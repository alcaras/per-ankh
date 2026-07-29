import { describe, expect, it, vi } from "vitest";
import {
	beginD1Query,
	beginR2Read,
	emitAccessLog,
	mergeBusyMs,
	runWithLogContext,
	setLogField,
	type BusyInterval,
} from "./log";

// The storage-timing accumulator: the interval algebra as a pure function,
// then the numbers it produces on the access log. Per-query wrapping lives in
// d1.test.ts, and the end-to-end counts in
// test/integration/games/storage-timing.test.ts.

function span(start: number, end: number): BusyInterval {
	return { start, end };
}

describe("mergeBusyMs", () => {
	it("is zero for no queries", () => {
		expect(mergeBusyMs([])).toBe(0);
	});

	it("is the duration of a single query", () => {
		expect(mergeBusyMs([span(10, 35)])).toBe(25);
	});

	it("sums disjoint queries, dropping the idle gap between them", () => {
		expect(mergeBusyMs([span(0, 10), span(50, 70)])).toBe(30);
	});

	it("counts overlapping queries once — the point of the metric", () => {
		// Two 60ms queries in one wave, 10ms apart. Sum is 120; the request
		// only waited 70.
		expect(mergeBusyMs([span(0, 60), span(10, 70)])).toBe(70);
	});

	it("counts a nested query once", () => {
		expect(mergeBusyMs([span(0, 100), span(20, 40)])).toBe(100);
	});

	it("treats adjacent queries as one continuous busy run", () => {
		expect(mergeBusyMs([span(0, 30), span(30, 50)])).toBe(50);
	});

	it("does not depend on the order intervals were recorded in", () => {
		const intervals = [span(50, 70), span(0, 60), span(10, 20)];
		expect(mergeBusyMs(intervals)).toBe(70);
		expect(mergeBusyMs([...intervals].reverse())).toBe(70);
	});

	it("does not mutate its input", () => {
		const intervals = [span(50, 70), span(0, 60)];
		mergeBusyMs(intervals);
		expect(intervals[0]).toEqual(span(50, 70));
	});
});

// Parsed access-log lines emitted while `fn` ran. emit() goes through
// console.log by design (Logpush ships stdout), so that's the seam.
async function captureAccessLog(
	fn: () => Promise<void>,
): Promise<Record<string, unknown>[]> {
	const spy = vi.spyOn(console, "log").mockImplementation(() => {});
	let lines: string[];
	try {
		await runWithLogContext(
			new Request("http://test/v1/games/abc"),
			async () => {
				await fn();
				emitAccessLog(new Response(null, { status: 200 }));
			},
		);
		// Snapshot before restoring — mockRestore() also resets mock.calls.
		lines = spy.mock.calls.map((call) => String(call[0]));
	} finally {
		spy.mockRestore();
	}
	return lines
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.filter((line) => line.type === "access");
}

// A query that takes a real, awaited slice of wall-clock time. performance.now()
// only advances across I/O in a Worker, so the timing block is meaningless
// without something to await.
function query(handle: "share" | "events", ms: number): Promise<void> {
	const end = beginD1Query(handle);
	return new Promise<void>((resolve) => setTimeout(resolve, ms)).finally(end);
}

describe("access log storage timing", () => {
	it("reports zeros for a request that touches neither D1 nor R2", async () => {
		const [line] = await captureAccessLog(async () => {});
		expect(line).toMatchObject({
			d1_ms: 0,
			d1_queries: 0,
			d1_wall_ms: 0,
			d1_events_ms: 0,
			d1_events_queries: 0,
			r2_ms: 0,
		});
	});

	it("counts every round trip and attributes the events subset", async () => {
		const [line] = await captureAccessLog(async () => {
			await query("share", 5);
			await query("events", 5);
			await query("events", 5);
		});
		expect(line.d1_queries).toBe(3);
		expect(line.d1_events_queries).toBe(2);
		// Both events queries are in d1_ms too, so the subset can't exceed it.
		expect(line.d1_events_ms as number).toBeLessThanOrEqual(
			line.d1_ms as number,
		);
		expect(line.d1_events_ms as number).toBeGreaterThan(0);
	});

	it("holds d1_wall_ms ≤ d1_ms and d1_wall_ms ≤ duration_ms", async () => {
		const [line] = await captureAccessLog(async () => {
			await Promise.all([query("share", 40), query("share", 40)]);
		});
		expect(line.d1_wall_ms as number).toBeLessThanOrEqual(line.d1_ms as number);
		expect(line.d1_wall_ms as number).toBeLessThanOrEqual(
			line.duration_ms as number,
		);
	});

	it("charges concurrent queries to d1_ms twice but to d1_wall_ms once", async () => {
		const [line] = await captureAccessLog(async () => {
			await Promise.all([query("share", 40), query("share", 40)]);
		});
		// Sum ≈ 80, wall ≈ 40. The margin is what #174-style parallelization
		// buys, and a sum-only metric would score it as a no-op. Loose bounds:
		// a slow machine stretches both, never the gap between them.
		expect(line.d1_ms as number).toBeGreaterThan(
			(line.d1_wall_ms as number) + 10,
		);
	});

	it("counts a query still in flight at emit but does not time it", async () => {
		// The audit inserts in games.ts are deliberately never awaited, so this
		// is the live case, not a hypothetical: the count must be honest about
		// what was issued without inventing an end for an open window.
		const [line] = await captureAccessLog(async () => {
			void query("events", 200);
			await query("share", 5);
		});
		expect(line.d1_queries).toBe(2);
		expect(line.d1_events_queries).toBe(1);
		expect(line.d1_events_ms).toBe(0);
	});

	it("accumulates R2 read time separately", async () => {
		const [line] = await captureAccessLog(async () => {
			const end = beginR2Read();
			await new Promise((resolve) => setTimeout(resolve, 20));
			end();
		});
		expect(line.r2_ms as number).toBeGreaterThan(0);
		expect(line.d1_queries).toBe(0);
	});

	it("keeps raw intervals out of the log line", async () => {
		// The accumulator is its own slot precisely because `fields` is spread
		// verbatim into the line.
		const [line] = await captureAccessLog(async () => {
			await query("share", 5);
			setLogField("blob_cache", "miss");
		});
		expect(line.blob_cache).toBe("miss");
		expect(line.timing).toBeUndefined();
		expect(line.d1Spans).toBeUndefined();
	});

	it("no-ops outside a request context, as the cron sweep needs", async () => {
		// The `scheduled` handler runs without runWithLogContext and queries
		// events on the raw binding.
		expect(() => beginD1Query("events")()).not.toThrow();
		expect(() => beginR2Read()()).not.toThrow();
	});
});
