<script lang="ts">
	import { resolve } from "$app/paths";
	import type { UploaderLeaderboardRow } from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Season view is the default — the board that resets, so being behind is
	// never more than a quarter deep. All-time is the career monument.
	let view = $state<"season" | "all">("season");

	// Activity tiers, named with the game's own culture levels (and their
	// in-game icons). Thresholds are absolute counts of games in the selected
	// window — a tier can't be lost to someone else's grinding, and any
	// number of players can be Legendary at once. Product knobs.
	const TIERS = [
		{ min: 50, key: "CULTURE_LEGENDARY", label: "Legendary" },
		{ min: 25, key: "CULTURE_STRONG", label: "Strong" },
		{ min: 10, key: "CULTURE_DEVELOPING", label: "Developing" },
		{ min: 1, key: "CULTURE_WEAK", label: "Weak" },
	] as const;
	const tierOf = (total: number) => TIERS.find((t) => total >= t.min) ?? null;

	type Row = UploaderLeaderboardRow & { other: number };
	const withOther = (rows: UploaderLeaderboardRow[]): Row[] =>
		rows.map((u) => ({
			...u,
			// Everything that isn't a network duel, a cloud duel, or an FFA:
			// single-player, hotseat/LAN, observer archives.
			other: u.total - u.duels_network - u.duels_cloud - u.ffas,
		}));
	const rows = $derived(
		withOther(view === "season" ? data.season : data.allTime),
	);

	// The signed-in viewer's row: highlighted in the table, summarized in the
	// card above it — their tier, distance to the next tier, and the player
	// immediately ahead (the rivalry framing, not the summit).
	const viewerId = $derived(data.user?.user_id ?? null);
	const viewerIndex = $derived(
		viewerId == null ? -1 : rows.findIndex((r) => r.user_id === viewerId),
	);
	const viewer = $derived(viewerIndex >= 0 ? rows[viewerIndex] : null);
	const viewerTier = $derived(viewer ? tierOf(viewer.total) : null);
	const nextTier = $derived.by(() => {
		if (!viewer) return null;
		const above = [...TIERS].reverse().find((t) => t.min > viewer.total);
		return above ? { ...above, needed: above.min - viewer.total } : null;
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
				Season · {data.seasonLabel}
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
		Games uploaded, by player and category. Wins and losses count the same —
		this board measures playing.
	</p>

	{#if viewer && viewerTier}
		<!-- The viewer's own arc, ahead of anyone else's: tier, the next rung,
		     and the one player ahead of them. -->
		<div
			class="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-border-subtle bg-surface p-3 text-sm"
		>
			<span class="flex items-center gap-2 font-bold text-gray-200">
				<SpriteIcon
					category="icons"
					value={viewerTier.key}
					size={18}
					alt={viewerTier.label}
				/>
				You're {viewerTier.label} — {viewer.total}
				{viewer.total === 1 ? "game" : "games"}
				{view === "season" ? "this season" : "all time"}
			</span>
			{#if nextTier}
				<span class="text-tan">{nextTier.needed} more to {nextTier.label}</span>
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
					<th class="{HEADER_CELL} text-left">Tier</th>
					<th class={HEADER_CELL}>Duels (Network)</th>
					<th class={HEADER_CELL}>Duels (Cloud)</th>
					<th class={HEADER_CELL}>FFAs</th>
					<th class={HEADER_CELL}>Other</th>
					<th class={HEADER_CELL}>Total</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as u, i (u.user_id)}
					{@const tier = tierOf(u.total)}
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
						</td>
						<td class="bg-surface px-3 py-2 text-left">
							{#if tier}
								<span class="flex items-center gap-1.5 text-xs text-tan">
									<SpriteIcon
										category="icons"
										value={tier.key}
										size={14}
										alt={tier.label}
									/>
									{tier.label}
								</span>
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
