import { describe, expect, it } from "vitest";
import {
	buildSummaryGameContext,
	derivePlayerSummary,
} from "./derive-player-summary";
import type { FullGameData, PlayerRosterEntry } from "./schemas/game";

// A minimal blob carrying only what the derivation under test reads. The real
// FullGameData is far wider (the Valibot schema treats most entries as
// unknown), so the fixture is cast the same way the module narrows its input.
function blobWith(over: {
	city_statistics?: { cities: Array<Record<string, unknown>> };
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

const PLAYER = { player_index: 0 } as unknown as PlayerRosterEntry;

function derive(blob: FullGameData) {
	return derivePlayerSummary(blob, PLAYER, buildSummaryGameContext(blob));
}

// A city at the given culture level, owned by player 0 unless stated.
function city(culture: string | null, owner = 0) {
	return {
		city_id: 1,
		owner_nation: "NATION_ROME",
		owner_player_xml_id: owner,
		first_owner_player_xml_id: owner,
		founded_turn: 3,
		culture_level: culture,
	};
}

// best_culture_level is what makes a wonder's eligibility answerable: a wonder
// can only be built in a city that has reached its <CulturePrereq>.
describe("derivePlayerSummary — best culture level", () => {
	it("takes the highest level across the player's cities", () => {
		const summary = derive(
			blobWith({
				city_statistics: {
					cities: [
						city("CULTURE_WEAK"),
						city("CULTURE_STRONG"),
						city("CULTURE_DEVELOPING"),
					],
				},
			}),
		);
		expect(summary.best_culture_level).toBe("CULTURE_STRONG");
	});

	it("ignores cities owned by someone else", () => {
		const summary = derive(
			blobWith({
				city_statistics: {
					cities: [city("CULTURE_WEAK"), city("CULTURE_LEGENDARY", 1)],
				},
			}),
		);
		expect(summary.best_culture_level).toBe("CULTURE_WEAK");
	});

	it("is null when the player holds no cities with a known level", () => {
		expect(derive(blobWith({})).best_culture_level).toBeNull();
		expect(
			derive(blobWith({ city_statistics: { cities: [city(null)] } }))
				.best_culture_level,
		).toBeNull();
	});
});
