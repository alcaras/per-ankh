// Public Stats page — the uploads leaderboard. Anonymous endpoint, same
// audience as the home discovery feed.
import { cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch }) => {
	const { uploaders } = await cloudApi.getUploaderLeaderboard({ fetch });
	return { uploaders };
};
