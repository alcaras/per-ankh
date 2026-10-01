<script lang="ts">
	import { type Snippet } from "svelte";
	import type { ECElementEvent, ChartOption } from "$lib/echarts";
	import Chart from "$lib/Chart.svelte";
	import FullscreenDialog from "$lib/ui/FullscreenDialog.svelte";

	let {
		option,
		height = "400px",
		title = "Chart",
		controls,
		onItemClick,
	}: {
		option: ChartOption;
		height?: string;
		title?: string;
		controls?: Snippet;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onItemClick?: (params: ECElementEvent) => void;
	} = $props();

	let fullscreen = $state(false);
</script>

<!-- Normal view -->
<div class="mb-6">
	{#if controls}
		<div class="mb-4">
			{@render controls()}
		</div>
	{/if}
	<div
		class="relative overflow-hidden rounded-lg"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<!-- Expand button -->
		<button
			onclick={() => (fullscreen = true)}
			class="absolute right-3 top-3 z-10 cursor-pointer rounded bg-black/20 p-1.5 transition-colors hover:bg-black/40 focus:outline-none"
			aria-label="Expand {title} to fullscreen"
			title="Expand to fullscreen"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="block h-4 w-4 text-white"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
				/>
			</svg>
		</button>

		<Chart {option} {height} {onItemClick} />
	</div>
</div>

<!-- Fullscreen dialog (renders in browser's top layer) -->
<FullscreenDialog bind:open={fullscreen}>
	{#if controls}
		<div class="mb-4 flex-shrink-0 rounded-lg bg-black/90 px-4 py-3">
			{@render controls()}
		</div>
	{/if}
	<div
		class="relative min-h-0 flex-1 overflow-hidden rounded-lg"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<!-- Close button -->
		<button
			onclick={() => (fullscreen = false)}
			class="absolute right-3 top-3 z-10 cursor-pointer rounded bg-black/20 p-1.5 transition-colors hover:bg-black/40 focus:outline-none"
			aria-label="Close fullscreen"
			title="Close fullscreen (Esc)"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="block h-4 w-4 text-white"
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
		<Chart {option} height="100%" {onItemClick} />
	</div>
</FullscreenDialog>
