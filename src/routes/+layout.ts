// adapter-cloudflare with SSR. Public game pages need server-rendered
// <meta property="og:*"> tags so Discord/Slack/Twitter can unfurl shared
// URLs into preview cards.
export const ssr = true;
export const prerender = false;

import {
	cloudApi,
	type FeaturedVideo,
	type MyAdminTournamentEntry,
	type MyTournamentEntry,
	type UserMe,
} from "$lib/api-cloud";
import { DEFAULT_META, type PageMeta } from "$lib/page-meta";
import type { LayoutLoad } from "./$types";

// Layout-level user load. Provides `data.user` to the cloud header so it
// can render the avatar/display_name (or "Sign in") on every page.
//
// Per-page auth guards stay where they are — those redirect on
// UnauthorizedError to /. The layout fetch is for chrome only; a
// null `user` here just renders the signed-out header without disrupting
// the page's own load.
//
// `meta` defaults are also exposed here. Pages override them by returning
// their own `meta` from `+page.ts` — SvelteKit merges parent + child data
// so the child's value wins. The root +layout.svelte renders one OG/
// Twitter block from `data.meta`.
export const load: LayoutLoad = async ({
	fetch,
}): Promise<{
	user: UserMe | null;
	meta: PageMeta;
	myTournaments: MyTournamentEntry[];
	adminTournaments: MyAdminTournamentEntry[];
	featuredVideos: FeaturedVideo[];
}> => {
	try {
		const user = await cloudApi.getMe({ fetch });
		// `myTournaments` drives the header dropdown (status != complete).
		// `adminTournaments` is a separate fetch (admin membership is its
		// own table). Both are nice-to-haves: failures fall through to
		// empty lists so the header still renders.
		let myTournaments: MyTournamentEntry[] = [];
		let adminTournaments: MyAdminTournamentEntry[] = [];
		// The site-admin featured set. Fetched once here — rather than by the
		// three page loads that render videos — because it's what the star toggle
		// on each VideoCard reads its state from, and because the alternative
		// (a per-viewer `featured` flag on /v1/creator-videos) would make an
		// edge-cached public response viewer-specific.
		let featuredVideos: FeaturedVideo[] = [];
		// my-tournaments / my-admin-tournaments are per-user membership lists,
		// relevant to any logged-in user. Skip the round-trips for signed-out
		// visitors. The catch blocks still tolerate failure (e.g. network) so a
		// hiccup doesn't break the header chrome.
		if (user) {
			try {
				const res = await cloudApi.getMyTournaments({ fetch });
				myTournaments = res.tournaments.filter((t) => t.status !== "complete");
			} catch {
				// fall through with empty list
			}
			try {
				const res = await cloudApi.getMyAdminTournaments({ fetch });
				adminTournaments = res.tournaments.filter(
					(t) => t.status !== "complete",
				);
			} catch {
				// fall through with empty list
			}
		}
		// Site admins only — the endpoint 404s for everyone else, so asking would
		// spend a round-trip to learn what `is_admin` already says.
		if (user?.is_admin) {
			try {
				featuredVideos = await cloudApi.listFeaturedVideos({ fetch });
			} catch {
				// fall through with empty list
			}
		}
		return {
			user,
			meta: DEFAULT_META,
			myTournaments,
			adminTournaments,
			featuredVideos,
		};
	} catch {
		// Network errors etc. — header just renders signed-out state.
		// Page-level loads will surface real errors when they fire.
		return {
			user: null,
			meta: DEFAULT_META,
			myTournaments: [],
			adminTournaments: [],
			featuredVideos: [],
		};
	}
};
