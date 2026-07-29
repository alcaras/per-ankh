// HTTP handler for the stats endpoint.
//
//   GET /v1/users/:user_id/stats           — user corpus
//
// Resolve corpus → check cache → compute on miss → return bundle.

import { CURRENT_PARSER_VERSION } from "../schemas/game";
import { sessionFromRequest } from "../session";
import type { SessionEnv } from "../session";
import {
	cloudCorsHeaders,
	errorResponse,
	getClientIp,
	jsonResponse,
} from "../util";
import { ANON_READS_PER_HOUR, countEventsSince, isScraperUA } from "../games";
import { parseScopeParam } from "../games-scope";
import { buildChartBundle } from "./aggregate";
import { getCached, putCached } from "./cache";
import { resolveUserCorpus } from "./resolve";
import type { ChartBundle, UserStatsScope } from "./types";
import type { QueryableD1 } from "../d1";

export interface UserStatsEnv extends SessionEnv {
	SHARE_DB: QueryableD1;
	SESSIONS_KV: KVNamespace;
	ALLOWED_ORIGINS: string;
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

// ─── Uploader leaderboard ────────────────────────────────────────────
//
//   GET /v1/stats/uploaders — public site-wide leaderboard of games
//   uploaded per user, split by category: network duels, cloud duels,
//   FFAs (3+ humans, any mode), and other (single-player, hotseat/LAN,
//   observer archives). Counts every upload — the point is who feeds the
//   archive — but exposes only display names and counts.

export interface UploaderLeaderboardEnv {
	SHARE_DB: QueryableD1;
	EVENTS_DB: D1Database;
	ALLOWED_ORIGINS: string;
}

interface UploaderRow {
	user_id: string;
	display_name: string;
	duels_network: number;
	duels_cloud: number;
	ffas: number;
	total: number;
}

export async function handleUploaderLeaderboard(
	request: Request,
	env: UploaderLeaderboardEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	// Same anon_read budget as the other public list reads (public-recent,
	// game detail): scrapers exempt by UA, untrusted IPs share one bucket.
	const ip = getClientIp(request) ?? "untrusted";
	const ua = request.headers.get("User-Agent");
	if (!isScraperUA(ua)) {
		const count = await countEventsSince(
			env.EVENTS_DB,
			"anon_read",
			"ip_address",
			ip,
		);
		if (count >= ANON_READS_PER_HOUR) {
			return errorResponse(
				"Rate limit exceeded. Try again later.",
				429,
				cors,
				"RATE_LIMIT",
			);
		}
		env.EVENTS_DB.prepare(
			`INSERT INTO events (event_type, ip_address) VALUES ('anon_read', ?)`,
		)
			.bind(ip)
			.run()
			.catch(() => {});
	}

	// Duel = exactly two humans; network/cloud from the save's game mode. A
	// two-human hotseat/LAN game isn't either duel column and lands in
	// `other` (derived client-side as total − the three columns), alongside
	// single-player. The human count comes from player_summaries, which is
	// written for every upload alongside the games row.
	const rows = await env.SHARE_DB.prepare(
		`SELECT
		   u.user_id,
		   COALESCE(u.alias, u.display_name) AS display_name,
		   SUM(h.humans = 2 AND g.game_mode = 'NETWORK') AS duels_network,
		   SUM(h.humans = 2 AND g.game_mode = 'PLAY_BY_CLOUD') AS duels_cloud,
		   SUM(h.humans >= 3) AS ffas,
		   COUNT(*) AS total
		 FROM games g
		 JOIN users u ON u.user_id = g.user_id
		 JOIN (
		   SELECT game_id, SUM(is_human) AS humans
		   FROM player_summaries GROUP BY game_id
		 ) h ON h.game_id = g.game_id
		 GROUP BY u.user_id
		 ORDER BY total DESC, display_name ASC`,
	).all<UploaderRow>();

	// Same public cache shape as public-recent: 60s edge, 5min browser.
	return new Response(JSON.stringify({ uploaders: rows.results ?? [] }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=300, s-maxage=60",
			...cors,
			Vary: "Origin",
		},
	});
}
