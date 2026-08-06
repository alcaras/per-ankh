// Trusted server-rendered requests: who a read is counted against.
//
// per-ankh.app renders its pages in a Worker, and that Worker's subrequests
// reach this API from Cloudflare's SSR egress — one address standing in for
// every visitor at once. Left alone, every per-IP budget counts the whole
// site into one bucket, which is how a crawl of /games/* spent the tournament
// pages' hourly allowance on 2026-08-05.
//
// The frontend forwards the visitor's address and proves it's ours with
// SSR_TRUSTED_KEY (src/hooks.server.ts → adoptTrustedFrontend in
// cloud/src/util.ts), so a trusted request is counted against the visitor and
// never against the egress — and an untrusted one can't claim an address it
// doesn't have.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../helpers/assertions";
import { ssrHeaders } from "../helpers/ssr-identity";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// The address every SSR subrequest in this file arrives from, standing in for
// the production egress. Nothing should ever be counted against it.
const EGRESS_IP = "203.0.113.200";

async function countEvents(eventType: string, ip: string): Promise<number> {
	const row = await env.SHARE_DB.prepare(
		`SELECT COUNT(*) AS n FROM events
		 WHERE event_type = ? AND ip_address = ?`,
	)
		.bind(eventType, ip)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

// The audit INSERT that spends a slot is fire-and-forget — the handler starts
// it and returns without awaiting — so a count read straight after a response
// can race it. Poll to the expected value, then assert it stayed there.
async function expectEventsToReach(
	eventType: string,
	ip: string,
	expected: number,
): Promise<void> {
	for (let i = 0; i < 50; i++) {
		if ((await countEvents(eventType, ip)) >= expected) break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(await countEvents(eventType, ip)).toBe(expected);
}

function get(path: string, headers: Record<string, string>): Promise<Response> {
	return SELF.fetch(`http://test${path}`, { headers });
}

describe("forwarded visitor IP", () => {
	it("counts a server-rendered read against the visitor, not the egress", async () => {
		const visitor = "203.0.113.60";

		await expectOk(
			await get("/v1/tournaments", ssrHeaders({ clientIp: visitor })),
		);

		await expectEventsToReach("tournament_view", visitor, 1);
		expect(await countEvents("tournament_view", EGRESS_IP)).toBe(0);
	});

	it("applies to every per-IP budget, not just the tournament one", async () => {
		// The adoption happens once at the Worker's entry, so a read with its own
		// unrelated limiter (anon_read, on the game endpoints) is attributed the
		// same way without knowing forwarding exists.
		const visitor = "203.0.113.61";

		await expectOk(
			await get("/v1/games/public-recent", ssrHeaders({ clientIp: visitor })),
		);

		await expectEventsToReach("anon_read", visitor, 1);
		expect(await countEvents("anon_read", EGRESS_IP)).toBe(0);
	});

	it("ignores a forwarded address from a caller without the key", async () => {
		// The spoofing case: anyone can send the header, so it has to be worth
		// nothing without the key. The read is charged to the caller's own
		// address, and the claimed victim's bucket is untouched.
		const spoofer = "203.0.113.62";
		const victim = "203.0.113.63";

		await expectOk(
			await get("/v1/tournaments", {
				...ssrHeaders({ clientIp: victim, key: "not-the-key" }),
				"CF-Connecting-IP": spoofer,
			}),
		);

		await expectEventsToReach("tournament_view", spoofer, 1);
		expect(await countEvents("tournament_view", victim)).toBe(0);
	});

	it("ignores forwarding entirely when this Worker has no key", async () => {
		// The deploy window where the frontend ships forwarding first. Nothing
		// is trusted, so everything counts the way it did before — including the
		// key-bearing request, which is now just an ordinary caller.
		const configured = env.SSR_TRUSTED_KEY;
		try {
			// @ts-expect-error — the binding is declared required; unsetting it is
			// exactly the state under test.
			delete env.SSR_TRUSTED_KEY;
			const visitor = "203.0.113.64";

			await expectOk(
				await get("/v1/tournaments", ssrHeaders({ clientIp: visitor })),
			);

			await expectEventsToReach("tournament_view", EGRESS_IP, 1);
			expect(await countEvents("tournament_view", visitor)).toBe(0);
		} finally {
			env.SSR_TRUSTED_KEY = configured;
		}
	});

	it("attributes a trusted read without CF-RAY, and an untrusted one to nobody", async () => {
		// CF-RAY is the "did this come through the edge" test, and it's not ours
		// to guarantee on a Worker-to-Worker subrequest. A valid key answers the
		// same question, so a trusted read still lands on the visitor...
		const visitor = "203.0.113.66";
		await expectOk(
			await get(
				"/v1/tournaments",
				ssrHeaders({ clientIp: visitor, omitCfRay: true }),
			),
		);
		await expectEventsToReach("tournament_view", visitor, 1);

		// ...while a caller with no key and no CF-RAY still can't name itself:
		// it goes to the shared "untrusted" bucket, exactly as before.
		await expectOk(
			await get("/v1/tournaments", { "CF-Connecting-IP": "203.0.113.67" }),
		);
		await expectEventsToReach("tournament_view", "untrusted", 1);
		expect(await countEvents("tournament_view", "203.0.113.67")).toBe(0);
	});

	it("carries the request body through the rewrite", async () => {
		// Adopting a forwarded address means handing the rest of the Worker a
		// rebuilt Request, and a rebuilt Request that dropped its body would break
		// every write silently. Malformed JSON is the discriminator: the handler
		// answers 400 for a body it can't parse and 204 for no body at all, so a
		// lost body would pass as success.
		const res = await SELF.fetch("http://test/v1/csp-report", {
			method: "POST",
			headers: {
				...ssrHeaders({ clientIp: "203.0.113.65" }),
				"Content-Type": "application/csp-report",
			},
			body: "{ not json",
		});

		expect(res.status).toBe(400);
	});
});
