ALTER TABLE "quote" DROP CONSTRAINT IF EXISTS "quote_customerContactId_fkey",
ADD CONSTRAINT "quote_customerContactId_fkey" 
FOREIGN KEY ("customerContactId") 
REFERENCES "contact"(id) 
ON DELETE SET NULL;

ALTER TABLE "salesOrder" DROP CONSTRAINT IF EXISTS "salesOrder_customerContactId_fkey",
ADD CONSTRAINT "salesOrder_customerContactId_fkey" 
FOREIGN KEY ("customerContactId") 
REFERENCES "contact"(id) 
ON DELETE SET NULL;

ALTER TABLE "purchaseOrder" DROP CONSTRAINT IF EXISTS "purchaseOrder_supplierContactId_fkey",
ADD CONSTRAINT "purchaseOrder_supplierContactId_fkey" 
FOREIGN KEY ("supplierContactId") 
REFERENCES "contact"(id) 
ON DELETE SET NULL;


WITH
  duplicates AS (
    SELECT
      email,
      "companyId",
      COUNT(*) AS count
    FROM
      "contact"
    GROUP BY
      email,
      "companyId"
    HAVING
      COUNT(*) > 1
  )
DELETE FROM "contact"
WHERE
  (email, "companyId") IN (
    SELECT
      email,
      "companyId"
    FROM
      duplicates
  );

-- Now, add the unique constraint
ALTER TABLE "contact"
ADD CONSTRAINT "contact_email_companyId_unique" UNIQUE ("email", "companyId");