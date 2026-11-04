-- Project and service parts in MRP.
-- Plan: .ai/plans/2026-10-15-project-service-parts-mrp.md
--
-- 1. A Draft service order's Service project is Draft, so its plan-line
--    materials are not demand. Existing Draft orders with a charge move to
--    Planned (they were worked as released); the rest stay Draft.
-- 2. purchase_order_line_consumed_by_project: one predicate for "the project
--    consumes this PO line at receipt" (post-receipt `consumedByProject`), so
--    the supply view and the demand view below cannot disagree.
-- 3. openPurchaseOrderLines: unchanged rows, the predicate now a function call.
-- 4. openProjectMaterialLines: a Purchase to Order plan line is demand, as in
--    openJobMaterialLines. Its own PO line (Create PO line) that the project
--    consumes at receipt is not supply, so it reduces the line's demand
--    instead. A service part with no date is due at the order's next visit.

-- ============================================================
-- 1. Draft service orders
-- ============================================================
UPDATE "serviceOrder" so
SET "status" = 'Planned'
WHERE so."status" = 'Draft'
  AND EXISTS (
    SELECT 1 FROM "projectLedger" pl
    WHERE pl."projectId" = so."projectId" AND pl."companyId" = so."companyId"
  );

UPDATE "project" p
SET "status" = 'Draft'
FROM "serviceOrder" so
WHERE so."projectId" = p."id"
  AND so."companyId" = p."companyId"
  AND so."status" = 'Draft'
  AND p."status" = 'Released';

-- ============================================================
-- 2. The consumed-at-receipt predicate. Its TS twin is `consumedByProject`
--    in post-receipt: a PO line charged to a project without project stock,
--    not outside processing, not a non-inventory item, and not Statistical.
-- ============================================================
CREATE OR REPLACE FUNCTION purchase_order_line_consumed_by_project(
  p_company_id TEXT,
  p_project_id TEXT,
  p_project_element_id TEXT,
  p_purchase_order_type "purchaseOrderType",
  p_item_tracking_type "itemTrackingType"
) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT p_project_id IS NOT NULL
    AND p_purchase_order_type <> 'Outside Processing'
    AND p_item_tracking_type <> 'Non-Inventory'
    AND EXISTS (
      SELECT 1 FROM "project" p
      WHERE p."id" = p_project_id
        AND p."companyId" = p_company_id
        AND NOT p."projectStock"
    )
    AND project_cost_treatment(
      p_company_id, p_project_id, p_project_element_id,
      company_today(p_company_id)
    ) IS DISTINCT FROM 'Statistical'
$$;

-- ============================================================
-- 3. Supply: recreated from 20261021005100_planning-group-segments.sql
-- ============================================================
CREATE OR REPLACE VIEW "openPurchaseOrderLines" WITH (security_invoker=true) AS (
  SELECT
    pol."id",
    pol."purchaseOrderId",
    po."purchaseOrderId" as "purchaseOrderReadableId",
    po."supplierId",
    pol."itemId",
    pol."quantityToReceive" * pol."conversionFactor" AS "quantityToReceive",
    i."unitOfMeasureCode",
    pol."purchaseOrderLineType",
    pol."requiredDate" AS "dueDate",
    pol."companyId",
    pol."locationId",
    po."orderDate",
    po."status",
    COALESCE(pol."promisedDate", pod."receiptPromisedDate") AS "promisedDate",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime" AS "leadTime",
    COALESCE(pol."planningGroupId", project_planning_segment(pol."projectId")) AS "planningSegmentId",
    pol."projectId" AS "ownerProjectId",
    pol."planningGroupId"
  FROM "purchaseOrderLine" pol
  INNER JOIN "purchaseOrder" po ON pol."purchaseOrderId" = po."id"
  INNER JOIN "purchaseOrderDelivery" pod ON pod."id" = po."id"
  INNER JOIN "item" i ON pol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE
    pol."purchaseOrderLineType" != 'Service'
    AND po."status" IN ('To Receive', 'To Receive and Invoice', 'Planned')
    AND pol."receivedComplete" = false
    AND NOT purchase_order_line_consumed_by_project(
      pol."companyId", pol."projectId", pol."projectElementId",
      po."purchaseOrderType", i."itemTrackingType"
    )
);

-- ============================================================
-- 4. Demand: recreated from 20261021005100_planning-group-segments.sql.
--    Same columns; "quantity" and "requiredDate" change, and the method
--    filter takes every method but Make to Order.
--
--    "covered" is what the line's own consumed PO line brings, in item
--    units: the ordered quantity while more can arrive, the received
--    quantity once the line is received complete or the order is Closed or
--    Rejected. A PO line that is supply (project stock, Statistical) covers
--    nothing here: MRP nets it as supply.
--
--    "nextVisit" is the planned start of the Service project's next
--    unfinished visit, as a date in the company's time zone.
-- ============================================================
CREATE OR REPLACE VIEW "openProjectMaterialLines" WITH (security_invoker = true) AS
SELECT
  m."id",
  m."companyId",
  m."projectId",
  m."projectElementId",
  m."itemId",
  p."locationId",
  m."quantity" - m."quantityIssued" - covered."quantity" AS "quantity",
  COALESCE(m."requiredDate", e."startDate", next_visit."date", p."startDate") AS "requiredDate",
  project_planning_segment(m."projectId") AS "planningSegmentId",
  p."planningPriority" AS "projectPriority"
FROM "projectElementMaterial" m
JOIN "projectElement" e ON e."id" = m."projectElementId" AND e."companyId" = m."companyId"
JOIN "projectState" s ON s."id" = e."stateId" AND s."companyId" = e."companyId"
JOIN "project" p ON p."id" = m."projectId" AND p."companyId" = m."companyId"
CROSS JOIN LATERAL (
  SELECT COALESCE((
    SELECT
      CASE
        WHEN pol."receivedComplete" OR po."status" IN ('Closed', 'Rejected')
          THEN COALESCE(pol."quantityReceived", 0)
        ELSE GREATEST(
          COALESCE(pol."purchaseQuantity", 0),
          COALESCE(pol."quantityReceived", 0)
        )
      END * COALESCE(pol."conversionFactor", 1)
    FROM "purchaseOrderLine" pol
    JOIN "purchaseOrder" po ON po."id" = pol."purchaseOrderId" AND po."companyId" = pol."companyId"
    JOIN "item" i ON i."id" = pol."itemId" AND i."companyId" = pol."companyId"
    WHERE pol."id" = m."purchaseOrderLineId"
      AND pol."companyId" = m."companyId"
      AND purchase_order_line_consumed_by_project(
        pol."companyId", pol."projectId", pol."projectElementId",
        po."purchaseOrderType", i."itemTrackingType"
      )
  ), 0) AS "quantity"
) covered
LEFT JOIN LATERAL (
  SELECT (MIN(v."plannedStart") AT TIME ZONE c."timezone")::date AS "date"
  FROM "serviceOrder" so
  JOIN "serviceVisit" v ON v."serviceOrderId" = so."id" AND v."companyId" = so."companyId"
  JOIN "company" c ON c."id" = so."companyId"
  WHERE so."projectId" = p."id"
    AND so."companyId" = p."companyId"
    AND v."status" IN ('Scheduled', 'Traveling', 'On Site')
  GROUP BY c."timezone"
) next_visit ON TRUE
WHERE m."methodType" <> 'Make to Order'
  AND m."quantity" - m."quantityIssued" - covered."quantity" > 0
  AND s."group" IN ('Unstarted', 'Started')
  AND p."status" = 'Released'
  AND p."locationId" IS NOT NULL;
