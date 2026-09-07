// The /players page's season arithmetic and its URL vocabulary, in one place.
//
// It lives beside the route rather than in `$lib` because nothing outside
// /players has a season, and it is a plain module rather than part of
// `+page.ts` because SvelteKit rejects any runtime export from a `+page.ts`
// but its own — which is what previously forced the load and the component to
// spell `ALL_BOARD` twice and normalize a URL twice, with the component's
// write guard and swap check both depending on the two copies agreeing.

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
export const ALL_BOARD = "all";
export type Board = "season" | "all";

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
//
// The epoch season is emitted before the clock is consulted, so the list is
// never empty and `seasons[seasons.length - 1]` is always a season. `now` is
// the *visitor's* clock here — this is a universal load, so on client
// navigation the browser supplies it — and a clock set before June 2026 would
// otherwise hand every caller an empty array to index into. Skew the other
// way is harmless: it adds seasons that no game can have landed in yet.
export function allSeasons(now = new Date()): Season[] {
	const out: Season[] = [seasonAt(EPOCH.year, EPOCH.index)];
	let y = EPOCH.year;
	let i = EPOCH.index;
	const today = now.toISOString().slice(0, 10);
	for (;;) {
		i++;
		if (i === 4) {
			i = 0;
			y++;
		}
		const s = seasonAt(y, i);
		if (s.since > today) break;
		out.push(s);
	}
	return out;
}

// The view a URL actually names. An absent `?season=`, an unknown slug and
// the current season's own slug are three spellings of one season, and
// anything but `?board=all` is the season board — so the load, the
// component's no-op write guard and its swap check all read a URL through
// this one function and none of them can mistake a respelling for a change.
//
// The career board still resolves a season — the stepper keeps its label, and
// switching back to Season returns to it rather than to today's — which is
// what reading the two from separate params buys.
export function resolveSelection(
	url: URL,
	seasons: Season[],
): { board: Board; selected: Season } {
	const slug = url.searchParams.get("season");
	return {
		board: url.searchParams.get("board") === ALL_BOARD ? "all" : "season",
		selected:
			seasons.find((s) => s.slug === slug) ?? seasons[seasons.length - 1],
	};
}

// A selection as one comparable value, for the guards that ask only whether
// two URLs name the same board.
export function selectionKey(sel: { board: Board; selected: Season }): string {
	return `${sel.board}:${sel.selected.slug}`;
}
