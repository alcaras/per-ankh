-- Site-admin "featured videos" — the first durable video rows in D1.
--
-- Everything else about videos is fetched live and cached in KV
-- (cloud/src/video/cache.ts): a channel's uploads come from its feed, a
-- tournament's from its playlist, and nothing is persisted. Featuring can't
-- work that way. A featured video ages out of the source feed (a channel's RSS
-- returns ~15 entries), so the row is a SNAPSHOT: the fields YouTube owns —
-- url, title, thumbnail, publish date — are stored because we can't re-derive
-- them once the video leaves the feed.
--
-- The uploader is deliberately NOT snapshotted. `user_id` names a Per-Ankh
-- uploader whose display name and avatar are joined from `users` at read time
-- (displayNameSql + buildAvatarUrl), the way every other read builds identity —
-- a frozen name would go stale on rename. `uploader_name` / `uploader_url`
-- carry the unlinked-YouTube-channel case, where there is no user row to join;
-- all three null is a video whose feed entry named no author. That is the same
-- three-way attribution the tournament playlist read applies
-- (attributePlaylistVideos, cloud/src/tournament/public.ts).
--
-- Composite PK (platform, video_id) — the same identity the video caches and
-- the frontend list keys use — so re-featuring a video updates its snapshot
-- rather than duplicating it.
--   - featured_by: which admin featured it. Kept as accountability; the row
--                  itself is the only record (a DELETE leaves nothing behind).
CREATE TABLE featured_videos (
    platform TEXT NOT NULL,
    video_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    thumbnail_url TEXT,
    published_at TEXT NOT NULL,
    user_id TEXT REFERENCES users(user_id),
    uploader_name TEXT,
    uploader_url TEXT,
    featured_at TEXT NOT NULL DEFAULT (datetime('now')),
    featured_by TEXT NOT NULL REFERENCES users(user_id),
    PRIMARY KEY (platform, video_id)
);
