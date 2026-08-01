<script lang="ts">
	// Head-to-head-by-type module, ported from owglick's H2H card. Every type is
	// a center-split diverging-bar row (player A grows left, B grows right),
	// with the absent side left blank when only one player has a type. Used on
	// the Military tab for the Ending Army / Military Built comparisons, on the
	// Economy tab for improvements, worker-turns and projects, and on the
	// Specialists tab for rural / urban specialists — hence the icon category
	// and label being the caller's to choose, down to having no icons at all.
	// A 1v1 framing; the caller gates it to two players.
	import SpriteIcon from "./SpriteIcon.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import type { BuildItem, SpriteCategory } from "./helpers";

	let {
		title,
		statA,
		statB,
		a,
		b,
		ca,
		cb,
		keys,
		iconCategory = "units",
		labelOf = (key: string) => formatEnum(key, "UNIT_"),
		showDiff = false,
	}: {
		title: string;
		statA?: string;
		statB?: string;
		a: BuildItem[];
		b: BuildItem[];
		ca: string;
		cb: string;
		// Optional fixed row order. When the caller renders several panels that
		// should line up (Military Built vs Ending Army), it passes the shared
		// union of keys so every panel draws the same rows in the same order — a
		// type absent from this panel renders as a blank placeholder row.
		// Omitted, the panel derives its own union from a/b.
		keys?: string[];
		// The sprite manifest rows draw their icon from, or null for subjects
		// with no baked art of their own (projects). The icon slot keeps its
		// fixed width either way, so a label-only panel still lines its rows up
		// with one that has icons.
		iconCategory?: SpriteCategory | null;
		// eslint-disable-next-line no-unused-vars -- callback type signature
		labelOf?: (key: string) => string;
		// Trailing ±N column: how far ahead the leading side is on that row. Level
		// rows stay blank, so the column reads as a list of the gaps.
		showDiff?: boolean;
	} = $props();

	function byType(items: BuildItem[]): Map<string, number> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const m = new Map<string, number>();
		for (const it of items) m.set(it.key, (m.get(it.key) ?? 0) + it.count);
		return m;
	}
	const aM = $derived(byType(a));
	const bM = $derived(byType(b));

	type Row = {
		key: string;
		ca: number;
		cb: number;
	};
	// One row per key. A side that has none of a key carries a 0 and renders a
	// blank bar/count on its half. Rows come from the caller's shared `keys`
	// order when given (so panels line up); otherwise from this panel's own
	// union of both sides, alphabetically by display name.
	const rows = $derived<Row[]>(
		(
			keys ??
			[...new Set([...aM.keys(), ...bM.keys()])].sort((p, q) =>
				labelOf(p).localeCompare(labelOf(q)),
			)
		).map((t) => ({
			key: t,
			ca: aM.get(t) ?? 0,
			cb: bM.get(t) ?? 0,
		})),
	);
	// Bar scale: longest single-side count across all rows.
	const max = $derived(Math.max(1, ...rows.map((r) => Math.max(r.ca, r.cb))));
	// Per-side totals, shown in a footer row aligned under the count columns.
	const totalA = $derived([...aM.values()].reduce((t, n) => t + n, 0));
	const totalB = $derived([...bM.values()].reduce((t, n) => t + n, 0));
</script>

<div
	class="flex flex-col overflow-hidden rounded-md border border-border-subtle bg-surface-sunken"
>
	<div class="flex items-start justify-between gap-2 px-2.5 py-1.5">
		<div class="truncate text-[10px] font-bold text-tan">{title}</div>
		{#if statA != null && statB != null}
			<div
				class="flex flex-none items-center gap-1 text-[10px] font-semibold text-muted"
			>
				<span class="font-mono" style="color:{ca}">{statA}</span>
				<span class="text-white">v</span>
				<span class="font-mono" style="color:{cb}">{statB}</span>
				<SpriteIcon category="yields" value="YIELD_TRAINING" size={12} />
			</div>
		{/if}
	</div>

	{#if rows.length > 0}
		<div>
			{#each rows as r (r.key)}
				<div
					class="grid items-center gap-2 px-2.5 py-0.5"
					style="grid-template-columns: 110px 1fr;"
				>
					<div class="flex min-w-0 items-center gap-1.5">
						<span class="flex w-3.5 flex-none">
							{#if iconCategory}
								<SpriteIcon category={iconCategory} value={r.key} size={14} />
							{/if}
						</span>
						<span class="truncate text-[11px] text-bright"
							>{labelOf(r.key)}</span
						>
					</div>
					<div class="flex items-center">
						<span
							class="w-5 flex-none text-center font-mono text-[11px] text-white"
							>{r.ca || ""}</span
						>
						<div class="flex flex-1 justify-end">
							{#if r.ca > 0}
								<div
									class="h-[11px] rounded-l-[3px]"
									style="width:{(r.ca / max) * 100}%;background:{ca}"
								></div>
							{/if}
						</div>
						<div class="mx-0.5"></div>
						<div class="flex flex-1">
							{#if r.cb > 0}
								<div
									class="h-[11px] rounded-r-[3px]"
									style="width:{(r.cb / max) * 100}%;background:{cb}"
								></div>
							{/if}
						</div>
						<span
							class="w-5 flex-none text-center font-mono text-[11px] text-white"
							>{r.cb || ""}</span
						>
						{#if showDiff}
							<span
								class="w-8 flex-none text-right font-mono text-[10px]"
								style="color:{r.ca > r.cb ? ca : cb}"
							>
								{r.ca === r.cb ? "" : `+${Math.abs(r.ca - r.cb)}`}
							</span>
						{/if}
					</div>
				</div>
			{/each}
			<!-- Totals: per-side sums aligned under the count columns. -->
			<div
				class="grid items-center gap-2 px-2.5 py-1"
				style="grid-template-columns: 110px 1fr;"
			>
				<div class="text-[10px] font-semibold text-muted">Total</div>
				<div class="flex items-center">
					<span
						class="w-5 flex-none text-center font-mono text-[10px]"
						style="color:{ca}">{totalA}</span
					>
					<div class="flex flex-1"></div>
					<div class="mx-0.5"></div>
					<div class="flex flex-1"></div>
					<span
						class="w-5 flex-none text-center font-mono text-[10px]"
						style="color:{cb}">{totalB}</span
					>
					{#if showDiff}
						<span
							class="w-8 flex-none text-right font-mono text-[10px] font-bold"
							style="color:{totalA > totalB ? ca : cb}"
						>
							{totalA === totalB ? "" : `+${Math.abs(totalA - totalB)}`}
						</span>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="px-2.5 py-3 text-center text-[10px] text-muted">none built</div>
	{/if}
</div>
