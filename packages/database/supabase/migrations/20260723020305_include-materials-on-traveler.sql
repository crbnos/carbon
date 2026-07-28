-- Opt-in company setting: render a materials (BOM) section on the job traveler PDF.
-- Default false preserves the current traveler behavior (no materials shown).
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "includeMaterialsOnTraveler" BOOLEAN NOT NULL DEFAULT false;
