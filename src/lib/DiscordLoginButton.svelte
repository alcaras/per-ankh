<script lang="ts">
	// The Discord OAuth round-trip, as a button. A signed-out home page renders
	// two of these — the header's compact Login chip and the hero band's blurple
	// call to action — so the handler and its redirecting/error state live here
	// instead of being copied into each. Callers bring their own styling via
	// `class` and any leading icon as children; the label is all that differs in
	// markup.
	//
	// `next` returns the viewer to the page they launched from, so this works on
	// every route the header rides on, not just home.
	import type { Snippet } from "svelte";
	import { page } from "$app/state";
	import { cloudApi, ApiError } from "$lib/api-cloud";
	import { resolveLoginNext } from "$lib/utils/safe-next";

	let {
		label,
		class: className = "",
		children,
	}: {
		label: string;
		class?: string;
		// Rendered ahead of the label — the hero's Discord logo. The header's
		// chip passes none.
		children?: Snippet;
	} = $props();

	let signingIn = $state(false);
	let loginError = $state<string | null>(null);

	async function handleSignIn() {
		signingIn = true;
		loginError = null;
		try {
			const redirectUri = `${window.location.origin}/auth/callback`;
			const next = resolveLoginNext(page.url);
			const { authorize_url } = await cloudApi.discordStart(redirectUri, next);
			window.location.href = authorize_url;
		} catch (err) {
			signingIn = false;
			loginError =
				err instanceof ApiError
					? `${err.code ?? err.status}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Login failed";
		}
	}
</script>

<!-- A failed OAuth start leaves the button pressable, so the error rides along
     as the tooltip rather than earning layout of its own. -->
<button
	type="button"
	onclick={handleSignIn}
	disabled={signingIn}
	class={className}
	title={loginError ?? undefined}
>
	{@render children?.()}
	{signingIn ? "Redirecting…" : label}
</button>
