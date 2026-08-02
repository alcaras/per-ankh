// User-table-shaped endpoints: two searches — the tournament admin's
// autocomplete and the header's people search — plus the public profile
// (the /users/[user_id] page chrome).
//
// Anything more user-table-shaped that grows beyond a few hundred lines
// can split into its own subdir.
//
// Auth model, shared by both searches:
//   1. session required (anonymous → 401) — a search returns user
//      identity fields, so it's logged-in only.
//   2. per-user rate limit on the user_id, audited via the shared
//      `events` table — same engine as the tournament_view limit.
//
// The two searches are deliberately separate handlers rather than one
// parameterized by audience: they differ in which columns match, which
// columns serialize, which rows are eligible, and how big the budget is.
// Folding them together would put an `isPublic` flag in front of the PII
// decision, which is the one thing that must not be a parameter. See
// handlePublicUserSearch for the three differences.
//
// Privacy: /search returns only the four fields the autocomplete needs
// (user_id, discord_id, discord_username, display_name). No email,
// avatar, or timestamps. Result cap defaults to 10, max 20.

import * as v from "valibot";
import { buildAvatarUrl } from "./auth";
import { countEventsSince } from "./games";
import { displayNameSql } from "./identity";
import { logError } from "./log";
import { UserSearchQuerySchema } from "./schemas/tournament";
import { sessionFromRequest, type SessionEnv } from "./session";
import { USER_MATCHES_WHERE, type TournamentEnv } from "./tournament/data";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "./util";
import type { QueryableD1, EventsEnv } from "./d1";

// Generous ceiling — typing 5 chars to find someone, picking from the
// dropdown, costs ~4 requests per slot. An admin adding a 16-player
// tournament makes ~64 requests; 60/hour limits that to one full slot
// list per hour from a single account. Any logged-in user can search, so
// the limit mostly bounds runaway scripts.
export const USER_SEARCH_PER_USER_PER_HOUR = 60;

// The public people search runs off the header's search-as-you-type, so it
// spends one audited call per debounced keystroke past the 2-char floor —
// finding one player costs several requests, and the admin search's 60/hr
// would allow only about seven lookups an hour. 300 keeps the dropdown
// usable across a browsing session while still bounding a runaway script.
export const PUBLIC_USER_SEARCH_PER_USER_PER_HOUR = 300;

const DEFAULT_LIMIT = 10;

// Both searches want the same three things: a session, SHARE_DB for the
// lookup, and EVENTS_DB for the budget.
export interface UserSearchEnv extends SessionEnv, TournamentEnv, EventsEnv {
	ALLOWED_ORIGINS: string;
}

export async function handleUserSearch(
	request: Request,
	env: UserSearchEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	// Rate limit per user. Check BEFORE doing any DB work or audit-row
	// insert so a hammered account fails cheaply.
	const count = await countEventsSince(
		env.EVENTS_DB,
		"user_search",
		"user_id",
		session.data.user_id,
	);
	if (count >= USER_SEARCH_PER_USER_PER_HOUR) {
		return errorResponse(
			"User search rate limit exceeded",
			429,
			cors,
			"RATE_LIMIT_USER_SEARCH",
		);
	}

	const url = new URL(request.url);
	const rawQ = url.searchParams.get("q") ?? "";
	const rawLimit = url.searchParams.get("limit");
	const limitNum = rawLimit !== null ? parseInt(rawLimit, 10) : NaN;
	const parsed = v.safeParse(UserSearchQuerySchema, {
		q: rawQ,
		...(Number.isFinite(limitNum) ? { limit: limitNum } : {}),
	});
	if (!parsed.success) {
		return errorResponse(
			`Invalid query: ${parsed.issues[0]?.message ?? "unknown"}`,
			400,
			cors,
			"VALIDATION_ERROR",
		);
	}
	const { q, limit = DEFAULT_LIMIT } = parsed.output;

	// "Still typing" floor — return empty without an audit row, so per-
	// keystroke calls below 2 chars don't churn the rate-limit counter or
	// the events table. Frontend can call /search on every keystroke
	// without thinking.
	if (q.length < 2) {
		return jsonResponse({ users: [] }, 200, cors);
	}

	// Audit row also serves as the rate-limit counter source. async fire-
	// and-forget — failure to audit shouldn't block the lookup.
	env.EVENTS_DB.prepare(
		`INSERT INTO events (event_type, user_id, metadata)
		 VALUES ('user_search', ?, ?)`,
	)
		.bind(session.data.user_id, JSON.stringify({ q_length: q.length }))
		.run()
		.catch((e: unknown) => {
			logError("user_search_audit_failed", e, {
				user_id: session.data.user_id,
			});
		});

	// Match a prefix of either display_name (the global_name fallback to
	// username — what people recognize themselves as) OR discord_username (the
	// lowercased canonical @ handle), so an admin can type whichever they know.
	// Picking a row threads discord_username into the slot via the user_id
	// pre-link path, so the data we store is unchanged. discord_username IS NOT
	// NULL filters out users who haven't logged in since migration 0016 and
	// would therefore be unpickable.
	//
	// LOWER(...) for case-insensitive match against the already-lowercased `q`
	// (discord_username is already stored lowercase). Indexes:
	// idx_users_discord_username covers the handle prefix; display_name has no
	// index. Table is small enough that the scan is fine — promote to a
	// functional index if user count grows past a few thousand.
	const rows = await env.SHARE_DB.prepare(
		`SELECT user_id, discord_id, discord_username,
		        ${displayNameSql("users")} AS display_name
		 FROM users
		 WHERE (LOWER(display_name) LIKE ?
		        OR LOWER(discord_username) LIKE ?
		        OR LOWER(alias) LIKE ?)
		   AND discord_username IS NOT NULL
		   AND display_name IS NOT NULL
		 ORDER BY display_name
		 LIMIT ?`,
	)
		.bind(q + "%", q + "%", q + "%", limit)
		.all<{
			user_id: string;
			discord_id: string;
			discord_username: string;
			display_name: string;
		}>();

	return jsonResponse({ users: rows.results ?? [] }, 200, cors);
}

// GET /v1/users/public-search — the header search's "Players" group.
//
// The public-facing sibling of handleUserSearch above: same auth, same
// rate-limit engine, three deliberate differences.
//
//   1. Matches display_name and alias only, never discord_username. The
//      admin search matches the canonical @ handle so an admin can type
//      whichever name they know; doing that here would let any logged-in
//      caller confirm Discord-handle prefixes, which is the thing the PII
//      stance forbids.
//   2. Serializes no discord_* field. discord_id is still SELECTed —
//      buildAvatarUrl needs it to address the CDN — and then used without
//      being emitted, the same select-use-don't-serialize shape
//      handleUserProfile uses for the profile header's avatar.
//   3. Returns only users who made something public (the EXISTS block).
//
// Rows are { user_id, display_name, avatar_url }.
interface PublicUserSearchRow {
	user_id: string;
	discord_id: string;
	display_name: string;
	avatar_hash: string | null;
}

export async function handlePublicUserSearch(
	request: Request,
	env: UserSearchEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	// Same ordering as handleUserSearch: budget first, so a hammered account
	// fails before any DB work or audit insert.
	const count = await countEventsSince(
		env.EVENTS_DB,
		"user_search_public",
		"user_id",
		session.data.user_id,
	);
	if (count >= PUBLIC_USER_SEARCH_PER_USER_PER_HOUR) {
		return errorResponse(
			"User search rate limit exceeded",
			429,
			cors,
			"RATE_LIMIT_USER_SEARCH_PUBLIC",
		);
	}

	const url = new URL(request.url);
	const rawQ = url.searchParams.get("q") ?? "";
	const rawLimit = url.searchParams.get("limit");
	const limitNum = rawLimit !== null ? parseInt(rawLimit, 10) : NaN;
	const parsed = v.safeParse(UserSearchQuerySchema, {
		q: rawQ,
		...(Number.isFinite(limitNum) ? { limit: limitNum } : {}),
	});
	if (!parsed.success) {
		return errorResponse(
			`Invalid query: ${parsed.issues[0]?.message ?? "unknown"}`,
			400,
			cors,
			"VALIDATION_ERROR",
		);
	}
	const { q, limit = DEFAULT_LIMIT } = parsed.output;

	// "Still typing" floor — empty result, no audit row, so per-keystroke
	// calls below 2 chars neither churn the events table nor spend budget.
	if (q.length < 2) {
		return jsonResponse({ users: [] }, 200, cors);
	}

	// Audit row doubles as the rate-limit counter. Fire-and-forget, and the
	// metadata is the query's LENGTH only — never its text, which is a
	// person's name being looked up.
	env.EVENTS_DB.prepare(
		`INSERT INTO events (event_type, user_id, metadata)
		 VALUES ('user_search_public', ?, ?)`,
	)
		.bind(session.data.user_id, JSON.stringify({ q_length: q.length }))
		.run()
		.catch((e: unknown) => {
			logError("user_search_public_audit_failed", e, {
				user_id: session.data.user_id,
			});
		});

	// Scoped to users who made something public: a session-gated prefix index
	// over the whole users table would be enumeration with a rate limiter on
	// it, and the product rule is that people are discoverable through the
	// things they chose to publish. One EXISTS leg per such thing, each
	// seeking on a user_id index rather than scanning — idx_games_user (0002)
	// filtered down to is_public, idx_slots_user (0006), and
	// user_video_channels' (user_id, platform) PK (0031); verified with
	// EXPLAIN QUERY PLAN against representative row counts. The outer scan
	// over `users` is the same one handleUserSearch does, on the same "table
	// is small enough" reasoning. Issue #186 Part B adds a fourth disjunct —
	// `u.slug IS NOT NULL`, a claimed profile URL — once that column exists.
	//
	// Prefix match on the two name columns only (see difference 1 above); a
	// row can only match if one of them is non-null, so the resolved
	// display_name never needs its own NOT NULL guard. LOWER(...) matches the
	// already-lowercased `q`.
	const rows = await env.SHARE_DB.prepare(
		`SELECT u.user_id, u.discord_id, u.avatar_hash,
		        ${displayNameSql("u")} AS display_name
		 FROM users u
		 WHERE (LOWER(u.display_name) LIKE ? OR LOWER(u.alias) LIKE ?)
		   AND (
		        EXISTS (SELECT 1 FROM games g
		                 WHERE g.user_id = u.user_id AND g.is_public = TRUE)
		     OR EXISTS (SELECT 1 FROM tournament_slots s WHERE s.user_id = u.user_id)
		     OR EXISTS (SELECT 1 FROM user_video_channels c WHERE c.user_id = u.user_id)
		   )
		 ORDER BY display_name
		 LIMIT ?`,
	)
		.bind(q + "%", q + "%", limit)
		.all<PublicUserSearchRow>();

	return jsonResponse(
		{
			users: (rows.results ?? []).map((r) => ({
				user_id: r.user_id,
				display_name: r.display_name,
				avatar_url: buildAvatarUrl(r.discord_id, r.avatar_hash),
			})),
		},
		200,
		cors,
	);
}

// GET /v1/users/:user_id — public user profile.
//
// Returns identity fields the /users/[user_id] profile page needs to
// render its chrome (display name + avatar). No auth, no beta gate;
// 404 if the user doesn't exist.
export interface UserProfileEnv extends SessionEnv {
	SHARE_DB: QueryableD1;
	ALLOWED_ORIGINS: string;
}

interface UserProfileRow {
	user_id: string;
	discord_id: string;
	display_name: string;
	avatar_hash: string | null;
}

export async function handleUserProfile(
	userId: string,
	request: Request,
	env: UserProfileEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const row = await env.SHARE_DB.prepare(
		`SELECT user_id, discord_id, ${displayNameSql("users")} AS display_name, avatar_hash FROM users WHERE user_id = ?`,
	)
		.bind(userId)
		.first<UserProfileRow>();

	if (!row) {
		return errorResponse("User not found", 404, cors, "NOT_FOUND");
	}

	// All-time profile summary for the profile-header card. Deliberately
	// over ALL the user's saves (no collection / game-type scope) — the
	// header sits above the scope selector and shouldn't move with it.
	// Visibility-scoped only: owner sees private+public, others public-only.
	const session = await sessionFromRequest(env, request);
	const vis = session?.data.user_id === userId ? "" : " AND is_public = 1";
	const [countsRow, nationRow, dayRow, channelsRes, participationRow] =
		await Promise.all([
			env.SHARE_DB.prepare(
				`SELECT COUNT(*) AS total,
				        CAST(SUM(CASE WHEN user_won = 1 THEN 1 ELSE 0 END) AS REAL)
				          / NULLIF(SUM(CASE WHEN user_won IS NOT NULL THEN 1 ELSE 0 END), 0)
				          AS win_rate
				 FROM games WHERE user_id = ?${vis}`,
			)
				.bind(userId)
				.first<{ total: number; win_rate: number | null }>(),
			env.SHARE_DB.prepare(
				`SELECT user_nation FROM games
				 WHERE user_id = ? AND user_nation IS NOT NULL${vis}
				 GROUP BY user_nation
				 ORDER BY COUNT(*) DESC, user_nation ASC
				 LIMIT 1`,
			)
				.bind(userId)
				.first<{ user_nation: string }>(),
			env.SHARE_DB.prepare(
				`SELECT CAST(strftime('%w', save_date) AS INTEGER) AS weekday
				 FROM games WHERE user_id = ? AND save_date IS NOT NULL${vis}
				 GROUP BY weekday
				 ORDER BY COUNT(*) DESC, weekday ASC
				 LIMIT 1`,
			)
				.bind(userId)
				.first<{ weekday: number | null }>(),
			// Linked video/stream channels — public, so the profile page can decide
			// whether to render the "Videos" tab without a second request. Videos
			// themselves load lazily via GET /v1/users/:id/videos when that tab opens.
			env.SHARE_DB.prepare(
				`SELECT platform, channel_url FROM user_video_channels
				 WHERE user_id = ? ORDER BY platform`,
			)
				.bind(userId)
				.all<{ platform: string; channel_url: string }>(),
			// Does this user appear in tournaments at all — same "render the tab?"
			// role `channels` plays for Videos, with the payload itself loading
			// lazily via GET /v1/users/:id/tournaments when the tab opens.
			//
			// "Has an attributable match OR has cast": exactly the two sections that
			// endpoint returns, so the flag can't disagree with the payload in either
			// direction. Holding a slot is deliberately NOT the test — it's neither
			// sufficient (a seat before round one, or one whose only match was a bye,
			// renders nothing) nor necessary (a substituted-out player holds no slot
			// yet keeps every match they played, via the report-time snapshot). The
			// match half reuses USER_MATCHES_WHERE for that reason: one rule, so a
			// later change to attribution can't leave the tab reachable-but-empty or
			// hidden-but-populated.
			//
			// Two EXISTS, five index-backed legs, no table scan (verified with
			// EXPLAIN QUERY PLAN): idx_matches_slot_a/b_user (0035) for the snapshot
			// halves, idx_slots_user (0006) + idx_matches_slot_a/b (0006) for the live
			// halves, idx_match_casters_user (0034) for the cast. The four attribution
			// legs materialize as a UNION temp b-tree rather than short-circuiting,
			// which the outer EXISTS then probes through the matches PK — bounded by
			// one player's match count, so the cost is the id list, not a scan. The
			// cast half is why that join table exists — the
			// equivalent question against the `parts` blob is a nested json_each
			// fan-out with no possible index, and it would run on every profile view
			// WITHOUT a slot, which is most of them. A rate limit is deliberately NOT
			// the answer here: it would add an `events` INSERT to the site's hottest
			// public read (and newly 429 an endpoint every SSR page load hits) to
			// avoid indexed reads.
			env.SHARE_DB.prepare(
				`SELECT EXISTS (
				          SELECT 1 FROM tournament_matches m WHERE ${USER_MATCHES_WHERE})
				     OR EXISTS (SELECT 1 FROM tournament_match_casters WHERE user_id = ?)
				        AS participates`,
			)
				.bind(userId, userId, userId, userId, userId)
				.first<{ participates: number }>(),
		]);

	return jsonResponse(
		{
			user_id: row.user_id,
			display_name: row.display_name,
			avatar_url: buildAvatarUrl(row.discord_id, row.avatar_hash),
			summary: {
				total_games: countsRow?.total ?? 0,
				win_rate: countsRow?.win_rate ?? null,
				favorite_nation: nationRow?.user_nation ?? null,
				favorite_day_of_week: dayRow?.weekday ?? null,
			},
			channels: channelsRes.results ?? [],
			tournament_participant: (participationRow?.participates ?? 0) === 1,
		},
		200,
		cors,
	);
}
