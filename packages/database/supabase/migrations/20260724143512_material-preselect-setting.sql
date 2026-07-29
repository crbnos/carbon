-- Gate the no-picking-list FEFO pre-selection on the MES issue-material screen
-- behind an opt-in company setting (default OFF). When off, operators start on
-- the Scan tab and nothing is pre-selected unless a picking list already picked
-- the lots; when on, the FEFO suggestion seeds the rows and opens the Select tab.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "autoSelectMaterialWithoutPickingList" BOOLEAN NOT NULL DEFAULT FALSE;
