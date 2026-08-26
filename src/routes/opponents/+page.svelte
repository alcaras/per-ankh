<script lang="ts">
	// Ten players you should get a close game against.
	//
	// The model that picks them runs entirely in the Worker and this page is
	// deliberately incapable of showing a rating: the payload carries none, so
	// there is no number here to leak into a tooltip, a title attribute or a
	// sort. Everything rendered is either identity or a fact the viewer could
	// have established by opening the profile themselves. The order is the
	// shuffled order the rebuild stored, which is why nothing here is numbered.
	import { resolve } from "$app/paths";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import { TIME_LOCALE } from "$lib/utils/formatting";
	import type { OpponentBadge, RecommendedOpponent } from "$lib/api-cloud";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const opponents = $derived(data.suggestions.opponents);

	// Badge copy. Each one is checkable by hand — who they last played, how many
	// rated games they have, whether the two of you share an opponent — which is
	// the test every badge on this page has to pass.
	const BADGE_LABELS: Record<OpponentBadge, string> = {
		active_this_week: "Active this week",
		new_here: "New here",
		bridges_circles: "No mutual opponents",
	};

	// The card's badge row: the pair's history first, then the opponent's own
	// badges. "No mutual opponents" already implies the two have never met — the
	// graph distance behind it is at least three — so the history label steps
	// aside rather than saying the weaker half of the same thing twice.
	function labelsFor(o: RecommendedOpponent): string[] {
		const bridges = o.badges.includes("bridges_circles");
		const history =
			o.meetings === 0
				? bridges
					? null
					: "Never played"
				: o.meetings === 1
					? "Played once"
					: o.meetings === 2
						? "Played twice"
						: `Played ${o.meetings} times`;
		return [
			...(history ? [history] : []),
			...o.badges.map((b) => BADGE_LABELS[b]),
		];
	}

	// computed_at is SQLite's datetime('now') — a bare "2026-08-26 03:47:12"
	// with no zone marker, which `new Date` reads as local. Rendered unzoned for
	// exactly that reason: the local read is what puts the stored wall clock
	// back on screen intact (same call the tournament header's completed_at
	// makes). Locale is pinned so an English page can't print "26. Aug".
	const updatedLabel = $derived.by(() => {
		const raw = data.suggestions.computed_at;
		if (!raw) return null;
		const d = new Date(raw);
		if (Number.isNaN(d.getTime())) return null;
		return d.toLocaleDateString(TIME_LOCALE, {
			month: "short",
			day: "numeric",
		});
	});
</script>

{#snippet opponentCard(o: RecommendedOpponent)}
	<!-- The whole card is one link to the profile, the way a tournament row card
	     is — the profile is the only thing there is to do with a suggestion, and
	     a card whose name alone is clickable makes the reader hunt for it. One
	     anchor rather than two also keeps the markup valid. -->
	<ProfileLink
		userId={o.user_id}
		slug={o.slug}
		class="block rounded-lg bg-surface-raised p-3 transition-colors hover:bg-surface-raised-hover"
		title="{o.display_name}'s profile"
	>
		<div class="flex items-center gap-3">
			<img
				src={o.avatar_url}
				alt=""
				width="40"
				height="40"
				class="h-10 w-10 shrink-0 rounded-full border-2 border-black"
			/>

			<div class="min-w-0 flex-1">
				<div class="truncate text-base font-bold text-white">
					{o.display_name}
				</div>

				<div class="mt-1 flex flex-wrap items-center gap-1.5">
					{#each labelsFor(o) as label (label)}
						<span
							class="rounded bg-amber-700/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-tan"
						>
							{label}
						</span>
					{/each}
				</div>
			</div>
		</div>
	</ProfileLink>
{/snippet}

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-4xl">
				<h1 class="text-2xl font-bold text-gray-200">Recommended opponents</h1>
				<p class="mt-1 text-sm text-tan opacity-90">
					Players you should get a close game against. Every one of them is
					someone who could beat you, and who you could beat.
				</p>

				<!-- The one thing the viewer can act on that isn't a profile link:
				     they are hidden from everyone else's page. Shown here rather than
				     only in Settings because this is where the exchange becomes
				     visible — they are reading a list they are not on. -->
				{#if !data.user.open_to_matches}
					<p class="mt-3 text-sm text-tan opacity-70">
						You're hidden from other players' suggestions right now. Turn
						<span class="font-bold">Open to match suggestions</span> back on in
						<a
							href={resolve("/account")}
							class="text-orange transition-colors hover:text-tan">Settings</a
						> to be listed too.
					</p>
				{/if}

				{#if opponents.length > 0}
					<div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
						{#each opponents as o (o.user_id)}
							{@render opponentCard(o)}
						{/each}
					</div>
					<p class="mt-4 text-xs text-tan opacity-60">
						In no particular order — this is ten players, not a ranking of ten
						players. A fresh set is picked every night{updatedLabel
							? `, most recently on ${updatedLabel}`
							: ""}.
					</p>
				{:else if !data.suggestions.rated}
					<p class="mt-6 text-sm text-tan opacity-70">
						Suggestions come from your multiplayer results, and you don't have
						any yet. Play someone and
						<a
							href={resolve("/upload")}
							class="text-orange transition-colors hover:text-tan"
							>upload the save</a
						>, or take a slot in a
						<a
							href={resolve("/tournaments")}
							class="text-orange transition-colors hover:text-tan">tournament</a
						> — either one is enough to start.
					</p>
				{:else}
					<p class="mt-6 text-sm text-tan opacity-70">
						Nothing to suggest tonight — everyone close enough to give you a
						good game is either already busy or away. Check back after the next
						round of results.
					</p>
				{/if}
			</div>
		</div>
	</main>
</div>
