-- invariant: a lot with no quantity left is Consumed, never a live status
-- returns rows that VIOLATE the rule (none = healthy)
--
-- The drain rule (functions/shared/entity-drain.ts `settleQuantity` /
-- `statusAfterQuantityChange`): a tracked entity whose quantity rounds to zero
-- is Consumed, not a zero-quantity husk that still reads Available and clutters
-- every on-hand list. `Scrapped` and `Rejected` are deliberately EXCLUDED — both
-- are quality markers kept as historical record and are already excluded from
-- on-hand, so a zero-quantity Scrapped/Rejected lot is expected, not a defect.
--
-- Enforcement today is per-writer, so this finds husks from ANY source: rows
-- that predate the drain rule, and any writer that revives a drained lot to a
-- live status (unconsume, shipment void, disposition Use As Is / Rework).
-- `createdAt` and `attributes` tell you which flow minted each one.
SELECT
  "id",
  "companyId",
  "itemId",
  "readableId",
  "quantity",
  "status",
  "sourceDocument",
  "sourceDocumentId",
  "createdAt",
  "attributes"
FROM "trackedEntity"
WHERE "quantity" <= 0
  AND "status" NOT IN ('Consumed', 'Scrapped', 'Rejected')
ORDER BY "createdAt" DESC;
