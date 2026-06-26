-- Flattened, company-wide view over the itemLedger stock-movement table.
-- Backs the aggregated "Stock Movements" list page (every item, all locations),
-- exposing joined item/location/storage-unit names as flat columns so the generic
-- search/sort/filter helpers work the same way they do for `kanbans` /
-- `stockTransferLines`. security_invoker => inherits itemLedger RLS
-- (SELECT requires inventory_view / accounting_view).
CREATE OR REPLACE VIEW "itemLedgers" WITH (security_invoker = true) AS
SELECT
  il.*,
  i."readableIdWithRevision" AS "itemReadableId",
  i."name"                   AS "itemDescription",
  i."type"                   AS "itemType",
  l."name"                   AS "locationName",
  su."name"                  AS "storageUnitName",
  te."readableId"            AS "trackedEntityReadableId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL
      THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END                        AS "thumbnailPath"
FROM "itemLedger" il
INNER JOIN "item" i ON i."id" = il."itemId" AND i."companyId" = il."companyId"
LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
LEFT JOIN "location" l ON l."id" = il."locationId"
LEFT JOIN "storageUnit" su ON su."id" = il."storageUnitId"
LEFT JOIN "trackedEntity" te ON te."id" = il."trackedEntityId";

-- Matches the default "newest first" sort exactly (company-scoped, createdAt then
-- the monotonic entryNumber as a unique tiebreaker) so the page can be served by an
-- index scan + limit, then nested-loop joined only for the returned rows. The
-- entryNumber tiebreaker also keeps offset pagination stable when createdAt ties.
CREATE INDEX IF NOT EXISTS "itemLedger_companyId_createdAt_entryNumber_idx"
  ON "itemLedger" ("companyId", "createdAt" DESC, "entryNumber" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'itemLedger'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "itemLedger";
  END IF;
END $$;