// Trusted server-rendered requests: who a read is counted against, and how
// many slots a page load spends.
//
// per-ankh.app renders its pages in a Worker, and that Worker's subrequests
// reach this API from Cloudflare's SSR egress — one address standing in for
// every visitor at once. Left alone, every per-IP budget counts the whole
// site into one bucket, which is how a crawl of /games/* spent the tournament
// pages' hourly allowance on 2026-08-05.
//
// The frontend forwards the visitor's address and proves it's ours with
// SSR_TRUSTED_KEY (src/hooks.server.ts → adoptTrustedFrontend in
// cloud/src/util.ts). Four properties follow, and this file pins all four:
//
//   1. A trusted request is counted against the visitor, never the egress —
//      and an untrusted one can't claim an address it doesn't have.
//   2. That is the *only* thing the key buys. Every read is gated and charged
//      the same for every caller, so a page load costs the same whether it was
//      server-rendered or navigated to in a hydrated client.
//   3. The address is all that's forwarded. The visitor's UA is not, because
//      the scraper exemption it would switch on is keyed on a string the
//      caller picks and skips the audit row as well as the gate.
//   4. The rewrite preserves everything else about the request — body, and the
//      edge `cf` metadata.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { adoptTrustedFrontend } from "../../src/util";
import { expectErrorCode, expectOk } from "../helpers/assertions";
import { makeTournament } from "../helpers/builders";
import { SSR_TRUSTED_TEST_KEY, ssrHeaders } from "../helpers/ssr-identity";

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

// A browser's own request: no forwarding involved, the address on the wire is
// the visitor's.
function directHeaders(ip: string): Record<string, string> {
	return { "CF-Connecting-IP": ip, "CF-RAY": "test-ray" };
}

describe("forwarded visitor IP", () => {
	it("counts a server-rendered read against the visitor, not the egress", async () => {
		const visitor = "203.0.113.60";

		await expectOk(
			await get("/v1/tournaments", ssrHeaders({ clientIp: visitor })),
		);

		await expectEventsToReach("tournament_list_view", visitor, 1);
		expect(await countEvents("tournament_list_view", EGRESS_IP)).toBe(0);
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

		await expectEventsToReach("tournament_list_view", spoofer, 1);
		expect(await countEvents("tournament_list_view", victim)).toBe(0);
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

			await expectEventsToReach("tournament_list_view", EGRESS_IP, 1);
			expect(await countEvents("tournament_list_view", visitor)).toBe(0);
		} finally {
			env.SSR_TRUSTED_KEY = configured;
		}
	});

	it("treats a blank key as no key rather than as a match", async () => {
		// Empty is how a secret gets half-set — a `wrangler secret put` with
		// nothing pasted, a `.dev.vars` line left bare — and an empty presented
		// value compares equal to an empty configured one. So this is the case
		// where forwarding would trust the whole internet: the read has to land
		// on the caller's own address, and the claimed one has to stay clean.
		const configured = env.SSR_TRUSTED_KEY;
		try {
			env.SSR_TRUSTED_KEY = "";
			const caller = "203.0.113.68";
			const victim = "203.0.113.69";

			await expectOk(
				await get("/v1/tournaments", {
					...ssrHeaders({ clientIp: victim, key: "" }),
					"CF-Connecting-IP": caller,
				}),
			);

			await expectEventsToReach("tournament_list_view", caller, 1);
			expect(await countEvents("tournament_list_view", victim)).toBe(0);
		} finally {
			env.SSR_TRUSTED_KEY = configured;
		}
	});

	it("falls back to the egress when a trusted request forwards no address", async () => {
		// The key proves who's calling; it doesn't conjure an address. With
		// nothing usable to swap in, the counter is the address on the wire
		// again — in production the shared egress, which is the pooling this
		// whole path exists to undo, so it's what `ssr_forward_no_client_ip`
		// reports. Its own address rather than EGRESS_IP so the count here
		// can't be confused with another test's.
		const egress = "203.0.113.201";

		await expectOk(
			await get("/v1/tournaments", {
				"CF-Connecting-IP": egress,
				"CF-RAY": "test-ray",
				"X-SSR-Key": SSR_TRUSTED_TEST_KEY,
			}),
		);

		await expectEventsToReach("tournament_list_view", egress, 1);
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
		await expectEventsToReach("tournament_list_view", visitor, 1);

		// ...while a caller with no key and no CF-RAY still can't name itself:
		// it goes to the shared "untrusted" bucket, exactly as before.
		await expectOk(
			await get("/v1/tournaments", { "CF-Connecting-IP": "203.0.113.67" }),
		);
		await expectEventsToReach("tournament_list_view", "untrusted", 1);
		expect(await countEvents("tournament_list_view", "203.0.113.67")).toBe(0);
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

describe("what a page load costs", () => {
	it("charges a trusted page load for every read it makes", async () => {
		const t = await makeTournament({
			slug: "ssr-page-load",
			advanceTo: "swiss-round-1-generated",
		});
		const visitor = "203.0.113.70";
		const headers = ssrHeaders({ clientIp: visitor });

		// What /tournaments/[slug] fetches on a cold load: the tournament, then
		// standings + bracket + matches (src/routes/tournaments/[slug]/+layout.ts).
		await expectOk(await get(`/v1/tournaments/${t.slug}`, headers));
		await expectOk(
			await get(`/v1/tournaments/${t.tournamentId}/standings`, headers),
		);
		await expectOk(
			await get(`/v1/tournaments/${t.tournamentId}/bracket`, headers),
		);
		await expectOk(
			await get(`/v1/tournaments/${t.tournamentId}/matches`, headers),
		);

		// Four reads, four slots. The trust marker settles which visitor the
		// rows belong to and nothing about what they cost — a page load is the
		// same price however the reads arrived.
		await expectEventsToReach("tournament_view", visitor, 4);
	});

	it("charges a browser exactly the same for the same four reads", async () => {
		// The identical sequence without the trust marker — a hydrated
		// navigation, or anyone hitting the API by hand. The two must agree, or
		// the ceiling means page loads on one path and reads on the other.
		const t = await makeTournament({
			slug: "ssr-page-load-direct",
			advanceTo: "swiss-round-1-generated",
		});
		const visitor = "203.0.113.71";
		const headers = directHeaders(visitor);

		await expectOk(await get(`/v1/tournaments/${t.slug}`, headers));
		await expectOk(
			await get(`/v1/tournaments/${t.tournamentId}/standings`, headers),
		);
		await expectOk(
			await get(`/v1/tournaments/${t.tournamentId}/bracket`, headers),
		);
		await expectOk(
			await get(`/v1/tournaments/${t.tournamentId}/matches`, headers),
		);

		await expectEventsToReach("tournament_view", visitor, 4);
	});

	it("does not let a caller declare itself trusted", async () => {
		// X-SSR-Trusted is this Worker's own verdict; adoptTrustedFrontend strips
		// it off every inbound request before deciding. A caller setting it must
		// gain nothing — including nothing it could gain here, now that trust
		// buys no discount at all.
		const t = await makeTournament({
			slug: "ssr-self-declared",
			advanceTo: "swiss-round-1-generated",
		});
		const caller = "203.0.113.72";

		await expectOk(
			await get(`/v1/tournaments/${t.tournamentId}/standings`, {
				...directHeaders(caller),
				"X-SSR-Trusted": "1",
			}),
		);

		await expectEventsToReach("tournament_view", caller, 1);
	});
});

describe("the ceiling is what an over-budget visitor meets", () => {
	const configured = env.TOURNAMENT_VIEW_PER_HOUR;
	afterEach(() => {
		env.TOURNAMENT_VIEW_PER_HOUR = configured;
	});

	it("429s a server-rendered read once the budget is spent", async () => {
		env.TOURNAMENT_VIEW_PER_HOUR = "1";
		const t = await makeTournament({
			slug: "ssr-entry-gate",
			advanceTo: "swiss-round-1-generated",
		});
		const visitor = "203.0.113.73";
		const headers = ssrHeaders({ clientIp: visitor });

		await expectOk(await get(`/v1/tournaments/${t.slug}`, headers));
		await expectEventsToReach("tournament_view", visitor, 1);

		await expectErrorCode(await get(`/v1/tournaments/${t.slug}`, headers), {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_VIEW",
		});
	});

	it("gates a sub-resource read on its own, trusted or not", async () => {
		// /standings reached directly is a read like any other. It was briefly
		// exempt for our own SSR Worker; the pair below is what pins that the
		// two callers now meet the ceiling identically.
		env.TOURNAMENT_VIEW_PER_HOUR = "1";
		const t = await makeTournament({
			slug: "ssr-subresource-gate",
			advanceTo: "swiss-round-1-generated",
		});

		const direct = "203.0.113.74";
		await expectOk(
			await get(`/v1/tournaments/${t.slug}`, directHeaders(direct)),
		);
		await expectEventsToReach("tournament_view", direct, 1);
		await expectErrorCode(
			await get(
				`/v1/tournaments/${t.tournamentId}/standings`,
				directHeaders(direct),
			),
			{ status: 429, code: "RATE_LIMIT_TOURNAMENT_VIEW" },
		);

		const trusted = "203.0.113.75";
		const headers = ssrHeaders({ clientIp: trusted });
		await expectOk(await get(`/v1/tournaments/${t.slug}`, headers));
		await expectEventsToReach("tournament_view", trusted, 1);
		await expectErrorCode(
			await get(`/v1/tournaments/${t.tournamentId}/standings`, headers),
			{ status: 429, code: "RATE_LIMIT_TOURNAMENT_VIEW" },
		);
	});
});

describe("the visitor's User-Agent is not forwarded", () => {
	// The address is forwarded; the UA deliberately isn't. Carrying it would
	// switch on the scraper exemption in games.ts for site traffic, and that
	// exemption is keyed on a string the caller picks and is granted before
	// both the gate and the audit INSERT — so `User-Agent: Discordbot/2.0`
	// would be an unmetered *and* unlogged path through every read budget. The
	// tests below are the regression guard on that decision: a request may not
	// buy the exemption by claiming a UA, keyed or not.
	it("does not honour a scraper UA claimed over the SSR hop", async () => {
		const crawler = "203.0.113.80";

		await expectOk(
			await get("/v1/tournaments", {
				...ssrHeaders({ clientIp: crawler }),
				"X-SSR-Client-UA": "Twitterbot/1.0",
			}),
		);

		// Charged like any other visitor. A row here is also what proves the
		// read stayed *visible*: the exemption skips the INSERT, so an exempted
		// read leaves nothing for the incident query in docs/cloudflare-waf.md.
		await expectEventsToReach("tournament_list_view", crawler, 1);
	});

	it("does not honour one on a budget with its own limiter either", async () => {
		// Same rule wherever the exemption is read — the adoption happens once at
		// the Worker's entry, so anon_read on the game endpoints must not see a
		// forwarded UA any more than the tournament budgets do.
		const crawler = "203.0.113.81";

		await expectOk(
			await get("/v1/games/public-recent", {
				...ssrHeaders({ clientIp: crawler }),
				"X-SSR-Client-UA": "Discordbot/2.0 (+https://discordapp.com)",
			}),
		);

		await expectEventsToReach("anon_read", crawler, 1);
	});

	it("leaves the real User-Agent alone on a trusted request", async () => {
		// Adoption swaps the address and nothing else. Whatever UA a handler
		// reads is the one that arrived on the wire — there is no header a caller
		// can send that replaces it, which is what keeps the scraper exemption
		// out of reach of the SSR path.
		const adopted = adoptTrustedFrontend(
			new Request("http://test/v1/tournaments", {
				headers: {
					...ssrHeaders({ clientIp: "203.0.113.82" }),
					"User-Agent": "SvelteKit-SSR",
					"X-SSR-Client-UA": "Slackbot/1.0",
				},
			}),
			{ SSR_TRUSTED_KEY: SSR_TRUSTED_TEST_KEY },
		);

		expect(adopted.headers.get("User-Agent")).toBe("SvelteKit-SSR");
	});
});

describe("edge metadata", () => {
	it("preserves the edge cf metadata across the rewrite", async () => {
		// Adopting a forwarded address hands the rest of the Worker a rebuilt
		// Request, and `cf` is not inherited by the constructor. The rewrite runs
		// for anyone presenting an SSR header — including a junk one — so a
		// dropped `cf` would let `X-SSR-Key: anything` delete a caller's own
		// country/ASN/bot-score before a handler could read it.
		//
		// Asserted on the request object rather than through SELF.fetch: the
		// access log builds its context from the *inbound* request (log.ts), so
		// nothing downstream can witness the rewrite today. That's the point —
		// this pins the property before something starts depending on it.
		const inbound = new Request("http://test/v1/tournaments", {
			headers: ssrHeaders({ clientIp: "203.0.113.85" }),
			cf: { colo: "LHR", asOrganization: "Example ISP" },
		} as RequestInit);

		const adopted = adoptTrustedFrontend(inbound, {
			SSR_TRUSTED_KEY: SSR_TRUSTED_TEST_KEY,
		});

		expect(adopted.headers.get("CF-Connecting-IP")).toBe("203.0.113.85");
		expect(adopted.cf?.colo).toBe("LHR");
	});
});
