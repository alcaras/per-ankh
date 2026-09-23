// Per (player, yield_type), generate a complete turn sequence and forward-
// fill rate from yield_rate_history and cumulative from yield_total_history.
// Both raw values are divided by 10 (the game stores yields scaled by 10).
// `cumulative` holds one of two quantities, and `cumulative_is_game_total`
// says which: the game's own lifetime total for that yield, or our running
// sum of the per-turn rate. See `totalsAreComplete` below.

import type { Player } from "../parsers/players.js";
import type {
	YieldRateHistory,
	YieldTotalHistory,
} from "../parsers/timeseries.js";
import type { YieldDataPoint, YieldHistory } from "../types.js";
import { playersOrderedByName } from "./_helpers.js";

/** Yield types included in the game blob. */
export const SHARE_YIELD_TYPES = [
	"YIELD_SCIENCE",
	"YIELD_CIVICS",
	"YIELD_TRAINING",
	"YIELD_GROWTH",
	"YIELD_CULTURE",
	"YIELD_HAPPINESS",
	"YIELD_ORDERS",
	"YIELD_FOOD",
	"YIELD_MONEY",
	"YIELD_DISCONTENT",
	"YIELD_IRON",
	"YIELD_STONE",
	"YIELD_WOOD",
	"YIELD_MAINTENANCE",
] as const;

/**
 * The two yields the game keeps no total for. Both carry a
 * `<SubtractFromYield>` in yield.xml — Discontent from Happiness,
 * Maintenance from Money — so they are credited to that yield with the sign
 * flipped (`changeYieldTotal`, Player.cs:8092) and `updateHistoryTotals`
 * (:17055) records nothing of their own. Their cumulative is always our
 * running sum.
 */
const UNTOTALED_YIELD_TYPES = new Set([
	"YIELD_DISCONTENT",
	"YIELD_MAINTENANCE",
]);

/** Earliest `turn` across the rows, or null when there are none. */
function earliestTurn(rows: { turn: number }[]): number | null {
	let earliest: number | null = null;
	for (const r of rows) {
		if (earliest === null || r.turn < earliest) earliest = r.turn;
	}
	return earliest;
}

/**
 * Whether the save's yield totals cover the whole game.
 *
 * The game only began recording `YieldTotalHistory` in 1.0.81366 (January
 * 2026), and a game started before that build and continued on a later one
 * starts its totals at the upgrade turn, from zero — everything earned
 * before it is missing. No save names the build a game started on, but the
 * rows do: after an upgrade every series of every player starts together, at
 * a turn well past the first. A game that recorded totals from the start has
 * its earliest total row within a turn of its earliest rate row. (A single
 * series can still start late, because the game writes no row while a total
 * is zero — `setTurnYieldTotal`, Player.cs:7969 — but not all of them at
 * once.)
 *
 * Across the 122 local saves this splits 68 with no totals, 49 complete
 * (earliest total row on turn 1 or 2, against an earliest rate row of 1 or
 * 2) and 5 upgraded (26, 28, 54, 68 and 90, all against a rate row of 1 or
 * 2). An upgraded save's totals are dropped: every series falls back to the
 * running sum, the same as a save from an older build.
 */
function totalsAreComplete(
	rateRows: YieldRateHistory[],
	totalRows: YieldTotalHistory[],
): boolean {
	const firstTotal = earliestTurn(totalRows);
	if (firstTotal === null) return false;
	const firstRate = earliestTurn(rateRows);
	if (firstRate === null) return true;
	return firstTotal <= firstRate + 1;
}

export function deriveYieldHistory(
	yieldRateHistory: YieldRateHistory[],
	yieldTotalHistory: YieldTotalHistory[],
	players: Player[],
	totalTurns: number,
	yieldTypes: readonly string[] = SHARE_YIELD_TYPES,
): YieldHistory[] {
	const result: YieldHistory[] = [];

	// Whether a series holds the game's total is a property of the save and
	// of the yield, not of the series' own rows: a totalled yield that never
	// left zero has no rows at all, and an upgraded save has rows that are
	// not the game's lifetime total.
	const completeTotals = totalsAreComplete(yieldRateHistory, yieldTotalHistory);

	for (const player of playersOrderedByName(players)) {
		for (const yieldType of yieldTypes) {
			const rateRows = yieldRateHistory.filter(
				(h) => h.playerXmlId === player.xmlId && h.yieldType === yieldType,
			);
			const totalRows = yieldTotalHistory.filter(
				(h) => h.playerXmlId === player.xmlId && h.yieldType === yieldType,
			);

			// turn → raw value
			const rateByTurn = new Map<number, number>();
			for (const r of rateRows) rateByTurn.set(r.turn, r.amount);
			const totalByTurn = new Map<number, number>();
			for (const r of totalRows) totalByTurn.set(r.turn, r.amount);

			const isGameTotal =
				completeTotals && !UNTOTALED_YIELD_TYPES.has(yieldType);

			const data: YieldDataPoint[] = [];
			let lastRate: number | null = null;
			// The turns before a series' first row read 0, as the game reads
			// them (`getTurnYieldTotal`, Player.cs:7982).
			let lastTotal = 0;
			let runningSum = 0;
			for (let t = 1; t <= totalTurns; t++) {
				const r = rateByTurn.get(t);
				if (r !== undefined) lastRate = r / 10;
				const c = totalByTurn.get(t);
				if (c !== undefined) lastTotal = c / 10;

				if (lastRate !== null) runningSum += lastRate;

				data.push({
					turn: t,
					rate: lastRate,
					cumulative: isGameTotal ? lastTotal : runningSum,
				});
			}

			result.push({
				player_id: player.xmlId,
				player_name: player.playerName,
				nation: player.nation,
				yield_type: yieldType,
				cumulative_is_game_total: isGameTotal,
				data,
			});
		}
	}

	return result;
}
