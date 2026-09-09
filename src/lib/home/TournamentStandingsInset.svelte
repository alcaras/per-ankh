<script lang="ts">
	// The featured tournament's leaders, as an inset of the home hero panel.
	//
	// Reads `combined_qualifier_ranking` rather than the per-division standings:
	// it spans both divisions in seeding-cascade order, and the divisions' own
	// names ("The New World (Americas)", "The Old World (Europe, Africa, Asia,
	// Oceania)") are far too long to head two columns in half a hero tile.
	//
	// The accepted cost is that a CombinedQualifier carries no user_id and no
	// slug, so these rows can't be profile links the way the standings table's
	// are. The panel links to the tournament instead — which is where a reader
	// following a name wants to end up from here anyway.
	import type { CombinedQualifier } from "$lib/api-cloud";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";

	let { rows }: { rows: CombinedQualifier[] } = $props();
</script>

{#if rows.length > 0}
	<ol class="flex flex-col gap-1">
		{#each rows as row (row.slot_id)}
			<li class="flex items-center gap-2 text-xs">
				<span class="w-4 shrink-0 text-right font-bold text-gray-400"
					>{row.rank}</span
				>
				<PlayerAvatar avatarUrl={row.avatar_url} size={18} />
				<span class="min-w-0 flex-1 truncate text-tan"
					>{row.display_name || "Unclaimed"}</span
				>
				<span class="shrink-0 font-bold text-bright"
					>{row.wins}&ndash;{row.losses}</span
				>
			</li>
		{/each}
	</ol>
{:else}
	<p class="text-xs text-tan opacity-70">Standings open when play begins.</p>
{/if}
