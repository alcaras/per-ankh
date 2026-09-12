// Turns a tournament's playlist into the shape its Videos tab browses:
// MATCH -> PART -> ANGLE.
//
//   match  one game, one save, one end turn   (tournament_matches)
//   part   one evening at the board           (parts[])
//   angle  one recording of that part         (parts[].streams[])
//
// All three levels already exist in the schema. What the stored data lacks is
// which video belongs to which match, because most `parts[].streams[]` entries
// are channel `/live` URLs that stop resolving once the broadcast ends — 103 of
// 157 on the 2026 tournament. So attribution is computed here, from what the
// tournament already knows about itself, rather than depended on.
//
// Everything in this module is pure. The handler supplies the rows.

import type { Video } from "../video/types";

/**
 * A pause longer than this ends the part.
 *
 * Two hours, and it has less headroom than it looks. The lower bound is the
 * longest real break inside one sitting; the UPPER bound is the shortest real
 * gap BETWEEN two games played the same evening, and on the 2026 tournament
 * that is match 3 — it finished at 20:23 and started again at 23:01, so
 * anything past about 2h35m merges two separate games into one. Raising this
 * needs a tournament that shows a longer mid-sitting break, not a hunch.
 */
const PART_GAP_MS = 2 * 60 * 60 * 1000;

/** How far a part may sit from a scheduled sitting and still be considered it. */
const ALIGN_MS = 36 * 60 * 60 * 1000;

// Thresholds rise with how speculative the rule is. Exact equality is safe at
// any length a real handle reaches — this tournament has a player called "PS" —
// while prefix and fuzzy matching need enough characters to be distinctive.
/** Shortest token that may match a roster name exactly. */
const MIN_EXACT = 2;
/** A token may match a longer roster name by prefix only from this length. */
const MIN_PREFIX = 3;
/** A token may match by edit distance only from this length. */
const MIN_FUZZY = 6;

// These three thresholds are fitted to one tournament's typos: they resolve 185
// of its 196 videos with no ambiguous pairings, and the eleven they miss are
// real-name aliases and an emoji handle that no rule reaches. That fit is the
// weakness — a roster they mis-resolve will do it silently, because the result
// is a boolean rather than a confidence the caller could refuse. If a second
// tournament runs on this, make resolveName return a score and let the handler
// drop anything it is not sure about into `unattributed`, where a human sees it.

export type Angle = "cast" | "pov";

export interface ArchiveAngle {
	video: Video;
	channel: string;
	angle: Angle;
	seconds: number;
	aired: string;
}

export interface ArchivePart {
	n: number;
	aired: string;
	/**
	 * Real time played, in seconds: the union of every angle's broadcast window,
	 * so overlap counts once and gaps do not count at all. Right for both shapes
	 * a part takes — several cameras on the same hours collapse to those hours,
	 * while cameras that relayed one long session between them add up. Taking
	 * the longest single camera instead reported match 80 of the 2026 tournament
	 * (three channels tiling 14:02→17:25, 17:25→22:24, 22:49→00:10) as five
	 * hours of a ten-hour game.
	 */
	seconds: number;
	angles: ArchiveAngle[];
}

const ms = (iso: string | null | undefined): number => {
	const t = iso == null ? NaN : Date.parse(iso);
	return Number.isNaN(t) ? NaN : t;
};

/** Covered milliseconds across windows: overlap once, gaps excluded. */
export function union(windows: [number, number][]): number {
	let total = 0;
	let start: number | null = null;
	let end = 0;
	for (const [a, b] of [...windows].sort((x, y) => x[0] - y[0])) {
		if (start === null || a > end) {
			if (start !== null) total += end - start;
			start = a;
			end = b;
		} else if (b > end) {
			end = b;
		}
	}
	return start === null ? 0 : total + (end - start);
}

const squash = (s: string | null | undefined): string =>
	(s ?? "")
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");

/**
 * Edit distance counting a transposition as one edit, not two, and capped:
 * returns `max + 1` as soon as it is certain to exceed.
 *
 * Transposition matters because it is the typo people actually make — the real
 * miss this was written for is "Queztal" for Quetzal, which plain Levenshtein
 * scores 2 and would need a threshold loose enough to start matching unrelated
 * names.
 */
export function editDistance(a: string, b: string, max: number): number {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let twoBack: number[] = [];
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		let best = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
			if (
				i > 1 &&
				j > 1 &&
				a[i - 1] === b[j - 2] &&
				a[i - 2] === b[j - 1] &&
				twoBack[j - 2] + 1 < d
			)
				d = twoBack[j - 2] + 1;
			row[j] = d;
			if (d < best) best = d;
		}
		if (best > max) return max + 1;
		twoBack = prev;
		prev = row;
	}
	return prev[b.length];
}

/**
 * Which roster name a title token refers to, or null.
 *
 * Three rules, narrowing as they get less certain. Uploaders truncate names
 * ("Cliff" for CLIFF123, "Nestor" for NestorLN) and mistype them ("Queztal"),
 * so exact matching alone leaves roughly one video in ten unattributed.
 */
export function resolveName(token: string, roster: string[]): string | null {
	if (token.length < MIN_EXACT) return null;
	const exact = roster.find((r) => squash(r) === token);
	if (exact !== undefined) return exact;
	if (token.length >= MIN_PREFIX) {
		const byPrefix = roster.filter((r) => squash(r).startsWith(token));
		if (byPrefix.length === 1) return byPrefix[0];
	}
	if (token.length >= MIN_FUZZY) {
		const near = roster.filter((r) => editDistance(squash(r), token, 1) <= 1);
		if (near.length === 1) return near[0];
	}
	return null;
}

const STOP = new Set([
	"old",
	"world",
	"community",
	"tournament",
	"match",
	"part",
	"pt",
	"round",
	"cast",
	"pov",
	"owct",
	"season",
	"trailer",
	"the",
	"end",
	"session",
	"vs",
	"game",
	"of",
	"and",
	"or",
	"live",
	"final",
	"finals",
	"day",
	"post",
]);

/**
 * The roster names a title mentions, in the order they appear. Longer n-grams
 * win, so "Max (3WordName)" is not read as the player "Max" plus noise.
 */
export function playersInTitle(title: string, roster: string[]): string[] {
	const toks = title
		.normalize("NFKD")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	const found: [number, string][] = [];
	const used = new Set<number>();
	for (let n = 4; n >= 1; n--) {
		for (let i = 0; i + n <= toks.length; i++) {
			let taken = false;
			for (let j = i; j < i + n; j++) if (used.has(j)) taken = true;
			if (taken) continue;
			if (n === 1 && STOP.has(toks[i])) continue;
			const hit = resolveName(toks.slice(i, i + n).join(""), roster);
			if (hit === null) continue;
			found.push([i, hit]);
			for (let j = i; j < i + n; j++) used.add(j);
		}
	}
	const seen = new Set<string>();
	return found
		.sort((x, y) => x[0] - y[0])
		.map(([, name]) => name)
		.filter((name) => (seen.has(name) ? false : (seen.add(name), true)));
}

/** Video ids named directly by a match's stored stream links. */
const VIDEO_ID_RE =
	/(?:watch\?v=|youtu\.be\/|youtube\.com\/live\/)([A-Za-z0-9_-]{11})/g;

export function videoIdsInUrl(url: string): string[] {
	return [...url.matchAll(VIDEO_ID_RE)].map((m) => m[1]);
}

/**
 * Who held the camera. Identity first: a video whose uploader IS one of the two
 * players is that player's point of view, and the uploader's user id is on the
 * payload whenever they have linked their channel.
 *
 * Title tags are matched on word boundaries — a bare substring test fires on
 * "broadcast", "podcast" and "castle". The channel-name fallback demands whole
 * equality or a distinctive prefix rather than containment, because containment
 * is unsafe on a real roster: "ant" is a player and "Konstant" is a caster.
 */
export function classifyAngle(
	title: string,
	channel: string,
	players: (string | null)[],
	uploaderUserId: string | null = null,
	playerUserIds: (string | null)[] = [],
): Angle {
	if (uploaderUserId != null && playerUserIds.includes(uploaderUserId))
		return "pov";
	if (/\bpov\b/i.test(title)) return "pov";
	if (/\bcast\b/i.test(title)) return "cast";
	const c = squash(channel);
	if (!c) return "cast";
	const isPlayer = players.some((p) => {
		const n = squash(p);
		if (n.length < MIN_EXACT) return false;
		return c === n || (n.length >= 5 && (c.startsWith(n) || n.startsWith(c)));
	});
	return isPlayer ? "pov" : "cast";
}

export interface TimedVideo {
	video: Video;
	channel: string;
	uploaderUserId: string | null;
	aired: string;
	seconds: number;
}

/**
 * Group one match's videos into parts by broadcast window.
 *
 * Windows, not titles: uploaders have tagged two parts four days apart
 * "Part 2", tagged a continuation "Part 4b", and put the wrong match number on
 * several videos. Air time is reliable for live content, which is nearly all of
 * it. Windows within PART_GAP_MS join, so a stream that dropped and resumed is
 * one part while a genuine second game that evening is two — match 3 of the
 * 2026 tournament played at 17:00 and again at 23:00 on the same day.
 *
 * `scheduledAt` aligns each part to the sitting it belongs to, so a scheduled
 * sitting with no footage can be reported as a gap rather than vanishing. A
 * malformed instant is skipped rather than poisoning the comparison.
 */
export function groupIntoParts(
	videos: TimedVideo[],
	players: (string | null)[],
	playerUserIds: (string | null)[],
	scheduledAt: (string | null)[] = [],
): { parts: ArchivePart[]; gaps: number } {
	const timed = videos
		.filter((v) => !Number.isNaN(ms(v.aired)) && v.seconds > 0)
		.sort((a, b) => ms(a.aired) - ms(b.aired));

	const clusters: { end: number; items: TimedVideo[] }[] = [];
	for (const v of timed) {
		const start = ms(v.aired);
		const end = start + v.seconds * 1000;
		const last = clusters[clusters.length - 1];
		if (last !== undefined && start - last.end <= PART_GAP_MS) {
			if (end > last.end) last.end = end;
			last.items.push(v);
		} else {
			clusters.push({ end, items: [v] });
		}
	}

	const schedule = scheduledAt
		.filter((s): s is string => s != null && !Number.isNaN(ms(s)))
		.sort();
	const claimed = new Set<string>();

	const parts = clusters.map((c, i): ArchivePart => {
		const start = ms(c.items[0].aired);
		let near: string | null = null;
		for (const s of schedule) {
			if (claimed.has(s)) continue;
			if (near === null || Math.abs(ms(s) - start) < Math.abs(ms(near) - start))
				near = s;
		}
		// Claiming is the point: an unclaimed sitting is one nobody filmed, which
		// is what `gaps` reports. Which sitting a part matched is not otherwise
		// interesting, so it is not returned.
		if (near !== null && Math.abs(ms(near) - start) <= ALIGN_MS)
			claimed.add(near);
		return {
			n: i + 1,
			aired: c.items[0].aired,
			seconds:
				union(
					c.items.map((v): [number, number] => [
						ms(v.aired),
						ms(v.aired) + v.seconds * 1000,
					]),
				) / 1000,
			angles: c.items
				.map(
					(v): ArchiveAngle => ({
						video: v.video,
						channel: v.channel,
						angle: classifyAngle(
							v.video.title,
							v.channel,
							players,
							v.uploaderUserId,
							playerUserIds,
						),
						seconds: v.seconds,
						aired: v.aired,
					}),
				)
				.sort((a, b) => b.seconds - a.seconds),
		};
	});

	return { parts, gaps: schedule.filter((s) => !claimed.has(s)).length };
}

/** A match, reduced to what attribution and grouping need from it. */
export interface ArchiveMatchInput {
	match_id: string;
	/** Both occupants, already resolved: snapshot for decided, live for pending. */
	players: [string | null, string | null];
	playerUserIds: [string | null, string | null];
	/** Every scheduled sitting, and every URL stored against them. */
	scheduledAt: (string | null)[];
	streamUrls: string[];
}

export interface AttributionResult {
	/** match_id -> the videos that belong to it. */
	byMatch: Map<string, TimedVideo[]>;
	/** Videos no match claimed, so the failures stay visible rather than dropped. */
	unattributed: TimedVideo[];
}

/**
 * Decide which match each video belongs to.
 *
 * A stored stream link naming a video wins outright — a human said so. Failing
 * that the title is matched against the tournament's own roster, which on the
 * 2026 tournament resolves 185 of 196 videos with no ambiguous pairings. The
 * remainder are real-name aliases and an emoji handle, which no rule reaches
 * and which a stored link is the answer for.
 *
 * The match NUMBER printed in titles is deliberately not used: two different
 * matches there are both tagged "Match 013", and several more carry a number
 * belonging to someone else's game. Names are the reliable part of a title.
 */
export function attributeVideos(
	videos: TimedVideo[],
	matches: ArchiveMatchInput[],
): AttributionResult {
	const byMatch = new Map<string, TimedVideo[]>();
	const unattributed: TimedVideo[] = [];

	const byLinkedId = new Map<string, string>();
	for (const m of matches)
		for (const url of m.streamUrls)
			for (const id of videoIdsInUrl(url)) byLinkedId.set(id, m.match_id);

	const roster = [
		...new Set(
			matches.flatMap((m) => m.players).filter((p): p is string => p != null),
		),
	];
	const pairKey = (a: string, b: string) => [a, b].sort().join(" ");
	const byPair = new Map<string, string[]>();
	for (const m of matches) {
		const [a, b] = m.players;
		if (a == null || b == null) continue;
		const k = pairKey(a, b);
		byPair.set(k, [...(byPair.get(k) ?? []), m.match_id]);
	}

	const claim = (matchId: string, v: TimedVideo) =>
		byMatch.set(matchId, [...(byMatch.get(matchId) ?? []), v]);

	for (const v of videos) {
		const linked = byLinkedId.get(v.video.id);
		if (linked !== undefined) {
			claim(linked, v);
			continue;
		}
		const named = playersInTitle(v.video.title, roster);
		if (named.length >= 2) {
			const candidates = byPair.get(pairKey(named[0], named[1])) ?? [];
			if (candidates.length === 1) {
				claim(candidates[0], v);
				continue;
			}
			// A rematch: the same two players met more than once. Break the tie on
			// air time against each candidate's scheduled sittings.
			if (candidates.length > 1) {
				const start = ms(v.aired);
				let best: string | null = null;
				let bestGap = Infinity;
				for (const id of candidates) {
					const m = matches.find((x) => x.match_id === id);
					for (const s of m?.scheduledAt ?? []) {
						const gap = Math.abs(ms(s) - start);
						if (!Number.isNaN(gap) && gap < bestGap) {
							bestGap = gap;
							best = id;
						}
					}
				}
				if (best !== null) {
					claim(best, v);
					continue;
				}
			}
		}
		unattributed.push(v);
	}
	return { byMatch, unattributed };
}
