<script lang="ts">
	// The other Old World tools a visitor here is likely to want: the game's
	// manual and the community's reference, art, puzzle and map-atlas sites.
	//
	// All of them are other people's sites rather than app routes, so every row
	// leaves per-ankh.app in a new tab — the same treatment VideoCard gives an
	// outbound watch URL.
	import { ATLAS_BASE_URL } from "$lib/tournament/map-script-options";
	import Panel from "$lib/ui/Panel.svelte";

	let { class: className = "" }: { class?: string } = $props();

	// Duel Maps is the atlas the tournament map links already deep-link into, so
	// its base URL comes from there rather than being written down a second time.
	const APPS: { label: string; href: string }[] = [
		{
			label: "Manual",
			href: "https://drive.google.com/file/d/1hb4dmDKxpf3pJJtpdFA4y4OOY-d2yrz1/view",
		},
		{ label: "Reference", href: "https://alcaras.github.io/owreference/" },
		{ label: "Art", href: "https://becked.github.io/pinacotheca/" },
		{ label: "Puzzles", href: "https://owpuzzle.fly.dev/" },
		{ label: "FFA Maps", href: "https://alcaras.github.io/owffaatlas/" },
		{ label: "Duel Maps", href: ATLAS_BASE_URL },
	];
</script>

<Panel title="Community Tools" class={className}>
	<!-- eslint-disable svelte/no-navigation-without-resolve -- external sites, not app routes; rel guards tabnabbing + referrer leakage -->
	<ul class="list-disc pl-4 text-[13px] text-tan">
		{#each APPS as app (app.href)}
			<li>
				<a
					href={app.href}
					target="_blank"
					rel="noopener noreferrer"
					class="font-semibold text-orange hover:underline"
				>
					{app.label}
				</a>
			</li>
		{/each}
	</ul>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</Panel>
