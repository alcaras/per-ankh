// Families tab option builders.

import type { ChartOption } from "$lib/echarts";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import type { ChartBundleCore } from "../types";
import {
	ALL_NATIONS,
	type WinLossRow,
	fmtClass,
	nationLabel,
	winLossStackedOption,
} from "./helpers";

// Founding-order slots, in order. A player runs three families; which one
// seeded the first city is a different commitment from the third.
const SLOT_LABELS = ["1st family", "2nd", "3rd"] as const;

// Family classes reuse the ARCHETYPE crest art (FAMILYCLASS_CHAMPIONS →
// crests/CREST_ARCHETYPE_CHAMPIONS).
function classCrestUrl(familyClass: string): string | undefined {
	const name = familyClass.replace(/^FAMILYCLASS_/, "");
	return SPRITE_MANIFEST[`crests/CREST_ARCHETYPE_${name}`];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

// Nations that have any family-class data, most-played first — drives the
// selector in FamilyStatsPanel.
export function familyNations(bundle: ChartBundleCore): string[] {
	const games = new Map(bundle.nationWinRate.map((r) => [r.nation, r.games]));
	return Array.from(new Set(bundle.familyByNation.map((r) => r.nation))).sort(
		(a, b) => (games.get(b) ?? 0) - (games.get(a) ?? 0),
	);
}

// One family class as the shared outcome bar plus the extras only this chart
// shows: `games`/`wins`/`rate` are the picks and how they ended, the rest ride
// along for the tooltip and the trailing label.
interface ClassRow extends WinLossRow {
	pickRate: number;
	avgShare: number | null;
	slots: [number, number, number];
}

// Per-class rows for one nation (or the cross-nation aggregate), plus the game
// count the pick rate is taken over. Shared by the option builder and the
// panel's container height so the two can't disagree on the row count.
function nationPickRows(
	bundle: ChartBundleCore,
	nation: string,
): { games: number; rows: ClassRow[] } {
	const isAll = nation === ALL_NATIONS;
	// "All nations": aggregate counts/wins per class across every nation; pick
	// rate is over total games in the corpus. (Across-pool aggregate — handy as
	// an overview, but not availability-normalized.) Otherwise restrict to the
	// chosen nation and use that nation's game count as the pick-rate base.
	const games = isAll
		? bundle.nationWinRate.reduce((s, r) => s + r.games, 0)
		: (bundle.nationWinRate.find((r) => r.nation === nation)?.games ?? 0);
	// City share is a per-nation mean, so recombining across nations weights
	// each nation by how often the class was picked there — the same weighting
	// the pick/win counts already carry. Slot counts are plain sums.
	const byClass = new Map<
		string,
		{
			count: number;
			wins: number;
			shareSum: number;
			shareCount: number;
			slots: [number, number, number];
		}
	>();
	for (const r of bundle.familyByNation) {
		if (!isAll && r.nation !== nation) continue;
		const e = byClass.get(r.class) ?? {
			count: 0,
			wins: 0,
			shareSum: 0,
			shareCount: 0,
			slots: [0, 0, 0] as [number, number, number],
		};
		e.count += r.count;
		e.wins += r.wins;
		if (r.avg_share != null && r.share_samples > 0) {
			e.shareSum += r.avg_share * r.share_samples;
			e.shareCount += r.share_samples;
		}
		for (let i = 0; i < 3; i++) e.slots[i] += r.slot_counts[i] ?? 0;
		byClass.set(r.class, e);
	}
	const rows = [...byClass.entries()].map(([cls, e]) => ({
		key: cls,
		games: e.count,
		wins: e.wins,
		rate: e.count > 0 ? e.wins / e.count : 0,
		pickRate: games > 0 ? e.count / games : 0,
		avgShare: e.shareCount > 0 ? e.shareSum / e.shareCount : null,
		slots: e.slots,
	}));
	return { games, rows };
}

// Rows the per-nation chart actually draws — the panel sizes the container off
// the same count, so the chart never scrolls past its box.
export function familyClassRowCount(
	bundle: ChartBundleCore,
	nation: string,
): number {
	return nationPickRows(bundle, nation).rows.length;
}

// For one nation: the shared wins/losses stack per family class its players
// picked — bar length is how often the class was picked, the split how those
// games ended — with the share of the empire it ran as a trailing label and the
// pick rate and founding-order split in the tooltip. Restricting to one nation
// holds the family pool constant, so the classes are comparable to each other.
export function familyNationPicksOption(
	bundle: ChartBundleCore,
	nation: string,
): ChartOption {
	const { games, rows } = nationPickRows(bundle, nation);
	return winLossStackedOption({
		rows,
		label: fmtClass,
		iconUrl: classCrestUrl,
		title: `${nationLabel(nation)} families`,
		tooltipFormatter: (r) => {
			const lines = [
				fmtClass(r.key),
				`Picked in ${r.games} of ${games} games (${pct(r.pickRate)})`,
				`Wins: ${r.wins} / ${r.games} (${pct(r.rate)})`,
			];
			if (r.avgShare != null) {
				lines.push(`Avg share of cities: ${pct(r.avgShare)}`);
			}
			// Founding order — which of the player's three families this was,
			// by the turn its first city landed.
			const slotTotal = r.slots.reduce((a, b) => a + b, 0);
			if (slotTotal > 0) {
				lines.push(
					SLOT_LABELS.map(
						(label, i) => `${label} ${pct(r.slots[i] / slotTotal)}`,
					).join(" · "),
				);
			}
			return lines.join("<br/>");
		},
		// How much of the empire this class ran, at the end of its bar. The
		// founding-order split is in the tooltip — three percentages would
		// crowd the axis.
		barLabel: (r) => (r.avgShare == null ? "" : `${pct(r.avgShare)} of cities`),
	});
}

// Which family class ran the capital, as a stacked wins/losses bar: length is
// how often that class held the capital, the split how those games ended. The
// same encoding as the nation win-rate bar, and the same reason — one bar
// answers both "how often" and "how well".
//
// Nation-agnostic on purpose: a family class means the same thing whichever
// nation fields it, and splitting by nation here would shred the sample.
// Typed against ChartBundleCore (only reads capitalFamilyWinRate) so it renders
// unchanged at tournament scope.
export function capitalFamilyWinLossOption(
	bundle: ChartBundleCore,
): ChartOption {
	return winLossStackedOption({
		rows: bundle.capitalFamilyWinRate.map((r) => ({
			key: r.family_class,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		})),
		label: fmtClass,
		iconUrl: classCrestUrl,
		// Titled in-chart like the per-nation bars beside it, so the two charts
		// in the Families panel are self-describing.
		title: "Capital family",
		labelWidth: 150,
	});
}
