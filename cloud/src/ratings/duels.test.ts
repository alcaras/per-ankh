import { describe, expect, it } from "vitest";
import { mergeDuels, type DuelExtraction, type ResolvedDuel } from "./duels";

function stats(): DuelExtraction["stats"] {
	return {
		tournament: 0,
		casual: 0,
		deduped: 0,
		casualGamesScanned: 0,
		unresolvedOpponent: 0,
		ambiguousOnlineId: 0,
	};
}

function duel(over: Partial<ResolvedDuel> = {}): ResolvedDuel {
	return {
		key: "game-1",
		date: "2026-08-01",
		p1: "a",
		p2: "b",
		winner: "a",
		isPublic: false,
		script: null,
		...over,
	};
}

describe("mergeDuels", () => {
	it("keeps the tournament record's result when both sources have the game", () => {
		const s = stats();
		const merged = mergeDuels(
			[duel({ winner: "a" })],
			[duel({ winner: "b" })],
			s,
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].winner).toBe("a");
		expect(s.deduped).toBe(1);
	});

	it("takes the map from the save when the match row doesn't have one", () => {
		// Winning the key isn't winning every field: the official result comes
		// from the tournament row, but only the save knows the map.
		const merged = mergeDuels(
			[duel({ script: null })],
			[duel({ script: "MAPCLASS_MapScriptDonut" })],
			stats(),
		);
		expect(merged[0].script).toBe("MAPCLASS_MapScriptDonut");
	});

	it("does not let the save overwrite a map the match row already names", () => {
		const merged = mergeDuels(
			[duel({ script: "MAPCLASS_MapScriptDonut" })],
			[duel({ script: "MAPCLASS_MapscriptWetlands" })],
			stats(),
		);
		expect(merged[0].script).toBe("MAPCLASS_MapScriptDonut");
	});

	it("takes public from either side — one public upload published the match", () => {
		const merged = mergeDuels(
			[duel({ isPublic: false })],
			[duel({ isPublic: true })],
			stats(),
		);
		expect(merged[0].isPublic).toBe(true);
	});

	it("drops a duel with no date from either source", () => {
		const merged = mergeDuels(
			[duel({ key: "t", date: "" })],
			[duel({ key: "c", date: "" })],
			stats(),
		);
		expect(merged).toEqual([]);
	});
});
