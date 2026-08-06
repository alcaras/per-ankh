import { describe, expect, it } from "vitest";
import { TOURNAMENT_VIEW_PER_HOUR, tournamentViewPerHour } from "./limits";

// The tournament view ceiling is read off env so an operator can retune it
// mid-event (`wrangler secret put TOURNAMENT_VIEW_PER_HOUR`) without a
// redeploy. Every way that var can be wrong resolves to the constant, because
// the failure mode this knob exists to shorten is the tournament pages being
// down — a value that parses to 0 or NaN must not be the thing that keeps them
// there. The gate's end of the wiring is pinned in
// test/integration/tournament/rate-limit-view.test.ts.
describe("tournamentViewPerHour", () => {
	it("uses a parseable positive value", () => {
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "50" })).toBe(50);
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "5000" })).toBe(
			5000,
		);
	});

	it("falls back to the constant when the var is absent or blank", () => {
		expect(tournamentViewPerHour({})).toBe(TOURNAMENT_VIEW_PER_HOUR);
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "" })).toBe(
			TOURNAMENT_VIEW_PER_HOUR,
		);
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "   " })).toBe(
			TOURNAMENT_VIEW_PER_HOUR,
		);
	});

	it("falls back on a non-positive value rather than refusing every read", () => {
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "0" })).toBe(
			TOURNAMENT_VIEW_PER_HOUR,
		);
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "-1" })).toBe(
			TOURNAMENT_VIEW_PER_HOUR,
		);
	});

	it("falls back on a value that only half-parses", () => {
		// parseInt("600 per hour") is 600 — a mangled value would pass as a
		// deliberate one. Number() rejects the whole string.
		expect(
			tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "600 per hour" }),
		).toBe(TOURNAMENT_VIEW_PER_HOUR);
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "six" })).toBe(
			TOURNAMENT_VIEW_PER_HOUR,
		);
		expect(
			tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "Infinity" }),
		).toBe(TOURNAMENT_VIEW_PER_HOUR);
	});
});
