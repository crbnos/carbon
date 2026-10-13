-- A service is identified by its name: its readable id IS its name, and the app
-- keeps the two in step (upsertService, updateServiceName, the CSV import).
-- Bring existing services into line.
--
-- A service is left as it is when its name cannot safely become its id:
--   * the name is blank,
--   * its revisions disagree on the name,
--   * another service in the company has the same name,
--   * the name is already a service's id in the company (including a service
--     row orphaned by a hard-deleted item).
-- Those keep their old id and are renamed the next time their name is edited.

CREATE TEMP TABLE "_serviceRename" AS
WITH "candidate" AS (
  SELECT
    "companyId",
    "readableId" AS "oldId",
    MIN(btrim("name")) AS "newId"
  FROM "item"
  WHERE "type" = 'Service'
  GROUP BY "companyId", "readableId"
  HAVING COUNT(DISTINCT btrim("name")) = 1
)
SELECT c."companyId", c."oldId", c."newId"
FROM "candidate" c
WHERE c."newId" <> ''
  AND c."newId" <> c."oldId"
  AND NOT EXISTS (
    SELECT 1 FROM "candidate" o
    WHERE o."companyId" = c."companyId"
      AND o."newId" = c."newId"
      AND o."oldId" <> c."oldId"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "item" i
    WHERE i."companyId" = c."companyId"
      AND i."type" = 'Service'
      AND i."readableId" = c."newId"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "service" s
    WHERE s."companyId" = c."companyId"
      AND s."id" = c."newId"
  );

-- "serviceSupplier" follows through its ON UPDATE CASCADE foreign key.
UPDATE "service" s
SET "id" = r."newId"
FROM "_serviceRename" r
WHERE s."companyId" = r."companyId"
  AND s."id" = r."oldId";

UPDATE "item" i
SET "readableId" = r."newId", "name" = r."newId"
FROM "_serviceRename" r
WHERE i."companyId" = r."companyId"
  AND i."type" = 'Service'
  AND i."readableId" = r."oldId";

DROP TABLE "_serviceRename";
