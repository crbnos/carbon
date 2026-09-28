-- Lot merge (inverse of Batch Split): net-zero ledger rows for combining
-- same-item tracked entities into one. Mirrors 'Batch Split'
-- (20250225145619_tracked-entities.sql, 20260504000000_cost-layers.sql).
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Batch Merge';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Batch Merge';
