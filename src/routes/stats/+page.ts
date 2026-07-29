// Public Stats page — the uploads leaderboard. Anonymous endpoint, same
// audience as the home discovery feed. Loads the current season (calendar
// quarter, UTC) and all-time in parallel so the toggle flips instantly.
import { cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

// First day of the current UTC calendar quarter — the season boundary.
function currentSeasonStart(now = new Date()): {
	since: string;
	label: string;
} {
	const y = now.getUTCFullYear();
	const q = Math.floor(now.getUTCMonth() / 3);
	const since = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
	return { since, label: `Q${q + 1} ${y}` };
}

export const load: PageLoad = async ({ fetch }) => {
	const season = currentSeasonStart();
	const [allTime, seasonBoard] = await Promise.all([
		cloudApi.getUploaderLeaderboard({ fetch }),
		cloudApi.getUploaderLeaderboard({ fetch, since: season.since }),
	]);
	return {
		allTime: allTime.uploaders,
		season: seasonBoard.uploaders,
		seasonLabel: season.label,
	};
};
