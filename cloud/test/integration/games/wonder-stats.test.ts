// Integration tests for the wonder slice of the stats bundle.
//
// The interesting part is the denominator: a player counts as *eligible* for a
// wonder only when all three gates are open — the wonder was enabled in that
// game (Old World disables most of them per game), the player held a city at
// the wonder's <CulturePrereq>, and no AI had already taken it off the board.
// These go through the real upload pipeline so the blob → wonder_events /
// game_wonder_pool / best_culture_level indexing is exercised end to end, then
// read back through GET /v1/users/:id/stats.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { WONDER_CULTURE_PREREQ } from "../../../src/generated/wonders";
import { expectOk } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { postMultipart, request } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// Two wonders at opposite ends of the culture ladder, so one test player can
// clear one gate and not the other.
const WEAK_WONDER = "IMPROVEMENT_PYRAMIDS";
const LEGENDARY_WONDER = "IMPROVEMENT_CIRCUS_MAXIMUS";

// Everything except the two above — the shape of a real save, which enables a
// subset and disables the rest.
const DISABLE_ALL_BUT_TEST_WONDERS = Object.keys(WONDER_CULTURE_PREREQ).filter(
	(w) => w !== WEAK_WONDER && w !== LEGENDARY_WONDER,
);

type WonderRow = {
	wonder: string;
	// null when no pool-carrying game accounted for this wonder — distinct from
	// a zero, which says it was on the board and nobody qualified.
	eligible: number | null;
	rate: number | null;
	built: number;
	wins: number;
	win_rate: number | null;
	median_turn: number | null;
};

async function upload(
	user: TestUser,
	opts: Parameters<typeof buildUploadFormData>[0],
): Promise<void> {
	const form = await buildUploadFormData(opts);
	const res = await postMultipart({ path: "/v1/games", form, as: user });
	expect(res.status).toBe(201);
}

async function wonderStats(user: TestUser): Promise<Map<string, WonderRow>> {
	const bundle = await expectOk<{ wonderStats: WonderRow[] }>(
		await request.get({ path: `/v1/users/${user.userId}/stats`, as: user }),
	);
	return new Map(bundle.wonderStats.map((w) => [w.wonder, w]));
}

describe("wonder stats — eligibility", () => {
	it("counts a player as eligible only for enabled wonders they have the culture for", async () => {
		const user = await makeUser();
		await upload(user, {
			winnerIndex: 0,
			parserVersion: "2.12.0",
			disabledImprovements: DISABLE_ALL_BUT_TEST_WONDERS,
			cities: [{ owner: 0, cultureLevel: "CULTURE_WEAK" }],
			wonders: [{ player_id: 0, wonder: WEAK_WONDER, completed_turn: 30 }],
		});

		const stats = await wonderStats(user);
		// Enabled and within reach: one eligible player, who built it and won.
		expect(stats.get(WEAK_WONDER)).toMatchObject({
			eligible: 1,
			built: 1,
			wins: 1,
			win_rate: 1,
			median_turn: 30,
		});
		// Enabled, but a Weak-culture player can never start it — and a row
		// exists only for a wonder someone could build or did, so being enabled
		// isn't on its own enough to earn one.
		expect(stats.has(LEGENDARY_WONDER)).toBe(false);
		// Disabled in this game — absent for the same reason.
		expect(stats.has("IMPROVEMENT_ORACLE")).toBe(false);
	});

	it("counts an eligible wonder nobody built, which is the point of the denominator", async () => {
		const user = await makeUser();
		await upload(user, {
			winnerIndex: 0,
			parserVersion: "2.12.0",
			disabledImprovements: DISABLE_ALL_BUT_TEST_WONDERS,
			cities: [{ owner: 0, cultureLevel: "CULTURE_WEAK" }],
		});

		expect(
			await wonderStats(user).then((s) => s.get(WEAK_WONDER)),
		).toMatchObject({
			eligible: 1,
			built: 0,
			wins: 0,
			win_rate: null,
			median_turn: null,
		});
	});

	it("reports no denominator, rather than a zero one, for a game with no pool", async () => {
		const user = await makeUser();
		// Same culture and the same build, but an older blob carries no
		// disabled-improvements list — so there's no pool, and the game adds
		// nothing to any denominator.
		await upload(user, {
			winnerIndex: 0,
			cities: [{ owner: 0, cultureLevel: "CULTURE_WEAK" }],
			wonders: [{ player_id: 0, wonder: WEAK_WONDER, completed_turn: 30 }],
		});

		const row = (await wonderStats(user)).get(WEAK_WONDER);
		// Zero here would say "available to nobody" directly above this
		// wonder's own build — null says we have nothing to divide by.
		expect(row?.eligible).toBeNull();
		expect(row?.rate).toBeNull();
		// The build itself is still indexed — it just has no denominator behind it.
		expect(row?.built ?? 0).toBe(1);
	});

	it("drops a wonder an AI took from the human's denominator", async () => {
		const user = await makeUser();
		await upload(user, {
			winnerIndex: 0,
			parserVersion: "2.12.0",
			disabledImprovements: DISABLE_ALL_BUT_TEST_WONDERS,
			// Legendary culture, so both test wonders are within reach and the
			// only thing separating them is who took them.
			cities: [{ owner: 0, cultureLevel: "CULTURE_LEGENDARY" }],
			aiPlayer: true,
			// The AI finishes it on turn 12; it's off the board from then on.
			wonders: [{ player_id: 2, wonder: WEAK_WONDER, completed_turn: 12 }],
		});

		const stats = await wonderStats(user);
		// Counting the human eligible here would read as them passing over a
		// wonder that wasn't theirs to build, and the AI's build can't offset
		// it — only human builds reach the numerator.
		expect(stats.has(WEAK_WONDER)).toBe(false);
		// The one the AI didn't take still counts, so this drops the wonder and
		// not the game.
		expect(stats.get(LEGENDARY_WONDER)).toMatchObject({
			eligible: 1,
			built: 0,
		});
	});

	it("drops a build whose builder the parser couldn't resolve", async () => {
		const user = await makeUser();
		await upload(user, {
			winnerIndex: 0,
			parserVersion: "2.12.0",
			disabledImprovements: DISABLE_ALL_BUT_TEST_WONDERS,
			cities: [{ owner: 0, cultureLevel: "CULTURE_WEAK" }],
			// A null nation is the parser's marker for "couldn't find the tile
			// owner"; it falls back to player_id 0, so indexing it would credit
			// whoever holds index 0 with someone else's wonder.
			wonders: [
				{ player_id: 0, wonder: WEAK_WONDER, completed_turn: 30, nation: null },
			],
		});

		expect((await wonderStats(user)).get(WEAK_WONDER)).toMatchObject({
			eligible: 1,
			built: 0,
		});
	});
});
