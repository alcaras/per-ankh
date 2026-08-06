import { cloudApi } from "$lib/api-cloud";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import type { PageLoad } from "./$types";

// Videos view — the uploads from the tournament's admin-set YouTube playlist.
// The playlist itself lives on the tournament (loaded once by the [slug] layout);
// this page fetches its videos, but only when a playlist is configured, and sets
// its own meta. The tab linking here is hidden unless youtube_playlist_url is
// set, so a direct visit is the only way to reach an unconfigured tournament's
// Videos view — it renders the empty state rather than 404ing. Best-effort like
// the home creator feed: an upstream hiccup yields an empty grid, not an error.
//
// A spent read budget is the one exception, and it's why this can't be a bare
// `.catch(() => [])`: the empty grid is indistinguishable from a tournament
// with no playlist, so the visitor is told there are no videos rather than to
// come back later. Every sibling tournament loader answers a 429 with the 429
// page; this one has to as well.
export const load: PageLoad = async ({ parent, fetch }) => {
	const { tournament } = await parent();
	const videos = tournament.youtube_playlist_url
		? await cloudApi
				.getTournamentPlaylistVideos(tournament.tournament_id, { fetch })
				.catch((err: unknown) => {
					rethrowRateLimit(err);
					return [];
				})
		: [];
	return {
		videos,
		meta: {
			title: `${tournament.name} · Videos - Per-Ankh`,
			description: `Videos for ${tournament.name} on Per-Ankh.`,
		},
	};
};
