-- A tax-ledger row records whether its tax was self-assessed.
--
-- The Tax Liability report found self-assessed tax by joining the row's live
-- tax code (`calculationType = 'Reverse Charge'`). Editing or deleting the
-- code after posting changed past figures, but the ledger is a snapshot of
-- what was posted. The posting now writes the flag on the row.

ALTER TABLE "taxLedger"
  ADD COLUMN IF NOT EXISTS "selfAssessed" BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: every purchase row posted so far under a Reverse Charge code. A
-- code deleted since posting leaves its rows false; nothing records it.
UPDATE "taxLedger" tl
SET "selfAssessed" = TRUE
FROM "taxCode" tc
WHERE tc."id" = tl."taxCodeId"
  AND tc."companyId" = tl."companyId"
  AND tc."calculationType" = 'Reverse Charge'
  AND tl."source" = 'Purchase'
  AND tl."selfAssessed" = FALSE;
