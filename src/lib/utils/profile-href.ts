import { resolve } from "$app/paths";

// The one place a player-profile URL is built. Every link site goes through it,
// so what a profile URL looks like is decided once rather than at each of the
// dozen-odd surfaces that name a player.
//
// It takes the identity object a payload already carries rather than a bare id
// because the URL has two shapes: a user who claimed a profile slug is at
// `/u/<slug>`, everyone else at their permanent `/users/[user_id]` permalink.
// Call sites pass whatever row they hold and never have to learn which applies.
//
// A payload that doesn't carry `slug` yet is not a bug — it emits the id URL,
// which 307-redirects to `/u/<slug>` for a slug-holder (see
// src/routes/users/[user_id]/+page.ts). That fallback is what lets each payload
// gain the field on its own schedule (issue #186 B5b) instead of all at once.
export function profileHref(p: {
	user_id: string;
	slug?: string | null;
}): string {
	return p.slug != null
		? resolve("/u/[slug]", { slug: p.slug })
		: resolve("/users/[user_id]", { user_id: p.user_id });
}
