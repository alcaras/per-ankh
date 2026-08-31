<script lang="ts">
	// "Records": the leaderboard behind the yield bands — for each series, the
	// player-games holding the biggest numbers, linked to the game.
	//
	// Two selectors, because the same series has six honest answers and they
	// disagree:
	//
	//   Peak / End of game favour long matches — yields compound, so these are
	//   partly a "who played the most turns" board. Kept because they're the
	//   ones people actually ask for, and labelled so nobody mistakes them for
	//   a like-for-like comparison.
	//
	//   T40 / T60 / T80 / T100 compare everyone who reached that turn AT that
	//   turn, which is the only length-blind board of the six.
	//
	// The accumulated measure means two different things depending on the
	// series and the card says which: growth, science, culture and orders are
	// never spent, so their total is lifetime production; money, food, iron,
	// stone and wood are, so theirs is the stockpile held at that turn.
	import { resolve } from "$app/paths";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import { nationName } from "$lib/utils/formatting";
	import { YIELD_SERIES } from "./charts/yields";
	import type { ChartBundleCore } from "./types";

	let { bundle }: { bundle: ChartBundleCore } = $props();

	// Which of the game's yields are spent, and so carry a stockpile rather
	// than a production total. Everything else only ever climbs.
	const SPENDABLE = new Set([
		"money_per_turn",
		"food_per_turn",
		"iron_per_turn",
		"stone_per_turn",
		"wood_per_turn",
		"maintenance_per_turn",
		"happiness_per_turn",
		"discontent_per_turn",
		"training_per_turn",
		"civics_per_turn",
	]);
	// Levels, not flows — they have no separate accumulated column, so the
	// accumulated board would repeat the rate board.
	const LEVELS = new Set(["military_power", "legitimacy"]);

	const WHENS = [
		{ key: "peak", label: "Best ever" },
		{ key: "final", label: "End of game" },
		{ key: "t20", label: "At T20" },
		{ key: "t40", label: "At T40" },
		{ key: "t60", label: "At T60" },
		{ key: "t80", label: "At T80" },
		{ key: "t100", label: "At T100" },
	] as const;

	// The bundle ships ten; the panel shows them all. Kept as a constant so a
	// board that wants a shorter list has one place to say so.
	const TOP_N = 10;

	let measure = $state<"rate" | "cum">("rate");
	let when = $state<(typeof WHENS)[number]["key"]>("peak");

	const boardCount = $derived(bundle.recordCounts?.[when] ?? 0);
	// On a checkpoint board every row shares the same turn, so it belongs in
	// the card's header once rather than down the whole column. Peak and
	// end-of-game rows each have their own turn and keep it.
	const fixedTurn = $derived(
		when.startsWith("t") ? Number(when.slice(1)) : null,
	);

	// The record holder first and emphasised, then the rest of the table — a
	// row has to say which side of the game posted the number, and in a duel
	// "Assyria vs Kush" alone doesn't.
	function seats(
		gameId: string,
		playerIndex: number,
	): { holder: boolean; nation: string | null; label: string }[] {
		const all = bundle.recordGames?.[gameId]?.seats ?? {};
		const rows = Object.entries(all).map(([i, seat]) => ({
			index: Number(i),
			holder: Number(i) === playerIndex,
			nation: seat.nation,
			// The save's handle when it has one, else the nation — an AI seat
			// and an unnamed save both land on the latter.
			label: seat.name ?? (seat.nation ? nationName(seat.nation) : "?"),
		}));
		return [
			...rows.filter((r) => r.holder),
			...rows.filter((r) => !r.holder).sort((a, b) => a.index - b.index),
		];
	}

	// Groups follow the game's own reading of its yields, in the Yields tab's
	// order within each: what an empire produces, what it stockpiles, what it
	// costs, and where it stands.
	const GROUPS: { title: string; keys: string[] }[] = [
		{
			title: "Output",
			keys: [
				"science_per_turn",
				"civics_per_turn",
				"training_per_turn",
				"growth_per_turn",
				"culture_per_turn",
				"orders_per_turn",
			],
		},
		{
			title: "Resources",
			keys: [
				"money_per_turn",
				"food_per_turn",
				"iron_per_turn",
				"stone_per_turn",
				"wood_per_turn",
			],
		},
		{ title: "Standing", keys: ["military_power", "legitimacy"] },
	];

	const byKey = $derived(
		new Map(YIELD_SERIES.map((s) => [s.key as string, s])),
	);
	const groups = $derived(
		GROUPS.map((group) => ({
			title: group.title,
			cards: group.keys
				.flatMap((k) => {
					const series = byKey.get(k);
					return series ? [card(series)] : [];
				})
				.filter((c) => !c.muted && c.rows.length > 0),
		})).filter((g) => g.cards.length > 0),
	);
	type Series = (typeof YIELD_SERIES)[number];
	function card(series: Series) {
		const isLevel = LEVELS.has(series.key);
		const key =
			measure === "cum" && !isLevel ? `${series.key}:cum` : series.key;
		return {
			...series,
			// A level has no accumulated column; showing the rate board twice
			// under a second name would be a lie of omission, so it sits out.
			muted: measure === "cum" && isLevel,
			note:
				measure === "cum" && !isLevel
					? SPENDABLE.has(series.key)
						? "held"
						: "produced"
					: null,
			rows: (bundle.records?.[key]?.[when] ?? []).slice(0, TOP_N),
		};
	}

	const fmt = (v: number): string =>
		Math.abs(v) >= 1000
			? Math.round(v).toLocaleString("en-US")
			: (Math.round(v * 10) / 10).toString();
</script>

{#if Object.keys(bundle.records ?? {}).length > 0}
	<section class="mb-6">
		<div class="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-2">
			<h3 class="text-base font-bold text-tan">Records</h3>
			<div class="flex flex-wrap gap-1 text-xs">
				{#each [{ k: "rate", l: "Per turn" }, { k: "cum", l: "Accumulated" }] as m (m.k)}
					<button
						type="button"
						class="rounded px-2 py-0.5 {measure === m.k
							? 'bg-orange/25 font-semibold text-bright'
							: 'text-gray-400 hover:text-tan'}"
						onclick={() => (measure = m.k as "rate" | "cum")}>{m.l}</button
					>
				{/each}
			</div>
			<div class="flex flex-wrap gap-1 text-xs">
				{#each WHENS as w (w.key)}
					<button
						type="button"
						class="rounded px-2 py-0.5 {when === w.key
							? 'bg-orange/25 font-semibold text-bright'
							: 'text-gray-400 hover:text-tan'}"
						onclick={() => (when = w.key)}>{w.label}</button
					>
				{/each}
			</div>
		</div>
		{#if boardCount > 0}
			<p class="mb-3 text-xs text-gray-400">
				{boardCount.toLocaleString("en-US")} player-games
			</p>
		{/if}
		{#each groups as group (group.title)}
			<div class="mb-4">
				<div
					class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
				>
					{group.title}
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{#each group.cards as card (card.key)}
						<div
							class="rounded-lg p-3"
							style="background-color: rgb(var(--color-surface));"
						>
							<div class="mb-1 flex items-baseline justify-between gap-2">
								<span class="flex items-baseline gap-1.5">
									<span class="text-xs font-bold" style="color: {card.color};"
										>{card.label}</span
									>
									{#if fixedTurn != null}
										<span class="text-[10px] tabular-nums text-gray-500"
											>T{fixedTurn}</span
										>
									{/if}
								</span>
								{#if card.note}
									<span
										class="text-[10px] uppercase tracking-wide text-gray-400"
										>{card.note}</span
									>
								{/if}
							</div>
							<ol class="text-xs">
								{#each card.rows as row, i (row.game_id + row.player_index)}
									<li class="flex items-baseline gap-2 py-0.5">
										<span class="w-4 shrink-0 text-right text-gray-500"
											>{i + 1}</span
										>
										<a
											class="flex min-w-0 flex-1 items-baseline gap-1 truncate text-gray-400 hover:underline"
											href={resolve("/games/[id]", { id: row.game_id })}
											title="T{row.turn} of {bundle.recordGames?.[row.game_id]
												?.turns ?? '?'} — open the game"
										>
											{#each seats(row.game_id, row.player_index) as seat, si (seat.label + si)}
												{#if si > 0}<span class="text-gray-600">v</span>{/if}
												{#if seat.nation}
													<SpriteIcon
														category="crests"
														value={seat.nation}
														size={12}
														alt={seat.nation}
													/>
												{/if}
												<span
													class={seat.holder
														? "font-semibold text-tan"
														: "text-gray-500"}>{seat.label}</span
												>
											{/each}
										</a>
										{#if fixedTurn == null}
											<span class="shrink-0 tabular-nums text-gray-500"
												>T{row.turn}</span
											>
										{/if}
										<span class="shrink-0 font-semibold tabular-nums text-tan"
											>{fmt(row.value)}</span
										>
									</li>
								{/each}
							</ol>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</section>
{/if}
