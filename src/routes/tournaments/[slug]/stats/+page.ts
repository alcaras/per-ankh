import { cloudApi } from "$lib/api-cloud";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import type { PageLoad } from "./$types";

// Tournament stats view. The tournament itself comes from the [slug] layout
// load; the two stats payloads are fetched here (Plane A competition + Plane B1
// save-content). Public and setup-gated: a pre-signup setup tournament already
// 404s from the layout's getTournament, so a reachable page always has visible
// stats. Both reads are independent → fetched in parallel.
export const load: PageLoad = async ({ parent, fetch }) => {
	const { tournament } = await parent();
	// Both reads draw on the per-IP tournament_view budget. The layout's own
	// reads got there first, so in practice this only fires when the budget
	// runs out between the two loads — still a 429, not a 500. Everything else
	// propagates unchanged.
	try {
		const [competition, games] = await Promise.all([
			cloudApi.getTournamentStats(tournament.tournament_id, { fetch }),
			cloudApi.getTournamentGamesStats(tournament.tournament_id, { fetch }),
		]);
		return {
			competition,
			games,
			meta: {
				title: `${tournament.name} · Stats - Per-Ankh`,
				description: `Statistics for ${tournament.name} on Per-Ankh.`,
			},
		};
	} catch (err) {
		rethrowRateLimit(err);
		throw err;
	}
};
