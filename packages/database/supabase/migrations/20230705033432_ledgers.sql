CREATE TYPE "month" AS ENUM (
  'January', 
  'February', 
  'March', 
  'April', 
  'May', 
  'June', 
  'July', 
  'August', 
  'September', 
  'October', 
  'November', 
  'December'
);

CREATE TABLE "fiscalYearSettings" (
  "companyId" TEXT NOT NULL,
  "startMonth" "month" NOT NULL DEFAULT 'January',
  "taxStartMonth" "month" NOT NULL DEFAULT 'January',
  "updatedBy" TEXT NOT NULL,

  CONSTRAINT "fiscalYearSettings_pkey" PRIMARY KEY ("companyId"),
  CONSTRAINT "fiscalYearSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fiscalYearSettings_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE TYPE "accountingPeriodStatus" AS ENUM (
  'Inactive', 
  'Active'
);

CREATE TABLE "accountingPeriod" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "status" "accountingPeriodStatus" NOT NULL DEFAULT 'Inactive',
  "companyId" TEXT NOT NULL,
  "closedAt" TIMESTAMP WITH TIME ZONE,
  "closedBy" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "accountingPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINt "accountingPeriod_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "accountingPeriod_closedBy_fkey" FOREIGN KEY ("closedBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "accountingPeriod_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "accountingPeriod_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);

CREATE INDEX "accountingPeriod_companyId_idx" ON "accountingPeriod" ("companyId");

CREATE TABLE "journal" (
  "id" SERIAL,
  "description" TEXT,
  "accountingPeriodId" TEXT,
  "companyId" TEXT NOT NULL,
  "postingDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "customFields" JSONB,

  CONSTRAINT "journal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journal_accountPeriodId_fkey" FOREIGN KEY ("accountingPeriodId") REFERENCES "accountingPeriod" ("id") ON DELETE RESTRICT,
  CONSTRAINT "journal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "journal_companyId_idx" ON "journal" ("companyId");

ALTER publication supabase_realtime ADD TABLE "journal";

CREATE INDEX "journal_accountPeriodId_idx" ON "journal" ("accountingPeriodId");
CREATE INDEX "journal_postingDate_idx" ON "journal" ("postingDate");

ALTER TABLE "journal" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with accounting_view can view journals" ON "journal"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('accounting_view', "companyId")
  );
  

CREATE POLICY "Employees with accounting_create can insert journals" ON "journal"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('accounting_create', "companyId")
);


CREATE TYPE "journalLineDocumentType" AS ENUM (
  'Receipt',
  'Invoice',
  'Credit Memo',
  'Blanket Order',
  'Return Order'
);

CREATE TABLE "journalLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "journalId" INTEGER NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "description" TEXT,
  "amount" NUMERIC(19, 4) NOT NULL,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
  "documentType" "journalLineDocumentType", 
  "documentId" TEXT,
  "externalDocumentId" TEXT,
  "journalLineReference" TEXT NOT NULL,
  "documentLineReference" TEXT,
  "accrual" BOOLEAN NOT NULL DEFAULT false,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "customFields" JSONB,

  CONSTRAINT "journalLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journalLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE   CASCADE,
  CONSTRAINT "journalLine_accountNumber_fkey" FOREIGN KEY ("accountNumber", "companyId") REFERENCES "account"("number", "companyId") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "journalLine_accountNumber_idx" ON "journalLine" ("accountNumber", "companyId");
CREATE INDEX "journalLine_companyId_idx" ON "journalLine" ("companyId");

ALTER TABLE "journalLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with accounting_view can view journal lines" ON "journalLine"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('accounting_view', "companyId")
  );
  

CREATE POLICY "Employees with accounting_create can insert journal lines" ON "journalLine"
  FOR INSERT
  WITH CHECK (   
    has_role('employee') AND
    has_company_permission('accounting_create', "companyId")
);

-- delete and update are not available for journal lines

CREATE TYPE "itemLedgerType" AS ENUM (
  'Purchase',
  'Sale',
  'Positive Adjmt.',
  'Negative Adjmt.',
  'Transfer',
  'Consumption',
  'Output',
  'Assembly Consumption',
  'Assembly Output'
);

CREATE TYPE "costLedgerType" AS ENUM (
  'Direct Cost',
  'Revaluation',
  'Rounding',
  'Indirect Cost',
  'Variance',
  'Total'
);

CREATE TYPE "itemLedgerDocumentType" AS ENUM (
  'Sales Shipment',
  'Sales Invoice',
  'Sales Return Receipt',
  'Sales Credit Memo',
  'Purchase Receipt',
  'Purchase Invoice',
  'Purchase Return Shipment',
  'Purchase Credit Memo',
  'Transfer Shipment',
  'Transfer Receipt',
  'Service Shipment',
  'Service Invoice',
  'Service Credit Memo',
  'Posted Assembly',
  'Inventory Receipt',
  'Inventory Shipment',
  'Direct Transfer'
);

CREATE TABLE "costLedger" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "entryNumber" SERIAL,
  "postingDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  "itemLedgerType" "itemLedgerType" NOT NULL,
  "costLedgerType" "costLedgerType" NOT NULL,
  "adjustment" BOOLEAN NOT NULL DEFAULT false,
  "documentType" "itemLedgerDocumentType",
  "documentId" TEXT,
  "externalDocumentId" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 0,
  "cost" NUMERIC(19, 4) NOT NULL DEFAULT 0,
  "costPostedToGL" NUMERIC(19, 4) NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  CONSTRAINT "costLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "costLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "costLedger_itemId_idx" ON "costLedger" ("itemId");
CREATE INDEX "costLedger_companyId_idx" ON "costLedger" ("companyId");

ALTER TABLE "costLedger" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with accounting_view can view the value ledger" ON "costLedger"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('accounting_view', "companyId")
  );


CREATE TABLE "itemLedger" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "entryNumber" SERIAL,
  "postingDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  "entryType" "itemLedgerType" NOT NULL,
  "documentType" "itemLedgerDocumentType",
  "documentId" TEXT,
  "externalDocumentId" TEXT,
  "itemId" TEXT NOT NULL,
  "itemReadableId" TEXT,
  "locationId" TEXT,
  "shelfId" TEXT,
  "quantity" NUMERIC(12, 4) NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  CONSTRAINT "itemLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "itemLedger_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "itemLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "itemLedger_shelfId_fkey" FOREIGN KEY ("shelfId", "locationId") REFERENCES "shelf"("id", "locationId") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "partLeger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "itemLedger" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Certain employees can view the parts ledger" ON "itemLedger"
  FOR SELECT
  USING (
    has_role('employee') AND
    (
      has_company_permission('accounting_view', "companyId") OR
      has_company_permission('parts_view', "companyId")
    )
  );

CREATE TYPE "supplierLedgerDocumentType" AS ENUM (
  'Payment',
  'Invoice',
  'Credit Memo',
  'Finance Charge Memo',
  'Reminder',
  'Refund'
);

CREATE TABLE "supplierLedger" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "entryNumber" SERIAL,
  "postingDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  "documentType" "supplierLedgerDocumentType",
  "documentId" TEXT,
  "externalDocumentId" TEXT,
  "supplierId" TEXT NOT NULL,
  "amount" NUMERIC(19, 4) NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  CONSTRAINT "supplierLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplierLedger_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "supplierLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "supplierLedger" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Certain employees can view the parts ledger" ON "supplierLedger"
  FOR SELECT
  USING (
    has_role('employee') AND
    (
      has_company_permission('invoicing_view', "companyId") OR
      has_company_permission('purchasing_view', "companyId") OR
      has_company_permission('accounting_view', "companyId")
    )
  );

CREATE OR REPLACE FUNCTION "journalLinesByAccountNumber" (
  from_date DATE DEFAULT (now() - INTERVAL '100 year'),
  to_date DATE DEFAULT now()
) 
RETURNS TABLE (
  "number" TEXT,
  "companyId" TEXT,
  "balance" NUMERIC(19, 4),
  "balanceAtDate" NUMERIC(19, 4),
  "netChange" NUMERIC(19, 4)
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
  BEGIN
    RETURN QUERY
      SELECT 
        a."number",
        a."companyId",
        SUM(jl."amount") AS "balance",
        SUM(CASE WHEN j."postingDate" <= to_date THEN jl."amount" ELSE 0 END) AS "balanceAtDate",
        SUM(CASE WHEN j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END) AS "netChange"
      FROM "account" a
      LEFT JOIN "journalLine" jl ON jl."accountNumber" = a."number"
      INNER JOIN "journal" j ON j."id" = jl."journalId"
      GROUP BY a."number", a."companyId";
  END;
$$;



      
      

