// The tracing wrapper in dispatch() — cloud/src/index.ts, issue #150.
//
// What this file can prove, and what it deliberately cannot:
//
//   Ours. dispatch() wraps each handler in `ctx.tracing.enterSpan(r.route, …)`
//   and sets `route` on the span. That the span is named with the *normalized*
//   route rather than url.pathname, that the attribute matches what the access
//   line carries, that unmatched paths and preflights never enter a span, and
//   that the handler's storage round trips are all issued inside the callback
//   — those are properties of this repo's code and are pinned below.
//
//   The platform's. Whether workerd keeps the span open until the returned
//   promise settles, and whether the auto-instrumented D1/R2 spans therefore
//   nest under ours, is not observable here: nothing in the test harness
//   exports spans, and `createExecutionContext()` supplies no `tracing` at all
//   (see the stub below). That half stays on the first-deploy checklist —
//   docs/cloud-deploy-plan.md §6.1.5 item 5. Test 6 pins the precondition it
//   rests on, which is the most this side of the boundary can say.
//
// These call `worker.fetch` directly rather than going through SELF.fetch,
// because SELF owns the ExecutionContext and `tracing` has to be observable.
// `env` stays the real Miniflare binding set — only `ctx` is a stand-in, so
// routeEnv still wraps real D1 handles and the storage-timing assertions in
// games/storage-timing.test.ts keep their meaning here.

import {
	applyD1Migrations,
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { getLogContext } from "../../src/log";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	// The security tee runs inside the same envelope on some responses.
	await applyD1Migrations(env.SECURITY_DB, env.TEST_SECURITY_MIGRATIONS);
});

interface RecordedSpan {
	name: string;
	attributes: Record<string, boolean | number | string | undefined>;
	// D1 round trips counted on the log context when the callback was invoked
	// and again when its promise settled. The gap is what test 6 asserts.
	d1AtEnter: number;
	d1AtSettle: number;
}

// A recording stand-in for `ctx.tracing`.
//
// It has to be a stand-in rather than a spy over the real thing:
// `createExecutionContext()` returns a context carrying only `waitUntil`,
// `passThroughOnException` and `exports` — no `tracing` — so there is no real
// Tracing object here to wrap. waitUntil is delegated to a real context so
// `waitOnExecutionContext` still drains the blob-cache fill and the audit
// inserts.
function contextWithTracing(): {
	ctx: ExecutionContext;
	real: ExecutionContext;
	spans: RecordedSpan[];
} {
	const real = createExecutionContext();
	const spans: RecordedSpan[] = [];
	const d1Count = (): number => getLogContext()?.timing.d1Queries ?? -1;

	const tracing = {
		enterSpan<T>(name: string, callback: (span: unknown) => T): T {
			const record: RecordedSpan = {
				name,
				attributes: {},
				d1AtEnter: d1Count(),
				d1AtSettle: -1,
			};
			spans.push(record);
			const span = {
				isTraced: false,
				setAttribute(key: string, value?: boolean | number | string): void {
					record.attributes[key] = value;
				},
				end(): void {},
			};
			const out = callback(span);
			return Promise.resolve(out).then((value) => {
				record.d1AtSettle = d1Count();
				return value;
			}) as T;
		},
	};

	const ctx = {
		waitUntil: (p: Promise<unknown>) => real.waitUntil(p),
		passThroughOnException: () => real.passThroughOnException(),
		tracing,
	} as unknown as ExecutionContext;

	return { ctx, real, spans };
}

// The same context with `tracing` left off — which is not a contrivance but
// exactly what `createExecutionContext()` hands back, and what dispatch's
// guard exists for.
function contextWithoutTracing(): {
	ctx: ExecutionContext;
	real: ExecutionContext;
	spans: RecordedSpan[];
} {
	const real = createExecutionContext();
	const ctx = {
		waitUntil: (p: Promise<unknown>) => real.waitUntil(p),
		passThroughOnException: () => real.passThroughOnException(),
	} as unknown as ExecutionContext;
	return { ctx, real, spans: [] };
}

// Drives one request through the real fetch envelope with the given context,
// and hands back the span records alongside the log lines it emitted.
async function drive(
	makeContext: typeof contextWithTracing,
	path: string,
	init: RequestInit = {},
): Promise<{
	response: Response;
	spans: RecordedSpan[];
	line: Record<string, unknown>;
	events: Record<string, unknown>[];
}> {
	const { ctx, real, spans } = makeContext();
	const request = new Request(`http://test${path}`, {
		...init,
		headers: { Origin: "http://localhost:1420", ...(init.headers ?? {}) },
	});
	// emit() writes JSON to console.log by design (the log sinks ship stdout),
	// so that is the seam for the access line.
	const spy = vi.spyOn(console, "log").mockImplementation(() => {});
	let response: Response;
	let emitted: string[];
	try {
		response = await worker.fetch(
			request,
			env as unknown as Parameters<typeof worker.fetch>[1],
			ctx,
		);
		// Snapshot before restoring — mockRestore() also resets mock.calls.
		emitted = spy.mock.calls.map((call) => String(call[0]));
	} finally {
		spy.mockRestore();
	}
	await waitOnExecutionContext(real);
	const parsed = emitted.map(
		(raw) => JSON.parse(raw) as Record<string, unknown>,
	);
	const lines = parsed.filter((entry) => entry.type === "access");
	expect(lines).toHaveLength(1);
	return {
		response,
		spans,
		line: lines[0],
		events: parsed.filter((entry) => entry.type === "event"),
	};
}

const trace = (path: string, init?: RequestInit) =>
	drive(contextWithTracing, path, init);

// A well-formed id that matches no row. Exercises a regex route end to end
// without seeding — the handler 404s, but only after dispatch has spanned it.
const ABSENT_GAME_ID = "aaaaaaaaaaaaaaaaaaaaa";

describe("dispatch tracing", () => {
	it("enters one span named with the normalized route, not the path", async () => {
		// The whole reason the wrapper exists: root spans carry url.path, whose
		// cardinality is one cell per game id.
		const { spans } = await trace(`/v1/games/${ABSENT_GAME_ID}`);
		expect(spans).toHaveLength(1);
		expect(spans[0].name).toBe("GET /v1/games/:id");
		expect(spans[0].name).not.toContain(ABSENT_GAME_ID);
	});

	it("spans a path route as well as a regex route", async () => {
		// dispatch() was restructured so both match kinds fall through to one
		// enterSpan call; a path route taking an early return would leave the
		// auth and stats endpoints untraced.
		const { spans } = await trace("/v1/auth/me");
		expect(spans).toHaveLength(1);
		expect(spans[0].name).toBe("GET /v1/auth/me");
	});

	it("sets the route attribute to the value the access line carries", async () => {
		// Same normalized route from the same place as setRoute(), which is what
		// lets a span query and a log query be compared at all.
		const { spans, line } = await trace(`/v1/games/${ABSENT_GAME_ID}`);
		expect(spans[0].attributes.route).toBe("GET /v1/games/:id");
		expect(line.route).toBe("GET /v1/games/:id");
	});

	it("enters no span when no route matches", async () => {
		// The 404 is built after the loop falls through, so there is nothing to
		// name it with — url.path is exactly the unbounded key to avoid.
		const { response, spans, line } = await trace("/v1/nonexistent");
		expect(response.status).toBe(404);
		expect(spans).toHaveLength(0);
		expect(line.route).toBeNull();
	});

	it("enters no span for a CORS preflight", async () => {
		// OPTIONS is answered by the envelope and never reaches dispatch.
		const { response, spans } = await trace(`/v1/games/${ABSENT_GAME_ID}`, {
			method: "OPTIONS",
		});
		expect(response.status).toBe(204);
		expect(spans).toHaveLength(0);
	});

	it("issues the handler's D1 round trips inside the span callback", async () => {
		// The precondition for platform D1/R2 spans nesting under ours: every
		// storage call has to happen within the callback's dynamic extent. If a
		// round trip were issued before enterSpan or after its promise settled,
		// no span-open policy in workerd could nest it.
		const { spans, line } = await trace(`/v1/games/${ABSENT_GAME_ID}`);
		expect(spans[0].d1AtEnter).toBe(0);
		expect(spans[0].d1AtSettle).toBeGreaterThan(0);
		expect(line.d1_queries).toBe(spans[0].d1AtSettle);
	});

	it("returns the handler's response through the wrapper unchanged", async () => {
		const { response } = await trace(`/v1/games/${ABSENT_GAME_ID}`);
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("dispatch without ctx.tracing", () => {
	// One test, not two, because the warn-once flag in index.ts is isolate
	// global: whichever case ran first would trip it and leave the other
	// asserting against an already-spent flag. Every test above supplies a
	// tracing context, so the flag is still unset when this runs — if that
	// stops being true, this fails with a zero count rather than passing
	// quietly.
	it("serves the route untraced and warns once, not per request", async () => {
		const first = await drive(
			contextWithoutTracing,
			`/v1/games/${ABSENT_GAME_ID}`,
		);
		const second = await drive(contextWithoutTracing, "/v1/auth/me");

		// The measurement degrades; the request does not. An unguarded
		// `ctx.tracing.enterSpan` would throw here and the envelope's safety net
		// would turn every route into a 500.
		// Both are the handlers' own answers (no row; no session), not the
		// envelope's 500.
		expect(first.response.status).toBe(404);
		expect(second.response.status).toBe(401);
		// The handler really ran — routeEnv wrapped D1 and the access line is
		// complete, span or no span.
		expect(first.line.route).toBe("GET /v1/games/:id");
		expect(first.line.d1_queries as number).toBeGreaterThan(0);
		expect(first.spans).toHaveLength(0);

		const warnings = [...first.events, ...second.events].filter(
			(entry) => entry.event === "tracing_unavailable",
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].level).toBe("warn");
	});
});
