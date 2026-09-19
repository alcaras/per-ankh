<script lang="ts">
	// One ranked list inside the home stats panel.
	//
	// The row is TournamentStandingsInset's — rank, icon, name, number — for the
	// reason the standings inset uses it: the lists sit three across, and a
	// horizontal bar would spend its 140px label gutter on most of that width
	// before the first pixel of plot. A list has nowhere to hover, so the second
	// number a bar keeps in its tooltip rides in the row beside the first.
	//
	// The box and its label belong to HomeStatsPanel, the same split
	// FeaturedTournamentPanel makes with its two insets.
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import type { StatListRow } from "$lib/home/home-stats";

	let { rows }: { rows: StatListRow[] } = $props();

	// The icon box is sized here rather than by the sprite, so a row whose art
	// is missing from the manifest (SpriteIcon renders nothing then) keeps the
	// same label inset as the rows around it.
	const ICON_SIZE = 18;
</script>

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
				<!-- Both numbers ride fixed-width tabular columns rather than sizing
				     to their own text. Shrink-wrapped, a three-digit count pushed the
				     percentage beside it a digit further left than a two-digit one
				     did, so the dim column zig-zagged down a list whose counts fall
				     through 100. The widths hold four digits and "100%", which is
				     every value either column can reach. -->
				<span
					class="w-9 shrink-0 text-right text-xs tabular-nums text-tan opacity-70"
					>{row.sub}</span
				>
				<span
					class="w-10 shrink-0 text-right font-bold tabular-nums text-bright"
					>{row.value}</span
				>
			</li>
		{/each}
	</ol>
{/if}
