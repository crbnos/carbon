-- Require a reachable contact on a supplier / customer before its documents post.
--
-- A spend platform cannot create a vendor without a contact EMAIL — Ramp rejects
-- both a create with no `business_vendor_contacts` and one whose contact carries
-- no email (`DEVELOPER_7001 "Missing data for required field"`, verified live
-- 2026-09-26). A supplier with no reachable contact therefore has every bill
-- rejected at push time, long after the person who could fix it has moved on.
--
-- The requirement is on the PARTY, not the document: the platform needs one
-- contact per supplier, once, and that is the record the vendor is built from.
-- Enforcement happens at the document boundary, where the user has the context
-- to answer it.
--
-- Both default FALSE. The sales column exists for symmetry with the purchasing
-- one — `companySettings` already pairs `accountsPayable*`/`accountsReceivable*`
-- and `defaultSupplierCc`/`defaultCustomerCc` — and because a customer-side
-- requirement is a reasonable policy to want. Nothing downstream forces it today:
-- Rillet, Xero and QuickBooks all treat a customer email as optional. So it ships
-- off, and stays off until someone asks for it.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "requireSupplierContact" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "requireCustomerContact" BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN "companySettings"."requireSupplierContact" IS
  'When true, a supplier must have at least one contact with an email address before its purchase orders, supplier quotes and purchase invoices can be released or posted.';

COMMENT ON COLUMN "companySettings"."requireCustomerContact" IS
  'When true, a customer must have at least one contact with an email address before its quotes, sales orders and sales invoices can be released or posted.';
