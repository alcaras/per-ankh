# Home redesign package

Everything needed to brief a redesign of `/` in one place.

- **`brief.md`** — the design brief. Written from source rather than screenshots, against `main`. It carries the data contract, the render states, the design intent already encoded in the component, and the token ramp, so it stands on its own.
- **the shots** — the home page as it renders today: 3 breakpoints × 2 auth passes × 3 feed states, in [`../ux-review/shots/`](../ux-review/shots/).

## The shots

They live in the UX-review bundle rather than beside this README, so there is one copy and no step to repeat after a capture: `./per-ankh ux-review` refreshes them in place. Paths below are relative to this file.

| File | State |
| --- | --- |
| `../ux-review/shots/{anon,auth}__home__{desktop,tablet,mobile}.jpg` | Warm — every feed populated |
| `../ux-review/shots/{anon,auth}__home__cold-feed__{…}.jpg` | No videos anywhere: the video panels drop and the games feed widens to the full row, two-up |
| `../ux-review/shots/{anon,auth}__home__cold-start__{…}.jpg` | No videos and no public games: the feed shows its empty-state copy |

Breakpoints are desktop 1440×900, tablet 768×1024, mobile 390×844.

The `anon` and `auth` pairs differ in one place only — the action in the call-to-action band (Discord sign-in vs. the "Global Stats" + "Your Games" pair). Home read `user` nowhere else, so the two passes were otherwise identical by construction, not by coincidence.

**These shots predate the redesign this package briefed.** They are the `main` of 2026-08-30, kept because the brief is written against it. The page they show no longer exists: the hero row's Featured Video tile is now the Community Tools panel, the tournament still is the backdrop of a live standings/schedule panel, a row of stats and season-standings panels sits between the hero row and the discovery grid, and `user` is read in a second place — the "Your season" panel, which is absent for an anonymous visitor. Re-run `./per-ankh ux-review` for shots of the current page.

**Every shot is above the fold.** The capture asks for a full-page screenshot, but the app scrolls in an inner container rather than the document, so the image never grows past the viewport — 1440×900 on desktop regardless of how much page there is. The Recent Games feed carries up to 20 cards and only the first one or two are visible here. Read `brief.md` for what the feed actually holds; do not size the games column from these images.

The cold states cannot be reached by loading the page with a normal local database — they are captured by stubbing the feed endpoints empty. They are real renders of the live component, not mockups.

## Provenance

Captured 2026-08-30 from a local dev server against local D1, via `./per-ankh ux-review --game-id ig-lHvRp_8w-0Ik9d6lx_`. The content is development data, so the specific games, videos and names are not production; the layout, density and state behaviour are.

Home does not vary with the pinned game, so a later capture run — which picks its game at random — refreshes these shots without changing what they show. `../ux-review/README.md` records the game and date of whatever run produced the current set.
