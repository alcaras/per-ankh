<script lang="ts">
	// /stats — the chart catalog over the whole public corpus. The page is the
	// facet row plus the shared StatsView: every chart here is the same spec
	// the user and tournament surfaces render, which is the point of typing
	// the registry at ChartBundleCore.
	//
	// The bundle is built with focal: "humans", so every human seat counts
	// rather than only an uploader's — both sides of a duel are somebody's
	// game. That is also why the page shows no win-rate or top-nation tile:
	// over an all-humans corpus those read ~50% by construction, and the
	// bundle correctly omits them.

	import { autohideScroll } from "$lib/actions/autohideScroll";
	import GlobalFacetRow from "$lib/stats/GlobalFacetRow.svelte";
	import StatsView from "$lib/stats/StatsView.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Not displayed — this is the empty-state gate. A selection narrows the
	// games as well as the focal seats, so a facet the corpus has no game for
	// resolves to a bundle with nothing in it rather than to an error.
	const gameCount = $derived(data.bundle.meta.game_count);
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
					<h1 class="text-2xl font-bold text-gray-200">Global Stats</h1>
					<GlobalFacetRow slice={data.slice} nation={data.nation} />
				</div>

				{#if gameCount === 0}
					<p class="p-8 text-center italic text-tan opacity-60">
						No public games match this selection yet.
					</p>
				{:else}
					<!-- The facet row above is this page's nation control, so the
					     per-nation panels drop their own. -->
					<StatsView
						bundle={data.bundle}
						showNationSelect={false}
						countLabel="Players"
					/>
				{/if}
			</div>
		</div>
	</main>
</div>
