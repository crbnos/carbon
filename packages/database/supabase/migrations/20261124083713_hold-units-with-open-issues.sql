-- A serial unit with an open issue linked to it is on hold in the MES when the
-- company turns this on: work that needs the unit open is refused until the
-- issue is closed. Derived from the issue's status; no status is stored.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "holdUnitsWithOpenIssues" BOOLEAN NOT NULL DEFAULT false;
