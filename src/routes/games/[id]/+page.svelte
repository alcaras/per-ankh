<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import type { PageData } from "./$types";
	import { GameDetailView } from "$lib/game-detail";
	import GameHeader from "$lib/game-detail/GameHeader.svelte";
	import { autohideScroll } from "$lib/actions/autohideScroll";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	const gameId = $derived(page.params.id ?? "");

	// Links to the old Map tab (/games/[id]#map) land on the map view, replacing
	// the entry rather than adding one. The view isn't mounted while the hash is
	// #map: its own hash effect would otherwise select a "map" tab that no
	// longer exists (an empty pane), and goto is async, so the URL still reads
	// #map when that effect runs. Not mounting it wins without depending on
	// effect order. page.url.hash reads "" during SSR.
	const isMapHash = $derived(page.url.hash === "#map");
	$effect(() => {
		if (isMapHash) {
			goto(resolve("/games/[id]/map", { id: gameId }), { replaceState: true });
		}
	});
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<GameHeader
					{game}
					isOwner={data.isOwner}
					collections={data.collections}
					tournamentLink={data.tournamentLink}
				/>
				{#if !isMapHash}
					<GameDetailView
						gameDetails={game.game_details}
						playerHistory={game.player_history}
						allYields={game.yield_history}
						eventLogs={game.event_logs}
						lawAdoptionHistory={game.law_adoption_history}
						currentLaws={game.current_laws}
						techDiscoveryHistory={game.tech_discovery_history}
						completedTechs={game.completed_techs}
						unitsProduced={game.units_produced}
						units={game.units}
						cityStatistics={game.city_statistics}
						improvementData={game.improvement_data}
						gameReligions={game.game_religions}
						techChoices={game.tech_choices}
						playerWonders={game.player_wonders}
						playerRoster={game.player_roster}
						playerNations={game.player_nations}
						characters={game.characters}
						characterTraits={game.character_traits}
						playerGoals={game.player_goals}
						families={game.families}
						memoryData={game.memory_data}
						storyEvents={game.story_events}
						tileOwnershipHistory={game.tile_ownership_history}
						yieldPrices={game.yield_price_history}
						playerResources={game.player_resources}
						familyOpinionHistory={game.family_opinion_history}
						projectsProduced={game.projects_produced}
						userNation={game.user_nation ?? null}
						userDisplayName={game.user_display_name ?? null}
						userWon={game.user_won ?? null}
						mapTiles={game.map_tiles}
					/>
				{/if}
			</div>
		</div>
	</main>
</div>
