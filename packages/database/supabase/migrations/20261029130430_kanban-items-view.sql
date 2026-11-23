-- The Kanbans list is one row per item at a location, with the item's kanbans
-- in the expanded row (as the Inspection Plans list is one row per part).

DROP VIEW IF EXISTS "kanbanItems";
CREATE VIEW "kanbanItems" WITH (SECURITY_INVOKER=true) AS
  SELECT
    -- The list reads one location at a time, so the item names the row.
    k."itemId" AS "id",
    k."itemId",
    k."locationId",
    k."companyId",
    k."name",
    k."readableIdWithRevision",
    k."thumbnailPath",
    COUNT(*)::INTEGER AS "kanbanCount",
    -- The search reads the kanbans' numbers too.
    string_agg(k."kanbanId", ' ') AS "kanbanIds",
    array_agg(DISTINCT k."replenishmentSystem") AS "replenishmentSystems",
    array_remove(array_agg(DISTINCT k."supplierId"), NULL) AS "supplierIds",
    jsonb_agg(
      jsonb_build_object(
        'id', k."id",
        'kanbanId', k."kanbanId",
        'replenishmentSystem', k."replenishmentSystem",
        'quantity', k."quantity",
        'purchaseUnitOfMeasureCode', k."purchaseUnitOfMeasureCode",
        'replenishmentLevel', k."replenishmentLevel",
        'storageUnitName', k."storageUnitName",
        'fromStorageUnitName', k."fromStorageUnitName",
        'supplierId', k."supplierId",
        'jobId', k."jobId",
        'jobReadableId', k."jobReadableId"
      )
      ORDER BY k."kanbanId" NULLS LAST, k."id"
    ) AS "kanbans",
    MIN(k."createdAt") AS "createdAt",
    MAX(COALESCE(k."updatedAt", k."createdAt")) AS "updatedAt"
  FROM "kanbans" k
  GROUP BY
    k."itemId",
    k."locationId",
    k."companyId",
    k."name",
    k."readableIdWithRevision",
    k."thumbnailPath";

-- Saved views of the Kanbans list keep working: a filter on a kanban's
-- replenishment or supplier becomes the item row's array filter, and a filter
-- or sort on a column the item row does not have is dropped.
UPDATE "tableView"
SET
  "filters" = CASE WHEN "filters" IS NULL THEN NULL ELSE ARRAY(
    SELECT CASE split_part(f, ':', 1)
      WHEN 'replenishmentSystem'
        THEN 'replenishmentSystems:contains:' || regexp_replace(f, '^[^:]*:[^:]*:', '')
      WHEN 'supplierId'
        THEN 'supplierIds:contains:' || regexp_replace(f, '^[^:]*:[^:]*:', '')
      ELSE f
    END
    FROM unnest("filters") WITH ORDINALITY AS t(f, n)
    WHERE split_part(f, ':', 1) IN (
      'itemId', 'name', 'readableIdWithRevision', 'createdAt', 'updatedAt',
      'replenishmentSystem', 'supplierId'
    )
    ORDER BY n
  ) END,
  "sorts" = CASE WHEN "sorts" IS NULL THEN NULL ELSE ARRAY(
    SELECT s
    FROM unnest("sorts") WITH ORDINALITY AS t(s, n)
    WHERE split_part(s, ':', 1) IN (
      'itemId', 'name', 'readableIdWithRevision', 'createdAt', 'updatedAt'
    )
    ORDER BY n
  ) END
WHERE "table" = 'kanban';
