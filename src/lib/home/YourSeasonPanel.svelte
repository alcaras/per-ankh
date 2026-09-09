<script lang="ts">
	// The signed-in viewer's own line on the season board, beside the board
	// itself — read from the same fetch, so the two panels can't disagree.
	//
	// Designed around the zero-games state, which is the ordinary one: a season
	// runs three months, so most signed-in visitors have no games in the one that
	// just started, and this panel is there to make the first game look close. It
	// never renders as an apology — it shows what the next rung of the cognomen
	// ladder costs and how far along the bar you already are.
	//
	// Plain props rather than the route's own types: the season window and the
	// cognomen ladder are defined beside /players, and nothing under $lib reaches
	// into src/routes. `+page.ts` does that derivation and hands the results
	// across as values.
	import StatTile from "$lib/StatTile.svelte";
	import Panel from "$lib/ui/Panel.svelte";

	let {
		rank,
		games,
		allTimeGames,
		winRate,
		cognomen,
		seasonLabel,
		seasonUntil,
		class: className = "",
	}: {
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
		seasonLabel: string;
		// The season window's exclusive end (YYYY-MM-DD). The day before it is
		// the last day the board counts.
		seasonUntil: string;
		class?: string;
	} = $props();

	// `seasonUntil` is always a YYYY-MM-01, so it parses as UTC midnight; one day
	// back from it is the day the board closes. Rendered in UTC because the
	// window itself is a UTC date range, not an instant in the viewer's day.
	const endsOn = $derived(
		new Date(Date.parse(seasonUntil) - 24 * 60 * 60 * 1000).toLocaleDateString(
			undefined,
			{ timeZone: "UTC", month: "short", day: "numeric" },
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
</script>

<Panel title="Your season" class={className}>
	<div class="grid grid-cols-2 gap-2">
		<StatTile label="Rank">
			{rank == null ? "Unranked" : `#${rank}`}
		</StatTile>
		<StatTile label="Games this season">{games}</StatTile>
		<StatTile label="Games all time">{allTimeGames ?? "—"}</StatTile>
		<StatTile label="Win rate">
			{winRate == null ? "—" : `${Math.round(winRate * 100)}%`}
		</StatTile>
	</div>

	<div class="mt-3">
		<p class="text-sm text-tan">
			{#if cognomen.next}
				{cognomen.next.remaining}
				{cognomen.next.remaining === 1 ? "game" : "games"} to earn
				<span class="font-bold text-bright">{cognomen.next.name}</span>
			{:else}
				You hold
				<span class="font-bold text-bright">{cognomen.current}</span>, the top
				of the ladder.
			{/if}
		</p>
		<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/40">
			<div
				class="h-full rounded-full bg-orange"
				style="width: {progress}%"
			></div>
		</div>
		<p class="mt-1.5 text-xs text-gray-400">
			{#if cognomen.current}
				<span class="font-bold text-tan">{cognomen.current}</span>
				&middot;
			{/if}
			{seasonLabel} ends {endsOn}
		</p>
	</div>
</Panel>
