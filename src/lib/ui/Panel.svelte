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
		icon,
		class: className = "",
		children,
	}: {
		title: string;
		// Optional leading icon (typically a <SpriteIcon size={20} />), rendered
		// in the heading before the title.
		icon?: Snippet;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<section class="rounded-lg bg-surface p-3 {className}">
	<h2 class="mb-3 flex items-center gap-2 text-base font-bold text-tan">
		{@render icon?.()}
		{title}
	</h2>
	{@render children()}
</section>
