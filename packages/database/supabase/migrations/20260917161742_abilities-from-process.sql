-- ============================================================================
-- Abilities are a process's qualification
-- ============================================================================
-- An ability is no longer a free-form, independently named record: it exists
-- only as the qualification for a process, and its name IS the process's name
-- (so renaming the process renames the ability). This migration:
--   1. deletes any ability with no process (it can't exist under the new model),
--   2. makes ability.processId NOT NULL + ON DELETE CASCADE (1:1 identity link),
--   3. drops ability.name (recreating the two views that read it so they source
--      the name from the linked process instead),
--   4. adds an "abilities" view exposing name from the process.

-- ── 1. Delete abilities not associated with a process ───────────────────────
-- An ability with no processId is a legacy free-form record; under the new model
-- it cannot exist, so it is removed. Deleting it CASCADEs its employeeAbility
-- qualifications and contractorAbility mappings, and NULLs any training.grantsAbilityId
-- that pointed at it (all by existing FK ON DELETE actions). Two references are
-- detached FIRST so the delete is neither destructive-by-cascade nor blocked:
--   * workCenter.requiredAbilityId is ON DELETE CASCADE — left alone, deleting the
--     ability would delete the work center. It is nullable, so null it instead.
--   * partner.abilityId is NOT NULL + NO ACTION — a partner on an orphan ability
--     would block the delete, and the mapping is meaningless once the ability is
--     gone, so those partner rows are removed.
UPDATE "workCenter" SET "requiredAbilityId" = NULL
  WHERE "requiredAbilityId" IN (SELECT "id" FROM "ability" WHERE "processId" IS NULL);

DELETE FROM "partner"
  WHERE "abilityId" IN (SELECT "id" FROM "ability" WHERE "processId" IS NULL);

DELETE FROM "ability" WHERE "processId" IS NULL;

-- ── 2. processId is now the identity link: NOT NULL + ON DELETE CASCADE ──────
ALTER TABLE "ability" ALTER COLUMN "processId" SET NOT NULL;
ALTER TABLE "ability" DROP CONSTRAINT IF EXISTS "ability_processId_fkey";
ALTER TABLE "ability"
  ADD CONSTRAINT "ability_processId_fkey"
  FOREIGN KEY ("processId") REFERENCES "process"("id") ON DELETE CASCADE;

-- ── 3. Recreate the views that read ability.name (source it from the process) ─
-- partners uses `p.*`, whose expansion froze when the view was first created;
-- CREATE OR REPLACE can't reconcile the wider current partner table, so DROP +
-- CREATE (the same pattern the capacity-planning migration used for workCenters).
DROP VIEW IF EXISTS "partners";
CREATE OR REPLACE VIEW "partners" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    p.id AS "supplierLocationId",
    ap.name AS "abilityName",
    s.id AS "supplierId",
    s.name AS "supplierName",
    a.city,
    -- address.state was renamed to stateProvince (20240928155702); the view's
    -- output column stays "state" so CREATE OR REPLACE keeps the same signature.
    a."stateProvince" AS "state"
  FROM "partner" p
    INNER JOIN "supplierLocation" sl
      ON sl.id = p.id
    INNER JOIN "supplier" s
      ON s.id = sl."supplierId"
    INNER JOIN "address" a
      ON a.id = sl."addressId"
    INNER JOIN "ability" a2
      ON a2.id = p."abilityId"
    INNER JOIN "process" ap
      ON ap.id = a2."processId"
  WHERE p."active" = true;

CREATE OR REPLACE VIEW "trainings" WITH(SECURITY_INVOKER=true) AS
  SELECT
    t1."id",
    t1."name",
    t1."description",
    t1."version",
    t1."status",
    t1."type",
    t1."frequency",
    t1."assignee",
    t1."estimatedDuration",
    t1."tags",
    t1."companyId",
    jsonb_agg(
      jsonb_build_object(
        'id', t2."id",
        'version', t2."version",
        'status', t2."status"
      )
    ) as "versions",
    t1."grantsAbilityId",
    ap."name" AS "grantsAbilityName"
  FROM "training" t1
  JOIN "training" t2 ON t1."name" = t2."name" AND t1."companyId" = t2."companyId"
  LEFT JOIN "ability" a ON a."id" = t1."grantsAbilityId"
  LEFT JOIN "process" ap ON ap."id" = a."processId"
  WHERE t1."version" = (
    SELECT MAX("version")
    FROM "training" t3
    WHERE t3."name" = t1."name"
    AND t3."companyId" = t1."companyId"
  )
  GROUP BY t1."id", t1."name", t1."description", t1."version", t1."status", t1."type",
           t1."frequency", t1."assignee", t1."estimatedDuration", t1."tags", t1."companyId",
           t1."grantsAbilityId", ap."name";

-- ── 4. Drop the stored name; the process is the source of truth now ─────────
ALTER TABLE "ability" DROP COLUMN IF EXISTS "name";

-- ── 5. The "abilities" view: ability columns + the live process name ────────
CREATE OR REPLACE VIEW "abilities" WITH(SECURITY_INVOKER=true) AS
  SELECT
    a.*,
    p."name" AS "name"
  FROM "ability" a
    INNER JOIN "process" p
      ON p."id" = a."processId" AND p."companyId" = a."companyId";
