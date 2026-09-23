<script lang="ts">
	import { untrack } from "svelte";
	import type { PageData } from "./$types";
	import type { MapTile } from "$lib/types/MapTile";
	import GameHeader from "$lib/game-detail/GameHeader.svelte";
	import { reconstructMapTiles } from "$lib/game-detail/reconstruct-map-tiles";
	import SpriteMap from "$lib/SpriteMap.svelte";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);

	// The map's turn, defaulting to the final one. Initialised at component
	// construction (not in $effect) so the SSR'd HTML already has the turn
	// slider at that turn, rather than adding it on hydration; $effect doesn't
	// run during SSR.
	// svelte-ignore state_referenced_locally
	let selectedMapTurn = $state<number | null>(
		data.game.game_details.total_turns,
	);
	// svelte-ignore state_referenced_locally
	let mapTiles = $state<MapTile[]>(data.game.map_tiles);

	// Re-sync when the route navigates to a different game. Only the match id
	// is tracked; the body reads via untrack(), so a revalidation for the same
	// game (e.g. invalidateAll() from a rename) keeps the selected turn.
	$effect(() => {
		game.game_details.match_id;
		untrack(() => {
			selectedMapTurn = game.game_details.total_turns;
			mapTiles = game.map_tiles;
		});
	});

	async function handleMapTurnChange(turn: number) {
		selectedMapTurn = turn;
		mapTiles = reconstructMapTiles(game, turn);
	}
</script>

<main class="isolate flex flex-1 flex-col overflow-hidden">
	<div class="px-4 pt-4">
		<div class="mx-auto max-w-screen-2xl">
			<GameHeader
				{game}
				isOwner={data.isOwner}
				collections={data.collections}
				tournamentLink={data.tournamentLink}
			/>
		</div>
	</div>

	{#if game.map_tiles.length === 0}
		<div class="px-4">
			<p class="mx-auto max-w-screen-2xl italic text-tan">
				No map data available for this game.
			</p>
		</div>
	{:else}
		<div class="min-h-0 flex-1">
			<SpriteMap
				tiles={mapTiles}
				cities={game.city_statistics.cities}
				playerNations={game.player_nations}
				totalTurns={game.game_details.total_turns}
				selectedTurn={selectedMapTurn}
				onTurnChange={handleMapTurnChange}
			/>
		</div>
	{/if}
</main>
