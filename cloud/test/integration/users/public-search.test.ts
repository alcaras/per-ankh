// Behavior tests for GET /v1/users/public-search — the "Players" group in
// the header search, and the public-facing sibling of /v1/users/search.
//
// Covers:
//   * Auth (anonymous → 401)
//   * "Still typing" floor (q.length < 2 returns empty, writes no audit row)
//   * Prefix matching on display_name and on alias — and NOT on
//     discord_username, which a public endpoint must not confirm
//   * The response carries no discord_* field at all (discord_id is still
//     read server-side to build avatar_url; it just never ships)
//   * Per-user rate limit at PUBLIC_USER_SEARCH_PER_USER_PER_HOUR
//   * Decision 2 scoping: only users who made something public are findable
//     (public game / tournament slot / linked video channel)

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_USER_SEARCH_PER_USER_PER_HOUR } from "../../../src/users";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import {
	makeTournament,
	makeUser,
	type TestUser,
} from "../../helpers/builders";
import { seedGame } from "../../helpers/games";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface PublicSearchResponse {
	users: Array<{
		user_id: string;
		display_name: string;
		avatar_url: string;
	}>;
}

async function search(
	caller: TestUser,
	q: string,
): Promise<PublicSearchResponse> {
	return expectOk<PublicSearchResponse>(
		await request.get({
			path: `/v1/users/public-search?q=${encodeURIComponent(q)}`,
			as: caller,
		}),
	);
}

async function idsMatching(caller: TestUser, q: string): Promise<string[]> {
	return (await search(caller, q)).users.map((u) => u.user_id);
}

// Seed N user_search_public audit rows for `userId`, reaching the ceiling
// without firing N real searches.
async function seedPublicSearchEvents(
	userId: string,
	count: number,
): Promise<void> {
	for (let i = 0; i < count; i++) {
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, user_id, metadata)
			 VALUES ('user_search_public', ?, ?)`,
		)
			.bind(userId, JSON.stringify({ seed: true, index: i }))
			.run();
	}
}

async function auditRowCount(userId: string): Promise<number> {
	const row = await env.SHARE_DB.prepare(
		`SELECT COUNT(*) AS n FROM events
		 WHERE event_type = 'user_search_public' AND user_id = ?`,
	)
		.bind(userId)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

// Public activity is the precondition for being findable at all, so every
// matching-behavior test needs a user who has some. A public game is the
// cheapest leg; the scoping block below exercises the other two.
async function makeFindableUser(
	opts: Parameters<typeof makeUser>[0],
): Promise<TestUser> {
	const u = await makeUser(opts);
	await seedGame(u, { isPublic: true });
	return u;
}

describe("GET /v1/users/public-search — auth", () => {
	it("returns 401 to an unauthenticated request", async () => {
		const res = await request.get({ path: "/v1/users/public-search?q=ab" });
		await expectErrorCode(res, { status: 401, code: "UNAUTHORIZED" });
	});
});

describe("GET /v1/users/public-search — matching", () => {
	it("returns an empty list for q.length < 2 and writes no audit row", async () => {
		const caller = await makeUser();
		const body = await search(caller, "a");
		expect(body.users).toEqual([]);
		expect(await auditRowCount(caller.userId)).toBe(0);
	});

	it("matches a prefix of display_name, not a suffix", async () => {
		const caller = await makeUser();
		const target = await makeFindableUser({
			displayName: "Nefertari the Scribe",
		});

		expect(await idsMatching(caller, "nefer")).toContain(target.userId);
		expect(await idsMatching(caller, "scribe")).not.toContain(target.userId);
	});

	it("matches a prefix of alias, and returns the alias as display_name", async () => {
		const caller = await makeUser();
		const target = await makeFindableUser({
			displayName: "Aliased Under Wadjet",
			alias: "Wadjethotep",
		});

		const body = await search(caller, "wadjet");
		const hit = body.users.find((u) => u.user_id === target.userId);
		expect(hit).toBeTruthy();
		expect(hit!.display_name).toBe("Wadjethotep");
	});

	it("does NOT match a prefix of discord_username", async () => {
		const caller = await makeUser();
		const target = await makeFindableUser({
			displayName: "Khepri Sunrise",
			discordUsername: "qorvex-handle",
		});

		// The @ handle is not a search key here — matching it would confirm
		// Discord-handle prefixes to any logged-in caller.
		expect(await idsMatching(caller, "qorvex")).not.toContain(target.userId);
		// Sanity: the same user IS findable by the name the site shows.
		expect(await idsMatching(caller, "khepri")).toContain(target.userId);
	});

	it("returns only user_id, display_name and avatar_url — no discord_* field", async () => {
		const caller = await makeUser();
		await makeFindableUser({ displayName: "Ptahmose Fieldcheck" });

		const body = await search(caller, "ptahmose");
		expect(body.users.length).toBeGreaterThan(0);
		for (const u of body.users) {
			expect(Object.keys(u).sort()).toEqual([
				"avatar_url",
				"display_name",
				"user_id",
			]);
		}
		// discord_id is still read server-side — it addresses the CDN — which
		// is exactly why its absence from the payload has to be asserted.
		expect(body.users[0].avatar_url).toMatch(
			/^https:\/\/cdn\.discordapp\.com\//,
		);
	});
});

describe("GET /v1/users/public-search — scoped to public activity", () => {
	it("omits a user with no public game, tournament slot, or video channel", async () => {
		const caller = await makeUser();
		const invisible = await makeUser({ displayName: "Sobeknakht Quiet" });
		const visible = await makeFindableUser({
			displayName: "Sobeknakht Loud",
		});

		const ids = await idsMatching(caller, "sobeknakht");
		expect(ids).toContain(visible.userId);
		expect(ids).not.toContain(invisible.userId);
	});

	it("does not count a private game as public activity", async () => {
		const caller = await makeUser();
		const u = await makeUser({ displayName: "Amenirdis Unlisted" });
		await seedGame(u, { isPublic: false });

		expect(await idsMatching(caller, "amenirdis")).not.toContain(u.userId);
	});

	it("finds a user whose only public activity is a tournament slot", async () => {
		const caller = await makeUser();
		const player = await makeUser({ displayName: "Herihor Seated" });
		await makeTournament({ slotOwners: { A: [player] } });

		expect(await idsMatching(caller, "herihor")).toContain(player.userId);
	});

	it("finds a user whose only public activity is a linked video channel", async () => {
		const caller = await makeUser();
		const creator = await makeUser({ displayName: "Meritaten Streams" });
		await env.SHARE_DB.prepare(
			`INSERT INTO user_video_channels (user_id, platform, channel_url, channel_id)
			 VALUES (?, 'youtube', ?, ?)`,
		)
			.bind(
				creator.userId,
				"https://www.youtube.com/@meritaten",
				"UCmeritaten00000000000",
			)
			.run();

		expect(await idsMatching(caller, "meritaten")).toContain(creator.userId);
	});
});

describe("GET /v1/users/public-search — rate limit", () => {
	it("returns 429 RATE_LIMIT_USER_SEARCH_PUBLIC after PUBLIC_USER_SEARCH_PER_USER_PER_HOUR audited searches", async () => {
		const caller = await makeUser();
		await seedPublicSearchEvents(
			caller.userId,
			PUBLIC_USER_SEARCH_PER_USER_PER_HOUR,
		);
		const res = await request.get({
			path: "/v1/users/public-search?q=anything",
			as: caller,
		});
		await expectErrorCode(res, {
			status: 429,
			code: "RATE_LIMIT_USER_SEARCH_PUBLIC",
		});
	});
});
