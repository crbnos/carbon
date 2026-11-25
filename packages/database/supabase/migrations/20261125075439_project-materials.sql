-- Projects: the Materials page and the Projects group of Used In.
-- Spec: .ai/specs/2026-11-25-project-materials-page.md

-- One row per plan line of a project, plus one Unplanned row per element and
-- item with issues, PO lines or jobs that no plan line links. Quantities only,
-- with the stored status of each PO and job. The ERP calls it through the
-- system handle after the Projects View check (getProjectMaterials), because
-- it reads tables that other modules guard. SECURITY INVOKER keeps a direct
-- PostgREST call under the caller's row-level security.
CREATE OR REPLACE FUNCTION public.get_project_materials(project_id TEXT, company_id TEXT)
RETURNS TABLE (
  "rowKind" TEXT,
  "projectElementMaterialId" TEXT,
  "projectElementId" TEXT,
  "elementReadableId" TEXT,
  "elementName" TEXT,
  "elementSequence" INTEGER,
  "elementStateName" TEXT,
  "elementStateGroup" "projectStateGroup",
  "elementStateColor" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "itemName" TEXT,
  "methodType" "methodType",
  "unitOfMeasureCode" TEXT,
  "quantityRequired" NUMERIC,
  "quantityOrdered" NUMERIC,
  "quantityReceived" NUMERIC,
  "quantityIssued" NUMERIC,
  "quantityRemaining" NUMERIC,
  "requiredDate" DATE,
  "issueStatus" TEXT,
  "supplies" JSONB,
  "projectOnHand" NUMERIC,
  "unassignedOnHand" NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH proj AS (
    SELECT p."id", p."locationId", p."projectStock", p."startDate"
    FROM "project" p
    WHERE p."id" = project_id AND p."companyId" = company_id
  ),
  materials AS (
    SELECT m.*
    FROM "projectElementMaterial" m
    WHERE m."projectId" = project_id AND m."companyId" = company_id
  ),
  -- The rule of project_receipt_charge_quantities: a relocation row whose
  -- journal line is on an inventory account is the inventory side.
  inventory_accounts AS (
    SELECT ARRAY[ad."rawMaterialsAccount", ad."finishedGoodsAccount"] AS "accounts"
    FROM "accountDefault" ad
    WHERE ad."companyId" = company_id
  ),
  issues AS (
    SELECT pl."projectElementId", pl."itemId", SUM(pl."quantity") AS "quantity"
    FROM "projectLedger" pl
    LEFT JOIN "journalLine" jl
      ON jl."id" = pl."journalLineId" AND jl."companyId" = pl."companyId"
    LEFT JOIN inventory_accounts a ON TRUE
    WHERE pl."companyId" = company_id
      AND pl."projectId" = project_id
      AND pl."documentType" = 'Project Issue'
      AND pl."itemId" IS NOT NULL
      AND NOT (
        pl."relocatesReceiptCharge"
        AND COALESCE(jl."accountId" = ANY(a."accounts"), FALSE)
      )
    GROUP BY pl."projectElementId", pl."itemId"
  ),
  -- The covered rule of openProjectMaterialLines.
  po_supply AS (
    SELECT
      pol."id" AS "lineId",
      pol."projectId",
      pol."projectElementId",
      pol."itemId",
      po."id" AS "documentId",
      po."purchaseOrderId" AS "readableId",
      po."status"::TEXT AS "status",
      CASE
        WHEN pol."receivedComplete" OR po."status" IN ('Closed', 'Rejected')
          THEN COALESCE(pol."quantityReceived", 0)
        ELSE GREATEST(COALESCE(pol."purchaseQuantity", 0), COALESCE(pol."quantityReceived", 0))
      END * COALESCE(pol."conversionFactor", 1) AS "ordered",
      COALESCE(pol."quantityReceived", 0) * COALESCE(pol."conversionFactor", 1) AS "received",
      purchase_order_line_consumed_by_project(
        pol."companyId", pol."projectId", pol."projectElementId",
        po."purchaseOrderType", i."itemTrackingType"
      ) AS "consumed"
    FROM "purchaseOrderLine" pol
    JOIN "purchaseOrder" po
      ON po."id" = pol."purchaseOrderId" AND po."companyId" = pol."companyId"
    JOIN "item" i
      ON i."id" = pol."itemId" AND i."companyId" = pol."companyId"
    WHERE pol."companyId" = company_id
      AND (
        pol."projectId" = project_id
        OR pol."id" IN (SELECT "purchaseOrderLineId" FROM materials WHERE "purchaseOrderLineId" IS NOT NULL)
      )
  ),
  job_supply AS (
    SELECT
      j."id" AS "documentId",
      j."projectId",
      j."projectElementId",
      j."itemId",
      j."jobId" AS "readableId",
      j."status"::TEXT AS "status",
      CASE
        WHEN j."status" IN ('Completed', 'Closed', 'Cancelled') THEN j."quantityComplete"
        ELSE j."quantity"
      END AS "ordered",
      j."quantityComplete" AS "received",
      j."consumeToProject" AS "consumed"
    FROM "job" j
    WHERE j."companyId" = company_id
      AND (
        j."projectId" = project_id
        OR j."id" IN (SELECT "jobId" FROM materials WHERE "jobId" IS NOT NULL)
      )
  ),
  plan_rows AS (
    SELECT
      'Plan'::TEXT AS "rowKind",
      m."id" AS "projectElementMaterialId",
      m."projectElementId",
      m."itemId",
      m."methodType",
      m."unitOfMeasureCode",
      m."quantity" AS "quantityRequired",
      COALESCE(ps."ordered", js."ordered", 0) AS "quantityOrdered",
      COALESCE(ps."received", js."received", 0) AS "quantityReceived",
      m."quantityIssued"
        + CASE WHEN ps."consumed" THEN ps."received" ELSE 0 END
        + CASE WHEN js."consumed" THEN js."received" ELSE 0 END AS "quantityIssued",
      COALESCE(m."requiredDate", e."startDate", (SELECT "startDate" FROM proj)) AS "requiredDate",
      CASE
        WHEN ps."lineId" IS NOT NULL THEN jsonb_build_array(jsonb_build_object(
          'type', 'Purchase Order', 'documentId', ps."documentId",
          'readableId', ps."readableId", 'lineId', ps."lineId", 'status', ps."status"))
        WHEN js."documentId" IS NOT NULL THEN jsonb_build_array(jsonb_build_object(
          'type', 'Job', 'documentId', js."documentId",
          'readableId', js."readableId", 'lineId', NULL, 'status', js."status"))
        ELSE '[]'::jsonb
      END AS "supplies"
    FROM materials m
    JOIN "projectElement" e
      ON e."id" = m."projectElementId" AND e."companyId" = m."companyId"
    LEFT JOIN po_supply ps ON ps."lineId" = m."purchaseOrderLineId"
    LEFT JOIN job_supply js ON js."documentId" = m."jobId"
  ),
  unplanned_sources AS (
    SELECT i."projectElementId", i."itemId",
      0::NUMERIC AS "ordered", 0::NUMERIC AS "received", i."quantity" AS "issued",
      NULL::JSONB AS "supply"
    FROM issues i
    WHERE NOT EXISTS (
      SELECT 1 FROM materials m
      WHERE m."projectElementId" IS NOT DISTINCT FROM i."projectElementId"
        AND m."itemId" = i."itemId"
    )
    UNION ALL
    SELECT ps."projectElementId", ps."itemId", ps."ordered", ps."received",
      CASE WHEN ps."consumed" THEN ps."received" ELSE 0 END,
      jsonb_build_object('type', 'Purchase Order', 'documentId', ps."documentId",
        'readableId', ps."readableId", 'lineId', ps."lineId", 'status', ps."status")
    FROM po_supply ps
    WHERE ps."projectId" = project_id
      AND NOT EXISTS (SELECT 1 FROM materials m WHERE m."purchaseOrderLineId" = ps."lineId")
    UNION ALL
    SELECT js."projectElementId", js."itemId", js."ordered", js."received",
      CASE WHEN js."consumed" THEN js."received" ELSE 0 END,
      jsonb_build_object('type', 'Job', 'documentId', js."documentId",
        'readableId', js."readableId", 'lineId', NULL, 'status', js."status")
    FROM job_supply js
    WHERE js."projectId" = project_id
      AND NOT EXISTS (SELECT 1 FROM materials m WHERE m."jobId" = js."documentId")
  ),
  unplanned_rows AS (
    SELECT
      'Unplanned'::TEXT AS "rowKind",
      NULL::TEXT AS "projectElementMaterialId",
      u."projectElementId",
      u."itemId",
      NULL::"methodType" AS "methodType",
      NULL::TEXT AS "unitOfMeasureCode",
      0::NUMERIC AS "quantityRequired",
      SUM(u."ordered") AS "quantityOrdered",
      SUM(u."received") AS "quantityReceived",
      SUM(u."issued") AS "quantityIssued",
      NULL::DATE AS "requiredDate",
      COALESCE(jsonb_agg(u."supply") FILTER (WHERE u."supply" IS NOT NULL), '[]'::jsonb) AS "supplies"
    FROM unplanned_sources u
    GROUP BY u."projectElementId", u."itemId"
  ),
  all_rows AS (
    SELECT * FROM plan_rows
    UNION ALL
    SELECT * FROM unplanned_rows
  ),
  stock AS (
    SELECT q."itemId",
      SUM(q."quantityOnHand") FILTER (WHERE q."projectId" = project_id) AS "projectOnHand",
      SUM(q."quantityOnHand") FILTER (
        WHERE q."projectId" = '' AND q."locationId" = (SELECT "locationId" FROM proj)
      ) AS "unassignedOnHand"
    FROM "itemStockQuantities" q
    WHERE q."companyId" = company_id
      AND (SELECT "projectStock" FROM proj)
      AND q."itemId" IN (SELECT "itemId" FROM all_rows)
    GROUP BY q."itemId"
  )
  SELECT
    r."rowKind",
    r."projectElementMaterialId",
    r."projectElementId",
    e."readableId",
    e."name",
    e."sequence",
    s."name",
    s."group",
    s."color",
    r."itemId",
    COALESCE(it."readableIdWithRevision", it."readableId"),
    it."name",
    r."methodType",
    COALESCE(r."unitOfMeasureCode", it."unitOfMeasureCode"),
    r."quantityRequired",
    r."quantityOrdered",
    r."quantityReceived",
    r."quantityIssued",
    CASE WHEN r."rowKind" = 'Plan'
      THEN GREATEST(0, r."quantityRequired" - r."quantityIssued") END,
    r."requiredDate",
    CASE
      WHEN r."rowKind" = 'Unplanned' THEN 'Unplanned'
      WHEN r."quantityIssued" >= r."quantityRequired" THEN 'Issued'
      WHEN r."quantityIssued" > 0 THEN 'Partly issued'
      ELSE 'Not issued'
    END,
    r."supplies",
    st."projectOnHand",
    st."unassignedOnHand"
  FROM all_rows r
  JOIN proj ON TRUE
  JOIN "item" it ON it."id" = r."itemId" AND it."companyId" = company_id
  LEFT JOIN "projectElement" e
    ON e."id" = r."projectElementId" AND e."companyId" = company_id
  LEFT JOIN "projectState" s
    ON s."id" = e."stateId" AND s."companyId" = company_id
  LEFT JOIN stock st ON st."itemId" = r."itemId"
  ORDER BY e."sequence" NULLS LAST, r."rowKind", COALESCE(it."readableIdWithRevision", it."readableId"), r."projectElementMaterialId"
  LIMIT 1001;
$$;

-- Forked from 20261005041631_item-usage-and-change-notice-lookups.sql: adds
-- 'projectMaterials', the plan lines of the item with their element.
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
    'projectMaterials', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(r) - 'createdAt' ORDER BY r."createdAt" DESC, r."id"), '[]'::jsonb
      )
      FROM (
        SELECT l."id", l."createdAt", l."methodType",
          e."readableId" AS "documentReadableId",
          l."projectId" AS "documentId",
          l."projectElementId" AS "documentParentId"
        FROM "projectElementMaterial" l
        JOIN "projectElement" e
          ON e."id" = l."projectElementId" AND e."companyId" = l."companyId"
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
