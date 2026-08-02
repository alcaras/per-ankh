import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { RESERVED_USER_SLUGS, SlugSchema } from "./user";

// The user slug is claimed once and then can't be changed by the user, and it
// becomes a public URL — so what the schema accepts is the whole of the
// decision. Pin the format, the normalization that happens before it, and the
// reserved list.

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
