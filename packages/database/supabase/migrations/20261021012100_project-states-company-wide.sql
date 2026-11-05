-- Project states and labels become company-wide (Settings → Projects): one set
-- per company, shared by every project, instead of a copy per project.
--
-- 1. Duplicates across projects merge by (companyId, name). The oldest row is
--    kept; it takes the colour (and, for a state, the group) most of the
--    duplicates have, and the smallest sort order.
-- 2. Every reference moves to the kept row: projectElement."stateId",
--    projectElementLabel, and the state ids inside baseline snapshots and
--    change request rows.
-- 3. "projectId" is dropped from both tables. A name is unique per company,
--    and each state group has at most one default per company.
-- 4. A company with no states gets the six defaults (`projectStates` in
--    `@carbon/database/seed-data`); new companies get them from seed-company.

-- ---------------------------------------------------------------------------
-- The merge maps: every duplicate id → the id that is kept.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE "stateMerge" ON COMMIT DROP AS
SELECT s."id", s."companyId", s."name",
  first_value(s."id") OVER (
    PARTITION BY s."companyId", s."name"
    ORDER BY s."createdAt", s."id"
  ) AS "keepId"
FROM "projectState" s;

CREATE TEMP TABLE "labelMerge" ON COMMIT DROP AS
SELECT l."id", l."companyId", l."name",
  first_value(l."id") OVER (
    PARTITION BY l."companyId", l."name"
    ORDER BY l."createdAt", l."id"
  ) AS "keepId"
FROM "projectLabel" l;

-- ---------------------------------------------------------------------------
-- Constraints that tie a state or a label to its project go first, so a
-- reference can move to a kept row of another project.
-- ---------------------------------------------------------------------------

ALTER TABLE "projectElement" DROP CONSTRAINT IF EXISTS "projectElement_state_fkey";
DROP INDEX IF EXISTS "projectElement_stateId_idx";

ALTER TABLE "projectState" DROP CONSTRAINT IF EXISTS "projectState_project_key";
ALTER TABLE "projectState" DROP CONSTRAINT IF EXISTS "projectState_name_key";
ALTER TABLE "projectState" DROP CONSTRAINT IF EXISTS "projectState_project_fkey";
DROP INDEX IF EXISTS "projectState_default_key";
DROP INDEX IF EXISTS "projectState_projectId_idx";

ALTER TABLE "projectLabel" DROP CONSTRAINT IF EXISTS "projectLabel_project_key";
ALTER TABLE "projectLabel" DROP CONSTRAINT IF EXISTS "projectLabel_name_key";
ALTER TABLE "projectLabel" DROP CONSTRAINT IF EXISTS "projectLabel_project_fkey";
DROP INDEX IF EXISTS "projectLabel_projectId_idx";

-- ---------------------------------------------------------------------------
-- States: the kept row's attributes, then every reference, then the merge.
-- ---------------------------------------------------------------------------

WITH colours AS (
  SELECT DISTINCT ON (m."keepId") m."keepId", s."color"
  FROM "stateMerge" m
  JOIN "projectState" s ON s."id" = m."id" AND s."companyId" = m."companyId"
  GROUP BY m."keepId", s."color"
  ORDER BY m."keepId", count(*) DESC, s."color"
), groups AS (
  SELECT DISTINCT ON (m."keepId") m."keepId", s."group"
  FROM "stateMerge" m
  JOIN "projectState" s ON s."id" = m."id" AND s."companyId" = m."companyId"
  GROUP BY m."keepId", s."group"
  ORDER BY m."keepId", count(*) DESC, s."group"
), orders AS (
  SELECT m."keepId", min(s."sortOrder") AS "sortOrder"
  FROM "stateMerge" m
  JOIN "projectState" s ON s."id" = m."id" AND s."companyId" = m."companyId"
  GROUP BY m."keepId"
)
UPDATE "projectState" s
SET "color" = colours."color",
  "group" = groups."group",
  "sortOrder" = orders."sortOrder"
FROM colours, groups, orders
WHERE s."id" = colours."keepId"
  AND groups."keepId" = colours."keepId"
  AND orders."keepId" = colours."keepId";

-- One default per group per company: the kept state that was a default in
-- the most projects, then the first by sort order.
CREATE TEMP TABLE "stateDefault" ON COMMIT DROP AS
WITH votes AS (
  SELECT m."keepId", count(*) FILTER (WHERE s."isDefault") AS "votes"
  FROM "stateMerge" m
  JOIN "projectState" s ON s."id" = m."id" AND s."companyId" = m."companyId"
  GROUP BY m."keepId"
)
SELECT DISTINCT ON (k."companyId", k."group") k."id"
FROM "projectState" k
JOIN votes v ON v."keepId" = k."id"
ORDER BY k."companyId", k."group", v."votes" DESC, k."sortOrder", k."id";

UPDATE "projectElement" e
SET "stateId" = m."keepId"
FROM "stateMerge" m
WHERE e."stateId" = m."id"
  AND e."companyId" = m."companyId"
  AND m."id" <> m."keepId";

-- A baseline snapshot keeps its elements under "elements"; each carries the
-- state id it had when the baseline was taken.
UPDATE "projectBaseline" b
SET "snapshot" = jsonb_set(
  b."snapshot",
  '{elements}',
  (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN m."keepId" IS NOT NULL
          THEN el || jsonb_build_object('stateId', m."keepId")
        ELSE el
      END
      ORDER BY ord
    ), '[]'::jsonb)
    FROM jsonb_array_elements(b."snapshot" -> 'elements') WITH ORDINALITY AS t(el, ord)
    LEFT JOIN "stateMerge" m
      ON m."id" = el ->> 'stateId'
      AND m."companyId" = b."companyId"
      AND m."id" <> m."keepId"
  )
)
WHERE jsonb_typeof(b."snapshot" -> 'elements') = 'array';

UPDATE "projectChangeRequestItem" i
SET "payload" = i."payload" || jsonb_build_object('stateId', m."keepId")
FROM "stateMerge" m
WHERE i."targetTable" = 'projectElement'
  AND i."payload" ->> 'stateId' = m."id"
  AND m."companyId" = i."companyId"
  AND m."id" <> m."keepId";

UPDATE "projectChangeRequestItem" i
SET "baseRow" = i."baseRow" || jsonb_build_object('stateId', m."keepId")
FROM "stateMerge" m
WHERE i."targetTable" = 'projectElement'
  AND i."baseRow" ->> 'stateId' = m."id"
  AND m."companyId" = i."companyId"
  AND m."id" <> m."keepId";

DELETE FROM "projectState" s
USING "stateMerge" m
WHERE s."id" = m."id"
  AND s."companyId" = m."companyId"
  AND m."id" <> m."keepId";

UPDATE "projectState" s
SET "isDefault" = EXISTS (SELECT 1 FROM "stateDefault" d WHERE d."id" = s."id");

-- ---------------------------------------------------------------------------
-- Labels: the kept row's colour, every element's labels, then the merge.
-- ---------------------------------------------------------------------------

WITH colours AS (
  SELECT DISTINCT ON (m."keepId") m."keepId", l."color"
  FROM "labelMerge" m
  JOIN "projectLabel" l ON l."id" = m."id" AND l."companyId" = m."companyId"
  GROUP BY m."keepId", l."color"
  ORDER BY m."keepId", count(*) DESC, l."color"
), orders AS (
  SELECT m."keepId", min(l."sortOrder") AS "sortOrder"
  FROM "labelMerge" m
  JOIN "projectLabel" l ON l."id" = m."id" AND l."companyId" = m."companyId"
  GROUP BY m."keepId"
)
UPDATE "projectLabel" l
SET "color" = colours."color",
  "sortOrder" = orders."sortOrder"
FROM colours, orders
WHERE l."id" = colours."keepId"
  AND orders."keepId" = colours."keepId";

-- An element with two labels that merge keeps one link.
INSERT INTO "projectElementLabel" ("projectElementId", "projectLabelId", "companyId", "createdBy", "createdAt")
SELECT el."projectElementId", m."keepId", el."companyId", el."createdBy", el."createdAt"
FROM "projectElementLabel" el
JOIN "labelMerge" m ON m."id" = el."projectLabelId" AND m."companyId" = el."companyId"
WHERE m."id" <> m."keepId"
ON CONFLICT ("projectElementId", "projectLabelId", "companyId") DO NOTHING;

-- Deleting a merged label takes its old element links with it (cascade).
DELETE FROM "projectLabel" l
USING "labelMerge" m
WHERE l."id" = m."id"
  AND l."companyId" = m."companyId"
  AND m."id" <> m."keepId";

-- ---------------------------------------------------------------------------
-- The company-wide shape.
-- ---------------------------------------------------------------------------

-- The project-scoped policies read "projectId"; the authz manifest's
-- company-wide rules replace them (authz sync, and the generated migration).
DROP POLICY IF EXISTS "SELECT" ON "public"."projectState";
DROP POLICY IF EXISTS "INSERT" ON "public"."projectState";
DROP POLICY IF EXISTS "UPDATE" ON "public"."projectState";
DROP POLICY IF EXISTS "DELETE" ON "public"."projectState";
DROP POLICY IF EXISTS "SELECT" ON "public"."projectLabel";
DROP POLICY IF EXISTS "INSERT" ON "public"."projectLabel";
DROP POLICY IF EXISTS "UPDATE" ON "public"."projectLabel";
DROP POLICY IF EXISTS "DELETE" ON "public"."projectLabel";

ALTER TABLE "projectState" DROP COLUMN "projectId";
ALTER TABLE "projectLabel" DROP COLUMN "projectId";

ALTER TABLE "projectState"
  ADD CONSTRAINT "projectState_name_key" UNIQUE ("companyId", "name");
-- One default state per group per company.
CREATE UNIQUE INDEX "projectState_default_key"
  ON "projectState" ("companyId", "group") WHERE "isDefault";

ALTER TABLE "projectLabel"
  ADD CONSTRAINT "projectLabel_name_key" UNIQUE ("companyId", "name");

ALTER TABLE "projectElement"
  ADD CONSTRAINT "projectElement_state_fkey"
  FOREIGN KEY ("stateId", "companyId") REFERENCES "projectState"("id", "companyId");
CREATE INDEX "projectElement_stateId_idx" ON "projectElement" ("stateId", "companyId");

-- ---------------------------------------------------------------------------
-- Every company has the six default states.
-- ---------------------------------------------------------------------------

INSERT INTO "projectState" ("companyId", "name", "group", "color", "sortOrder", "isDefault", "createdBy")
SELECT c."id", s.name, s.grp::"projectStateGroup", s.color, s.sort, s.is_default, 'system'
FROM "company" c
CROSS JOIN (VALUES
  ('Backlog', 'Backlog', '#60646C', 1, TRUE),
  ('Todo', 'Unstarted', '#60646C', 2, TRUE),
  ('In Progress', 'Started', '#F59E0B', 3, TRUE),
  ('In Review', 'Started', '#3B82F6', 4, FALSE),
  ('Done', 'Completed', '#46A758', 5, TRUE),
  ('Cancelled', 'Cancelled', '#9AA4BC', 6, TRUE)
) AS s(name, grp, color, sort, is_default)
WHERE NOT EXISTS (
  SELECT 1 FROM "projectState" ps WHERE ps."companyId" = c."id"
);
