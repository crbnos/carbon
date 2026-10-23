-- Projects Phase 2b: the MRP demand and supply views carry a netting segment.
-- Spec: .ai/specs/2026-10-03-projects.md (MRP: a project-aware netting segment)
--
-- Every view gains "planningSegmentId" as its LAST column, so CREATE OR REPLACE
-- keeps every existing column and filter. '' is the common segment; a project
-- id is a project with project stock (project_planning_segment,
-- 20261021004600). A company with no project stock sees '' on every row.
--
-- Two supply rows leave the views, because they never put stock on hand:
--   * a job that consumes its output to its project (consumeToProject);
--   * a purchase order line that its receipt consumes to the project. The
--     condition mirrors `consumedByProject` in post-receipt (index.ts) and
--     loadReceiptProjectRoutes (project-routes.ts): not outside processing,
--     an inventory item, a project without project stock, and a treatment
--     on the company's today that is not Statistical.
--
-- Two new views feed MRP: openProjectMaterialLines (plan-line materials) and
-- openProjectBorrows (open borrows between projects).

-- ============================================================
-- 1. openSalesOrderLines — forked from 20261006130001. Phase 4 links sales
--    orders to projects; until then every line is common.
-- ============================================================
CREATE OR REPLACE VIEW "openSalesOrderLines" WITH (security_invoker=true) AS (
  SELECT
    sol."id",
    sol."salesOrderId",
    sol."itemId",
    sol."promisedDate",
    sol."methodType",
    sol."unitOfMeasureCode",
    CASE
      WHEN sol."methodType" = 'Make to Order' THEN GREATEST(
        sol."quantityToSend" - COALESCE((
          SELECT SUM(GREATEST(j."quantity" - j."quantityReceivedToInventory" - j."quantityShipped", 0))
          FROM "job" j
          WHERE j."salesOrderLineId" = sol."id"
            AND j."companyId" = sol."companyId"
            AND j."status" IN ('Planned', 'Ready', 'In Progress', 'Paused')
        ), 0),
        0
      )
      ELSE sol."quantityToSend"
    END AS "quantityToSend",
    -- Pre-job-dedup open quantity: what this line CONSUMES from the demand
    -- forecast. An MTO line fully covered by its linked job still consumed
    -- the forecast that predicted it; only its residual drives new supply.
    sol."quantityToSend" AS "quantityToConsume",
    sol."salesOrderLineType",
    sol."companyId",
    COALESCE(sol."locationId", so."locationId") AS "locationId",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime",
    ''::text AS "planningSegmentId"
  FROM "salesOrderLine" sol
  INNER JOIN "salesOrder" so ON sol."salesOrderId" = so."id"
  INNER JOIN "item" i ON sol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE sol."salesOrderLineType" != 'Service'
    AND so."status" IN ('To Ship', 'To Ship and Invoice')
);

-- ============================================================
-- 2. openJobMaterialLines — forked from 20260926093417. A job's materials
--    are demand in its project's segment.
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
    project_planning_segment(j."projectId") AS "planningSegmentId"
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
  WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND jm."methodType" != 'Make to Order'
);

-- ============================================================
-- 3. openProductionOrders — forked from 20260811123619. A job that receives
--    to project stock is supply in its project's segment. A job that
--    consumes its output to the project puts nothing in stock.
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
    CASE
      WHEN j."receiveToProjectStock" THEN project_planning_segment(j."projectId")
      ELSE ''
    END AS "planningSegmentId"
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
-- 4. openPurchaseOrderLines — forked from 20260811123616. A line charged to
--    a project with project stock is supply in its segment. A line that the
--    receipt consumes to its project is not supply.
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
    project_planning_segment(pol."projectId") AS "planningSegmentId"
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
-- 5. openProjectMaterialLines — open plan-line materials of released
--    projects, on elements that have not finished. Pull from Inventory only:
--    a Make or Buy line becomes a job or a PO line, which carries the demand.
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
  project_planning_segment(m."projectId") AS "planningSegmentId"
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
-- 6. openProjectBorrows — open borrows between projects. MRP books each as
--    firm demand on the borrower and firm supply on the lender, both on the
--    payback due date.
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
  project_planning_segment(b."lenderProjectId") AS "lenderSegmentId"
FROM "projectBorrow" b
WHERE b."status" = 'Open';
