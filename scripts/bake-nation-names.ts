// Bake the NATION_<zType> → English nation name table from the OW reference XML
// so the app calls a nation what the game calls it: NATION_HITTITE is **Hatti**
// (Hittite is its adjective) and NATION_TAMIL is **Tamilakam**.
//
// formatEnum() title-cases the internal id, which happens to match the display
// name for eleven of the thirteen nations. The game resolves it in two hops:
//
//   nation.xml         <zType>NATION_HITTITE</zType>
//                      <GenderedName>GENDERED_TEXT_NATION_HITTITE</GenderedName>
//   genderedText.xml   GENDERED_TEXT_NATION_HITTITE
//                        GRAMMATICAL_GENDER_MASCULINE → TEXT_NATION_HITTITE
//   text-nation-hittite.xml
//                      <en-US>Hatti~Hittite~a Hittite~Hittites</en-US>
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/nation.xml         — <Entry> with <zType> and
//                                             <GenderedName>.
//   Reference/XML/Infos/genderedText*.xml  — <Entry> whose <Texts> pairs map a
//                                             grammatical gender to a TEXT_* key.
//   Reference/XML/Infos/text-*.xml         — <Entry> with <zType>TEXT_NATION_*
//                                             and <en-US>. Merge all of both
//                                             families for DLC adds, as the
//                                             goal-names bake does.
//
// OUTPUT: .bake/nation-names.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module at
// src/lib/generated/nation-names.ts.
//
// We emit only entries whose resolved name differs from the runtime formatEnum()
// fallback — matching the tech/goal/difficulty bakes — so today's table is two
// entries and every other nation falls through without a lookup. Baking the
// table rather than hardcoding those two keeps it honest when DLC adds a nation.
//
// Only the noun (first ~ field) is baked. The adjective / member / plural forms
// have no consumer.
//
// Run: npm run bake:nation-names

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";
import { formatEnum } from "../src/lib/utils/formatting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/nation-names.json");

// The gender whose text is the plain nation name; the feminine row is the
// same name declined for a female ruler.
const MASCULINE = "GRAMMATICAL_GENDER_MASCULINE";

interface NationEntry {
	zType?: string;
	GenderedName?: string;
}
interface GenderedPair {
	zIndex?: string;
	zValue?: string;
}
interface GenderedTextEntry {
	zType?: string;
	Texts?: { Pair?: GenderedPair | GenderedPair[] };
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
// field: "Hatti~Hittite~a Hittite~Hittites" is noun ~ adjective ~ member ~
// plural. The first field is the nation name.
function displayForm(raw: string): string {
	return raw.split("~")[0].trim();
}

async function main(): Promise<void> {
	const xmlDir = resolveReferenceXml();
	const infosDir = resolve(xmlDir, "Infos");
	const nationPath = resolve(infosDir, "nation.xml");

	const allFiles = await readdir(infosDir);
	const genderedFiles = allFiles
		.filter((f) => /^genderedText.*\.xml$/.test(f))
		.map((f) => resolve(infosDir, f));
	const textFiles = allFiles
		.filter((f) => /^text-.*\.xml$/.test(f))
		.map((f) => resolve(infosDir, f));

	const [nationEntries, genderedFileEntries, textFileEntries] =
		await Promise.all([
			loadEntries<NationEntry>(nationPath),
			Promise.all(genderedFiles.map((p) => loadEntries<GenderedTextEntry>(p))),
			Promise.all(textFiles.map((p) => loadEntries<TextEntry>(p))),
		]);

	const textKeyByGendered = new Map<string, string>();
	for (const entries of genderedFileEntries) {
		for (const g of entries) {
			if (!g.zType) continue;
			const pairs = g.Texts?.Pair;
			if (pairs == null) continue;
			const list = Array.isArray(pairs) ? pairs : [pairs];
			const masculine = list.find((p) => p.zIndex === MASCULINE);
			if (masculine?.zValue) textKeyByGendered.set(g.zType, masculine.zValue);
		}
	}

	const textByKey = new Map<string, string>();
	for (const entries of textFileEntries) {
		for (const t of entries) {
			if (t.zType && t["en-US"]) {
				textByKey.set(t.zType, t["en-US"]);
			}
		}
	}

	const overrides: Record<string, string> = {};
	for (const nation of nationEntries) {
		const zType = nation.zType;
		if (!zType || !zType.startsWith("NATION_")) continue;

		const textKey = nation.GenderedName
			? textKeyByGendered.get(nation.GenderedName)
			: undefined;
		const raw = textKey ? textByKey.get(textKey) : undefined;
		if (!raw) continue;

		const display = displayForm(raw);
		if (!display) continue;

		// Skip nations whose resolved name already matches formatEnum.
		if (display === formatEnum(zType, "NATION_")) continue;

		overrides[zType] = display;
	}

	// Sort keys for deterministic output.
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(overrides).sort()) {
		sorted[key] = overrides[key];
	}

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(SIDECAR, JSON.stringify(sorted, null, "\t") + "\n", "utf-8");

	const total = nationEntries.filter((n) =>
		n.zType?.startsWith("NATION_"),
	).length;
	console.log(
		`bake-nation-names: ${Object.keys(sorted).length} overrides emitted (of ${total} nations, merged ${genderedFiles.length} genderedText*.xml and ${textFiles.length} text-*.xml files) → ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
