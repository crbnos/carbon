-- Add a short abbreviation ("code") to locations, used as the [Site] segment of
-- configurable serial numbers (falls back to the location name when null).
-- Nullable; no view depends on SELECT * over "location" so no view recreate is needed.
ALTER TABLE "location" ADD COLUMN IF NOT EXISTS "code" TEXT;

-- Backfill the seeded default location. Idempotent: only fills a still-null code.
UPDATE "location"
SET "code" = 'HQ'
WHERE "name" = 'Headquarters' AND "code" IS NULL;
