-- Backfill the default "Project" entity-backed dimension for every existing company
-- group. Dimensions are user-configured per company group, but slice 2 of the Projects
-- feature expects a Project dimension to exist so a project is selectable on journal
-- lines. New-company seeding covers this via functions/lib/seed.data.ts; this migration
-- covers pre-existing groups.
--
-- Idempotent: the partial unique index on (name, companyGroupId) WHERE active = true plus
-- ON CONFLICT DO NOTHING guarantees no duplicate, so this is safe to (re)run. Name mirrors
-- seed.data.ts exactly ("Project"). Inserted rows default active = true.
--
-- 'Project' was added to the "dimensionEntityType" enum in a prior migration
-- (20260911180928_accounting-project-dimension-enum.sql), so it is safe to reference here.
INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT 'Project', 'Project'::"dimensionEntityType", cg."id", 'system'
FROM "companyGroup" cg
ON CONFLICT ("name", "companyGroupId") WHERE "active" = true DO NOTHING;
