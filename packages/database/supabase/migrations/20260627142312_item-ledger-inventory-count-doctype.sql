-- Add a 'Inventory Count' document type to itemLedgerDocumentType so cycle-count
-- adjustments are distinguishable from receipts / sales / transfers in ledger history.
-- ALTER TYPE ... ADD VALUE must live in its own migration (cannot be used in the same
-- transaction that adds it), so the value is added here ahead of the tables that use it.
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Inventory Count';
