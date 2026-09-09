// The home page's three stats panels, cut from the trimmed /v1/home-summary
// payload (the unfaceted `duel` slice — the /stats default, and the great
// majority of the corpus).
//
// Rows, not bars. /stats draws these categories as horizontal bars; here each
// panel is the width of the season standings beside it, where a bar's label
// gutter alone would take most of the panel. So each builder returns rows for
// StatListPanel, and because a list has nowhere to hover, both numbers a bar
// splits between its length and its tooltip are in the row itself.

import type { HomeStatsSummary } from "$lib/api-cloud";
import { familyCrestKey, type SpriteCategory } from "$lib/game-detail/helpers";
import { fmtClass, fmtNation } from "$lib/stats/charts/helpers";
import { archetypeSpriteKey, formatArchetype } from "$lib/utils/formatting";

// One row of a home stats list.
export interface StatListRow {
	// The enum value the row is about — its {#each} key.
	key: string;
	label: string;
	// The row's art, in SpriteIcon's terms rather than as a URL: the sprite
	// helpers the charts use resolve to a URL because ECharts needs one in an
	// axis label, and a component has SpriteIcon.
	icon?: { category: SpriteCategory; value: string };
	// The headline number, at the row's right edge.
	value: string;
	// The supporting number, dimmer and to its left — the one a bar chart would
	// have kept in its tooltip.
	sub: string;
}

// Rows a home stats panel keeps.
const HOME_STAT_ROWS = 7;

const pct = (v: number) => `${Math.round(v * 100)}%`;

// The rank is by GAMES PLAYED, never by rate — for the selection and for the
// order. A rate off a thin sample would outrank a real finding, and the row
// carries its rate anyway for the reader who came for it. The known cost is
// that a high-rate thin-sample category doesn't reach the home page; /stats is
// where the whole distribution lives.
//
// It is also what every panel puts in its headline column, so the three read
// as one board: the games count is the bold number the list is ordered by, and
// the percentage beside it — a share of the slice for nations, a win rate for
// the other two — is the dim one. A panel whose bold column was a rate would be
// a numbered list counting down by something the reader can't see.
function topByGames<R extends { games: number }>(rows: readonly R[]): R[] {
	return [...rows].sort((a, b) => b.games - a.games).slice(0, HOME_STAT_ROWS);
}

// --- Nations --------------------------------------------------------
// The seven most-played nations: how many games each, and the share of the
// slice that is. Derived from nationWinRate rather than from the bundle's
// `nations` field — the two are the same GROUP BY over the same rows, so the
// trimmed payload carries one.
export function homeNationPickRateRows(
	summary: HomeStatsSummary,
): StatListRow[] {
	// The denominator is the whole slice, not the seven rows drawn: a share of
	// the visible rows would climb as the cap tightened, which is a different
	// claim from the one the label makes.
	const total = summary.nationWinRate.reduce((n, r) => n + r.games, 0);
	return topByGames(summary.nationWinRate).map((r) => ({
		key: r.nation,
		label: fmtNation(r.nation),
		icon: { category: "crests", value: r.nation },
		value: `${r.games}`,
		sub: total > 0 ? pct(r.games / total) : "—",
	}));
}

// --- Starting Family ------------------------------------------------
// The family class holding the capital, which is the family a player starts
// under — what the panel's title says, and what capitalFamilyWinRate is.
export function homeCapitalFamilyRows(
	summary: HomeStatsSummary,
): StatListRow[] {
	return topByGames(summary.capitalFamilyWinRate).map((r) => {
		// Family classes wear the ARCHETYPE crest art (FAMILYCLASS_CHAMPIONS →
		// CREST_ARCHETYPE_CHAMPIONS). familyCrestKey spells that mapping for the
		// whole app; a null family here is "no per-family crest to prefer",
		// which is the case for a row that is a class and not a family.
		const crest = familyCrestKey(null, r.family_class);
		return {
			key: r.family_class,
			label: fmtClass(r.family_class),
			...(crest ? { icon: { category: "crests" as const, value: crest } } : {}),
			value: `${r.games}`,
			sub: pct(r.rate),
		};
	});
}

// --- Starting Leader ------------------------------------------------
// Two filters, in order: the Worker's minimum-games floor ships with the data
// (a rate off eleven games is not a finding), then the cap here.
export function homeArchetypeRows(summary: HomeStatsSummary): StatListRow[] {
	return topByGames(summary.startingArchetypeWinRate).map((r) => ({
		key: r.archetype,
		label: formatArchetype(r.archetype),
		icon: { category: "traits", value: archetypeSpriteKey(r.archetype) },
		value: `${r.games}`,
		sub: pct(r.rate),
	}));
}
