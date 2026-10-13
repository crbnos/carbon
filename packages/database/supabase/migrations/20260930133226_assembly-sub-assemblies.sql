-- Sub-assemblies replace "Build off to the side".
--   isSubAssembly = the row is a sub-assembly (header). It can exist before any
--                   step is moved into it.
--   parentStepId  = the sub-assembly this step belongs to (was: a later JOIN step).
--   usedInStepId  = on a header: the step that fits the finished sub-assembly.
--                   NULL = nothing uses it, so it joins the main build at the header.
-- Rows stay in play order: a sub-assembly's steps sit directly before its header.
-- ON DELETE SET NULL: deleting the using step leaves the sub-assembly joining the
-- main build; deleting a header returns its steps to the top level.
BEGIN;

ALTER TABLE "assemblyInstructionStep"
  ADD COLUMN IF NOT EXISTS "usedInStepId" TEXT
    REFERENCES "assemblyInstructionStep"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "isSubAssembly" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "assemblyInstructionStep_usedInStepId_idx"
  ON "assemblyInstructionStep" ("usedInStepId");

-- A sub-assembly installs nothing itself: its parts come from its steps. Header
-- rows are never copied into job steps, so a part on one would never reach the floor.
ALTER TABLE "assemblyInstructionStep"
  DROP CONSTRAINT IF EXISTS "assemblyInstructionStep_subAssembly_no_parts";
ALTER TABLE "assemblyInstructionStep"
  ADD CONSTRAINT "assemblyInstructionStep_subAssembly_no_parts"
  CHECK (NOT "isSubAssembly" OR cardinality("componentNodeIds") = 0);

-- Convert build-aside data: every join step's staged steps become one
-- sub-assembly used at that join step, placed where the last staged step was.
CREATE TEMP TABLE "_subAssemblyJoin" ON COMMIT DROP AS
SELECT
  j."id"                    AS "joinId",
  j."assemblyInstructionId" AS "assemblyInstructionId",
  j."companyId"             AS "companyId",
  j."createdBy"             AS "createdBy",
  xid()                     AS "headerId",
  MAX(s."sortOrder")        AS "lastStaged"
FROM "assemblyInstructionStep" s
JOIN "assemblyInstructionStep" j ON j."id" = s."parentStepId"
GROUP BY j."id", j."assemblyInstructionId", j."companyId", j."createdBy";

INSERT INTO "assemblyInstructionStep"
  ("id", "assemblyInstructionId", "companyId", "title", "sortOrder",
   "usedInStepId", "isSubAssembly", "componentNodeIds", "planConfidence", "createdBy")
SELECT "headerId", "assemblyInstructionId", "companyId", NULL, "lastStaged",
       "joinId", true, '{}', 'manual', "createdBy"
FROM "_subAssemblyJoin";

UPDATE "assemblyInstructionStep" s
SET "parentStepId" = jn."headerId"
FROM "_subAssemblyJoin" jn
WHERE s."parentStepId" = jn."joinId";

-- Renumber affected instructions so each sub-assembly's steps sit directly
-- before its header (play order).
WITH keyed AS (
  SELECT
    s."id",
    s."assemblyInstructionId",
    COALESCE(m."lastStaged", h."lastStaged", s."sortOrder") AS k1,
    CASE WHEN h."headerId" IS NOT NULL THEN 1 ELSE 0 END      AS k2,
    s."sortOrder"                                             AS k3
  FROM "assemblyInstructionStep" s
  LEFT JOIN "_subAssemblyJoin" m ON m."headerId" = s."parentStepId"
  LEFT JOIN "_subAssemblyJoin" h ON h."headerId" = s."id"
  WHERE s."assemblyInstructionId" IN (SELECT "assemblyInstructionId" FROM "_subAssemblyJoin")
),
numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "assemblyInstructionId" ORDER BY k1, k2, k3) AS rn
  FROM keyed
)
UPDATE "assemblyInstructionStep" s
SET "sortOrder" = n.rn
FROM numbered n
WHERE s."id" = n."id";

COMMIT;
