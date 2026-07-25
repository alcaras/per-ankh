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

// A city at the given culture level, owned by player 0 unless stated. `held`
// defaults to the sole owner — pass it to describe a city that changed hands.
function city(culture: string | null, owner = 0, held = [owner]) {
	return {
		city_id: 1,
		owner_nation: "NATION_ROME",
		owner_player_xml_id: owner,
		first_owner_player_xml_id: held[0],
		player_families: held.map((player_xml_id) => ({ player_xml_id })),
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

	// A player conquered out of the game owns nothing at the end. Reading the
	// end-state owner would give them no culture level and so no eligibility
	// for any wonder, dropping them out of every build-rate denominator.
	it("counts a city the player held and then lost", () => {
		const summary = derive(
			blobWith({
				city_statistics: {
					cities: [city("CULTURE_LEGENDARY", 1, [0, 1])],
				},
			}),
		);
		expect(summary.best_culture_level).toBe("CULTURE_LEGENDARY");
	});

	it("still ignores a city the player never held", () => {
		const summary = derive(
			blobWith({
				city_statistics: {
					cities: [city("CULTURE_WEAK"), city("CULTURE_LEGENDARY", 1, [1, 2])],
				},
			}),
		);
		expect(summary.best_culture_level).toBe("CULTURE_WEAK");
	});

	// player_families arrived in parser 2.10.0; older blobs have only the
	// end-state owner to go on.
	it("falls back to the end-state owner when player_families is absent", () => {
		const legacy = { ...city("CULTURE_STRONG"), player_families: undefined };
		expect(
			derive(blobWith({ city_statistics: { cities: [legacy] } }))
				.best_culture_level,
		).toBe("CULTURE_STRONG");
	});
});
