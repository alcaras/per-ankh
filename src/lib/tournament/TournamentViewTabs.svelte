<script lang="ts">
	// The tournament's top-level views as a segmented tab group (Overview, Matches,
	// Stats, and — when a playlist is configured — Videos). Lives in the centre of
	// the tournament header — between the title and the action cluster — on every
	// tournament view surface, so "which view am I on" reads at a glance. These are
	// cross-route links (not a bits-ui Tabs panel); the active tab is matched on
	// the *exact* route id, not a pathname prefix, so Overview
	// ("/tournaments/[slug]") doesn't also light up on its /matches and /stats
	// pages — and so the pill lands on the right tab in the SSR'd first paint
	// instead of sliding into place on hydration (see views.ts).
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import type { ResolvedPathname } from "$app/types";
	import type { TournamentDetail } from "$lib/api-cloud";
	import {
		TOURNAMENT_VIEW_LABELS,
		tournamentView,
		type TournamentView,
	} from "./views";

	let { tournament }: { tournament: TournamentDetail } = $props();

	// Each tab is just its view plus the href to reach it; the label comes from
	// views.ts, which the crumb leaves read too.
	const navTabs: {
		view: TournamentView;
		href: ResolvedPathname;
	}[] = $derived([
		{
			view: "overview",
			href: resolve("/tournaments/[slug]", { slug: tournament.slug }),
		},
		{
			view: "matches",
			href: resolve("/tournaments/[slug]/matches", { slug: tournament.slug }),
		},
		{
			view: "stats",
			href: resolve("/tournaments/[slug]/stats", { slug: tournament.slug }),
		},
		// Videos appears only once an admin has set a playlist — otherwise the tab
		// (and its route) would be empty for the vast majority of tournaments. The
		// grid/pill geometry below is driven by navTabs.length, so the control
		// stays correct whether there are three tabs or four.
		...(tournament.youtube_playlist_url
			? [
					{
						// `as const` only here: the annotation on navTabs above
						// contextually types that array's own elements, but does not
						// reach through this conditional spread.
						view: "videos" as const,
						href: resolve("/tournaments/[slug]/videos", {
							slug: tournament.slug,
						}),
					},
				]
			: []),
	]);

	// Which tab the current route sits on, driving the sliding pill's position.
	// -1 (no match) parks the pill hidden — defensive only: this control renders
	// solely on the tournament view routes, so exactly one tab is normally active.
	const activeView = $derived(tournamentView(page.route.id));
	const activeIndex = $derived(
		navTabs.findIndex((tab) => tab.view === activeView),
	);
</script>

<!-- Segmented control matching the matches page's view toggle: an equal-column
     grid with a raised-surface pill that slides under the active tab. Kept as
     cross-route links (not buttons) — nav semantics, so aria-current, not
     aria-pressed. Text stays tan; the pill is the sole active indicator. -->
<nav
	class="relative grid overflow-hidden rounded-lg border-2 border-surface"
	style="background-color: rgb(var(--color-surface));"
	style:grid-template-columns={`repeat(${navTabs.length}, minmax(0, 1fr))`}
	aria-label="Tournament views"
>
	<div
		class="pointer-events-none absolute inset-y-0 left-0 transition-transform duration-200 ease-out"
		style:width={`${100 / navTabs.length}%`}
		style:background-color="rgb(var(--color-surface-raised))"
		style:opacity={activeIndex < 0 ? "0" : "1"}
		style:transform={`translateX(${(activeIndex < 0 ? 0 : activeIndex) * 100}%)`}
	></div>
	<!-- eslint-disable svelte/no-navigation-without-resolve -- tab.href is a resolve() result; not traceable through the array -->
	{#each navTabs as tab, i (tab.href)}
		<a
			href={tab.href}
			aria-current={i === activeIndex ? "page" : undefined}
			class="relative z-10 px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors"
		>
			{TOURNAMENT_VIEW_LABELS[tab.view]}
		</a>
	{/each}
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</nav>
