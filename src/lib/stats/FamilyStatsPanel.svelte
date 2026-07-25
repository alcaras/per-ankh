<script lang="ts">
	// Families category: which family class ran the capital (nation-agnostic —
	// the earliest of the family decisions), then a nation selector for which
	// classes that nation's players pick and whether some win more.

	import ChartContainer from "$lib/ChartContainer.svelte";
	import NationSelect from "./NationSelect.svelte";
	import type { ChartBundleCore } from "./types";
	import {
		capitalFamilyWinLossOption,
		familyNations,
		familyNationPicksOption,
	} from "./charts/families";
	import { barChartHeight } from "./charts/helpers";
	import { ALL_NATIONS, nationLabel } from "./charts/helpers";

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
</script>

{#if bundle.capitalFamilyWinRate.length > 0}
	<ChartContainer
		option={capitalFamilyWinLossOption(bundle)}
		height={barChartHeight(bundle.capitalFamilyWinRate.length)}
		title="Capital family"
	/>
{/if}

{#if nations.length === 0}
	<p class="p-8 text-center italic text-brown">No family data available.</p>
{:else}
	<NationSelect value={nation} {options} onChange={(v) => (chosen = v)} />

	<ChartContainer
		option={familyNationPicksOption(bundle, nation)}
		height="400px"
		title={nationLabel(nation)}
	/>
{/if}
