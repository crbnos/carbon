-- Versioned, region-aware terms & conditions.
-- Replaces the single company-wide terms blob as the source read at render
-- time: each row is one T&C version covering one or more outgoing document
-- types, with an optional scope (specific counterparties or countries) and an
-- optional effective-date window. Resolution
-- (counterparty > country > global, latest effectiveFrom wins, quiet
-- fallback on gaps) happens in app
-- code (resolveEffectiveTermsVersion in @carbon/utils). The old "terms" table
-- stays in place as the backfill source; nothing reads it after this change.
-- Spec: .ai/specs/2026-08-26-versioned-region-terms-and-conditions.md

-- The outgoing document types that print terms & conditions. Mirrors the
-- terms-bearing subset of documentTemplate's types (@carbon/documents).
CREATE TYPE "termsDocumentType" AS ENUM (
    'purchaseOrder',
    'quote',
    'salesOrder',
    'salesInvoice',
    'packingSlip'
);

CREATE TABLE "termsVersion" (
    "id" TEXT NOT NULL DEFAULT id('terms'),
    "companyId" TEXT NOT NULL,
    "documentTypes" "termsDocumentType"[] NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSON NOT NULL DEFAULT '{}',
    "customerIds" TEXT[] NOT NULL DEFAULT '{}',
    "supplierIds" TEXT[] NOT NULL DEFAULT '{}',
    "countryCodes" TEXT[] NOT NULL DEFAULT '{}',
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    -- A version prints on at least one document, and carries at most ONE
    -- scope dimension: named counterparties or countries.
    CONSTRAINT "termsVersion_documentTypes" CHECK (cardinality("documentTypes") > 0),
    CONSTRAINT "termsVersion_one_scope" CHECK (
        NOT (
          (cardinality("customerIds") > 0 OR cardinality("supplierIds") > 0)
          AND cardinality("countryCodes") > 0
        )
    ),
    CONSTRAINT "termsVersion_date_order" CHECK ("effectiveFrom" IS NULL OR "effectiveTo" IS NULL OR "effectiveFrom" <= "effectiveTo")
);

CREATE INDEX "termsVersion_companyId_idx" ON "termsVersion" ("companyId");
CREATE INDEX "termsVersion_createdBy_idx" ON "termsVersion" ("createdBy");
CREATE INDEX "termsVersion_updatedBy_idx" ON "termsVersion" ("updatedBy");
CREATE INDEX "termsVersion_lookup_idx" ON "termsVersion" ("companyId", "active");
CREATE INDEX "termsVersion_documentTypes_idx" ON "termsVersion" USING GIN ("documentTypes");

ALTER TABLE "public"."termsVersion" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."termsVersion"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
  OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[])
  OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."termsVersion"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."termsVersion"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."termsVersion"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_delete'))::text[])
);

-- Backfill: each company's existing terms become version 1 (global, open-ended)
-- covering every document type that side printed them on. purchasingTerms
-- reached only the purchase order; salesTerms reached all four customer-facing
-- types, which one row now expresses directly.
INSERT INTO "termsVersion" ("companyId", "documentTypes", "name", "content", "createdBy")
SELECT t."id", ARRAY['purchaseOrder']::"termsDocumentType"[], 'Standard Terms', t."purchasingTerms", 'system'
FROM "terms" t
WHERE t."purchasingTerms" IS NOT NULL
  AND t."purchasingTerms"::text NOT IN ('{}', 'null', '""');

INSERT INTO "termsVersion" ("companyId", "documentTypes", "name", "content", "createdBy")
SELECT t."id",
       ARRAY['quote', 'salesOrder', 'salesInvoice', 'packingSlip']::"termsDocumentType"[],
       'Standard Terms', t."salesTerms", 'system'
FROM "terms" t
WHERE t."salesTerms" IS NOT NULL
  AND t."salesTerms"::text NOT IN ('{}', 'null', '""');
