<script lang="ts">
	// The map view's chrome, laid over the map in the places Old World's own
	// screen puts them: the yield strip across the top, the turn and the
	// player switcher at top-left, research at top-right, the leader at
	// bottom-left, and the turn controls along the bottom. It shows one
	// player's view at the selected turn; the switcher changes whose. Its
	// panels, yields and menu icons open the game's analysis tabs, each in a
	// lightbox the page renders (onOpenTab).
	import type { cloudApi } from "$lib/api-cloud";
	import Select from "$lib/ui/Select.svelte";
	import { nationName } from "$lib/utils/formatting";
	import SpriteIcon from "./SpriteIcon.svelte";
	import MapYieldStrip from "./MapYieldStrip.svelte";
	import MapTurnControls from "./MapTurnControls.svelte";
	import { gameTabs, type GameTabId } from "./game-tabs.svelte";
	import {
		findByPlayer,
		hasVictoryPoints,
		rulerName,
		techName,
		type DetailPlayer,
	} from "./helpers";
	import {
		CHROME_PANEL_CLASS,
		nextDiscovery,
		pointAtTurn,
		rulerAt,
	} from "./map-chrome";

	let {
		game,
		players,
		playerId = $bindable(),
		selectedTurn,
		onTurnChange,
		onOpenTab,
		showPolitical = $bindable(true),
		showReligion = $bindable(false),
	}: {
		game: Awaited<ReturnType<typeof cloudApi.getGame>>;
		players: DetailPlayer[];
		// Whose view the chrome shows; null only for a game with no players.
		playerId: number | null;
		selectedTurn: number;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onTurnChange: (turn: number) => Promise<void> | void;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onOpenTab: (tab: GameTabId) => void;
		showPolitical?: boolean;
		showReligion?: boolean;
	} = $props();

	const finalTurn = $derived(game.game_details.total_turns);
	const tabs = $derived(gameTabs(game));
	const player = $derived(
		players.find((p) => p.playerId === playerId) ?? players[0],
	);
	const playerOptions = $derived(
		players.map((p) => ({ value: String(p.playerId), label: p.label })),
	);

	// Points, military power and legitimacy at the selected turn.
	const standing = $derived.by(() => {
		if (!player) return undefined;
		const history = findByPlayer(
			game.player_history,
			player,
			(h) => h.player_id,
			(h) => h.nation,
		);
		return history ? pointAtTurn(history.history, selectedTurn) : undefined;
	});

	const research = $derived.by(() => {
		if (!player) return null;
		const history = findByPlayer(
			game.tech_discovery_history,
			player,
			(h) => h.player_id,
			(h) => h.nation,
		);
		return nextDiscovery(history, selectedTurn);
	});

	// `characters` is absent from blobs parsed before it existed.
	const ruler = $derived(
		player
			? rulerAt(game.characters ?? [], player.playerId, selectedTurn)
			: null,
	);

	const value = (n: number | null | undefined): string =>
		n == null ? "—" : n.toLocaleString("en-US");
</script>

<div class="pointer-events-none absolute inset-0 z-10 flex flex-col gap-3 p-3">
	<!-- Top bar: the yield strip, then a menu icon per tab -->
	<div class="flex flex-wrap items-start gap-3">
		{#if player}
			<div class="pointer-events-auto">
				<MapYieldStrip
					allYields={game.yield_history}
					yieldPrices={game.yield_price_history ?? []}
					playerResources={game.player_resources ?? []}
					{player}
					turn={selectedTurn}
					{finalTurn}
					{onOpenTab}
				/>
			</div>
		{/if}
		<div
			class="pointer-events-auto flex h-12 items-center gap-0.5 px-1.5 {CHROME_PANEL_CLASS}"
		>
			{#each tabs as tab (tab.id)}
				<button
					type="button"
					onclick={() => onOpenTab(tab.id)}
					class="flex cursor-pointer rounded p-1.5 transition-colors hover:bg-tan/15"
					title={tab.label}
				>
					<SpriteIcon
						category={tab.icon.category}
						value={tab.icon.value}
						size={24}
						alt={tab.label}
					/>
				</button>
			{/each}
		</div>
	</div>

	<div class="relative min-h-0 flex-1">
		{#if player}
			<!-- Turn and player switcher (top-left) -->
			<div
				class="pointer-events-auto absolute left-0 top-0 flex flex-col gap-2 px-3 py-2 {CHROME_PANEL_CLASS}"
			>
				<div class="flex items-center gap-1.5 text-sm font-bold text-bright">
					<SpriteIcon category="icons" value="TURN" size={18} alt="" />
					Turn {selectedTurn}
				</div>
				<div class="flex items-center gap-3 text-sm">
					<div class="flex items-center gap-1.5">
						{#if player.nation}
							<SpriteIcon
								category="crests"
								value={player.nation}
								size={20}
								alt={nationName(player.nation)}
							/>
						{/if}
						<Select
							value={String(player.playerId)}
							onChange={(v) => {
								if (v != null) playerId = Number(v);
							}}
							options={playerOptions}
							ariaLabel="Player"
						/>
					</div>
					{#if hasVictoryPoints(game.game_details)}
						<span
							class="flex items-center gap-1 tabular-nums"
							title="Victory Points"
						>
							<SpriteIcon
								category="icons"
								value="VICTORY_NORMAL"
								size={16}
								alt="Victory Points"
							/>
							{value(standing?.points)}
						</span>
					{/if}
					<button
						type="button"
						onclick={() => onOpenTab("military")}
						class="flex cursor-pointer items-center gap-1 tabular-nums transition-colors hover:text-bright"
						title="Military Power"
					>
						<SpriteIcon
							category="icons"
							value="MILITARY"
							size={16}
							alt="Military Power"
						/>
						{value(standing?.military_power)}
					</button>
				</div>
			</div>

			<!-- Research (top-right): the next tech discovered after this turn -->
			{#if research}
				<button
					type="button"
					onclick={() => onOpenTab("techs")}
					class="pointer-events-auto absolute right-0 top-0 flex cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:border-tan {CHROME_PANEL_CLASS}"
				>
					<SpriteIcon
						category="techs"
						value={research.tech}
						size={32}
						alt={techName(research.tech)}
					/>
					<span class="leading-tight">
						<span class="block text-sm font-bold text-bright">
							{techName(research.tech)}
						</span>
						<span class="block text-xs tabular-nums">{research.turns}y</span>
					</span>
				</button>
			{/if}

			<!-- Leader (bottom-left) -->
			{#if ruler}
				{@const name = rulerName(ruler) ?? "Unknown"}
				<button
					type="button"
					onclick={() => onOpenTab("leaders")}
					class="pointer-events-auto absolute bottom-0 left-0 flex cursor-pointer items-center gap-3 p-2 pr-4 text-left transition-colors hover:border-tan {CHROME_PANEL_CLASS}"
				>
					{#if ruler.portrait}
						<span class="block overflow-hidden rounded border border-tan/50">
							<SpriteIcon
								category="portraits"
								value={ruler.portrait}
								size={64}
								alt={name}
							/>
						</span>
					{/if}
					<span class="leading-tight">
						<span class="block text-sm font-bold text-bright">{name}</span>
						<span
							class="mt-1 flex items-center gap-1 text-sm tabular-nums"
							title="Legitimacy"
						>
							<SpriteIcon
								category="yields"
								value="YIELD_LEGITIMACY"
								size={16}
								alt="Legitimacy"
							/>
							{value(standing?.legitimacy)}
						</span>
					</span>
				</button>
			{/if}
		{/if}

		<!-- Turn and layer controls (bottom) -->
		<div
			class="pointer-events-auto absolute bottom-0 left-1/2 -translate-x-1/2 px-4 py-2 {CHROME_PANEL_CLASS}"
		>
			<MapTurnControls
				totalTurns={finalTurn}
				{selectedTurn}
				{onTurnChange}
				bind:showPolitical
				bind:showReligion
			/>
		</div>
	</div>
</div>
