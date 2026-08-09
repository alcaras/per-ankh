<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import CreatorVideos from "$lib/CreatorVideos.svelte";
	import DiscordLoginButton from "$lib/DiscordLoginButton.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import RecentSaveCard from "$lib/RecentSaveCard.svelte";
	import Panel from "$lib/ui/Panel.svelte";
	import VideoCard from "$lib/VideoCard.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const user = $derived(page.data.user);

	// The videos column only exists when a creator or a tournament playlist has
	// recent uploads (empty on a cold feed cache). It's the only thing that
	// varies the discovery grid below: present, it takes half the row and the
	// games feed keeps its cards in one column; absent, the feed spans the row
	// on its own and the cards go two-up.
	const hasVideos = $derived(data.videos.length > 0);
</script>

<main class="isolate flex flex-1 flex-col overflow-hidden">
	<div
		class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
		use:autohideScroll
	>
		<div class="mx-auto max-w-screen-2xl">
			<!--
			The call to action, on one narrow full-width row: the pitch on the left,
			the action on the right, stacking on mobile. Both viewers get the band —
			only the action differs (sign in vs. a link into your own games), so the
			whole page reads the same signed in or out.
			-->
			<section
				class="mb-4 flex flex-col gap-3 rounded-lg px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6"
				style="background-color: rgb(var(--color-surface-raised));"
			>
				<!--
				Pitch + pills travel together as the left cluster, a fixed `sm:gap-8`
				apart, so the pills read as part of the pitch instead of floating in
				the middle. All the row's slack lands between this cluster and the
				action (the section's `justify-between`), which keeps the pitch→pills
				spacing identical at every window width.
				-->
				<div
					class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-8"
				>
					<div class="min-w-0">
						<h1 class="text-xl font-bold text-gray-200 sm:text-2xl">
							Parse, analyze and share your Old World games
						</h1>
						<p class="mt-1 text-sm text-tan opacity-90">
							Upload save files and explore every detail of your games.{#if !user}
								Sign in with Discord to get started.{/if}
						</p>
					</div>

					<!--
					The three feature pills. A vertical list at this size: the band is a
					third the height of the panel they used to sit in as a wrapping row,
					and stacked they fill it instead of forcing it taller.
					-->
					<div
						class="flex shrink-0 flex-col gap-1 text-xs font-semibold text-tan"
					>
						<span class="flex items-center gap-1.5">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-3.5 w-3.5 text-orange"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-2.28 5.941"
								/>
							</svg>
							Interactive charts
						</span>
						<span class="flex items-center gap-1.5">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-3.5 w-3.5 text-orange"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
								/>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
								/>
							</svg>
							Explorable map
						</span>
						<span class="flex items-center gap-1.5">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-3.5 w-3.5 text-orange"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"
								/>
							</svg>
							Share saves
						</span>
					</div>
				</div>

				<!--
					The action. Signed in it's the way into your own games, carrying the
					same avatar the header shows so it reads as "you". Signed out it's the
					same button the header's Login is, sized as a call to action.
					-->
				{#if user}
					<ProfileLink
						userId={user.user_id}
						slug={user.slug}
						class="inline-flex shrink-0 items-center gap-2 self-start rounded-md bg-[#292623] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:text-orange sm:self-auto"
					>
						<img
							src={user.avatar_url}
							alt=""
							class="h-6 w-6 rounded-full border border-black"
							width="24"
							height="24"
						/>
						Your Games
					</ProfileLink>
				{:else}
					<DiscordLoginButton
						label="Continue with Discord"
						class="inline-flex shrink-0 items-center gap-2 self-start rounded-md bg-[#5865F2] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#4752c4] disabled:opacity-60 sm:self-auto"
					>
						<svg
							class="h-5 w-5"
							viewBox="0 0 24 24"
							fill="currentColor"
							aria-hidden="true"
						>
							<path
								d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3.2a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 5.83 4.369a.07.07 0 0 0-.032.027C3.476 7.86 2.843 11.255 3.156 14.605a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.056c.5-3.873-.838-7.24-3.549-10.209a.061.061 0 0 0-.031-.028ZM9.681 12.564c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"
							/>
						</svg>
					</DiscordLoginButton>
				{/if}
			</section>

			<!--
			The two hero tiles, side by side on desktop and stacked on mobile: the
			current major tournament, then the newest featured video. Shown to every
			viewer — they are how the home page surfaces the tournament now that the
			signed-in rail is gone. 16:9 stacked, and on desktop the grid stretches
			both panels to the row height, with the banner filling whatever its panel
			gets (`lg:flex-1`) so it ends level with the video panel however the video
			title wraps, cropping via object-cover.
			-->
			<div class="mb-4 grid gap-4 lg:grid-cols-2">
				<!--
				Tournament highlight: the whole tile links to the current major
				tournament. The event name is baked into the still (the animation's
				opening title card), so no text overlay is needed — the panel header
				names the section.
				-->
				<Panel title="Featured Tournament" class="flex flex-col">
					<a
						href={resolve("/tournaments/2026-community-tournament")}
						class="group block aspect-video overflow-hidden rounded-lg bg-black lg:aspect-auto lg:flex-1"
					>
						<img
							src="/tournament-hero.webp"
							alt="2026 Community Tournament"
							width="654"
							height="345"
							class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
						/>
					</a>
				</Panel>

				<!--
				The newest featured video — the same VideoCard the strip below and every
				other video surface renders, so the hero can't drift into a second video
				card style. Absent only when nothing is featured AND both video feeds
				came back empty (see heroVideo in +page.ts), which leaves the tournament
				panel alone in its column.
				-->
				{#if data.heroVideo}
					<Panel title="Featured Video">
						<VideoCard video={data.heroVideo} />
					</Panel>
				{/if}
			</div>

			<!--
			Discovery grid (desktop): recent saves (left) → videos (right). A column
			with no content drops out and its neighbour widens. Each column is a
			titled Panel, the same chrome the hero row uses.
		-->
			<!--
				On mobile the grid stacks in DOM order; `order` utilities lift the
				videos above the long games feed there, while `lg:order-*` restores
				the desktop left→right (games → videos) arrangement.
			-->
			<div class="grid gap-4 lg:grid-cols-2">
				<Panel
					title="Recent Games"
					class={`order-2 lg:order-1 ${hasVideos ? "" : "lg:col-span-2"}`}
				>
					{#if data.recentGames.length === 0}
						<p class="text-sm text-tan opacity-70">
							No public saves yet. Be the first — upload a save and toggle
							visibility to public.
						</p>
					{:else}
						<div
							class={hasVideos
								? "grid grid-cols-1 gap-3"
								: "grid grid-cols-2 gap-3"}
						>
							{#each data.recentGames as game (game.game_id)}
								<RecentSaveCard {game} />
							{/each}
						</div>
					{/if}
				</Panel>

				<!--
				Videos: creator uploads and tournament-playlist uploads merged into one
				strip — right column on desktop, full-width on smaller screens (the
				component handles the responsive grid). `self-start` keeps it at its
				content height instead of stretching to the (much taller) games column,
				so it ends after its last card. Omitted entirely on a cold/empty feed
				rather than leaving a gap.
			-->
				{#if hasVideos}
					<Panel title="Recent Videos" class="order-1 self-start lg:order-2">
						<CreatorVideos videos={data.videos} />
					</Panel>
				{/if}
			</div>
		</div>
	</div>
</main>
