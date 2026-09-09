// The home page's six stats panels, cut from the trimmed /v1/home-summary
// payload (the unfaceted `duel` slice — the /stats default, and the great
// majority of the corpus).
//
// The chart options themselves are the catalog's: the three outcome bars go
// through winLossStackedOption directly rather than through the /stats wrappers
// around it, because those wrappers read their bundle field whole and home
// needs a slice of it — and adding a cap to a wrapper would shorten the same
// chart on /stats and on every profile.

import { getNationChartColor } from "$lib/config";
import type { HomeStatsSummary } from "$lib/api-cloud";
import type { ChartOption } from "$lib/echarts";
import { expansionWinRateOption } from "$lib/stats/charts/cities";
import { classCrestUrl } from "$lib/stats/charts/families";
import {
	ALL_NATIONS,
	BAR_WIDTH,
	CHART_THEME,
	COMMON_GRID,
	crestAxisLabel,
	fmtClass,
	fmtNation,
	winLossStackedOption,
} from "$lib/stats/charts/helpers";
import { archetypeIconUrl } from "$lib/stats/charts/leaders";
import { nationCrestUrl } from "$lib/stats/charts/nations";
import { techFirstOption } from "$lib/stats/charts/tech";
import { formatArchetype } from "$lib/utils/formatting";

// Rows a home stats panel keeps.
//
// Every one of these charts is half-width (~750px), and a horizontal bar spends
// 140px of that on its label gutter before the first pixel of plot — which is
// also why there is no quarter-width variant of them anywhere on the page.
// Height is what the cap actually buys: barChartHeight is 34px a row, so seven
// rows stand 328px against thirteen nations' 532px, and the four panels of rows
// 2 and 3 line up instead of one column running long.
export const HOME_STAT_ROWS = 7;

// The cap is by GAMES PLAYED, never by rate.
//
// winLossStackedOption draws bar length as games and sorts by games ascending
// itself, so a rate-ranked selection would produce a chart whose selection and
// whose geometry disagree — seven rows chosen for their rates, redrawn in an
// order the reader can see is about something else. The known cost is that a
// high-rate thin-sample category drops off the home view; /stats is where the
// whole distribution lives.
function topByGames<R extends { games: number }>(rows: readonly R[]): R[] {
	return [...rows].sort((a, b) => b.games - a.games).slice(0, HOME_STAT_ROWS);
}

// --- By nation (win rate) -------------------------------------------
// The seven most-played nations, bar length games and the split the outcome —
// the same encoding, colors and sort as the Nations tab's headline bar.
export function homeNationWinRateOption(
	summary: HomeStatsSummary,
): ChartOption {
	return winLossStackedOption({
		rows: topByGames(summary.nationWinRate).map((r) => ({
			key: r.nation,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		})),
		label: fmtNation,
		iconUrl: nationCrestUrl,
	});
}

// --- Games by nation (pick rate) ------------------------------------
// The same seven nations as the win-rate bar beside it, answering the other
// question a reader has about them: how often anyone plays them. Derived from
// nationWinRate rather than from the bundle's `nations` field — the two are
// the same GROUP BY over the same rows, so the trimmed payload carries one.
//
// A row is only ever itself here, so each bar wears its own nation's color (the
// convention nationAvgPointsOption follows) instead of the outcome pair.
export function homeNationPickRateOption(
	summary: HomeStatsSummary,
): ChartOption {
	// The denominator is the whole slice, not the seven rows drawn: a share of
	// the visible rows would climb as the cap tightened, which is a different
	// claim from the one the label makes.
	const total = summary.nationWinRate.reduce((n, r) => n + r.games, 0);
	// Ascending, because ECharts stacks a category axis bottom-up — same
	// orientation as every other bar on the page.
	const rows = topByGames(summary.nationWinRate).sort(
		(a, b) => a.games - b.games,
	);
	const nations = rows.map((r) => r.nation);
	return {
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = rows[p.dataIndex];
				if (!row) return "";
				const share = total > 0 ? Math.round((row.games / total) * 100) : 0;
				return `${fmtNation(row.nation)}<br/>Games: ${row.games}<br/>Pick rate: ${share}%`;
			},
		},
		grid: { ...COMMON_GRID, left: 140 },
		xAxis: { type: "value" },
		yAxis: {
			type: "category",
			data: nations,
			axisLabel: crestAxisLabel(
				nations,
				nationCrestUrl,
				fmtNation,
				132,
				20,
				14,
			),
		},
		series: [
			{
				type: "bar",
				barWidth: BAR_WIDTH,
				data: rows.map((r, i) => ({
					value: r.games,
					itemStyle: { color: getNationChartColor(r.nation, i) },
				})),
			},
		],
	};
}

// --- Expansion speed → win rate -------------------------------------
// Uncapped, and the one panel here that is: its buckets are an ordered scale
// rather than a ranking (the builder fixes the order and drops empty buckets),
// so it already tops out at seven — and a cap would cut "never", a real 31%
// bucket and one of the more interesting numbers on the page.
export function homeExpansionWinRateOption(
	summary: HomeStatsSummary,
): ChartOption {
	return expansionWinRateOption(summary);
}

// --- Capital family class -------------------------------------------
export function homeCapitalFamilyOption(
	summary: HomeStatsSummary,
): ChartOption {
	return winLossStackedOption({
		rows: topByGames(summary.capitalFamilyWinRate).map((r) => ({
			key: r.family_class,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		})),
		label: fmtClass,
		iconUrl: classCrestUrl,
		labelWidth: 150,
	});
}

// --- Starting leader archetype --------------------------------------
// Two filters, in order: the Worker's minimum-games floor ships with the data
// (a rate off eleven games is not a finding), then the cap here.
export function homeArchetypeOption(summary: HomeStatsSummary): ChartOption {
	return winLossStackedOption({
		rows: topByGames(summary.startingArchetypeWinRate).map((r) => ({
			key: r.archetype,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		})),
		label: formatArchetype,
		iconUrl: archetypeIconUrl,
	});
}

// --- First tech -----------------------------------------------------
// The cross-nation aggregate rows only — home has no nation selector, and the
// bundle carries an ALL_NATIONS row per tech so the aggregate needs no
// recombining. No in-chart title: the Panel's heading does that.
export function homeTechFirstOption(summary: HomeStatsSummary): ChartOption {
	return techFirstOption(summary, ALL_NATIONS, {
		limit: HOME_STAT_ROWS,
		title: null,
	});
}

// How many rows each panel actually draws — what its container's height is
// sized from (barChartHeight). Kept beside the builders so a cap change moves
// the chart and its box together, and so a corpus with fewer categories than
// the cap gets a shorter chart rather than empty bands.
export function homeStatRowCounts(summary: HomeStatsSummary): {
	nationWinRate: number;
	nationPickRate: number;
	expansion: number;
	capitalFamily: number;
	archetype: number;
	techFirst: number;
} {
	const capped = (n: number) => Math.min(n, HOME_STAT_ROWS);
	const nations = capped(summary.nationWinRate.length);
	return {
		nationWinRate: nations,
		nationPickRate: nations,
		// The builder drops empty buckets, so the rows drawn are the buckets
		// with games in them.
		expansion: summary.expansionWinRate.filter((b) => b.games > 0).length,
		capitalFamily: capped(summary.capitalFamilyWinRate.length),
		archetype: capped(summary.startingArchetypeWinRate.length),
		techFirst: capped(
			summary.techFirst.filter((r) => r.nation === ALL_NATIONS).length,
		),
	};
}
