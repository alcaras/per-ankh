// Old World map-script zTypes with friendly display labels.
//
// A `value` here is the zType Old World declares for the script — the exact
// string a save carries. Saves write `mapClass().mzType` (GameParameters.cs
// WriteAttributeString("MapClass", …), Game.cs WriteElementString("MapClass",
// …)), so a token observed in a save IS the declared zType, and it is the
// strongest evidence available for what a script is called.
//
// Not Reference/XML: the mapClass.xml we ship declares exactly one entry,
// MAPCLASS_RANDOM. Every real script is declared by base-game or DLC content
// absent from that snapshot, so the zTypes below are corroborated instead
// from globalsType.xml's DEFAULT_MAPCLASS_SP/MP, the mod maps under
// Reference/XML/Mods, the literal getType<MapClassType>("…") calls in
// GameParameters.cs, and — for everything those miss — the uploaded corpus.
//
// Two identifier spaces meet here, and conflating them is what this table
// previously got wrong:
//
//   * the zType, above, which saves and tournament rows carry;
//   * the C# class name, which is what scripts/bake-map-options.ts reads off
//     Reference/Source/…/MapScripts/*.cs to build MAP_SCRIPT_OPTIONS. The bake
//     has no zType to read — mapClass.xml doesn't declare these — so it keys
//     on `MAPCLASS_` + filename and always will.
//
// They coincide for most scripts and diverge for four, whose entries carry an
// explicit `optionsKey`. The filename quirks the bake preserves verbatim
// (MapScripLakesAndGulfs' missing 't', MapScriptMediterrancean's misspelling)
// are quirks of the *filenames*; the zTypes spell both correctly.
//
// Update this list when a new DLC ships or Mohawk renames an entry. A new
// script's zType is a guess until a save carrying it lands — the C# filename
// is the best available prior, and the four `optionsKey` entries below are
// what that prior costs when it turns out to be wrong.

import { formatMapClass } from "$lib/utils/formatting";

export type MapScriptDlc = "base" | "wrath_of_gods" | "empires_of_the_indus";

export interface MapScriptInfo {
	// The script's zType — what a save's MapClass holds and what a tournament
	// map_pool entry stores. See the header on how each is corroborated.
	value: string;
	label: string;
	// Short form for the compact map-pool label (e.g. "CRB", "AridP", "DOTA").
	// Kept terse but recognizable so a pool reads at a glance; the full `label`
	// is still shown in tooltips and the read-only summary.
	abbrev: string;
	dlc: MapScriptDlc;
	// zTypes of superseded versions of this same script, still carried by the
	// saves that were played on them. Old World retires a script by replacing
	// its content rather than by registering a replacement in mReplacedXMLTypes
	// (Infos.cs), so nothing in the game maps an old token to the new one — a
	// save uploaded years ago is the only place the old spelling survives, and
	// this is where we record that the two name one map.
	//
	// Resolved for display (label, abbrev) so both spellings read alike.
	// Deliberately NOT accepted as a map_pool value: a pool offering two
	// spellings of one map is a pool that can pair the "same" map twice.
	aliases?: readonly string[];
	// This script's key in the baked MAP_SCRIPT_OPTIONS manifest, when it
	// differs from `value` — i.e. when OW's zType and its C# class name
	// disagree. Present on exactly the four scripts where they do; read
	// through mapScriptOptionsKey rather than indexed directly.
	optionsKey?: string;
}

export const DLC_GROUP_LABELS: Record<MapScriptDlc, string> = {
	base: "Base game",
	wrath_of_gods: "Wrath of Gods",
	empires_of_the_indus: "Empires of the Indus",
};

export const KNOWN_MAP_SCRIPTS: MapScriptInfo[] = [
	{
		value: "MAPCLASS_MapScriptArchipelago",
		label: "Archipelago",
		abbrev: "Arch",
		dlc: "base",
	},
	{
		// Short zType, long class name (MapScriptAridPlateau.cs).
		value: "MAPCLASS_AridPlateau",
		label: "Arid Plateau",
		abbrev: "AridP",
		dlc: "base",
		optionsKey: "MAPCLASS_MapScriptAridPlateau",
	},
	{ value: "MAPCLASS_MapScriptBay", label: "Bay", abbrev: "Bay", dlc: "base" },
	{
		// Short zType, long class name. The one script the shipped XML names
		// outright: globalsType.xml gives DEFAULT_MAPCLASS_MP as
		// MAPCLASS_CoastalRainBasin, and LBP-PersiaTheGood.xml maps to it.
		value: "MAPCLASS_CoastalRainBasin",
		label: "Coastal Rain Basin",
		abbrev: "CRB",
		dlc: "base",
		optionsKey: "MAPCLASS_MapScriptCoastalRainBasin",
	},
	{
		value: "MAPCLASS_MapScriptContinent",
		label: "Continent",
		abbrev: "Cont",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptDesert",
		label: "Desert",
		abbrev: "Desert",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptDisjunction",
		label: "Disjunction",
		abbrev: "Disj",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptDonut",
		label: "Donut",
		abbrev: "Donut",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptHardwoodForest",
		label: "Hardwood Forest",
		abbrev: "Hardwood",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptHighlands",
		label: "Highlands",
		abbrev: "Highlands",
		dlc: "base",
	},
	{
		// The trailing digit is in the zType itself (LBP-EgyptTheJust.xml maps
		// to it), not just the filename. MapScriptInlandSea is the retired
		// first version — no MapScriptInlandSea.cs remains, so a save carrying
		// it predates the replacement.
		value: "MAPCLASS_MapScriptInlandSea2",
		label: "Inland Sea",
		abbrev: "InlSea",
		dlc: "base",
		aliases: ["MAPCLASS_MapScriptInlandSea"],
	},
	{
		// MapScripLakesAndGulfs.cs is missing a 't'; the zType is not.
		value: "MAPCLASS_MapScriptLakesAndGulfs",
		label: "Lakes and Gulfs",
		abbrev: "L&G",
		dlc: "base",
		optionsKey: "MAPCLASS_MapScripLakesAndGulfs",
	},
	{
		// MapScriptMediterrancean.cs is misspelled; the zType is not.
		value: "MAPCLASS_MapScriptMediterranean",
		label: "Mediterranean",
		abbrev: "Med",
		dlc: "base",
		optionsKey: "MAPCLASS_MapScriptMediterrancean",
	},
	{
		value: "MAPCLASS_MapScriptContinents",
		label: "Multiple Continents",
		abbrev: "MultiC",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptNorthernOcean",
		label: "Northern Ocean",
		abbrev: "NOcean",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptPlayerIslands",
		label: "Player Islands",
		abbrev: "Islands",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptSeaside",
		label: "Seaside",
		abbrev: "Seaside",
		dlc: "base",
	},

	{
		value: "MAPCLASS_MapScriptDesolation",
		label: "Desolation",
		abbrev: "Desol",
		dlc: "wrath_of_gods",
	},
	{
		value: "MAPCLASS_MapScriptEbbingSea",
		label: "Ebbing Sea",
		abbrev: "Ebbing",
		dlc: "wrath_of_gods",
	},
	{
		value: "MAPCLASS_MapScriptRejuvenation",
		label: "Rejuvenation",
		abbrev: "Rejuv",
		dlc: "wrath_of_gods",
	},
	{
		value: "MAPCLASS_MapScriptTumblingMountain",
		label: "Tumbling Mountain",
		abbrev: "Tumbling",
		dlc: "wrath_of_gods",
	},

	{
		value: "MAPCLASS_MapscriptJungle",
		label: "Deep Jungle",
		abbrev: "Jungle",
		dlc: "empires_of_the_indus",
	},
	{
		value: "MAPCLASS_MapScriptDota",
		label: "Duel of the Ancients",
		abbrev: "DOTA",
		dlc: "empires_of_the_indus",
	},
	{
		value: "MAPCLASS_MapscriptMountainPass",
		label: "Mountain Pass",
		abbrev: "MtnPass",
		dlc: "empires_of_the_indus",
	},
	{
		value: "MAPCLASS_MapscriptWetlands",
		label: "Wetlands",
		abbrev: "Wetlands",
		dlc: "empires_of_the_indus",
	},
];

// Every spelling a script answers to — its zType and any superseded ones —
// mapped to the one entry that describes it. Aliases are folded in here rather
// than at each call site so a legacy token labels itself correctly wherever it
// surfaces, instead of relying on formatMapClass landing on the right words by
// coincidence of the prefix strip.
const infoBySpelling: Record<string, MapScriptInfo> = Object.fromEntries(
	KNOWN_MAP_SCRIPTS.flatMap((s) => [
		[s.value, s] as const,
		...(s.aliases ?? []).map((a) => [a, s] as const),
	]),
);

// Friendly display name for any map_script. Falls back to the generic
// PascalCase-split formatter for unknown values (future DLCs not yet added to
// this table, and the zType of a new script we guessed wrong).
export function mapScriptLabel(value: string | null | undefined): string {
	if (!value) return "Unknown";
	return infoBySpelling[value]?.label ?? formatMapClass(value);
}

// Short form of a map_script name for compact pool labels (e.g. "CRB").
// Falls back to the full friendly label for unknown values, so a future
// DLC script still renders something sensible until it's added above.
export function mapScriptAbbrev(value: string | null | undefined): string {
	if (!value) return "Unknown";
	return infoBySpelling[value]?.abbrev ?? mapScriptLabel(value);
}

// The key a script takes in the baked MAP_SCRIPT_OPTIONS manifest, which is
// keyed by C# class name rather than zType — see the header. Unknown values
// pass through unchanged so the caller's own lookup decides what to do with
// them, which is the same answer they got before this indirection existed.
export function mapScriptOptionsKey(value: string): string {
	const info = infoBySpelling[value];
	return info?.optionsKey ?? info?.value ?? value;
}

// Returns map scripts grouped by DLC, with already-allowed values excluded.
// Used to populate the "Add map" dropdown so admins can only pick maps not
// already in the tournament's list.
export function unaddedMapScriptsByDlc(
	allowed: readonly string[],
): { dlc: MapScriptDlc; entries: MapScriptInfo[] }[] {
	const allowedSet = new Set(allowed);
	const groups: { dlc: MapScriptDlc; entries: MapScriptInfo[] }[] = [
		{ dlc: "base", entries: [] },
		{ dlc: "wrath_of_gods", entries: [] },
		{ dlc: "empires_of_the_indus", entries: [] },
	];
	for (const s of KNOWN_MAP_SCRIPTS) {
		if (allowedSet.has(s.value)) continue;
		const group = groups.find((g) => g.dlc === s.dlc);
		if (group) group.entries.push(s);
	}
	return groups.filter((g) => g.entries.length > 0);
}

// All known map scripts grouped by DLC. Used by the maps panel's "Add a map"
// picker — with the map_pool model the same script can be added multiple times
// (with different options), so the picker never excludes already-added scripts.
export function allMapScriptsByDlc(): {
	dlc: MapScriptDlc;
	entries: MapScriptInfo[];
}[] {
	return unaddedMapScriptsByDlc([]);
}
