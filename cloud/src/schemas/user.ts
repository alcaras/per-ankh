// Valibot schemas for the user's own account: the /v1/auth/settings
// preferences and the /v1/users/me/slug profile-URL claim.

import * as v from "valibot";

import { StreamUrlSchema } from "./tournament";

// User-editable account preferences. Every field is optional so a caller
// updates only what it sends (see handleSettings in cloud/src/auth.ts):
//   - default_game_public: visibility applied to newly uploaded saves (the
//     fresh-upload branch in cloud/src/games.ts).
//   - stream_url: the user's casting stream link (twitch/youtube, same
//     allowlist as match-part streams). Auto-attached when they take the
//     streamer slot on a match part; null clears it (no auto-attach).
export const UserSettingsSchema = v.object({
	default_game_public: v.optional(v.boolean()),
	stream_url: v.optional(v.nullable(StreamUrlSchema)),
});

export type UserSettings = v.InferOutput<typeof UserSettingsSchema>;

// The user slug — the <slug> in per-ankh.app/u/<slug>. Its own regex rather
// than the exported tournament `slugRegex` (schemas/tournament.ts): the same
// shape by design, but 3-30 chars instead of 1-64 and no trailing hyphen,
// because this one is a name a person picks once for themselves and then
// can't change, not a machine-derivable label with a disambiguating suffix.
const userSlugRegex = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

// Reserved for impersonation and brand reasons ONLY — not route safety. The
// tournament list (RESERVED_SLUGS, tournament/admin.ts) holds segments that
// could collide with a route under /tournaments/; under /u/ nothing can
// collide by construction, so a route-derived entry here would restrict a
// legitimate name for nothing. Deliberately not the tournament set, and
// deliberately short: the risk being priced is a profile that reads as
// official, not a URL that breaks.
//
// "me" is doubly covered — the 3-char floor rejects it before this check runs
// — and is listed anyway so the set reads as the complete brand hold rather
// than "the brand holds that happen to be 3+ characters".
export const RESERVED_USER_SLUGS = new Set([
	"admin",
	"staff",
	"moderator",
	"support",
	"me",
	"per-ankh",
	"perankh",
]);

// Trim → lowercase BEFORE validating, so a user may type mixed case (and a
// trailing space from a paste) and still claim the name they meant. The stored
// value is always the normalized one — which is also what makes the unique
// index a case-insensitive uniqueness guarantee and a usable prefix index.
//
// One format check, one message. Splitting the length bound out into
// minLength/maxLength would put the 3-30 rule in two places that can drift,
// and the message below already states the whole rule — which matters because
// the claim endpoint surfaces it to the user verbatim.
export const SlugSchema = v.pipe(
	v.string(),
	v.trim(),
	v.toLowerCase(),
	v.regex(
		userSlugRegex,
		"Profile URL must be 3-30 characters — lowercase letters, numbers, and hyphens — and must start and end with a letter or number",
	),
	v.check(
		(slug) => !RESERVED_USER_SLUGS.has(slug),
		"That profile URL is reserved",
	),
);

// The claim request envelope. The field is a bare string here, validated
// against SlugSchema by the handler, so a malformed *body* (missing key, wrong
// type) and an invalid *slug* stay distinguishable on the wire — see
// handleClaimSlug in cloud/src/users.ts.
export const ClaimSlugSchema = v.object({
	slug: v.string(),
});
