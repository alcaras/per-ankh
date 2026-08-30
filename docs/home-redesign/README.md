# Home redesign package

Everything needed to brief a redesign of `/` in one place.

- **`brief.md`** — the design brief. Written from source rather than screenshots, against `main`. It carries the data contract, the render states, the design intent already encoded in the component, and the token ramp, so it stands on its own.
- **`shots/`** — the home page as it renders today: 3 breakpoints × 2 auth passes × 3 feed states.

## The shots

| File | State |
| --- | --- |
| `{anon,auth}__home__{desktop,tablet,mobile}.jpg` | Warm — every feed populated |
| `{anon,auth}__home__cold-feed__{…}.jpg` | No videos anywhere: the video panels drop and the games feed widens to the full row, two-up |
| `{anon,auth}__home__cold-start__{…}.jpg` | No videos and no public games: the feed shows its empty-state copy |

Breakpoints are desktop 1440×900, tablet 768×1024, mobile 390×844.

The `anon` and `auth` pairs differ in one place only — the action in the call-to-action band (Discord sign-in vs. the "Global Stats" + "Your Games" pair). Home reads `user` nowhere else, so the two passes are otherwise identical by construction, not by coincidence.

**Every shot is above the fold.** The capture asks for a full-page screenshot, but the app scrolls in an inner container rather than the document, so the image never grows past the viewport — 1440×900 on desktop regardless of how much page there is. The Recent Games feed carries up to 20 cards and only the first one or two are visible here. Read `brief.md` for what the feed actually holds; do not size the games column from these images.

The cold states cannot be reached by loading the page with a normal local database — they are captured by stubbing the feed endpoints empty. They are real renders of the live component, not mockups.

## Provenance

Captured 2026-08-30 from a local dev server against local D1, via `npm run ux:review -- --game-id ig-lHvRp_8w-0Ik9d6lx_`. The content is development data, so the specific games, videos and names are not production; the layout, density and state behaviour are.
