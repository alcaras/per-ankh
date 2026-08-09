<script lang="ts">
	// "Latest from creators": the newest uploads across every user's linked
	// channels and every visible tournament's playlist, merged newest-first by
	// the home load (GET /v1/creator-videos + GET /v1/tournament-videos).
	// On the home page this is the right column beside the games feed on desktop,
	// where it lays out as a 2-up grid of compact (half-size) VideoCards; below
	// `lg` it collapses to a full-width strip (2-up, then 4-up). Videos are
	// TournamentVideos — the widest of the three shapes VideoCard attributes, and
	// the one a merged strip carries: a creator upload and a matched playlist
	// upload both arrive with the uploader's Per-Ankh identity, an unmatched
	// playlist upload with its raw YouTube channel. The enclosing Panel owns the
	// section element, its header and the parent grid's placement; this is just
	// the card grid.
	import VideoCard from "$lib/VideoCard.svelte";
	import { videoKey } from "$lib/featured-videos.svelte";
	import type { TournamentVideo } from "$lib/api-cloud";

	let { videos }: { videos: TournamentVideo[] } = $props();
</script>

<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2">
	{#each videos as v (videoKey(v))}
		<VideoCard video={v} />
	{/each}
</div>
