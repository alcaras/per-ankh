// Families tab option builders.

import type { ChartOption } from "$lib/echarts";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import type { ChartBundleCore } from "../types";
import {
	ALL_NATIONS,
	CHART_THEME,
	COMMON_GRID,
	LOSS_COLOR,
	WIN_COLOR,
	crestAxisLabel,
	fmtClass,
	nationLabel,
} from "./helpers";

// Family classes reuse the ARCHETYPE crest art (FAMILYCLASS_CHAMPIONS →
// crests/CREST_ARCHETYPE_CHAMPIONS).
// The wins/losses stack both family charts draw: bar length is games, the
// split is how they ended, and a trailing label can hang off the loss segment.
// Kept local to this module — #155 introduces a catalog-wide
// `winLossStackedOption` in charts/helpers.ts, and both of these route through
// it on rebase once that lands.
function outcomeSeries(opts: {
	wins: number[];
	losses: number[];
	label?: { formatter: (p: { dataIndex: number }) => string };
}) {
	return [
		{
			name: "Wins",
			type: "bar" as const,
			stack: "outcome",
			data: opts.wins,
			itemStyle: { color: WIN_COLOR },
		},
		{
			name: "Losses",
			type: "bar" as const,
			stack: "outcome",
			data: opts.losses,
			itemStyle: { color: LOSS_COLOR },
			...(opts.label
				? {
						label: {
							show: true,
							position: "right" as const,
							color: CHART_THEME.textStyle.color,
							fontSize: 11,
							formatter: opts.label.formatter,
						},
					}
				: {}),
		},
	];
}

// Founding-order slots, in order. A player runs three families; which one
// seeded the first city is a different commitment from the third.
const SLOT_LABELS = ["1st family", "2nd", "3rd"] as const;

function classCrestUrl(familyClass: string): string | undefined {
	const name = familyClass.replace(/^FAMILYCLASS_/, "");
	return SPRITE_MANIFEST[`crests/CREST_ARCHETYPE_${name}`];
}

// Nations that have any family-class data, most-played first — drives the
// selector in FamilyStatsPanel.
export function familyNations(bundle: ChartBundleCore): string[] {
	const games = new Map(bundle.nationWinRate.map((r) => [r.nation, r.games]));
	return Array.from(new Set(bundle.familyByNation.map((r) => r.nation))).sort(
		(a, b) => (games.get(b) ?? 0) - (games.get(a) ?? 0),
	);
}

// For one nation: paired horizontal bars of pick rate and win rate per
// pool class, sorted by pick rate. Answers "which families do I pick for
// this nation" and "do some win more" in one read, with no cross-nation
// availability confound.
export function familyNationPicksOption(
	bundle: ChartBundleCore,
	nation: string,
): ChartOption {
	const isAll = nation === ALL_NATIONS;
	// "All nations": aggregate counts/wins per class across every nation; pick
	// rate is over total games in the corpus. (Across-pool aggregate — handy as
	// an overview, but not availability-normalized.) Otherwise restrict to the
	// chosen nation and use that nation's game count as the pick-rate base.
	const games = isAll
		? bundle.nationWinRate.reduce((s, r) => s + r.games, 0)
		: (bundle.nationWinRate.find((r) => r.nation === nation)?.games ?? 0);
	// City share is a per-nation mean, so recombining across nations weights
	// each nation by how often the class was picked there — the same weighting
	// the pick/win counts already carry. Slot counts are plain sums.
	const byClass = new Map<
		string,
		{
			count: number;
			wins: number;
			shareSum: number;
			shareCount: number;
			slots: [number, number, number];
		}
	>();
	for (const r of bundle.familyByNation) {
		if (!isAll && r.nation !== nation) continue;
		const e = byClass.get(r.class) ?? {
			count: 0,
			wins: 0,
			shareSum: 0,
			shareCount: 0,
			slots: [0, 0, 0] as [number, number, number],
		};
		e.count += r.count;
		e.wins += r.wins;
		if (r.avg_share != null && r.share_samples > 0) {
			e.shareSum += r.avg_share * r.share_samples;
			e.shareCount += r.share_samples;
		}
		for (let i = 0; i < 3; i++) e.slots[i] += r.slot_counts[i] ?? 0;
		byClass.set(r.class, e);
	}
	const rows = [...byClass.entries()]
		.map(([cls, e]) => ({
			class: cls,
			pickRate: games > 0 ? e.count / games : 0,
			count: e.count,
			wins: e.wins,
			avgShare: e.shareCount > 0 ? e.shareSum / e.shareCount : null,
			slots: e.slots,
		}))
		// Ascending so the most-picked class sits at the top (ECharts stacks a
		// category axis bottom-up).
		.sort((a, b) => a.count - b.count);
	const classes = rows.map((r) => r.class);
	const pct = (v: number) => `${Math.round(v * 100)}%`;
	return {
		...CHART_THEME,
		title: {
			...CHART_THEME.title,
			text: `${nationLabel(nation)} families`,
		},
		tooltip: {
			trigger: "axis",
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const r = rows[p.dataIndex];
				if (!r) return "";
				const lines = [
					`${fmtClass(r.class)}`,
					`Picked in ${r.count} games (${pct(r.pickRate)} of this nation's)`,
					`Wins: ${r.wins} / ${r.count} (${pct(r.count > 0 ? r.wins / r.count : 0)})`,
				];
				if (r.avgShare != null) {
					lines.push(`Avg share of cities: ${pct(r.avgShare)}`);
				}
				// Founding order — which of the player's three families this was,
				// by the turn its first city landed.
				const slotTotal = r.slots.reduce((a, b) => a + b, 0);
				if (slotTotal > 0) {
					lines.push(
						SLOT_LABELS.map(
							(label, i) => `${label} ${pct(r.slots[i] / slotTotal)}`,
						).join(" · "),
					);
				}
				return lines.join("<br/>");
			},
		},
		// Room on the right for the city-share label.
		grid: { ...COMMON_GRID, left: 140, right: 120, top: 64 },
		xAxis: { type: "value" },
		yAxis: {
			type: "category",
			data: classes,
			axisLabel: crestAxisLabel(classes, classCrestUrl, fmtClass, 132, 20, 14),
		},
		series: outcomeSeries({
			wins: rows.map((r) => r.wins),
			losses: rows.map((r) => r.count - r.wins),
			// How much of the empire this class ran, at the end of its bar. The
			// founding-order split is in the tooltip — three percentages would
			// crowd the axis.
			label: {
				formatter: (p: { dataIndex: number }) => {
					const r = rows[p.dataIndex];
					if (!r || r.avgShare == null) return "";
					return `${pct(r.avgShare)} of cities`;
				},
			},
		}),
	};
}

// Which family class ran the capital, as a stacked wins/losses bar: length is
// how often that class held the capital, the split how those games ended. The
// same encoding as the nation win-rate bar, and the same reason — one bar
// answers both "how often" and "how well".
//
// Nation-agnostic on purpose: a family class means the same thing whichever
// nation fields it, and splitting by nation here would shred the sample.
// Typed against ChartBundleCore (only reads capitalFamilyWinRate) so it renders
// unchanged at tournament scope.
export function capitalFamilyWinLossOption(
	bundle: ChartBundleCore,
): ChartOption {
	// Ascending so the most common capital family sits at the top (ECharts
	// stacks a category axis bottom-up).
	const rows = [...bundle.capitalFamilyWinRate].sort(
		(a, b) => a.games - b.games,
	);
	const classes = rows.map((r) => r.family_class);
	return {
		...CHART_THEME,
		// Titled in-chart like the per-nation bars beside it, so the two charts
		// in the Families panel are self-describing.
		title: { ...CHART_THEME.title, text: "Capital family" },
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = rows[p.dataIndex];
				if (!row) return "";
				return `${fmtClass(row.family_class)} capital<br/>Wins: ${row.wins} / ${row.games}<br/>Rate: ${Math.round(row.rate * 100)}%`;
			},
		},
		grid: { ...COMMON_GRID, left: 150 },
		xAxis: { type: "value" },
		yAxis: {
			type: "category",
			data: classes,
			axisLabel: crestAxisLabel(classes, classCrestUrl, fmtClass, 142, 20, 14),
		},
		series: outcomeSeries({
			wins: rows.map((r) => r.wins),
			losses: rows.map((r) => r.games - r.wins),
		}),
	};
}
