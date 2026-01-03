
DROP FUNCTION IF EXISTS get_direct_descendants_of_tracked_entity;
CREATE OR REPLACE FUNCTION get_direct_descendants_of_tracked_entity(p_tracked_entity_id TEXT)
RETURNS TABLE (
    "trackedActivityId" TEXT,
    "id" TEXT,
    "readableId" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ta."id" AS "trackedActivityId",
        te."id", 
        te."readableId",
        te."quantity", 
        te."status", 
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes", 
        te."attributes" AS "attributes"
    FROM "trackedActivityInput" ai
    INNER JOIN "trackedEntity" te 
        ON ai."trackedEntityId" = te."id"
    INNER JOIN "trackedActivity" ta
        ON ai."trackedActivityId" = ta."id"
    JOIN "trackedActivityOutput" ao 
        ON ai."trackedActivityId" = ao."trackedActivityId"
    WHERE ao."trackedEntityId" = p_tracked_entity_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get direct descendants with strict filtering
DROP FUNCTION IF EXISTS get_direct_descendants_of_tracked_entity_strict;
CREATE OR REPLACE FUNCTION get_direct_descendants_of_tracked_entity_strict(p_tracked_entity_id TEXT)
RETURNS TABLE (
    "trackedActivityId" TEXT,
    "id" TEXT,
    "readableId" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ta."id" AS "trackedActivityId",
        te."id", 
        te."readableId",
        te."quantity", 
        te."status", 
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes",
        te."attributes" AS "attributes"
    FROM "trackedActivityInput" tai
    INNER JOIN "trackedEntity" te 
        ON tai."trackedEntityId" = te."id"
    INNER JOIN "trackedActivity" ta
        ON tai."trackedActivityId" = ta."id"
    WHERE tai."trackedActivityId" IN (
        SELECT tao."trackedActivityId"
        FROM "trackedActivityOutput" tao
        LEFT JOIN "trackedActivityInput" tai2 
            ON tao."trackedActivityId" = tai2."trackedActivityId" 
            AND tai2."trackedEntityId" = p_tracked_entity_id
        WHERE tao."trackedEntityId" = p_tracked_entity_id 
            AND tai2."trackedEntityId" IS NULL
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get direct ancestors of tracked entity
DROP FUNCTION IF EXISTS get_direct_ancestors_of_tracked_entity;
CREATE OR REPLACE FUNCTION get_direct_ancestors_of_tracked_entity(p_tracked_entity_id TEXT)
RETURNS TABLE (
    "trackedActivityId" TEXT,
    "id" TEXT,
    "readableId" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ta."id" AS "trackedActivityId",
        te."id", 
        te."readableId",
        te."quantity", 
        te."status", 
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes", 
        te."attributes" AS "attributes"
    FROM "trackedActivityOutput" ao
    INNER JOIN "trackedEntity" te 
        ON ao."trackedEntityId" = te."id"
    INNER JOIN "trackedActivity" ta
        ON ao."trackedActivityId" = ta."id"
    JOIN "trackedActivityInput" ai 
        ON ao."trackedActivityId" = ai."trackedActivityId"
    WHERE ai."trackedEntityId" = p_tracked_entity_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get direct ancestors with strict filtering
DROP FUNCTION IF EXISTS get_direct_ancestors_of_tracked_entity_strict;
CREATE OR REPLACE FUNCTION get_direct_ancestors_of_tracked_entity_strict(p_tracked_entity_id TEXT)
RETURNS TABLE (
    "trackedActivityId" TEXT,
    "id" TEXT,
    "readableId" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ta."id" AS "trackedActivityId",
        te."id", 
        te."readableId",
        te."quantity", 
        te."status", 
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes",
        te."attributes" AS "attributes"
    FROM "trackedActivityOutput" tao
    INNER JOIN "trackedEntity" te 
        ON tao."trackedEntityId" = te."id"
    INNER JOIN "trackedActivity" ta
        ON tao."trackedActivityId" = ta."id"
    WHERE tao."trackedActivityId" IN (
        SELECT tai."trackedActivityId"
        FROM "trackedActivityInput" tai
        LEFT JOIN "trackedActivityOutput" tao2 
            ON tai."trackedActivityId" = tao2."trackedActivityId" 
            AND tao2."trackedEntityId" = p_tracked_entity_id
        WHERE tai."trackedEntityId" = p_tracked_entity_id 
            AND tao2."trackedEntityId" IS NULL
    );
END;
$$ LANGUAGE plpgsql;