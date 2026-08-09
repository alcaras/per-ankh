<script lang="ts">
	// Titled section chrome: lifts a group of cards off the page background.
	// `surface` sits between the page (`blue-gray`) and the `surface-raised`
	// cards inside, so the panel reads as a tray the cards rest on. Placement —
	// grid order/span, or `flex flex-col` when a child has to stretch to the
	// panel's height — comes from the caller via `class`, because the panel is
	// the grid item wherever it's used.
	import type { Snippet } from "svelte";

	let {
		title,
		class: className = "",
		children,
	}: { title: string; class?: string; children: Snippet } = $props();
</script>

<section class="rounded-lg bg-surface p-3 {className}">
	<h2 class="mb-3 text-base font-bold text-tan">{title}</h2>
	{@render children()}
</section>
