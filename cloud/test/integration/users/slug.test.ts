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
import { SLUG_CLAIM_ATTEMPTS_PER_USER_PER_HOUR } from "../../../src/users";
import {
	expectErrorCode,
	expectOk,
	expectStatus,
} from "../../helpers/assertions";
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

	// The budget counts attempts, not successes: a user who hasn't claimed yet
	// can fire unlimited *rejected* claims, each a real D1 write and a probe
	// for whether a name is free. One-per-account successes can't bound that.
	it("429s past SLUG_CLAIM_ATTEMPTS_PER_USER_PER_HOUR attempts", async () => {
		const u = await makeUser();
		for (let i = 0; i < SLUG_CLAIM_ATTEMPTS_PER_USER_PER_HOUR; i++) {
			await env.SHARE_DB.prepare(
				`INSERT INTO events (event_type, user_id) VALUES ('slug_claim_attempt', ?)`,
			)
				.bind(u.userId)
				.run();
		}

		await expectErrorCode(await claim("over-budget", u), {
			status: 429,
			code: "RATE_LIMIT_SLUG_CLAIM",
		});
	});

	it("spends budget on a rejected claim, not just a successful one", async () => {
		const holder = await makeUser({ slug: "already-mine" });
		const other = await makeUser();

		await expectErrorCode(await claim("already-mine", other), {
			status: 409,
			code: "SLUG_TAKEN",
		});

		const row = await env.SHARE_DB.prepare(
			`SELECT COUNT(*) AS n FROM events
			 WHERE event_type = 'slug_claim_attempt' AND user_id = ?`,
		)
			.bind(other.userId)
			.first<{ n: number }>();
		expect(row?.n).toBe(1);
		// The holder is untouched — the failed claim took neither the name nor
		// the other user's budget.
		expect(holder.userId).not.toBe(other.userId);
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

interface GameDetailResponse {
	user_id: string;
	user_display_name: string;
	user_slug: string | null;
}

// The detail read's uploader fields are injected over the stored blob, so this
// asserts against a seeded blob rather than in local dev — the dev D1 snapshot
// carries no R2 objects, and the handler 404s before it serializes.
describe("users.slug — game detail", () => {
	it("injects user_slug beside user_display_name, null for an unclaimed uploader", async () => {
		const claimed = await makeUser({ slug: "detail-uploader" });
		const unclaimed = await makeUser();

		for (const [uploader, expected] of [
			[claimed, "detail-uploader"],
			[unclaimed, null],
		] as const) {
			const gameId = await seedGame(uploader, { isPublic: true });
			const body = await expectOk<GameDetailResponse>(
				await request.get({ path: `/v1/games/${gameId}` }),
			);
			expect(body.user_id).toBe(uploader.userId);
			expect(body.user_slug).toBe(expected);
		}
	});
});

interface StandingsResponse {
	divisions: {
		A: {
			standings: Array<{
				slot_id: string;
				user_id: string | null;
				slug: string | null;
			}>;
		};
	};
}

describe("users.slug — tournament standings", () => {
	it("ships the occupant's slug on their standings row, null on an unclaimed slot's", async () => {
		const owner = await makeUser({ slug: "seeded-player" });
		const t = await makeTournament({
			slotOwners: { A: [owner] },
			advanceTo: "swiss-round-1-generated",
		});

		const body = await expectOk<StandingsResponse>(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/standings`,
				as: owner,
			}),
		);
		const rows = body.divisions.A.standings;
		const claimed = rows.find((r) => r.user_id === owner.userId);
		expect(claimed?.slug).toBe("seeded-player");

		// makeTournament fills the rest of the division with unclaimed slots —
		// no account, so no slug, and ProfileLink leaves those names unlinked.
		const unclaimed = rows.find((r) => r.user_id === null);
		expect(unclaimed).toBeTruthy();
		expect(unclaimed!.slug).toBeNull();
	});
});

interface MatchesResponse {
	matches: Array<{
		match_id: string;
		status: string;
		slot_a_id: string;
		slot_a_user_id: string | null;
		slot_a_slug: string | null;
		slot_b_slug: string | null;
		parts: Array<{
			id: string;
			casters: Array<{ user_id: string | null; slug: string | null }>;
		}>;
	}>;
}

describe("users.slug — serializeMatch", () => {
	it("resolves slot_a_slug from the report-time snapshot occupant", async () => {
		const player = await makeUser({ slug: "match-winner" });
		const t = await makeTournament({
			slotOwners: { A: [player] },
			advanceTo: "swiss-round-1-complete",
		});

		const body = await expectOk<MatchesResponse>(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/matches`,
				as: player,
			}),
		);
		// The snapshot columns only exist once a match is decided; a pending one
		// carries nulls by design and the client falls back to its live maps.
		const decided = body.matches.find(
			(m) => m.status !== "pending" && m.slot_a_user_id === player.userId,
		);
		expect(decided).toBeTruthy();
		expect(decided!.slot_a_slug).toBe("match-winner");
		// Side B of that match is an unclaimed slot in the same fixture.
		expect(decided!.slot_b_slug).toBeNull();

		const pending = body.matches.find((m) => m.status === "pending");
		if (pending) expect(pending.slot_a_slug).toBeNull();
	});

	it("resolves a linked caster's slug and leaves a slug-less one null", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const match = (await t.matches()).find((m) => m.status === "pending")!;
		const scheduled = await expectOk<{
			match: { parts: Array<{ id: string }> };
		}>(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${match.match_id}/schedule`,
				as: t.admin,
				body: {
					parts: [
						{
							scheduled_at: "2026-08-01T18:00:00.000Z",
							casters: [],
							streams: [],
						},
					],
				},
			}),
		);
		const partId = scheduled.match.parts[0].id;

		const withSlug = await makeUser({ slug: "the-caster" });
		const withoutSlug = await makeUser();
		for (const caster of [withSlug, withoutSlug]) {
			await expectStatus(
				await request.post({
					path: `/v1/tournaments/${t.tournamentId}/matches/${match.match_id}/parts/${partId}/casters/me`,
					as: caster,
					body: {},
				}),
				204,
			);
		}

		const body = await expectOk<MatchesResponse>(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/matches`,
				as: t.admin,
			}),
		);
		const casters =
			body.matches.find((m) => m.match_id === match.match_id)?.parts[0]
				.casters ?? [];
		expect(casters.find((c) => c.user_id === withSlug.userId)?.slug).toBe(
			"the-caster",
		);
		expect(
			casters.find((c) => c.user_id === withoutSlug.userId)?.slug,
		).toBeNull();
	});
});
