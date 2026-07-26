// Integration tests for the section filters on the two admin list endpoints —
// GET /v1/admin/games/out-of-date and GET /v1/admin/games/all. Both share
// parseAdminGameFilter / buildAdminGameFilterWhere (cloud/src/games-scope.ts),
// so every case is asserted against both: a filter that works on one list and
// not the other would let a sweep silently act on the wrong section.
//
// Games are seeded by direct INSERT — the subject is the handlers' query, not
// the upload pipeline.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
	expectErrorCode,
	expectOk,
	expectStatus,
} from "../../helpers/assertions";
import {
	makeSiteAdmin,
	makeTournament,
	makeUser,
	type TestUser,
} from "../../helpers/builders";
import { request } from "../../helpers/requests";

// One site admin for the file: users.discord_id is unique, and the Worker
// recognizes exactly one. Seeded in beforeAll so it survives per-test storage
// isolation.
let admin: TestUser;

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	admin = await makeSiteAdmin();
});

// Every seeded game is out-of-date w.r.t. CURRENT unless it says otherwise, so
// the two lists cover the same rows and can be asserted side by side.
const CURRENT = "3.0.0";
const STALE = "2.5.0";

async function seedGame(
	user: TestUser,
	opts?: { parserVersion?: string; createdAt?: string },
): Promise<string> {
	const gameId = nanoid(21);
	const createdAt = opts?.createdAt;
	await env.SHARE_DB.prepare(
		`INSERT INTO games (
			game_id, user_id, xml_game_id, total_turns, file_hash,
			is_public, blob_version, blob_size_bytes, parser_version
			${createdAt ? ", created_at" : ""}
		) VALUES (?, ?, ?, 50, ?, 0, 2, 1024, ?${createdAt ? ", ?" : ""})`,
	)
		.bind(
			gameId,
			user.userId,
			nanoid(36),
			nanoid(64),
			opts?.parserVersion ?? STALE,
			...(createdAt ? [createdAt] : []),
		)
		.run();
	return gameId;
}

// Attach a game to a match without driving the report pipeline — the filter
// only cares about (game_id, status).
async function linkMatch(
	matchId: string,
	gameId: string,
	status: "complete" | "pending",
): Promise<void> {
	await env.SHARE_DB.prepare(
		"UPDATE tournament_matches SET game_id = ?, status = ? WHERE match_id = ?",
	)
		.bind(gameId, status, matchId)
		.run();
}

interface OutOfDateBody {
	games: { game_id: string }[];
}
interface AllBody {
	games: { game_id: string }[];
}

// Both lists, same filter, as id sets — every assertion below is "which games
// would this sweep touch".
async function sweepSets(
	query: string,
): Promise<{ outOfDate: Set<string>; all: Set<string> }> {
	const sep = query ? "&" : "";
	const outOfDateBody = await expectOk<OutOfDateBody>(
		await request.get({
			path: `/v1/admin/games/out-of-date?version=${CURRENT}${sep}${query}`,
			as: admin,
		}),
	);
	const allBody = await expectOk<AllBody>(
		await request.get({
			path: `/v1/admin/games/all${query ? `?${query}` : ""}`,
			as: admin,
		}),
	);
	return {
		outOfDate: new Set(outOfDateBody.games.map((g) => g.game_id)),
		all: new Set(allBody.games.map((g) => g.game_id)),
	};
}

describe("admin game list section filters", () => {
	it("404s both lists for a non-admin", async () => {
		const mortal = await makeUser({ discordUsername: "not-an-admin" });
		await expectStatus(
			await request.get({
				path: `/v1/admin/games/out-of-date?version=${CURRENT}`,
				as: mortal,
			}),
			404,
		);
		await expectStatus(
			await request.get({ path: "/v1/admin/games/all", as: mortal }),
			404,
		);
	});

	it("filters both lists to one owner", async () => {
		const owner = await makeUser({ discordUsername: "filter-owner" });
		const other = await makeUser({ discordUsername: "filter-other" });
		const mine = await seedGame(owner);
		const theirs = await seedGame(other);

		const scoped = await sweepSets(`user_id=${owner.userId}`);
		expect(scoped.outOfDate.has(mine)).toBe(true);
		expect(scoped.outOfDate.has(theirs)).toBe(false);
		expect(scoped.all.has(mine)).toBe(true);
		expect(scoped.all.has(theirs)).toBe(false);

		// Unfiltered still sees both — the filter narrows, it doesn't persist.
		const unscoped = await sweepSets("");
		expect(unscoped.outOfDate.has(theirs)).toBe(true);
		expect(unscoped.all.has(theirs)).toBe(true);
	});

	it("filters both lists to a tournament's completed matches", async () => {
		const owner = await makeUser({ discordUsername: "tourney-owner" });
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const matches = await t.matches();

		const completed = await seedGame(owner);
		const stillPending = await seedGame(owner);
		const unlinked = await seedGame(owner);
		await linkMatch(matches[0].match_id, completed, "complete");
		await linkMatch(matches[1].match_id, stillPending, "pending");

		const scoped = await sweepSets(`tournament_id=${t.tournamentId}`);
		for (const set of [scoped.outOfDate, scoped.all]) {
			expect(set.has(completed)).toBe(true);
			// A retro-edit can leave a game on a match that isn't complete; the
			// tournament's stats corpus excludes those, so the sweep does too.
			expect(set.has(stillPending)).toBe(false);
			expect(set.has(unlinked)).toBe(false);
		}
	});

	it("treats from/to as inclusive calendar days", async () => {
		const owner = await makeUser({ discordUsername: "date-owner" });
		const before = await seedGame(owner, { createdAt: "2026-03-31 23:59:59" });
		// Both boundary days carry a late timestamp: `to` is the bound that has
		// to survive a same-day time component.
		const first = await seedGame(owner, { createdAt: "2026-04-01 00:00:01" });
		const last = await seedGame(owner, { createdAt: "2026-04-03 23:59:59" });
		const after = await seedGame(owner, { createdAt: "2026-04-04 00:00:01" });

		const scoped = await sweepSets("from=2026-04-01&to=2026-04-03");
		for (const set of [scoped.outOfDate, scoped.all]) {
			expect(set.has(first)).toBe(true);
			expect(set.has(last)).toBe(true);
			expect(set.has(before)).toBe(false);
			expect(set.has(after)).toBe(false);
		}

		// Open-ended: `from` alone leaves the upper bound off.
		const openEnded = await sweepSets("from=2026-04-04");
		for (const set of [openEnded.outOfDate, openEnded.all]) {
			expect(set.has(after)).toBe(true);
			expect(set.has(last)).toBe(false);
		}
	});

	it("keeps the parser-version predicate inside the section", async () => {
		const owner = await makeUser({ discordUsername: "version-owner" });
		const stale = await seedGame(owner);
		const current = await seedGame(owner, { parserVersion: CURRENT });

		const scoped = await sweepSets(`user_id=${owner.userId}`);
		expect(scoped.outOfDate.has(stale)).toBe(true);
		// Reparse targets only what's out of date; reindex applies to every
		// game in the section.
		expect(scoped.outOfDate.has(current)).toBe(false);
		expect(scoped.all.has(current)).toBe(true);
	});

	it("400s both lists on a malformed filter rather than sweeping wide", async () => {
		for (const bad of [
			"user_id=nope",
			"tournament_id=nope",
			"from=04-01-2026",
		]) {
			await expectErrorCode(
				await request.get({
					path: `/v1/admin/games/out-of-date?version=${CURRENT}&${bad}`,
					as: admin,
				}),
				{ status: 400, code: "INVALID_QUERY" },
			);
			await expectErrorCode(
				await request.get({ path: `/v1/admin/games/all?${bad}`, as: admin }),
				{ status: 400, code: "INVALID_QUERY" },
			);
		}
	});

	it("ignores empty filter values", async () => {
		const owner = await makeUser({ discordUsername: "empty-owner" });
		const game = await seedGame(owner);

		const scoped = await sweepSets("user_id=&tournament_id=&from=&to=");
		expect(scoped.outOfDate.has(game)).toBe(true);
		expect(scoped.all.has(game)).toBe(true);
	});
});
