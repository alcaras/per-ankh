// GET /v1/tournaments/:id/video-archive — match -> part -> angle.
//
// The pure grouping and attribution rules are unit-tested beside the source
// (src/tournament/video-archive.test.ts). What only an isolate can pin is the
// handler: that the playlist comes out of KV, that occupants and turn counts
// come out of D1, which matches are included at all, and that a video no match
// claims still reaches the caller.
//
// No YOUTUBE_API_KEY here, and none is needed: the playlist read goes through
// the SWR cache, so seeding that KV entry is both how the test supplies videos
// and a check that the cache key the handler builds is the one the cache layer
// reads.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";
import { ipHeaders, seedEvents } from "../../helpers/rate-limit";
import { TOURNAMENT_VIEW_PER_HOUR } from "../../../src/tournament/limits";
import type { MatchRow } from "../../../src/tournament/data";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const PLAYLIST = "PLtestplaylistid0000000000000000000";
const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST}`;

interface ArchiveAngle {
	channel: string;
	angle: "cast" | "pov";
	seconds: number;
	video: { id: string; title: string };
}
interface ArchivePart {
	n: number;
	seconds: number;
	angles: ArchiveAngle[];
}
interface ArchiveMatch {
	match_number: number | null;
	status: string;
	slot_a_display_name: string | null;
	slot_b_display_name: string | null;
	total_turns: number | null;
	parts: ArchivePart[];
	gaps: number;
}
interface ArchiveBody {
	matches: ArchiveMatch[];
	unattributed: { id: string }[];
}

/** One playlist video, as the cache holds it after enrichment. */
function video(opts: {
	id: string;
	title: string;
	channel: string;
	aired: string;
	hours: number;
}) {
	return {
		id: opts.id,
		title: opts.title,
		url: `https://www.youtube.com/watch?v=${opts.id}`,
		thumbnail_url: null,
		published_at: opts.aired,
		platform: "youtube" as const,
		duration_seconds: Math.round(opts.hours * 3600),
		uploader_channel_id: `UC${opts.channel}`,
		uploader_name: opts.channel,
	};
}

/**
 * Seed the SWR entry the handler will read. The version prefix is deliberately
 * not hardcoded: it is discovered from whatever key the cache writes, so a
 * CACHE_VERSION bump does not silently turn this test into a no-op that passes
 * because both sides read an empty playlist.
 */
async function seedPlaylist(videos: ReturnType<typeof video>[]): Promise<void> {
	const existing = await env.SESSIONS_KV.list({ prefix: "videos:" });
	const version =
		existing.keys.length > 0
			? /videos:(v\d+):/.exec(existing.keys[0].name)?.[1]
			: undefined;
	const key = `videos:${version ?? "v6"}:youtube:playlist:${PLAYLIST}`;
	await env.SESSIONS_KV.put(
		key,
		JSON.stringify({ fetched_at: Date.now(), videos }),
	);
}

async function archive(tournamentId: string): Promise<ArchiveBody> {
	return expectOk<ArchiveBody>(
		await request.get({
			path: `/v1/tournaments/${tournamentId}/video-archive`,
		}),
	);
}

/** Give a match a reported game with a turn count, as an upload would. */
async function reportWithTurns(
	match: MatchRow,
	turns: number,
	ownerUserId: string,
): Promise<string> {
	const gameId = `g${match.match_id.slice(0, 20)}`;
	await env.SHARE_DB.prepare(
		`INSERT INTO games (game_id, user_id, xml_game_id, total_turns, file_hash,
		 parser_version) VALUES (?, ?, 'x', ?, ?, '1.0.0')`,
	)
		.bind(gameId, ownerUserId, turns, gameId)
		.run();
	await env.SHARE_DB.prepare(
		`UPDATE tournament_matches SET status='complete', winner_slot_id=slot_a_id,
		 game_id=?, slot_a_username='PlayerA', slot_b_username='PlayerB'
		 WHERE match_id=?`,
	)
		.bind(gameId, match.match_id)
		.run();
	return gameId;
}

describe("GET /v1/tournaments/:id/video-archive", () => {
	it("returns nothing when no playlist is configured", async () => {
		const t = await makeTournament({ advanceTo: "swiss" });
		const body = await archive(t.tournamentId);
		expect(body.matches).toEqual([]);
		expect(body.unattributed).toEqual([]);
	});

	it("groups a match's videos into parts and counts one evening once", async () => {
		const t = await makeTournament({ advanceTo: "swiss" });
		await env.SHARE_DB.prepare(
			`UPDATE tournaments SET youtube_playlist_url=? WHERE tournament_id=?`,
		)
			.bind(PLAYLIST_URL, t.tournamentId)
			.run();
		const [match] = await t.matches();
		await reportWithTurns(match, 87, t.admin.userId);

		await seedPlaylist([
			// One evening, two cameras: the same hours filmed twice.
			video({
				id: "aaaaaaaaaa1",
				title: "PlayerA v PlayerB [Cast]",
				channel: "Caster",
				aired: "2026-07-04T17:00:00Z",
				hours: 3,
			}),
			video({
				id: "aaaaaaaaaa2",
				title: "PlayerA v PlayerB [PoV]",
				channel: "PlayerA",
				aired: "2026-07-04T17:02:00Z",
				hours: 2.9,
			}),
			// A second evening, six hours later — past the two-hour join.
			video({
				id: "aaaaaaaaaa3",
				title: "PlayerA v PlayerB - Part 2",
				channel: "Caster",
				aired: "2026-07-04T23:00:00Z",
				hours: 2,
			}),
		]);

		const body = await archive(t.tournamentId);
		const m = body.matches.find((x) => x.match_number === match.match_number);
		expect(m?.parts).toHaveLength(2);
		// Not 5.9: the two cameras saw the same three hours.
		expect(m?.parts[0].seconds).toBeCloseTo(3 * 3600, -1);
		expect(m?.parts[0].angles.map((a) => a.angle).sort()).toEqual([
			"cast",
			"pov",
		]);
		expect(m?.parts[1].seconds).toBeCloseTo(2 * 3600, -1);
		expect(m?.total_turns).toBe(87);
	});

	it("adds up a relay where channels covered different stretches", async () => {
		const t = await makeTournament({ advanceTo: "swiss" });
		await env.SHARE_DB.prepare(
			`UPDATE tournaments SET youtube_playlist_url=? WHERE tournament_id=?`,
		)
			.bind(PLAYLIST_URL, t.tournamentId)
			.run();
		const [match] = await t.matches();
		await reportWithTurns(match, 120, t.admin.userId);

		await seedPlaylist([
			video({
				id: "bbbbbbbbbb1",
				title: "PlayerA v PlayerB",
				channel: "First",
				aired: "2026-09-05T14:00:00Z",
				hours: 3,
			}),
			video({
				id: "bbbbbbbbbb2",
				title: "PlayerA v PlayerB",
				channel: "Second",
				aired: "2026-09-05T17:00:00Z",
				hours: 3,
			}),
		]);

		const body = await archive(t.tournamentId);
		const m = body.matches.find((x) => x.match_number === match.match_number);
		// One continuous evening, two cameras tiling it: six hours, not three.
		expect(m?.parts).toHaveLength(1);
		expect(m?.parts[0].seconds).toBeCloseTo(6 * 3600, -1);
	});

	it("prefers a stored stream link over the title", async () => {
		const t = await makeTournament({ advanceTo: "swiss" });
		await env.SHARE_DB.prepare(
			`UPDATE tournaments SET youtube_playlist_url=? WHERE tournament_id=?`,
		)
			.bind(PLAYLIST_URL, t.tournamentId)
			.run();
		const matches = await t.matches();
		await reportWithTurns(matches[0], 50, t.admin.userId);
		// The link lives on the SECOND match; the title names nobody at all.
		await env.SHARE_DB.prepare(
			`UPDATE tournament_matches SET parts=? WHERE match_id=?`,
		)
			.bind(
				JSON.stringify([
					{
						id: "p1",
						scheduled_at: "2026-07-04T17:00:00Z",
						casters: [],
						streams: [
							{
								url: "https://www.youtube.com/watch?v=cccccccccc1",
								label: null,
							},
						],
					},
				]),
				matches[1].match_id,
			)
			.run();

		await seedPlaylist([
			video({
				id: "cccccccccc1",
				title: "untitled upload",
				channel: "Caster",
				aired: "2026-07-04T17:00:00Z",
				hours: 2,
			}),
		]);

		const body = await archive(t.tournamentId);
		const linked = body.matches.find(
			(x) => x.match_number === matches[1].match_number,
		);
		expect(linked?.parts).toHaveLength(1);
	});

	it("returns a video no match claims instead of dropping it", async () => {
		const t = await makeTournament({ advanceTo: "swiss" });
		await env.SHARE_DB.prepare(
			`UPDATE tournaments SET youtube_playlist_url=? WHERE tournament_id=?`,
		)
			.bind(PLAYLIST_URL, t.tournamentId)
			.run();
		await seedPlaylist([
			video({
				id: "dddddddddd1",
				title: "somebody nobody has ever heard of",
				channel: "Caster",
				aired: "2026-07-04T17:00:00Z",
				hours: 2,
			}),
		]);
		const body = await archive(t.tournamentId);
		expect(body.unattributed.map((v) => v.id)).toEqual(["dddddddddd1"]);
	});

	it("keeps a decided match with no footage and omits an unfilmed pending one", async () => {
		const t = await makeTournament({ advanceTo: "swiss" });
		await env.SHARE_DB.prepare(
			`UPDATE tournaments SET youtube_playlist_url=? WHERE tournament_id=?`,
		)
			.bind(PLAYLIST_URL, t.tournamentId)
			.run();
		const matches = await t.matches();
		await reportWithTurns(matches[0], 60, t.admin.userId);
		await seedPlaylist([]);

		const body = await archive(t.tournamentId);
		const numbers = body.matches.map((m) => m.match_number);
		// The decided one is a gap in the archive, which is worth showing. The
		// pending ones nobody filmed are not news.
		expect(numbers).toContain(matches[0].match_number);
		expect(body.matches.every((m) => m.status === "complete")).toBe(true);
	});

	// The archive is a per-tournament read like its siblings, so it must sit
	// behind the same door and spend from the same budget. Neither is visible
	// from the pure functions.
	it("404s a setup-gated tournament for a stranger", async () => {
		const t = await makeTournament();
		await env.SHARE_DB.prepare(
			`UPDATE tournaments SET youtube_playlist_url=?, status='setup',
			 signups_open=0 WHERE tournament_id=?`,
		)
			.bind(PLAYLIST_URL, t.tournamentId)
			.run();
		await expectErrorCode(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/video-archive`,
			}),
			{ status: 404, code: "TOURNAMENT_NOT_FOUND" },
		);
	});

	it("429s once the per-IP view budget is spent", async () => {
		const t = await makeTournament({ advanceTo: "swiss" });
		await env.SHARE_DB.prepare(
			`UPDATE tournaments SET youtube_playlist_url=? WHERE tournament_id=?`,
		)
			.bind(PLAYLIST_URL, t.tournamentId)
			.run();
		await seedPlaylist([]);
		const ip = "203.0.113.77";
		await seedEvents("tournament_view", ip, TOURNAMENT_VIEW_PER_HOUR);
		const res = await SELF.fetch(
			`http://test/v1/tournaments/${t.tournamentId}/video-archive`,
			{ headers: ipHeaders(ip) },
		);
		expect(res.status).toBe(429);
	});

	it("renders a renamed player under their current name", async () => {
		// The precedence that was inverted once: identity is pinned to the
		// report-time user_id, presentation follows the profile. A player who
		// renames after their match must read as the new name here, exactly as on
		// every other match surface.
		const t = await makeTournament({ advanceTo: "swiss" });
		await env.SHARE_DB.prepare(
			`UPDATE tournaments SET youtube_playlist_url=? WHERE tournament_id=?`,
		)
			.bind(PLAYLIST_URL, t.tournamentId)
			.run();
		const player = await makeUser();
		const [match] = await t.matches();
		await reportWithTurns(match, 70, t.admin.userId);
		await env.SHARE_DB.prepare(
			`UPDATE tournament_matches SET slot_a_user_id=?, slot_a_username='OldHandle'
			 WHERE match_id=?`,
		)
			.bind(player.userId, match.match_id)
			.run();
		await env.SHARE_DB.prepare(
			`UPDATE users SET display_name=? WHERE user_id=?`,
		)
			.bind("NewName", player.userId)
			.run();
		await seedPlaylist([]);

		const body = await archive(t.tournamentId);
		const m = body.matches.find((x) => x.match_number === match.match_number);
		expect(m?.slot_a_display_name).toBe("NewName");
	});
});
