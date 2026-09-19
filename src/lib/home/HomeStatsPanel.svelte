<script lang="ts">
	// The home page's corpus stats, as one tray of three insets: which nations
	// get played, which family class holds the capital, which leader archetype
	// starts the game. Three separate panels before this — one panel reads as
	// the single board they always were, and the row below the hero is two
	// trays (this and the tools) instead of four.
	//
	// The inset chrome and its label live here rather than in StatListInset,
	// the same split FeaturedTournamentPanel makes with its two boxes: the
	// inset is the list, the panel is what the list sits in.
	import type { SpriteCategory } from "$lib/game-detail/helpers";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import type { StatListRow } from "$lib/home/home-stats";
	import Panel from "$lib/ui/Panel.svelte";
	import StatListInset from "./StatListInset.svelte";

	let {
		nationPickRate,
		capitalFamily,
		archetype,
		class: className = "",
	}: {
		nationPickRate: StatListRow[];
		capitalFamily: StatListRow[];
		archetype: StatListRow[];
		class?: string;
	} = $props();

	// The label's glyph — the game's own art for what the list ranks, in the
	// same descriptor shape the rows carry. Smaller than a row icon, so the
	// label reads as the inset's marker and not as its first entry.
	const LABEL_ICON_SIZE = 14;

	const sections: Array<{
		id: string;
		label: string;
		icon: { category: SpriteCategory; value: string };
		rows: StatListRow[];
	}> = $derived([
		{
			id: "nations",
			label: "Nations",
			icon: { category: "icons", value: "TRIBES" },
			rows: nationPickRate,
		},
		{
			id: "capital-family",
			label: "Starting Family",
			icon: { category: "icons", value: "RELATIONSHIPS" },
			rows: capitalFamily,
		},
		{
			id: "starting-leader",
			label: "Starting Leader",
			icon: { category: "icons", value: "CHARACTERS" },
			rows: archetype,
		},
	]);
</script>

<Panel title="Global Stats" class={className}>
	<!-- Two across before the panel is wide enough for three: at `sm` an inset
	     is ~270px of content, which the row's fixed rank/number columns already
	     take half of, and a third column there would leave the names with
	     nothing but ellipsis. At `lg` each inset is the width the three
	     standalone panels had. -->
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each sections as section (section.id)}
			<div class="rounded-lg bg-surface-deep p-2">
				<h3
					class="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase text-gray-400"
				>
					<SpriteIcon
						category={section.icon.category}
						value={section.icon.value}
						size={LABEL_ICON_SIZE}
					/>
					{section.label}
				</h3>
				<StatListInset rows={section.rows} />
			</div>
		{/each}
	</div>
</Panel>
