<script lang="ts">
	// The map view's yield strip: the game's top-bar yields for one player at
	// the selected turn. Each slot shows the rate, and the lifetime total only
	// where the series holds the game's own total — a running sum of the rate
	// isn't the number the game would show. The stockpile is the final turn's
	// (the save keeps no stockpile history), so it goes in the tooltip rather
	// than the slot, where scrubbing to the last turn would jump from a total
	// to a stockpile. Clicking a slot opens its yield's tab (TOP_BAR_YIELDS).
	import { Tooltip } from "bits-ui";
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import type { PlayerResourceInfo, YieldPriceEntry } from "$lib/parser/types";
	import { formatEnum } from "$lib/utils/formatting";
	import SpriteIcon from "./SpriteIcon.svelte";
	import type { GameTabId } from "./game-tabs.svelte";
	import {
		YIELD_CHART_CONFIG,
		cumulativeIsGameTotal,
		findByPlayer,
		type DetailPlayer,
	} from "./helpers";
	import { STOCKPILE_SCALE, pricesByTurn } from "./economy";
	import {
		CHROME_PANEL_CLASS,
		TOP_BAR_YIELDS,
		pointAtTurn,
	} from "./map-chrome";

	let {
		allYields,
		yieldPrices,
		playerResources,
		player,
		turn,
		finalTurn,
		onOpenTab,
	}: {
		allYields: YieldHistory[];
		yieldPrices: YieldPriceEntry[];
		playerResources: PlayerResourceInfo[];
		player: DetailPlayer;
		turn: number;
		finalTurn: number;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onOpenTab: (tab: GameTabId) => void;
	} = $props();

	// Game-wide, so independent of the player and the turn. Only the four
	// commodities the market prices (Food, Iron, Stone, Wood) have a curve.
	const prices = $derived(pricesByTurn(yieldPrices, finalTurn));

	const slots = $derived(
		TOP_BAR_YIELDS.map(({ yieldType, stockpiled, tab }) => {
			const series = findByPlayer(
				allYields.filter((y) => y.yield_type === yieldType),
				player,
				(y) => y.player_id,
				(y) => y.nation,
			);
			const point = series ? pointAtTurn(series.data, turn) : undefined;
			const held = stockpiled
				? playerResources.find(
						(r) =>
							r.player_xml_id === player.playerId && r.yield_type === yieldType,
					)
				: undefined;
			return {
				yieldType,
				tab,
				title:
					YIELD_CHART_CONFIG.find((c) => c.yieldType === yieldType)?.title ??
					formatEnum(yieldType, "YIELD_"),
				rate: point?.rate ?? null,
				total: cumulativeIsGameTotal(allYields, yieldType)
					? (point?.cumulative ?? null)
					: null,
				price: prices.get(yieldType)?.[turn] ?? null,
				stockpile: held != null ? held.amount / STOCKPILE_SCALE : null,
			};
		}),
	);

	// Yields are stored in tenths, so a rate carries at most one decimal.
	const rate = (value: number | null): string =>
		value == null
			? "—"
			: `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
	const amount = (value: number): string =>
		Math.round(value).toLocaleString("en-US");
	// Prices sit around 2–100 money, so whole numbers would hide their movement.
	const price = (value: number): string => value.toFixed(1);
</script>

<Tooltip.Provider delayDuration={200} disableHoverableContent>
	<div
		class="flex h-12 items-stretch divide-x divide-tan/20 overflow-hidden {CHROME_PANEL_CLASS}"
	>
		{#each slots as slot (slot.yieldType)}
			<Tooltip.Root>
				<Tooltip.Trigger
					class="flex cursor-pointer items-center gap-1.5 px-3 text-left transition-colors hover:bg-tan/15"
					aria-label={slot.title}
					onclick={() => onOpenTab(slot.tab)}
				>
					<SpriteIcon category="yields" value={slot.yieldType} size={22} />
					<span class="flex flex-col leading-tight">
						<span
							class="whitespace-nowrap text-sm font-bold tabular-nums text-bright"
						>
							{#if slot.total != null}
								{amount(slot.total)}
								<span class="text-xs font-normal text-tan"
									>({rate(slot.rate)})</span
								>
							{:else}
								{rate(slot.rate)}
							{/if}
						</span>
						{#if slot.price != null}
							<span class="text-[10px] tabular-nums text-tan/70"
								>{price(slot.price)}</span
							>
						{/if}
					</span>
				</Tooltip.Trigger>
				<Tooltip.Portal>
					<Tooltip.Content
						side="bottom"
						sideOffset={6}
						class="z-50 min-w-40 px-3 py-2 text-xs {CHROME_PANEL_CLASS}"
					>
						<p class="mb-1.5 font-bold text-bright">{slot.title}</p>
						<dl
							class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-0.5"
						>
							<dt class="label">Per turn</dt>
							<dd class="text-right tabular-nums">{rate(slot.rate)}</dd>
							{#if slot.total != null}
								<dt class="label">Total</dt>
								<dd class="text-right tabular-nums">{amount(slot.total)}</dd>
							{/if}
							{#if slot.price != null}
								<dt class="label">Market price</dt>
								<dd class="text-right tabular-nums">{price(slot.price)}</dd>
							{/if}
							{#if slot.stockpile != null}
								<dt class="label">Stockpile, turn {finalTurn}</dt>
								<dd class="text-right tabular-nums">
									{amount(slot.stockpile)}
								</dd>
							{/if}
						</dl>
					</Tooltip.Content>
				</Tooltip.Portal>
			</Tooltip.Root>
		{/each}
	</div>
</Tooltip.Provider>

<style>
	/* The hover panel's row label (MapTooltip), so the chrome reads alike. */
	.label {
		color: rgb(var(--color-muted));
		font-size: 9.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
</style>
