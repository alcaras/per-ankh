<script lang="ts">
	import { untrack } from "svelte";
	import type { PageData } from "./$types";
	import type { MapTile } from "$lib/types/MapTile";
	import GameHeader from "$lib/game-detail/GameHeader.svelte";
	import MapChrome from "$lib/game-detail/MapChrome.svelte";
	import {
		resolveGamePlayers,
		saveOwnerPlayer,
		type DetailPlayer,
	} from "$lib/game-detail/helpers";
	import { reconstructMapTiles } from "$lib/game-detail/reconstruct-map-tiles";
	import SpriteMap from "$lib/SpriteMap.svelte";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	const players = $derived(resolveGamePlayers(game));

	// Whose view the chrome opens on: the uploader's player, or player 0 for an
	// observer upload. Keyed on `uploader_nation`, the raw choice — the
	// response's `user_nation` falls back to the first human's nation, so it's
	// never null.
	function defaultPlayerId(
		g: typeof data.game,
		list: DetailPlayer[],
	): number | null {
		const owner =
			g.uploader_nation != null
				? saveOwnerPlayer(list, g.uploader_nation)
				: list.find((p) => p.playerId === 0);
		return (owner ?? list[0])?.playerId ?? null;
	}

	// The map's turn, defaulting to the final one, and the chrome's player.
	// Initialised at component construction (not in $effect) so the SSR'd HTML
	// already has the turn slider at that turn and the chrome in that player's
	// view, rather than adding them on hydration; $effect doesn't run during
	// SSR.
	// svelte-ignore state_referenced_locally
	let selectedMapTurn = $state<number>(data.game.game_details.total_turns);
	// svelte-ignore state_referenced_locally
	let mapTiles = $state<MapTile[]>(data.game.map_tiles);
	// svelte-ignore state_referenced_locally
	let playerId = $state<number | null>(defaultPlayerId(data.game, players));
	let showPolitical = $state(true);
	let showReligion = $state(false);

	// Re-sync when the route navigates to a different game. Only the match id
	// is tracked; the body reads via untrack(), so a revalidation for the same
	// game (e.g. invalidateAll() from a rename) keeps the selected turn and
	// player.
	$effect(() => {
		game.game_details.match_id;
		untrack(() => {
			selectedMapTurn = game.game_details.total_turns;
			mapTiles = game.map_tiles;
			playerId = defaultPlayerId(game, players);
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
		<div class="relative min-h-0 flex-1">
			<SpriteMap
				tiles={mapTiles}
				cities={game.city_statistics.cities}
				playerNations={game.player_nations}
				{showPolitical}
				{showReligion}
			/>
			<MapChrome
				{game}
				{players}
				bind:playerId
				selectedTurn={selectedMapTurn}
				onTurnChange={handleMapTurnChange}
				bind:showPolitical
				bind:showReligion
			/>
		</div>
	{/if}
</main>
