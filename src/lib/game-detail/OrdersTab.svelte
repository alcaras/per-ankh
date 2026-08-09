<script lang="ts">
	// Orders tab — the action economy. The orders-per-turn and legitimacy
	// plots (the same builders the Yields and Leaders tabs draw, so a player
	// keeps one colour and one selection across the page) over per-player
	// itemizations of where both come from at end of game, anchored on the
	// game's own calculation (see orders.ts). Works for any player count —
	// cards render per player, duel or FFA.
	import ChartContainer from "$lib/ChartContainer.svelte";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import type { PlayerLaw } from "$lib/types/PlayerLaw";
	import type { StoryEvent } from "$lib/types/StoryEvent";
	import type {
		CharacterInfo,
		CharacterTraitInfo,
		PlayerGoalInfo,
	} from "$lib/parser/types";
	import {
		dynastyLeaders,
		legitimacyEndBreakdown,
		ordersEndBreakdown,
		type EndBreakdown,
	} from "./orders";
	import {
		createLegitimacyChartOption,
		createYieldChartOption,
		findByPlayer,
		ownedByPlayer,
	} from "./helpers";
	import type { DetailPlayer } from "./helpers";

	let {
		players,
		allYields,
		playerHistory,
		characters = [],
		characterTraits = [],
		currentLaws,
		playerGoals = [],
		storyEvents = [],
		ordersChartFilter = $bindable<Record<string, boolean>>({}),
		legitimacyChartFilter = $bindable<Record<string, boolean>>({}),
	}: {
		players: DetailPlayer[];
		allYields: YieldHistory[];
		playerHistory: PlayerHistory[];
		characters?: CharacterInfo[];
		characterTraits?: CharacterTraitInfo[];
		currentLaws: PlayerLaw[];
		playerGoals?: PlayerGoalInfo[];
		storyEvents?: StoryEvent[];
		ordersChartFilter?: Record<string, boolean>;
		legitimacyChartFilter?: Record<string, boolean>;
	} = $props();

	// ─── Charts ───────────────────────────────────────────────────────
	// Both plots exist elsewhere on the page — orders/turn in Yields, legitimacy
	// in Leaders — and are built here from the same helpers, so they read as one
	// family and share the page's per-player chart selection.
	const ordersChart = $derived(
		createYieldChartOption(
			allYields,
			"YIELD_ORDERS",
			"Orders",
			"Orders",
			ordersChartFilter,
		),
	);
	const legitimacyChart = $derived(
		createLegitimacyChartOption(playerHistory, players, legitimacyChartFilter),
	);

	// ─── Footnotes ────────────────────────────────────────────────────
	// One string per metric: the duel table and the FFA cards annotate the same
	// "Other" row, so the text lives in one place.
	const ORDERS_NOTE =
		"Everything the save can't itemize: council and court ratings, city yields (shrines, cathedrals), agents, trade and tribute. The save records gross production — orders spent by working or fortifying units are not deducted here. MP advantage compensation is also unrecorded per player.";
	const LEGITIMACY_NOTE =
		"Bonuses without a same-turn story event, legacy-ambition differences, cathedrals and shrines, and jumps on succession turns (the dynasty term reshuffles). A cognomen earned mid-reign is counted both in its ruler's row and inside a timed jump, and an ambition's completion turn isn't recorded, so a jump paying one out is credited to that turn's event — this signed row nets the overlap out.";

	// ─── Per-player breakdowns ────────────────────────────────────────

	const ordersYields = $derived(
		allYields.filter((y) => y.yield_type === "YIELD_ORDERS"),
	);

	type PlayerBreakdown = {
		player: DetailPlayer;
		orders: EndBreakdown | null;
		legitimacy: EndBreakdown | null;
	};

	const breakdowns = $derived<PlayerBreakdown[]>(
		players.map((p) => {
			const history =
				findByPlayer(
					playerHistory,
					p,
					(h) => h.player_id,
					(h) => h.nation,
				)?.history ?? [];
			const lastLegit = [...history]
				.reverse()
				.find((d) => d.legitimacy != null)?.legitimacy;
			const finalLegitimacy = p.legitimacy ?? lastLegit ?? null;
			const ordersRows =
				findByPlayer(
					ordersYields,
					p,
					(y) => y.player_id,
					(y) => y.nation,
				)?.data ?? [];
			const finalOrdersRate =
				[...ordersRows].reverse().find((d) => d.rate != null)?.rate ?? null;
			const leaders = dynastyLeaders(characters, p.playerId);
			const rulerId = p.leader_character_xml_id;
			const ruler =
				(rulerId != null
					? characters.find((c) => c.xml_id === rulerId)
					: null) ??
				leaders[leaders.length - 1] ??
				null;

			const orders: EndBreakdown | null =
				finalOrdersRate != null
					? ordersEndBreakdown({
							finalOrdersRate,
							finalLegitimacy,
							difficulty: p.difficulty,
							laws: ownedByPlayer(
								currentLaws,
								p,
								(l) => l.player_id,
								(l) => l.nation,
							),
							ruler,
							characterTraits,
						})
					: null;
			const legitimacy: EndBreakdown | null =
				finalLegitimacy != null
					? legitimacyEndBreakdown({
							finalLegitimacy,
							leaders,
							goals: playerGoals.filter((g) => g.player_xml_id === p.playerId),
							series: history,
							storyEvents: storyEvents.filter(
								(e) => e.player_name === p.player_name,
							),
						})
					: null;
			return { player: p, orders, legitimacy };
		}),
	);

	const fmt = (v: number, dp: number): string =>
		(v < 0 ? "−" : "") + Math.abs(v).toFixed(dp);
	// Every contribution row carries its sign — a cognomen can cost legitimacy
	// (COGNOMEN_BLOODY is −100) and the remainder runs either way. Totals use
	// plain `fmt`.
	const signed = (v: number, dp: number): string =>
		(v < 0 ? "" : "+") + fmt(v, dp);

	// ─── Duel side-by-side ────────────────────────────────────────────
	// Two players read best as one table — every source row, both values in
	// facing columns. Rows are the union of both sides' labels, ordered by
	// the larger value; a source only one side has shows "—" for the other.
	const isDuel = $derived(players.length === 2);

	const SECTIONS = [
		{
			title: "Orders per turn, at end",
			dp: 1,
			note: ORDERS_NOTE,
			pick: (b: PlayerBreakdown) => b.orders,
		},
		{
			title: "Legitimacy, at end",
			dp: 0,
			note: LEGITIMACY_NOTE,
			pick: (b: PlayerBreakdown) => b.legitimacy,
		},
	];

	// The union walk and every cell lookup run once per derivation here, not
	// once per render per cell as they would from the template.
	const duelSections = $derived(
		SECTIONS.map((section) => {
			const labels = breakdowns.map((b) => b.player.label);
			const sides = breakdowns.map((b) => section.pick(b));
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and consumed inside one derivation, never mutated after
			const best = new Map<string, { max: number; detail?: string }>();
			for (const bd of sides) {
				for (const r of bd?.rows ?? []) {
					const prev = best.get(r.label);
					if (!prev || r.value > prev.max) {
						best.set(r.label, { max: r.value, detail: r.detail });
					}
				}
			}
			return {
				title: section.title,
				dp: section.dp,
				note: section.note,
				rows: [...best.entries()]
					.sort((a, b) => b[1].max - a[1].max)
					.map(([label, v]) => ({
						label,
						detail: v.detail,
						values: sides.map((bd, i) => ({
							player: labels[i],
							value: bd?.rows.find((r) => r.label === label)?.value ?? null,
						})),
					})),
				others: sides.map((bd, i) => ({
					player: labels[i],
					value: bd?.other ?? null,
				})),
				totals: sides.map((bd, i) => ({
					player: labels[i],
					value: bd?.total ?? null,
				})),
			};
		}),
	);
</script>

{#snippet breakdownTable(b: EndBreakdown, dp: number, otherNote: string)}
	<table class="w-full text-xs">
		<tbody>
			{#each b.rows as row (row.label)}
				<tr>
					<td class="py-0.5 pr-2 text-tan">
						{row.label}
						{#if row.detail}
							<div class="text-[10px] text-tan opacity-60">{row.detail}</div>
						{/if}
					</td>
					<td
						class="py-0.5 text-right align-top font-mono tabular-nums text-gray-200"
						>{signed(row.value, dp)}</td
					>
				</tr>
			{/each}
			<tr>
				<td class="py-0.5 pr-2 text-tan" title={otherNote}>
					Other <span class="text-[10px] opacity-60">(?)</span>
				</td>
				<td
					class="py-0.5 text-right font-mono tabular-nums {b.other < 0
						? 'text-red-400'
						: 'text-gray-200'}">{signed(b.other, dp)}</td
				>
			</tr>
			<tr class="border-t border-border-subtle font-bold">
				<td class="py-1 pr-2 text-gray-200">Total</td>
				<td class="py-1 text-right font-mono tabular-nums text-white"
					>{fmt(b.total, dp)}</td
				>
			</tr>
		</tbody>
	</table>
{/snippet}

<div class="space-y-4">
	{#if ordersChart}
		<div
			class="rounded-lg p-4"
			style="background-color: rgb(var(--color-surface));"
		>
			<ChartContainer option={ordersChart} height="400px" title="Orders" />
		</div>
	{/if}

	{#if legitimacyChart}
		<div
			class="rounded-lg p-4"
			style="background-color: rgb(var(--color-surface));"
		>
			<ChartContainer
				option={legitimacyChart}
				height="400px"
				title="Legitimacy"
			/>
		</div>
	{/if}

	{#if isDuel}
		<!-- Duel: one table per metric, both players in facing columns. -->
		{#each duelSections as section (section.title)}
			<div
				class="rounded-lg p-4"
				style="background-color: rgb(var(--color-surface));"
			>
				<div class="mb-2 text-[10px] uppercase tracking-wide text-tan">
					{section.title}
				</div>
				<table class="w-full text-xs">
					<thead>
						<tr>
							<td></td>
							{#each breakdowns as b (b.player.label)}
								<td
									class="pb-1 text-right font-bold"
									style="color: {b.player.color};">{b.player.label}</td
								>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each section.rows as row (row.label)}
							<tr>
								<td class="py-0.5 pr-2 text-tan" title={row.detail}>
									{row.label}
								</td>
								{#each row.values as cell (cell.player)}
									<td
										class="py-0.5 text-right font-mono tabular-nums text-gray-200"
									>
										{#if cell.value != null}{signed(
												cell.value,
												section.dp,
											)}{:else}<span class="opacity-40">—</span>{/if}
									</td>
								{/each}
							</tr>
						{/each}
						<tr>
							<td class="py-0.5 pr-2 text-tan" title={section.note}>
								Other <span class="text-[10px] opacity-60">(?)</span>
							</td>
							{#each section.others as cell (cell.player)}
								<td
									class="py-0.5 text-right font-mono tabular-nums {cell.value !=
										null && cell.value < 0
										? 'text-red-400'
										: 'text-gray-200'}"
								>
									{#if cell.value != null}{signed(
											cell.value,
											section.dp,
										)}{:else}<span class="opacity-40">—</span>{/if}
								</td>
							{/each}
						</tr>
						<tr class="border-t border-border-subtle font-bold">
							<td class="py-1 pr-2 text-gray-200">Total</td>
							{#each section.totals as cell (cell.player)}
								<td class="py-1 text-right font-mono tabular-nums text-white">
									{#if cell.value != null}{fmt(
											cell.value,
											section.dp,
										)}{:else}—{/if}
								</td>
							{/each}
						</tr>
					</tbody>
				</table>
			</div>
		{/each}
	{:else}
		<!-- FFA: one card per player. -->
		<div class="grid gap-4 md:grid-cols-2">
			{#each breakdowns as b (b.player.label)}
				<div
					class="rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					<h3 class="mb-3 text-sm font-bold" style="color: {b.player.color};">
						{b.player.label}
					</h3>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<div class="mb-1 text-[10px] uppercase tracking-wide text-tan">
								Orders per turn, at end
							</div>
							{#if b.orders}
								{@render breakdownTable(b.orders, 1, ORDERS_NOTE)}
							{:else}
								<div class="text-xs text-tan opacity-70">no orders data</div>
							{/if}
						</div>
						<div>
							<div class="mb-1 text-[10px] uppercase tracking-wide text-tan">
								Legitimacy, at end
							</div>
							{#if b.legitimacy}
								{@render breakdownTable(b.legitimacy, 0, LEGITIMACY_NOTE)}
							{:else}
								<div class="text-xs text-tan opacity-70">
									no legitimacy data
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
