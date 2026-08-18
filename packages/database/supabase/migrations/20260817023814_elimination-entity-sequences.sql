-- Elimination entities are auto-created as bare company shells in seed-company
-- (isEliminationEntity = true) with no reference data — in particular no
-- `sequence` rows. generateEliminationEntries posts an elimination journal on
-- that entity and stamps journalEntryId from
--   get_next_sequence('journalEntry', <elim>)
-- which raised P0001 "Sequence not found for table journalEntry and company
-- <elim>" the moment the earlier RLS / accounting-period fixes let execution
-- reach it.
--
-- Backfill the missing sequences for every existing elimination entity by
-- copying its parent company's sequences (a real, fully-seeded company), with
-- `next` reset to 0 so the entity starts its own counters. seed-company is fixed
-- in the same change to seed these going forward. Idempotent: ON CONFLICT on the
-- ("table", "companyId") primary key means re-running over already-seeded
-- entities is a no-op, and any sequence a parent lacks is simply skipped.

INSERT INTO "sequence" (
  "table", "name", "prefix", "suffix", "next", "size", "step", "companyId"
)
SELECT
  s."table", s."name", s."prefix", s."suffix", 0, s."size", s."step", elim."id"
FROM "company" elim
JOIN "sequence" s ON s."companyId" = elim."parentCompanyId"
WHERE elim."isEliminationEntity" = true
  AND elim."parentCompanyId" IS NOT NULL
ON CONFLICT ("table", "companyId") DO NOTHING;
