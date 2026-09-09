<script lang="ts">
	// The home hero's left tile: the current major tournament, live.
	//
	// The banner was the whole panel until now, with the event's name baked into
	// the still (the animation's opening title card) and the image re-cut every
	// season. The name is text over the band instead, so a new event needs no new
	// art — and the band gives up the height the two insets below it need.
	//
	// The insets answer the two questions a visitor has about a running event:
	// who is winning, and when is the next game. Both are read-only previews;
	// the whole panel's links go to the tournament for anything further.
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

	// Leaders shown in the standings inset — enough to read the top of the field
	// in a half-tile.
	const STANDINGS_ROWS = 5;

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

<Panel title="Featured Tournament">
	<!-- eslint-disable svelte/no-navigation-without-resolve -- href is a resolve() result; not traceable through the local var -->
	<a
		{href}
		class="group relative block h-28 overflow-hidden rounded-lg bg-black sm:h-32"
	>
		<img
			src="/tournament-hero.webp"
			alt=""
			width="654"
			height="345"
			class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
		/>
		<!-- The name reads over the art's lower third, which is dark in every cut
		     of the still; the gradient is what guarantees the contrast rather than
		     the art doing it by luck. -->
		<div
			class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pb-2 pt-8"
		>
			<h3
				class="truncate text-base font-bold text-white transition-colors group-hover:text-orange sm:text-lg"
			>
				{tournament.name}
			</h3>
		</div>
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->

	<div class="mt-3 grid gap-3 sm:grid-cols-2">
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<h4 class="mb-2 text-xs font-bold uppercase text-gray-400">Standings</h4>
			<TournamentStandingsInset rows={leaders} />
		</div>
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<h4 class="mb-2 text-xs font-bold uppercase text-gray-400">Upcoming</h4>
			<TournamentUpcomingInset {matches} {slots} />
		</div>
	</div>
</Panel>
