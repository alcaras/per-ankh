// Integration tests for the per-POP blob cache in front of the R2 read on
// GET /v1/games/:id (cloud/src/blob-cache.ts, issue #150).
//
// The tier is invisible from the response body, so each test proves it by
// deleting the R2 object out from under the handler while leaving the games
// row intact, then re-reading:
//   - served from cache  → still 200
//   - not cached (owner) → 404 BLOB_MISSING
//
// That same trick pins the design's load-bearing property: authorization is
// re-read from D1 on every request, ahead of the cache, so a cached entry can
// never outlive the permission to read it.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// Minimal FullGameData-shaped blob. handleGameDetail only JSON-parses it and
// spreads D1 metadata over the top, so the parser-level shape doesn't matter
// here — player_roster carries an online_id so the PII strip is exercised.
function makeBlob(gameName: string): Record<string, unknown> {
	return {
		match_metadata: { game_name: gameName, winner: null },
		player_roster: [{ player_index: 0, online_id: "STEAM_SECRET" }],
	};
}

async function putBlob(
	gameId: string,
	blob: Record<string, unknown>,
): Promise<void> {
	const gz = new Response(
		new Response(JSON.stringify(blob)).body!.pipeThrough(
			new CompressionStream("gzip"),
		),
	);
	await env.SHARE_BUCKET.put(
		`games/${gameId}.json.gz`,
		await gz.arrayBuffer(),
		{ httpMetadata: { contentType: "application/json" } },
	);
}

async function seedGame(
	user: TestUser,
	opts: { isPublic: boolean; gameName?: string },
): Promise<string> {
	const gameId = nanoid(21);
	await env.SHARE_DB.prepare(
		`INSERT INTO games (
			game_id, user_id, xml_game_id, total_turns, file_hash,
			game_name, is_public, blob_version, blob_size_bytes, parser_version
		) VALUES (?, ?, ?, ?, ?, ?, ?, 2, 1024, '1.0.0')`,
	)
		.bind(
			gameId,
			user.userId,
			nanoid(36),
			50,
			nanoid(64),
			opts.gameName ?? "Test Game",
			opts.isPublic ? 1 : 0,
		)
		.run();
	await putBlob(gameId, makeBlob(opts.gameName ?? "Test Game"));
	return gameId;
}

interface DetailBody {
	match_metadata: { game_name: string };
	player_roster: { online_id: string | null }[];
	display_name: string | null;
}

describe("blob cache on GET /v1/games/:id", () => {
	it("serves an anonymous re-read from cache after the R2 object is gone", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });

		// Cold: fills the cache.
		await expectOk(await request.get({ path: `/v1/games/${gameId}` }));

		// Pull the object out of R2. D1 row stays, so the auth gate still
		// passes and the read falls to the cache.
		await env.SHARE_BUCKET.delete(`games/${gameId}.json.gz`);

		const warm = await expectOk<DetailBody>(
			await request.get({ path: `/v1/games/${gameId}` }),
		);
		expect(warm.match_metadata.game_name).toBe("Test Game");
	});

	it("still strips online_id when the bytes come from cache", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });

		await expectOk(await request.get({ path: `/v1/games/${gameId}` }));
		await env.SHARE_BUCKET.delete(`games/${gameId}.json.gz`);

		// The cache holds raw blob bytes; stripOnlineIds runs per request on
		// the parsed result, so a hit must be just as stripped as a miss.
		// The key survives with a null value — see stripOnlineIdsDeep.
		const warm = await expectOk<DetailBody>(
			await request.get({ path: `/v1/games/${gameId}` }),
		);
		expect(warm.player_roster[0].online_id).toBeNull();
	});

	it("does not cache the owner's read", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });

		const first = await expectOk<DetailBody>(
			await request.get({ path: `/v1/games/${gameId}`, as: owner }),
		);
		// Owners keep online_id — confirms this really is the owner path.
		expect(first.player_roster[0].online_id).toBe("STEAM_SECRET");

		await env.SHARE_BUCKET.delete(`games/${gameId}.json.gz`);

		// `private, no-store` means a post-reparse reload must see fresh bytes,
		// so the owner path must never read through the cache.
		await expectErrorCode(
			await request.get({ path: `/v1/games/${gameId}`, as: owner }),
			{ status: 404, code: "BLOB_MISSING" },
		);
	});

	it("re-authorizes from D1, so a private flip is not served from cache", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });

		// Warm the cache as an anonymous viewer.
		await expectOk(await request.get({ path: `/v1/games/${gameId}` }));

		// Flip to private with no cache invalidation anywhere — the whole
		// point of caching bytes rather than the response.
		await env.SHARE_DB.prepare(
			"UPDATE games SET is_public = 0 WHERE game_id = ?",
		)
			.bind(gameId)
			.run();

		await expectErrorCode(await request.get({ path: `/v1/games/${gameId}` }), {
			status: 401,
			code: "UNAUTHORIZED",
		});
	});

	it("re-authorizes from D1, so a deleted game is not served from cache", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });

		await expectOk(await request.get({ path: `/v1/games/${gameId}` }));

		// Mirrors the admin CLI's out-of-band delete: the games row goes away
		// alongside the R2 object, with no in-Worker hook to invalidate.
		await env.SHARE_DB.prepare("DELETE FROM games WHERE game_id = ?")
			.bind(gameId)
			.run();
		await env.SHARE_BUCKET.delete(`games/${gameId}.json.gz`);

		await expectErrorCode(await request.get({ path: `/v1/games/${gameId}` }), {
			status: 404,
			code: "NOT_FOUND",
		});
	});

	it("drifts the key when parser_version advances, so a reparse can't serve stale bytes", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });

		// Warm the cache at the seeded version.
		await expectOk(await request.get({ path: `/v1/games/${gameId}` }));

		// A re-import overwrites the blob and lands a strictly-newer
		// parser_version on the games row. Bumping the row alone is enough to
		// prove the key moved: with the old key still in play the deleted R2
		// object would be papered over by the warm entry.
		await env.SHARE_DB.prepare(
			"UPDATE games SET parser_version = '2.0.0' WHERE game_id = ?",
		)
			.bind(gameId)
			.run();
		await env.SHARE_BUCKET.delete(`games/${gameId}.json.gz`);

		await expectErrorCode(await request.get({ path: `/v1/games/${gameId}` }), {
			status: 404,
			code: "BLOB_MISSING",
		});

		// And the new version caches independently of the orphaned entry.
		await putBlob(gameId, makeBlob("Reparsed"));
		const fresh = await expectOk<DetailBody>(
			await request.get({ path: `/v1/games/${gameId}` }),
		);
		expect(fresh.match_metadata.game_name).toBe("Reparsed");
	});

	it("does not negative-cache a missing blob", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });
		await env.SHARE_BUCKET.delete(`games/${gameId}.json.gz`);

		await expectErrorCode(await request.get({ path: `/v1/games/${gameId}` }), {
			status: 404,
			code: "BLOB_MISSING",
		});

		// Restoring the object must take effect immediately, not after a TTL.
		await putBlob(gameId, makeBlob("Restored"));
		const restored = await expectOk<DetailBody>(
			await request.get({ path: `/v1/games/${gameId}` }),
		);
		expect(restored.match_metadata.game_name).toBe("Restored");
	});
});
