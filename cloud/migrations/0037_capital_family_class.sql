-- The family class that holds the player's capital.
--
-- A player's three families are already recorded (player_summaries
-- .family_classes), but which of them runs the capital is a distinct and
-- earlier decision: the capital is the city every early bonus compounds
-- through, so its family's class shapes the opening in a way "we had Traders
-- somewhere" does not.
--
-- Derived from the blob's city_statistics: the player's is_capital city, read
-- through owner_player_xml_id so a mirror match can't credit one side with the
-- other's capital. NULL when the player ended with no capital (eliminated, or
-- a pre-2.6.0 blob whose cities carry no family class). Backfilled for
-- existing rows by the admin reindex sweep, which rebuilds player_summaries
-- from the stored blob.
ALTER TABLE player_summaries ADD COLUMN capital_family_class TEXT;

CREATE INDEX idx_summaries_capital_family
    ON player_summaries(capital_family_class);
