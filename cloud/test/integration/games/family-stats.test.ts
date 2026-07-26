// Integration tests for the family slice of the stats bundle.
//
// Two things here are easy to get subtly wrong and invisible once wrong: the
// share of a player's cities a family class ended up holding, and the founding
// order those families arrived in — which must be read from the cities the
// player *founded*, since a captured city keeps the turn its original owner
// founded it. Both go through the real upload pipeline (blob →
// player_family_cities) and are read back through GET /v1/users/:id/stats.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { postMultipart, request } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const SAGES = "FAMILYCLASS_SAGES";
const TRADERS = "FAMILYCLASS_TRADERS";
const CHAMPIONS = "FAMILYCLASS_CHAMPIONS";

type FamilyRow = {
	nation: string;
	class: string;
	count: number;
	wins: number;
	avg_share: number | null;
	share_samples: number;
	slot_counts: [number, number, number];
};

async function upload(
	user: TestUser,
	opts: Parameters<typeof buildUploadFormData>[0],
): Promise<string> {
	const res = await postMultipart({
		path: "/v1/games",
		form: await buildUploadFormData(opts),
		as: user,
	});
	// A failing insert takes the whole upload batch down, so the status code is
	// the assertion that matters for the param-cap cases below.
	expect(res.status).toBe(201);
	return (await expectOk<{ game_id: string }>(res)).game_id;
}

// The (player, family class) rows the upload actually wrote.
async function footprint(
	gameId: string,
): Promise<Array<{ player_index: number; family_class: string }>> {
	const res = await env.SHARE_DB.prepare(
		`SELECT player_index, family_class FROM player_family_cities
		 WHERE game_id = ? ORDER BY player_index, family_class`,
	)
		.bind(gameId)
		.all<{ player_index: number; family_class: string }>();
	return res.results ?? [];
}

async function families(user: TestUser): Promise<Map<string, FamilyRow>> {
	const bundle = await expectOk<{
		familyByNation: FamilyRow[];
		capitalFamilyWinRate: Array<{ family_class: string; games: number }>;
	}>(await request.get({ path: `/v1/users/${user.userId}/stats`, as: user }));
	return new Map(bundle.familyByNation.map((r) => [r.class, r]));
}

describe("family stats", () => {
	it("splits the city share across the player's classes", async () => {
		const user = await makeUser();
		// Three cities: two Sages, one Traders — a 2:1 empire.
		await upload(user, {
			winnerIndex: 0,
			cities: [
				{ owner: 0, familyClass: SAGES, foundedTurn: 4, isCapital: true },
				{ owner: 0, familyClass: SAGES, foundedTurn: 20 },
				{ owner: 0, familyClass: TRADERS, foundedTurn: 12 },
			],
		});

		const rows = await families(user);
		expect(rows.get(SAGES)?.avg_share).toBeCloseTo(2 / 3, 5);
		expect(rows.get(TRADERS)?.avg_share).toBeCloseTo(1 / 3, 5);
		expect(rows.get(SAGES)?.share_samples).toBe(1);
	});

	it("ranks founding order by the player's own foundings", async () => {
		const user = await makeUser();
		await upload(user, {
			winnerIndex: 0,
			cities: [
				{ owner: 0, familyClass: SAGES, foundedTurn: 8, isCapital: true },
				{ owner: 0, familyClass: TRADERS, foundedTurn: 30 },
			],
		});

		const rows = await families(user);
		// Sages first, Traders second.
		expect(rows.get(SAGES)?.slot_counts).toEqual([1, 0, 0]);
		expect(rows.get(TRADERS)?.slot_counts).toEqual([0, 1, 0]);
	});

	it("doesn't let a captured city backdate a family's founding", async () => {
		const user = await makeUser();
		await upload(user, {
			winnerIndex: 0,
			cities: [
				{ owner: 0, familyClass: SAGES, foundedTurn: 8, isCapital: true },
				{ owner: 0, familyClass: TRADERS, foundedTurn: 30 },
				// Taken from the opponent, who founded it on turn 2. Counting it
				// would make Traders look like the player's first family.
				{
					owner: 0,
					familyClass: TRADERS,
					foundedTurn: 2,
					capturedFrom: 1,
				},
			],
		});

		const rows = await families(user);
		expect(rows.get(SAGES)?.slot_counts).toEqual([1, 0, 0]);
		expect(rows.get(TRADERS)?.slot_counts).toEqual([0, 1, 0]);
		// The captured city still counts toward the empire's composition.
		expect(rows.get(TRADERS)?.avg_share).toBeCloseTo(2 / 3, 5);
	});

	it("reads the capital's class off the capital city", async () => {
		const user = await makeUser();
		await upload(user, {
			winnerIndex: 0,
			cities: [
				{ owner: 0, familyClass: TRADERS, foundedTurn: 3, isCapital: true },
				{ owner: 0, familyClass: SAGES, foundedTurn: 9 },
			],
		});

		const bundle = await expectOk<{
			capitalFamilyWinRate: Array<{
				family_class: string;
				games: number;
				wins: number;
			}>;
		}>(await request.get({ path: `/v1/users/${user.userId}/stats`, as: user }));
		expect(bundle.capitalFamilyWinRate).toEqual([
			{ family_class: TRADERS, games: 1, wins: 1, rate: 1 },
		]);
	});

	// A pre-2.6.0 blob's cities carry no family_class at all. The whole backfill
	// story rests on those games degrading to "no data" instead of failing, so
	// the empty bundle field is the assertion.
	it("yields no capital family rows when no city carries a family", async () => {
		const user = await makeUser();
		await upload(user, {
			winnerIndex: 0,
			cities: [{ owner: 0, isCapital: true }, { owner: 0 }],
		});

		const bundle = await expectOk<{
			capitalFamilyWinRate: unknown[];
			familyByNation: unknown[];
		}>(await request.get({ path: `/v1/users/${user.userId}/stats`, as: user }));
		expect(bundle.capitalFamilyWinRate).toEqual([]);
		expect(bundle.familyByNation).toEqual([]);
	});

	// player_family_cities takes 5 bindings per row against D1's 99-parameter
	// ceiling, so the insert has to chunk at 19 rows. A full multiplayer lobby
	// clears that in one game — eight seats running three families each is 24
	// rows — and because every derived write shares one atomic batch(), an
	// over-wide chunk doesn't lose the footprint, it 500s the upload.
	it("writes every human seat's families past the insert parameter cap", async () => {
		const user = await makeUser();
		const HUMANS = 8;
		const CLASSES = [SAGES, TRADERS, CHAMPIONS];
		const gameId = await upload(user, {
			winnerIndex: 0,
			humans: HUMANS,
			cities: Array.from({ length: HUMANS }, (_, owner) =>
				CLASSES.map((familyClass, i) => ({
					owner,
					familyClass,
					foundedTurn: 4 + i * 8,
					isCapital: i === 0,
				})),
			).flat(),
		});

		const rows = await footprint(gameId);
		expect(rows.length).toBe(HUMANS * CLASSES.length);
		expect(rows.filter((r) => r.player_index === HUMANS - 1).length).toBe(
			CLASSES.length,
		);
	});

	// Nothing reads an AI's footprint — loadFamilyCities joins on
	// ps.is_human = 1 — so writing one is dead storage, and in a vs-AI save the
	// AI seats are most of the rows.
	it("leaves AI seats out of the footprint table", async () => {
		const user = await makeUser();
		const gameId = await upload(user, {
			winnerIndex: 0,
			aiPlayer: true,
			cities: [
				{ owner: 0, familyClass: SAGES, isCapital: true },
				// The AI at index 2 runs a family of its own.
				{ owner: 2, familyClass: TRADERS, isCapital: true },
			],
		});

		expect(await footprint(gameId)).toEqual([
			{ player_index: 0, family_class: SAGES },
		]);
	});
});
