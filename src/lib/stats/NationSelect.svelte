<script lang="ts">
	// Shared nation selector for the per-nation stats panels (Families, Opening
	// laws, Tech). Controlled: the parent owns the selected value and the option
	// list (typically the ALL_NATIONS sentinel followed by real nations) and
	// handles changes. Labels render via the shared nationLabel helper.
	//
	// Rendered as a sticky, left-aligned bar matching the Yields toolbar
	// (same chrome as the subtab chip bar), so it stays reachable while
	// scrolling the panel's chart stack.
	//
	// toolbarFlush pulls the bar out of a container's px-4 so it lines up with
	// the tab bar above. Only StatsView pads its tab content, so only it opts
	// in; a caller that doesn't pad (the tournament stats page) leaves it off,
	// or the bar hangs a rem left of both the tabs above it and the charts
	// below.

	import { Select } from "bits-ui";
	import { nationLabel } from "./charts/helpers";

	let {
		value,
		options,
		onChange,
		toolbarFlush = false,
	}: {
		value: string;
		options: string[];
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onChange: (value: string) => void;
		toolbarFlush?: boolean;
	} = $props();
</script>

<div
	class="sticky top-1 z-10 mb-4 flex w-fit items-center gap-2 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg {toolbarFlush
		? '-ml-4'
		: ''}"
>
	<Select.Root
		type="single"
		{value}
		onValueChange={onChange}
		items={options.map((n) => ({ value: n, label: nationLabel(n) }))}
	>
		<Select.Trigger
			class="flex items-center gap-2 rounded bg-surface-raised px-2.5 py-1 text-xs font-bold text-tan"
		>
			{nationLabel(value)}
			<span class="text-brown">▼</span>
		</Select.Trigger>
		<Select.Portal>
			<Select.Content
				class="z-50 max-h-72 overflow-y-auto rounded-lg border border-surface bg-surface-sunken shadow-lg"
			>
				<Select.Viewport>
					{#each options as n (n)}
						<Select.Item
							value={n}
							label={nationLabel(n)}
							class="flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm text-tan data-[highlighted]:bg-surface-raised"
						>
							{#snippet children({ selected })}
								{nationLabel(n)}
								{#if selected}<span class="text-orange">✓</span>{/if}
							{/snippet}
						</Select.Item>
					{/each}
				</Select.Viewport>
			</Select.Content>
		</Select.Portal>
	</Select.Root>
</div>
