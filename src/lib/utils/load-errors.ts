// Error mapping shared by SvelteKit `load` functions.
//
// Loaders own their own 404/403 wording — "Game not found" and "Tournament
// not found" are different pages. The 429 case is the one every rate-limited
// loader answers identically, so it lives here rather than being re-derived
// (or, as on the tournament loaders before #196, forgotten).

import { error } from "@sveltejs/kit";
import { ApiError } from "$lib/api-cloud";

// Re-throw a spent per-IP read budget as a SvelteKit 429.
//
// Every Worker per-IP read budget answers 429 once an IP's hourly bucket is
// full — the ReadEventType ones in cloud/src/read-budget.ts, plus anon_read on
// the public game reads, which predates that gate. Deliberately not enumerated
// here: the list is now five long and went stale twice while it was, and a
// loader needs to know the shape of the failure, not which bucket produced it.
// A loader with no branch for it lets the ApiError fall through unhandled, and
// SvelteKit renders that as a 500 — "Something went wrong", which is both
// untrue and unactionable. Waiting out the rolling hour is the whole remedy,
// so the status and the copy have to say that; a 500 tells the visitor to
// give up and tells us to go looking for a bug that isn't there.
//
// No-op for anything else; call it first and let the caller's own branches
// (and final `throw err`) handle the rest.
export function rethrowRateLimit(err: unknown): void {
	if (err instanceof ApiError && err.status === 429) {
		throw error(429, "Too many requests. Try again in a few minutes.");
	}
}
