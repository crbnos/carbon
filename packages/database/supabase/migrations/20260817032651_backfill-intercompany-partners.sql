-- Backfill intercompany supplier/customer partner rows that were silently
-- dropped at seed time.
--
-- `sync_intercompany_partners` (20260403120000) inserts a supplier + customer
-- row in each company for every sibling in its group, WITHOUT a readableId,
-- using ON CONFLICT DO NOTHING. seed-company set the subsidiary's companyGroupId
-- (which fires that trigger) BEFORE it seeded the company's `sequence` rows, so
-- `set_{supplier,customer}_readable_id_on_insert` (20260521124731) — which only
-- stamps an id when the sequence row already exists — left readableId ''. Because
-- `supplier_readableId_companyId_unique` / `customer_readableId_companyId_unique`
-- treat '' as a real value, only the FIRST sibling's partner row survived; every
-- later sibling collided on (companyId, '') and was swallowed. A company created
-- into a group of 3+ therefore saw only one sibling as an intercompany partner.
--
-- seed-company now sets companyGroupId AFTER seeding sequences, so new companies
-- are provisioned correctly. This migration repairs already-seeded groups.
-- Idempotent: blank-id backfill only touches rows still missing an id, and the
-- inserts are guarded by NOT EXISTS + ON CONFLICT DO NOTHING.

-- 1. Give the surviving intercompany rows a real readableId (frees the '' slot
--    so step 2's inserts can't recreate the collision, and stops them rendering
--    blank in the UI). Only where the company actually has the sequence.
UPDATE "supplier"
SET "readableId" = get_next_sequence('supplier', "companyId")
WHERE "intercompanyCompanyId" IS NOT NULL
  AND ("readableId" IS NULL OR "readableId" = '')
  AND EXISTS (
    SELECT 1 FROM "sequence" s
    WHERE s."table" = 'supplier' AND s."companyId" = "supplier"."companyId"
  );

UPDATE "customer"
SET "readableId" = get_next_sequence('customer', "companyId")
WHERE "intercompanyCompanyId" IS NOT NULL
  AND ("readableId" IS NULL OR "readableId" = '')
  AND EXISTS (
    SELECT 1 FROM "sequence" s
    WHERE s."table" = 'customer' AND s."companyId" = "customer"."companyId"
  );

-- 2. Insert the missing partner rows for every active, non-elimination company
--    pair within a group. The BEFORE INSERT readableId triggers stamp a real id
--    per row (sequences now exist), so no two siblings collide on (companyId, '').
INSERT INTO "supplier" ("name", "companyId", "intercompanyCompanyId")
SELECT partner."name", own."id", partner."id"
FROM "company" own
JOIN "company" partner
  ON partner."companyGroupId" = own."companyGroupId"
 AND partner."id" <> own."id"
 AND partner."isEliminationEntity" = false
 AND partner."active" = true
WHERE own."isEliminationEntity" = false
  AND own."active" = true
  AND own."companyGroupId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "supplier" s
    WHERE s."companyId" = own."id" AND s."intercompanyCompanyId" = partner."id"
  )
ON CONFLICT DO NOTHING;

INSERT INTO "customer" ("name", "companyId", "intercompanyCompanyId")
SELECT partner."name", own."id", partner."id"
FROM "company" own
JOIN "company" partner
  ON partner."companyGroupId" = own."companyGroupId"
 AND partner."id" <> own."id"
 AND partner."isEliminationEntity" = false
 AND partner."active" = true
WHERE own."isEliminationEntity" = false
  AND own."active" = true
  AND own."companyGroupId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "customer" c
    WHERE c."companyId" = own."id" AND c."intercompanyCompanyId" = partner."id"
  )
ON CONFLICT DO NOTHING;
