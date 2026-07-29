<script lang="ts">
	import { resolve } from "$app/paths";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// `other` = everything that isn't a network duel, a cloud duel, or an
	// FFA: single-player, hotseat/LAN, observer archives.
	const rows = $derived(
		data.uploaders.map((u) => ({
			...u,
			other: u.total - u.duels_network - u.duels_cloud - u.ffas,
		})),
	);

	const HEADER_CELL =
		"whitespace-nowrap px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-100";
	const CELL = "px-3 py-2 text-right tabular-nums text-tan";
</script>

<svelte:head>
	<title>Stats — Per Ankh</title>
</svelte:head>

<main class="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 pb-10 pt-6">
	<h1 class="mb-1 text-2xl font-bold text-gray-200">Stats</h1>
	<p class="mb-5 text-sm text-tan">Games uploaded, by player and category.</p>

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
					<tr class="group">
						<td class="{CELL} rounded-l-lg bg-surface text-left">{i + 1}</td>
						<td class="bg-surface px-3 py-2 text-left">
							<a
								href={resolve(`/users/${u.user_id}`)}
								class="font-semibold text-gray-200 transition-colors hover:text-orange"
								>{u.display_name}</a
							>
						</td>
						<td class="{CELL} bg-surface">{u.duels_network}</td>
						<td class="{CELL} bg-surface">{u.duels_cloud}</td>
						<td class="{CELL} bg-surface">{u.ffas}</td>
						<td class="{CELL} bg-surface">{u.other}</td>
						<td class="{CELL} rounded-r-lg bg-surface font-bold text-gray-200"
							>{u.total}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</main>
