// Bake each worker-buildable improvement's build cost from the OW reference
// XML, so the Economy tab can price what a player's workers actually spent
// their turns on.
//
// In Old World a worker parked on a tile adds one turn of progress per turn,
// so an improvement's <iBuildTurns> IS its worker-turn cost. Emitted alongside
// the improvement's class (the axis the ledger groups by — a Mine and a
// Great Mine are both "Mine" work) and whether it's rural, urban or a wonder.
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/improvement.xml       — <Entry> with <zType>,
//     <iBuildTurns>, <Class>, <bBuild> (worker-buildable), <bUrban>, <bWonder>.
//   Reference/XML/Infos/improvement-event*.xml — DLC/event improvement adds.
//
// Emitted for every <bBuild> entry with a positive <iBuildTurns>, plus
// anything those mature into: an improvement a worker cannot build and that
// no built improvement developed into never cost anyone a worker turn. What
// that drops is captured tribal sites (Slums, Minor City, the ruins →
// settlement line) and event grants (the Laurion Mine, cult shrines).
//
// These are the BASE costs. The game adjusts them per city (a Builder leader
// takes one turn off, Steward of the Land adds one, an Artisans family seat
// takes two off urban builds), and the save records the adjusted figure per
// tile in <ImprovementBuildTurnsOriginal>. Measured against 7,671 improved
// tiles, the base matches 62% of the time and is within ±1 for 96%. Once the
// parser carries the per-tile figure, the ledger should read it instead of
// these and this table becomes the fallback for older blobs.
//
// OUTPUT: src/lib/generated/improvement-builds.ts (checked in, self-contained —
// no .bake sidecar, so bake:finalize never wipes it when this hasn't run).
//
// Run: npm run bake:improvement-builds

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import { format as prettierFormat, resolveConfig } from "prettier";

import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(REPO_ROOT, "src/lib/generated/improvement-builds.ts");

// improvement.xml plus the event/DLC adds that follow the same shape.
const IMPROVEMENT_FILE = /^improvement(-event.*)?\.xml$/;

interface ImprovementEntry {
	zType?: string;
	Class?: string;
	iBuildTurns?: string;
	bBuild?: string;
	bUrban?: string;
	bWonder?: string;
	DevelopImprovement?: string;
}

type Kind = "rural" | "urban" | "wonder";

interface BuildInfo {
	turns: number;
	class: string | null;
	kind: Kind;
	/** Set when this improvement is what a built one matured into. */
	developedFrom?: string;
}

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

async function loadEntries(path: string): Promise<ImprovementEntry[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = parser.parse(xml) as {
		Root?: { Entry?: ImprovementEntry | ImprovementEntry[] };
	};
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");
	const files = (await readdir(infosDir))
		.filter((f) => IMPROVEMENT_FILE.test(f))
		.sort();
	const entryLists = await Promise.all(
		files.map((f) => loadEntries(resolve(infosDir, f))),
	);

	// The first file to define a zType wins, matching how the game layers the
	// base table under its event adds.
	const builds: Record<string, BuildInfo> = {};
	let scanned = 0;
	for (const entries of entryLists) {
		for (const imp of entries) {
			const zType = imp.zType;
			if (zType == null || zType === "") continue;
			scanned += 1;
			if (builds[zType] != null) continue;
			if (imp.bBuild !== "1") continue;
			const turns = Number(imp.iBuildTurns ?? 0);
			if (!Number.isFinite(turns) || turns <= 0) continue;
			builds[zType] = {
				turns,
				class: imp.Class ?? null,
				kind:
					imp.bWonder === "1"
						? "wonder"
						: imp.bUrban === "1"
							? "urban"
							: "rural",
			};
		}
	}

	if (Object.keys(builds).length === 0) {
		throw new Error(
			`bake-improvement-builds: no buildable improvements found in ${files.join(", ")} — did the XML tags change?`,
		);
	}

	// Improvements mature on their own: a Hamlet (4 worker-turns) becomes a
	// Village after 20 turns and a Town after 20 more, and neither of those is
	// buildable. Pricing them at zero would write off work that was really
	// done — 1,332 such tiles across the cached corpus — so a matured
	// improvement inherits the cost and class of whatever built it. Only
	// chains rooted in a buildable improvement inherit; the ruins → settlement
	// line has no built ancestor and stays free, correctly.
	const byType = new Map<string, ImprovementEntry>();
	for (const entries of entryLists) {
		for (const imp of entries) {
			if (imp.zType != null && !byType.has(imp.zType))
				byType.set(imp.zType, imp);
		}
	}
	let inherited = 0;
	for (const [zType, info] of Object.entries(builds)) {
		if (info.developedFrom != null) continue; // only walk from real builds
		let cursor = byType.get(zType)?.DevelopImprovement;
		const seen = new Set<string>([zType]);
		while (cursor != null && cursor !== "" && !seen.has(cursor)) {
			seen.add(cursor);
			// A target that's buildable in its own right keeps its own price.
			if (builds[cursor] == null) {
				builds[cursor] = { ...info, developedFrom: zType };
				inherited += 1;
			}
			cursor = byType.get(cursor)?.DevelopImprovement;
		}
	}

	const lines: string[] = [];
	lines.push(
		"// AUTO-GENERATED by scripts/bake-improvement-builds.ts. Do not edit.",
	);
	lines.push("// Run `npm run bake:improvement-builds` to refresh.");
	lines.push("");
	lines.push("export interface ImprovementBuild {");
	lines.push(
		"\t/** Base worker-turns to build (improvement.xml iBuildTurns). */",
	);
	lines.push("\treadonly turns: number;");
	lines.push(
		"\t/** IMPROVEMENTCLASS_* zType; null for wonders, which have no class. */",
	);
	lines.push("\treadonly class: string | null;");
	lines.push('\treadonly kind: "rural" | "urban" | "wonder";');
	lines.push(
		"\t/** Set when this is what a built improvement matured into (Hamlet → Village → Town). */",
	);
	lines.push("\treadonly developedFrom?: string;");
	lines.push("}");
	lines.push("");
	lines.push(
		"// Every improvement a worker can build (IMPROVEMENT_* zType) → what it",
	);
	lines.push(
		"// costs them, including what it matured into afterwards. Absence means",
	);
	lines.push(
		"// the improvement was never worker-built — a captured tribal settlement",
	);
	lines.push("// or an event grant — and so is free.");
	lines.push(
		"export const IMPROVEMENT_BUILDS: Readonly<Record<string, ImprovementBuild>> = {",
	);
	for (const zType of Object.keys(builds).sort()) {
		lines.push(`\t${JSON.stringify(zType)}: ${JSON.stringify(builds[zType])},`);
	}
	lines.push("};");
	lines.push("");

	const config = await resolveConfig(OUTPUT_TS);
	const formatted = await prettierFormat(lines.join("\n"), {
		...config,
		parser: "typescript",
		filepath: OUTPUT_TS,
	});
	await mkdir(dirname(OUTPUT_TS), { recursive: true });
	if (existsSync(OUTPUT_TS)) {
		const existing = await readFile(OUTPUT_TS, "utf-8");
		if (existing === formatted) {
			console.log("bake-improvement-builds: no changes");
			return;
		}
	}
	await writeFile(OUTPUT_TS, formatted);
	console.log(
		`bake-improvement-builds: ${Object.keys(builds).length} priced improvements (${inherited} inherited through develop chains, of ${scanned} scanned across ${files.length} files) → ${OUTPUT_TS.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
