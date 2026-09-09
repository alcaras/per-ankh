<script lang="ts">
	// The season leaderboard's top rows, from the same board /players renders
	// (GET /v1/stats/players over the current season window).
	//
	// Rank is the row's position in the server's order, +1 — the board's own
	// ordering, which settles a tied total on who reached it first. The same
	// rule /players applies, so a player's number is the same on both pages.
	//
	// The whole panel opens that board (it is the home page's only route to it
	// now that the call-to-action bar's Players button is gone), through the
	// stretched-link overlay RecentSaveCard and VideoCard use: two real,
	// non-nested anchors, so a row's profile link still wins its own clicks and
	// both survive middle-click and open-in-new-tab.
	import { resolve } from "$app/paths";
	import type { PlayedGamesRow } from "$lib/api-cloud";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import Panel from "$lib/ui/Panel.svelte";

	let {
		players,
		seasonLabel,
		class: className = "",
	}: {
		players: PlayedGamesRow[];
		seasonLabel: string;
		class?: string;
	} = $props();
</script>

<Panel title="Season Standings · {seasonLabel}" class="relative {className}">
	<a
		href={resolve("/players")}
		class="absolute inset-0 z-10 rounded-lg"
		aria-label="Full leaderboard"
	></a>
	{#if players.length === 0}
		<p class="text-sm text-tan opacity-70">
			No games played this season yet. Upload one and take the top spot.
		</p>
	{:else}
		<ol class="flex flex-col gap-1">
			{#each players as player, i (player.user_id)}
				<li class="flex items-center gap-2 text-sm">
					<span class="w-4 shrink-0 text-right font-bold text-gray-400"
						>{i + 1}</span
					>
					<PlayerAvatar avatarUrl={player.avatar_url} size={20} />
					<ProfileLink
						userId={player.user_id}
						slug={player.slug}
						class="relative z-20 min-w-0 flex-1 truncate text-tan transition-colors hover:text-orange"
					>
						{player.display_name}
					</ProfileLink>
					<span class="shrink-0 font-bold text-bright">{player.total}</span>
				</li>
			{/each}
		</ol>
		<div class="mt-3 flex justify-end">
			<a
				href={resolve("/players")}
				class="relative z-20 text-xs font-semibold text-orange hover:underline"
			>
				Leaderboard
			</a>
		</div>
	{/if}
</Panel>
