-- A Fixed Price service job bills one plain invoice line with no item, so the
-- job no longer names an item to bill. The column's foreign key and index go
-- with it.
-- Spec: .ai/specs/2026-10-31-service-labor-rates-and-time-posting.md

ALTER TABLE "serviceJob" DROP COLUMN IF EXISTS "serviceItemId";
