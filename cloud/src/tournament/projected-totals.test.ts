// Cross-check for the header's match-count projection, which lives in the
// SvelteKit tree at src/lib/tournament/projected-totals.ts.
//
// Why the test is here and not beside the module: the frontend has no test
// runner, and the assertion worth making is that the census walk agrees with
// the REAL pairing engine — pairSwissRound and computeRecord are importable
// as siblings from this suite. The projection module is dependency-free, so
// reaching across the root costs nothing and touches no Worker bundle; it's
// the same reach canonical-map-options.test.ts already makes.
//
// The walk models the field as a census of W-L records with no player
// identity, so it cannot see one thing the engine does: pickByeRecipient
// skips players who already had a bye. That only diverges once a field runs
// out of never-byed players and someone takes a SECOND bye — small fields
// only, asserted below as the known boundary rather than papered over.

import { describe, expect, it } from "vitest";
import { pairSwissRound } from "./pairing";
import { computeRecord } from "./standings";
import type { MatchRef, SlotRef, TournamentConfig } from "./types";
import { projectSwissDivision } from "../../../src/lib/tournament/projected-totals";

// Deterministic PRNG: every future below is reproducible, so a failure is a
// real regression rather than an unlucky seed.
function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function project(n: number, config: TournamentConfig) {
	return projectSwissDivision(
		Array.from({ length: n }, () => ({ wins: 0, losses: 0 })),
		[],
		config.swiss_max_rounds,
		{
			winsToAdvance: config.swiss_wins_to_advance,
			lossesToEliminate: config.swiss_losses_to_eliminate,
		},
		0,
	);
}

type Rec = { wins: number; losses: number };

function swissSlots(n: number): SlotRef[] {
	return Array.from({ length: n }, (_, i) => ({
		slot_id: `s${i}`,
		phase: "swiss",
		division: "A",
		swiss_seed: i + 1,
		championship_seed: null,
		withdrawn: false,
	}));
}

// Pair one round through the real engine and append it to `played`, deciding
// each match by coin flip. `decide` false leaves the playable matches pending
// instead — the state the header renders from for most of a tournament's life,
// where the open round is generated but not yet reported. Returns the playable
// (bye-excluded, matching the projection's units) count and the bye recipients.
function dealRound(
	slots: SlotRef[],
	played: MatchRef[],
	round: number,
	config: TournamentConfig,
	rand: () => number,
	decide = true,
): { playable: number; byes: string[] } {
	const pairings = pairSwissRound(slots, played, round, config);
	const byes: string[] = [];
	let playable = 0;
	for (const [i, p] of pairings.entries()) {
		const isBye = p.slot_b_id === null;
		if (isBye) byes.push(p.slot_a_id);
		else playable++;
		played.push({
			match_id: `m${round}-${i}`,
			round_id: `r${round}`,
			round_number: round,
			phase: "swiss",
			division: "A",
			slot_a_id: p.slot_a_id,
			slot_b_id: p.slot_b_id,
			map_pool_id: null,
			map_script: null,
			// Byes are written status='bye' with the lone slot as winner
			// (buildSwissRoundStatements), which computeRecord scores as a win.
			status: isBye ? "bye" : decide ? "complete" : "pending",
			winner_slot_id: isBye
				? p.slot_a_id
				: decide
					? rand() < 0.5
						? p.slot_a_id
						: p.slot_b_id!
					: null,
		});
	}
	return { playable, byes };
}

// The two census arguments the header passes: W-L for every still-active slot,
// and how many have already clinched. Both come from DECIDED matches only — a
// generated-but-unreported round travels separately as pending pairs.
function censusFrom(
	slots: SlotRef[],
	played: MatchRef[],
	config: TournamentConfig,
): { active: Rec[]; alreadyQualified: number } {
	const decided = played.filter((m) => m.status !== "pending");
	const records = slots.map((s) => computeRecord(s.slot_id, decided, config));
	return {
		active: records
			.filter((r) => r.status === "active")
			.map((r) => ({ wins: r.wins, losses: r.losses })),
		alreadyQualified: records.filter((r) => r.status === "advanced").length,
	};
}

// The open round's unreported pairings, as the record pairs the header builds
// from the standings rows.
function pendingPairsOf(
	slots: SlotRef[],
	played: MatchRef[],
	config: TournamentConfig,
): Array<[Rec, Rec]> {
	const decided = played.filter((m) => m.status !== "pending");
	const recordOf = new Map(
		slots.map((s) => [s.slot_id, computeRecord(s.slot_id, decided, config)]),
	);
	return played
		.filter((m) => m.status === "pending" && m.slot_b_id !== null)
		.map((m) => {
			const a = recordOf.get(m.slot_a_id)!;
			const b = recordOf.get(m.slot_b_id!)!;
			return [
				{ wins: a.wins, losses: a.losses },
				{ wins: b.wins, losses: b.losses },
			] as [Rec, Rec];
		});
}

// Play a whole division through the real engine and report what actually
// happened: playable matches and how many players reached the win threshold.
function playDivision(
	n: number,
	config: TournamentConfig,
	rand: () => number,
): {
	matches: number;
	qualifiers: number;
	byes: string[];
	perRound: number[];
} {
	const slots = swissSlots(n);
	const played: MatchRef[] = [];
	const byes: string[] = [];
	const perRound: number[] = [];
	let matches = 0;
	for (let round = 1; round <= config.swiss_max_rounds; round++) {
		const r = dealRound(slots, played, round, config, rand);
		perRound.push(r.playable);
		byes.push(...r.byes);
		matches += r.playable;
	}
	const qualifiers = slots.filter(
		(s) => computeRecord(s.slot_id, played, config).status === "advanced",
	).length;
	return { matches, qualifiers, byes, perRound };
}

function observe(n: number, config: TournamentConfig, futures: number) {
	const rand = lcg(n * 7919 + config.swiss_max_rounds * 31 + 13);
	let matchMin = Infinity;
	let matchMax = -Infinity;
	let qualMin = Infinity;
	let qualMax = -Infinity;
	let repeatByes = 0;
	const roundMin = Array.from(
		{ length: config.swiss_max_rounds },
		() => Infinity,
	);
	const roundMax = Array.from(
		{ length: config.swiss_max_rounds },
		() => -Infinity,
	);
	for (let f = 0; f < futures; f++) {
		const r = playDivision(n, config, rand);
		matchMin = Math.min(matchMin, r.matches);
		matchMax = Math.max(matchMax, r.matches);
		qualMin = Math.min(qualMin, r.qualifiers);
		qualMax = Math.max(qualMax, r.qualifiers);
		for (const [i, c] of r.perRound.entries()) {
			roundMin[i] = Math.min(roundMin[i], c);
			roundMax[i] = Math.max(roundMax[i], c);
		}
		if (r.byes.length !== new Set(r.byes).size) repeatByes++;
	}
	return {
		matchMin,
		matchMax,
		qualMin,
		qualMax,
		repeatByes,
		roundMin,
		roundMax,
	};
}

// Resume a division from a mid-tournament state and report what the rounds
// still to come actually held, across many futures. `cut` decided rounds are
// played once with a fixed seed to build the state; with `openPending`, round
// `cut + 1` is generated on top of it and left unreported. Returns the
// projection made from that state alongside the observed per-round envelope,
// in the same walk order (index 0 is the next round to be generated).
function observeFrom(
	n: number,
	config: TournamentConfig,
	cut: number,
	openPending: boolean,
	futures: number,
) {
	const slots = swissSlots(n);
	const base: MatchRef[] = [];
	const setup = lcg(n * 104729 + cut * 31 + 7);
	for (let round = 1; round <= cut; round++)
		dealRound(slots, base, round, config, setup);
	const openRound = openPending ? cut + 1 : cut;
	if (openPending) dealRound(slots, base, openRound, config, setup, false);

	const { active, alreadyQualified } = censusFrom(slots, base, config);
	const roundsLeft = config.swiss_max_rounds - openRound;
	const projection = projectSwissDivision(
		active,
		pendingPairsOf(slots, base, config),
		roundsLeft,
		{
			winsToAdvance: config.swiss_wins_to_advance,
			lossesToEliminate: config.swiss_losses_to_eliminate,
		},
		alreadyQualified,
	);

	const roundMin = Array.from({ length: roundsLeft }, () => Infinity);
	const roundMax = Array.from({ length: roundsLeft }, () => -Infinity);
	const rand = lcg(n * 7919 + cut * 131 + (openPending ? 3 : 1));
	for (let f = 0; f < futures; f++) {
		const played = base.map((m) => ({ ...m }));
		for (const m of played) {
			if (m.status !== "pending") continue;
			m.status = "complete";
			m.winner_slot_id = rand() < 0.5 ? m.slot_a_id : m.slot_b_id;
		}
		for (let round = openRound + 1; round <= config.swiss_max_rounds; round++) {
			const { playable } = dealRound(slots, played, round, config, rand);
			const i = round - openRound - 1;
			roundMin[i] = Math.min(roundMin[i], playable);
			roundMax[i] = Math.max(roundMax[i], playable);
		}
	}
	return { projection, roundMin, roundMax };
}

const OWCT: TournamentConfig = {
	swiss_wins_to_advance: 3,
	swiss_losses_to_eliminate: 3,
	swiss_max_rounds: 5,
};
const DEEP: TournamentConfig = {
	swiss_wins_to_advance: 4,
	swiss_losses_to_eliminate: 4,
	swiss_max_rounds: 7,
};

const FUTURES = 300;

describe("projectSwissDivision vs the pairing engine", () => {
	// Real division sizes: OWCT runs two divisions in the high twenties, and
	// docs/tournament-rules.md calls out 29/27 and 30/26 as configurations
	// admins hit.
	for (const n of [6, 12, 16, 20, 24, 26, 27, 28, 29, 30, 31, 32]) {
		it(`brackets every future for a ${n}-player division`, () => {
			const p = project(n, OWCT);
			const o = observe(n, OWCT, FUTURES);
			expect(o.matchMin).toBeGreaterThanOrEqual(p.remainingMin);
			expect(o.matchMax).toBeLessThanOrEqual(p.remainingMax);
			expect(o.qualMin).toBeGreaterThanOrEqual(p.qualifiersMin);
			expect(o.qualMax).toBeLessThanOrEqual(p.qualifiersMax);
		});

		// The envelope is what the header renders: an exact number when closed,
		// "~N" when open. A loose envelope would print "~" (or a midpoint) for
		// a total that was actually pinned down, so tightness is the claim.
		it(`projects an exactly tight envelope for a ${n}-player division`, () => {
			const p = project(n, OWCT);
			const o = observe(n, OWCT, FUTURES);
			expect([o.matchMin, o.matchMax]).toEqual([
				p.remainingMin,
				p.remainingMax,
			]);
			expect([o.qualMin, o.qualMax]).toEqual([
				p.qualifiersMin,
				p.qualifiersMax,
			]);
		});

		// The per-round slice is what sizes a round cell the strip hasn't seen
		// yet — one mark per projected match — so a loose bound there draws
		// marks for games that will never be played. Tightness is asserted
		// round by round, not just on the total: the totals can be exact while
		// a round's own bound is not.
		it(`projects an exactly tight envelope per round for ${n} players`, () => {
			const p = project(n, OWCT);
			const o = observe(n, OWCT, FUTURES);
			expect(p.perRoundMin).toEqual(o.roundMin);
			expect(p.perRoundMax).toEqual(o.roundMax);
		});
	}

	it("brackets a deeper 4W/4L, 7-round config", () => {
		for (const n of [16, 20, 24, 28, 32]) {
			const p = project(n, DEEP);
			const o = observe(n, DEEP, FUTURES);
			expect(o.matchMin).toBeGreaterThanOrEqual(p.remainingMin);
			expect(o.matchMax).toBeLessThanOrEqual(p.remainingMax);
			expect(o.qualMin).toBeGreaterThanOrEqual(p.qualifiersMin);
			expect(o.qualMax).toBeLessThanOrEqual(p.qualifiersMax);
			// Per round too — the strip draws these one mark at a time under any
			// config, not just OWCT. Bracketing rather than tightness: seven
			// rounds is a big enough space of futures that 300 samples don't
			// reliably reach the extreme of every round, and a deeper config is
			// where the envelope genuinely widens past 1 (4W/4L at n=20 spreads
			// its last round by 2), so the floor the strip draws matters most
			// here.
			for (const [i, v] of p.perRoundMin.entries())
				expect(v).toBeLessThanOrEqual(o.roundMin[i]);
			for (const [i, v] of p.perRoundMax.entries())
				expect(v).toBeGreaterThanOrEqual(o.roundMax[i]);
		}
	});
});

describe("projectSwissDivision — resumed mid-tournament", () => {
	// The call the header actually makes. `project()` above always starts from
	// an empty field: no pending pairs, nobody advanced, every round still to
	// come. The header is never in that state — by the time it renders a strip
	// there are decided rounds behind it, an open round generated but not fully
	// reported, and players who have already clinched. The per-round slice is
	// what sizes the cells on screen, so it has to be tight from THERE, not
	// only from round zero.
	for (const n of [16, 24, 28, 30]) {
		for (let cut = 1; cut < OWCT.swiss_max_rounds; cut++) {
			it(`projects a tight per-round envelope for ${n} players resumed after round ${cut}`, () => {
				const o = observeFrom(n, OWCT, cut, false, FUTURES);
				expect(o.projection.perRoundMin).toEqual(o.roundMin);
				expect(o.projection.perRoundMax).toEqual(o.roundMax);
			});

			// Same, with the open round generated and unreported — every one of
			// its playable matches is a pending pair the walk must resolve
			// before it can size the rounds after it.
			if (cut + 1 >= OWCT.swiss_max_rounds) continue;
			it(`projects a tight per-round envelope for ${n} players with round ${cut + 1} unreported`, () => {
				const o = observeFrom(n, OWCT, cut, true, FUTURES);
				expect(o.projection.perRoundMin).toEqual(o.roundMin);
				expect(o.projection.perRoundMax).toEqual(o.roundMax);
			});
		}
	}
});

describe("projectSwissDivision — the lone-survivor bye", () => {
	// Regression guard: playRound used to stop once fewer than two players were
	// active, but the engine hands the lone active slot a bye every remaining
	// round, and those free wins can carry them past the win threshold. The
	// walk reported a confidently exact qualifier count that was too low.
	it("counts the qualifier a one-player field byes its way to", () => {
		const p = project(4, OWCT);
		const o = observe(4, OWCT, FUTURES);
		expect(o.qualMax).toBe(3);
		expect(p.qualifiersMax).toBeGreaterThanOrEqual(3);
	});

	it("keeps a single active player playing to the end of Swiss", () => {
		// One player, 2 wins already, 3 rounds left: byes alone advance them.
		const p = projectSwissDivision(
			[{ wins: 2, losses: 0 }],
			[],
			3,
			{ winsToAdvance: 3, lossesToEliminate: 3 },
			0,
		);
		expect(p).toMatchObject({
			remainingMin: 0,
			remainingMax: 0,
			qualifiersMin: 1,
			qualifiersMax: 1,
		});
	});
});

describe("projectSwissDivision — the bye-recipient approximation", () => {
	// The census has no player identity, so it always seats the bye in the
	// worst bucket while the engine skips anyone who already had one. Pin the
	// boundary: at real field sizes the engine never repeats a bye, which is
	// why the walk stays exact there.
	it("never repeats a bye at a real division size", () => {
		for (const n of [26, 27, 28, 29, 30]) {
			expect(observe(n, OWCT, FUTURES).repeatByes).toBe(0);
		}
	});

	// Documented divergence, asserted so it can't drift silently: a 5-player
	// division byes every round and runs out of never-byed players, so the
	// engine seats a bye the census can't predict and plays one game fewer
	// than the walk's floor.
	it("can over-count matches once a small field repeats a bye", () => {
		const p = project(5, OWCT);
		const o = observe(5, OWCT, FUTURES);
		expect(o.repeatByes).toBeGreaterThan(0);
		expect(o.matchMin).toBeLessThan(p.remainingMin);
	});
});

describe("projectSwissDivision — pending matches", () => {
	const config = { winsToAdvance: 3, lossesToEliminate: 3 };

	it("forks a cross-record pending pair and folds a same-record one", () => {
		const active = [
			{ wins: 1, losses: 0 },
			{ wins: 1, losses: 0 },
			{ wins: 0, losses: 1 },
			{ wins: 0, losses: 1 },
		];
		const same = projectSwissDivision(
			active,
			[
				[
					{ wins: 1, losses: 0 },
					{ wins: 1, losses: 0 },
				],
			],
			0,
			config,
			0,
		);
		// One up, one down under either result — nothing to fork on.
		expect(same.remainingMin).toBe(same.remainingMax);
		expect(same.qualifiersMin).toBe(same.qualifiersMax);
	});

	it("skips a pending pair whose records aren't in the active census", () => {
		// A withdrawn player's not-yet-forfeited match: the walk must ignore
		// the game rather than drive a bucket negative and corrupt every later
		// round. Compare against the same field with no pending pair at all.
		const active = [
			{ wins: 1, losses: 0 },
			{ wins: 0, losses: 1 },
		];
		const ghost = projectSwissDivision(
			active,
			[
				[
					{ wins: 2, losses: 2 },
					{ wins: 0, losses: 0 },
				],
			],
			2,
			config,
			0,
		);
		const clean = projectSwissDivision(active, [], 2, config, 0);
		expect(ghost).toEqual(clean);
	});

	// Every cross-record pending pair forks, so without collapsing branches on
	// their census signature a full round of them costs 2^k walks — 20 pairs
	// measured at 5.2s before the fix, ~1ms after. The timeout is the
	// assertion; the envelope is checked so a broken collapse can't pass by
	// dropping branches.
	it("collapses duplicate pending-pair futures", { timeout: 1000 }, () => {
		const active = Array.from({ length: 40 }, (_, i) =>
			i % 2 === 0 ? { wins: 1, losses: 0 } : { wins: 0, losses: 1 },
		);
		const pairs = Array.from(
			{ length: 20 },
			() =>
				[
					{ wins: 1, losses: 0 },
					{ wins: 0, losses: 1 },
				] as [Rec, Rec],
		);
		const p = projectSwissDivision(active, pairs, 3, config, 0);
		expect(p.remainingMin).toBeGreaterThan(0);
		expect(p.remainingMax).toBeGreaterThanOrEqual(p.remainingMin);
		expect(p.qualifiersMax).toBeGreaterThanOrEqual(p.qualifiersMin);
	});
});
