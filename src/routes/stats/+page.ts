// The public global-stats surface: the chart catalog run over the whole
// public corpus rather than one user's library or one tournament's games.
//
// Anonymous — no session, no parent() dependency, nothing viewer-dependent in
// the payload. is_public = 1 is the whole visibility rule server-side, and it
// already covers tournament games (linkTournamentMatch forces the flag), so
// there is no half of this page a signed-in visitor sees differently.
//
// The selection lives entirely in the URL, so a view is linkable and the
// browser's back button walks the slices.

import { cloudApi } from "$lib/api-cloud";
import {
	globalSelectionLabel,
	parseGlobalSlice,
	parseNationFacet,
} from "$lib/stats/global-facets";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
	// Parsed here rather than read raw, so an unknown ?slice= or an off-roster
	// ?nation= lights the control the Worker actually answered with instead of
	// leaving the row pointing at a selection the bundle isn't for.
	const slice = parseGlobalSlice(url.searchParams.get("slice"));
	const nation = parseNationFacet(url.searchParams.get("nation"));

	try {
		const bundle = await cloudApi.getGlobalStats({ fetch, slice, nation });
		const selection = globalSelectionLabel(slice, nation);
		return {
			bundle,
			slice,
			nation,
			meta: {
				title: `${selection} · Global stats - Per-Ankh`,
				description: `Aggregate Old World statistics across every public game on Per-Ankh: ${selection}.`,
			},
		};
	} catch (err) {
		// /stats spends its own per-IP budget (not anon_read), so a 429 here
		// means this surface alone was hammered. Same remedy as everywhere
		// else: wait out the rolling hour.
		rethrowRateLimit(err);
		throw err;
	}
};
