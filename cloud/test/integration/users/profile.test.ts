// The profile-header summary on GET /v1/users/:user_id — the one scope
// narrowing that card has.
//
// The header is deliberately scope-free otherwise: it sits above the Games
// tab's scope selector and doesn't move with it, so every other selection the
// repo has (collection, game type, composition) is absent from its three
// reads. Challenge runs are the exception, and these tests pin it, because
// nothing in the card's own shape would show the exception is there — see the
// comment on buildUserProfile (users.ts) for why runs are the one game type a
// scope-free header still has to drop.
//
// Direct INSERT for the fixture, the way users/stats.test.ts and
// global-slices.test.ts seed theirs: all three reads run on `games` columns
// alone, and the real upload path would want a parsed save for each one. The
// submission row is likewise inserted rather than submitted — what's under
// test is the predicate, not the scorer.

import { applyD1Migrations, env } from "cloudflare:test";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface ProfileResponse {
	summary: {
		total_games: number;
		win_rate: number | null;
		favorite_nation: string | null;
		favorite_day_of_week: number | null;
	};
}

// `won` is null for a run, matching what the upload path records: a run stops
// when the rule set is met, so its save has no winning seat and user_won comes
// out NULL (games.ts).
async function seedGame(opts: {
	user: TestUser;
	nation: string;
	saveDate: string;
	won: 1 | null;
}): Promise<string> {
	const gameId = nanoid(21);
	await env.SHARE_DB.prepare(
		`INSERT INTO games (
			game_id, user_id, xml_game_id, total_turns, file_hash,
			is_public, parser_version, user_nation, user_won, save_date
		) VALUES (?, ?, ?, 60, ?, 1, '2.9.1', ?, ?, ?)`,
	)
		.bind(
			gameId,
			opts.user.userId,
			nanoid(36),
			nanoid(64),
			opts.nation,
			opts.won,
			opts.saveDate,
		)
		.run();
	return gameId;
}

// One challenge, and every game in `gameIds` an accepted run on it — which is
// the shape that matters here: a challenge fixes one map, so its runs all carry
// that map's nation and its runners all played the same day.
async function seedChallenge(user: TestUser, gameIds: string[]): Promise<void> {
	const challengeId = `ch_${nanoid(18)}`;
	await env.SHARE_DB.prepare(
		`INSERT INTO challenges (
			challenge_id, number, title, created_by, closes_at,
			setup, objectives, criteria,
			map_r2_key, map_file_hash, map_size_bytes
		) VALUES (?, 27, 'Profile fixture', ?, datetime('now', '+30 days'),
		          '{}', '[]', '[]', ?, 'hash', 1)`,
	)
		.bind(challengeId, user.userId, `challenges/${challengeId}/map.zip`)
		.run();
	for (const gameId of gameIds) {
		await env.SHARE_DB.prepare(
			`INSERT INTO challenge_submissions (
				submission_id, challenge_id, game_id, user_id, score_turn, verdict
			) VALUES (?, ?, ?, ?, 50, '{}')`,
		)
			.bind(nanoid(21), challengeId, gameId, user.userId)
			.run();
	}
}

describe("GET /v1/users/:user_id — profile summary", () => {
	it("counts the user's games and not their challenge runs", async () => {
		const user = await makeUser();
		// One ordinary game, and two runs on one challenge — so the runs
		// outnumber it on both reads that pick a modal value. Without the
		// predicate the card reads 3 games, Egypt and Sunday instead.
		await seedGame({
			user,
			nation: "NATION_ROME",
			saveDate: "2026-03-02", // Monday
			won: 1,
		});
		const runs = [
			await seedGame({
				user,
				nation: "NATION_EGYPT",
				saveDate: "2026-03-01", // Sunday
				won: null,
			}),
			await seedGame({
				user,
				nation: "NATION_EGYPT",
				saveDate: "2026-03-01",
				won: null,
			}),
		];
		await seedChallenge(user, runs);

		const profile = await expectOk<ProfileResponse>(
			await request.get({ path: `/v1/users/${user.userId}` }),
		);
		expect(profile.summary.total_games).toBe(1);
		expect(profile.summary.favorite_nation).toBe("NATION_ROME");
		expect(profile.summary.favorite_day_of_week).toBe(1);
		// win_rate needs no predicate of its own — a run's save has no winner,
		// so its user_won is NULL and the denominator skips it — but it is read
		// by the same query as total_games, so it is pinned here too.
		expect(profile.summary.win_rate).toBe(1);
	});
});
