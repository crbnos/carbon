-- Assembly step lineage: links a step to the step it was copied from when a new
-- instruction version is created. Mirrors the instruction-level
-- "rootInstructionId" idiom — NULL means "I am the root", so a step's lineage
-- group is COALESCE("rootStepId", "id") (same shape as
-- 20260730153412_assembly-instructions-view.sql).
--
-- ON DELETE SET NULL: deleting an OLD version must never delete the CURRENT
-- version's steps; an orphaned step simply becomes its own root.

BEGIN;

ALTER TABLE "assemblyInstructionStep"
  ADD COLUMN IF NOT EXISTS "rootStepId" TEXT
    REFERENCES "assemblyInstructionStep"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "assemblyInstructionStep_rootStepId_idx"
  ON "assemblyInstructionStep" ("rootStepId");

-- Backfill: repair job step markers stranded on a NON-CURRENT instruction
-- version by an activation that repointed the operation but not its steps.
-- rootStepId cannot exist retroactively, so match within the version group by
-- title first, then by sortOrder. Idempotent: the WHERE clause only selects
-- markers that disagree with their operation's instruction, so a second run
-- matches nothing.
WITH stranded AS (
  SELECT
    s."id"           AS "jobStepId",
    s."companyId"    AS "companyId",
    jo."assemblyInstructionId" AS "currentInstructionId",
    old."title"      AS "title",
    old."sortOrder"  AS "sortOrder"
  FROM "jobOperationStep" s
  JOIN "assemblyInstructionStep" old
    ON old."id" = s."assemblyInstructionStepId"
  JOIN "jobOperation" jo
    ON jo."id" = s."operationId"
  WHERE jo."assemblyInstructionId" IS NOT NULL
    AND old."assemblyInstructionId" <> jo."assemblyInstructionId"
),
-- Rank every plausible (stranded step -> new step) pairing, best match first.
-- Title equality is a strong PREFERENCE, not a join condition: renaming steps is
-- one of the main reasons to cut a new version, and gating on an exact title
-- would silently skip exactly those steps. sortOrder equality breaks the tie, so
-- a retitled step still matches by position.
--
-- Both directions are ranked because a single "best match" per job step is not
-- enough: two stranded steps sharing a title both resolved to the same new step,
-- and since planAssemblyStepMarkerSync builds its target map last-writer-wins,
-- the loser was silently dropped — never updated, never stale (its marker is
-- valid), left on the job forever as an invisible duplicate.
candidates AS (
  SELECT
    st."jobStepId",
    nw."id" AS "newStepId",
    ROW_NUMBER() OVER (
      PARTITION BY st."jobStepId"
      ORDER BY
        (nw."title" IS NOT DISTINCT FROM st."title") DESC,
        (nw."sortOrder" IS NOT DISTINCT FROM st."sortOrder") DESC,
        nw."sortOrder" ASC,
        nw."id" ASC
    ) AS "stepRank",
    ROW_NUMBER() OVER (
      PARTITION BY nw."id"
      ORDER BY
        (nw."title" IS NOT DISTINCT FROM st."title") DESC,
        (nw."sortOrder" IS NOT DISTINCT FROM st."sortOrder") DESC,
        st."sortOrder" ASC,
        st."jobStepId" ASC
    ) AS "claimRank"
  FROM stranded st
  JOIN "assemblyInstructionStep" nw
    ON nw."assemblyInstructionId" = st."currentInstructionId"
   AND nw."companyId" = st."companyId"
),
-- One new step is claimed by at most one job step, and vice versa. A pairing
-- that loses either race is left alone rather than guessed at — the operation's
-- "Sync Assembly Steps" finishes the repair.
matched AS (
  SELECT "jobStepId", "newStepId"
  FROM candidates
  WHERE "stepRank" = 1
    AND "claimRank" = 1
)
UPDATE "jobOperationStep" s
SET "assemblyInstructionStepId" = m."newStepId"
FROM matched m
WHERE s."id" = m."jobStepId";

COMMIT;
