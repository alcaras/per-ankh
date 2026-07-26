// Wonders tab option builder.
//
// One row per wonder on a turn axis: the P25–P75 span of when it gets built
// with the median marked, so the chart reads as a timeline of the game — early
// wonders at short turns, late ones stretching right.
//
// The builders' outcome rides on that timeline twice over: the median marker
// is colored by it in three buckets (rather than a gradient — samples per
// wonder are small, and a bucket is honest about that), and the trailing label
// spells out the rate with its sample. How often a wonder was passed over —
// built vs the players who could have built it: it was enabled in their game,
// they had a city at its culture level, and no AI had already taken it — is in
// the tooltip.

import type { ChartOption } from "$lib/echarts";
import { IMPROVEMENT_NAMES } from "$lib/generated/improvement-names";
import { IMPROVEMENT_ICON } from "$lib/generated/science-yields";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import { CULTURE_LEVELS } from "$lib/generated/wonders";
import { formatEnum } from "$lib/utils/formatting";
import type { ChartBundleCore } from "../types";
import {
	AXIS_NAME_X,
	CHART_THEME,
	COMMON_GRID,
	LOSS_COLOR,
	MARKER_OUTLINE,
	MIXED_COLOR,
	WIN_COLOR,
	crestAxisLabel,
} from "./helpers";

// One empty state, referenced from the registry spec and the tournament page
// rather than retyped at each — they're empty for the same reason. This fires
// only when nothing at all is indexed: a save that predates the wonder tables
// but has a wonder in it still produces rows, so "these saves are too old"
// would be the wrong story to tell here.
export const WONDER_EMPTY_MESSAGE = "No wonder data available.";

// Wonders are improvements, so both the real in-game name ("The Pyramids", not
// "Pyramids") and the icon come from the improvement tables. Local, like
// tech.ts's techLabel: charts/helpers.ts holds the bare enum-strip helpers,
// name-table lookups stay with the tab that needs them.
function fmtWonder(value: string): string {
	return IMPROVEMENT_NAMES[value] ?? formatEnum(value, "IMPROVEMENT_");
}

// Some wonders render another entry's art (zIconName — The Acropolis draws the
// Parthenon, the Via Recta Souk the Grand Bazaar), which the baked alias map
// resolves; the same indirection the improvements table and map tooltip use.
function wonderIconUrl(wonder: string): string | undefined {
	const icon = IMPROVEMENT_ICON[wonder] ?? wonder;
	return SPRITE_MANIFEST[`improvements/${icon}`];
}

// Old World's own noun for the gate: the four Culture Levels a city passes
// through (Weak → Developing → Strong → Legendary).
function tierLabel(culturePrereq: string): string {
	return formatEnum(culturePrereq, "CULTURE_");
}

// Row order: culture level (the tier the game unlocks them at), then how often
// they're built, then name. ECharts stacks a category axis bottom-up, so every
// comparison runs backwards from how it reads — the earliest tier, and the
// most-built wonder within it, end up at the top.
function orderRows(rows: ChartBundleCore["wonderStats"]) {
	return [...rows].sort((a, b) => {
		const tier =
			CULTURE_LEVELS.indexOf(b.culture_prereq ?? "") -
			CULTURE_LEVELS.indexOf(a.culture_prereq ?? "");
		if (tier !== 0) return tier;
		if (a.built !== b.built) return a.built - b.built;
		return fmtWonder(b.wonder).localeCompare(fmtWonder(a.wonder));
	});
}

const pct = (v: number) => Math.round(v * 100);

// Outcome buckets for the median marker. A wonder's builders are few, so the
// read is "did building this tend to go with winning", not a precise rate —
// three buckets say that honestly where a gradient would imply precision.
// Shape carries the split as well as color: solid copper for won, solid muted
// for mixed, hollow for lost. Two dark fills on a dark span would be a color
// difference only, and a faint one at marker size.
const OUTCOME_BUCKETS = [
	{
		name: "Builders mostly won",
		min: 0.6,
		itemStyle: { color: WIN_COLOR },
	},
	{
		name: "Mixed",
		min: 0.4,
		itemStyle: { color: MIXED_COLOR },
	},
	{
		name: "Builders mostly lost",
		min: 0,
		itemStyle: {
			color: LOSS_COLOR,
			borderColor: MARKER_OUTLINE,
			borderWidth: 2,
		},
	},
] as const;

// Turn-axis tick spacing. Set explicitly rather than left to splitNumber: the
// axis max is rounded to it, and ECharts' own choice of interval doesn't have
// to divide that max — 0–120 by its default lands on 25s, which would put a
// tick at 100 and the boundary at 120 right back on top of each other.
const TICK_INTERVAL = 20;

function bucketIndex(winRate: number): number {
	return OUTCOME_BUCKETS.findIndex((b) => winRate >= b.min);
}

export function wonderOverviewOption(bundle: ChartBundleCore): ChartOption {
	const rows = orderRows(bundle.wonderStats);
	const wonders = rows.map((r) => r.wonder);
	const built = rows.filter((r) => r.built > 0);
	// Axis extent runs past the latest P75 to the next tick; the trailing labels
	// sit outside the grid (grid.right) rather than needing headroom inside it.
	// Rounded to TICK_INTERVAL because ECharts always draws a boundary tick at an
	// explicit max: any other value plants a stray gridline and label a few turns
	// after the last regular one.
	const maxTurn = Math.max(...built.map((r) => r.p75_turn ?? 0), 10);
	const axisMax = Math.ceil(maxTurn / TICK_INTERVAL) * TICK_INTERVAL;

	return {
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = rows[p.dataIndex];
				if (!row) return "";
				// Three states, not two. A wonder no pool-carrying save accounted
				// for has no denominator at all — a different claim from a zero
				// one, and stating "available to nobody" directly above this
				// wonder's own build turns is how the tooltip ends up arguing
				// with itself. Zero is the leftover case: a build got indexed but
				// no player's recorded culture reached the prereq, so say that
				// much and no more.
				const facts: string[] = [];
				// A wonder the baked prereq table doesn't carry — a mod, or new
				// content since the last bake — has no level to name. Drop the
				// line rather than stand a dash in for the noun.
				if (row.culture_prereq) {
					facts.push(`Needs ${tierLabel(row.culture_prereq)} Culture`);
				}
				facts.push(
					row.eligible === null
						? "No record of which games offered it"
						: row.eligible === 0
							? "No eligible players recorded"
							: `Built in ${row.built} of ${row.eligible} matches (${pct(row.rate ?? 0)}%)`,
				);
				if (row.built > 0) {
					facts.push(
						`Median turn ${Math.round(row.median_turn ?? 0)} (P25–P75: ${Math.round(row.p25_turn ?? 0)}–${Math.round(row.p75_turn ?? 0)})`,
						`Builders won ${row.wins}/${row.built} (${pct(row.win_rate ?? 0)}%)`,
					);
				}
				// Name as the heading, every fact under it as a list item. The
				// margins are inline because ECharts renders the tooltip outside
				// any stylesheet scope — browser defaults would indent the list
				// 40px and space it a full line off the name. (Hex/inline styles
				// inside tooltip HTML are the norm here — see EventRail.)
				const items = facts.map((f) => `<li>${f}</li>`).join("");
				return `<b>${fmtWonder(row.wonder)}</b><ul style="margin:4px 0 0;padding-left:18px">${items}</ul>`;
			},
		},
		legend: {
			show: true,
			top: 0,
			right: 8,
			data: OUTCOME_BUCKETS.map((b) => b.name),
			textStyle: { color: CHART_THEME.textStyle.color },
		},
		grid: { ...COMMON_GRID, left: 190, right: 110, top: 56 },
		xAxis: {
			type: "value",
			name: "Turn built",
			...AXIS_NAME_X,
			min: 0,
			max: axisMax,
			interval: TICK_INTERVAL,
		},
		yAxis: {
			type: "category",
			data: wonders,
			axisLabel: crestAxisLabel(wonders, wonderIconUrl, fmtWonder, 182, 20, 13),
		},
		series: [
			{
				// Transparent riser: the visible span then starts at P25.
				type: "bar",
				stack: "span",
				silent: true,
				data: rows.map((r) => r.p25_turn ?? 0),
				itemStyle: { color: "transparent" },
			},
			{
				// The P25–P75 span itself, with the builders' win rate trailing it.
				type: "bar",
				stack: "span",
				data: rows.map((r) =>
					r.built > 0 ? (r.p75_turn ?? 0) - (r.p25_turn ?? 0) : 0,
				),
				itemStyle: { color: WIN_COLOR, opacity: 0.28 },
				label: {
					show: true,
					position: "right",
					color: CHART_THEME.textStyle.color,
					fontSize: 11,
					// The builders' win rate, with the sample beside it — the marker
					// buckets it, this gives the number. A wonder nobody built has no
					// outcome to report; how often it was passed over is in the tooltip.
					formatter: (p: { dataIndex: number }) => {
						const row = rows[p.dataIndex];
						if (!row || row.built === 0) return "";
						return `${pct(row.win_rate ?? 0)}% won (${row.wins}/${row.built})`;
					},
				},
			},
			// One median series per outcome bucket, so the legend explains the
			// marker colors without a separate visualMap.
			...OUTCOME_BUCKETS.map((bucket, bi) => ({
				name: bucket.name,
				type: "line" as const,
				symbol: "circle",
				symbolSize: 11,
				lineStyle: { opacity: 0 },
				itemStyle: bucket.itemStyle,
				data: rows.map((r, i) =>
					r.built > 0 && bucketIndex(r.win_rate ?? 0) === bi
						? [r.median_turn ?? 0, i]
						: [null, i],
				),
			})),
		],
	};
}
