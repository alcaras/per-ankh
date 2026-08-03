import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { SlugSchema } from "./user";
import {
	RESERVED_USER_SLUGS,
	slugifyDisplayName,
	userSlugError,
} from "./user-slug";

// The user slug becomes a public URL, and it arrives two ways: typed by the
// user (SlugSchema, below) or derived from their display name at signup
// (slugifyDisplayName, at the bottom). Both end up in the same column and both
// answer to the same rule, so pin the format, the normalization that happens
// before it, the reserved list, and the character rewrite.

function parse(input: unknown): v.SafeParseResult<typeof SlugSchema> {
	return v.safeParse(SlugSchema, input);
}

describe("SlugSchema — format", () => {
	it.each([
		["abc", "the 3-char floor"],
		["a-b", "an internal hyphen at minimum length"],
		["a".repeat(30), "the 30-char ceiling"],
		["parthia", "an ordinary name"],
		["player-2", "digits and a hyphen"],
		["2fast", "a leading digit"],
		["a--b", "repeated internal hyphens"],
	])("accepts %j — %s", (input) => {
		expect(parse(input).success).toBe(true);
	});

	it.each([
		["ab", "two chars is below the floor"],
		["", "empty"],
		["a".repeat(31), "one over the ceiling"],
		["-abc", "leading hyphen"],
		["abc-", "trailing hyphen"],
		["a_bc", "underscore is not in the charset"],
		["a.bc", "dot is not in the charset"],
		["ab c", "internal space"],
		["abcé", "non-ASCII"],
	])("rejects %j — %s", (input) => {
		expect(parse(input).success).toBe(false);
	});

	it("rejects a non-string", () => {
		expect(parse(42).success).toBe(false);
	});

	it("states the whole rule in one message, safe to show a user", () => {
		const result = parse("ab");
		expect(result.success).toBe(false);
		expect(result.issues?.[0]?.message).toMatch(/3-30 characters/);
	});
});

describe("SlugSchema — normalization", () => {
	it("lowercases, so mixed-case input claims the lowercase name", () => {
		const result = parse("MixedCase");
		expect(result.success).toBe(true);
		expect(result.output).toBe("mixedcase");
	});

	it("trims surrounding whitespace before validating", () => {
		const result = parse("  parthia\n");
		expect(result.success).toBe(true);
		expect(result.output).toBe("parthia");
	});

	// Normalization runs first, so the rules see the value that would be
	// stored — not the raw input. A padded 2-char name is still too short, and
	// a mixed-case reserved word is still reserved.
	it("applies the length rule to the trimmed value", () => {
		expect(parse("  ab  ").success).toBe(false);
	});

	it("applies the reserved list to the lowercased value", () => {
		expect(parse("Admin").success).toBe(false);
	});
});

describe("SlugSchema — reserved names", () => {
	it.each([...RESERVED_USER_SLUGS])("rejects %j", (reserved) => {
		expect(parse(reserved).success).toBe(false);
	});

	// "me" is the exception: at 2 chars the format rule rejects it first, so
	// it never reaches the reserved check. Every other entry answers with the
	// reserved message, which is what the claim UI shows.
	it.each([...RESERVED_USER_SLUGS].filter((s) => s.length >= 3))(
		"says %j is reserved",
		(reserved) => {
			expect(parse(reserved).issues?.[0]?.message).toMatch(/reserved/);
		},
	);

	// The list is impersonation/brand holds only — nothing under /u/ can
	// collide with a route, so a route-shaped name is a legitimate claim.
	it.each(["new", "create", "edit", "settings", "api"])(
		"does not reserve %j, which only the tournament list holds",
		(routeish) => {
			expect(parse(routeish).success).toBe(true);
		},
	);
});

// ---------------------------------------------------------------------------
// slugifyDisplayName — the derivation that gives a new account its URL.
//
// It does the character rewrite and nothing else: callers (the login path and
// `admin backfill-slugs`) run userSlugError over the result and skip the
// assignment on any complaint. So the interesting cases split in two — what it
// rewrites, and what it hands back knowing the caller will refuse it.
// ---------------------------------------------------------------------------

describe("slugifyDisplayName — rewriting", () => {
	it.each([
		["Marcus", "marcus", "the ordinary case, just lowercased"],
		["Marcus Licinius", "marcus-licinius", "space becomes a separator"],
		["  Marcus  ", "marcus", "surrounding whitespace trims off"],
		["Marcus\tLicinius", "marcus-licinius", "any whitespace, not just spaces"],
		["Marcus   Licinius", "marcus-licinius", "a run of spaces is one hyphen"],
		["Marcus_Licinius", "marcuslicinius", "underscore is dropped, not mapped"],
		["Marcus O'Brien", "marcus-obrien", "apostrophe drops out mid-word"],
		["König", "knig", "a stripped accent leaves the rest"],
		["ばか Marcus", "marcus", "non-Latin drops, leaving the Latin part"],
		["Marcus 🏛", "marcus", "emoji drops, and so does its orphaned hyphen"],
		["-Marcus-", "marcus", "leading and trailing hyphens trim"],
		["Marcus--Licinius", "marcus-licinius", "hyphen runs collapse"],
		["player 2", "player-2", "digits survive"],
	])("%j → %j (%s)", (input, expected) => {
		expect(slugifyDisplayName(input)).toBe(expected);
	});

	// The output is what gets stored, so it has to already be in the stored
	// shape — nothing downstream normalizes it a second time.
	it("produces a value the format rule accepts, for an ordinary name", () => {
		expect(userSlugError(slugifyDisplayName("Marcus Licinius"))).toBeNull();
	});
});

describe("slugifyDisplayName — names that yield no slug", () => {
	// Each of these comes back as something userSlugError rejects, which is the
	// signal to assign nothing at all. No suffixes, no truncation, no padding:
	// a user whose name doesn't survive keeps their /users/<user_id> permalink
	// and can pick a name in Settings.
	it.each([
		["ばか", "a name with no Latin characters at all"],
		["🏛🏛🏛", "emoji only"],
		["...", "punctuation only"],
		["Jo", "under the 3-char floor"],
		["J.M.", "initials fall under the floor once the periods drop"],
		["Marcus Licinius Crassus Dives the Elder", "over the 30-char ceiling"],
		["Admin", "a reserved name"],
	])("%j (%s) derives something the rule refuses", (input) => {
		expect(userSlugError(slugifyDisplayName(input))).not.toBeNull();
	});

	it("never invents characters to reach a valid slug", () => {
		expect(slugifyDisplayName("ばか")).toBe("");
		expect(slugifyDisplayName("Jo")).toBe("jo");
	});

	// The ceiling is a refusal, not a trim — a truncated name is one the user
	// never wrote, and half a name in a public URL is worse than none.
	it("does not truncate an over-long name", () => {
		expect(slugifyDisplayName("Marcus Licinius Crassus Dives the Elder")).toBe(
			"marcus-licinius-crassus-dives-the-elder",
		);
	});
});
