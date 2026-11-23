-- "Require email on contacts" is a company setting: one for supplier contacts,
-- one for customer contacts.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "requireSupplierContactEmail" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requireCustomerContactEmail" BOOLEAN NOT NULL DEFAULT false;
