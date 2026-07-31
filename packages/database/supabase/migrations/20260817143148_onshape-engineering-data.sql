-- Engineering data read off synced Onshape BOM rows.
--
-- The sync writes the raw BOM row into "externalIntegrationMapping".metadata and
-- normalizes the four engineering facts Carbon reads (release state, mass,
-- material, vendor) into metadata.engineering under stable keys. This backfills
-- that object for rows written before the normalization existed, then exposes the
-- read model as a view.

-- Best-effort backfill. Header names are configurable per Onshape company, so the
-- lookup is case-insensitive and alias-aware, mirroring
-- functions/shared/extract-engineering-fields.ts. Only scalar cells are readable:
-- an unresolved Onshape value that arrives as an object has no readable text and
-- stays null. The raw row is left untouched, so a missing alias is a one-line fix
-- and never a silent hole. Rows already carrying an 'engineering' object were
-- written by the normalizing sync and are left alone.
WITH "cells" AS (
  SELECT
    "eim"."id" AS "mappingId",
    lower(btrim("cell"."key")) AS "header",
    CASE
      WHEN jsonb_typeof("cell"."value") IN ('string', 'number', 'boolean')
        THEN NULLIF(btrim("cell"."value" #>> '{}'), '')
      ELSE NULL
    END AS "cellText"
  FROM "externalIntegrationMapping" "eim"
  CROSS JOIN LATERAL jsonb_each("eim"."metadata") AS "cell"("key", "value")
  WHERE "eim"."integration" = 'onshapeData'
    AND jsonb_typeof("eim"."metadata") = 'object'
    AND "eim"."metadata" -> 'engineering' IS NULL
),
"engineering" AS (
  SELECT
    "mappingId",
    max("cellText") FILTER (WHERE "header" = 'state') AS "state",
    max("cellText") FILTER (WHERE "header" = 'mass') AS "mass",
    max("cellText") FILTER (WHERE "header" = 'material') AS "material",
    -- 'Vendor' is the canonical header, 'Supplier' the fallback alias
    COALESCE(
      max("cellText") FILTER (WHERE "header" = 'vendor'),
      max("cellText") FILTER (WHERE "header" = 'supplier')
    ) AS "vendor"
  FROM "cells"
  GROUP BY "mappingId"
)
UPDATE "externalIntegrationMapping" "eim"
SET "metadata" = "eim"."metadata" || jsonb_build_object(
  'engineering',
  jsonb_build_object(
    'state', "engineering"."state",
    'mass', "engineering"."mass",
    'material', "engineering"."material",
    'vendor', "engineering"."vendor"
  )
)
FROM "engineering"
WHERE "engineering"."mappingId" = "eim"."id";

-- One row per item whose BOM has been synced from Onshape. The release state
-- prefers the separately-tracked model state and falls back to what the BOM sync
-- recorded, so the two freshness timestamps are reported separately:
-- "bomSyncedAt" is when the engineering data was last pulled, "stateSyncedAt"
-- when the release state was.
CREATE VIEW "onshapeEngineeringData" WITH(SECURITY_INVOKER=true) AS
SELECT
  "eim"."companyId",
  "eim"."entityId" AS "itemId",
  "i"."readableId",
  "i"."revision",
  "i"."name",
  COALESCE(
    "s"."releaseState",
    "eim"."metadata" -> 'engineering' ->> 'state'
  ) AS "releaseState",
  "s"."updatedAt" AS "stateSyncedAt",
  "eim"."metadata" -> 'engineering' ->> 'mass' AS "mass",
  "eim"."metadata" -> 'engineering' ->> 'material' AS "material",
  "eim"."metadata" -> 'engineering' ->> 'vendor' AS "vendor",
  "eim"."updatedAt" AS "bomSyncedAt"
FROM "externalIntegrationMapping" "eim"
JOIN "item" "i"
  ON "i"."id" = "eim"."entityId"
  AND "i"."companyId" = "eim"."companyId"
LEFT JOIN "onshapeItemSyncState" "s"
  ON "s"."itemId" = "i"."id"
  AND "s"."companyId" = "eim"."companyId"
  AND "s"."assetKind" = 'model'
WHERE "eim"."integration" = 'onshapeData';
