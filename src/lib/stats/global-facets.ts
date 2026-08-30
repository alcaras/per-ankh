// The /stats selection vocabulary, client side: the composition slice and the
// nation facet that together name one global corpus.
//
// The Worker parses both params forgivingly (games-scope.ts — parseSliceParam,
// parseNationParam): a stale bookmark, a hand-edited URL, or a slice this
// version no longer has degrades to a neighbouring view rather than 400ing.
// The page has to land on the same answer the Worker did, or the facet
// controls would light a selection the payload isn't for — so the parse is
// mirrored here, the way profileScope mirrors parseScopeParam.

import { NATION_COLORS } from "$lib/config";
import { nationName } from "$lib/utils/formatting";
import type { GlobalSlice } from "./types";

// How each slice names itself. A total map rather than a lookup with a
// fallback, so adding a slice to GlobalSlice is a type error here until it
// has a label.
const GLOBAL_SLICE_LABELS: Readonly<Record<GlobalSlice, string>> = {
	all: "All public games",
	duel: "Multiplayer duels",
	ffa: "Multiplayer FFA",
	single_player: "Single-player",
};

// Selector order: the whole corpus first, then the compositions widest-first.
// The three compositions don't partition the corpus — a 2-human game with any
// AI is too few humans for FFA, too many for single-player and too many
// players for a duel — which is why "All public games" is a slice of its own
// rather than the union of the other three.
export const GLOBAL_SLICES: readonly GlobalSlice[] = [
	"all",
	"duel",
	"ffa",
	"single_player",
];

// Mirrors DEFAULT_GLOBAL_SLICE in cloud/src/games-scope.ts. Duels, not "all":
// 94% of the public corpus is 1v1, so the all-public numbers *are* the duel
// numbers, and landing on the label that describes the distribution beats
// landing on a superset whose name implies a breadth it doesn't have.
export const DEFAULT_GLOBAL_SLICE: GlobalSlice = "duel";

export function globalSliceLabel(slice: GlobalSlice): string {
	return GLOBAL_SLICE_LABELS[slice];
}

export function parseGlobalSlice(raw: string | null): GlobalSlice {
	return raw !== null && GLOBAL_SLICES.includes(raw as GlobalSlice)
		? (raw as GlobalSlice)
		: DEFAULT_GLOBAL_SLICE;
}

// The nations the facet offers: the playable roster, read off the same table
// the nation colors come from.
//
// Not the nations seated in the current selection, which is what the user
// page's nation chip reads off its bundle. A faceted bundle reports only the
// nation it was faceted to (the facet narrows the focal seats, so
// `bundle.nations` holds exactly that one), so the option list can't come from
// the payload — and fetching the unfaceted slice alongside it, just for the
// list, would double what the page spends against a budget denominated in one
// read per page load.
//
// A nation with no seat in the selected slice is therefore offerable, and
// selecting it resolves to an empty corpus: the page shows its empty state
// rather than charts. That is the cost of not paying for a second read.
export const NATION_FACET_OPTIONS: readonly string[] = Object.keys(
	NATION_COLORS,
)
	.map((key) => `NATION_${key}`)
	.sort((a, b) => nationName(a).localeCompare(nationName(b)));

// Parse ?nation= into a facet selection. Stricter than the Worker's shape
// check, deliberately: an off-roster token passes its regex and then selects
// no game at all, so honouring one here would leave the control reading "All
// nations" over an empty bundle. Unknown → no facet, the view a bare /stats
// serves.
export function parseNationFacet(raw: string | null): string | null {
	return raw !== null && NATION_FACET_OPTIONS.includes(raw) ? raw : null;
}

// How a selection names itself in prose — the page title and its description.
export function globalSelectionLabel(
	slice: GlobalSlice,
	nation: string | null,
): string {
	const label = globalSliceLabel(slice);
	return nation === null ? label : `${nationName(nation)} · ${label}`;
}
