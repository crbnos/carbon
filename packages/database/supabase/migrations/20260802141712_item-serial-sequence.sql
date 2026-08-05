-- Per-item serial-number sequence: an optional, at-most-one configurable format +
-- counter per item (mirrors the document "sequence" table, but keyed to an item).
-- When a job is created for the item, the assign-serial-numbers edge function reserves
-- the next N values and stamps them onto the job's tracked entities' readableId.
--
-- Format tokens (interpolated at generation time): %{yyyy} %{yy} %{mm} %{dd} %{ww}
-- (ISO week) and %{location} (location.code, falling back to location.name).
CREATE TABLE IF NOT EXISTS "itemSerialSequence" (
  "id" TEXT NOT NULL DEFAULT id('iss'),
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,

  "prefix" TEXT,
  "suffix" TEXT,
  "next" INTEGER NOT NULL DEFAULT 0,
  "size" INTEGER NOT NULL DEFAULT 5,
  "step" INTEGER NOT NULL DEFAULT 1,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "itemSerialSequence_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "itemSerialSequence_next_check" CHECK ("next" >= 0),
  CONSTRAINT "itemSerialSequence_size_check" CHECK ("size" >= 1),
  CONSTRAINT "itemSerialSequence_step_check" CHECK ("step" >= 1),
  CONSTRAINT "itemSerialSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "itemSerialSequence_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- One serial sequence per item (the "can't add two for the same item" rule).
  CONSTRAINT "itemSerialSequence_itemId_companyId_key" UNIQUE ("itemId", "companyId")
);

CREATE INDEX IF NOT EXISTS "itemSerialSequence_companyId_idx" ON "itemSerialSequence" ("companyId");
CREATE INDEX IF NOT EXISTS "itemSerialSequence_itemId_idx" ON "itemSerialSequence" ("itemId");
CREATE INDEX IF NOT EXISTS "itemSerialSequence_createdBy_idx" ON "itemSerialSequence" ("createdBy");

ALTER TABLE "public"."itemSerialSequence" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."itemSerialSequence";
CREATE POLICY "SELECT" ON "public"."itemSerialSequence"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."itemSerialSequence";
CREATE POLICY "INSERT" ON "public"."itemSerialSequence"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_create'))::text[])
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."itemSerialSequence";
CREATE POLICY "UPDATE" ON "public"."itemSerialSequence"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

DROP POLICY IF EXISTS "DELETE" ON "public"."itemSerialSequence";
CREATE POLICY "DELETE" ON "public"."itemSerialSequence"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_delete'))::text[])
);

-- List view: joins the item so the settings table can show/search the part.
CREATE OR REPLACE VIEW "itemSerialSequences" WITH(SECURITY_INVOKER=true) AS
SELECT
  iss.*,
  i."readableIdWithRevision" AS "itemReadableId",
  i."name" AS "itemName",
  i."itemTrackingType"
FROM "itemSerialSequence" iss
INNER JOIN "item" i ON i."id" = iss."itemId";
