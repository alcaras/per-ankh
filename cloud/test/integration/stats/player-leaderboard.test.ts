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
	// Defaults to false, matching the column's own default — a save uploaded
	// before the game ended has no winning seat at all, and five public cloud
	// duels in the corpus look like that.
	is_winner?: boolean;
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
				game_id, player_index, player_name, is_human, is_uploader, online_id,
				is_winner
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				gameId,
				i,
				`Player ${i}`,
				(seat.is_human ?? true) ? 1 : 0,
				(seat.is_uploader ?? false) ? 1 : 0,
				seat.online_id ?? null,
				(seat.is_winner ?? false) ? 1 : 0,
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
		slug: string | null;
		duels_network: number;
		duels_cloud: number;
		ffas: number;
		total: number;
		duels_network_at: string | null;
		duels_network_won: boolean;
		duels_cloud_at: string | null;
		duels_cloud_won: boolean;
		ffas_at: string | null;
		ffas_won: boolean;
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

	it("classifies a match by its non-local mode when two uploads disagree", async () => {
		const uploader = await makeUser();
		const opponent = await makeUser();
		const onlineId = `STEAM_${nanoid(12)}`;
		await linkOnlineId(opponent, onlineId);

		// One match, two uploads, two modes: each client reports the mode it
		// ran in, and seven public matches in the corpus look like this. The
		// network seat's reading wins — a match somebody played over the
		// network is a network match however the other seat sat down at it.
		const xmlGameId = nanoid(36);
		for (const [user, mode] of [
			[uploader, "HOTSEAT"],
			[opponent, "NETWORK"],
		] as const) {
			await seedPlayedGame({
				uploader: user,
				xmlGameId,
				gameMode: mode,
				seats: [
					{ is_uploader: user === uploader },
					{ online_id: onlineId, is_uploader: user === opponent },
				],
			});
		}

		const body = (await (await get("")).json()) as LeaderboardBody;
		for (const user of [uploader, opponent]) {
			const row = rowFor(body, user)!;
			expect(row.duels_network).toBe(1);
			// Not also counted as a local game: `other` is derived client-side
			// as total minus the counted categories, so a match that landed in
			// neither column would silently reappear there.
			expect(row.total).toBe(1);
		}
	});

	it("resolves two non-local modes network-first", async () => {
		const user = await makeUser();
		const xmlGameId = nanoid(36);
		// No match in the corpus reports both yet; the rule is pinned so the
		// first one that does is not settled by whichever row D1 returns.
		for (const mode of ["PLAY_BY_CLOUD", "NETWORK"]) {
			await seedPlayedGame({
				uploader: user,
				xmlGameId,
				gameMode: mode,
				seats: [{ is_uploader: true }, {}],
			});
		}

		const body = (await (await get("")).json()) as LeaderboardBody;
		const row = rowFor(body, user)!;
		expect(row.duels_network).toBe(1);
		expect(row.duels_cloud).toBe(0);
		expect(row.total).toBe(1);
	});

	it("returns the profile slug, and null for a user without one", async () => {
		// The board's rows link to /u/<slug>; without the field every link
		// would take the id permalink's 307 (profileHref, src/lib/utils).
		const slug = `player-${nanoid(8).toLowerCase()}`;
		const slugged = await makeUser({ slug });
		const unslugged = await makeUser();
		for (const uploader of [slugged, unslugged]) {
			await seedPlayedGame({
				uploader,
				gameMode: "NETWORK",
				seats: [{ is_uploader: true }, {}],
			});
		}

		const body = (await (await get("")).json()) as LeaderboardBody;
		expect(rowFor(body, slugged)!.slug).toBe(slug);
		expect(rowFor(body, unslugged)!.slug).toBeNull();
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

	// ── The crown tiebreak ──────────────────────────────────────────────
	//
	// /players crowns one player per format, so the field tied at the top —
	// most of the board at a season's start — has to be separated. These pin
	// the two values that do it: when a player reached their count, and how
	// the match that got them there went.

	it("reaches a count at its newest match, and reports that match's result", async () => {
		const user = await makeUser();
		// Won first, lost second: the count was reached at the loss, so the
		// row must carry the later timestamp and won=false. Reading the
		// player's *best* match instead of their latest would flip both.
		await seedPlayedGame({
			uploader: user,
			gameMode: "NETWORK",
			createdAt: "2026-09-02 10:00:00",
			seats: [{ is_uploader: true, is_winner: true }, {}],
		});
		await seedPlayedGame({
			uploader: user,
			gameMode: "NETWORK",
			createdAt: "2026-09-05 10:00:00",
			seats: [{ is_uploader: true }, { is_winner: true }],
		});

		const row = rowFor(
			(await (await get("")).json()) as LeaderboardBody,
			user,
		)!;
		expect(row.duels_network).toBe(2);
		expect(row.duels_network_at).toBe("2026-09-05 10:00:00");
		expect(row.duels_network_won).toBe(false);
		// A format with no games has nothing to break a tie with, and must
		// not borrow another format's match to do it.
		expect(row.duels_cloud_at).toBeNull();
		expect(row.duels_cloud_won).toBe(false);
		expect(row.ffas_at).toBeNull();
	});

	it("gives both sides of a head-to-head one timestamp and opposite results", async () => {
		// The tie the timestamp cannot break: two players reach the same
		// count in the same match, so only the result separates them.
		const winner = await makeUser();
		const loser = await makeUser();
		const onlineId = `STEAM_${nanoid(12)}`;
		await linkOnlineId(loser, onlineId);

		await seedPlayedGame({
			uploader: winner,
			gameMode: "NETWORK",
			createdAt: "2026-09-04 12:00:00",
			seats: [{ is_uploader: true, is_winner: true }, { online_id: onlineId }],
		});

		const body = (await (await get("")).json()) as LeaderboardBody;
		for (const user of [winner, loser]) {
			// Same match, so the same instant to the character — anything
			// else and the head-to-head rule would never come into play.
			expect(rowFor(body, user)!.duels_network_at).toBe("2026-09-04 12:00:00");
		}
		expect(rowFor(body, winner)!.duels_network_won).toBe(true);
		expect(rowFor(body, loser)!.duels_network_won).toBe(false);
	});

	it("times a double-uploaded match from the first upload, and still counts it once", async () => {
		// Both players upload the same match, days apart. The match happened
		// when it first landed, so both reach their count then — taking each
		// upload's own created_at would put the second player's crown claim
		// behind the first's by however long they took to upload.
		const uploader = await makeUser();
		const opponent = await makeUser();
		const onlineId = `STEAM_${nanoid(12)}`;
		await linkOnlineId(opponent, onlineId);

		const xmlGameId = nanoid(36);
		for (const [user, at] of [
			[uploader, "2026-09-03 08:00:00"],
			[opponent, "2026-09-09 08:00:00"],
		] as const) {
			await seedPlayedGame({
				uploader: user,
				xmlGameId,
				gameMode: "NETWORK",
				createdAt: at,
				seats: [
					{ is_uploader: user === uploader, is_winner: user === uploader },
					{
						online_id: onlineId,
						is_uploader: user === opponent,
						is_winner: user === opponent,
					},
				],
			});
		}

		const body = (await (await get("")).json()) as LeaderboardBody;
		for (const user of [uploader, opponent]) {
			const row = rowFor(body, user)!;
			expect(row.duels_network_at).toBe("2026-09-03 08:00:00");
			// The win flag rides the same dedupe as the count: carrying
			// is_winner through the UNION un-grouped would make the two
			// uploads two rows and count one match twice.
			expect(row.duels_network).toBe(1);
			expect(row.total).toBe(1);
		}
		expect(rowFor(body, uploader)!.duels_network_won).toBe(true);
		expect(rowFor(body, opponent)!.duels_network_won).toBe(true);
	});

	it("wins a match on any upload that records the win", async () => {
		// One save taken before the end and one after: the pre-end upload has
		// no winning seat, and reading it alone would say nobody won a match
		// somebody did.
		const user = await makeUser();
		const xmlGameId = nanoid(36);
		await seedPlayedGame({
			uploader: user,
			xmlGameId,
			gameMode: "NETWORK",
			createdAt: "2026-09-06 09:00:00",
			seats: [{ is_uploader: true }, {}],
		});
		await seedPlayedGame({
			uploader: user,
			xmlGameId,
			gameMode: "NETWORK",
			createdAt: "2026-09-06 11:00:00",
			seats: [{ is_uploader: true, is_winner: true }, {}],
		});

		const row = rowFor(
			(await (await get("")).json()) as LeaderboardBody,
			user,
		)!;
		expect(row.duels_network).toBe(1);
		expect(row.duels_network_won).toBe(true);
		expect(row.duels_network_at).toBe("2026-09-06 09:00:00");
	});

	it("orders a tied total on who reached it first, not alphabetically", async () => {
		// The board's rank is the row's position in this order, and the page
		// numbers rows 1, 2, 3 with nothing shared — so a tie the ORDER BY
		// leaves unbroken is a #1 nobody earned. Names are seeded in the
		// reverse of the expected order: alphabetical alone would invert it.
		const early = await makeUser({ displayName: "Zoe" });
		const late = await makeUser({ displayName: "Abe" });
		// A window of its own: every test in this file shares one database,
		// and the rest of them seed into today or the season around it.
		for (const [user, at] of [
			[early, "2027-03-02 09:00:00"],
			[late, "2027-03-08 09:00:00"],
		] as const) {
			await seedPlayedGame({
				uploader: user,
				gameMode: "NETWORK",
				createdAt: at,
				seats: [{ is_uploader: true }, {}],
			});
		}

		const body = (await (
			await get("?since=2027-03-01&until=2027-04-01")
		).json()) as LeaderboardBody;
		expect(body.players.map((p) => p.display_name)).toEqual(["Zoe", "Abe"]);
		expect(body.players[0].total).toBe(body.players[1].total);
	});

	it("orders a head-to-head tie on the winner, as a crown does", async () => {
		// Reaching the total in the same match gives both players the same
		// instant to the character, so only the result can separate them —
		// the step a crown has always had and the rank used to fall through,
		// which let one board seat the same two players in two orders. Names
		// are seeded in the reverse of the expected order: alphabetical alone
		// would invert it.
		const winner = await makeUser({ displayName: "Zeno" });
		const loser = await makeUser({ displayName: "Ajax" });
		const onlineId = `STEAM_${nanoid(12)}`;
		await linkOnlineId(loser, onlineId);

		// A window of its own, for the reason the test above seeds one.
		await seedPlayedGame({
			uploader: winner,
			gameMode: "NETWORK",
			createdAt: "2027-05-04 12:00:00",
			seats: [{ is_uploader: true, is_winner: true }, { online_id: onlineId }],
		});

		const body = (await (
			await get("?since=2027-05-01&until=2027-06-01")
		).json()) as LeaderboardBody;
		expect(body.players.map((p) => p.display_name)).toEqual(["Zeno", "Ajax"]);
		expect(body.players[0].total).toBe(body.players[1].total);
		// The same pair the crown reads, so the two cannot disagree.
		expect(body.players[0].duels_network_at).toBe(
			body.players[1].duels_network_at,
		);
		expect(body.players[0].duels_network_won).toBe(true);
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
