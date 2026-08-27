<script lang="ts">
	// Families category: which family class ran the capital (nation-agnostic —
	// the earliest of the family decisions), then which families get refused
	// altogether, then a nation selector for which classes that nation's
	// players pick and whether some win more.
	//
	// Rendered on both the profile Stats tab and a tournament's stats page, so
	// the cut table reads as "this player's choices" in one place and "this
	// event's field" in the other with no branch here — the corpus behind the
	// bundle is what differs.

	import ChartContainer from "$lib/ChartContainer.svelte";
	import NationSelect from "./NationSelect.svelte";
	import type { ChartBundleCore } from "./types";
	import {
		capitalFamilyWinLossOption,
		familyClassRowCount,
		familyCutsOption,
		familyNations,
		familyNationPicksOption,
	} from "./charts/families";
	import { ALL_NATIONS, barChartHeight, nationLabel } from "./charts/helpers";

	let { bundle }: { bundle: ChartBundleCore } = $props();

	const nations = $derived(familyNations(bundle));
	// Selector options: the cross-nation aggregate first, then each nation.
	const options = $derived([ALL_NATIONS, ...nations]);
	// User selection; defaults to the "All nations" aggregate until they pick,
	// or if a scope change drops the chosen one.
	let chosen = $state<string | null>(null);
	const nation = $derived(
		chosen && options.includes(chosen) ? chosen : ALL_NATIONS,
	);

	const cuts = $derived(bundle.familyCuts);
	// What the table couldn't read, said out loud rather than quietly dropped —
	// a rate whose exclusions are invisible invites more trust than it has
	// earned.
	const skipped = $derived(
		cuts.skipped_incomplete +
			cuts.skipped_forced_pool +
			cuts.skipped_unknown_pool,
	);
	const skippedReason = $derived(
		[
			cuts.skipped_incomplete > 0
				? `${cuts.skipped_incomplete} that lost a family to conquest`
				: null,
			cuts.skipped_forced_pool > 0
				? `${cuts.skipped_forced_pool} on nations that field their whole pool`
				: null,
			cuts.skipped_unknown_pool > 0
				? `${cuts.skipped_unknown_pool} on an unrecognised nation`
				: null,
		]
			.filter(Boolean)
			.join(", "),
	);
</script>

<!-- The two charts read from different columns (player_summaries
     .capital_family_class, .family_classes) and go empty independently, so each
     carries its own empty state rather than sharing one guard. -->
{#if bundle.capitalFamilyWinRate.length > 0}
	<ChartContainer
		option={capitalFamilyWinLossOption(bundle)}
		height={barChartHeight(bundle.capitalFamilyWinRate.length)}
		title="Capital family"
	/>
{:else}
	<p class="p-8 text-center italic text-brown">
		No capital family data available.
	</p>
{/if}

<!-- Which families this corpus refuses. Its own guard: a corpus can have
     capital-family data and still have no readable cut table, because a roster
     that lost a family to conquest can't say what was chosen at setup. -->
{#if cuts.rows.length > 0}
	<ChartContainer
		option={familyCutsOption(bundle)}
		height={barChartHeight(cuts.rows.length)}
		title="Families cut"
	/>
	<p class="px-4 pb-2 text-center text-xs text-tan opacity-60">
		{cuts.player_games} player-games. A player fields three of their nation's families,
		so the notch on each bar is how often chance alone would cut it — bars past the
		notch are refused more than chance, and colour marks the ones that clear a false-discovery
		gate across all {cuts.rows.length} classes.
		{#if skipped > 0}
			{skipped}
			{skipped === 1 ? "player-game is" : "player-games are"} left out: {skippedReason}.
		{/if}
	</p>
{:else}
	<p class="p-8 text-center italic text-brown">No family cut data available.</p>
{/if}

{#if nations.length === 0}
	<p class="p-8 text-center italic text-brown">No family data available.</p>
{:else}
	<NationSelect value={nation} {options} onChange={(v) => (chosen = v)} />

	<ChartContainer
		option={familyNationPicksOption(bundle, nation)}
		height={barChartHeight(familyClassRowCount(bundle, nation))}
		title={nationLabel(nation)}
	/>
{/if}
