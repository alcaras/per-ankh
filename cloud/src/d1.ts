// D1 read-replication plumbing.
//
// `per-ankh-share-index` lives in ENAM. Every query from a Worker running
// elsewhere — Sydney, Frankfurt — crosses to Eastern North America and back,
// and handlers issuing several sequential queries pay that RTT per query, not
// per request. Read replication puts a copy nearer the reader.
//
// Replication only engages through the Sessions API. Queries on a plain
// binding run on the primary no matter what `read_replication` mode the
// database is set to, so turning the setting on is inert until something
// calls `withSession` (and the reverse is just as true — the mode is set on
// the database itself, out-of-band; see cloud/wrangler.toml). `dispatch`
// (index.ts) hands routes flagged `staleTolerant` a session-backed SHARE_DB
// and every other route the raw binding, which is why no query site had to
// change.
//
// Sessions take a constraint, and we always pass `first-primary`: the first
// query runs on the primary and anchors the session's bookmark there, so
// every later read is served by a replica caught up to the database as of
// the moment the request arrived. `first-unconstrained` is faster — it saves
// that one remaining crossing — but it changes what flagging a route means.
// The reviewer would have to establish not just that the handler never
// writes, but that nothing downstream *persists* what it read: the first
// route flagged here caches its answer in KV for 24h, so a single lagged
// read would be served for a day. `first-primary` keeps the question local
// (see the flag's doc comment in index.ts) and still moves every query after
// the first off the primary.
//
// Two D1 handles reach handlers:
//
//   SHARE_DB   A Sessions API handle on `staleTolerant` routes, the raw
//              binding everywhere else.
//   EVENTS_DB  Always the raw binding, so `events` queries always run on
//              the primary.
//
// EVENTS_DB exists because the `events` table is both audit log and
// rate-limit counter, and both roles break on a replica:
//
//   1. A replica read sees only what the session's bookmark covers, so a
//      `COUNT(*)` misses whatever concurrent requests committed after this
//      one anchored — always an *under*-count, so every rate limit would
//      fail **open**, silently weakened and never tightened. `first-primary`
//      makes that window narrow rather than unbounded, which makes it harder
//      to notice, not safer.
//   2. The Sessions API guarantees sequential consistency, so a write
//      anchors the session's bookmark and every later read in that request
//      has to wait for a replica to catch up to it. An audit INSERT in the
//      handler preamble would therefore drag the rest of the handler's
//      reads back to the primary anyway — the write, not just the count, is
//      what disqualifies a route.
//
// Keeping events on their own handle settles both: exact counts, and an
// audit INSERT that never touches the session bookmark.

import { beginD1Query } from "./log";
import type { D1Handle } from "./log";

// The D1 surface handlers actually use. `D1DatabaseSession` implements
// `prepare` and `batch` with signatures identical to `D1Database` but has no
// `exec`/`withSession`/`dump`, so it is not assignable to `D1Database` —
// this is the common shape that lets dispatch swap one for the other.
//
// It also makes the events invariant partly self-enforcing: `SHARE_DB` is a
// `QueryableD1` and so cannot be passed to anything expecting a real
// `D1Database`, which is how `countEventsSince` — and every other helper
// that counts events — refuses a session handle. Keep those parameters
// `D1Database`; widening one to `QueryableD1` is what quietly removes the
// barrier.
export type QueryableD1 = Pick<D1Database, "prepare" | "batch">;

// Mixed into the env of every module that reads or writes `events`.
export interface EventsEnv {
	EVENTS_DB: D1Database;
}

// Always `first-primary` — the header says why that's part of the design and
// not a tuning knob. `withSession()` defaults to "first-unconstrained" when
// the argument is omitted, so a bare call would silently opt into an
// unbounded-lag first read; passing it explicitly is the whole reason this is
// a named function rather than an inline call.
export function staleTolerantSession(db: D1Database): QueryableD1 {
	return db.withSession("first-primary");
}

// === Per-request query instrumentation ===
//
// Both handles are wrapped in `routeEnv`, so every query the Worker issues is
// timed and counted onto the access log (see the storage-timing block in
// log.ts) without a single call site changing. `routeEnv` is the one place
// both handles are derived, which is what makes that coverage structural
// rather than a convention someone has to remember.
//
// The signature is generic and type-preserving on purpose. Typing this
// `(db: QueryableD1) => D1Database` would also compile, and would be a
// laundering device: it would hand back a real `D1Database` for a session
// handle and so quietly delete the barrier the header above builds — the one
// that stops `countEventsSince` from ever accepting a replica session.
// Generic keeps SHARE_DB a `QueryableD1` and EVENTS_DB a `D1Database`. That
// half is pinned by the `@ts-expect-error` in d1.test.ts, which fails if a
// wrapped session ever becomes assignable to `D1Database`.
// stale-tolerant-routes.test.ts pins the half the compiler can't see: that the
// ROUTES table and the reviewed-route list agree, and that an inline
// `INSERT INTO events` is written through `env.EVENTS_DB`.
//
// Two layers, because `prepare()` is synchronous: the round trip is awaited
// on the statement, so the handle wrapper covers `prepare`/`batch` and the
// statement wrapper re-wraps `bind()` and times the terminal calls.
//
// Proxies rather than object literals. D1's methods live on a host prototype,
// so a spread would drop them, and a literal would silently narrow each handle
// to the subset this file happens to know about — `getBookmark()`,
// `withSession()`, `exec()` would all vanish. A proxy forwards what it doesn't
// intercept.

// The real statement behind a wrapped one. `batch()` hands its statements to
// the binding, which unwraps them through the host type system and would
// reject a proxy, so the wrapper strips its own layer on the way in.
const RAW_STATEMENT = Symbol("rawD1Statement");

// The terminal calls: each is one round trip, and each returns a promise.
const TIMED_METHODS = new Set(["first", "all", "run", "raw"]);

type HostMethod = (...args: never[]) => unknown;

// Host objects reject a proxy as `this`, so methods we pass through are bound
// to the real receiver.
function forward(target: object, prop: string | symbol): unknown {
	const value = Reflect.get(target, prop, target);
	return typeof value === "function"
		? (value as HostMethod).bind(target)
		: value;
}

function unwrapStatement(stmt: D1PreparedStatement): D1PreparedStatement {
	const raw = (stmt as { [RAW_STATEMENT]?: D1PreparedStatement })[
		RAW_STATEMENT
	];
	return raw ?? stmt;
}

function instrumentStatement(
	stmt: D1PreparedStatement,
	handle: D1Handle,
): D1PreparedStatement {
	return new Proxy(stmt, {
		get(target, prop) {
			if (prop === RAW_STATEMENT) return target;
			// bind() returns a fresh statement, so it has to be re-wrapped —
			// otherwise the terminal call on every bound statement (which is
			// nearly all of them) goes untimed.
			if (prop === "bind") {
				return (...values: unknown[]) =>
					instrumentStatement(target.bind(...values), handle);
			}
			if (typeof prop === "string" && TIMED_METHODS.has(prop)) {
				const method = forward(target, prop) as HostMethod;
				return (...args: never[]) => {
					const end = beginD1Query(handle);
					// Time to settle, not to call: the crossing is the await.
					return (method(...args) as Promise<unknown>).finally(end);
				};
			}
			return forward(target, prop);
		},
	});
}

export function instrumentD1<T extends QueryableD1>(
	db: T,
	handle: D1Handle,
): T {
	return new Proxy(db, {
		get(target, prop) {
			// prepare() is local — nothing to time, just a statement to wrap.
			if (prop === "prepare") {
				return (query: string) =>
					instrumentStatement(target.prepare(query), handle);
			}
			// One round trip whatever the statement count: D1 ships a batch as a
			// single request and runs it as one transaction.
			if (prop === "batch") {
				return (statements: D1PreparedStatement[]) => {
					const end = beginD1Query(handle);
					return target.batch(statements.map(unwrapStatement)).finally(end);
				};
			}
			return forward(target, prop);
		},
	});
}
