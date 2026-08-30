import { describe, expect, it } from "vitest";
import { LAW_CLASSES } from "../generated/law-classes";
import { OPENING_LAWS_TOP_N, boundOpeningLaws } from "./aggregate";

// Openings drawn from the real civic laws — succession laws never reach this
// field — as sorted windows over the sorted law list, so each set has the shape
// the aggregator builds: four names, order dropped, ascending.
const CIVIC_LAWS = Object.values(LAW_CLASSES)
	.filter((c) => !c.succession)
	.flatMap((c) => c.laws)
	.sort();
const opening = (i: number) => CIVIC_LAWS.slice(i, i + 4);

const EGYPT = "NATION_EGYPT";
const ROME = "NATION_ROME";

// One row per distinct opening, all for the same nation.
const egyptRows = (n: number, count: (i: number) => number) =>
	Array.from({ length: n }, (_, i) => ({
		nation: EGYPT,
		laws: opening(i),
		count: count(i),
	}));

describe("boundOpeningLaws", () => {
	// The windows have to outnumber the cap for any of this to bite.
	it("has enough distinct openings to exceed the cap", () => {
		expect(CIVIC_LAWS.length - 3).toBeGreaterThan(OPENING_LAWS_TOP_N + 4);
	});

	it("passes a nation through untouched while it is under the cap", () => {
		const rows = egyptRows(OPENING_LAWS_TOP_N, () => 1);
		expect(boundOpeningLaws(rows)).toEqual(rows);
	});

	it("keeps a nation's most played openings and drops its tail", () => {
		// Strictly descending counts, so the cut needs no tiebreak to be read.
		const rows = egyptRows(OPENING_LAWS_TOP_N + 2, (i) => 100 - i);
		expect(boundOpeningLaws(rows)).toEqual(rows.slice(0, OPENING_LAWS_TOP_N));
	});

	it("keeps a row under its nation's cut when the set places once summed", () => {
		const shared = opening(OPENING_LAWS_TOP_N + 1);
		// Egypt's least played opening — 16th of 16, so its own ranking drops it
		// — is the one Rome plays most, which makes the summed set the corpus's
		// most common opening and the aggregate view's top row.
		const egyptOnly = egyptRows(OPENING_LAWS_TOP_N, () => 4);
		const egyptShared = { nation: EGYPT, laws: shared, count: 1 };
		const rows = [
			...egyptOnly,
			egyptShared,
			{ nation: ROME, laws: shared, count: 20 },
		];

		expect(boundOpeningLaws(rows)).toEqual(rows);
		// Without Rome's copies the same row places in no ranking at all.
		expect(boundOpeningLaws([...egyptOnly, egyptShared])).toEqual(egyptOnly);
	});

	it("cuts the same rows whatever order they arrive in", () => {
		// Every count equal, which is the corpus's common case: two thirds of
		// the rows are singletons, so the tiebreak decides the whole cut.
		const rows = egyptRows(OPENING_LAWS_TOP_N + 5, () => 1);
		const kept = (rs: typeof rows) =>
			boundOpeningLaws(rs).map((r) => r.laws.join("|"));

		expect(kept(rows)).toHaveLength(OPENING_LAWS_TOP_N);
		expect(kept([...rows].reverse()).sort()).toEqual(kept(rows).sort());
	});
});
