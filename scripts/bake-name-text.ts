// Bake the NAME_<zType> → English display name table from the OW reference XML
// so characters show the name the game gives them ("Muwattalli") instead of the
// title-cased internal enum ("Hittite Male03").
//
// formatEnum() is right for most of the base game by accident — NAME_ASHURBANIPAL
// title-cases straight to "Ashurbanipal". It has nothing to recover where the
// token is an opaque index (the whole Hatti pool is NAME_HITTITE_MALE01..26 /
// FEMALE01..20), where the token carries a prefix the name doesn't
// (NAME_TUTOR_ARISTOTLE → "Aristotle", NAME_ALEXANDER_HISTORICAL → "Alexander"),
// where token and name are simply unrelated (NAME_PROPHET → "Jonah",
// NAME_SUN_GAMELAT → "Ishtar-gamelat"), or where the name is hyphenated
// (NAME_SAMMU_RAMAT → "Sammu-ramat", which we'd print as "Sammu Ramat").
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/name.xml     — enumerates <Entry> with <zType> and
//                                       <Name> (a TEXT_NAME_* key).
//   Reference/XML/Infos/text-*.xml   — <Entry> with <zType>TEXT_NAME_* and
//                                       <en-US>. Name text is spread over seven
//                                       of these (text-name.xml, text-eoti.xml,
//                                       text-name-hittite.xml, …), so merge all
//                                       text-*.xml as the goal-names bake does.
//
// OUTPUT: .bake/name-text.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module at
// src/lib/generated/name-text.ts.
//
// We emit only entries whose resolved name differs from the runtime formatEnum()
// fallback — matching the tech/goal/difficulty bakes — so the ~960 names that
// already format correctly fall through without a lookup. The fallback also has
// to stay because it's the only thing covering name tokens that appear in saves
// but not in this Reference snapshot (newer content), and the handful of
// name.xml entries with no TEXT_NAME_* row anywhere.
//
// Run: npm run bake:name-text

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";
import { formatEnum } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/name-text.json");

interface NameEntry {
	zType?: string;
	Name?: string;
}
interface TextEntry {
	zType?: string;
	"en-US"?: string;
}

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

async function loadEntries<T>(path: string): Promise<T[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = parser.parse(xml) as { Root?: { Entry?: T | T[] } };
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

// OW packs a localized string's grammatical variants into one ~-separated
// field (nation text is "Hatti~Hittite~a Hittite~Hittites"; the French name
// rows are "Mursili~de Mursili~que Mursili"). The first field is the plain
// display form — the only one en-US name rows carry today.
function displayForm(raw: string): string {
	return raw.split("~")[0].trim();
}

async function main(): Promise<void> {
	const xmlDir = resolveReferenceXml();
	const infosDir = resolve(xmlDir, "Infos");
	const namePath = resolve(infosDir, "name.xml");

	const allFiles = await readdir(infosDir);
	const textFiles = allFiles
		.filter((f) => /^text-.*\.xml$/.test(f))
		.map((f) => resolve(infosDir, f));

	const [nameEntries, ...textFileEntries] = await Promise.all([
		loadEntries<NameEntry>(namePath),
		...textFiles.map((p) => loadEntries<TextEntry>(p)),
	]);

	const textByKey = new Map<string, string>();
	for (const entries of textFileEntries) {
		for (const t of entries) {
			if (t.zType && t["en-US"]) {
				textByKey.set(t.zType, t["en-US"]);
			}
		}
	}

	const overrides: Record<string, string> = {};
	let missingText = 0;
	for (const name of nameEntries) {
		const zType = name.zType;
		const nameKey = name.Name;
		if (!zType || !zType.startsWith("NAME_")) continue;

		const raw = nameKey ? textByKey.get(nameKey) : undefined;
		if (!raw) {
			missingText++;
			continue;
		}

		const display = displayForm(raw);
		if (!display) continue;

		// Skip names whose resolved text already matches formatEnum.
		if (display === formatEnum(zType, "NAME_")) continue;

		overrides[zType] = display;
	}

	// Sort keys for deterministic output.
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(overrides).sort()) {
		sorted[key] = overrides[key];
	}

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(SIDECAR, JSON.stringify(sorted, null, "\t") + "\n", "utf-8");

	const total = nameEntries.filter((n) => n.zType?.startsWith("NAME_")).length;
	console.log(
		`bake-name-text: ${Object.keys(sorted).length} overrides emitted (of ${total} names, ${missingText} with no text entry, merged ${textFiles.length} text-*.xml files) → ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
