<script lang="ts">
	// "Latest from creators": the newest uploads across every user's linked
	// channels and every visible tournament's playlist, merged newest-first by
	// the home load (GET /v1/creator-videos + GET /v1/tournament-videos).
	// On the home page this is the middle column between the games feed and the
	// right rail on desktop, where it lays out as a 2-up grid of compact
	// (half-size) VideoCards; below `lg` it collapses to a full-width strip (2-up,
	// then 4-up). Videos are TournamentVideos — the widest of the three shapes
	// VideoCard attributes, and the one a merged strip carries: a creator upload
	// and a matched playlist upload both arrive with the uploader's Per-Ankh
	// identity, an unmatched playlist upload with its raw YouTube channel. The
	// `class` prop supplies the parent grid's placement (order + col-span).
	import VideoCard from "$lib/VideoCard.svelte";
	import type { TournamentVideo } from "$lib/api-cloud";

	let {
		videos,
		class: className = "",
	}: { videos: TournamentVideo[]; class?: string } = $props();
</script>

<section class={className}>
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2">
		{#each videos as v (v.platform + ":" + v.id)}
			<VideoCard video={v} />
		{/each}
	</div>
</section>
