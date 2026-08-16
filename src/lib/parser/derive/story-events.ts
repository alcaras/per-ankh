// Parsed event_stories carry XML ids; resolve to first_name + city_name and
// keep the owning player as both an id and a name, newest turn first. The id
// is what consumers join on — see player_xml_id on the StoryEvent type.
//
// The whole history ships. The DuckDB query this was ported from ended
// `LIMIT 100`, which fed a "100 most recent events" table in the desktop
// Events tab; that table is gone, and every consumer since reads these rows
// as per-(player, turn) evidence — expedition markers and science spikes on
// the Techs tab, legitimacy itemization on the Orders tab. Saves carry
// 214-688 events, so a newest-100 window spanned only the last 12-22 turns
// and left every earlier turn unattributable. Shipping all of them, with the
// player id below on every row, costs 0.9-3.9% of blob bytes — worst case in
// the corpus +104 KiB uncompressed, +8 KiB gzipped, against Worker limits of
// 10 MB compressed / 50 MB decompressed. Keep it that way: the ordering below
// is for consumers' convenience, not to select a prefix.

import type { Character } from "../parsers/characters.js";
import type { City } from "../parsers/cities.js";
import type { EventStory } from "../parsers/events.js";
import type { Player } from "../parsers/players.js";
import type { StoryEvent } from "../types.js";
import { playerByXmlId } from "./_helpers.js";

export function deriveStoryEvents(
	eventStories: EventStory[],
	players: Player[],
	characters: Character[],
	cities: City[],
): StoryEvent[] {
	const playerMap = playerByXmlId(players);
	const charMap = new Map<number, Character>();
	for (const c of characters) charMap.set(c.xmlId, c);
	const cityMap = new Map<number, City>();
	for (const c of cities) cityMap.set(c.xmlId, c);

	const out: StoryEvent[] = [];
	let surrogateId = 1;

	for (const e of eventStories) {
		const player = playerMap.get(e.playerXmlId);
		if (!player) continue;
		out.push({
			event_id: surrogateId++,
			event_type: e.eventType,
			player_xml_id: player.xmlId,
			player_name: player.playerName,
			occurred_turn: e.occurredTurn,
			primary_character_name:
				e.primaryCharacterXmlId !== null
					? (charMap.get(e.primaryCharacterXmlId)?.firstName ?? null)
					: null,
			city_name:
				e.cityXmlId !== null
					? (cityMap.get(e.cityXmlId)?.cityName ?? null)
					: null,
		});
	}

	out.sort(
		(a, b) => b.occurred_turn - a.occurred_turn || b.event_id - a.event_id,
	);

	return out;
}
