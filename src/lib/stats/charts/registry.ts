// Chart registry — declarative source of truth for the catalog.
// Adding a chart means: write its option builder under charts/,
// add a ChartSpec entry here, render via StatsView.
//
// Order within a category drives the visual order in the grid.

import type { ChartSpec, StatsCategory } from "../types";
import { barChartHeight } from "./helpers";
import { LEADER_EMPTY_MESSAGE, visibleTraitRowCount } from "./leaders";

export const CATEGORIES: Array<{ id: StatsCategory; label: string }> = [
	{ id: "yields", label: "Yields" },
	{ id: "nations", label: "Nations" },
	{ id: "leaders", label: "Leaders" },
	{ id: "families", label: "Families" },
	{ id: "laws", label: "Laws" },
	{ id: "cities", label: "Cities" },
	{ id: "tech", label: "Tech" },
];

export const CHART_SPECS: ChartSpec[] = [
	// Nations
	{
		id: "nation-winloss-stacked",
		category: "nations",
		title: "Win rate",
		hasData: (b) => b.nationWinRate.length > 0,
		height: (b) => barChartHeight(b.nationWinRate.length),
	},
	{
		id: "nation-avg-points",
		category: "nations",
		title: "Average final points",
		hasData: (b) => b.nationAvgPoints.length > 0,
		height: (b) => barChartHeight(b.nationAvgPoints.length),
	},
	// Leaders — the starting leader's roll: their archetype, and the traits
	// they began the game with. Both bars carry games (length) and wins
	// (split), so each answers distribution and outcome at once.
	{
		id: "starting-archetype-winloss",
		category: "leaders",
		title: "Starting archetype",
		subtitle: "Games played, split by outcome",
		hasData: (b) => b.startingArchetypeWinRate.length > 0,
		emptyMessage: () => LEADER_EMPTY_MESSAGE,
		height: (b) =>
			barChartHeight(b.startingArchetypeWinRate.length, { subtitle: true }),
	},
	{
		id: "starting-trait-winloss",
		category: "leaders",
		title: "Starting leader traits",
		subtitle: "Games played, split by outcome",
		hasData: (b) => b.startingTraitWinRate.length > 0,
		emptyMessage: () => LEADER_EMPTY_MESSAGE,
		height: (b) => barChartHeight(visibleTraitRowCount(b), { subtitle: true }),
	},
	// Families — category anchor only; rendered by FamilyStatsPanel
	// (per-nation pick/win bars), not the generic spec loop.
	{
		id: "families",
		category: "families",
		title: "Families",
		hasData: (b) => b.familyByNation.length > 0,
	},
	// Yields — category anchor only. The Yields tab is rendered by
	// YieldsStatsPanel (one chart per series), not the generic spec loop,
	// so this entry exists solely to surface the subtab.
	{
		id: "yields",
		category: "yields",
		title: "Yields",
		hasData: (b) => b.yieldCurves.turns.length > 0,
	},
	// Laws — category anchor only; rendered by LawsStatsPanel (one nation
	// selector driving both the law-adoption and opening-sequence charts).
	{
		id: "laws",
		category: "laws",
		title: "Laws",
		hasData: (b) => b.lawTiming.length > 0 || b.openingLaws.length > 0,
	},
	// Cities
	{
		id: "city-expansion-winrate",
		category: "cities",
		title: "Win rate by expansion speed",
		hasData: (b) => b.expansionWinRate.length > 0,
	},
	// Tech — category anchor only; rendered by TechStatsPanel (nation selector
	// driving both the first-tech and tech-timing charts), not the spec loop.
	{
		id: "tech",
		category: "tech",
		title: "Tech",
		hasData: (b) => b.techTiming.length > 0 || b.techFirst.length > 0,
	},
];
