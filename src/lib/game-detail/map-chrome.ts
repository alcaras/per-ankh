// What the map view's chrome reads for one player at one turn. Everything in
// the chrome follows the selected turn, so each value is looked up at that
// turn rather than taken from the end of the game.

import type { CharacterInfo } from "$lib/parser/types";
import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
import { dynastyLeaders } from "./helpers";
import type { GameTabId } from "./game-tabs.svelte";

// The frame every piece of the chrome sits in, the tile hover panel included:
// a dark fill with a thin tan trim, drawn in CSS on the palette tokens rather
// than from the game's frame sprites (#270). A class string rather than a
// component so it also dresses elements another component owns, like a
// bits-ui tooltip's content.
export const CHROME_PANEL_CLASS =
	"rounded border border-tan/50 bg-gradient-to-b from-surface/95 to-surface-deep/95 text-tan shadow-[inset_0_0_0_1px_rgb(var(--color-black)/0.6),0_4px_12px_rgb(var(--color-black)/0.5)]";

/**
 * The yields of the game's top bar: the eight it stockpiles, plus Science,
 * which it shows as a rate only. The rest (Growth, Culture, Happiness,
 * Discontent, Maintenance) stay out of it. In yield.xml's order. Clicking a
 * yield opens `tab` in a lightbox.
 */
export const TOP_BAR_YIELDS: {
	yieldType: string;
	stockpiled: boolean;
	tab: GameTabId;
}[] = [
	{ yieldType: "YIELD_CIVICS", stockpiled: true, tab: "laws" },
	{ yieldType: "YIELD_TRAINING", stockpiled: true, tab: "military" },
	{ yieldType: "YIELD_SCIENCE", stockpiled: false, tab: "techs" },
	{ yieldType: "YIELD_MONEY", stockpiled: true, tab: "economics" },
	{ yieldType: "YIELD_ORDERS", stockpiled: true, tab: "orders" },
	{ yieldType: "YIELD_FOOD", stockpiled: true, tab: "economics" },
	{ yieldType: "YIELD_IRON", stockpiled: true, tab: "economics" },
	{ yieldType: "YIELD_STONE", stockpiled: true, tab: "economics" },
	{ yieldType: "YIELD_WOOD", stockpiled: true, tab: "economics" },
];

/**
 * The point of a turn-ordered series in force at `turn`: the last one at or
 * before it. The derived histories carry one point per turn, so this is
 * usually that turn's own point.
 */
export function pointAtTurn<T extends { turn: number }>(
	points: T[],
	turn: number,
): T | undefined {
	return points.findLast((p) => p.turn <= turn);
}

/**
 * The tech a player was researching at `turn`: their next discovery after
 * it, and how many turns away it was. Null when they discover nothing later,
 * which is always the case at the final turn.
 */
export function nextDiscovery(
	history: TechDiscoveryHistory | undefined,
	turn: number,
): { tech: string; turns: number } | null {
	const next = history?.data.find((d) => d.turn > turn && d.tech_name != null);
	if (next?.tech_name == null) return null;
	return { tech: next.tech_name, turns: next.turn - turn };
}

/** The player's ruler at `turn`: the last to take the throne by then. */
export function rulerAt(
	characters: CharacterInfo[],
	playerId: number,
	turn: number,
): CharacterInfo | null {
	return (
		dynastyLeaders(characters, playerId).findLast(
			(c) => (c.became_leader_turn ?? 0) <= turn,
		) ?? null
	);
}
