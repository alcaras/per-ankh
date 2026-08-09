# Legacy share decommission — deploy checklist

Removes the desktop-era share feature: the `/v1/share/*` Worker endpoints, the `shares`/`blocked_keys`/`blocked_ips` D1 tables (migration `0042`), the frozen `web/` SPA, the `/share/*` → `legacy.per-ankh.app` redirect, and the legacy vars/CLI/admin surfaces that fed them. `per-ankh.app/share/[id]` now serves a static "link retired" tombstone.

**The deploy is a normal release.** `./per-ankh staging deploy`, then `./per-ankh prod deploy`. The migration rides the pipeline as it does for every other release — there is nothing to hand-run or reorder.

Three things the pipeline has no concept of are split out as [optional follow-ups](#optional-follow-ups) at the end: the R2 blobs the dropped `shares` rows pointed at, the `legacy.per-ankh.app` entries in the Cloudflare dashboard, and a possibly-stale Worker secret. None of them blocks the deploy, and skipping the first costs only storage on dead objects.

One step is irreversible: migration `0042` is `DROP TABLE`, forward-only, no down. Everything else in the deploy rolls back by redeploying the previous Worker/frontend version. (Follow-up A is permanent too, which is why it goes last.)

## Before you start

- [ ] **Back up prod D1** — `./per-ankh backup` (defaults to remote/production). This snapshot is the only rollback for the dropped tables.
- [ ] **Merge to `main`.** `git.branch` is a blocking preflight check that hard-requires `main`; `--allow-branch` demotes it to a warning if you'd rather deploy from the branch. Merging is cleaner — prod's changelog phase assumes a normal release.
- [ ] **If you plan to do [follow-up A](#a-delete-the-orphaned-r2-blobs), count the blobs now** — migration `0042` drops the table that holds the count. It's the only thing in the follow-ups that has to happen before the deploy.

## Staging

- [ ] `./per-ankh staging status` — pending migrations show `0042` and nothing unexpected.
- [ ] `./per-ankh staging deploy --dry-run` — read the printed plan.
- [ ] `./per-ankh staging deploy` — runs `preflight → migrate → worker → frontend → smoke`.

Watch `secrets.parity` during preflight: 8 keys were removed from both `[vars]` and `[env.staging.vars]`, and the sets have been verified to still match, but this is the check that would catch a miss.

Verify:

```bash
curl -i https://api-staging.per-ankh.app/v1/share/aaaaaaaaaaaaaaaaaaaaa   # 404, cloud CORS headers
curl -i -X POST https://api-staging.per-ankh.app/v1/share                  # 404, not 400/503
```

- [ ] Both return 404. A 400 or 503 means the old handler is still mounted.
- [ ] `https://staging.per-ankh.app/share/testid` → 200, "Shared link retired", no redirect.

> **Do not run `./per-ankh staging reclone` before prod is done.** Reclone re-copies D1 from prod. With staging migrated and prod not yet, it restores `shares`/`blocked_keys`/`blocked_ips` to staging and you will debug a ghost.

## Production

- [ ] `./per-ankh prod status`
- [ ] `./per-ankh prod deploy --dry-run`
- [ ] `./per-ankh prod deploy` — runs `preflight → changelog → migrate → worker → frontend → smoke`.

Verify:

```bash
curl -i https://per-ankh.app/share/abc123                          # 200 tombstone, no Location header
curl -i https://api.per-ankh.app/v1/share/aaaaaaaaaaaaaaaaaaaaa    # 404
./per-ankh prod smoke                                              # 2 probes, both pass
./per-ankh admin stats                                             # no legacy counters, no error on missing tables
./per-ankh admin events --limit 5                                  # GAME/USER columns, no --share flag
```

- [ ] All five clean. The last two are the real cross-check: `admin stats` used to `SELECT COUNT(*) FROM shares` plus both blocklist counts, so if the CLI deployed but the migration didn't apply, it throws on a missing table. That's the proof code and schema moved together.

### Two things to expect, not debug

**A brief window of 500s during `migrate → worker`.** After the tables drop but before the new Worker replaces the old one, the live Worker still runs `share-legacy.ts` against the now-dropped tables. Those requests 500 rather than 404, and because `legacy_share_write` is gone from `SECURITY_REASONS` each one falls through to `server_error` and writes a security-events row. Under a minute, on an endpoint being killed anyway.

**CDN lag on `/v1/share/:id`.** It served `Cache-Control: public, max-age=3600`, so a cached 200 can persist up to an hour past deploy. A share URL still resolving shortly after cutover is the CDN, not a failed deploy — re-check with a cache-busting query string before concluding anything.

## Optional follow-ups

None of these is required, and the deploy above is complete without them.

### A. Delete the orphaned R2 blobs

Dropping `shares` leaves its blobs in `per-ankh-shares` with nothing referencing them. The only consequence of leaving them is storage cost on dead objects. **This is permanent — do it last.**

Done by hand in the dashboard: **R2 → `per-ankh-shares` → object browser.**

The legacy blobs are the **root-level** objects. Everything the live code writes goes under `games/` or `saves/`, so anything sitting at the root — not inside either folder — is a legacy share blob. That stays true after `shares` is dropped, which is why no export or listing has to happen before the deploy.

The one exception is the **count**, which is worth having ahead of time for a purely practical reason: it tells you whether hand-deletion is a few clicks or an afternoon. Run it *before* migrating — `0042` drops the table:

```bash
npx wrangler d1 execute per-ankh-share-index --remote \
  --command "SELECT COUNT(*) FROM shares"
```

Then, after the deploy:

- [ ] Open the bucket and confirm the root holds only `games/`, `saves/`, and loose `{id}.json.gz` objects.
- [ ] Delete the loose root objects. **Do not touch `games/` or `saves/`** — that's live production game data in the same bucket.
- [ ] If staging was ever recloned from prod, repeat on `per-ankh-shares-staging`.

If the count turns out large enough to make the dashboard impractical, the alternative is rclone against the bucket, which needs an **Object Read & Write** token scoped to `per-ankh-shares` (dashboard → R2 → Manage API tokens). The `R2_PROD_RO_*` credentials in `.staging.vars` can enumerate but not delete. `scripts/prod/deploy/reclone.ts` has the working rclone-over-R2 setup to copy from; note that `wrangler r2 object` is no help here, offering only `get`/`put`/`delete` with no listing command.

### B. Retire `legacy.per-ankh.app`

Dashboard-managed, nothing checked into the repo, so none of it is verifiable from a checkout or automated by `./per-ankh prod deploy`. **Do this after the deploy, not before** — until the frontend step lands, `per-ankh.app/share/*` still redirects here, and pulling the domain first turns those links into a DNS failure instead of the retirement page.

- [ ] **Stop the Pages build integration.** Workers & Pages → Pages project `per-ankh` → disconnect the GitHub integration, or delete the project. This is the one with lasting consequence: `web/` no longer exists on `main`, so a still-connected integration fails a build on every push.
- [ ] **Remove the custom domain** `legacy.per-ankh.app` from the Pages project.
- [ ] **Delete the DNS record** if removing the custom domain didn't.
- [ ] `curl -i https://legacy.per-ankh.app/` — should no longer resolve.

`per-ankh-web.pages.dev`, the auto-assigned Pages hostname, goes with the project if you delete it; otherwise it keeps serving the frozen SPA on a URL nobody links to. Harmless either way.

### C. Stale `UPLOADS_ENABLED` secret

It was documented as overridable via `wrangler secret put`, which outlives the `wrangler.toml` var removal.

```bash
npx wrangler secret list --env staging
npx wrangler secret delete UPLOADS_ENABLED --env staging   # if present
```

- [ ] Same without `--env staging` for prod.

## Rollback

The Worker and frontend roll back by redeploying the previous version. The migration does not — there is no down, and `DROP TABLE` is final. Those rows come back from the pre-deploy backup or not at all. Follow-up A is likewise permanent, which is why it goes last.
