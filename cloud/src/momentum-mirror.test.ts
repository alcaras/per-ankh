// Regeneration test: cloud/src/momentum.ts is GENERATED from the frontend's
// src/lib/game-detail/momentum.ts by scripts/momentum-mirror.ts — re-run the
// transform here and assert the on-disk mirror matches byte-for-byte, the
// same guarantee the generated weights table has. The rest are model
// invariants the scorer must hold regardless of the fitted numbers.
// (`node:fs` / `import.meta.url` typed by test-node.d.ts — the worker
// tsconfig has no Node types; this file runs on Vitest's Node pool.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mirrorMomentumSource } from "../../scripts/momentum-mirror";
import { momentumCurve as cloudCurve, type MomentumInput } from "./momentum";

function fixture(): MomentumInput {
	const data = (base: number) =>
		Array.from({ length: 30 }, (_, i) => ({
			turn: i + 2,
			rate: base + i * 0.5,
		}));
	return {
		a: 0,
		b: 1,
		finalTurn: 31,
		yieldHistory: [
			{ player_id: 0, yield_type: "YIELD_ORDERS", data: data(10) },
			{ player_id: 1, yield_type: "YIELD_ORDERS", data: data(8) },
			{ player_id: 0, yield_type: "YIELD_SCIENCE", data: data(12) },
			{ player_id: 1, yield_type: "YIELD_SCIENCE", data: data(12) },
			// All five eco resources, split leads — the eco tally must see
			// every member of ECO5, not just money.
			{ player_id: 0, yield_type: "YIELD_MONEY", data: data(5) },
			{ player_id: 1, yield_type: "YIELD_MONEY", data: data(4) },
			{ player_id: 0, yield_type: "YIELD_FOOD", data: data(7) },
			{ player_id: 1, yield_type: "YIELD_FOOD", data: data(9) },
			{ player_id: 0, yield_type: "YIELD_IRON", data: data(3) },
			{ player_id: 1, yield_type: "YIELD_IRON", data: data(2) },
			{ player_id: 0, yield_type: "YIELD_STONE", data: data(2) },
			{ player_id: 1, yield_type: "YIELD_STONE", data: data(6) },
			{ player_id: 0, yield_type: "YIELD_WOOD", data: data(4) },
			{ player_id: 1, yield_type: "YIELD_WOOD", data: data(1) },
			{ player_id: 0, yield_type: "YIELD_GROWTH", data: data(20) },
			{ player_id: 1, yield_type: "YIELD_GROWTH", data: data(15) },
		],
		playerHistory: [
			{
				player_id: 0,
				history: Array.from({ length: 30 }, (_, i) => ({
					turn: i + 2,
					military_power: 40 + i * 6,
				})),
			},
			{
				player_id: 1,
				history: Array.from({ length: 30 }, (_, i) => ({
					turn: i + 2,
					military_power: 40 + i * 5,
				})),
			},
		],
	};
}

/** A long duel where every raw lead is held perfectly constant. */
function constantLeadFixture(): MomentumInput {
	const flat = (rate: number) =>
		Array.from({ length: 99 }, (_, i) => ({ turn: i + 2, rate }));
	const yields = (
		player: number,
		v: Record<string, number>,
	): MomentumInput["yieldHistory"] =>
		Object.entries(v).map(([yield_type, rate]) => ({
			player_id: player,
			yield_type,
			data: flat(rate),
		}));
	return {
		a: 0,
		b: 1,
		finalTurn: 100,
		yieldHistory: [
			...yields(0, {
				YIELD_ORDERS: 12,
				YIELD_SCIENCE: 30,
				YIELD_GROWTH: 25,
				YIELD_MONEY: 10,
				YIELD_FOOD: 10,
			}),
			...yields(1, {
				YIELD_ORDERS: 10,
				YIELD_SCIENCE: 24,
				YIELD_GROWTH: 20,
				YIELD_MONEY: 8,
				YIELD_FOOD: 12,
			}),
		],
		playerHistory: [0, 1].map((player_id) => ({
			player_id,
			history: Array.from({ length: 99 }, (_, i) => ({
				turn: i + 2,
				military_power: player_id === 0 ? 120 : 100,
			})),
		})),
	};
}

describe("momentum mirror", () => {
	it("is exactly what the transform produces from the frontend scorer", () => {
		const front = readFileSync(
			new URL("../../src/lib/game-detail/momentum.ts", import.meta.url),
			"utf8",
		);
		const mirror = readFileSync(new URL("./momentum.ts", import.meta.url), "utf8");
		expect(mirror).toBe(mirrorMomentumSource(front));
	});

	it("is antisymmetric — swapping sides gives 1 − p", () => {
		const f = fixture();
		const swapped = { ...f, a: f.b, b: f.a };
		const pa = cloudCurve(f)!.points;
		const pb = cloudCurve(swapped)!.points;
		for (let i = 0; i < pa.length; i++) {
			expect(pa[i].p + pb[i].p).toBeCloseTo(1, 9);
		}
	});

	it("a tied stat contributes exactly zero change", () => {
		// Science is identical for both sides every turn → lv is 0 at every
		// point, so its exact difference ch is 0.00 too.
		const curve = cloudCurve(fixture())!;
		const sci = curve.dims.indexOf("science");
		for (const pt of curve.points.slice(1)) {
			expect(pt.ch[sci]).toBe(0);
		}
	});

	it("level decomposition sums to the log-odds", () => {
		const curve = cloudCurve(fixture())!;
		for (const pt of curve.points) {
			const logOdds = Math.log(pt.p / (1 - pt.p));
			const sum = pt.lv.reduce((s, v) => s + v, 0);
			// lv is rounded to 2dp per dimension for display.
			expect(sum).toBeCloseTo(logOdds, 1);
		}
	});

	it("change decomposition sums to the move in log-odds", () => {
		// ch is the exact difference of lv, so the panel's bars can never
		// disagree with its header — Σch = Δlog-odds up to display rounding.
		const curve = cloudCurve(fixture())!;
		for (let i = 1; i < curve.points.length; i++) {
			const pt = curve.points[i];
			const prev = curve.points[i - 1];
			const delta =
				Math.log(pt.p / (1 - pt.p)) - Math.log(prev.p / (1 - prev.p));
			const sum = pt.ch.reduce((s, v) => s + v, 0);
			expect(sum).toBeCloseTo(delta, 1);
		}
	});

	it("a constant lead never produces a jump", () => {
		// The regression the interpolated weights exist to prevent: with every
		// raw lead held constant for 100 turns, no single turn may move the
		// probability sharply — the hard bucket switch used to leap ~13 points
		// at exactly 70% of the game.
		const curve = cloudCurve(constantLeadFixture())!;
		for (let i = 1; i < curve.points.length; i++) {
			const jump = Math.abs(curve.points[i].p - curve.points[i - 1].p);
			expect(jump).toBeLessThan(0.03);
		}
	});
});
