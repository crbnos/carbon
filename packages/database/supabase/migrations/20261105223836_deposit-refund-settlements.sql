-- A deposit refund consumes its original payment's remaining principal and
-- carrying base, without pretending to settle an invoice or credit memo.
ALTER TABLE "invoiceSettlement" ADD COLUMN IF NOT EXISTS "targetPaymentId" TEXT;

ALTER TABLE "invoiceSettlement" DROP CONSTRAINT IF EXISTS "invoiceSettlement_targetPaymentId_fkey";
ALTER TABLE "invoiceSettlement"
  ADD CONSTRAINT "invoiceSettlement_targetPaymentId_fkey"
  FOREIGN KEY ("targetPaymentId", "companyId")
  REFERENCES "payment" ("id", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoiceSettlement"
  DROP CONSTRAINT IF EXISTS "invoiceSettlement_target_check";
ALTER TABLE "invoiceSettlement"
  ADD CONSTRAINT "invoiceSettlement_target_check" CHECK (
    num_nonnulls("targetSalesInvoiceId", "targetPurchaseInvoiceId", "targetMemoId",
      "targetReimbursementId", "targetPaymentId") = 1
  ) NOT VALID;
ALTER TABLE "invoiceSettlement" VALIDATE CONSTRAINT "invoiceSettlement_target_check";

ALTER TABLE "invoiceSettlement" DROP CONSTRAINT IF EXISTS "invoiceSettlement_targetPaymentId_check";
ALTER TABLE "invoiceSettlement"
  ADD CONSTRAINT "invoiceSettlement_targetPaymentId_check" CHECK (
    "targetPaymentId" IS NULL OR (
      "paymentId" IS NOT NULL
      AND "sourcePaymentId" IS NOT NULL
      AND "sourcePaymentId" = "targetPaymentId"
      AND "targetPaymentId" <> "paymentId"
      AND "memoId" IS NULL
      AND "discountAmount" = 0
      AND "writeOffAmount" = 0
      AND "fxGainLossAmount" = 0
    )
  ) NOT VALID;
ALTER TABLE "invoiceSettlement" VALIDATE CONSTRAINT "invoiceSettlement_targetPaymentId_check";

CREATE INDEX IF NOT EXISTS "invoiceSettlement_targetPaymentId_idx"
  ON "invoiceSettlement" ("targetPaymentId", "companyId")
  WHERE "targetPaymentId" IS NOT NULL;
