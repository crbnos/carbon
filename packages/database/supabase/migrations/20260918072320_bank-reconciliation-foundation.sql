-- Bank Reconciliation — Checkpoint 1 (minimal vertical slice)
--
-- Scope is intentionally trimmed: a company's own bank account, a CSV-sourced
-- statement/transaction set, and enough columns to prove the auto-match loop
-- (upload -> parse -> match against posted journalLine rows -> see results).
--
-- companyBankAccount is named to avoid ambiguity with payment.bankAccount
-- (an FK to the GL chart of accounts) and the existing supplierBankAccount /
-- customerBankAccount tables (counterparty banks, not the company's own).

CREATE TYPE "bankStatementStatus" AS ENUM ('Processing', 'Imported', 'Failed');
CREATE TYPE "bankTransactionStatus" AS ENUM ('Unmatched', 'Matched', 'Excluded');
CREATE TYPE "bankMatchType" AS ENUM ('Exact', 'Manual');

CREATE TABLE "companyBankAccount" (
    "id" TEXT NOT NULL DEFAULT id('cmba'),
    "companyId" TEXT NOT NULL,

    "name" TEXT NOT NULL,
    "glAccountId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("glAccountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX "companyBankAccount_companyId_idx" ON "companyBankAccount" ("companyId");
CREATE INDEX "companyBankAccount_glAccountId_idx" ON "companyBankAccount" ("glAccountId");
CREATE INDEX "companyBankAccount_createdBy_idx" ON "companyBankAccount" ("createdBy");
CREATE INDEX "companyBankAccount_updatedBy_idx" ON "companyBankAccount" ("updatedBy");

ALTER TABLE "public"."companyBankAccount" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."companyBankAccount"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."companyBankAccount"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."companyBankAccount"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."companyBankAccount"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

CREATE TABLE "bankStatement" (
    "id" TEXT NOT NULL DEFAULT id('bstmt'),
    "companyId" TEXT NOT NULL,
    "companyBankAccountId" TEXT NOT NULL,

    "sourceFileName" TEXT,
    "status" "bankStatementStatus" NOT NULL DEFAULT 'Processing',
    "importError" TEXT,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("companyBankAccountId", "companyId")
        REFERENCES "companyBankAccount"("id", "companyId") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX "bankStatement_companyId_idx" ON "bankStatement" ("companyId");
CREATE INDEX "bankStatement_companyBankAccountId_idx" ON "bankStatement" ("companyBankAccountId");
CREATE INDEX "bankStatement_createdBy_idx" ON "bankStatement" ("createdBy");
CREATE INDEX "bankStatement_updatedBy_idx" ON "bankStatement" ("updatedBy");

ALTER TABLE "public"."bankStatement" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."bankStatement"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."bankStatement"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."bankStatement"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."bankStatement"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

CREATE TABLE "bankTransaction" (
    "id" TEXT NOT NULL DEFAULT id('btxn'),
    "companyId" TEXT NOT NULL,
    "companyBankAccountId" TEXT NOT NULL,
    "bankStatementId" TEXT,

    "postedDate" DATE NOT NULL,
    "amount" NUMERIC NOT NULL,
    "description" TEXT NOT NULL,

    "status" "bankTransactionStatus" NOT NULL DEFAULT 'Unmatched',
    "matchedJournalLineId" TEXT,
    "matchType" "bankMatchType",

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("companyBankAccountId", "companyId")
        REFERENCES "companyBankAccount"("id", "companyId") ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY ("bankStatementId", "companyId")
        REFERENCES "bankStatement"("id", "companyId") ON UPDATE CASCADE ON DELETE SET NULL,
    FOREIGN KEY ("matchedJournalLineId") REFERENCES "journalLine"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "bankTransaction_companyId_idx" ON "bankTransaction" ("companyId");
CREATE INDEX "bankTransaction_companyBankAccountId_idx" ON "bankTransaction" ("companyBankAccountId");
CREATE INDEX "bankTransaction_bankStatementId_idx" ON "bankTransaction" ("bankStatementId");
CREATE INDEX "bankTransaction_matchedJournalLineId_idx" ON "bankTransaction" ("matchedJournalLineId");
CREATE INDEX "bankTransaction_status_idx" ON "bankTransaction" ("status", "companyId");
CREATE INDEX "bankTransaction_createdBy_idx" ON "bankTransaction" ("createdBy");
CREATE INDEX "bankTransaction_updatedBy_idx" ON "bankTransaction" ("updatedBy");

ALTER TABLE "public"."bankTransaction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."bankTransaction"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."bankTransaction"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."bankTransaction"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."bankTransaction"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- Custom Fields registration (Settings -> Custom Fields), following the
-- supplierBankAccount / customerBankAccount precedent.
INSERT INTO "customFieldTable" ("table", "module", "name")
VALUES
  ('companyBankAccount', 'Accounting', 'Company Bank Account')
ON CONFLICT ("table") DO NOTHING;
