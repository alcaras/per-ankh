-- Drop the desktop-era share tables.
--
-- The Tauri desktop app and its `/v1/share/*` Worker endpoints are gone, along
-- with the `web/` viewer that read them. These three tables were read only by
-- the deleted `cloud/src/share-legacy.ts`, so nothing queries them any more:
--
--   shares        — the legacy share index ({share_id}.json.gz blobs in R2 root)
--   blocked_keys  — app-key blocklist, checked only on POST /v1/share
--   blocked_ips   — IP blocklist, likewise legacy-only (the cloud games path
--                   has never consulted it)
--
-- The R2 blobs these rows point at are deleted out-of-band; see the deploy
-- notes. Back up first (`./per-ankh backup`) — forward-only, no down migration.
--
-- Deliberately NOT dropped: `events.share_id` / `events.app_key` and the legacy
-- rows that use them. `events` is the shared audit log for both worlds, and the
-- historical rows are kept as a record. Those columns stay nullable and unused.

DROP INDEX IF EXISTS idx_shares_app_key;
DROP INDEX IF EXISTS idx_shares_created_at;

DROP TABLE IF EXISTS shares;
DROP TABLE IF EXISTS blocked_keys;
DROP TABLE IF EXISTS blocked_ips;
