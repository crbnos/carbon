-- A Lease line on a purchase invoice names a lease, not an item, account or asset:
-- the posting resolves its account from the lease (liability, operating or variable
-- lease expense). `purchaseInvoiceLine_lease_check` already ties the type to
-- "leaseId"; this lets the line-type check accept it.
ALTER TABLE "purchaseInvoiceLine" DROP CONSTRAINT IF EXISTS "invoiceLineType_check";
ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "invoiceLineType_check"
  CHECK (
    (
      "invoiceLineType" = 'Comment' AND
      "itemId" IS NULL AND
      "accountId" IS NULL AND
      "assetId" IS NULL AND
      "description" IS NOT NULL
    )
    OR (
      "invoiceLineType" = 'G/L Account' AND
      "itemId" IS NULL AND
      "accountId" IS NOT NULL AND
      "assetId" IS NULL
    )
    OR (
      (
        "invoiceLineType" = 'Part' OR
        "invoiceLineType" = 'Material' OR
        "invoiceLineType" = 'Tool' OR
        "invoiceLineType" = 'Consumable' OR
        "invoiceLineType" = 'Fixture' OR
        "invoiceLineType" = 'Service'
      ) AND
      "itemId" IS NOT NULL AND
      "accountId" IS NULL AND
      "assetId" IS NULL
    )
    OR (
      "invoiceLineType" = 'Fixed Asset' AND
      "itemId" IS NULL AND
      "accountId" IS NULL AND
      "assetId" IS NOT NULL
    )
    OR (
      "invoiceLineType" = 'Lease' AND
      "itemId" IS NULL AND
      "accountId" IS NULL AND
      "assetId" IS NULL
    )
  );
