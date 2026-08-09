# Legacy share decommission — deploy procedure

Removes the desktop-era share feature: the `/v1/share/*` Worker endpoints, the `shares`/`blocked_keys`/`blocked_ips` D1 tables (migration `0042`), the frozen `web/` SPA, the `/share/*` → `legacy.per-ankh.app` redirect, and the legacy vars/CLI/admin surfaces that fed them. `per-ankh.app/share/[id]` now serves a static "link retired" tombstone.

The irreversible steps are the `0042` migration (`DROP TABLE`, forward-only, no down) and the R2 blob deletion. Everything else rolls back by redeploying the previous Worker/frontend version. That asymmetry is why the migration rides the deploy pipeline and the R2 deletion goes last in each environment.

## Phase 0 — before touching either environment

**0.1 — Capture the share_id list.** The one irreversible ordering mistake available. Migration `0042` drops `shares`, and `admin shares list` is deleted in this branch, so after migrating there is no record of which R2 keys were legacy. Run from a checkout that still has the command, or raw:

```bash
npx wrangler d1 execute per-ankh-share-index --remote \
  --command "SELECT share_id, app_key, game_name, created_at FROM shares ORDER BY created_at"
```

Save the output outside the repo. **Record the actual row count here and let later phases refer back to it** — the R2 deletion (2.5) and its verification key off this number, so it lives in exactly one place.

**0.2 — Back up prod D1.** `./per-ankh backup` (defaults to remote/production). Forward-only migrations, no down — this snapshot is the only rollback for the dropped tables.

**0.3 — Provision an R2 write token for prod.** This blocks Phase 2.5. `.staging.vars` currently holds `R2_PROD_RO_*` — an **Object Read only** token scoped to `per-ankh-shares`. It can enumerate the legacy blobs but cannot delete them. Either mint an **Object Read & Write** token scoped to `per-ankh-shares` (dashboard → R2 → Manage API tokens), or plan to delete the blobs through the dashboard by hand. Decide now — discovering it mid-cutover is how the R2 step gets skipped and forgotten.

**0.4 — Decide the branch story.** `git.branch` is a blocking preflight check that hard-requires `main`, demoted to warn only by `--allow-branch`. Either merge the decom branch → `main` first (cleaner; prod's changelog phase assumes a normal release), or pass `--allow-branch` on every deploy command. Merging is preferred.

**0.5 — Do not run `./per-ankh staging reclone` between Phases 1 and 2.** Reclone re-copies D1 from prod. With staging migrated and prod not yet, a reclone restores `shares`/`blocked_keys`/`blocked_ips` to staging and you will debug a ghost.

## Phase 1 — staging rehearsal

Staging never served the legacy viewer (`legacyOrigin` was null), but its D1 has all three tables from `0001_baseline`, and its R2 may hold legacy blobs if it was ever recloned from prod. The migration and R2 steps are both live rehearsals here.

**1.1** `./per-ankh staging status` — confirm pending migrations show `0042` and nothing unexpected.

**1.2** `./per-ankh staging preflight` — expect green. Watch `secrets.parity`: 8 keys were removed from both `[vars]` and `[env.staging.vars]`, and the key sets have been verified to still match, but this is the check that catches a miss.

**1.3** `./per-ankh staging deploy --dry-run` — read the printed plan before committing to it.

**1.4** `./per-ankh staging deploy` — runs `preflight → migrate → worker → frontend → smoke`.

**1.5 — Confirm the endpoints are gone.**

```bash
curl -i https://api-staging.per-ankh.app/v1/share/aaaaaaaaaaaaaaaaaaaaa   # expect 404, cloud CORS headers
curl -i -X POST https://api-staging.per-ankh.app/v1/share                  # expect 404, not 400/503
```

A 400 or 503 means the old handler is still mounted.

**1.6** `https://staging.per-ankh.app/share/testid` → 200, "Shared link retired", no redirect.

**1.7 — Staging R2.** Note: `wrangler r2 object` offers only `get`/`put`/`delete` — there is no object-listing command in wrangler. Use rclone, which the repo already configures for exactly this in `scripts/prod/deploy/reclone.ts`. With `CF_ACCOUNT_ID` and `R2_STAGING_RW_*` from `.staging.vars`:

```bash
export RCLONE_CONFIG_STAGINGR2_TYPE=s3
export RCLONE_CONFIG_STAGINGR2_PROVIDER=Cloudflare
export RCLONE_CONFIG_STAGINGR2_REGION=auto
export RCLONE_CONFIG_STAGINGR2_ENDPOINT=https://<CF_ACCOUNT_ID>.r2.cloudflarestorage.com
export RCLONE_CONFIG_STAGINGR2_ACCESS_KEY_ID=<R2_STAGING_RW_ACCESS_KEY_ID>
export RCLONE_CONFIG_STAGINGR2_SECRET_ACCESS_KEY=<R2_STAGING_RW_SECRET_ACCESS_KEY>

# Root-level objects only — everything current lives under games/ or saves/
rclone lsf stagingr2:per-ankh-shares-staging --max-depth 1 --files-only --s3-no-check-bucket
```

`--s3-no-check-bucket` is required — bucket-scoped R2 tokens can't `ListBuckets`. `--max-depth 1 --files-only` isolates root keys from the live `games/` and `saves/` prefixes. **Read the listing and delete by explicit key**, not by glob; the legacy blobs share a bucket with production game data.

**1.8 — Stale `UPLOADS_ENABLED` secret.** It was documented as overridable via `wrangler secret put`, which outlives the `wrangler.toml` var removal:

```bash
npx wrangler secret list --env staging
npx wrangler secret delete UPLOADS_ENABLED --env staging   # if present
```

## Phase 2 — production

**2.1** Confirm 0.1, 0.2, and 0.3 are actually done. Not "probably done."

**2.2** `./per-ankh prod status`, then `./per-ankh prod preflight`.

**2.3** `./per-ankh prod deploy --dry-run`, then `./per-ankh prod deploy`.

The pipeline is `preflight → changelog → migrate → worker → frontend → smoke`, with migrate as step 3 of 6. Let the migration ride the pipeline — the bundled path is the tested one (it gates on preflight, writes the changelog, runs smoke), and hand-running six steps to reorder one trades a small, self-clearing fault for the risk of skipping a step. Only the R2 deletion (2.5) is held for last.

The window that matters is **migrate → worker**: after the tables drop but before the new Worker replaces the old one, the live Worker still runs `share-legacy.ts` querying the now-dropped tables, so those requests **500, not 404** — and because this branch removed `legacy_share_write` from `SECURITY_REASONS`, each one falls through to `server_error` and writes a security-events row. Under a minute, on an endpoint being killed anyway; expect it rather than debug it. (The later worker → frontend window, where `/share/*` still 302s to a legacy host whose API is gone, is cosmetic — the page shows its "not found" state.)

**2.4 — Expect CDN lag.** `GET /v1/share/:id` served `Cache-Control: public, max-age=3600`, so a cached 200 can persist up to an hour past deploy. A share URL still resolving shortly after cutover is the CDN, not a failed deploy — re-check with a cache-busting query string before concluding anything.

**2.5 — Prod R2.** Same rclone approach as 1.7, against `per-ankh-shares`, using the **write-scoped token from 0.3** (`R2_PROD_RO_*` cannot delete). Verify the listing against the 0.1 export before deleting anything. Do this last; it is permanent.

**2.6 — Prod secrets.** Same as 1.8, without `--env staging`.

## Phase 3 — Cloudflare dashboard (prod only)

Dashboard-managed with no config checked into the repo, so none of this is verifiable from a checkout or automated by `./per-ankh prod deploy`.

**Ordering — after the deploy, not before.** The `/share/*` 302 lives in `src/hooks.server.ts` and ships with the *frontend* step. Until that lands, `per-ankh.app/share/*` still redirects to `legacy.per-ankh.app`. Pulling the domain first turns those links into a DNS failure instead of the retirement page. Deploy → confirm the tombstone renders → then tear down.

1. **Remove the custom domain.** Workers & Pages → Pages project `per-ankh` → Custom domains → remove `legacy.per-ankh.app`.
2. **Stop the build integration.** Disconnect the GitHub integration, or delete the project outright. This is the step with lasting consequence: `web/` no longer exists on `main`, so a still-connected integration fails a build on every push.
3. **Delete the DNS record** for `legacy.per-ankh.app` if removing the custom domain didn't already remove it.
4. **`per-ankh-web.pages.dev`** — the auto-assigned Pages hostname. Gone with the project if step 2 deletes it; otherwise it keeps serving the frozen SPA on a URL nobody links to. Harmless either way.

## Phase 4 — final verification

```bash
curl -i https://per-ankh.app/share/abc123                          # 200 tombstone, no Location header
curl -i https://legacy.per-ankh.app/                               # should no longer resolve
curl -i https://api.per-ankh.app/v1/share/aaaaaaaaaaaaaaaaaaaaa    # 404
./per-ankh prod smoke                                              # 2 probes now, not 3
./per-ankh admin stats                                             # no legacy counters, no error on missing tables
./per-ankh admin events --limit 5                                  # GAME/USER columns, no --share flag
```

The last two are the real cross-check: `admin stats` used to `SELECT COUNT(*) FROM shares` plus both blocklist counts. If the CLI deployed but the migration didn't apply, it throws on a missing table — that's the proof code and schema moved together.

## Rollback

The Worker and frontend roll back by redeploying the previous version. The migration does not — there is no down, and `DROP TABLE` is final. Those rows come back from the 0.2 backup or not at all. The R2 blob deletion is likewise permanent, which is why it is last in each environment.
