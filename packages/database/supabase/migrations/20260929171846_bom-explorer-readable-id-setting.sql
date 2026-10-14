-- Per-company choice of the label on every BoM explorer node (item, quote and
-- job explorers share one row component). Default OFF keeps the description,
-- falling back to the item ID when a node has none; ON shows the item's
-- readableIdWithRevision instead. The hover preview shows both either way.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "showBomExplorerReadableId" BOOLEAN NOT NULL DEFAULT FALSE;
