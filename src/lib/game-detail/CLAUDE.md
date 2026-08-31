# Game Detail View (`src/lib/game-detail/`)

Builds the `/games/[id]` page.

## Adding to the view

- **Adding a yield chart:** add one entry to `YIELD_CHART_CONFIG` in `helpers.ts`, and add the new key to `ChartFilterKey` and `PLAYER_CHART_KEYS` in the same file.
- **Adding a tab:** create `FooTab.svelte` here, then add a `Tabs.Trigger` and `Tabs.Content` in `GameDetailView.svelte`.

## Changes that need new backend data

UI-only changes work without touching the backend. But if a new chart/tab needs data not in the existing game blob, update the cloud Worker (`cloud/src/`) — add the field to the game blob shape and to the validation schemas (see `cloud/src/CLAUDE.md`).

Deploy the Worker schema change **before** releasing the frontend that depends on it.

## Per-player vs whole-game data (a correctness trap)

Stats bugs here have come from conflating whole-game state with the current player's. Gate on the **player's own** data, not "any player": e.g. a naval/tech-unlock marker should key off the player's own units, not any player's — otherwise player A's boat lights up player B's markers in an FFA. Watch for mixing a fog-limited roster count with a complete power stat. Use `getNationChartColor(player.nation, i)` from `$lib/config` for per-player series color, never a gray literal.

## Momentum (the duel win-probability curve)

`momentum.ts` is the scorer, and it is the **source of truth**: the Worker's `cloud/src/momentum.ts` is GENERATED from it — after editing here, run `npm run bake:momentum -- --mirror-only` (no corpus needed) to regenerate the mirror; never hand-edit it (a regeneration test pins it byte-for-byte). The model, its fitted weights (`$lib/generated/momentum`), and its validation suite live in `scripts/bake-momentum.ts`.

Refitting the weights (`npm run bake:momentum`, needs `MOMENTUM_CORPUS_DIR`) is an **explicit act**, deliberately excluded from `bake:all` — a finished game's curve must never drift because a bake re-ran. A refit keeps `MOMENTUM_MODEL_VERSION`; a form change bumps it, and every scored D1 row records `momentum_version` so vintages stay distinguishable.
