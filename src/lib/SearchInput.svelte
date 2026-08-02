<script lang="ts">
	let {
		value = $bindable(""),
		placeholder = "Search",
		variant = "light",
		class: className = "",
		style = "",
		autofocus = false,
		clearable = false,
	}: {
		value?: string;
		placeholder?: string;
		variant?: "light" | "dark" | "field";
		class?: string;
		style?: string;
		autofocus?: boolean;
		// Show a clear (×) button at the right edge whenever the field holds a
		// value. Opt-in so the surfaces that don't want one keep their chrome
		// exactly as it is. The right-edge padding is reserved whenever this is
		// set, not only while the button shows, so typing the first character
		// doesn't shift the text.
		clearable?: boolean;
	} = $props();

	let inputEl = $state<HTMLInputElement | null>(null);
	$effect(() => {
		if (autofocus) inputEl?.focus();
	});

	const variantStyles = {
		light: {
			icon: "text-gray-400",
			input: "py-2 border-2 border-black rounded bg-white text-black text-sm",
			bg: "",
		},
		dark: {
			icon: "text-tan opacity-50",
			input:
				"py-1 border-none rounded-full text-tan text-sm font-normal placeholder-tan placeholder:opacity-50",
			bg: "background-color: rgb(var(--color-surface-raised-hover));",
		},
		field: {
			icon: "text-brown",
			input:
				"py-2 rounded text-tan text-sm placeholder-brown placeholder:opacity-70",
			bg: "background-color: rgb(var(--color-surface-sunken));",
		},
	};

	const styles = $derived(variantStyles[variant]);
</script>

<div class="relative {className}" {style}>
	<div class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-4 w-4 {styles.icon}"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
			/>
		</svg>
	</div>
	<input
		type="text"
		bind:this={inputEl}
		bind:value
		{placeholder}
		autocomplete="off"
		autocorrect="off"
		autocapitalize="off"
		spellcheck="false"
		class="w-full pl-9 {clearable
			? 'pr-9'
			: 'pr-3'} {styles.input} transition-colors focus:outline-none"
		style={styles.bg}
	/>
	{#if clearable && value !== ""}
		<!-- Mirrors the magnifier: same offset from its edge, same size, and
		     the variant-aware icon color, so the two read as a pair. Focus
		     returns to the input so clearing doesn't interrupt typing. -->
		<button
			type="button"
			class="absolute right-3 top-1/2 -translate-y-1/2 {styles.icon} transition-colors hover:text-orange"
			aria-label="Clear search"
			title="Clear search"
			onclick={() => {
				value = "";
				inputEl?.focus();
			}}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M6 18L18 6M6 6l12 12"
				/>
			</svg>
		</button>
	{/if}
</div>
