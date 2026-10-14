-- Two lookups every item page makes, each as one statement.
--
-- Both were assembled in TypeScript from many PostgREST requests: where an item
-- is used was fifteen requests fired at once, and an item's change notices were
-- eight requests in five sequential steps. SECURITY INVOKER: row-level security
-- decides what the caller sees, exactly as it did for the separate requests.

-- Everywhere an item is referenced. Each list is the newest hundred lines, with
-- the document the line belongs to; lines created together are ordered by id,
-- so the same call always answers the same way. quoteLine and supplierQuoteLine
-- have no "createdAt", so theirs are a hundred in no particular order, as before.
CREATE OR REPLACE FUNCTION get_item_used_in(item_id TEXT, company_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'issues', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", d."nonConformanceId" AS "documentReadableId", d."id" AS "documentId"
        FROM "nonConformanceItem" l
        LEFT JOIN "nonConformance" d ON d."id" = l."nonConformanceId" AND d."companyId" = l."companyId"
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'jobMaterials', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", l."methodType", d."jobId" AS "documentReadableId", d."id" AS "documentId"
        FROM "jobMaterial" l
        LEFT JOIN "job" d ON d."id" = l."jobId" AND d."companyId" = l."companyId"
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'jobs', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", l."jobId" AS "documentReadableId"
        FROM "job" l
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'maintenanceDispatchItems', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", d."maintenanceDispatchId" AS "documentReadableId", d."id" AS "documentId"
        FROM "maintenanceDispatchItem" l
        LEFT JOIN "maintenanceDispatch" d ON d."id" = l."maintenanceDispatchId" AND d."companyId" = l."companyId"
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'methodMaterials', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", l."methodType", d."id" AS "documentId", d."version", i."readableIdWithRevision" AS "documentReadableId", i."id" AS "documentParentId", i."type" AS "itemType"
        FROM "methodMaterial" l
        LEFT JOIN "makeMethod" d ON d."id" = l."makeMethodId" AND d."companyId" = l."companyId"
        LEFT JOIN "item" i ON i."id" = d."itemId" AND i."companyId" = d."companyId"
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'purchaseOrderLines', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", d."purchaseOrderId" AS "documentReadableId", d."id" AS "documentId"
        FROM "purchaseOrderLine" l
        LEFT JOIN "purchaseOrder" d ON d."id" = l."purchaseOrderId" AND d."companyId" = l."companyId"
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'receiptLines', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", d."receiptId" AS "documentReadableId", d."id" AS "documentId"
        FROM "receiptLine" l
        LEFT JOIN "receipt" d ON d."id" = l."receiptId" AND d."companyId" = l."companyId"
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'quoteLines', (
      SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      FROM (
        SELECT l."id", l."methodType", d."quoteId" AS "documentReadableId", d."id" AS "documentId"
        FROM "quoteLine" l
        LEFT JOIN "quote" d ON d."id" = l."quoteId" AND d."companyId" = l."companyId"
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        LIMIT 100
      ) r
    ),
    'quoteMaterials', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", l."methodType", l."quoteId" AS "documentParentId", l."quoteLineId" AS "documentId", i."readableIdWithRevision" AS "documentReadableId"
        FROM "quoteMaterial" l
        LEFT JOIN "quoteLine" d ON d."id" = l."quoteLineId" AND d."companyId" = l."companyId"
        LEFT JOIN "item" i ON i."id" = d."itemId" AND i."companyId" = d."companyId"
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'salesOrderLines', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", l."methodType", d."salesOrderId" AS "documentReadableId", d."id" AS "documentId"
        FROM "salesOrderLine" l
        LEFT JOIN "salesOrder" d ON d."id" = l."salesOrderId" AND d."companyId" = l."companyId"
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'shipmentLines', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", d."shipmentId" AS "documentReadableId", d."id" AS "documentId"
        FROM "shipmentLine" l
        LEFT JOIN "shipment" d ON d."id" = l."shipmentId" AND d."companyId" = l."companyId"
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'supplierQuotes', (
      SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      FROM (
        SELECT l."id", d."supplierQuoteId" AS "documentReadableId", d."id" AS "documentId"
        FROM "supplierQuoteLine" l
        LEFT JOIN "supplierQuote" d ON d."id" = l."supplierQuoteId" AND d."companyId" = l."companyId"
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        LIMIT 100
      ) r
    ),
    'assemblyInstructions', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", l."name" AS "documentReadableId", l."version"
        FROM "assemblyInstruction" l
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'inspections', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", l."inspectionId" AS "documentReadableId"
        FROM "inspection" l
        WHERE l."itemId" = item_id AND l."companyId" = company_id
        ORDER BY l."createdAt" DESC, l."id"
        LIMIT 100
      ) r
    ),
    'jobMaterialUsage', jsonb_build_object(
      'byMaterialId', (
        SELECT coalesce(jsonb_object_agg(m."id", coalesce(m."estimatedQuantity", 0)), '{}'::jsonb)
        FROM "jobMaterial" m
        WHERE m."itemId" = item_id AND m."companyId" = company_id
      ),
      'byJobId', (
        SELECT coalesce(jsonb_object_agg(j."id", coalesce(j."quantity", 0)), '{}'::jsonb)
        FROM "job" j
        WHERE j."itemId" = item_id AND j."companyId" = company_id
      )
    )
  );
$$;

-- Every change notice that touches an item or any other revision of it (an
-- item row sharing its "readableId"): as an affected item, as a component on a
-- notice's draft method, as either side of a supersession, or as the revision
-- a notice created. Newest first. NULL or empty statuses means any status.
CREATE OR REPLACE FUNCTION get_item_change_notices(
  item_id TEXT,
  company_id TEXT,
  statuses "changeOrderStatus"[] DEFAULT NULL
)
RETURNS TABLE (
  "id" TEXT,
  "changeOrderId" TEXT,
  "name" TEXT,
  "status" "changeOrderStatus",
  "changeOrderTypeId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH revisions AS (
    SELECT r."id", r."changeOrderId"
    FROM "item" i
    JOIN "item" r
      ON r."readableId" = i."readableId" AND r."companyId" = i."companyId"
    WHERE i."id" = item_id AND i."companyId" = company_id
  ),
  notices AS (
    SELECT a."changeOrderId"
    FROM "changeOrderAffectedItem" a
    WHERE a."companyId" = company_id
      AND a."itemId" IN (SELECT r."id" FROM revisions r)
    UNION
    SELECT m."changeOrderId"
    FROM "methodMaterial" c
    JOIN "makeMethod" m
      ON m."id" = c."makeMethodId" AND m."companyId" = c."companyId"
    WHERE c."companyId" = company_id
      AND c."itemId" IN (SELECT r."id" FROM revisions r)
      AND m."changeOrderId" IS NOT NULL
    UNION
    SELECT s."changeOrderId"
    FROM "changeOrderSupersession" s
    WHERE s."companyId" = company_id
      AND (
        s."predecessorItemId" IN (SELECT r."id" FROM revisions r)
        OR s."successorItemId" IN (SELECT r."id" FROM revisions r)
      )
    UNION
    SELECT r."changeOrderId" FROM revisions r WHERE r."changeOrderId" IS NOT NULL
  )
  SELECT
    co."id",
    co."changeOrderId",
    co."name",
    co."status",
    co."changeOrderTypeId",
    co."createdAt"
  FROM "changeOrder" co
  WHERE co."companyId" = company_id
    AND co."id" IN (SELECT n."changeOrderId" FROM notices n)
    AND (
      statuses IS NULL
      OR cardinality(statuses) = 0
      OR co."status" = ANY (statuses)
    )
  ORDER BY co."createdAt" DESC, co."id";
$$;
