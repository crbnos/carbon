-- MRP Planning Actions (Phase 1)
-- Spec: .ai/specs/2026-08-22-mrp-v2-planned-order-generation.md §P1
-- Plan: .ai/plans/2026-09-08-mrp-planning-actions.md (Task 1)

-- Enums (idempotent)
DO $$ BEGIN
  CREATE TYPE "planningActionType" AS ENUM
    ('Order', 'Make', 'Expedite', 'Defer', 'Cancel', 'Increase', 'Decrease');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "planningActionStatus" AS ENUM ('Open', 'Dismissed', 'Actioned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The persisted planning action message: one row per suggested action, written
-- diff-write by MRP each run. Assignable, dismissible.
CREATE TABLE IF NOT EXISTS "planningAction" (
    "id" TEXT NOT NULL DEFAULT id('pla'),
    "companyId" TEXT NOT NULL,

    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "type" "planningActionType" NOT NULL,
    "status" "planningActionStatus" NOT NULL DEFAULT 'Open',

    "suggestedQuantity" NUMERIC NOT NULL,
    "suggestedDate" DATE NOT NULL,
    "isASAP" BOOLEAN NOT NULL DEFAULT false,

    -- Target of a CHANGE action (exactly one set; both NULL for Order/Make):
    "purchaseOrderLineId" TEXT,
    "jobId" TEXT,
    "requiresManualAction" BOOLEAN NOT NULL DEFAULT false,

    -- Suggestion attribution (the "why"):
    "supplierId" TEXT,
    "policyName" TEXT,
    "reason" TEXT,
    "triggerValues" JSONB,

    -- Assignment:
    "assignee" TEXT REFERENCES "user"("id"),
    "assigneeOverridden" BOOLEAN NOT NULL DEFAULT false,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "planningAction_change_target_chk" CHECK (
      ("type" IN ('Order','Make') AND "purchaseOrderLineId" IS NULL AND "jobId" IS NULL)
      OR ("type" NOT IN ('Order','Make') AND (("purchaseOrderLineId" IS NOT NULL)::int + ("jobId" IS NOT NULL)::int) = 1)
    )
);

CREATE INDEX IF NOT EXISTS "planningAction_companyId_idx" ON "planningAction" ("companyId");
CREATE INDEX IF NOT EXISTS "planningAction_assignee_idx"  ON "planningAction" ("companyId", "assignee");
CREATE INDEX IF NOT EXISTS "planningAction_item_loc_idx"  ON "planningAction" ("companyId", "itemId", "locationId");
CREATE INDEX IF NOT EXISTS "planningAction_status_idx"    ON "planningAction" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "planningAction_createdBy_idx" ON "planningAction" ("createdBy");

-- Deterministic regen identity (diff-write): one non-terminal action per
-- (item, location, type, period, target document)
CREATE UNIQUE INDEX IF NOT EXISTS "planningAction_natural_key_idx" ON "planningAction"
  ("companyId", "itemId", "locationId", "type", "periodId",
   (COALESCE("purchaseOrderLineId", "jobId", '')))
  WHERE "status" <> 'Actioned';

ALTER TABLE "public"."planningAction" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "SELECT" ON "public"."planningAction"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "INSERT" ON "public"."planningAction"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
    OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "UPDATE" ON "public"."planningAction"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
    OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "DELETE" ON "public"."planningAction"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
    OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Ownership ladder (tree: company default -> location -> location-specific item group -> item)
ALTER TABLE "itemPlanning"    ADD COLUMN IF NOT EXISTS "responsibleEmployee" TEXT REFERENCES "user"("id");
ALTER TABLE "location"        ADD COLUMN IF NOT EXISTS "responsibleEmployee" TEXT REFERENCES "user"("id");
ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS "defaultResponsibleEmployee" TEXT REFERENCES "user"("id");
ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS "rescheduleToleranceDays" INTEGER NOT NULL DEFAULT 7
  CHECK ("rescheduleToleranceDays" >= 0);

-- Composite-FK prerequisite: itemPostingGroup's PK is ("id") alone (parts.sql:69);
-- location already has UNIQUE ("id","companyId") via 20260905132037.
DO $$ BEGIN
  ALTER TABLE "itemPostingGroup"
    ADD CONSTRAINT "itemPostingGroup_id_companyId_key" UNIQUE ("id", "companyId");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- Location-specific item-group ownership (the "location > item group" tier).
-- Sparse: rows exist only for configured (location, group) cells.
CREATE TABLE IF NOT EXISTS "itemPostingGroupResponsibility" (
    "id" TEXT NOT NULL DEFAULT id('pgr'),
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "itemPostingGroupId" TEXT NOT NULL,
    "responsibleEmployee" TEXT REFERENCES "user"("id"),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "itemPostingGroupResponsibility_location_fkey"
      FOREIGN KEY ("locationId", "companyId") REFERENCES "location"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "itemPostingGroupResponsibility_group_fkey"
      FOREIGN KEY ("itemPostingGroupId", "companyId") REFERENCES "itemPostingGroup"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "itemPostingGroupResponsibility_unique" UNIQUE ("companyId", "locationId", "itemPostingGroupId")
);

CREATE INDEX IF NOT EXISTS "itemPostingGroupResponsibility_companyId_idx" ON "itemPostingGroupResponsibility" ("companyId");
CREATE INDEX IF NOT EXISTS "itemPostingGroupResponsibility_createdBy_idx" ON "itemPostingGroupResponsibility" ("createdBy");

ALTER TABLE "public"."itemPostingGroupResponsibility" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "SELECT" ON "public"."itemPostingGroupResponsibility"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "INSERT" ON "public"."itemPostingGroupResponsibility"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "UPDATE" ON "public"."itemPostingGroupResponsibility"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "DELETE" ON "public"."itemPostingGroupResponsibility"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
