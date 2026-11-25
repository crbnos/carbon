-- Manual: Carbon never creates invoices for the agreement on its own. A
-- person bills its periods with Invoice (spec 2026-11-25-rentals-and-documents).
-- Only a rental agreement takes it; the app refuses it for the company
-- setting and for contracts.
ALTER TYPE "invoiceAutomation" ADD VALUE IF NOT EXISTS 'Manual' BEFORE 'Draft Only';
