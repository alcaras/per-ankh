// Tournament rate-limit ceilings. Hardcoded, except the three per-IP read
// ceilings (tournamentViewPerHour / tournamentListViewPerHour /
// tournamentLinkViewPerHour below) — the "operators need to retune during a
// live event" case this file anticipated actually happened, so those are
// wrangler vars with the constants as their defaults.
//
// Those three are separate budgets because they are drawn on by three
// different populations. A shared budget means the busiest surface decides
// when the others start refusing, and the surface with the most traffic is
// never the one you meant to protect: /games/* crawling took the tournament
// pages down on 2026-08-05, and the home page's tournament strip is a larger
// caller than /tournaments itself. When adding a public read, give it the
// budget of the page it is fetched by, not of the feature it belongs to.

import { ceilingFrom } from "../read-budget";

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

// Per-IP budget for the tournament page reads: detail, standings, bracket,
// rounds, matches, match detail, both stats endpoints, and the profile
// Tournaments tab. Scraper User-Agents bypass.
//
// Counted in *reads*, and every read charges — there is no cheaper class of
// read and no caller who pays less (see enforceReadRateLimit). A cold
// /tournaments/[slug] makes four; the stats page makes six. So this number is
// roughly 600 tournament page loads an hour, or 400 of the stats page, and it
// means the same thing whether the visitor arrived by a server-rendered load
// or by clicking through a hydrated one.
//
// 2400 rather than the 600 it was through #196: at 600 reads a visitor met the
// ceiling after ~150 page loads, which is reachable by browsing and is the
// reason the number needed rethinking at all. The alternative was to charge a
// page load once and let its sub-resources ride along free on our own SSR
// Worker — same headroom, but the ceiling then meant reads to one caller and
// page loads to another, and the rate limiter had to know who was asking.
// Multiplying the number gets the headroom without either.
//
// Deliberately *not* the tournament list read — see
// TOURNAMENT_LIST_VIEW_PER_HOUR.
//
// The default only — read the effective ceiling with tournamentViewPerHour().
export const TOURNAMENT_VIEW_PER_HOUR = 2400;

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
	return ceilingFrom(
		env.TOURNAMENT_VIEW_PER_HOUR,
		TOURNAMENT_VIEW_PER_HOUR,
		"TOURNAMENT_VIEW_PER_HOUR",
	);
}

// Per-IP budget for the tournament list read (GET /v1/tournaments). Its own
// budget, deliberately not the tournament pages' one: the list is fetched by
// the home page on every render (src/routes/+page.ts) as well as by
// /tournaments, and the home page is the busiest surface on the site. Sharing
// means ordinary landing-page traffic decides when /tournaments/[slug] starts
// refusing — the same coupling that took the tournament pages down on
// 2026-08-05 with /games/* as the busy surface instead.
//
// Not folded into anon_read either, for the reason the link read isn't: the
// home page calls both, so sharing would spend one visitor's landing-page
// budget twice over.
//
// Stays at 600 where the view ceiling is 2400, because the arithmetic differs,
// not the generosity: this is one read per page load, so 600 is 600 loads —
// the same headroom the view budget needs four reads each to reach.
//
// The default only — read the effective ceiling with tournamentListViewPerHour().
export const TOURNAMENT_LIST_VIEW_PER_HOUR = 600;

// Effective per-IP list ceiling, on the same lever as the other two. This is
// the one whose exhaustion is most visible to an ordinary visitor — it empties
// the home page's tournament strip — so it is also the one most likely to want
// moving mid-event.
export function tournamentListViewPerHour(env: {
	TOURNAMENT_LIST_VIEW_PER_HOUR?: string;
}): number {
	return ceilingFrom(
		env.TOURNAMENT_LIST_VIEW_PER_HOUR,
		TOURNAMENT_LIST_VIEW_PER_HOUR,
		"TOURNAMENT_LIST_VIEW_PER_HOUR",
	);
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
		"TOURNAMENT_LINK_VIEW_PER_HOUR",
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
