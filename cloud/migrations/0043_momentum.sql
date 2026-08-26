-- Per-turn momentum (P(this player wins), 0..1) for finished duels — the
-- fitted win-probability model scored at derive time (upload + reindex).
-- NULL for FFA games, unknown winners, and rows written before the model
-- landed; the reindex sweep backfills those from the blob.
ALTER TABLE game_player_turn ADD COLUMN momentum REAL;

-- Which model wrote the score: MOMENTUM_MODEL_VERSION at derive time.
-- A refit keeps the version and changes the numbers; a form change bumps
-- it. Recorded per row because the reindex sweep rewrites rows over time —
-- without this the column silently mixes vintages after the first refit,
-- and the provenance can't be reconstructed later.
ALTER TABLE game_player_turn ADD COLUMN momentum_version INTEGER;
