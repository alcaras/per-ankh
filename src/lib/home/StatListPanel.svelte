<script lang="ts">
	// One home stats panel: a titled Panel wrapping a ranked list.
	//
	// The row is TournamentStandingsInset's — rank, icon, name, number — for the
	// reason the standings inset uses it: the panels sit three across, and a
	// horizontal bar would spend its 140px label gutter on most of that width
	// before the first pixel of plot. A list has nowhere to hover, so the second
	// number a bar keeps in its tooltip rides in the row beside the first.
	import type { SpriteCategory } from "$lib/game-detail/helpers";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import type { StatListRow } from "$lib/home/home-stats";
	import Panel from "$lib/ui/Panel.svelte";

	let {
		title,
		titleIcon,
		rows,
	}: {
		title: string;
		// The panel heading's icon — the game's own glyph for what the list
		// ranks, in the same descriptor shape the rows carry.
		titleIcon: { category: SpriteCategory; value: string };
		rows: StatListRow[];
	} = $props();

	// The icon box is sized here rather than by the sprite, so a row whose art
	// is missing from the manifest (SpriteIcon renders nothing then) keeps the
	// same label inset as the rows around it.
	const ICON_SIZE = 18;

	// The heading glyph, a touch larger than the row icons so it reads as the
	// panel's marker rather than another list entry.
	const TITLE_ICON_SIZE = 20;
</script>

<Panel {title}>
	{#snippet icon()}
		<SpriteIcon
			category={titleIcon.category}
			value={titleIcon.value}
			size={TITLE_ICON_SIZE}
		/>
	{/snippet}
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
</Panel>
