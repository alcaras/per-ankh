<script lang="ts">
	// The home hero's left tile: the current major tournament, live.
	//
	// The banner was the whole panel until now, with the event's name baked into
	// the still (the animation's opening title card) and the image re-cut every
	// season. The art is the tile's backdrop instead, and the event's name is the
	// panel's own heading, so a new event needs no new art — and the still gives
	// up the height the two insets need by sitting behind them rather than above
	// them.
	//
	// The insets answer the two questions a visitor has about a running event:
	// who is winning, and when is the next game. Both are read-only previews —
	// nothing in them is separately clickable, which is what lets the whole tile
	// be one link to the tournament.
	import { resolve } from "$app/paths";
	import type {
		StandingsResponse,
		TournamentDetail,
		TournamentMatch,
	} from "$lib/api-cloud";
	import { slotMapsFromStandings } from "$lib/tournament/slot-identity";
	import Panel from "$lib/ui/Panel.svelte";
	import TournamentStandingsInset from "./TournamentStandingsInset.svelte";
	import TournamentUpcomingInset from "./TournamentUpcomingInset.svelte";

	let {
		tournament,
		standings,
		matches,
	}: {
		tournament: TournamentDetail;
		standings: StandingsResponse;
		matches: TournamentMatch[];
	} = $props();

	// Leaders shown in the standings inset. Three, not the top five: the insets
	// are sized to leave the lower half of the tile as picture, and the podium is
	// the part of a standings a glance is actually after.
	const STANDINGS_ROWS = 3;

	const href = $derived(
		resolve("/tournaments/[slug]", { slug: tournament.slug }),
	);

	// combined_qualifier_ranking is present once the tournament is past setup;
	// during setup there is no ranking to show and the inset says so.
	const leaders = $derived(
		(standings.combined_qualifier_ranking ?? []).slice(0, STANDINGS_ROWS),
	);

	// The bracket is empty through the whole Swiss phase, so the names here come
	// from the standings alone — see slotMapsFromStandings.
	const slots = $derived(slotMapsFromStandings(standings));
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- href is a resolve() result; not traceable through the local var -->
<a {href} class="group block h-full">
	<!-- `isolate` plus `-z-10` on the art is what lets the still sit behind the
	     panel's own heading as well as the insets: negative-z children paint
	     above the section's background but below its in-flow content, and the
	     isolation keeps them from escaping behind the page. The scrim, not the
	     art, is what guarantees contrast — every cut of the still is re-lit
	     differently and the text can't depend on which one is in place. -->
	<Panel
		title={tournament.name}
		class="relative isolate flex h-full flex-col overflow-hidden"
	>
		<img
			src="/tournament-hero.webp"
			alt=""
			width="654"
			height="345"
			class="absolute inset-0 -z-10 h-full w-full object-cover"
		/>
		<div
			class="absolute inset-0 -z-10 bg-black/70 transition-colors group-hover:bg-black/60"
		></div>

		<!-- The insets are nearly opaque: the art is the tile's backdrop, not a
		     texture behind their rows, and at any less the still's lit half fights
		     the names in front of it. What shows the picture is the space around
		     them, not what bleeds through them. The grid is deliberately not
		     stretched to the panel: the tile keeps the season
		     boards' height, `mt-auto` drops the insets to its foot, and what they
		     leave over is the art.

		     Both boxes are a FIXED height rather than content-height, which is what
		     stops the tile reshaping itself under the reader. Upcoming's row count
		     is a function of the clock — the SSR paint splits live from upcoming
		     against a `now` captured when the Worker isolate loaded now.svelte.ts,
		     hydration re-splits against the browser's, and the 30s tick moves a
		     sitting across the boundary after that — so a content-sized box grew
		     and shrank on its own. 102px is two Upcoming rows exactly: `p-2` (16)
		     + the label (15 + `mb-1`) + two two-line rows (31.5 each) + their
		     `gap-1`. Standings' three rows sit inside the same box with room over,
		     and `overflow-hidden` is the partner to the fixed height — nothing can
		     spill past it if a time string wraps at the narrowest column. -->
		<div class="mt-auto grid gap-2 sm:grid-cols-2">
			<div class="h-[102px] overflow-hidden rounded-lg bg-surface-deep/90 p-2">
				<h4 class="mb-1 text-[10px] font-bold uppercase text-gray-400">
					Standings
				</h4>
				<TournamentStandingsInset rows={leaders} />
			</div>
			<div class="h-[102px] overflow-hidden rounded-lg bg-surface-deep/90 p-2">
				<h4 class="mb-1 text-[10px] font-bold uppercase text-gray-400">
					Upcoming
				</h4>
				<TournamentUpcomingInset {matches} {slots} />
			</div>
		</div>
	</Panel>
</a>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
