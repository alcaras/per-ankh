// `./per-ankh admin duel-event-titles` — the distinct set of event-story titles
// that have fired in a two-player multiplayer duel, swept from the raw saves.
//
// SOURCE — the raw saves, not the stored blob. `story_events` only began
// shipping a game's whole history at parser 2.14.0; below that the blob carries
// the newest 100 player-scoped rows and no character- or city-scoped rows at
// all (cloud/src/schemas/game.ts). Much of the corpus predates 2.14.0, so the
// blob would answer a truncated question. The raw ZIP at saves/<game_id>.zip
// has been written on every upload since the first cloud commit (a6d637a, the
// same commit that created the games table), and the save is the authoritative
// record: each <...EventStoryTurn> container holds one child per event type
// that fired, tag name = the EVENTSTORY_* zType (docs/save-file-format.md).
//
// DUEL — map_size covers both zTypes the corpus carries: MAPSIZE_SMALLEST (the
// current name, shown in-game as "Duel") and MAPSIZE_DUEL (legacy; no longer in
// mapSize.xml). "Two-player multiplayer" is expressed as exactly two players,
// both human — that test is what actually decides it. game_mode only rules out
// the two single-player modes, so an unlisted mode (LAN is already in the
// corpus) still counts rather than being dropped unseen.
//
// Slow by nature: one wrangler spawn per save, hundreds of them. Downloads are
// cached on disk and reused, so re-running to reshape the output costs no
// further remote reads.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { XMLParser } from "fast-xml-parser";

import { d1Query, r2Get, sqlStr } from "../wrangler";
import type { CommandOpts } from "../../lib/cli";
import { flagInt, flagString, parseFlags, printJson } from "../../lib/cli";
import { bold, dim, info, warn } from "../../lib/format";
import { resolveReferenceXml } from "../../lib/paths";
import { extractXmlFromZip } from "../../../src/lib/parser/extract-zip";
import { stripMarkup } from "../../../src/lib/utils/formatting";

// Both spellings of the duel map size present in the corpus.
const DUEL_MAP_SIZES = ["MAPSIZE_SMALLEST", "MAPSIZE_DUEL"];
const SINGLE_PLAYER_MODES = ["SINGLE_PLAYER", "SINGLE_PLAYER_SIMPLE"];

const sqlList = (values: string[]): string => values.map(sqlStr).join(", ");

// A save records a fired event as an element named for its zType, e.g.
// <EVENTSTORY_COURTIER_MISSION_FOOD>32</EVENTSTORY_COURTIER_MISSION_FOOD>.
// Only opening tags match (the leading `<` is not followed by `/`), and zTypes
// carrying the prefix appear nowhere else in the save as an element name, so
// this needs no structural walk of the three containers that hold them.
const EVENT_TAG = /<(EVENTSTORY_[A-Z0-9_]+)>/g;

interface GameRow {
	game_id: string;
	game_mode: string | null;
}

interface XmlEntry {
	zType?: string;
	Name?: string;
	"en-US"?: string;
}

const xmlParser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

async function loadEntries(path: string): Promise<XmlEntry[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = xmlParser.parse(xml) as {
		Root?: { Entry?: XmlEntry | XmlEntry[] };
	};
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

// zType → English title, plus every zType the reference data defines. Titles
// resolve in two hops the same way the bake scripts do it: eventStory*.xml
// gives each event a <Name> text key, and the key is looked up in a map merged
// across every text-*.xml. The merge matters — 361 of the title keys live
// outside text-eventStoryTitle*.xml (EOTI's, for instance, sit in
// text-eventStory-eoti.xml alongside the body copy).
//
// `known` is returned alongside because a zType with no title is two different
// things: an event the data defines but leaves untitled (no <Name> at all —
// the silent setup and chain-link halves of an event, which never raise a
// titled popup), and an event absent from the current XML entirely (played on
// a version since changed). The report has to tell those apart.
async function loadTitles(): Promise<{
	titles: Map<string, string>;
	known: Set<string>;
}> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");
	const files = await readdir(infosDir);

	const storyFiles = files.filter((f: string) => /^eventStory.*\.xml$/.test(f));
	const textFiles = files.filter((f: string) => /^text-.*\.xml$/.test(f));

	const [storyEntries, textEntries] = await Promise.all([
		Promise.all(
			storyFiles.map((f: string) => loadEntries(resolve(infosDir, f))),
		),
		Promise.all(
			textFiles.map((f: string) => loadEntries(resolve(infosDir, f))),
		),
	]);

	const textByKey = new Map<string, string>();
	for (const entries of textEntries) {
		for (const t of entries) {
			if (t.zType && t["en-US"]) textByKey.set(t.zType, t["en-US"]);
		}
	}

	const titles = new Map<string, string>();
	const known = new Set<string>();
	for (const entries of storyEntries) {
		for (const e of entries) {
			if (!e.zType?.startsWith("EVENTSTORY_")) continue;
			known.add(e.zType);
			if (!e.Name) continue;
			const raw = textByKey.get(e.Name);
			if (!raw) continue;
			const title = stripMarkup(raw).trim();
			if (title) titles.set(e.zType, title);
		}
	}
	return { titles, known };
}

// Run `task` over `items` with a bounded number in flight. Wrangler spawns
// dominate the wall clock and each decompressed save is held in memory while
// it is scanned, so both ends want a ceiling.
async function mapLimit<T>(
	items: T[],
	limit: number,
	task: (item: T, index: number) => Promise<void>,
): Promise<void> {
	let next = 0;
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			for (;;) {
				const i = next++;
				if (i >= items.length) return;
				await task(items[i], i);
			}
		},
	);
	await Promise.all(workers);
}

function buildReport(
	named: Set<string>,
	zTypeCount: number,
	scanned: number,
	untitled: string[],
	unknown: string[],
): string {
	const lines: string[] = [
		"# Event titles fired in two-player multiplayer duels",
		"",
		`${named.size} distinct titles, from ${zTypeCount} distinct event types across ${scanned} games.`,
		"",
		"Titles are as the game data writes them, so a few carry the runtime",
		"substitution slots the game fills in from the board — {CHARACTER-SHORT-0},",
		"{CITY-0}, {G1:Man:Woman}.",
		"",
		...[...named].sort((a, b) => a.localeCompare(b)).map((t) => `- ${t}`),
	];
	if (untitled.length > 0) {
		lines.push(
			"",
			`## Untitled in the game data (${untitled.length})`,
			"",
			"Defined in eventStory*.xml with no <Name> — the setup and chain-link",
			"halves of an event, which fire without ever raising a titled popup.",
			"",
			...untitled.sort().map((z) => `- \`${z}\``),
		);
	}
	if (unknown.length > 0) {
		lines.push(
			"",
			`## Not in the current reference data (${unknown.length})`,
			"",
			"Fired in a save but absent from eventStory*.xml — removed or renamed",
			"since those games were played.",
			"",
			...unknown.sort().map((z) => `- \`${z}\``),
		);
	}
	return lines.join("\n") + "\n";
}

export async function run(args: string[], opts: CommandOpts): Promise<void> {
	const { flags } = parseFlags(args);
	const concurrency = flagInt(flags, "concurrency", 6);
	const outPath = flagString(flags, "out");
	const cacheDir = resolve(
		flagString(flags, "cache-dir") ?? resolve(tmpdir(), "per-ankh-duel-saves"),
	);
	await mkdir(cacheDir, { recursive: true });

	const games = await d1Query<GameRow>(
		`SELECT g.game_id, g.game_mode
		   FROM games g
		   JOIN player_summaries p ON p.game_id = g.game_id
		  WHERE g.map_size IN (${sqlList(DUEL_MAP_SIZES)})
		    AND COALESCE(g.game_mode, '') NOT IN (${sqlList(SINGLE_PLAYER_MODES)})
		  GROUP BY g.game_id
		 HAVING COUNT(*) = 2 AND SUM(p.is_human) = 2
		  ORDER BY g.game_id`,
	);
	if (games.length === 0) {
		warn("No two-player multiplayer duels matched.");
		return;
	}

	const byMode = new Map<string, number>();
	for (const g of games) {
		const mode = g.game_mode ?? "(null)";
		byMode.set(mode, (byMode.get(mode) ?? 0) + 1);
	}
	info(
		`${games.length} games matched — ` +
			[...byMode]
				.sort((a, b) => b[1] - a[1])
				.map(([mode, n]) => `${mode} ${n}`)
				.join(", "),
	);
	info(`Reading saves (${concurrency} at a time), cache: ${cacheDir}`);

	const zTypes = new Set<string>();
	const missing: string[] = [];
	const failed: Array<{ game_id: string; error: string }> = [];
	let scanned = 0;

	await mapLimit(games, concurrency, async (game, i) => {
		const dest = resolve(cacheDir, `${game.game_id}.zip`);
		try {
			// An empty file from an interrupted earlier run would fail the
			// archive check forever, so only a non-empty cache entry counts.
			const cached = existsSync(dest) && (await stat(dest)).size > 0;
			if (!cached && !(await r2Get(`saves/${game.game_id}.zip`, dest))) {
				missing.push(game.game_id);
				return;
			}
			const buf = await readFile(dest);
			const xml = extractXmlFromZip(
				buf.buffer.slice(
					buf.byteOffset,
					buf.byteOffset + buf.byteLength,
				) as ArrayBuffer,
			);
			for (const m of xml.matchAll(EVENT_TAG)) zTypes.add(m[1]);
			scanned++;
		} catch (e) {
			failed.push({ game_id: game.game_id, error: String(e) });
		}
		if ((i + 1) % 25 === 0) info(`  …${i + 1}/${games.length}`);
	});

	const { titles, known } = await loadTitles();
	const named = new Set<string>();
	const untitled: string[] = [];
	const unknown: string[] = [];
	for (const z of zTypes) {
		const title = titles.get(z);
		if (title) named.add(title);
		else if (known.has(z)) untitled.push(z);
		else unknown.push(z);
	}

	for (const f of failed) warn(`${f.game_id}: ${f.error}`);
	if (missing.length > 0) {
		warn(`${missing.length} save(s) had no object in R2`);
	}

	const report = buildReport(named, zTypes.size, scanned, untitled, unknown);
	if (outPath) {
		await writeFile(resolve(outPath), report, "utf-8");
		info(`Wrote ${resolve(outPath)}`);
	}

	if (opts.json) {
		printJson({
			games_matched: games.length,
			scanned,
			missing,
			failed,
			event_types: zTypes.size,
			titles: [...named].sort((a, b) => a.localeCompare(b)),
			untitled: untitled.sort(),
			unknown: unknown.sort(),
		});
		return;
	}

	if (outPath) {
		process.stdout.write(
			`\n${bold(`${named.size} distinct titles`)} from ${zTypes.size} event types across ${scanned} games\n` +
				`${dim(`untitled ${untitled.length}, unrecognised ${unknown.length}`)}\n`,
		);
		return;
	}
	process.stdout.write(report);
}
