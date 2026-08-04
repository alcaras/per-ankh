// Marketing landing + discovery feed — served to everyone, signed in or
// out. Loads the active tournaments list (public read) and the most
// recent shared saves (anonymous endpoint). Signed-in users see the
// same page.
import { redirect } from "@sveltejs/kit";
import { cloudApi } from "$lib/api-cloud";
import type { CreatorVideo, TournamentVideo } from "$lib/api-cloud";
import { safeNext } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

// Cards in the home video strip. Each feed already arrives capped at this size
// from the Worker (MAX_CREATOR_FEED_VIDEOS / MAX_TOURNAMENT_FEED_VIDEOS), so
// the newest twelve of the two merged are always among them — and all three
// caps move together.
const VIDEO_STRIP_SIZE = 12;

// One strip, two sources: creator uploads (every user's linked channels, which
// the Worker narrows to titles naming Old World) interleaved with the uploads on
// every visible tournament's playlist (unfiltered — a tournament's own admins
// curated them). Newest first across both.
//
// A video can legitimately be in both feeds — a caster who linked their channel,
// whose VOD an admin then added to the playlist — and two entries sharing a
// platform+id crash the strip's keyed {#each} with each_key_duplicate, so the
// first occurrence wins. Creators lead the concat because their entries always
// carry Per-Ankh identity, where a playlist entry only does when its uploader
// linked that channel.
function mergeVideoStrip(
	creatorVideos: CreatorVideo[],
	tournamentVideos: TournamentVideo[],
): TournamentVideo[] {
	const seen = new Set<string>();
	return [...creatorVideos, ...tournamentVideos]
		.filter((v) => {
			const key = `${v.platform}:${v.id}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
		.slice(0, VIDEO_STRIP_SIZE);
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
	const [recentRes, tournamentsRes, creatorVideos, tournamentVideos] =
		await Promise.all([
			cloudApi.listPublicRecent({ fetch }).catch(() => ({ games: [] })),
			cloudApi
				.listTournaments({ limit: 50 }, { fetch })
				.catch(() => ({ tournaments: [], limit: 0, offset: 0 })),
			cloudApi.getCreatorVideos({ fetch }).catch(() => []),
			cloudApi.getTournamentVideos({ fetch }).catch(() => []),
		]);

	return {
		recentGames: recentRes.games,
		tournaments: tournamentsRes.tournaments,
		videos: mergeVideoStrip(creatorVideos, tournamentVideos),
	};
};
