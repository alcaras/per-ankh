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
// Every Worker read limiter (anon_read, tournament_view,
// tournament_link_view) answers 429 once an IP's hourly bucket is full. A
// loader with no branch for it lets the ApiError fall through unhandled,
// which SvelteKit renders as a 500 — and a 500 gets cached by CDNs where a
// 429 doesn't, so the error outlives the rolling window that clears the
// limit. Reloading is the user's only remedy, so the status has to say so.
//
// No-op for anything else; call it first and let the caller's own branches
// (and final `throw err`) handle the rest.
export function rethrowRateLimit(err: unknown): void {
	if (err instanceof ApiError && err.status === 429) {
		throw error(429, "Too many requests. Try again in a few minutes.");
	}
}
