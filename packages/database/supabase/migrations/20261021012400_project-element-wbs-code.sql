-- A project element's pinned WBS code (Phase A of
-- .ai/specs/2026-10-12-wbs-interop-and-contract-financing.md). Null means the
-- code is derived from the element's position in the tree (`computeWbsCodes`).
ALTER TABLE "projectElement" ADD COLUMN IF NOT EXISTS "wbsCode" TEXT;

DO $wbs$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projectElement_wbsCode_check') THEN
    ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_wbsCode_check"
      CHECK ("wbsCode" ~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$');
  END IF;
END $wbs$;

CREATE UNIQUE INDEX IF NOT EXISTS "projectElement_wbsCode_key"
  ON "projectElement" ("projectId", "companyId", "wbsCode")
  WHERE "wbsCode" IS NOT NULL;
