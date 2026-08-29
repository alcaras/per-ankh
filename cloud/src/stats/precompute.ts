// Nightly precompute of the public /stats bundles.
//
// Every selection the /stats surface can express is a (slice, nation?) pair,
// and the whole space is small enough to build ahead of time: four composition
// slices, each unfaceted plus one bundle per nation seated in it. The request
// path still computes on a miss (global-stats design §5) — this warms the
// cache, it does not own it, and no correctness rests on it having run. That
// is also why it writes through putCached rather than a longer-lived tier:
// both paths produce the same kind of entry, so both get the same 24h TTL.

import { buildChartBundle } from "./aggregate";
import type { AggregateEnv } from "./aggregate";
import { putCached } from "./cache";
import type { StatsCacheEnv } from "./cache";
import { listGlobalSliceNations, resolveGlobalCorpus } from "./resolve";
import type { ResolveEnv } from "./resolve";
import type { GlobalSlice } from "./types";

// Cron pattern → the slice that pattern precomputes.
//
// One pattern per slice rather than one invocation for all four. The four
// together are ~963 D1 queries against a 1,000-per-invocation ceiling, and
// both that ceiling and the 128 MB isolate are charged per invocation — so a
// pattern each buys a fresh query budget *and* a fresh isolate, and a fifth
// slice later adds a pattern instead of eating another's margin. Every
// interval stays at an hour or more, which is what puts a cron on the
// 15-minute CPU tier rather than the 30-second one.
//
// The Worker's `scheduled` handler dispatches on this table with no fallback,
// so a pattern missing from it does nothing rather than running the retention
// sweep — which is what lets staging declare these patterns and only these.
// Kept in sync by eye with `crons` in wrangler.toml, top-level and staging
// alike; nothing imports a wrangler config.
export const STATS_PRECOMPUTE_CRONS: Readonly<Record<string, GlobalSlice>> = {
	"17 4 * * *": "all",
	"17 5 * * *": "duel",
	"17 6 * * *": "ffa",
	"17 7 * * *": "single_player",
};

export interface PrecomputeEnv
	extends AggregateEnv, ResolveEnv, StatsCacheEnv {}

export interface PrecomputeSliceResult {
	// Bundles written: the unfaceted slice, plus one per nation seated in it.
	selections: number;
	// Games in the unfaceted slice. The faceted selections are subsets of it,
	// so this is the number the invocation's cost is denominated in.
	games: number;
}

// Build and cache every selection of one slice.
//
// Strictly sequential, and that is the load-bearing part rather than an
// incidental loop: one bundle's working set peaks near 60 MB while it builds,
// against a 128 MB isolate. Fourteen of them in flight is the shape that runs
// out of memory; one at a time, each released before the next starts, is the
// shape that fits — so nothing here may become a Promise.all.
//
// The unfaceted slice goes first. It is the largest bundle and the one a
// visitor lands on (nobody arrives on a nation), so if an invocation is going
// to exhaust its query budget it should do that after the entry point is warm
// rather than before.
export async function precomputeGlobalSlice(
	env: PrecomputeEnv,
	slice: GlobalSlice,
	parserVersion: string,
): Promise<PrecomputeSliceResult> {
	const nations = await listGlobalSliceNations(env, slice);
	const selections: string[][] = [[], ...nations.map((nation) => [nation])];

	let games = 0;
	for (const selection of selections) {
		const corpus = await resolveGlobalCorpus(env, slice, {
			nations: selection,
		});
		if (selection.length === 0) games = corpus.gameIds.length;
		// "humans" widens the focal set to every human seat, which is the whole
		// point of a corpus where both sides of a duel are someone's game. It
		// returns a ChartBundleCore; the cache is opaque JSON either way.
		const bundle = await buildChartBundle(env, corpus, parserVersion, "humans");
		await putCached(
			env,
			{
				kind: "global",
				slice,
				nations: selection,
				parser_version: parserVersion,
			},
			bundle,
		);
	}

	return { selections: selections.length, games };
}
