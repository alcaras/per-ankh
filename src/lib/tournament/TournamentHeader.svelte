<script lang="ts">
	// The overview-only body of the tournament header: the meta strip (owner /
	// format / players / dates) and the per-status hero (setup CTA, sign-ups,
	// in-progress bar, champion cards). The shared header row above it — trail,
	// status badge, view toggle, signup, action cluster — now lives in the [slug]
	// layout; the overview page renders this component as its first content block.
	import type {
		CombinedQualifier,
		TournamentDetail,
		UserMe,
	} from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import SignupPopover from "./SignupPopover.svelte";
	import TransitionPopover from "./TransitionPopover.svelte";
	import type {
		HeaderHero,
		HeaderHeroRound,
		HeaderStatusMeta,
	} from "./header-status";

	interface Props {
		tournament: TournamentDetail;
		statusMeta: HeaderStatusMeta;
		hero: HeaderHero;
		// Roster size for the meta strip; only shown once the tournament is
		// running or complete (setup/sign-ups surface their own count in the hero).
		playerCount: number;
		// Signed-in user, threaded through for the signup popover's confirmation
		// line (null for anonymous viewers — signup isn't offered then anyway).
		user: UserMe | null;
		// Combined qualifier ranking for the championship-transition preview;
		// null until the swiss phase produces a ranking.
		combined: CombinedQualifier[] | null;
		isAdmin: boolean;
		canSignUp: boolean;
		busy: boolean;
		startReady: boolean;
		transitionReady: boolean;
		onStart: () => void;
		// eslint-disable-next-line no-unused-vars -- callback signature
		onConfirmTransition: (overrideRanks?: string[]) => void;
	}

	let {
		tournament,
		statusMeta,
		hero,
		playerCount,
		user,
		combined,
		isAdmin,
		canSignUp,
		busy,
		startReady,
		transitionReady,
		onStart,
		onConfirmTransition,
	}: Props = $props();

	// Date-only display ("May 30"); the stored value is a full instant.
	function shortDate(iso: string | null): string | null {
		if (!iso) return null;
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return null;
		return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	}

	// Round cells are sized by their match count, so one mark is one match
	// everywhere in the strip and a mark is the same width across a lane. A
	// proportional gauge drew a fixed row of dots per cell instead, which
	// invited exactly the counting it couldn't survive: four unlit dots for
	// three outstanding matches.
	//
	// The weights are shared by both lanes and the round-label row above them,
	// taken from the larger division's count for that round, so the columns
	// stay aligned when the divisions are different sizes (a 28-player
	// division opens on 14, a 32-player one on 16) — the two lanes then differ
	// only in how wide their own marks are inside a shared cell. Early exit
	// drains the field as players clinch, so later cells are genuinely
	// narrower; the floor is what keeps a cell visible when the walk projects
	// no matches at all for it (a 4-player division's round 5 projects 0). At
	// the division sizes the rules doc names it never binds — a 28-player
	// division's last round weighs 5.
	const MIN_ROUND_WEIGHT = 4;

	// Both divisions carry a cell per Swiss round, so indexing either by `i`
	// is safe for the length taken from the first.
	const roundWeights = $derived(
		hero.kind === "in-progress"
			? Array.from({ length: hero.divisions[0]?.rounds.length ?? 0 }, (_, i) =>
					Math.max(
						MIN_ROUND_WEIGHT,
						...hero.divisions.map((d) => d.rounds[i].total),
					),
				)
			: [],
	);

	// Every round cell is its own progressbar, so every one carries a name —
	// a closed round is as much a thing a screen reader lands on as the open
	// one, and an unnamed progressbar announces only its numbers.
	function roundAriaLabel(
		r: HeaderHeroRound,
		index: number,
		laneLabel: string,
	): string {
		if (r.current) return `Matches reported — ${laneLabel}`;
		const matches = `${r.total} ${r.total === 1 ? "match" : "matches"}`;
		return r.projected
			? `Swiss ${index + 1} — ${matches} projected`
			: `Swiss ${index + 1} — ${r.done} of ${matches} reported`;
	}

	const startsLabel = $derived(shortDate(tournament.starts_at));
	const endedLabel = $derived(shortDate(tournament.completed_at));

	// Meta strip text segments after the owner/admins block. Built in order;
	// each renders with a leading divider so the strip reads "owner │ format │
	// players │ description │ date" with separators only between present items.
	const metaSegments = $derived.by(() => {
		const out: { text: string; italic?: boolean }[] = [
			{ text: "Swiss → Championship" },
		];
		if (
			(statusMeta.key === "in-progress" || statusMeta.key === "complete") &&
			playerCount > 0
		) {
			out.push({
				text: `${playerCount} ${playerCount === 1 ? "player" : "players"}`,
			});
		}
		if (tournament.description)
			out.push({ text: tournament.description, italic: true });
		if (statusMeta.key === "complete") {
			if (endedLabel) out.push({ text: `Ended ${endedLabel}` });
		} else if (startsLabel) {
			out.push({ text: `Starts ${startsLabel}` });
		}
		return out;
	});
</script>

<!-- One stretch of the progress strip — a Swiss round cell or the whole
     championship bar: one mark per match, each stretching to fill its share of
     the width. A closed stretch — every match in it reported — collapses to a
     solid line. `live` brightens the track of a round that has opened, so an
     open round with nothing reported yet still reads apart from the rounds
     still to come; the championship passes it for the same reason, reading
     dimmer while it is still a projection during Swiss. -->
{#snippet marks(done: number, total: number, live: boolean)}
	{#if total <= 0}
		<!-- Nothing to draw a mark for — a round the walk says the field clinches
		     before, or a bracket with no size yet. A hairline holds the cell so
		     the strip reads as empty there rather than broken. -->
		<span class="h-px flex-1 rounded-full bg-input"></span>
	{:else if done === total}
		<span class="h-1 flex-1 rounded-full bg-orange"></span>
	{:else}
		{#each Array.from({ length: total }, (_, i) => i < done) as reported, i (i)}
			<span
				class="h-1 flex-1 rounded-full {reported
					? 'bg-orange'
					: live
						? 'bg-input-focus'
						: 'bg-input'}"
			></span>
		{/each}
	{/if}
{/snippet}

<header class="mb-3">
	<!-- Meta panel: owner/admins, format, players, date — grouped. First block of
	     the overview body; the shared header row (trail/toggle/actions) sits above
	     it in the [slug] layout. -->
	<div
		class="rounded-lg p-3"
		style="background-color: rgb(var(--color-surface));"
	>
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-tan opacity-80"
		>
			{#if tournament.owner}
				<span class="flex items-center gap-1">
					<img
						src={tournament.owner.avatar_url}
						alt=""
						class="h-4 w-4 rounded-full"
					/>
					<span
						><span class="opacity-70">Owner:</span>
						{tournament.owner.display_name}</span
					>
				</span>
				{#if tournament.admins.length > 0}
					<span class="opacity-40">│</span>
					<span>
						<span class="opacity-70"
							>{tournament.admins.length === 1 ? "Admin:" : "Admins:"}</span
						>
						{tournament.admins.map((a) => a.display_name).join(", ")}
					</span>
				{/if}
			{/if}
			{#each metaSegments as seg, i (seg.text)}
				{#if i > 0 || tournament.owner}
					<span class="opacity-40">│</span>
				{/if}
				<span class:italic={seg.italic}>{seg.text}</span>
			{/each}
		</div>
	</div>

	<!-- Hero strip: per-status content + primary CTA. -->
	<div
		class="mt-3 rounded-lg py-3 pl-3 pr-4"
		style="background-color: rgb(var(--color-surface));"
	>
		{#if hero.kind === "setup"}
			<div class="flex flex-wrap items-center gap-4">
				<span
					class="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full border border-white"
					aria-hidden="true"
				>
					<SpriteIcon category="icons" value="TOOL_SETTINGS" size={22} />
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-xs uppercase tracking-wide text-tan opacity-50">
						Getting started
					</p>
					<p class="text-sm text-tan opacity-90">
						Set a name, format, and rules — then open sign-ups.
					</p>
				</div>
				{#if isAdmin}
					<button
						type="button"
						class="whitespace-nowrap rounded border border-tan px-3 py-1.5 text-xs text-tan disabled:opacity-50"
						onclick={onStart}
						disabled={busy || !startReady}
						title={startReady
							? ""
							: "Add at least one player to each division to start"}
					>
						Start tournament
					</button>
				{/if}
			</div>
		{:else if hero.kind === "signups"}
			<div class="flex flex-wrap items-center gap-4">
				<div class="min-w-0 flex-1">
					<p class="text-xs uppercase tracking-wide text-tan opacity-50">
						Sign-ups
					</p>
					<p class="text-sm text-tan">
						<span class="font-bold">{hero.signedUp}</span>
						signed up
						<span class="opacity-60">
							· {hero.divisionAName}
							{hero.divisionACount} · {hero.divisionBName}
							{hero.divisionBCount}
						</span>
					</p>
				</div>
				{#if isAdmin}
					<button
						type="button"
						class="whitespace-nowrap rounded border border-tan px-3 py-1.5 text-xs text-tan disabled:opacity-50"
						onclick={onStart}
						disabled={busy || !startReady}
						title={startReady
							? ""
							: "Add at least one player to each division to start"}
					>
						Start tournament
					</button>
				{/if}
				{#if canSignUp && user}
					<SignupPopover {tournament} {user} {busy} />
				{/if}
			</div>
		{:else if hero.kind === "in-progress"}
			<div class="flex flex-wrap items-center gap-4">
				<!-- Two-row grid with a shared auto-sized label column, so both bars
				     span exactly the same width regardless of label length. The
				     Swiss rows drop out once the bracket is live, leaving the
				     championship bar and the overall tally. -->
				<div
					class="grid min-w-[16rem] flex-1 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-3 pl-1"
				>
					<!-- Shared Swiss round labels, lit while some division is playing
					     that round — or, once the bracket is the only row left, the
					     championship's own name in their place. Beside them, matches
					     played so far against the projected eventual total ("~" while
					     results in flight can still swing it — see
					     projected-totals.ts). -->
					{#if hero.championship.active}
						<span
							class="truncate text-[10px] uppercase tracking-wide text-tan opacity-50"
							>Championship</span
						>
					{:else}
						<div class="flex gap-2">
							{#each roundWeights as weight, i (i)}
								<span
									style="flex: {weight}"
									class="truncate text-center text-[10px] uppercase tracking-wide {hero.divisions.some(
										(d) => d.rounds[i].current,
									)
										? 'font-bold text-orange'
										: 'text-tan opacity-50'}">Swiss {i + 1}</span
								>
							{/each}
						</div>
					{/if}
					<span
						class="col-start-2 justify-self-end whitespace-nowrap text-[10px] italic text-tan opacity-70"
					>
						{hero.playedOverall} of {hero.projectedExact
							? ""
							: "~"}{hero.projectedTotal} matches
					</span>
					{#if !hero.championship.active}
						<!-- One Swiss lane per division: a cell per round, one mark per
						     match — a solid line once the round is closed, an unlit row
						     for a round still to come (the census walk's size for it),
						     and a row filling as reports land in between. The lanes merge
						     into the championship bar. -->
						{#each hero.divisions as d (d.label)}
							<div class="flex flex-col gap-0.5">
								<div class="flex items-center gap-2">
									{#each d.rounds as r, i (i)}
										<div
											class="flex items-center gap-0.5"
											style="flex: {roundWeights[i]}"
											role="progressbar"
											aria-valuemin={0}
											aria-valuemax={r.total}
											aria-valuenow={r.done}
											aria-label={roundAriaLabel(r, i, d.label)}
										>
											{@render marks(r.done, r.total, r.current)}
										</div>
									{/each}
								</div>
								<span
									class="truncate text-center text-[10px] uppercase tracking-wide text-tan opacity-50"
								>
									{d.label}
								</span>
							</div>
							<span
								class="justify-self-end whitespace-nowrap text-[10px] italic text-tan opacity-70"
							>
								{#if d.total > 0}{d.reported} of {d.total} reported{/if}
							</span>
						{/each}
					{/if}
					<!-- The merged championship bar — the divisions reunite in one
					     bracket. Sized by the projected bracket until it's live, so
					     during Swiss the marks are the projection's count. -->
					<div class="flex flex-col gap-0.5">
						<div
							class="flex items-center gap-2"
							role="progressbar"
							aria-valuemin={0}
							aria-valuemax={hero.championship.total}
							aria-valuenow={hero.championship.reported}
							aria-label="Matches reported — Championship"
						>
							{@render marks(
								hero.championship.reported,
								hero.championship.total,
								hero.championship.active,
							)}
						</div>
						{#if !hero.championship.active}
							<span
								class="truncate text-center text-[10px] uppercase tracking-wide text-tan opacity-50"
								>Championship</span
							>
						{/if}
					</div>
					<span
						class="justify-self-end whitespace-nowrap text-[10px] italic text-tan opacity-70"
					>
						{#if hero.championship.active}
							{hero.championship.reported} of {hero.championship.total} reported
						{:else if hero.championship.total > 0}
							{hero.championship.exact ? "" : "~"}{hero.championship.total}
							matches
						{/if}
					</span>
				</div>
				{#if isAdmin && transitionReady && combined}
					<div class="flex flex-shrink-0 items-center gap-3">
						<TransitionPopover
							{tournament}
							{combined}
							{busy}
							onConfirm={onConfirmTransition}
						/>
					</div>
				{/if}
			</div>
		{:else if hero.kind === "complete"}
			<!-- Two side-by-side cards spanning the full width: a wider champion
			     card (gold ring + trophy) and a narrower runner-up card (neutral
			     ring + GOAL_STARTED). Ranked by width and ring tint; our sprites
			     and colors throughout. -->
			<div class="flex flex-wrap items-stretch gap-3">
				<div
					class="flex min-w-[15rem] flex-[1.6] items-center gap-4 rounded-lg p-3"
					style="background-color: rgb(var(--color-surface-raised));"
				>
					<span
						class="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full border border-white"
						aria-hidden="true"
					>
						<SpriteIcon category="icons" value="ACHIEVEMENT" size={24} />
					</span>
					<div class="min-w-0">
						<p class="text-xs uppercase tracking-wide text-tan opacity-50">
							Champion
						</p>
						{#if hero.champion}
							<p class="text-sm">
								<ProfileLink
									userId={hero.championUserId}
									slug={hero.championSlug}
									class="hover:underline"
								>
									<span class="font-bold text-orange">{hero.champion}</span>
								</ProfileLink>
							</p>
							{#if hero.finalSummary}
								<p class="text-xs text-tan">{hero.finalSummary}</p>
							{/if}
						{:else}
							<p class="text-sm text-tan opacity-70">Not recorded yet</p>
						{/if}
					</div>
				</div>
				{#if hero.champion && hero.finalist}
					<div
						class="flex min-w-[12rem] flex-1 items-center gap-4 rounded-lg p-3"
						style="background-color: rgb(var(--color-surface-raised));"
					>
						<span
							class="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full border border-white"
							aria-hidden="true"
						>
							<SpriteIcon category="icons" value="GOAL_STARTED" size={22} />
						</span>
						<div class="min-w-0">
							<p class="text-xs uppercase tracking-wide text-tan opacity-50">
								Runner-up
							</p>
							<p class="text-sm">
								<ProfileLink
									userId={hero.finalistUserId}
									slug={hero.finalistSlug}
									class="hover:underline"
								>
									<span class="font-bold text-orange">{hero.finalist}</span>
								</ProfileLink>
							</p>
							{#if hero.fieldSize > 0}
								<p class="text-xs text-tan">
									Finished 2nd of {hero.fieldSize}
								</p>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</header>
