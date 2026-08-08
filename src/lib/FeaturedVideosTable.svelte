<script lang="ts">
	// The featured set as an inventory, for the Featured tab on /admin — a table
	// rather than the VideoCard grid the public surfaces use, because this is the
	// view for auditing what's in the set and taking things out of it, not for
	// discovering videos. It's also the only surface that reaches the set on a
	// touch device: the star on a card is hover-only.
	//
	// Rows come from the page load (newest video first, as the Worker ordered
	// them) narrowed to what's still featured, so a removal here — which flips
	// the same shared set the stars read — drops the row without a re-fetch, and
	// puts it back if the write fails.
	import type { FeaturedVideo } from "$lib/api-cloud";
	import {
		isFeatured,
		setFeatured,
		videoKey,
	} from "$lib/featured-videos.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import { formatDate, platformLabel } from "$lib/utils/formatting";

	let { videos }: { videos: FeaturedVideo[] } = $props();

	const rows = $derived(videos.filter(isFeatured));

	// Which video is mid-write, so its Remove button can't be pressed twice.
	let removing = $state<string | null>(null);

	async function remove(video: FeaturedVideo) {
		if (removing !== null) return;
		removing = videoKey(video);
		await setFeatured(video, false);
		removing = null;
	}
</script>

<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<h3 class="mb-3 text-base font-bold text-tan">Admin — Featured videos</h3>
	<div
		class="rounded-lg p-3"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<p class="mb-3 text-xs text-tan">
			Videos featured from the star on any video card. Each row is a snapshot
			taken when it was featured, so it stays here after it drops out of its
			channel's feed — the uploader's name is joined live, and follows a rename.
		</p>
		{#if rows.length === 0}
			<div class="py-6 text-center text-sm text-gray-400">
				No featured videos.
			</div>
		{:else}
			<table class="w-full text-left text-xs text-tan">
				<thead>
					<tr class="border-b border-black">
						<th class="py-1.5 pr-2 font-bold">Video</th>
						<th class="py-1.5 pr-2 font-bold">Uploader</th>
						<th class="py-1.5 pr-2 font-bold">Published</th>
						<th class="py-1.5 font-bold"
							><span class="sr-only">Actions</span></th
						>
					</tr>
				</thead>
				<tbody>
					{#each rows as video (videoKey(video))}
						<tr class="border-b border-black/50 last:border-0">
							<td class="min-w-0 py-1.5 pr-2">
								<!-- An external watch URL, not an app route, so resolve()
								     doesn't apply; rel guards tabnabbing + referrer leakage. -->
								<!-- eslint-disable svelte/no-navigation-without-resolve -->
								<a
									href={video.url}
									target="_blank"
									rel="noopener noreferrer"
									class="line-clamp-2 hover:underline"
									title={video.title}
								>
									{video.title}
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
								<div class="text-gray-400">{platformLabel(video.platform)}</div>
							</td>
							<td class="py-1.5 pr-2">
								{#if "user_id" in video}
									<ProfileLink
										userId={video.user_id}
										slug={video.slug}
										class="hover:underline"
									>
										{video.display_name}
									</ProfileLink>
								{:else if "uploader_name" in video}
									<!-- eslint-disable svelte/no-navigation-without-resolve -->
									<a
										href={video.uploader_url}
										target="_blank"
										rel="noopener noreferrer"
										class="hover:underline"
									>
										{video.uploader_name}
									</a>
									<!-- eslint-enable svelte/no-navigation-without-resolve -->
								{:else}
									<span class="text-gray-400">—</span>
								{/if}
							</td>
							<td class="whitespace-nowrap py-1.5 pr-2">
								{formatDate(video.published_at)}
							</td>
							<td class="py-1.5 text-right">
								<button
									type="button"
									onclick={() => remove(video)}
									disabled={removing !== null}
									class="rounded bg-orange px-2 py-0.5 text-xs font-bold text-white hover:bg-orange/80 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange"
								>
									Remove
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
