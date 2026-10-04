<script lang="ts">
	// The "done" tick — CopyButton's confirmation in its icon form, paired with
	// CopyMark. Shared for the same reason: three hand-pasted copies of one
	// path, which happened to agree and had nothing keeping them that way.
	//
	// Sized by the caller (`class`), coloured by `currentColor`, and decorative:
	// the button it sits in already names itself. That name does not change when
	// the copy lands — in CopyButton's icon form the tick is the only feedback,
	// which is why it has to be the tick everyone else draws.
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
	<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
</svg>
