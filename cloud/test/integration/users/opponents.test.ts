// Integration tests for the ratings rebuild and the viewer's opponents list
// (cloud/src/ratings/rebuild.ts, handlers.ts). The recommender itself is unit
// tested beside its module; what needs D1 is the rebuild's replace-in-place
// contract — a row from an earlier run is gone afterwards, and a run never
// leaves a table empty — and the shape of what crosses the wire.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
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
