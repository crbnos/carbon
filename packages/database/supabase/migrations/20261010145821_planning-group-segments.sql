-- Projects Phase 3: a member of an active planning group nets in the group's
-- segment (the group id). Grouped supply (a PO line or job with
-- "planningGroupId") is supply in that segment.
-- Spec: .ai/specs/2026-10-03-projects.md (Phase 3: planning groups)
--
-- The views are recreated from their Phase 2b definitions
-- (20261010133214_mrp-segment-views.sql). New columns go LAST, so
-- CREATE OR REPLACE keeps every existing column and filter:
--   * "ownerProjectId"  — the row's own project (null for grouped supply);
--   * "planningGroupId" — the group of grouped supply or of a grouped job;
--   * "projectPriority" — project."planningPriority", for the peg order.
-- A company with no planning group gets the same rows and segments as before.

-- ============================================================
-- 1. The segment rule. Its TS twin is planningSegmentOf (plan-company.ts).
-- ============================================================
CREATE OR REPLACE FUNCTION project_planning_segment(p_project_id TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE
                     WHEN g."id" IS NOT NULL AND g."active" THEN g."id"
                     WHEN p."projectStock" THEN p."id"
                     ELSE '' END
                   FROM "project" p
                   LEFT JOIN "planningGroup" g ON g."id" = p."planningGroupId" AND g."companyId" = p."companyId"
                   WHERE p."id" = p_project_id), '');
$$;

-- ============================================================
-- 2. openJobMaterialLines — a grouped job's materials are demand in its group.
-- ============================================================
CREATE OR REPLACE VIEW "openJobMaterialLines" WITH (security_invoker = true) AS (
  SELECT
    jm."id",
    jm."jobId",
    jmm."parentMaterialId",
    jm."jobMakeMethodId",
    j."jobId" as "jobReadableId",
    jm."itemId",
    jm."quantityToIssue",
    jm."unitOfMeasureCode",
    jm."companyId",
    i1."replenishmentSystem",
    i1."itemTrackingType",
    ir."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate",
    jm."quantity" AS "quantityPerParent",
    COALESCE(j."planningGroupId", project_planning_segment(j."projectId")) AS "planningSegmentId",
    j."projectId" AS "ownerProjectId",
    j."planningGroupId",
    p."planningPriority" AS "projectPriority",
    j."projectElementId"
  FROM "jobMaterial" jm
  INNER JOIN "job" j
    ON jm."jobId" = j."id" AND j."companyId" = jm."companyId"
  INNER JOIN "jobMakeMethod" jmm
    ON jm."jobMakeMethodId" = jmm."id" AND jmm."companyId" = jm."companyId"
  INNER JOIN "item" i1
    ON jm."itemId" = i1."id" AND i1."companyId" = jm."companyId"
  INNER JOIN "item" i2
    ON j."itemId" = i2."id" AND i2."companyId" = jm."companyId"
  INNER JOIN "itemReplenishment" ir
    ON i2."id" = ir."itemId" AND ir."companyId" = jm."companyId"
  LEFT JOIN "project" p
    ON p."id" = j."projectId" AND p."companyId" = j."companyId"
  WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND jm."methodType" != 'Make to Order'
);

-- ============================================================
-- 3. openProductionOrders — a grouped job is supply in its group.
-- ============================================================
CREATE OR REPLACE VIEW "openProductionOrders"
WITH (security_invoker = true)
AS (
  SELECT
    j."id",
    j."itemId",
    j."jobId",
    j."productionQuantity" - j."quantityReceivedToInventory" AS "quantityToReceive",
    j."unitOfMeasureCode",
    j."companyId",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate",
    j."deadlineType",
    COALESCE(
      j."planningGroupId",
      CASE
        WHEN j."receiveToProjectStock" THEN project_planning_segment(j."projectId")
        ELSE ''
      END
    ) AS "planningSegmentId",
    j."projectId" AS "ownerProjectId",
    j."planningGroupId"
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND j."salesOrderId" IS NULL
  AND NOT j."consumeToProject"
);

-- ============================================================
-- 4. openPurchaseOrderLines — a grouped line is supply in its group.
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
    -- Consumed by the project at receipt (post-receipt `consumedByProject`).
    AND NOT (
      pol."projectId" IS NOT NULL
      AND po."purchaseOrderType" <> 'Outside Processing'
      AND i."itemTrackingType" <> 'Non-Inventory'
      AND EXISTS (
        SELECT 1 FROM "project" p
        WHERE p."id" = pol."projectId"
          AND p."companyId" = pol."companyId"
          AND NOT p."projectStock"
      )
      AND project_cost_treatment(
        pol."companyId", pol."projectId", pol."projectElementId",
        company_today(pol."companyId")
      ) IS DISTINCT FROM 'Statistical'
    )
);

-- ============================================================
-- 5. openProjectMaterialLines — the segment follows the group through
--    project_planning_segment; the project's priority orders its pegs.
-- ============================================================
CREATE OR REPLACE VIEW "openProjectMaterialLines" WITH (security_invoker = true) AS
SELECT
  m."id",
  m."companyId",
  m."projectId",
  m."projectElementId",
  m."itemId",
  p."locationId",
  m."quantity" - m."quantityIssued" AS "quantity",
  COALESCE(m."requiredDate", e."startDate", p."startDate") AS "requiredDate",
  project_planning_segment(m."projectId") AS "planningSegmentId",
  p."planningPriority" AS "projectPriority"
FROM "projectElementMaterial" m
JOIN "projectElement" e ON e."id" = m."projectElementId" AND e."companyId" = m."companyId"
JOIN "projectState" s ON s."id" = e."stateId" AND s."companyId" = e."companyId"
JOIN "project" p ON p."id" = m."projectId" AND p."companyId" = m."companyId"
WHERE m."methodType" = 'Pull from Inventory'
  AND m."quantity" > m."quantityIssued"
  AND s."group" IN ('Unstarted', 'Started')
  AND p."status" = 'Released'
  AND p."locationId" IS NOT NULL;

-- ============================================================
-- 6. openProjectBorrows — "projectPriority" is the borrower's.
-- ============================================================
CREATE OR REPLACE VIEW "openProjectBorrows" WITH (security_invoker = true) AS
SELECT
  b."id",
  b."companyId",
  b."borrowerProjectId",
  b."lenderProjectId",
  b."itemId",
  b."locationId",
  b."quantity" - b."quantityPaidBack" AS "quantity",
  b."paybackDueDate",
  project_planning_segment(b."borrowerProjectId") AS "borrowerSegmentId",
  project_planning_segment(b."lenderProjectId") AS "lenderSegmentId",
  p."planningPriority" AS "projectPriority"
FROM "projectBorrow" b
LEFT JOIN "project" p ON p."id" = b."borrowerProjectId" AND p."companyId" = b."companyId"
WHERE b."status" = 'Open';
