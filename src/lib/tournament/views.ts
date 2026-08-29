// Which of a tournament's top-level views a route sits on, and what that view is
// called — the single owner of the route-id → view → label mapping, shared by the
// tournament layout (header chrome and crumbs) and TournamentViewTabs (the
// sliding pill). Both used to derive the view separately, each commented "same
// rule as the other", and both spelled the labels out again on their own.
//
// Matched on `page.route.id`, NOT on `page.url.pathname`. `resolve()` returns
// `base + path`, and during SSR `base` is RELATIVE to the page being rendered
// (SvelteKit's `paths.relative` default) — so `/tournaments/x/matches` was being
// compared against `../../tournaments/x/matches` and every view flag came out
// false on the server. That dropped all the gated header chrome from the first
// paint — both clock toggles, the status chip, the signed-up popover, and the
// crumb leaf — and reflowed the header when hydration flipped the flags true.
// Route ids are the same string on both sides, and they're checked against the
// generated RouteId union, so a renamed or deleted route fails svelte-check
// exactly as a bad `resolve()` argument does. `resolve()` stays the right tool
// for the tabs' hrefs, where a relative path is a feature.
import type { RouteId } from "$app/types";

export type TournamentView = "overview" | "matches" | "stats" | "videos";

/**
 * The tournament view a route id names, or null off the tournament views (the
 * pill parks hidden and the layout's flags all read false, as before).
 */
export function tournamentView(routeId: RouteId | null): TournamentView | null {
	switch (routeId) {
		case "/tournaments/[slug]":
			return "overview";
		case "/tournaments/[slug]/matches":
			return "matches";
		case "/tournaments/[slug]/stats":
			return "stats";
		case "/tournaments/[slug]/videos":
			return "videos";
		default:
			return null;
	}
}

// What each view is called wherever it's named in navigation: the tabs' pill on
// every view, and — for the three that sit under Overview — the crumb leaf.
// Overview reads its label here too even though its crumb is the tournament's
// own name, so renaming a view stays one edit.
const VIEW_LABELS: Record<TournamentView, string> = {
	overview: "Overview",
	matches: "Matches",
	stats: "Stats",
	videos: "Videos",
};

/** The navigation label for a view. */
export function tournamentViewLabel(view: TournamentView): string {
	return VIEW_LABELS[view];
}
