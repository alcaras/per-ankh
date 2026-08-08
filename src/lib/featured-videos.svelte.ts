// The site-admin featured set, as client state.
//
// Which videos are featured is one app-wide fact, and the star that toggles it
// rides on VideoCard — a component three unrelated surfaces render (the home
// strip, a profile's Videos tab, a tournament's Videos page). Holding the set
// per-card would leave the same video starred on one surface and not another
// after a toggle, and `page.data` can't hold it because an optimistic flip has
// to be writable and survive until the next load. So it lives here: one
// reactive set of "<platform>:<video_id>" keys that every star reads.
//
// Seeded from the root layout's fetch (see +layout.ts) via syncFeatured, which
// runs in an effect so the server never populates module state — that would be
// shared across requests.

import { SvelteSet } from "svelte/reactivity";
import {
	cloudApi,
	type FeaturedVideo,
	type FeatureVideoRequest,
	type TournamentVideo,
} from "$lib/api-cloud";
import { toast } from "$lib/ui/toast";

// The identity of a video everywhere it's rendered — the same key the card
// grids use for their `{#each}` and the Worker's composite primary key.
export function videoKey(video: { platform: string; id: string }): string {
	return `${video.platform}:${video.id}`;
}

const keys = new SvelteSet<string>();

// Replace the set with what the server says is featured. Called from the root
// layout (app-wide) and from the admin page, whose own load is fresher; a
// re-run of either is server truth, so it wins over any optimistic flip still
// standing.
export function syncFeatured(videos: FeaturedVideo[]): void {
	keys.clear();
	for (const video of videos) keys.add(videoKey(video));
}

// Reading this inside a component template or $derived subscribes to the set.
export function isFeatured(video: { platform: string; id: string }): boolean {
	return keys.has(videoKey(video));
}

// The snapshot POST /v1/admin/featured-videos stores. A featured video outlives
// the feed it came from, so the fields the platform owns travel with it; the
// uploader's name and avatar don't (the read joins those live), which is why
// only the discriminating fields — user_id, or the raw channel pair — are read
// off the card's video.
function snapshot(video: TournamentVideo): FeatureVideoRequest {
	return {
		platform: video.platform,
		video_id: video.id,
		url: video.url,
		title: video.title,
		thumbnail_url: video.thumbnail_url,
		published_at: video.published_at,
		user_id: "user_id" in video ? video.user_id : null,
		uploader_name: "uploader_name" in video ? video.uploader_name : null,
		uploader_url: "uploader_name" in video ? video.uploader_url : null,
	};
}

// Feature or unfeature, optimistically: the set flips first so the star (and
// the Featured tab's list, which filters on it) responds immediately, and
// reverts on failure. The set is the only thing a caller has to revert — every
// surface derives what it renders from it — so a failure is reported by the
// toast here rather than handed back.
export async function setFeatured(
	video: TournamentVideo,
	next: boolean,
): Promise<void> {
	const key = videoKey(video);
	const was = keys.has(key);
	if (next) keys.add(key);
	else keys.delete(key);
	try {
		if (next) await cloudApi.featureVideo(snapshot(video));
		else await cloudApi.unfeatureVideo(video.platform, video.id);
	} catch (err) {
		if (was) keys.add(key);
		else keys.delete(key);
		toast.error(
			`${next ? "Feature" : "Unfeature"} failed: ${err instanceof Error ? err.message : err}`,
		);
	}
}
