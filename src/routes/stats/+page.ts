// Public Stats page — the games-played leaderboard. Anonymous endpoint,
// same audience as the home discovery feed. Loads the current dynasty
// (per-ankh's season: a calendar quarter, UTC) and all-time in parallel so
// the toggle flips instantly.
import { cloudApi } from "$lib/api-cloud";
import { toRomanNumeral } from "$lib/utils/formatting";
import type { PageLoad } from "./$types";

// Seasons are dynasties — the game's own unit of succession — numbered
// from per-ankh's first: Dynasty I is 2026 Q3, each calendar quarter (UTC)
// crowns the next.
const DYNASTY_EPOCH_YEAR = 2026;
const DYNASTY_EPOCH_QUARTER = 2; // zero-based: Q3

function currentDynasty(now = new Date()): {
	since: string;
	label: string;
	range: string;
} {
	const y = now.getUTCFullYear();
	const q = Math.floor(now.getUTCMonth() / 3);
	const ordinal =
		(y - DYNASTY_EPOCH_YEAR) * 4 + (q - DYNASTY_EPOCH_QUARTER) + 1;
	const MONTHS = ["Jan", "Apr", "Jul", "Oct"];
	const ENDS = ["Mar", "Jun", "Sep", "Dec"];
	return {
		since: `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`,
		label: `Dynasty ${toRomanNumeral(Math.max(1, ordinal))}`,
		range: `${MONTHS[q]}–${ENDS[q]} ${y}`,
	};
}

export const load: PageLoad = async ({ fetch }) => {
	const dynasty = currentDynasty();
	const [allTime, season] = await Promise.all([
		cloudApi.getPlayerLeaderboard({ fetch }),
		cloudApi.getPlayerLeaderboard({ fetch, since: dynasty.since }),
	]);
	return {
		allTime: allTime.players,
		season: season.players,
		dynastyLabel: dynasty.label,
		dynastyRange: dynasty.range,
	};
};
