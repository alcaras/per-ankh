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
