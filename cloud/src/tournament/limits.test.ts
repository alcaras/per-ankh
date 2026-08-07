import { describe, expect, it } from "vitest";
import {
	TOURNAMENT_LINK_VIEW_PER_HOUR,
	TOURNAMENT_VIEW_PER_HOUR,
	tournamentLinkViewPerHour,
	tournamentViewPerHour,
} from "./limits";

// Both read ceilings are read off env so an operator can retune one mid-event
// (`wrangler secret put TOURNAMENT_VIEW_PER_HOUR`) without a
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

	it("falls back below one whole read, which refuses as surely as 0", () => {
		// The gate is `count >= limit`, so a slipped decimal point is the same
		// outage as a fat-fingered 0 — 0.5 refuses everything after the first
		// read, .5 and 1e-3 refuse from the first.
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "0.5" })).toBe(
			TOURNAMENT_VIEW_PER_HOUR,
		);
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: ".5" })).toBe(
			TOURNAMENT_VIEW_PER_HOUR,
		);
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "1e-3" })).toBe(
			TOURNAMENT_VIEW_PER_HOUR,
		);
	});

	it("falls back on a fractional ceiling rather than rounding one", () => {
		// 1.5 is 2 to the gate and 1.5 to whoever reads the var back. An
		// operator retuning mid-event should see the number they set take
		// effect or not at all.
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "1.5" })).toBe(
			TOURNAMENT_VIEW_PER_HOUR,
		);
		expect(tournamentViewPerHour({ TOURNAMENT_VIEW_PER_HOUR: "750.5" })).toBe(
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

// The link ceiling shares the parse rules above (one helper, so they can't
// drift). What's worth pinning here is the wiring: that it reads its *own*
// var and falls back to its own constant, since the whole point of the split
// is that the two budgets move independently.
describe("tournamentLinkViewPerHour", () => {
	it("uses a parseable positive value", () => {
		expect(
			tournamentLinkViewPerHour({ TOURNAMENT_LINK_VIEW_PER_HOUR: "50" }),
		).toBe(50);
	});

	it("falls back to the constant when the var is absent or unparseable", () => {
		expect(tournamentLinkViewPerHour({})).toBe(TOURNAMENT_LINK_VIEW_PER_HOUR);
		expect(
			tournamentLinkViewPerHour({ TOURNAMENT_LINK_VIEW_PER_HOUR: "0" }),
		).toBe(TOURNAMENT_LINK_VIEW_PER_HOUR);
		expect(
			tournamentLinkViewPerHour({
				TOURNAMENT_LINK_VIEW_PER_HOUR: "600 per hour",
			}),
		).toBe(TOURNAMENT_LINK_VIEW_PER_HOUR);
	});

	it("ignores the view var — the two knobs are independent", () => {
		const env = {
			TOURNAMENT_VIEW_PER_HOUR: "5",
			TOURNAMENT_LINK_VIEW_PER_HOUR: "50",
		};
		expect(tournamentLinkViewPerHour(env)).toBe(50);
		expect(tournamentViewPerHour(env)).toBe(5);
	});
});
