import { describe, expect, it } from "vitest";
import {
	buildRecommendations,
	MAX_APPEARANCES,
	MIN_RECOMMENDATION_COUNT,
	RECOMMENDATION_COUNT,
	type RecommendationCandidate,
} from "./recommend";
import type { Duel } from "./glicko2";

const TODAY = "2026-08-26";
const RECENT = "2026-08-20";

function player(
	userId: string,
	over: Partial<RecommendationCandidate> = {},
): RecommendationCandidate {
	return {
		userId,
		r: 1500,
		rd: 80,
		games: 40,
		lastActive: RECENT,
		openToMatches: true,
		...over,
	};
}

// A pool of same-strength, settled, active players — every pair passes the
// stomp filter, so each test can vary the one thing it is about.
function pool(n: number, prefix = "p"): RecommendationCandidate[] {
	return Array.from({ length: n }, (_, i) => player(`${prefix}${i}`));
}

function idsFor(
	lists: Map<string, { opponentUserId: string }[]>,
	userId: string,
): string[] {
	return (lists.get(userId) ?? []).map((r) => r.opponentUserId);
}

describe("buildRecommendations", () => {
	it("gives each player a full list drawn from everyone but themselves", () => {
		const players = pool(15);
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		for (const p of players) {
			const ids = idsFor(lists, p.userId);
			expect(ids).toHaveLength(RECOMMENDATION_COUNT);
			expect(ids).not.toContain(p.userId);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});

	it("never suggests a game one side would walk", () => {
		// Eight players at the same strength, so the floor below is nowhere near
		// binding and the band is free to do its job.
		const players = [
			...pool(8),
			player("hopeless", { r: 2400 }),
			player("outclassed", { r: 700 }),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		for (const p of pool(8)) {
			const ids = idsFor(lists, p.userId);
			expect(ids).not.toContain("hopeless");
			expect(ids).not.toContain("outclassed");
		}
		// …and symmetrically: the strong player is not offered the weak one
		// while anyone closer is left.
		expect(idsFor(lists, "hopeless")).not.toContain("outclassed");
	});

	it("gives the ends of the ladder a floor rather than a dead end", () => {
		// One player far above a settled pack: nobody is a close game for them,
		// so the band has to give way — down to the floor, and no further.
		const players = [player("champion", { r: 2100 }), ...pool(12)];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		const ids = idsFor(lists, "champion");
		expect(ids).toHaveLength(MIN_RECOMMENDATION_COUNT);
		expect(new Set(ids).size).toBe(ids.length);
		// The pack still gets full lists off each other.
		expect(idsFor(lists, "p0")).toHaveLength(RECOMMENDATION_COUNT);
	});

	it("widens the band when either side is a player it barely knows", () => {
		// Everyone here sits at a conservative rating (r - 2·RD) of 1500 or
		// 1340. The 160-point gap predicts about 29/71: outside the band a
		// settled pair is held to, inside the one a pair with a barely-known
		// player on either side gets. Six same-strength players sit alongside
		// so the floor is already satisfied and the band is what decides.
		const near = pool(6, "near").map((p) => ({ ...p, r: 1660 }));
		const far = pool(3, "far");

		// A settled player finds none of the three close enough.
		const settled = buildRecommendations({
			players: [player("settled", { r: 1660 }), ...near, ...far],
			duels: [],
			today: TODAY,
		});
		expect(idsFor(settled, "settled").sort()).toEqual(
			near.map((p) => p.userId).sort(),
		);

		// The same conservative rating with a wide deviation reaches all nine.
		const unsettled = buildRecommendations({
			players: [
				player("newcomer", { r: 1900, rd: 200, games: 1 }),
				...near,
				...far,
			],
			duels: [],
			today: TODAY,
		});
		expect(idsFor(unsettled, "newcomer")).toHaveLength(9);

		// ...and so does a settled player looking at a barely-known candidate.
		const candidate = buildRecommendations({
			players: [
				player("settled", { r: 1660 }),
				...near,
				player("unplaced", { r: 1740, rd: 200, games: 1 }),
			],
			duels: [],
			today: TODAY,
		});
		expect(idsFor(candidate, "settled")).toContain("unplaced");
	});

	it("leaves out anyone who opted out, and still gives them their own list", () => {
		const players = [...pool(12), player("hidden", { openToMatches: false })];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		for (const p of players) {
			expect(idsFor(lists, p.userId)).not.toContain("hidden");
		}
		expect(idsFor(lists, "hidden")).toHaveLength(RECOMMENDATION_COUNT);
	});

	it("leaves out anyone who has not been seen in months", () => {
		const players = [
			...pool(12),
			player("gone", { lastActive: "2026-01-01" }),
			player("never", { lastActive: null }),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		for (const p of players) {
			const ids = idsFor(lists, p.userId);
			expect(ids).not.toContain("gone");
			expect(ids).not.toContain("never");
		}
	});

	it("spreads the load instead of sending everyone to the same player", () => {
		// Twice as many receivers as candidates: forty in the pool, and forty
		// more who read a list without being on anyone's. Eight hundred picks
		// over forty names is exactly the ceiling, so it binds on every
		// candidate and still leaves every list full — the case it is meant
		// to hold in.
		const players = [
			...pool(40),
			...pool(40, "reader").map((p) => ({ ...p, openToMatches: false })),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		const appearances = new Map<string, number>();
		for (const p of players) {
			const ids = idsFor(lists, p.userId);
			expect(ids).toHaveLength(RECOMMENDATION_COUNT);
			for (const id of ids) {
				appearances.set(id, (appearances.get(id) ?? 0) + 1);
			}
		}
		for (const [, count] of appearances) {
			expect(count).toBeLessThanOrEqual(MAX_APPEARANCES);
		}
	});

	it("counts the pair's history and badges what is true about it", () => {
		const players = [
			player("me"),
			player("rival"),
			player("stranger"),
			player("rookie", { games: 2 }),
			player("today", { lastActive: TODAY }),
		];
		const duels: Duel[] = [
			{ date: "2026-08-01", p1: "me", p2: "rival", winner: "me" },
			{ date: "2026-08-10", p1: "me", p2: "rival", winner: "rival" },
		];
		const lists = buildRecommendations({ players, duels, today: TODAY });
		const mine = new Map(
			(lists.get("me") ?? []).map((r) => [r.opponentUserId, r]),
		);

		expect(mine.get("rival")!.meetings).toBe(2);
		expect(mine.get("stranger")!.meetings).toBe(0);
		expect(mine.get("rookie")!.badges).toContain("new_here");
		expect(mine.get("today")!.badges).toContain("active_this_week");
		// Nobody who has played forty games is "new here".
		expect(mine.get("rival")!.badges).not.toContain("new_here");
	});

	it("prefers a fresh pairing to this month's third rematch", () => {
		const players = [player("me"), player("again"), player("fresh")];
		const duels: Duel[] = Array.from({ length: 3 }, (_, i) => ({
			date: `2026-08-0${i + 1}`,
			p1: "me",
			p2: "again",
			winner: "me",
		}));
		const lists = buildRecommendations({ players, duels, today: TODAY });
		// With only two candidates there is room for both — the decay is a
		// discount, not a ban.
		expect(idsFor(lists, "me").sort()).toEqual(["again", "fresh"]);

		// With ten rivals competing for the slots, the rematch loses its place.
		const crowded = buildRecommendations({
			players: [...players, ...pool(10, "other")],
			duels,
			today: TODAY,
		});
		expect(idsFor(crowded, "me")).not.toContain("again");
	});

	it("does not hand a settled player a list of strangers", () => {
		// Every unrated player sits at the starting rating, so a prediction
		// from raw ratings would call them an even game for anyone mid-ladder.
		// The conservative estimate places them at the bottom of what they
		// might be instead, and a newcomer only reaches a settled player's list
		// once even that pessimistic estimate is close.
		const newcomers = Array.from({ length: 12 }, (_, i) =>
			player(`new${i}`, { rd: 300, games: 1 }),
		);
		const known = Array.from({ length: 8 }, (_, i) =>
			player(`known${i}`, { r: 1480 + i * 5 }),
		);
		const proven = player("proven", { r: 1900, rd: 300, games: 2 });
		const lists = buildRecommendations({
			players: [player("veteran"), ...known, ...newcomers, proven],
			duels: [],
			today: TODAY,
		});

		const ids = idsFor(lists, "veteran");
		expect(ids.filter((id) => id.startsWith("new"))).toHaveLength(0);
		expect(ids).toContain("proven");
		for (const k of known) expect(ids).toContain(k.userId);
	});

	it("fills a thin pool rather than handing anyone a short list", () => {
		// Eleven candidates for ninety lists: the appearance ceiling cannot be
		// honoured and still fill them, and a page with three names on it is
		// the feature not working, so the ceiling is what gives.
		const players = [
			...pool(11, "few"),
			...pool(79, "reader").map((p) => ({ ...p, openToMatches: false })),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		for (const p of players) {
			expect(idsFor(lists, p.userId)).toHaveLength(RECOMMENDATION_COUNT);
		}
	});

	it("lists the most recently active first, whatever their rating", () => {
		// Three players spread across the band, seen on three different days.
		// Nearest-in-rating would put `mid` first; the stored order is who can
		// actually play this week.
		const players = [
			player("me"),
			player("mid", { r: 1505, lastActive: "2026-08-01" }),
			player("far", { r: 1560, lastActive: TODAY }),
			player("near", { r: 1520, lastActive: RECENT }),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });
		expect(idsFor(lists, "me")).toEqual(["far", "near", "mid"]);
	});

	it("is deterministic — same inputs, same lists in the same order", () => {
		const players = pool(20);
		const a = buildRecommendations({ players, duels: [], today: TODAY });
		const b = buildRecommendations({ players, duels: [], today: TODAY });
		expect([...a.entries()]).toEqual([...b.entries()]);
	});
});
