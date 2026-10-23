-- A reimbursement line or a supplier invoice line pays at most one service job
-- charge. `chargeCost` checks it before the write; these indexes hold it when
-- two saves race past that check.
CREATE UNIQUE INDEX IF NOT EXISTS "serviceJobItem_reimbursementLineId_key"
  ON "serviceJobItem" ("reimbursementLineId", "companyId")
  WHERE "reimbursementLineId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "serviceJobItem_purchaseInvoiceLineId_key"
  ON "serviceJobItem" ("purchaseInvoiceLineId", "companyId")
  WHERE "purchaseInvoiceLineId" IS NOT NULL;
