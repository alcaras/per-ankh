// Marketing landing + discovery feed — served to everyone, signed in or
// out. Loads the most recent shared saves (anonymous endpoint) plus the
// video feeds. Signed-in users see the same page, minus the sign-in
// call to action.
import { redirect } from "@sveltejs/kit";
import { cloudApi } from "$lib/api-cloud";
import type { CreatorVideo, TournamentVideo } from "$lib/api-cloud";
import { videoKey } from "$lib/featured-videos.svelte";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import { safeNext } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

// Cards in the home video strip. Each feed already arrives capped at this size
// from the Worker (MAX_CREATOR_FEED_VIDEOS / MAX_TOURNAMENT_FEED_VIDEOS), so
// the newest twelve of the two merged are always among them — and all three
// caps move together. Applied after the hero video is pulled out (see below),
// so promoting one to the hero shortens the strip by nothing.
const VIDEO_STRIP_SIZE = 12;

// One list, two sources: creator uploads (every user's linked channels, which
// the Worker narrows to titles naming Old World) interleaved with the uploads on
// every visible tournament's playlist (unfiltered — a tournament's own admins
// curated them). Newest first across both, uncapped — the caller caps.
//
// A video can legitimately be in both feeds — a caster who linked their channel,
// whose VOD an admin then added to the playlist — and two entries sharing a
// platform+id crash the strip's keyed {#each} with each_key_duplicate, so the
// first occurrence wins. Creators lead the concat because their entries always
// carry Per-Ankh identity, where a playlist entry only does when its uploader
// linked that channel.
function mergeVideoFeeds(
	creatorVideos: CreatorVideo[],
	tournamentVideos: TournamentVideo[],
): TournamentVideo[] {
	const seen = new Set<string>();
	return [...creatorVideos, ...tournamentVideos]
		.filter((v) => {
			const key = videoKey(v);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
}

export const load: PageLoad = async ({ fetch, parent, url }) => {
	const { user } = await parent();

	// Belt-and-suspenders: an already-authenticated viewer who lands on a
	// `/?next=…` bounce URL (a stale/bookmarked link, or a live session in
	// another tab) should be forwarded to their destination rather than left on
	// the home page. The normal anon→login→callback path never reaches here —
	// the callback navigates straight to the unwrapped `next`. Skip home targets
	// so a self-referential `/?next=…` can't loop.
	const nextParam = url.searchParams.get("next");
	if (user && nextParam) {
		const target = safeNext(nextParam);
		if (target !== "/" && !target.startsWith("/?")) {
			throw redirect(303, target);
		}
	}

	// All fetches are best-effort: a transient worker hiccup shouldn't
	// blank the home page. Failures fall through to empty — the section
	// just shows its empty-state copy.
	//
	// A spent read budget is the exception, on the one fetch that has one. The
	// empty state reads as "nothing has been shared lately", which is a different
	// and wrong answer to "you've made too many requests" — and it hides the
	// thing an operator most needs to see, since this page is the busiest reader
	// of the anon_read budget. Same rule as every sibling loader, via
	// rethrowRateLimit.
	//
	// The three video feeds are deliberately outside the read budgets and answer
	// 200 by construction — each handler swallows its own upstream failures to
	// an empty list — so there is no 429 for them to re-throw.
	const [recentRes, creatorVideos, tournamentVideos, featuredVideos] =
		await Promise.all([
			cloudApi.listPublicRecent({ fetch }).catch((err: unknown) => {
				rethrowRateLimit(err);
				return { games: [] };
			}),
			cloudApi.getCreatorVideos({ fetch }).catch(() => []),
			cloudApi.getTournamentVideos({ fetch }).catch(() => []),
			cloudApi.getFeaturedVideos({ fetch }).catch(() => []),
		]);

	const merged = mergeVideoFeeds(creatorVideos, tournamentVideos);

	// The hero's video tile: the newest featured video, or — with nothing
	// featured (or the feed down) — the newest video the feeds have, so the tile
	// is never an empty box. Null only when there is no video anywhere.
	const heroVideo = featuredVideos[0] ?? merged[0] ?? null;
	const heroKey = heroVideo ? videoKey(heroVideo) : null;

	return {
		recentGames: recentRes.games,
		// The strip is everything the hero isn't. The hero is usually in these
		// feeds too — the fallback takes their newest outright, and an admin
		// normally stars something recent — so without this the same card would
		// render twice on one page. Capped after the exclusion, so the strip still
		// carries a full twelve.
		videos: merged
			.filter((v) => videoKey(v) !== heroKey)
			.slice(0, VIDEO_STRIP_SIZE),
		heroVideo,
	};
};
