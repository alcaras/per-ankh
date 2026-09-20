// Integration tests for the ratings rebuild and the viewer's opponents list
// (cloud/src/ratings/rebuild.ts, handlers.ts). The recommender itself is unit
// tested beside its module; what needs D1 is the rebuild's replace-in-place
// contract — a row from an earlier run is gone afterwards, and a run never
// leaves a table empty — the wire shape of the list, and which games the
// extractor's SQL calls a duel at all.

import { applyD1Migrations, env } from "cloudflare:test";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { extractDuels } from "../../../src/ratings/duels";
import { rebuildRatings } from "../../../src/ratings/rebuild";
import { expectOk } from "../../helpers/assertions";
import {
	makeTournament,
	makeUser,
	type TestUser,
} from "../../helpers/builders";
import { request } from "../../helpers/requests";

// Eight players who each fought one decided tournament match: the smallest
// pool the extractor can rate without a save blob.
let players: TestUser[];
let hidden: TestUser;

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	players = [];
	for (let i = 0; i < 8; i++) {
		players.push(await makeUser({ displayName: `Duelist ${i}` }));
	}
	await makeTournament({
		slotOwners: { A: players.slice(0, 4), B: players.slice(4, 8) },
		advanceTo: "swiss-round-1-complete",
	});
	// Opted out of being suggested, but still a viewer with a list of their
	// own — that asymmetry is the contract the tab's copy describes.
	hidden = players[0];
	await env.SHARE_DB.prepare(
		"UPDATE users SET open_to_matches = 0 WHERE user_id = ?",
	)
		.bind(hidden.userId)
		.run();
});

interface OpponentsResponse {
	opponents: Record<string, unknown>[];
	rated: boolean;
}

describe("rebuildRatings", () => {
	it("replaces an earlier run's rows and leaves every rated player a list", async () => {
		// A row an earlier run left behind, at a position this run will not
		// write, for a viewer this run will not touch at all.
		const bystander = await makeUser();
		await env.SHARE_DB.prepare(
			`INSERT INTO user_recommended_opponents
			   (user_id, position, opponent_user_id, meetings, badges, computed_at)
			 VALUES (?, 99, ?, 0, '[]', '2020-01-01 00:00:00')`,
		)
			.bind(bystander.userId, players[1].userId)
			.run();

		const result = await rebuildRatings(env.SHARE_DB);
		expect(result.users).toBe(8);
		expect(result.ratableDuels).toBe(4);

		const stale = await env.SHARE_DB.prepare(
			"SELECT 1 FROM user_recommended_opponents WHERE user_id = ?",
		)
			.bind(bystander.userId)
			.first();
		expect(stale).toBeNull();

		const ratings = await env.SHARE_DB.prepare(
			"SELECT COUNT(*) AS n FROM user_ratings",
		).first<{ n: number }>();
		expect(ratings?.n).toBe(8);

		const listed = await env.SHARE_DB.prepare(
			"SELECT COUNT(DISTINCT user_id) AS n FROM user_recommended_opponents",
		).first<{ n: number }>();
		expect(listed?.n).toBe(8);
	});
});

// A casual save with a roster, for the extractor's SQL to select or reject.
async function makeGame(opts: {
	uploader: TestUser;
	gameMode: string;
	isPublic?: boolean;
	seats: {
		onlineId?: string;
		isUploader?: boolean;
		isHuman?: boolean;
		won?: boolean;
	}[];
}): Promise<void> {
	const gameId = nanoid(21);
	await env.SHARE_DB.prepare(
		`INSERT INTO games (
		   game_id, user_id, xml_game_id, total_turns, file_hash, game_name,
		   is_public, blob_version, blob_size_bytes, parser_version, game_mode,
		   save_date
		 ) VALUES (?, ?, ?, 50, ?, 'Casual Game', ?, 2, 1024, '1.0.0', ?, '2026-08-20')`,
	)
		.bind(
			gameId,
			opts.uploader.userId,
			nanoid(36),
			nanoid(64),
			(opts.isPublic ?? true) ? 1 : 0,
			opts.gameMode,
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
				`Seat ${i}`,
				(seat.isHuman ?? true) ? 1 : 0,
				(seat.isUploader ?? false) ? 1 : 0,
				seat.onlineId ?? null,
				(seat.won ?? false) ? 1 : 0,
			)
			.run();
	}
}

describe("extractDuels", () => {
	it("rates a duel played apart, and nothing the repo would not call one", async () => {
		// Three saves that a two-human count alone cannot tell apart, and only
		// the first is a duel: the second has AI in it (games-scope.ts argues
		// that case directly), and the third was played at one machine.
		const [a, b] = [await makeUser(), await makeUser()];
		const onlineA = nanoid(12);
		const onlineB = nanoid(12);
		for (const [user, id] of [
			[a, onlineA],
			[b, onlineB],
		] as const) {
			await env.SHARE_DB.prepare(
				"INSERT INTO user_online_ids (user_id, online_id) VALUES (?, ?)",
			)
				.bind(user.userId, id)
				.run();
		}
		const humans = [
			{ onlineId: onlineA, isUploader: true, won: true },
			{ onlineId: onlineB },
		];

		const before = (await extractDuels(env.SHARE_DB)).stats.casual;
		await makeGame({ uploader: a, gameMode: "NETWORK", seats: humans });
		await makeGame({
			uploader: a,
			gameMode: "NETWORK",
			seats: [...humans, { isHuman: false }, { isHuman: false }],
		});
		await makeGame({ uploader: a, gameMode: "HOTSEAT", seats: humans });

		const after = await extractDuels(env.SHARE_DB);
		expect(after.stats.casual).toBe(before + 1);
	});

	it("marks a duel only the pair can see as not public", async () => {
		// The badges are counted over this flag, so a private save must not
		// arrive looking like a published result.
		const [a, b] = [await makeUser(), await makeUser()];
		const onlineA = nanoid(12);
		const onlineB = nanoid(12);
		for (const [user, id] of [
			[a, onlineA],
			[b, onlineB],
		] as const) {
			await env.SHARE_DB.prepare(
				"INSERT INTO user_online_ids (user_id, online_id) VALUES (?, ?)",
			)
				.bind(user.userId, id)
				.run();
		}
		await makeGame({
			uploader: a,
			gameMode: "NETWORK",
			isPublic: false,
			seats: [
				{ onlineId: onlineA, isUploader: true, won: true },
				{ onlineId: onlineB },
			],
		});

		const { duels } = await extractDuels(env.SHARE_DB);
		const mine = duels.filter((d) => d.p1 === a.userId || d.p2 === a.userId);
		expect(mine).toHaveLength(1);
		expect(mine[0].isPublic).toBe(false);
	});
});

describe("GET /v1/users/me/opponents", () => {
	it("returns names and facts, and never a rating or a Discord handle", async () => {
		await rebuildRatings(env.SHARE_DB);
		const body = await expectOk<OpponentsResponse>(
			await request.get({ path: "/v1/users/me/opponents", as: players[1] }),
		);
		expect(body.rated).toBe(true);
		expect(body.opponents.length).toBeGreaterThan(0);
		for (const o of body.opponents) {
			expect(Object.keys(o).sort()).toEqual([
				"avatar_url",
				"badges",
				"discord_url",
				"display_name",
				"meetings",
				"slug",
				"user_id",
			]);
			expect(o.user_id).not.toBe(hidden.userId);
		}
	});

	it("still gives a hidden player their own list", async () => {
		await rebuildRatings(env.SHARE_DB);
		const body = await expectOk<OpponentsResponse>(
			await request.get({ path: "/v1/users/me/opponents", as: hidden }),
		);
		expect(body.opponents.length).toBeGreaterThan(0);
	});

	it("tells an unrated player so", async () => {
		const newcomer = await makeUser();
		const body = await expectOk<OpponentsResponse>(
			await request.get({ path: "/v1/users/me/opponents", as: newcomer }),
		);
		expect(body).toEqual({ opponents: [], rated: false });
	});
});
