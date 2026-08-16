-- Job-level self-consumption guard: a job can never list its own output item
-- as a material.
--
-- Companion to 20260812030545 (the same guard on methodMaterial). 50 jobMaterial
-- rows across ~20 tenants had jm."itemId" = job."itemId" — a job requiring its
-- own output to be picked or purchased before it can produce it. Most were
-- added directly on jobs, not copied from the (now guarded) BOMs, so the job
-- table needs its own gate.

-- ---------------------------------------------------------------------------
-- 1. Cleanup.
--
--    Deleting a material line cascades jobMaterial -> jobMakeMethod ->
--    jobOperation, and SIX tables cascade off jobOperation: productionEvent
--    (labor/time), jobOperationTool, jobOperationStep, jobOperationParameter,
--    rework and nonConformanceJobOperation. Only productionQuantity is
--    NO ACTION — i.e. it raises — so it is the ONLY one a failed delete would
--    reveal; the rest disappear silently.
--
--    So the rule here is not "detach what would error", it is "never let the
--    cascade reach an operation at all": detach every subtree containing ANY
--    jobOperation. Detached methods stay on the job as root-level methods with
--    their operations, labor and production intact. Only genuinely empty
--    method copies are allowed to cascade away.
--
--    Verified against the prod snapshot: 0 itemLedger / pickingListLine
--    references to any of the self-consuming lines.
-- ---------------------------------------------------------------------------

WITH RECURSIVE bad AS (
  SELECT jm.id, jm."companyId"
  FROM "jobMaterial" jm
  JOIN job j ON j.id = jm."jobId" AND j."companyId" = jm."companyId"
  WHERE jm."itemId" = j."itemId"
),
subtree AS (
  SELECT b.id AS bad_id, m.id AS method_id, b."companyId"
  FROM bad b
  JOIN "jobMakeMethod" m
    ON m."parentMaterialId" = b.id AND m."companyId" = b."companyId"
  UNION
  SELECT s.bad_id, m2.id, s."companyId"
  FROM subtree s
  JOIN "jobMaterial" jm2
    ON jm2."jobMakeMethodId" = s.method_id AND jm2."companyId" = s."companyId"
  JOIN "jobMakeMethod" m2
    ON m2."parentMaterialId" = jm2.id AND m2."companyId" = jm2."companyId"
),
dirty AS (
  SELECT DISTINCT s.bad_id
  FROM subtree s
  JOIN "jobOperation" jo
    ON jo."jobMakeMethodId" = s.method_id AND jo."companyId" = s."companyId"
)
UPDATE "jobMakeMethod" m
SET "parentMaterialId" = NULL
WHERE m."parentMaterialId" IN (SELECT bad_id FROM dirty);

DELETE FROM "jobMaterial" jm
USING job j
WHERE j.id = jm."jobId"
  AND j."companyId" = jm."companyId"
  AND jm."itemId" = j."itemId";

-- ---------------------------------------------------------------------------
-- 2. Sync interceptor: veto on write, every path (UI, MES, API, Kysely).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_check_job_material_self_reference(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
-- Pinned: runs on every write to this table, so the caller is an ordinary
-- application role and must not control name resolution.
SET search_path = public, pg_temp
AS $$
DECLARE
  job_item_id TEXT;
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN RETURN; END IF;

  SELECT "itemId" INTO job_item_id
  FROM job
  WHERE "id" = p_new->>'jobId'
    AND "companyId" = p_new->>'companyId';

  IF job_item_id = p_new->>'itemId' THEN
    RAISE EXCEPTION 'A job cannot consume the item it produces as a material'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- jobMaterial is already event-wired (20260410031810); re-attach with the
-- check PREPENDED to the existing interceptor lists so nothing is clobbered.
SELECT attach_event_trigger(
  'jobMaterial',
  ARRAY[
    'sync_check_job_material_self_reference',
    'sync_update_job_material_make_method_item_id'
  ]::TEXT[],
  ARRAY['sync_insert_job_material_make_method']::TEXT[]
);
