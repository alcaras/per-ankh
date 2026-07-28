// Per-IP anonymous-read rate limit on GET /v1/games/:id — ANON_READS_PER_HOUR
// counted from the D1 `events` table, shared with /v1/games/public-recent
// under the `anon_read` event type.
//
// These tests pin the *order* of the gate, not just the cap. handleGameDetail
// issues the backing count concurrently with the games-row read whenever the
// request carries no session (issue #150): non-ownership is certain for those,
// so the two queries need not be sequential. That hoist must not move any
// decision. What has to stay true:
//
//   * 404 (no such game) and 401/403 (not visible to this caller) are still
//     decided BEFORE 429, so an over-limit IP asking for a game it could never
//     read gets the same answer as an under-limit one.
//   * The audit INSERT that consumes a budget slot still sits behind the
//     visibility gate — a request that was never served must not spend one.
//     Only the read-only COUNT was hoisted.
//   * Callers the hoist skips are still enforced: a signed-in non-owner may be
//     the owner as far as the preamble knows, so its count is issued later, in
//     the gate itself. Losing that fallback would silently stop rate-limiting
//     every logged-in viewer.
//   * Owners and scraper User-Agents remain exempt entirely.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { ANON_READS_PER_HOUR } from "../../../src/games";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { seedGame } from "../../helpers/games";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// Fill an IP's hourly bucket to the cap without firing N real reads.
//
// One statement, not the await-per-row loop its sibling
// (tournament/rate-limit-view.test.ts seedViewEvents) uses. Most tests in this
// file need a full bucket, and per-row seeding — as a loop or as a batch of N
// statements — put enough extra work through the shared test runtime to start
// tipping already-marginal timing-sensitive tests in *other* files into
// timeouts. A recursive CTE generates the rows server-side instead.
async function seedAnonReads(ip: string, count: number): Promise<void> {
	await env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, ip_address)
		 WITH RECURSIVE seq(i) AS (
		   SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?
		 )
		 SELECT 'anon_read', ? FROM seq`,
	)
		.bind(count, ip)
		.run();
}

async function countAnonReads(ip: string): Promise<number> {
	const row = await env.SHARE_DB.prepare(
		`SELECT COUNT(*) AS n FROM events
		 WHERE event_type = 'anon_read' AND ip_address = ?`,
	)
		.bind(ip)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

// The audit INSERT is fire-and-forget — the handler starts it and returns
// without awaiting, so it can land after the response does.
//
// Presence polls; absence can't. A poll that finds nothing proves only that
// nothing has landed *yet*, which is exactly what a broken implementation
// looks like for the first few milliseconds. So the absence assertions wait a
// fixed, generous window instead: the INSERT is *issued* synchronously inside
// the handler, so if the gate ever moved above it, local D1 would have the row
// well inside this budget.
const SETTLE_MS = 150;

async function expectAnonReadsToReach(
	ip: string,
	expected: number,
): Promise<void> {
	for (let i = 0; i < 50; i++) {
		if ((await countAnonReads(ip)) >= expected) break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(await countAnonReads(ip)).toBe(expected);
}

async function expectAnonReadsToStayAt(
	ip: string,
	expected: number,
): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
	expect(await countAnonReads(ip)).toBe(expected);
}

// The shared `request` helper sends no CF headers, and getClientIp ignores
// CF-Connecting-IP unless CF-RAY is present (an untrusted topology collapses
// to one shared bucket, which would make these tests interfere). So per-IP
// tests go through SELF.fetch directly, same as rate-limit-view.test.ts.
function get(
	path: string,
	opts: { ip: string; as?: TestUser; ua?: string },
): Promise<Response> {
	const headers: Record<string, string> = {
		Origin: "http://localhost:1420",
		"CF-Connecting-IP": opts.ip,
		"CF-RAY": "test-ray",
	};
	if (opts.as) headers["Cookie"] = `session=${opts.as.sessionToken}`;
	if (opts.ua) headers["User-Agent"] = opts.ua;
	return SELF.fetch(`http://test${path}`, { headers });
}

interface DetailBody {
	match_metadata: { game_name: string };
}

describe("anon_read rate limit on GET /v1/games/:id", () => {
	it("429s an anonymous read once the per-IP cap is reached", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });
		const ip = "203.0.113.20";
		await seedAnonReads(ip, ANON_READS_PER_HOUR);

		await expectErrorCode(await get(`/v1/games/${gameId}`, { ip }), {
			status: 429,
			code: "RATE_LIMIT",
		});
	});

	it("records exactly one anon_read for a served anonymous read", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, {
			isPublic: true,
			gameName: "Served",
		});
		const ip = "203.0.113.21";

		const body = await expectOk<DetailBody>(
			await get(`/v1/games/${gameId}`, { ip }),
		);
		expect(body.match_metadata.game_name).toBe("Served");

		// Reading consumes a budget slot — the guard that keeps the limit from
		// being a no-op on this route.
		await expectAnonReadsToReach(ip, 1);
	});

	it("404s a missing game ahead of the limit, spending no budget", async () => {
		const ip = "203.0.113.22";
		await seedAnonReads(ip, ANON_READS_PER_HOUR);

		// Over the cap, but the row read decides first — as it did before the
		// count was hoisted alongside it.
		await expectErrorCode(await get(`/v1/games/${nanoid(21)}`, { ip }), {
			status: 404,
			code: "NOT_FOUND",
		});
		await expectAnonReadsToStayAt(ip, ANON_READS_PER_HOUR);
	});

	it("401s a private game ahead of the limit, spending no budget", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: false });
		const ip = "203.0.113.23";
		await seedAnonReads(ip, ANON_READS_PER_HOUR);

		await expectErrorCode(await get(`/v1/games/${gameId}`, { ip }), {
			status: 401,
			code: "UNAUTHORIZED",
		});
		await expectAnonReadsToStayAt(ip, ANON_READS_PER_HOUR);
	});

	it("403s a signed-in non-owner of a private game, spending no budget", async () => {
		const owner = await makeUser();
		const viewer = await makeUser();
		const gameId = await seedGame(owner, { isPublic: false });
		const ip = "203.0.113.24";

		await expectErrorCode(
			await get(`/v1/games/${gameId}`, { ip, as: viewer }),
			{
				status: 403,
				code: "FORBIDDEN",
			},
		);
		await expectAnonReadsToStayAt(ip, 0);
	});

	it("still enforces the cap for a signed-in non-owner", async () => {
		const owner = await makeUser();
		const viewer = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });
		const ip = "203.0.113.25";
		await seedAnonReads(ip, ANON_READS_PER_HOUR);

		// This caller never gets the hoisted count — the preamble can't rule out
		// ownership while a session is present, so the gate issues its own.
		await expectErrorCode(
			await get(`/v1/games/${gameId}`, { ip, as: viewer }),
			{
				status: 429,
				code: "RATE_LIMIT",
			},
		);
	});

	it("counts a served signed-in non-owner read", async () => {
		const owner = await makeUser();
		const viewer = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });
		const ip = "203.0.113.26";

		await expectOk(await get(`/v1/games/${gameId}`, { ip, as: viewer }));
		await expectAnonReadsToReach(ip, 1);
	});

	it("exempts the owner from the cap and records nothing", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });
		const ip = "203.0.113.27";
		await seedAnonReads(ip, ANON_READS_PER_HOUR);

		await expectOk(await get(`/v1/games/${gameId}`, { ip, as: owner }));
		await expectAnonReadsToStayAt(ip, ANON_READS_PER_HOUR);
	});

	it("exempts a scraper User-Agent from the cap and records nothing", async () => {
		const owner = await makeUser();
		const gameId = await seedGame(owner, { isPublic: true });
		const ip = "203.0.113.28";
		await seedAnonReads(ip, ANON_READS_PER_HOUR);

		// Link unfurls must always resolve, so scrapers bypass both the gate and
		// the audit insert — which means the count is never even issued for them.
		await expectOk(
			await get(`/v1/games/${gameId}`, { ip, ua: "Twitterbot/1.0" }),
		);
		await expectAnonReadsToStayAt(ip, ANON_READS_PER_HOUR);
	});
});
