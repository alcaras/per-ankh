import { logError } from "./log";
import { slugifyDisplayName, userSlugError } from "./schemas/user-slug";
import type { QueryableD1 } from "./d1";

// The display name shown for a user across the API: an operator-set `alias`
// overrides the Discord-sourced `display_name`. `t` is the table alias used in
// the surrounding query (e.g. "u", "users"). Alias the result back to
// display_name so response shapes/types stay unchanged.
export const displayNameSql = (t: string): string =>
	`COALESCE(${t}.alias, ${t}.display_name)`;

// Give a brand-new account its profile URL, derived from the name it already
// shows everywhere. Called by both login paths (cloud/src/auth.ts) on the
// first-login INSERT and nowhere else — see below for why "first login only" is
// the whole design and not an optimization.
//
// `displayName` must be the EFFECTIVE name — the COALESCE above, which is what
// every public payload renders. Both callers pass the value their upsert's
// RETURNING already projected, so there is no second read and no chance of
// deriving from a name the site doesn't show.
//
// Never runs on the update path. If it did, "no slug" would stop being a state
// a user can hold: unsetting through DELETE /v1/users/me/slug would silently
// re-derive on their next login, and a rename would be undone the same way for
// anyone whose chosen name happens to slugify differently from their display
// name. First-login-only is what makes both stick.
//
// Returns the assigned slug, or null when the name didn't survive
// slugification (empty/short/long/reserved), when the name is taken, or when
// the write failed. Every one of those is a normal outcome: NULL is a state the
// whole slug surface already handles, the profile stays served at
// /users/<user_id>, and the Settings card is the escape hatch. Which is also
// why nothing here throws — a slug is never worth failing a login over.
//
// `slug_changed_at` stays NULL: this name was issued, not chosen, so it must
// not spend the rename cooldown the user hasn't used yet (see migration 0040).
export async function assignDerivedUserSlug(
	db: QueryableD1,
	userId: string,
	displayName: string,
): Promise<string | null> {
	const slug = slugifyDisplayName(displayName);
	if (userSlugError(slug) !== null) return null;

	try {
		// NOT EXISTS keeps the ordinary collision — two players called "Marcus"
		// — off the error path, where it would land as a raised UNIQUE violation
		// mid-login. A true race between two simultaneous first logins still
		// raises, hence the catch: same outcome (no slug), just not free.
		const result = await db
			.prepare(
				`UPDATE users SET slug = ?
				 WHERE user_id = ? AND slug IS NULL
				   AND NOT EXISTS (SELECT 1 FROM users WHERE slug = ?)`,
			)
			.bind(slug, userId, slug)
			.run();
		return (result.meta?.changes ?? 0) > 0 ? slug : null;
	} catch (e) {
		logError("derived_slug_assign_failed", e, { user_id: userId });
		return null;
	}
}
