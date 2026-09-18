-- Counterparty bank accounts: the bank we pay a supplier into, and the bank we
-- refund a customer to. NOT the company's own bank accounts, and unrelated to
-- "payment"."bankAccount", which is a GL chart-of-accounts reference.
--
-- Gated on accounting_* rather than purchasing_*/sales_* on purpose: payments are
-- run by finance, and purchasing_view is very widely held.

CREATE TABLE "supplierBankAccount" (
    "id" TEXT NOT NULL DEFAULT id('sba'),
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,

    "name" TEXT NOT NULL,
    "accountHolderName" TEXT,
    "bankName" TEXT,
    -- Free text, not an addressId FK: correspondent banks route on this string
    -- and it is printed verbatim onto payment files. Nothing queries or
    -- geocodes it, so the address table's structure would only get in the way.
    "bankAddress" TEXT,
    "countryCode" CHAR(2),
    "currencyCode" TEXT,

    -- The account identifier as the country writes it: an IBAN in SEPA, a plain
    -- account number in the US, a BBAN elsewhere. Storing one column rather than
    -- one per scheme is how Odoo models this; countryCode decides how it is
    -- labelled and validated.
    "accountNumber" TEXT,
    -- The routing identifier: US ABA, UK sort code, AU BSB, IN IFSC, CA transit.
    -- One column for the same reason.
    "bankCode" TEXT,
    "swiftBic" TEXT,

    -- Reserved for a future payment integration. Nothing reads these yet: the
    -- accounts are reference data a person consults, so there is no default to
    -- select and no archive flow. Deliberately left unindexed and unconstrained
    -- until something actually consumes them.
    "isPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "notes" TEXT,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    "tags" TEXT[],

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("supplierId", "companyId")
        REFERENCES "supplier"("id", "companyId") ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY ("countryCode") REFERENCES "country"("alpha2")
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "supplierBankAccount_companyId_idx" ON "supplierBankAccount" ("companyId");
CREATE INDEX "supplierBankAccount_supplierId_idx" ON "supplierBankAccount" ("supplierId");
CREATE INDEX "supplierBankAccount_createdBy_idx" ON "supplierBankAccount" ("createdBy");
CREATE INDEX "supplierBankAccount_updatedBy_idx" ON "supplierBankAccount" ("updatedBy");
CREATE INDEX "supplierBankAccount_countryCode_idx" ON "supplierBankAccount" ("countryCode");

ALTER TABLE "public"."supplierBankAccount" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."supplierBankAccount"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."supplierBankAccount"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."supplierBankAccount"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."supplierBankAccount"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

CREATE TABLE "customerBankAccount" (
    "id" TEXT NOT NULL DEFAULT id('cba'),
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,

    "name" TEXT NOT NULL,
    "accountHolderName" TEXT,
    "bankName" TEXT,
    -- Free text, not an addressId FK: correspondent banks route on this string
    -- and it is printed verbatim onto payment files. Nothing queries or
    -- geocodes it, so the address table's structure would only get in the way.
    "bankAddress" TEXT,
    "countryCode" CHAR(2),
    "currencyCode" TEXT,

    -- The account identifier as the country writes it: an IBAN in SEPA, a plain
    -- account number in the US, a BBAN elsewhere. Storing one column rather than
    -- one per scheme is how Odoo models this; countryCode decides how it is
    -- labelled and validated.
    "accountNumber" TEXT,
    -- The routing identifier: US ABA, UK sort code, AU BSB, IN IFSC, CA transit.
    -- One column for the same reason.
    "bankCode" TEXT,
    "swiftBic" TEXT,

    -- Reserved for a future payment integration. Nothing reads these yet: the
    -- accounts are reference data a person consults, so there is no default to
    -- select and no archive flow. Deliberately left unindexed and unconstrained
    -- until something actually consumes them.
    "isPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "notes" TEXT,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    "tags" TEXT[],

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("customerId", "companyId")
        REFERENCES "customer"("id", "companyId") ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY ("countryCode") REFERENCES "country"("alpha2")
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "customerBankAccount_companyId_idx" ON "customerBankAccount" ("companyId");
CREATE INDEX "customerBankAccount_customerId_idx" ON "customerBankAccount" ("customerId");
CREATE INDEX "customerBankAccount_createdBy_idx" ON "customerBankAccount" ("createdBy");
CREATE INDEX "customerBankAccount_updatedBy_idx" ON "customerBankAccount" ("updatedBy");
CREATE INDEX "customerBankAccount_countryCode_idx" ON "customerBankAccount" ("countryCode");

ALTER TABLE "public"."customerBankAccount" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."customerBankAccount"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."customerBankAccount"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."customerBankAccount"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."customerBankAccount"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- Register both tables for custom fields. Without these rows the tables never
-- appear in Settings → Custom Fields, so the <CustomFormFields> block on each
-- form has nothing to render and country-specific extras (US ACH account type,
-- an Indian purpose code, a branch name) have nowhere structured to live.
INSERT INTO "customFieldTable" ("table", "module", "name")
VALUES
  ('supplierBankAccount', 'Purchasing', 'Supplier Bank Account'),
  ('customerBankAccount', 'Sales', 'Customer Bank Account')
ON CONFLICT ("table") DO NOTHING;
