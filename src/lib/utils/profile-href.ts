import { resolve } from "$app/paths";

// The one place a player-profile URL is built. Every link site goes through it,
// so what a profile URL looks like is decided once rather than at each of the
// dozen-odd surfaces that name a player.
//
// It takes the identity object a payload already carries rather than a bare id
// because that URL is about to gain a second shape: issue #186 Part B adds
// user-chosen slugs served at `/u/<slug>`, and this function is where that
// branch lands (`slug ? /u/[slug] : /users/[user_id]`). Call sites pass whatever
// row they hold and never have to learn which shape applies. Until then every
// profile resolves to its permanent `/users/[user_id]` permalink, which stays
// valid afterwards — Part B 308-redirects it.
export function profileHref(p: {
	user_id: string;
	slug?: string | null;
}): string {
	return resolve("/users/[user_id]", { user_id: p.user_id });
}
