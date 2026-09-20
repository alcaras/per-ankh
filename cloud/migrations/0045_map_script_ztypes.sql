-- Rewrite four stored map_script values to the zTypes Old World actually
-- declares for those scripts.
--
-- The values being replaced were never OW zTypes. They were derived from the
-- C# class filenames under Reference/Source/…/MapScripts/ (the options bake
-- keys on `MAPCLASS_` + filename because mapClass.xml declares only
-- MAPCLASS_RANDOM), and the lookup table was hand-written to match. But a save
-- writes mapClass().mzType — the declared zType — so the corpus is the
-- authority, and it carries the short CoastalRainBasin/AridPlateau spellings
-- and the correctly-spelled LakesAndGulfs/Mediterranean. globalsType.xml's
-- DEFAULT_MAPCLASS_MP (MAPCLASS_CoastalRainBasin) says the same independently.
-- The `t` missing from MapScripLakesAndGulfs.cs and the misspelling in
-- MapScriptMediterrancean.cs are quirks of those filenames, not of the zTypes.
--
-- Two columns hold a pool script: tournaments.map_pool (JSON array of
-- { id, script, options }, migration 0019) and tournament_matches.map_script
-- (the denormalized played MAPCLASS from the same migration). Both are
-- rewritten so one map has one identifier everywhere a tournament reads it.
--
-- games.map_class is deliberately untouched: it is the token the save itself
-- recorded, already correct, and rewriting parsed save data to match a lookup
-- table would be the same mistake in the other direction.
--
-- map_pool entry ids are preserved, so tournament_matches.map_pool_id keeps
-- resolving. Forward-only, like every migration here; the pre-fix spellings
-- are recoverable from this file if one is ever needed.

UPDATE tournaments
SET map_pool = (
    SELECT json_group_array(
        json_set(
            inst.value,
            '$.script',
            CASE json_extract(inst.value, '$.script')
                WHEN 'MAPCLASS_MapScriptAridPlateau' THEN 'MAPCLASS_AridPlateau'
                WHEN 'MAPCLASS_MapScriptCoastalRainBasin' THEN 'MAPCLASS_CoastalRainBasin'
                WHEN 'MAPCLASS_MapScripLakesAndGulfs' THEN 'MAPCLASS_MapScriptLakesAndGulfs'
                WHEN 'MAPCLASS_MapScriptMediterrancean' THEN 'MAPCLASS_MapScriptMediterranean'
                ELSE json_extract(inst.value, '$.script')
            END
        )
    )
    FROM json_each(tournaments.map_pool) inst
)
WHERE EXISTS (
    SELECT 1
    FROM json_each(tournaments.map_pool) inst
    WHERE json_extract(inst.value, '$.script') IN (
        'MAPCLASS_MapScriptAridPlateau',
        'MAPCLASS_MapScriptCoastalRainBasin',
        'MAPCLASS_MapScripLakesAndGulfs',
        'MAPCLASS_MapScriptMediterrancean'
    )
);

UPDATE tournament_matches
SET map_script = CASE map_script
        WHEN 'MAPCLASS_MapScriptAridPlateau' THEN 'MAPCLASS_AridPlateau'
        WHEN 'MAPCLASS_MapScriptCoastalRainBasin' THEN 'MAPCLASS_CoastalRainBasin'
        WHEN 'MAPCLASS_MapScripLakesAndGulfs' THEN 'MAPCLASS_MapScriptLakesAndGulfs'
        WHEN 'MAPCLASS_MapScriptMediterrancean' THEN 'MAPCLASS_MapScriptMediterranean'
    END
WHERE map_script IN (
    'MAPCLASS_MapScriptAridPlateau',
    'MAPCLASS_MapScriptCoastalRainBasin',
    'MAPCLASS_MapScripLakesAndGulfs',
    'MAPCLASS_MapScriptMediterrancean'
);
