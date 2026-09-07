# Momentum — the duel win-probability model

> **Status:** as-built record, verified 2026-09-07 against a code read of the scorer (`src/lib/game-detail/momentum.ts`), its generated Worker mirror (`cloud/src/momentum.ts`), the fit (`scripts/bake-momentum.ts`), the baked weights (`src/lib/generated/momentum.ts`), the derive path (`cloud/src/games.ts`), and the two surfaces that render it (`src/lib/game-detail/MomentumPanel.svelte`, `src/lib/RecentSaveCard.svelte`). The model was rebuilt for per-ankh's blobs from the spec in owglick's `docs/momentum-model.md` — that spec lives in another repo and is not vendored here; this doc is the per-ankh implementation's own record. Landed 2026-07-27 (v1), model v2 2026-08-30.

## 1. What momentum is

Momentum is a **per-turn win probability for a finished duel**: one number per turn saying how likely the model thinks it was that a given player would win, given only the two sides' per-turn statistics at that turn. Rendered as a curve, it answers "who was winning, and when did that change" — the shape a duel's story has that a victory-points line does not, because VP is a scoring rule rather than a position evaluation.

It is defined **only for duels**. The scorer itself requires two named sides, a final turn of at least 10, and at least five scoreable turns; the callers add the rest. Game detail asks only for exactly two humans (`OverviewTab.svelte:344`), since it is reading a game the viewer already has open. The persisted path additionally requires a **known winner** (`cloud/src/games.ts:617`), because a stored `p` that no outcome ever confirmed is a number nobody can check. Everything else — FFA, unknown winners, games whose series are too sparse — has no momentum, and the surfaces fall back (§7).

It is **retrospective, not a forecast**, and the code says so in three places. The weights are fitted over a corpus of finished games, and — the harder constraint — a turn's weight depends on how far through the match it falls, which requires the final turn to be known. Present it as "who was winning", never "who would have won".

## 2. What is scored

Five dimensions, each stored as an **A−B difference** rather than two absolute values (`featsAt`, `src/lib/game-detail/momentum.ts:108`). The difference form is what kills the "bigger empire has more of everything" collinearity that would otherwise make every dimension a proxy for every other.

| dim | definition at turn T | missing data |
| --- | --- | --- |
| `growth` | `YIELD_GROWTH` rate, A − B | absent = **0 income** |
| `orders` | `YIELD_ORDERS` rate, A − B | absent = **turn unscoreable** |
| `science` | `YIELD_SCIENCE` rate, A − B | absent = **turn unscoreable** |
| `eco` | sign tally over money/food/iron/stone/wood: +1 per yield where A's rate is higher, −1 where B's is, **0 on a tie** — range −5…+5 | absent = 0 income |
| `mil` | `(pa − pb) / max(1, (pa + pb) / 2)` — the power gap **relative** to the two sides' mean power | absent = turn unscoreable |

Three of those cells carry the model's load-bearing data decisions:

- **Military is relative, not absolute.** Absolute military power grows roughly 20× across a match; an absolute gap would encode "it is late in the game" far more strongly than "someone is ahead".
- **Eco is a sign tally, not a sum.** Five economic yields on different scales cannot be added; counting who leads each makes the dimension scale-free, and ties genuinely contribute 0 rather than being folded into either side.
- **Orders and science gate the turn; growth and eco do not.** A player with no `YIELD_ORDERS` row at turn T has no data (orders and science exist from T2 onward), so the turn is dropped. A player with no `YIELD_MONEY` row has *zero money income* — which is data, and treating it as missing is the single most damaging parse error available here. §5's coverage gate exists to catch exactly that.

The model sees **only these five differences**. It does not see nations, leaders, laws, cities, techs, VP, the event log, or anything about who the players are.

### The cities dimension, and why it is gone

v1 had a sixth dimension, cities. v2 dropped it for two independent reasons recorded in the bake header: its fitted weights were sign-flipping suppressors for growth (r ≈ +0.65 between the two), and it alone required reconstructing city counts from tile ownership — a reconstruction blind to **razed** cities, since only end-state city centres exist in `map_tiles`. It was undercounting precisely the event the chart most needs to show.

## 3. From features to a probability

**Standardise.** Each raw difference is divided by the corpus standard deviation of that dimension *at that turn* (`zOf` / `sdAt`, `momentum.ts:151`). A 20-food growth lead means something very different at T15 and at T90, and the per-turn SD is what makes those comparable. The table (`MOMENTUM_SD`) is sparse over turns and consumers **snap to the nearest present turn**; it currently covers turns 2–143.

**Weight.** The weight vector is fitted **per progress bucket** over `T / finalTurn`, half-open, currently `[0, .3) [.3, .5) [.5, .7) [.7, .85) [.85, 1.01)`. This is the model's single most important structural decision: growth front-loads and military back-loads, so one fixed weighting misreads both ends of every match.

**Interpolate.** The scorer does *not* use the bucket's weights directly. It interpolates the weight vector piecewise-linearly between **bucket centres**, clamped flat outside the outermost centres (`weightsAt`, `momentum.ts:172`). A hard switch at bucket edges puts four structural jumps into every curve, and those jumps read as battles that never happened — with every raw lead held perfectly constant, the old hard switch leapt ~13 percentage points at exactly 70% of the game. A regression test pins that shut (§8).

**Score.** A no-intercept logistic over the weighted z-scores:

```
log-odds = Σ_j  w_j(progress) · z_j(T)
p        = 1 / (1 + e^(−log-odds))
```

The missing intercept is deliberate: it is what *allows* the model to be **antisymmetric** (an intercept would break `f(−x) = 1 − f(x)` outright), and the fit's negated-row augmentation (§4) is what enforces it. So scoring B against A gives exactly `1 − p`, and the two players' curves are one curve.

### The current baked numbers

Fitted on **471 deduped duels** (575 blobs scanned), L2 = 8 chosen by CV. Held-out AUC at 30/50/70% of game: **0.668 / 0.755 / 0.812**. Held-out calibration over a 10–90% progress grid: **Brier 0.198, ECE 0.034**. Weights (`MOMENTUM_WEIGHTS`, dimension order `growth, orders, science, eco, mil`):

| bucket | growth | orders | science | eco | mil |
| --- | --- | --- | --- | --- | --- |
| 0–30% | 0.3741 | 0.0977 | −0.0666 | 0.0950 | −0.0405 |
| 30–50% | 0.6721 | 0.3522 | 0.2367 | 0.1321 | −0.1704 |
| 50–70% | 0.5181 | 0.6952 | 0.6654 | 0.2236 | −0.0010 |
| 70–85% | 0.4181 | 0.8896 | 0.9185 | 0.3122 | 0.6245 |
| 85–100% | 0.3182 | 0.9338 | 0.7683 | 0.3973 | 1.2944 |

These change on every refit — read them from `src/lib/generated/momentum.ts`, not from here. The **shape**, though, is a validated invariant: growth peaks early, military peaks last, and a corpus that inverts that fails the bake (§5). Note also that a decisive early military lead is worth roughly nothing to the model, and briefly *negative* around the 30–50% mark: early aggression in this corpus is not, by itself, evidence of winning.

## 4. Fitting the model (`npm run bake:momentum`)

The bake is a standalone refit against a **local corpus of game blobs** — the JSON that `/v1/games/:id` serves, one `<id>.json` per game, in the directory named by `MOMENTUM_CORPUS_DIR` in `.env`. It touches no live resource.

- **Selection.** Finished duels only: exactly two humans, a known winner who is one of them, ≥ 10 turns, ≥ 5 scoreable turns (`prepGame`, `scripts/bake-momentum.ts:210`).
- **Dedup.** A match both players uploaded appears as two blobs with one `xml_game_id`; the longer upload wins, so each match counts once. Games are then sorted by that id, which makes fold assignment deterministic — the same corpus always produces the same fit whatever order the directory listed.
- **Standardiser.** Per-turn, per-dimension SD, smoothed over a **±7-turn** window. Raw per-turn SD jitter invents changes in the curve that no player made; widening from the original ±3 cut the `Σch − Δlog-odds` residual p95 by ~13% at no CV cost.
- **Fit.** IRLS/Newton logistic, no intercept, L2-regularised (`fitLogistic`, `bake-momentum.ts:266`), run **per bucket** on rows in that progress band, with every row added twice — once negated with a flipped label — so antisymmetry holds by construction rather than by hope. A bucket with fewer than 40 rows is emitted as `null` and skipped by the interpolator.
- **Regularisation.** L2 is chosen from `[0.5, 1, 2, 4, 8]` by 5-fold cross-validation **grouped by game**. Every turn of a game carries the same label, so row-level counts wildly overstate the independent evidence — ~471 matches, not tens of thousands of rows. The selection metric is mean per-game held-out log loss over a progress grid, games weighted equally. The SD normaliser stays corpus-wide: it is a per-turn scale, not a fitted parameter.
- **Evaluation as scored.** Every held-out metric routes through the same piecewise-linear interpolation the scorer uses (`interpAt`, `bake-momentum.ts:437`) — the model as scored, never as fitted.
- **Corpus era.** All balance eras are kept, deliberately. A 2×2 held-out test showed the extra ~170 old-era duels beating era purity (AUC 0.782 vs 0.773; the confident-wrong rate at 50–85% progress halved) — the features are per-turn-standardised differences, which are era-robust, and at ~200 modern duels sample size binds harder than balance drift. Revisit the cutoff when the modern corpus alone reaches ~350.

## 5. The validation suite — four ways the bake refuses to ship

The bake **throws** rather than emit, on any of:

1. **Thin corpus** — fewer than 100 usable duels (`bake-momentum.ts:338`).
2. **Coverage** — median first scored turn > 8 (`:345`). This is the Gotcha-1 signature: if absent eco yields were treated as missing data rather than zero income, every chart starts late, and this is what catches it.
3. **Shape** — growth's peak bucket must come before military's (`:545`). A corpus that fails this is mis-parsed, not differently balanced.
4. **Calibration** — held-out Brier < 0.25 and 10-bin ECE ≤ 0.08 (`:614`). The UI renders `p` as a percentage, so **calibration, not discrimination, is the property the product claims**. Brier ≥ 0.25 means the scores beat nothing (always saying 50%). The ECE bound is ~4× the binning noise floor at this corpus size, so tripping it means genuine systematic miscalibration rather than sampling jitter.

## 6. Where the code lives, and what generates what

`src/lib/game-detail/momentum.ts` is the **source of truth** for the scorer. Three artefacts are generated from it or beside it, and none may be hand-edited:

| file | generated by | pinned by |
| --- | --- | --- |
| `src/lib/generated/momentum.ts` | `npm run bake:momentum` | — |
| `cloud/src/generated/momentum.ts` | same bake, identical bytes (the law-classes dual-emit pattern) | — |
| `cloud/src/momentum.ts` | `npm run bake:momentum -- --mirror-only`, via `scripts/momentum-mirror.ts` | `cloud/src/momentum-mirror.test.ts`, byte-for-byte |

The mirror transform is a pure function with exactly one intentional delta — the import path (`../generated/momentum` → `./generated/momentum`) — and it throws if the frontend scorer ever stops importing what it expects. So the Worker and the browser cannot compute different momentum for the same game; that is a test failure, not a bug report.

## 7. Where momentum is computed and stored

**Two consumers, two paths, one scorer.**

*Game detail* computes the curve **client-side, per render**, from the blob the page already has (`OverviewTab.svelte:355`). It needs the full `MomentumPoint` — the level and change decompositions, the raw leads, each side's own stats — which is far more than D1 stores. The two duellists are ordered uploader-first, so the plotted line is "my side" when there is one.

*The public feed* reads a **persisted** series. At derive time — on upload and on every reindex, both through `buildGamePlayerTurnStatements` (`cloud/src/games.ts:606`) — the Worker scores the curve and writes `p` to `game_player_turn.momentum` for player A and `1 − p` for player B, rounded to 3dp, alongside `momentum_version` (migration `0043_momentum.sql`). `GET /v1/games/public-recent` serves those as `momentum_series` per player, and `RecentSaveCard.svelte:80` renders the momentum look when both players have one, falling back to the VP sparkline when they do not.

Storing the version **per row** is deliberate: the reindex sweep rewrites rows over time, so without it the column silently mixes vintages after the first refit and the provenance can't be reconstructed. `NULL` momentum is the normal state for FFA games, unknown winners, and rows written before the model landed — the feed's fallback keys on it, and the reindex sweep backfills from the blob.

## 8. Invariants, and the tests that hold them

`cloud/src/momentum-mirror.test.ts` asserts these against the Worker's copy — they are properties of the model form, and hold whatever the fitted numbers are:

- **The mirror is exactly what the transform produces** from the frontend scorer.
- **Antisymmetry**: swapping A and B gives `1 − p` at every point, to 9 decimal places.
- **A tied stat contributes exactly zero change** — `ch` is `0`, not `−0.00` or a rounding crumb.
- **`Σ lv` = the log-odds**: the level decomposition accounts for the whole position, not most of it.
- **`Σ ch` = the move in log-odds**: `ch` is the *exact difference* of `lv` between adjacent points, so the panel's header and its bars can never disagree about the same number.
- **A constant lead never produces a jump**: with every raw lead held flat for 100 turns, no single turn may move `p` by 3 points. This is the regression the interpolated weights exist to prevent.

One display detail worth knowing when reading the code: `lv` and `ch` are rounded to 2dp and then `+ 0`, which folds IEEE `−0` (a negative weight times a zero change) into `0` so the panel never prints "−0.00".

## 9. The panel

`MomentumPanel.svelte` is the owglick viewer's interaction rebuilt here: one line for P(A wins), the area between the line and the 50% midline filled in whoever leads' colour, and the hovered turn's numbers in a stable panel below. Hover explores, click pins, and the panel opens pinned on the last point — the finished position. No tooltip commentary: the panel *is* the data. A corner icon crossfades the card to an "about" side that explains every number in it, the same way the tournament page switches bracket and standings.

Below the chart it shows, for the shown turn: the **level** bars (`lv` — why the line is where it is), the **change** bars (`ch` — what moved it since the previous scored turn), each side's **own raw numbers** (growth, orders, science yield rates and military power, leader-per-row coloured — not model inputs, present so the reader can check the arithmetic), and a **turn summary**.

The summary's battle rows are derived, because battles are not in the event log: military-power drops across the window, read the owglick way — both sides bleeding hard is a trade (named for who lost less), one side collapsing alone is an army destroyed (`battlesFor`, `MomentumPanel.svelte:228`). Event-log rows cover **everything after the previous scored turn** up to this one, which is a single turn for adjacent points and a wider window wherever a turn was dropped for missing orders/science/power.

The panel reserves its height from the largest row count the whole curve ever reaches, computed by the same functions that render, so the layout cannot shift as the pointer crosses the chart and a reservation cannot disagree with what lands in it.

## 10. Refit policy

Refitting is an **explicit act** — `npm run bake:momentum`, needing `MOMENTUM_CORPUS_DIR` — and is deliberately excluded from `bake:all`. A finished game's curve must never drift because some unrelated bake re-ran.

`MOMENTUM_MODEL_VERSION` (currently **2**) tracks the model **form** — dimensions, buckets, standardisation. A refit on new data keeps the version and changes the numbers; a form change bumps it. Persisted rows record whichever version wrote them.

When editing the scorer: change `src/lib/game-detail/momentum.ts`, then run `npm run bake:momentum -- --mirror-only` (no corpus needed) to regenerate the Worker mirror. Never hand-edit `cloud/src/momentum.ts`.

## 11. What momentum is not

- **Not a forecast.** Weights key on progress through the match, which needs the final turn. There is no honest way to run this on an in-progress game as it stands.
- **Not causal.** The panel's battle and event rows sit beside a change in the curve; they are data about the same window, not an attribution of the move to that event.
- **Not opinion-free about the early game.** With growth the only dimension carrying real weight before 30% progress, an early curve is a growth curve. The held-out AUC at 30% (0.668) is the honest measure of how much that is worth.
- **Not defined outside duels.** Three humans, an AI opponent, or an unknown winner means no curve — by construction, not by omission.
