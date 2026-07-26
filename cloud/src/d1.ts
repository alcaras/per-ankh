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
// calls `withSession`. `dispatch` (index.ts) hands routes flagged
// `staleTolerant` a session-backed SHARE_DB and every other route the raw
// binding, which is why no query site had to change.
//
// Two D1 handles reach handlers:
//
//   SHARE_DB   A Sessions API handle on `staleTolerant` routes, the raw
//              binding everywhere else.
//   EVENTS_DB  Always the raw binding, so `events` queries always run on
//              the primary.
//
// EVENTS_DB exists because the `events` table is both audit log and
// rate-limit counter, and both roles break under replica lag:
//
//   1. Lag hides the newest rows, so a stale `COUNT(*)` is always an
//      *under*-count and every rate limit would fail **open** — silently
//      weakened, never tightened.
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
// `D1Database`, which is how `countEventsSince` refuses a session handle.
export type QueryableD1 = Pick<D1Database, "prepare" | "batch">;

// Mixed into the env of every module that reads or writes `events`.
export interface EventsEnv {
	EVENTS_DB: D1Database;
}

// `withSession()` defaults to "first-unconstrained" when the argument is
// omitted, which means a bare call silently opts into stale reads rather
// than failing loudly. Pass the constraint explicitly, always — that's the
// whole reason this is a named function rather than an inline call.
export function staleTolerantSession(db: D1Database): QueryableD1 {
	return db.withSession("first-unconstrained");
}
