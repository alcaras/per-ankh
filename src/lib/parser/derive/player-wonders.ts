// derive/player-wonders.ts — port of get_player_wonders (match_data.rs:178–216).
//
// Wonder completion fires WONDER_ACTIVITY events for every player; we
// dedupe by wonder name (data2) and keep the earliest turn. The builder is
// resolved by finding the wonder's improvement on the map and reading who
// owned that tile *on the turn it completed* — a wonder outlives its builder,
// so the final owner is whoever holds it at the end, not who put it there.

import type { EventLog as ParsedEventLog } from "../parsers/events.js";
import type { Player } from "../parsers/players.js";
import type { Tile, TileOwnership } from "../parsers/tiles.js";
import type { PlayerWonder } from "../types.js";
import { playerByXmlId, strCmp } from "./_helpers.js";

export function derivePlayerWonders(
	eventLogs: ParsedEventLog[],
	tiles: Tile[],
	tileOwnership: TileOwnership[],
	players: Player[],
): PlayerWonder[] {
	const playerMap = playerByXmlId(players);

	// Map improvement → its tile and that tile's final owner. The final owner
	// is only the fallback; the ownership history below is what resolves a
	// wonder that changed hands.
	const tileByImprovement = new Map<
		string,
		{ tileXmlId: number; finalOwner: number }
	>();
	for (const t of tiles) {
		if (t.improvement === null) continue;
		if (t.ownerPlayerXmlId === null) continue;
		// Only set the first tile carrying this improvement (LEFT JOIN
		// behavior — first match wins). Real wonders are unique per game so
		// this is effectively deterministic.
		if (!tileByImprovement.has(t.improvement)) {
			tileByImprovement.set(t.improvement, {
				tileXmlId: t.xmlId,
				finalOwner: t.ownerPlayerXmlId,
			});
		}
	}

	// Group WONDER_ACTIVITY/"completed" events by wonder, take MIN(turn).
	const wonderTurns = new Map<string, number>();
	for (const log of eventLogs) {
		if (log.logType !== "WONDER_ACTIVITY") continue;
		if (log.data2 === null) continue;
		if (log.description === null) continue;
		if (!log.description.includes("completed")) continue;
		const prev = wonderTurns.get(log.data2);
		if (prev === undefined || log.turn < prev) {
			wonderTurns.set(log.data2, log.turn);
		}
	}

	// Owner of each wonder's tile on the turn that wonder completed. Ownership
	// history is sparse — one entry per change of hands — so the owner at turn
	// T is the latest entry at or before T, however many times the tile moved.
	// Same resolution the map's turn slider uses (reconstruct-map-tiles.ts).
	// Scoped to the handful of wonder tiles: the full history runs to tens of
	// thousands of rows.
	const completionTurnByTile = new Map<number, number>();
	for (const [wonder, completedTurn] of wonderTurns) {
		const tile = tileByImprovement.get(wonder);
		if (tile !== undefined)
			completionTurnByTile.set(tile.tileXmlId, completedTurn);
	}
	const ownerAtCompletion = new Map<number, number | null>();
	const latestTurnSeen = new Map<number, number>();
	for (const entry of tileOwnership) {
		const completedTurn = completionTurnByTile.get(entry.tileXmlId);
		if (completedTurn === undefined) continue;
		if (entry.turn > completedTurn) continue;
		const prev = latestTurnSeen.get(entry.tileXmlId);
		if (prev === undefined || entry.turn > prev) {
			latestTurnSeen.set(entry.tileXmlId, entry.turn);
			ownerAtCompletion.set(entry.tileXmlId, entry.ownerPlayerXmlId);
		}
	}

	const out: PlayerWonder[] = [];
	for (const [wonder, completedTurn] of wonderTurns) {
		const tile = tileByImprovement.get(wonder);
		// A tile with no history entry at or before the completion turn — or one
		// recording it as unowned then — leaves the final owner as the only
		// answer available, which is what this resolved to before the history
		// was consulted at all.
		const builderXmlId =
			tile === undefined
				? undefined
				: (ownerAtCompletion.get(tile.tileXmlId) ?? tile.finalOwner);
		const builder =
			builderXmlId !== undefined ? playerMap.get(builderXmlId) : undefined;
		out.push({
			player_id: builder?.xmlId ?? 0,
			player_name: builder?.playerName ?? "Unknown",
			nation: builder?.nation ?? null,
			wonder,
			completed_turn: completedTurn,
		});
	}

	// ORDER BY p.nation, cw.completed_turn, cw.wonder.
	out.sort(
		(a, b) =>
			strCmp(a.nation ?? "", b.nation ?? "") ||
			a.completed_turn - b.completed_turn ||
			strCmp(a.wonder, b.wonder),
	);
	return out;
}
