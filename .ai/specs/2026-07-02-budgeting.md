# GL Budgeting with Cost Centers, Commitments & Budget Control

> Status: in-progress
> Author: Claude (for Brad Barbin)
> Date: 2026-07-02
> Research: `.ai/research/budgeting.md` (SAP, NetSuite, Dynamics 365 Business Central)
> Depends on: `.ai/specs/2026-07-02-period-closing.md` (fiscalYear/periodNumber on `accountingPeriod`, `createFiscalYearPeriods`)

## TLDR

Add full-cycle budgeting to the accounting module in three phases. **Phase 1 —
Core budgeting:** a `budget` header (a named plan for one fiscal year; multiple
per year act as versions/scenarios) and `budgetLine` rows keyed by **GL account
× accounting period × optional cost center**, entered through a spreadsheet-style
matrix (accounts × periods), seeded by copying a prior budget or prior-year
actuals with an adjustment factor, round-tripped through CSV, and consumed
through a Budget vs Actual report (Actual / Budget / Variance / Variance %) with
cost-center filtering and hierarchy rollup. **Phase 2 — Commitments & budget
control:** open purchase-order lines coded to an account + cost center (the
indirect-purchasing columns that already exist) count as committed spend;
a per-company budget control policy (Warn or Block at a threshold %) checks
purchasing documents against the designated Approved budget — SAP availability
control / NetSuite Budget Validation, grounded in Carbon's existing PO
structures. **Phase 3 — Reporting integration:** budget comparison columns on
the income statement and consolidated group-level budget vs actual. An
Approved-budget immutability trigger (period-close-style backstop) makes
enforcement targets trustworthy.

## Problem Statement

Carbon can record actuals with full analytical detail — journal lines carry
`accountId` and cost-center tags via `journalLineDimension` (written by every
`post-*` edge function), purchase order lines already carry `accountId` +
`costCenterId` for indirect spend — but there is nowhere to record what those
numbers were *supposed* to be, and nothing that uses the plan to inform or
control spend. A controller planning FY2027 cannot say "R&D cost center:
$40k/month of `6100 - Salaries`, $5k/month of `6400 - Software`", cannot see in
March that R&D is 12% over on software, and cannot have the system warn a buyer
that the PO they're about to release exhausts the marketing budget.

Today a Carbon customer budgets in a spreadsheet, exports the income statement
monthly, and reconciles by hand; over-budget spend is discovered after the
invoice posts. Every competitor ERP we surveyed treats budget-vs-actual
variance as the daily-use surface of managerial accounting, and both SAP
(availability control) and NetSuite (Budget Validation SuiteApp) offer
threshold-based purchasing checks as the control layer. Carbon has all the
underlying structures — chart of accounts, first-class periods, cost centers,
dimension-tagged GL, account-coded PO lines — and no budgeting on top of them.

## Proposed Solution

All inside the existing `accounting` module (enforcement hooks touch the
purchasing release/posting flow in Phase 2). Delivered in three phases, each
independently shippable.

### Phase 1 — Core budgeting

1. **Budget headers** (`budget`): name-unique-per-company plans, each covering
   one fiscal year, with lifecycle `Draft → Approved → Archived`. Multiple
   budgets per fiscal year are the versioning mechanism ("2027 Original",
   "2027 Reforecast Q2") — NetSuite budget categories / BC budget names / SAP
   versions. Approving records `approvedBy`/`approvedAt` and freezes lines
   (DB trigger); revisions happen by copying to a new Draft ("Revise" action),
   which is how SAP keeps version 0 trustworthy.
2. **Budget lines** (`budgetLine`): one row per cell —
   `(budgetId, accountId, accountingPeriodId, costCenterId?)` → `amount`.
   NetSuite-style period buckets (upsertable cells), not BC's additive entry
   ledger. `NULL` cost center = company-level line (industry convention:
   blank-dimension rows are not apportioned down).
3. **Matrix editor**: accounts × the FY's periods, editable cells (building on
   the `EditableNumberCell` pattern from `QuoteLinePricing`), cost-center
   selector, account filters (default: income-statement posting accounts),
   Fill / Distribute helpers (NetSuite semantics). Prior-year-profile shaping
   (SAP distribution-key analog) comes from seed-from-actuals, which preserves
   the source year's monthly curve by construction (`spread: "even"` flattens
   it); row-level matrix helpers are Fill and Distribute only.
4. **Seeding services**: copy another budget or seed from a fiscal year's
   posted actuals, both with an adjustment factor ("last year + 5%"),
   period-number-mapped across years.
5. **CSV round-trip**: export from the matrix/report via the existing
   table-export mechanism; **import via the `import-csv` edge function** (new
   `budgetLine` entry in its table enum) — research is unanimous that
   spreadsheet round-trip is the real bulk-entry path.
6. **Budget vs Actual report**: RPC + route beside the trial balance — columns
   Actual, Budget, Variance, Variance %, filterable by budget, period range,
   and cost center, with **cost-center hierarchy rollup** (child cost centers
   aggregate into parents via `parentCostCenterId`, SAP standard-hierarchy
   style) and an explicit "untagged actuals" row when filtering by cost center.

### Phase 2 — Commitments & budget control

7. **Commitments**: outstanding amounts of open PO lines that are coded to a
   GL account (`purchaseOrderLine.accountId`, i.e. indirect/G-L-Account-type
   lines, with their `costCenterId`) count as committed spend: outstanding =
   ordered − invoiced, valued at line price. Consumed = actuals + commitments;
   Available = budget − consumed (SAP assigned-value model). The Budget vs
   Actual report gains Committed and Available columns.
8. **Budget control policy** (`budgetControlPolicy`): per-company record
   designating **which Approved budget enforces**, the action (**Warn** or
   **Block**), and a **threshold %** (e.g. warn at 90% consumed) — NetSuite
   Budget Control record shape, SAP tolerance-limit semantics. At most one
   active policy per company.
9. **Enforcement hook**: on PO release (and warn-only on purchase invoice
   posting for invoices without a PO), for each account-coded line, check
   annual consumed + this document against the designated budget for that
   account (+ cost center). Warn → flash message + banner, still saves.
   Block → the release fails with a clear message; users holding
   `accounting_update` may override with a reason (SAP authorization-group
   analog), and the override is recorded. Annual check only in v1 — matching
   S/4HANA cost-center AVC, which is annual-only to this day.
10. **Approved-budget immutability trigger**: `budgetLine` writes are rejected
    unless the parent budget is `Draft` (period-close trigger pattern) — an
    enforcement target that can drift is worse than none.

### Phase 3 — Reporting integration & consolidation

11. **Income statement integration**: an optional "Compare to budget" picker on
    the existing income statement route adds Budget / Variance columns
    (BC account-schedule `ACT/BUD` analog) using the same RPC.
12. **Consolidated budget vs actual**: group-level rollup across companies,
    translating budget amounts with the same mechanism as actuals
    (`translateCompanyBalances`) — no separate budget-exchange-rate table
    (deliberate simplification vs NetSuite; see open question 4).

### What stays out (all phases)

- **Driver-based planning, approval routing/workflows engine, rolling-forecast
  automation, allocations** — the EPM tier (NSPB / SAC territory).
- **Generic budget dimensions** (BC Budget Dimension 1–4): budgets slice by
  cost center only. Carbon's own operational pattern is a hard `costCenterId`
  column on documents (indirect purchasing) converted to generic dimensions
  only at GL posting — budgeting follows the same pattern. A
  `budgetLineDimension` table can be added later without reshaping `budgetLine`.
- **Budget exchange rates** — consolidation translates at the same rates as
  actuals.
- **Xero sync** — budgets are not an `AccountingEntityType`.
- **Item/quantity budgets, statistical key figures (headcount)** — noted for a
  future demand-planning intersection.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Multi-tenancy | `companyId` + composite PK `("id", "companyId")` on all three new tables; child FKs include `companyId` | Carbon convention (canonical template `20260609143732_document-template.sql`); budgets are per-company (NetSuite: subsidiary-specific) even though the COA is group-scoped |
| Data shape | Header + one row per cell (account × period × cost center), upsertable | NetSuite `budgets`/`budgetsMachine` bucket model; avoids BC's additive entry ledger + registers; cells map 1:1 to matrix UI and CSV rows |
| Period keying | `budgetLine.accountingPeriodId` FK → `accountingPeriod` | Actuals already group by `journal.accountingPeriodId`; period-close spec makes periods first-class (`fiscalYear`, `periodNumber`); budget creation ensures the FY's periods exist via `createFiscalYearPeriods` |
| Cost center dimension | Nullable `costCenterId` FK column on `budgetLine`; NULL = company-level | Matches Carbon's own operational pattern (`purchaseOrderLine.costCenterId`, `20260503000000_indirect-purchases.sql`) and SAP/BC-cost-accounting's hardwired cost-center axis; keeps variance and commitment SQL simple |
| Actuals-by-cost-center | Join `journalLineDimension` → `dimension` where `entityType = 'CostCenter'` | Already written by every `post-*` edge function (e.g. `post-purchase-invoice` maps `invoiceLine.costCenterId` → dimension row); budgets introduce no second tagging mechanism |
| Commitments source | Open `purchaseOrderLine` rows with `accountId` set (indirect lines), outstanding = ordered − invoiced | Columns already exist; SAP commitments are strongest for account-assigned (indirect) POs; inventory PO lines post to balance-sheet accounts that aren't spend-controlled the same way |
| Enforcement posture | Off by default; per-company opt-in policy with Warn/Block + threshold %; annual check; permission-gated override | Consensus: reporting-only is every ERP's default; opt-in control mirrors NetSuite's SuiteApp and S/4HANA AVC (annual-only); hard blocks need an escape hatch |
| Sign convention | Store GL-signed amounts (positive = debit, matching `journalLine.amount`); UI enters/displays natural positive per account class | Variance = actual − budget with no CASE logic; income statement already does class-based sign flipping (`applyRootSignCorrection`); BC stores GL-signed too |
| Status lifecycle | Enum `budgetStatus`: `Draft`, `Approved`, `Archived`; `approvedBy`/`approvedAt` on header; lines writable only in Draft (DB trigger); Approved → Archived only; "Revise" = copy to new Draft | SAP: the budget is the *approved, binding* figure; immutability is what makes enforcement meaningful; copy-to-revise keeps an audit-clean original (NetSuite "keep Original immutable" practice) |
| Period close interaction | None — budgets stay editable (in Draft) regardless of period `closeStatus` | BC/NetSuite precedent: budgets are planning data, not books of record |
| RLS | Four standard policies per table; SELECT via `get_companies_with_employee_role()`, writes via `get_companies_with_employee_permission('accounting_<action>')` | Matches `costCenter` (`20260317233050_cost-centers.sql`) |
| Permission scoping | Reuse `accounting` module permissions | Cost centers, journals, periods all use `accounting_*`; adding a `module` enum value ripples through the permission UI for little gain; the Block-override doubles as the elevated action gate |
| Service function shape | All in `accounting.service.ts`, `client` first arg, `{ data, error }`; copy/seed run as SQL functions (`copyBudgetLines`, `seedBudgetLinesFromActuals`) wrapped by services calling `client.rpc` | `.ai/rules/conventions-services.md`; SQL functions are atomic and SECURITY INVOKER (RLS applies), and avoid Kysely `as any` casts for tables absent from the cloud-generated types |
| Module layout | Extend `accounting.models.ts` / `accounting.service.ts`; UI under `modules/accounting/ui/Budgets/`; Phase 2 hook lives in the purchasing release action calling an accounting service | One service/models file per module; cross-module touch is one call site |
| Form pattern | `ValidatedForm` + `validator(zodSchema)` + route actions for header forms; matrix cells write per-cell from the RLS-gated browser client with optimistic state (update-by-id / insert / delete-on-zero) | `.ai/rules/conventions-forms.md`; the QuoteLinePricing precedent — also sidesteps PostgREST `onConflict` against the NULLS NOT DISTINCT constraint |
| Reporting | RPC `budgetVsActual(...)` beside `trialBalance` / `accountTreeBalancesByCompany`; Phase 2 extends it with committed | Aggregation belongs in Postgres like every financial report here |
| Matrix UI | Spreadsheet-style grid built on the `EditableNumberCell` pattern (`QuoteLinePricing.tsx`, `SupplierQuoteLinePricing.tsx`) | Copy the nearest precedent, don't design from concepts |
| CSV import | New `budgetLine` entry in the `import-csv` edge function table enum + import UI per `.ai/rules/csv-import-system.md`; wide format (one row per account × cost center, `period1`–`period12` columns, natural sign matching export), upserted by cell key | Research unanimous: CSV round-trip is the real entry path; infra exists; wide format is what humans edit in Excel |
| Backward compatibility | Additive except one call added to the PO release action (Phase 2); no FROZEN/STABLE surface changed | Enforcement is inert until a company activates a policy |

## Data Model Changes

Phase 1 migration (`pnpm db:migrate:new budgeting` — randomized HHMMSS), ordered
**after** `20260702044133_period-close-lifecycle.sql`; Phase 2 adds a second
migration for `budgetControlPolicy` + the PO-override audit column. All DDL
idempotent (guards + `DO $$ ... EXCEPTION` for types) per the deploy-runner
retry convention.

```sql
CREATE TYPE "budgetStatus" AS ENUM ('Draft', 'Approved', 'Archived');

CREATE TABLE "budget" (
    "id" TEXT NOT NULL DEFAULT id('bud'),
    "companyId" TEXT NOT NULL,

    "name" TEXT NOT NULL,
    "description" TEXT,
    "fiscalYear" INTEGER NOT NULL,           -- FY named by ending year, matching accountingPeriod.fiscalYear
    "status" "budgetStatus" NOT NULL DEFAULT 'Draft',
    "approvedBy" TEXT REFERENCES "user"("id"),
    "approvedAt" TIMESTAMP WITH TIME ZONE,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    "tags" TEXT[],

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "budget_companyId_idx" ON "budget" ("companyId");
CREATE INDEX "budget_createdBy_idx" ON "budget" ("createdBy");
CREATE INDEX "budget_companyId_fiscalYear_idx" ON "budget" ("companyId", "fiscalYear");

ALTER TABLE "budget" ADD CONSTRAINT "budget_companyId_name_key"
    UNIQUE ("companyId", "name");

CREATE TABLE "budgetLine" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,

    "accountId" TEXT NOT NULL,
    "accountingPeriodId" TEXT NOT NULL,
    "costCenterId" TEXT,                     -- NULL = company-level line
    "amount" NUMERIC NOT NULL DEFAULT 0,     -- GL-signed: positive = debit

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("budgetId", "companyId") REFERENCES "budget"("id", "companyId") ON DELETE CASCADE,
    FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE,
    FOREIGN KEY ("accountingPeriodId") REFERENCES "accountingPeriod"("id") ON DELETE CASCADE,
    FOREIGN KEY ("costCenterId") REFERENCES "costCenter"("id") ON DELETE CASCADE
);

CREATE INDEX "budgetLine_companyId_idx" ON "budgetLine" ("companyId");
CREATE INDEX "budgetLine_budgetId_idx" ON "budgetLine" ("budgetId", "companyId");
CREATE INDEX "budgetLine_accountId_idx" ON "budgetLine" ("accountId");
CREATE INDEX "budgetLine_accountingPeriodId_idx" ON "budgetLine" ("accountingPeriodId");
CREATE INDEX "budgetLine_costCenterId_idx" ON "budgetLine" ("costCenterId");
CREATE INDEX "budgetLine_createdBy_idx" ON "budgetLine" ("createdBy");

-- One cell per (budget, account, period, cost center); PG15 NULLS NOT DISTINCT
-- makes two NULL-cost-center rows for the same cell collide, as intended.
ALTER TABLE "budgetLine" ADD CONSTRAINT "budgetLine_cell_key"
    UNIQUE NULLS NOT DISTINCT ("budgetId", "companyId", "accountId", "accountingPeriodId", "costCenterId");

-- Hard backstop (period-close trigger pattern): lines are writable only while
-- the budget is Draft.
CREATE OR REPLACE FUNCTION check_budget_editable() RETURNS TRIGGER AS $$
DECLARE v_status "budgetStatus";
BEGIN
  SELECT "status" INTO v_status FROM "budget"
    WHERE "id" = COALESCE(NEW."budgetId", OLD."budgetId")
      AND "companyId" = COALESCE(NEW."companyId", OLD."companyId");
  IF v_status IS DISTINCT FROM 'Draft' THEN
    RAISE EXCEPTION 'Budget is % — copy it to a new draft to revise', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "budgetLine_check_editable"
  BEFORE INSERT OR UPDATE OR DELETE ON "budgetLine"
  FOR EACH ROW EXECUTE FUNCTION check_budget_editable();
```

Phase 2 migration:

```sql
CREATE TYPE "budgetControlAction" AS ENUM ('Warn', 'Block');

CREATE TABLE "budgetControlPolicy" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,

    "budgetId" TEXT NOT NULL,                -- must reference an Approved budget (service-enforced)
    "action" "budgetControlAction" NOT NULL DEFAULT 'Warn',
    "thresholdPercent" NUMERIC NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("budgetId", "companyId") REFERENCES "budget"("id", "companyId") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "budgetControlPolicy_one_active_per_company"
    ON "budgetControlPolicy" ("companyId") WHERE "active";
-- + companyId/budgetId/createdBy indexes and the standard four RLS policies

-- Override audit on the purchase order (Block overrides are recorded):
ALTER TABLE "purchaseOrder" ADD COLUMN IF NOT EXISTS "budgetOverrideReason" TEXT;
ALTER TABLE "purchaseOrder" ADD COLUMN IF NOT EXISTS "budgetOverrideBy" TEXT REFERENCES "user"("id");
```

RLS — identical pattern to `costCenter` for all three tables (shown once):

```sql
ALTER TABLE "public"."budget" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."budget"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."budget"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."budget"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."budget"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);
-- ...same four for "budgetLine" and "budgetControlPolicy"
```

### Budget vs Actual RPC (sketch — final SQL in the implementation plan)

```sql
CREATE OR REPLACE FUNCTION "budgetVsActual"(
  p_company_id TEXT,
  p_budget_id TEXT,
  p_cost_center_id TEXT DEFAULT NULL,  -- NULL = company-wide; when set, includes descendant cost centers (recursive CTE on parentCostCenterId)
  p_rollup BOOLEAN DEFAULT TRUE
) RETURNS TABLE (
  "accountId" TEXT,
  "number" TEXT,
  "name" TEXT,
  "periodNumber" INTEGER,
  "budget" NUMERIC,
  "actual" NUMERIC,
  "committed" NUMERIC          -- Phase 2; 0 until then
) LANGUAGE sql SECURITY INVOKER AS $$
  -- budget side: budgetLine ⋈ accountingPeriod (periodNumber); cost-center
  --   filter includes the cost center's subtree when p_rollup; NULL-costCenter
  --   rows are company-level and included only when p_cost_center_id IS NULL;
  -- actual side: journalLine ⋈ journal (accountingPeriodId → the budget's
  --   fiscalYear periods), grouped by accountId + periodNumber, summing
  --   journalLine.amount (signed); cost-center restriction goes through
  --   journalLineDimension jld ⋈ dimension d ON d."entityType" = 'CostCenter'
  --   AND jld."valueId" IN (subtree ids);
  -- committed side (Phase 2): open purchaseOrderLine rows with accountId set,
  --   outstanding = ordered − invoiced, valued at line price, bucketed to the
  --   period of the PO's promised/order date;
  -- FULL OUTER JOIN the sides on (accountId, periodNumber).
$$;
```

Notes:
- Actuals aggregate by `journalLine.accountId` (never the legacy `accountNumber`).
- Security-invoker, called via `client.rpc(...)` so RLS applies — same as
  `trialBalance` / `accountTreeBalancesByCompany`.
- Variance, Variance %, and Available are computed in the loader/UI,
  sign-corrected per account class exactly like the income statement.

After each migration: `pnpm run generate:types` before any typechecking.

## API / Service Changes

All in `apps/erp/app/modules/accounting/accounting.models.ts` and
`accounting.service.ts`, exported through the module barrel.

### Models (zod)

```typescript
export const budgetStatusType = ["Draft", "Approved", "Archived"] as const;
export const budgetControlActionType = ["Warn", "Block"] as const;

export const budgetValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().optional()),
  fiscalYear: zfd.numeric(z.number().int().min(2000).max(2100)),
});

export const budgetLinesValidator = z.object({
  budgetId: z.string().min(1),
  costCenterId: zfd.text(z.string().optional()),   // applies to all cells in the payload
  lines: z.array(
    z.object({
      accountId: z.string().min(1),
      accountingPeriodId: z.string().min(1),
      amount: z.number(),
    })
  ),
});

export const copyBudgetValidator = z.object({
  targetBudgetId: z.string().min(1),
  source: z.enum(["budget", "actuals"]),
  sourceBudgetId: zfd.text(z.string().optional()),
  sourceFiscalYear: zfd.numeric(z.number().int().optional()),
  adjustmentFactor: zfd.numeric(z.number().positive().default(1)),
  spread: z.enum(["source", "even"]).default("source"),
});

export const budgetControlPolicyValidator = z.object({
  id: zfd.text(z.string().optional()),
  budgetId: z.string().min(1),
  action: z.enum(budgetControlActionType),
  thresholdPercent: zfd.numeric(z.number().min(1).max(200).default(100)),
  active: zfd.checkbox(),
});
```

### Service functions

Supabase-client functions (return `{ data, error }`, never throw):

| Function | Phase | Notes |
|---|---|---|
| `getBudgets(client, companyId, args)` | 1 | List with `setGenericQueryFilters`, `.select("*", { count: "exact" })`, scoped `.eq("companyId", companyId)` |
| `getBudget(client, budgetId, companyId)` | 1 | Single header |
| `getBudgetsList(client, companyId, fiscalYear?)` | 1 | id/name pairs for pickers |
| `upsertBudget(client, budget)` | 1 | Insert/update header; on insert, ensures the FY's `accountingPeriod` rows exist (calls `createFiscalYearPeriods` when `(companyId, fiscalYear)` has none) |
| `approveBudget(client, { budgetId, companyId, userId })` | 1 | Draft → Approved, stamps `approvedBy/approvedAt`; Approved → Archived via `archiveBudget` |
| `deleteBudget(client, budgetId, companyId)` | 1 | Draft only (service check); lines cascade |
| `getBudgetLines(client, budgetId, companyId, costCenterId?)` | 1 | Matrix cells; `costCenterId` null-filter distinguishes company-level view |
| `getAccountingPeriodsForFiscalYear(client, companyId, fiscalYear)` | 1 | The matrix's period columns |
| `getBudgetVsActual(client, { companyId, budgetId, costCenterId?, rollup? })` | 1 | Wraps `client.rpc("budgetVsActual", ...)` |
| `getBudgetControlPolicy(client, companyId)` | 2 | Active policy or null |
| `upsertBudgetControlPolicy(client, policy)` | 2 | Validates the target budget is Approved and same FY coverage |
| `checkBudgetAvailability(client, { companyId, lines: [{accountId, costCenterId?, amount}] })` | 2 | Returns per-line `{ status: "ok" \| "warning" \| "blocked", budget, consumed, available }` against the policy's budget (annual check); called by the PO release action and invoice posting |

SQL functions (defined in the budgeting migration; atomic, SECURITY INVOKER so
RLS applies; the Draft-only trigger enforces the target-state rule per row):

| Function | Phase | Notes |
|---|---|---|
| `copyBudgetLines(p_company_id, p_source_budget_id, p_target_budget_id, p_adjustment_factor, p_created_by)` | 1 | Replaces the target's lines with the source's, remapping periods by `periodNumber` across fiscal years, × factor — wrapped by `copyBudgetLines(client, args)` in the service |
| `seedBudgetLinesFromActuals(p_company_id, p_source_fiscal_year, p_target_budget_id, p_adjustment_factor, p_spread, p_created_by)` | 1 | Aggregates posted `journalLine.amount` by `accountId` × source `periodNumber` (× cost center via `journalLineDimension`/`dimension` `entityType = 'CostCenter'`), × factor, into target-FY lines — BC "Copy G/L Budget from G/L Entry" + NetSuite "base on actuals". `p_spread = 'source'` preserves the monthly profile; `'even'` flattens it |

Matrix cell writes happen client-side (per-cell update-by-id / insert /
delete-on-zero via the browser Supabase client, RLS-gated — the
QuoteLinePricing precedent). CSV import writes cells inside the `import-csv`
edge function's Kysely transaction using `ON CONFLICT ON CONSTRAINT
"budgetLine_cell_key" DO UPDATE`, applying the class-based sign flip so the
file carries natural-signed amounts matching the export.

### Enforcement hook (Phase 2, purchasing side)

The PO release action (`apps/erp/app/routes/x+/purchase-order+/…release…`) and
the purchase-invoice posting path call `checkBudgetAvailability` with the
document's account-coded lines **before** proceeding:

- No active policy, or no account-coded lines → no-op (zero cost when unused).
- `warning` → proceed; flash warning ("Marketing is at 94% of FY2027 budget for
  6400 - Software") and banner on the PO.
- `blocked` → action returns a form error; a user with `accounting_update` can
  resubmit with `overrideReason`, which is stored on the PO
  (`budgetOverrideReason`/`budgetOverrideBy`) and audit-logged.

### Routes (flat routes under `apps/erp/app/routes/x+/accounting+/`)

| Route file | Phase | Purpose / permission |
|---|---|---|
| `budgets.tsx` | 1 | List (table + Outlet) — `view: "accounting"` |
| `budgets.new.tsx` | 1 | Drawer: header + optional "Start from" (copy/seed + factor) — `create: "accounting"` |
| `budgets_.$budgetId.tsx` | 1 | Full-page matrix editor (trailing underscore opts out of list nesting); cells write client-side, RLS-gated — `view: "accounting"` |
| `budgets.edit.$budgetId.tsx` | 1 | Drawer over the list for header edits — `update: "accounting"` |
| `budgets.approve.$budgetId.tsx` | 1 | Confirm modal → approve (Draft) or archive (Approved) — `update: "accounting"` |
| `budgets.delete.$budgetId.tsx` | 1 | Confirm modal → `deleteBudget` — `delete: "accounting"` |
| `budget-vs-actual.tsx` | 1 | Report: budget/cost-center/period filters → `getBudgetVsActual` — `view: "accounting"` |
| `budget-control.tsx` | 2 | Policy settings form — `update: "accounting"` |

Path helpers in `apps/erp/app/utils/path.ts` (`path.to.budgets`,
`path.to.budget(id)`, `path.to.budgetVsActual`, `path.to.budgetControl`, …);
sidebar entries beside Cost Centers and Trial Balance. Route actions follow the
standard shape: `requirePermissions`, `validator(schema).validate(formData)`,
plain-object returns (never `Response.json`), flash + redirect.

## UI Changes

Components in `apps/erp/app/modules/accounting/ui/Budgets/`, cloned from the
nearest precedents:

- **BudgetsTable** — standard list table (clone of `CostCentersTable`): Name,
  Fiscal Year, Status badge, Approved by/at, Updated; row click → matrix. No
  parenthesized counts.
- **BudgetForm** — drawer (clone of `CostCenterForm`): Name, Fiscal Year,
  Description; create-time "Start from" section (None / Copy budget /
  Prior-year actuals; Adjustment factor; Spread: as-source / even /
  prior-year profile).
- **BudgetMatrix** — the flagship new component, built on the
  `EditableNumberCell` pattern from `QuoteLinePricing.tsx`: rows = posting
  accounts (active, `directPosting`; default filter Income Statement, toggle
  for all classes), columns = the FY's periods + row total; toolbar with
  account search, class/category filter, **Cost center** select
  (Company-level / each cost center — determines the cell set shown and
  written), Fill / Distribute / prior-year-profile helpers on the focused
  row; batched cell saves with optimistic UI; read-only when status ≠ Draft
  with an "Approved — Revise to edit" banner and a Revise button
  (copy-to-draft). Cells display natural sign per account class.
- **BudgetVsActualTable** — report modeled on the trial balance screen:
  Account, Actual, Budget, Variance, Variance % (+ Committed, Available in
  Phase 2), period-range and cost-center filters (rollup toggle), budget
  picker (defaults to the FY's Approved budget), CSV export, "untagged
  actuals" row when a cost-center filter is active. Sign-corrected like the
  income statement.
- **BudgetControlForm** (Phase 2) — settings card: designated budget (Approved
  only), Warn/Block, threshold %; plus the PO banner/flash strings.
- **Income statement** (Phase 3) — "Compare to budget" select adds
  Budget / Variance columns.

i18n via Lingui throughout. Docs: Accounting → Budgets page + glossary entries
(budget, commitment, budget control) per keep-sources-in-sync; update
`modules/accounting` AGENTS.md service list.

## Acceptance Criteria

Phase 1:

- [ ] Migration applies on a DB with the period-close migration, is idempotent,
      and `pnpm run generate:types` + typecheck pass.
- [ ] Creating budget "2027 Plan" (FY2027) auto-creates FY2027 periods when
      missing; duplicate name in the same company is rejected with a form error.
- [ ] Matrix: entering 5,000 in P1 for an expense account and Distribute spreads
      evenly across periods; seeding from actuals with `spread = 'source'`
      matches the FY2026 monthly proportions; reload persists; zeroing a cell
      deletes its row; row totals correct.
- [ ] Cost-center select on "Machining" writes lines with that `costCenterId`;
      company-level cells are a distinct set; the cell-uniqueness constraint
      makes duplicate company-level cells impossible.
- [ ] Copy budget ×1.1 and seed-from-actuals ×1.05 produce lines equal to
      source × factor (period-number-mapped across years; cost-center detail
      preserved).
- [ ] CSV: export from the matrix opens in a spreadsheet; re-importing an edited
      file through the import flow updates the matching cells to the file's
      values (upsert by cell — absent cells are left untouched).
- [ ] Approving a budget stamps approver/time; direct `budgetLine` writes are
      then rejected by the trigger (verified via SQL, not just UI); Revise
      copies to a new Draft.
- [ ] Budget vs Actual: Actual ties to the trial balance for the same
      accounts/range; Variance/Variance % sign-corrected per class; cost-center
      filter restricts actuals via `journalLineDimension` and includes child
      cost centers when rollup is on; untagged actuals surfaced.
- [ ] RLS: no `accounting_create` → cannot insert; `accounting_view` only →
      read-only. `pnpm run typecheck` and `pnpm run lint` pass.

Phase 2:

- [ ] With no active policy, PO release behavior is byte-for-byte unchanged.
- [ ] Warn policy at 90%: releasing a PO with an account-coded line that pushes
      consumed (actuals + open commitments + this PO) past 90% of the annual
      budget for that account+cost center flashes a warning and still releases.
- [ ] Block policy at 100%: release fails with a per-line message; resubmit with
      an override reason by a user holding `accounting_update` succeeds and
      records `budgetOverrideReason`/`budgetOverrideBy` (+ audit log entry).
- [ ] Budget vs Actual shows Committed (open account-coded PO outstanding) and
      Available = Budget − Actual − Committed; invoicing a PO line moves its
      amount from Committed to Actual without double counting.
- [ ] Policy form rejects a non-Approved budget; only one active policy per
      company (partial unique index verified).

Phase 3:

- [ ] Income statement with "Compare to budget" shows Budget and Variance
      columns consistent with the Budget vs Actual report.
- [ ] Group-level Budget vs Actual aggregates member companies' budgets and
      actuals translated with the same rates as consolidated actuals.
- [ ] `modules/accounting` AGENTS.md, product docs, and glossary updated.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Commitments only see account-coded (indirect) PO lines — item lines resolve accounts through posting groups at receipt and are invisible to budget control until then | Med | Documented explicitly in UI/docs ("budget control applies to G/L-coded purchase lines"); posting-group resolution for item lines is a listed future enhancement, not silently missing |
| Enforcement adds a check to the PO release path — a bug there blocks purchasing | High | Check is behind an active-policy guard (no-op by default); failure mode on internal error is fail-open with a logged warning, never fail-closed; release action covered by tests for no-policy/warn/block/override |
| Variance by cost center is only as good as dimension tagging (journal lines without CostCenter tags read as untagged) | Med | `post-*` functions already tag when source documents carry `costCenterId`; the report surfaces "untagged actuals" explicitly; docs state the prerequisite |
| Dependency on period-closing work (`fiscalYear`/`periodNumber`, `createFiscalYearPeriods`) | Med | Migration ordered after `20260702044133`; if that service is delayed, `upsertBudget` generates periods itself from `fiscalYearSettings.startMonth` |
| The matrix editor is the largest novel UI; `EditableNumberCell` is a cell, not a grid | Med | Build the grid as rows of editable cells like `QuoteLinePricing` (row = account, cells = periods); virtualize with the existing TanStack Virtual dependency if account counts demand it |
| CSV import's Kysely `ON CONFLICT ON CONSTRAINT` against the `NULLS NOT DISTINCT` unique constraint needs a PG15 verification | Low | Matrix writes avoid upserts entirely (per-cell update-by-id / insert / delete); import fallback is select-then-update per cell |
| GL-signed storage confuses manual data fixes (revenue budgets stored negative) | Low | Documented in migration comment + models; every UI surface normalizes by class like the income statement |
| Immutability trigger vs CSV re-import of an Approved budget | Low | Import flow requires Draft (service check mirrors the trigger); error message points to Revise |

## Open Questions

> All questions resolved 2026-07-02 (1–7 by the be-more-ambitious direction +
> codebase verification; 8–12 by accepted recommendations). Gate cleared —
> implementation may proceed per `.ai/plans/2026-07-02-budgeting.md`.

- [x] **1. Dimension scope** — **Answer:** cost center only, as a hard
      `costCenterId` column — matching Carbon's own operational pattern
      (`purchaseOrderLine.costCenterId`) and keeping commitment/variance SQL
      simple. Generic budget dimensions (BC 1–4) deferred; schema leaves room
      for a `budgetLineDimension` table.
- [x] **2. Enforcement scope** — **Answer:** in scope as Phase 2 — opt-in
      per-company policy (Warn/Block + threshold, annual check, permission-gated
      override), grounded in the existing indirect-purchasing columns. Off by
      default, matching industry posture.
- [x] **3. CSV round-trip** — **Answer:** both export and import in Phase 1,
      via the existing table-export and `import-csv` infrastructure.
- [x] **4. Balance-sheet budgeting** — **Answer:** all active `directPosting`
      accounts are budgetable; matrix defaults to the Income Statement filter.
- [x] **5. Matrix editor** — **Answer:** required in Phase 1; build on the
      `EditableNumberCell` / `QuoteLinePricing` precedent.
- [x] **6. Permission granularity** — **Answer:** reuse `accounting_*`; a
      dedicated budget module permission would ripple through the `module` enum
      and permission UI for little gain. The Block override is gated on
      `accounting_update`.
- [x] **7. "Active/Approved" semantics** — **Answer:** lifecycle is
      Draft → Approved (immutable, trigger-enforced) → Archived; multiple
      Approved budgets per FY allowed; reports default to the FY's most recent
      Approved budget; the control policy designates its target explicitly.
- [x] **8. Sequencing on period close** — **Answer:** period-closing lands
      first — its migration (`20260702044133`) is already in this working tree
      and budgeting's migration is timestamp-ordered after it. The fallback
      (budgeting generates periods from `fiscalYearSettings.startMonth`) stays
      documented in Risks in case `createFiscalYearPeriods` ships late.
- [x] **9. Commitment reduction basis** — **Answer:** reduce committed on
      **invoice posting**. Indirect/service lines often aren't received, and
      invoicing is when actuals hit the GL — so committed→actual hand-off is
      exact with no double counting. Receipt-based reduction revisited if
      accrual-on-receipt for account-coded lines is added later.
- [x] **10. Enforcement points** — **Answer:** PO release (warn or block per
      policy) + warn-only on purchase-invoice posting (catches no-PO invoices).
      No checks at line save or quote→PO conversion in Phase 2 — earlier checks
      are noisier and the release gate is the industry anchor point.
- [x] **11. Commitment period bucketing** — **Answer:** bucket committed
      amounts to the PO line's **promised date** period (falling back to the
      order date when unset). Annual enforcement is unaffected either way.
- [x] **12. Consolidation translation (Phase 3)** — **Answer:** translate
      budgets at the same consolidated rates as actuals, reusing
      `translateCompanyBalances` — no budget-exchange-rate table. Fixed plan
      rates noted as a future option if FX-variance isolation is requested.

## Changelog

- 2026-07-02: Created. Grounded in `.ai/research/budgeting.md` (SAP CO-OM-CCA /
  S/4HANA plan categories, NetSuite budgets/budgetsMachine + budget categories,
  Dynamics 365 BC G/L Budget Name/Entry + Cost Accounting).
- 2026-07-02: Expanded scope per direction to be more ambitious: three-phase
  delivery adding commitments + budget control (Warn/Block policy, override
  audit), Draft→Approved→Archived lifecycle with immutability trigger, CSV
  import in Phase 1, prior-year-profile spreading, cost-center hierarchy
  rollup, income-statement integration and group consolidation (Phase 3).
  Verified enablers in-repo: `purchaseOrderLine.accountId`/`costCenterId`
  (`20260503000000_indirect-purchases.sql`), `journalLineDimension` written by
  all `post-*` functions, `EditableNumberCell` grid precedent, extensible
  `import-csv` table enum. Resolved open questions 1–7 accordingly.
- 2026-07-02: Resolved open questions 8–12 with the recommended answers
  (period-close sequencing, invoice-posting commitment reduction, PO-release +
  invoice-warn enforcement points, promised-date commitment bucketing,
  consolidated-rate translation). Status → in-progress; Phase 1 implementation
  plan at `.ai/plans/2026-07-02-budgeting.md`.
- 2026-07-02: Aligned with the Phase 1 plan after precedent verification:
  copy/seed are SQL functions (`copyBudgetLines`, `seedBudgetLinesFromActuals`)
  called via `client.rpc` instead of Kysely transactions; matrix cells write
  per-cell from the RLS-gated browser client (QuoteLinePricing precedent)
  instead of a batched route action; prior-year-profile spreading is delivered
  by seed-from-actuals (`p_spread`), with Fill/Distribute as the row-level
  matrix helpers; matrix route is `budgets_.$budgetId.tsx` (un-nested); CSV
  import is wide-format (period1–12 columns) upserting by cell key.
