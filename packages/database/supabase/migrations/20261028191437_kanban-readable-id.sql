-- A readable number for each kanban (KB000001), printed on its label, so a
-- particular card or bin can be found and brought into or out of service.

-- 1. The column. Nullable: a restore loads rows with triggers off, and a
-- backup taken before this migration has no number to load.
SET lock_timeout = '5s';
ALTER TABLE "kanban" ADD COLUMN IF NOT EXISTS "kanbanId" TEXT;
RESET lock_timeout;

COMMENT ON COLUMN "kanban"."kanbanId" IS
  'Readable number from the company''s "kanban" sequence (KB000001), printed on the label. Assigned on insert by set_kanban_readable_id and never changed. Not the stockTransfer."kanbanId" foreign key, which holds kanban.id.';

-- 2. The sequence for every existing company. New companies get it from
-- seed-data.ts.
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId", "updatedBy")
SELECT 'kanban', 'Kanban', 'KB', NULL, 0, 6, 1, c."id", 'system'
FROM "company" c
ON CONFLICT ("table", "companyId") DO NOTHING;

-- 3. Number the existing kanbans of each company in the order they were made.
-- get_next_sequence formats the number and moves the counter, so the counter
-- ends past the last number given out.
DO $backfill$
DECLARE
  k RECORD;
BEGIN
  FOR k IN
    SELECT "id", "companyId"
    FROM "kanban"
    WHERE "kanbanId" IS NULL
    ORDER BY "companyId", "createdAt", "id"
  LOOP
    UPDATE "kanban"
    SET "kanbanId" = get_next_sequence('kanban', k."companyId")
    WHERE "id" = k."id"
      AND "companyId" = k."companyId";
  END LOOP;
END;
$backfill$;

SET lock_timeout = '5s';
CREATE UNIQUE INDEX IF NOT EXISTS "kanban_kanbanId_companyId_key"
  ON "kanban" ("companyId", "kanbanId");
RESET lock_timeout;

-- 4. Every insert takes the next number: the kanban form, the API, the demo
-- datasets and test fixtures all insert without one. A company missing its
-- sequence row gets one, so a kanban is never left unnumbered.
CREATE OR REPLACE FUNCTION set_kanban_readable_id_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."kanbanId" IS NULL OR NEW."kanbanId" = '' THEN
    INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId", "updatedBy")
    VALUES ('kanban', 'Kanban', 'KB', NULL, 0, 6, 1, NEW."companyId", 'system')
    ON CONFLICT ("table", "companyId") DO NOTHING;

    NEW."kanbanId" := get_next_sequence('kanban', NEW."companyId");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS set_kanban_readable_id ON "kanban";
CREATE TRIGGER set_kanban_readable_id
  BEFORE INSERT ON "kanban"
  FOR EACH ROW
  EXECUTE PROCEDURE set_kanban_readable_id_on_insert();

-- 5. The kanbans view expands k.* at creation, so recreate it to expose the
-- new column. Unchanged from 20261012232517_kanban-replenishment-level.sql.
DROP VIEW IF EXISTS "kanbans";
CREATE VIEW "kanbans" WITH(SECURITY_INVOKER=true) AS
SELECT
  k.*,
  i.name,
  i."readableIdWithRevision",
  j."jobId" as "jobReadableId",
  l.name as "locationName",
  s.name as "storageUnitName",
  fs.name as "fromStorageUnitName",
  su.name as "supplierName",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath"
FROM "kanban" k
JOIN "item" i ON k."itemId" = i."id"
LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
JOIN "location" l ON k."locationId" = l."id"
LEFT JOIN "storageUnit" s ON k."storageUnitId" = s."id"
LEFT JOIN "storageUnit" fs ON k."fromStorageUnitId" = fs."id"
LEFT JOIN "supplier" su ON k."supplierId" = su."id"
LEFT JOIN "job" j ON k."jobId" = j."id";
