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
		legitimacyEndBreakdown,
		ordersEndBreakdown,
		type EndBreakdown,
	} from "./orders";
	import {
		createLegitimacyChartOption,
		createYieldChartOption,
		dynastyLeaders,
		findByPlayer,
		ownedByPlayer,
	} from "./helpers";
	import type { DetailPlayer } from "./helpers";
	import SpriteIcon from "./SpriteIcon.svelte";
	import { formatEnum } from "$lib/utils/formatting";

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
	// One string per metric, annotating that breakdown's "Other" row on every
	// nation panel.
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

	// The itemization sits in the same recessed subpanel the Economy tab's
	// ledgers use (BuildComparison), so a list reads as a list wherever it
	// appears on the page.
	const LIST_PANEL =
		"overflow-hidden rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-1.5";

	const fmt = (v: number, dp: number): string =>
		(v < 0 ? "−" : "") + Math.abs(v).toFixed(dp);
	// Every contribution row carries its sign — a cognomen can cost legitimacy
	// (COGNOMEN_BLOODY is −100) and the remainder runs either way. Totals use
	// plain `fmt`.
	const signed = (v: number, dp: number): string =>
		(v < 0 ? "" : "+") + fmt(v, dp);

	// ─── Sections ─────────────────────────────────────────────────────
	// The two itemizations a nation panel stacks, in render order. One entry
	// each, so the heading, precision, footnote and empty state can't drift
	// apart from the breakdown they describe.
	const SECTIONS = [
		{
			title: "Ending Orders",
			icon: "YIELD_ORDERS",
			dp: 1,
			note: ORDERS_NOTE,
			empty: "no orders data",
			pick: (b: PlayerBreakdown) => b.orders,
		},
		{
			title: "Ending Legitimacy",
			icon: "YIELD_LEGITIMACY",
			dp: 0,
			note: LEGITIMACY_NOTE,
			empty: "no legitimacy data",
			pick: (b: PlayerBreakdown) => b.legitimacy,
		},
	];
</script>

{#snippet sectionHeading(title: string, icon: string)}
	<span
		class="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-tan"
	>
		{title}
		<SpriteIcon
			category="yields"
			value={icon}
			size={14}
			alt={formatEnum(icon, "YIELD_")}
		/>
	</span>
{/snippet}

{#snippet breakdownTable(b: EndBreakdown, dp: number, otherNote: string)}
	<div class={LIST_PANEL}>
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
	</div>
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

	<!-- One panel per nation, whatever the player count. -->
	<div class="grid gap-4 md:grid-cols-2">
		{#each breakdowns as b (b.player.label)}
			<div
				class="rounded-lg p-4"
				style="background-color: rgb(var(--color-surface));"
			>
				<h3 class="mb-3 text-sm font-bold" style="color: {b.player.color};">
					{b.player.label}
				</h3>
				<!-- Stacked, not side-by-side: the two itemizations have unrelated
				     row counts, so facing columns leave whichever is shorter
				     trailing dead space down its half of the panel. -->
				<div class="space-y-4">
					{#each SECTIONS as section (section.title)}
						{@const bd = section.pick(b)}
						<div>
							<div class="mb-1">
								{@render sectionHeading(section.title, section.icon)}
							</div>
							{#if bd}
								{@render breakdownTable(bd, section.dp, section.note)}
							{:else}
								<div class="text-xs text-tan opacity-70">{section.empty}</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
