<script lang="ts">
	// Wonders tab — the whole catalogue, one row per culture tier, with this
	// game's reality painted on: wonders the save disabled carry dimmed art and
	// a muted name, wonders still open are full-strength, and a built wonder
	// carries its builder's colour, nation and completion turn. One glance
	// answers "what was in the pool, and who got what".
	import type { PlayerWonder } from "$lib/types/PlayerWonder";
	import {
		CULTURE_LEVELS,
		WONDER_CULTURE_PREREQ,
	} from "$lib/generated/wonders";
	import { formatEnum } from "$lib/utils/formatting";
	import SpriteIcon from "./SpriteIcon.svelte";
	import { type DetailPlayer, improvementDisplayName } from "./helpers";

	let {
		players,
		playerWonders,
		disabledImprovements = null,
	}: {
		players: DetailPlayer[];
		playerWonders: PlayerWonder[];
		// Wonders the save switched off. Null on pre-2.12.0 blobs, where the
		// pool is unknown — which is not the same claim as "nothing disabled",
		// so nothing is dimmed and a note says why.
		disabledImprovements?: string[] | null;
	} = $props();

	const disabled = $derived(new Set(disabledImprovements ?? []));

	type WonderCard = {
		wonder: string;
		state: "disabled" | "available" | "built";
		// Set when built.
		turn?: number;
		builderLabel?: string;
		builderColor?: string;
		builderNation?: string | null;
	};

	// One row per culture tier, in game order, each tier's wonders A→Z by
	// display name. `built` wins over `disabled`: a wonder that demonstrably
	// completed was in the pool whatever the end-state list says.
	const rows = $derived.by<{ level: string; cards: WonderCard[] }[]>(() => {
		const builtBy = new Map(playerWonders.map((w) => [w.wonder, w]));
		return CULTURE_LEVELS.map((level) => ({
			level,
			cards: Object.keys(WONDER_CULTURE_PREREQ)
				.filter((wonder) => WONDER_CULTURE_PREREQ[wonder] === level)
				.sort((a, b) =>
					improvementDisplayName(a).localeCompare(improvementDisplayName(b)),
				)
				.map((wonder): WonderCard => {
					const built = builtBy.get(wonder);
					if (built) {
						// Id match and nothing else: the wonder row always carries its
						// builder's id, and in a mirror match nation can't tell the two
						// players apart. Same join the Economy tab's wonder rail makes;
						// the row's own nation/name cover a blob that matches nothing.
						const player = players.find((p) => p.playerId === built.player_id);
						return {
							wonder,
							state: "built",
							turn: built.completed_turn,
							builderLabel:
								player?.label ??
								(built.nation
									? formatEnum(built.nation, "NATION_")
									: built.player_name),
							builderColor: player?.color,
							builderNation: player?.nation ?? built.nation,
						};
					}
					return {
						wonder,
						state: disabled.has(wonder) ? "disabled" : "available",
					};
				}),
		})).filter((row) => row.cards.length > 0);
	});
</script>

{#if disabledImprovements == null}
	<p class="mb-3 text-xs italic text-tan">
		This save predates the wonder-pool data, so which wonders were disabled is
		unknown — nothing is marked as out of the pool.
	</p>
{/if}

{#each rows as row (row.level)}
	<section class="mb-4 rounded-lg bg-surface p-4">
		<h2 class="mb-2 text-lg font-bold text-bright">
			<span class="inline-flex items-center gap-1.5">
				<SpriteIcon
					category="icons"
					value={row.level}
					size={16}
					alt={formatEnum(row.level, "CULTURE_")}
				/>
				{formatEnum(row.level, "CULTURE_")}
			</span>
		</h2>
		<div class="flex flex-wrap gap-3">
			{#each row.cards as card (card.wonder)}
				<div
					class="w-48 rounded-lg border-2 bg-surface-raised p-2 text-center"
					style="border-color: {card.builderColor ?? 'transparent'};"
				>
					<!-- The wrapper is what the disabled dim applies to, so the art
					     fades while the name and the "Not in this game" note stay
					     legible — the states differ by what they say, not by a filter
					     over all of it. Sized to the icon's square, the same way
					     BuildComparison's icon column is. -->
					<span
						class="mx-auto flex h-14 w-14 flex-none items-center {card.state ===
						'disabled'
							? 'opacity-35'
							: ''}"
					>
						<SpriteIcon
							category="improvements"
							value={card.wonder}
							size={56}
							alt={improvementDisplayName(card.wonder)}
						/>
					</span>
					<div
						class="mt-1.5 text-xs font-semibold {card.state === 'disabled'
							? 'text-muted'
							: 'text-white'}"
					>
						{improvementDisplayName(card.wonder)}
					</div>
					{#if card.state === "built"}
						<!-- Builder and turn read as one phrase ("Egypt Turn 81"), so they
						     share a line. Only the nation carries its colour; the turn
						     stays tan. The card is sized for the longest wonder name, which
						     leaves room for every plain nation label — but a mirror match
						     labels its players "Babylonia (name)", which no fixed width
						     fits, so that one truncates rather than wrapping the card
						     taller. The turn never gives up space; the label does. -->
						<div
							class="mt-1 flex items-center justify-center gap-x-1 text-[11px] leading-tight"
						>
							<span
								class="flex min-w-0 items-center gap-1 font-bold"
								style="color: {card.builderColor ?? 'rgb(var(--color-tan))'};"
							>
								{#if card.builderNation}
									<SpriteIcon
										category="crests"
										value={card.builderNation}
										size={13}
										alt=""
									/>
								{/if}
								<span class="truncate" title={card.builderLabel}>
									{card.builderLabel}
								</span>
							</span>
							<span class="shrink-0 text-tan">Turn {card.turn}</span>
						</div>
					{:else if card.state === "disabled"}
						<div class="mt-1 text-[10px] italic text-tan">Not in this game</div>
					{/if}
				</div>
			{/each}
		</div>
	</section>
{/each}
