<script lang="ts">
	// The board's own rules, in the popover the ⓘ in the crowns panel opens:
	// the cognomen ladder, and the tiebreak that settles a crown. Both were
	// only ever written down in comments — in this file's sibling and in the
	// worker's `stats/handlers` — so the page ranked players by rules no one
	// reading it could see.
	//
	// The rungs come from `./ladder`, the same module the board reads, so the
	// table here can't drift from the cognomens on the rows behind it.
	//
	// Wider than the shared popover's default: the wrapper caps content at
	// 85vh — the viewport's height, not the room below the trigger — so a
	// panel taller than the space under the crowns card runs off the bottom of
	// the window with no scrollbar to reach it (becked/per-ankh#247). Fixing
	// the cap is a change to a component all 18 popovers route through;
	// reflowing to fit inside it is not.
	import Popover from "$lib/ui/Popover.svelte";
	import { cognomenName } from "$lib/utils/formatting";
	import { RUNGS } from "./ladder";

	let open = $state(false);
</script>

<Popover
	bind:open
	ariaLabel="How the board works"
	contentClass="w-[min(92vw,38rem)]"
>
	{#snippet trigger({ props })}
		<button
			{...props}
			type="button"
			class="shrink-0 text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
			aria-label="How the board works"
			title="How the board works"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
		</button>
	{/snippet}

	<div class="space-y-4 text-xs text-tan">
		<section>
			<!-- The leading section's heading carries the close affordance, the way
			     the app's other popover headers do. A row of its own left a band of
			     dead space above the content, and the panel has no title to put
			     there instead. -->
			<div class="mb-1 flex items-center justify-between gap-3">
				<h3 class="text-sm font-bold">Crowns</h3>
				<button
					type="button"
					class="shrink-0 text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
					onclick={() => (open = false)}
					aria-label="Close"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>
			<p class="opacity-80">
				Seasonal crowns go to the player with the most multiplayer games of each
				type. Tiebreaks go to the player who reached the game count first.
			</p>
		</section>

		<section>
			<h3 class="mb-1 text-sm font-bold">Cognomens</h3>
			<p class="mb-2 opacity-80">Earn cognomens by uploading games.</p>
			<table class="w-full">
				<thead>
					<tr class="border-b border-black text-left">
						<th class="w-14 py-1 pr-2 font-bold">Games</th>
						<th class="py-1 font-bold">Cognomen</th>
					</tr>
				</thead>
				<tbody>
					{#each RUNGS as rung (rung.type)}
						<tr class="border-b border-black border-opacity-30 last:border-0">
							<td class="py-1 pr-2 tabular-nums">{rung.games}</td>
							<td class="py-1 italic text-gray-200"
								>{cognomenName(rung.type)}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	</div>
</Popover>
