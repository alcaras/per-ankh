import { describe, expect, it } from "vitest";
import { instrumentD1, type QueryableD1 } from "./d1";
import { getLogContext, runWithLogContext, type StorageTiming } from "./log";

// The query wrapper: what counts as one round trip, what gets timed, and what
// the wrapper must not quietly change about a handle. The numbers it feeds are
// tested in log.test.ts; the whole path in
// test/integration/games/storage-timing.test.ts.

// Stand-in for the binding. The real D1 classes are host objects with no
// constructor, so the fake carries the shape and the tests cast it in — which
// also proves the wrapper only relies on prepare/batch being callable.
class FakeStatement {
	constructor(
		readonly sql: string,
		readonly bound: readonly unknown[],
		private readonly settle: () => Promise<unknown>,
	) {}
	bind(...values: unknown[]): FakeStatement {
		return new FakeStatement(this.sql, values, this.settle);
	}
	first(): Promise<unknown> {
		return this.settle();
	}
	all(): Promise<unknown> {
		return this.settle();
	}
	run(): Promise<unknown> {
		return this.settle();
	}
	raw(): Promise<unknown> {
		return this.settle();
	}
}

class FakeDb {
	readonly batches: FakeStatement[][] = [];
	constructor(
		private readonly settle: () => Promise<unknown> = () =>
			Promise.resolve(null),
	) {}
	prepare(sql: string): FakeStatement {
		return new FakeStatement(sql, [], this.settle);
	}
	batch(statements: FakeStatement[]): Promise<unknown[]> {
		this.batches.push(statements);
		return this.settle().then(() => []);
	}
	// Not intercepted by the wrapper. Stands in for the real extras a handle
	// carries — getBookmark(), withSession(), exec() — which a wrapper built
	// from an object literal instead of a proxy would drop.
	getBookmark(): string {
		return "bookmark-1";
	}
}

function asHandle(db: FakeDb): QueryableD1 {
	return db as unknown as QueryableD1;
}

// Runs `fn` inside a request context and hands back the accumulator it filled.
async function withTiming(fn: () => Promise<void>): Promise<StorageTiming> {
	let timing: StorageTiming | undefined;
	await runWithLogContext(new Request("http://test/v1/games/abc"), async () => {
		await fn();
		timing = getLogContext()?.timing;
	});
	if (!timing) throw new Error("no log context");
	return timing;
}

describe("instrumentD1", () => {
	it("counts and times a prepare/bind/first round trip", async () => {
		const timing = await withTiming(async () => {
			const db = instrumentD1(asHandle(new FakeDb()), "share");
			await db.prepare("SELECT 1 WHERE x = ?").bind(1).first();
		});
		expect(timing.d1Queries).toBe(1);
		expect(timing.d1EventsQueries).toBe(0);
		expect(timing.d1Spans).toHaveLength(1);
	});

	it("times each terminal call, so bind() must return a wrapped statement", async () => {
		// Nearly every query in the Worker is prepare().bind().<terminal>(), so a
		// bind() that returned the raw statement would leave the app essentially
		// uninstrumented while still reporting numbers.
		const timing = await withTiming(async () => {
			const db = instrumentD1(asHandle(new FakeDb()), "share");
			const stmt = db.prepare("SELECT 1");
			await stmt.bind(1).first();
			await stmt.bind(2).all();
			await stmt.bind(3).run();
			await stmt.bind(4).raw();
		});
		expect(timing.d1Queries).toBe(4);
	});

	it("does not count a statement that is prepared and never run", async () => {
		// The batch builders in games.ts and tournament/admin.ts prepare
		// statements by the dozen and issue them as one call.
		const timing = await withTiming(async () => {
			const db = instrumentD1(asHandle(new FakeDb()), "share");
			db.prepare("INSERT INTO games VALUES (?)").bind("a");
			db.prepare("INSERT INTO games VALUES (?)").bind("b");
		});
		expect(timing.d1Queries).toBe(0);
	});

	it("counts a batch as one round trip, not one per statement", async () => {
		const timing = await withTiming(async () => {
			const db = instrumentD1(asHandle(new FakeDb()), "share");
			await db.batch([
				db.prepare("INSERT INTO games VALUES (?)").bind("a"),
				db.prepare("INSERT INTO games VALUES (?)").bind("b"),
				db.prepare("INSERT INTO games VALUES (?)").bind("c"),
			]);
		});
		expect(timing.d1Queries).toBe(1);
		expect(timing.d1Spans).toHaveLength(1);
	});

	it("unwraps the statements it hands to batch", async () => {
		// The binding unwraps statements through the host type system and would
		// reject a proxy, so this is a runtime requirement, not tidiness.
		const fake = new FakeDb();
		await withTiming(async () => {
			const db = instrumentD1(asHandle(fake), "share");
			await db.batch([db.prepare("INSERT INTO games VALUES (?)").bind("a")]);
		});
		expect(fake.batches).toHaveLength(1);
		expect(fake.batches[0][0]).toBeInstanceOf(FakeStatement);
		expect(fake.batches[0][0].bound).toEqual(["a"]);
	});

	it("attributes the handle it was given, which is what separates events", async () => {
		// Both handles are the same database, so the handle is the only thing
		// that tells an events query from a share query.
		const timing = await withTiming(async () => {
			const share = instrumentD1(asHandle(new FakeDb()), "share");
			const events = instrumentD1(asHandle(new FakeDb()), "events");
			await share.prepare("SELECT 1").first();
			await events.prepare("SELECT COUNT(*) FROM events").first();
		});
		expect(timing.d1Queries).toBe(2);
		expect(timing.d1EventsQueries).toBe(1);
		expect(timing.d1Spans.filter((s) => s.events)).toHaveLength(1);
	});

	it("counts a query at issue time, before it settles", async () => {
		// The audit inserts in games.ts are fire-and-forget and are still open
		// when emitAccessLog runs. They still cost the database a round trip.
		let release: () => void = () => {};
		const pending = new Promise<unknown>((resolve) => {
			release = () => resolve(null);
		});
		const timing = await withTiming(async () => {
			const db = instrumentD1(asHandle(new FakeDb(() => pending)), "events");
			void db.prepare("INSERT INTO events VALUES (?)").bind("x").run();
			const ctx = getLogContext();
			// Counted synchronously; no span until it settles.
			expect(ctx?.timing.d1Queries).toBe(1);
			expect(ctx?.timing.d1Spans).toHaveLength(0);
			release();
			await pending;
		});
		expect(timing.d1Queries).toBe(1);
	});

	it("propagates a rejection rather than swallowing it", async () => {
		// countEventsSince must 500 on a D1 failure, not fail the limiter open.
		const timing = await withTiming(async () => {
			const db = instrumentD1(
				asHandle(new FakeDb(() => Promise.reject(new Error("D1 down")))),
				"events",
			);
			await expect(db.prepare("SELECT 1").first()).rejects.toThrow("D1 down");
		});
		// Still a round trip that happened, and one whose duration we know.
		expect(timing.d1Queries).toBe(1);
		expect(timing.d1Spans).toHaveLength(1);
	});

	it("passes through methods it does not intercept", async () => {
		const wrapped = instrumentD1(asHandle(new FakeDb()), "share");
		expect((wrapped as unknown as FakeDb).getBookmark()).toBe("bookmark-1");
	});

	it("works outside a request context, as the cron sweep needs", async () => {
		// `scheduled` runs without runWithLogContext.
		const db = instrumentD1(asHandle(new FakeDb()), "share");
		await expect(db.prepare("DELETE FROM events").run()).resolves.toBeNull();
	});
});

describe("instrumentD1 type preservation", () => {
	it("does not launder a session handle into a D1Database", () => {
		// The compile-time half of the design. `SHARE_DB` may be a read
		// replication session, and countEventsSince refuses one by taking a real
		// `D1Database` (see the header in d1.ts). A wrapper typed
		// `(db: QueryableD1) => D1Database` would silently delete that barrier,
		// so the generic signature is load-bearing: the error below is the pin.
		const session = asHandle(new FakeDb());
		// @ts-expect-error — QueryableD1 in, QueryableD1 out; never a D1Database.
		const laundered: D1Database = instrumentD1(session, "share");
		expect(laundered).toBeDefined();
	});
});
