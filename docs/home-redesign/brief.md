# Home page design brief

Input material for a redesign of `/` — the page every visitor lands on, signed in or out. Written from the source rather than from screenshots, because `src/routes/+page.svelte` and `src/routes/+page.ts` carry their design reasoning in comments.

Written against `main` as of 2026-08-30. (The `ux-review-home-cold-states` branch is 41 commits behind and predates global stats; `+page.ts` is identical on both, `+page.svelte` differs only in the CTA action.)

## The problem

Per-Ankh knows a great deal about Old World games, and home shows a thin slice of it: twenty recent saves, up to twelve videos, one featured video, and a picture of a tournament. Everything else the app has computed — a whole-corpus statistics engine, per-user records, live tournament standings — is reachable only by navigating away.

We want home to be a better representation of the data we have. Concretely: **feature more videos, bring stats onto the page, highlight specific users, and leave room for a player ranking** that does not exist yet but will.

The obstacle is that the page has no framework to add any of that to. It is a fixed arrangement of four hardcoded regions with exactly one conditional in the whole component — `hasVideos`, which toggles a column span. There is no vocabulary of modules, no notion of what earns space, no rule for what happens when a fifth kind of content arrives. Adding a ranking today means hand-editing a grid and inventing its behaviour from scratch.

## What we want out of this

A **framework**, not a layout. The useful output is a system that answers:

- What is the vocabulary of home — what kinds of module exist, and what is each one for?
- How do modules rank against each other, and what earns a module more space or a better slot?
- How does each module behave when its data is thin, empty, or gated? (This is not an edge case here — see the states below.)
- How does a new module — a player ranking — get added without redesigning the page?
- What does an anonymous visitor see where a signed-in one sees more? Today that difference is one button; the richest data we have is signed-in only, so the redesign has to take a real position on this.

## What Per-Ankh knows that home doesn't show

Each of these is live on `main` and absent from home.

**Global statistics — the largest gap.** `GET /v1/stats` returns a single `ChartBundle` covering roughly 22 charts over the entire public corpus: nation win rates and average points, starting-leader archetype and trait win rates, wonders (built, eligible, timing, outcome), cities, laws, tech, families, and per-turn yield curves as p25/p50/p75 distribution bands. It is faceted two ways — a composition slice (`all`, `duel`, `ffa`, `single_player`) and a nation. The default slice is `duel`, deliberately: 94% of the public corpus is 1v1, so the all-public numbers *are* the duel numbers.

Home surfaces none of it. On `main` the signed-in CTA carries a "Global Stats" button to `/stats`; a signed-out visitor gets no stats and no link. **`/stats` is signed-in only — `GET /v1/stats` 401s without a session**, and it spends its own per-IP budget (`GLOBAL_STATS_VIEW_PER_HOUR = 600`) rather than a share of the anonymous read budget. That gate is the central design constraint on "bring some stats in": deciding what a public home page may show is a product decision, not a layout one.

**Users.** A user appears on home only as a name and avatar inside a save card. The data for more exists on the public profile: `summary` carries `total_games`, `win_rate`, `favorite_nation` and `favorite_day_of_week`; alongside it are linked video channels, a `tournament_participant` flag, a profile slug and an avatar. There is, however, **no "top users" or "featured users" endpoint** — `GET /v1/users/public-search` is query-driven and signed-in only. So "highlight specific users" needs either an admin-curated set (the pattern `featured_videos` already establishes) or a new server-side aggregate. Both are buildable; the design should say which shape it wants.

**Videos.** Both feeds cap server-side at 12 (`MAX_CREATOR_FEED_VIDEOS`, `MAX_TOURNAMENT_FEED_VIDEOS`); they are merged, the hero is pulled out, and the remainder is capped again at `VIDEO_STRIP_SIZE = 12`. All three caps are documented as moving together. Notably, `GET /v1/featured-videos` returns a **list** — an admin can feature many — and home consumes exactly one of them, `featuredVideos[0]`, as the hero. So "feature more videos" is partly a cap change and partly the discovery that a curated set already exists with nowhere to go.

**Tournaments.** The live tournament API is extensive: `/v1/tournaments`, and per tournament `/standings`, `/bracket`, `/rounds`, `/matches`, `/videos`, `/stats`. Home represents all of it with a hardcoded link to `/tournaments/2026-community-tournament` and a static `/tournament-hero.webp` whose event name is baked into the image — a picture that must be re-cut by hand every season. The most live thing on the site is the most static thing on the page.

**A player ranking does not exist.** There is no Elo, Glicko, or rating anywhere in the app; the only leaderboard is a count of caster appearances inside tournament stats. A ranking is net-new data. The design should treat it as a module whose slot and shape we reserve now — what it needs to say, how much room it takes, what it degrades to — rather than assume numbers that aren't there.

## What the page is today

In DOM order, inside a `max-w-screen-2xl` scroll column:

1. **Call-to-action band** — one full-width row on `surface-raised`. Left cluster: an `h1` ("Parse, analyze and share your Old World games"), a one-line subhead, and three feature pills stacked vertically (Interactive charts / Explorable map / Share saves). Right: the action — signed out, a Discord button; signed in, a pair, "Global Stats" then "Your Games", in that order because the first is the same page for every viewer and the second is yours.
2. **Hero row** — `lg:grid-cols-2`. Panel "Featured Tournament" (whole tile links out, static still) and Panel "Featured Video" (one `VideoCard`).
3. **Discovery grid** — `lg:grid-cols-2`. Panel "Recent Games" (up to 20 `RecentSaveCard`s) and Panel "Recent Videos" (a 2-up grid of compact `VideoCard`s).

On mobile the discovery grid stacks in `order` order, lifting videos above the long games feed; `lg:order-*` restores games → videos on desktop. Every section is a `Panel`: `rounded-lg bg-surface p-3` with an `h2 mb-3 text-base font-bold text-tan`.

## The data contract, and what it costs

All of home's data is fetched in one `Promise.all` in `+page.ts`.

- **Recent games** — `GET /v1/games/public-recent`, anonymous, capped server-side at `PUBLIC_RECENT_LIMIT = 20`. Each row ships the full player roster (humans *and* AI) plus a per-turn victory-point series, deliberately, so a card draws its sparkline with no follow-up request. It shares the `anon_read` rate-limit bucket and is the busiest reader of it.
- **Creator / tournament videos** — `GET /v1/creator-videos`, `GET /v1/tournament-videos`, capped at 12 each. Merged newest-first and de-duplicated on `platform:id`, creators leading the concat so the entry carrying Per-Ankh identity wins a tie.
- **Featured videos** — `GET /v1/featured-videos`, the admin-curated set, newest first.

Three properties any new module inherits:

- **Failure is a first-class state.** Every feed degrades to an empty list on error, so a Worker hiccup shortens the page rather than blanking it. The one exception is `listPublicRecent`, which re-throws a 429 — "nothing has been shared lately" is a different and wrong answer to "you have made too many requests".
- **Anonymous page, anonymous budget.** Adding server-backed modules to a page anyone can load spends rate-limit budget per visitor. `/v1/stats` and both user searches sidestep this by requiring a session — which is exactly why they aren't on home yet.
- **PII stays in its lane.** `online_id` is stripped for anonymous viewers, and `discord_username` never appears in a public payload. (`avatar_url` does embed the Discord snowflake — that is accepted app-wide, as the only way to render an avatar.)

**`user` is read in exactly one place**: the CTA band, for the trailing sentence and which action renders. Nothing else varies by viewer, so *"signed in with no games" is not a distinct home state* and needs no design.

## The states a design has to cover

`hasVideos` is the only flag that reshapes the page today. These four renders were verified in a browser on 2026-08-30:

| State | Panels present | Games feed |
| --- | --- | --- |
| **Warm** (the usual case) | Featured Tournament, Featured Video, Recent Games, Recent Videos | one column, 20 cards |
| **Cold feed** (no videos anywhere) | Featured Tournament, Recent Games | spans the full row, cards **two-up** |
| **Cold start** (no videos, no public games) | Featured Tournament, Recent Games | empty-state copy only |
| **Single video** (one video total) | Featured Tournament, Featured Video, Recent Games | spans the full row, two-up |

Two consequences worth designing for deliberately. Losing the videos does not merely remove a column — it re-flows the games feed into a two-up grid it never otherwise uses, so the cold layout is a genuinely different page. And the "single video" row is the hero-exclusion rule biting: one video becomes the hero and the strip vanishes, so home can show a Featured Video with no Recent Videos beneath it.

A framework with more modules multiplies these combinations, which is why per-module empty behaviour needs to be part of the system rather than decided case by case.

Cold-start empty copy, verbatim: "No public saves yet. Be the first — upload a save and toggle visibility to public."

## Design intent already encoded

Decisions the current page makes on purpose. Honor them or overturn them knowingly — they are not accidents.

- **One page, both viewers.** The CTA band is shown to everyone and only its action differs. The signed-in right-rail was removed (`1c1a150`) and the two pages merged (`93532ce`).
- **The hero row is how home surfaces the tournament** now that the signed-in rail is gone.
- **The tournament tile carries no text overlay** — the event name is baked into the still, and the panel header names the section.
- **The featured video reuses `VideoCard`**, the same component every other video surface renders, specifically so the hero cannot drift into a second card style.
- **The strip excludes the hero**, because the hero is usually also the newest item in the feeds and would otherwise render twice. The cap is applied after the exclusion so the strip still carries a full twelve.
- **The videos panel is `self-start`**, ending at its own content height rather than stretching to the much taller games column — and is omitted entirely on a cold feed rather than leaving a gap.
- **Pitch and pills travel as one cluster** a fixed `sm:gap-8` apart, so all the row's slack lands between the cluster and the action and the pitch→pills spacing is identical at every width.

## Density — the incumbent to argue with

Each `RecentSaveCard` renders **eleven** stat tiles (Player, Winner, Victory Type, Map, Multiplayer, Difficulty, Cities, Techs, Laws, VP, Turns) across two 5-column grids, plus an ECharts victory-point sparkline with one series per player including AI. Home renders up to twenty of them, and in the cold-feed layout those twenty go two-up.

This is the heaviest element on the page and the least revisited. It is also the space any new module has to come out of. A framework that adds stats, users and a ranking has to say what a discovery card actually needs to convey to someone scanning — versus what belongs on the game detail page one click away.

## Visual system

Dark and warm-brown. Tokens live in `src/app.css` `:root` as space-separated RGB channels so they compose with Tailwind opacity modifiers (`bg-tan/15`).

- **Surfaces**, darkest → lightest, each with a hover step: `surface-deep` `#1a1510`, `surface-sunken` `#241f1b`, `surface` `#2a2622` (primary cards, sections, stat boxes), `surface-raised` `#35302b` (inputs, raised cards, menus). Page background is `blue-gray` `#211a12`.
- **Accents**: `orange` `#ffa500`, `tan` `#d2b48c`, `brown` `#a52a2a`, `dark-brown` `#79261d`.
- **Text**: `bright` `#DBDEE3` (values and titles), `tan` (panel headings), `muted` `#7a6a55` (labels), `gray-200` `#eeeeee`.
- **Semantic**: `success` / `success-surface` and `danger` / `danger-surface` — advance/win and eliminate/loss.
- **Charts**: `CHART_THEME` and `getChartColor(i)` from `$lib/config`; nation color via `getCivilizationColor(nation) ?? getChartColor(i)`. Never a hardcoded hex, never a gray fallback where a helper exists.

`docs/design-audit.html` is a live-rendered inventory of every visual pattern in the app with `file:line` citations — useful as a catalogue. **Its "divergences to consolidate" list is stale**: it predates the June tokenization (`26b6c1b`) that fixed its top-impact rows. The inline `#35302B`, `#2a2622` and `#DBDEE3` counts it reports as 15+, 7+ and 20+ are now 3, 2 and 1. Two findings do survive: `--color-tan-hover` is defined identical to `--color-tan`, so every `hover:bg-tan-hover` is a no-op, and `--color-yellow` is defined and never used. Treat the token ramp in `src/app.css` as the authority.

## Open questions the design should answer

1. **The anonymous/signed-in split.** The richest data is behind a session. Does home show anonymous visitors a reduced form of it, a teaser that converts, or nothing? This is the highest-leverage question here.
2. **Curated or computed.** Featured users and featured videos could be admin-picked (following `featured_videos`) or derived server-side. Which, and does the same mechanism serve both?
3. **How many videos is "more"**, and in what shape — a longer strip, a denser grid, or a second tier below a curated few?
4. **Where a ranking lives before it exists**, and what it degrades to while the corpus is too thin to rank anyone honestly.
5. **What the tournament module becomes** once it reads live data instead of a hand-cut image.

## Non-goals

- Do not design a "signed in with no games" state — it does not exist; see the data contract.
- `docs/archive/per-ankh-home-redesign-spec.html` is a **superseded** earlier redesign, kept for history only. It describes a page predating the two-page merge.
- `docs/ux-review/review.html` is a ranked QA defect list from a ten-expert panel that states outright it read no source code, and its home screenshots depict the pre-rebuild page. Not a model for this work, and not a description of the current page.
