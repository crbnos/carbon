-- Drop the unique constraint since we'll handle this via trigger
ALTER TABLE "contact" 
DROP CONSTRAINT IF EXISTS "contact_email_companyId_unique";

ALTER TABLE "contact" ADD COLUMN "isCustomer" BOOLEAN NOT NULL DEFAULT TRUE;

-- Update existing supplier contacts to have isCustomer = FALSE
UPDATE "contact" c
SET "isCustomer" = FALSE 
FROM "supplierContact" sc
WHERE c.id = sc."contactId";

ALTER TABLE "contact" ADD CONSTRAINT "contact_email_companyId_unique" UNIQUE ("email", "companyId", "isCustomer");
