// Which of a tournament's top-level views a route sits on — the single owner of
// the route-id → view mapping, shared by the tournament layout (header chrome
// and crumbs) and TournamentViewTabs (the sliding pill). Both used to derive
// this separately, each commented "same rule as the other".
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
