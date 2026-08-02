// Behavior tests for the user-claimed profile URL (users.slug) — the claim
// endpoint, the resolver that serves /u/<slug>, and the identity payloads the
// slug rides along on.
//
// Covers:
//   * POST /v1/users/me/slug: happy path (and the lowercasing that lets a
//     user type mixed case), anonymous → 401, bad format → 400, reserved
//     name → 400, someone else's slug → 409, a second claim by the same
//     user → 409
//   * The claim's awaited audit row
//   * GET /v1/users/by-slug/:slug: resolves to the same payload the id route
//     serves, 404 for an unknown slug, 404 for a malformed one
//   * Propagation onto the identity payloads whose links would otherwise take
//     the /users/<id> → /u/<slug> redirect hop. Each case also asserts the
//     un-claimed neighbour still reads null, because a payload that returned a
//     slug for everyone would pass a one-sided check.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
	expectErrorCode,
	expectOk,
	expectStatus,
} from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { seedGame } from "../../helpers/games";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface ClaimResponse {
	slug: string;
}

interface ProfileResponse {
	user_id: string;
	display_name: string;
	avatar_url: string;
	slug: string | null;
	summary: { total_games: number };
	channels: unknown[];
	tournament_participant: boolean;
}

function claim(slug: string, as?: TestUser): Promise<Response> {
	return request.post({ path: "/v1/users/me/slug", body: { slug }, as });
}

describe("POST /v1/users/me/slug", () => {
	it("claims the slug and echoes the stored value", async () => {
		const u = await makeUser();

		const body = await expectOk<ClaimResponse>(await claim("claimed-name", u));
		expect(body.slug).toBe("claimed-name");

		const profile = await expectOk<ProfileResponse>(
			await request.get({ path: `/v1/users/${u.userId}` }),
		);
		expect(profile.slug).toBe("claimed-name");
	});

	it("lowercases and trims, so mixed-case input claims the lowercase name", async () => {
		const u = await makeUser();

		const body = await expectOk<ClaimResponse>(await claim("  MixedCase  ", u));
		expect(body.slug).toBe("mixedcase");

		// The stored value is the normalized one, so the pretty URL — which is
		// lowercase-only — resolves it.
		const profile = await expectOk<ProfileResponse>(
			await request.get({ path: "/v1/users/by-slug/mixedcase" }),
		);
		expect(profile.user_id).toBe(u.userId);
	});

	it("writes a slug_claim audit row", async () => {
		const u = await makeUser();
		await expectOk(await claim("audited-claim", u));

		const ev = await env.SHARE_DB.prepare(
			`SELECT event_type, user_id, metadata FROM events
			 WHERE event_type = 'slug_claim' AND user_id = ?
			 ORDER BY rowid DESC LIMIT 1`,
		)
			.bind(u.userId)
			.first<{ event_type: string; user_id: string; metadata: string }>();
		expect(ev).toBeTruthy();
		const meta = JSON.parse(ev!.metadata) as { slug: string };
		expect(meta.slug).toBe("audited-claim");
	});

	it("requires a session", async () => {
		await expectErrorCode(await claim("anon-claim"), {
			status: 401,
			code: "UNAUTHORIZED",
		});
	});

	it.each([
		["ab", "below the 3-char floor"],
		["a".repeat(31), "over the 30-char ceiling"],
		["-leading", "leading hyphen"],
		["trailing-", "trailing hyphen"],
		["has space", "space"],
		["under_score", "underscore"],
	])("rejects %j (%s) with 400 INVALID_SLUG", async (bad) => {
		const u = await makeUser();
		await expectErrorCode(await claim(bad, u), {
			status: 400,
			code: "INVALID_SLUG",
		});
	});

	it("rejects a reserved name with 400 INVALID_SLUG", async () => {
		const u = await makeUser();
		await expectErrorCode(await claim("moderator", u), {
			status: 400,
			code: "INVALID_SLUG",
		});
	});

	it("rejects a slug another user already holds with 409 SLUG_TAKEN", async () => {
		const holder = await makeUser();
		const other = await makeUser();
		await expectOk(await claim("contested", holder));

		await expectErrorCode(await claim("contested", other), {
			status: 409,
			code: "SLUG_TAKEN",
		});
	});

	it("rejects a second claim by the same user with 409 SLUG_ALREADY_SET", async () => {
		const u = await makeUser();
		await expectOk(await claim("first-pick", u));

		await expectErrorCode(await claim("second-pick", u), {
			status: 409,
			code: "SLUG_ALREADY_SET",
		});

		// Set-once means the first claim stands — the failed one didn't
		// overwrite it, and didn't take the name it asked for either.
		const profile = await expectOk<ProfileResponse>(
			await request.get({ path: `/v1/users/${u.userId}` }),
		);
		expect(profile.slug).toBe("first-pick");
		await expectStatus(
			await request.get({ path: "/v1/users/by-slug/second-pick" }),
			404,
		);
	});
});

describe("GET /v1/users/by-slug/:slug", () => {
	it("serves the same payload as the id route", async () => {
		const u = await makeUser({ slug: "parity-check" });

		const byId = await expectOk<ProfileResponse>(
			await request.get({ path: `/v1/users/${u.userId}` }),
		);
		const bySlug = await expectOk<ProfileResponse>(
			await request.get({ path: "/v1/users/by-slug/parity-check" }),
		);

		expect(bySlug).toEqual(byId);
		expect(bySlug.slug).toBe("parity-check");
		expect(bySlug.user_id).toBe(u.userId);
	});

	it("404s an unknown slug", async () => {
		await expectErrorCode(
			await request.get({ path: "/v1/users/by-slug/nobody-here" }),
			{ status: 404, code: "NOT_FOUND" },
		);
	});

	// A malformed slug never reaches the handler — the route pattern admits
	// only the stored lowercase shape, so these fall through the router.
	it.each([
		["ab", "below the floor"],
		["UPPER", "uppercase"],
		["-leading", "leading hyphen"],
		["trailing-", "trailing hyphen"],
		["has_underscore", "underscore"],
	])("404s the malformed slug %j (%s)", async (bad) => {
		await expectStatus(
			await request.get({ path: `/v1/users/by-slug/${bad}` }),
			404,
		);
	});
});

// ---------------------------------------------------------------------------
// B5b — slug propagation onto the identity payloads
//
// Each surface below emits a profile link. Without the slug the link is the
// /users/<id> permalink, which 308s; with it the link is already canonical.
// Nothing breaks when a slug is absent, which is exactly why every case here
// also pins the null.
// ---------------------------------------------------------------------------

interface PublicRecentResponse {
	games: Array<{
		game_id: string;
		uploader_user_id: string;
		uploader_slug: string | null;
	}>;
}

describe("users.slug — public-recent", () => {
	it("ships uploader_slug for a claimed uploader and null for an unclaimed one", async () => {
		const claimed = await makeUser({ slug: "feed-uploader" });
		const unclaimed = await makeUser();
		const claimedGame = await seedGame(claimed, { isPublic: true });
		const unclaimedGame = await seedGame(unclaimed, { isPublic: true });

		const body = await expectOk<PublicRecentResponse>(
			await request.get({ path: "/v1/games/public-recent" }),
		);
		const byId = new Map(body.games.map((g) => [g.game_id, g]));
		expect(byId.get(claimedGame)?.uploader_slug).toBe("feed-uploader");
		expect(byId.get(unclaimedGame)?.uploader_slug).toBeNull();
	});
});

