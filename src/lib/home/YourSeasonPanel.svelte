<script lang="ts">
	// The signed-in viewer's own line on the season board, beside the board
	// itself — read from the same fetch, so the two panels can't disagree.
	//
	// Designed around the zero-games state, which is the ordinary one: a season
	// runs three months, so most signed-in visitors have no games in the one that
	// just started, and this panel is there to make the first game look close. It
	// never renders as an apology — it leads with the viewer's own name and
	// title, and shows what the next rung of the cognomen ladder costs and how
	// far along the bar you already are.
	//
	// Plain props rather than the route's own types: the season window and the
	// cognomen ladder are defined beside /players, and nothing under $lib reaches
	// into src/routes. `+page.ts` does that derivation and hands the results
	// across as values.
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import Panel from "$lib/ui/Panel.svelte";
	import { formatDate } from "$lib/utils/formatting";

	let {
		displayName,
		avatarUrl,
		rank,
		games,
		allTimeGames,
		winRate,
		cognomen,
		seasonUntil,
	}: {
		displayName: string;
		avatarUrl: string;
		// Position on the season board, or null for a player with no games in it
		// — they are not on the board, so they have no rank on it.
		rank: number | null;
		games: number;
		// All-time totals, which the season window can't answer. Null when the
		// profile read failed.
		allTimeGames: number | null;
		winRate: number | null;
		// Where the viewer stands on the cognomen ladder. `current` is null below
		// the first rung; `next` is null at the top of it.
		cognomen: {
			current: string | null;
			next: { name: string; games: number; remaining: number } | null;
		};
		// The season window's exclusive end (YYYY-MM-DD). The day before it is
		// the last day the board counts.
		seasonUntil: string;
	} = $props();

	// `seasonUntil` is always a YYYY-MM-01, so it parses as UTC midnight; one day
	// back from it is the day the board closes. Rendered in UTC because the
	// window itself is a UTC date range, not an instant in the viewer's day —
	// which is also why it renders as a plain date rather than a localized one.
	const endsOn = $derived(
		formatDate(
			new Date(Date.parse(seasonUntil) - 24 * 60 * 60 * 1000).toISOString(),
		),
	);

	// Progress toward the next rung, as a share of its threshold. The rungs sit
	// on the triangular numbers, so early on the bar moves a long way per game —
	// which is the true shape of the ladder, not flattery.
	const progress = $derived(
		cognomen.next
			? Math.min(100, Math.round((games / cognomen.next.games) * 100))
			: 100,
	);

	// Label/value rows under the card — the three totals the card has no room
	// for. The season's own number is not among them: the card shows it in
	// large type already.
	const rows = $derived([
		{
			label: "All-time games",
			value: allTimeGames == null ? "—" : `${allTimeGames}`,
		},
		{
			label: "Win rate, all time",
			value: winRate == null ? "—" : `${Math.round(winRate * 100)}%`,
		},
		{ label: "Season ends", value: endsOn },
	]);
</script>

<Panel title="Your season" class="flex h-full flex-col">
	<div class="rounded-lg bg-surface-raised p-3">
		<div class="flex items-center gap-3">
			<div class="min-w-0 flex-1">
				<p class="flex flex-wrap items-center gap-x-2">
					<PlayerAvatar {avatarUrl} size={20} />
					<span class="truncate text-lg font-bold text-bright"
						>{displayName}</span
					>
					{#if cognomen.current}
						<span class="truncate text-sm italic text-gray-400">
							{cognomen.current}
						</span>
					{/if}
				</p>
				<p class="mt-0.5 text-xs text-gray-400">
					{rank == null ? "Unranked" : `#${rank}`}
				</p>
			</div>
			<div class="shrink-0 text-right">
				<p class="text-2xl font-bold leading-none text-bright">{games}</p>
				<p
					class="mt-1 text-[10px] font-bold uppercase tracking-wide text-gray-400"
				>
					Games
				</p>
			</div>
		</div>

		<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-black/40">
			<div
				class="h-full rounded-full bg-orange"
				style="width: {progress}%"
			></div>
		</div>

		<p class="mt-2 text-sm text-tan">
			{#if cognomen.next}
				{cognomen.next.remaining}
				{cognomen.next.remaining === 1 ? "game" : "games"} to reach
				<span class="italic">{cognomen.next.name}</span>
			{:else}
				You hold {cognomen.current}, the top of the ladder.
			{/if}
		</p>
	</div>

	<!-- The panel is as tall as the season board beside it, and `mt-auto` spends
	     that slack above the list rather than below it, so the last row sits on
	     the panel's foot. -->
	<dl class="mt-auto pt-3">
		{#each rows as row (row.label)}
			<div
				class="flex items-center justify-between gap-3 border-t border-border-subtle py-2 first:border-t-0"
			>
				<dt class="text-sm text-tan">{row.label}</dt>
				<dd class="text-sm font-bold text-bright">{row.value}</dd>
			</div>
		{/each}
	</dl>
</Panel>
