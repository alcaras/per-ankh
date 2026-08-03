-- Add Discord's @ handle (lowercased) to the users table.
--
-- Why: tournament_slots.discord_username has long stored the lowercased
-- Discord handle (mirrors handleDiscordCallback's `discordUser.username
-- .toLowerCase()` at cloud/src/auth.ts:400), but the users table only kept
-- display_name (= `global_name ?? username`). Two paths need the raw handle
-- on users:
--   1. The new /v1/users/search autocomplete for the slot-creation form,
--      which has to prefix-match the canonical handle (not display_name,
--      which may diverge).
--   2. Future pre-linking of slots: handleBulkCreateSlots can accept a
--      user_id and resolve the canonical discord_username from users so
--      the client can't spoof a mismatched handle into the slot row.
--
-- Backfill: none. handleDiscordCallback's upsert (next migration to wire)
-- writes the column on every login. Existing users stay NULL until they
-- next sign in; the autocomplete query naturally skips NULL rows.
-- Active users self-heal within a login cycle; inactive users were
-- invisible to autocomplete anyway.

ALTER TABLE users ADD COLUMN discord_username TEXT;

-- Prefix-search index, for the /v1/users/search query pattern of
-- `WHERE discord_username LIKE ?` with `q + '%'` (prefix-only).
--
-- Correction (0039): SQLite does NOT apply the LIKE optimization here, and
-- storing the column lowercase doesn't arrange it — the optimization needs the
-- column to be COLLATE NOCASE (or case_sensitive_like ON), which neither is.
-- The handler also writes LOWER(discord_username) LIKE ?, and wrapping the
-- column in a function rules out an index outright. So this index does not
-- serve that search: it's a full scan of `users`, which is fine at this table
-- size and is what the handler comment says. Kept because it's harmless and
-- would become load-bearing under a NOCASE collation or an unwrapped
-- predicate; drop it if neither ever happens.
CREATE INDEX idx_users_discord_username ON users(discord_username);
