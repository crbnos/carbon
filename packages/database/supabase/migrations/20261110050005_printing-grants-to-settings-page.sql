-- Printing has no pages of its own: its tables (printerRoute, printJob) belong
-- to the Settings page Printing since the page-keys migration. A grant on the
-- Printing module becomes a grant on that page, at the same level, so nobody
-- who prints today loses it.

-- A subject that already holds the page keeps its own row.
DELETE FROM "permission" p
WHERE p."module" = 'Printing'
  AND EXISTS (
    SELECT 1 FROM "permission" s
    WHERE s."companyId" = p."companyId"
      AND s."employeeTypeId" IS NOT DISTINCT FROM p."employeeTypeId"
      AND s."userId" IS NOT DISTINCT FROM p."userId"
      AND s."apiKeyId" IS NOT DISTINCT FROM p."apiKeyId"
      AND s."module" = 'Settings'
      AND s."page" = 'settings.printing'
  );

UPDATE "permission"
SET "module" = 'Settings', "page" = 'settings.printing'
WHERE "module" = 'Printing';
