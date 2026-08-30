// HTTP handlers for the stats endpoints.
//
//   GET /v1/users/:user_id/stats           — user corpus
//   GET /v1/stats                          — global (public) corpus
//
// Resolve corpus → check cache → compute on miss → return bundle.

import { CURRENT_PARSER_VERSION } from "../schemas/game";
import { sessionFromRequest } from "../session";
import type { SessionEnv } from "../session";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "../util";
import {
	parseNationParam,
	parseScopeParam,
	parseSliceParam,
} from "../games-scope";
import { ceilingFrom, enforceReadRateLimit } from "../read-budget";
import type { ReadBudget } from "../read-budget";
import { logError } from "../log";
import { buildChartBundle } from "./aggregate";
import { getCached, getStaleGlobalCached, putCached } from "./cache";
import { buildGlobalSelection } from "./precompute";
import type { PrecomputeEnv } from "./precompute";
import { resolveUserCorpus } from "./resolve";
import type { ChartBundle, ChartBundleCore, UserStatsScope } from "./types";
import type { EventsEnv, QueryableD1 } from "../d1";

export interface UserStatsEnv extends SessionEnv {
	SHARE_DB: QueryableD1;
	SESSIONS_KV: KVNamespace;
	ALLOWED_ORIGINS: string;
}

export interface GlobalStatsEnv extends PrecomputeEnv, EventsEnv {
	ALLOWED_ORIGINS: string;
	// Per-IP hourly ceiling on the /stats read budget. Optional: unset falls
	// back to the constant below. A var rather than a bare const for the same
	// reason the tournament ceilings are — retunable without a redeploy.
	GLOBAL_STATS_VIEW_PER_HOUR?: string;
}

export async function handleUserStats(
	userId: string,
	request: Request,
	env: UserStatsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	if (!/^[A-Za-z0-9_-]{21}$/.test(userId)) {
		return errorResponse("Invalid user_id", 400, cors, "INVALID_USER_ID");
	}

	const session = await sessionFromRequest(env, request);
	const viewerId = session?.data.user_id ?? null;
	const viewerScope: UserStatsScope = viewerId === userId ? "self" : "public";

	const url = new URL(request.url);
	const scope = parseScopeParam(url.searchParams.get("scope"));

	const cacheKey = {
		kind: "user" as const,
		user_id: userId,
		viewerScope,
		scope,
		parser_version: CURRENT_PARSER_VERSION,
	};
	const cached = await getCached<ChartBundle>(env, cacheKey);
	if (cached) {
		return jsonResponse(
			cached as unknown as Record<string, unknown>,
			200,
			cors,
		);
	}

	const corpus = await resolveUserCorpus(env, userId, viewerScope, scope);
	if (!corpus) {
		return errorResponse("User not found", 404, cors, "NOT_FOUND");
	}

	const bundle = await buildChartBundle(
		env,
		corpus,
		CURRENT_PARSER_VERSION,
		"uploader",
	);
	await putCached(env, cacheKey, bundle);
	return jsonResponse(bundle as unknown as Record<string, unknown>, 200, cors);
}

// ---------- GET /v1/stats — the global corpus ----------

// Per-IP budget for the public /stats read, spent one slot per bundle fetched.
//
// Its own budget, deliberately not a share of anon_read: /stats and /games/*
// are different populations, and a shared budget lets whichever is busier
// decide when the other starts refusing — the coupling that took the
// tournament pages down on 2026-08-05. It also ties the abuse ceiling to the
// cold-start ceiling, two knobs that want to move independently.
//
// 600 arrived through the fan-out, not by copying a number across: /stats is
// one read per page load, so 600 is 600 page loads an hour — the same headroom
// TOURNAMENT_LIST_VIEW_PER_HOUR buys at the same number, and the same headroom
// TOURNAMENT_VIEW_PER_HOUR needs 2400 to reach on its four-to-six reads a page.
//
// The default only — read the effective ceiling with globalStatsViewPerHour().
export const GLOBAL_STATS_VIEW_PER_HOUR = 600;

export function globalStatsViewPerHour(env: {
	GLOBAL_STATS_VIEW_PER_HOUR?: string;
}): number {
	return ceilingFrom(
		env.GLOBAL_STATS_VIEW_PER_HOUR,
		GLOBAL_STATS_VIEW_PER_HOUR,
		"GLOBAL_STATS_VIEW_PER_HOUR",
	);
}

const GLOBAL_STATS_BUDGET: ReadBudget = {
	eventType: "global_stats_view",
	message: "Stats view rate limit exceeded",
	code: "RATE_LIMIT_GLOBAL_STATS",
};

// The payload is byte-identical for every viewer and changes at most nightly,
// so it takes an edge cache — the same header the other public reads carry
// (channels.ts, featured.ts, tournament/public.ts). No browser cache, so a
// visitor who reloads after the nightly precompute sees the new numbers rather
// than waiting out a client TTL. Vary: Origin because the CORS headers are
// origin-specific and the response is shared-cacheable.
//
// It is also the herd control a cold key relies on: every colo answers its
// second and later requests from the edge, which with the deploy's warm step
// takes a version bump from "one recompute per request" to roughly one per
// colo. Whether that holds is the trigger for a single-flight lock, which the
// design defers until it measurably doesn't.
function globalStatsResponse(
	bundle: ChartBundleCore,
	cors: Record<string, string>,
): Response {
	return new Response(JSON.stringify(bundle), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=0, s-maxage=60",
			...cors,
			Vary: "Origin",
		},
	});
}

// GET /v1/stats — the chart bundle over the whole public corpus.
//
// Public: anonymous, no session read at all. is_public = 1 is the whole
// visibility rule (it already covers tournament games, which linkTournamentMatch
// forces public), so there is no viewer-dependent half of this payload and
// nothing for a session to decide.
//
// The selection is a composition slice plus an optional nation, both parsed
// forgivingly: an unknown ?slice= falls back to the duel default and an
// unknown ?nation= to no facet, so a stale bookmark or a hand-edited URL
// degrades to a neighbouring view instead of 400ing.
//
// Three ways to answer, in order:
//
//   1. The precomputed entry (stats/precompute.ts warms all 56 of them
//      nightly). The steady state, and a single KV read.
//   2. Last night's entry under a superseded parser_version, served stale
//      while this one rebuilds behind ctx.waitUntil. Available on parser drift
//      only — a BUNDLE_SCHEMA_VERSION bump changes the bundle's shape, and a
//      frontend on the new shape would break on the old bytes (see
//      getStaleGlobalCached).
//   3. Computing it here.
//
// Step 3 is not a vestige of step 1 and never refuses: a schema bump orphans
// every key at once, a deploy warms only the four unfaceted slices, and a
// nation selection asked for in between has to be served by building it.
// Precompute-only is the one shape that would make the facet model expensive
// to change later.
export async function handleGlobalStats(
	request: Request,
	env: GlobalStatsEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const limited = await enforceReadRateLimit(
		env,
		request,
		cors,
		GLOBAL_STATS_BUDGET,
		globalStatsViewPerHour(env),
	);
	if (limited) return limited;

	const url = new URL(request.url);
	const slice = parseSliceParam(url.searchParams.get("slice"));
	const nation = parseNationParam(url.searchParams.get("nation"));
	// The resolver and the cache key both take a set, even though the UI is
	// single-select, so widening the facet to multi-select later costs the
	// nightly precompute table rather than this call chain.
	const nations = nation === null ? [] : [nation];

	const cacheKey = {
		kind: "global" as const,
		slice,
		nations,
		parser_version: CURRENT_PARSER_VERSION,
	};
	const cached = await getCached<ChartBundleCore>(env, cacheKey);
	if (cached) return globalStatsResponse(cached, cors);

	const stale = await getStaleGlobalCached<ChartBundleCore>(env, cacheKey);
	if (stale) {
		ctx.waitUntil(
			buildGlobalSelection(env, slice, nations, CURRENT_PARSER_VERSION).catch(
				(e: unknown) => {
					// Nothing awaits this, so the log line is the only signal. The
					// next request misses again and retries it, either from the
					// request path or from the night's cron.
					logError("global_stats_refresh_failed", e, {
						slice,
						nation: nation ?? "",
					});
				},
			),
		);
		return globalStatsResponse(stale, cors);
	}

	const bundle = await buildGlobalSelection(
		env,
		slice,
		nations,
		CURRENT_PARSER_VERSION,
	);
	return globalStatsResponse(bundle, cors);
}
