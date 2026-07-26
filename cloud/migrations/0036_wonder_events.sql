-- Wonder completions, and the culture level that gates them.
--
-- The blob already carries `player_wonders` (one row per wonder completed in
-- the game, with the builder and the turn); this indexes it the way tech_events
-- and law_events index their blob arrays, so the stats aggregator can build
-- per-wonder distributions without reading R2.
--
-- A wonder is globally unique within a game — the first player to finish it
-- takes it off the board for everyone — hence the (game_id, wonder) key.
CREATE TABLE wonder_events (
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    wonder TEXT NOT NULL,
    player_index INTEGER NOT NULL,
    turn INTEGER NOT NULL,
    PRIMARY KEY (game_id, wonder)
);

CREATE INDEX idx_wonder_events_wonder ON wonder_events(wonder);

-- Highest culture level reached by any city the player held at the end of the
-- game (CULTURE_WEAK < CULTURE_DEVELOPING < CULTURE_STRONG < CULTURE_LEGENDARY,
-- NULL when the player ended with no cities). Wonders have no tech prereq —
-- their only gate is a city at the wonder's <CulturePrereq> — so this column is
-- what separates "didn't build it" from "couldn't build it" in the wonder
-- charts. Backfilled for existing rows by the admin reindex sweep, which
-- rebuilds player_summaries from the stored blob.
ALTER TABLE player_summaries ADD COLUMN best_culture_level TEXT;

-- Which wonders were actually on the board for a game. Old World enables only
-- a subset per game (a base-game save disables 15 of the 28), so without this
-- "nobody built the Colossus" can't be told apart from "the Colossus wasn't in
-- the game". Rows are the ENABLED set, derived at index time from the blob's
-- game_details.disabled_improvements (parser 2.12.0+) minus the baked wonder
-- list. A game whose blob predates 2.12.0 simply has no rows and drops out of
-- the eligibility denominator rather than skewing it.
CREATE TABLE game_wonder_pool (
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    wonder TEXT NOT NULL,
    PRIMARY KEY (game_id, wonder)
);

CREATE INDEX idx_game_wonder_pool_wonder ON game_wonder_pool(wonder);
