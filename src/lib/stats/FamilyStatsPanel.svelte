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
	import FamilyKeepBars from "./FamilyKeepBars.svelte";
	import {
		capitalFamilyWinLossOption,
		familyClassRowCount,
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

	// The keep table for whatever nation is selected — its own table when one
	// is, the cross-nation one otherwise. Each carries its own gate, so this is
	// a swap rather than a filter over shared rows.
	const keeps = $derived(
		nation === ALL_NATIONS
			? bundle.familyKeeps.overall
			: (bundle.familyKeeps.byNation.find((n) => n.nation === nation) ??
					bundle.familyKeeps.overall),
	);
	// What the table couldn't read, said out loud rather than quietly dropped —
	// a rate whose exclusions are invisible invites more trust than it earned.
	const skipped = $derived(
		keeps.skipped_incomplete +
			keeps.skipped_forced_pool +
			keeps.skipped_unknown_pool,
	);
	const skippedReason = $derived(
		[
			keeps.skipped_incomplete > 0
				? `${keeps.skipped_incomplete} that lost a family to conquest`
				: null,
			keeps.skipped_forced_pool > 0
				? `${keeps.skipped_forced_pool} on nations that field their whole pool`
				: null,
			keeps.skipped_unknown_pool > 0
				? `${keeps.skipped_unknown_pool} on an unrecognised nation`
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

{#if nations.length === 0}
	<p class="p-8 text-center italic text-brown">No family data available.</p>
{:else}
	<!-- One selector for both of the family-choice views below: which classes
	     get kept, and how the games went for them. -->
	<NationSelect value={nation} {options} onChange={(v) => (chosen = v)} />

	<!-- Same card the sibling charts sit in (ChartContainer's shell), so the one
	     hand-rolled view on this panel doesn't read as an unstyled fragment
	     between two chrome-wrapped charts. -->
	{#if keeps.rows.length > 0}
		<div
			class="mx-auto mb-6 max-w-3xl overflow-hidden rounded-lg px-5 py-4"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<h3 class="text-center text-base font-bold text-tan">
				Families kept{nation === ALL_NATIONS ? "" : ` — ${nationLabel(nation)}`}
			</h3>
			<FamilyKeepBars rows={keeps.rows} />
			<p class="mx-auto mt-3 max-w-2xl text-center text-xs text-muted">
				{keeps.player_games} player-games. A player fields three of their nation's
				families, so the notch is how often chance alone would keep one — past the
				notch is a family players want, short of it one they pass over. Δ is that
				gap, coloured only where it clears a false-discovery gate across all
				{keeps.rows.length} classes.
				{#if skipped > 0}
					{skipped}
					{skipped === 1 ? "player-game is" : "player-games are"} left out: {skippedReason}.
				{/if}
			</p>
		</div>
	{/if}

	<ChartContainer
		option={familyNationPicksOption(bundle, nation)}
		height={barChartHeight(familyClassRowCount(bundle, nation))}
		title={nationLabel(nation)}
	/>
{/if}
