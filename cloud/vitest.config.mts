import path from "node:path";
import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { SITE_ADMIN_DISCORD_ID } from "./test/helpers/admin-identity";
import { SSR_TRUSTED_TEST_KEY } from "./test/helpers/ssr-identity";

const MIGRATIONS_PATH = path.resolve(import.meta.dirname, "./migrations");
const SECURITY_MIGRATIONS_PATH = path.resolve(
	import.meta.dirname,
	"./migrations-security",
);

// Two projects:
//   - "unit" runs the existing pure-function tests on the default Node pool.
//     No miniflare overhead; ~ms per test.
//   - "integration" runs handler tests inside a Miniflare Worker isolate with
//     real D1/KV/R2 bindings via `@cloudflare/vitest-pool-workers`.
//
// Migrations are read once at config load and exposed to tests via the
// `TEST_MIGRATIONS` binding. Each test file applies them in beforeAll.
//
// `npm test` runs both. Use `--project unit` or `--project integration` to
// filter.
export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
				},
			},
			{
				plugins: [
					cloudflareTest(async () => ({
						main: "./src/index.ts",
						wrangler: { configPath: "./wrangler.toml" },
						miniflare: {
							bindings: {
								TEST_MIGRATIONS: await readD1Migrations(MIGRATIONS_PATH),
								TEST_SECURITY_MIGRATIONS: await readD1Migrations(
									SECURITY_MIGRATIONS_PATH,
								),
								// Enable the local Discord-free login bypass
								// (GET /v1/auth/dev/login) so integration tests can drive
								// the real claimTournamentSlots path. Mirrors
								// cloud/.dev.vars; prod never sets DEV_LOGIN. The handler
								// also requires a non-HTTPS request, which SELF.fetch's
								// http:// origin satisfies. See cloud/src/auth.ts
								// handleDevLogin.
								DEV_LOGIN: "1",
								// Gives the isolate a site admin (isSiteAdmin matches
								// users.discord_id against it), so the /v1/admin/*
								// endpoints are reachable via makeSiteAdmin(). No
								// makeUser-generated id can collide with it.
								ADMIN_DISCORD_ID: SITE_ADMIN_DISCORD_ID,
								// The frontend Worker's shared key, so tests can send a
								// server-rendered request the way per-ankh.app does and
								// assert what the API believes about the visitor
								// (adoptTrustedFrontend in src/util.ts). Bound here rather
								// than read from .dev.vars — that file is gitignored, and
								// these tests must pass on a fresh checkout.
								SSR_TRUSTED_KEY: SSR_TRUSTED_TEST_KEY,
							},
						},
					})),
				],
				test: {
					name: "integration",
					include: ["test/integration/**/*.test.ts"],
				},
			},
		],
	},
});
