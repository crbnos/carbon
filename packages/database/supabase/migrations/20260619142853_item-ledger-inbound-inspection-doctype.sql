-- Add an 'Inbound Inspection' document type to itemLedgerDocumentType so that
-- rejecting an inbound inspection lot for a non-tracked (Inventory) item can
-- post a Negative Adjmt. ledger entry that reverses the received quantity.
-- Tracked items already drop out of on-hand via trackedEntity status, but
-- non-tracked items have no per-row status to flip, so they need a compensating
-- ledger row instead.
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Inbound Inspection';
