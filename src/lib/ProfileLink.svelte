<script lang="ts">
	// Null-safe profile link: wraps its children in an anchor to the player's
	// profile when `userId` resolves, and renders them **bare** when it doesn't.
	//
	// Nullability is the normal case, not the exception — unclaimed slots, byes,
	// TBD feeder cells and free-text casters all carry a null user_id, and the
	// ~10 tournament surfaces that name a player would otherwise each hand-roll
	// the same conditional. Rendering children unwrapped (rather than in a dead
	// anchor or a substitute span) is what keeps an unlinked surface pixel-
	// identical to what it rendered before there were any links: `class` styles
	// the anchor only, so keep layout that must survive the null case on the
	// caller's own wrapper and give this the classes the link itself needs.
	import type { Snippet } from "svelte";
	import { profileHref } from "$lib/utils/profile-href";

	let {
		userId,
		slug = null,
		class: className = "",
		title,
		ariaLabel,
		onclick,
		children,
	}: {
		userId: string | null;
		// The same user's claimed profile slug, when the caller's payload
		// carries one — it decides `/u/<slug>` vs. the id permalink. Two props
		// rather than one identity object because most callers hold a bare id
		// resolved from a map (slot → user_id) and not a row; omitting it is
		// always safe (the id URL 308-redirects). It must describe the SAME
		// user as `userId`.
		slug?: string | null;
		// Applied to the anchor only (see above) — the unlinked branch renders
		// children unwrapped.
		class?: string;
		title?: string;
		ariaLabel?: string;
		// Row-click surfaces pass `(e) => e.stopPropagation()` so following the
		// link doesn't also fire the row handler; the header menu passes its close.
		// eslint-disable-next-line no-unused-vars -- documentary param name
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	} = $props();
</script>

{#if userId === null}
	{@render children()}
{:else}
	<!-- profileHref() returns a resolve() result; the rule can't see through the
	     call, and this is the one place the app builds a profile anchor. -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a
		href={profileHref({ user_id: userId, slug })}
		class={className}
		{title}
		aria-label={ariaLabel}
		{onclick}
	>
		{@render children()}
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{/if}
