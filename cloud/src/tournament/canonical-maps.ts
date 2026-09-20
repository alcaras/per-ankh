// Canonical map_script values accepted by the API.
//
// Mirror of the `value` strings in src/lib/tournament/map-scripts.ts
// KNOWN_MAP_SCRIPTS. Keep these two lists in sync when a new DLC ships
// or Mohawk renames an entry.
//
// Each is the zType Old World declares for the script — the exact string a
// save's MapClass carries. That is not always its C# class name; see the
// header on map-scripts.ts for how each zType is corroborated, and
// SCRIPT_OPTIONS_KEYS below for the four where the two disagree.
//
// Why duplicated: cloud/ is a separate package with its own tsconfig
// (cloud/tsconfig.json), bundled by wrangler/esbuild — the Worker bundle has
// no business shipping SvelteKit-shaped modules.
//
// Drift safety net: canonical-maps.test.ts imports map-scripts-table.ts
// across the package boundary and asserts this copy against the original —
// the value list, the options keys below, and that neither side resolves an
// alias — as well as against the baked options manifest, as a bijection. That
// import is a test reading a table, not the Worker importing $lib; the table
// module is kept free of imports precisely so it stays readable from here.
// The admin CLI validates its own input against the same table
// (scripts/admin/commands/tournament.ts).

export const CANONICAL_MAP_SCRIPTS: readonly string[] = [
	// Base game
	"MAPCLASS_MapScriptArchipelago",
	"MAPCLASS_AridPlateau",
	"MAPCLASS_MapScriptBay",
	"MAPCLASS_CoastalRainBasin",
	"MAPCLASS_MapScriptContinent",
	"MAPCLASS_MapScriptDesert",
	"MAPCLASS_MapScriptDisjunction",
	"MAPCLASS_MapScriptDonut",
	"MAPCLASS_MapScriptHardwoodForest",
	"MAPCLASS_MapScriptHighlands",
	"MAPCLASS_MapScriptInlandSea2",
	"MAPCLASS_MapScriptLakesAndGulfs",
	"MAPCLASS_MapScriptMediterranean",
	"MAPCLASS_MapScriptContinents",
	"MAPCLASS_MapScriptNorthernOcean",
	"MAPCLASS_MapScriptPlayerIslands",
	"MAPCLASS_MapScriptSeaside",

	// Wrath of Gods DLC
	"MAPCLASS_MapScriptDesolation",
	"MAPCLASS_MapScriptEbbingSea",
	"MAPCLASS_MapScriptRejuvenation",
	"MAPCLASS_MapScriptTumblingMountain",

	// Empires of the Indus DLC
	"MAPCLASS_MapscriptJungle",
	"MAPCLASS_MapScriptDota",
	"MAPCLASS_MapscriptMountainPass",
	"MAPCLASS_MapscriptWetlands",
];

export const CANONICAL_MAP_SCRIPTS_SET: ReadonlySet<string> = new Set(
	CANONICAL_MAP_SCRIPTS,
);

// zType → the key that script takes in CANONICAL_SCRIPT_OPTIONS, for the four
// scripts whose zType and C# class name disagree. The options manifest is
// baked off Reference/Source/…/MapScripts/*.cs filenames (the bake has no
// zType to read — mapClass.xml declares only MAPCLASS_RANDOM), so it is keyed
// by class name while everything a pool stores is keyed by zType.
//
// Mirror of the `optionsKey` fields in KNOWN_MAP_SCRIPTS. A superseded
// spelling is deliberately absent: it has no manifest of its own and must not
// borrow its successor's, so it falls through unresolved here exactly as it
// does in mapScriptOptionsKey.
const SCRIPT_OPTIONS_KEYS: Readonly<Record<string, string>> = {
	MAPCLASS_AridPlateau: "MAPCLASS_MapScriptAridPlateau",
	MAPCLASS_CoastalRainBasin: "MAPCLASS_MapScriptCoastalRainBasin",
	MAPCLASS_MapScriptLakesAndGulfs: "MAPCLASS_MapScripLakesAndGulfs",
	MAPCLASS_MapScriptMediterranean: "MAPCLASS_MapScriptMediterrancean",
};

// The CANONICAL_SCRIPT_OPTIONS key for a stored map_pool script. Unknown
// values pass through unchanged, so the caller's own lookup still decides
// what an unrecognized script means.
export function scriptOptionsKey(script: string): string {
	return SCRIPT_OPTIONS_KEYS[script] ?? script;
}
