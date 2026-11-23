-- Backfill for Projects Phase 1a: identifiers and states for existing projects, the
-- "Project Element" dimension, and the project account defaults for existing companies.
-- Spec: .ai/specs/2026-10-03-projects.md

-- 1. Identifiers for existing projects: initials of the name, capitals, made unique per company.
CREATE OR REPLACE FUNCTION derive_project_identifier(p_name TEXT, p_company_id TEXT)
RETURNS TEXT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  n INTEGER := 1;
BEGIN
  base := upper(regexp_replace(
    COALESCE((SELECT string_agg(left(w, 1), '') FROM regexp_split_to_table(p_name, '\s+') AS w WHERE w <> ''), ''),
    '[^A-Za-z0-9]', '', 'g'));
  IF base !~ '^[A-Z]' THEN base := 'P' || base; END IF;
  IF length(base) < 2 THEN base := rpad(base, 2, 'X'); END IF;
  base := left(base, 4);
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM "project" WHERE "companyId" = p_company_id AND "identifier" = candidate) LOOP
    n := n + 1;
    candidate := left(base, 6 - length(n::TEXT)) || n::TEXT;
  END LOOP;
  RETURN candidate;
END;
$$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT "id", "companyId", "name" FROM "project" WHERE "identifier" IS NULL ORDER BY "createdAt" LOOP
    UPDATE "project" SET "identifier" = derive_project_identifier(r."name", r."companyId")
    WHERE "id" = r."id" AND "companyId" = r."companyId";
  END LOOP;
END $$;

-- 2. Seeded states for every existing project.
INSERT INTO "projectState" ("projectId", "companyId", "name", "group", "color", "sortOrder", "isDefault", "createdBy")
SELECT p."id", p."companyId", s.name, s.grp::"projectStateGroup", s.color, s.sort, s.is_default, 'system'
FROM "project" p
CROSS JOIN (VALUES
  ('Backlog', 'Backlog', '#60646C', 1, TRUE),
  ('Todo', 'Unstarted', '#60646C', 2, TRUE),
  ('In Progress', 'Started', '#F59E0B', 3, TRUE),
  ('In Review', 'Started', '#3B82F6', 4, FALSE),
  ('Done', 'Completed', '#46A758', 5, TRUE),
  ('Cancelled', 'Cancelled', '#9AA4BC', 6, TRUE)
) AS s(name, grp, color, sort, is_default)
ON CONFLICT ("projectId", "name", "companyId") DO NOTHING;

-- 3. The "Project Element" dimension for every company group.
INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT 'Project Element', 'ProjectElement'::"dimensionEntityType", cg."id", 'system'
FROM "companyGroup" cg
ON CONFLICT ("name", "companyGroupId") WHERE "active" = true DO NOTHING;

-- 4. Account defaults: Project WIP = the WIP account; Project Expense = account 7080 when it exists.
UPDATE "accountDefault" ad
SET "projectWorkInProgressAccount" = ad."workInProgressAccount"
WHERE ad."projectWorkInProgressAccount" IS NULL;

UPDATE "accountDefault" ad
SET "projectExpenseAccount" = a."id"
FROM "company" c
JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a."number" = '7080' AND a."isGroup" = FALSE
WHERE c."id" = ad."companyId" AND ad."projectExpenseAccount" IS NULL;
