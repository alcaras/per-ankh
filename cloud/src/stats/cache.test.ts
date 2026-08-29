import { describe, expect, it } from "vitest";
import { BUNDLE_SCHEMA_VERSION, cacheKeyToString } from "./cache";
import type { GlobalSlice } from "./types";

const EGYPT = "NATION_EGYPT";
const ROME = "NATION_ROME";

const PARSER = "2.15.0";

const globalKey = (nations: string[], slice: GlobalSlice = "duel") =>
	({
		kind: "global",
		slice,
		nations,
		parser_version: PARSER,
	}) as const;

describe("the global cache key", () => {
	it("carries both version segments the other corpora key on", () => {
		// The schema version is what a serve-stale walk pins and the parser
		// version is what it reaches across, so the two have to be here and in
		// this order for §12's rule to be expressible at all.
		expect(cacheKeyToString(globalKey([]))).toBe(
			`stats:v${BUNDLE_SCHEMA_VERSION}-p${PARSER}:global:duel:`,
		);
	});

	it("gives one selection one spelling however it was ordered", () => {
		// The resolver takes a set so multi-select stays a UI change rather than
		// a key migration. That only holds if the key normalizes too — otherwise
		// one selection caches under as many keys as it has orderings.
		expect(cacheKeyToString(globalKey([ROME, EGYPT]))).toBe(
			cacheKeyToString(globalKey([EGYPT, ROME, EGYPT])),
		);
	});

	it("keeps a faceted selection out of its own slice's suffix", () => {
		// getStaleGlobalCached matches candidates by suffix. The empty nation
		// set leaves the trailing colon that makes the two distinguishable; drop
		// it and a Rome bundle answers a lookup for the whole slice.
		expect(cacheKeyToString(globalKey([ROME])).endsWith(":global:duel:")).toBe(
			false,
		);
	});

	it("keeps one nation out of another's suffix", () => {
		// Same match, the multi-select case: ",NATION_ROME" must not read as
		// the Rome selection.
		expect(
			cacheKeyToString(globalKey([EGYPT, ROME])).endsWith(
				":global:duel:NATION_ROME",
			),
		).toBe(false);
	});

	it("separates the slices", () => {
		expect(cacheKeyToString(globalKey([], "all"))).not.toBe(
			cacheKeyToString(globalKey([], "duel")),
		);
	});
});
