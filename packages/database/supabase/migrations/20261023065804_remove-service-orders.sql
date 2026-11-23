-- Remove the old field-service module: service orders, visits, installed components,
-- Service projects, the By Coverage treatment and coverage on charges.
-- Service jobs replace it (.ai/specs/2026-10-22-service-jobs-and-returns.md).
-- The RLS rules left in 20261023065359_remove-service-order-rls.sql.
--
-- Kept: customerAsset, customerAssetStatus, projectBillableItem(Status), projectExpenseEntry,
-- employeeJob."defaultStorageUnitId", the 'Service' module value and the journal values
-- 'Service Order' and 'Project Expense'.

-- 1) Objects that read the service tables.
-- openProjectMaterialLines: the newest body (20261021013000) without the next_visit join.
CREATE OR REPLACE VIEW "openProjectMaterialLines" WITH (security_invoker = true) AS
SELECT
  m."id",
  m."companyId",
  m."projectId",
  m."projectElementId",
  m."itemId",
  p."locationId",
  m."quantity" - m."quantityIssued" - covered."quantity" AS "quantity",
  COALESCE(m."requiredDate", e."startDate", p."startDate") AS "requiredDate",
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
WHERE m."methodType" <> 'Make to Order'
  AND m."quantity" - m."quantityIssued" - covered."quantity" > 0
  AND s."group" IN ('Unstarted', 'Started')
  AND p."status" = 'Released'
  AND p."locationId" IS NOT NULL;

DROP FUNCTION IF EXISTS get_child_service_project_costs(TEXT, TEXT);

-- 2) Foreign keys and indexes into the service tables.
ALTER TABLE "salesInvoice" DROP CONSTRAINT IF EXISTS "salesInvoice_serviceOrder_fkey";
DROP INDEX IF EXISTS "salesInvoice_serviceOrderId_idx";
ALTER TABLE "timesheetEntry" DROP CONSTRAINT IF EXISTS "timesheetEntry_visit_fkey";
DROP INDEX IF EXISTS "timesheetEntry_serviceVisitId_idx";
ALTER TABLE "projectExpenseEntry" DROP CONSTRAINT IF EXISTS "projectExpenseEntry_visit_fkey";
DROP INDEX IF EXISTS "projectExpenseEntry_serviceVisitId_idx";

-- 3) The service tables. Children first; no CASCADE, so a missed dependent fails here.
DROP TABLE IF EXISTS "serviceVisit";
DROP TABLE IF EXISTS "customerAssetComponent";
DROP TABLE IF EXISTS "serviceOrder";

DELETE FROM "sequence" WHERE "table" = 'serviceOrder';

-- 4) Service projects (templates included) and the rows that belong to them.
-- Rows another document owns keep the document: an inventory ledger row only loses its
-- project. A project row the FKs below do not cover (a job, a PO line on a node) fails
-- the delete loudly rather than being removed.
UPDATE "itemLedger" SET "projectId" = NULL
WHERE ("projectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service');
UPDATE "costLedger" SET "projectId" = NULL
WHERE ("projectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service');
UPDATE "pickingListLine" SET "projectId" = NULL
WHERE ("projectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service');
UPDATE "inventoryCountLine" SET "projectId" = NULL
WHERE ("projectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service');

DELETE FROM "projectBillableItem"
WHERE ("projectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service');
DELETE FROM "timesheetEntry"
WHERE ("projectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service');
DELETE FROM "projectExpenseEntry"
WHERE ("projectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service');
DELETE FROM "projectLedger"
WHERE ("projectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service');
DELETE FROM "projectPeg"
WHERE ("projectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service');
DELETE FROM "projectStockTransfer"
WHERE ("fromProjectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service')
   OR ("toProjectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service');
DELETE FROM "projectBorrow"
WHERE ("borrowerProjectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service')
   OR ("lenderProjectId", "companyId") IN (SELECT "id", "companyId" FROM "project" WHERE "projectType" = 'Service');
-- Elements, milestones, members and the other ON DELETE CASCADE children go with it.
DELETE FROM "project" WHERE "projectType" = 'Service';

UPDATE "project" SET "costTreatment" = 'Statistical' WHERE "costTreatment" = 'By Coverage';
UPDATE "projectElement" SET "costTreatment" = 'Statistical' WHERE "costTreatment" = 'By Coverage';

-- 5) The Service project columns and constraints.
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_parent_fkey";
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_parent_check";
DROP INDEX IF EXISTS "project_parentProjectId_idx";
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_service_treatment_check";
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_identifier_check";

ALTER TABLE "project"
  DROP COLUMN IF EXISTS "projectType",
  DROP COLUMN IF EXISTS "parentProjectId";
ALTER TABLE "timesheetEntry"
  DROP COLUMN IF EXISTS "coverage",
  DROP COLUMN IF EXISTS "coverageReason",
  DROP COLUMN IF EXISTS "serviceVisitId";
ALTER TABLE "projectLedger"
  DROP COLUMN IF EXISTS "coverage",
  DROP COLUMN IF EXISTS "coverageReason";
ALTER TABLE "projectExpenseEntry"
  DROP COLUMN IF EXISTS "coverage",
  DROP COLUMN IF EXISTS "coverageReason",
  DROP COLUMN IF EXISTS "serviceVisitId";
ALTER TABLE "projectBillableItem" DROP COLUMN IF EXISTS "coverage";
ALTER TABLE "salesInvoice" DROP COLUMN IF EXISTS "serviceOrderId";

-- The identifier check as it was before Service projects (20261021000300).
ALTER TABLE "project" ADD CONSTRAINT "project_identifier_check"
  CHECK ("identifier" IS NULL OR "identifier" ~ '^[A-Z][A-Z0-9]{1,5}$');

-- 6) The service enums.
DROP TYPE IF EXISTS "projectType";
DROP TYPE IF EXISTS "serviceCoverage";
DROP TYPE IF EXISTS "serviceOrderType";
DROP TYPE IF EXISTS "serviceOrderStatus";
DROP TYPE IF EXISTS "serviceVisitStatus";
DROP TYPE IF EXISTS "serviceInvoiceDetail";

-- 7) projectCostTreatment without 'By Coverage'. Postgres cannot drop an enum value,
-- so the type is rebuilt and its two columns, one check, one default and two
-- functions move to it.
ALTER TYPE "projectCostTreatment" RENAME TO "projectCostTreatment_old";
CREATE TYPE "projectCostTreatment" AS ENUM ('Statistical', 'Expense', 'Capitalize', 'Contract');

ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_costObjective_treatment_check";
ALTER TABLE "project" ALTER COLUMN "costTreatment" DROP DEFAULT;
ALTER TABLE "projectElement" ALTER COLUMN "costTreatment" DROP DEFAULT;

ALTER TABLE "project"
  ALTER COLUMN "costTreatment" TYPE "projectCostTreatment"
  USING "costTreatment"::text::"projectCostTreatment";
ALTER TABLE "projectElement"
  ALTER COLUMN "costTreatment" TYPE "projectCostTreatment"
  USING "costTreatment"::text::"projectCostTreatment";

ALTER TABLE "project" ALTER COLUMN "costTreatment" SET DEFAULT 'Statistical';
-- From 20261021010500_government-contracting-columns.sql.
ALTER TABLE "project" ADD CONSTRAINT "project_costObjective_treatment_check"
  CHECK ("costObjective" IS NULL OR "costTreatment" <> 'Expense' OR "costObjective" IN ('IR&D', 'B&P', 'Indirect'));

-- From 20261021001600_complete-job-cip-project.sql (its return type names the enum).
DROP FUNCTION IF EXISTS project_cost_treatment(TEXT, TEXT, TEXT, DATE);
CREATE FUNCTION project_cost_treatment(
  p_company_id TEXT, p_project_id TEXT, p_element_id TEXT, p_posting_date DATE
) RETURNS "projectCostTreatment" LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_treatment "projectCostTreatment";
BEGIN
  WITH RECURSIVE chain AS (
    SELECT e."id", e."parentId", e."costTreatment", e."costTreatmentEffectiveFrom", 0 AS depth
    FROM "projectElement" e WHERE e."id" = p_element_id AND e."companyId" = p_company_id
    UNION ALL
    SELECT p."id", p."parentId", p."costTreatment", p."costTreatmentEffectiveFrom", c.depth + 1
    FROM "projectElement" p JOIN chain c ON p."id" = c."parentId" AND p."companyId" = p_company_id
  )
  SELECT c."costTreatment" INTO v_treatment
  FROM chain c
  WHERE c."costTreatment" IS NOT NULL
    AND (c."costTreatmentEffectiveFrom" IS NULL OR c."costTreatmentEffectiveFrom" <= p_posting_date)
  ORDER BY c.depth LIMIT 1;

  IF v_treatment IS NULL THEN
    SELECT "costTreatment" INTO v_treatment
    FROM "project" WHERE "id" = p_project_id AND "companyId" = p_company_id;
  END IF;
  RETURN v_treatment;
END;
$$;

-- From 20261021001500_project-posting-account-capitalize.sql, unchanged, so its
-- variable resolves to the new type.
CREATE OR REPLACE FUNCTION project_posting_account(
  p_company_id TEXT, p_project_id TEXT, p_element_id TEXT, p_posting_date DATE
) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_treatment "projectCostTreatment";
  v_account TEXT;
  v_project RECORD;
  v_defaults RECORD;
  v_asset_id TEXT;
  v_final_asset_id TEXT;
  v_asset RECORD;
BEGIN
  SELECT "costTreatment", "costAccountId", "fixedAssetId" INTO v_project
  FROM "project" WHERE "id" = p_project_id AND "companyId" = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id;
  END IF;

  -- nearest element (self, then ancestors) with a treatment effective on the date
  WITH RECURSIVE chain AS (
    SELECT e."id", e."parentId", e."costTreatment", e."costTreatmentEffectiveFrom", e."costAccountId", 0 AS depth
    FROM "projectElement" e WHERE e."id" = p_element_id AND e."companyId" = p_company_id
    UNION ALL
    SELECT p."id", p."parentId", p."costTreatment", p."costTreatmentEffectiveFrom", p."costAccountId", c.depth + 1
    FROM "projectElement" p JOIN chain c ON p."id" = c."parentId" AND p."companyId" = p_company_id
  )
  SELECT c."costTreatment", c."costAccountId" INTO v_treatment, v_account
  FROM chain c
  WHERE c."costTreatment" IS NOT NULL
    AND (c."costTreatmentEffectiveFrom" IS NULL OR c."costTreatmentEffectiveFrom" <= p_posting_date)
  ORDER BY c.depth LIMIT 1;

  IF v_treatment IS NULL THEN
    v_treatment := v_project."costTreatment";
    v_account := v_project."costAccountId";
  END IF;

  IF v_treatment = 'Capitalize' THEN
    -- nearest final-asset element (self, then ancestors), else the project's asset.
    -- A final-asset element with no asset yet holds none: the raise below runs.
    v_asset_id := v_project."fixedAssetId";
    IF p_element_id IS NOT NULL THEN
      WITH RECURSIVE chain AS (
        SELECT e."id", e."parentId", e."isFinalAsset", e."fixedAssetId", 0 AS depth
        FROM "projectElement" e WHERE e."id" = p_element_id AND e."companyId" = p_company_id
        UNION ALL
        SELECT p."id", p."parentId", p."isFinalAsset", p."fixedAssetId", c.depth + 1
        FROM "projectElement" p JOIN chain c ON p."id" = c."parentId" AND p."companyId" = p_company_id
      )
      SELECT c."fixedAssetId" INTO v_final_asset_id
      FROM chain c WHERE c."isFinalAsset" ORDER BY c.depth LIMIT 1;
      IF FOUND THEN v_asset_id := v_final_asset_id; END IF;
    END IF;

    SELECT fa."status", fc."assetAccountId" INTO v_asset
    FROM "fixedAsset" fa
    JOIN "fixedAssetClass" fc ON fc."id" = fa."fixedAssetClassId"
    WHERE fa."id" = v_asset_id AND fa."companyId" = p_company_id;

    IF FOUND AND v_asset."status" IN ('Under Construction', 'Active') THEN
      RETURN v_asset."assetAccountId";
    END IF;
    RAISE EXCEPTION 'This capital project has no asset under construction. Release the project first.';
  END IF;

  -- Statistical is the only treatment that returns NULL.
  IF v_treatment = 'Statistical' THEN RETURN NULL; END IF;
  IF v_account IS NOT NULL THEN RETURN v_account; END IF;

  SELECT "projectExpenseAccount", "projectWorkInProgressAccount" INTO v_defaults
  FROM "accountDefault" WHERE "companyId" = p_company_id;

  IF v_treatment = 'Expense' THEN
    IF v_defaults."projectExpenseAccount" IS NULL THEN
      RAISE EXCEPTION 'Set Project Expense in Account Defaults before you charge an Expense project';
    END IF;
    RETURN v_defaults."projectExpenseAccount";
  END IF;

  IF v_treatment = 'Contract' THEN
    IF v_defaults."projectWorkInProgressAccount" IS NULL THEN
      RAISE EXCEPTION 'Set Project Work in Progress in Account Defaults before you charge a Contract project';
    END IF;
    RETURN v_defaults."projectWorkInProgressAccount";
  END IF;

  RAISE EXCEPTION 'Cost treatment % is not available yet', v_treatment;
END;
$$;

DROP TYPE "projectCostTreatment_old";

NOTIFY pgrst, 'reload schema';
