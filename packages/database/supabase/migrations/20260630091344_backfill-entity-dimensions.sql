-- Backfill default entity-backed dimensions for every existing company group.
-- Idempotent: the dimension (name, companyGroupId) unique constraint plus
-- ON CONFLICT DO NOTHING guarantees we never insert a duplicate, so this is
-- safe to (re)run and safe alongside the new-company seed.
--
-- Covers the three new dimensions (Customer, Supplier, Item) and also the
-- WorkCenter / Process / FixedAssetClass dimensions, which were added to the
-- new-company seed (functions/lib/seed.data.ts) but were never backfilled to
-- company groups that predate them. Names mirror seed.data.ts exactly.
INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT d."name", d."entityType"::"dimensionEntityType", cg."id", 'system'
FROM "companyGroup" cg
CROSS JOIN (
  VALUES
    ('Customer', 'Customer'),
    ('Supplier', 'Supplier'),
    ('Item', 'Item'),
    ('Work Center', 'WorkCenter'),
    ('Process', 'Process'),
    ('Asset Class', 'FixedAssetClass')
) AS d("name", "entityType")
-- The unique constraint on (name, companyGroupId) was replaced by a PARTIAL
-- unique index `WHERE active = true` in 20260524143827_fixed-assets.sql, so the
-- conflict target must repeat that predicate to match (matches the sibling
-- backfills in that migration). Inserted rows default active = true.
ON CONFLICT ("name", "companyGroupId") WHERE "active" = true DO NOTHING;
