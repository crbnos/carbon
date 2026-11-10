ALTER TABLE "company"
  ADD COLUMN IF NOT EXISTS "dimensions" JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS "company_dimensions_idx"
  ON "company" USING GIN ("dimensions");
