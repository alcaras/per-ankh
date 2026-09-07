// GET /v1/stats/players — the public played-games leaderboard.
//
// The endpoint's whole point is attribution beyond the uploader: one upload
// credits every human seat that maps to a registered user (uploader via the
// is_uploader seat, everyone else via player_summaries.online_id matched
// against user_online_ids), with double-uploaded matches deduped on
// xml_game_id. These tests pin that attribution, the category split, the
// since/until window (until exclusive), the short cache TTL every window
// shares, the season_view gate, and the PII stance: linking online ids must
// never appear in the response.
//
// They also pin the visibility rule the board shares with every other public
// reader (users.ts, stats/resolve.ts): a save its owner kept private reaches
// no public counter, down neither credit path. Windows are caller-supplied to
// the day, so a counter that moved would be an activity log for a game its
// owner never published.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { SEASON_VIEW_PER_HOUR } from "../../../src/stats/handlers";
import { expectErrorCode } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface Seat {
	online_id?: string;
	is_human?: boolean;
	is_uploader?: boolean;
}

// Direct INSERT, same rationale as helpers/games.ts seedGame: the endpoint
// reads only D1, and driving the real upload path would need a parsed save.
async function seedPlayedGame(opts: {
	uploader: TestUser;
	xmlGameId?: string;
	gameMode?: string | null;
	createdAt?: string; // ISO date; defaults to now
	// Defaults to public, matching the upload default
	// (games.ts: pref?.default_game_public !== 0). Set false to seed a save
	// its owner kept private.
	isPublic?: boolean;
	seats: Seat[];
}): Promise<string> {
	const gameId = nanoid(21);
	await env.SHARE_DB.prepare(
		`INSERT INTO games (
			game_id, user_id, xml_game_id, total_turns, file_hash,
			game_name, is_public, blob_version, blob_size_bytes, parser_version,
			game_mode, created_at
		) VALUES (?, ?, ?, 50, ?, 'Leaderboard Game', ?, 2, 1024, '1.0.0', ?,
		          COALESCE(?, datetime('now')))`,
	)
		.bind(
			gameId,
			opts.uploader.userId,
			opts.xmlGameId ?? nanoid(36),
			nanoid(64),
			(opts.isPublic ?? true) ? 1 : 0,
			opts.gameMode ?? null,
			opts.createdAt ?? null,
		)
		.run();
	for (const [i, seat] of opts.seats.entries()) {
		await env.SHARE_DB.prepare(
			`INSERT INTO player_summaries (
				game_id, player_index, player_name, is_human, is_uploader, online_id
			) VALUES (?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				gameId,
				i,
				`Player ${i}`,
				(seat.is_human ?? true) ? 1 : 0,
				(seat.is_uploader ?? false) ? 1 : 0,
				seat.online_id ?? null,
			)
			.run();
	}
	return gameId;
}

async function linkOnlineId(user: TestUser, onlineId: string): Promise<void> {
	await env.SHARE_DB.prepare(
		`INSERT INTO user_online_ids (user_id, online_id) VALUES (?, ?)`,
	)
		.bind(user.userId, onlineId)
		.run();
}

// Per-IP requests, same shape as anon-read-rate-limit.test.ts: requests.ts
// omits CF-Connecting-IP unless CF-RAY is present, so per-IP tests build
// headers themselves.
function get(
	query: string,
	opts?: { ip?: string; ua?: string },
): Promise<Response> {
	const headers: Record<string, string> = {
		Origin: "http://localhost:1420",
		"CF-Connecting-IP": opts?.ip ?? `10.9.${nanoid(4)}`,
		"CF-RAY": "test-ray",
	};
	if (opts?.ua) headers["User-Agent"] = opts.ua;
	return SELF.fetch(`http://test/v1/stats/players${query}`, { headers });
}

interface LeaderboardBody {
	players: {
		user_id: string;
		display_name: string;
		duels_network: number;
		duels_cloud: number;
		ffas: number;
		total: number;
	}[];
}

function rowFor(body: LeaderboardBody, user: TestUser) {
	return body.players.find((p) => p.user_id === user.userId);
}

describe("GET /v1/stats/players", () => {
	it("credits the uploader's seat and online_id-matched seats, once per match", async () => {
		const uploader = await makeUser();
		const opponent = await makeUser();
		const onlineId = `STEAM_${nanoid(12)}`;
		await linkOnlineId(opponent, onlineId);

		const xmlGameId = nanoid(36);
		// Both players upload the same network duel — separate games rows,
		// same save GameId.
		for (const user of [uploader, opponent]) {
			await seedPlayedGame({
				uploader: user,
				xmlGameId,
				gameMode: "NETWORK",
				seats: [
					{ is_uploader: user === uploader },
					{ online_id: onlineId, is_uploader: user === opponent },
				],
			});
		}

		const res = await get("");
		expect(res.status).toBe(200);
		const body = (await res.json()) as LeaderboardBody;
		for (const user of [uploader, opponent]) {
			const row = rowFor(body, user);
			expect(row).toBeDefined();
			expect(row!.duels_network).toBe(1);
			expect(row!.total).toBe(1);
		}
		// The uploader has no linked online id and the opponent's is linking
		// data only — neither may surface anywhere in the response.
		expect(JSON.stringify(body)).not.toContain(onlineId);
	});

	it("splits duels by game mode and counts 3+ humans as FFAs", async () => {
		const user = await makeUser();
		await seedPlayedGame({
			uploader: user,
			gameMode: "PLAY_BY_CLOUD",
			seats: [{ is_uploader: true }, {}],
		});
		await seedPlayedGame({
			uploader: user,
			gameMode: "NETWORK",
			seats: [{ is_uploader: true }, {}, {}],
		});
		// Single-player: one human seat, AI opponents — total only.
		await seedPlayedGame({
			uploader: user,
			gameMode: null,
			seats: [{ is_uploader: true }, { is_human: false }],
		});

		const body = (await (await get("")).json()) as LeaderboardBody;
		const row = rowFor(body, user)!;
		expect(row.duels_cloud).toBe(1);
		expect(row.ffas).toBe(1);
		expect(row.duels_network).toBe(0);
		expect(row.total).toBe(3);
	});

	it("counts zero, not null, when no match has a recorded game mode", async () => {
		const user = await makeUser();
		// game_mode is nullable and `x AND NULL` is NULL, so a bare
		// SUM(<predicate>) over only these rows returns NULL for both duel
		// columns — a null where the response promises a number.
		await seedPlayedGame({
			uploader: user,
			gameMode: null,
			seats: [{ is_uploader: true }, {}],
		});

		const body = (await (await get("")).json()) as LeaderboardBody;
		const row = rowFor(body, user)!;
		expect(row.duels_network).toBe(0);
		expect(row.duels_cloud).toBe(0);
		expect(row.ffas).toBe(0);
		expect(row.total).toBe(1);
	});

	it("ignores unregistered online ids and AI seats", async () => {
		const uploader = await makeUser();
		await seedPlayedGame({
			uploader,
			gameMode: "NETWORK",
			seats: [
				{ is_uploader: true },
				{ online_id: `STEAM_${nanoid(12)}` }, // human, but not linked
				{ is_human: false, online_id: `STEAM_${nanoid(12)}` },
			],
		});

		const body = (await (await get("")).json()) as LeaderboardBody;
		expect(rowFor(body, uploader)!.total).toBe(1);
	});

	it("credits nobody through an online id two users have linked", async () => {
		const host = await makeUser();
		const first = await makeUser();
		const second = await makeUser();
		// user_online_ids is many-to-many (0003) and links are captured from
		// whichever seat an uploader claimed, so one id can name two people
		// without either of them doing anything wrong.
		const sharedId = `STEAM_${nanoid(12)}`;
		await linkOnlineId(first, sharedId);
		await linkOnlineId(second, sharedId);

		await seedPlayedGame({
			uploader: host,
			gameMode: "NETWORK",
			seats: [{ is_uploader: true }, { online_id: sharedId }],
		});
		// The ambiguity costs neither of them their own upload — that credit
		// comes from the claimed seat, not from the contested id.
		await seedPlayedGame({
			uploader: second,
			gameMode: "NETWORK",
			seats: [{ is_uploader: true }, { online_id: sharedId }],
		});

		const body = (await (await get("")).json()) as LeaderboardBody;
		expect(rowFor(body, first)).toBeUndefined();
		expect(rowFor(body, second)!.total).toBe(1);
		expect(rowFor(body, host)!.total).toBe(1);
	});

	it("credits nobody for a private game, on either path", async () => {
		const uploader = await makeUser();
		const opponent = await makeUser();
		const onlineId = `STEAM_${nanoid(12)}`;
		await linkOnlineId(opponent, onlineId);

		await seedPlayedGame({
			uploader,
			gameMode: "NETWORK",
			isPublic: false,
			seats: [{ is_uploader: true }, { online_id: onlineId }],
		});

		const body = (await (await get("")).json()) as LeaderboardBody;
		// Absent, not zeroed — a private save is the only game either player
		// has here, so neither may appear at all. A row of zeroes would still
		// name an account whose every game is private.
		expect(rowFor(body, uploader)).toBeUndefined();
		expect(rowFor(body, opponent)).toBeUndefined();
	});

	it("counts a match once for both when only one side's upload is public", async () => {
		const uploader = await makeUser();
		const opponent = await makeUser();
		const onlineId = `STEAM_${nanoid(12)}`;
		await linkOnlineId(opponent, onlineId);

		// The same match uploaded by both, public on one side and private on
		// the other. One public upload makes the match public, and it is that
		// upload's seats that credit both players — so the private copy
		// neither adds a second credit nor withdraws the public one.
		const xmlGameId = nanoid(36);
		for (const user of [uploader, opponent]) {
			await seedPlayedGame({
				uploader: user,
				xmlGameId,
				gameMode: "NETWORK",
				isPublic: user === uploader,
				seats: [
					{ is_uploader: user === uploader },
					{ online_id: onlineId, is_uploader: user === opponent },
				],
			});
		}

		const body = (await (await get("")).json()) as LeaderboardBody;
		for (const user of [uploader, opponent]) {
			const row = rowFor(body, user);
			expect(row).toBeDefined();
			expect(row!.duels_network).toBe(1);
			expect(row!.total).toBe(1);
		}
	});

	it("windows on created_at with until exclusive, and 400s malformed dates", async () => {
		const user = await makeUser();
		await seedPlayedGame({
			uploader: user,
			gameMode: "NETWORK",
			createdAt: "2020-06-15 12:00:00",
			seats: [{ is_uploader: true }, {}],
		});
		await seedPlayedGame({
			uploader: user,
			gameMode: "NETWORK",
			createdAt: "2020-09-01 00:00:00", // on the until boundary — excluded
			seats: [{ is_uploader: true }, {}],
		});

		const windowed = (await (
			await get("?since=2020-06-01&until=2020-09-01")
		).json()) as LeaderboardBody;
		expect(rowFor(windowed, user)!.total).toBe(1);

		const bad = await get("?since=June-2020");
		await expectErrorCode(bad, { status: 400, code: "INVALID_QUERY" });
	});

	it("caches every window briefly, a closed season included", async () => {
		// A finished season's board still moves — a visibility toggle, a newly
		// linked online id, the reindex backfill, a deleted game — and nothing
		// can recall a response once served, so a closed window gets the same
		// short TTL an open one does rather than a day-long promise.
		for (const window of ["?since=2020-06-01&until=2020-09-01", ""]) {
			const res = await get(window);
			expect(res.headers.get("Cache-Control")).toBe(
				"public, max-age=300, s-maxage=60",
			);
		}
	});

	it("429s a read once the per-IP season_view cap is reached", async () => {
		const ip = `10.8.${nanoid(6)}`;
		// Same single-statement bucket fill as anon-read-rate-limit.test.ts.
		// Its own budget, so filling anon_read would not reach this gate — the
		// bucket the page spends is the one this fills.
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, ip_address)
			 WITH RECURSIVE seq(i) AS (
			   SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?
			 )
			 SELECT 'season_view', ? FROM seq`,
		)
			.bind(SEASON_VIEW_PER_HOUR, ip)
			.run();

		const limited = await get("", { ip });
		await expectErrorCode(limited, { status: 429, code: "RATE_LIMIT_SEASON" });

		// Scraper UAs stay exempt.
		const scraper = await get("", { ip, ua: "Discordbot/2.0" });
		expect(scraper.status).toBe(200);
	});
});
