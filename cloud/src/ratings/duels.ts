// Reconstruct the decisive 1v1 duels between registered users that the rating
// model runs on, entirely from D1. Two sources:
//
//   1. Tournament matches — both players' user_ids and the winner are
//      snapshotted on tournament_matches, so these are exact.
//   2. Casual games — a single-winner duel played apart, whose roster slots
//      both resolve to a registered user, by looking each slot's online_id up
//      in user_online_ids (player_summaries.online_id, migration 0044).
//
// "Duel" is the repo's word and this uses the repo's test for it:
// COMPOSITION_GAME_IDS_SQL.duel (games-scope.ts), which is two slots, both
// human. Counting only the humans would rate a 2-human 4-AI save as a 1v1,
// which that module argues at length is not a duel. On top of it,
// remoteGameModeSql — a game two people played at one machine is not a result
// the ladder is built from, and hotseat should be excluded by a rule rather
// than by identity resolution happening to fail on it.
//
// Resolution is by online_id and user_id only. Nothing here matches on a
// player's name: an Old World save's display name is whatever the player typed
// that day, and two people who both call themselves "ninja" are not the same
// account. A slot whose online_id maps to no user, or to more than one, is
// simply unresolved and its game is skipped — a rating built on a guessed
// identity is worse than one built on fewer games.
//
// Duels are de-duplicated across both sources by the game's stable
// xml_game_id, so a match that both players uploaded, or that was uploaded
// casually *and* archived into a tournament, counts once. All bulk D1 — no R2,
// no per-game round trips.

import type { QueryableD1 } from "../d1";
import { COMPOSITION_GAME_IDS_SQL, remoteGameModeSql } from "../games-scope";
import { UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL } from "../online-ids";
import type { Duel } from "./glicko2";

export interface ResolvedDuel extends Duel {
	// Dedup key: the game's xml_game_id when there is one, else a synthetic id
	// for a tournament match reported with no save attached.
	key: string;
	// Whether this result is one a visitor could have read for themselves. Only
	// the badges depend on it, and that is the whole reason it is carried: a
	// badge must not be derived from a game nobody outside the pair can see
	// (recommend.ts).
	isPublic: boolean;
}

export interface DuelExtraction {
	duels: ResolvedDuel[];
	// Diagnostics, logged by the nightly rebuild and echoed by the admin
	// trigger — the only visibility an operator has into how much of the game
	// corpus the model actually sees.
	stats: {
		tournament: number;
		casual: number;
		deduped: number;
		casualGamesScanned: number;
		// Decisive duels dropped because a slot resolved to no user…
		unresolvedOpponent: number;
		// …or because its online_id is claimed by more than one account.
		ambiguousOnlineId: number;
	};
}

// online_id -> the single user who owns it, or null for an id two accounts
// claim. Both entries matter: a null tells the caller that the id is claimed
// but unsettled, which the diagnostics count apart from an id nobody linked at
// all.
//
// The ownership rule itself is UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL, shared with
// the played-games leaderboard, so the null case is what is left over rather
// than a second statement of the same judgement.
async function loadOnlineIdIndex(
	db: QueryableD1,
): Promise<Map<string, string | null>> {
	const [linked, owned] = await db.batch<{
		online_id: string;
		user_id: string | null;
	}>([
		db.prepare(
			"SELECT DISTINCT online_id, NULL AS user_id FROM user_online_ids",
		),
		db.prepare(UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL),
	]);
	const index = new Map<string, string | null>();
	for (const r of linked.results ?? []) index.set(r.online_id, null);
	for (const r of owned.results ?? []) index.set(r.online_id, r.user_id);
	return index;
}

// Tournament matches: both user_ids and the winner are already columns. Joined
// to games so a match with an attached save carries that save's xml_game_id and
// can dedup against the casual copy of the same game.
//
// A reported match is public whatever its save's visibility: the bracket and
// the standings publish who played whom and who won, which is exactly what a
// badge may be derived from.
async function tournamentDuels(db: QueryableD1): Promise<ResolvedDuel[]> {
	const rows = await db
		.prepare(
			`SELECT m.match_id, m.slot_a_id, m.slot_a_user_id, m.slot_b_user_id,
			        m.winner_slot_id,
			        substr(COALESCE(m.reported_at, m.created_at), 1, 10) AS dt,
			        g.xml_game_id
			   FROM tournament_matches m
			   LEFT JOIN games g ON g.game_id = m.game_id
			  WHERE m.status IN ('complete', 'forfeit')
			    AND m.slot_a_user_id IS NOT NULL
			    AND m.slot_b_user_id IS NOT NULL
			    AND m.winner_slot_id IS NOT NULL`,
		)
		.all<{
			match_id: string;
			slot_a_id: string;
			slot_a_user_id: string;
			slot_b_user_id: string;
			winner_slot_id: string;
			dt: string | null;
			xml_game_id: string | null;
		}>();

	const out: ResolvedDuel[] = [];
	for (const r of rows.results ?? []) {
		// A slot pair pointing at one account is a data error, not a duel.
		if (r.slot_a_user_id === r.slot_b_user_id) continue;
		out.push({
			key: r.xml_game_id ?? `match:${r.match_id}`,
			date: r.dt ?? "",
			p1: r.slot_a_user_id,
			p2: r.slot_b_user_id,
			winner:
				r.winner_slot_id === r.slot_a_id ? r.slot_a_user_id : r.slot_b_user_id,
			isPublic: true,
		});
	}
	return out;
}

interface HumanSlotRow {
	game_id: string;
	xml_game_id: string;
	uploader_user_id: string | null;
	dt: string | null;
	is_public: number;
	is_uploader: number;
	is_winner: number;
	online_id: string | null;
}

// Casual games. One scan of the roster slots of every duel played apart —
// composition and game mode both asked in the repo's own vocabulary
// (games-scope.ts) — grouped by game in memory so that the one test left, a
// single winner, is applied once here.
async function casualDuels(
	db: QueryableD1,
	onlineIds: Map<string, string | null>,
	stats: DuelExtraction["stats"],
): Promise<ResolvedDuel[]> {
	const rows = await db
		.prepare(
			`SELECT ps.game_id, ps.is_uploader, ps.is_winner, ps.online_id,
			        g.xml_game_id, g.user_id AS uploader_user_id, g.is_public,
			        substr(COALESCE(g.save_date, g.created_at), 1, 10) AS dt
			   FROM player_summaries ps
			   JOIN games g ON g.game_id = ps.game_id
			  WHERE ps.is_human = 1
			    AND ${remoteGameModeSql("g")}
			    AND ps.game_id IN (${COMPOSITION_GAME_IDS_SQL.duel})`,
		)
		.all<HumanSlotRow>();

	const byGame = new Map<string, HumanSlotRow[]>();
	for (const r of rows.results ?? []) {
		const slots = byGame.get(r.game_id);
		if (slots) slots.push(r);
		else byGame.set(r.game_id, [r]);
	}

	const out: ResolvedDuel[] = [];
	for (const slots of byGame.values()) {
		if (slots.filter((s) => s.is_winner === 1).length !== 1) continue;
		stats.casualGamesScanned += 1;

		const resolved: { userId: string; isWinner: boolean }[] = [];
		let ambiguous = false;
		for (const s of slots) {
			// online_id first, for every slot including the uploader's. An
			// observer upload (a tournament admin archiving someone else's save)
			// has no is_uploader slot at all, and even when it does, the id in the
			// save is the better answer than "whoever's account this arrived
			// through". games.user_id is the fallback for the uploader's own slot
			// on a hotseat save, where the roster carries no OnlineID.
			const byOnlineId = s.online_id ? onlineIds.get(s.online_id) : undefined;
			if (byOnlineId === null) ambiguous = true;
			const userId =
				byOnlineId ?? (s.is_uploader === 1 ? s.uploader_user_id : null);
			if (userId) resolved.push({ userId, isWinner: s.is_winner === 1 });
		}

		if (resolved.length !== 2 || resolved[0].userId === resolved[1].userId) {
			if (ambiguous) stats.ambiguousOnlineId += 1;
			else stats.unresolvedOpponent += 1;
			continue;
		}
		const winner = resolved.find((r) => r.isWinner);
		if (!winner) continue;
		out.push({
			key: slots[0].xml_game_id,
			date: slots[0].dt ?? "",
			p1: resolved[0].userId,
			p2: resolved[1].userId,
			winner: winner.userId,
			isPublic: slots[0].is_public === 1,
		});
	}
	return out;
}

// Every ratable duel in D1, de-duplicated by key. A tournament record wins a
// shared key: it is the reported, official result.
export async function extractDuels(db: QueryableD1): Promise<DuelExtraction> {
	const stats: DuelExtraction["stats"] = {
		tournament: 0,
		casual: 0,
		deduped: 0,
		casualGamesScanned: 0,
		unresolvedOpponent: 0,
		ambiguousOnlineId: 0,
	};

	const onlineIds = await loadOnlineIdIndex(db);
	const tournament = await tournamentDuels(db);
	const casual = await casualDuels(db, onlineIds, stats);
	stats.tournament = tournament.length;
	stats.casual = casual.length;

	// A duel with no date can't be placed in a rating period, so it is dropped
	// rather than silently landing in whichever period sorts first.
	const byKey = new Map<string, ResolvedDuel>();
	for (const d of tournament) {
		if (d.date) byKey.set(d.key, d);
	}
	for (const d of casual) {
		if (!d.date) continue;
		const seen = byKey.get(d.key);
		if (seen) {
			// A match one player uploaded publicly and the other privately is a
			// public match — the public upload already published that it
			// happened. Same reading the played-games board takes of a
			// double-uploaded match (stats/handlers.ts).
			if (d.isPublic) seen.isPublic = true;
			stats.deduped += 1;
			continue;
		}
		byKey.set(d.key, d);
	}

	return { duels: [...byKey.values()], stats };
}
