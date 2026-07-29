// Public Season page — the games-played leaderboard. Anonymous endpoint,
// same audience as the home discovery feed. Loads the current season and
// all-time in parallel so the toggle flips instantly.
import { cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

// Seasons follow the meteorological quarters the community actually says
// out loud: Summer Jun–Aug, Fall Sep–Nov, Winter Dec–Feb, Spring Mar–May
// (UTC). Winter belongs to the year it starts in, so Jan/Feb 2027 are
// still "Winter 2026".
function currentSeason(now = new Date()): {
	since: string;
	label: string;
	range: string;
} {
	const m = now.getUTCMonth(); // 0-based
	let y = now.getUTCFullYear();
	// Month the current season started: Jun(5), Sep(8), Dec(11), Mar(2).
	const SEASONS = [
		{ start: 11, name: "Winter", range: "Dec–Feb" },
		{ start: 8, name: "Fall", range: "Sep–Nov" },
		{ start: 5, name: "Summer", range: "Jun–Aug" },
		{ start: 2, name: "Spring", range: "Mar–May" },
	];
	let season = SEASONS.find((s) => m >= s.start);
	if (!season) {
		// Jan/Feb: the Winter that started the previous December.
		season = SEASONS[0];
		y -= 1;
	}
	return {
		since: `${y}-${String(season.start + 1).padStart(2, "0")}-01`,
		label: `${season.name} ${y}`,
		range: season.range,
	};
}

export const load: PageLoad = async ({ fetch }) => {
	const season = currentSeason();
	const [allTime, seasonBoard] = await Promise.all([
		cloudApi.getPlayerLeaderboard({ fetch }),
		cloudApi.getPlayerLeaderboard({ fetch, since: season.since }),
	]);
	return {
		allTime: allTime.players,
		season: seasonBoard.players,
		seasonLabel: season.label,
		seasonRange: season.range,
	};
};
