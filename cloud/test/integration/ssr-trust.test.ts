// Trusted server-rendered requests: who a read is counted against, and how
// many slots a page load spends.
//
// per-ankh.app renders its pages in a Worker, and that Worker's subrequests
// reach this API from Cloudflare's SSR egress — one address standing in for
// every visitor at once. Left alone, every per-IP budget counts the whole
// site into one bucket, which is how a crawl of /games/* spent the tournament
// pages' hourly allowance on 2026-08-05.
//
// The frontend forwards the visitor's address and User-Agent and proves it's
// ours with SSR_TRUSTED_KEY (src/hooks.server.ts → adoptTrustedFrontend in
// cloud/src/util.ts). Three properties follow, and this file pins all three:
//
//   1. A trusted request is counted against the visitor, never the egress —
//      and an untrusted one can't claim an address it doesn't have.
//   2. A trusted page load spends one slot, not one per read: the entry read
//      charges and the sub-resources ride along. A browser making the same
//      reads directly pays for each, so no endpoint is free.
//   3. The visitor's UA arrives too, which is what makes the scraper exemption
//      reach the traffic it was written for — a link-preview unfurl is a
//      server-rendered load and never anything else.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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

			await expectEventsToReach("tournament_view", caller, 1);
			expect(await countEvents("tournament_view", victim)).toBe(0);
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

		await expectEventsToReach("tournament_view", egress, 1);
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

describe("one page load, one slot", () => {
	it("charges a trusted page load once across its four reads", async () => {
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

		// One visitor action, one slot — the entry read's. Before this, the same
		// page load spent four, so ~150 cold loads exhausted the hourly budget
		// for the whole site.
		await expectEventsToReach("tournament_view", visitor, 1);
	});

	it("charges a browser for every read it makes directly", async () => {
		// The same four reads without the trust marker — a hydrated navigation,
		// or anyone hitting the API by hand. Riding along is a property of a
		// server-rendered page load, not of the endpoints.
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
		// gain nothing — so this read is still charged.
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

	it("429s the entry read, which is the one the page can't render without", async () => {
		// Riding along means a rider is neither charged nor counted, so what
		// stops an over-budget visitor is the entry read — and it has to, since
		// nothing downstream of it re-checks.
		env.TOURNAMENT_VIEW_PER_HOUR = "1";
		const t = await makeTournament({
			slug: "ssr-entry-gate",
			advanceTo: "swiss-round-1-generated",
		});
		const visitor = "203.0.113.73";
		const headers = ssrHeaders({ clientIp: visitor });

		// The first page load spends the only slot...
		await expectOk(await get(`/v1/tournaments/${t.slug}`, headers));
		await expectEventsToReach("tournament_view", visitor, 1);

		// ...and the next one is refused before it renders anything.
		await expectErrorCode(await get(`/v1/tournaments/${t.slug}`, headers), {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_VIEW",
		});
	});

	it("still gates a rider read that isn't riding on anything", async () => {
		// Untrusted callers get no short-circuit: /standings on its own is a
		// read like any other, gated and charged, however many the caller has
		// already spent.
		env.TOURNAMENT_VIEW_PER_HOUR = "1";
		const t = await makeTournament({
			slug: "ssr-rider-direct-gate",
			advanceTo: "swiss-round-1-generated",
		});
		const visitor = "203.0.113.74";
		const headers = directHeaders(visitor);

		await expectOk(await get(`/v1/tournaments/${t.slug}`, headers));
		await expectEventsToReach("tournament_view", visitor, 1);

		await expectErrorCode(
			await get(`/v1/tournaments/${t.tournamentId}/standings`, headers),
			{ status: 429, code: "RATE_LIMIT_TOURNAMENT_VIEW" },
		);
	});

	it("charges a trusted rider nothing, even with the budget wide open", async () => {
		// The counter side of riding along: the sub-resource reads leave no
		// rows at all, so the visitor's bucket holds page loads and not reads.
		const t = await makeTournament({
			slug: "ssr-rider-uncharged",
			advanceTo: "swiss-round-1-generated",
		});
		const visitor = "203.0.113.75";
		const headers = ssrHeaders({ clientIp: visitor });

		await expectOk(
			await get(`/v1/tournaments/${t.tournamentId}/standings`, headers),
		);
		await expectOk(
			await get(`/v1/tournaments/${t.tournamentId}/bracket`, headers),
		);

		// Followed by an entry read, so the assertion is on a settled count
		// rather than on a row that simply hasn't been written yet: exactly one
		// row exists, and it's the entry read's.
		await expectOk(await get(`/v1/tournaments/${t.slug}`, headers));
		await expectEventsToReach("tournament_view", visitor, 1);
	});
});

describe("forwarded visitor User-Agent", () => {
	// The scraper exemption exists for link-preview crawlers, and an unfurl is
	// always a server-rendered load — so it only ever applies to a request that
	// arrived through forwarding. Without the UA riding along with the address,
	// the exemption covers nothing that actually happens in production.
	it("exempts a scraper whose UA arrived over the SSR hop", async () => {
		const crawler = "203.0.113.80";
		const headers = ssrHeaders({ clientIp: crawler });

		await expectOk(
			await get("/v1/tournaments", {
				...headers,
				"X-SSR-Client-UA": "Twitterbot/1.0",
			}),
		);

		// An ordinary read from the same address afterwards, so the count this
		// settles on is one that has actually been written: if the crawler's
		// read had been charged, this would find two rows.
		await expectOk(await get("/v1/tournaments", headers));
		await expectEventsToReach("tournament_view", crawler, 1);
	});

	it("applies to every budget that reads the UA, not just the tournament one", async () => {
		const crawler = "203.0.113.81";
		const headers = ssrHeaders({ clientIp: crawler });

		await expectOk(
			await get("/v1/games/public-recent", {
				...headers,
				"X-SSR-Client-UA": "Discordbot/2.0 (+https://discordapp.com)",
			}),
		);

		await expectOk(await get("/v1/games/public-recent", headers));
		await expectEventsToReach("anon_read", crawler, 1);
	});

	it("counts a forwarded browser UA like any other visitor", async () => {
		// The other half: forwarding a UA must not exempt anything by itself.
		const visitor = "203.0.113.82";

		await expectOk(
			await get(
				"/v1/tournaments",
				ssrHeaders({ clientIp: visitor, clientUa: "Mozilla/5.0" }),
			),
		);

		await expectEventsToReach("tournament_view", visitor, 1);
	});

	it("ignores a claimed UA from a caller without the key", async () => {
		// Same spoofing rule as the address: worth nothing unkeyed, so a
		// scraper UA can't be borrowed to skip the counter.
		const spoofer = "203.0.113.83";

		await expectOk(
			await get("/v1/tournaments", {
				...ssrHeaders({
					clientIp: spoofer,
					clientUa: "Slackbot/1.0",
					key: "not-the-key",
				}),
				"CF-Connecting-IP": spoofer,
			}),
		);

		await expectEventsToReach("tournament_view", spoofer, 1);
	});
});
