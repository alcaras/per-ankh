// The profile permalink. Every user is permanently addressable here by id;
// a user who claimed a slug is *canonically* at /u/<slug>, so this route
// 308-redirects to it (the /dashboard precedent — see
// src/routes/dashboard/+page.ts for why 308) and keeps the query string, so
// ?tab= / ?scope= deep links survive the hop. Slug-less users — the default,
// since claiming is opt-in — are served here exactly as before.
//
// The page itself and everything downstream of the profile live in
// $lib/users/profile-load + ProfilePage, shared with /u/[slug].

import { error, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { cloudApi } from "$lib/api-cloud";
import {
	buildProfilePage,
	profileScope,
	rethrowProfileLoadError,
} from "$lib/users/profile-load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url, params, parent }) => {
	const targetUserId = params.user_id;
	if (!/^[A-Za-z0-9_-]{21}$/.test(targetUserId)) {
		throw error(404, "User not found");
	}

	const { user: viewer } = await parent();
	const isOwner = viewer?.user_id === targetUserId;
	const scope = profileScope(url);

	// All three start together, as they always have. The redirect decision
	// needs the profile alone: awaiting all three first would make a slug-holder
	// wait on two responses they're about to discard, while starting the other
	// two only after the profile arrives would cost every slug-less user the
	// parallelism. So — start all three, await the profile, then either redirect
	// (abandoning the other two) or await them together.
	//
	// The no-op .catch is what keeps an abandoned rejection from surfacing as an
	// unhandled rejection. It handles a *derived* promise, so awaiting the
	// originals below still propagates their failures into the catch block.
	const profileP = cloudApi.getUserProfile(targetUserId, { fetch });
	const collectionsP = cloudApi.listCollections({
		fetch,
		userId: targetUserId,
	});
	const bundleP = cloudApi.getUserStats(targetUserId, { fetch, scope });
	collectionsP.catch(() => {});
	bundleP.catch(() => {});

	try {
		const profile = await profileP;
		if (!profile) {
			throw error(404, "User not found");
		}
		if (profile.slug != null) {
			throw redirect(
				308,
				`${resolve("/u/[slug]", { slug: profile.slug })}${url.search}`,
			);
		}

		const [collectionsRes, bundle] = await Promise.all([collectionsP, bundleP]);
		return await buildProfilePage({
			fetch,
			url,
			profile,
			collectionsRes,
			bundle,
			isOwner,
			scope,
		});
	} catch (err) {
		rethrowProfileLoadError(err, url);
	}
};
