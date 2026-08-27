<script lang="ts">
	// Which families get kept, against how often keeping one would happen by
	// itself.
	//
	// Hand-rolled rather than an ECharts bar, for the same reason
	// BuildComparison and TechComparison are: a chart draws one number per row,
	// and this row has five to say — how often it was kept, where chance sits,
	// how far apart those are, whether that gap survives the multiple-comparison
	// gate, and how many games it rests on. A bar chart puts the first on the
	// canvas and leaves the rest in a tooltip nobody opens.
	//
	// Being DOM and not canvas, it colours from the UI ramp — the semantic
	// success/danger pair and the surface tokens — not from the chart palette.
	// Those are separate on purpose: the chart palette is literal hex precisely
	// because ECharts renders to a canvas that cannot resolve CSS variables
	// (docs/reference/color-scheme.md), and nothing here has that problem.
	//
	// The two rules that shape it, both about not making the reader do
	// arithmetic. Chance is a notch ON the bar, not a number in a neighbouring
	// column, because it is a different value per row: three of a four-family
	// pool is 75%, three of Maurya's six is 50%, and a mixed corpus lands
	// between. And every row carries its sample, because a rate with no n
	// invites trust in a four-game cell.
	import { fmtClass } from "./charts/helpers";
	import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
	import type { FamilyKeepRow } from "./types";

	let { rows }: { rows: FamilyKeepRow[] } = $props();

	// Family classes reuse the archetype crest art, the same mapping the sibling
	// family charts use.
	function crest(familyClass: string): string | undefined {
		return SPRITE_MANIFEST[
			`crests/CREST_ARCHETYPE_${familyClass.replace(/^FAMILYCLASS_/, "")}`
		];
	}

	// One rule for every coloured thing on the row: colour means the gap cleared
	// the significance gate, and which colour means which way. A bar that took
	// its colour from the sign alone said "kept less than chance" for a family
	// sitting five points under it on sixty games — a claim the Δ beside it was
	// declining to make, in the same two colours. Below the gate the bar is
	// neutral and the position does the talking; the notch is still right there.
	function fill(row: FamilyKeepRow): string {
		if (!row.significant) return "rgb(var(--color-muted) / 0.55)";
		const token = row.delta >= 0 ? "--color-success" : "--color-danger";
		const strength = Math.min(1, Math.abs(row.delta) / 25);
		return `rgb(var(${token}) / ${(0.35 + strength * 0.5).toFixed(2)})`;
	}
</script>

<!-- Width is the caller's: the card around it is capped, because ten rows of a
     percentage do not get more readable at 1400px — the eye loses the line
     between a name and its bar, and the notch stops being comparable row to
     row. -->
<div class="flex flex-col gap-1">
	<!-- Column headers instead of a paragraph. Without them the Δ column is a
	     signed number in one of three colours and no way to know what any of it
	     means; "vs chance" names the comparison and the colour then reads as
	     what it is. -->
	<div
		class="grid items-end gap-2 pb-0.5 text-[10px] uppercase tracking-wide text-muted"
		style="grid-template-columns: 120px 1fr 38px 42px 34px;"
	>
		<span></span>
		<span class="text-right">kept, vs the tick = chance</span>
		<span class="text-right">kept</span>
		<span
			class="text-right"
			title="Kept minus chance. Coloured where the gap is more than this many games could produce by luck."
			>vs chance</span
		>
		<span class="text-right">games</span>
	</div>
	{#each rows as row (row.family_class)}
		<div
			class="grid items-center gap-2 text-xs"
			style="grid-template-columns: 120px 1fr 38px 42px 34px;"
		>
			<span class="flex min-w-0 items-center gap-1.5 text-tan">
				{#if crest(row.family_class)}
					<img
						src={crest(row.family_class)}
						alt=""
						width="14"
						height="14"
						class="shrink-0"
					/>
				{/if}
				<span class="truncate">{fmtClass(row.family_class)}</span>
			</span>

			<!-- The track. Quarter gridlines give the eye something to measure
			     against without an axis, and the notch is this row's own chance
			     level. -->
			<span class="relative block h-3.5 rounded-sm bg-surface-sunken">
				<span
					class="pointer-events-none absolute inset-0 rounded-sm"
					style="background-image: repeating-linear-gradient(to right, transparent 0, transparent calc(25% - 1px), rgb(var(--color-tan) / 0.18) calc(25% - 1px), rgb(var(--color-tan) / 0.18) 25%);"
				></span>
				<span
					class="absolute inset-y-0 left-0 rounded-sm"
					style="width:{row.kept_pct}%;background:{fill(row)}"
				></span>
				<span
					class="absolute inset-y-[-2px] w-[2px] rounded-sm bg-tan-light"
					style="left:{row.baseline_pct}%"
					title="Chance alone keeps it {row.baseline_pct.toFixed(
						0,
					)}% of the time"
				></span>
			</span>

			<span class="text-right font-mono text-bright"
				>{row.kept_pct.toFixed(0)}%</span
			>

			<!-- The gap, coloured only when it clears the gate. Muted here means
			     "not distinguishable from chance", never "small". -->
			<span
				class="text-right font-mono"
				class:text-muted={!row.significant}
				class:text-success={row.significant && row.delta >= 0}
				class:text-danger={row.significant && row.delta < 0}
				title={row.significant
					? "Clears the false-discovery gate"
					: "Not distinguishable from chance"}
			>
				{row.delta >= 0 ? "+" : ""}{row.delta.toFixed(0)}
			</span>

			<span class="text-right font-mono text-muted">{row.eligible}g</span>
		</div>
	{/each}
</div>
