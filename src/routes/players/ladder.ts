// The /players epithet ladder: the rungs, and the epithet a game count earns.
//
// Beside the route for the reason `./seasons` is — nothing outside /players
// reads it — and a plain module rather than part of `+page.ts` because the
// board and its guide both need the rungs, and SvelteKit rejects any runtime
// export from a `+page.ts` but its own.

import { cognomenName } from "$lib/utils/formatting";

export interface Rung {
	games: number;
	type: string;
}

// Activity epithets from the game's cognomen ladder — and the set is
// exactly Old World's own difficulty ladder, every level of which is
// also a cognomen: the New, the Able, the Just, the Good, the Strong,
// the Noble, the Glorious, the Magnificent, the Great, in that order
// (achievement.xml's ACHIEVEMENT_DIFFICULTY_*). They land one to a
// legitimacy decade from the Able (30) up, which is why the decades
// below have no rung — the Founder and the Mason sit at 10, and the
// game gives ten more cognomens at 20. Thresholds are games
// played in the selected season, on the triangular numbers: each rung
// costs exactly one game more than the last, so the next epithet always
// feels one push away. The ladder deliberately stops at the Magnificent
// (36, ~3 games/week — reached by a handful of real quarters); the Great
// stays unclaimed, reserved for whatever earns it later (tournaments,
// ratings), and a weekly player lands the Strong. Absolute thresholds —
// an epithet can't be lost to someone else's grinding, and any number
// of players can share one.
export const RUNGS: Rung[] = [
	{ games: 1, type: "COGNOMEN_NEW" },
	{ games: 3, type: "COGNOMEN_ABLE" },
	{ games: 6, type: "COGNOMEN_JUST" },
	{ games: 10, type: "COGNOMEN_GOOD" },
	{ games: 15, type: "COGNOMEN_STRONG" },
	{ games: 21, type: "COGNOMEN_NOBLE" },
	{ games: 28, type: "COGNOMEN_GLORIOUS" },
	{ games: 36, type: "COGNOMEN_MAGNIFICENT" },
];

export function epithetOf(total: number): string | null {
	const rung = RUNGS.findLast((r) => total >= r.games);
	return rung ? cognomenName(rung.type) : null;
}
