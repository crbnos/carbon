-- Backfill the default "Scrap Reason" entity-backed dimension for every existing
-- company group. Dimensions are user-configured per company group, but the scrap
-- flow expects a ScrapReason dimension to exist so scrap postings get tagged (and
-- so the reason is selectable on journal lines). New-company seeding covers this
-- via functions/lib/seed.data.ts; this migration covers pre-existing groups.
--
-- Idempotent: the partial unique index on (name, companyGroupId) WHERE active = true
-- plus ON CONFLICT DO NOTHING guarantees no duplicate, so this is safe to (re)run.
-- Name mirrors seed.data.ts exactly ("Scrap Reason"). Inserted rows default active = true.
--
-- 'ScrapReason' was added to the "dimensionEntityType" enum in a prior migration
-- (20260807090400_scrap-unscrap-enums.sql), so it is safe to reference here.
INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT 'Scrap Reason', 'ScrapReason'::"dimensionEntityType", cg."id", 'system'
FROM "companyGroup" cg
ON CONFLICT ("name", "companyGroupId") WHERE "active" = true DO NOTHING;
