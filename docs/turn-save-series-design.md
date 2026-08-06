# Turn-save series — Chromium watch-page ingestion & storage design

> **Status:** forward-looking design doc, not an as-built record — nothing in it is built. Written 2026-08-05, grounded in a code read of the parser (`src/lib/parser/`), the upload path (`src/lib/api-cloud.ts`, `cloud/src/games.ts`), the map replay layer (`src/lib/SpriteMap.svelte`, `src/lib/game-detail/reconstruct-map-tiles.ts`), and the storage schema (`cloud/migrations/0002_cloud_schema.sql`). Companion to `docs/save-file-format.md` (the fidelity-tier model this design exists to route around).

## 1. Why this doc exists

Requests of the form *"show me this table/chart/map at any past turn"* are decided by the four temporal-fidelity tiers in `docs/save-file-format.md` — and tiers 3 (rolling event buffer) and 4 (current-state-only: units, improvements, specialists, active laws) are unrecoverable from a single save. That doc's worked example (per-turn science breakdown, assessed 2026-07-19: not possible) ends with the sentence this design acts on: *"Requesting more saves of the same game is the only real path."*

A save per turn converts every tier-3/4 field into a full time series. Proof of concept exists: alcaras produced a save for every turn of one duel and built a standalone replay viewer from it — hex canvas, turn slider, dual side-by-side player POVs each under that player's fog of war, per-turn units/cities/attacks, and per-turn tech/science report panels. This doc designs the per-ankh equivalent: how a series of turn saves is captured from the player's disk, uploaded, stored, and grouped as **one game**.

## 2. Decisions

1. **Ingestion is a browser "watch this folder" page** using the File System Access API (Chromium), not a native companion app and not a CLI. It reuses the existing in-browser parser and the existing Discord session cookie — no new credential surface, nothing to install. Non-Chromium browsers get a manual "sync now" fallback (§4).
2. **Every turn-save ZIP is kept in R2, permanently.** The compact replay track extracted from the series is derived data — versioned and regenerable, never the source of truth. No per-turn parsed blobs, no per-turn D1 stat rows. The final (completed) save remains the one canonical `games` record, exactly as today.

Decision 2 is the reparse lesson applied in advance. The parser is at 2.13.0 with a version allowlist, a blob cache keyed by `parser_version`, and dedicated re-import tooling (`BulkReparseModal`, `reparse-upload`, `reindex`) — all of which exists because what we want from a save keeps changing after upload. A replay-track extractor will follow the same curve, and regeneration is only possible if the raw ZIPs still exist. The cost is negligible: tournament duel saves in `test-data/saves/` run 170–270 KB zipped, so a 60-turn series is roughly 10 MB — about $0.015/month per hundred replay games at R2 pricing. What would actually be expensive — 60 full `FullGameData` blobs and 60 sets of D1 rows per game — is exactly what this design does not store.

## 3. Current state (verified 2026-08-05)

Assets to build on:

- **Stable game identity is already captured.** Every save's `<Root>` carries `GameId`, constant across all saves of one match. It is parsed into `match_metadata.xml_game_id` (`src/lib/parser/parsers/match-metadata.ts:28`) and stored in `games.xml_game_id` (`cloud/migrations/0002_cloud_schema.sql:36`) — but today it is inert: no index, no unique constraint, no query groups on it. The save's current turn is parsed too (`<Game><Turn>` → `match_metadata.total_turns`).
- **The parse pipeline is client-side and reusable as-is.** `src/lib/parser/worker.ts` runs `extractXmlFromZip` → `parseSaveXml` → `extractAllGameData` in a Web Worker (`fflate` + `fast-xml-parser`, no browser-specific core).
- **The map already has a turn slider with playback** (`SpriteMap.svelte`, driven by `reconstruct-map-tiles.ts`), with documented limits — no units, improvements gated on ownership rather than truly historical, no fog. Those limits are precisely what a turn-save series removes.
- **Per-team fog data is already parsed and shipped** — `tile_visibility` with `revealed_turn` per team (`src/lib/parser/parsers/tiles.ts:291`, `TileVisibilityInfo` in `types.ts:267`) — and currently has zero UI consumers.

Blockers this design must change:

- **In-progress saves are rejected twice**: client-side by `validateCompletedGame` (`src/lib/parser/validation.ts` — no `<Game><GameOver/>`, no upload) and server-side by the `NOT_COMPLETED` gate (`cloud/src/games.ts:1379`). A turn-30 save cannot be uploaded at all today.
- **One save = one game, deliberately.** Dedup is `UNIQUE (user_id, file_hash)` on ZIP bytes; `docs/cloud-rewrite-spec.md` §"Duplicate detection" states that two files sharing `xml_game_id` are always two distinct games. This design *preserves* that invariant for the `games` table — snapshots are a new object type attached to a game, never additional game records — so the original decision (guarding against replayed-from-autosave duplicates) stands.
- **No headless ingest path exists** — no CLI, no watcher, and the Worker cannot parse a save (no XML parser in `cloud/` deps; the stored ZIP is never opened server-side). This design keeps it that way: all parsing stays in the browser.

## 4. Ingestion — the watch page

A page (suggested route: `/upload/watch`, sibling of the existing `/upload`) that holds a handle to the player's Old World saves directory and uploads new saves as they appear, while the player plays.

Flow:

1. **Pick the folder once.** `window.showDirectoryPicker()` returns a `FileSystemDirectoryHandle`. Persist the handle in IndexedDB; on a later visit, `queryPermission()`/`requestPermission()` re-arms it with one click instead of a re-pick.
2. **Poll for new files.** Enumerate the directory every ~15 s and diff against a seen-set of `(name, size, lastModified)`. Polling is the dependable baseline; a change-notification API can be adopted later if it stabilizes without altering the design.
3. **Cheap identity parse per new file.** Run only zip-extract + XML parse + `parseMatchMetadata` — enough to read `xml_game_id`, turn, and whether `<GameOver/>` is present. The directory may contain many games' autosaves; `xml_game_id` is what sorts them into series.
4. **Route by completion.** Save without `<GameOver/>` → snapshot upload (§5). Save with `<GameOver/>` → the existing full parse + `POST /v1/games` flow unchanged, which also triggers series linking (§5).
5. **Bulk import is the same code path.** Pointing the page at a directory full of an already-finished game's autosaves just makes every file "new" at once. Order of arrival never matters — snapshots may land before, after, or interleaved with the final save.

Browser support:

| Browser | Experience |
| --- | --- |
| Chromium desktop — Chrome, Edge, Dia, Arc, Brave, Opera, Vivaldi | Full watch: persistent handle, background polling while the tab is open |
| Safari, Firefox (any version) | No `showDirectoryPicker()` (both ship only the Origin Private File System). Fallback: `<input type="file" webkitdirectory>` + a **"sync now"** button — each click re-reads the folder snapshot and uploads anything new. Manual, but complete. |
| Any mobile browser | Not supported (no local-disk pickers) |

Auth is the existing session cookie — the page runs logged in, like every other upload surface. This is the decisive advantage over a companion app (§8).

## 5. Storage & data model

**R2** (`SHARE_BUCKET`):

- `snapshots/{snapshot_id}.zip` — every turn-save ZIP, kept permanently (Decision 2). Keyed by snapshot id, not by game id, because snapshots usually arrive before the `games` record exists; D1 carries the linkage, and nothing ever needs re-keying.
- `games/{game_id}.replay.json.gz` — one replay track per game (§6), stamped with `replay_track_version`.
- `games/{game_id}.json.gz` and `saves/{game_id}.zip` — unchanged.

**D1** (`SHARE_DB`) — one new table, sketch:

```sql
CREATE TABLE save_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(user_id),
    xml_game_id TEXT NOT NULL,
    turn        INTEGER NOT NULL,
    file_hash   TEXT NOT NULL,      -- SHA-256 of ZIP bytes, server-computed like games
    size_bytes  INTEGER NOT NULL,
    save_date   TEXT,
    game_id     TEXT REFERENCES games(game_id),  -- NULL until the final save lands
    created_at  TEXT NOT NULL,
    UNIQUE (user_id, file_hash)
);
CREATE INDEX idx_snapshots_series ON save_snapshots (user_id, xml_game_id, turn);
```

- **Dedup** mirrors `games`: same bytes uploaded twice by the same user is a no-op. Two snapshots of the same turn with different bytes (replayed-from-autosave) both keep — the replay-track generator picks per turn (latest `save_date` wins by default).
- **Upload endpoint**: a new `POST /v1/games/snapshots` (multipart: the ZIP + a small metadata JSON from the cheap parse — `xml_game_id`, `turn`, `save_date`). It deliberately bypasses the completion gate; the gate stays untouched on `POST /v1/games`. The Worker still never parses XML — it trusts-but-bounds the client metadata the same way `POST /v1/games` already trusts the client-parsed blob, and stores the ZIP.
- **Linking**: when a completed save is uploaded through the normal flow, the server backfills `game_id` on all of that uploader's snapshots with the same `xml_game_id`. Series are **per-user** — two players each uploading their own series of the same match link to their own game records, consistent with the existing per-user game model.
- **Gaps and orphans**: missing turns are fine (the replay track holds whatever turns exist). A series whose game never completes just sits unlinked; no auto-deletion — an admin purge command (the `admin-cli` `games` namespace is the precedent) can come later if orphan volume ever warrants it.

## 6. The replay track

One gzipped JSON blob per game, derived from the snapshot series, holding only what the canonical blob cannot: the per-turn slice of tier-3/4 data. Per turn, roughly: units (id, type, owner, position, HP, promotions), cities (population, current production), that turn's rolling-buffer events (`IMPROVEMENT_FINISHED`, `CITY_PRODUCTION`, … — each snapshot contributes its own turn's buffer, which is what makes tier 3 recoverable), improvements/specialists per tile, per-team visibility, and per-player report inputs (current research + alternatives, science-breakdown inputs). Exact contents are `replay_track_version`-versioned and expected to grow — that is why the raw ZIPs are kept (§2).

**Generation is browser-driven**, mirroring `BulkReparseModal`: fetch the series ZIPs from R2 (or use the just-parsed results during a live watch session), run the extractor per snapshot, upload one blob. v1 can make this an explicit "build replay" action on the game page once a series is linked; incremental regeneration on extractor upgrades reuses the same flow. The Worker never parses anything.

Notable unlocks, both previously assessed impossible from a single save:

- **Per-turn science breakdown** — `scienceBreakdown()`'s tier-4 inputs (improvements, specialists, `<ActiveLaw>`, capital culture) exist in each snapshot, so the 2026-07-19 "not possible" verdict in `docs/save-file-format.md` is lifted for games with a series.
- **Dual-POV fog of war** — saves record visibility **per team**, so a single player's series yields every player's revealed-tile history (`tile_visibility` is already parsed). Current-turn *visible* (vs. explored) sets are not stored per turn; alcaras's viewer approximates them geometrically from unit sight radii + city territory, and the same approximation works here.

## 7. UI payoff (sketch, not scoped here)

The existing map turn slider upgrades from ownership-projection to truth: real units on the map per turn, real improvement/road/specialist state, fog-of-war rendering with a POV selector, omniscient toggle. Per-turn report panels (research, science breakdown) become possible on games with a series. Independently of any of this, an "explored vs. unexplored" overlay is already possible today from a single save via the unconsumed `tile_visibility` data.

## 8. Rejected alternatives

- **Native companion app (Tauri/Electron watcher).** Auth is solvable (device-authorization flow issuing a scoped, hashed, revocable upload-only API token), but the real costs are packaging: macOS notarization, Windows SmartScreen/signing, an auto-update channel — a standing operational surface versus a page that needs nothing installed. Revisit only if real usage shows the watch page's limits (tab must stay open; Chromium-only for live watch) actually bite.
- **Node CLI.** Users are non-technical; "install Node" is a non-starter, and a packaged CLI inherits the native-app costs above with worse UX.
- **Server-side parsing of snapshots.** Would add an XML parser to the Worker and a second parse implementation to keep in sync with the browser's. The client-parses/server-stores split is load-bearing; snapshots keep it.
- **Per-turn parsed blobs / per-turn D1 stat rows.** ~60× redundant storage of data the canonical blob already has in tier-1 form; everything genuinely per-turn lives in the replay track.
- **Dropping snapshot ZIPs after extraction.** A one-way door that breaks the reparse model for exactly the data class most likely to need re-extraction. Storage cost is cents (§2).

## 9. Open questions

- **Live follow.** Snapshots arriving during play make a "watch this game in progress" page possible (the series exists before the game does). Deliberately out of scope for v1 — games stay invisible until the final save lands, preserving the completed-games-only product model — but the data model above does not preclude it.
- **Tournament tie-in.** `POST /v1/games` already accepts `tournament_match_id`; whether the watch page should carry match context (auto-tagging a series to a scheduled match) is a product question for tournament ops.
- **Merging both players' series.** Per-user series are independent by design (§5). Whether a game page should be able to combine two linked players' series into one richer replay (e.g. preferring each player's own snapshots for their POV) is open; single-series dual-POV (§6) may make it unnecessary.
- **Snapshot cadence.** Old World's autosave-per-turn is the natural source, but the design tolerates any cadence — every turn, every fifth, or a partial directory.
