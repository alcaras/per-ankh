<script lang="ts">
	import { goto } from "$app/navigation";
	import { navigating, page } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import type { PlayedGamesRow } from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import { COGNOMEN_LADDER } from "$lib/generated/cognomens";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Named off the load's return rather than re-declared, so the two boards
	// stay one decision — +page.ts can't export the type (SvelteKit rejects
	// runtime exports from a +page.ts) but PageData carries it.
	type Board = PageData["board"];

	// Activity epithets from the game's cognomen ladder, one per legitimacy
	// decade in the game's own ascending order (the New is the fresh-ruler
	// epithet at the floor; Able 30 … Magnificent 90). Thresholds are games
	// played in the selected season, on the triangular numbers: each rung
	// costs exactly one game more than the last, so the next epithet always
	// feels one push away. The ladder deliberately stops at the Magnificent
	// (36, ~3 games/week — reached by a handful of real quarters); the Great
	// stays unclaimed, reserved for whatever earns it later (tournaments,
	// ratings), and a weekly player lands the Strong. Absolute thresholds —
	// an epithet can't be lost to someone else's grinding, and any number
	// of players can share one.
	const RUNGS: { games: number; type: string }[] = [
		{ games: 1, type: "COGNOMEN_NEW" },
		{ games: 3, type: "COGNOMEN_ABLE" },
		{ games: 6, type: "COGNOMEN_JUST" },
		{ games: 10, type: "COGNOMEN_GOOD" },
		{ games: 15, type: "COGNOMEN_STRONG" },
		{ games: 21, type: "COGNOMEN_NOBLE" },
		{ games: 28, type: "COGNOMEN_GLORIOUS" },
		{ games: 36, type: "COGNOMEN_MAGNIFICENT" },
	];
	const cognomenName = (type: string): string =>
		COGNOMEN_LADDER.find((c) => c.type === type)?.name ?? "";
	const epithetOf = (total: number): string | null => {
		const rung = [...RUNGS].reverse().find((r) => total >= r.games);
		return rung ? cognomenName(rung.type) : null;
	};

	type Row = PlayedGamesRow & { other: number };
	const withOther = (rows: PlayedGamesRow[]): Row[] =>
		rows.map((u) => ({
			...u,
			// Everything that isn't a network duel, a cloud duel, or an FFA:
			// single-player and hotseat/LAN games.
			other: u.total - u.duels_network - u.duels_cloud - u.ffas,
		}));
	const rows = $derived(
		withOther(data.board === "season" ? data.season : data.allTime),
	);

	// Standard competition ranking: equal totals share a rank and the next
	// rank skips the tie (1, 1, 3). A positional ordinal would hand out a
	// different number to players the board itself can't tell apart, which
	// at a season's start — where most of the field sits on one game — is
	// nearly the whole board. The server orders by total DESC, so tied rows
	// are always adjacent and one backward look is enough.
	const ranks = $derived.by(() => {
		const out: number[] = [];
		rows.forEach((r, i) => {
			out.push(i > 0 && r.total === rows[i - 1].total ? out[i - 1] : i + 1);
		});
		return out;
	});

	// Board navigation: the stepper walks the archive (every season since
	// per-ankh's first) and the switch chooses season-vs-career. The two are
	// independent selections and the URL keeps them in separate params, so
	// moving one leaves the other where it was — switching to the career
	// board and back returns to the season you left, not to today's. Every
	// board this page can show, a past season's crowns included, is linkable
	// forever. Season is the default: the board that resets, so being behind
	// is never more than a few months deep. All-time is the career monument.
	//
	// The value naming the career board. +page.ts owns the same constant but
	// can't export it (SvelteKit rejects any runtime export from a +page.ts
	// but its own), so it is spelled again here.
	const ALL_BOARD = "all";
	const currentSlug = $derived(data.seasons[data.seasons.length - 1].slug);
	const selectedIndex = $derived(
		data.seasons.findIndex((s) => s.slug === data.selected.slug),
	);
	const isCurrentSeason = $derived(selectedIndex === data.seasons.length - 1);
	// The view a URL actually names, normalized the way the load normalizes
	// it: an absent `?season=`, an unknown slug and the current season's own
	// slug are three spellings of one season, and anything but `?board=all`
	// is the season board. Both the write guard and the swap dimming compare
	// through this rather than through the raw params, so neither can mistake
	// a respelling for a change.
	const selectionOf = (url: URL): string => {
		const slug = url.searchParams.get("season");
		const season =
			data.seasons.find((s) => s.slug === slug)?.slug ?? currentSlug;
		const board =
			url.searchParams.get("board") === ALL_BOARD ? "all" : "season";
		return `${board}:${season}`;
	};
	// One writer for both controls, so neither can drop the other's selection
	// on its way past. Defaults drop their param rather than spelling them
	// out, keeping one canonical URL — and one edge-cache entry — for the
	// default view, as GlobalFacetRow and ScopeRow do.
	function select(board: Board, slug: string): void {
		const url = new URL(page.url);
		if (slug === currentSlug) url.searchParams.delete("season");
		else url.searchParams.set("season", slug);
		if (board === "all") url.searchParams.set("board", ALL_BOARD);
		else url.searchParams.delete("board");
		// Re-selecting the view already on screen would spend two D1 reads
		// and a per-IP budget slot to fetch back what is already rendered —
		// the same guard GlobalFacetRow puts in front of its facet writes.
		if (selectionOf(url) === selectionOf(page.url)) return;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		void goto(url, { noScroll: true });
	}

	// The board switch, as the segmented control the tournament and stats
	// pages use: a lit thumb that slides between two fixed-width cells.
	// Switching to Season returns to whichever season the stepper last
	// selected — the load keeps `selected` meaningful on the career board
	// for exactly this, which is also why the stepper below can go inert
	// there rather than doubling as a way back.
	const BOARDS = [
		{ key: "season", label: "Season" },
		{ key: "all", label: "All time" },
	] as const satisfies readonly { key: Board; label: string }[];
	const boardIndex = $derived(BOARDS.findIndex((b) => b.key === data.board));
	// Segmented-control tokens, matching the tournament stats page's status
	// switch and the matches page's view switch.
	const triggerClass =
		"relative z-10 cursor-pointer whitespace-nowrap px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors disabled:cursor-default disabled:opacity-50";

	// Every board change re-runs the load (two fetches, one per board), so
	// the page keeps showing the outgoing board until the new one lands.
	// Dimming for the duration is the /stats treatment: it says the numbers
	// still on screen belong to the board you just left, and it covers the
	// wait that stepping through the archive would otherwise spend looking
	// unresponsive.
	const isSwapping = $derived.by(() => {
		const to = navigating.to;
		if (!to) return false;
		return selectionOf(to.url) !== selectionOf(page.url);
	});

	// Crowns of the season — most games played in each format, foursquare-
	// mayor style. Ties share a crown. A past season's crowns are settled;
	// the current season's are up for grabs.
	const CROWN_FORMATS = [
		{ key: "duels_network", label: "Network" },
		{ key: "duels_cloud", label: "Cloud" },
		{ key: "ffas", label: "FFAs" },
	] as const;
	type FormatKey = (typeof CROWN_FORMATS)[number]["key"];
	// How many co-holders the strip names before it summarizes the rest. A
	// fresh season ties its whole field on one game, so an uncapped list is
	// longest exactly when the strip matters most.
	const CROWN_NAMES_SHOWN = 3;
	const seasonRows = $derived(withOther(data.season));
	const crowns = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built fresh inside $derived, not mutated after
		const out = new Map<FormatKey, { names: string[]; count: number }>();
		for (const f of CROWN_FORMATS) {
			const max = Math.max(0, ...seasonRows.map((r) => r[f.key]));
			// Every format gets an entry, claimed or not: a crown nobody holds
			// yet is the season's standing invitation, so it is named rather
			// than omitted. `count: 0` is what `hasCrown` already reads as
			// unclaimed, so no row wears a crown for an empty format.
			out.set(f.key, {
				names:
					max > 0
						? seasonRows
								.filter((r) => r[f.key] === max)
								.map((r) => r.display_name)
						: [],
				count: max,
			});
		}
		return out;
	});
	const crownHolders = (names: string[]): string =>
		names.length <= CROWN_NAMES_SHOWN
			? names.join(" & ")
			: `${names.slice(0, CROWN_NAMES_SHOWN).join(" & ")} +${names.length - CROWN_NAMES_SHOWN} more`;
	const hasCrown = (u: Row, key: FormatKey): boolean =>
		data.board === "season" &&
		(crowns.get(key)?.count ?? 0) > 0 &&
		u[key] === crowns.get(key)!.count;

	// The signed-in viewer's arc, ahead of anyone else's: their epithet, a
	// count, and a progress bar to the next rung — their own climb, never
	// the summit or the gap to it. A viewer with no games on this board is
	// absent from `rows` — at a season's start that is everyone — so the
	// card is built from a zero total rather than from a row: the arc
	// begins before the first game instead of at it.
	const viewerId = $derived(data.user?.user_id ?? null);
	const viewerIndex = $derived(
		viewerId == null ? -1 : rows.findIndex((r) => r.user_id === viewerId),
	);
	const viewerTotal = $derived(viewerIndex >= 0 ? rows[viewerIndex].total : 0);
	// The board's own rendering of the name once they're on it, so the card
	// and their row never disagree.
	const viewerName = $derived(
		viewerIndex >= 0
			? rows[viewerIndex].display_name
			: (data.user?.display_name ?? ""),
	);
	// The tally names the board it counts, so a career total and a season's
	// can't be read for each other on a page where one switch swaps them.
	const viewerTally = $derived(
		`${viewerTotal} ${viewerTotal === 1 ? "game" : "games"} · ${
			data.board === "all" ? "All time" : data.selected.label
		}`,
	);
	const viewerEpithet = $derived(epithetOf(viewerTotal));
	const currentRung = $derived(
		[...RUNGS].reverse().find((r) => viewerTotal >= r.games),
	);
	const nextRung = $derived(RUNGS.find((r) => r.games > viewerTotal));
	// Progress within the current rung's span, for the bar — every game
	// played visibly moves it. At zero the bar is empty and the first rung
	// is the whole span.
	const rungProgress = $derived.by(() => {
		if (!nextRung) return 1;
		const floor = currentRung?.games ?? 0;
		return (viewerTotal - floor) / (nextRung.games - floor);
	});

	const num = (n: number) => (n === 0 ? "—" : n.toLocaleString());

	const HEADER_CELL =
		"whitespace-nowrap px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-100";
	const CELL = "px-3 py-2 text-right tabular-nums text-tan";
	// border-separate leaves the <tr> with no continuous box to paint, so each
	// cell paints the row background — and the hover lift has to travel the
	// same way, driven off the row's `group`.
	const ROW_BG = "bg-surface transition-colors group-hover:bg-surface-hover";
</script>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-3xl">
		<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
			<h1 class="text-2xl font-bold text-gray-200">Players</h1>
			<div class="flex flex-wrap items-center gap-2">
				<!-- Season stepper: chevrons walk the archive, and the label between
				     them names the season they land on. Inert on the career board,
				     which has no season to step through — disabled rather than
				     hidden, so the control keeps its footprint and stays readable as
				     where Season will take you back to. -->
				<div
					class="relative flex w-fit items-center overflow-hidden rounded-lg border-2 border-surface"
					style="background-color: rgb(var(--color-surface));"
					role="group"
					aria-label="Season"
				>
					<button
						type="button"
						class={triggerClass}
						aria-label="Previous season{selectedIndex > 0
							? `: ${data.seasons[selectedIndex - 1].label}`
							: ''}"
						disabled={data.board === "all" || selectedIndex <= 0}
						onclick={() =>
							select(data.board, data.seasons[selectedIndex - 1].slug)}
						>‹</button
					>
					<span
						class="whitespace-nowrap px-1 text-xs font-bold text-tan"
						class:opacity-50={data.board === "all"}
					>
						<!-- Every season's label is laid into one grid cell, all but the
						     selected one hidden, so the stepper is as wide as its widest
						     season and stays that width whichever is selected — walking
						     the archive can't shift the chevrons out from under the
						     cursor. Same construct as the /stats facet triggers. -->
						<span class="label-stack">
							{#each data.seasons as s (s.slug)}
								<span class="label-sizer" aria-hidden="true"
									>{s.label} · {s.range}</span
								>
							{/each}
							<span>{data.selected.label} · {data.selected.range}</span>
						</span>
					</span>
					<button
						type="button"
						class={triggerClass}
						aria-label="Next season{!isCurrentSeason
							? `: ${data.seasons[selectedIndex + 1].label}`
							: ''}"
						disabled={data.board === "all" || isCurrentSeason}
						onclick={() =>
							select(data.board, data.seasons[selectedIndex + 1].slug)}
						>›</button
					>
				</div>
				<!-- Board switch: the season board or the career board, the lit
				     segment sliding across (the tournament stats page's status
				     switch, in the same construct). -->
				<div
					class="relative grid w-fit overflow-hidden rounded-lg border-2 border-surface"
					style="background-color: rgb(var(--color-surface)); grid-template-columns: repeat({BOARDS.length}, minmax(0, 1fr));"
					role="group"
					aria-label="Board"
				>
					<div
						class="pointer-events-none absolute inset-y-0 left-0 transition-transform duration-200 ease-out"
						style:width="{100 / BOARDS.length}%"
						style:background-color="rgb(var(--color-surface-raised))"
						style:transform="translateX({boardIndex * 100}%)"
					></div>
					{#each BOARDS as b (b.key)}
						<button
							type="button"
							class={triggerClass}
							aria-pressed={data.board === b.key}
							onclick={() => select(b.key, data.selected.slug)}
						>
							{b.label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<div class="board" class:swapping={isSwapping} aria-busy={isSwapping}>
			{#if data.board === "season"}
				<!-- The season's format crowns: most games played in each format.
				     Shown whether or not anyone holds them — a fresh season's board is
				     three open crowns, which is the whole point of the reset. -->
				<div
					class="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-surface p-3 text-xs"
				>
					<span class="font-bold uppercase tracking-wide text-tan"
						>Crowns of {data.selected.name}
						{isCurrentSeason ? "(so far)" : data.selected.year}</span
					>
					<!-- The three crowns take the rest of the strip and centre in it,
					     so the run of them sits balanced between the label and the
					     panel's right edge rather than trailing off to the left. Their
					     own wrap keeps that true once they stack. -->
					<div
						class="flex flex-1 flex-wrap items-center justify-center gap-x-6 gap-y-1"
					>
						{#each CROWN_FORMATS as f (f.key)}
							{@const k = crowns.get(f.key)!}
							{#if k.count > 0}
								<span class="inline-flex items-center gap-1 text-tan">
									<SpriteIcon
										category="yields"
										value="YIELD_LEGITIMACY"
										size={12}
										alt=""
									/>
									<span class="font-semibold text-gray-200"
										>{crownHolders(k.names)}</span
									>
									<span>· {f.label} ({k.count})</span>
								</span>
							{:else}
								<span
									class="inline-flex items-center gap-1 text-tan opacity-70"
								>
									<SpriteIcon
										category="yields"
										value="YIELD_LEGITIMACY"
										size={12}
										alt=""
									/>
									<span>{f.label} unclaimed</span>
								</span>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			{#if data.user}
				<div
					class="mb-4 rounded-lg border border-border-subtle bg-surface p-3 text-sm"
				>
					<div
						class="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1"
					>
						<span class="font-bold text-gray-200">
							{viewerName}
							{#if viewerEpithet}
								<span class="font-semibold italic text-orange"
									>{viewerEpithet}</span
								>
							{/if}
						</span>
						{#if viewerTotal > 0}
							<span class="text-xs text-tan">{viewerTally}</span>
						{/if}
					</div>
					{#if nextRung}
						<!-- Progress to the next epithet: the bar spans the current
						     rung's range, so every game played visibly moves it. The
						     sentence beside it carries the same reading, so the bar
						     itself is decorative. -->
						<div class="mt-2 flex items-center gap-3">
							<div
								class="h-2 flex-1 overflow-hidden rounded-sm bg-surface-sunken"
								aria-hidden="true"
							>
								<div
									class="h-full rounded-sm bg-orange transition-[width] duration-200 ease-out"
									style="width: {Math.round(rungProgress * 100)}%;"
								></div>
							</div>
							<span class="whitespace-nowrap text-xs text-tan">
								{nextRung.games - viewerTotal}
								{nextRung.games - viewerTotal === 1 ? "game" : "games"} to reach
								<span class="font-semibold italic text-gray-200"
									>{cognomenName(nextRung.type)}</span
								>
							</span>
						</div>
					{:else}
						<!-- Topping the ladder ends nothing: the crowns stay in play
						     every single game. -->
						<div class="mt-1 text-xs text-tan">
							The ladder is yours — now the crowns: every game still counts.
						</div>
					{/if}
				</div>
			{/if}

			{#if rows.length === 0}
				<p class="p-8 text-center text-sm text-tan opacity-70">
					{#if data.board === "all"}
						No public games yet. Upload a save and set it public to open the
						board.
					{:else if isCurrentSeason}
						No games yet this season.
					{:else}
						No games were played in {data.selected.label}.
					{/if}
				</p>
			{:else}
				<div class="overflow-x-auto rounded-lg bg-blue-gray p-3">
					<table class="w-full border-separate border-spacing-y-1.5 text-sm">
						<thead>
							<tr>
								<th class="{HEADER_CELL} text-left">#</th>
								<th class="{HEADER_CELL} text-left">Player</th>
								<th class={HEADER_CELL}>Duels (Network)</th>
								<th class={HEADER_CELL}>Duels (Cloud)</th>
								<th class={HEADER_CELL}>FFAs</th>
								<th
									class={HEADER_CELL}
									title="Single-player and local (hotseat/LAN) games — a local game with 3+ humans counts as an FFA"
									>Other</th
								>
								<th class={HEADER_CELL}>Total</th>
							</tr>
						</thead>
						<tbody>
							{#each rows as u, i (u.user_id)}
								{@const epithet = epithetOf(u.total)}
								{@const you = u.user_id === viewerId}
								<tr class="group">
									<td
										class="{CELL} {ROW_BG} rounded-l-lg border-l-2 text-left {you
											? 'border-orange'
											: 'border-transparent'}">{ranks[i]}</td
									>
									<td class="{ROW_BG} px-3 py-2 text-left">
										<ProfileLink
											userId={u.user_id}
											class="font-semibold {you
												? 'text-orange'
												: 'text-gray-200'} transition-colors hover:text-orange"
										>
											{u.display_name}
										</ProfileLink>
										{#if epithet}
											<span class="text-xs italic text-tan">{epithet}</span>
										{/if}
									</td>
									{#each CROWN_FORMATS as f (f.key)}
										{@render countCell(u, f.key, f.label)}
									{/each}
									<td class="{CELL} {ROW_BG}">{num(u.other)}</td>
									<td
										class="{CELL} {ROW_BG} rounded-r-lg font-bold text-gray-200"
										>{num(u.total)}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>
</main>

<!-- A counted format's cell. The crown gets a fixed slot ahead of the number,
     reserved crowned or not: in the left gutter of a right-aligned column it
     costs space nothing else wants, where a crown trailing the number would
     shove that row's digits off the tabular grid its column sits on and off
     the right edge its header is aligned to. -->
{#snippet countCell(u: Row, key: FormatKey, label: string)}
	<td class="{CELL} {ROW_BG}"
		><span
			class="mr-1 inline-flex w-5 items-center align-middle"
			title={hasCrown(u, key) ? `Season leader — ${label}` : undefined}
			>{#if hasCrown(u, key)}<SpriteIcon
					category="yields"
					value="YIELD_LEGITIMACY"
					size={14}
					alt="Season leader"
				/>{/if}</span
		>{num(u[key])}</td
	>
{/snippet}

<style>
	/* 200ms to match the segmented control's thumb and the tournament view
	   crossfades. */
	.board {
		transition: opacity 200ms ease-out;
	}

	.board.swapping {
		opacity: 0.3;
		/* What's under the fade is the outgoing board — a click would act on
		   numbers that are about to be replaced. */
		pointer-events: none;
	}

	/* Width-stable label: every option stacked in one grid cell, all but the
	   current one hidden, so the control is as wide as its widest option.
	   Same construct as $lib/stats/GlobalFacetRow.svelte's facet triggers
	   (Svelte styles are component-scoped, so it is spelled again here). */
	.label-stack {
		display: grid;
		justify-items: start;
	}

	.label-stack > span {
		grid-area: 1 / 1;
		white-space: nowrap;
	}

	.label-sizer {
		visibility: hidden;
	}
</style>
