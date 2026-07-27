<script lang="ts">
	// Families tab — the political system, and its price.
	//
	// A family's opinion of its player applies an EffectCity to every city that
	// family holds, and five of the six bands move upkeep: furious costs half as
	// much again, friendly a fifth less. So the three panels here read as one
	// argument — the opinion over time, how much of the game was spent in each
	// band and what that averaged out to, and the share of the workforce each
	// family's territory absorbed.
	import type { ChartOption } from "$lib/echarts";
	import type { CityStatistics } from "$lib/types/CityStatistics";
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import type { FamilyOpinionEntry, UnitInfo } from "$lib/parser/types";
	import { FAMILY_OPINION_BANDS } from "$lib/generated/family-opinion";
	import { CHART_THEME, getChartColor } from "$lib/config";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import {
		TOOLTIP_BORDER,
		TOOLTIP_MUTED,
		TOOLTIP_SURFACE,
		TOOLTIP_TEXT,
	} from "./EventRail.svelte";
	import { playerEconomies } from "./economy";
	import { familyOpinionSeries, opinionBandTallies } from "./families";
	import { type DetailPlayer, orderPlayersUploaderFirst } from "./helpers";

	let {
		players,
		improvementData,
		cityStatistics,
		familyOpinionHistory = [],
		units = [],
		totalTurns,
		userNation = null,
	}: {
		players: DetailPlayer[];
		improvementData: ImprovementData;
		cityStatistics: CityStatistics;
		// Per-turn opinion. Defaults to [] for legacy callers (frozen web/
		// viewer), which empties the tab rather than breaking it.
		familyOpinionHistory?: FamilyOpinionEntry[];
		units?: UnitInfo[];
		totalTurns: number;
		userNation?: string | null;
	} = $props();

	const orderedPlayers = $derived(
		orderPlayersUploaderFirst(players, userNation),
	);

	const opinions = $derived(
		familyOpinionSeries(familyOpinionHistory, orderedPlayers, totalTurns),
	);

	function pct(value: number): string {
		return `${Math.round(value * 100)}%`;
	}

	// ─── Opinion over time ────────────────────────────────────────────
	// One chart per nation rather than one with everybody on it: six lines in
	// two colours is unreadable, and the comparison that matters is between a
	// nation's own families, not across nations. Within a chart the families
	// get distinct colours from the shared series palette; the nation is named
	// in the title, so its colour doesn't have to carry that.
	function opinionChartFor(player: DetailPlayer): ChartOption | null {
		const mine = opinions.filter((s) => s.playerId === player.playerId);
		if (mine.length === 0) return null;
		return {
			...CHART_THEME,
			title: { ...CHART_THEME.title, text: `${player.label} — family opinion` },
			legend: {
				show: true,
				bottom: 0,
				textStyle: { color: "#FFFFFF", fontSize: 11 },
			},
			tooltip: {
				trigger: "axis",
				backgroundColor: TOOLTIP_SURFACE,
				borderColor: TOOLTIP_BORDER,
				textStyle: { color: TOOLTIP_TEXT },
			},
			grid: { left: 56, right: 32, top: 48, bottom: 64 },
			xAxis: {
				type: "value",
				name: "Turn",
				nameLocation: "middle",
				nameGap: 26,
				min: 0,
				max: totalTurns,
				minInterval: 1,
				splitLine: { show: false },
			},
			yAxis: {
				type: "value",
				name: "Opinion",
				nameLocation: "middle",
				nameGap: 38,
			},
			series: mine.map((s, i) => ({
				name: formatEnum(s.family, "FAMILY_"),
				type: "line" as const,
				data: s.points,
				showSymbol: false,
				lineStyle: { color: getChartColor(i), width: 2 },
				itemStyle: { color: getChartColor(i) },
			})),
		} as ChartOption;
	}

	const opinionCharts = $derived(
		orderedPlayers
			.map((player) => ({ player, option: opinionChartFor(player) }))
			.filter(
				(c): c is { player: DetailPlayer; option: ChartOption } =>
					c.option != null,
			),
	);

	// ─── Turns by band ────────────────────────────────────────────────
	// Semantic scale, so these are literal colours rather than series colours:
	// the bands mean the same thing in every game, and nation colour is spent
	// on the axis labels and the lines above.
	const BAND_COLORS: Record<string, string> = {
		OPINIONFAMILY_FURIOUS: "#8c2f2a",
		OPINIONFAMILY_ANGRY: "#b4524a",
		OPINIONFAMILY_UPSET: "#c98a4b",
		OPINIONFAMILY_CAUTIOUS: "#6b6459",
		OPINIONFAMILY_PLEASED: "#9aa871",
		OPINIONFAMILY_FRIENDLY: "#6f9e5a",
	};

	const bandLabel = (type: string): string =>
		formatEnum(type, "OPINIONFAMILY_");

	const bandTallies = $derived(opinionBandTallies(opinions, orderedPlayers));

	const bandChartOption = $derived.by<ChartOption | null>(() => {
		const rows = bandTallies.filter((t) => t.familyTurns > 0);
		if (rows.length === 0) return null;
		// Reversed so the first nation sits at the top of a category axis, with
		// its own families directly beneath it.
		const ordered = [...rows].reverse();
		const upkeepLabel = (value: number) =>
			`${value > 0 ? "+" : ""}${value.toFixed(1)}% upkeep`;
		// One rich style per nation so every row — heading and families alike —
		// carries its nation's colour, the same key the lines above use.
		const rich: Record<string, object> = {};
		orderedPlayers.forEach((p, i) => {
			rich[`n${i}`] = { color: p.color, fontWeight: "bold", fontSize: 12 };
			rich[`f${i}`] = { color: p.color, fontSize: 11, padding: [0, 0, 0, 14] };
		});
		const styleOf = (t: (typeof ordered)[number]) => {
			const i = orderedPlayers.findIndex(
				(p) => p.playerId === t.player.playerId,
			);
			return t.family == null
				? `{n${i}|${t.player.label}}`
				: `{f${i}|${formatEnum(t.family, "FAMILY_")}}`;
		};
		return {
			...CHART_THEME,
			title: { ...CHART_THEME.title, text: "Turns by family opinion" },
			legend: {
				show: true,
				bottom: 0,
				textStyle: { color: "#FFFFFF", fontSize: 11 },
			},
			tooltip: {
				trigger: "axis",
				axisPointer: { type: "shadow" },
				backgroundColor: TOOLTIP_SURFACE,
				borderColor: TOOLTIP_BORDER,
				textStyle: { color: TOOLTIP_TEXT },
				formatter: (params: unknown) => {
					const arr = params as { dataIndex: number }[];
					const row = ordered[arr[0]?.dataIndex ?? 0];
					if (!row) return "";
					const lines = FAMILY_OPINION_BANDS.filter(
						(b) => (row.counts.get(b.type) ?? 0) > 0,
					).map((b) => {
						const n = row.counts.get(b.type) ?? 0;
						const sign = b.maintenanceModifier > 0 ? "+" : "";
						const effect =
							b.maintenanceModifier === 0
								? "no upkeep change"
								: `${sign}${b.maintenanceModifier}% upkeep`;
						return (
							`<div><span style="color:${BAND_COLORS[b.type]}">■</span> ` +
							`${bandLabel(b.type)} <b>${n}</b> ` +
							`<span style="color:${TOOLTIP_MUTED}">(${pct(n / row.familyTurns)}, ${effect})</span></div>`
						);
					});
					const heading =
						row.family == null
							? `${row.player.label} — all families`
							: `${row.player.label} · ${formatEnum(row.family, "FAMILY_")}`;
					// A family only exists from the turn its first city is founded, so
					// a short bar can mean a late arrival rather than a lost family.
					const since =
						row.firstTurn != null
							? `<div style="color:${TOOLTIP_MUTED};font-size:11px">` +
								`${row.family == null ? "First family from" : "In play from"} turn ${row.firstTurn}</div>`
							: "";
					return (
						`<div style="font-weight:700;color:${row.player.color}">${heading}</div>${since}` +
						lines.join("") +
						`<div style="margin-top:4px;color:${TOOLTIP_MUTED}">` +
						`Across ${row.familyTurns} turns: ` +
						`<b style="color:${TOOLTIP_TEXT}">${upkeepLabel(row.avgMaintenanceModifier)}</b></div>`
					);
				},
			},
			// The right gutter holds the upkeep label clear of the axis end line.
			grid: { left: 130, right: 150, top: 48, bottom: 44 },
			xAxis: { type: "value", name: "" },
			yAxis: {
				type: "category",
				data: ordered.map(styleOf),
				axisLabel: { rich },
			},
			series: FAMILY_OPINION_BANDS.map((band, i) => ({
				name: bandLabel(band.type),
				type: "bar" as const,
				stack: "bands",
				data: ordered.map((t) => t.counts.get(band.type) ?? 0),
				itemStyle: { color: BAND_COLORS[band.type] },
				// The average rides off the end of the last segment, so each bar
				// carries its own cost without a second chart.
				...(i === FAMILY_OPINION_BANDS.length - 1
					? {
							label: {
								show: true,
								position: "right" as const,
								distance: 8,
								color: CHART_THEME.textStyle.color,
								fontSize: 11,
								formatter: (p: { dataIndex: number }) =>
									upkeepLabel(
										ordered[p.dataIndex]?.avgMaintenanceModifier ?? 0,
									),
							},
						}
					: {}),
			})),
		} as ChartOption;
	});

	// ─── Worker-turns by family ───────────────────────────────────────
	// How much of each workforce went into each family's territory — the
	// economic footprint behind the politics above.
	const economies = $derived(
		playerEconomies(
			orderedPlayers,
			improvementData.improvements,
			cityStatistics.cities,
			units,
		),
	);

	const familyWorkRows = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const totals = new Map<string, number>();
		for (const eco of economies) {
			for (const f of eco.byFamily) {
				const key = f.familyClass ?? "";
				totals.set(key, (totals.get(key) ?? 0) + f.turns);
			}
		}
		// Ascending so the biggest sits at the top — ECharts lays a category axis
		// out bottom-up.
		return [...totals.entries()]
			.sort((a, b) => a[1] - b[1])
			.map(([key]) => ({
				// Work outside any city's territory is a real bucket, not a gap.
				label: key === "" ? "Outside cities" : formatEnum(key, "FAMILYCLASS_"),
				values: economies.map(
					(eco) =>
						eco.byFamily.find((f) => (f.familyClass ?? "") === key)?.turns ?? 0,
				),
			}));
	});

	const familyWorkOption = $derived.by<ChartOption>(() => ({
		...CHART_THEME,
		title: { ...CHART_THEME.title, text: "Worker-turns by family" },
		legend: {
			show: orderedPlayers.length > 1,
			top: 4,
			// Clear of ChartContainer's fullscreen button in the corner.
			right: 44,
			textStyle: { color: "#FFFFFF" },
		},
		tooltip: { ...CHART_THEME.tooltip, axisPointer: { type: "shadow" } },
		grid: { left: 130, right: 24, top: 56, bottom: 44 },
		xAxis: {
			type: "value",
			name: "Worker-turns",
			nameLocation: "middle",
			nameGap: 28,
		},
		yAxis: { type: "category", data: familyWorkRows.map((r) => r.label) },
		series: orderedPlayers.map((p, i) => ({
			name: p.label,
			type: "bar" as const,
			data: familyWorkRows.map((r) => r.values[i] ?? 0),
			itemStyle: { color: p.color },
		})),
	}));

	const barHeight = (rows: number): string =>
		`${Math.max(rows, 1) * 26 + 110}px`;
</script>

{#if opinionCharts.length === 0 && familyWorkRows.length === 0}
	<p class="p-8 text-center italic text-tan">No family data in this save</p>
{:else}
	{#if opinionCharts.length > 0}
		<div class="mb-4 grid items-start gap-4 lg:grid-cols-2">
			{#each opinionCharts as chart (chart.player.playerId)}
				<div
					class="rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					<ChartContainer
						option={chart.option}
						height="320px"
						title="{chart.player.label} — family opinion"
					/>
				</div>
			{/each}
		</div>
	{/if}

	{#if bandChartOption}
		<div
			class="mb-4 rounded-lg p-4"
			style="background-color: rgb(var(--color-surface));"
		>
			<ChartContainer
				option={bandChartOption}
				height="{bandTallies.length * 30 + 130}px"
				title="Turns by family opinion"
			/>
		</div>
	{/if}

	{#if familyWorkRows.length > 0}
		<div
			class="mb-4 rounded-lg p-4"
			style="background-color: rgb(var(--color-surface));"
		>
			<ChartContainer
				option={familyWorkOption}
				height={barHeight(familyWorkRows.length)}
				title="Worker-turns by family"
			/>
		</div>
	{/if}
{/if}
