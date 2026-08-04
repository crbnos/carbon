-- Collapse assembly instruction versions to one row per version group for the
-- list, mirroring the "procedures" view. A group is identified by its root
-- pointer COALESCE("rootInstructionId", "id"); the row surfaced is the highest
-- "version" in the group, and every sibling version is rolled into a "versions"
-- jsonb array ({id, version, status}) the table's hover card renders. Grouping
-- by ai1."id" is safe because it is the table's primary key (every selected
-- ai1 column is functionally dependent on it).

DROP VIEW IF EXISTS "assemblyInstructions";
CREATE OR REPLACE VIEW "assemblyInstructions" WITH(SECURITY_INVOKER=true) AS
  SELECT
    ai1."id",
    ai1."name",
    ai1."modelUploadId",
    ai1."itemId",
    ai1."assemblyPlanJobId",
    ai1."status",
    ai1."version",
    ai1."publishedAt",
    ai1."settings",
    ai1."rootInstructionId",
    ai1."companyId",
    ai1."customFields",
    ai1."tags",
    ai1."createdBy",
    ai1."createdAt",
    ai1."updatedBy",
    ai1."updatedAt",
    jsonb_agg(
      jsonb_build_object(
        'id', ai2."id",
        'version', ai2."version",
        'status', ai2."status"
      )
      ORDER BY ai2."version"
    ) AS "versions"
  FROM "assemblyInstruction" ai1
  JOIN "assemblyInstruction" ai2
    ON COALESCE(ai2."rootInstructionId", ai2."id")
     = COALESCE(ai1."rootInstructionId", ai1."id")
   AND ai2."companyId" = ai1."companyId"
  WHERE ai1."version" = (
    SELECT MAX(ai3."version")
    FROM "assemblyInstruction" ai3
    WHERE COALESCE(ai3."rootInstructionId", ai3."id")
        = COALESCE(ai1."rootInstructionId", ai1."id")
      AND ai3."companyId" = ai1."companyId"
  )
  GROUP BY ai1."id";
