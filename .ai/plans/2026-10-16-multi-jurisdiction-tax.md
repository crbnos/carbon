# Multi-Jurisdiction Tax, Phase 1 — implementation plan

**Spec:** .ai/specs/2026-10-16-multi-jurisdiction-tax.md
**Research:** .ai/research/2026-10-16-purchase-tax-recovery-and-xero-tax-mapping.md
**Grill log:** .ai/runs/2026-10-16-grill-multi-jurisdiction-tax.md
**Closest sibling:** dimension with values (tax code with components); payment terms (authorities, registrations); the integration drawer's Dimensions tab (Tax Rates tab); `itemLedger` (`taxLedger`)
**Branch:** montevideo

Phase 1 ships as four pull requests, one per slice. Each slice leaves `main` green.

| Slice | Pull request | Tasks | Ships |
|---|---|---|---|
| A | Foundation | 1–15 | Alone |
| B | Posting | 16–25 | In the same release as C |
| C | Provider mapping | 26–34 | In the same release as B |
| D | Reporting and documents | 35–39 | After B |

🛑 Slice B changes how purchase tax posts. Slice C makes Xero and QuickBooks Online send that tax. Never release B without C: a recoverable code would then post VAT to Tax Paid while Xero still gets "No VAT".

## Progress

Slice A — Foundation
- [x] Task 1: Write the Phase 1 schema migration
- [x] Task 2: Add authz rules, event attachments and audit entries
- [x] Task 3: Apply the migration, regenerate types, ship the authz migration
- [x] Task 4: Follow the account-default renames through code, seed data and backups
- [x] Task 5: Write the pure tax-component helpers with tests
- [x] Task 6: Add tax models and service functions, with the resolver
- [ ] Task 7: Add the tax code API route and the `TaxCode` select
- [ ] Task 8: Build the Tax Codes screens
- [ ] Task 9: Build the Tax Authorities and Tax Registrations screens
- [ ] Task 10: Add code assignment to customers, suppliers, locations and items
- [ ] Task 11: Resolve tax codes on sales document lines
- [ ] Task 12: Resolve tax codes on purchase document lines
- [ ] Task 13: Carry tax codes through rentals, contracts, fixed assets, conversions and billing generators
- [ ] Task 14: Accept a tax code in the customer and supplier CSV import
- [ ] Task 15: Seed tax codes in the demo datasets

Slice B — Posting
- [ ] Task 16: Post sales tax per component, with header-shipping tax
- [ ] Task 17: Tax header shipping in the invoice view, provider components and PDF helpers
- [ ] Task 18: Split purchase tax into recoverable and non-recoverable parts at invoice posting
- [ ] Task 19: Leave recoverable tax out of the received unit cost
- [x] Task 20: Write the pure tax-ledger row builder with tests
- [ ] Task 21: Write `taxLedger` rows when sales and purchase invoices post and void
- [ ] Task 22: Post memo tax
- [ ] Task 23: Enter memo tax in the memo form and in memos made from a source
- [ ] Task 24: Write `taxLedger` rows in the legacy backfill
- [ ] Task 25: Verify slice B end to end

Slice C — Provider mapping
- [ ] Task 26: Write `core/tax-mapping.ts` with tests
- [ ] Task 27: Read provider tax catalogs (Xero `/TaxRates`, QuickBooks Online tax codes)
- [ ] Task 28: Add the Tax Rates tab and the sync gate to the integration drawer
- [ ] Task 29: Write the shared provider tax-rate resolver with tests
- [ ] Task 30: Send mapped tax on Xero invoices, sales orders and purchase orders
- [ ] Task 31: Carry per-line tax through bill costing
- [ ] Task 32: Send tax on Xero bills, credit notes and vendor credits
- [ ] Task 33: Send mapped tax on QuickBooks Online documents
- [ ] Task 34: Update the accounting sync rule

Slice D — Reporting and documents
- [ ] Task 35: Build the Tax Liability report
- [ ] Task 36: Print the tax summary, VAT clause and registration on sales PDFs
- [ ] Task 37: Move customers and suppliers from a bare percent to tax codes
- [ ] Task 38: Update docs, glossary, rules and AGENTS.md
- [ ] Task 39: Verify Phase 1 in the browser

## Dependencies

- Task 2 needs Task 1. Task 3 needs Tasks 1 and 2. Every later task needs Task 3 (generated types).
- Task 4 needs Task 3.
- Task 5 is independent of Task 4. Task 6 needs Task 5.
- Tasks 7, 8 and 9 need Task 6. Tasks 8 and 9 are independent of each other.
- Task 10 needs Task 7. Tasks 11, 12 and 13 need Tasks 6 and 7, and are independent of each other.
- Tasks 14 and 15 need Task 6.
- Tasks 16, 18, 19 and 20 need Task 5. Tasks 16, 18 and 20 are independent of each other.
- Task 17 needs Task 16. Task 21 needs Tasks 16, 18 and 20. Task 22 needs Task 20. Task 23 needs Task 22. Task 24 needs Task 21.
- Task 26 needs Task 3. Task 27 is independent. Task 28 needs Tasks 26 and 27. Task 29 needs Task 26.
- Tasks 30, 32 and 33 need Task 29. Task 32 needs Task 31. Task 31 needs Task 21.
- Task 35 needs Task 21. Task 36 needs Task 21. Task 37 needs Task 10.
- Task 38 runs last in each slice for that slice's surfaces. Task 39 runs after Task 37.

## Conventions for every task

- Commit each task through `/check-and-commit` (`.claude/skills/check-and-commit/SKILL.md`).
- Rates and percents are 0–1 fractions in storage, as `taxPercent` is today.
- Round with the helpers in `packages/database/src/precision.ts`: `applyRate`, `distributeRoundingResidual`, `round`. Never call `Math.round` or `toFixed` on a money value.
- Never use JavaScript `Date` (`.claude/rules/date-handling.md`). Compare `YYYY-MM-DD` strings for effective dates.
- Kysely writes in a server function need an explicit `companyId` (lesson "Kysely writes in a server function bypass RLS").
- If a file, line number or function named here does not match the code, STOP and report. Do not improvise.

---

# Slice A — Foundation

## Task 1: Write the Phase 1 schema migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_multi-jurisdiction-tax.sql` (made by the command in step 1)
- Copy from (precedent): `packages/database/supabase/migrations/20261011163211_lessee-leases.sql` (table shape, composite PK, indexes, account FK with `ON DELETE RESTRICT`)

**Steps:**
1. Run `pnpm db:migrate:new multi-jurisdiction-tax`.
2. If the generated HHMMSS is `000000`, rename the file to a random HHMMSS on the same date.
3. Write this SQL into the file. Every statement is idempotent.

```sql
-- Enums
DO $$ BEGIN
  CREATE TYPE "taxCalculationType" AS ENUM ('Normal', 'Reverse Charge');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "taxReportingCategory" AS ENUM
    ('Standard', 'Reduced', 'Zero-Rated', 'Exempt', 'Reverse Charge', 'Export', 'Out of Scope');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "taxLedgerSource" AS ENUM ('Sales', 'Purchase');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Authorities
CREATE TABLE IF NOT EXISTS "taxAuthority" (
  "id" TEXT NOT NULL DEFAULT id('txa'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "supplierId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "taxAuthority_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "taxAuthority_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "taxAuthority_supplierId_fkey" FOREIGN KEY ("supplierId", "companyId")
    REFERENCES "supplier"("id", "companyId") ON DELETE SET NULL ("supplierId"),
  CONSTRAINT "taxAuthority_name_key" UNIQUE ("companyId", "name")
);
CREATE INDEX IF NOT EXISTS "taxAuthority_companyId_idx" ON "taxAuthority" ("companyId");
CREATE INDEX IF NOT EXISTS "taxAuthority_supplierId_idx" ON "taxAuthority" ("supplierId");
CREATE INDEX IF NOT EXISTS "taxAuthority_createdBy_idx" ON "taxAuthority" ("createdBy");

-- Codes
CREATE TABLE IF NOT EXISTS "taxCode" (
  "id" TEXT NOT NULL DEFAULT id('txc'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "calculationType" "taxCalculationType" NOT NULL DEFAULT 'Normal',
  "reportingCategory" "taxReportingCategory" NOT NULL DEFAULT 'Standard',
  "taxesShipping" BOOLEAN NOT NULL DEFAULT FALSE,
  "invoiceMessage" TEXT,
  "countryCode" TEXT REFERENCES "country"("alpha2"),
  "state" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "taxCode_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "taxCode_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "taxCode_name_key" UNIQUE ("companyId", "name")
);
CREATE INDEX IF NOT EXISTS "taxCode_companyId_idx" ON "taxCode" ("companyId");
CREATE INDEX IF NOT EXISTS "taxCode_countryCode_idx" ON "taxCode" ("countryCode");
CREATE INDEX IF NOT EXISTS "taxCode_createdBy_idx" ON "taxCode" ("createdBy");

-- Components
CREATE TABLE IF NOT EXISTS "taxCodeComponent" (
  "id" TEXT NOT NULL DEFAULT id('txcc'),
  "companyId" TEXT NOT NULL,
  "taxCodeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "taxAuthorityId" TEXT,
  "taxPercent" NUMERIC NOT NULL,
  "recoverablePercent" NUMERIC NOT NULL DEFAULT 0,
  "sequence" INTEGER NOT NULL DEFAULT 1,
  "isCompound" BOOLEAN NOT NULL DEFAULT FALSE,
  "taxReceivedAccountId" TEXT,
  "taxPaidAccountId" TEXT,
  "effectiveDate" DATE,
  "expirationDate" DATE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "taxCodeComponent_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "taxCodeComponent_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "taxCodeComponent_taxCodeId_fkey" FOREIGN KEY ("taxCodeId", "companyId")
    REFERENCES "taxCode"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "taxCodeComponent_taxAuthorityId_fkey" FOREIGN KEY ("taxAuthorityId", "companyId")
    REFERENCES "taxAuthority"("id", "companyId") ON DELETE SET NULL ("taxAuthorityId"),
  CONSTRAINT "taxCodeComponent_taxReceivedAccountId_fkey" FOREIGN KEY ("taxReceivedAccountId")
    REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "taxCodeComponent_taxPaidAccountId_fkey" FOREIGN KEY ("taxPaidAccountId")
    REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "taxCodeComponent_taxPercent_check" CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1),
  CONSTRAINT "taxCodeComponent_recoverablePercent_check"
    CHECK ("recoverablePercent" >= 0 AND "recoverablePercent" <= 1),
  CONSTRAINT "taxCodeComponent_dates_check"
    CHECK ("expirationDate" IS NULL OR "effectiveDate" IS NULL OR "expirationDate" >= "effectiveDate")
);
CREATE INDEX IF NOT EXISTS "taxCodeComponent_companyId_idx" ON "taxCodeComponent" ("companyId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_taxCodeId_idx" ON "taxCodeComponent" ("taxCodeId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_taxAuthorityId_idx" ON "taxCodeComponent" ("taxAuthorityId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_taxReceivedAccountId_idx" ON "taxCodeComponent" ("taxReceivedAccountId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_taxPaidAccountId_idx" ON "taxCodeComponent" ("taxPaidAccountId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_createdBy_idx" ON "taxCodeComponent" ("createdBy");

-- Registrations
CREATE TABLE IF NOT EXISTS "taxRegistration" (
  "id" TEXT NOT NULL DEFAULT id('txr'),
  "companyId" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL REFERENCES "country"("alpha2"),
  "state" TEXT,
  "registrationNumber" TEXT NOT NULL,
  "effectiveDate" DATE,
  "endDate" DATE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "taxRegistration_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "taxRegistration_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "taxRegistration_companyId_idx" ON "taxRegistration" ("companyId");
CREATE INDEX IF NOT EXISTS "taxRegistration_countryCode_idx" ON "taxRegistration" ("countryCode");
CREATE INDEX IF NOT EXISTS "taxRegistration_createdBy_idx" ON "taxRegistration" ("createdBy");

-- Ledger
CREATE TABLE IF NOT EXISTS "taxLedger" (
  "id" TEXT NOT NULL DEFAULT id('txl'),
  "companyId" TEXT NOT NULL,
  "source" "taxLedgerSource" NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "documentLineId" TEXT,
  "journalId" TEXT NOT NULL,
  "postingDate" DATE NOT NULL,
  "taxCodeId" TEXT,
  "taxCodeComponentId" TEXT,
  "componentName" TEXT,
  "taxAuthorityId" TEXT,
  "taxPercent" NUMERIC NOT NULL DEFAULT 0,
  "recoverablePercent" NUMERIC NOT NULL DEFAULT 0,
  "customerId" TEXT,
  "supplierId" TEXT,
  "taxableAmount" NUMERIC NOT NULL DEFAULT 0,
  "taxAmount" NUMERIC NOT NULL DEFAULT 0,
  "recoverableAmount" NUMERIC NOT NULL DEFAULT 0,
  "exemptAmount" NUMERIC NOT NULL DEFAULT 0,
  "documentTaxableAmount" NUMERIC NOT NULL DEFAULT 0,
  "documentTaxAmount" NUMERIC NOT NULL DEFAULT 0,
  "currencyCode" TEXT,
  "exchangeRate" NUMERIC,
  "taxExemptionReason" "taxExemptionReason",
  "exemptionCertificateNumber" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  CONSTRAINT "taxLedger_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "taxLedger_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_postingDate_idx" ON "taxLedger" ("companyId", "postingDate");
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_documentId_idx" ON "taxLedger" ("companyId", "documentId");
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_journalId_idx" ON "taxLedger" ("companyId", "journalId");
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_taxAuthorityId_idx" ON "taxLedger" ("companyId", "taxAuthorityId");
CREATE INDEX IF NOT EXISTS "taxLedger_createdBy_idx" ON "taxLedger" ("createdBy");

-- Account-default renames (grill 2). No live SQL function reads the old names.
DO $$ BEGIN
  ALTER TABLE "accountDefault" RENAME COLUMN "salesTaxPayableAccount" TO "taxReceivedAccount";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accountDefault" RENAME COLUMN "purchaseTaxPayableAccount" TO "taxPaidAccount";
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Columns
ALTER TABLE "item" ADD COLUMN IF NOT EXISTS "taxable" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "memo" ADD COLUMN IF NOT EXISTS "taxAmount" NUMERIC NOT NULL DEFAULT 0;
```

4. Add `taxCodeId` and its composite FK to each of these tables. Repeat this block once per table, with `<t>` replaced by the table name: `customerTax`, `supplierTax`, `customerLocation`, `quoteLine`, `salesOrderLine`, `salesInvoiceLine`, `rentalAgreement`, `rentalAgreementCharge`, `customerContractLine`, `supplierQuoteLinePrice`, `purchaseOrderLine`, `purchaseInvoiceLine`, `memo`.

```sql
ALTER TABLE "<t>" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "<t>" ADD CONSTRAINT "<t>_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "<t>_taxCodeId_idx" ON "<t>" ("taxCodeId");
```

5. Recreate these views so they show `taxCodeId`: `salesInvoiceLines`, `purchaseInvoiceLines`, `salesOrderLines`, `quoteLines`, `purchaseOrderLines`, `supplierQuoteLines`. For each view:
   1. Find its newest definition: `grep -l 'VIEW "<view>"' packages/database/supabase/migrations/*.sql | sort | tail -1`.
   2. Copy that definition into this migration unchanged.
   3. Put `DROP VIEW IF EXISTS "<view>";` before it.
   4. Keep `WITH (SECURITY_INVOKER = true)` (lesson "`CREATE OR REPLACE VIEW` without `WITH (...)` silently drops `security_invoker`").
6. Do not add `CREATE POLICY`, `ENABLE ROW LEVEL SECURITY` or `attach_event_trigger`. Task 2 and Task 3 ship them.

If a view in step 5 depends on another view that must also be recreated, STOP and report the chain.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_multi-jurisdiction-tax.sql
# Expected: 5
grep -c "_taxCodeId_fkey" packages/database/supabase/migrations/*_multi-jurisdiction-tax.sql
# Expected: 13
grep -c "CREATE POLICY" packages/database/supabase/migrations/*_multi-jurisdiction-tax.sql
# Expected: 0
```

**Out of scope:** Phase 2 tables (`taxReturn`, layouts), `taxReturnId`, `needsEngineReconciliation`, `taxPayableAccount`, `taxReceivableAccount`. The `salesInvoices` view (Task 17).

## Task 2: Add authz rules, event attachments and audit entries

**Depends on:** 1
**Files:**
- Modify: `packages/database/src/authz/manifest.ts` — five rules
- Modify: `packages/database/src/event-system/attachments.ts` — four entries
- Modify: `packages/database/src/audit.config.ts` — three entities and one display entry
- Copy from (precedent): `paymentTerm` in `manifest.ts:1105` and `attachments.ts:255`; `paymentTerm: ["name"]` in `audit.config.ts`

**Steps:**
1. Add to `manifest.ts`, in alphabetical position:

```ts
taxAuthority: company("accounting", {
  read: anyOf("accounting_view", "sales_view", "purchasing_view")
}),
taxCode: company("accounting", {
  read: anyOf("accounting_view", "sales_view", "purchasing_view")
}),
taxCodeComponent: company("accounting", {
  read: anyOf("accounting_view", "sales_view", "purchasing_view")
}),
taxRegistration: company("accounting", {
  read: anyOf("accounting_view", "sales_view", "purchasing_view")
}),
taxLedger: company("accounting", {
  read: anyOf("accounting_view", "sales_view", "purchasing_view"),
  create: false,
  update: false,
  delete: false
}),
```

2. If `company()` rejects the `delete` key, STOP and report. Do not write a custom policy.
3. Add to `attachments.ts`:

```ts
taxAuthority: { statement: ["broadcast_reference_changes"] },
taxCode: { statement: ["broadcast_reference_changes"] },
taxCodeComponent: { statement: ["broadcast_reference_changes"] },
taxRegistration: { statement: ["broadcast_reference_changes"] },
```

4. In `audit.config.ts`, add entities for `taxCode` (with `taxCodeComponent` as an extension, the way `customer` carries `customerTax`), `taxAuthority` and `taxRegistration`. Copy the `paymentTerm` entity's shape.
5. Add `taxCode: ["name"]` to the FK display map, next to `paymentTerm: ["name"]`.

**Verify:**
```bash
pnpm --filter @carbon/database test -- src/authz
# Expected: all tests pass except migration.test.ts, which passes after Task 3
```

**Out of scope:** policies for existing tables.

## Task 3: Apply the migration, regenerate types, ship the authz migration

**Depends on:** 1, 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_multi-jurisdiction-tax-rls.sql` (generated)
- Modify: `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts` (generated)

**Steps:**
1. 🛑 If the local stack is down, STOP and ask the user to run `crbn up`. Never rebuild the database.
2. Run `pnpm db:migrate`.
3. Run `pnpm run generate:types`.
4. Run `pnpm --filter @carbon/database authz migration multi-jurisdiction-tax-rls`.
5. Run `pnpm db:migrate` again to apply the generated migration.

**Verify:**
```bash
grep -c '"taxLedger"' packages/database/src/types.ts
# Expected: a number greater than 0
grep -c 'taxReceivedAccount' packages/database/src/types.ts
# Expected: a number greater than 0
pnpm --filter @carbon/database test -- src/authz/migration.test.ts
# Expected: passes
```

**Out of scope:** fixing type errors in callers (Task 4).

## Task 4: Follow the account-default renames through code, seed data and backups

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts:481-486` — rename fields; messages "Tax Received account is required", "Tax Paid account is required"
- Modify: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx:306-318` — names, labels `t\`Tax Received\`` and `t\`Tax Paid\``, badges "Liability" and "Asset", term ids `account-default-tax-received` and `account-default-tax-paid`
- Modify: `packages/database/src/account-import.ts:80-81` — `ROLE_NAMES` keys and labels "Tax Received", "Tax Paid"
- Modify: `packages/database/src/account-import.ts:166-209` — add `REFERENCE_POLICY` entries
- Modify: `packages/database/src/accounting-cutover/shared.ts:92-93` — `ACCOUNT_DEFAULT_COLUMNS`
- Modify: `packages/server-functions/src/post-sales-invoice/posting-accounts.ts:74,295` — read `defaults.taxReceivedAccount`
- Modify: `packages/server-functions/src/post-sales-invoice/posting-lines.test.ts:61`, `packages/server-functions/src/post-reimbursement/post-reimbursement-test-fixture.ts:40-41` — fixture keys
- Modify: `packages/database/src/seed-data.ts` — accounts and defaults
- Modify: `docs/content/src/glossary/terms.ts:728-735` — glossary keys and text
- Modify: `packages/jobs/src/backups/renames.ts` — `LIVE_COLUMN_RENAMES`
- Modify: `packages/jobs/manifests/schema.json` (generated)

**Steps:**
1. Run `git grep -n "salesTaxPayableAccount\|purchaseTaxPayableAccount" -- ':!*.sql' ':!packages/database/src/types.ts' ':!packages/database/src/swagger-docs-schema.ts' ':!.ai'`.
2. Rename every hit to `taxReceivedAccount` or `taxPaidAccount`.
3. In `seed-data.ts`, rename account 2210 to "Tax Received". Keep its key, number and class.
4. In `seed-data.ts`, replace the 2220 "Purchase Tax Payable" entry with this entry:

```ts
{
  key: "1170",
  number: "1170",
  name: "Tax Paid",
  isGroup: false,
  parentKey: "receivables",
  accountType: "Other Current Asset",
  incomeBalance: "Balance Sheet",
  class: "Asset",
  consolidatedRate: "Current",
  createdBy: "system"
},
```

5. In `seed-data.ts` `accountDefaults`, set `taxReceivedAccount: "2210"` and `taxPaidAccount: "1170"`.
6. Run `git grep -n '"2220"' -- packages`. If a dataset or test still names 2220, change it to 1170.
7. In `account-import.ts` `REFERENCE_POLICY`, add:

```ts
{ table: "taxCodeComponent", column: "taxReceivedAccountId", policy: "repoint" },
{ table: "taxCodeComponent", column: "taxPaidAccountId", policy: "repoint" },
```

8. In the glossary, rename `account-default-sales-tax-payable` to `account-default-tax-received`: "Tax Received (default): GL liability account credited with tax collected from customers."
9. Rename `account-default-purchase-tax-payable` to `account-default-tax-paid`: "Tax Paid (default): GL asset account debited with the recoverable share of tax paid to suppliers."
10. In `renames.ts`, add to `LIVE_COLUMN_RENAMES`:

```ts
// 2026-10 (multi-jurisdiction tax): the tax account defaults took Odoo's
// names. Both columns kept their values; only the names changed.
accountDefault: {
  salesTaxPayableAccount: "taxReceivedAccount",
  purchaseTaxPayableAccount: "taxPaidAccount"
},
```

11. Run `pnpm db:check:backups` to regenerate `packages/jobs/manifests/schema.json`. If it skips with "no connection", see memory "Shell SUPABASE_DB_URL overrides worktree": export the `.env.local` URL first.

**Verify:**
```bash
git grep -n "salesTaxPayableAccount\|purchaseTaxPayableAccount" -- ':!*.sql' ':!.ai' ':!packages/jobs/src/backups/renames.ts'
# Expected: no output
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database --filter=@carbon/server-functions --filter=@carbon/jobs
# Expected: all tasks successful
pnpm --filter @carbon/server-functions test -- src/post-sales-invoice
# Expected: all tests pass
pnpm db:check:backups
# Expected: success, schema.json staged
```

**Out of scope:** renaming or reclassifying an existing company's 2210 or 2220 account (grill 2). `reverseChargeSalesTaxPayableAccount`.

## Task 5: Write the pure tax-component helpers with tests

**Depends on:** none (types only)
**Files:**
- Create: `packages/database/src/tax-components.ts`
- Create: `packages/database/src/tax-components.test.ts`
- Modify: `packages/database/package.json` — export `"./tax-components"` next to `"./sales-posting-amounts"` (line 69)
- Modify: `packages/utils/src/index.ts` — re-export, as for `sales-posting-amounts`
- Copy from (precedent): `packages/database/src/build-memo-journal.ts` and its test (pure helper, relative imports, `vitest`)

**Steps:**
1. Write these exports. Every function is pure.

```ts
export type TaxComponentInput = {
  id: string;
  name: string;
  taxAuthorityId: string | null;
  taxPercent: number;          // 0..1
  recoverablePercent: number;  // 0..1
  sequence: number;
  isCompound: boolean;
  taxReceivedAccountId: string | null;
  taxPaidAccountId: string | null;
  effectiveDate: string | null;   // YYYY-MM-DD
  expirationDate: string | null;  // YYYY-MM-DD
};

export type TaxCodeInput = {
  id: string;
  calculationType: "Normal" | "Reverse Charge";
  taxesShipping: boolean;
  components: TaxComponentInput[];
};

/** Components effective on `date`: (!effectiveDate || effectiveDate <= date) && (!expirationDate || date <= expirationDate), sorted by sequence. */
export function effectiveComponents(code: TaxCodeInput, date: string): TaxComponentInput[];

/** Compound-aware rate: a compound component applies to base + the tax of earlier components. */
export function effectiveTaxPercent(components: TaxComponentInput[]): number;

export type ComponentTax = {
  component: TaxComponentInput;
  taxAmount: number;
  recoverableAmount: number;
  nonRecoverableAmount: number;
};

/**
 * Split a line's tax across components in proportion to each component's exact tax,
 * with distributeRoundingResidual at `scale`. Then split each part into recoverable and
 * non-recoverable shares the same way. The parts sum exactly to `lineTax`.
 */
export function splitLineTax(args: {
  base: number;
  lineTax: number;
  components: TaxComponentInput[];
  scale: number;
}): ComponentTax[];

/** The line's tax base including its share of header shipping when the code taxes shipping. */
export function lineTaxBase(args: {
  merchandise: number;
  addOnCost: number;
  shippingCost: number;
  allocatedHeaderShipping: number;
  taxesShipping: boolean;
}): number;

/** Received unit cost: price + (non-recoverable tax + shipping) / quantity. */
export function receiptUnitCost(args: {
  unitPrice: number;
  conversionFactor: number;
  purchaseQuantity: number;
  taxAmount: number;
  recoverableTaxAmount: number;
  shippingCost: number;
}): number;
```

2. Name the internal scale by its use. Pass `SCALE` from `precision.ts` for base amounts. Pass `currency.decimalPlaces` for document amounts. Do not write a literal scale.
3. Write tests for these cases:
   - A component expiring 2026-06-30 and a successor from 2026-07-01: `effectiveComponents` picks one of them on each date.
   - State 6.25% + City 2.00%, neither compound: `effectiveTaxPercent` is 0.0825.
   - GST 5% + compound PST 9.975%: `effectiveTaxPercent` is 0.05 + 0.09975 × 1.05.
   - £1,000 base, 20%, 50% recoverable: one part, tax 200, recoverable 100, non-recoverable 100.
   - `splitLineTax` parts always sum to `lineTax` (use 3 components and an odd cent).
   - `lineTaxBase` with `taxesShipping` false leaves out the header share. With true it includes it.
   - `receiptUnitCost` with recoverable tax equal to tax returns price + shipping / quantity only.
   - `receiptUnitCost` with recoverable tax 0 returns today's value: price / factor + (tax + shipping) / (quantity × factor).

**Verify:**
```bash
pnpm --filter @carbon/database test -- src/tax-components.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/utils
# Expected: all tasks successful
```

**Out of scope:** reading the database. Ledger rows (Task 20).

## Task 6: Add tax models and service functions, with the resolver

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — validators
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — CRUD and resolver
- Create: `apps/erp/app/modules/accounting/tax.test.ts`
- Copy from (precedent): `getPaymentTerms` :4332, `getPaymentTermsList` :4358, `upsertPaymentTerm` :4518, `getDimension` :4757, `upsertDimension` :4769 in `accounting.service.ts`; `dimensionValidator` :869; `calibrationAttempts` repeatable in `apps/erp/app/modules/quality/quality.models.ts:135-152`

**Steps:**
1. Add validators to `accounting.models.ts`:
   - `taxCodeComponentValidator`: `id` optional, `name`, `taxAuthorityId` optional, `taxPercent` 0–1, `recoverablePercent` 0–1, `sequence`, `isCompound`, `taxReceivedAccountId` optional, `taxPaidAccountId` optional, `effectiveDate` optional, `expirationDate` optional. Refine: expiration on or after effective.
   - `taxCodeValidator`: `id` optional, `name`, `description`, `calculationType`, `reportingCategory`, `taxesShipping` (`zfd.checkbox()`), `invoiceMessage`, `countryCode`, `state`, `active`, `components: zfd.repeatableOfType(taxCodeComponentValidator)` with at least one row.
   - `taxAuthorityValidator`: `id` optional, `name`, `supplierId` optional.
   - `taxRegistrationValidator`: `id` optional, `countryCode`, `state`, `registrationNumber`, `effectiveDate`, `endDate`.
   - Export `taxCalculationTypes` and `taxReportingCategories` as `const` arrays typed from `Database["public"]["Enums"]`.
2. Add service functions to `accounting.service.ts`. Each takes `client` first and returns `{ data, error }`. Add `/** @mcp read */` or `/** @mcp upsert */` tags as the payment-term functions do.
   - `getTaxCodes(client, companyId, args)`, `getTaxCodesList(client, companyId)` (id, name, effective rate, `taxesShipping`), `getTaxCode(client, taxCodeId)` (selects `"*, taxCodeComponent(*)"`).
   - `upsertTaxCode(client, taxCode, components)`. Diff components by `id`: update the rows that keep an id, insert the rows with no id, delete the rows that are missing.
   - `deleteTaxCode(client, taxCodeId)`. Set `active = false`. Never delete a code that a line references.
   - `getTaxAuthorities`, `getTaxAuthoritiesList`, `getTaxAuthority`, `upsertTaxAuthority`, `deleteTaxAuthority`.
   - `getTaxRegistrations`, `getTaxRegistration`, `upsertTaxRegistration`, `deleteTaxRegistration`.
   - `suggestTaxCodes(client, companyId, { countryCode, state })`. Return active codes whose `countryCode` matches, and whose `state` matches or is null.
   - `resolveLineTaxes(client, companyId, args)` with the signature from the spec ("API / Service Changes").
3. Make `resolveLineTaxes` a thin loader around a pure function in `accounting.service.ts`:

```ts
export function decideLineTax(facts: {
  source: "sales" | "purchase";
  taxExempt: boolean;
  taxExemptionReason: string | null;
  itemTaxable: boolean;
  locationTaxCode: TaxCodeInput | null;
  partyTaxCode: TaxCodeInput | null;
  fallbackTaxPercent: number;
  date: string;
}): {
  taxCodeId: string | null;
  taxPercent: number;
  components: TaxComponentInput[];
  exempt: boolean;
  exemptionReason: string | null;
};
```

   The order is the spec's order: exempt, non-taxable item, location code, party code, fallback percent. A purchase line ignores `locationTaxCode`.
4. Load the facts in one round trip per table:
   - `customerTax` (taxExempt, reason, `taxCodeId`)
   - `customerLocation.taxCodeId`
   - `item.taxable`
   - the codes with components
   - `customer.taxPercent` or `supplier.taxPercent`
5. In `tax.test.ts`, test `decideLineTax` with these cases:
   - exempt beats every code
   - a non-taxable item gives zero tax with no reason
   - a location code beats the party code
   - no code returns the fallback percent with a null `taxCodeId`
   - an expired component is not in `components`

**Verify:**
```bash
pnpm --filter erp test -- app/modules/accounting/tax.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** Avalara dispatch (Phase 3). UI.

## Task 7: Add the tax code API route and the `TaxCode` select

**Depends on:** 6
**Files:**
- Create: `apps/erp/app/routes/api+/accounting.tax-codes.ts`
- Create: `apps/erp/app/components/Form/TaxCode.tsx`
- Modify: `apps/erp/app/components/Form/index.ts` — export `TaxCode` and `useTaxCodes`
- Modify: `apps/erp/app/utils/path.ts` — `api.taxCodes`
- Modify: `apps/erp/app/components/emptyStates.tsx` — `"taxCode"` entry
- Copy from (precedent): `apps/erp/app/routes/api+/accounting.payment-terms.ts`, `apps/erp/app/components/Form/PaymentTerm.tsx`, `emptyStates.tsx:33,149`

**Steps:**
1. Copy `accounting.payment-terms.ts` to `accounting.tax-codes.ts`. Return `getTaxCodesList(client, companyId)`. Keep `export const clientLoader = cachedClientLoader<typeof loader>()`.
2. Copy `PaymentTerm.tsx` to `TaxCode.tsx`. Rename `usePaymentTerm` to `useTaxCodes`.
3. Each option is `{ value: id, label: name, helper: formatted effective rate }`.
4. Do not offer an inline create. A tax code needs components, so the empty state links to `path.to.newTaxCode`.
5. Add `onChange` that passes the selected code's effective rate, so a line form can set `taxPercent`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** using the select in forms (Tasks 10–13).

## Task 8: Build the Tax Codes screens

**Depends on:** 6
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/tax-codes.tsx`, `tax-codes.new.tsx`, `tax-codes.$taxCodeId.tsx`, `tax-codes.delete.$taxCodeId.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Tax/TaxCodeForm.tsx`, `TaxCodesTable.tsx`, `index.ts`
- Modify: `apps/erp/app/utils/path.ts` — `taxCodes`, `taxCode(id)`, `newTaxCode`, `deleteTaxCode(id)`
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — a "Tax" group
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/dimensions.tsx`, `dimensions.new.tsx`, `dimensions.$dimensionId.tsx`, `dimensions.delete.$dimensionId.tsx`; `apps/erp/app/modules/accounting/ui/Dimensions/DimensionForm.tsx`, `DimensionsTable.tsx`; the component grid from `apps/erp/app/modules/quality/ui/Calibrations/GaugeCalibrationRecordForm.tsx:322-358`

**Steps:**
1. Copy the four dimension routes. Change `getDimensions` to `getTaxCodes(client, companyId, …)`. Change the permissions to `view: "accounting"` and `update: "accounting"`, as the dimension routes have.
2. Copy `DimensionForm` to `TaxCodeForm`. Add the header fields: Name, Description, Calculation Type (Select), Reporting Category (Select), Taxes Shipping (Boolean), Invoice Message (TextArea), Country, State.
3. Replace the `Array` field with a component grid copied from `GaugeCalibrationRecordForm.tsx:322-358`.
   - Each row has Name, Authority (Combobox from `getTaxAuthoritiesList`), Rate %, Recoverable %, Compound, Tax Received account, Tax Paid account, Effective, Expires.
   - Use `components[${index}].field` names. Rates use `INPUT_FORMAT` percent kinds from `@carbon/utils`, never inline digits.
4. Show the effective rate under the grid. Compute it with `effectiveTaxPercent` and today's date in the company timezone.
5. Copy `DimensionsTable` to `TaxCodesTable`. Columns: Name, Rate, Calculation Type, Reporting Category, Taxes Shipping, Active.
6. In `useAccountingSubmodules.tsx`, add a group `t\`Tax\`` before "Configure". Entries: Tax Codes (`LuReceiptText`), Tax Authorities (`LuLandmark`), Tax Registrations (`LuIdCard`). Task 35 adds Tax Liability.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```
Browser: open `/x/accounting/tax-codes`. Create "TX – Austin" with State 6.25% and City 2.00%. The table shows 8.25%.

**Out of scope:** provider mapping on this form (it lives in the integration drawer, Task 28).

## Task 9: Build the Tax Authorities and Tax Registrations screens

**Depends on:** 6
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/tax-authorities.tsx`, `tax-authorities.new.tsx`, `tax-authorities.$taxAuthorityId.tsx`, `tax-authorities.delete.$taxAuthorityId.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/tax-registrations.tsx`, `tax-registrations.new.tsx`, `tax-registrations.$taxRegistrationId.tsx`, `tax-registrations.delete.$taxRegistrationId.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Tax/TaxAuthorityForm.tsx`, `TaxAuthoritiesTable.tsx`, `TaxRegistrationForm.tsx`, `TaxRegistrationsTable.tsx`
- Modify: `apps/erp/app/utils/path.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/payment-terms.tsx`, `payment-terms.new.tsx`, `payment-terms.$paymentTermId.tsx`, `payment-terms.delete.$paymentTermId.tsx`; `apps/erp/app/modules/accounting/ui/PaymentTerms/*`

**Steps:**
1. Copy the payment-terms routes and UI twice, once per record type.
2. Authority fields: Name, Supplier (the existing `Supplier` combobox).
3. Registration fields: Country, State, Registration Number, Effective, End.
4. On the registrations list, show an `Alert variant="warning"` when an active code's country has no registration. Show another when a registration's country has no active code. Copy the alert from `apps/erp/app/routes/x+/reports+/lease-liabilities.tsx:457-478`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** the Avalara nexus check (Phase 3).

## Task 10: Add code assignment to customers, suppliers, locations and items

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomerTaxForm.tsx`, `apps/erp/app/modules/purchasing/ui/Supplier/SupplierTaxForm.tsx` — `TaxCode` field
- Modify: `apps/erp/app/modules/sales/sales.models.ts:101` (`customerTaxValidator`), `apps/erp/app/modules/purchasing/purchasing.models.ts:390` (`supplierTaxValidator`) — `taxCodeId` optional
- Modify: `apps/erp/app/modules/sales/sales.service.ts:3378` (`updateCustomerTax`), `apps/erp/app/modules/purchasing/purchasing.service.ts:1677` (`updateSupplierTax`) — write `taxCodeId`
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomerLocationForm.tsx`, `sales.models.ts:79` (`customerLocationValidator`), `sales.service.ts:2166` (`insertCustomerLocation`), `sales.service.ts:3315` (`updateCustomerLocation`)
- Modify: `apps/erp/app/modules/items/ui/Parts/PartProperties.tsx`, `ToolProperties.tsx`, `MaterialProperties.tsx`, `ServiceProperties.tsx`, `ConsumableProperties.tsx` — "Taxable" switch
- Modify: `apps/erp/app/routes/x+/items+/update.tsx` — `"taxable"` case
- Copy from (precedent): the `active` switch in `PartProperties.tsx:770-790` and the `"active"` case in `update.tsx:161-196`

**Steps:**
1. Add `<TaxCode name="taxCodeId" label={t\`Tax Code\`} />` to both tax forms, above the exemption fields.
2. Under the select, show the first `suggestTaxCodes` result for the party's address as a one-click "Use {name}" button. Load the suggestion in the tax route's loader.
3. Add `taxCodeId` to `customerLocationValidator` and the location form.
4. 🛑 `updateCustomerLocation` writes the `customerLocation` row only inside `if (customerLocation.customFields)`. Change it so it also writes when `taxCodeId` is present. Keep the address update as it is.
5. Add the Taxable switch next to Active in each of the five properties panels. Post `field: "taxable"`.
6. In `update.tsx`, add a `"taxable"` case: `client.from("item").update({ taxable: value === "on", updatedBy, updatedAt }).in("id", items).eq("companyId", companyId)`. Extend the `field` union type.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```
Browser: assign "TX – Austin" on a customer's Tax card, reload, and see it kept.

**Out of scope:** supplier locations (suppliers resolve from `supplierTax` only). The bulk assign action (Task 37).

## Task 11: Resolve tax codes on sales document lines

**Depends on:** 6, 7
**Files:**
- Modify: `apps/erp/app/routes/x+/quote+/$quoteId.tsx`, `apps/erp/app/routes/x+/sales-order+/$orderId.tsx`, `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.tsx` — loaders return `resolvedTax` for the customer
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteExplorer.tsx:102`, `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderExplorer.tsx:147`, `apps/erp/app/routes/x+/sales-order+/$orderId.new.tsx:203`, `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceExplorer.tsx:78`, `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.new.tsx:202` — initial values
- Modify: the quote, sales order and sales invoice line forms (`QuoteLineForm.tsx`, `SalesOrderLineForm.tsx`, `SalesInvoiceLineForm.tsx`) — `TaxCode` select
- Modify: the line validators in `sales.models.ts` and `invoicing.models.ts` — `taxCodeId` optional
- Modify: the line upsert services in `sales.service.ts` and `invoicing.service.ts` — write `taxCodeId`
- Create: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.recalculate-taxes.tsx`, `apps/erp/app/routes/x+/sales-order+/$orderId.recalculate-taxes.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.exchange-rate.tsx` (the post action with `requireUnlocked` and referrer redirect); the refresh `IconButton` in `SalesInvoiceProperties.tsx:449-460`

**Steps:**
1. In each parent loader, call `resolveLineTaxes(client, companyId, { source: "sales", customerId, customerLocationId: shipToId, date: documentDate })` with no `itemId`. Return it as `resolvedTax`.
2. In each explorer and `new` route, set the initial values `taxCodeId: resolvedTax.taxCodeId` and `taxPercent: resolvedTax.taxPercent`. This replaces `customer.taxPercent` on quotes and orders and the hard-coded 0 on invoices.
3. In each line-create action, call `resolveLineTaxes` with the line's `itemId` when the form sent no `taxCodeId`. Use the result. A user who picked a code in the form keeps it.
4. In each line form, add `<TaxCode name="taxCodeId" />` beside the tax percent field. When the user picks a code, set `taxPercent` to the code's effective rate.
5. `SalesInvoiceLineForm` uses `useTaxPair` (`:226-237`). Feed the new percent into the pair so the amount re-derives.
6. Add the two recalculate-taxes routes. Each re-runs the resolver for every line with no manual override, and writes `taxCodeId` and `taxPercent`. Add a refresh `IconButton` next to the ship-to field on the order and the invoice.
7. The audit log records old and new `taxCodeId` on the line automatically (`audit.config.ts` diffs whole rows).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```
Browser: a sales order line for the "TX – Austin" customer defaults to 8.25% with the code shown. A new sales invoice line defaults to the same.

**Out of scope:** posting (slice B). Quote line prices on the share page (they read `taxPercent`).

## Task 12: Resolve tax codes on purchase document lines

**Depends on:** 6, 7
**Files:**
- Modify: `apps/erp/app/routes/x+/purchase-order+/$orderId.tsx`, `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.tsx` — loaders return `resolvedTax` for the supplier
- Modify: `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderExplorer.tsx:82`, `apps/erp/app/routes/x+/purchase-order+/$orderId.new.tsx:131`, `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceExplorer.tsx:83`, `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.new.tsx:118`
- Modify: `PurchaseOrderLineForm.tsx` (`:190`, `:237`, `:911`, `:1116`), `PurchaseInvoiceLineForm.tsx` (`:192`, `:316`, `:883`, `:1114`) — `TaxCode` select and a read-only "Recoverable" amount
- Modify: the supplier quote line price form and its validator — `taxCodeId`
- Modify: `apps/erp/app/routes/x+/purchasing+/planning.update.tsx:725` — use the resolver
- Copy from (precedent): Task 11's changes

**Steps:**
1. Repeat Task 11 steps 1–5 for purchase orders, purchase invoices and supplier quotes. Use `source: "purchase"` and `supplierId`.
2. Keep the purchase tax pair (`supplierTaxAmount`, `taxPercent`) intact. Picking a code sets `taxPercent`, and the pair derives `supplierTaxAmount`. The supplier's invoice can still override the amount.
3. Show "Recoverable: {amount}" under the tax fields. Compute it with `splitLineTax` and the code's components.
4. In `planning.update.tsx`, replace `supplier.taxPercent ?? 0` with the resolver's `taxPercent`, and write `taxCodeId` on the new line.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** the receipt (Task 19). Posting.

## Task 13: Carry tax codes through rentals, contracts, fixed assets, conversions and billing generators

**Depends on:** 6, 7
**Files:**
- Modify: `apps/erp/app/routes/x+/rental-agreement+/new.tsx:149` and the rental agreement and charge forms — `taxCodeId`
- Modify: `apps/erp/app/routes/x+/contract+/$id.lines.new.tsx:98` and `ContractLineForm` — `taxCodeId`. 🛑 This form shows percent in 0–100 units (`$id.$lineId.details.tsx:129` multiplies by 100). Convert the code's rate the same way.
- Modify: `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.sell.tsx:124`, `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.purchase.tsx:137` — use the resolver instead of 0
- Modify: `packages/server-functions/src/convert/index.ts:437,733,1014,1637,1822` — copy `taxCodeId` next to `taxPercent`
- Modify: `packages/server-functions/src/create-rental-invoices/index.ts:403,419` (add `"c.taxCodeId"` to the charge select at `:318-326`), `packages/server-functions/src/create-contract-invoices/index.ts:720`
- Modify: `packages/server-functions/src/create-lease-invoices/index.ts:237,268-269` — resolve the supplier's code
- Copy from (precedent): the existing `taxPercent` lines at each site

**Steps:**
1. Add `taxCodeId` wherever `taxPercent` is copied at the listed lines.
2. In `create-lease-invoices`, read the lease supplier's `supplierTax.taxCodeId`. If it is set, compute `taxPercent` with `effectiveTaxPercent(effectiveComponents(code, dueDate))` and `supplierTaxAmount` with `applyRate`.
3. If the supplier has no code, keep today's zeros.
4. In the fixed-asset routes, call `resolveLineTaxes` with the validator's `customerId` or `supplierId`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: all tasks successful
pnpm --filter @carbon/server-functions test -- src/convert src/create-contract-invoices src/create-rental-invoices src/create-lease-invoices
# Expected: all tests pass
```

**Out of scope:** card charges and reimbursements (grill 3).

## Task 14: Accept a tax code in the customer and supplier CSV import

**Depends on:** 6
**Files:**
- Modify: `apps/erp/app/modules/shared/imports.models.ts` — customer and supplier `taxCodeId` field (near `:842-858` and `:1005-1035`), and `importSchemas` (`:2221`)
- Modify: `packages/server-functions/src/import-csv/index.ts` — write `customerTax.taxCodeId` / `supplierTax.taxCodeId` next to `upsertTaxIdentifiers` (`:1170`); add `{ column: "taxCodeId", table: "taxCode", label: "Tax Code" }` to `REFERENCES.customer` and `REFERENCES.supplier` (`:228-240`)
- Copy from (precedent): the `customerTypeId` enum field (`imports.models.ts:842-858`), without `creatableLookup`

**Steps:**
1. Add the enum field labelled "Tax Code" with a fetcher over active `taxCode` rows.
2. Write the code to the tax satellite row in the same place `taxId` is written.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: all tasks successful
pnpm --filter @carbon/server-functions test -- src/import-csv
# Expected: all tests pass
```

**Out of scope:** importing tax codes themselves.

## Task 15: Seed tax codes in the demo datasets

**Depends on:** 6
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — `TaxCodeSpec`, `TaxAuthoritySpec`, `taxCodes`/`taxAuthorities` on `FoundationData`, `taxCode?` on `CustomerSpec` (`:66`) and `SupplierSpec` (`:78`)
- Modify: `packages/database/src/datasets/data/{satellite,robotics,precision,motor}/foundation.ts`
- Modify: `packages/database/src/datasets/tiers/01-foundation.ts` — insert authorities and codes before the customers (`:342`), then write `customerTax.taxCodeId` / `supplierTax.taxCodeId`
- Modify: `packages/database/src/datasets/validate.ts` — a `taxCode` ref kind in `buildIndex` (`:1079`), `REF_LABELS` (`:1033`), and `need("taxCode", …)` checks
- Modify: `packages/database/src/datasets/coverage.ts` — floors
- Copy from (precedent): `need("customerType", …)` at `validate.ts:1364`; `insertId(ctx, table, values)` from `sql.ts:144`

**Steps:**
1. Give each dataset two authorities and three codes. The Houston-based datasets use "TX – Houston" (State 6.25% + City 2.00%), "Out of State – Exempt" (Exempt, 0%) and "Use Tax 8.25%" (0% recoverable).
2. Assign "TX – Houston" to every Texas customer. Assign none to suppliers, so purchase postings stay as today.
3. State percentages the way people write them (6.25). Let the tier divide by 100 (lesson "Demo datasets state percentages the way people write them").
4. Add floors: `taxAuthority: 2`, `taxCode: 3`, `taxCodeComponent: 4`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass both layers
```

**Out of scope:** `taxLedger` floors (slice B adds them after posting writes rows).

---

# Slice B — Posting

## Task 16: Post sales tax per component, with header-shipping tax

**Depends on:** 5
**Files:**
- Modify: `packages/database/src/sales-posting-amounts.ts` — input fields and the tax leg
- Modify: `packages/server-functions/src/post-sales-invoice/posting-accounts.ts` — component accounts
- Modify: `packages/server-functions/src/post-sales-invoice/posting-lines.ts:72-96` (add `taxCodeId` to the `SalesInvoiceLine` Pick), `:482-790`
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts` — load codes
- Modify: `packages/utils/src/sales-posting-amounts.test.ts` — new cases
- Copy from (precedent): the existing `fixture()` and `byAccount()` helpers in `sales-posting-amounts.test.ts:24-58`

**Steps:**
1. Extend `SalesPostingAmountsInput` (`:9-20`) with:

```ts
taxesShipping?: boolean;
taxComponents?: Array<{ id: string; taxPercent: number; accountId: string | null }>;
```

2. In `calculateSalesPostingAmounts` (`:175-178`), build the base with `lineTaxBase` from `tax-components.ts`. Add `allocatedHeaderShipping` only when `taxesShipping` is true.
3. Change `accounts.tax` in `BuildSalesPostingLinesInput` (`:107-140`) from one account to `tax: SalesPostingAccount` (the default) plus an optional `componentTaxAccounts: Map<string, SalesPostingAccount>`.
4. Replace the single tax push (`:507-513`) with one push per component. Split `salesTaxBase` with `splitLineTax` at `SCALE`. Each part uses the component's account, else the default. The description is `"Tax Received"`.
5. With no components, push one leg to the default account with the description `"Tax Received"`, as today except for the label.
6. In `posting-accounts.ts`, add every component account id to `accountIds`. Return `componentTaxAccounts` from `resolveSalesInvoiceAccounts`.
7. In `post-sales-invoice/index.ts`, after loading the lines (`:125`), load each distinct `taxCodeId` with its components in one query. Filter them with `effectiveComponents` on the invoice's posting date. Pass `taxesShipping` and `taxComponents` per line.
8. Add tests:
   - The fixture with no code gives today's totals (`{sales: 123, shipping: 15, tax: 13, ar: 151}`).
   - Two components 6.25% and 2.00% give two tax legs whose sum equals `salesTaxBase`.
   - `taxesShipping: true` adds the header share to the tax base.
   - A component with its own account posts to that account.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- src/sales-posting-amounts.test.ts
# Expected: all tests pass
pnpm --filter @carbon/server-functions test -- src/post-sales-invoice
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/server-functions
# Expected: all tasks successful
```

**Out of scope:** `taxLedger` writes (Task 21). The invoice view (Task 17).

## Task 17: Tax header shipping in the invoice view, provider components and PDF helpers

**Depends on:** 16
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_sales-invoice-shipping-tax.sql` (via `pnpm db:migrate:new sales-invoice-shipping-tax`)
- Modify: `packages/ee/src/accounting/core/sales-document-components.ts:294-310` — HeaderShipping tax
- Modify: `packages/documents/src/utils/sales-invoice.ts:77-121` — header shipping tax in totals
- Copy from (precedent): the newest `salesInvoices` definition in `20261006221401_sales-invoice-discount-and-ship-to.sql:62-200`

**Steps:**
1. In the migration, `DROP VIEW IF EXISTS "salesInvoices"`. Recreate it from the newest definition, keeping `security_invoker`.
2. Add to `totalTax` (`:166-172`) the header shipping tax:

```sql
+ COALESCE(ss."shippingCost", 0) * COALESCE((
    SELECT SUM(w.weight * w."taxPercent") / NULLIF(SUM(w.weight), 0)
    FROM (
      SELECT
        COALESCE(l."quantity", 0) * COALESCE(l."unitPrice", 0) * (1 - COALESCE(l."discountPercent", 0))
          + COALESCE(l."shippingCost", 0) + COALESCE(l."addOnCost", 0) AS weight,
        CASE WHEN tc."taxesShipping" THEN COALESCE(l."taxPercent", 0) ELSE 0 END AS "taxPercent"
      FROM "salesInvoiceLine" l
      LEFT JOIN "taxCode" tc ON tc."id" = l."taxCodeId" AND tc."companyId" = l."companyId"
      WHERE l."invoiceId" = si."id" AND l."invoiceLineType" <> 'Comment'
    ) w
  ), 0)
```

3. Add the same term to every total in the view that includes `totalTax`.
4. Run `pnpm db:migrate` and `pnpm run generate:types`.
5. In `sales-document-components.ts`, give the HeaderShipping component each line's share at that line's rate when its code has `taxesShipping`. `reconcileSource` (`:177`) compares against the view's `totalTax`, so the two must agree.
6. 🛑 The view weights header shipping without rounding. `allocateSalesHeaderShipping` rounds each share and gives the remainder to the last line. If `reconcileSource` refuses an invoice because of that difference, STOP and report the gap. Do not widen the tolerance.
7. In `packages/documents/src/utils/sales-invoice.ts`, add the same header-shipping tax to `getTotal`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- src/accounting/core/sales-document-components
# Expected: all tests pass
pnpm --filter @carbon/documents test
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/documents --filter=erp
# Expected: all tasks successful
```

**Out of scope:** the purchase invoices view (header freight is never taxed on purchases).

## Task 18: Split purchase tax into recoverable and non-recoverable parts at invoice posting

**Depends on:** 5
**Files:**
- Modify: `packages/server-functions/src/post-purchase-invoice/purchase-posting-amounts.ts`
- Modify: `packages/server-functions/src/post-purchase-invoice/posting-lines.ts`
- Modify: `packages/server-functions/src/post-purchase-invoice/lease-lines.ts`
- Modify: `packages/server-functions/src/post-purchase-invoice/index.ts` — load codes, AP for reverse charge
- Modify: `packages/database/src/accounting-posting.ts:93-118` — add `"TaxPaid"` and `"TaxReceived"` posting roles
- Modify: `purchase-posting-amounts.test.ts`, `posting-lines.test.ts`, `lease-lines.test.ts`
- Copy from (precedent): the zero-PPV case in `purchase-posting-amounts.test.ts:64-107`; the "capitalizes tax and line shipping" case in `posting-lines.test.ts:473`

**Steps:**
1. Add to `PurchasePostingLine` (`:7-20`):

```ts
recoverableTaxAmount?: number;   // base; 0 when no code
taxComponents?: ComponentTax[];  // from splitLineTax
reverseCharge?: boolean;
```

2. Add to `PurchasePostingAmounts` (`:22-30`): `recoverableTaxBase: number`.
3. At `:60`, change the cost to `nominal + shippingCost + taxAmount − recoverableTaxAmount`.
4. 🛑 Keep the header-freight weights (`:72-90`) on today's gross basis (`nominal + shippingCost + taxAmount`). Only the cost changes. A 0% recoverable company's freight allocation must not move.
5. In `posting-lines.ts`, after each line's debits, add one debit per component with `recoverableAmount > 0`. The account is the component's `taxPaidAccountId`, else `defaults.taxPaidAccount`. The description is `"Tax Paid"`. AP still credits the gross.
6. For a Reverse Charge code, the supplier charged no tax:
   1. Compute the tax from the code's rate on the net.
   2. Debit Tax Paid with the recoverable share.
   3. Debit cost with the non-recoverable share.
   4. Credit `reverseChargeSalesTaxPayableAccount` with the full tax.
   5. Leave AP at the net.
7. In `lease-lines.ts`, send only the non-recoverable tax to `extrasAccount`. The recoverable tax goes to Tax Paid.
8. In `index.ts`, load codes and components for the lines' `taxCodeId` values in one query (`:747`). Split each line's `taxAmount` with `splitLineTax` at `SCALE`.
9. Add tests:
   - £1,000 net, 20%, 100% recoverable: Dr cost 1,000 / Dr Tax Paid 200 / Cr AP 1,200.
   - £1,000 net, 20%, 50% recoverable: Dr cost 1,100 / Dr Tax Paid 100 / Cr AP 1,200.
   - Reverse Charge 20%, 100% recoverable: Dr cost 1,000 / Dr Tax Paid 200 / Cr Reverse Charge 200 / Cr AP 1,000.
   - No code: the "capitalizes tax and line shipping" case is unchanged.
   - Zero PPV when the receipt used `receiptUnitCost` with the same split (pairs with Task 19).

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- src/post-purchase-invoice
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/server-functions --filter=@carbon/database
# Expected: all tasks successful
```

**Out of scope:** the "Accrue use tax" action (Phase 2).

## Task 19: Leave recoverable tax out of the received unit cost

**Depends on:** 5
**Files:**
- Modify: `packages/server-functions/src/create/index.ts:1037-1053` — `receiptFromPurchaseOrder`
- Copy from (precedent): `receiptUnitCost` from Task 5

**Steps:**
1. Load the components for the purchase order lines' `taxCodeId` values in one query, after the line select at `:906-916`.
2. Compute each line's recoverable tax with `splitLineTax`.
3. Replace `:1037-1039` and `:1053` with `receiptUnitCost({ unitPrice, conversionFactor, purchaseQuantity, taxAmount, recoverableTaxAmount, shippingCost })`.
4. With no code, `recoverableTaxAmount` is 0 and the unit cost is unchanged.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- src/create
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: all tasks successful
```

**Out of scope:** the `(1 + taxPercent)` shipment unit prices at `create/index.ts:2674,2921,3005,3221,3309`. `post-shipment` never reads them. Fixed-asset receipts (`post-receipt/index.ts:1907-1909`).

## Task 20: Write the pure tax-ledger row builder with tests

**Depends on:** 5
**Files:**
- Create: `packages/database/src/tax-ledger.ts`
- Create: `packages/database/src/tax-ledger.test.ts`
- Modify: `packages/database/package.json` — export `"./tax-ledger"`
- Modify: `packages/utils/src/index.ts` — re-export

**Steps:**
1. Write the builder:

```ts
export type TaxLedgerRow = Omit<
  Database["public"]["Tables"]["taxLedger"]["Insert"],
  "id" | "createdAt"
>;

export function buildTaxLedgerRows(args: {
  companyId: string;
  createdBy: string;
  source: "Sales" | "Purchase";
  documentType: "Sales Invoice" | "Purchase Invoice" | "Memo";
  documentId: string;
  journalId: string;
  postingDate: string;
  partyId: { customerId?: string; supplierId?: string };
  currencyCode: string;
  exchangeRate: number;
  currencyDecimals: number;
  sign: 1 | -1;
  lines: Array<{
    documentLineId: string | null;
    taxCodeId: string | null;
    taxableBase: number;        // base currency
    components: ComponentTax[]; // empty for a legacy or exempt line
    taxPercent: number;         // the line's rate, used when components is empty
    exempt: { reason: string | null; certificateNumber: string | null } | null;
  }>;
}): TaxLedgerRow[];
```

2. Write one row per component. A line with no components writes one row with `taxCodeId` null and the line's rate.
3. An exempt or non-taxable line writes one row with `exemptAmount` = the base and zero tax.
4. Convert to document currency with `toDocumentAmount(base, exchangeRate, currencyDecimals)`.
5. `sign: -1` negates every amount (voids and credit memos).
6. Test: a two-component line, a legacy line, an exempt line, a void, and a foreign-currency line.

**Verify:**
```bash
pnpm --filter @carbon/database test -- src/tax-ledger.test.ts
# Expected: all tests pass
```

**Out of scope:** inserting rows (Task 21).

## Task 21: Write `taxLedger` rows when sales and purchase invoices post and void

**Depends on:** 16, 18, 20
**Files:**
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts` — after the journal-line insert (`:1040-1049`); void (`:1456`, insert after `:2005`)
- Modify: `packages/server-functions/src/post-sales-invoice/posting-lines.ts` — `SalesInvoiceJournal` (`:309-356`) returns the ledger inputs
- Modify: `packages/server-functions/src/post-purchase-invoice/index.ts` — after `:1808`; void (insert after `:590`)
- Modify: `packages/database/src/datasets/coverage.ts` — `taxLedger` floor
- Create: `packages/server-functions/src/post-sales-invoice/tax-ledger.test.ts`, `packages/server-functions/src/post-purchase-invoice/tax-ledger.test.ts`
- Copy from (precedent): `databaseTest` from `packages/server-functions/src/local-database-test-fixture.ts`; `packages/server-functions/src/always-post-invoice.test.ts`

**Steps:**
1. Return the per-line ledger inputs from `buildSalesInvoiceJournal` beside `lines`.
2. Inside the existing transaction, after the journal-line insert, call `buildTaxLedgerRows` with `journalId: journalResult.id` and `sign: 1`.
3. Insert the rows with `trx.insertInto("taxLedger").values(rows)`. Every row carries `companyId`.
4. Snapshot `customerTax.taxExempt`, the reason and the certificate number for exempt lines.
5. In the void path, read the original rows by `documentId`. Insert negated copies with the void `journalId`.
6. Do the same in `post-purchase-invoice` with `recoverableAmount` from Task 18.
7. A zero-line invoice writes no journal and no ledger rows.
8. Write `databaseTest` integration tests:
   - "TX – Austin": two ledger rows, bases and taxes as in the spec.
   - A void writes negated rows that net to zero per document.
   - A posted invoice before the cutover writes rows against a Provisional journal.
9. After the tests pass, run `pnpm db:check:datasets`. Measure `taxLedger` per dataset. Set the floor to the smallest count × 0.8.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- src/post-sales-invoice src/post-purchase-invoice
# Expected: all tests pass (integration tests run only with a local database)
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** memo rows (Task 22). Legacy rows (Task 24).

## Task 22: Post memo tax

**Depends on:** 20
**Files:**
- Modify: `packages/database/src/build-memo-journal.ts` — tax leg
- Modify: `packages/database/src/build-memo-journal.test.ts`
- Modify: `packages/server-functions/src/post-memo/post-memo-transaction.ts` — tax account, ledger rows, void
- Modify: `packages/server-functions/src/post-memo/rebuild-journal.ts` — pass the tax
- Copy from (precedent): the reason leg in `build-memo-journal.ts`

**Steps:**
1. Add to `BuildMemoJournalInput`: `taxAmount?: number` (document currency) and `taxAccountId?: string`.
2. If `taxAmount > 0`, the reason leg takes `amount − taxAmount`. A tax leg takes `taxAmount` on the same side as the reason leg.
3. The tax account is Tax Received for a customer memo and Tax Paid for a supplier memo. Read `defaults.taxReceivedAccount` / `defaults.taxPaidAccount`, else the code's component account.
4. In `post-memo-transaction.ts`, read `memo.taxCodeId` and `memo.taxAmount`. Pass them to `buildMemoJournal`.
5. After the journal insert (`:554`), write ledger rows with `buildTaxLedgerRows`. Use `sign: -1` for a customer Credit memo and a supplier Debit memo. Use `sign: 1` for the other two combinations.
6. 🛑 Contract and rental credits replace the reason leg (`lines.splice(1, 1, ...contractLegs)`, `:501-534`). Keep the tax leg outside the spliced range.
7. Test: a £1,200 customer Credit memo with £200 tax posts Dr reason 1,000 / Dr Tax Received 200 / Cr AR 1,200. A memo without tax posts as today.

**Verify:**
```bash
pnpm --filter @carbon/database test -- src/build-memo-journal.test.ts
# Expected: all tests pass
pnpm --filter @carbon/server-functions test -- src/post-memo
# Expected: all tests pass
```

**Out of scope:** the memo form (Task 23).

## Task 23: Enter memo tax in the memo form and in memos made from a source

**Depends on:** 22
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts:492-511` (`memoValidator`) — `netAmount`, `taxCodeId`
- Modify: `apps/erp/app/modules/invoicing/ui/Memo/MemoForm.tsx:122-129`
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts:3948-3976` (`upsertMemo`)
- Modify: `apps/erp/app/modules/sales/sales.service.ts:8055` (`createSalesReturnOrderCredit`), `apps/erp/app/modules/purchasing/purchasing.service.ts:4965`, `packages/server-functions/src/post-customer-contract/index.ts:1747`, `packages/server-functions/src/create-rental-invoices/index.ts:495`
- Copy from (precedent): `useTaxPair` in `apps/erp/app/components/Form/TaxFields.tsx`

**Steps:**
1. Replace the `amount` input with Net Amount, Tax Code, a read-only Tax, and a read-only Gross.
2. Compute the tax as `applyRate(netAmount, effectiveTaxPercent(components), currency.decimalPlaces)`.
3. `upsertMemo` stores `amount = net + tax`, `taxAmount` and `taxCodeId`. Never compute tax backwards from a gross amount.
4. Each source creator takes the source lines' `taxCodeId` and rate. If the source lines have more than one code, create one memo per code.
5. The RMA credit total today is net of tax. Add the tax on top so `amount` is gross.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: all tasks successful
pnpm --filter @carbon/server-functions test -- src/post-memo src/create-rental-invoices src/post-customer-contract
# Expected: all tests pass
```
Browser: create a customer credit memo with Net 1,000 and "UK Standard 20%". The form shows Tax 200 and Gross 1,200.

**Out of scope:** memo lines (grill 5: two rates means two memos).

## Task 24: Write `taxLedger` rows in the legacy backfill

**Depends on:** 21
**Files:**
- Modify: `packages/server-functions/src/activate-accounting/legacy/sales-invoice.ts`, `purchase-invoice.ts`, `memo.ts`
- Modify: `packages/server-functions/src/activate-accounting/legacy/write.ts:37,174` — carry ledger inputs on `LegacyJournal`
- Modify: `packages/server-functions/src/activate-accounting/legacy/index.ts:89-120` — insert rows after the journal ids come back

**Steps:**
1. Add `taxLedger?: Omit<Parameters<typeof buildTaxLedgerRows>[0], "journalId">` to `LegacyJournal`.
2. Fill it in each builder from the same inputs Task 21 uses.
3. `insertProvisionalJournals` returns ids in input order. Zip ids with journals and call `buildTaxLedgerRows` for each journal that has an id.
4. Insert the rows in the same transaction.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- src/activate-accounting
# Expected: all tests pass
```

**Out of scope:** `promote.ts` (readers join on journal status; no change).

## Task 25: Verify slice B end to end

**Depends on:** 16–24
**Files:** none

**Steps:**
1. Run the commands below.
2. In the browser, post a UK purchase order, receipt and invoice at "UK Standard 20%" (100% recoverable). Check that inventory is £1,000 for 10 × £100 and the invoice debits Tax Paid £200.
3. Post a sales invoice at "TX – Austin". Check the two tax legs.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database --filter=@carbon/server-functions --filter=@carbon/ee --filter=@carbon/documents
# Expected: all tasks successful
pnpm --filter @carbon/database test && pnpm --filter @carbon/server-functions test && pnpm --filter @carbon/utils test
# Expected: all tests pass
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** providers (slice C).

---

# Slice C — Provider mapping

## Task 26: Write `core/tax-mapping.ts` with tests

**Depends on:** 3
**Files:**
- Create: `packages/ee/src/accounting/core/tax-mapping.ts`
- Create: `packages/ee/src/accounting/core/tax-mapping.test.ts`
- Modify: `packages/ee/src/accounting/index.ts` — `export * from "./core/tax-mapping"`
- Copy from (precedent): `packages/ee/src/accounting/core/dimension-mapping.ts` (Kysely `Db` type at `:35`, `{data, error}` returns); `upsertAccountMappings` at `core/account-mapping.ts:333-386`; `getUnmappedRequiredAccounts` at `:550`

**Steps:**
1. Write these exports:

```ts
export const TAX_CODE_MAPPING_ENTITY_TYPE = "taxCode";
export type TaxDirection = "sales" | "purchase";
export function buildTaxCodeMappingEntityId(taxCodeId: string, direction: TaxDirection): string; // `${taxCodeId}:${direction}`
export function parseTaxCodeMappingEntityId(entityId: string): { taxCodeId: string; direction: TaxDirection } | null;
export interface TaxCodeMapping { taxCodeId: string; direction: TaxDirection; externalId: string; externalName: string | null; externalRate: number | null; }
export function getTaxCodeMappings(db: Db, args: { companyId: string; integration: string }): Promise<{ data: TaxCodeMapping[] | null; error: string | null }>;
export function upsertTaxCodeMappings(db: Db, args: { companyId: string; integration: string; userId: string; mappings: Array<Omit<TaxCodeMapping, never>> }): Promise<{ data: number | null; error: string | null }>;
export function matchTaxCodesByRate(args: { codes: Array<{ id: string; name: string; rate: number }>; options: Array<{ id: string; name: string; rate: number; direction: TaxDirection }>; mapped: Set<string> }): Array<{ taxCodeId: string; direction: TaxDirection; externalId: string; externalName: string }>;
export function getUnmappedTaxCodes(db: Db, args: { companyId: string; integration: string }): Promise<{ data: Array<{ taxCodeId: string; name: string; direction: TaxDirection }> | null; error: string | null }>;
```

2. `upsertTaxCodeMappings` checks that every code id belongs to `companyId` (RLS is bypassed). Then it calls one `linkBatch` with `allowDuplicateExternalId: true` and `metadata: { externalName, externalRate }`.
3. `matchTaxCodesByRate` proposes a rate only when exactly one option has the code's rate.
4. `getUnmappedTaxCodes` lists each active code and direction that appears on a line or a memo and has no mapping. A code used only on sales needs only a sales mapping.
5. Test the id round trip, the proposals (one match, two matches, none), and the unmapped logic with a stub database.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- src/accounting/core/tax-mapping.test.ts
# Expected: all tests pass
```

**Out of scope:** UI.

## Task 27: Read provider tax catalogs (Xero `/TaxRates`, QuickBooks Online tax codes)

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/accounting/providers/xero/models.ts` — `TaxRateSchema` in `namespace Xero`
- Modify: `packages/ee/src/accounting/providers/xero/provider.ts` — `listTaxRates()`
- Modify: `packages/ee/src/accounting/providers/xero/provider.test.ts`
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/invoice-tax.ts` — export a direction-aware option list
- Copy from (precedent): `listTrackingCategories` (`provider.ts:448`) and its test (`provider.test.ts:62-83`); `loadQboInvoiceTaxCatalog` (`invoice-tax.ts:18-36`)

**Steps:**
1. Add the schema:

```ts
export const TaxRateSchema = z.object({
  Name: z.string(),
  TaxType: z.string(),
  ReportTaxType: z.string().optional(),
  Status: z.enum(["ACTIVE", "DELETED", "ARCHIVED", "PENDING"]).optional(),
  EffectiveRate: z.number().optional(),
  DisplayTaxRate: z.number().optional(),
  CanApplyToRevenue: z.boolean().optional(),
  CanApplyToExpenses: z.boolean().optional(),
  TaxComponents: z.array(z.object({ Name: z.string(), Rate: z.number(), IsCompound: z.boolean().optional(), IsNonRecoverable: z.boolean().optional() })).optional()
}).passthrough();
export type TaxRate = z.infer<typeof TaxRateSchema>;
```

2. Add `listTaxRates(): Promise<Xero.TaxRate[]>`. It calls `request<{ TaxRates }>("GET", "/TaxRates")`, logs and returns `[]` on error, and keeps `ACTIVE` rates.
3. Add `qboTaxOptions(catalog, direction)` in `invoice-tax.ts`. It returns active codes with a single rate in `SalesTaxRateList` (sales) or `PurchaseTaxRateList` (purchase), with the rate's `RateValue / 100`.
4. Test both with fetch mocks.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- src/accounting/providers/xero/provider.test.ts src/accounting/providers/quickbooks-online
# Expected: all tests pass
```

**Out of scope:** creating provider tax rates.

## Task 28: Add the Tax Rates tab and the sync gate to the integration drawer

**Depends on:** 26, 27
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — loader data, tab, intents, gate
- Create: `apps/erp/app/modules/settings/ui/Integrations/TaxRateMapping.tsx`
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `taxCodeMappingUpsertValidator`, `taxCodeMappingBulkUpsertValidator`
- Modify: `apps/erp/app/modules/settings/ui/Integrations/AccountingSyncControl.tsx` — `unmappedTaxCodeCount`
- Copy from (precedent): `getDimensionSyncTabData` (`integrations.$id.tsx:504-628`), the Dimensions tab entry (`:2192-2211`), `upsert-dimension-value-mapping` (`:1435-1470`), the bulk handler (`:1474-1523`), `DimensionMapping.tsx` (`DimensionValueMappingRowForm` `:596-704`, `MatchByNameDrawer` `:706`), `dimensionValueMappingUpsertValidator` (`settings.models.ts:729`)

**Steps:**
1. Write `getTaxRateTabData(client, { companyId, integrationId, provider })`. It loads active codes, mappings, provider options per direction, unmapped codes and `matchTaxCodesByRate` proposals.
2. Return it only for Xero and QuickBooks Online.
3. Add a `"tax-rates"` tab after "dimensions", labelled "Tax Rates".
4. Copy `DimensionMapping.tsx` to `TaxRateMapping.tsx`. Each row shows the code's name and rate, a Sales `Combobox` and a Purchase `Combobox`. Each option label is "{Name} ({rate}%)".
5. Add intents `upsert-tax-code-mapping` and `bulk-upsert-tax-code-mappings`. They call `upsertTaxCodeMappings(getDatabaseClient(), …)`.
6. In `update-sync-enabled` (`:1549-1582`), after the account check, call `getUnmappedTaxCodes`. If it returns rows, refuse with "Map the remaining N tax code(s) before turning on sync".
7. Pass `unmappedTaxCodeCount` to `AccountingSyncControl`. Disable the switch while it is above 0, and link to `?tab=tax-rates`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee
# Expected: all tasks successful
```
Browser: open the Xero integration. The Tax Rates tab lists "UK Standard 20%" with proposals `OUTPUT2` and `INPUT2`.

**Out of scope:** Rillet (grill 6).

## Task 29: Write the shared provider tax-rate resolver with tests

**Depends on:** 26
**Files:**
- Create: `packages/ee/src/accounting/core/provider-tax.ts`
- Create: `packages/ee/src/accounting/core/provider-tax.test.ts`
- Copy from (precedent): the warning shape in `quickbooks-online/entities/invoice-tax.ts:51-66`; the one-minor-unit check at `:147-159`

**Steps:**
1. Write:

```ts
export function resolveProviderTaxRate(args: {
  documentId: string;
  direction: TaxDirection;
  taxCodeId: string | null;
  taxPercent: number;
  netAmount: number;
  taxAmount: number;
  decimalPlaces: number;
  mappings: ReadonlyMap<string, TaxCodeMapping>;   // key: buildTaxCodeMappingEntityId
  options: ReadonlyArray<{ id: string; name: string; rate: number }>;
}): { externalId: string; externalName: string; rate: number };
```

2. If `taxCodeId` is set, use its mapping for `direction`. If it has none, throw `JournalEntrySyncError` with `UNMAPPED_TAX_CODES`, `warning: true`, and `metadata: { documentId, taxCodeId, direction }`.
3. If `taxCodeId` is null, match `taxPercent` to exactly one option rate. If none or several match, throw the same Warning with `metadata.reason`.
4. If `taxPercent` is 0 and no code is set, return the option whose rate is 0 and whose name is "No VAT", "Tax Exempt" or `NONE`. If none exists, throw the Warning.
5. Check `|taxAmount − round(netAmount × rate, decimalPlaces)| ≤ 10^−decimalPlaces`. If the check fails, throw the Warning naming the Carbon rate and the provider rate.
6. Test each branch.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- src/accounting/core/provider-tax.test.ts
# Expected: all tests pass
```

**Out of scope:** provider-specific payloads.

## Task 30: Send mapped tax on Xero invoices, sales orders and purchase orders

**Depends on:** 29
**Files:**
- Modify: `packages/ee/src/accounting/providers/xero/entities/invoice.ts:76-125,300-345` — mapped `TaxType`
- Modify: `packages/ee/src/accounting/core/sales-document-components.ts:18-47` — add `taxCodeId` to each component
- Modify: `packages/ee/src/accounting/core/sales-invoice-source.ts` — select `salesInvoiceLine.taxCodeId`
- Modify: `packages/ee/src/accounting/providers/xero/entities/sales-order.ts:151-172,263-315`
- Modify: `packages/ee/src/accounting/providers/xero/entities/purchase-order.ts:312-388`
- Modify: `packages/ee/src/accounting/providers/xero/entities/__tests__/invoice.test.ts:351-364`, `purchase-order.test.ts`; create `sales-order.test.ts`
- Copy from (precedent): the `accountCodesPromise` cache with eviction in `invoice.ts:136,153-174`

**Steps:**
1. Add a `taxContextPromise` on each syncer. It loads `getTaxCodeMappings` and `provider.listTaxRates()` once, and evicts itself on failure.
2. In `buildXeroSalesInvoiceLines`, take a `resolveTaxType(component)` argument. Replace `component.taxPercent !== 0 ? "OUTPUT" : "NONE"` with its result.
3. In `mapToRemote`, resolve every component before `ensureDependencySynced`, so a Warning fires before any dependency write.
4. In `sales-order.ts`, select `taxPercent` and `taxCodeId`. Send `TaxType` and `TaxAmount` per line.
5. In `purchase-order.ts`, replace `hasTax ? "INPUT" : "NONE"` with the purchase-direction resolution.
6. Update `invoice.test.ts`. Extend `makeInvoiceDb` so the tax-mapping query returns mappings. Replace the `"OUTPUT"` expectations with the mapped `TaxType`. Add cases for an unmapped code and a legacy percent match.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- src/accounting/providers/xero
# Expected: all tests pass
```

**Out of scope:** bills and credit notes (Task 32).

## Task 31: Carry per-line tax through bill costing

**Depends on:** 21
**Files:**
- Modify: `packages/ee/src/accounting/core/document-costing.ts:58-68,99-307,507`
- Modify: `packages/ee/src/accounting/core/document-costing.test.ts`
- Copy from (precedent): the Payables exclusion through `classifyAccountingPostingRole` (`:200-228`)

**Steps:**
1. Add to `CostingLine`: `sourceLineId: string | null` (parsed from `documentLineReference`, `purchase-invoice:<lineId>`) and `tax: Array<{ taxCodeId: string | null; recoverableAmount: number; nonRecoverableAmount: number; taxPercent: number }>`.
2. Exclude journal lines whose role is `"TaxPaid"` (Task 18), as the Payables line is excluded.
3. Load `taxLedger` rows for the bill (`documentId`, `source = 'Purchase'`) in one query. Attach them to cost lines by `documentLineId`.
4. Subtract the excluded Tax Paid amounts from the reconciliation side of `toTransactionCurrencyLines`, so the check still balances. Carry the recoverable tax beside the lines.
5. Test: a bill with a 20% recoverable line yields one cost line of £1,000 carrying £200 recoverable, and the reconciliation passes.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- src/accounting/core/document-costing.test.ts
# Expected: all tests pass
```

**Out of scope:** charge costing (`loadChargeCostingLines`).

## Task 32: Send tax on Xero bills, credit notes and vendor credits

**Depends on:** 29, 31
**Files:**
- Modify: `packages/ee/src/accounting/providers/xero/entities/bill.ts:136-208,474-566`
- Modify: `packages/ee/src/accounting/providers/xero/entities/credit-memo.ts:104-122,144-178,256,459-515` — memo tax
- Modify: `packages/ee/src/accounting/providers/xero/entities/__tests__/bill.test.ts`, `credit-memo.test.ts`

**Steps:**
1. In `buildXeroBillLineItems`, for each cost line:
   1. If it carries no recoverable tax, emit today's line with `TaxType: "NONE"`.
   2. If all its tax is recoverable, emit one line: the net, the mapped purchase `TaxType`, `TaxAmount` = the recoverable tax.
   3. If its tax is partly recoverable, emit two lines (grill 10). Line 1 is net × recoverable percent at the mapped rate with the recoverable tax. Line 2 is the remaining net plus the non-recoverable tax at `NONE`, on the same account.
2. Set `LineAmountTypes: "Exclusive"` on a bill that has any taxed line.
3. Add `taxCodeId` and `taxAmount` to `XeroMemoSource` and its loader. A memo with tax sends `UnitAmount = amount − taxAmount`, `TaxAmount = taxAmount` and the mapped rate (sales direction for a customer memo, purchase for a supplier memo).
4. Test the three bill cases and a taxed credit note.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- src/accounting/providers/xero
# Expected: all tests pass
```

**Out of scope:** charges, reimbursements and journals (grill 3).

## Task 33: Send mapped tax on QuickBooks Online documents

**Depends on:** 29
**Files:**
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/models.ts` — `TaxCodeRef` on `AccountBasedExpenseLineDetailSchema` (`:212`) and `ItemBasedExpenseLineDetailSchema` (`:224`); `TxnTaxDetail` and `GlobalTaxCalculation` on `BillSchema` (`:252`), `PurchaseOrderSchema` (`:291`), `CreditMemoSchema` (`:368`), `VendorCreditSchema` (`:399`)
- Modify: `entities/invoice-tax.ts`, `entities/invoice.ts`, `entities/bill.ts:134-200,462-540`, `entities/purchase-order.ts:295-345`, `entities/shared.ts:196-238`, `entities/credit-memo.ts:373`, `entities/vendor-credit.ts:80`
- Modify: the matching tests under `entities/__tests__/`

**Steps:**
1. In `resolveQboInvoiceTax`, use the mapped code when a component has a `taxCodeId`. Keep today's percent matching for legacy lines.
2. On bills, purchase orders, credit memos and vendor credits, put `TaxCodeRef` on each line from `resolveProviderTaxRate`. Send `TxnTaxDetail` and, outside the US, `GlobalTaxCalculation: "TaxExcluded"`.
3. A partly recoverable bill line becomes two lines, as in Task 32. The second line uses the company's non-taxable code.
4. A US company keeps `TAX`/`NON` markers. Its bills send `NON` while every line is 0% recoverable, so they stay as today.
5. Test a GB bill with a mapped code and a US bill.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- src/accounting/providers/quickbooks-online
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: all tasks successful
```

**Out of scope:** Rillet.

## Task 34: Update the accounting sync rule

**Depends on:** 30, 32, 33
**Files:**
- Modify: `.claude/rules/accounting-sync-handlers.md:319-321,396-401` and the QuickBooks Online bill, purchase order and memo bullets
- Modify: `packages/ee/src/accounting/providers/xero/entities/credit-memo.ts:137-140` — doc comment

**Steps:**
1. Replace "Bill lines are tax-neutral" with the recoverable split and the two-line rule.
2. Describe the tax-code mapping (`core/tax-mapping.ts`), the legacy percent match, the one-minor-unit check and the sync gate.
3. Keep Rillet's description as it is.

**Verify:**
```bash
grep -n "tax-neutral" .claude/rules/accounting-sync-handlers.md
# Expected: no output, or only a line about Rillet
```

**Out of scope:** product docs (Task 38).

---

# Slice D — Reporting and documents

## Task 35: Build the Tax Liability report

**Depends on:** 21
**Files:**
- Create: `apps/erp/app/routes/x+/reports+/tax-liability.tsx`
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getTaxLiability`
- Modify: `apps/erp/app/routes/x+/accounting+/reports.tsx:176-184` — a card
- Modify: `apps/erp/app/utils/path.ts` — `taxLiability`
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — "Tax Liability" in the Tax group
- Copy from (precedent): `apps/erp/app/routes/x+/reports+/rental-utilization.tsx` (loader `:50-87`, filters `:230-262`, `Table` `:266-275`)

**Steps:**
1. Write `getTaxLiability(client, companyId, { startDate, endDate, taxAuthorityId })`. Select `taxLedger` joined to `journal` with `status = 'Posted'`. Group by authority and component name.
2. Return taxable base, exempt base, tax collected (Sales), recoverable tax (Purchase `recoverableAmount`), and net due = collected − recoverable.
3. Copy the rental-utilization route. Its filters are two date pickers and an authority `Combobox`.
4. Every accessor key has no `_` (`.claude/rules/table-csv-export.md`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```
Browser: the report for this quarter shows "TX State" and "City of Austin". The totals tie to the movement of Tax Received and Tax Paid.

**Out of scope:** tax returns (Phase 2).

## Task 36: Print the tax summary, VAT clause and registration on sales PDFs

**Depends on:** 21
**Files:**
- Modify: `packages/lib/src/sales-invoice-document.server.tsx:145-210,323-347` — load ledger rows (posted) or resolved components (draft), registrations, code messages
- Modify: `packages/documents/src/pdf/blocks/SummaryBlock.tsx:137-157`, `packages/documents/src/pdf/blocks/types.ts:19-57` — `taxSummary`
- Modify: `packages/documents/src/pdf/blocks/PartiesBlock.tsx:77-82`, `packages/documents/src/pdf/blocks/vars.ts:39-42` — registration number
- Modify: `apps/erp/app/routes/file+/sales-order+/$id[.]pdf.tsx`, `packages/documents/src/pdf/blocks/salesOrder/SummaryBlock.tsx:101-119` — summary from resolved components
- Modify: `packages/documents/src/pdf/QuotePDF.tsx:141-165`, `packages/documents/src/pdf/blocks/quote/SummaryBlock.tsx:48-55`
- Modify: `packages/jobs/src/invoicing/automate-invoice.test.ts:65` — mock

**Steps:**
1. Add `taxSummary: Array<{ name: string; rate: number; base: number; tax: number }>` and `invoiceMessages: string[]` and `sellerRegistration: string | null` to the invoice data.
2. A posted invoice builds `taxSummary` from its `taxLedger` rows. A draft builds it from `splitLineTax` on the current lines.
3. `SummaryBlock` prints one row per summary entry instead of one "Taxes" row, when the summary has more than one entry. With one entry it prints today's row.
4. Print each `invoiceMessage` under the totals.
5. Print the registration for the company's country, else `company.taxId`.
6. The customer VAT number already prints when it is set (`PartiesBlock.tsx:77-82`). Leave it.

**Verify:**
```bash
pnpm --filter @carbon/documents test
# Expected: all tests pass
pnpm --filter @carbon/jobs test -- src/invoicing
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/documents --filter=@carbon/lib --filter=erp --filter=@carbon/jobs
# Expected: all tasks successful
```

**Out of scope:** emails (they read `taxPercent` and need no change).

## Task 37: Move customers and suppliers from a bare percent to tax codes

**Depends on:** 10
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomersTable.tsx`, `apps/erp/app/modules/purchasing/ui/Supplier/SuppliersTable.tsx` — `withSelectableRows`, `renderActions`
- Create: `apps/erp/app/routes/x+/customer+/update.tsx`, `apps/erp/app/routes/x+/supplier+/update.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `bulkUpdateCustomers`, `bulkUpdateSuppliers`
- Modify: `apps/erp/app/routes/x+/sales+/customers.tsx`, `apps/erp/app/routes/x+/purchasing+/suppliers.tsx` — banner
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomerForm.tsx:197-205` — hide `taxPercent` once the company has a code
- Copy from (precedent): `PartsTable.tsx` `onBulkUpdate` (`:498-520`), `renderActions` (`:523-630`), `withSelectableRows` (`:752-757`); `apps/erp/app/routes/x+/items+/update.tsx`; the banner in `lease-liabilities.tsx:457-478`

**Steps:**
1. Add an "Assign tax code" `DropdownMenuSub` listing active codes. It posts `field: "taxCodeId"` to the bulk route.
2. The bulk route upserts `customerTax` / `supplierTax` rows with `taxCodeId` for the selected ids, scoped by `companyId`.
3. If the company has an active code, the list loaders count parties with `taxPercent > 0` and no code. Show an `Alert variant="info"` with that count and the text "Move to tax codes".
4. Hide the customer form's Tax Percent field once the company has an active code. Keep the column as the no-code fallback.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** dropping `customer.taxPercent`.

## Task 38: Update docs, glossary, rules and AGENTS.md

**Depends on:** the tasks of the slice being shipped
**Files:**
- Modify: `docs/content/docs/reference/accounting.mdx`, `suppliers-and-customers.mdx`, `invoices.mdx`, `payments.mdx`, `financial-reports.mdx`, `quotes.mdx`, `sales-orders.mdx`, `purchase-orders.mdx`, `rental-agreements.mdx`, `company-settings.mdx`, `documents.mdx`
- Modify: `docs/content/docs/integrations/accounting.mdx` — the Tax Rates tab
- Modify: `docs/content/src/glossary/terms.ts` — tax code, tax component, recoverable percent, tax ledger; `customer-default-tax-percent` text
- Modify: `apps/erp/app/modules/accounting/AGENTS.md`, `apps/erp/app/modules/invoicing/AGENTS.md`, `apps/erp/app/modules/sales/AGENTS.md`, `apps/erp/app/modules/purchasing/AGENTS.md`
- Modify: `.claude/rules/numeric-precision.md:122-135` — `taxableBase` lives in `packages/utils/src/tax.ts`
- Modify: `.claude/rules/onboarding-company-templates.md` — tax seeding
- Copy from (precedent): `.claude/skills/carbon-docs/SKILL.md`

**Steps:**
1. Use the `carbon-docs` skill. Ground every claim in the merged code.
2. Check every internal link with the loop in `.claude/rules/changelog-authoring.md` ("Every internal link must resolve").

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: no errors
```

**Out of scope:** a changelog entry (write one with `/changelog-entry` after release).

## Task 39: Verify Phase 1 in the browser

**Depends on:** 37
**Files:** none

**Steps:**
1. Run `/test` with the spec's Phase 1 acceptance criteria as the test plan.
2. Cover these flows:
   1. Create "TX – Austin" and assign it.
   2. Create and post a sales invoice; check the two tax legs and the ledger rows.
   3. Run the UK purchase flow at 100% and 50% recoverable.
   4. Post a customer credit memo with tax.
   5. Map Xero tax rates; confirm the sync gate blocks while a code is unmapped.
   6. Open the Tax Liability report.
   7. Check the invoice PDF summary.
3. Save screenshots under `.context/`.
4. Before release, a UK accountant reviews a demo Xero VAT return (grill 10).

**Verify:** `/test` reports every flow as passed.

**Out of scope:** Phase 2 and Phase 3.
