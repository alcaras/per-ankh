// Drift-guard for the map-script vocabulary.
//
// Two identifier spaces meet in the tournament map pool: the zType a script is
// declared under (what a save carries, what a pool stores, what
// CANONICAL_MAP_SCRIPTS lists) and the C# class name the options bake keys on
// (MAP_SCRIPT_OPTIONS, mirrored here as CANONICAL_SCRIPT_OPTIONS). They agree
// for most scripts and diverge for four, which is why scriptOptionsKey exists.
//
// The bug these tests pin: CANONICAL_MAP_SCRIPTS once held class names in
// place of zTypes for four scripts, so a pool could only ever be built from
// values no save has ever carried — and nothing failed, because the pool and
// the corpus never got compared. Asserting that every canonical value resolves
// to a real options manifest is that comparison.
//
// The second describe compares the two hand-maintained tables against each
// other. canonical-maps.ts is a copy of KNOWN_MAP_SCRIPTS — the Worker bundle
// can't ship a SvelteKit-shaped module — and nothing but these assertions
// makes it a copy rather than a second opinion.

import { describe, expect, it } from "vitest";
import { CANONICAL_SCRIPT_OPTIONS } from "./canonical-map-options";
import {
	CANONICAL_MAP_SCRIPTS,
	CANONICAL_MAP_SCRIPTS_SET,
	scriptOptionsKey,
} from "./canonical-maps";
import { MAP_SCRIPT_OPTIONS } from "../../../src/lib/generated/map-script-options";
import {
	KNOWN_MAP_SCRIPTS,
	mapScriptOptionsKey,
} from "../../../src/lib/tournament/map-scripts-table";

describe("canonical map scripts", () => {
	it("lists each script once", () => {
		expect(CANONICAL_MAP_SCRIPTS_SET.size).toBe(CANONICAL_MAP_SCRIPTS.length);
	});

	it("resolves every canonical value to a baked options manifest", () => {
		for (const script of CANONICAL_MAP_SCRIPTS) {
			const key = scriptOptionsKey(script);
			expect(
				MAP_SCRIPT_OPTIONS[key],
				`${script} → ${key} has no entry in the baked manifest`,
			).toBeDefined();
		}
	});

	it("covers every baked script with exactly one canonical value", () => {
		const resolved = CANONICAL_MAP_SCRIPTS.map(scriptOptionsKey);
		expect(new Set(resolved).size).toBe(resolved.length);
		expect(new Set(resolved)).toEqual(new Set(Object.keys(MAP_SCRIPT_OPTIONS)));
	});

	it("keeps the cloud options mirror reachable from every canonical value", () => {
		// validateInstanceOptions rejects a script with no manifest outright, so
		// a value that misses here can never be configured in a pool.
		for (const script of CANONICAL_MAP_SCRIPTS) {
			expect(
				CANONICAL_SCRIPT_OPTIONS[scriptOptionsKey(script)],
				`${script} has no options manifest in the cloud mirror`,
			).toBeDefined();
		}
	});

	it("leaves an unknown script's key alone", () => {
		// The four remapped scripts are the whole of scriptOptionsKey's job;
		// anything else — a future DLC, a legacy token — passes through so the
		// caller's own lookup still decides what it means.
		expect(scriptOptionsKey("MAPCLASS_MapScriptNotAThing")).toBe(
			"MAPCLASS_MapScriptNotAThing",
		);
	});
});

describe("cross-package mirror", () => {
	it("lists exactly the zTypes the lookup table declares", () => {
		expect(new Set(CANONICAL_MAP_SCRIPTS)).toEqual(
			new Set(KNOWN_MAP_SCRIPTS.map((s) => s.value)),
		);
	});

	it("resolves each script's options key identically on both sides", () => {
		// The bug this file was written for was one table disagreeing with
		// another about what a script is called. An options key right on one
		// side and wrong on the other fails the same way, one layer down.
		for (const script of KNOWN_MAP_SCRIPTS) {
			expect(scriptOptionsKey(script.value), script.value).toBe(
				script.optionsKey ?? script.value,
			);
			expect(scriptOptionsKey(script.value), script.value).toBe(
				mapScriptOptionsKey(script.value),
			);
		}
	});

	it("leaves a superseded spelling out of the pool vocabulary entirely", () => {
		// An alias labels itself as its successor and stops there: it is not a
		// value a pool may hold, and neither side lends it that successor's
		// options manifest — otherwise the maps panel would offer editable
		// options for an entry StrictMapScriptSchema rejects on save.
		for (const alias of KNOWN_MAP_SCRIPTS.flatMap((s) => s.aliases ?? [])) {
			expect(CANONICAL_MAP_SCRIPTS_SET.has(alias), alias).toBe(false);
			expect(scriptOptionsKey(alias), alias).toBe(alias);
			expect(mapScriptOptionsKey(alias), alias).toBe(alias);
		}
	});
});
