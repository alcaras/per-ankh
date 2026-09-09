<script lang="ts">
	// The featured tournament's next sittings, as an inset of the home hero
	// panel: the ones live right now, then the next few still ahead.
	//
	// Live-first, matching the tournament overview's own Live & Upcoming panel —
	// and through the same definition (liveAndUpcoming), so what counts as live
	// can't drift between the two. A match split across days contributes one row
	// per sitting. No horizon: the next few by time, however far out they are,
	// because "nothing scheduled" and "nothing scheduled this week" are different
	// claims and only the first is worth a panel's silence.
	//
	// Occupant names come from the standings maps rather than the match payload:
	// a pending match's slot_a_display_name / slot_b_display_name are NULL (the
	// snapshot is taken at report time), which is exactly the case
	// matchSlotDisplayName's live fallback covers.
	import type { TournamentMatch } from "$lib/api-cloud";
	import { nowMs } from "$lib/stores/now.svelte";
	import { clockFaceIs12Hour } from "$lib/stores/clock-face.svelte";
	import {
		matchSlotAvatarUrl,
		matchSlotDisplayName,
	} from "$lib/tournament/match-occupant";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import { liveAndUpcoming } from "$lib/tournament/schedule";
	import type { SlotMaps } from "$lib/tournament/slot-identity";
	import { formatScheduledInZone } from "$lib/utils/formatting";

	let { matches, slots }: { matches: TournamentMatch[]; slots: SlotMaps } =
		$props();

	// Upcoming sittings previewed here — one, because the inset is sized to give
	// the tile back to the art. Live ones are still never capped: a match being
	// played right now is the most time-sensitive thing this panel has.
	const MAX_UPCOMING = 1;

	// Reactive via nowMs(): a sitting crosses upcoming → live → gone as the
	// clock advances, without a refetch.
	const split = $derived(liveAndUpcoming(matches, nowMs()));
	const rows = $derived([
		...split.live.map((np) => ({ np, live: true })),
		...split.upcoming.slice(0, MAX_UPCOMING).map((np) => ({ np, live: false })),
	]);

	// The viewer's own clock only, unlike the tournament pages' UTC-primary
	// rendering: this is a glance surface, and the zone a reader can act on
	// without converting is their own. Absolute, not relative, because "in 1 day"
	// is what a reader has to translate and the exact instant is what they came
	// for.
	const use12Hour = $derived(clockFaceIs12Hour());

	function side(m: TournamentMatch, s: "a" | "b"): string {
		return matchSlotDisplayName(m, s, slots.labels) ?? "TBD";
	}
</script>

{#if rows.length > 0}
	<ul class="flex flex-col gap-1">
		{#each rows as { np, live } (np.match.match_id + ":" + np.partNumber)}
			<li class="text-[11px]">
				<div class="flex items-center gap-1">
					{#if live}
						<span
							class="shrink-0 rounded bg-orange px-1 text-[9px] font-bold text-black"
							>LIVE</span
						>
					{/if}
					<PlayerAvatar
						avatarUrl={matchSlotAvatarUrl(np.match, "a", slots.avatars)}
						size={14}
					/>
					<span class="min-w-0 truncate text-tan">{side(np.match, "a")}</span>
					<span class="shrink-0 text-gray-400">v</span>
					<PlayerAvatar
						avatarUrl={matchSlotAvatarUrl(np.match, "b", slots.avatars)}
						size={14}
					/>
					<span class="min-w-0 truncate text-tan">{side(np.match, "b")}</span>
				</div>
				<p class="text-[10px] text-gray-400">
					{formatScheduledInZone(
						np.part.scheduled_at,
						"local",
						use12Hour,
					)}{#if np.split}
						&middot; Part {np.partNumber}{/if}
				</p>
			</li>
		{/each}
	</ul>
{:else}
	<p class="text-[11px] text-tan opacity-70">No matches scheduled right now.</p>
{/if}
