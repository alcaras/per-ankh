<script lang="ts" module>
	export interface SlotPickerCandidate {
		slotId: string;
		label: string;
		seed: number | null;
		// The candidate's current pending opponent, when the resulting matchup
		// is the point of the pick (the swap flow). Null when the candidate has
		// no pending match (e.g. reinstated mid-round).
		opponentLabel: string | null;
	}
</script>

<script lang="ts">
	// Pick-a-player popover: a small trigger button in a Swiss standings row
	// that opens a searchable list of same-division candidates. Backs both
	// row actions that need a second player: Swap (trade seats) and Pair
	// (add a catch-up match to the open round); the caller supplies the
	// candidates, the button label, and the three trigger titles.
	//
	// Why Popover + Combobox (two bits-ui floating primitives nested):
	//   * The Popover portals its content, so the dropdown escapes the standings
	//     table's overflow (the original reason this reached for Combobox at
	//     all) and anchors to the button like the row's Withdraw/Reinstate siblings
	//     don't need to — it floats free of the row.
	//   * The Combobox stays for the searchable, keyboard-navigable candidate list
	//     (a round-1 division can be ~30 players, so the typeahead filter matters);
	//     bits-ui owns keyboard nav and ARIA. We render the items matching the typed
	//     query — bits-ui filters nothing itself.
	//
	// Nesting two floating layers safely: the Combobox uses ContentStatic (NOT
	// Combobox.Portal), so the whole input+list tree lives inside the Popover's DOM
	// and focus scope — the Popover's focus trap contains it, and a click on a
	// Combobox item is DOM-inside the popover, so the Popover's outside-click
	// dismiss never races the item selection. bits-ui's dismiss is topmost-layer
	// only, so while the Combobox is open it owns Escape / outside-click; we route a
	// single `open` state through both, so one dismiss collapses the whole picker.
	import { Combobox } from "bits-ui";
	import Popover from "$lib/ui/Popover.svelte";

	let {
		candidates,
		eligible,
		disabled = false,
		actionLabel,
		ariaLabel,
		titleEnabled,
		titleIneligible,
		titleEmpty,
		onSelect,
	}: {
		candidates: SlotPickerCandidate[];
		// Whether this row's player may act at all; drives the disabled-trigger
		// title. candidates is empty when ineligible.
		eligible: boolean;
		disabled?: boolean;
		// Trigger button text ("Swap", "Pair").
		actionLabel: string;
		ariaLabel: string;
		// Trigger titles: eligible with candidates / this row ineligible / no
		// eligible partners.
		titleEnabled: string;
		titleIneligible: string;
		titleEmpty: string;
		// eslint-disable-next-line no-unused-vars -- param name documentary
		onSelect: (otherSlotId: string) => void;
	} = $props();

	// One open state, bound to the Popover and passed (controlled) to the
	// Combobox: any Combobox dismiss (Escape, outside click, pick) flows back
	// through onOpenChange and collapses the popover in a single step.
	let open = $state(false);

	let search = $state("");
	const query = $derived(search.trim().toLowerCase());
	const filtered = $derived(
		query
			? candidates.filter((c) => c.label.toLowerCase().includes(query))
			: candidates,
	);

	// The trigger can't open when this row is ineligible, when no eligible
	// partners exist, or while another action is in flight — a disabled
	// Popover trigger can't open, so this gates the whole picker.
	const triggerDisabled = $derived(
		disabled || !eligible || candidates.length === 0,
	);
	const triggerTitle = $derived(
		!eligible
			? titleIneligible
			: candidates.length === 0
				? titleEmpty
				: titleEnabled,
	);
</script>

<Popover
	bind:open
	{ariaLabel}
	contentClass="w-72"
	frameClass="border border-surface bg-surface-sunken p-0 shadow-lg"
>
	{#snippet trigger({ props })}
		<button
			{...props}
			type="button"
			disabled={triggerDisabled}
			class="rounded border border-black border-opacity-50 px-1.5 text-[10px] text-tan opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
			title={triggerTitle}
		>
			{actionLabel}
		</button>
	{/snippet}

	<Combobox.Root
		type="single"
		{open}
		onOpenChange={(o) => {
			// Escape / outside click / pick all close the Combobox — collapse the
			// popover with it so the row returns to just the button.
			if (!o) open = false;
		}}
		onValueChange={(v) => {
			if (v) onSelect(v);
		}}
	>
		<div class="p-1.5">
			<!-- No autofocus attribute: the Popover's focus scope focuses its first
			     tabbable (this input) on open, so the admin can type immediately. -->
			<Combobox.Input
				aria-label={ariaLabel}
				oninput={(e) => (search = e.currentTarget.value)}
				class="w-full rounded bg-surface px-1.5 py-1 text-xs text-tan focus:outline-none"
			/>
		</div>
		<Combobox.ContentStatic
			class="max-h-64 overflow-y-auto border-t border-surface pb-1"
		>
			<Combobox.Viewport>
				{#each filtered as c (c.slotId)}
					<Combobox.Item
						value={c.slotId}
						label={c.label}
						class="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs text-tan data-[highlighted]:bg-surface-raised"
					>
						<span class="truncate">{c.label}</span>
						<span class="ml-2 shrink-0 whitespace-nowrap opacity-60">
							{#if c.seed != null}#{c.seed}{/if}
							{#if c.opponentLabel}· vs {c.opponentLabel}{/if}
						</span>
					</Combobox.Item>
				{:else}
					<div class="px-3 py-2 text-xs text-tan opacity-60">No matches.</div>
				{/each}
			</Combobox.Viewport>
		</Combobox.ContentStatic>
	</Combobox.Root>
</Popover>
