<script lang="ts">
	// The copy-to-clipboard glyph, for the icon form of CopyButton. One path, so
	// every copy affordance in the app offers the same picture — this was
	// hand-pasted into the account page, the match popover and the suggested
	// opponents card, and a fourth copy arrived drawing a different icon
	// altogether before anyone noticed the first three were meant to match.
	//
	// Sized by the caller (`class`), coloured by `currentColor`, and decorative:
	// every call site is a button that already names itself.
	let { class: className = "h-3.5 w-3.5" }: { class?: string } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	class={className}
	fill="none"
	viewBox="0 0 24 24"
	stroke="currentColor"
	stroke-width="2"
	aria-hidden="true"
>
	<path
		stroke-linecap="round"
		stroke-linejoin="round"
		d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
	/>
</svg>
