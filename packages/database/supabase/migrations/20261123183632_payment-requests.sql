DO $$ BEGIN
  CREATE TYPE "paymentRequestStatus" AS ENUM ('Planned', 'Ready', 'Sent', 'Paid', 'Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "paymentRequest" (
  "id" TEXT NOT NULL DEFAULT id('preq'),
  "companyId" TEXT NOT NULL,
  "purchaseInvoiceId" TEXT,
  "purchaseOrderId" TEXT,
  "requestNumber" INTEGER NOT NULL,
  "status" "paymentRequestStatus" NOT NULL DEFAULT 'Planned',
  "amount" NUMERIC,
  "currencyCode" TEXT NOT NULL,
  "dueDate" DATE,
  "description" TEXT,
  "documentPath" TEXT,
  "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
  "paymentId" TEXT,
  "idempotencyKey" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchaseInvoice"("id") ON DELETE CASCADE,
  FOREIGN KEY ("purchaseOrderId", "companyId") REFERENCES "purchaseOrder"("id", "companyId") ON DELETE CASCADE,
  FOREIGN KEY ("paymentId", "companyId") REFERENCES "payment"("id", "companyId"),
  CONSTRAINT "paymentRequest_target_check" CHECK (num_nonnulls("purchaseInvoiceId", "purchaseOrderId") = 1),
  CONSTRAINT "paymentRequest_amount_check" CHECK ("amount" IS NULL OR "amount" > 0),
  CONSTRAINT "paymentRequest_ready_check" CHECK (
    "status" IN ('Planned', 'Cancelled') OR ("amount" IS NOT NULL AND "dueDate" IS NOT NULL)
  ),
  CONSTRAINT "paymentRequest_paid_check" CHECK (("status" = 'Paid') = ("paymentId" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "paymentRequest_companyId_idx" ON "paymentRequest" ("companyId");
CREATE INDEX IF NOT EXISTS "paymentRequest_createdBy_idx" ON "paymentRequest" ("createdBy");
CREATE INDEX IF NOT EXISTS "paymentRequest_updatedBy_idx" ON "paymentRequest" ("updatedBy");
CREATE INDEX IF NOT EXISTS "paymentRequest_paymentId_idx" ON "paymentRequest" ("paymentId");
CREATE INDEX IF NOT EXISTS "paymentRequest_purchaseInvoiceId_idx" ON "paymentRequest" ("purchaseInvoiceId");
CREATE INDEX IF NOT EXISTS "paymentRequest_purchaseOrderId_idx" ON "paymentRequest" ("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "paymentRequest_status_idx" ON "paymentRequest" ("companyId", "status", "dueDate");

CREATE UNIQUE INDEX IF NOT EXISTS "paymentRequest_invoice_number_key"
  ON "paymentRequest" ("purchaseInvoiceId", "requestNumber", "companyId")
  WHERE "purchaseInvoiceId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "paymentRequest_order_number_key"
  ON "paymentRequest" ("purchaseOrderId", "requestNumber", "companyId")
  WHERE "purchaseOrderId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "paymentRequest_idempotency_key"
  ON "paymentRequest" ("companyId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
