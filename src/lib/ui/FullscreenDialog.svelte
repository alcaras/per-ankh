<script lang="ts">
	// A modal <dialog> over the viewport, in the browser's top layer: a chart's
	// fullscreen view (ChartContainer) and the map view's lightboxes. It
	// animates in and out, and closes on Escape, on a click on the backdrop, or
	// when the caller sets `open` false (its close button).
	import { untrack, type Snippet } from "svelte";

	let {
		open = $bindable(false),
		dialog = $bindable(null),
		onclose,
		children,
	}: {
		// Setting it false closes the dialog, animated. It turns false by itself
		// when Escape or the backdrop closes the dialog.
		open?: boolean;
		// The <dialog> element. A modal dialog makes everything outside it
		// inert, so content that portals (bits-ui portals to body) has to
		// portal into this instead.
		dialog?: HTMLDialogElement | null;
		// Called once the dialog has closed, however it was closed.
		onclose?: () => void;
		children: Snippet;
	} = $props();

	let isClosing = $state(false);

	const ANIMATION_DURATION = 200; // ms - keep in sync with CSS

	$effect(() => {
		const shouldOpen = open;
		if (!dialog) return;
		if (shouldOpen && !dialog.open) dialog.showModal();
		else if (!shouldOpen && dialog.open) untrack(closeAnimated);
	});

	function closeAnimated() {
		if (!dialog || isClosing) return;

		// Add closing class to trigger exit animation
		isClosing = true;

		// Wait for animation to complete before actually closing
		setTimeout(() => {
			dialog?.close();
			isClosing = false;
		}, ANIMATION_DURATION);
	}

	function handleDialogClose() {
		// Remove focus from the button that triggered the dialog
		// to prevent the blue focus outline on it
		// This handles all close methods: button click, Escape key, backdrop click
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		open = false;
		onclose?.();
	}

	function handleBackdropClick(event: MouseEvent) {
		// Close if clicking the dialog backdrop (not the content)
		if (event.target === dialog) {
			open = false;
		}
	}
</script>

<!-- Renders in the browser's top layer -->
<dialog
	bind:this={dialog}
	onclick={handleBackdropClick}
	onclose={handleDialogClose}
	class="fullscreen-dialog {isClosing ? 'closing' : ''}"
>
	<div class="dialog-content">
		{@render children()}
	</div>
</dialog>

<style>
	.fullscreen-dialog {
		/* Reset default dialog styles */
		border: none;
		padding: 0;
		background: transparent;
		max-width: none;
		max-height: none;
		width: 100vw;
		height: 100vh;
		/* Remove focus outline - dialog doesn't need visual focus indication */
		outline: none;
	}

	/* Explicitly set display based on open state to fix WebKitGTK compositor issue.
     Without this, the unconditional display:flex overrides the browser's default
     display:none for closed dialogs, causing compositor layer leakage on Linux.
     See: https://github.com/anthropics/per-ankh/issues/8 */
	.fullscreen-dialog:not([open]) {
		display: none;
	}

	.fullscreen-dialog[open] {
		display: flex;
		align-items: center;
		justify-content: center;
		/* Opening animation */
		animation: dialogFadeIn 0.2s ease-out;
	}

	.fullscreen-dialog[open] .dialog-content {
		animation: dialogZoomIn 0.2s ease-out;
	}

	.fullscreen-dialog[open]::backdrop {
		animation: backdropFadeIn 0.2s ease-out;
	}

	/* Closing animation */
	.fullscreen-dialog.closing {
		animation: dialogFadeOut 0.2s ease-in forwards;
	}

	.fullscreen-dialog.closing .dialog-content {
		animation: dialogZoomOut 0.2s ease-in forwards;
	}

	.fullscreen-dialog.closing::backdrop {
		animation: backdropFadeOut 0.2s ease-in forwards;
	}

	@keyframes dialogFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes dialogFadeOut {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	@keyframes dialogZoomIn {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	@keyframes dialogZoomOut {
		from {
			opacity: 1;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(0.95);
		}
	}

	@keyframes backdropFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes backdropFadeOut {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	.fullscreen-dialog::backdrop {
		background: rgb(var(--color-black) / 0.8);
	}

	.dialog-content {
		position: relative;
		width: 95vw;
		height: 90vh;
		max-width: 95vw;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
	}
</style>
