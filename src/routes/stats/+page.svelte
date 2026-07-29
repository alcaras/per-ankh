<script lang="ts">
	import { resolve } from "$app/paths";
	import type { PlayedGamesRow } from "$lib/api-cloud";
	import { COGNOMEN_LADDER } from "$lib/generated/cognomens";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Dynasty (the season) is the default — the board that resets, so being
	// behind is never more than a quarter deep. All-time is the career
	// monument.
	let view = $state<"season" | "all">("season");

	// Activity epithets from the game's own cognomen ladder ("the New" →
	// "the Great"): each rung is a games-played threshold in the selected
	// window. Absolute thresholds — an epithet can't be lost to someone
	// else's grinding, and any number of players can share one. The
	// thresholds are product knobs; the names and their order are the
	// game's (cognomen.xml, ascending legitimacy).
	const RUNGS: { games: number; type: string }[] = [
		{ games: 1, type: "COGNOMEN_NEW" },
		{ games: 5, type: "COGNOMEN_FOUNDER" },
		{ games: 10, type: "COGNOMEN_AMBITIOUS" },
		{ games: 20, type: "COGNOMEN_VALIANT" },
		{ games: 35, type: "COGNOMEN_MIGHTY" },
		{ games: 50, type: "COGNOMEN_VICTORIOUS" },
		{ games: 75, type: "COGNOMEN_WISE" },
		{ games: 100, type: "COGNOMEN_GLORIOUS" },
		{ games: 150, type: "COGNOMEN_MAGNIFICENT" },
		{ games: 200, type: "COGNOMEN_GREAT" },
	];
	const cognomenName = (type: string): string =>
		COGNOMEN_LADDER.find((c) => c.type === type)?.name ?? "";
	const epithetOf = (total: number): string | null => {
		const rung = [...RUNGS].reverse().find((r) => total >= r.games);
		return rung ? cognomenName(rung.type) : null;
	};

	type Row = PlayedGamesRow & { other: number };
	const withOther = (rows: PlayedGamesRow[]): Row[] =>
		rows.map((u) => ({
			...u,
			// Everything that isn't a network duel, a cloud duel, or an FFA:
			// single-player and hotseat/LAN.
			other: u.total - u.duels_network - u.duels_cloud - u.ffas,
		}));
	const rows = $derived(
		withOther(view === "season" ? data.season : data.allTime),
	);

	// The signed-in viewer's row: highlighted in the table, summarized in the
	// card above it — their epithet, the games to the next one, and the
	// player immediately ahead (the rivalry framing, not the summit).
	const viewerId = $derived(data.user?.user_id ?? null);
	const viewerIndex = $derived(
		viewerId == null ? -1 : rows.findIndex((r) => r.user_id === viewerId),
	);
	const viewer = $derived(viewerIndex >= 0 ? rows[viewerIndex] : null);
	const viewerEpithet = $derived(viewer ? epithetOf(viewer.total) : null);
	const nextRung = $derived.by(() => {
		if (!viewer) return null;
		const above = RUNGS.find((r) => r.games > viewer.total);
		return above
			? { name: cognomenName(above.type), needed: above.games - viewer.total }
			: null;
	});
	const rival = $derived(viewerIndex > 0 ? rows[viewerIndex - 1] : null);

	const num = (n: number) => (n === 0 ? "—" : n.toLocaleString());

	const TOGGLE_BASE =
		"rounded px-3 py-1 text-xs font-semibold transition-colors";
	const HEADER_CELL =
		"whitespace-nowrap px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-100";
	const CELL = "px-3 py-2 text-right tabular-nums text-tan";
</script>

<svelte:head>
	<title>Stats — Per Ankh</title>
</svelte:head>

<main class="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 pb-10 pt-6">
	<div class="mb-1 flex items-baseline justify-between gap-3">
		<h1 class="text-2xl font-bold text-gray-200">Stats</h1>
		<div class="flex rounded-lg bg-surface-sunken p-1">
			<button
				type="button"
				class="{TOGGLE_BASE} {view === 'season'
					? 'bg-surface text-orange'
					: 'text-tan hover:text-orange'}"
				onclick={() => (view = "season")}
			>
				{data.dynastyLabel} · {data.dynastyRange}
			</button>
			<button
				type="button"
				class="{TOGGLE_BASE} {view === 'all'
					? 'bg-surface text-orange'
					: 'text-tan hover:text-orange'}"
				onclick={() => (view = "all")}
			>
				All time
			</button>
		</div>
	</div>
	<p class="mb-5 text-sm text-tan">
		Games played, by player and category. Wins and losses count the same, and
		any player's upload counts for everyone who played in it.
	</p>

	{#if viewer && viewerEpithet}
		<!-- The viewer's own arc, ahead of anyone else's: epithet, the next
		     rung, and the one player ahead of them. -->
		<div
			class="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg border border-border-subtle bg-surface p-3 text-sm"
		>
			<span class="font-bold text-gray-200">
				{viewer.display_name}
				<span class="font-semibold italic text-orange">{viewerEpithet}</span>
				— {viewer.total}
				{viewer.total === 1 ? "game" : "games"}
				{view === "season" ? `this dynasty` : "all time"}
			</span>
			{#if nextRung}
				<span class="text-tan"
					>{nextRung.needed} more to become {nextRung.name}</span
				>
			{/if}
			{#if rival}
				<span class="text-tan"
					>{rival.total - viewer.total === 0
						? `tied with ${rival.display_name}`
						: `${rival.total - viewer.total} behind ${rival.display_name}`}</span
				>
			{/if}
		</div>
	{/if}

	<div class="overflow-x-auto rounded-lg bg-blue-gray p-3">
		<table class="w-full border-separate border-spacing-y-1.5">
			<thead>
				<tr>
					<th class="{HEADER_CELL} text-left">#</th>
					<th class="{HEADER_CELL} text-left">Player</th>
					<th class={HEADER_CELL}>Duels (Network)</th>
					<th class={HEADER_CELL}>Duels (Cloud)</th>
					<th class={HEADER_CELL}>FFAs</th>
					<th class={HEADER_CELL}>Other</th>
					<th class={HEADER_CELL}>Total</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as u, i (u.user_id)}
					{@const epithet = epithetOf(u.total)}
					{@const you = u.user_id === viewerId}
					<tr class="group">
						<td
							class="{CELL} rounded-l-lg bg-surface text-left {you
								? 'border-l-2 border-orange'
								: ''}">{i + 1}</td
						>
						<td class="bg-surface px-3 py-2 text-left">
							<a
								href={resolve(`/users/${u.user_id}`)}
								class="font-semibold {you
									? 'text-orange'
									: 'text-gray-200'} transition-colors hover:text-orange"
								>{u.display_name}</a
							>
							{#if epithet}
								<span class="text-xs italic text-tan">{epithet}</span>
							{/if}
						</td>
						<td class="{CELL} bg-surface">{num(u.duels_network)}</td>
						<td class="{CELL} bg-surface">{num(u.duels_cloud)}</td>
						<td class="{CELL} bg-surface">{num(u.ffas)}</td>
						<td class="{CELL} bg-surface">{num(u.other)}</td>
						<td class="{CELL} rounded-r-lg bg-surface font-bold text-gray-200"
							>{u.total}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</main>
