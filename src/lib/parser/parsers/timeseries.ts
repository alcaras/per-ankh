// Time-series data parsers. Eight collections — one game-level
// (yield_price_history) and seven per-Player.

import { ParseError } from "../extract-zip.js";
import {
	asArray,
	isElement,
	parseSparseHistory,
	parseSparseHistoryByType,
	requireInt,
} from "../parse-xml.js";

// ---------- Types ----------

export interface YieldPriceHistory {
	turn: number;
	yieldType: string;
	price: number;
}

export interface MilitaryPowerHistory {
	playerXmlId: number;
	turn: number;
	militaryPower: number;
}

export interface PointsHistory {
	playerXmlId: number;
	turn: number;
	points: number;
}

export interface LegitimacyHistory {
	playerXmlId: number;
	turn: number;
	legitimacy: number;
}

export interface YieldRateHistory {
	playerXmlId: number;
	turn: number;
	yieldType: string;
	amount: number;
}

export interface YieldTotalHistory {
	playerXmlId: number;
	turn: number;
	yieldType: string;
	amount: number;
}

export interface FamilyOpinionHistory {
	playerXmlId: number;
	familyName: string;
	turn: number;
	opinion: number;
}

export interface ReligionOpinionHistory {
	playerXmlId: number;
	religionName: string;
	turn: number;
	opinion: number;
}

// ---------- Helpers ----------

function* eachPlayer(
	root: Record<string, unknown>,
): Generator<[number, Record<string, unknown>]> {
	for (const node of asArray(root.Player) as unknown[]) {
		if (!isElement(node)) continue;
		const playerXmlId = requireInt(node["@_ID"], "Player.ID");
		yield [playerXmlId, node];
	}
}

// ---------- Game-level: yield price history ----------

export function parseYieldPriceHistory(
	root: Record<string, unknown>,
): YieldPriceHistory[] {
	const gameNode = root.Game;
	if (!isElement(gameNode)) {
		// Rust errors with MissingElement if Game is absent.
		throw new ParseError("Game", "MISSING_FIELD");
	}
	const out: YieldPriceHistory[] = [];
	for (const { typeName, turn, value } of parseSparseHistoryByType(
		gameNode.YieldPriceHistory,
		"YieldPriceHistory",
	)) {
		out.push({ turn, yieldType: typeName, price: value });
	}
	return out;
}

// ---------- Player-level: military power ----------

export function parseMilitaryPowerHistory(
	root: Record<string, unknown>,
): MilitaryPowerHistory[] {
	const out: MilitaryPowerHistory[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { turn, value } of parseSparseHistory(
			node.MilitaryPowerHistory,
			"MilitaryPowerHistory",
		)) {
			out.push({ playerXmlId, turn, militaryPower: value });
		}
	}
	return out;
}

// ---------- Player-level: points ----------

export function parsePointsHistory(
	root: Record<string, unknown>,
): PointsHistory[] {
	const out: PointsHistory[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { turn, value } of parseSparseHistory(
			node.PointsHistory,
			"PointsHistory",
		)) {
			out.push({ playerXmlId, turn, points: value });
		}
	}
	return out;
}

// ---------- Player-level: legitimacy ----------

export function parseLegitimacyHistory(
	root: Record<string, unknown>,
): LegitimacyHistory[] {
	const out: LegitimacyHistory[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { turn, value } of parseSparseHistory(
			node.LegitimacyHistory,
			"LegitimacyHistory",
		)) {
			out.push({ playerXmlId, turn, legitimacy: value });
		}
	}
	return out;
}

// ---------- Player-level: yield rates ----------

export function parseYieldRateHistory(
	root: Record<string, unknown>,
): YieldRateHistory[] {
	const out: YieldRateHistory[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { typeName, turn, value } of parseSparseHistoryByType(
			node.YieldRateHistory,
			"YieldRateHistory",
		)) {
			out.push({ playerXmlId, turn, yieldType: typeName, amount: value });
		}
	}
	return out;
}

// ---------- Player-level: yield totals ----------
// Available in game version 1.0.81366+ (January 2026). Older saves silently
// produce zero rows — absence is not an error.

export function parseYieldTotalHistory(
	root: Record<string, unknown>,
): YieldTotalHistory[] {
	const out: YieldTotalHistory[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { typeName, turn, value } of parseSparseHistoryByType(
			node.YieldTotalHistory,
			"YieldTotalHistory",
		)) {
			out.push({ playerXmlId, turn, yieldType: typeName, amount: value });
		}
	}
	return out;
}

// ---------- Player-level: family opinions ----------

export function parseFamilyOpinionHistory(
	root: Record<string, unknown>,
): FamilyOpinionHistory[] {
	const out: FamilyOpinionHistory[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { typeName, turn, value } of parseSparseHistoryByType(
			node.FamilyOpinionHistory,
			"FamilyOpinionHistory",
		)) {
			out.push({ playerXmlId, familyName: typeName, turn, opinion: value });
		}
	}
	return out;
}

// ---------- Player-level: religion opinions ----------

export function parseReligionOpinionHistory(
	root: Record<string, unknown>,
): ReligionOpinionHistory[] {
	const out: ReligionOpinionHistory[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { typeName, turn, value } of parseSparseHistoryByType(
			node.ReligionOpinionHistory,
			"ReligionOpinionHistory",
		)) {
			out.push({
				playerXmlId,
				religionName: typeName,
				turn,
				opinion: value,
			});
		}
	}
	return out;
}

// ---------- ToRow mappers (snake_case wire format) ----------

export function yieldPriceHistoryToRow(
	h: YieldPriceHistory,
): Record<string, unknown> {
	return {
		turn: h.turn,
		yield_type: h.yieldType,
		price: h.price,
	};
}

export function familyOpinionHistoryToRow(
	h: FamilyOpinionHistory,
): Record<string, unknown> {
	return {
		player_xml_id: h.playerXmlId,
		family_name: h.familyName,
		turn: h.turn,
		opinion: h.opinion,
	};
}

export function religionOpinionHistoryToRow(
	h: ReligionOpinionHistory,
): Record<string, unknown> {
	return {
		player_xml_id: h.playerXmlId,
		religion_name: h.religionName,
		turn: h.turn,
		opinion: h.opinion,
	};
}
