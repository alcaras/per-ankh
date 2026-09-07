// Public /players page — the games-played leaderboard. Anonymous endpoint,
// same audience as the home discovery feed. Which board is shown lives
// entirely in the query string, so a view is linkable and the browser's
// back button walks the boards. Past seasons are closed windows the archive
// keeps forever.
//
// The season arithmetic and the URL vocabulary live in ./seasons, shared with
// +page.svelte so the board this load fetches and the board the component
// draws controls for are one decision.
import { cloudApi } from "$lib/api-cloud";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import { allSeasons, resolveSelection } from "./seasons";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
	const seasons = allSeasons();
	// Parsed here rather than read raw in the component, so the board the
	// page renders and the board the <title> claims are the one decision.
	const { board, selected } = resolveSelection(url, seasons);
	try {
		// One board, one read. Fetching both and rendering one used to look
		// like it bought an instant switch, but it never could: the board is
		// in the URL, so switching re-runs this load and re-fetches from
		// scratch either way. The second board was two D1 executions and two
		// season_view slots a load for something no render ever read.
		const { players } = await cloudApi.getPlayerLeaderboard({
			fetch,
			...(board === "all"
				? {}
				: { since: selected.since, until: selected.until }),
		});
		return {
			players,
			seasons,
			selected,
			board,
			meta: {
				// The board is addressable, so the title has to name the one
				// that is addressed — an all-time link that unfurls as a
				// season is a link to the wrong page.
				title: `Players · ${board === "all" ? "All time" : selected.label} - Per-Ankh`,
				description:
					board === "all"
						? "Games played by player across every public game on Per-Ankh, all time."
						: `Games played by player across every public game on Per-Ankh: ${selected.label} (${selected.range}).`,
			},
		};
	} catch (err) {
		// /players spends its own per-IP budget (season_view, not anon_read),
		// so a 429 here means this surface alone was hammered — an archive
		// walk is what reaches the ceiling. Same remedy as everywhere else:
		// wait out the rolling hour. Without this the ApiError falls through
		// and SvelteKit renders a 500.
		rethrowRateLimit(err);
		throw err;
	}
};
