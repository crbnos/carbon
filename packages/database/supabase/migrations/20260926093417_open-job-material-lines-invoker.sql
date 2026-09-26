-- openJobMaterialLines runs as the caller again.
--
-- A view without security_invoker runs as its owner, so the RLS on the tables
-- underneath never sees the querying role. Every view in "public" is a
-- PostgREST endpoint, reachable with the anon key the apps publish, so this
-- view served every company's open job material lines to anyone
-- (reported by two independent researchers against production).
--
-- The clause was added in 20250616011758, dropped in 20250616131548, restored
-- by the RLS audit (20250716061055), then dropped by omission in
-- 20260321143847, 20260417000300, 20260811123619 and 20260908211552 — each
-- recreated the view from a copy that lacked it. The no-view-without-invoker
-- check in @carbon/checks now fails a CREATE VIEW that does not state
-- security_invoker, and the view-without-security-invoker invariant checks the
-- live catalog.
--
-- The joins now also match on companyId, so the view is tenant-consistent on
-- its own and the joins can use the ("id", "companyId") primary keys. Rows are
-- unchanged: a job, make method or item always shares its material's company.

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
    jm."quantity" AS "quantityPerParent"
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
