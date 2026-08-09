<script lang="ts">
	// Recent videos merged across the user's linked channels (newest first),
	// rendered as a grid of discovery-style VideoCards — the same card the home
	// "Latest from creators" feed uses, so the two surfaces read as one family.
	// These are all one user's uploads, so the cards suppress the uploader credit
	// and show the date pill alone — the videos still carry their uploader, which
	// is what an admin's star snapshots into the featured set. The grid sits in a
	// recessed (sunken) panel so the raised cards read as a well within the tab.
	// Data comes from GET /v1/users/:id/videos via the page load.
	import VideoCard from "$lib/VideoCard.svelte";
	import { videoKey } from "$lib/featured-videos.svelte";
	import type { CreatorVideo } from "$lib/api-cloud";

	let { videos }: { videos: CreatorVideo[] } = $props();
</script>

<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface-sunken));"
>
	{#if videos.length === 0}
		<div class="py-8 text-center text-sm text-gray-400">No recent videos.</div>
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each videos as v (videoKey(v))}
				<VideoCard video={v} showUploader={false} />
			{/each}
		</div>
	{/if}
</div>
