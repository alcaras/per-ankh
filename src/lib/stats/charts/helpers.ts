// Shared helpers for the stats chart option builders. Reuses the
// existing chart-theme constants from $lib/config.

import type { ChartOption } from "$lib/echarts";
import { CHART_THEME } from "$lib/config";
import { YIELD_COLORS } from "$lib/generated/yield-colors";
import { formatEnum, nationName } from "$lib/utils/formatting";

// Strip leaderless enum prefix for axis labels. The stats SQL returns
// raw values (NATION_PERSIA, TRAIT_INTELLIGENT, etc.); the chart axes
// need humanized text.

// Nations are the exception: two of them aren't their token (NATION_HITTITE is
// Hatti, NATION_TAMIL is Tamilakam), so axis labels take the shared helper.
export function fmtNation(value: string): string {
	return nationName(value);
}
export function fmtTrait(value: string): string {
	return formatEnum(value, "TRAIT_");
}
export function fmtClass(value: string): string {
	// Stored values are FAMILYCLASS_* (e.g. FAMILYCLASS_CHAMPIONS).
	return formatEnum(value, "FAMILYCLASS_");
}
export function fmtTech(value: string): string {
	return formatEnum(value, "TECH_");
}
export function fmtLaw(value: string): string {
	return formatEnum(value, "LAW_");
}

// Win/loss series colors — Old World's own Happiness and Discontent.
//
// The game defines these two as a single opposed mechanic, not as two
// unrelated yields: "When a City's Happiness bar empties, its overall
// Discontent Level goes up by one" (text-yield.xml, TEXT_YIELD_DISCONTENT_HELP).
// So the pair already carries a went-well / went-badly reading in the game's
// own vocabulary, which is exactly what a wins-vs-losses split needs — the
// same argument the yield colors themselves rest on, applied to a pair rather
// than to one series.
//
// This also retires the worst contrast in the chart layer. The old loss tone
// (#5a4d3f) sat at 2.10:1 on the chart ground, below every floor the yield
// bake enforces; Discontent is 5.53:1. Separation improves with it: 0.241 →
// 0.264 in OKLab, and 0.274 under deuteranopic simulation — better under
// red-green color blindness than the copper/brown pair was under normal
// vision, and with none of the green/red hazard the game's own
// COLOR_POSITIVE / COLOR_NEGATIVE would have brought.
//
// Shared by every chart that splits a series by outcome (the nation win-rate
// bar, the leader and family bars, the yields winner/loser split) so the two
// cohorts mean the same thing everywhere. The tournament standings bar
// deliberately colors per-player instead, so it doesn't use these.
export const WIN_COLOR = YIELD_COLORS.YIELD_HAPPINESS;
export const LOSS_COLOR = YIELD_COLORS.YIELD_DISCONTENT;

// Fills for a chart that buckets an outcome three ways rather than splitting it
// two (the wonders bars). The outer two are the same Happiness / Discontent
// pair the two-way split uses, so "mostly won" and "mostly lost" read the same
// on the wonders chart as everywhere else; Legitimacy sits between them as the
// neutral, being the yield with no directional charge of its own.
//
// The neutral was chosen on separation, not on taste. Against Happiness and
// Discontent, Legitimacy holds a worst-pair distance of 0.140 in OKLab and
// 0.142 deuteranopic — matching the blue/copper/rose triple this replaces
// (0.150 / 0.138) rather than spending its separation to join the palette.
// Culture is the trap here: it looks like the obvious neutral and collapses
// against Discontent at 0.009 deuteranopic, one color for two buckets.
export const OUTCOME_WON = YIELD_COLORS.YIELD_HAPPINESS;
export const OUTCOME_MIXED = YIELD_COLORS.YIELD_LEGITIMACY;
export const OUTCOME_LOST = YIELD_COLORS.YIELD_DISCONTENT;

// The app's body-text tan (--color-tan, what `text-tan` renders), spelled as a
// literal because ECharts options can't read a CSS variable.
export const TEXT_TAN = "#D2B48C";

// Sentinel selector value for the cross-nation aggregate ("All nations")
// option shared by the nation-selector panels (Families, Opening laws). Not a
// real NATION_* enum, so it never collides with one.
export const ALL_NATIONS = "__all__";
export function nationLabel(value: string): string {
	return value === ALL_NATIONS ? "All nations" : fmtNation(value);
}

// Common option fragments. Each chart starts from CHART_THEME and
// overrides as needed; small helpers cut repetition for the most
// common patterns.
export const COMMON_GRID = { left: 60, right: 30, top: 40, bottom: 60 };

// Container height for a horizontal bar chart: ~34px per row so the
// icon-bearing axis labels (crests, avatars) have breathing room, plus
// padding for the grid margins. Shared by the registry specs and the
// tournament stats charts so the same chart sizes identically everywhere.
export function barChartHeight(rowCount: number): string {
	return `${Math.max(rowCount, 1) * 34 + 90}px`;
}

// Axis-title placement, mirroring the game-detail charts: the title sits
// centered along the axis (x below it, y reading vertically beside it)
// rather than ECharts' default corner placement. Spread alongside `name`.
export const AXIS_NAME_X = { nameLocation: "middle", nameGap: 30 } as const;
export const AXIS_NAME_Y = { nameLocation: "middle", nameGap: 40 } as const;

// Left-aligned category axisLabel that renders each value as its crest icon
// followed by its display name (name only when there's no crest). Spread
// into a category axis's `axisLabel`; the axis `data` must be the raw values
// (not pre-formatted). `crestUrl` maps a raw value to its sprite URL;
// `margin` left-aligns the labels at the grid's left edge (set ≈ grid.left).
// Shared by the nations and families charts.
export function crestAxisLabel(
	values: string[],
	crestUrl: (value: string) => string | undefined,
	name: (value: string) => string,
	margin: number,
	size = 16,
	fontSize?: number,
) {
	const key = (v: string) => v.replace(/^[A-Z]+_/, "").toLowerCase();
	const rich: Record<string, object> = {};
	for (const v of values) {
		const url = crestUrl(v);
		if (url)
			rich[key(v)] = {
				height: size,
				width: size,
				backgroundColor: { image: url },
			};
	}
	return {
		interval: 0,
		align: "left" as const,
		margin,
		// `fontSize` styles the name text (the rich `{crest|}` tag only sizes the
		// icon); color comes from the chart theme's white axis-label default.
		...(fontSize != null ? { fontSize } : {}),
		formatter: (value: string) =>
			crestUrl(value) ? `{${key(value)}|} ${name(value)}` : name(value),
		rich,
	};
}

// One category's outcome tally for a win/loss bar. `rate` is the server's
// own wins/games — passed through rather than recomputed here, so the value
// the tooltip shows is the one the aggregator guarded against a zero
// denominator.
export interface WinLossRow {
	key: string;
	games: number;
	wins: number;
	rate: number;
}

// Horizontal stacked wins/losses bar: bar length = games played, the split
// shows the rate. Sorted by games ascending so the busiest category sits at
// the top (ECharts stacks a category axis bottom-up). One builder behind every
// outcome bar in the catalog — nations, leader archetypes, starting traits,
// family classes — so they stay identical by construction rather than by copy.
//
// Generic over the row so a caller can hang its own fields off `WinLossRow`
// (pick rate, city share, founding-order slots) and read them back in
// `tooltipFormatter` / `barLabel`. Those callbacks receive the *sorted* row
// rather than an index, so a caller can't mis-index against the pre-sort order.
export function winLossStackedOption<R extends WinLossRow>(opts: {
	rows: R[];
	// Display name for a row key (fmtNation, fmtTrait, …).
	label: (value: string) => string;
	// Sprite for a row key, when the category has icon art (nation crests,
	// archetype glyphs). Omit for text-only labels.
	iconUrl?: (value: string) => string | undefined;
	// Room reserved for the axis labels; widen for long names.
	labelWidth?: number;
	// In-chart ECharts title, for the panels that stack several of these with
	// no HTML heading of their own (Families). The registry-driven charts leave
	// it off — StatsView titles those from the spec.
	title?: string;
	// Replaces the default name / wins / rate tooltip body, for a category with
	// more to say than the outcome split.
	tooltipFormatter?: (row: R) => string;
	// Per-row annotation hung off the end of the bar.
	barLabel?: (row: R) => string;
}): ChartOption {
	const {
		rows,
		label,
		iconUrl,
		labelWidth = 140,
		title,
		tooltipFormatter,
		barLabel,
	} = opts;
	const sorted = [...rows].sort((a, b) => a.games - b.games);
	const keys = sorted.map((r) => r.key);
	return {
		...CHART_THEME,
		...(title ? { title: { ...CHART_THEME.title, text: title } } : {}),
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
			formatter: (params: unknown) => {
				const p = (params as { dataIndex: number }[])[0];
				const row = sorted[p.dataIndex];
				if (!row) return "";
				if (tooltipFormatter) return tooltipFormatter(row);
				return `${label(row.key)}<br/>Wins: ${row.wins} / ${row.games}<br/>Rate: ${Math.round(row.rate * 100)}%`;
			},
		},
		grid: {
			...COMMON_GRID,
			left: labelWidth,
			// A title needs headroom (the same 64 the titled charts elsewhere
			// use), a bar label needs room past the end of the longest bar.
			...(title ? { top: 64 } : {}),
			...(barLabel ? { right: 120 } : {}),
		},
		xAxis: { type: "value" },
		yAxis: {
			type: "category",
			data: keys,
			// Larger icon + name (white from the theme) for the headline charts;
			// an icon-less category renders the name alone at the same inset, so
			// both variants align to the grid edge identically.
			axisLabel: iconUrl
				? crestAxisLabel(keys, iconUrl, label, labelWidth - 8, 20, 14)
				: {
						interval: 0,
						align: "left" as const,
						margin: labelWidth - 8,
						fontSize: 14,
						formatter: label,
					},
		},
		series: [
			{
				name: "Wins",
				type: "bar",
				stack: "outcome",
				data: sorted.map((r) => r.wins),
				itemStyle: { color: WIN_COLOR },
			},
			{
				name: "Losses",
				type: "bar",
				stack: "outcome",
				data: sorted.map((r) => r.games - r.wins),
				itemStyle: { color: LOSS_COLOR },
				// Hung off the loss segment so it lands past the end of the whole
				// bar, whatever the split.
				...(barLabel
					? {
							label: {
								show: true,
								position: "right" as const,
								color: CHART_THEME.textStyle.color,
								fontSize: 11,
								formatter: (p: { dataIndex: number }) => {
									const row = sorted[p.dataIndex];
									return row ? barLabel(row) : "";
								},
							},
						}
					: {}),
			},
		],
	};
}

export { CHART_THEME };
