-- Inventory adjustments and inventory counts now post GL journals
-- (spec: .ai/specs/2026-07-14-inventory-adjustment-gl-posting.md).
-- journalEntrySourceType already contains 'Inventory Adjustment' (20260402000000).
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Inventory Adjustment';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Inventory Count';
