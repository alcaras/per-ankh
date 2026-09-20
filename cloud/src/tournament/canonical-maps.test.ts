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

import { describe, expect, it } from "vitest";
import { CANONICAL_SCRIPT_OPTIONS } from "./canonical-map-options";
import {
	CANONICAL_MAP_SCRIPTS,
	CANONICAL_MAP_SCRIPTS_SET,
	scriptOptionsKey,
} from "./canonical-maps";
import { MAP_SCRIPT_OPTIONS } from "../../../src/lib/generated/map-script-options";

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
