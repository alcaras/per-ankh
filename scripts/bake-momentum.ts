// Fit the momentum model — a per-turn win-probability curve for duels — on a
// local corpus of game blobs, and bake the fitted weights + per-turn scales
// into generated modules for both the frontend and the Worker.
//
// The model, its maths, and the data gotchas it must respect are specified
// in owglick's docs/momentum-model.md; this script is that spec rebuilt for
// per-ankh's blobs. In brief: five per-turn dimensions (growth, orders,
// science, eco, military), each stored as the A−B difference (kills the
// bigger-empire-has-more-of-everything collinearity), standardised by the
// corpus SD at that turn (smoothed ±7 turns), scored by an antisymmetric
// no-intercept logistic fitted separately per game-progress bucket — because
// growth front-loads and military back-loads, one fixed weighting misreads
// both ends of every match. The SCORER interpolates the weight vector
// piecewise-linearly between bucket centres (a hard switch at the edges puts
// four structural jumps into every curve), so every metric this bake cites
// is evaluated through that same interpolation — the model as scored, not as
// fitted. The L2 strength is chosen by k-fold cross-validation GROUPED BY
// GAME: every turn of a game carries the same label, so row-level counts
// wildly overstate the independent evidence (~384 matches, not tens of
// thousands of rows).
//
// v2 dropped the cities dimension: its fitted weights were sign-flipping
// suppressors for growth (r ≈ +0.65), and it alone required the fragile
// tile-ownership city reconstruction — which was also blind to razed cities
// (only end-state city centres exist in map_tiles), undercounting exactly
// the event the chart most needs to show.
//
// SOURCES (local-only): a directory of per-ankh game blobs (the JSON the
// /v1/games/:id endpoint serves), pointed at by MOMENTUM_CORPUS_DIR in .env.
// Only finished duels — exactly two humans, known winner — are used, deduped
// on the save's xml_game_id (a match both players uploaded must count once,
// not twice). ALL balance eras are kept, deliberately: a 2x2 held-out test
// on current-era games showed the extra ~170 old-era duels beat era purity
// (AUC 0.782 vs 0.773; confident-wrong rate at 50-85% progress halves) —
// the features are per-turn-standardised A−B differences, which are era-
// robust, and at n≈200 modern duels sample size binds harder than balance
// drift. Revisit the cutoff when the modern corpus alone reaches ~350.
//
// OUTPUT: src/lib/generated/momentum.ts AND cloud/src/generated/momentum.ts
// (identical, the law-classes dual-emit pattern): bucket weights, the
// smoothed SD table, and MOMENTUM_MODEL_VERSION. The scoring code that
// consumes these lives in src/lib/game-detail/momentum.ts; its Worker mirror
// cloud/src/momentum.ts is also GENERATED here (scripts/momentum-mirror.ts is
// the transform), so the two can't drift. `--mirror-only` regenerates just
// the mirror, no corpus needed.
//
// The validation suite runs here and FAILS THE BAKE on violation:
//   - Coverage: the median first scored turn must be early (Gotcha 1 — an
//     absent eco yield is zero income, not missing data).
//   - Shape: growth's weight must peak in an earlier bucket than military's
//     (the front-load/back-load signature; a corpus that fails this is
//     mis-parsed, not differently balanced).
//   - Calibration: the UI renders these probabilities as percentages, and
//     calibration — not discrimination — is the property that claims. On
//     pooled held-out CV predictions the Brier score must beat always-50%
//     and the 10-bin expected calibration error must stay near sampling
//     noise (thresholds documented at the check).
//
// Run: npm run bake:momentum

import "dotenv/config";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format as prettierFormat, resolveConfig } from "prettier";

import { mirrorMomentumSource } from "./momentum-mirror";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUTS = [
	resolve(REPO_ROOT, "src/lib/generated/momentum.ts"),
	resolve(REPO_ROOT, "cloud/src/generated/momentum.ts"),
];
const SCORER = resolve(REPO_ROOT, "src/lib/game-detail/momentum.ts");
const MIRROR_OUT = resolve(REPO_ROOT, "cloud/src/momentum.ts");

async function emitMirror(): Promise<void> {
	const front = await readFile(SCORER, "utf-8");
	await writeFile(MIRROR_OUT, mirrorMomentumSource(front));
	console.log(
		`bake-momentum: mirrored ${SCORER.replace(REPO_ROOT + "/", "")} → ${MIRROR_OUT.replace(REPO_ROOT + "/", "")}`,
	);
}

// Bump when the model form changes (dimensions, buckets, standardisation) —
// refits on a new corpus keep the version and change the fitted numbers.
// v2: dropped cities, interpolated weights, CV-chosen L2 (see header).
const MODEL_VERSION = 2;

const DIMS = ["growth", "orders", "science", "eco", "mil"] as const;
const ECO5 = [
	"YIELD_MONEY",
	"YIELD_FOOD",
	"YIELD_IRON",
	"YIELD_STONE",
	"YIELD_WOOD",
];
// Progress buckets (T / final turn). The single most important modelling
// decision — see the header comment.
const BUCKETS: [number, number][] = [
	[0.0, 0.3],
	[0.3, 0.5],
	[0.5, 0.7],
	[0.7, 0.85],
	[0.85, 1.01],
];
// L2 candidates for the grouped cross-validation; the winner is refit on the
// full corpus and stamped into the generated header.
const L2_GRID = [0.5, 1, 2, 4, 8];
const CV_FOLDS = 5;
// Held-out evaluation grid: one prediction per game per progress point, so
// games weigh equally and within-game autocorrelation can't inflate n.
const EVAL_PROGRESS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const MIN_BUCKET_N = 40;

// ---------- Corpus loading ----------

interface Blob {
	player_roster?: { player_index: number; is_human?: boolean }[];
	match_metadata?: {
		winner?: { winner_player_xml_id?: number | null } | null;
		total_turns?: number;
		save_date?: string;
		xml_game_id?: string;
	};
	game_details?: { total_turns?: number };
	yield_history?: {
		player_id: number;
		yield_type: string;
		data: { turn: number; rate: number | null }[];
	}[];
	player_history?: {
		player_id: number;
		history: { turn: number; military_power: number | null }[];
	}[];
}

function corpusDir(): string {
	const fromEnv = process.env.MOMENTUM_CORPUS_DIR;
	if (fromEnv && fromEnv.trim() !== "") {
		const dir = resolve(fromEnv);
		if (existsSync(dir)) return dir;
		throw new Error(`MOMENTUM_CORPUS_DIR=${fromEnv} does not exist`);
	}
	throw new Error(
		"bake-momentum: set MOMENTUM_CORPUS_DIR in .env to a directory of per-ankh game blobs (one <id>.json per game)",
	);
}

// ---------- Per-game series (the spec's M / Y / C) ----------

type Series = Map<number, Map<string, Map<number, number>>>; // player → yield → turn → rate
type PowerSeries = Map<number, Map<number, number>>; // player → turn → power

interface Duel {
	/** Stable identity for deterministic fold assignment. */
	id: string;
	a: number;
	b: number;
	winner: number;
	end: number;
	pts: { turn: number; f: Record<string, number> }[];
}

/** Raw A−B features at turn T, or null when orders/science lack data. */
function featsAt(
	a: number,
	b: number,
	M: PowerSeries,
	Y: Series,
	T: number,
): Record<string, number> | null {
	const pa = M.get(a)?.get(T);
	const pb = M.get(b)?.get(T);
	if (pa == null || pb == null) return null;
	const out: Record<string, number> = {
		// Growth (the food→population engine) is the strongest single dimension
		// and a leading indicator of the others. Absent = zero income, like eco.
		growth:
			(Y.get(a)?.get("YIELD_GROWTH")?.get(T) ?? 0) -
			(Y.get(b)?.get("YIELD_GROWTH")?.get(T) ?? 0),
		// Relative, because absolute power grows ~20× over a match.
		mil: (pa - pb) / Math.max(1, (pa + pb) / 2),
	};
	for (const [key, name] of [
		["YIELD_ORDERS", "orders"],
		["YIELD_SCIENCE", "science"],
	] as const) {
		const va = Y.get(a)?.get(key)?.get(T);
		const vb = Y.get(b)?.get(key)?.get(T);
		// Orders and science exist from T2 — genuinely absent means no data.
		if (va == null || vb == null) return null;
		out[name] = va - vb;
	}
	let e = 0;
	for (const key of ECO5) {
		// Gotcha 1: an absent eco yield is ZERO income, not missing data.
		const va = Y.get(a)?.get(key)?.get(T) ?? 0;
		const vb = Y.get(b)?.get(key)?.get(T) ?? 0;
		// Gotcha 2: ties contribute 0, not −1.
		e += va > vb ? 1 : va < vb ? -1 : 0;
	}
	out.eco = e;
	return out;
}

function prepGame(d: Blob, file: string): Duel | null {
	const humans = (d.player_roster ?? []).filter((p) => p.is_human);
	if (humans.length !== 2) return null;
	const winner = d.match_metadata?.winner?.winner_player_xml_id;
	if (winner == null) return null;
	const end = d.game_details?.total_turns ?? d.match_metadata?.total_turns ?? 0;
	if (end < 10) return null;
	const [a, b] = [humans[0].player_index, humans[1].player_index];
	if (winner !== a && winner !== b) return null;

	const Y: Series = new Map();
	for (const row of d.yield_history ?? []) {
		const per = Y.get(row.player_id) ?? new Map<string, Map<number, number>>();
		const byTurn = per.get(row.yield_type) ?? new Map<number, number>();
		for (const p of row.data) if (p.rate != null) byTurn.set(p.turn, p.rate);
		per.set(row.yield_type, byTurn);
		Y.set(row.player_id, per);
	}
	const M: PowerSeries = new Map();
	for (const row of d.player_history ?? []) {
		const byTurn = new Map<number, number>();
		for (const p of row.history)
			if (p.military_power != null) byTurn.set(p.turn, p.military_power);
		M.set(row.player_id, byTurn);
	}

	const pts: Duel["pts"] = [];
	for (let t = 2; t <= end; t++) {
		const f = featsAt(a, b, M, Y, t);
		if (f) pts.push({ turn: t, f });
	}
	if (pts.length < 5) return null;
	return { id: d.match_metadata?.xml_game_id ?? file, a, b, winner, end, pts };
}

// ---------- Tiny linear algebra (n×n) ----------

function solve(A: number[][], g: number[]): number[] | null {
	const n = g.length;
	const m = A.map((row, i) => [...row, g[i]]);
	for (let col = 0; col < n; col++) {
		let piv = col;
		for (let r = col + 1; r < n; r++)
			if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
		if (Math.abs(m[piv][col]) < 1e-12) return null;
		[m[col], m[piv]] = [m[piv], m[col]];
		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const factor = m[r][col] / m[col][col];
			for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
		}
	}
	return m.map((row, i) => row[n] / m[i][i]);
}

/** Newton/IRLS logistic, no intercept, L2-regularised. */
function fitLogistic(X: number[][], y: number[], l2: number): number[] {
	const k = X[0].length;
	let w = new Array<number>(k).fill(0);
	for (let it = 0; it < 60; it++) {
		const H = Array.from({ length: k }, () => new Array<number>(k).fill(0));
		const gd = new Array<number>(k).fill(0);
		for (let i = 0; i < X.length; i++) {
			const zi = X[i].reduce((s, v, j) => s + v * w[j], 0);
			const p = 1 / (1 + Math.exp(-zi));
			const wt = Math.max(p * (1 - p), 1e-6);
			for (let r = 0; r < k; r++) {
				gd[r] += X[i][r] * (y[i] - p);
				for (let c = 0; c < k; c++) H[r][c] += X[i][r] * X[i][c] * wt;
			}
		}
		for (let r = 0; r < k; r++) {
			H[r][r] += l2;
			gd[r] -= l2 * w[r];
		}
		const step = solve(H, gd);
		if (!step) break;
		w = w.map((v, j) => v + step[j]);
		if (Math.max(...step.map(Math.abs)) < 1e-8) break;
	}
	return w;
}

// ---------- Main ----------

async function main(): Promise<void> {
	if (process.argv.includes("--mirror-only")) {
		await emitMirror();
		return;
	}
	const dir = corpusDir();
	const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
	const duels: Duel[] = [];
	// A match both players uploaded appears as two blobs with one
	// xml_game_id — keep the longer upload so each match counts once.
	const byMatch = new Map<string, { turns: number; duel: Duel }>();
	let read = 0;

	for (const f of files) {
		let d: Blob;
		try {
			d = JSON.parse(await readFile(resolve(dir, f), "utf-8")) as Blob;
		} catch {
			continue;
		}
		read++;

		const duel = prepGame(d, f);
		if (!duel) continue;
		const xid = d.match_metadata?.xml_game_id;
		const turns = duel.end;
		if (xid == null) {
			duels.push(duel);
		} else {
			const prev = byMatch.get(xid);
			if (!prev || turns > prev.turns) byMatch.set(xid, { turns, duel });
		}
	}
	duels.push(...[...byMatch.values()].map((v) => v.duel));
	// Stable order → deterministic CV folds (i % CV_FOLDS below): the same
	// corpus always produces the same fit, whatever the directory order.
	duels.sort((x, y) => x.id.localeCompare(y.id));
	console.log(
		`bake-momentum: ${read} blobs read, ${duels.length} deduped duels`,
	);

	if (duels.length < 100) {
		throw new Error(
			`bake-momentum: only ${duels.length} usable duels (of ${read} blobs) — too thin to fit.`,
		);
	}
	const firstTurns = duels.map((g) => g.pts[0].turn).sort((x, y) => x - y);
	const medianFirst = firstTurns[Math.floor(firstTurns.length / 2)];
	if (medianFirst > 8) {
		throw new Error(
			`bake-momentum: median first scored turn is ${medianFirst} — charts start late, which is the Gotcha-1 signature (absent eco yields treated as missing).`,
		);
	}

	// Per-turn SD, smoothed ±7 (Gotcha 4: raw per-turn jitter invents changes;
	// ±7 over the original ±3 cuts the Σch−Δlog-odds residual p95 ~13% with no
	// CV cost — owglick momentum-model.md §11.4).
	const atTurn = new Map<number, Map<string, number[]>>();
	for (const g of duels)
		for (const { turn, f } of g.pts) {
			const per = atTurn.get(turn) ?? new Map<string, number[]>();
			for (const k of DIMS) {
				const arr = per.get(k) ?? [];
				arr.push(f[k]);
				per.set(k, arr);
			}
			atTurn.set(turn, per);
		}
	const rawSd = new Map<number, Map<string, number>>();
	for (const [turn, per] of atTurn) {
		const out = new Map<string, number>();
		for (const k of DIMS) {
			const v = per.get(k) ?? [];
			if (v.length > 3) {
				const mean = v.reduce((s, x) => s + x, 0) / v.length;
				out.set(
					k,
					Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length),
				);
			}
		}
		rawSd.set(turn, out);
	}
	const sdTable = new Map<number, Record<string, number>>();
	for (const turn of rawSd.keys()) {
		const smoothed: Record<string, number> = {};
		let complete = true;
		for (const k of DIMS) {
			const vals: number[] = [];
			for (let t = turn - 7; t <= turn + 7; t++) {
				const v = rawSd.get(t)?.get(k);
				if (v) vals.push(v);
			}
			if (vals.length === 0) {
				complete = false;
				break;
			}
			smoothed[k] = vals.reduce((s, x) => s + x, 0) / vals.length;
		}
		if (complete) sdTable.set(turn, smoothed);
	}
	const goodTurns = [...sdTable.keys()].sort((x, y) => x - y);
	const sdAt = (T: number): Record<string, number> => {
		let best = goodTurns[0];
		for (const t of goodTurns)
			if (Math.abs(t - T) < Math.abs(best - T)) best = t;
		return sdTable.get(best)!;
	};
	const zOf = (f: Record<string, number>, T: number): number[] => {
		const s = sdAt(T);
		return DIMS.map((k) => f[k] / s[k]);
	};

	// Fit per bucket, both orientations (antisymmetry: f(−x) = 1 − f(x)).
	const fitBuckets = (train: Duel[], l2: number): (number[] | null)[] => {
		const out: (number[] | null)[] = [];
		for (const [lo, hi] of BUCKETS) {
			const X: number[][] = [];
			const y: number[] = [];
			for (const g of train) {
				const label = g.winner === g.a ? 1 : 0;
				for (const { turn, f } of g.pts) {
					const prog = turn / g.end;
					if (prog >= lo && prog < hi) {
						X.push(zOf(f, turn));
						y.push(label);
					}
				}
			}
			if (y.length < MIN_BUCKET_N) {
				out.push(null);
				continue;
			}
			const Xa = [...X, ...X.map((row) => row.map((v) => -v))];
			const ya = [...y, ...y.map((v) => 1 - v)];
			out.push(fitLogistic(Xa, ya, l2));
		}
		return out;
	};

	// The scorer's piecewise-linear interpolation between bucket centres —
	// every metric below evaluates the model AS SCORED, not as fitted.
	const interpAt = (
		ws: (number[] | null)[],
		progress: number,
	): number[] | null => {
		const centres = BUCKETS.flatMap(([lo, hi], i) => {
			const w = ws[i];
			return w ? [{ c: (lo + hi) / 2, w }] : [];
		});
		if (centres.length === 0) return null;
		if (progress <= centres[0].c) return centres[0].w;
		for (let i = 1; i < centres.length; i++) {
			if (progress <= centres[i].c) {
				const lo = centres[i - 1];
				const t = (progress - lo.c) / (centres[i].c - lo.c);
				return lo.w.map((v, j) => v + t * (centres[i].w[j] - v));
			}
		}
		return centres[centres.length - 1].w;
	};

	// P(a wins) at the game point nearest a progress fraction, or null.
	const predictAt = (
		ws: (number[] | null)[],
		g: Duel,
		prog: number,
	): number | null => {
		const T = Math.round(g.end * prog);
		const pt = g.pts.find((p) => p.turn >= T);
		if (!pt) return null;
		const w = interpAt(ws, pt.turn / g.end);
		if (!w) return null;
		const s = zOf(pt.f, pt.turn).reduce((acc, v, j) => acc + v * w[j], 0);
		return 1 / (1 + Math.exp(-s));
	};

	// L2 by k-fold CV GROUPED BY GAME: every turn of a game carries the same
	// label, so the regulariser must be calibrated against ~independent
	// matches, not tens of thousands of autocorrelated rows. (The SD
	// normaliser stays corpus-wide — a per-turn scale, not a fitted
	// parameter.) Selection metric: mean per-game held-out log loss over the
	// progress grid, games weighted equally.
	const foldOf = (i: number): number => i % CV_FOLDS;
	let bestL2 = L2_GRID[0];
	let bestLoss = Infinity;
	for (const l2 of L2_GRID) {
		const gameLosses: number[] = [];
		for (let f = 0; f < CV_FOLDS; f++) {
			const ws = fitBuckets(
				duels.filter((_, i) => foldOf(i) !== f),
				l2,
			);
			duels.forEach((g, i) => {
				if (foldOf(i) !== f) return;
				const y = g.winner === g.a ? 1 : 0;
				const losses: number[] = [];
				for (const prog of EVAL_PROGRESS) {
					const p = predictAt(ws, g, prog);
					if (p == null) continue;
					const c = Math.min(1 - 1e-9, Math.max(1e-9, p));
					losses.push(-(y * Math.log(c) + (1 - y) * Math.log(1 - c)));
				}
				if (losses.length > 0)
					gameLosses.push(losses.reduce((s, v) => s + v, 0) / losses.length);
			});
		}
		const mean = gameLosses.reduce((s, v) => s + v, 0) / gameLosses.length;
		console.log(
			`bake-momentum: CV L2=${l2} → held-out log loss ${mean.toFixed(4)}`,
		);
		if (mean < bestLoss) {
			bestLoss = mean;
			bestL2 = l2;
		}
	}

	// Final weights: every bucket refit on the full corpus at the chosen L2.
	const weights = fitBuckets(duels, bestL2).map((w) =>
		w ? w.map((v) => Math.round(v * 10000) / 10000) : null,
	);
	const bucketNs = BUCKETS.map(([lo, hi]) =>
		duels.reduce(
			(s, g) =>
				s +
				g.pts.filter((p) => {
					const prog = p.turn / g.end;
					return prog >= lo && prog < hi;
				}).length,
			0,
		),
	);

	// Shape check: growth must peak earlier than military, or the corpus is
	// mis-parsed (front-load/back-load is the model's signature).
	const peak = (dim: number): number => {
		let best = 0;
		let bestV = -Infinity;
		weights.forEach((w, i) => {
			if (w && w[dim] > bestV) {
				bestV = w[dim];
				best = i;
			}
		});
		return best;
	};
	const growthPeak = peak(DIMS.indexOf("growth"));
	const milPeak = peak(DIMS.indexOf("mil"));
	if (!(growthPeak < milPeak)) {
		throw new Error(
			`bake-momentum: shape check failed — growth peaks in bucket ${growthPeak}, military in ${milPeak}; expected growth to front-load and military to back-load.`,
		);
	}

	// One more CV pass at the chosen L2, pooling every held-out prediction —
	// the out-of-sample numbers the generated header cites, and the
	// calibration validation's input.
	const heldGrid: { y: number; p: number }[] = [];
	const heldAt = new Map<number, { y: number; p: number }[]>();
	for (let f = 0; f < CV_FOLDS; f++) {
		const ws = fitBuckets(
			duels.filter((_, i) => foldOf(i) !== f),
			bestL2,
		);
		duels.forEach((g, i) => {
			if (foldOf(i) !== f) return;
			const y = g.winner === g.a ? 1 : 0;
			for (const prog of EVAL_PROGRESS) {
				const p = predictAt(ws, g, prog);
				if (p != null) heldGrid.push({ y, p });
			}
			for (const prog of [0.3, 0.5, 0.7]) {
				const p = predictAt(ws, g, prog);
				if (p == null) continue;
				const arr = heldAt.get(prog) ?? [];
				arr.push({ y, p });
				heldAt.set(prog, arr);
			}
		});
	}
	const auc = (rows: { y: number; p: number }[]): string => {
		const pos = rows.filter((r) => r.y === 1).map((r) => r.p);
		const neg = rows.filter((r) => r.y === 0).map((r) => r.p);
		let concordant = 0;
		let pairs = 0;
		for (const p of pos)
			for (const n of neg) {
				pairs++;
				if (p > n) concordant++;
				else if (p === n) concordant += 0.5;
			}
		return pairs > 0 ? (concordant / pairs).toFixed(3) : "n/a";
	};
	const aucAt = (prog: number): string => auc(heldAt.get(prog) ?? []);
	const brier =
		heldGrid.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / heldGrid.length;
	// 10 equal-width bins; ECE = Σ (n_b/N)·|mean p − empirical win rate|.
	const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
	for (const r of heldGrid) {
		const b = bins[Math.min(9, Math.floor(r.p * 10))];
		b.n++;
		b.p += r.p;
		b.y += r.y;
	}
	const ece = bins.reduce(
		(s, b) =>
			b.n === 0
				? s
				: s + (b.n / heldGrid.length) * Math.abs(b.p / b.n - b.y / b.n),
		0,
	);
	// Calibration hard-fail: the UI renders p as a percentage, so calibration
	// — not discrimination — is the property it claims. Brier ≥ 0.25 means
	// the scores are no better than always saying 50%. The ECE bound is ~4×
	// the binning noise floor at this corpus size (10 bins × ~350 held-out
	// points → per-bin std ≈ 0.03), so a trip means genuine systematic
	// miscalibration, not sampling jitter.
	if (brier >= 0.25 || ece > 0.08) {
		throw new Error(
			`bake-momentum: calibration check failed — held-out Brier ${brier.toFixed(3)} (must be < 0.25), ECE ${ece.toFixed(3)} (must be ≤ 0.08). The rendered percentages would systematically mislead.`,
		);
	}

	// ---------- Emit ----------
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/bake-momentum.ts. Do not edit.");
	lines.push("// Run `npm run bake:momentum` to refit on a local corpus.");
	lines.push("//");
	lines.push(
		`// Fitted on ${duels.length} finished duels (${read} blobs scanned);`,
	);
	lines.push(
		`// L2=${bestL2} chosen by ${CV_FOLDS}-fold cross-validation grouped by game.`,
	);
	lines.push(
		`// Held-out AUC at 30/50/70% of game: ${aucAt(0.3)} / ${aucAt(0.5)} / ${aucAt(0.7)} (pooled CV predictions).`,
	);
	lines.push(
		`// Held-out calibration over a 10–90% progress grid: Brier ${brier.toFixed(3)}, ECE ${ece.toFixed(3)}.`,
	);
	lines.push("");
	lines.push(
		"// Bump MODEL_VERSION in the bake when the model FORM changes; a refit",
	);
	lines.push("// on new data keeps the version and changes the numbers.");
	lines.push(`export const MOMENTUM_MODEL_VERSION = ${MODEL_VERSION};`);
	lines.push("");
	lines.push("/** Dimension order every weights row follows. */");
	lines.push(`export const MOMENTUM_DIMS = ${JSON.stringify(DIMS)} as const;`);
	lines.push("");
	lines.push(
		"/** Progress buckets over T / final turn, half-open [lo, hi). */",
	);
	lines.push(
		"// Weights are FITTED per bucket; the scorer interpolates them",
		"// piecewise-linearly between bucket centres (no cliffs at the edges).",
	);
	lines.push(
		`export const MOMENTUM_BUCKETS: readonly [number, number][] = ${JSON.stringify(BUCKETS)};`,
	);
	lines.push("");
	lines.push(
		"/** Per-bucket weights (null = bucket too thin on this corpus). */",
	);
	lines.push(
		`export const MOMENTUM_WEIGHTS: readonly (readonly number[] | null)[] = ${JSON.stringify(weights)};`,
	);
	lines.push("");
	lines.push(
		"// Smoothed corpus SD of each dimension at each turn — the standardiser.",
	);
	lines.push(
		"// Sparse over turns; consumers snap to the nearest present turn.",
	);
	const sdObj: Record<string, Record<string, number>> = {};
	for (const t of goodTurns) {
		const row = sdTable.get(t)!;
		sdObj[t] = Object.fromEntries(
			DIMS.map((k) => [k, Math.round(row[k] * 10000) / 10000]),
		);
	}
	lines.push(
		`export const MOMENTUM_SD: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sdObj)};`,
	);
	lines.push("");

	const config = await resolveConfig(OUTPUTS[0]);
	const formatted = await prettierFormat(lines.join("\n"), {
		...config,
		parser: "typescript",
		filepath: OUTPUTS[0],
	});
	for (const out of OUTPUTS) {
		await mkdir(dirname(out), { recursive: true });
		await writeFile(out, formatted);
	}
	await emitMirror();
	console.log(
		`bake-momentum: ${duels.length} duels, buckets n=[${bucketNs.join(", ")}], L2=${bestL2}, ` +
			`held-out AUC@30/50/70% = ${aucAt(0.3)}/${aucAt(0.5)}/${aucAt(0.7)}, ` +
			`Brier ${brier.toFixed(3)}, ECE ${ece.toFixed(3)} → ${OUTPUTS.map((o) => o.replace(REPO_ROOT + "/", "")).join(", ")}`,
	);
	console.log(
		"weights per bucket:",
		weights.map((w) => (w ? w.map((v) => v.toFixed(2)).join(" ") : "thin")),
	);
}

await main();
