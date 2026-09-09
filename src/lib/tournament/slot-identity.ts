import type { BracketResponse, StandingsResponse } from "$lib/api-cloud";

// Per-slot identity lookups (display name / linked user / avatar) keyed by
// slot_id. A slot can appear in both the Swiss standings and the championship
// bracket during the championship phase, so each map unions the two sources —
// the bracket entry wins on overlap (it's the later, more authoritative
// snapshot).
export interface SlotMaps {
	labels: Record<string, string>;
	userIds: Record<string, string | null>;
	// Each linked user's profile slug — the companion to `userIds` that
	// lets a link resolve straight to /u/<slug> instead of the id URL's 307.
	// Null for an unclaimed slot and for an occupant who has none;
	// either way the pair still renders (ProfileLink falls back to the id).
	slugs: Record<string, string | null>;
	avatars: Record<string, string | null>;
	// Each slot's signup answer (timezone/availability), admin-only — null for
	// non-admin viewers and slots that never answered. Only the Swiss standings
	// carry it (the bracket doesn't), so it's keyed off standings alone.
	signupAnswers: Record<string, string | null>;
}

// The standings half of the maps, on its own — everything the Swiss standings
// know about who holds each slot.
//
// Separate from buildSlotMaps because a caller that has no bracket to overlay
// still needs the names: a pending match comes back from
// GET /tournaments/:id/matches with slot_a_display_name / slot_b_display_name
// NULL (the payload snapshots those at report time), so any surface listing
// upcoming sittings has to look the occupants up. The home page's Upcoming
// panel is one, and it reads this rather than passing an empty bracket in —
// a synthetic `{ slots: [] }` would be a shape the API never returns, and
// re-walking the divisions locally would be the same loop twice.
export function slotMapsFromStandings(standings: StandingsResponse): SlotMaps {
	const labels: Record<string, string> = {};
	const userIds: Record<string, string | null> = {};
	const slugs: Record<string, string | null> = {};
	const avatars: Record<string, string | null> = {};
	const signupAnswers: Record<string, string | null> = {};

	for (const div of ["A", "B"] as const) {
		for (const s of standings.divisions[div].standings) {
			if (s.display_name) labels[s.slot_id] = s.display_name;
			userIds[s.slot_id] = s.user_id;
			slugs[s.slot_id] = s.slug;
			avatars[s.slot_id] = s.avatar_url;
			signupAnswers[s.slot_id] = s.signup_answer;
		}
	}

	return { labels, userIds, slugs, avatars, signupAnswers };
}

// Builds the slot identity maps consumed by the match detail popover and the
// schedule rows. Union of per-division Swiss standings and bracket slots; only
// real display names land in `labels` (callers fall back to a truncated slot
// id).
export function buildSlotMaps(
	standings: StandingsResponse,
	bracket: BracketResponse,
): SlotMaps {
	const { labels, userIds, slugs, avatars, signupAnswers } =
		slotMapsFromStandings(standings);

	// The bracket wins on overlap — it's the later, more authoritative
	// snapshot — which is why the overlay runs second rather than the two
	// sources merging. signupAnswers is untouched: the bracket doesn't carry it.
	for (const s of bracket.slots) {
		if (s.display_name) labels[s.slot_id] = s.display_name;
		userIds[s.slot_id] = s.user_id;
		slugs[s.slot_id] = s.slug;
		avatars[s.slot_id] = s.avatar_url;
	}

	return { labels, userIds, slugs, avatars, signupAnswers };
}
