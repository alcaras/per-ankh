// Bake the PROJECT_<zType> → 2D icon name table from the OW reference XML, so
// the Economy tab's project panels can draw the icon the game draws.
//
// A project names its icon with <zIcon>, which is NOT its zType for most of
// them: tiers point at the tier-1 art (PROJECT_FESTIVAL → PROJECT_FESTIVAL_1),
// the import projects name the resource they import (PROJECT_IMPORT_CAMEL →
// RESOURCE_CAMEL), the hidden event projects mostly borrow one of two generic
// glyphs (PROJECT_IRON_INDUSTRY → PROJECT_MONARCH), and the heresy projects
// name a religion or mission glyph. The names cross sprite categories, so the
// runtime (helpers.ts getSpritePath) resolves each icon against projects/,
// resources/ and religions/ in turn.
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/project.xml         — the base project table.
//   Reference/XML/Infos/project-event-*.xml — same info type, split by DLC
//   Reference/XML/Infos/project-event.xml     (eoti / sap / wd / wog) plus the
//                                             base event projects. A save's
//                                             ProjectsProduced can name any of
//                                             them, so all are merged; base
//                                             file loads first and DLC files
//                                             override by zType.
//
// OUTPUT: .bake/project-icons.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module at
// src/lib/generated/project-icons.ts.
//
// We emit only the entries whose <zIcon> differs from their zType — matching
// the name bakers — so a project that names its own art falls through to the
// zType without a lookup.
//
// Run: npm run bake:project-icons

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/project-icons.json");

interface ProjectEntry {
	zType?: string;
	zIcon?: string;
}

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

async function loadEntries(path: string): Promise<ProjectEntry[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = parser.parse(xml) as {
		Root?: { Entry?: ProjectEntry | ProjectEntry[] };
	};
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

// The project-definition files: the base table plus the event projects, whose
// DLC variants are hyphenated (project-event-eoti.xml, …). Deliberately NOT
// text-project*.xml, which holds the localized strings, not the definitions.
function isProjectDefFile(name: string): boolean {
	return name === "project.xml" || /^project-event(-.*)?\.xml$/.test(name);
}

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");
	const defFiles = (await readdir(infosDir)).filter(isProjectDefFile);
	const ordered = [
		...defFiles.filter((f) => f === "project.xml"),
		...defFiles.filter((f) => f !== "project.xml").sort(),
	];

	const overrides: Record<string, string> = {};
	let total = 0;
	for (const file of ordered) {
		for (const entry of await loadEntries(resolve(infosDir, file))) {
			const zType = entry.zType;
			// The template <Entry> at the head of each file has every tag empty.
			if (!zType || !zType.startsWith("PROJECT_")) continue;
			total += 1;
			if (!entry.zIcon || entry.zIcon === zType) continue;
			overrides[zType] = entry.zIcon;
		}
	}

	// Sort keys for deterministic output.
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(overrides).sort()) {
		sorted[key] = overrides[key];
	}

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(SIDECAR, JSON.stringify(sorted, null, "\t") + "\n", "utf-8");

	console.log(
		`bake-project-icons: ${Object.keys(sorted).length} overrides emitted (of ${total} projects across ${ordered.length} file(s)) → ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
