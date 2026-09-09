<script lang="ts">
	// One home stats panel: a titled Panel wrapping a ChartContainer.
	//
	// The option carries no in-chart title — the Panel's h2 does the titling, and
	// ChartContainer's `title` is only the expand button's aria-label, so there
	// is no second heading to collide with it.
	import ChartContainer from "$lib/ChartContainer.svelte";
	import type { ChartOption } from "$lib/echarts";
	import { barChartHeight } from "$lib/stats/charts/helpers";
	import Panel from "$lib/ui/Panel.svelte";

	let {
		title,
		option,
		rows,
		class: className = "",
	}: {
		title: string;
		option: ChartOption;
		// Rows the option actually draws — the chart's height follows it, so a
		// short category list gets a short panel instead of empty bands.
		rows: number;
		class?: string;
	} = $props();
</script>

<Panel {title} class={className}>
	<ChartContainer {option} {title} height={barChartHeight(rows)} />
</Panel>
