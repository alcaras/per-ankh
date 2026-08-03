// The user-slug rule — what may become the <slug> in per-ankh.app/u/<slug> —
// as plain TypeScript, with no valibot import.
//
// It sits beside schemas/user.ts, which wraps it in a valibot pipe, rather than
// inside it, because the set endpoint is not the only writer of this column:
// `./per-ankh admin set-slug` and `./per-ankh admin backfill-slugs` write it
// too, and must accept exactly what the endpoint accepts. The reserved list is
// an impersonation control and the backfill applies it unattended across every
// existing row, so a drifted copy of it is the failure that matters. valibot is
// a cloud/ dependency and scripts/ can't resolve it, so a rule shared across
// that boundary has to be valibot-free. Sharing the rule and not the wrapper is
// what keeps the regex, the reserved list, the slugifier, and the messages from
// existing twice.

// 3-30 chars: lowercase alphanumerics with internal hyphens. Its own regex
// rather than the exported tournament `slugRegex` (schemas/tournament.ts): the
// same shape by design, but 3-30 chars instead of 1-64 and no trailing hyphen,
// because this one is a person's name in a URL they hand to other people, not a
// machine-derivable label with a disambiguating suffix.
export const userSlugRegex = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

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

// One format check, one message. Splitting the length bound out into
// minLength/maxLength would put the 3-30 rule in two places that can drift,
// and the message below already states the whole rule — which matters because
// the claim endpoint surfaces it to the user verbatim.
export const USER_SLUG_FORMAT_MESSAGE =
	"Profile URL must be 3-30 characters — lowercase letters, numbers, and hyphens — and must start and end with a letter or number";

export const USER_SLUG_RESERVED_MESSAGE = "That profile URL is reserved";

// Trim → lowercase BEFORE validating, so a user may type mixed case (and a
// trailing space from a paste) and still claim the name they meant. The stored
// value is always the normalized one — which is also what makes the unique
// index a case-insensitive uniqueness guarantee and a usable prefix index.
export function normalizeUserSlug(input: string): string {
	return input.trim().toLowerCase();
}

// Why an already-normalized slug can't be claimed, in a message safe to show
// the user, or null when it can. SlugSchema states the same two rules as
// separate valibot actions so each carries its own message; this is the form
// the admin CLI uses, where there is no pipe to hang them on.
export function userSlugError(slug: string): string | null {
	if (!userSlugRegex.test(slug)) return USER_SLUG_FORMAT_MESSAGE;
	if (RESERVED_USER_SLUGS.has(slug)) return USER_SLUG_RESERVED_MESSAGE;
	return null;
}

// A display name reduced to the shape a slug has to have — "Marcus Licinius" →
// "marcus-licinius". This is what gives a new account a profile URL without
// asking for one (cloud/src/auth.ts, on the first-login INSERT) and what fills
// them in for existing rows (`./per-ankh admin backfill-slugs`). Both callers
// run it through userSlugError afterwards and skip the assignment on any
// complaint, so this function's only job is the character rewrite: it is
// allowed to return "" or "ab" or a 40-char string, and never invents
// characters to reach a valid one.
//
// Deliberately no numeric-suffix disambiguation, and no truncation to fit the
// 30-char ceiling. Both would manufacture a name the user never wrote —
// "marcus-licinius-crassu" or "marcus-4" is not what anyone would hand out —
// and no slug is a fine outcome: /users/<user_id> serves every profile, and the
// Settings card is there for a name that didn't survive this.
//
// Whitespace → hyphen happens BEFORE the charset strip, so word boundaries
// survive as separators instead of collapsing ("Two Words" → "two-words", not
// "twowords"). Everything outside [a-z0-9-] is then dropped rather than
// transliterated — a name written in a non-Latin script yields "" and gets no
// slug, which is the honest answer; romanizing it would put a name in a public
// URL that its owner didn't write.
export function slugifyDisplayName(displayName: string): string {
	return displayName
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
}
