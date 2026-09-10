-- Expose the granted ability on the `trainings` list view. `training.grantsAbilityId`
-- was added in 20260720121629_capacity-planning.sql but the view (created in
-- 20251205021915_training.sql) was never recreated to surface it, so the list
-- table couldn't show or filter by the ability a training grants.
--
-- New columns are appended after `versions` so CREATE OR REPLACE VIEW is valid.

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
    a."name" AS "grantsAbilityName"
  FROM "training" t1
  JOIN "training" t2 ON t1."name" = t2."name" AND t1."companyId" = t2."companyId"
  LEFT JOIN "ability" a ON a."id" = t1."grantsAbilityId"
  WHERE t1."version" = (
    SELECT MAX("version")
    FROM "training" t3
    WHERE t3."name" = t1."name"
    AND t3."companyId" = t1."companyId"
  )
  GROUP BY t1."id", t1."name", t1."description", t1."version", t1."status", t1."type",
           t1."frequency", t1."assignee", t1."estimatedDuration", t1."tags", t1."companyId",
           t1."grantsAbilityId", a."name";
