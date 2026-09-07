// HTTP handlers for the stats endpoints.
//
//   GET /v1/users/:user_id/stats           — user corpus
//   GET /v1/stats                          — global (public) corpus
//   GET /v1/stats/players                  — played-games leaderboard
//
// The first two resolve corpus → check cache → compute on miss → return
// bundle. The third is not a bundle at all — it counts games played per user
// straight out of D1, uncached — and shares this file for the corpus it reads
// rather than for the shape it returns.

import { CURRENT_PARSER_VERSION } from "../schemas/game";
import { sessionFromRequest } from "../session";
import type { SessionEnv } from "../session";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "../util";
import { buildAvatarUrl } from "../auth";
import { displayNameSql } from "../identity";
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
import { resolveGlobalCorpus, resolveUserCorpus } from "./resolve";
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
// than waiting out a client TTL. `cors` already carries Vary: Origin
// (cloudCorsHeaders), which is what keeps the origin-specific CORS headers from
// being served to the wrong origin out of a shared cache.
//
// It is also half the herd control a cold key has: every colo answers its
// second and later requests from the edge, which takes a version bump from
// "one recompute per request" to roughly one per colo. The other half is the
// hourly warm (STATS_WARM_CRON, stats/precompute.ts), which rebuilds any of
// the four unfaceted bundles that a bump orphaned and so bounds the cold
// window to one interval. Design §12 wanted that warm at deploy time instead;
// it is a cron because a deploy step would need an app session the wrangler
// toolchain has no way to mint. Whether the two hold together is the trigger
// for a single-flight lock, which the design defers until they measurably
// don't.
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
		},
	});
}

// GET /v1/stats — the chart bundle over the whole public corpus.
//
// Session required. Not because the payload is viewer-dependent — it is not:
// is_public = 1 is the whole visibility rule (it already covers tournament
// games, which linkTournamentMatch forces public), so every signed-in viewer
// reads the same bytes and nothing here consults the session beyond its
// existence. The gate is on who may spend a whole-corpus aggregation, not on
// what they get to see.
//
// Checked before the rate limit, the way handleUserSearch does it: a request
// that never reads anything should not spend an IP's read budget, and an
// anonymous caller with no cookie is refused without touching KV or D1.
//
// One consequence worth naming: enforceReadRateLimit exempts scraper
// User-Agents from the budget, but that exemption was only ever about counting.
// A Discord or Slack link-preview bot carries no session, so it is refused here
// like any other anonymous caller — and the frontend /stats route bounces the
// same visitors to login, so a shared /stats link previews as the home page.
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
// Step 3 is not a vestige of step 1 and never refuses. A schema bump orphans
// all 56 keys at once and step 2 deliberately won't reach across that bump,
// so what warms them back is the hourly cron (STATS_WARM_CRON,
// stats/precompute.ts) — and it covers the four unfaceted slices only. Every
// nation selection asked for between the bump and the night's precompute is
// still served by building it here. Precompute-only is the one shape that
// would make the facet model expensive to change later.
//
// Step 2 is skipped where the selection resolves to no games — see the
// resolve below.
export async function handleGlobalStats(
	request: Request,
	env: GlobalStatsEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

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

	// Resolve before reaching for a stale entry, so a selection with no games
	// never pays for the reach. Such a selection is deliberately never cached
	// (precompute.ts — an empty bundle costs no queries, and caching one would
	// be a KV write per distinct string anyone can mint), so it misses forever,
	// and getStaleGlobalCached answers a miss by paginating every `stats:` key
	// in the namespace — user and tournament bundles included — to conclude the
	// same nothing every time.
	//
	// It is not only a hand-edited URL that lands here. The facet offers all 13
	// nations in every slice by design (§9.1), so picking one that nobody has
	// played in the FFA slice is an ordinary click, and it walks the keyspace on
	// every request for as long as the corpus stays that way.
	//
	// Nothing is given up by skipping the lookup: an empty selection was never
	// written under any parser version, so there is no stale entry to find. The
	// cost is one D1 query ahead of a stale response, which already pays for the
	// walk itself.
	const corpus = await resolveGlobalCorpus(env, slice, { nations });
	const build = () =>
		buildGlobalSelection(env, slice, nations, CURRENT_PARSER_VERSION, corpus);

	if (corpus.gameIds.length === 0) {
		return globalStatsResponse(await build(), cors);
	}

	const stale = await getStaleGlobalCached<ChartBundleCore>(env, cacheKey);
	if (stale) {
		ctx.waitUntil(
			build().catch((e: unknown) => {
				// Nothing awaits this, so the log line is the only signal. The
				// next request misses again and retries it, either from the
				// request path or from the night's cron.
				logError("global_stats_refresh_failed", e, {
					slice,
					nation: nation ?? "",
				});
			}),
		);
		return globalStatsResponse(stale, cors);
	}

	return globalStatsResponse(await build(), cors);
}

// ─── Played-games leaderboard ────────────────────────────────────────
//
//   GET /v1/stats/players — public site-wide leaderboard of games PLAYED
//   per user, split by category: network duels, cloud duels, FFAs (3+
//   humans, any mode), and other (single-player, hotseat/LAN). Playing is
//   what's counted, not uploading: anyone's upload credits every human
//   seat in it — the uploader via their claimed seat, everyone else by
//   matching the seat's online id against user_online_ids. The same match
//   uploaded by both players (separate game rows, same save GameId)
//   counts once per player, deduped on xml_game_id. Only display names,
//   Discord avatars, and counts are exposed.

export interface PlayerLeaderboardEnv {
	SHARE_DB: QueryableD1;
	EVENTS_DB: D1Database;
	ALLOWED_ORIGINS: string;
	// Per-IP hourly ceiling on the /players read budget. Optional: unset falls
	// back to the constant below. A var rather than a bare const for the same
	// reason the other read ceilings are — retunable without a redeploy.
	SEASON_VIEW_PER_HOUR?: string;
}

// Per-IP budget for the public /players reads, spent one slot per board.
//
// Its own budget, deliberately not a share of anon_read. /players and /games/*
// are different populations, and a shared budget lets whichever is busier
// decide when the other starts refusing — the coupling that took the
// tournament pages down on 2026-08-05, and the reason tournament/limits.ts
// says to give a public read the budget of the page that fetches it rather
// than of the feature it belongs to. anon_read is also the wrong size and the
// wrong shape for this page: its 200/hr is already shared with the home feed
// and every game-detail view, and it is a bare constant, so the season read
// would be the only budgeted public read an operator can't retune without a
// redeploy.
//
// Not a share of global_stats_view either, close as the two surfaces sound:
// /players is anonymous where /stats is session-gated, so pooling them would
// let a crawl of the public board decide when signed-in visitors stop getting
// charts.
//
// 1200 arrived through the fan-out, not by copying a number across: the
// /players page fetches two boards per load — all-time plus the selected
// season (src/routes/players/+page.ts) — and each step through the archive
// costs another two. So 1200 is ~600 page loads an hour, the same headroom
// GLOBAL_STATS_VIEW_PER_HOUR buys at 600 on one read a load and
// TOURNAMENT_VIEW_PER_HOUR at 2400 on four to six.
//
// The default only — read the effective ceiling with seasonViewPerHour().
export const SEASON_VIEW_PER_HOUR = 1200;

export function seasonViewPerHour(env: {
	SEASON_VIEW_PER_HOUR?: string;
}): number {
	return ceilingFrom(
		env.SEASON_VIEW_PER_HOUR,
		SEASON_VIEW_PER_HOUR,
		"SEASON_VIEW_PER_HOUR",
	);
}

const SEASON_BUDGET: ReadBudget = {
	eventType: "season_view",
	message: "Season view rate limit exceeded",
	code: "RATE_LIMIT_SEASON",
};

// The D1 row. discord_id and avatar_hash are SELECTed to address the Discord
// CDN and are folded into avatar_url below rather than emitted as fields of
// their own — the same select-use-don't-serialize shape handlePublicUserSearch
// and the featured-video attribution use.
interface PlayedGamesQueryRow {
	user_id: string;
	display_name: string;
	discord_id: string;
	avatar_hash: string | null;
	duels_network: number;
	duels_cloud: number;
	ffas: number;
	total: number;
}

export async function handlePlayerLeaderboard(
	request: Request,
	env: PlayerLeaderboardEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const limited = await enforceReadRateLimit(
		env,
		request,
		cors,
		SEASON_BUDGET,
		seasonViewPerHour(env),
	);
	if (limited) return limited;

	// Optional season window: `since`/`until` (YYYY-MM-DD, until exclusive)
	// count only games UPLOADED in the window — created_at is
	// server-authoritative, unlike the save's own dates. Invalid values are
	// rejected rather than silently ignored so a malformed season picker
	// can't masquerade as all-time.
	//
	// The frontend also sends `v`, its PLAYERS_SHAPE_VERSION (api-cloud.ts).
	// Nothing here reads it and nothing should: it exists to key the caches a
	// closed window's day-long max-age fills, and a response that varied on it
	// would defeat that. It is named here so a later tightening of this
	// validation doesn't 400 the board's own requests.
	const url = new URL(request.url);
	const sinceRaw = url.searchParams.get("since");
	const untilRaw = url.searchParams.get("until");
	for (const v of [sinceRaw, untilRaw]) {
		if (v != null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
			return errorResponse("Invalid window date", 400, cors, "INVALID_QUERY");
		}
	}

	// `played` is (user, match) pairs — the uploader's claimed seat, plus
	// every seat whose online id belongs to a registered user; UNION dedupes
	// both the two credit paths and double-uploaded matches (same
	// xml_game_id). `match_class` classifies each match from any in-window
	// upload of it (all uploads of a match carry the same save, so humans
	// and game_mode agree). Duel = exactly two humans, split by game mode;
	// two-human hotseat/LAN lands in `other` (derived client-side).
	//
	// Every arm carries is_public = 1 — the same visibility rule the profile
	// card (users.ts) and the global corpus (stats/resolve.ts) enforce. A
	// private game must not reach a public counter: the increment alone
	// publishes that the game happened, how many humans were in it and its
	// game mode, and — through the online-id arm — that a second player was
	// there, which is a visibility decision that player never made. Windows
	// are caller-supplied down to a single day, so the counters are fine
	// enough to read as an activity log rather than as a season total.
	// `match_class` is the load-bearing arm (the final JOIN is inner, so a
	// match missing from it drops out entirely), but all three carry the
	// predicate rather than resting a visibility guarantee on join
	// semantics. A match uploaded publicly by one player and privately by
	// another stays public — the public upload classifies it, and both
	// players are credited once.
	const rows = await env.SHARE_DB.prepare(
		`WITH humans AS (
		   SELECT game_id, SUM(is_human) AS n
		   FROM player_summaries GROUP BY game_id
		 ),
		 played AS (
		   SELECT g.user_id, g.xml_game_id
		   FROM games g
		   JOIN player_summaries ps
		     ON ps.game_id = g.game_id AND ps.is_uploader = 1 AND ps.is_human = 1
		   WHERE g.is_public = 1
		     AND (?1 IS NULL OR g.created_at >= ?1)
		     AND (?2 IS NULL OR g.created_at < ?2)
		   UNION
		   SELECT uo.user_id, g.xml_game_id
		   FROM games g
		   JOIN player_summaries ps
		     ON ps.game_id = g.game_id AND ps.is_human = 1
		        AND ps.online_id IS NOT NULL
		   JOIN user_online_ids uo ON uo.online_id = ps.online_id
		   WHERE g.is_public = 1
		     AND (?1 IS NULL OR g.created_at >= ?1)
		     AND (?2 IS NULL OR g.created_at < ?2)
		 ),
		 match_class AS (
		   SELECT g.xml_game_id, MAX(h.n) AS n_humans, MAX(g.game_mode) AS game_mode
		   FROM games g
		   JOIN humans h ON h.game_id = g.game_id
		   WHERE g.is_public = 1
		     AND (?1 IS NULL OR g.created_at >= ?1)
		     AND (?2 IS NULL OR g.created_at < ?2)
		   GROUP BY g.xml_game_id
		 )
		 SELECT
		   u.user_id,
		   ${displayNameSql("u")} AS display_name,
		   u.discord_id,
		   u.avatar_hash,
		   SUM(mc.n_humans = 2 AND mc.game_mode = 'NETWORK') AS duels_network,
		   SUM(mc.n_humans = 2 AND mc.game_mode = 'PLAY_BY_CLOUD') AS duels_cloud,
		   SUM(mc.n_humans >= 3) AS ffas,
		   COUNT(*) AS total
		 FROM played p
		 JOIN match_class mc ON mc.xml_game_id = p.xml_game_id
		 JOIN users u ON u.user_id = p.user_id
		 GROUP BY u.user_id
		 ORDER BY total DESC, display_name ASC`,
	)
		.bind(sinceRaw, untilRaw)
		.all<PlayedGamesQueryRow>();

	const players = (rows.results ?? []).map((r) => ({
		user_id: r.user_id,
		display_name: r.display_name,
		avatar_url: buildAvatarUrl(r.discord_id, r.avatar_hash),
		duels_network: r.duels_network,
		duels_cloud: r.duels_cloud,
		ffas: r.ffas,
		total: r.total,
	}));

	// A CLOSED window is immutable — created_at can't be backdated, so a
	// finished season's board never changes — and caches for a day; open
	// windows keep the public-recent shape (60s edge, 5min browser).
	const closed =
		untilRaw != null && untilRaw <= new Date().toISOString().slice(0, 10);
	return new Response(JSON.stringify({ players }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": closed
				? "public, max-age=86400, s-maxage=86400"
				: "public, max-age=300, s-maxage=60",
			...cors,
			Vary: "Origin",
		},
	});
}
