# Multi-Jurisdiction Tax Compliance — implementation plan (Phase 1)

**Spec:** .ai/specs/2026-07-03-multi-jurisdiction-tax.md
**Research:** .ai/research/multi-jurisdiction-tax.md
**Branch:** `tax-compliance` (create from `main`)

**Scope:** Phase 1 only — determination (direct assignment), corrected posting, `taxLedger`, memo tax, shipping taxability, PDF tax blocks, liability report. Phases 2 (returns/settlement, use tax) and 3 (Avalara, Xero mapping) get their own plans after Phase 1 ships; their schema hooks (`taxReturnId`, `needsEngineReconciliation` columns) are created now so the ledger never needs an ALTER later.

**Ground rules for every task:** pnpm only (never npm). Never run a whole-repo typecheck (OOMs) — always `pnpm exec turbo run typecheck --filter=@carbon/erp`. Never rebuild the database. Do not commit — /check-and-commit handles commits per task. UI strings use Lingui (`useLingui().t` / `<Trans>` from `@lingui/react/macro`).

## Progress

- [ ] Task 1: Create the Phase 1 migration
- [ ] Task 2: Regenerate database types
- [ ] Task 3: Add tax validators and enum arrays to accounting.models.ts (+ memo validator)
- [ ] Task 4: Add effective-component rate math to accounting.utils.ts with unit tests
- [ ] Task 5: Add tax CRUD service functions to accounting.service.ts
- [ ] Task 6: Add resolveLineTaxes + suggestTaxCode with unit-tested core
- [ ] Task 7: Wire determination into sales-side line creation
- [ ] Task 8: Wire determination into purchase-side line creation
- [ ] Task 9: Tax codes routes + table + form (components editor)
- [ ] Task 10: Tax authorities + tax registrations routes
- [ ] Task 11: Accounting nav + path.to entries for the Tax group
- [ ] Task 12: Customer/supplier tax-code assignment UI + taxPercent sunset banner
- [ ] Task 13: Customer location override select
- [ ] Task 14: Item "Taxable" switch
- [ ] Task 15: Line form tax display + override select + audit coverage
- [ ] Task 16: Shared edge-function tax resolver helper
- [ ] Task 17: post-sales-invoice — tax split, ledger writes, VOID reversals, shipping taxability
- [ ] Task 18: post-purchase-invoice — recoverable input tax, reverse charge, ledger writes
- [ ] Task 19: post-memo — net/tax split + signed ledger rows
- [ ] Task 20: Sales invoice PDF tax summary, clauses, registration numbers
- [ ] Task 21: Tax liability report (service + route)
- [ ] Task 22: Lingui extract + full scoped validation
- [ ] Task 23: Browser verification via /test

## Dependencies

- Task 1 → 2 → 3 → everything else.
- Tasks 4–5 after 3; Task 6 needs 4–5.
- Tasks 7–8 need 6. Tasks 9–11 need 5 (independent of 6–8; 9/10/11 can run in parallel).
- Tasks 12–14 need 5 (independent of each other; parallel OK).
- Task 15 needs 6. Task 16 needs 2; Tasks 17–19 need 16 (17/18/19 parallel after 16).
- Task 20 needs 17 (reads the same resolved data; PDF math is read-side). Task 21 needs 17–18 (ledger rows exist).
- Task 22 after all code tasks; Task 23 last.

---

## Task 1: Create the Phase 1 migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_multi-jurisdiction-tax.sql` (via `pnpm db:migrate:new multi-jurisdiction-tax` — never hand-pick the timestamp; if the generated HHMMSS is `000000`, rename the file with randomized digits)

**Steps:**

1. Run `pnpm db:migrate:new multi-jurisdiction-tax` from the repo root.
2. Write the following SQL into the generated file. Every statement is idempotency-guarded because the deploy runner retries failed files over partially-committed state.

```sql
-- ============================== ENUMS ==============================
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

-- ============================== TABLES ==============================
CREATE TABLE IF NOT EXISTS "taxAuthority" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplierId" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "taxAuthority_companyId_idx" ON "taxAuthority" ("companyId");
CREATE INDEX IF NOT EXISTS "taxAuthority_createdBy_idx" ON "taxAuthority" ("createdBy");
CREATE INDEX IF NOT EXISTS "taxAuthority_supplierId_idx" ON "taxAuthority" ("supplierId");
DO $$ BEGIN
  ALTER TABLE "taxAuthority" ADD CONSTRAINT "taxAuthority_companyId_name_key" UNIQUE ("companyId", "name");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "taxCode" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "calculationType" "taxCalculationType" NOT NULL DEFAULT 'Normal',
    "reportingCategory" "taxReportingCategory" NOT NULL DEFAULT 'Standard',
    "invoiceMessage" TEXT,
    "countryId" INTEGER REFERENCES "country"("id"),
    "state" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "taxCode_companyId_idx" ON "taxCode" ("companyId");
CREATE INDEX IF NOT EXISTS "taxCode_createdBy_idx" ON "taxCode" ("createdBy");
CREATE INDEX IF NOT EXISTS "taxCode_countryId_idx" ON "taxCode" ("countryId");
DO $$ BEGIN
  ALTER TABLE "taxCode" ADD CONSTRAINT "taxCode_companyId_name_key" UNIQUE ("companyId", "name");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "taxCodeComponent" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "taxCodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxAuthorityId" TEXT,
    "rate" NUMERIC NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "isCompound" BOOLEAN NOT NULL DEFAULT FALSE,
    "isRecoverable" BOOLEAN NOT NULL DEFAULT FALSE,
    "salesTaxAccountId" TEXT,
    "purchaseTaxAccountId" TEXT,
    "effectiveDate" DATE,
    "expirationDate" DATE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId") ON DELETE CASCADE,
    FOREIGN KEY ("taxAuthorityId", "companyId") REFERENCES "taxAuthority"("id", "companyId")
);
CREATE INDEX IF NOT EXISTS "taxCodeComponent_companyId_idx" ON "taxCodeComponent" ("companyId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_taxCodeId_idx" ON "taxCodeComponent" ("taxCodeId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_taxAuthorityId_idx" ON "taxCodeComponent" ("taxAuthorityId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_createdBy_idx" ON "taxCodeComponent" ("createdBy");

CREATE TABLE IF NOT EXISTS "taxRegistration" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "countryId" INTEGER NOT NULL REFERENCES "country"("id"),
    "state" TEXT,
    "registrationNumber" TEXT NOT NULL,
    "effectiveDate" DATE,
    "endDate" DATE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "taxRegistration_companyId_idx" ON "taxRegistration" ("companyId");
CREATE INDEX IF NOT EXISTS "taxRegistration_countryId_idx" ON "taxRegistration" ("countryId");
CREATE INDEX IF NOT EXISTS "taxRegistration_createdBy_idx" ON "taxRegistration" ("createdBy");

CREATE TABLE IF NOT EXISTS "taxLedger" (
    "id" TEXT NOT NULL DEFAULT id('txl'),
    "companyId" TEXT NOT NULL,
    "source" "taxLedgerSource" NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentLineId" TEXT,
    "journalId" TEXT,
    "postingDate" DATE NOT NULL,
    "taxCodeId" TEXT,
    "taxCodeComponentId" TEXT,
    "componentName" TEXT,
    "taxAuthorityId" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "rate" NUMERIC NOT NULL DEFAULT 0,
    "taxableAmount" NUMERIC NOT NULL DEFAULT 0,
    "taxAmount" NUMERIC NOT NULL DEFAULT 0,
    "exemptAmount" NUMERIC NOT NULL DEFAULT 0,
    "taxExemptionReason" "taxExemptionReason",
    "exemptionCertificateNumber" TEXT,
    "currencyCode" TEXT,
    "exchangeRate" NUMERIC,
    "taxReturnId" TEXT,
    "needsEngineReconciliation" BOOLEAN NOT NULL DEFAULT FALSE,
    "postedToInputAccount" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_postingDate_idx" ON "taxLedger" ("companyId", "postingDate");
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_documentId_idx" ON "taxLedger" ("companyId", "documentId");
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_taxAuthorityId_idx" ON "taxLedger" ("companyId", "taxAuthorityId");
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_taxReturnId_idx" ON "taxLedger" ("companyId", "taxReturnId");
CREATE INDEX IF NOT EXISTS "taxLedger_createdBy_idx" ON "taxLedger" ("createdBy");

-- ============================== RLS ==============================
-- Same block for each of: taxAuthority, taxCode, taxCodeComponent, taxRegistration, taxLedger.
-- Written out once here for taxAuthority; REPEAT VERBATIM for the other four tables
-- (replace the table name only).
ALTER TABLE "public"."taxAuthority" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."taxAuthority";
CREATE POLICY "SELECT" ON "public"."taxAuthority"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."taxAuthority";
CREATE POLICY "INSERT" ON "public"."taxAuthority"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."taxAuthority";
CREATE POLICY "UPDATE" ON "public"."taxAuthority"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."taxAuthority";
CREATE POLICY "DELETE" ON "public"."taxAuthority"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- ============================== COLUMN ADDS ==============================
ALTER TABLE "item"             ADD COLUMN IF NOT EXISTS "taxable" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "customer"         ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
ALTER TABLE "customerLocation" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
ALTER TABLE "supplier"         ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
ALTER TABLE "companySettings"  ADD COLUMN IF NOT EXISTS "shippingIsTaxable" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "quoteLine"           ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
ALTER TABLE "salesOrderLine"      ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
ALTER TABLE "salesInvoiceLine"    ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
ALTER TABLE "purchaseOrderLine"   ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
ALTER TABLE "memo"                ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
ALTER TABLE "memo"                ADD COLUMN IF NOT EXISTS "taxAmount" NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE "accountDefault"      ADD COLUMN IF NOT EXISTS "taxSettlementAccount" TEXT;
CREATE INDEX IF NOT EXISTS "customer_taxCodeId_idx" ON "customer" ("taxCodeId");
CREATE INDEX IF NOT EXISTS "customerLocation_taxCodeId_idx" ON "customerLocation" ("taxCodeId");
CREATE INDEX IF NOT EXISTS "supplier_taxCodeId_idx" ON "supplier" ("taxCodeId");
```

   Note: authority deletion is blocked by the plain composite FK (NO ACTION) plus a friendly pre-check in Task 5's `deleteTaxAuthority`. If `id('txl')` errors because the `id(prefix)` function signature differs, use bare `id()`. Set `postedToInputAccount = true` on ledger rows whose tax was debited to an input/receivable account (Tasks 18–19) — the liability report aggregates on it.

3. **View recreations.** For each view whose base table gained a column and whose body uses `<alias>.*` or an explicit column list — `customers`, `suppliers`, `quoteLines`, `salesOrderLines`, `salesInvoiceLines`, `purchaseOrderLines`, `purchaseInvoiceLines`, and the memo view(s) from `20260630093809_ar-ap-payments.sql` — do the following, one view at a time:
   1. Find the NEWEST migration defining that view: `grep -rln 'CREATE OR REPLACE VIEW "<name>"\|CREATE VIEW "<name>"' packages/database/supabase/migrations/ | sort | tail -1`.
   2. Copy that newest body **verbatim** into this migration as `DROP VIEW IF EXISTS "<name>"; CREATE OR REPLACE VIEW "<name>" WITH(SECURITY_INVOKER=true) AS <newest body>;` — dropping first refreshes `*` expansion so the new columns appear.
   3. If the body lists columns explicitly (no `<alias>.*`), append the new column(s) (`taxCodeId`, `taxable`, or `taxAmount` as applicable) to the list.
   4. If a view's newest definition cannot be located, STOP and report — do not write a view body from memory.
4. Apply locally: `pnpm db:migrate` (this is applying migrations to the local dev DB, which is allowed; it is not a DB rebuild). If `crbn migrate` fails with a local permission error, validate instead via the rolled-back-transaction method: `psql` as `supabase_admin`, `BEGIN; \i <migration file>; ROLLBACK;` and report that `db:migrate` needs the user.

**Verify:**
```bash
pnpm db:migrate
# Expected: output lists <timestamp>_multi-jurisdiction-tax.sql as applied, exit 0.
psql "$SUPABASE_DB_URL" -c '\d "taxLedger"' | head -30
# Expected: columns id, companyId, source, documentType, ..., needsEngineReconciliation present.
```

**Out of scope:** `taxReturn` / `taxReturnLayout` tables (Phase 2 migration); dropping `customer.taxPercent` (kept as fallback); touching `postingGroup*` anything (dropped tables — do not recreate).

---

## Task 2: Regenerate database types

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/types.ts` (generated — never hand-edit)

**Steps:**
1. Run `pnpm run generate:types` from the repo root.
2. Do NOT commit a 55k-line whole-file rewrite: if the diff includes unrelated per-company table churn (the committed types come from the cloud DB), keep only the hunks for the new tax tables/columns if the repo's convention allows partial staging; otherwise leave the full regenerated file and flag it in the task notes for the user. If the new `taxLedger`/`taxCode` types do NOT appear after generation, STOP and report.

**Verify:**
```bash
grep -n '"taxCode"\|"taxLedger"\|"taxAuthority"\|"taxRegistration"' packages/database/src/types.ts | head -5
# Expected: Row/Insert/Update type entries for the new tables.
```

**Out of scope:** hand-editing any generated file.

---

## Task 3: Add tax validators and enum arrays to accounting.models.ts (+ memo validator)

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — add tax validators + enum arrays
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` — extend `memoValidator`

**Steps:**
1. In `accounting.models.ts`, following the existing style (`zfd` from `zod-form-data`, exported `const` arrays for enums — mirror `depreciationMethods` / `fixedAssetStatuses`):
   - `export const taxCalculationTypes = ["Normal", "Reverse Charge"] as const;`
   - `export const taxReportingCategories = ["Standard", "Reduced", "Zero-Rated", "Exempt", "Reverse Charge", "Export", "Out of Scope"] as const;`
   - `taxAuthorityValidator`: `{ id: z.string().optional(), name: z.string().min(1, "Name is required"), supplierId: zfd.text(z.string().optional()) }`
   - `taxCodeValidator`: `{ id: z.string().optional(), name: z.string().min(1), description: zfd.text(z.string().optional()), calculationType: z.enum(taxCalculationTypes), reportingCategory: z.enum(taxReportingCategories), invoiceMessage: zfd.text(z.string().optional()), countryId: zfd.numeric(z.number().optional()), state: zfd.text(z.string().optional()), active: zfd.checkbox() }`
   - `taxCodeComponentValidator`: `{ id: z.string().optional(), taxCodeId: z.string().min(1), name: z.string().min(1), taxAuthorityId: zfd.text(z.string().optional()), rate: zfd.numeric(z.number().min(0).max(1)), sequence: zfd.numeric(z.number().int().min(1)).default(1), isCompound: zfd.checkbox(), isRecoverable: zfd.checkbox(), salesTaxAccountId: zfd.text(z.string().optional()), purchaseTaxAccountId: zfd.text(z.string().optional()), effectiveDate: zfd.text(z.string().optional()), expirationDate: zfd.text(z.string().optional()) }` with `.refine` that when both dates present, `expirationDate > effectiveDate`.
   - `taxRegistrationValidator`: `{ id: z.string().optional(), countryId: zfd.numeric(z.number()), state: zfd.text(z.string().optional()), registrationNumber: z.string().min(1), effectiveDate: zfd.text(z.string().optional()), endDate: zfd.text(z.string().optional()) }`
   - Export inferred types (`TaxCode`, `TaxCodeComponent`, …) next to the validators, matching file conventions.
2. In `invoicing.models.ts`, find `memoValidator` and add: `taxCodeId: zfd.text(z.string().optional())`, `taxAmount: zfd.numeric(z.number().min(0)).optional()`. Add a `.refine` that `taxAmount`, when present, is `<= amount`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0, no new errors.
```

**Out of scope:** UI form components (later tasks); service functions.

---

## Task 4: Add effective-component rate math to accounting.utils.ts with unit tests

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.utils.ts` — pure functions
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts` — tests (copy style from existing tests in this file)

**Steps:**
1. Add pure functions (no client, fully unit-testable):
   - `getEffectiveComponents(components: TaxCodeComponentLike[], date: string): TaxCodeComponentLike[]` — filters `effectiveDate <= date` (or null) AND (`expirationDate` null OR `> date`), sorted by `sequence`.
   - `computeEffectiveTaxRate(components: TaxCodeComponentLike[]): number` — non-compound components sum on the base; a compound component applies its rate to `base × (1 + sum of prior non-compound rates so far)` in `sequence` order. Return the total effective rate (e.g. GST 5% + compound PST 9.975% → `0.05 + 0.09975 × 1.05 = 0.1547375`).
   - `computeLineTaxBreakdown(components, taxableBase: number, currencyDecimals: number)` — returns `{ componentId, rate, taxAmount }[]` with **per-line, half-up rounding at `currencyDecimals`** per component, plus `totalTax` = sum of rounded components.
   Use a structural `TaxCodeComponentLike` type (rate, sequence, isCompound, effectiveDate, expirationDate, id) so the functions work on both app types and edge-function rows.
2. Tests (use optional chaining on indexed access — `noUncheckedIndexedAccess` is on): single component; two stacked (6.25 + 2 = 8.25 on 100 → 8.25); compound Canada GST+PST example above; effective-date boundary (component expiring 2026-06-30 vs successor effective 2026-07-01, assert rates picked at 2026-06-30 vs 2026-07-01); rounding (rate 0.0825 on 33.33 → component amounts round half-up to 2 decimals and sum consistently).

**Verify:**
```bash
pnpm --filter @carbon/erp test -- accounting.utils
# Expected: new tests listed and passing, exit 0.
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** DB access; document-level rounding (explicitly not supported).

---

## Task 5: Add tax CRUD service functions to accounting.service.ts

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts`
- Modify: `apps/erp/app/modules/accounting/index.ts` — barrel exports if not already wildcard

**Steps:**
1. Following the existing CRUD style in this file (e.g. the payment terms / fixed asset class functions — client first arg, `{data, error}` returned raw, `companyId` scoping on every query, `sanitize` on writes):
   - `getTaxAuthorities(client, companyId, args?: GenericQueryFilters & { search?: string })` (list w/ `setGenericQueryFilters`), `getTaxAuthoritiesList` (id/name for selects), `getTaxAuthority`, `upsertTaxAuthority`, `deleteTaxAuthority`.
   - `getTaxCodes(list)`, `getTaxCodesList` (active only, id/name/calculationType), `getTaxCode` (single, `.select("*, taxCodeComponent(*)")`), `upsertTaxCode`, `deleteTaxCode`.
   - `upsertTaxCodeComponents(client, companyId, taxCodeId, components[], userId)` — delete-and-reinsert components for the code (config tables, low volume) OR per-row upsert matching the house upsert branch style; include audit fields.
   - `getTaxRegistrations(list)`, `getTaxRegistration`, `upsertTaxRegistration`, `deleteTaxRegistration`.
   - `getTaxCodeWithEffectiveComponents(client, companyId, taxCodeId, date)` — fetches code + components, applies `getEffectiveComponents`/`computeEffectiveTaxRate` from Task 4, returns `{ taxCode, components, effectiveRate }`.
2. Block deleting a `taxAuthority` referenced by any `taxCodeComponent` (pre-check count, return an error object with a clear message).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** determination logic (Task 6); routes (Tasks 9–10).

---

## Task 6: Add resolveLineTaxes + suggestTaxCode with unit-tested core

**Depends on:** Tasks 4, 5
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.utils.ts` — pure resolution core
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts` — tests
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — thin fetching wrappers

**Steps:**
1. Pure core in `accounting.utils.ts`:
   `resolveTaxFromInputs(inputs: { customerTaxExempt?: boolean; customerExemptionReason?: string | null; customerExemptionCertificateNumber?: string | null; itemTaxable?: boolean; locationTaxCodeId?: string | null; partyTaxCodeId?: string | null; legacyTaxPercent?: number | null })` → `{ kind: "exempt" | "nonTaxableItem" | "code" | "legacy" | "none"; taxCodeId: string | null; taxPercent: number | null (null for "code" — computed by caller from components); exemptionReason?; exemptionCertificateNumber? }`. Precedence: exempt → nonTaxableItem → location code → party code → legacy percent → none.
2. Tests: each precedence rung; exempt customer with a coded location still resolves exempt; taxable item + no codes + legacy 0.05 → legacy.
3. Service wrappers in `accounting.service.ts`:
   - `resolveLineTaxes(client, companyId, { source: "sales" | "purchase", customerId?, supplierId?, customerLocationId?, itemId?, date })` — fetches `customerTax` (taxExempt, reason, certificate), `customerLocation.taxCodeId` (when id given), `customer.taxCodeId`/`customer.taxPercent` (or supplier equivalents for purchase), `item.taxable`; runs `resolveTaxFromInputs`; for `kind: "code"` fetches effective components (Task 5) and computes `taxPercent` + `components[]`. Returns `{ data: { taxCodeId, taxPercent, components, kind, exemptionReason, exemptionCertificateNumber }, error }`.
   - `suggestTaxCode(client, companyId, { countryId?, state? })` — active `taxCode` rows where (`countryId` matches or code's countryId is null) and (`state` matches case-insensitively or code's state is null), ordered most-specific-first (state match > country match); return top 5.
4. If `customerTax`/`supplierTax` field names differ from the spec's assumption (`taxExempt`, `taxExemptionReason`, `taxExemptionCertificateNumber`), STOP and report — do not guess (check `packages/database/supabase/migrations/20260430000001_tax-status.sql`).

**Verify:**
```bash
pnpm --filter @carbon/erp test -- accounting.utils
# Expected: resolveTaxFromInputs tests pass.
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** call-site wiring (Tasks 7–8); Avalara dispatch (Phase 3 — the wrapper is the seam, keep its signature stable).

---

## Task 7: Wire determination into sales-side line creation

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — quote line + sales order line creation/duplication paths
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — sales invoice line creation path (if line defaults are set here)
- Modify: the route actions that create these lines (grep below) if defaulting happens there instead

**Steps:**
1. Locate every server-side site where a NEW sales-side line's `taxPercent` is defaulted from the customer or copied forward: `grep -n "taxPercent" apps/erp/app/modules/sales/sales.service.ts apps/erp/app/modules/invoicing/invoicing.service.ts apps/erp/app/routes/x+/sales-order+/*.tsx apps/erp/app/routes/x+/quote+/*.tsx apps/erp/app/routes/x+/sales-invoice+/*.tsx` (known site: `sales.service.ts:1937`-area insert). Order→invoice and quote→order copies keep copying the line's stored values (correct — do not re-resolve on conversion).
2. At each NEW-line creation site, call `resolveLineTaxes` and set both `taxCodeId` and `taxPercent` from the result. Where the caller already receives an explicit `taxPercent` from the form, only default when the field was not user-set (match the existing `?? `-default idiom at each site).
3. Add a `recalculateLineTaxes` action route for sales orders and sales invoices (new route files following the naming of sibling action-only routes in `apps/erp/app/routes/x+/sales-order+/` — e.g. an `…$orderId.recalculate-taxes.tsx` action-only file): loops document lines, re-runs `resolveLineTaxes` with the current ship-to, updates `taxCodeId`/`taxPercent` on lines NOT manually overridden — track override by comparing stored `taxCodeId` to the resolution result; if there is no reliable way to distinguish a manual override, update all lines and note it in the response flash ("Recalculated N lines").
4. If the ship-to→`customerLocationId` linkage is not available at line-creation time in a given path (e.g. quotes without a location), pass only `customerId` — the resolver falls back to the customer default.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
pnpm --filter @carbon/erp test
# Expected: existing sales/invoicing tests still pass.
```

**Out of scope:** purchase side (Task 8); line form UI (Task 15); changing conversion-copy semantics.

---

## Task 8: Wire determination into purchase-side line creation

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — PO line creation
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — purchase invoice line creation

**Steps:**
1. Same grep approach for purchase lines (`grep -n "taxPercent\|supplierTaxAmount" apps/erp/app/modules/purchasing/purchasing.service.ts apps/erp/app/modules/invoicing/invoicing.service.ts`). Purchase lines keep `supplierTaxAmount` as the authoritative entry — determination only sets `taxCodeId` (identity/recoverability), never overwrites a user-entered `supplierTaxAmount`.
2. On new PO/purchase-invoice lines, call `resolveLineTaxes({ source: "purchase", supplierId, itemId, date })` and set `taxCodeId` from the result. Do not compute or set `supplierTaxAmount` from the code in this task (the purchase invoice remains supplier-authoritative; a suggested amount display is Task 15's UI concern).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** use-tax accrual (Phase 2); generated `taxPercent`/`taxAmount` columns on purchase lines (they stay GENERATED from supplierTaxAmount — do not touch).

---

## Task 9: Tax codes routes + table + form (components editor)

**Depends on:** Task 5
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/tax-codes.tsx`, `tax-codes.new.tsx`, `tax-codes.$taxCodeId.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Tax/TaxCodesTable.tsx`, `TaxCodeForm.tsx`, `index.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/payment-terms.tsx` + `payment-terms.new.tsx` + `payment-terms.$paymentTermId.tsx`; form fields precedent for account selects: `apps/erp/app/modules/accounting/ui/FixedAssets/AssetClassForm.tsx:134-169` (`<Account>` from `~/components/Form`)

**Steps:**
1. Clone the payment-terms route trio: list route (loader `getTaxCodes` + `requirePermissions(request, { view: "accounting" })`), `new` and `$taxCodeId` as Drawer overlay routes rendered via the list route's `<Outlet />` (Drawer pattern per the payment-terms precedent — never cards below the table).
2. `TaxCodeForm` (ValidatedForm + `validator(taxCodeValidator)`): name, description, calculationType select, reportingCategory select, invoiceMessage textarea, country select (existing country select component — grep `~/components/Form` for `Country`; if none exists, use a plain `Select` fed by a countries loader), state input, active checkbox.
3. Components editor inside the drawer, below the code fields: a row list (add/remove/reorder by sequence) with per-row: name, authority select (from `getTaxAuthoritiesList`), rate (percent input storing 0..1 — follow how `taxPercent` inputs elsewhere convert, grep `taxPercent` in `apps/erp/app/modules/sales/ui/`), isCompound + isRecoverable checkboxes, `<Account>` selects for salesTaxAccountId/purchaseTaxAccountId, effective/expiration date pickers. Submit posts components as a JSON field or repeated fields to the same action, which calls `upsertTaxCode` + `upsertTaxCodeComponents` in sequence. Show a computed effective-rate preview (`computeEffectiveTaxRate` on the current rows) in the drawer footer, formatted as a percent — plain number, no parentheses.
4. Table columns: name, effective rate (computed), calculation type, reporting category, active; row actions edit/delete gated by `permissions.can("update", "accounting")` per the payment-terms precedent.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** Xero TaxType select (Phase 3); nav registration (Task 11).

---

## Task 10: Tax authorities + tax registrations routes

**Depends on:** Task 5
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/tax-authorities.tsx`, `tax-authorities.new.tsx`, `tax-authorities.$taxAuthorityId.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/tax-registrations.tsx`, `tax-registrations.new.tsx`, `tax-registrations.$taxRegistrationId.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Tax/TaxAuthoritiesTable.tsx`, `TaxAuthorityForm.tsx`, `TaxRegistrationsTable.tsx`, `TaxRegistrationForm.tsx` (export from `ui/Tax/index.ts`)
- Copy from (precedent): the same payment-terms trio as Task 9

**Steps:**
1. Authorities: name + optional supplier select (grep `~/components/Form` for the `Supplier` select component used in purchasing forms). Delete action surfaces the referenced-by-components error from Task 5 as a flash error.
2. Registrations: country select, state, registrationNumber, effective/end dates.
3. Cross-warnings on the registrations list route loader: compute (a) active tax codes whose `countryId`/`state` match no active registration, and (b) registrations matching no active code; render each as an `Alert`-style banner above the table (grep `packages/react/src` for the existing `Alert` component).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** Avalara nexus mirror (Phase 3).

---

## Task 11: Accounting nav + path.to entries for the Tax group

**Depends on:** Tasks 9, 10 (routes exist)
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — add entries
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — add a "Tax" group

**Steps:**
1. `path.ts`, mirroring the paymentTerms trio exactly (list/new/id + generatePath): `taxCodes`, `newTaxCode`, `taxCode(id)`, `taxAuthorities`, `newTaxAuthority`, `taxAuthority(id)`, `taxRegistrations`, `newTaxRegistration`, `taxRegistration(id)`, `taxLiability` (report route, Task 21).
2. `useAccountingSubmodules.tsx`: add a "Tax" group containing Tax Codes, Tax Authorities, Tax Registrations, Tax Liability, following the existing group structure (Reports / General Ledger / Fixed Assets / Configure). Place Tax Liability under the Reports group if groups are semantic rather than positional — match how Fixed Assets pages are grouped and keep all four tax entries together in one "Tax" group. Use `msg`-style breadcrumb/label conventions already present in the file.
3. Update Tasks 9/10 routes to use the new `path.to` helpers if they hardcoded URLs.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** MES nav (tax is ERP-only).

---

## Task 12: Customer/supplier tax-code assignment UI + taxPercent sunset banner

**Depends on:** Tasks 5, 6
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomerTaxForm.tsx` — Tax Code select + suggestion + conditional taxPercent
- Modify: `apps/erp/app/routes/x+/customer+/$customerId.tax.tsx` — loader/action
- Modify: `apps/erp/app/modules/purchasing/ui/Supplier/SupplierTaxForm.tsx` + `apps/erp/app/routes/x+/supplier+/$supplierId.tax.tsx` — same changes
- Modify: `apps/erp/app/modules/sales/sales.models.ts` + `purchasing.models.ts` — add `taxCodeId` to the tax validators
- Modify: `apps/erp/app/modules/sales/sales.service.ts` + `purchasing.service.ts` — persist `customer.taxCodeId` / `supplier.taxCodeId` in the update functions used by those routes

**Steps:**
1. Add a Tax Code select (options from `getTaxCodesList`, loaded in the route loader) to `CustomerTaxForm`; persist to `customer.taxCodeId` via the route action (extend `updateCustomerTax` or the customer update it delegates to — follow where `taxId`/`taxPercent` are saved today).
2. Suggestion: in the loader, fetch the customer's primary location address (via `customerLocation`/`address`); call `suggestTaxCode` with its `countryId`/`state`; when the customer has no `taxCodeId` and suggestions exist, render a dismissible inline hint ("This address looks like {state}: apply {code name}?") with an apply button that sets the select value. No document-time inference anywhere.
3. Sunset banner (OQ 4): in the loader, check whether the company has any party with a `taxCodeId` (one `select id, limit 1` on customer + supplier where `taxCodeId is not null`). If yes, hide the `taxPercent` input and render a banner: "Flat tax percent is deprecated — assign tax codes instead." If no, keep today's `taxPercent` field.
4. Mirror all of 1–3 for the supplier form/route.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** bulk assignment (do NOT build a new bulk-update route in this task — if the customers table already has a bulk-update action route analogous to `apps/erp/app/routes/x+/items+/update.tsx`, add `taxCodeId` to it; if it does not exist, note that in the task result and leave bulk for a follow-up).

---

## Task 13: Customer location override select

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomerLocationForm.tsx` — Tax Code override select
- Modify: the customer-location route(s) that render this form (grep `CustomerLocationForm` under `apps/erp/app/routes/x+/customer+/`) — loader provides `getTaxCodesList`, action persists `customerLocation.taxCodeId`
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — location validator gains `taxCodeId`

**Steps:**
1. Add an optional "Tax Code (override)" select under the address block in `CustomerLocationForm` (empty option = "Inherit from customer"). Persist through the location upsert service (grep `insertCustomerLocation` / `updateCustomerLocation` in `sales.service.ts`).
2. On address change in this form, surface the same `suggestTaxCode` hint as Task 12 (reuse the hint component — extract it to `apps/erp/app/modules/accounting/ui/Tax/TaxCodeSuggestion.tsx` and export it if Task 12 inlined it).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** supplier locations (purchase determination uses the supplier default only in Phase 1).

---

## Task 14: Item "Taxable" switch

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Parts/PartProperties.tsx` — Boolean property
- Modify: sibling properties panels that expose the same block: grep `Requires Inspection\|requiresInspection` under `apps/erp/app/modules/items/ui/` and add the same switch to every panel that has it (Tools, Materials, Consumables, Services as applicable)
- Modify: `apps/erp/app/routes/x+/items+/update.tsx` — accept the `taxable` field
- Copy from (precedent): `PartProperties.tsx:600-627` (`<Boolean label="Active" …>` / `<Boolean label="Requires Inspection" …>`)

**Steps:**
1. Add `<Boolean label="Taxable" name="taxable" variant="small" onChange={(value) => onUpdate("taxable", value)} />` (match the exact `onUpdate`/fetcher submission idiom of the `requiresInspection` switch in each panel).
2. In `x+/items+/update.tsx`, add `taxable` to the accepted fields (boolean coercion matching how other booleans are parsed there). It is a plain item column — no cascade logic (do NOT touch `deriveItemMethodUpdate` / method-material cascades).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** item views/tables surfacing `taxable` as a column (not needed for Phase 1).

---

## Task 15: Line form tax display + override select + audit coverage

**Depends on:** Tasks 6, 7, 8
**Files:**
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm.tsx`
- Modify: `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceLineForm.tsx`
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderLineForm.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteLineForm.tsx`
- Modify: the corresponding line route actions to accept/persist `taxCodeId` (grep each form's `action` route)
- Modify: `packages/database/src/audit.config.ts` — ensure line tables are audited
- Copy from (precedent): `SalesInvoiceLineForm.tsx:71-143` (where `taxPercent` already flows into totals math)

**Steps:**
1. In each line form, add a "Tax Code" select (options via `getTaxCodesList` provided by the parent route loader; empty option = "None / manual"). When a code is selected, set the form's `taxPercent` to the code's effective rate (fetch via a small loader/fetcher call to a `resolveLineTaxes`-backed endpoint or pass the codes list with precomputed effective rates from the loader — prefer precomputed rates in the loader: extend `getTaxCodesList` to include `effectiveRate` computed at `today`). Keep `taxPercent` visible read-only next to the select when a code is chosen; editable when "None / manual".
2. Persist `taxCodeId` in each line action (the zod line validators in `sales.models.ts` / `invoicing.models.ts` gain `taxCodeId: zfd.text(z.string().optional())`).
3. Audit coverage (OQ 3): open `packages/database/src/audit.config.ts`; if `salesOrderLine` / `salesInvoiceLine` / `purchaseInvoiceLine` / `quoteLine` are already configured entities, confirm new columns are captured automatically (diff-based) and do nothing. If they are NOT in the config, this is an "Ask First" boundary per `packages/database/AGENTS.md` — STOP on that sub-step and report rather than adding entities unilaterally; the rest of the task proceeds.
4. Purchase invoice line form additionally shows "Suggested tax: {amount}" (computed from the resolved code's effective rate × line base) next to `supplierTaxAmount` — display only, never auto-overwrites the supplier amount.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** MES line UIs; changing how `taxPercent` totals math works in these forms (it already multiplies correctly).

---

## Task 16: Shared edge-function tax resolver helper

**Depends on:** Task 2
**Files:**
- Create: `packages/database/supabase/functions/shared/resolve-taxes.ts`
- Copy from (precedent): `packages/database/supabase/functions/shared/get-accounting-period.ts` (shared-helper shape), `packages/database/supabase/functions/shared/get-posting-group.ts` (accountDefault fetch)

**Steps:**
1. Export three functions (Deno imports per the edge-function rule — types from `../lib/types.ts`):
   - `getEffectiveComponents(components, date)` and `computeComponentTaxes(components, taxableBase, decimals)` — port the Task 4 math VERBATIM (same rounding: per-component, half-up at currency decimals; keep the functions in sync by comment reference to `accounting.utils.ts`).
   - `getLineTaxContext(client, companyId, { taxCodeId, date })` — fetches the code + components effective at `date`, returns `{ calculationType, reportingCategory, components: [{ id, name, taxAuthorityId, rate, isCompound, isRecoverable, salesTaxAccountId, purchaseTaxAccountId }] }`; returns null when `taxCodeId` is null.
2. No `requirePermissions` here — callers (posting functions) already hold a service-role client inside their transaction.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check shared/resolve-taxes.ts
# Expected: exit 0 (no type errors). If deno is unavailable locally, verify via the edge-runtime container logs after Task 17 and note it.
```

**Out of scope:** calling it (Tasks 17–19); Avalara (Phase 3).

---

## Task 17: post-sales-invoice — tax split, ledger writes, VOID reversals, shipping taxability

**Depends on:** Task 16
**Files:**
- Modify: `packages/database/supabase/functions/post-sales-invoice/index.ts`

**Steps:**
1. **Revenue net of tax.** At the line-cost computation ([index.ts:302-306](packages/database/supabase/functions/post-sales-invoice/index.ts)), split: `netLineAmount = qty × unitPrice + shipping + addOn` (NO `× (1 + taxPercent)`), `lineTaxAmount` computed as follows: if the line has `taxCodeId`, fetch context once per distinct code (cache in a Map) via `getLineTaxContext` and use `computeComponentTaxes(components, netTaxableBase, decimals)` where `netTaxableBase` excludes `nonTaxableAddOnCost` exactly as the invoice-totals view does; if no code but `taxPercent > 0`, `lineTaxAmount = round(netTaxableBase × taxPercent)` as a single pseudo-component. All amounts × `invoiceExchangeRate` for base currency, same as existing math.
2. **Journal lines.** Keep AR debit **gross** (`net + tax`, weighted shipping unchanged). Credit revenue with **net**. For each component (or the pseudo-component), credit `component.salesTaxAccountId ?? accountDefaults.data.salesTaxPayableAccount` with the component tax amount, description `"Sales Tax – " + componentName` (legacy: `"Sales Tax"`). If `accountDefaults.data.salesTaxPayableAccount` is null/empty when needed, throw a clear error ("Sales tax payable account is not configured") — surfaced like other posting errors.
3. **Exempt/zero lines.** When resolution kind was exempt (line has customer marked exempt — fetch `customerTax` once per invoice) or `item.taxable = false` or effective rate 0: post no tax journal lines, but still write the ledger row (step 4) with `exemptAmount = netTaxableBase`, snapshotting `taxExemptionReason`/`exemptionCertificateNumber` from `customerTax` when customer-exempt.
4. **taxLedger rows.** Inside the same Kysely transaction that writes journal lines, insert one `taxLedger` row per line per component (and one per exempt/legacy line): source `'Sales'`, documentType `'Sales Invoice'`, documentId, documentLineId, journalId, postingDate (same date the journal uses), taxCodeId, taxCodeComponentId, componentName, taxAuthorityId, customerId, rate, taxableAmount (base ccy), taxAmount, exemptAmount, currencyCode, exchangeRate, createdBy = the posting userId.
5. **Shipping taxability.** Fetch `companySettings.shippingIsTaxable`; when true and the invoice has document-level (shipment) shipping, tax that shipping at the FIRST line's resolved code context (document-level shipping has one destination); write its own tax journal credit + ledger row with documentLineId null. When false, current behavior (untaxed).
6. **VOID path.** In the VOID branch (grep `VOID` in this file, ~line 1263/1393): insert negated `taxLedger` rows mirroring the original document's rows (select the original rows by documentId, flip signs of taxableAmount/taxAmount/exemptAmount, stamp the void journalId + posting date).
7. Line-cost allocation weighting (`lineCostPercentageOfTotalCost`) must keep using GROSS totals so shipping weighting behavior is unchanged — only the revenue/tax credit split changes. Fixed-asset disposal invoice lines and intercompany branches: apply the same AR-gross/revenue-net/tax-credit split where those branches credit revenue/proceeds; if a branch's structure makes the split ambiguous, STOP and report the branch rather than guessing.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check post-sales-invoice/index.ts
# Expected: exit 0.
# Then, with the local stack running (crbn up) and accounting enabled (/x/settings/accounting):
# post a sales invoice with taxPercent = 0.0825 via the UI and check:
psql "$SUPABASE_DB_URL" -c 'SELECT "componentName", "taxableAmount", "taxAmount" FROM "taxLedger" ORDER BY "createdAt" DESC LIMIT 5;'
# Expected: rows for the posted invoice; journal shows revenue net + "Sales Tax" credit lines (inspect via the UI journal viewer).
```

**Out of scope:** post-shipment / post-receipt (no tax there); Avalara commit calls (Phase 3); changing COGS/inventory entries.

---

## Task 18: post-purchase-invoice — recoverable input tax, reverse charge, ledger writes

**Depends on:** Task 16
**Files:**
- Modify: `packages/database/supabase/functions/post-purchase-invoice/index.ts`

**Steps:**
1. Per line with a `taxCodeId`, fetch context (Map-cached). Split the line's `taxAmount` (already base currency, GENERATED from `supplierTaxAmount × exchangeRate`) across effective components proportionally by component share of the effective rate (rounding per component, half-up; last component absorbs the residual so the sum equals the line's `taxAmount` exactly).
2. **Normal + recoverable components:** debit `component.purchaseTaxAccountId ?? accountDefaults.data.purchaseTaxPayableAccount` for the component share; reduce the cost debit by the same amount (cost posts net of recoverable tax); set `postedToInputAccount = true` on those ledger rows. **Normal + non-recoverable (or no code):** current behavior — tax stays in `lineCost` ([index.ts:449-458](packages/database/supabase/functions/post-purchase-invoice/index.ts)), AP gross, `postedToInputAccount = false`. Mixed codes (some components recoverable, some not) split accordingly.
3. **Reverse Charge codes** (`calculationType = 'Reverse Charge'`): the supplier charged no tax (`supplierTaxAmount` expected 0 — if non-zero, treat as Normal and log a warning into the function's console): compute the notional tax from the code's effective rate on the line base; post Dr `purchaseTaxAccountId ?? accountDefault.purchaseTaxPayableAccount` (recoverable) / Cr `accountDefault.reverseChargeSalesTaxPayableAccount` for the same amount; AP stays net (unchanged). If the reverse-charge account default is missing when needed, throw "Reverse charge sales tax payable account is not configured".
4. **taxLedger rows** in the same transaction: source `'Purchase'`, documentType `'Purchase Invoice'`, one row per component (recoverable, non-recoverable, and both legs' identity for reverse charge: one row with the input-side amount, `taxAmount` positive; reverse-charge output leg is represented by the same row — do NOT write two rows per component; the settlement report reads reverse-charge codes by `reportingCategory`). Include supplierId, rates, bases (base currency).
5. **VOID path**: negated ledger rows, mirroring Task 17 step 6.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check post-purchase-invoice/index.ts
# Expected: exit 0.
psql "$SUPABASE_DB_URL" -c 'SELECT "source", "componentName", "taxAmount", "exemptAmount" FROM "taxLedger" WHERE "source" = '"'"'Purchase'"'"' ORDER BY "createdAt" DESC LIMIT 5;'
# Expected: purchase rows after posting a purchase invoice with a coded line.
```

**Out of scope:** use-tax accrual affordance (Phase 2); touching the GENERATED columns; post-receipt.

---

## Task 19: post-memo — net/tax split + signed ledger rows

**Depends on:** Task 16
**Files:**
- Modify: `packages/database/supabase/functions/post-memo/index.ts`
- Modify: `apps/erp/app/modules/invoicing/ui/Memo/MemoForm.tsx` — tax code select + computed tax display
- Modify: the memo route(s) that render/submit `MemoForm` (grep `MemoForm` under `apps/erp/app/routes/x+/credits+/`) — loader provides tax codes list; action persists `taxCodeId`/`taxAmount`

**Steps:**
1. **MemoForm:** add a Tax Code select (options w/ precomputed effective rates from the loader, as in Task 15). When set, compute `taxAmount = round(amount × r / (1 + r))` client-side and show it read-only ("Includes {taxAmount} tax"), submitting both fields; allow manual `taxAmount` edit (validator caps at `amount`). `amount` label/semantics unchanged (gross).
2. **post-memo edge function:** locate the journal-line construction (memo posts Dr/Cr `reasonAccount` vs AR/AP for `amount`). With a `taxCodeId` and `taxAmount > 0`: keep the AR/AP leg at gross `amount`; post the `reasonAccount` leg at `amount − taxAmount`; post the tax leg per component (proportional split as Task 18 step 1) to `salesTaxAccountId`/`purchaseTaxAccountId` fallback chain by party side, with the sign that mirrors the reason-account leg (Credit memo for a customer: Dr reason net, Dr output tax, Cr AR gross; Debit memo flips; supplier memos mirror on the purchase side using purchase accounts).
3. **taxLedger rows:** one per component, source by party side (`'Sales'` for customer memos, `'Purchase'` for supplier), documentType `'Memo'`, signed so that a customer Credit memo REDUCES the period's output tax (negative `taxAmount`) and a customer Debit memo increases it; supplier memos mirror, with `postedToInputAccount = true` when the tax leg hits a purchase tax account. `taxableAmount` = signed `(amount − taxAmount)` in base currency (× memo exchangeRate).
4. Memos with no `taxCodeId` (or `taxAmount = 0`) post byte-identically to today — guard the whole feature behind `taxAmount > 0`.
5. If `post-memo/index.ts` does not exist or memo posting turns out to live elsewhere (grep `functions.invoke("post-memo"` under `apps/erp/`), STOP and report the actual location before editing.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check post-memo/index.ts
# Expected: exit 0.
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** memo application/settlement logic (`invoiceSettlement`) — signs there are amount-based and unaffected because `amount` semantics are unchanged.

---

## Task 20: Sales invoice PDF tax summary, clauses, registration numbers

**Depends on:** Task 17 (data available), Task 2 (types)
**Files:**
- Modify: `packages/documents/src/pdf/SalesInvoicePDF.tsx`
- Modify: `packages/documents/src/utils/sales-invoice.ts`
- Modify: the PDF data loader that assembles SalesInvoicePDF props (grep `SalesInvoicePDF` under `apps/erp/app/` and `packages/database/supabase/functions/` to find where props are built — likely the document render route/edge function)

**Steps:**
1. Extend the PDF props with: `taxSummary: { name: string; rate: number; amount: number }[]` (grouped by component name — built from the lines' tax codes' effective components, or for legacy lines a single "Tax" row), `taxMessages: string[]` (distinct `invoiceMessage` values of codes on the document), `sellerTaxRegistrationNumber: string | null` (active `taxRegistration` matching the company's country, else `company.taxId`), `customerVatNumber: string | null` (from `customerTax.vatNumber`, only when any line's code has reportingCategory `Reverse Charge` or `Export`).
2. In `SalesInvoicePDF.tsx`, render: the tax summary rows between subtotal and total (one row per component: name, rate as percent, amount — no parentheses around numbers); `taxMessages` as small print under the totals block; registration numbers in the header/footer block where `company.taxId` (or equivalent) renders today — grep this file for existing tax/company-identity display and extend in place.
3. Keep `getLineTaxesAndFees` math untouched; add a `getTaxSummaryByComponent(lines, codeContexts)` helper in `utils/sales-invoice.ts` used by the props builder.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/documents
# Expected: exit 0.
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0 (props builder).
```

**Out of scope:** quote/PO PDFs (follow-up); document template customizer blocks beyond what the invoice template already renders.

---

## Task 21: Tax liability report (service + route)

**Depends on:** Tasks 17, 18
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getTaxLiability`
- Create: `apps/erp/app/routes/x+/accounting+/tax-liability.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Tax/TaxLiabilityTable.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/trial-balance.tsx:27-80` (date-range loader + `ReportFilters`); table CSV export is built into the shared Table per `.ai/rules/table-csv-export.md`

**Steps:**
1. `getTaxLiability(client, companyId, { startDate, endDate, taxAuthorityId? })` — aggregate `taxLedger` grouped by `taxAuthorityId` + `componentName`: `sum(taxableAmount)`, `sum(exemptAmount)`, `sum(taxAmount) filter (source = 'Sales')` as collected, `sum(taxAmount) filter (source = 'Purchase' AND "postedToInputAccount")` as input tax (the flag is written by Tasks 18–19; capitalized non-recoverable purchase tax appears in the bases but not as input tax). Net = collected − input.
2. Route with `requirePermissions({ view: "accounting" })`, `ReportFilters` for the date range + an authority filter select, and a grouped table (authority → component rows) with the standard Table (CSV export comes free).
3. Register `taxLiability` in `path.ts`/nav if not done in Task 11.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0.
```

**Out of scope:** returns/settlement (Phase 2); GL cross-tie automation (manual check in Task 23).

---

## Task 22: Lingui extract + full scoped validation

**Depends on:** all code tasks (3–21)
**Files:**
- Modify: `packages/locale/locales/*/erp.po` (generated by extract)

**Steps:**
1. `pnpm lingui:extract` (new UI strings from Tasks 9–15, 20–21 land in the `.po` catalogs). Run `pnpm lingui:clean` if headers churn.
2. Run the full scoped gate: `pnpm run lint`, `pnpm exec turbo run typecheck --filter=@carbon/erp --filter=@carbon/documents --filter=@carbon/database`, `pnpm --filter @carbon/erp test`.

**Verify:**
```bash
pnpm run lint && pnpm exec turbo run typecheck --filter=@carbon/erp --filter=@carbon/documents && pnpm --filter @carbon/erp test
# Expected: all exit 0.
```

**Out of scope:** `pnpm translate` (LLM translation pass — user-triggered).

---

## Task 23: Browser verification via /test

**Depends on:** Task 22
**Files:** none (verification)

**Steps:**
1. Boot the stack with plain `crbn up` (portless `*.dev`). Enable accounting locally at `/x/settings/accounting` (fresh resets seed `accountingEnabled=false`).
2. Invoke the `/test` skill with this scenario: (a) create tax authority "Texas Comptroller"; (b) create tax code "TX – Austin" with components State 6.25 + City 2.0, match fields US/TX; (c) open a customer with a TX address — confirm the suggestion hint, assign the code; (d) create a sales order line for that customer — confirm `taxPercent` shows 8.25%; (e) invoice and post it; (f) verify the journal shows revenue net + two Sales Tax credit lines and AR gross; (g) open Tax Liability for today — confirm the two component rows with correct bases; (h) create + post a Credit memo with the code — confirm the liability report nets down; (i) screenshot each step (ValidatedForm submits via `requestSubmit`; blur react-aria number fields first).
3. Any "Something went wrong"/blank page → capture via the `/error` skill and fix before proceeding.

**Verify:**
```bash
# /test run transcript + screenshots; liability report totals match the posted documents:
# 8.25% of the order line base split 6.25/2.00 across the two component rows, memo negative.
# Expected: playbook cached under .ai/playbooks/.
```

**Out of scope:** Phase 2/3 scenarios (returns, use tax, Avalara).
