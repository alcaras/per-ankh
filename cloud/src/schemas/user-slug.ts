// The user-slug rule — what may become the <slug> in per-ankh.app/u/<slug> —
// as plain TypeScript, with no valibot import.
//
// It sits beside schemas/user.ts, which wraps it in a valibot pipe, rather than
// inside it, because the claim endpoint is not the only writer of this column:
// `./per-ankh admin set-slug` writes it too, and must accept exactly what the
// endpoint accepts. An operator minting a name the endpoint would have refused
// is permanent — the user can't change it — and the reserved list is an
// impersonation control, so a drifted copy of it is the failure that matters.
// valibot is a cloud/ dependency and scripts/ can't resolve it, so a rule
// shared across that boundary has to be valibot-free. Sharing the rule and not
// the wrapper is what keeps the regex, the reserved list, and the messages from
// existing twice.

// 3-30 chars: lowercase alphanumerics with internal hyphens. Its own regex
// rather than the exported tournament `slugRegex` (schemas/tournament.ts): the
// same shape by design, but 3-30 chars instead of 1-64 and no trailing hyphen,
// because this one is a name a person picks once for themselves and then can't
// change, not a machine-derivable label with a disambiguating suffix.
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
