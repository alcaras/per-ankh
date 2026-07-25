import { describe, expect, it } from "vitest";
import type { FullGameData, PlayerRosterEntry } from "./schemas/game";
import {
	buildSummaryGameContext,
	derivePlayerSummary,
} from "./derive-player-summary";

// A minimal blob carrying only what the starting-leader derivation reads.
// The real FullGameData is far wider (the Valibot schema treats most entries as
// unknown), so the fixture is cast the same way the module narrows its input.
function blobWith(over: {
	characters?: Array<Record<string, unknown>>;
	character_traits?: Array<Record<string, unknown>>;
}): FullGameData {
	return {
		match_metadata: { total_turns: 60 },
		player_history: [],
		city_statistics: { cities: [] },
		families: [],
		characters: [],
		character_traits: [],
		completed_techs: [],
		law_adoption_history: [],
		...over,
	} as unknown as FullGameData;
}

// One leader for player 0, crowned on turn 1 (a starting leader is born
// pre-game — birth_turn is negative — and takes the throne on the first turn).
const LEADER = {
	xml_id: 7,
	player_xml_id: 0,
	is_royal: true,
	became_leader_turn: 1,
	death_turn: null,
	archetype: "TRAIT_SCHOLAR_ARCHETYPE",
};

const PLAYER = { player_index: 0 } as unknown as PlayerRosterEntry;

function derive(blob: FullGameData) {
	return derivePlayerSummary(blob, PLAYER, buildSummaryGameContext(blob));
}

describe("derivePlayerSummary — starting leader", () => {
	it("captures the traits the leader starts with, stamped on turn 1", () => {
		const blob = blobWith({
			characters: [LEADER],
			character_traits: [
				{
					character_xml_id: 7,
					trait_name: "TRAIT_SCHOLAR_ARCHETYPE",
					acquired_turn: 1,
				},
				{
					character_xml_id: 7,
					trait_name: "TRAIT_INTELLIGENT",
					acquired_turn: 1,
				},
			],
		});

		const summary = derive(blob);

		expect(summary.starting_ruler_archetype).toBe("TRAIT_SCHOLAR_ARCHETYPE");
		// Both the archetype trait and the personality trait land here; splitting
		// the two is the stats aggregator's job, not the derivation's.
		expect(JSON.parse(summary.starting_ruler_traits ?? "[]")).toEqual([
			"TRAIT_SCHOLAR_ARCHETYPE",
			"TRAIT_INTELLIGENT",
		]);
	});

	it("excludes traits acquired after the game began", () => {
		const blob = blobWith({
			characters: [LEADER],
			character_traits: [
				{
					character_xml_id: 7,
					trait_name: "TRAIT_INTELLIGENT",
					acquired_turn: 1,
				},
				// Won through an event mid-game — not part of the starting roll.
				{ character_xml_id: 7, trait_name: "TRAIT_WARLIKE", acquired_turn: 26 },
			],
		});

		expect(JSON.parse(derive(blob).starting_ruler_traits ?? "[]")).toEqual([
			"TRAIT_INTELLIGENT",
		]);
	});

	it("ignores other players' leaders", () => {
		const blob = blobWith({
			characters: [
				LEADER,
				{
					...LEADER,
					xml_id: 9,
					player_xml_id: 1,
					archetype: "TRAIT_ZEALOT_ARCHETYPE",
				},
			],
			character_traits: [
				{ character_xml_id: 9, trait_name: "TRAIT_ROMANTIC", acquired_turn: 1 },
			],
		});

		const summary = derive(blob);
		expect(summary.starting_ruler_archetype).toBe("TRAIT_SCHOLAR_ARCHETYPE");
		expect(summary.starting_ruler_traits).toBeNull();
	});

	it("takes the earliest crowned leader when a succession happened", () => {
		const blob = blobWith({
			characters: [
				{
					...LEADER,
					xml_id: 11,
					became_leader_turn: 34,
					archetype: "TRAIT_HERO_ARCHETYPE",
				},
				LEADER,
			],
			character_traits: [
				{ character_xml_id: 11, trait_name: "TRAIT_BOLD", acquired_turn: 34 },
			],
		});

		const summary = derive(blob);
		expect(summary.starting_ruler_archetype).toBe("TRAIT_SCHOLAR_ARCHETYPE");
		expect(summary.succession_count).toBe(2);
		// The successor's own trait, acquired on the turn they took the throne,
		// must not land in the starting leader's list.
		expect(summary.starting_ruler_traits).toBeNull();
	});
});
