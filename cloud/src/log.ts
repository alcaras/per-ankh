// Structured JSON logging primitive for the API Worker.
//
// All output is emitted as one JSON object per console.log line, which both
// configured sinks consume unchanged: Cloudflare parses and indexes the
// fields for a 7-day queryable window, and an OTLP export carries the same
// lines to a longer-retention destination (see docs/cloud-deploy-plan.md
// §6.1). Two log shapes:
//
//   - Access log (type=access). One per request, emitted by the fetch
//     envelope after dispatch returns. Fields: ts, level, request_id,
//     cf_ray, colo, method, route, path, status, duration_ms, d1_ms,
//     d1_queries, d1_wall_ms, d1_events_ms, d1_events_queries, r2_ms,
//     user_id, error_code, error_class + handler-attached fields via
//     setLogField. The d1_*/r2_* block is the storage-timing accumulator
//     below.
//
//   - Event log (type=event). Emitted mid-handler by logError / logWarn /
//     logEvent. Correlated to the access log via request_id.
//
// Request-scoped state flows via AsyncLocalStorage (gated by the
// nodejs_als compatibility flag in cloud/wrangler.toml). Handlers don't
// take a context argument; they call setRoute / setUserId / setLogField
// from anywhere in the call frame.
//
// PII deny-list: any field key in PII_KEYS is replaced with "[REDACTED]"
// before stringify, and the line gets pii_redaction: true. Discord IDs and
// platform OnlineIDs are PII per the cutover plan; the deny-list is the
// last line of defense. Handlers shouldn't be putting PII in fields in
// the first place.

// AsyncLocalStorage from node:async_hooks. @cloudflare/workers-types
// doesn't ship Node module declarations, so we declare just the surface
// we use in cloud/src/types/node-async-hooks.d.ts rather than pulling in
// @types/node and risking globals collisions.
import { AsyncLocalStorage } from "node:async_hooks";

export const PII_KEYS = new Set([
	"online_id",
	"discord_id",
	"username",
	"email",
	"access_token",
	"code_verifier",
	"session_token",
	"app_key",
	"body",
]);

export type LogLevel = "info" | "warn" | "error";

// === Storage timing ===
//
// Latency on the anonymous read path is dominated by cross-region round
// trips: D1 and R2 both live in ENAM and the Worker runs at the colo
// nearest the viewer, so a reader in Sydney pays a transpacific hop per
// query, not per request. Every candidate fix left in issue #150 trades
// accuracy or complexity for one of those hops, and the ranking so far
// comes from reading code rather than measuring it — hence this: each
// request accumulates its own D1/R2 timing, and the access log turns it
// into numbers the sinks aggregate per route and per colo.
//
// Only I/O is measurable this way. A Worker's clock advances on I/O, not on
// CPU work, so CPU time cannot be derived from these timestamps at all —
// don't add a column for it.

// Which handle a query went out on. Mirrors the two handles dispatch
// derives (see d1.ts) so the EVENTS_DB subset can be attributed on its own:
// the per-request rate-limit COUNT(*) is the most repeated blocking hop in
// the app, and a baseline that can't isolate it can't score removing it.
export type D1Handle = "share" | "events";

// One query's in-flight window, in performance.now() ms.
export interface BusyInterval {
	start: number;
	end: number;
}

interface D1Span extends BusyInterval {
	events: boolean;
}

export interface StorageTiming {
	// Round trips issued. Counted when the terminal call is made rather than
	// when it settles, so the fire-and-forget audit inserts in games.ts —
	// deliberately never awaited, and still in flight when emitAccessLog runs
	// — are counted for what they cost the database. A batch() is ONE round
	// trip however many statements it carries.
	d1Queries: number;
	// The EVENTS_DB subset of d1Queries.
	d1EventsQueries: number;
	// One entry per *settled* query. A query still in flight at emit time
	// contributes to the counts above and to none of the durations below:
	// closing a window that hasn't closed would mean inventing an end.
	d1Spans: D1Span[];
	// Sum of R2 read durations, body transfer included (see blob-cache.ts).
	// No intervals: nothing issues concurrent R2 reads, so there is no
	// overlap to measure.
	r2Ms: number;
}

export interface LogContext {
	request_id: string;
	cf_ray: string | null;
	// IATA code of the data center that served the request. Its own envelope
	// slot rather than a setLogField entry, same as cf_ray. Neither sink
	// supplies a colo in groupable form, and cf_ray can't stand in for it:
	// it's unique per request, so grouping by it yields one group per request.
	colo: string | null;
	method: string;
	path: string;
	route: string | null;
	user_id: string | null;
	error_code: string | null;
	// Security-event reason set by a handler when it can't be derived from
	// status+route at the emit chokepoint (currently only "signup"). Read by
	// emitSecurityEvent in security-events.ts; takes precedence over the
	// status/route-derived reasons. See issue #71.
	security_reason: string | null;
	started_at: number;
	// Its own slot rather than a `fields` entry: `fields` is spread verbatim
	// into the log line, so raw intervals would ship in it. emitAccessLog
	// reduces this to the d1_*/r2_* numbers.
	timing: StorageTiming;
	fields: Record<string, unknown>;
}

const als = new AsyncLocalStorage<LogContext>();

function newContext(request: Request): LogContext {
	const url = new URL(request.url);
	// `cf` is absent on a hand-built Request and its type is the union of the
	// incoming and outgoing shapes, which widens `.colo` to unknown — narrow
	// rather than cast, so an unpopulated edge just logs null.
	const colo = request.cf?.colo;
	return {
		request_id: crypto.randomUUID(),
		cf_ray: request.headers.get("CF-RAY"),
		colo: typeof colo === "string" ? colo : null,
		method: request.method,
		path: url.pathname,
		route: null,
		user_id: null,
		error_code: null,
		security_reason: null,
		started_at: performance.now(),
		timing: { d1Queries: 0, d1EventsQueries: 0, d1Spans: [], r2Ms: 0 },
		fields: {},
	};
}

export function runWithLogContext<T>(
	request: Request,
	fn: () => Promise<T>,
): Promise<T> {
	return als.run(newContext(request), fn);
}

export function getLogContext(): LogContext | undefined {
	return als.getStore();
}

export function getRequestId(): string | null {
	return als.getStore()?.request_id ?? null;
}

export function setRoute(route: string): void {
	const ctx = als.getStore();
	if (ctx) ctx.route = route;
}

// Tag a security-event reason that the emit chokepoint can't infer from
// status+route (currently only "signup", set on new-account creation). The
// access log itself doesn't use this — it's consumed by emitSecurityEvent.
export function setSecurityReason(reason: string): void {
	const ctx = als.getStore();
	if (ctx) ctx.security_reason = reason;
}

export function setUserId(userId: string): void {
	const ctx = als.getStore();
	if (ctx) ctx.user_id = userId;
}

export function setErrorCode(code: string): void {
	const ctx = als.getStore();
	if (ctx) ctx.error_code = code;
}

export function setLogField(key: string, value: unknown): void {
	const ctx = als.getStore();
	if (ctx) ctx.fields[key] = value;
}

// Open a timing window for one D1 round trip and return its closer, which
// the query wrapper calls when the statement settles (instrumentD1 in
// d1.ts). The count lands immediately, the interval only on close — see
// StorageTiming.
//
// No-ops without a log context, exactly as setLogField does: the `scheduled`
// handler runs outside runWithLogContext and sweeps events on the raw
// binding, so a cron run must not need one.
export function beginD1Query(handle: D1Handle): () => void {
	const ctx = als.getStore();
	if (!ctx) return () => {};
	const events = handle === "events";
	ctx.timing.d1Queries += 1;
	if (events) ctx.timing.d1EventsQueries += 1;
	const start = performance.now();
	return () => {
		ctx.timing.d1Spans.push({ start, end: performance.now(), events });
	};
}

// Same shape for one R2 read. Only the sum is kept (see StorageTiming.r2Ms).
export function beginR2Read(): () => void {
	const ctx = als.getStore();
	if (!ctx) return () => {};
	const start = performance.now();
	return () => {
		ctx.timing.r2Ms += performance.now() - start;
	};
}

// Time with at least one query in flight: the union of the busy intervals,
// in ms. Distinct from the sum of the intervals, which double-counts
// whatever ran concurrently — the difference between the two is how much
// overlap a request actually achieved.
//
// Pure, and exported so the interval algebra is unit-testable directly
// (log.test.ts) rather than only through a request.
export function mergeBusyMs(intervals: readonly BusyInterval[]): number {
	if (intervals.length === 0) return 0;
	const sorted = [...intervals].sort((a, b) => a.start - b.start);
	let busy = 0;
	let start = sorted[0].start;
	let end = sorted[0].end;
	for (const next of sorted.slice(1)) {
		if (next.start > end) {
			// Gap: the database was idle between the two.
			busy += end - start;
			start = next.start;
			end = next.end;
		} else if (next.end > end) {
			// Overlapping or nested — extend the run rather than counting twice.
			end = next.end;
		}
	}
	return busy + (end - start);
}

// Shallow-clone fields, replacing any deny-listed key whose value isn't
// already null/undefined with "[REDACTED]". Returns a flag the emitter
// uses to mark the line.
function scrubPii(fields: Record<string, unknown>): {
	scrubbed: Record<string, unknown>;
	redacted: boolean;
} {
	let redacted = false;
	const scrubbed: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(fields)) {
		if (PII_KEYS.has(k) && v !== null && v !== undefined) {
			scrubbed[k] = "[REDACTED]";
			redacted = true;
		} else {
			scrubbed[k] = v;
		}
	}
	return { scrubbed, redacted };
}

function emit(line: Record<string, unknown>): void {
	// Errors that snuck into fields serialize to {} by default — coerce to
	// { name, message } so the log line carries something useful.
	console.log(
		JSON.stringify(line, (_, v) =>
			v instanceof Error ? { name: v.name, message: v.message } : v,
		),
	);
}

export function logEvent(
	level: LogLevel,
	event: string,
	fields?: Record<string, unknown>,
): void {
	const ctx = als.getStore();
	const { scrubbed, redacted } = scrubPii(fields ?? {});
	emit({
		ts: new Date().toISOString(),
		level,
		type: "event",
		event,
		request_id: ctx?.request_id ?? null,
		user_id: ctx?.user_id ?? null,
		...(redacted ? { pii_redaction: true } : {}),
		...scrubbed,
	});
}

export function logWarn(event: string, fields?: Record<string, unknown>): void {
	logEvent("warn", event, fields);
}

export function logError(
	event: string,
	err: unknown,
	fields?: Record<string, unknown>,
): void {
	const errFields: Record<string, unknown> = { ...(fields ?? {}) };
	if (err !== null && err !== undefined) {
		if (err instanceof Error) {
			errFields.error_class = err.name;
			errFields.error_message = err.message;
		} else {
			errFields.error_class = "UnknownError";
			errFields.error_message = String(err);
		}
	}
	logEvent("error", event, errFields);
}

// Emit the access log line for the just-completed request. Called by the
// fetch envelope after dispatch returns (or after the safety-net 500).
export function emitAccessLog(response: Response): void {
	const ctx = als.getStore();
	if (!ctx) return;
	const status = response.status;
	const level: LogLevel =
		status >= 500 ? "error" : status >= 400 ? "warn" : "info";
	const { scrubbed, redacted } = scrubPii(ctx.fields);
	let d1Ms = 0;
	let d1EventsMs = 0;
	for (const span of ctx.timing.d1Spans) {
		d1Ms += span.end - span.start;
		if (span.events) d1EventsMs += span.end - span.start;
	}
	emit({
		ts: new Date().toISOString(),
		level,
		type: "access",
		request_id: ctx.request_id,
		cf_ray: ctx.cf_ray,
		// Access lines only. Event lines correlate by request_id, so nothing
		// needs it there.
		colo: ctx.colo,
		method: ctx.method,
		route: ctx.route,
		path: ctx.path,
		status,
		duration_ms: Math.round(performance.now() - ctx.started_at),
		// Sum of per-query in-flight time, which MAY exceed duration_ms and
		// is not a bug: queries issued in one wave each count their whole
		// window, so two concurrent 60ms queries sum to 120ms inside a ~60ms
		// request. Read it against d1_wall_ms, not on its own.
		d1_ms: Math.round(d1Ms),
		// Round trips, not statements — a batch() counts once. See
		// StorageTiming.d1Queries for what "issued" means here.
		d1_queries: ctx.timing.d1Queries,
		// Union of the busy intervals: wall-clock time this request spent
		// waiting on D1. Invariants: ≤ d1_ms and ≤ duration_ms.
		d1_wall_ms: Math.round(mergeBusyMs(ctx.timing.d1Spans)),
		// The EVENTS_DB subset, which is one query's worth on most routes:
		// the per-IP rate-limit count (plus its audit insert).
		d1_events_ms: Math.round(d1EventsMs),
		d1_events_queries: ctx.timing.d1EventsQueries,
		r2_ms: Math.round(ctx.timing.r2Ms),
		user_id: ctx.user_id,
		error_code: ctx.error_code,
		...(redacted ? { pii_redaction: true } : {}),
		...scrubbed,
	});
}
