// Public /players page — the games-played leaderboard. Anonymous endpoint,
// same audience as the home discovery feed. Which board is shown lives
// entirely in the query string, so a view is linkable and the browser's
// back button walks the boards. Past seasons are closed windows the archive
// keeps forever.
import { cloudApi } from "$lib/api-cloud";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import type { PageLoad } from "./$types";

export interface Season {
	name: string;
	year: number;
	label: string; // "Summer 2026"
	range: string; // "Jun–Aug"
	slug: string; // "summer-2026"
	since: string; // inclusive YYYY-MM-DD
	until: string; // exclusive YYYY-MM-DD
}

// The board and the season are two independent selections, so they get two
// params: `?board=all` names the career board, `?season=<slug>` names the
// season. They cannot share one slot. Folding the career board into the
// season param (`?season=all-time`, as this page first did) meant switching
// boards *overwrote* the season — `all-time` matches no season, so the
// selection fell back to the current one and coming back landed you
// somewhere you had never been.
//
// Each default is spelled by absence — the season board and the current
// season each drop their param — so the default view has one canonical URL,
// and so one edge-cache entry rather than several spellings of it. Same rule
// GlobalFacetRow and ScopeRow follow.
//
// Not exported — SvelteKit rejects any runtime export from a `+page.ts` but
// its own, so +page.svelte spells the same value literally.
const ALL_BOARD = "all";
type Board = "season" | "all";

// Seasons follow the meteorological quarters the community actually says
// out loud: Spring Mar–May, Summer Jun–Aug, Fall Sep–Nov, Winter Dec–Feb
// (owned by the year it starts in, so Jan/Feb 2027 are still Winter 2026).
// Seasons exist from per-ankh's first, Summer 2026; earlier games live
// only in all-time.
const SEASON_DEFS = [
	{ name: "Spring", startMonth: 2, range: "Mar–May" },
	{ name: "Summer", startMonth: 5, range: "Jun–Aug" },
	{ name: "Fall", startMonth: 8, range: "Sep–Nov" },
	{ name: "Winter", startMonth: 11, range: "Dec–Feb" },
] as const;
const EPOCH = { year: 2026, index: 1 }; // Summer 2026

function seasonAt(year: number, index: number): Season {
	const def = SEASON_DEFS[index];
	const sinceY = year;
	const sinceM = def.startMonth + 1;
	// Exclusive end: three months on (Winter rolls into the next year).
	const untilY = index === 3 ? year + 1 : year;
	const untilM = index === 3 ? 3 : def.startMonth + 4;
	return {
		name: def.name,
		year,
		label: `${def.name} ${year}`,
		range: def.range,
		slug: `${def.name.toLowerCase()}-${year}`,
		since: `${sinceY}-${String(sinceM).padStart(2, "0")}-01`,
		until: `${untilY}-${String(untilM).padStart(2, "0")}-01`,
	};
}

// Every season from the epoch through today, chronological — the picker's
// list. Grows by itself as time passes; no deploy rolls a season over.
function allSeasons(now = new Date()): Season[] {
	const out: Season[] = [];
	let y = EPOCH.year;
	let i = EPOCH.index;
	const today = now.toISOString().slice(0, 10);
	for (;;) {
		const s = seasonAt(y, i);
		if (s.since > today) break;
		out.push(s);
		i++;
		if (i === 4) {
			i = 0;
			y++;
		}
	}
	return out;
}

export const load: PageLoad = async ({ fetch, url }) => {
	const seasons = allSeasons();
	// Parsed here rather than read raw in the component, so the board the
	// page renders and the board the <title> claims are the one decision.
	// The career board still carries a season — the stepper keeps its label,
	// and the crowns the board hides are that season's when you come back —
	// which is what reading the two from separate params buys.
	const board: Board =
		url.searchParams.get("board") === ALL_BOARD ? "all" : "season";
	const slug = url.searchParams.get("season");
	const selected =
		seasons.find((s) => s.slug === slug) ?? seasons[seasons.length - 1];
	try {
		const [allTime, seasonBoard] = await Promise.all([
			cloudApi.getPlayerLeaderboard({ fetch }),
			cloudApi.getPlayerLeaderboard({
				fetch,
				since: selected.since,
				until: selected.until,
			}),
		]);
		return {
			allTime: allTime.players,
			season: seasonBoard.players,
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
		// so a 429 here means this surface alone was hammered — and it costs
		// two slots a load, so an archive walk is what reaches the ceiling.
		// Same remedy as everywhere else: wait out the rolling hour. Without
		// this the ApiError falls through and SvelteKit renders a 500.
		rethrowRateLimit(err);
		throw err;
	}
};
