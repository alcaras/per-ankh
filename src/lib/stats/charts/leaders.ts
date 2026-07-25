// Leaders tab option builders — how a starting leader's roll fared.
//
// Old World rolls each player's starting leader: one archetype and the
// personality traits they begin with. Both bars are the shared wins/losses
// stack, so bar length reads as the distribution ("how often did this come
// up") and the split as the outcome ("how often did it win").

import type { ChartOption } from "$lib/echarts";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import { archetypeSpriteKey, formatArchetype } from "$lib/utils/formatting";
import type { ChartBundleCore } from "../types";
import { fmtTrait, winLossStackedOption } from "./helpers";

// Both leader charts share an empty state: they're empty for the same reason,
// and the copy is referenced from the registry specs and the tournament page
// rather than retyped at each.
export const LEADER_EMPTY_MESSAGE =
	"No leader data in these saves yet — they were parsed before characters were captured.";

function archetypeIconUrl(archetype: string): string | undefined {
	return SPRITE_MANIFEST[`traits/${archetypeSpriteKey(archetype)}`];
}

// Art ships for the archetypes and a couple of the plain traits (Strength,
// Weakness); crestAxisLabel falls back to a name-only label per value, so a
// resolver that misses most traits still lights up the ones that have one.
function traitIconUrl(trait: string): string | undefined {
	return SPRITE_MANIFEST[`traits/${trait}`];
}

// The ten archetypes are a fixed, small set, so every one that appears fits on
// one chart. Typed against ChartBundleCore — it renders identically for a user
// library and a tournament corpus.
export function startingArchetypeWinLossOption(
	bundle: ChartBundleCore,
): ChartOption {
	return winLossStackedOption({
		rows: bundle.startingArchetypeWinRate.map((r) => ({
			key: r.archetype,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		})),
		label: formatArchetype,
		iconUrl: archetypeIconUrl,
	});
}

// Starting traits have a long tail (~40 across a large corpus, most of them
// one-offs), so the chart keeps the traits with the most games behind them —
// the same cap the tech and law charts use to stay readable.
const MAX_TRAIT_ROWS = 15;

export function startingTraitWinLossOption(
	bundle: ChartBundleCore,
): ChartOption {
	const rows = [...bundle.startingTraitWinRate]
		.sort((a, b) => b.games - a.games)
		.slice(0, MAX_TRAIT_ROWS)
		.map((r) => ({
			key: r.trait,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		}));
	return winLossStackedOption({
		rows,
		label: fmtTrait,
		iconUrl: traitIconUrl,
		// Trait names run longer than nation names ("Compassionate"), so the
		// labels get more room than the shared default.
		labelWidth: 160,
	});
}

// Rows the trait chart actually draws — the registry sizes the container off
// the same cap, so the chart never scrolls past its box.
export function visibleTraitRowCount(bundle: ChartBundleCore): number {
	return Math.min(bundle.startingTraitWinRate.length, MAX_TRAIT_ROWS);
}
