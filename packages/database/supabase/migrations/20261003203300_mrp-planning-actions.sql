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

    -- The two dates the planning grids read off a stored action:
    --   horizonDate     — the date that decides whether the action is inside a
    --                     planning horizon (time fence): the earlier of the target
    --                     order's current date and the suggested date, so a Defer
    --                     counts from where the order sits today and an Expedite
    --                     from when it is needed.
    --   latestOrderDate — Order / Make / Increase only: the required date less the
    --                     item's lead time, i.e. the last day to place the order.
    "horizonDate" DATE NOT NULL,
    "latestOrderDate" DATE,

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
    -- ON DELETE CASCADE throughout: a planning action is regenerable MRP output —
    -- when its item, location, period or target disappears, the suggestion is
    -- meaningless and must never block the delete or linger until the next run.
    -- All five referenced tables have single-column ("id") primary keys.
    CONSTRAINT "planningAction_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
    CONSTRAINT "planningAction_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
    CONSTRAINT "planningAction_periodId_fkey"
      FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE CASCADE,
    CONSTRAINT "planningAction_purchaseOrderLineId_fkey"
      FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchaseOrderLine"("id") ON DELETE CASCADE,
    CONSTRAINT "planningAction_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE,
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

-- Foreign-key indexes, for cascade deletes: a job / purchaseOrderLine delete
-- scans these columns. The two nullable targets are partial.
CREATE INDEX IF NOT EXISTS "planningAction_jobId_idx"
  ON "planningAction" ("jobId") WHERE "jobId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "planningAction_purchaseOrderLineId_idx"
  ON "planningAction" ("purchaseOrderLineId") WHERE "purchaseOrderLineId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "planningAction_itemId_idx"
  ON "planningAction" ("itemId");
CREATE INDEX IF NOT EXISTS "planningAction_periodId_idx"
  ON "planningAction" ("periodId");
CREATE INDEX IF NOT EXISTS "planningAction_locationId_idx"
  ON "planningAction" ("locationId");

-- Deterministic regen identity (diff-write): one non-terminal action per
-- (item, location, type, period, target document)
CREATE UNIQUE INDEX IF NOT EXISTS "planningAction_natural_key_idx" ON "planningAction"
  ("companyId", "itemId", "locationId", "type", "periodId",
   (COALESCE("purchaseOrderLineId", "jobId", '')))
  WHERE "status" <> 'Actioned';

-- RLS policies live in packages/database/src/authz/manifest.ts (`planningAction`)
-- and ship through the generated authz migration.
ALTER TABLE "public"."planningAction" ENABLE ROW LEVEL SECURITY;

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

-- RLS policies live in packages/database/src/authz/manifest.ts
-- (`itemPostingGroupResponsibility`) and ship through the generated authz migration.
ALTER TABLE "public"."itemPostingGroupResponsibility" ENABLE ROW LEVEL SECURITY;
