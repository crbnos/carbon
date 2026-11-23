-- Contract financing (Phase B of
-- .ai/specs/2026-10-12-wbs-interop-and-contract-financing.md): customary
-- progress payments (FAR 32.5, SF 1443) and performance-based payments
-- (FAR 32.10) on a customer contract. The government's payment of a request
-- is a customer deposit scoped to the contract (`payment.customerContractId`);
-- liquidation is that deposit applied to a delivery invoice.

DO $enums$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contractFinancingMethod') THEN
    CREATE TYPE "contractFinancingMethod" AS ENUM (
      'Progress Payments',
      'Performance-Based Payments'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contractFinancingRequestStatus') THEN
    CREATE TYPE "contractFinancingRequestStatus" AS ENUM (
      'Draft',
      'Submitted',
      'Approved',
      'Paid',
      'Withdrawn'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'performanceBasedPaymentEventType') THEN
    CREATE TYPE "performanceBasedPaymentEventType" AS ENUM (
      'Severable',
      'Cumulative'
    );
  END IF;
END $enums$;

-- The financing terms of a contract: one row per contract.
CREATE TABLE IF NOT EXISTS "customerContractFinancing" (
  "id" TEXT NOT NULL DEFAULT id('ccf'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "financingMethod" "contractFinancingMethod" NOT NULL,
  -- SF 1443 line 5 (FAR 32.501-3).
  "contractPrice" NUMERIC NOT NULL,
  -- SF 1443 line 7.
  "initialAwardDate" DATE NOT NULL,
  -- SF 1443 line 3.
  "isSmallBusiness" BOOLEAN NOT NULL DEFAULT FALSE,
  -- PBP: total payments never exceed this share of the price (FAR 32.1004(b)(2)).
  "maximumPaymentShare" NUMERIC NOT NULL DEFAULT 0.9,
  -- The next request number of the contract's series, given at Submit.
  "nextRequestNumber" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractFinancing_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractFinancing_contract_key" UNIQUE ("customerContractId", "companyId"),
  CONSTRAINT "customerContractFinancing_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "customerContractFinancing_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractFinancing_price_check" CHECK ("contractPrice" > 0),
  CONSTRAINT "customerContractFinancing_share_check"
    CHECK ("maximumPaymentShare" > 0 AND "maximumPaymentShare" <= 1),
  CONSTRAINT "customerContractFinancing_nextRequestNumber_check" CHECK ("nextRequestNumber" >= 1)
);

CREATE INDEX IF NOT EXISTS "customerContractFinancing_companyId_idx"
  ON "customerContractFinancing" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractFinancing_createdBy_idx"
  ON "customerContractFinancing" ("createdBy");

-- The rate history: the rate of a date is the latest row on or before it.
CREATE TABLE IF NOT EXISTS "customerContractFinancingRate" (
  "id" TEXT NOT NULL DEFAULT id('ccfr'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "effectiveDate" DATE NOT NULL,
  -- SF 1443 line 6A; null on a performance-based payment contract.
  "progressPaymentRate" NUMERIC,
  -- SF 1443 line 6B.
  "liquidationRate" NUMERIC NOT NULL,
  "modificationNumber" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractFinancingRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractFinancingRate_date_key"
    UNIQUE ("customerContractId", "effectiveDate", "companyId"),
  CONSTRAINT "customerContractFinancingRate_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "customerContractFinancingRate_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractFinancingRate_progress_check"
    CHECK ("progressPaymentRate" IS NULL OR ("progressPaymentRate" > 0 AND "progressPaymentRate" <= 1)),
  CONSTRAINT "customerContractFinancingRate_liquidation_check"
    CHECK ("liquidationRate" >= 0 AND "liquidationRate" <= 1)
);

CREATE INDEX IF NOT EXISTS "customerContractFinancingRate_companyId_idx"
  ON "customerContractFinancingRate" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractFinancingRate_createdBy_idx"
  ON "customerContractFinancingRate" ("createdBy");

-- A progress payment request (an SF 1443) or a performance-based payment
-- request. `lines` holds the computed values, `overrides` the user's.
CREATE TABLE IF NOT EXISTS "contractFinancingRequest" (
  "id" TEXT NOT NULL DEFAULT id('cfr'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "financingMethod" "contractFinancingMethod" NOT NULL,
  "requestNumber" INTEGER,
  "status" "contractFinancingRequestStatus" NOT NULL DEFAULT 'Draft',
  "requestDate" DATE NOT NULL,
  "costsThroughDate" DATE NOT NULL,
  -- SF 1443 line 12b and the date it was estimated (at most 6 months old).
  "estimateToComplete" NUMERIC,
  "estimateDate" DATE,
  "lines" JSONB NOT NULL DEFAULT '{}',
  "overrides" JSONB NOT NULL DEFAULT '{}',
  -- SF 1443 line 26, or PBP value 1b.
  "requestedAmount" NUMERIC NOT NULL DEFAULT 0,
  -- SF 1443 line 27.
  "approvedAmount" NUMERIC,
  -- The deposit payment that settled the request.
  "paymentId" TEXT,
  "submittedAt" TIMESTAMP WITH TIME ZONE,
  "submittedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "contractFinancingRequest_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "contractFinancingRequest_number_key"
    UNIQUE ("customerContractId", "requestNumber", "companyId"),
  CONSTRAINT "contractFinancingRequest_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "contractFinancingRequest_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "contractFinancingRequest_payment_fkey" FOREIGN KEY ("paymentId", "companyId")
    REFERENCES "payment"("id", "companyId") ON DELETE SET NULL ("paymentId"),
  -- A Draft has no number; every other status keeps the number Submit gave it.
  CONSTRAINT "contractFinancingRequest_number_check"
    CHECK (("status" = 'Draft') = ("requestNumber" IS NULL)),
  CONSTRAINT "contractFinancingRequest_dates_check" CHECK ("costsThroughDate" <= "requestDate"),
  CONSTRAINT "contractFinancingRequest_amount_check"
    CHECK ("requestedAmount" >= 0 AND ("approvedAmount" IS NULL OR "approvedAmount" >= 0))
);

CREATE INDEX IF NOT EXISTS "contractFinancingRequest_companyId_idx"
  ON "contractFinancingRequest" ("companyId");
CREATE INDEX IF NOT EXISTS "contractFinancingRequest_contract_idx"
  ON "contractFinancingRequest" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "contractFinancingRequest_payment_idx"
  ON "contractFinancingRequest" ("paymentId", "companyId") WHERE "paymentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "contractFinancingRequest_createdBy_idx"
  ON "contractFinancingRequest" ("createdBy");

-- The performance-based payment schedule of a contract.
CREATE TABLE IF NOT EXISTS "performanceBasedPaymentEvent" (
  "id" TEXT NOT NULL DEFAULT id('pbpe'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  -- The CLIN the event pays toward; null for the whole contract.
  "customerContractLineId" TEXT,
  "sequence" INTEGER NOT NULL,
  -- WAWF event id: 1 to 10 characters.
  "eventCode" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "completionCriteria" TEXT,
  "eventType" "performanceBasedPaymentEventType" NOT NULL DEFAULT 'Cumulative',
  "amount" NUMERIC NOT NULL,
  "plannedDate" DATE,
  "completedDate" DATE,
  "completedBy" TEXT REFERENCES "user"("id"),
  "evidence" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "performanceBasedPaymentEvent_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "performanceBasedPaymentEvent_code_key"
    UNIQUE ("customerContractId", "eventCode", "companyId"),
  CONSTRAINT "performanceBasedPaymentEvent_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "performanceBasedPaymentEvent_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "performanceBasedPaymentEvent_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId")
    REFERENCES "customerContractLine"("id", "companyId") ON DELETE SET NULL ("customerContractLineId"),
  CONSTRAINT "performanceBasedPaymentEvent_code_check" CHECK (char_length("eventCode") BETWEEN 1 AND 10),
  CONSTRAINT "performanceBasedPaymentEvent_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "performanceBasedPaymentEvent_completed_check"
    CHECK (("completedDate" IS NULL) = ("completedBy" IS NULL))
);

CREATE INDEX IF NOT EXISTS "performanceBasedPaymentEvent_companyId_idx"
  ON "performanceBasedPaymentEvent" ("companyId");
CREATE INDEX IF NOT EXISTS "performanceBasedPaymentEvent_line_idx"
  ON "performanceBasedPaymentEvent" ("customerContractLineId", "companyId")
  WHERE "customerContractLineId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "performanceBasedPaymentEvent_createdBy_idx"
  ON "performanceBasedPaymentEvent" ("createdBy");

-- The events a PBP request bills.
CREATE TABLE IF NOT EXISTS "contractFinancingRequestEvent" (
  "id" TEXT NOT NULL DEFAULT id('cfre'),
  "companyId" TEXT NOT NULL,
  "contractFinancingRequestId" TEXT NOT NULL,
  "performanceBasedPaymentEventId" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "contractFinancingRequestEvent_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "contractFinancingRequestEvent_event_key"
    UNIQUE ("contractFinancingRequestId", "performanceBasedPaymentEventId", "companyId"),
  CONSTRAINT "contractFinancingRequestEvent_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "contractFinancingRequestEvent_request_fkey" FOREIGN KEY ("contractFinancingRequestId", "companyId")
    REFERENCES "contractFinancingRequest"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "contractFinancingRequestEvent_event_fkey" FOREIGN KEY ("performanceBasedPaymentEventId", "companyId")
    REFERENCES "performanceBasedPaymentEvent"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "contractFinancingRequestEvent_companyId_idx"
  ON "contractFinancingRequestEvent" ("companyId");
CREATE INDEX IF NOT EXISTS "contractFinancingRequestEvent_event_idx"
  ON "contractFinancingRequestEvent" ("performanceBasedPaymentEventId", "companyId");
CREATE INDEX IF NOT EXISTS "contractFinancingRequestEvent_createdBy_idx"
  ON "contractFinancingRequestEvent" ("createdBy");

-- The contract deposit scope: a customer deposit held against a contract
-- funds only that contract's invoices.
ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "customerContractId" TEXT;

DO $paydep$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_customerContract_fkey') THEN
    ALTER TABLE "payment" ADD CONSTRAINT "payment_customerContract_fkey"
      FOREIGN KEY ("customerContractId", "companyId")
      REFERENCES "customerContract"("id", "companyId") ON DELETE RESTRICT;
  END IF;
END $paydep$;

CREATE INDEX IF NOT EXISTS "payment_customerContractId_idx"
  ON "payment" ("customerContractId", "companyId") WHERE "customerContractId" IS NOT NULL;

ALTER TABLE "payment" DROP CONSTRAINT IF EXISTS "payment_deposit_document_check";
ALTER TABLE "payment" ADD CONSTRAINT "payment_deposit_document_check"
  CHECK (num_nonnulls("salesOrderId", "rentalAgreementId", "customerContractId") <= 1);
