-- Per-player, per-family-class city footprint.
--
-- player_summaries.family_classes already records *which* three classes a
-- player ran, but not how much of the empire each ended up holding, or how
-- early it arrived. Those are the two questions that separate a family you
-- leaned on from one you merely had: a class holding half your cities from
-- turn 20 played a different game than one that showed up with a single late
-- conquest.
--
-- One row per (game, player, family class) — at most three per player, so this
-- stays small. Derived from the blob's city_statistics at index time, keyed on
-- owner_player_xml_id so a mirror match can't credit one side with the other's
-- cities. `cities` counts the player's end-of-game holdings of that class (the
-- save is an end-state snapshot, so a razed or lost city isn't in it), and
-- `first_founded_turn` is the earliest founding among them, which the stats
-- layer turns into "how much of the game it was present for".
--
-- Backfilled for existing games by the admin reindex sweep, which rebuilds the
-- derived tables from the stored blob.
--
-- No secondary index: the only reader (loadFamilyCities in
-- stats/aggregate.ts) selects by game_id, which the primary key's leading
-- column already serves. One on family_class would cost every upload and
-- reindex a write for a lookup nothing performs.
CREATE TABLE player_family_cities (
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_index INTEGER NOT NULL,
    family_class TEXT NOT NULL,
    cities INTEGER NOT NULL,
    first_founded_turn INTEGER,
    PRIMARY KEY (game_id, player_index, family_class)
);
