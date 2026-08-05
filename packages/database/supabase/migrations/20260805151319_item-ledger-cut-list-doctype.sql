-- Ledger document type for cut list confirmation postings.
--
-- Its own migration on purpose: ALTER TYPE ... ADD VALUE cannot be used by
-- other statements in the same transaction, so the value has to land before
-- anything references it.
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Cut List Consumption';
