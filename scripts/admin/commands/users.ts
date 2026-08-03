// `./per-ankh admin users` — list users (recent login first by default).
// `./per-ankh admin user <id>` — full detail for one user.
// `./per-ankh admin find-user <query>` — search users by handle / display name
//   / slug / email, with their tournament-slot involvement.
// `./per-ankh admin set-slug|clear-slug <id>` — operator control over the
//   profile URL a user is otherwise handed at signup and free to rename.
// `./per-ankh admin backfill-slugs [--dry-run]` — hand one to the accounts
//   that predate derivation.

import { d1Batch, d1Exec, d1Query, sqlStr } from "../wrangler";
// The profile-URL rule and slugifier, shared with the Worker rather than
// restated here — see cloud/src/schemas/user-slug.ts for why it's a module of
// its own. cloud/ is a CJS package (no "type":"module") while scripts/ runs as
// ESM, so its named exports surface only through the default-interop object.
import userSlugRule from "../../../cloud/src/schemas/user-slug";
import { confirmYesNo } from "../../lib/confirm";
import {
	bold,
	type Column,
	dim,
	emdash,
	formatBytes,
	formatDate,
	info,
	ok,
	printCount,
	printDetail,
	printTable,
	trunc,
} from "../../lib/format";
import {
	type CommandOpts,
	flagInt,
	flagString,
	parseFlags,
	printJson,
} from "../../lib/cli";

const { normalizeUserSlug, slugifyDisplayName, userSlugError } = userSlugRule;

interface UserListRow {
	user_id: string;
	display_name: string;
	discord_id: string;
	email: string | null;
	created_at: string;
	last_login_at: string;
	game_count: number;
	last_upload: string | null;
}

interface UserRow {
	user_id: string;
	display_name: string;
	alias: string | null;
	slug: string | null;
	discord_id: string;
	avatar_hash: string | null;
	email: string | null;
	email_verified: number | null;
	created_at: string;
	last_login_at: string;
}

interface CollectionRow {
	collection_id: number;
	name: string;
	is_default: number;
}

interface OnlineIdRow {
	online_id: string;
	first_seen_at: string;
	last_seen_at: string;
}

interface ChannelDetailRow {
	platform: string;
	channel_url: string;
	channel_id: string;
	updated_at: string;
}

interface RecentGameRow {
	game_id: string;
	game_name: string | null;
	user_nation: string | null;
	total_turns: number;
	blob_size_bytes: number | null;
	created_at: string;
}

interface RecentEventRow {
	event_type: string;
	game_id: string | null;
	share_id: string | null;
	ip_address: string | null;
	created_at: string;
}

interface UserMatchRow {
	user_id: string;
	discord_username: string | null;
	display_name: string;
	alias: string | null;
	slug: string | null;
	discord_id: string;
	email: string | null;
	created_at: string;
	last_login_at: string;
	game_count: number;
}

interface SlotMatchRow {
	slot_id: string;
	tournament_id: string;
	slug: string;
	tournament_name: string;
	tournament_status: string;
	phase: string;
	division: string | null;
	swiss_seed: number | null;
	championship_seed: number | null;
	discord_username: string | null;
	discord_id: string | null;
	user_id: string | null;
}

const SORT_CLAUSES: Record<string, string> = {
	recent: "u.last_login_at DESC",
	uploads: "game_count DESC, u.last_login_at DESC",
	created: "u.created_at DESC",
};

export async function runList(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { flags } = parseFlags(argv);
	const limit = flagInt(flags, "limit", 50);
	const sortKey = flagString(flags, "sort") ?? "recent";
	const orderBy = SORT_CLAUSES[sortKey];
	if (!orderBy) {
		throw new Error(
			`unknown --sort value: ${sortKey} (expected one of: recent, uploads, created)`,
		);
	}

	info(`Listing users (sort=${sortKey}, limit=${limit})...`);
	const sql = `
		SELECT
		  u.user_id, u.display_name, u.discord_id, u.email,
		  u.created_at, u.last_login_at,
		  (SELECT COUNT(*)  FROM games g WHERE g.user_id = u.user_id) AS game_count,
		  (SELECT MAX(created_at) FROM games g WHERE g.user_id = u.user_id) AS last_upload
		FROM users u
		ORDER BY ${orderBy}
		LIMIT ${limit}
	`;
	const rows = await d1Query<UserListRow>(sql);

	if (opts.json) {
		printJson(rows);
		return;
	}
	if (rows.length === 0) {
		process.stderr.write("No users found.\n");
		return;
	}

	const cols: Column[] = [
		{ header: "USER_ID", width: 22 },
		{ header: "NAME", width: 22 },
		{ header: "GAMES", width: 5, align: "right" },
		{ header: "LAST UPLOAD", width: 16 },
		{ header: "LAST LOGIN", width: 16 },
		{ header: "CREATED", width: 16 },
	];
	printTable(
		cols,
		rows.map((r) => [
			r.user_id,
			emdash(r.display_name),
			String(r.game_count),
			formatDate(r.last_upload),
			formatDate(r.last_login_at),
			formatDate(r.created_at),
		]),
	);
	printCount(rows.length, "users shown");
}

export async function runDetail(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	if (!userId) {
		throw new Error("Usage: ./per-ankh admin user <user_id>");
	}

	info(`Loading user ${userId}...`);
	const idStr = sqlStr(userId);
	const batch = await d1Batch([
		`SELECT * FROM users WHERE user_id = ${idStr}`,
		`SELECT collection_id, name, is_default FROM collections WHERE user_id = ${idStr} ORDER BY collection_id`,
		`SELECT online_id, first_seen_at, last_seen_at FROM user_online_ids
		 WHERE user_id = ${idStr} ORDER BY last_seen_at DESC`,
		`SELECT game_id, game_name, user_nation, total_turns, blob_size_bytes, created_at
		 FROM games WHERE user_id = ${idStr} ORDER BY created_at DESC LIMIT 10`,
		`SELECT event_type, game_id, share_id, ip_address, created_at
		 FROM events WHERE user_id = ${idStr} ORDER BY created_at DESC LIMIT 10`,
		`SELECT COUNT(*) AS cnt FROM games WHERE user_id = ${idStr}`,
		`SELECT platform, channel_url, channel_id, updated_at FROM user_video_channels
		 WHERE user_id = ${idStr} ORDER BY platform`,
	]);
	const [
		userRows,
		collectionRows,
		onlineIdRows,
		gameRows,
		eventRows,
		gameCountRows,
		channelRows,
	] = [
		batch[0] as UserRow[],
		batch[1] as CollectionRow[],
		batch[2] as OnlineIdRow[],
		batch[3] as RecentGameRow[],
		batch[4] as RecentEventRow[],
		batch[5] as { cnt: number }[],
		batch[6] as ChannelDetailRow[],
	];
	const totalGames = gameCountRows[0]?.cnt ?? 0;
	const user = userRows[0];
	if (!user) {
		throw new Error(`User not found: ${userId}`);
	}

	if (opts.json) {
		printJson({
			user,
			collections: collectionRows,
			online_ids: onlineIdRows,
			channels: channelRows,
			recent_games: gameRows,
			recent_events: eventRows,
		});
		return;
	}

	printDetail("User", [
		["User ID", user.user_id],
		["Display name", emdash(user.display_name)],
		["Alias", emdash(user.alias)],
		["Slug", user.slug ? `/u/${user.slug}` : emdash(user.slug)],
		["Discord ID", user.discord_id],
		["Email", emdash(user.email)],
		["Email verified", user.email_verified ? "yes" : "no"],
		["Created", formatDate(user.created_at)],
		["Last login", formatDate(user.last_login_at)],
		["Games", String(totalGames)],
		["Collections", String(collectionRows.length)],
		["Online IDs", String(onlineIdRows.length)],
		["Channels", String(channelRows.length)],
	]);

	if (collectionRows.length > 0) {
		printTable(
			[
				{ header: "COLLECTION_ID", width: 13, align: "right" },
				{ header: "NAME", width: 24 },
				{ header: "DEFAULT", width: 7 },
			],
			collectionRows.map((c) => [
				String(c.collection_id),
				c.name,
				c.is_default ? "yes" : "no",
			]),
		);
		process.stdout.write("\n");
	}

	if (onlineIdRows.length > 0) {
		printTable(
			[
				{ header: "ONLINE_ID", width: 24 },
				{ header: "FIRST SEEN", width: 16 },
				{ header: "LAST SEEN", width: 16 },
			],
			onlineIdRows.map((o) => [
				o.online_id,
				formatDate(o.first_seen_at),
				formatDate(o.last_seen_at),
			]),
		);
		process.stdout.write("\n");
	}

	if (channelRows.length > 0) {
		printTable(
			[
				{ header: "PLATFORM", width: 8 },
				{ header: "CHANNEL_ID", width: 26 },
				{ header: "CHANNEL_URL", width: 34 },
				{ header: "UPDATED", width: 16 },
			],
			channelRows.map((c) => [
				c.platform,
				c.channel_id,
				c.channel_url,
				formatDate(c.updated_at),
			]),
		);
		process.stdout.write("\n");
	}

	if (gameRows.length > 0) {
		printTable(
			[
				{ header: "GAME_ID", width: 22 },
				{ header: "NAME", width: 22 },
				{ header: "NATION", width: 16 },
				{ header: "TURNS", width: 5, align: "right" },
				{ header: "SIZE", width: 8, align: "right" },
				{ header: "CREATED", width: 16 },
			],
			gameRows.map((g) => [
				g.game_id,
				emdash(g.game_name),
				emdash(g.user_nation),
				String(g.total_turns),
				formatBytes(g.blob_size_bytes),
				formatDate(g.created_at),
			]),
		);
		process.stdout.write("\n");
	}

	if (eventRows.length > 0) {
		printTable(
			[
				{ header: "TYPE", width: 18 },
				{ header: "GAME/SHARE", width: 22 },
				{ header: "IP", width: 16 },
				{ header: "TIME", width: 16 },
			],
			eventRows.map((e) => [
				e.event_type,
				emdash(e.game_id ?? e.share_id),
				emdash(e.ip_address),
				formatDate(e.created_at),
			]),
		);
	}
}

export async function runFind(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional, flags } = parseFlags(argv);
	const query = positional[0];
	if (!query) {
		throw new Error(
			"Usage: ./per-ankh admin find-user <query>  (matches discord handle, display name, profile slug, or email)",
		);
	}
	const limit = flagInt(flags, "limit", 25);

	info(`Searching users matching "${query}"...`);

	// Case-insensitive substring match. discord_username and slug are stored
	// lowercase (auth.ts / the claim endpoint), display_name/email are
	// mixed-case, so we lower() both sides throughout.
	// Any `%` / `_` in the query stay live wildcards — useful for operators.
	const like = sqlStr(`%${query.toLowerCase()}%`);
	const userPredicate =
		`lower(u.discord_username) LIKE ${like} ` +
		`OR lower(u.display_name) LIKE ${like} ` +
		`OR lower(u.alias) LIKE ${like} ` +
		`OR lower(u.slug) LIKE ${like} ` +
		`OR lower(u.email) LIKE ${like}`;

	const batch = await d1Batch([
		`SELECT
		   u.user_id, u.discord_username, u.display_name, u.alias, u.slug,
		   u.discord_id, u.email,
		   u.created_at, u.last_login_at,
		   (SELECT COUNT(*) FROM games g WHERE g.user_id = u.user_id) AS game_count
		 FROM users u
		 WHERE ${userPredicate}
		 ORDER BY u.last_login_at DESC
		 LIMIT ${limit}`,
		// Slots matched by handle text catch admin-prefilled, still-unclaimed
		// slots that have no users row yet; the user_id IN (...) arm also
		// catches slots claimed by a user we matched on display name or email.
		`SELECT
		   s.slot_id, s.tournament_id, t.slug, t.name AS tournament_name,
		   t.status AS tournament_status, s.phase, s.division,
		   s.swiss_seed, s.championship_seed,
		   s.discord_username, s.discord_id, s.user_id
		 FROM tournament_slots s
		 JOIN tournaments t ON t.tournament_id = s.tournament_id
		 WHERE lower(s.discord_username) LIKE ${like}
		    OR s.user_id IN (SELECT u.user_id FROM users u WHERE ${userPredicate})
		 ORDER BY t.slug, s.phase, s.division, s.swiss_seed
		 LIMIT ${limit}`,
	]);
	const users = batch[0] as UserMatchRow[];
	const slots = batch[1] as SlotMatchRow[];

	if (opts.json) {
		printJson({ users, slots });
		return;
	}

	if (users.length === 0 && slots.length === 0) {
		process.stderr.write(`No users or slots match "${query}".\n`);
		return;
	}

	if (users.length > 0) {
		process.stdout.write(`\n${bold("Matching users")}\n`);
		printTable(
			[
				{ header: "USER_ID", width: 22 },
				{ header: "HANDLE", width: 20 },
				{ header: "NAME", width: 18 },
				{ header: "ALIAS", width: 16 },
				{ header: "SLUG", width: 16 },
				{ header: "EMAIL", width: 26 },
				{ header: "GAMES", width: 5, align: "right" },
				{ header: "LAST LOGIN", width: 16 },
			],
			users.map((u) => [
				u.user_id,
				emdash(u.discord_username),
				emdash(u.display_name),
				emdash(u.alias),
				emdash(u.slug),
				emdash(u.email),
				String(u.game_count),
				formatDate(u.last_login_at),
			]),
		);
		printCount(users.length, "users matched");
	} else {
		process.stdout.write(`\n${dim("No matching user accounts.")}\n`);
	}

	if (slots.length > 0) {
		process.stdout.write(`\n${bold("Tournament slots")}\n`);
		printTable(
			[
				{ header: "SLOT_ID", width: 22 },
				{ header: "TOURNAMENT", width: 24 },
				{ header: "STATUS", width: 12 },
				{ header: "PHASE", width: 12 },
				{ header: "DIV", width: 3 },
				{ header: "SEED", width: 5, align: "right" },
				{ header: "HANDLE", width: 16 },
				{ header: "CLAIMED", width: 7 },
			],
			slots.map((s) => [
				s.slot_id,
				emdash(s.slug),
				s.tournament_status,
				s.phase,
				emdash(s.division),
				s.swiss_seed != null
					? String(s.swiss_seed)
					: s.championship_seed != null
						? String(s.championship_seed)
						: "—",
				emdash(s.discord_username),
				s.user_id ? "yes" : "no",
			]),
		);
		printCount(slots.length, "slots matched");
	}
}

// Cap matches the migration's intent (a display label, not free text) and
// keeps the alias from blowing out table layouts wherever it's rendered.
const MAX_ALIAS_LEN = 64;

interface AliasUserRow {
	user_id: string;
	display_name: string;
	alias: string | null;
}

// `./per-ankh admin set-alias <user_id> <alias>` — set an operator display
// alias that overrides the Discord display_name everywhere the app renders
// this account (resolved server-side via COALESCE; see cloud/src/identity.ts).
export async function runSetAlias(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	const rawAlias = positional[1];
	if (!userId || rawAlias === undefined) {
		throw new Error("Usage: ./per-ankh admin set-alias <user_id> <alias>");
	}
	const alias = rawAlias.trim();
	if (alias.length === 0) {
		throw new Error("Alias is empty (use clear-alias to remove an alias).");
	}
	if (alias.length > MAX_ALIAS_LEN) {
		throw new Error(
			`Alias too long (${alias.length} > ${MAX_ALIAS_LEN} chars).`,
		);
	}
	for (const ch of alias) {
		const code = ch.charCodeAt(0);
		if (code < 0x20 || code === 0x7f) {
			throw new Error("Alias contains control characters.");
		}
	}

	const rows = await d1Query<AliasUserRow>(
		`SELECT user_id, display_name, alias FROM users WHERE user_id = ${sqlStr(userId)}`,
	);
	const user = rows[0];
	if (!user) {
		throw new Error(`User not found: ${userId}`);
	}

	await d1Exec(
		`UPDATE users SET alias = ${sqlStr(alias)} WHERE user_id = ${sqlStr(userId)}`,
	);

	if (opts.json) {
		printJson({
			user_id: userId,
			display_name: user.display_name,
			alias,
			previous_alias: user.alias,
		});
		return;
	}
	ok(
		`Alias set: ${user.display_name} (${userId}) → "${alias}"` +
			(user.alias ? ` (was "${user.alias}")` : ""),
	);
}

// `./per-ankh admin clear-alias <user_id>` — drop the operator alias, reverting
// the account to its Discord display_name everywhere.
export async function runClearAlias(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	if (!userId) {
		throw new Error("Usage: ./per-ankh admin clear-alias <user_id>");
	}

	const rows = await d1Query<AliasUserRow>(
		`SELECT user_id, display_name, alias FROM users WHERE user_id = ${sqlStr(userId)}`,
	);
	const user = rows[0];
	if (!user) {
		throw new Error(`User not found: ${userId}`);
	}
	if (user.alias === null) {
		info(`User ${user.display_name} (${userId}) has no alias set.`);
		return;
	}

	await d1Exec(
		`UPDATE users SET alias = NULL WHERE user_id = ${sqlStr(userId)}`,
	);

	if (opts.json) {
		printJson({
			user_id: userId,
			display_name: user.display_name,
			alias: null,
			previous_alias: user.alias,
		});
		return;
	}
	ok(`Alias cleared: ${user.display_name} (${userId}) (was "${user.alias}")`);
}

interface SlugUserRow {
	user_id: string;
	display_name: string;
	slug: string | null;
}

// `./per-ankh admin set-slug <user_id> <slug>` — set the profile URL
// (per-ankh.app/u/<slug>) a user would otherwise set for themselves via
// POST /v1/users/me/slug. Users can now rename, so this is no longer the only
// way a mistaken name gets replaced; what it's for is the name a user must not
// keep (impersonation, abuse) and the one they can't fix themselves because
// they're inside the rename cooldown.
//
// It applies the endpoint's rule unchanged — the reserved list is an
// impersonation control, and an operator minting a name past it defeats the
// control — but it deliberately does NOT touch slug_changed_at: the cooldown
// clock belongs to the user's own changes, so an operator fix neither spends
// their week nor grants them a fresh one.
export async function runSetSlug(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	const rawSlug = positional[1];
	if (!userId || rawSlug === undefined) {
		throw new Error("Usage: ./per-ankh admin set-slug <user_id> <slug>");
	}
	const slug = normalizeUserSlug(rawSlug);
	const problem = userSlugError(slug);
	if (problem) {
		throw new Error(`${problem}.`);
	}

	// Who the operator named, and who (if anyone) holds the name already —
	// the unique index would reject the collision, but with a D1 constraint
	// error instead of the holder's identity.
	const batch = await d1Batch([
		`SELECT user_id, display_name, slug FROM users WHERE user_id = ${sqlStr(userId)}`,
		`SELECT user_id, display_name, slug FROM users WHERE slug = ${sqlStr(slug)}`,
	]);
	const user = (batch[0] as SlugUserRow[])[0];
	const holder = (batch[1] as SlugUserRow[])[0];
	if (!user) {
		throw new Error(`User not found: ${userId}`);
	}
	if (holder && holder.user_id !== userId) {
		throw new Error(
			`Profile URL /u/${slug} is taken by ${holder.display_name} (${holder.user_id}).`,
		);
	}
	if (user.slug === slug) {
		info(`User ${user.display_name} (${userId}) already has /u/${slug}.`);
		return;
	}

	await d1Exec(
		`UPDATE users SET slug = ${sqlStr(slug)} WHERE user_id = ${sqlStr(userId)}`,
	);

	if (opts.json) {
		printJson({
			user_id: userId,
			display_name: user.display_name,
			slug,
			previous_slug: user.slug,
		});
		return;
	}
	ok(`Profile URL set: ${user.display_name} (${userId}) → /u/${slug}`);
	if (user.slug) {
		info(`/u/${user.slug} now 404s and is free for anyone to claim.`);
	}
}

// `./per-ankh admin clear-slug <user_id>` — release the profile URL, leaving
// the user at their permalink until they set another. Same shape as the user's
// own DELETE /v1/users/me/slug, minus the cooldown stamp (see set-slug above).
//
// No guard beyond "the row exists": clearing is allowed to break the old
// /u/<slug> link. The user's profile is permanently reachable at
// /users/<user_id> either way, and every internal link resolves through that
// permalink. What the operator does need told is the part they can't undo
// alone: the freed name is claimable by anyone, so releasing a recognizable one
// hands over the chance to be mistaken for its previous holder.
export async function runClearSlug(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	if (!userId) {
		throw new Error("Usage: ./per-ankh admin clear-slug <user_id>");
	}

	const rows = await d1Query<SlugUserRow>(
		`SELECT user_id, display_name, slug FROM users WHERE user_id = ${sqlStr(userId)}`,
	);
	const user = rows[0];
	if (!user) {
		throw new Error(`User not found: ${userId}`);
	}
	if (user.slug === null) {
		info(`User ${user.display_name} (${userId}) has no profile URL set.`);
		return;
	}

	await d1Exec(
		`UPDATE users SET slug = NULL WHERE user_id = ${sqlStr(userId)}`,
	);

	if (opts.json) {
		printJson({
			user_id: userId,
			display_name: user.display_name,
			slug: null,
			previous_slug: user.slug,
		});
		return;
	}
	ok(
		`Profile URL cleared: ${user.display_name} (${userId}) (was /u/${user.slug})`,
	);
	info(
		`/u/${user.slug} now 404s and is free for anyone to claim; the profile stays at /users/${userId}.`,
	);
}

// `./per-ankh admin backfill-slugs [--dry-run]` — give the accounts that
// predate derivation the profile URL a signup would hand them today.
//
// A command and not a migration, which is the whole reason this exists: SQLite
// has no regex, so the slugification in cloud/src/schemas/user-slug.ts can't be
// expressed in SQL at all. Running it here also means the backfill and the
// login path are the same function against the same reserved list, rather than
// a SQL transliteration that drifts from it.
//
// Assigns nothing it isn't sure of. A name that doesn't survive slugification
// and a name someone already holds are both skipped, reported, and left NULL —
// no numeric suffixes, no truncation, matching the login path exactly. Within
// one run the earliest account wins a contested name (ORDER BY created_at), so
// re-running is stable and the older account isn't demoted by a newer one.
//
// slug_changed_at stays NULL, like every other derived assignment: these names
// were issued, so the user's rename cooldown is untouched and their first
// correction is immediate.
interface SlugBackfillRow {
	user_id: string;
	display_name: string;
	created_at: string;
}

export async function runBackfillSlugs(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { flags } = parseFlags(argv);
	const dryRun = flags["dry-run"] !== undefined;

	// The effective display name, same COALESCE every public payload renders
	// (cloud/src/identity.ts) — an operator alias is the name the site shows, so
	// it's the name the URL derives from.
	const [candidatesRaw, takenRaw] = await d1Batch([
		`SELECT user_id, COALESCE(alias, display_name) AS display_name, created_at
		   FROM users WHERE slug IS NULL ORDER BY created_at`,
		`SELECT slug FROM users WHERE slug IS NOT NULL`,
	]);
	const candidates = candidatesRaw as SlugBackfillRow[];
	const taken = new Set((takenRaw as { slug: string }[]).map((r) => r.slug));

	const planned: { user_id: string; display_name: string; slug: string }[] = [];
	const skipped: { display_name: string; reason: string }[] = [];
	for (const row of candidates) {
		const slug = slugifyDisplayName(row.display_name);
		const problem = userSlugError(slug);
		if (problem) {
			skipped.push({
				display_name: row.display_name,
				// The rule's own message, which names the 3-30 rule or the reserved
				// list; "" for a name that stripped down to nothing reads as the
				// format complaint it is.
				reason: slug === "" ? "name has no usable characters" : problem,
			});
			continue;
		}
		if (taken.has(slug)) {
			skipped.push({
				display_name: row.display_name,
				reason: `/u/${slug} already taken`,
			});
			continue;
		}
		taken.add(slug);
		planned.push({
			user_id: row.user_id,
			display_name: row.display_name,
			slug,
		});
	}

	// The plan, before anything is written — which is the whole value of the
	// --dry-run flag and of printing it here: an operator sees every name that
	// is about to become a public URL, and every name that won't.
	//
	// Human output only. --json emits one object at the END of the run instead,
	// because the plan is not the outcome: the guards below can drop rows, so a
	// payload printed here would report names as published that never were.
	if (!opts.json) {
		printCount(
			candidates.length,
			candidates.length === 1
				? "user without a profile URL"
				: "users without a profile URL",
		);
		if (planned.length > 0) {
			printTable(
				[
					{ header: "USER", width: 28 },
					{ header: "SLUG", width: 32 },
					{ header: "USER_ID", width: 22 },
				],
				planned.map((p) => [
					trunc(p.display_name, 28),
					`/u/${p.slug}`,
					p.user_id,
				]),
			);
		}
		if (skipped.length > 0) {
			info(`Skipping ${skipped.length} (left at /users/<user_id>):`);
			for (const s of skipped) {
				info(`  ${trunc(s.display_name, 40)} — ${s.reason}`);
			}
		}
	}

	// Every early return reports `assigned: 0` rather than its own shape, so a
	// --json consumer reads one field to learn what landed and never has to
	// infer it from `dry_run` or from the presence of a plan.
	if (planned.length === 0) {
		if (opts.json)
			printJson({ dry_run: dryRun, planned, skipped, assigned: 0 });
		else info("Nothing to assign.");
		return;
	}
	if (dryRun) {
		if (opts.json) printJson({ dry_run: true, planned, skipped, assigned: 0 });
		else info("Dry run — nothing written. Drop --dry-run to apply.");
		return;
	}
	// Prompts go to stderr, so --json output stays clean and this stays a gate
	// in both modes — publishing a URL for every account on the site is not
	// something --json should quietly opt out of. --yes skips it as everywhere.
	if (!opts.yes) {
		const yes = await confirmYesNo(
			`About to publish ${planned.length} profile URL${planned.length === 1 ? "" : "s"}. Are you sure?`,
		);
		if (!yes) {
			if (opts.json)
				printJson({ dry_run: false, planned, skipped, assigned: 0 });
			else info("Cancelled.");
			return;
		}
	}

	// Both guards are the ones the login path uses, and they're here for the
	// same reason: this run's read is minutes stale by the time it writes, so a
	// user who logged in or renamed in between must win. `slug IS NULL` drops
	// anyone who has since acquired one; NOT EXISTS turns a name taken in the
	// meantime into a no-op instead of a UNIQUE violation that would abort the
	// rest of the chunk.
	//
	// Which is exactly why the chunk size can't be the count: those guards are
	// built to no-op, and d1Exec reports nothing back. Read the end state
	// instead — one query per chunk asking which of the pairs it just wrote
	// actually hold. That counts a row a concurrent login happened to give the
	// same derived name, which is right: the planned URL exists either way, and
	// what an operator needs to know is which names are now public.
	const CHUNK = 50;
	let assigned = 0;
	for (let i = 0; i < planned.length; i += CHUNK) {
		const chunk = planned.slice(i, i + CHUNK);
		await d1Exec(
			chunk
				.map(
					(p) =>
						`UPDATE users SET slug = ${sqlStr(p.slug)}
						  WHERE user_id = ${sqlStr(p.user_id)} AND slug IS NULL
						    AND NOT EXISTS (SELECT 1 FROM users WHERE slug = ${sqlStr(p.slug)})`,
				)
				.join("; "),
		);
		const [landed] = await d1Query<{ n: number }>(
			`SELECT COUNT(*) AS n FROM users WHERE ${chunk
				.map(
					(p) =>
						`(user_id = ${sqlStr(p.user_id)} AND slug = ${sqlStr(p.slug)})`,
				)
				.join(" OR ")}`,
		);
		assigned += landed?.n ?? 0;
		if (!opts.json && planned.length > CHUNK) {
			info(`  ${assigned}/${planned.length}...`);
		}
	}

	if (opts.json) {
		printJson({ dry_run: false, planned, skipped, assigned });
		return;
	}
	if (assigned === planned.length) {
		ok(`Assigned ${assigned} profile URL${assigned === 1 ? "" : "s"}.`);
		return;
	}
	ok(`Assigned ${assigned} of ${planned.length} planned profile URLs.`);
	info(
		`${planned.length - assigned} were claimed or renamed between this run's read and its write, and were left as they are.`,
	);
}
