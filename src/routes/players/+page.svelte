<script lang="ts">
	import { goto } from "$app/navigation";
	import { navigating, page } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import type { PlayedGamesRow } from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import { cognomenName } from "$lib/utils/formatting";
	import { profileHref } from "$lib/utils/profile-href";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Named off the load's return rather than re-declared, so the two boards
	// stay one decision — +page.ts can't export the type (SvelteKit rejects
	// runtime exports from a +page.ts) but PageData carries it.
	type Board = PageData["board"];

	// Activity epithets from the game's cognomen ladder — and the set is
	// exactly Old World's own difficulty ladder, every level of which is
	// also a cognomen: the New, the Able, the Just, the Good, the Strong,
	// the Noble, the Glorious, the Magnificent, the Great, in that order
	// (achievement.xml's ACHIEVEMENT_DIFFICULTY_*). They land one to a
	// legitimacy decade from the Able (30) up, which is why the decades
	// below have no rung — the Founder and the Mason sit at 10, and the
	// game gives ten more cognomens at 20. Thresholds are games
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

	// The board in the server's own order, each row carrying its rank.
	//
	// Standard competition ranking: equal totals share a rank and the next
	// rank skips the tie (1, 1, 3). A positional ordinal would hand out a
	// different number to players the board itself can't tell apart, which
	// at a season's start — where most of the field sits on one game — is
	// nearly the whole board. The server orders by total DESC, so tied rows
	// are always adjacent and one backward look is enough.
	//
	// The rank is computed here, before any sort, and travels on the row: it
	// is the player's standing on this board, not their position in whatever
	// column the table is currently sorted by. Sorting by FFAs and reading
	// 1, 4, 2 down the # column is the point — it says who those players are
	// on the board you are looking at.
	type Ranked = Row & { rank: number };
	const ranked = $derived.by(() => {
		const base = withOther(
			data.board === "season" ? data.season : data.allTime,
		);
		const out: Ranked[] = [];
		base.forEach((r, i) => {
			out.push({
				...r,
				rank: i > 0 && r.total === base[i - 1].total ? out[i - 1].rank : i + 1,
			});
		});
		return out;
	});

	// Column sorting. Local state rather than a URL param: this page's load
	// re-fetches both boards on any URL change — two D1 reads and a
	// season_view budget slot, which is why `select` guards a no-op
	// navigation — and a sort only rearranges rows already on screen. Board
	// and season stay in the URL because they change *which* rows those are.
	//
	// Same state shape and toggle rule as the app's other sortable tables
	// (the game-detail tabs' toggleSort, the tournament matches table's
	// toggleMatchSort): the sorted column flips, a new column opens in its
	// own natural direction. Neither of those helpers takes this page's
	// state — both are typed to their own domain's table object, which
	// carries search and filters this board has no equivalent of — so the
	// rule is spelled here as it is there.
	type SortKey = "rank" | "display_name" | FormatKey | "other" | "total";
	// Which way a column reads when you first click it. A count column opens
	// descending — every one of them is an achievement, and the question a
	// board answers is who has the most. Rank and name open ascending, where
	// first and A are the top of the column.
	const OPENS_ASCENDING: SortKey[] = ["rank", "display_name"];
	// The board opens on the order the server sent it in.
	let sortColumn = $state<SortKey>("total");
	let sortDirection = $state<"asc" | "desc">("desc");
	function toggleSort(key: SortKey): void {
		if (sortColumn === key) {
			sortDirection = sortDirection === "asc" ? "desc" : "asc";
		} else {
			sortColumn = key;
			sortDirection = OPENS_ASCENDING.includes(key) ? "asc" : "desc";
		}
	}
	const rows = $derived.by(() => {
		const key = sortColumn;
		const dir = sortDirection === "asc" ? 1 : -1;
		// Array.prototype.sort is stable and `ranked` arrives in board order,
		// so players who tie on the sorted column keep their standing between
		// them — sorting by FFAs puts the higher total first within a tie —
		// and no secondary comparator is needed to make the order definite.
		return [...ranked].sort((a, b) =>
			key === "display_name"
				? dir * a.display_name.localeCompare(b.display_name)
				: dir * (a[key] - b[key]),
		);
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

	// Crowns of the board — most games played in each format, foursquare-
	// mayor style. Ties share a crown. A past season's crowns are settled;
	// the current season's and the career board's are up for grabs.
	//
	// They describe whichever board is on screen: switch to All time and the
	// panel crowns careers rather than the season, the way the viewer's tally
	// switches under it. A season panel over career numbers would be naming a
	// season the disabled stepper can't even move off.
	const CROWN_FORMATS = [
		{ key: "duels_network", label: "Network" },
		{ key: "duels_cloud", label: "Cloud" },
		{ key: "ffas", label: "FFA" },
	] as const;
	type FormatKey = (typeof CROWN_FORMATS)[number]["key"];
	// How many holders a shared crown names before it counts the rest instead.
	// A fresh season ties its whole field on one game, so the co-holder list
	// is longest exactly when the card matters most — past the cap it is a
	// +N, and its tooltip still names everyone it didn't draw.
	const CROWN_HOLDERS_SHOWN = 3;
	// A crown holder as the card names them — one line per holder, face and
	// name, so a tie reads as the players sharing it rather than a face stack.
	type Holder = Pick<Row, "user_id" | "display_name" | "avatar_url">;
	const crowns = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built fresh inside $derived, not mutated after
		const out = new Map<FormatKey, { holders: Holder[]; count: number }>();
		for (const f of CROWN_FORMATS) {
			const max = Math.max(0, ...ranked.map((r) => r[f.key]));
			// Every format gets an entry, claimed or not: a crown nobody holds
			// yet is the season's standing invitation, so it is named rather
			// than omitted. `count: 0` is what `hasCrown` already reads as
			// unclaimed, so no row wears a crown for an empty format.
			out.set(f.key, {
				holders:
					max > 0
						? ranked
								.filter((r) => r[f.key] === max)
								.map(({ user_id, display_name, avatar_url }) => ({
									user_id,
									display_name,
									avatar_url,
								}))
						: [],
				count: max,
			});
		}
		return out;
	});
	// The panel's heading and the per-row leader tooltip both name the board
	// being crowned, so a career crown and a season's can't be read for each
	// other — the rule the viewer's tally already follows.
	const crownsHeading = $derived(
		data.board === "all"
			? "Crowns of all time"
			: `Crowns of ${data.selected.label}`,
	);
	const leaderTerm = $derived(
		data.board === "all" ? "All-time leader" : "Season leader",
	);
	// The holders a crown card names, capped so one card can't outgrow its
	// neighbours; anyone past the cap is counted on a last line.
	const crownShown = (holders: Holder[]): Holder[] =>
		holders.slice(0, CROWN_HOLDERS_SHOWN);
	// The co-holders the card didn't draw, for that line's tooltip.
	const crownRestNames = (holders: Holder[]): string =>
		holders
			.slice(CROWN_HOLDERS_SHOWN)
			.map((h) => h.display_name)
			.join(", ");
	const hasCrown = (u: Row, key: FormatKey): boolean =>
		(crowns.get(key)?.count ?? 0) > 0 && u[key] === crowns.get(key)!.count;

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

	// The whole row opens the player's profile, not just their name — every
	// cell in it describes that one player, so the name cell was a small
	// target for the only destination the row has.
	//
	// A plain left click only: a modified click is the browser's to handle
	// (new tab, new window, a selection drag), and it still has the name
	// cell's real anchor to handle it with — which is also what keyboard
	// activation follows, so the row needs no key handler of its own. The
	// payload carries no slug, so this builds the same permalink the anchor
	// does (profileHref redirects it to /u/<slug> for a slug-holder).
	function openProfile(u: Row, e: MouseEvent): void {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- profileHref() returns a resolve() result; lint can't see through the call
		void goto(profileHref({ user_id: u.user_id }));
	}

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
			<!-- The board's format crowns: most games played in each format, one
			     card per crown in the shape the game page's Nations panel uses —
			     a titled panel over raised subpanels. Shown whether or not anyone
			     holds them; a fresh season's board is three open crowns, which is
			     the whole point of the reset. -->
			<div class="mb-4 rounded-lg bg-surface p-4">
				<h3 class="mb-3 text-xs font-bold uppercase tracking-wide text-tan">
					{crownsHeading}
				</h3>
				<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
					{#each CROWN_FORMATS as f (f.key)}
						{@const k = crowns.get(f.key)!}
						<!-- Three across starts at md rather than sm because that is where
						     a card is wide enough for the longest name on the board: at sm
						     the card holds ~160px of line and the widest holder line needs
						     ~180px, where md's ~203px (and ~213px at the page's max width)
						     clears it. -->
						<div
							class="min-w-0 rounded-lg bg-surface-raised p-3 text-xs"
							class:opacity-70={k.holders.length === 0}
						>
							<!-- Header: the crown, and what it is the crown of — ranged left
							     under the panel title, which is the line it answers to. -->
							<div class="mb-2 flex items-center gap-1.5">
								<SpriteIcon
									category="yields"
									value="YIELD_LEGITIMACY"
									size={16}
									alt=""
								/>
								<span class="text-sm font-bold text-tan">{f.label}</span>
							</div>
							<!-- Who holds it, centred under the header: one line per holder,
							     so a tie reads as the players sharing the crown rather than as
							     a stack of faces, each carrying the count it is held at. A name
							     too long for the card wraps rather than truncating — a crown
							     holder is the last name to abbreviate. A tie deeper than the
							     cap counts the names it didn't draw, and spells them out in
							     that line's tooltip. -->
							<div class="flex flex-col items-center gap-1 text-center">
								{#if k.holders.length === 0}
									<span class="text-tan">Unclaimed</span>
								{:else}
									{#each crownShown(k.holders) as h (h.user_id)}
										<span
											class="flex min-w-0 max-w-full items-center justify-center gap-1.5"
										>
											<img
												src={h.avatar_url}
												alt=""
												class="h-4 w-4 shrink-0 rounded-full"
												width="16"
												height="16"
												loading="lazy"
											/>
											<span class="break-words font-semibold text-gray-200"
												>{h.display_name}</span
											>
											<span class="shrink-0 text-tan">({k.count})</span>
										</span>
									{/each}
									{#if k.holders.length > CROWN_HOLDERS_SHOWN}
										<span class="text-tan" title={crownRestNames(k.holders)}
											>+{k.holders.length - CROWN_HOLDERS_SHOWN} more</span
										>
									{/if}
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>

			{#if data.user}
				<div
					class="mb-4 rounded-lg border border-border-subtle bg-surface p-3 text-sm"
				>
					<div
						class="flex flex-wrap items-center justify-between gap-x-5 gap-y-1"
					>
						<span class="flex items-center gap-1.5 font-bold text-gray-200">
							<img
								src={data.user.avatar_url}
								alt=""
								class="h-5 w-5 shrink-0 rounded-full"
								width="20"
								height="20"
							/>
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
								{@render sortHeader("rank", "#", "text-left")}
								{@render sortHeader("display_name", "Player", "text-left")}
								{@render sortHeader("duels_network", "Network (Duel)")}
								{@render sortHeader("duels_cloud", "Cloud (Duel)")}
								{@render sortHeader("ffas", "FFA")}
								{@render sortHeader(
									"other",
									"Other",
									"",
									"Single-player and local (hotseat/LAN) games — a local game with 3+ humans counts as an FFA",
								)}
								{@render sortHeader("total", "Total")}
							</tr>
						</thead>
						<tbody>
							{#each rows as u (u.user_id)}
								{@const epithet = epithetOf(u.total)}
								{@const you = u.user_id === viewerId}
								<tr
									class="group cursor-pointer"
									onclick={(e) => openProfile(u, e)}
								>
									<td
										class="{CELL} {ROW_BG} rounded-l-lg border-l-2 text-left {you
											? 'border-orange'
											: 'border-transparent'}">{u.rank}</td
									>
									<td class="{ROW_BG} px-3 py-2 text-left">
										<span class="flex items-center gap-1.5">
											<!-- The row handler would otherwise fire behind the
											     anchor and navigate to the same profile twice. -->
											<ProfileLink
												userId={u.user_id}
												class="flex items-center gap-1.5 font-semibold {you
													? 'text-orange'
													: 'text-gray-200'} transition-colors hover:text-orange"
												onclick={(e) => e.stopPropagation()}
											>
												<img
													src={u.avatar_url}
													alt=""
													class="h-5 w-5 shrink-0 rounded-full"
													width="20"
													height="20"
													loading="lazy"
												/>
												{u.display_name}
											</ProfileLink>
											{#if epithet}
												<span class="text-xs italic text-tan">{epithet}</span>
											{/if}
										</span>
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

{#snippet sortHeader(
	key: SortKey,
	label: string,
	align: string = "",
	title: string = "",
)}
	<th
		class="{HEADER_CELL} cursor-pointer transition-colors hover:text-orange {align}"
		title={title || undefined}
		onclick={() => toggleSort(key)}
	>
		<span class="inline-flex items-center gap-1"
			>{label}{#if sortColumn === key}<span class="text-orange"
					>{sortDirection === "asc" ? "↑" : "↓"}</span
				>{/if}</span
		>
	</th>
{/snippet}

<!-- A counted format's cell. The crown gets a fixed slot ahead of the number,
     reserved crowned or not: in the left gutter of a right-aligned column it
     costs space nothing else wants, where a crown trailing the number would
     shove that row's digits off the tabular grid its column sits on and off
     the right edge its header is aligned to. -->
{#snippet countCell(u: Row, key: FormatKey, label: string)}
	<td class="{CELL} {ROW_BG}"
		><span
			class="mr-1 inline-flex w-5 items-center align-middle"
			title={hasCrown(u, key) ? `${leaderTerm} — ${label}` : undefined}
			>{#if hasCrown(u, key)}<SpriteIcon
					category="yields"
					value="YIELD_LEGITIMACY"
					size={14}
					alt={leaderTerm}
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
