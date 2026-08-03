// POST /v1/tournaments/:id/rounds/:round_id/matches — late pairing into an
// open Swiss round. Pins the full substitution arc the endpoint exists for
// (withdraw → next round pairs without them → reinstate → add a catch-up
// match), plus the invariants that make it safe: the added match blocks the
// round from closing until reported, feeds the next round's pairing like any
// other result, gets its map from the same engine as round generation, and
// every eligibility gate rejects with a specific code.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";
import type { MatchRow, RoundRow } from "../../../src/tournament/data";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface MatchBody {
	match: MatchRow;
}

// Build the endpoint's home scenario: withdraw both division-A players who
// then get substituted, let round 2 generate without them, reinstate them.
// Returns everything the tests poke at.
async function substitutionScenario() {
	// Three scripts so the reinstated pair always has a script fresh to both
	// (they play at most two distinct scripts in round 1).
	const t = await makeTournament({
		advanceTo: "swiss-round-1-generated",
		allowedMaps: ["MAP_SEASIDE", "MAP_RIVER", "MAP_DESERT"],
	});
	const aIds = new Set(t.slotsByDivision.A.map((s) => s.slotId));
	const r1Matches = ((await t.matches()) as MatchRow[]).filter(
		(m) => m.status === "pending" && aIds.has(m.slot_a_id),
	);
	expect(r1Matches).toHaveLength(2);

	// Withdraw slot_a of each division-A match: both matches forfeit to the
	// opponents, which closes round 1 (division A) and generates round 2
	// with only the two remaining actives.
	const [subA, subB] = [r1Matches[0].slot_a_id, r1Matches[1].slot_a_id];
	for (const slotId of [subA, subB]) {
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/slots/${slotId}/withdraw`,
				as: t.admin,
			}),
		);
	}
	const rounds = (await t.rounds()) as RoundRow[];
	const r1 = rounds.find(
		(r) => r.phase === "swiss" && r.division === "A" && r.round_number === 1,
	)!;
	const r2 = rounds.find(
		(r) => r.phase === "swiss" && r.division === "A" && r.round_number === 2,
	)!;
	expect(r1.status).toBe("complete");
	expect(r2.status).toBe("in_progress");

	// The substitutes take over the seats (identity swap is covered by the
	// PATCH-slot tests); here we just reinstate the slots.
	for (const slotId of [subA, subB]) {
		await expectOk(
			await request.delete({
				path: `/v1/tournaments/${t.tournamentId}/slots/${slotId}/withdraw`,
				as: t.admin,
			}),
		);
	}
	return { t, subA, subB, r1, r2, r1Matches };
}

describe("add match to an open swiss round", () => {
	it("pairs two reinstated slots into the open round and keeps it open until they report", async () => {
		const { t, subA, subB, r1, r2, r1Matches } = await substitutionScenario();

		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/rounds/${r2.round_id}/matches`,
			as: t.admin,
			body: { slot_a_id: subA, slot_b_id: subB },
		});
		expect(res.status).toBe(201);
		const { match } = (await res.json()) as MatchBody;
		expect(match.round_id).toBe(r2.round_id);
		expect(match.status).toBe("pending");
		expect(match.winner_slot_id).toBeNull();
		// Derived fields follow round generation's conventions: next index in
		// the round, next global match number, pick order to slot_b.
		expect(match.match_index).toBe(2);
		expect(match.match_number).not.toBeNull();
		expect(match.pick_order_winner_slot_id).toBe(subB);
		// Map comes from the same engine as generation: an instance of the
		// pool whose script neither substitute saw in their round-1 seat.
		const r1Scripts = new Set(r1Matches.map((m) => m.map_script));
		expect(match.map_pool_id).not.toBeNull();
		expect(r1Scripts.has(match.map_script)).toBe(false);

		// Audit trail.
		const audit = await env.SHARE_DB.prepare(
			`SELECT COUNT(*) AS n FROM events
			 WHERE event_type = 'tournament_admin'
			   AND metadata LIKE '%match_added%'`,
		).first<{ n: number }>();
		expect(audit?.n ?? 0).toBeGreaterThan(0);

		// Reporting the round's generated match does NOT close the round —
		// the added match is still pending.
		const generated = ((await t.matches()) as MatchRow[]).find(
			(m) => m.round_id === r2.round_id && m.match_id !== match.match_id,
		)!;
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${generated.match_id}`,
				as: t.admin,
				body: { winner_slot_id: generated.slot_a_id, status: "complete" },
			}),
		);
		let rounds = (await t.rounds()) as RoundRow[];
		expect(
			rounds.find((r) => r.round_id === r2.round_id)!.status,
		).toBe("in_progress");

		// Reporting the added match closes the round and its result feeds
		// round 3's pairing: the winner (1-1) and loser (0-2) both pair on.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${match.match_id}`,
				as: t.admin,
				body: { winner_slot_id: subA, status: "complete" },
			}),
		);
		rounds = (await t.rounds()) as RoundRow[];
		expect(rounds.find((r) => r.round_id === r2.round_id)!.status).toBe(
			"complete",
		);
		const r3 = rounds.find(
			(r) => r.phase === "swiss" && r.division === "A" && r.round_number === 3,
		);
		expect(r3).toBeDefined();
		const r3Slots = ((await t.matches()) as MatchRow[])
			.filter((m) => m.round_id === r3!.round_id)
			.flatMap((m) => [m.slot_a_id, m.slot_b_id]);
		expect(r3Slots).toContain(subA);
		expect(r3Slots).toContain(subB);

		// The round-1 forfeits stand: the substitutes inherited 0-1 seats, so
		// after the added match they sit at 1-1 and 0-2.
		expect(r1.status).toBe("complete");
	});

	it("rejects every ineligible pairing with a specific code", async () => {
		const { t, subA, subB, r1, r2 } = await substitutionScenario();
		// `as: null` sends the request anonymously (an explicit undefined
		// would re-trigger the default parameter).
		const post = (
			roundId: string,
			body: unknown,
			as: { sessionToken: string } | null = t.admin,
		) =>
			request.post({
				path: `/v1/tournaments/${t.tournamentId}/rounds/${roundId}/matches`,
				as: as ?? undefined,
				body,
			});

		// Closed round.
		await expectErrorCode(
			await post(r1.round_id, { slot_a_id: subA, slot_b_id: subB }),
			{ status: 409, code: "ROUND_CLOSED" },
		);
		// Self-pairing.
		await expectErrorCode(
			await post(r2.round_id, { slot_a_id: subA, slot_b_id: subA }),
			{ status: 400, code: "SAME_SLOT" },
		);
		// Already paired this round: the two non-withdrawn slots hold round
		// 2's generated match.
		const paired = ((await t.matches()) as MatchRow[]).find(
			(m) => m.round_id === r2.round_id,
		)!;
		await expectErrorCode(
			await post(r2.round_id, {
				slot_a_id: paired.slot_a_id,
				slot_b_id: subA,
			}),
			{ status: 409, code: "ALREADY_PAIRED" },
		);
		// Wrong division: a division-B slot into the division-A round.
		await expectErrorCode(
			await post(r2.round_id, {
				slot_a_id: t.slotsByDivision.B[0].slotId,
				slot_b_id: subA,
			}),
			{ status: 409, code: "WRONG_DIVISION" },
		);
		// Withdrawn slot.
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/slots/${subB}/withdraw`,
				as: t.admin,
			}),
		);
		await expectErrorCode(
			await post(r2.round_id, { slot_a_id: subA, slot_b_id: subB }),
			{ status: 409, code: "SLOT_WITHDRAWN" },
		);
		// Unknown round.
		await expectErrorCode(
			await post("x".repeat(21), { slot_a_id: subA, slot_b_id: subB }),
			{ status: 404, code: "ROUND_NOT_FOUND" },
		);
		// Non-admin and anonymous callers.
		const outsider = await makeUser();
		await expectErrorCode(
			await post(r2.round_id, { slot_a_id: subA, slot_b_id: subB }, outsider),
			{ status: 403, code: "NOT_TOURNAMENT_ADMIN" },
		);
		await expectErrorCode(
			await post(r2.round_id, { slot_a_id: subA, slot_b_id: subB }, null),
			{ status: 401, code: "UNAUTHORIZED" },
		);
	});
});
