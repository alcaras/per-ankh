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

// One empty state per chart, each naming the domain its panel is short of and
// referenced from the registry spec and the tournament page rather than
// retyped at each. The two charts read from separate summary columns
// (starting_ruler_archetype, starting_ruler_traits) and go empty independently.
export const ARCHETYPE_EMPTY_MESSAGE = "No leader archetype data available.";
export const TRAIT_EMPTY_MESSAGE = "No leader trait data available.";

function archetypeIconUrl(archetype: string): string | undefined {
	return SPRITE_MANIFEST[`traits/${archetypeSpriteKey(archetype)}`];
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
		// No icon resolver — these are name-only rows. `trait.xml` is the
		// authority through zIconName, and only 28 of its 306 records declare
		// art: the ten bArchetype archetypes (each pointing at the bare id,
		// which is what archetypeSpriteKey reproduces), seventeen
		// TRAIT_CLERGY_* pointing into the `religions` sprite category, and
		// TRAIT_PRESET_ARCHETYPE. The sprite manifest is not the authority
		// here — its `traits` category is baked from the art folder, so it also
		// carries HUD icons that aren't trait records at all (TRAIT_STRENGTH,
		// TRAIT_WEAKNESS: a trait's classification is bStrength/bWeakness on
		// the record) plus one DLC connection trait. None of those is a trait a
		// leader can start with, so a `traits/<trait>` lookup can only miss.
		//
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
