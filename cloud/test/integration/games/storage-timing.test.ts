// Integration coverage for the per-request D1/R2 timing on the access log
// (cloud/src/log.ts, cloud/src/d1.ts, issue #150).
//
// These go through SELF.fetch, so they run through the real fetch envelope and
// through routeEnv — which is where both D1 handles are wrapped. That's the
// point of testing it here: a test that hand-builds an env and calls a handler
// directly gets unwrapped handles by construction and would prove nothing
// about the coverage.
//
// The anonymous read on GET /v1/games/:id is the route issue #150 is about, and
// its query set is exactly known: one games-row read on SHARE_DB, and on
// EVENTS_DB the rate-limit count plus the fire-and-forget audit insert.
//
// Interval algebra lives in src/log.test.ts, wrapper semantics in src/d1.test.ts.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";
import { seedGame } from "../../helpers/games";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// The shared `request` helper sends no User-Agent, and only one test here needs
// one — same reason anon-read-rate-limit.test.ts drops to SELF.fetch for its
// per-IP cases rather than widening the helper.
function getAs(path: string, ua: string): Promise<Response> {
	return SELF.fetch(`http://test${path}`, {
		headers: { Origin: "http://localhost:1420", "User-Agent": ua },
	});
}

// The one access-log line the given request emitted. emit() writes JSON to
// console.log by design (the log sinks ship stdout), so that's the seam — and
// Worker shares this isolate's console when driven through SELF.
async function accessLog(
	send: () => Promise<Response>,
): Promise<{ response: Response; line: Record<string, unknown> }> {
	const spy = vi.spyOn(console, "log").mockImplementation(() => {});
	let response: Response;
	let emitted: string[];
	try {
		response = await send();
		// Snapshot before restoring — mockRestore() also resets mock.calls.
		emitted = spy.mock.calls.map((call) => String(call[0]));
	} finally {
		spy.mockRestore();
	}
	const lines = emitted
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.filter((line) => line.type === "access");
	expect(lines).toHaveLength(1);
	return { response, line: lines[0] };
}

describe("access log storage timing on GET /v1/games/:id", () => {
	it("counts every round trip the anonymous read issues, events attributed", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });

		const { response, line } = await accessLog(() =>
			request.get({ path: `/v1/games/${gameId}` }),
		);
		await expectOk(response);

		expect(line.route).toBe("GET /v1/games/:id");
		// 1 SHARE_DB (games row) + 2 EVENTS_DB (rate-limit count, audit insert).
		// The insert is never awaited and may still be open at emit; it is
		// counted anyway, because it costs the database a round trip either way.
		//
		// This number is the point of the test, and the issue #150 fix will
		// change it by design — cutting a round trip off this route is the
		// whole objective. A failure here means "update the count to the new
		// query plan", not "a regression crept in"; it is only a regression if
		// the plan didn't change.
		expect(line.d1_queries).toBe(3);
		expect(line.d1_events_queries).toBe(2);
	});

	it("holds d1_wall_ms ≤ d1_ms and d1_wall_ms ≤ duration_ms through the real envelope", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });

		const { line } = await accessLog(() =>
			request.get({ path: `/v1/games/${gameId}` }),
		);
		expect(line.d1_wall_ms as number).toBeLessThanOrEqual(line.d1_ms as number);
		expect(line.d1_wall_ms as number).toBeLessThanOrEqual(
			line.duration_ms as number,
		);
		expect(line.d1_events_ms as number).toBeLessThanOrEqual(
			line.d1_ms as number,
		);
	});

	it("attributes no events queries to a route that never counts a read", async () => {
		// Scrapers skip the rate-limit gate entirely, so the same route drops to
		// its one SHARE_DB read — which is what makes the events subset a
		// per-request measurement rather than a per-route constant.
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });

		const { line } = await accessLog(() =>
			getAs(`/v1/games/${gameId}`, "Discordbot/2.0"),
		);
		expect(line.d1_queries).toBe(1);
		expect(line.d1_events_queries).toBe(0);
	});
});

describe("blob_cache on the access log", () => {
	it("reports miss then hit across two anonymous reads", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });

		const cold = await accessLog(() =>
			request.get({ path: `/v1/games/${gameId}` }),
		);
		expect(cold.line.blob_cache).toBe("miss");

		const warm = await accessLog(() =>
			request.get({ path: `/v1/games/${gameId}` }),
		);
		expect(warm.line.blob_cache).toBe("hit");
		// A hit reads bytes from the colo, not from the bucket, so it must land
		// nowhere in r2_ms — the definition the field depends on. It pins the
		// definition rather than a measured difference: Miniflare's R2 is local,
		// so the cold read above also rounds to 0 here.
		expect(warm.line.r2_ms).toBe(0);
	});

	it("reports bypass for the owner's read, which never enters the cache", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });

		const { line } = await accessLog(() =>
			request.get({ path: `/v1/games/${gameId}`, as: owner }),
		);
		expect(line.blob_cache).toBe("bypass");
	});

	it("emits no blob_cache field for a route that reads no blob", async () => {
		// Absence has to stay meaningful, which is what the bypass tag protects.
		const { line } = await accessLog(() =>
			request.get({ path: "/v1/games/public-recent" }),
		);
		expect(line.blob_cache).toBeUndefined();
		expect(line.r2_ms).toBe(0);
		expect(line.r2_op).toBeUndefined();
	});

	it("marks the streamed save download so it can't be read as no R2 work", async () => {
		// The one line above and this one are otherwise identical on the fields
		// that describe R2 — no blob_cache, r2_ms 0 — and they mean opposite
		// things: nothing read, versus the largest object in the app streamed
		// straight to the client. r2_op is what separates them in a query.
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });
		await env.SHARE_BUCKET.put(
			`saves/${gameId}.zip`,
			new TextEncoder().encode("per-ankh-test-zip"),
		);

		const { response, line } = await accessLog(() =>
			request.get({ path: `/v1/games/${gameId}/download`, as: owner }),
		);
		expect(response.status).toBe(200);
		expect(line.route).toBe("GET /v1/games/:id/download");
		expect(line.r2_op).toBe("streamed");
		expect(line.blob_cache).toBeUndefined();
		expect(line.r2_ms).toBe(0);
	});
});
