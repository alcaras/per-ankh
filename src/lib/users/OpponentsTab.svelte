<script lang="ts">
	// Ten players the profile's owner should get a close game against.
	//
	// Owner-only, and the only tab that is: the others are facts about the
	// profile (it has channels, it holds a tournament slot), this one is about
	// the viewer. The gate is not really the tab bar though — the endpoint
	// behind it is /users/me/opponents, which has no by-id form, so there is no
	// URL that serves anyone else's list.
	//
	// The model that picks them runs entirely in the Worker and this component
	// is deliberately incapable of showing a rating: the payload carries none,
	// so there is no number here to leak into a tooltip, a title attribute or a
	// sort. Everything rendered is either identity or a fact the viewer could
	// have established by opening the profile themselves. The order is the one
	// the rebuild stored — most recently active first — and says nothing about
	// rating, which is why nothing here is numbered.
	import { resolve } from "$app/paths";
	import DiscordMark from "$lib/ui/DiscordMark.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import type {
		OpponentBadge,
		RecommendedOpponent,
		RecommendedOpponents,
	} from "$lib/api-cloud";

	let {
		suggestions,
		openToMatches,
	}: {
		suggestions: RecommendedOpponents;
		// The owner's own listing preference. Surfaced here, not only in
		// Settings, because this is where the exchange becomes visible: they are
		// reading a list they are not on.
		openToMatches: boolean;
	} = $props();

	const opponents = $derived(suggestions.opponents);

	// Badge copy. Each one is checkable by hand from what the opponent's
	// profile already shows — how many rated games they have played in public,
	// and when the last of them was — which is the test every badge here has to
	// pass. Nothing is counted from a private save or from a login.
	const BADGE_LABELS: Record<OpponentBadge, string> = {
		active_this_week: "Active this week",
		new_here: "New here",
	};

	// The card's badge row: the pair's history first, then the opponent's own
	// badges.
	//
	// Every history label names the pair, never the player. "Never played" under
	// a stranger's name reads as a fact about them — that they have never played
	// at all — which is both wrong and the opposite of a recommendation.
	// "First meeting" can only be about the two of you.
	function labelsFor(o: RecommendedOpponent): string[] {
		const history =
			o.meetings === 0
				? "First meeting"
				: o.meetings === 1
					? "Played once"
					: o.meetings === 2
						? "Played twice"
						: `Played ${o.meetings} times`;
		return [history, ...o.badges.map((b) => BADGE_LABELS[b])];
	}
</script>

{#snippet opponentCard(o: RecommendedOpponent)}
	<div
		class="flex items-center gap-2 rounded-lg bg-surface p-3 transition-colors hover:bg-surface-hover"
	>
		<!-- Identity is one link to the profile, the way a tournament row card is
		     — a card whose name alone is clickable makes the reader hunt for it.
		     The Discord link is its sibling rather than a child, because an
		     anchor inside an anchor is not markup. -->
		<ProfileLink
			userId={o.user_id}
			slug={o.slug}
			class="flex min-w-0 flex-1 items-center gap-3"
			title="{o.display_name}'s profile"
		>
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
							class="rounded bg-amber-700/40 px-1.5 py-0.5 text-xs text-amber-300"
						>
							{label}
						</span>
					{/each}
				</div>
			</div>
		</ProfileLink>

		<!-- Their Discord profile. The mark alone, no label: it lands on the
		     profile rather than in a DM — Discord publishes no compose URL, and
		     whether a stranger may message them at all stays their privacy
		     setting to make — so a button reading "DM" would promise something it
		     does not do. The tooltip and the aria-label say where it goes.
		     discord.com, not an app route, so resolve() doesn't apply; rel guards
		     tabnabbing + referrer leakage (same shape as VideoCard's). -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={o.discord_url}
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex shrink-0 items-center rounded border border-tan p-1.5 text-tan transition-colors hover:border-orange hover:text-orange"
			title="{o.display_name} on Discord"
			aria-label="{o.display_name} on Discord"
		>
			<DiscordMark />
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>
{/snippet}

{#if !openToMatches}
	<p class="mb-3 text-sm text-tan opacity-70">
		You're hidden from other players' lists —
		<a
			href={resolve("/account")}
			class="text-orange transition-colors hover:text-tan">Settings</a
		> to be listed too.
	</p>
{/if}

{#if opponents.length > 0}
	<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
		{#each opponents as o (o.user_id)}
			{@render opponentCard(o)}
		{/each}
	</div>
{:else if !suggestions.rated}
	<p class="p-8 text-center text-sm text-tan opacity-60">
		Suggestions come from your multiplayer games.
		<a
			href={resolve("/upload")}
			class="text-orange transition-colors hover:text-tan">Upload a save</a
		> of one you've played and you'll have a list.
	</p>
{:else}
	<p class="p-8 text-center text-sm text-tan opacity-60">
		Nothing to suggest right now — everyone close enough to give you a good game
		is either already busy or away.
	</p>
{/if}

<!-- The tab bar gives this tab no mark of its own, so the answer to "who else
     sees this?" lives here: under the list, in every state, because it is as
     true of an empty page as of a full one. -->
<p class="mt-4 text-right text-xs text-tan opacity-60">
	Opponent recommendations are private.
</p>
