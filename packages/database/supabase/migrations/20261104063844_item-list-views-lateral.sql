-- The five item list views (parts, tools, materials, consumables, services)
-- found each item's latest revision and its revision list with two CTEs over
-- every item of the type. Under RLS they cannot be inlined: the item policy
-- calls the VOLATILE portal helpers (get_supplier_ids_with_supplier_permission,
-- get_customer_ids_with_customer_permission). Materialised, item_revisions has
-- no index, so it was joined by a nested loop that scanned it once per row: a
-- company's n items cost n² comparisons. In production the parts list with a
-- supplier filter took 1,173 ms under RLS (54 ms without), throwing away 532,900
-- rows to return 7; materials took 382 ms for 861 rows.
--
-- Each view now reads, per row of its type table, the latest revision, the
-- revision list and the supplier aggregate through LATERAL subqueries on
-- indexed columns, which RLS cannot turn quadratic (43 ms for the same parts
-- query). Every view keeps its columns in the same order, so CREATE OR REPLACE
-- keeps grants and dependents. Two changes, both to values that were undefined
-- before: an exact tie for "latest revision" now picks by id, and
-- "supplierIds" lists the supplier part numbers in order. "companyId" comes
-- from the type table (equal to the item's), so a company filter reaches its
-- index.

CREATE OR REPLACE VIEW "parts" WITH (SECURITY_INVOKER=true) AS
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."sourcingType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  p."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE li."thumbnailPath"
  END as "thumbnailPath",
  mu."modelPath",
  mu."name" as "modelName",
  mu."size" as "modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  p."customFields",
  p."tags",
  ic."itemPostingGroupId",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt",
  ss."supersessionMode",
  li."mpn",
  ps."suppliers"
FROM "part" p
CROSS JOIN LATERAL (
  SELECT i.*
  FROM "item" i
  WHERE i."readableId" = p."id" AND i."companyId" = p."companyId" AND i."type" = 'Part'
  ORDER BY
    i."active" DESC,
    CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END DESC,
    i."createdAt" DESC NULLS LAST,
    i."id"
  LIMIT 1
) li
LEFT JOIN "modelUpload" mu ON mu.id = li."modelUploadId"
LEFT JOIN LATERAL (
  SELECT json_agg(
    json_build_object(
      'id', i.id,
      'revision', i."revision",
      'name', i."name",
      'description', i."description",
      'active', i."active",
      'createdAt', i."createdAt"
    ) ORDER BY
      CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END,
      i."createdAt"
  ) as "revisions"
  FROM "item" i
  WHERE i."readableId" = p."id" AND i."companyId" = p."companyId" AND i."type" = 'Part'
) ir ON true
LEFT JOIN LATERAL (
  SELECT
    string_agg(sp."supplierPartId", ',' ORDER BY sp."supplierPartId") AS "supplierIds",
    array_agg(DISTINCT sp."supplierId") FILTER (WHERE sp."supplierId" IS NOT NULL) AS "suppliers"
  FROM "supplierPart" sp
  WHERE sp."itemId" = li.id AND sp."companyId" = li."companyId"
) ps ON true
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id
LEFT JOIN "itemSupersession" ss ON ss."itemId" = li.id AND ss."companyId" = li."companyId";

CREATE OR REPLACE VIEW "tools" WITH (SECURITY_INVOKER=true) AS
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."sourcingType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  t."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE li."thumbnailPath"
  END AS "thumbnailPath",
  mu."modelPath",
  mu."name" AS "modelName",
  mu."size" AS "modelSize",
  ps."supplierIds",
  uom.name AS "unitOfMeasure",
  ir."revisions",
  t."customFields",
  t."tags",
  ic."itemPostingGroupId",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt",
  ss."supersessionMode",
  li."mpn",
  ps."suppliers"
FROM "tool" t
CROSS JOIN LATERAL (
  SELECT i.*
  FROM "item" i
  WHERE i."readableId" = t."id" AND i."companyId" = t."companyId" AND i."type" = 'Tool'
  ORDER BY
    i."active" DESC,
    CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END DESC,
    i."createdAt" DESC NULLS LAST,
    i."id"
  LIMIT 1
) li
LEFT JOIN "modelUpload" mu ON mu.id = li."modelUploadId"
LEFT JOIN LATERAL (
  SELECT json_agg(
    json_build_object('id', i.id, 'revision', i."revision", 'methodType', i."defaultMethodType", 'type', i."type")
    ORDER BY
      CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END,
      i."createdAt"
  ) AS "revisions"
  FROM "item" i
  WHERE i."readableId" = t."id" AND i."companyId" = t."companyId" AND i."type" = 'Tool'
) ir ON true
LEFT JOIN LATERAL (
  SELECT
    string_agg(sp."supplierPartId", ',' ORDER BY sp."supplierPartId") AS "supplierIds",
    array_agg(DISTINCT sp."supplierId") FILTER (WHERE sp."supplierId" IS NOT NULL) AS "suppliers"
  FROM "supplierPart" sp
  WHERE sp."itemId" = li.id AND sp."companyId" = li."companyId"
) ps ON true
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id
LEFT JOIN "itemSupersession" ss ON ss."itemId" = li.id AND ss."companyId" = li."companyId";

CREATE OR REPLACE VIEW "materials" WITH (SECURITY_INVOKER=true) AS
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  m."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE li."thumbnailPath"
  END AS "thumbnailPath",
  li."modelUploadId",
  mu."modelPath",
  mu."name" AS "modelName",
  mu."size" AS "modelSize",
  ps."supplierIds",
  uom.name AS "unitOfMeasure",
  ir."revisions",
  mf.name AS "materialForm",
  ms.name AS "materialSubstance",
  md.name AS "dimensions",
  mfin.name AS "finish",
  mg.name AS "grade",
  mt.name AS "materialType",
  m."materialSubstanceId",
  m."materialFormId",
  m."customFields",
  m."tags",
  ic."itemPostingGroupId",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt",
  ss."supersessionMode",
  li."mpn",
  ps."suppliers"
FROM "material" m
CROSS JOIN LATERAL (
  SELECT i.*
  FROM "item" i
  WHERE i."readableId" = m."id" AND i."companyId" = m."companyId" AND i."type" = 'Material'
  ORDER BY
    i."active" DESC,
    CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END DESC,
    i."createdAt" DESC NULLS LAST,
    i."id"
  LIMIT 1
) li
LEFT JOIN "modelUpload" mu ON mu.id = li."modelUploadId"
LEFT JOIN LATERAL (
  SELECT json_agg(
    json_build_object('id', i.id, 'revision', i."revision", 'methodType', i."defaultMethodType", 'type', i."type")
    ORDER BY
      CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END,
      i."createdAt"
  ) AS "revisions"
  FROM "item" i
  WHERE i."readableId" = m."id" AND i."companyId" = m."companyId" AND i."type" = 'Material'
) ir ON true
LEFT JOIN LATERAL (
  SELECT
    string_agg(sp."supplierPartId", ',' ORDER BY sp."supplierPartId") AS "supplierIds",
    array_agg(DISTINCT sp."supplierId") FILTER (WHERE sp."supplierId" IS NOT NULL) AS "suppliers"
  FROM "supplierPart" sp
  WHERE sp."itemId" = li.id AND sp."companyId" = li."companyId"
) ps ON true
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "materialForm" mf ON mf.id = m."materialFormId"
LEFT JOIN "materialSubstance" ms ON ms.id = m."materialSubstanceId"
LEFT JOIN "materialDimension" md ON m."dimensionId" = md.id
LEFT JOIN "materialFinish" mfin ON m."finishId" = mfin.id
LEFT JOIN "materialGrade" mg ON m."gradeId" = mg.id
LEFT JOIN "materialType" mt ON m."materialTypeId" = mt.id
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id
LEFT JOIN "itemSupersession" ss ON ss."itemId" = li.id AND ss."companyId" = li."companyId";

CREATE OR REPLACE VIEW "consumables" WITH (SECURITY_INVOKER=true) AS
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  c."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE li."thumbnailPath"
  END AS "thumbnailPath",
  li."modelUploadId",
  mu."modelPath",
  mu."name" AS "modelName",
  mu."size" AS "modelSize",
  ps."supplierIds",
  uom.name AS "unitOfMeasure",
  ir."revisions",
  c."customFields",
  c."tags",
  ic."itemPostingGroupId",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt",
  ss."supersessionMode",
  li."mpn",
  ps."suppliers"
FROM "consumable" c
CROSS JOIN LATERAL (
  SELECT i.*
  FROM "item" i
  WHERE i."readableId" = c."id" AND i."companyId" = c."companyId" AND i."type" = 'Consumable'
  ORDER BY
    i."active" DESC,
    CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END DESC,
    i."createdAt" DESC NULLS LAST,
    i."id"
  LIMIT 1
) li
LEFT JOIN "modelUpload" mu ON mu.id = li."modelUploadId"
LEFT JOIN LATERAL (
  SELECT json_agg(
    json_build_object('id', i.id, 'revision', i."revision", 'methodType', i."defaultMethodType", 'type', i."type")
    ORDER BY
      CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END,
      i."createdAt"
  ) AS "revisions"
  FROM "item" i
  WHERE i."readableId" = c."id" AND i."companyId" = c."companyId" AND i."type" = 'Consumable'
) ir ON true
LEFT JOIN LATERAL (
  SELECT
    string_agg(sp."supplierPartId", ',' ORDER BY sp."supplierPartId") AS "supplierIds",
    array_agg(DISTINCT sp."supplierId") FILTER (WHERE sp."supplierId" IS NOT NULL) AS "suppliers"
  FROM "supplierPart" sp
  WHERE sp."itemId" = li.id AND sp."companyId" = li."companyId"
) ps ON true
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id
LEFT JOIN "itemSupersession" ss ON ss."itemId" = li.id AND ss."companyId" = li."companyId";

CREATE OR REPLACE VIEW "services" WITH (SECURITY_INVOKER=true) AS
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  s."companyId",
  li."thumbnailPath",
  ps."supplierIds",
  uom.name AS "unitOfMeasure",
  ir."revisions",
  s."customFields",
  s."tags",
  ic."itemPostingGroupId",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt",
  ps."suppliers"
FROM "service" s
CROSS JOIN LATERAL (
  SELECT i.*
  FROM "item" i
  WHERE i."readableId" = s."id" AND i."companyId" = s."companyId" AND i."type" = 'Service'
  ORDER BY
    i."active" DESC,
    CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END DESC,
    i."createdAt" DESC NULLS LAST,
    i."id"
  LIMIT 1
) li
LEFT JOIN LATERAL (
  SELECT json_agg(
    json_build_object('id', i.id, 'revision', i."revision", 'methodType', i."defaultMethodType", 'type', i."type")
    ORDER BY
      CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END,
      i."createdAt"
  ) AS "revisions"
  FROM "item" i
  WHERE i."readableId" = s."id" AND i."companyId" = s."companyId" AND i."type" = 'Service'
) ir ON true
LEFT JOIN LATERAL (
  SELECT
    string_agg(sp."supplierPartId", ',' ORDER BY sp."supplierPartId") AS "supplierIds",
    array_agg(DISTINCT sp."supplierId") FILTER (WHERE sp."supplierId" IS NOT NULL) AS "suppliers"
  FROM "supplierPart" sp
  WHERE sp."itemId" = li.id AND sp."companyId" = li."companyId"
) ps ON true
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id;
