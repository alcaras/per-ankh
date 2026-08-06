// Tournament rate-limit ceilings. Hardcoded, except the two per-IP read
// ceilings (tournamentViewPerHour / tournamentLinkViewPerHour below) — the
// "operators need to retune during a live event" case this file anticipated
// actually happened, so those are wrangler vars with the constants as their
// defaults.

// Per-user admin mutation budget. Spec said 30/hour/tournament; we
// simplified to per-user because the threat model (stolen admin
// session) is identical at our 4-admin-per-tournament scale.
export const TOURNAMENT_ADMIN_ACTIONS_PER_HOUR = 30;

// Per-user budget for match scheduling edits (scheduled time, stream link,
// caster). Separate from the admin budget because participants — not just
// admins — can schedule their own matches, and a participant has no admin
// budget to draw from. Generous: setting a time/stream/caster on a match is a
// handful of edits per match per player.
export const TOURNAMENT_SCHEDULE_ACTIONS_PER_HOUR = 60;

// Per-IP budget for anonymous tournament reads (list/detail/standings/
// bracket/rounds/matches/match-detail). Scraper User-Agents bypass.
//
// The default only — read the effective ceiling with tournamentViewPerHour().
export const TOURNAMENT_VIEW_PER_HOUR = 600;

// A ceiling read off an env var, falling back to the compiled-in default.
// Shared by both read budgets so the two can't drift in how they parse.
//
// Number(), not parseInt(): parseInt("600 per hour") is 600, which would let a
// mangled value silently pass as a deliberate one. Anything below one whole
// read is treated as unset rather than "refuse everything" — a fat-fingered 0
// during an incident would 429 the whole surface, which is the outage these
// knobs exist to shorten, and so would a slipped decimal point: the gate is
// `count >= limit`, so 0.5 refuses every read after the first exactly as 0
// refuses every read at all. Integers only, for the same reason — a ceiling of
// 1.5 is 2 to the gate and 1.5 to whoever reads it back.
function ceilingFrom(raw: string | undefined, fallback: number): number {
	const parsed = Number(raw);
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

// Effective per-IP tournament view ceiling: the TOURNAMENT_VIEW_PER_HOUR var
// when it parses, the constant above otherwise.
//
// The var exists so an operator can retune mid-event without a redeploy —
// `npx wrangler secret put TOURNAMENT_VIEW_PER_HOUR` takes effect immediately,
// the same lever UPLOADS_ENABLED documents. It lasts until the next deploy,
// which puts the wrangler.toml value back — the caveat is on the vars there.
// Unset behaves exactly as the constant did when it was the only source.
export function tournamentViewPerHour(env: {
	TOURNAMENT_VIEW_PER_HOUR?: string;
}): number {
	return ceilingFrom(env.TOURNAMENT_VIEW_PER_HOUR, TOURNAMENT_VIEW_PER_HOUR);
}

// Per-IP budget for the game→tournament link read
// (GET /v1/games/:id/tournament-link). Its own budget, deliberately not the
// tournament one: every /games/[id] render calls it whether or not the game is
// linked, so on the tournament budget a crawl of game pages spends the
// tournament pages' allowance and takes /tournaments/* down with it — which is
// exactly what happened on 2026-08-05.
//
// Set above ANON_READS_PER_HOUR (200, the anonymous ceiling on the game read
// this one accompanies) so it is never the limit a real visitor meets first;
// it is a backstop on an endpoint that would otherwise be unmetered, not a
// constraint on browsing. When it does fire, the game page's loader already
// swallows the failure and hides the tournament banner.
//
// The default only — read the effective ceiling with tournamentLinkViewPerHour().
export const TOURNAMENT_LINK_VIEW_PER_HOUR = 600;

// Effective per-IP link ceiling, tunable on the same lever as the view one
// above. Splitting the budgets is what keeps a game-page crawl off the
// tournament pages; it doesn't stop the crawl from draining *this* budget, and
// then every server-rendered game page loses its tournament banner until the
// hour rolls. That's the case where an operator wants this number moved, and
// it's the same incident — so the knob has to be here too, not a redeploy away.
export function tournamentLinkViewPerHour(env: {
	TOURNAMENT_LINK_VIEW_PER_HOUR?: string;
}): number {
	return ceilingFrom(
		env.TOURNAMENT_LINK_VIEW_PER_HOUR,
		TOURNAMENT_LINK_VIEW_PER_HOUR,
	);
}

// Per-user budget for tournament creation. Tighter than admin mutations:
// creating a tournament adds rows + an admin row + squats a slug, and
// the legitimate use case (an organizer setting up a new event) is rare
// enough that 5/hour is generous. Spam at this rate is bounded by the
// cost of acquiring Discord accounts.
export const TOURNAMENT_CREATE_PER_USER_PER_HOUR = 5;

// Per-user budget for the TO-only CSV export. The work is cheap (bounded D1
// reads, no R2), so this is a runaway-client backstop rather than a real
// constraint — and every call writes a 'tournament_export' audit event, so
// the counter doubles as an export log. 30/hour is generous for an organizer
// pulling results.
export const TOURNAMENT_EXPORT_PER_HOUR = 30;
