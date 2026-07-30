-- =============================================================================
-- Change Orders (ECO) module — top-to-bottom model.
--
-- The user picks affected parts first, then edits each part's BOM/BOP/attributes
-- on a CO-owned Draft makeMethod (via the normal editors, hidden until release).
-- At release the drafts are activated and propagated via itemSupersession.
--
-- Conventions clone quality/nonConformance (20250327140050_ncr.sql): id('<prefix>')
-- PK, audit columns, RLS via get_companies_with_employee_permission('parts_*')
-- for writes and get_companies_with_employee_role() for reads on lookup tables.
-- Change orders live under the Items/Parts area, so the permission domain is parts.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Idempotency teardown — makes this migration rerunnable after a partial apply
--    (a migration only re-runs after a prior apply failed midway). Safe no-op on a
--    clean DB. Drops in dependency order, including the columns added to shared
--    tables below.
-- -----------------------------------------------------------------------------
ALTER TABLE "item" DROP CONSTRAINT IF EXISTS "item_changeOrderId_fkey";
ALTER TABLE "item" DROP COLUMN IF EXISTS "changeOrderId";
ALTER TABLE "item" DROP COLUMN IF EXISTS "revisionStatus";
ALTER TABLE "makeMethod" DROP CONSTRAINT IF EXISTS "makeMethod_changeOrderId_fkey";
ALTER TABLE "makeMethod" DROP COLUMN IF EXISTS "changeOrderId";
ALTER TABLE "companySettings" DROP COLUMN IF EXISTS "plmReleaseControl";

DROP TABLE IF EXISTS "changeOrderActionTask" CASCADE;
DROP TABLE IF EXISTS "changeOrderSupersession" CASCADE;
DROP TABLE IF EXISTS "changeOrderAffectedItem" CASCADE;
DROP TABLE IF EXISTS "changeOrderRequiredAction" CASCADE;
DROP TABLE IF EXISTS "changeOrder" CASCADE;
DROP TABLE IF EXISTS "changeOrderType" CASCADE;

DROP TYPE IF EXISTS "changeOrderChangeType";
DROP TYPE IF EXISTS "changeOrderTaskStatus";
DROP TYPE IF EXISTS "itemRevisionStatus";
DROP TYPE IF EXISTS "changeOrderStatus";
DROP TYPE IF EXISTS "changeOrderTypeEnum";

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
-- Named "changeOrderTypeEnum" (not "changeOrderType") because a table of that name
-- exists below and Postgres registers an implicit composite type per table, so an
-- enum and a table cannot share a name in pg_type.
CREATE TYPE "changeOrderTypeEnum" AS ENUM (
  'Engineering',
  'Manufacturing',
  'Documentation'
);

-- Forward-only stage flow, one step at a time. Start/Implementation/Done broadcast
-- a team notification.
CREATE TYPE "changeOrderStatus" AS ENUM (
  'Draft',
  'Start',
  'Engineering Complete',
  'Implementation',
  'Done'
);

CREATE TYPE "itemRevisionStatus" AS ENUM (
  'Design',
  'Prototype',
  'Production',
  'Obsolete'
);

-- Mirrors nonConformanceTaskStatus.
CREATE TYPE "changeOrderTaskStatus" AS ENUM (
  'Pending',
  'In Progress',
  'Completed',
  'Skipped'
);

-- Per-affected-item change type — drives the release action and the editing surface:
--   Version   = new method version on the same item; no supersession.
--   Revision  = new revision item, attributes/docs only; auto supersession.
--   New Part  = new part number derived from and superseding the part; auto supersession.
CREATE TYPE "changeOrderChangeType" AS ENUM (
  'Version',
  'Revision',
  'New Part'
);

-- -----------------------------------------------------------------------------
-- 2. changeOrderType — the "Category" lookup (clones nonConformanceType)
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderType" (
  "id" TEXT NOT NULL DEFAULT id('cot'),
  "name" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderType_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderType_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderType_companyId_idx" ON "changeOrderType" ("companyId");

ALTER TABLE "changeOrderType" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderType"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderType"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderType"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderType"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

-- Seed default categories for every existing company.
INSERT INTO "changeOrderType" ("name", "companyId", "createdBy")
SELECT co_types.name, c."id", 'system'
FROM "company" c
CROSS JOIN (VALUES
  ('Design Improvement'),
  ('Cost Reduction'),
  ('Quality / Reliability Improvement'),
  ('Supplier / Sourcing Change'),
  ('Material or Component Change'),
  ('Obsolescence / End-of-Life'),
  ('Regulatory / Compliance'),
  ('Safety'),
  ('Manufacturing / Producibility'),
  ('Customer Request'),
  ('Documentation Error / Correction')
) AS co_types(name);

-- -----------------------------------------------------------------------------
-- 3. changeOrder (parent) — clones nonConformance
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrder" (
  "id" TEXT NOT NULL DEFAULT id('co'),
  "changeOrderId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  -- reasonForChange = why; description = what. Both are rich-text JSON editors.
  "reasonForChange" JSON NOT NULL DEFAULT '{}',
  "description" JSON NOT NULL DEFAULT '{}',
  "type" "changeOrderTypeEnum" NOT NULL DEFAULT 'Engineering',
  "status" "changeOrderStatus" NOT NULL DEFAULT 'Draft',
  "priority" "nonConformancePriority",
  "changeOrderTypeId" TEXT,
  -- Optional link to the NCR that originated this change (navigable both ways;
  -- SET NULL so deleting the NCR doesn't cascade-delete the CO).
  "nonConformanceId" TEXT,
  "openDate" DATE NOT NULL,
  "dueDate" DATE,
  "requiredActionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "approvalRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sourceType" TEXT,
  "sourceId" TEXT,
  "assignee" TEXT,
  "customFields" JSONB,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrder_companyId_changeOrderId_key" UNIQUE ("companyId", "changeOrderId"),
  CONSTRAINT "changeOrder_changeOrderTypeId_fkey" FOREIGN KEY ("changeOrderTypeId") REFERENCES "changeOrderType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrder_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrder_companyId_idx" ON "changeOrder" ("companyId");
CREATE INDEX "changeOrder_changeOrderTypeId_idx" ON "changeOrder" ("changeOrderTypeId");
CREATE INDEX "changeOrder_nonConformanceId_idx" ON "changeOrder" ("nonConformanceId");
CREATE INDEX "changeOrder_status_idx" ON "changeOrder" ("status");
CREATE INDEX "changeOrder_assignee_idx" ON "changeOrder" ("assignee");

ALTER TABLE "changeOrder" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrder"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrder"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrder"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrder"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 4. makeMethod.changeOrderId — a Draft makeMethod with a non-null changeOrderId is
--    CO-owned and hidden from version-list/switcher/copy-target reads until release.
--    MRP/jobs/cost key off activeMakeMethods (non-Archived), so they're unaffected.
--    SET NULL so deleting the CO doesn't cascade-delete method history.
-- -----------------------------------------------------------------------------
ALTER TABLE "makeMethod" ADD COLUMN IF NOT EXISTS "changeOrderId" TEXT;
ALTER TABLE "makeMethod" ADD CONSTRAINT "makeMethod_changeOrderId_fkey"
  FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "makeMethod_changeOrderId_idx" ON "makeMethod" ("changeOrderId");

-- -----------------------------------------------------------------------------
-- 5. changeOrderAffectedItem — the parts the user selects to change. Per-item edits
--    live on a CO-owned Draft makeMethod (draftMakeMethodId), edited via the normal
--    BillOfMaterial/BillOfProcess/PartProperties editors and hidden until release.
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderAffectedItem" (
  "id" TEXT NOT NULL DEFAULT id('coai'),
  "changeOrderId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "changeType" "changeOrderChangeType" NOT NULL DEFAULT 'Version',
  -- The CO-owned Draft makeMethod this affected item edits (created on add).
  "draftMakeMethodId" TEXT,
  -- The Active method version the draft was copied from (merge base for the
  -- release diff). Nullable for a New Part with no source method.
  "baseMakeMethodId" TEXT,
  -- Per-item revision cutover config: the oldRev→newRev supersession is auto-written
  -- at release; the user only tunes mode + dates (empty successorEffectivityDate =
  -- effective immediately at release).
  "supersessionMode" "supersessionMode" NOT NULL DEFAULT 'Consume First',
  "discontinuationDate" DATE,
  "successorEffectivityDate" DATE,
  -- Release idempotency marker: the created revision's itemId, set at release.
  -- Non-null => this affected item is already applied; skip on re-run.
  "newItemId" TEXT,
  "changeSummary" JSONB,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderAffectedItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderAffectedItem_changeOrderId_itemId_key" UNIQUE ("changeOrderId", "itemId"),
  CONSTRAINT "changeOrderAffectedItem_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_newItemId_fkey" FOREIGN KEY ("newItemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_draftMakeMethodId_fkey" FOREIGN KEY ("draftMakeMethodId") REFERENCES "makeMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_baseMakeMethodId_fkey" FOREIGN KEY ("baseMakeMethodId") REFERENCES "makeMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderAffectedItem_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderAffectedItem_changeOrderId_idx" ON "changeOrderAffectedItem" ("changeOrderId");
CREATE INDEX "changeOrderAffectedItem_itemId_idx" ON "changeOrderAffectedItem" ("itemId");
CREATE INDEX "changeOrderAffectedItem_newItemId_idx" ON "changeOrderAffectedItem" ("newItemId");
CREATE INDEX "changeOrderAffectedItem_draftMakeMethodId_idx" ON "changeOrderAffectedItem" ("draftMakeMethodId");
CREATE INDEX "changeOrderAffectedItem_baseMakeMethodId_idx" ON "changeOrderAffectedItem" ("baseMakeMethodId");
CREATE INDEX "changeOrderAffectedItem_companyId_idx" ON "changeOrderAffectedItem" ("companyId");

ALTER TABLE "changeOrderAffectedItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderAffectedItem"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderAffectedItem"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderAffectedItem"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderAffectedItem"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 6. changeOrderSupersession — manual different-part obsolescence declarations
--    (NOT revision cutover, which is auto-generated from changeOrderAffectedItem).
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderSupersession" (
  "id" TEXT NOT NULL DEFAULT id('cosup'),
  "changeOrderId" TEXT NOT NULL,
  "predecessorItemId" TEXT NOT NULL,
  "successorItemId" TEXT,
  "supersessionMode" "supersessionMode" NOT NULL DEFAULT 'Consume First',
  "discontinuationDate" DATE,
  "successorEffectivityDate" DATE,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderSupersession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderSupersession_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_predecessorItemId_fkey" FOREIGN KEY ("predecessorItemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_successorItemId_fkey" FOREIGN KEY ("successorItemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderSupersession_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderSupersession_changeOrderId_idx" ON "changeOrderSupersession" ("changeOrderId");
CREATE INDEX "changeOrderSupersession_predecessorItemId_idx" ON "changeOrderSupersession" ("predecessorItemId");
CREATE INDEX "changeOrderSupersession_successorItemId_idx" ON "changeOrderSupersession" ("successorItemId");
CREATE INDEX "changeOrderSupersession_companyId_idx" ON "changeOrderSupersession" ("companyId");

ALTER TABLE "changeOrderSupersession" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderSupersession"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderSupersession"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderSupersession"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderSupersession"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 7. changeOrderActionTask — freeform, non-gating tasks (clones nonConformanceActionTask).
--    actionTypeId (template link) is added in the follow-up required-actions migration.
-- -----------------------------------------------------------------------------
CREATE TABLE "changeOrderActionTask" (
  "id" TEXT NOT NULL DEFAULT id('coat'),
  "changeOrderId" TEXT NOT NULL,
  "name" TEXT,
  "status" "changeOrderTaskStatus" NOT NULL DEFAULT 'Pending',
  "dueDate" DATE,
  "completedDate" DATE,
  "assignee" TEXT,
  "notes" JSON NOT NULL DEFAULT '{}',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "changeOrderActionTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "changeOrderActionTask_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderActionTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderActionTask_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderActionTask_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "changeOrderActionTask_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "changeOrderActionTask_changeOrderId_idx" ON "changeOrderActionTask" ("changeOrderId");
CREATE INDEX "changeOrderActionTask_assignee_idx" ON "changeOrderActionTask" ("assignee");
CREATE INDEX "changeOrderActionTask_status_idx" ON "changeOrderActionTask" ("status");

ALTER TABLE "changeOrderActionTask" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderActionTask"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderActionTask"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderActionTask"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderActionTask"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

-- -----------------------------------------------------------------------------
-- 8. Columns added to the existing item table.
--    revisionStatus  — lifecycle state of the revision.
--    changeOrderId   — revision→CO back-link, stamped at release on each newly-created
--                      revision item; powers the "Created by CO-…" chip and change
--                      history. SET NULL so deleting a CO doesn't cascade items.
-- -----------------------------------------------------------------------------
ALTER TABLE "item" ADD COLUMN "revisionStatus" "itemRevisionStatus" NOT NULL DEFAULT 'Design';
ALTER TABLE "item" ADD COLUMN "changeOrderId" TEXT;
ALTER TABLE "item" ADD CONSTRAINT "item_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "changeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "item_changeOrderId_idx" ON "item" ("changeOrderId");

-- -----------------------------------------------------------------------------
-- 9. companySettings.plmReleaseControl — how strictly release rules are enforced.
--    TEXT + CHECK is the convention for constrained string settings; existing RLS
--    on companySettings covers new columns automatically.
-- -----------------------------------------------------------------------------
ALTER TABLE "companySettings" ADD COLUMN "plmReleaseControl" TEXT NOT NULL DEFAULT 'enforce' CHECK ("plmReleaseControl" IN ('off', 'warn', 'enforce'));

-- -----------------------------------------------------------------------------
-- 10. Custom-fields registration (idempotent — the registry row survives a re-run
--     of this migration because it lives outside the CO-owned tables).
-- -----------------------------------------------------------------------------
INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('changeOrder', 'Change Order', 'Items')
ON CONFLICT ("table") DO NOTHING;

-- -----------------------------------------------------------------------------
-- 11. Sequence seed — change order readable id per company (ECO-000001, size 6).
-- -----------------------------------------------------------------------------
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'changeOrder', 'Change Order', 'ECO-', NULL, 0, 6, 1, "id"
FROM "company"
ON CONFLICT ("table", "companyId") DO NOTHING;

-- -----------------------------------------------------------------------------
-- 12. Realtime — the change-orders list uses useRealtime("changeOrder").
-- -----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE "changeOrder";

-- -----------------------------------------------------------------------------
-- 13. changeOrders view — powers the change-orders list. Rolls each CO's affected
--     items up into an "itemIds" text[] (so the list can filter by item through
--     the generic .overlaps() filter path) and an "affectedItems" jsonb array (so
--     a list row can be expanded to show its affected items without a 2nd query).
--     SECURITY_INVOKER so the underlying tables' RLS applies to the caller.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS "changeOrders";
CREATE OR REPLACE VIEW "changeOrders" WITH (SECURITY_INVOKER=true) AS
  SELECT
    co.*,
    COALESCE(ai."itemIds", ARRAY[]::text[]) AS "itemIds",
    COALESCE(ai."affectedItems", '[]'::jsonb) AS "affectedItems"
  FROM "changeOrder" co
  LEFT JOIN (
    SELECT
      "changeOrderId",
      array_agg(DISTINCT "itemId") AS "itemIds",
      jsonb_agg(
        jsonb_build_object(
          'id', "id",
          'itemId', "itemId",
          'changeType', "changeType",
          'newItemId', "newItemId"
        )
        ORDER BY "sortOrder", "createdAt"
      ) AS "affectedItems"
    FROM "changeOrderAffectedItem"
    GROUP BY "changeOrderId"
  ) ai ON ai."changeOrderId" = co."id";
