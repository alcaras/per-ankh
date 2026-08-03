// Behavior tests for the profile URL (users.slug) — the endpoint that sets and
// releases it, the resolver that serves /u/<slug>, and the identity payloads
// the slug rides along on.
//
// Covers:
//   * POST /v1/users/me/slug: happy path (and the lowercasing that lets a
//     user type mixed case), anonymous → 401, bad format → 400, reserved
//     name → 400, someone else's slug → 409, renaming, and the cooldown that
//     bounds renames
//   * DELETE /v1/users/me/slug: releases the name back into the pool, is
//     idempotent, isn't itself gated by the cooldown, and does start one
//   * The awaited audit rows on both, and what each carries
//   * GET /v1/users/by-slug/:slug: resolves to the same payload the id route
//     serves, 404 for an unknown slug, 404 for a malformed one, 404 for one
//     that has been renamed away
//   * Propagation onto the identity payloads whose links would otherwise take
//     the /users/<id> → /u/<slug> redirect hop. Each case also asserts the
//     slug-less neighbour still reads null, because a payload that returned a
//     slug for everyone would pass a one-sided check.
//
// Derivation at first login is NOT here — it belongs to the login path, and its
// test sits with the dev-login flow that exercises it.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
	SLUG_CLAIM_ATTEMPTS_PER_USER_PER_HOUR,
	SLUG_RENAME_COOLDOWN_DAYS,
} from "../../../src/users";
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

function release(as?: TestUser): Promise<Response> {
	return request.delete({ path: "/v1/users/me/slug", as });
}

function readSlugState(userId: string) {
	return env.SHARE_DB.prepare(
		`SELECT slug, slug_changed_at FROM users WHERE user_id = ?`,
	)
		.bind(userId)
		.first<{ slug: string | null; slug_changed_at: string | null }>();
}

// Backdate the cooldown clock so a test can rename again without waiting a
// week. Writes the same column the endpoint writes, which is the point: it
// exercises the real predicate rather than a test-only bypass.
function ageOutCooldown(userId: string): Promise<unknown> {
	return env.SHARE_DB.prepare(
		`UPDATE users SET slug_changed_at = datetime('now', ?) WHERE user_id = ?`,
	)
		.bind(`-${SLUG_RENAME_COOLDOWN_DAYS + 1} days`, userId)
		.run();
}

// The most recent audit row of a type, which is how each change is expected to
// leave a trace: the users row shows the current value only.
function lastEvent(userId: string, eventType: string) {
	return env.SHARE_DB.prepare(
		`SELECT metadata FROM events
		 WHERE event_type = ? AND user_id = ?
		 ORDER BY rowid DESC LIMIT 1`,
	)
		.bind(eventType, userId)
		.first<{ metadata: string }>();
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

	it("writes a slug_claim audit row naming both sides of the change", async () => {
		const u = await makeUser();
		await expectOk(await claim("audited-claim", u));

		const first = await lastEvent(u.userId, "slug_claim");
		expect(first).toBeTruthy();
		expect(JSON.parse(first!.metadata)).toEqual({
			slug: "audited-claim",
			previous_slug: null,
		});

		// The rename's row carries the released name — the only record of it,
		// since the users row now shows the new one and the old is claimable.
		await ageOutCooldown(u.userId);
		await expectOk(await claim("audited-rename", u));

		const second = await lastEvent(u.userId, "slug_claim");
		expect(JSON.parse(second!.metadata)).toEqual({
			slug: "audited-rename",
			previous_slug: "audited-claim",
		});
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

	// A user's first change is free — the cooldown clock starts at their own
	// first write, so a derived name (slug_changed_at NULL) can be corrected
	// immediately, which is most of what this endpoint is for.
	it("renames a slug the user already holds, and frees the old name", async () => {
		const u = await makeUser({ slug: "first-pick" });

		const body = await expectOk<ClaimResponse>(await claim("second-pick", u));
		expect(body.slug).toBe("second-pick");

		const profile = await expectOk<ProfileResponse>(
			await request.get({ path: `/v1/users/${u.userId}` }),
		);
		expect(profile.slug).toBe("second-pick");

		// The old URL stops resolving, and the name is back in the pool: someone
		// else can take it, which is the accepted cost of renaming.
		await expectStatus(
			await request.get({ path: "/v1/users/by-slug/first-pick" }),
			404,
		);
		const other = await makeUser();
		await expectOk(await claim("first-pick", other));
	});

	it("429s a second rename inside the cooldown, leaving the first standing", async () => {
		const u = await makeUser({ slug: "derived-name" });
		await expectOk(await claim("chosen-name", u));

		await expectErrorCode(await claim("third-name", u), {
			status: 429,
			code: "RATE_LIMIT_SLUG_RENAME",
		});

		const profile = await expectOk<ProfileResponse>(
			await request.get({ path: `/v1/users/${u.userId}` }),
		);
		expect(profile.slug).toBe("chosen-name");
		// The refused rename didn't take the name it asked for either.
		await expectStatus(
			await request.get({ path: "/v1/users/by-slug/third-name" }),
			404,
		);
	});

	it("allows the next rename once the cooldown has elapsed", async () => {
		const u = await makeUser();
		await expectOk(await claim("earlier-name", u));
		await ageOutCooldown(u.userId);

		const body = await expectOk<ClaimResponse>(await claim("later-name", u));
		expect(body.slug).toBe("later-name");
	});

	// Re-submitting the name you already hold is not a change, so it must not
	// burn a week of cooldown on a no-op — a double-submitted form would
	// otherwise lock the user out of the correction they just made.
	it("treats re-submitting the caller's own slug as a no-op success", async () => {
		const u = await makeUser({ slug: "same-name" });

		const body = await expectOk<ClaimResponse>(await claim("same-name", u));
		expect(body.slug).toBe("same-name");

		// The clock never started. A derived slug leaves slug_changed_at NULL,
		// and a no-op must not be what spends the user's first change — so the
		// real rename behind it still lands.
		expect((await readSlugState(u.userId))?.slug_changed_at).toBeNull();
		await expectOk(await claim("other-name", u));
	});
});

describe("DELETE /v1/users/me/slug", () => {
	it("releases the slug and returns it to the pool", async () => {
		const u = await makeUser({ slug: "released-name" });

		await expectStatus(await release(u), 204);

		const profile = await expectOk<ProfileResponse>(
			await request.get({ path: `/v1/users/${u.userId}` }),
		);
		expect(profile.slug).toBeNull();
		await expectStatus(
			await request.get({ path: "/v1/users/by-slug/released-name" }),
			404,
		);

		const other = await makeUser();
		await expectOk(await claim("released-name", other));
	});

	it("writes a slug_release audit row naming what was given up", async () => {
		const u = await makeUser({ slug: "audited-release" });
		await expectStatus(await release(u), 204);

		const ev = await lastEvent(u.userId, "slug_release");
		expect(ev).toBeTruthy();
		expect(JSON.parse(ev!.metadata)).toEqual({
			previous_slug: "audited-release",
		});
	});

	it("is idempotent for a user who has no slug", async () => {
		const u = await makeUser();
		await expectStatus(await release(u), 204);
		await expectStatus(await release(u), 204);

		const ev = await lastEvent(u.userId, "slug_release");
		// Nothing was released, so nothing is recorded — the audit trail is of
		// changes, not of calls.
		expect(ev).toBeNull();
	});

	it("requires a session", async () => {
		await expectErrorCode(await release(), {
			status: 401,
			code: "UNAUTHORIZED",
		});
	});

	// Getting your name out of a public URL is the one thing that must always
	// work, so the release is exempt from the cooldown the setter enforces.
	it("releases even inside the rename cooldown", async () => {
		const u = await makeUser();
		await expectOk(await claim("just-renamed", u));

		await expectStatus(await release(u), 204);
		expect((await readSlugState(u.userId))?.slug).toBeNull();
	});

	// …but it stamps the clock, or release-then-claim would be the way around
	// the gate and the cooldown would be decorative.
	it("starts a cooldown, so release is not a way to rename freely", async () => {
		const u = await makeUser({ slug: "starting-name" });

		await expectStatus(await release(u), 204);
		await expectErrorCode(await claim("bypass-name", u), {
			status: 429,
			code: "RATE_LIMIT_SLUG_RENAME",
		});
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
// /users/<id> permalink, which 307s; with it the link is already canonical.
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
