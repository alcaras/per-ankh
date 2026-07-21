<script lang="ts">
	import { resolve } from "$app/paths";
</script>

<svelte:head>
	<title>Shared link retired — Per Ankh</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="flex flex-1 items-center justify-center p-4">
	<div
		class="w-full max-w-sm rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<h3 class="mb-3 text-base font-bold text-tan">Shared link retired</h3>
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<p class="mb-3 text-xs text-gray-400">
				This link was created by the Per Ankh desktop app, which has been
				retired. Per Ankh is now a web app — upload a save to analyze and share
				it.
			</p>

			<a
				href={resolve("/")}
				class="block w-full rounded border border-brown px-3 py-1.5 text-center text-xs font-semibold text-tan transition-colors hover:bg-brown"
			>
				Go to Per Ankh
			</a>
		</div>
	</div>
</main>
