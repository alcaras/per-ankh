<script lang="ts">
	// One home stats panel: a titled Panel wrapping a ranked list.
	//
	// The row is TournamentStandingsInset's — rank, icon, name, number — for the
	// reason the standings inset uses it: the panels sit three across, and a
	// horizontal bar would spend its 140px label gutter on most of that width
	// before the first pixel of plot. A list has nowhere to hover, so the second
	// number a bar keeps in its tooltip rides in the row beside the first.
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import type { StatListRow } from "$lib/home/home-stats";
	import Panel from "$lib/ui/Panel.svelte";

	let {
		title,
		rows,
		class: className = "",
	}: {
		title: string;
		rows: StatListRow[];
		class?: string;
	} = $props();

	// The icon box is sized here rather than by the sprite, so a row whose art
	// is missing from the manifest (SpriteIcon renders nothing then) keeps the
	// same label inset as the rows around it.
	const ICON_SIZE = 18;
</script>

<Panel {title} class={className}>
	{#if rows.length === 0}
		<p class="text-sm text-tan opacity-70">Not enough games yet.</p>
	{:else}
		<ol class="flex flex-col gap-1">
			{#each rows as row, i (row.key)}
				<li class="flex items-center gap-2 text-sm">
					<span class="w-4 shrink-0 text-right font-bold text-gray-400"
						>{i + 1}</span
					>
					<span
						class="inline-flex shrink-0 items-center justify-center"
						style="width: {ICON_SIZE}px; height: {ICON_SIZE}px;"
					>
						{#if row.icon}
							<SpriteIcon
								category={row.icon.category}
								value={row.icon.value}
								size={ICON_SIZE}
							/>
						{/if}
					</span>
					<span class="min-w-0 flex-1 truncate text-tan">{row.label}</span>
					<span class="shrink-0 text-xs text-tan opacity-70">{row.sub}</span>
					<span class="shrink-0 font-bold text-bright">{row.value}</span>
				</li>
			{/each}
		</ol>
	{/if}
</Panel>
