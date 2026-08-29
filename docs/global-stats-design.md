# Global stats — design

A public `/stats` surface that runs the existing chart catalog over the **whole public corpus** rather than one user's library or one tournament's games. Forward-looking: this is the plan, not the as-built record. When it ships, fold the outcome into `docs/aggregate-statistics.md` and retire this doc.

Status: **planned, unbuilt.** Written 2026-08-28.

## 1. What this is

Today the chart catalog answers "how do *my* games look" (`/users/[user_id]?tab=stats`) and "how did *this tournament* look" (`/tournaments/[slug]/stats`). It cannot answer "how do multiplayer duels look, across everyone" — the question the charts are actually best at, because it is the only corpus large enough for the distributions to mean something.

`/stats` is that surface: pick a **slice** (a corpus), optionally narrow it with **facets**, read the same charts.

## 2. What already exists

Most of the machinery is in place, and this is deliberate — `docs/aggregate-statistics.md` §"Core idea" kept the seam open on purpose.

- **The corpus seam.** `buildChartBundle(env, corpus, parserVersion, focal)` (`cloud/src/stats/aggregate.ts:577`) takes an opaque game-id list and nothing else. Two resolvers feed it: `resolveUserCorpus` and `resolveTournamentCorpus` (`cloud/src/stats/resolve.ts`). A global slice is a third resolver.
- **The focal widening.** `focal: "humans"` (`aggregate.ts:36`) already counts every human player rather than only the uploader — built for tournaments, and exactly right for a global corpus where both sides of a duel matter. It returns `ChartBundleCore`, which correctly omits the one-focal-per-game fields (`win_rate`, `summary.top_nation`) that read ~50% by construction over an all-humans corpus.
- **Composition predicates.** The `vs_ai` / `mp` game-type fragments in `cloud/src/games-scope.ts:60-77` are pure `game_id IN (subquery)` with no `user_id` reference, so they lift to a global corpus unchanged.
- **The KV bundle cache.** `cloud/src/stats/cache.ts` — parser-version and schema-version embedded in the key, 24h TTL, prefix-walk invalidation.
- **The cron.** `wrangler.toml` already declares `crons = ["47 3 * * *"]` with a `scheduled` handler (`cloud/src/index.ts:1177`) that reads `controller.cron`.

What does **not** exist: a global resolver, a facet vocabulary, precomputation, the route, and the frontend's ability to render a `ChartBundleCore` through the chart registry (see §9).

## 3. Slices

Four, each `is_public = 1`. Counts are from the 2026-08-25 corpus snapshot; §16 re-derives them.

| Slice | Predicate | Public games | Focal rows |
| --- | --- | --- | --- |
| All public games | (no composition filter) | 572 | 90,406 |
| Multiplayer duels | exactly 2 players, both human | 538 | 78,878 |
| Multiplayer FFA | 3 or more human players | 19 | 9,363 |
| Single-player | exactly 1 human player | 10 | 1,209 |

*Focal rows* are the human `game_player_turn` rows a slice feeds to `loadYieldCurves` — the quantity §7 is denominated in, and the one that governs whether a slice fits.

**The corpus is duels.** 94% of public games are 1v1, so "All public games" and "Multiplayer duels" are the same charts to within 34 games, and the other two slices are small enough that a facet applied to them is decorative. Ship all four regardless: the taxonomy is the point, and the two thin slices cost 9 queries and ~20 MB each. Expect the duel slice to carry the page.

**Tournament is not a slice.** A tournament match is two humans playing each other, so tournament games are a subset of multiplayer duels — not a sibling category. Per-tournament stats already have their own page. This is deliberate and is the same taxonomy defect that issue #228 records against the existing `?scope` selector.

**The duel predicate counts players, not humans:** `HAVING COUNT(*) = 2 AND SUM(is_human) = 2`. The existing scope predicates filter `WHERE is_human = 1` and *then* count, which lets a 2-human + 2-AI game pass as a duel. The shared helper implements the player-counting form; the divergence covers 5 public games today, at player/human compositions 3/2, 4/2, 5/2 and 6/2.

**The three composition slices do not partition the corpus.** Those same 5 games match no composition predicate — too few humans for FFA, too many for single-player, too many players for a duel — and so appear only under "All public games". That is the intended reading, and it is why the all-public slice is not the union of the other three (its 90,406 focal rows against their 89,450).

## 4. Facets

Two, both **multi-select**, ANDed with the slice:

- **Nations**
- **Map sizes**

### 4.1 Facets cannot be precomputed

~13 playable nations and 7 map sizes present in the public corpus. Multi-select means every subset is a valid selection, so the combination space is 4 slices × 2¹³ × 2⁷ ≈ **4.2 million bundles**. Single-select would still be ~448 bundles, an upper bound of ~48,000 D1 queries ≈ 48 cron invocations. Neither is precomputable.

This is the central architectural consequence and it shapes §5.

### 4.2 The nation facet filters *players*, not games

In a Rome-vs-Greece duel with "Rome" selected, filtering by *game* would qualify the match and then feed **both** players' rows into `yieldCurves` — including the Greek's. That is not what anyone means by "Rome stats".

So the nation facet restricts the **focal set**: only rows for players of a selected nation contribute. Multi-select composes as a union of focal sets. Map size has no such ambiguity — it is a pure game property and filters games.

Consequence: the focal convention gains a third form. It currently lives in exactly two places (`buildSelfMembership` and `loadYieldCurves`'s `selfClause`, both in `aggregate.ts`); a nation-restricted focal must thread through both and nowhere else.

### 4.3 Rejected: nation as a client-side display filter

Eight bundle fields are already nation-keyed (`nationWinRate`, `nationAvgPoints`, `nations`, `familyByNation`, `lawTiming`, `openingLaws`, `techFirst`, `techTiming`), so a nation filter could be a free client-side row filter over data already in the payload. But the other eight are not nation-keyed (`yieldCurves`, `wonderStats`, `capitalFamilyWinRate`, `expansionWinRate`, `startingArchetypeWinRate`, `startingTraitWinRate`, `summary`, `favorite_day_of_week`) and would silently ignore the filter. Half the page quietly not respecting a control is worse than not offering the control. Rejected.

## 5. Architecture: precompute slices, compute facets on demand

```
cron (nightly)          4 unfaceted slices ──▶ KV, long TTL
request with facets ──▶ compute on demand ──▶ KV, short TTL, opportunistic
```

- The **four unfaceted slices** are precomputed by the cron. Cheap and bounded.
- A **faceted selection** is always a *subset* of its slice, so it is strictly smaller in queries and memory than the slice it narrows. It is computed in the request and cached under a key derived from the normalized facet set. Popular combinations warm naturally; exotic ones cost one compute.

This inverts cleanly as the corpus grows: if on-demand aggregation stops fitting a request budget, the fallback is to precompute more and refuse the long tail, not to redesign.

CPU is not what bounds this path. A whole-corpus aggregation costs ~1s of JS (§6.1) against a 30s fetch-handler default (raisable to 5 min via `limits.cpu_ms`), and a faceted selection is a subset of its slice and therefore cheaper still. The request path is bounded by memory instead — §7.

## 6. Budgets and platform limits

Verified against Cloudflare docs, 2026-08-28.

| Limit | Value | Note |
| --- | --- | --- |
| Cron CPU time | 30s if interval < 1h; **15 min if ≥ 1h** | A daily cron gets the 15-min tier |
| D1 queries per invocation | **1,000** (Paid) | The binding constraint, not subrequests |
| Subrequests per invocation | 10,000 (Paid) | D1/KV calls count; not a concern here |
| Isolate memory | **128 MB** | See §7 — the real ceiling |
| D1 rows read | 25 B/month included, then $0.001/M | Effectively free at this scale |
| KV writes | 1M/month included, then $5/M | Nightly × 4 slices ≈ 120/month |
| KV storage / max value | 1 GB included / 25 MiB per value | Not a concern |
| D1 max bound params | 100 | Why `CHUNK_SIZE = 50` leaves headroom |

**Query arithmetic.** The aggregator runs 9 chunked query loops at `CHUNK_SIZE = 50`, so a slice costs exactly `ceil(N/50) × 9` queries. The all-public slice is 108; all four together are 225, well inside one invocation's 1,000. The ceiling arrives at roughly 5,500 games in a single slice (§15).

**Both the query ceiling and the memory ceiling are per invocation.** `crons` is an array and the handler already dispatches on `controller.cron`, so splitting slices across staggered cron patterns gives each a fresh 1,000-query budget *and* a fresh isolate. Keep every added pattern at an interval ≥ 1 hour to stay on the 15-minute CPU tier.

### 6.1 Cost of one aggregation

Baseline, established by driving the real `buildChartBundle(env, corpus, version, "humans")` over all nine loaders against the 2026-08-25 snapshot, with D1 replaced by an in-process SQLite shim of `QueryableD1` (Apple M2, Node 25):

| Slice | Queries | JS CPU | Peak live heap | Bundle JSON | gzipped |
| --- | --- | --- | --- | --- | --- |
| All public (572) | 108 | ~0.98 s | 97.7 MB | 622 KB | 154 KB |
| Duels (538) | 99 | ~0.87 s | 86.4 MB | 597 KB | 151 KB |
| FFA (19) | 9 | ~0.09 s | 19.6 MB | 419 KB | 112 KB |
| Single-player (10) | 9 | ~0.02 s | 2.8 MB | 385 KB | 94 KB |

Read these as an order of magnitude, not a contract, in two directions. SQLite runs in-process, so its time is excluded from JS CPU exactly as D1's would be — but workerd charges result deserialization the shim does not, so the deployed figure is some multiple of this rather than equal to it. And Node's `heapUsed` is not workerd's 128 MB accounting; what transfers is the ratio between slices and the slope in §7, not the third digit.

## 7. Memory — the binding constraint

`loadYieldCurves` (`aggregate.ts:273`) pulls **raw** `game_player_turn` rows and retains, per row, one number in each of 32 arrays (16 series × rate + cumulative). Decided games land in `pooled` *and* one of `winners`/`losers`, so they are stored twice.

The rate is **~890 bytes of live heap per focal row**, over a ~17 MB floor for the other eight loaders — a slope confirmed across corpus subsets from 143 to 572 games. `loadYieldCurves` is ~83% of the peak: holding the corpus fixed at 572 games and halving the focal set (`focal: "uploader"`) takes the peak from 97.7 MB to 57.3 MB.

At 90,406 focal rows that puts the all-public slice at **97.7 MB against a 128 MB isolate** — 76% of the ceiling in live objects, before allocation churn. §7.1 is what buys the headroom back, which is why it is a prerequisite rather than a tidy-up.

### 7.1 Required: disjoint cohorts

Accumulate **winners / losers / undecided** as three disjoint cohorts instead of `pooled` + `winners` + `losers`. The pooled bands are then the merge of all three at band time — exactly identical percentiles. Local change to one function, no bundle-shape change.

The saving is set by how much of the corpus is decided, since a decided row is the one stored twice. 89,284 of 90,406 public focal rows — **98.8%** — sit in decided games, so this halves sample storage: `loadYieldCurves` goes from ~81 MB to ~41 MB and the all-public peak lands near 55–60 MB. That is the difference between a slice that fits with room and one that runs at 76% of the isolate.

### 7.2 Contingency: turn-window chunking

Out of v1 scope — with §7.1 the largest slice fits with roughly half the isolate free. If a slice later outgrows it, process turns in windows (1–20, 21–40, …) instead of all at once. Percentiles are computed per turn independently, so windowing partitions the work along an axis the algorithm already partitions along — **byte-identical output, no bundle-shape change**, invisible to every chart.

The trigger is a row count, not a game count: against a 128 MB isolate the ceiling is ~125,000 focal rows as the code stands and ~250,000 with §7.1 — about 1,600 public games at the current ~158 focal rows per game.

Costs: windows must run sequentially (parallel defeats the memory bound), so wall-clock grows and global slices become cron-only rather than on-demand-capable; needs the turn range up front; the window width is a tuning knob whose right value drifts with corpus size.

Alternatives considered and rejected: **t-digest / reservoir sampling** (constant memory, but approximate — the global page's bands would differ from the tournament page's over overlapping data, an invisible inconsistency in charts we deliberately share); **percentiles in SQL** (288 values per turn; unmaintainable as one statement, ~30 queries split up, and structurally unlike the other eight loaders); **a precomputed rollup table** (permanently cheap, but a rollup can only be keyed by groupings chosen in advance, which is exactly what ad-hoc facets are not).

## 8. Bundle shape: one bundle

**Decision: one bundle per corpus, as today. Not split per category.**

The deciding fact is that the bundle is **size-stable as the corpus grows**. `yieldCurves` is 16 series × 2 (rate/cumulative) × 3 bands × 3 cohorts = 288 arrays of length `turns.length` — that is `O(max_turn)`, not `O(games)`. The per-nation/law/tech rows are `O(nations × laws)`. On the current 152-turn axis the all-public bundle is 622 KB of JSON, 154 KB gzipped, and it stays there as games accumulate. The 10-game single-player slice is 385 KB / 94 KB on the same axis — 57× fewer games for 62% of the payload — which is the property this section rests on.

Two fields scale with game count rather than turn count: `save_dates`, which the global bundle drops (§8.1), and `openingLaws`, which §8.2 bounds. With both handled the size-stability above holds.

**The rule to revisit this:** split per category only if a field is added whose size scales with game count.

### 8.1 Per-field disposition

Which `ChartBundleCore` fields survive the widening to a global corpus.

| Field | Global? | Notes |
| --- | --- | --- |
| `meta.game_count` | keep | |
| `summary.total_games` | keep | |
| `summary.avg_total_turns` | keep | |
| `save_dates` | **drop** | `O(games)`; a calendar heatmap of the whole site is not a chart |
| `favorite_day_of_week` | **drop** | no consumer on any surface — the profile card reads its own copy from `GET /v1/users/:user_id`, not the bundle |
| `nations` | keep | |
| `nationWinRate` | keep | reads as deviation from ~50%, not absolute |
| `nationAvgPoints` | keep | |
| `startingArchetypeWinRate` | keep | |
| `startingTraitWinRate` | keep | |
| `wonderStats` | keep | a row reports the pooled subset when it has a denominator, everything when it has none (gate 1, `aggregate.ts`) |
| `capitalFamilyWinRate` | keep | |
| `familyByNation` | keep | |
| `yieldCurves` | keep | the payload and memory driver |
| `lawTiming` | keep | |
| `openingLaws` | keep, bounded | `O(games)` as it stands — §8.2 |
| `expansionWinRate` | keep | |
| `techFirst` | keep | |
| `techTiming` | keep | |

### 8.2 Bounding `openingLaws`

Distinct (nation, four-law-set) rows grow with the corpus — 139 at 143 games, 270 at 286, 469 at 572 — and 67% of them are singletons. At 51 KB it is the third-largest field, and the only one besides `save_dates` without a ceiling.

The chart never shows the tail: `openingLawsOption` (`src/lib/stats/charts/laws.ts`) ranks and takes the top 15. So the field ships hundreds of rows to render fifteen.

Bounding it server-side is not quite a `slice()`, because the "All nations" view sums a combo's counts across nations *before* ranking, so a per-nation top-N can drop a row that would have placed in the aggregate. Two forms work: drop `count == 1` rows, which is safe only while the modal count stays clear of the 13 a singleton could sum to (19 today — a real margin, but one that narrows); or rank after the cross-nation sum and keep the top N per nation plus the top N overall, which has no expiry date and is what to build.

Either changes chart output on the user page as well, so it lands against the round-trip test, not before it.

## 9. Frontend

`ChartSpec` and `StatsView` are typed against `ChartBundle` (the user shape) — `hasData`, `emptyMessage`, and `height` are all `(bundle: ChartBundle) => …` (`src/lib/stats/types.ts:220-227`). The global endpoint returns `ChartBundleCore`, so **the registry must be parameterized over the bundle shape.** This is the prerequisite for everything else on the frontend.

The registry is also less general than it looks: `buildOption` is a hardcoded `switch` on spec id (`StatsView.svelte:62-73`), and four of eight categories (`yields`, `families`, `laws`, `tech`) are anchor-only stubs special-cased in the template dispatch (`StatsView.svelte:132-140`).

Once parameterized, the tournament stats page's **chart tabs** can collapse onto the shared registry — it currently hand-rolls its own tabs and calls option builders directly. Its Plane A tabs (Matches, Players, Casters) stay bespoke: they render a different payload shape and a `MatchTable`, neither of which the spec loop models. **Deferred** — it is a refactor of a live surface with no dependency on the rest, and it is the natural thing to drop if the session runs long.

The facet UI is a sibling of `ScopeRow.svelte`, but multi-select rather than one dropdown. Selection lives in the URL, as tabs/scope/filters already do throughout the app.

## 10. Visibility

`is_public = 1` is the whole rule. It already encodes "public because the uploader said so, **or** because it is a tournament game": tournament-linked uploads force `is_public = 1` (`cloud/src/games.ts:980`, `linkTournamentMatch`, on both the fresh-upload and dedup-link paths), and `handleGameUpdate` refuses to un-public a game linked to a match in a non-`complete` tournament (`games.ts:2626-2645`). No union predicate is needed.

One residual edge, accepted: that lockout releases when a tournament reaches `complete`, so an owner can then make a finished tournament game private. It would drop out of `/stats` while remaining on the tournament stats page, whose corpus ignores `is_public` (issue #111).

## 11. Access and rate limiting

`/stats` is **public** — anonymous access, no session required. It is public data, and it is the surface most likely to bring players to the site.

It gets its **own rate-limit budget**, not a share of `anon_read`. The tournament budgets are separate for exactly this reason: the 2026-08-05 incident was one busy surface deciding when the others started refusing. Follow the existing pattern in `wrangler.toml` — a `[vars]` entry so the ceiling can be retuned without a redeploy.

Because the payload is byte-identical for every viewer and changes at most nightly, an edge cache layer is worth it here in a way it was not for user stats (`docs/aggregate-statistics.md` records "no client cache header" as a deliberate decision for that surface — different situation, revisit for this one).

## 12. Caching and the cold-start problem

A whole-corpus aggregation is ~1s of JS and ~60 MB with §7.1 (§6.1), which fits a fetch handler with room. So precomputation is an optimization, not something the request path depends on: **a miss computes in the request, exactly as a faceted selection does.** The cron warms the cache rather than owning it, which is also why first population needs no deploy-runbook step and `putCached`'s 24h TTL can stay as it is.

Two things still need explicit answers.

**Serve-stale is available on one of the key's two version segments, not both.** A `parser_version` bump orphans every entry without changing the bundle's shape, so the previous entry is merely stale and safe to serve while the new one computes. A `BUNDLE_SCHEMA_VERSION` bump does change the shape, and `cache.ts` is explicit that the bundle types declare every field required so consumers dereference them directly — a frontend on the new shape reading a pre-bump bundle breaks on it. So: serve-stale on parser drift, recompute on schema drift. Treating the two segments alike is what makes the option look unavailable.

Neither bump is rare enough to wave off — five bundle-schema versions landed between 2026-05-24 and 2026-07-26, and the parser moved several times over the same window.

**The herd is the real cost of a cold key.** Every concurrent request recomputes at 108 queries apiece, bounded only by §11's rate limit — which ties the abuse ceiling to the cold-start ceiling, two knobs that should move independently. A single-flight lock in KV, or simply accepting the duplicate work at this corpus size, are both defensible; inheriting the coupling by default is not.

Cache keys stay in `cacheKeyToString` (`cache.ts:77`) with a `global` variant. Facet keys must be **normalized** (sorted, deduped) so that selecting Rome-then-Greece and Greece-then-Rome hit the same entry.

## 13. Testing

**Staging must exercise the cron.** `[env.staging.triggers] crons = []` is currently empty for a stated reason: staging D1 is recloned from prod, and an independent retention sweep there would skew prod/staging diffs. So do not just populate the array — give the stats precompute its **own cron pattern** and have staging declare only that one. Triggers are per-environment and the handler dispatches on `controller.cron`, so staging runs the stats path and never the retention sweep.

**Close the aggregator-test gap.** `docs/aggregate-statistics.md` lists "No aggregator tests" as a known limitation and names the fix: a fixture → `ChartBundle` round-trip. That gap is load-bearing here — the disjoint-cohort change (§7.1) and any turn-windowing (§7.2) must be provably output-identical for existing corpora, and without a round-trip test there is nothing to diff old against new. Build it first, not last.

**Re-measure cost as the corpus grows.** §6.1 is a baseline, not a fixed property; §16 and the same harness re-derive it. The figure to watch is focal rows per slice, since that is what §7.2's trigger is denominated in.

## 14. Open questions

1. **Cold-start latency.** A miss computes in the request (§12) — affordable, but ~1s of CPU plus D1 round trips. Whether an anonymous visitor waits for that or sees a warming state is a product call, not a measurement.
2. **Herd control on a cold key** — a single-flight lock versus accepting duplicate recomputes (§12).

## 15. Deferred, with growth triggers

Not in scope; each records the condition that would change that.

- **Predicate corpus** (resolvers return a `SELECT game_id` predicate that loaders inline as a subquery, making query count independent of corpus size, instead of materializing an id list). Trigger: a slice approaching ~5,500 games, where `ceil(N/50) × 9` nears the 1,000-query ceiling. At 572 public games and ~200 uploads/month this is roughly two to three years out. It would also make the *user* path marginally slower, so it is worth doing only for the global case.
- **Turn-window chunking** (§7.2). Trigger: ~250,000 focal rows in one slice — about 1,600 public games.
- **A second facet dimension beyond nations and map sizes.** At 572 public games, 538 of them duels, most cells of a deeper cross-product would hold under 20 games. Trigger: enough corpus that a representative cell holds a usable sample.
- **Tournament chart tabs collapsing onto the shared registry** (§9).
- **Issue #228** — migrating the user-page `?scope` selector onto this facet vocabulary. Deliberately out of scope: it changes three live surfaces and a URL contract, and issue #156 wants to move the same call sites. But the facet model here **must be designed to subsume `UserScope`**, and must be validated against the user page's concepts (collections, the `public` subset, `viewerOwnsTarget` visibility) even though only the global consumer ships now.

## 16. Corpus sizing query

Re-run against a D1 snapshot to refresh §3's counts and re-check §7.2's trigger; the figures in this doc are from 2026-08-25.

```sql
SELECT
  (SELECT COUNT(*) FROM games) AS games_all,
  (SELECT COUNT(*) FROM games WHERE is_public=1) AS games_public,
  (SELECT COUNT(*) FROM game_player_turn) AS gpt_rows_all,
  (SELECT COUNT(*) FROM game_player_turn gpt
     JOIN player_summaries ps ON ps.game_id=gpt.game_id AND ps.player_index=gpt.player_index
   WHERE ps.is_human=1) AS gpt_rows_human,
  (SELECT COUNT(*) FROM game_player_turn gpt
     JOIN player_summaries ps ON ps.game_id=gpt.game_id AND ps.player_index=gpt.player_index
     JOIN games g ON g.game_id=gpt.game_id
   WHERE ps.is_human=1 AND g.is_public=1) AS gpt_rows_human_public,
  (SELECT MAX(turn) FROM game_player_turn) AS max_turn,
  (SELECT COUNT(*) FROM games g WHERE g.is_public=1 AND g.game_id IN
     (SELECT game_id FROM player_summaries GROUP BY game_id HAVING COUNT(*)=2 AND SUM(is_human)=2)) AS public_duels,
  (SELECT COUNT(*) FROM games g WHERE g.is_public=1 AND g.game_id IN
     (SELECT game_id FROM player_summaries GROUP BY game_id HAVING SUM(is_human)>=3)) AS public_ffa,
  (SELECT COUNT(*) FROM games g WHERE g.is_public=1 AND g.game_id IN
     (SELECT game_id FROM player_summaries GROUP BY game_id HAVING SUM(is_human)=1)) AS public_sp,
  (SELECT COUNT(DISTINCT map_size) FROM games WHERE is_public=1) AS distinct_map_sizes;
```

## 17. Implementation order

One branch, one session. Ordered so each step is verifiable before the next depends on it.

1. **Fixture → bundle round-trip test** (§13). Nothing else is safely verifiable without it.
2. **Disjoint cohorts** in `loadYieldCurves` (§7.1) — load-bearing for the all-public slice, not an optimization. Prove byte-identical output against step 1.
3. **Bound `openingLaws`** (§8.2) so the bundle stops scaling with game count. Changes chart output, so it diffs against step 1.
4. **Shared composition predicates** — the player-counting duel/FFA/single-player fragments (§3), in `games-scope.ts`, used by the global resolver.
5. **`resolveGlobalCorpus`** — slice + facets → corpus, with the focal-restriction form for nations (§4.2).
6. **Cron precompute** for the four slices + KV `global` key variant + the serve-stale rule (§12), with its own cron pattern and staging enabled (§13).
7. **`GET /v1/stats`** — public, own rate-limit budget, on-demand facet path (§5, §11).
8. **Registry parameterized over `ChartBundleCore`** (§9).
9. **`/stats` route + facet UI** (§9).

Turn-window chunking (§7.2) is out of scope here; it slots after step 2 only if a slice crosses the row count in §7.2.

## 18. Docs to update on ship

- **`docs/aggregate-statistics.md`** — its "Future work" bullet predicts this feature and asserts the cost is caching ("an arbitrary game-id set hashes to a poor hit-rate key"). That is wrong: caching is the easy part once the slice set is enumerable, and the real costs are isolate memory and the per-invocation query ceiling. Correct it, and fold the as-built outcome in.
- **`docs/api-reference.md`** — the new endpoint.
- **`docs/cloud-deploy-plan.md`** — it still points a health check at the retired `/v1/stats` path (§486, §521), which this feature now claims for something else. No first-population step is needed: a cold key computes in the request (§12).
- **`docs/tournament-stats-design.md`** — §5's UI-generalization notes are superseded once the registry is parameterized.
- **This doc** — retire it into `docs/aggregate-statistics.md` once built.
