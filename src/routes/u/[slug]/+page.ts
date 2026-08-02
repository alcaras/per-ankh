// The profile at its claimed pretty URL — the canonical address for a user
// who has one. /users/[user_id] stays the permanent permalink and 308s here.
//
// Name-first lookup costs one serialized round trip the id route doesn't pay:
// the collections + stats fetches are keyed by user_id, which only the profile
// response carries, so they can't start until it lands. That's the price of the
// pretty URL and it's paid only on this route.
//
// The page itself and everything downstream of the profile live in
// $lib/users/profile-load + ProfilePage, shared with /users/[user_id].

import { error } from "@sveltejs/kit";
import { cloudApi } from "$lib/api-cloud";
import {
	buildProfilePage,
	profileScope,
	rethrowProfileLoadError,
	USER_SLUG_RE,
} from "$lib/users/profile-load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url, params, parent }) => {
	const slug = params.slug;
	// Nothing outside the claim format is ever a stored slug, so a junk URL is
	// a 404 here rather than a round trip that would 404 anyway.
	if (!USER_SLUG_RE.test(slug)) {
		throw error(404, "User not found");
	}

	const { user: viewer } = await parent();
	const scope = profileScope(url);

	try {
		const profile = await cloudApi.getUserProfileBySlug(slug, { fetch });
		if (!profile) {
			throw error(404, "User not found");
		}

		const [collectionsRes, bundle] = await Promise.all([
			cloudApi.listCollections({ fetch, userId: profile.user_id }),
			cloudApi.getUserStats(profile.user_id, { fetch, scope }),
		]);
		return await buildProfilePage({
			fetch,
			url,
			profile,
			collectionsRes,
			bundle,
			isOwner: viewer?.user_id === profile.user_id,
			scope,
		});
	} catch (err) {
		rethrowProfileLoadError(err, url);
	}
};
