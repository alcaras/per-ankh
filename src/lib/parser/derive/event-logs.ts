// Dedups events that have the same (turn, log_type, stripped-description),
// and carries the group's owner set out as `player_xml_ids` — every player
// that logged the event. That set is what consumers attribute a row by.
//
// `player_name` keeps its legacy meaning unchanged: null for groups with > 1
// row (the SQL `CASE` clause at line 287), the resolved name for single-row
// groups. It is the only key blobs below PARSER_VERSION 2.14.0 carry, and
// what the Events tab renders.

import type { EventLog as ParsedEventLog } from "../parsers/events.js";
import type { Player } from "../parsers/players.js";
import type { EventLog } from "../types.js";
import { playerByXmlId, stripMarkup } from "./_helpers.js";

interface Bucket {
	min_log_id: number; // surrogate id; we use array order as proxy
	log_type: string;
	turn: number;
	rowCount: number;
	/** Every player that contributed a row — the group's owner set. */
	playerXmlIds: Set<number>;
	descriptions: string[];
}

export function deriveEventLogs(
	eventLogs: ParsedEventLog[],
	players: Player[],
): EventLog[] {
	const playerMap = playerByXmlId(players);

	// Group by (turn, log_type, stripped-description).
	const groups = new Map<string, Bucket>();
	let nextSurrogateId = 1;

	for (const log of eventLogs) {
		const stripped = log.description ? stripMarkup(log.description) : "";
		// `\x01` separator — mirrors the SQL `GROUP BY el.turn, el.log_type, ...`
		// triple. Plain concatenation collides on edge cases like
		// (turn=12, type="X") vs (turn=1, type="2X").
		const key = `${log.turn}\x01${log.logType}\x01${stripped}`;
		let bucket = groups.get(key);
		if (!bucket) {
			bucket = {
				min_log_id: nextSurrogateId++,
				log_type: log.logType,
				turn: log.turn,
				rowCount: 0,
				playerXmlIds: new Set(),
				descriptions: [],
			};
			groups.set(key, bucket);
		}
		bucket.rowCount++;
		bucket.playerXmlIds.add(log.playerXmlId);
		if (log.description !== null) bucket.descriptions.push(log.description);
	}

	const out: EventLog[] = [];
	for (const b of groups.values()) {
		// MIN(description) — JS string compare via sort.
		const description =
			b.descriptions.length > 0 ? [...b.descriptions].sort()[0] : null;

		// SQL `WHEN COUNT(*) > 1 THEN NULL`. Counts ALL rows in the group,
		// not distinct players — two events from the same player at the same
		// turn with the same stripped description still trip the multi-row
		// branch. One row means exactly one owner, and the map always holds
		// it: parseEventLogs reads logs out of Player[].PermanentLogList, so
		// every playerXmlId is a real player, and parsePlayers keeps every
		// Player node. (Both fallbacks this branch used to carry — a null id
		// and a missing player — were unreachable for those two reasons.)
		let playerName: string | null = null;
		if (b.rowCount === 1) {
			const [soloPlayerXmlId] = b.playerXmlIds;
			playerName = playerMap.get(soloPlayerXmlId)!.playerName;
		}

		out.push({
			log_id: b.min_log_id,
			log_type: b.log_type,
			turn: b.turn,
			// Sorted so the array is canonical: the set's insertion order is
			// whichever player's log the parser happened to reach first.
			player_xml_ids: [...b.playerXmlIds].sort((x, y) => x - y),
			player_name: playerName,
			description,
		});
	}

	// ORDER BY el.turn DESC, MIN(el.log_id) DESC.
	out.sort((a, b) => b.turn - a.turn || b.log_id - a.log_id);
	return out;
}
