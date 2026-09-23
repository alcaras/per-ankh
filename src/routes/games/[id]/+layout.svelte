<script lang="ts">
	// Spans both views of a game (analysis and map) so the one piece of state
	// they share — the owner's visibility toggle — survives a switch between
	// them (see visibility-context). Each page renders its own header; this
	// layout renders only its children.
	import { untrack, type Snippet } from "svelte";
	import {
		GameVisibility,
		setGameVisibility,
	} from "$lib/game-detail/visibility-context.svelte";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Read from the server-injected `is_public` field on owner responses.
	// Initialised at component construction (not in $effect) so the SSR'd HTML
	// renders the correct toggle position; $effect doesn't run during SSR.
	// Public viewers don't see the toggle.
	// svelte-ignore state_referenced_locally
	const visibility = setGameVisibility(
		new GameVisibility(data.game.is_public ?? false),
	);

	// Re-sync when the route navigates to a different game. Only the match id
	// is tracked; the body reads via untrack(). This avoids clobbering an
	// in-flight optimistic visibility toggle if the layout is revalidated for
	// the same game (e.g. invalidateAll() from a rename) — the new server
	// `is_public` would race the optimistic flip.
	$effect(() => {
		data.game.game_details.match_id;
		untrack(() => {
			visibility.isPublic = data.game.is_public ?? false;
		});
	});
</script>

{@render children()}
