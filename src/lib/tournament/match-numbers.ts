import type { TournamentMatch } from "$lib/api-cloud";
import { matchStatusGroup } from "./matches-table";

// Global, stable "Match N" numbering across a whole tournament, shared by the
// matches table, the bracket cards, the match popover, and the sesh export so
// every surface agrees.
//
// Numbered over real (non-bye) matches in a stable order — phase, then round,
// then division (A, B), then the within-round position — so generating a later
// round APPENDS new numbers without renumbering earlier matches (important:
// admins ping players with "Match 12", and that number must never change).
//
// `match_index` isn't exposed on the client `TournamentMatch`, so the
// within-round position is recovered from the API's list order (it already
// sorts by …, round_number, match_index).

const PHASE_ORDER: Record<string, number> = { swiss: 0, championship: 1 };
const DIVISION_ORDER: Record<string, number> = { A: 0, B: 1 };

export function matchNumbers(matches: TournamentMatch[]): Map<string, number> {
	const seqByGroup = new Map<string, number>();
	const real = matches
		.filter((m) => matchStatusGroup(m) !== null)
		.map((m) => {
			const key = `${m.phase ?? ""}|${m.round_number ?? 0}|${m.division ?? ""}`;
			const seq = (seqByGroup.get(key) ?? 0) + 1;
			seqByGroup.set(key, seq);
			return { m, seq };
		});
	real.sort(
		(a, b) =>
			(PHASE_ORDER[a.m.phase ?? ""] ?? 9) -
				(PHASE_ORDER[b.m.phase ?? ""] ?? 9) ||
			(a.m.round_number ?? 0) - (b.m.round_number ?? 0) ||
			(DIVISION_ORDER[a.m.division ?? ""] ?? 9) -
				(DIVISION_ORDER[b.m.division ?? ""] ?? 9) ||
			a.seq - b.seq,
	);
	const map = new Map<string, number>();
	real.forEach((x, i) => map.set(x.m.match_id, i + 1));
	return map;
}

// Zero-padded display form, e.g. 1 -> "001". Width grows past 999 if needed.
export function padMatchNumber(n: number | undefined | null): string {
	return n == null ? "" : String(n).padStart(3, "0");
}
