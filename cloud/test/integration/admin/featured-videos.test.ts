// Integration tests for the site-admin featured-videos endpoints — the list,
// the upsert, and the idempotent delete (cloud/src/featured.ts).
//
// Three things are worth pinning here rather than in the unit test beside the
// module: the admin gate (all three are dark to everyone else), that a repeat
// POST refreshes a snapshot instead of failing the PK, and that a DELETE of an
// absent row still succeeds — the star toggle and the Featured tab's Remove can
// both reach a video, and neither should have to know who got there first.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeSiteAdmin, makeUser, type TestUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

const PATH = "/v1/admin/featured-videos";

// One site admin for the file: users.discord_id is unique, and the Worker
// recognizes exactly one. The uploader beside it stands for a featured video
// whose uploader has a Per-Ankh account.
let admin: TestUser;
let uploader: TestUser;

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	admin = await makeSiteAdmin();
	uploader = await makeUser({ displayName: "Linked Creator" });
	// Give the uploader a Discord avatar hash so the read's avatar_url is the
	// per-user CDN path rather than the hashless default, which is the same for
	// everyone and would prove nothing about the join.
	await env.SHARE_DB.prepare(
		"UPDATE users SET avatar_hash = ? WHERE user_id = ?",
	)
		.bind("abc123", uploader.userId)
		.run();
});

// A test's writes are visible to the ones after it in this file, and every case
// here asserts on the whole set — so start each from an empty table (and an
// un-aliased uploader, which the rename case sets) rather than threading unique
// ids through cases that are about ordering and counts.
beforeEach(async () => {
	await env.SHARE_DB.prepare("DELETE FROM featured_videos").run();
	await env.SHARE_DB.prepare("UPDATE users SET alias = NULL WHERE user_id = ?")
		.bind(uploader.userId)
		.run();
});

// A featured-video POST body. The video fields are the snapshot; attribution is
// per-case.
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		platform: "youtube",
		video_id: "vid00000001",
		url: "https://www.youtube.com/watch?v=vid00000001",
		title: "Old World — Assyria opening",
		thumbnail_url: "https://i.ytimg.com/vi/vid00000001/hqdefault.jpg",
		published_at: "2026-07-01T12:00:00Z",
		...over,
	};
}

interface ListBody {
	videos: {
		id: string;
		title: string;
		url: string;
		thumbnail_url: string | null;
		published_at: string;
		platform: string;
		user_id?: string;
		display_name?: string;
		slug?: string | null;
		avatar_url?: string;
		uploader_name?: string;
		uploader_url?: string;
	}[];
}

async function feature(over: Record<string, unknown> = {}): Promise<void> {
	await expectOk(
		await request.post({ path: PATH, as: admin, body: body(over) }),
	);
}

async function list(): Promise<ListBody["videos"]> {
	const res = await expectOk<ListBody>(
		await request.get({ path: PATH, as: admin }),
	);
	return res.videos;
}

describe("featured videos — CORS preflight", () => {
	// These are the first /v1/admin/* calls a browser preflights: a JSON POST
	// and a DELETE both do, while every older admin endpoint is a GET, a
	// bodyless POST, or a multipart upload — requests it sends without asking
	// first. So the admin prefix had never needed a preflight answer at all, and
	// isCloudPath (cloud/src/index.ts) didn't list it, which fell through to the
	// legacy single-origin headers and blocked the call in the browser.
	it("answers with the calling origin, not the legacy one", async () => {
		const res = await SELF.fetch(`http://test${PATH}`, {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:1420",
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "content-type",
			},
		});

		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
			"http://localhost:1420",
		);
		expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
		// The star's unfeature path.
		expect(res.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
	});
});

describe("featured videos — admin gate", () => {
	it("hides all three endpoints from a non-admin", async () => {
		const other = await makeUser();
		await expectErrorCode(await request.get({ path: PATH, as: other }), {
			status: 404,
			code: "NOT_FOUND",
		});
		await expectErrorCode(
			await request.post({ path: PATH, as: other, body: body() }),
			{ status: 404, code: "NOT_FOUND" },
		);
		await expectErrorCode(
			await request.delete({ path: `${PATH}/youtube/vid00000001`, as: other }),
			{ status: 404, code: "NOT_FOUND" },
		);
	});

	it("hides all three endpoints from an anonymous caller", async () => {
		await expectErrorCode(await request.get({ path: PATH }), {
			status: 404,
			code: "NOT_FOUND",
		});
		await expectErrorCode(await request.post({ path: PATH, body: body() }), {
			status: 404,
			code: "NOT_FOUND",
		});
		await expectErrorCode(
			await request.delete({ path: `${PATH}/youtube/vid00000001` }),
			{ status: 404, code: "NOT_FOUND" },
		);
	});

	it("does not write on a rejected POST", async () => {
		const other = await makeUser();
		await request.post({ path: PATH, as: other, body: body() });
		expect(await list()).toEqual([]);
	});
});

describe("featured videos — list", () => {
	it("returns the set newest video first", async () => {
		await feature({
			video_id: "old00000001",
			published_at: "2026-01-01T00:00:00Z",
		});
		await feature({
			video_id: "new00000001",
			published_at: "2026-08-01T00:00:00Z",
		});
		await feature({
			video_id: "mid00000001",
			published_at: "2026-04-01T00:00:00Z",
		});

		expect((await list()).map((v) => v.id)).toEqual([
			"new00000001",
			"mid00000001",
			"old00000001",
		]);
	});

	it("attributes a linked uploader from users at read time", async () => {
		await feature({ user_id: uploader.userId });
		const [video] = await list();
		expect(video).toMatchObject({
			user_id: uploader.userId,
			display_name: "Linked Creator",
		});
		expect(video.avatar_url).toBe(
			`https://cdn.discordapp.com/avatars/${uploader.discordId}/abc123.png`,
		);
	});

	it("reflects a rename without re-featuring the video", async () => {
		await feature({ user_id: uploader.userId });
		// An operator-set alias is what every other read renders (displayNameSql).
		await env.SHARE_DB.prepare("UPDATE users SET alias = ? WHERE user_id = ?")
			.bind("Renamed Creator", uploader.userId)
			.run();

		expect((await list())[0]).toMatchObject({
			display_name: "Renamed Creator",
		});
	});

	it("falls back to the raw YouTube channel when no user is linked", async () => {
		await feature({
			uploader_name: "Some YouTube Channel",
			uploader_url: "https://www.youtube.com/channel/UC123",
		});
		const [video] = await list();
		expect(video).toMatchObject({
			uploader_name: "Some YouTube Channel",
			uploader_url: "https://www.youtube.com/channel/UC123",
		});
		expect(video.user_id).toBeUndefined();
	});

	it("carries no attribution when the video has no author", async () => {
		await feature();
		const [video] = await list();
		expect(video.user_id).toBeUndefined();
		expect(video.uploader_name).toBeUndefined();
	});
});

describe("featured videos — upsert", () => {
	it("refreshes the snapshot on a repeat feature instead of duplicating", async () => {
		await feature({ title: "Original title", thumbnail_url: null });
		await feature({
			title: "Re-titled by the uploader",
			thumbnail_url: "https://i.ytimg.com/vi/vid00000001/maxres.jpg",
		});

		const videos = await list();
		expect(videos).toHaveLength(1);
		expect(videos[0]).toMatchObject({
			title: "Re-titled by the uploader",
			thumbnail_url: "https://i.ytimg.com/vi/vid00000001/maxres.jpg",
		});
	});

	it("clears attribution the second body omits", async () => {
		await feature({ user_id: uploader.userId });
		await feature();
		expect((await list())[0].user_id).toBeUndefined();
	});

	it("rejects a platform with no registered provider", async () => {
		await expectErrorCode(
			await request.post({
				path: PATH,
				as: admin,
				body: body({ platform: "vimeo" }),
			}),
			{ status: 400, code: "INVALID_BODY" },
		);
	});

	it("rejects a non-http(s) url", async () => {
		// Stored and rendered as an href — an unrestricted scheme is stored XSS.
		await expectErrorCode(
			await request.post({
				path: PATH,
				as: admin,
				body: body({ url: "javascript:alert(1)" }),
			}),
			{ status: 400, code: "INVALID_BODY" },
		);
	});

	it("rejects a body with no title", async () => {
		await expectErrorCode(
			await request.post({
				path: PATH,
				as: admin,
				body: body({ title: "  " }),
			}),
			{ status: 400, code: "INVALID_BODY" },
		);
	});
});

describe("featured videos — delete", () => {
	it("removes the video from the set", async () => {
		await feature();
		await expectOk(
			await request.delete({ path: `${PATH}/youtube/vid00000001`, as: admin }),
		);
		expect(await list()).toEqual([]);
	});

	it("succeeds on a video that was never featured", async () => {
		await expectOk(
			await request.delete({ path: `${PATH}/youtube/neverfeatur`, as: admin }),
		);
	});

	it("succeeds twice on the same video", async () => {
		await feature();
		await expectOk(
			await request.delete({ path: `${PATH}/youtube/vid00000001`, as: admin }),
		);
		await expectOk(
			await request.delete({ path: `${PATH}/youtube/vid00000001`, as: admin }),
		);
		expect(await list()).toEqual([]);
	});

	it("leaves the same video id on another platform alone", async () => {
		await feature();
		await expectOk(
			await request.delete({ path: `${PATH}/twitch/vid00000001`, as: admin }),
		);
		expect((await list()).map((v) => v.id)).toEqual(["vid00000001"]);
	});
});
