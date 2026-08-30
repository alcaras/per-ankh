// Comparative-standing shifts: the game classifies one player's stat against
// another's through InfoHelpers.getBestPercentValue. In the C#'s own naming,
// percent = theirValue × 100 / ourValue (integer division) and the tier with
// the smallest threshold ≥ that percent wins; the entry with no threshold is
// the catch-all (InfoPercentBase defaults miPercent to int.MaxValue), which
// an ourValue ≤ 0 short-circuits straight to.
//
// From a rail row's vantage the row's player is theirValue and the opponent
// is ourValue — the tier is how the opponent classifies this player, which
// is what the chips and their tooltips say. Two consumers share this: the
// Techs rail's knowledge standing (cumulative science, knowledge.xml) and
// the Military rail's power standing (military power, power.xml).

export type StandingTier = {
	readonly type: string;
	readonly percent: number | null;
};

export type StandingShift = {
	turn: number;
	from: string; // tier zType the player was
	to: string; // tier zType they became
	// The player's value as a percent of the opponent's that turn — the
	// exact quantity the game buckets. Null when the opponent's value was
	// 0: the game reads that as an unbounded percent, so no percentage is
	// meaningful.
	pct: number | null;
};

// The game's bucketing: the tier with the smallest threshold ≥ pct wins; no
// threshold is the catch-all. A null pct is the C#'s int.MaxValue, which
// only the catch-all covers.
function standingTier(
	pct: number | null,
	tiers: readonly StandingTier[],
): string {
	const target = pct ?? Infinity;
	let best = tiers[tiers.length - 1].type;
	let min = Infinity;
	for (const t of tiers) {
		const p = t.percent ?? Infinity;
		if (p >= target && p <= min) {
			min = p;
			best = t.type;
		}
	}
	return best;
}

/**
 * Turns where the player's standing vs the opponent shifted tier. Runs
 * shorter than `minRun` are folded into their predecessor — sitting exactly
 * on a threshold flip-flops the raw classification every turn, and a burst
 * of chips at one boundary says nothing a single shift doesn't. (Science
 * jitters more than power: the blob stores cumulative science divided by
 * ten, so its ratio wobbles where military power's raw integers don't.) The
 * final run always stands, so the last shift agrees with the end state. No
 * marker for the initial classification — only changes.
 *
 * A turn missing from `theirs` is skipped. A turn where their value is 0 is
 * not: that is the C#'s ourValue ≤ 0 case, and it lands on the catch-all
 * tier with `pct: null`. A caller for whom a zero denominator is a startup
 * artifact rather than a real standing filters those turns out of `theirs`
 * itself.
 */
export function standingShiftMarkers(
	mine: { turn: number; value: number }[],
	theirs: { turn: number; value: number }[],
	tiers: readonly StandingTier[],
	minRun: number,
): StandingShift[] {
	const other = new Map<number, number>();
	for (const d of theirs) other.set(d.turn, d.value);
	const perTurn: { turn: number; tier: string; pct: number | null }[] = [];
	for (const d of mine) {
		const opp = other.get(d.turn);
		if (opp == null) continue;
		const pct = opp > 0 ? Math.trunc((d.value * 100) / opp) : null;
		perTurn.push({ turn: d.turn, tier: standingTier(pct, tiers), pct });
	}
	// Group into runs, then fold sub-minimum runs into their predecessor.
	type Run = { tier: string; first: (typeof perTurn)[number]; length: number };
	const runs: Run[] = [];
	for (const p of perTurn) {
		const last = runs[runs.length - 1];
		if (last && last.tier === p.tier) last.length++;
		else runs.push({ tier: p.tier, first: p, length: 1 });
	}
	const kept: Run[] = [];
	for (let i = 0; i < runs.length; i++) {
		const isLast = i === runs.length - 1;
		if (!isLast && runs[i].length < minRun && kept.length > 0) continue;
		const prev = kept[kept.length - 1];
		if (prev && prev.tier === runs[i].tier) continue;
		kept.push(runs[i]);
	}
	return kept.slice(1).map((r, i) => ({
		turn: r.first.turn,
		from: kept[i].tier,
		to: r.tier,
		pct: r.first.pct,
	}));
}
