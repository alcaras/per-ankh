<script lang="ts">
	// Tournament Videos view. The tournament's recorded games, browsable at the
	// level people actually look for them: a MATCH is one game, played across one
	// or more PARTS, each of which may have been filmed from several ANGLES —
	// a caster's broadcast, or a player's own point of view. Opening a match lists
	// its parts and lets you pick a camera.
	//
	// Each side carries its nation's crest and colour, which is also the filter
	// axis: the nation select narrows to matches where either player fielded it.
	import { SvelteSet } from "svelte/reactivity";
	import SearchInput from "$lib/SearchInput.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import FeaturedStar from "$lib/FeaturedStar.svelte";
	import Select from "$lib/ui/Select.svelte";
	import type { SelectOption } from "$lib/ui/types";
	import { getCivilizationColor } from "$lib/config";
	import { formatShortDate, nationName } from "$lib/utils/formatting";
	import {
		distinguishingOptions,
		mapPoolLabel,
		poolEntryById,
	} from "$lib/tournament/map-script-options";
	import { mapScriptLabel } from "$lib/tournament/map-scripts";
	import { padMatchNumber } from "$lib/tournament/match-numbers";
	import {
		matchSlotNation,
		matchSlotOutcome,
	} from "$lib/tournament/match-occupant";
	import {
		formatRuntime,
		type ArchiveAngle,
		type ArchiveMatch,
	} from "$lib/tournament/video-archive";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let query = $state("");
	let nation = $state("");
	let round = $state("");
	const open = new SvelteSet<string>();
	let showUnattributed = $state(false);

	const rounds = $derived(
		[...new Set(data.archive.matches.map((a) => a.round_number))].sort(
			(a, b) => a - b,
		),
	);

	// A pending match with footage has no nation yet; it must not put an
	// "Unknown" option in the select that, chosen, silently clears the filter.
	const nations = $derived(
		[
			...new Set(
				data.archive.matches.flatMap((a) => [
					matchSlotNation(a, "a"),
					matchSlotNation(a, "b"),
				]),
			),
		]
			.filter((n): n is string => n != null)
			.sort((a, b) => nationName(a).localeCompare(nationName(b))),
	);

	// Option lists for the shared Select. "" is its placeholder value, which
	// it hands back as null on pick — the same empty string these filters
	// already mean by "no filter".
	const nationOptions = $derived<SelectOption[]>([
		{ value: "", label: "All nations" },
		...nations.map((n) => ({ value: n, label: nationName(n) })),
	]);

	const roundOptions = $derived<SelectOption[]>([
		{ value: "", label: "All rounds" },
		...rounds.map((r) => ({ value: String(r), label: `Round ${r}` })),
	]);

	// A runtime the Worker could not price: on the keyed read that is a
	// broadcast still running; on the keyless feed it is every video, and
	// saying "live" about all of them would be false.
	const runtimeLabel = (seconds: number | null): string =>
		seconds !== null
			? formatRuntime(seconds)
			: data.archive.source === "api"
				? "live"
				: "";

	const totalSeconds = (a: ArchiveMatch) =>
		a.parts.reduce((t, p) => t + p.seconds, 0);

	// --- The match row's right-hand metadata, as aligned columns ------
	//
	// A cell is a run of segments joined by ", ". A measurement emphasises its
	// value and may name a unit after it ("123" + "turns"); a `plain` segment
	// (the map) is label text.
	type MetaSegment = { value: string; unit?: string; plain?: boolean };
	type MetaCell = MetaSegment[];

	const META_KEYS = ["map", "turns", "hours", "counts"] as const;
	type MetaKey = (typeof META_KEYS)[number];

	// The map names its pool instance, not just its script — MatchTable's
	// compact label ("Sq Duel CRB PS"), which is how every other match surface
	// reads. That needs the instance, and the archive row carries only
	// map_script; the match list the tournament layout loads for every page
	// under /tournaments/[slug] carries map_pool_id, and covers the archive —
	// all 91 of the live tournament's archive rows resolve in it, each with a
	// pool id.
	const poolIdByMatch = $derived(
		new Map(data.matches.map((m) => [m.match_id, m.map_pool_id])),
	);
	const distinguishing = $derived(
		distinguishingOptions(data.tournament.map_pool),
	);

	// An instance dropped from the pool mid-tournament leaves the script as all
	// anything knows about the map — the label this page showed throughout, so
	// it stays the fallback rather than the blank MatchTable renders there.
	function mapLabel(a: ArchiveMatch): string {
		const entry = poolEntryById(
			data.tournament.map_pool,
			poolIdByMatch.get(a.match_id),
		);
		if (entry) return mapPoolLabel(entry, distinguishing, true);
		return a.map_script ? mapScriptLabel(a.map_script) : "";
	}

	function metaCells(a: ArchiveMatch): Record<MetaKey, MetaCell> {
		const videos = a.parts.reduce((n, p) => n + p.angles.length, 0);
		const parts = a.parts.length;
		const seconds = totalSeconds(a);
		const map = mapLabel(a);
		return {
			map: map ? [{ value: map, plain: true }] : [],
			turns: a.total_turns
				? [{ value: String(a.total_turns), unit: "turns" }]
				: [],
			// formatRuntime already names its own units ("5h 26m").
			hours: seconds > 0 ? [{ value: formatRuntime(seconds) }] : [],
			counts: [
				{ value: String(videos), unit: videos === 1 ? "video" : "videos" },
				{ value: String(parts), unit: parts === 1 ? "part" : "parts" },
			],
		};
	}

	// Characters the cell renders, separator included — enough to rank two
	// labels from the same column against each other.
	const cellLength = (cell: MetaCell): number =>
		cell.reduce(
			(n, g) => n + g.value.length + (g.unit ? g.unit.length + 1 : 0),
			Math.max(0, cell.length - 1) * 2,
		);

	// Each row is its own grid, and sibling grids can't share a `max-content`
	// track, so the columns line up only if every row sizes its tracks off the
	// same content. Every row therefore carries a zero-height copy of the
	// longest cell the archive holds in each column, drawn through the same
	// snippet as the real one: `max-content` then resolves identically
	// everywhere, with no slack. A width counted in `ch` instead left the
	// columns visibly loose — `ch` is the digit advance and these labels are
	// mostly lowercase. A column no match fills — "hours" on the keyless
	// feed, which prices nothing — drops out rather than leaving a dead
	// track.
	const metaWidest = $derived.by(() => {
		const widest = Object.fromEntries(
			META_KEYS.map((k) => [k, [] as MetaCell]),
		) as Record<MetaKey, MetaCell>;
		for (const a of data.archive.matches) {
			const cells = metaCells(a);
			for (const k of META_KEYS)
				if (cellLength(cells[k]) > cellLength(widest[k])) widest[k] = cells[k];
		}
		return widest;
	});

	const metaKeys = $derived(META_KEYS.filter((k) => metaWidest[k].length > 0));
	const metaTemplate = $derived(metaKeys.map(() => "max-content").join(" "));

	function haystack(a: ArchiveMatch): string {
		return [
			a.slot_a_display_name,
			a.slot_b_display_name,
			`match ${a.match_number}`,
			a.map_script,
			...[matchSlotNation(a, "a"), matchSlotNation(a, "b")]
				.filter(Boolean)
				.map(nationName),
			...a.parts.flatMap((p) =>
				p.angles.map((g) => `${g.channel} ${g.video.title}`),
			),
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
	}

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.archive.matches.filter(
			(a) =>
				(!round || String(a.round_number) === round) &&
				(!nation ||
					matchSlotNation(a, "a") === nation ||
					matchSlotNation(a, "b") === nation) &&
				(!q || haystack(a).includes(q)),
		);
	});

	const filtering = $derived(
		query.trim() !== "" || nation !== "" || round !== "",
	);

	const totals = $derived({
		matches: shown.length,
		parts: shown.reduce((t, a) => t + a.parts.length, 0),
		videos: shown.reduce(
			(t, a) => t + a.parts.reduce((n, p) => n + p.angles.length, 0),
			0,
		),
		hours: shown.reduce((t, a) => t + totalSeconds(a), 0) / 3600,
	});

	// Narrowing to a handful of matches is a request to see inside them, so a
	// filtered list opens itself — but only while it stays small. Opening 87
	// matches at once mounts every part and every tile synchronously, which is
	// what the old page's "Show more" existed to avoid.
	const AUTO_OPEN_LIMIT = 8;

	// `open` is the one source of truth and always means open. Auto-opening
	// ADDS to it rather than overriding it, so a match the filter opened can be
	// closed again, and its button's aria-expanded is never a lie. An earlier
	// version flipped the set's sense while a filter was active, which made
	// typing one character collapse the one match you had opened; the version
	// after that OR'd the filter in at render time, which made the collapse
	// button a no-op on every auto-opened match.
	$effect(() => {
		if (filtering && shown.length <= AUTO_OPEN_LIMIT)
			for (const a of shown) open.add(a.match_id);
	});

	function toggle(id: string) {
		if (open.has(id)) open.delete(id);
		else open.add(id);
	}
</script>

{#snippet chevron(expanded: boolean)}
	<!-- The app's disclosure affordance, as TournamentMapsPanel and
	     MatchPopover draw it: one chevron, rotated when open. -->
	<svg
		xmlns="http://www.w3.org/2000/svg"
		class="h-3.5 w-3.5 shrink-0 text-tan opacity-70 transition-transform"
		class:rotate-90={expanded}
		viewBox="0 0 20 20"
		fill="currentColor"
		aria-hidden="true"
	>
		<path
			fill-rule="evenodd"
			d="M7.21 14.77a.75.75 0 010-1.06L10.94 10 7.21 6.29a.75.75 0 111.06-1.06l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-.02z"
			clip-rule="evenodd"
		/>
	</svg>
{/snippet}

{#snippet metaCell(cell: MetaCell)}
	{#each cell as seg, j (j)}{#if j > 0},&nbsp;{/if}{#if seg.plain}{seg.value}{:else}<b
				class="text-tan">{seg.value}</b
			>{#if seg.unit}&nbsp;{seg.unit}{/if}{/if}{/each}
{/snippet}

{#snippet tile(
	video: ArchiveAngle["video"],
	channel: string,
	runtime: string,
	badge: ArchiveAngle["angle"],
)}
	<!-- `group` is what reveals the admin star on hover, as on VideoCard. -->
	<div
		class="group relative flex w-64 gap-2 rounded-lg p-2 transition-colors hover:bg-surface-raised-hover"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<!-- An external watch URL, not an app route, so resolve() doesn't apply;
		     rel guards tabnabbing and referrer leakage. Scoped to this one
		     element, as VideoCard scopes the same rule. Named by the video's
		     title, as VideoCard names its link: the tile shows only channel and
		     runtime, and two angles from one channel are otherwise the same link
		     to a screen reader. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={video.url}
			target="_blank"
			rel="noopener noreferrer"
			class="absolute inset-0 z-10 rounded-lg"
			aria-label={[video.title, channel, runtime].filter(Boolean).join(" — ")}
		></a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{#if video.thumbnail_url}
			<img
				src={video.thumbnail_url}
				alt=""
				loading="lazy"
				width="80"
				height="45"
				class="h-11 w-20 flex-none rounded object-cover"
				style="background-color: rgb(var(--color-surface-deep));"
			/>
		{:else}
			<!-- A feed entry can omit its thumbnail, and an empty src resolves to
			     the document URL in some browsers and refetches the page. -->
			<div
				class="h-11 w-20 flex-none rounded"
				style="background-color: rgb(var(--color-surface-deep));"
			></div>
		{/if}
		<span class="min-w-0 flex-1">
			<span
				class="block truncate text-xs font-semibold"
				style="color: rgb(var(--color-bright));"
			>
				{channel || "Unknown channel"}
				<span
					class="ml-1 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wider"
					class:text-orange={badge === "pov"}
					class:text-tan={badge === "cast"}
					style="background-color: rgb(var({badge === 'pov'
						? '--color-orange'
						: '--color-tan'}) / 0.15);"
				>
					{badge === "pov" ? "POV" : "cast"}
				</span>
			</span>
			{#if runtime}
				<span class="mt-0.5 block text-[11px] text-muted">{runtime}</span>
			{/if}
		</span>
		<FeaturedStar {video} />
	</div>
{/snippet}

{#if data.archive.matches.length === 0}
	<div
		class="rounded-lg p-4"
		style="background-color: rgb(var(--color-surface-sunken));"
	>
		<div class="py-8 text-center text-sm text-gray-400">
			{data.archive.source === "none"
				? "This tournament has no video playlist."
				: "No videos yet."}
		</div>
	</div>
{:else}
	<div
		class="mb-3 flex flex-wrap items-center gap-3 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface-sunken));"
	>
		<SearchInput bind:value={query} variant="dark" class="w-64" />
		<Select
			value={nation}
			onChange={(v) => (nation = v ?? "")}
			options={nationOptions}
			ariaLabel="Filter by nation"
			class="w-40"
			matchTriggerWidth
		/>
		<Select
			value={round}
			onChange={(v) => (round = v ?? "")}
			options={roundOptions}
			ariaLabel="Filter by round"
			class="w-32"
			matchTriggerWidth
		/>
		<span class="ml-auto text-xs text-muted">
			{totals.matches} matches · {totals.parts} parts · {totals.videos} videos · {Math.round(
				totals.hours,
			)} h
		</span>
	</div>

	<div
		class="flex flex-col gap-2 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface-sunken));"
	>
		{#if data.archive.source === "feed"}
			<!-- The keyless read: recent playlist entries only, none with a runtime,
			     dated by when the VOD went up. Say so, or "0 h" and undated parts
			     read as a broken archive. A band in the list beside the parts it
			     describes, like the gap and unattributed notes below — not a
			     subtitle over the whole page. -->
			<div
				class="rounded-lg border border-dashed border-border-subtle px-3 py-2 text-xs text-muted"
			>
				Showing the playlist's most recent entries. Runtimes and the full
				history need the server's YouTube API key.
			</div>
		{/if}

		{#if shown.length === 0}
			<div class="py-8 text-center text-sm text-gray-400">
				No match fits that filter.
			</div>
		{/if}

		{#each shown as a (a.match_id)}
			{@const wonA = matchSlotOutcome(a, "a") === "won"}
			{@const wonB = matchSlotOutcome(a, "b") === "won"}
			{@const cells = metaCells(a)}
			{@const natA = matchSlotNation(a, "a")}
			{@const natB = matchSlotNation(a, "b")}
			{@const colorA = natA ? getCivilizationColor(natA) : undefined}
			{@const colorB = natB ? getCivilizationColor(natB) : undefined}
			<div
				class="overflow-hidden rounded-lg"
				style="background-color: rgb(var(--color-surface));"
			>
				<!-- The two nation colours as a hairline down the left edge: the match's
				     identity at a glance when scanning a long list. -->
				<div class="flex">
					<div class="flex w-1 flex-none flex-col">
						<div
							class="flex-1"
							style="background-color: {colorA ?? 'transparent'};"
						></div>
						<div
							class="flex-1"
							style="background-color: {colorB ?? 'transparent'};"
						></div>
					</div>
					<button
						type="button"
						onclick={() => toggle(a.match_id)}
						aria-expanded={open.has(a.match_id)}
						class="grid flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-surface-hover lg:grid-cols-[6rem_minmax(0,1fr)_auto]"
					>
						<span
							class="flex w-24 flex-none items-center gap-1 text-[11px] font-bold tracking-wider text-muted"
						>
							{@render chevron(open.has(a.match_id))}
							{#if a.match_number != null}
								<span>MATCH {padMatchNumber(a.match_number)}</span>
							{/if}
						</span>
						<span class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
							<span class="flex items-center gap-1.5">
								{#if natA}
									<SpriteIcon
										category="crests"
										value={natA}
										size={18}
										alt={nationName(natA)}
									/>
								{/if}
								<span class="font-bold {wonA ? 'text-orange' : 'text-tan'}">
									{a.slot_a_display_name ?? "—"}
								</span>
							</span>
							<span class="text-xs text-muted">v</span>
							<span class="flex items-center gap-1.5">
								{#if natB}
									<SpriteIcon
										category="crests"
										value={natB}
										size={18}
										alt={nationName(natB)}
									/>
								{/if}
								<span class="font-bold {wonB ? 'text-orange' : 'text-tan'}">
									{a.slot_b_display_name ?? "—"}
								</span>
							</span>
						</span>
						<!-- Columns from `lg` up, where the row has the width to hold
						     them; below it the cells stay a wrapping flex list, as
						     fixed tracks would overflow a phone. A cell names its own
						     track, so an empty one leaves its column standing instead
						     of pulling the rest left. -->
						<span
							class="col-span-2 flex flex-wrap gap-x-3 text-xs text-muted lg:col-span-1 lg:grid lg:justify-end"
							style="grid-template-columns: {metaTemplate}; grid-template-rows: auto 0;"
						>
							{#each metaKeys as k, i (k)}
								{#if cells[k].length > 0}
									<span
										class="whitespace-nowrap"
										style="grid-column: {i + 1}; grid-row: 1;"
										>{@render metaCell(cells[k])}</span
									>
								{/if}
							{/each}
							<!-- The sizing row: see metaWidest. Clipped to nothing, and out
							     of the button's accessible name. -->
							{#each metaKeys as k, i (k)}
								<span
									aria-hidden="true"
									class="invisible hidden overflow-hidden whitespace-nowrap lg:block"
									style="grid-column: {i + 1}; grid-row: 2;"
									>{@render metaCell(metaWidest[k])}</span
								>
							{/each}
						</span>
					</button>
				</div>

				{#if open.has(a.match_id)}
					<div class="flex flex-col gap-2 px-4 pb-3 pt-2">
						{#if a.parts.length === 0}
							<div
								class="rounded-lg border border-dashed border-border-subtle px-3 py-2 text-xs text-muted"
							>
								No footage of this match has surfaced.
							</div>
						{/if}
						{#each a.parts as p (p.n)}
							<div
								class="flex flex-wrap gap-3 rounded-lg p-3"
								style="background-color: rgb(var(--color-surface-sunken));"
							>
								<div class="w-24 flex-none">
									<div class="text-[11px] font-bold tracking-wider text-muted">
										PART {p.n}
									</div>
									{#if p.angles.length > 1}
										<div class="mt-0.5 text-xs text-muted">
											{p.angles.length} videos
										</div>
									{/if}
									<div class="mt-0.5 text-xs text-muted">
										{formatShortDate(p.aired)}{#if p.seconds > 0}
											· {formatRuntime(p.seconds)}{/if}
									</div>
								</div>
								<div class="flex flex-1 flex-wrap gap-2">
									{#each p.angles as g (g.video.id)}
										{@render tile(
											g.video,
											g.channel,
											runtimeLabel(g.seconds),
											g.angle,
										)}
									{/each}
								</div>
							</div>
						{/each}

						{#if a.gaps > 0}
							<div
								class="rounded-lg border border-dashed border-border-subtle px-3 py-2 text-xs text-muted"
							>
								{a.gaps} scheduled part{a.gaps === 1 ? "" : "s"} with no surviving
								footage — the time above is a floor for this match.
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}

		{#if data.archive.unattributed.length > 0}
			<!-- The point of the server returning these rather than dropping them: a
		     video the matcher could not place is a hole in the archive, and a
		     silent hole is indistinguishable from a video that does not exist. -->
			<div
				class="mt-3 rounded-lg p-4"
				style="background-color: rgb(var(--color-surface-sunken));"
			>
				<button
					type="button"
					onclick={() => (showUnattributed = !showUnattributed)}
					aria-expanded={showUnattributed}
					class="flex cursor-pointer items-center gap-1.5 text-left text-sm text-muted transition-colors hover:text-tan"
				>
					{@render chevron(showUnattributed)}
					<span
						>{data.archive.unattributed.length} video{data.archive.unattributed
							.length === 1
							? ""
							: "s"} on the playlist we could not match to a game</span
					>
				</button>
				{#if showUnattributed}
					<p class="mt-2 max-w-prose text-xs text-muted">
						Usually a title that names a player by something other than their
						handle. Attaching the video to its match under Schedule fixes it for
						good.
					</p>
					<ul class="mt-3 flex flex-col gap-1">
						{#each data.archive.unattributed as v (v.id)}
							<li class="truncate text-xs">
								<!-- eslint-disable svelte/no-navigation-without-resolve -->
								<a href={v.url} target="_blank" rel="noopener noreferrer"
									>{v.title}</a
								>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
{/if}
