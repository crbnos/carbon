-- Surface the cutting-process columns on the "processes" view.
--
-- The view is defined as `SELECT p.*, ...`, but Postgres expands the star at
-- CREATE time and freezes the column list. The cut-list foundation migration
-- added isCuttingProcess + the four saw defaults to "process" afterwards, so
-- the view never picked them up — which meant the Process form could not read
-- back what it had saved.
--
-- CREATE OR REPLACE cannot reorder columns (the new ones land before
-- workCenters/suppliers), so this drops and recreates. Nothing else in the
-- schema depends on this view — verified against pg_depend.
DROP VIEW IF EXISTS "processes";

CREATE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    wcp."workCenters",
    sp."suppliers"
  FROM "process" p
  LEFT JOIN (
    SELECT
      "processId",
      array_agg("workCenterId"::text) as "workCenters"
    FROM "workCenterProcess" wcp
    INNER JOIN "workCenter" wc ON wcp."workCenterId" = wc.id
    GROUP BY "processId"
  ) wcp ON p.id = wcp."processId"
  LEFT JOIN (
    SELECT
      "processId",
      jsonb_agg(jsonb_build_object('id', sp."id", 'name', s.name)) as "suppliers"
    FROM "supplierProcess" sp
    INNER JOIN "supplier" s ON sp."supplierId" = s.id
    GROUP BY "processId"
  ) sp ON p.id = sp."processId";
