// Integration tests for the profile URL a new account is given at first login
// (assignDerivedUserSlug in cloud/src/identity.ts), driven through the real
// /v1/auth/dev/login handler — the same first-login branch the Discord callback
// takes, minus the OAuth round trip.
//
// The properties that matter here are the ones the login path owns rather than
// the slugifier (unit-tested in src/schemas/user.test.ts):
//   * a new account gets a slug derived from the name it will be shown under
//   * a name that doesn't survive slugification gets none, and the login is
//     otherwise unaffected
//   * a name someone already holds gets none — the login never fails over it
//   * derivation runs on the INSERT only, so a returning login can't resurrect
//     a slug the user renamed or released. That last one is what makes "no
//     slug" a state a user can actually hold.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { devLogin } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// Discord snowflakes for this file, distinct from the other auth tests'.
let discordIdCounter = 3000000000000000001n;
function nextDiscordId(): string {
	return String(discordIdCounter++);
}

interface SlugRow {
	user_id: string;
	slug: string | null;
	slug_changed_at: string | null;
}

async function loadByDiscord(discordId: string): Promise<SlugRow | null> {
	return await env.SHARE_DB.prepare(
		"SELECT user_id, slug, slug_changed_at FROM users WHERE discord_id = ?",
	)
		.bind(discordId)
		.first<SlugRow>();
}

async function loginAs(displayName: string): Promise<SlugRow> {
	const discordId = nextDiscordId();
	const res = await devLogin({
		discordId,
		username: `u${discordId.slice(-8)}`,
		displayName,
	});
	expect(res.status).toBe(302);
	const row = await loadByDiscord(discordId);
	expect(row).toBeTruthy();
	return row!;
}

describe("derived profile URL at first login", () => {
	it("derives the slug from the display name", async () => {
		const row = await loginAs("Marcus Licinius");
		expect(row.slug).toBe("marcus-licinius");
	});

	// NULL here is what tells the rename cooldown this name was issued rather
	// than chosen, which is what keeps the user's first correction immediate.
	it("leaves slug_changed_at NULL, so the user's first change is free", async () => {
		const row = await loginAs("Servius Tullius");
		expect(row.slug).toBe("servius-tullius");
		expect(row.slug_changed_at).toBeNull();
	});

	it.each([
		["ばか", "a name with nothing in the slug charset"],
		["Jo", "a name under the 3-char floor"],
		["Admin", "a reserved name"],
	])("assigns nothing for %j (%s), and the login still works", async (name) => {
		const row = await loginAs(name);
		expect(row.slug).toBeNull();
		// The account exists and is usable — no slug is a normal state, not a
		// failed signup.
		expect(row.user_id).toHaveLength(21);
	});

	it("assigns nothing when the derived name is already taken", async () => {
		const first = await loginAs("Gaius Marius");
		expect(first.slug).toBe("gaius-marius");

		// A second player with the same display name. No numeric suffix, no
		// stolen name: the later account simply has none.
		const second = await loginAs("Gaius Marius");
		expect(second.slug).toBeNull();
		expect(second.user_id).not.toBe(first.user_id);
	});
});

describe("derivation does not run on a returning login", () => {
	it("does not restore a released slug", async () => {
		const discordId = nextDiscordId();
		const username = `u${discordId.slice(-8)}`;
		await devLogin({ discordId, username, displayName: "Appius Claudius" });
		expect((await loadByDiscord(discordId))?.slug).toBe("appius-claudius");

		// Stand in for DELETE /v1/users/me/slug, whose own behaviour is covered
		// in users/slug.test.ts — what's under test is the login that follows.
		await env.SHARE_DB.prepare(
			`UPDATE users SET slug = NULL, slug_changed_at = datetime('now')
			 WHERE discord_id = ?`,
		)
			.bind(discordId)
			.run();

		await devLogin({ discordId, username, displayName: "Appius Claudius" });
		expect((await loadByDiscord(discordId))?.slug).toBeNull();
	});

	it("does not overwrite a renamed slug, even one that no longer matches the display name", async () => {
		const discordId = nextDiscordId();
		const username = `u${discordId.slice(-8)}`;
		await devLogin({ discordId, username, displayName: "Quintus Fabius" });

		await env.SHARE_DB.prepare(
			`UPDATE users SET slug = 'cunctator', slug_changed_at = datetime('now')
			 WHERE discord_id = ?`,
		)
			.bind(discordId)
			.run();

		await devLogin({ discordId, username, displayName: "Quintus Fabius" });
		expect((await loadByDiscord(discordId))?.slug).toBe("cunctator");
	});
});
