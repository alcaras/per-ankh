// /opponents — the signed-in viewer's suggested opponents.
//
// Auth: bounces to /?next=/opponents when signed out, the same way /account
// does. `cloudApi.getMe` swallows a 401 into null, so the check is on the
// result rather than a catch.

import { redirect } from "@sveltejs/kit";
import { cloudApi } from "$lib/api-cloud";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import { loginBounce } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
	const user = await cloudApi.getMe({ fetch });
	if (!user) {
		throw redirect(303, loginBounce(url));
	}

	const suggestions = await cloudApi
		.getMyOpponents({ fetch })
		.catch((err: unknown) => {
			rethrowRateLimit(err);
			throw err;
		});

	return {
		user,
		suggestions,
		meta: {
			title: "Recommended opponents - Per-Ankh",
			description: "Players you should get a close game against.",
		},
	};
};
