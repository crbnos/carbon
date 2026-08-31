-- Per-process batch compatibility rules (spec: .ai/specs/2026-08-21-job-operation-batching.md).
-- Sparse JSONB: keys equal to their resolved default are omitted; an all-default
-- config is written as NULL. NULL reproduces today's behavior byte-for-byte
-- (substance/grade/dimension guide the suggestion signature; form/finish/item ignored).
-- Shape: { item?, substance?, grade?, dimension?, form?, finish?: "must"|"guide"|"ignore" }
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchRules" JSONB;

COMMENT ON COLUMN "process"."batchRules" IS 'Per-dimension batch compatibility levels (must|guide|ignore); NULL = defaults (substance/grade/dimension guide, form/finish/item ignore).';

-- Re-declare the "processes" view so p.* picks up "batchRules".
-- Forked verbatim from 20260821024449_job-operation-batching.sql.
DROP VIEW IF EXISTS "processes";
CREATE OR REPLACE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
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
