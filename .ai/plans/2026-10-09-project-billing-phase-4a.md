# Project Billing Phase 4a — billing — implementation plan

**Spec:** .ai/specs/2026-10-09-project-billing.md (Phase 4a, decisions 1–18, Open Questions Q1)
**Research:** .ai/research/projects-wbs-pmmo.md (patterns 9 and 10, Answer 6, Recommendation 7)
**Branch:** projects-wbs-research-spec
**Prerequisite:** every task of these plans is done and committed:
- `.ai/plans/2026-10-07-projects-phase-1a.md` (`projectElement`, `projectLedger`, `laborCategory`, `laborCategoryRate`, `project-posting.ts`, `get_project_cost_summary`, the Projects module);
- `.ai/plans/2026-10-08-projects-phase-1b.md`;
- `.ai/plans/2026-10-09-field-service-phase-a.md` (`projectBillableItem`, `projectBillableItemStatus`, `buildBillableItem`, `reverseBillableItem`, `BillableItemsTable`, the `projectModule` RLS piece, the billable item release in `sales.server.ts`).

If one of these artifacts does not exist, STOP and report.

🛑 **Release rule.** Phase 4a and Phase 4b (`.ai/plans/2026-10-09-project-billing-phase-4b.md`) ship in the same release. Phase 4a alone posts T&M invoices to Deferred Revenue, and nothing recognizes that revenue until 4b's synthesizer runs. Do not merge 4a to `main` without 4b.

## Scope of this plan

A customer contract line can bill project work by time and materials or at cost plus a fee:
1. **Billing method** on a contract line (Fixed, Time & Materials, Cost Plus), with a billing element, handling or fee percent, funding and a ceiling.
2. **Bill rates:** a default per labor category, and contract rates per labor category or per employee.
3. **Billable items:** T&M items at posting, Cost Plus items from the commercial generator, a backfill, and a review (hold, release, write off, edit price).
4. **Funding:** a hard stop at the funded amount, and the FAR 52.232-20/-22 notices.
5. **Invoicing:** the source `create-project-billing-invoices` in the nightly recurring billing job, with stamp release on delete and on VOID.
6. **UI:** the contract line form and the line's billing drawer. The contract's Project billing section, Projects → Billing and the project Billing tab. The bill rate on labor categories.

Every new enum value of 4a and 4b is in Task 1. Phase 4b adds revenue (Right to Invoice, Percent Complete, cost relief, loss provision).

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/conventions-database.md`, `.claude/rules/database-patterns.md`, `.claude/rules/conventions-services.md`, `.claude/rules/conventions-forms.md`, `.claude/rules/authz-manifest.md`, `.claude/rules/commercial-licensing.md`, `.claude/rules/numeric-precision.md` and `.claude/rules/projects-system.md` before Task 1.
- Read `apps/erp/app/modules/sales/AGENTS.md` (Contracts) and `packages/server-functions/AGENTS.md`.
- Use the `carbon-design` skill for every UI task.
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files. Files under `packages/ee/` and `.ee.` files get the commercial header.
- Never use JavaScript `Date`. Use `@internationalized/date` and the `datetime` helpers in `@carbon/utils`.
- Round with `round()` from `@carbon/utils`. Never query in a loop. Never construct a database client in a `*.service.ts`.
- Every Kysely write in a server function names `companyId` explicitly (lesson "Kysely writes in a server function bypass RLS").
- Give every row of one Kysely insert the same keys. See the lesson "Kysely builds ONE column list per multi-row insert".
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Decisions this plan makes

These correct or add to the spec. Task 20 records them there.

| # | Decision | Why |
|---|---|---|
| P1 | `@carbon/server-functions` cannot import `@carbon/ee`: `@carbon/ee` already depends on it, so the import would be a cycle. Cost Plus pricing therefore runs in the commercial `generateCostPlusItems` (`@carbon/ee/project-revenue.server`), not at posting. Posting writes T&M items only. The nightly job, the revenue run (4b) and the line's **Generate billable items** call the generator. | The spec puts Cost Plus pricing in `packages/ee` (Q1). Only the ERP, the jobs and the ee package can call ee code. Without ee code a Cost Plus line bills nothing, so the paywall has no route around it in open code. |
| P2 | `requireEntitlement(…, "PROJECT_REVENUE")` sits in `requireProjectRevenueEntitlement` (ee). The line routes call it when the billing method is Cost Plus or the revenue method is Percent Complete. | Q1: "`requireEntitlement` guards creating a Cost Plus line or choosing Percent Complete". The real lock is P1 and the 4b synthesizer. |
| P3 | No `holdReason` column. Items use the existing `projectBillableItem.statusReason` for "No bill rate", "No hours", "Funding limit" and a user's note. | Field service Phase A already added `statusReason` for the same purpose ("Reversed"). Two reason columns would split one fact. |
| P4 | `projectBillableItem` gains `voidedSalesInvoiceId`. A VOID stamps it. A re-bill of such an item, or an invoice with a negative item, is held for review. | The contract and rental sources hold a re-bill after a void (`contractInvoiceHold`, `contract-invoice-plan.ts:22`). The new source must not post a re-bill unattended. |
| P5 | Billing lines (T&M and Cost Plus) and Percent Complete lines need the contract currency to equal the company base currency. Confirm refuses other contracts. | Ledger cost is in base currency; bill rates are in the contract currency. The spec puts multi-currency bill rates out of scope. |
| P6 | A T&M line uses Right to Invoice only. A Cost Plus line uses Percent Complete or Right to Invoice. A Fixed line uses Daily, Even Period or Percent Complete. CHECKs enforce it. | The spec defines no Percent Complete price for a T&M line. |
| P7 | Confirm and amend refuse a billing line whose element is the same as, an ancestor of, or a descendant of another live billing line's element. | Nested billing elements would bill one ledger row twice, and the funding position would count its cost twice. |
| P8 | A live billing line: its contract is Active, its billing method is not Fixed, and `startDate <= postingDate <= COALESCE(endDate, postingDate)`. | The line has no status column (spec *Data Model*). |
| P9 | Amend refuses a `change` of a billing line. It allows `add` and `end`. Funding fields change through **Edit funding** on an Active contract. Labor rates change at any time. | A `change` replaces the line with a new id, and the billable items point at the old id. Funding modifications are routine on a live contract. |
| P10 | Every item is priced as quantity 1 at the priced amount, except a T&M labor item: hours × bill rate. A Cost Plus labor item stores quantity = hours and amount = round(cost × (1 + fee)). | Exact amounts. The invoice total then equals Σ item amounts, which 4b's Right to Invoice revenue relies on. |
| P11 | Invoice grouping: T&M labor by labor category and unit price (quantity = hours). Cost Plus labor by labor category (quantity 1). Other cost by cost type (quantity 1). | Spec decision 10 asks for an average rate. An average price × hours does not equal Σ items exactly. One line per rate keeps the invoice exact. |
| P12 | The funding check runs once a day in the recurring billing job, not after each posting batch. | Posting runs synchronously in many server functions. A daily check meets the 60-day notice window. |
| P13 | The line stores `thresholdNoticeFundedCost` and `runOutNoticeFundedCost`: the `fundedCost` for which each notice went out. A changed `fundedCost` makes the notice due again. | "Once per threshold per line" needs a stored state. A funding increase must start a new cycle. |
| P14 | The expected cost uses the plan's remaining cost as a cap only when the subtree has a plan. | With no plan lines the cap is 0, and the notice would never fire. |
| P15 | A confirm or an amend `add` of a T&M line runs the T&M backfill in its transaction. | Work posted before the contract was confirmed is billable. A forgotten backfill would lose it. |

## Progress

- [x] Task 1: Create the enum migration
- [x] Task 2: Create the project billing migration
- [x] Task 3: Apply migrations, regenerate types, ship RLS and the enum mirrors
- [x] Task 4: Add the pure billing helpers
- [x] Task 5: Add the commercial project revenue module and Cost Plus pricing
- [x] Task 6: Keep billing lines out of the contract schedule
- [x] Task 7: Validate billing lines at confirm and amend
- [x] Task 8: Write T&M billable items at posting
- [x] Task 9: Add `generate-contract-billable-items`
- [ ] Task 10: Add `create-project-billing-invoices`
- [ ] Task 11: Release billable items on Draft delete and on VOID
- [ ] Task 12: Add the `ContractFundingThreshold` notification
- [ ] Task 13: Wire project billing into the recurring billing job
- [ ] Task 14: Add the contract and project services
- [ ] Task 15: Add the billing fields to the contract line form
- [ ] Task 16: Add the contract line billing drawer
- [ ] Task 17: Add the Project billing section and the backup report
- [ ] Task 18: Add Projects → Billing and the project Billing tab
- [ ] Task 19: Add the bill rate to labor categories
- [ ] Task 20: Update the rules, AGENTS.md, docs and spec
- [ ] Task 21: Verify in the browser

## Dependencies

- Tasks 1 → 2 → 3 run in order.
- Task 4 needs Task 3. Task 5 needs Task 4. Task 6 needs Task 3.
- Task 7 needs Tasks 6 and 8. Task 8 needs Task 4. Task 9 needs Task 8.
- Task 10 needs Tasks 4 and 6. Task 11 needs Task 3.
- Task 12 has no dependency. Task 13 needs Tasks 5, 10 and 12.
- Task 14 needs Tasks 3 and 4. Tasks 15–19 need Task 14. Task 15 also needs Task 5. Task 16 needs Tasks 5 and 9. Task 17 needs Task 10.
- Task 20 needs Tasks 1–19. Task 21 runs last.
- Tasks 11 and 12 are independent of each other and of Tasks 4–10.

---

## Task 1: Create the enum migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_project-billing-enums.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261006221201_contract-enums.sql`

**Steps:**
1. Run `pnpm db:migrate:new project-billing-enums`.
2. Write only these statements. Postgres refuses a new enum value in the transaction that adds it. Phase 4b uses the last two values; they are here so 4b needs no enum migration.

```sql
DO $$ BEGIN CREATE TYPE "contractBillingMethod" AS ENUM ('Fixed', 'Time & Materials', 'Cost Plus');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE "contractRevenueMethod" ADD VALUE IF NOT EXISTS 'Right to Invoice';
ALTER TYPE "contractRevenueMethod" ADD VALUE IF NOT EXISTS 'Percent Complete';
ALTER TYPE "revenueScheduleType" ADD VALUE IF NOT EXISTS 'Cost Relief';
ALTER TYPE "revenueScheduleType" ADD VALUE IF NOT EXISTS 'Loss Provision';
```

**Verify:**
```bash
grep -c "ADD VALUE\|CREATE TYPE" packages/database/supabase/migrations/*_project-billing-enums.sql
# Expected: 5
```

**Out of scope:** tables and columns (Task 2).

---

## Task 2: Create the project billing migration

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_project-billing.sql`
- Copy from (precedent): `20261006221301_contracts.sql` (table, FK and index style)

**Steps:**
1. Run `pnpm db:migrate:new project-billing`.
2. Write the SQL below. Add an index on `companyId` and on every FK column of the new table and the new columns.
3. Do not add `CREATE POLICY`. Task 3 renders RLS.

```sql
-- 1) Billing terms on the contract line --------------------------------------------
ALTER TABLE "customerContractLine"
  ADD COLUMN IF NOT EXISTS "billingMethod" "contractBillingMethod" NOT NULL DEFAULT 'Fixed',
  ADD COLUMN IF NOT EXISTS "projectElementId" TEXT,
  ADD COLUMN IF NOT EXISTS "materialHandlingPercent" NUMERIC,
  ADD COLUMN IF NOT EXISTS "feePercent" NUMERIC,
  ADD COLUMN IF NOT EXISTS "fundedAmount" NUMERIC,
  ADD COLUMN IF NOT EXISTS "fundedCost" NUMERIC,
  ADD COLUMN IF NOT EXISTS "noticePercent" NUMERIC NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS "noticeWindowDays" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "ceilingAmount" NUMERIC,
  ADD COLUMN IF NOT EXISTS "thresholdNoticeFundedCost" NUMERIC,
  ADD COLUMN IF NOT EXISTS "runOutNoticeFundedCost" NUMERIC;

DO $$ BEGIN
  ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_projectElement_fkey"
    FOREIGN KEY ("projectElementId", "projectId", "companyId")
    REFERENCES "projectElement"("id", "projectId", "companyId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_billing_check";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_billing_check" CHECK (
  "billingMethod" = 'Fixed'
  OR ("projectId" IS NOT NULL AND "projectElementId" IS NOT NULL AND "quantity" = 1 AND "rate" = 0
      AND "revenueType" = 'One-time')
);
ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_fee_check";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_fee_check"
  CHECK ("billingMethod" <> 'Cost Plus' OR "feePercent" IS NOT NULL);
ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_revenueMethod_check";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_revenueMethod_check" CHECK (
  ("billingMethod" = 'Fixed' AND "revenueMethod" IN ('Daily', 'Even Period', 'Percent Complete'))
  OR ("billingMethod" = 'Time & Materials' AND "revenueMethod" = 'Right to Invoice')
  OR ("billingMethod" = 'Cost Plus' AND "revenueMethod" IN ('Right to Invoice', 'Percent Complete'))
);
ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_progress_check";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_progress_check"
  CHECK ("revenueMethod" <> 'Percent Complete' OR "projectElementId" IS NOT NULL);
ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_funding_check";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_funding_check" CHECK (
  ("materialHandlingPercent" IS NULL OR "materialHandlingPercent" BETWEEN 0 AND 1)
  AND ("feePercent" IS NULL OR "feePercent" BETWEEN 0 AND 1)
  AND ("fundedAmount" IS NULL OR "fundedAmount" >= 0)
  AND ("fundedCost" IS NULL OR "fundedCost" >= 0)
  AND ("ceilingAmount" IS NULL OR "ceilingAmount" >= 0)
  AND "noticePercent" BETWEEN 0.75 AND 0.85
  AND "noticeWindowDays" BETWEEN 30 AND 90
);
CREATE INDEX IF NOT EXISTS "customerContractLine_projectElementId_idx"
  ON "customerContractLine" ("projectElementId", "companyId") WHERE "projectElementId" IS NOT NULL;

-- 2) Bill rates -------------------------------------------------------------------
ALTER TABLE "laborCategoryRate" ADD COLUMN IF NOT EXISTS "billRate" NUMERIC CHECK ("billRate" IS NULL OR "billRate" >= 0);

CREATE TABLE IF NOT EXISTS "customerContractLaborRate" (
  "id" TEXT NOT NULL DEFAULT id('conlr'),
  "companyId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "laborCategoryId" TEXT,
  "employeeId" TEXT REFERENCES "user"("id"),
  "billRate" NUMERIC NOT NULL CHECK ("billRate" >= 0),
  "effectiveFrom" DATE NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractLaborRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractLaborRate_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractLaborRate_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId")
    REFERENCES "customerContractLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractLaborRate_category_fkey" FOREIGN KEY ("laborCategoryId", "companyId")
    REFERENCES "laborCategory"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractLaborRate_subject_check" CHECK (num_nonnulls("laborCategoryId", "employeeId") = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "customerContractLaborRate_key" ON "customerContractLaborRate"
  ("customerContractLineId", COALESCE("laborCategoryId", ''), COALESCE("employeeId", ''), "effectiveFrom", "companyId");

-- 3) Billable items ---------------------------------------------------------------
ALTER TABLE "projectBillableItem" ADD COLUMN IF NOT EXISTS "voidedSalesInvoiceId" TEXT;  -- re-bill hold (P4), no FK
DO $$ BEGIN
  ALTER TABLE "projectBillableItem" ADD CONSTRAINT "projectBillableItem_contractLine_fkey"
    FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId")
    ON DELETE SET NULL ("customerContractLineId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "projectBillableItem_contractLine_idx"
  ON "projectBillableItem" ("companyId", "customerContractLineId", "status") WHERE "customerContractLineId" IS NOT NULL;
```

4. Add the two SQL functions below in the same file. Both take the date as an argument: never use `CURRENT_DATE` (the session day is UTC).

```sql
-- One billing element subtree per line: the line's element and every descendant.
CREATE OR REPLACE FUNCTION get_contract_line_subtree(p_company_id TEXT, p_line_ids TEXT[])
RETURNS TABLE ("customerContractLineId" TEXT, "projectElementId" TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH RECURSIVE tree AS (
    SELECT l."id" AS line_id, e."id" AS element_id
    FROM "customerContractLine" l
    JOIN "projectElement" e ON e."id" = l."projectElementId" AND e."companyId" = l."companyId"
    WHERE l."companyId" = p_company_id AND l."id" = ANY (p_line_ids)
    UNION ALL
    SELECT t.line_id, c."id"
    FROM tree t
    JOIN "projectElement" c ON c."parentId" = t.element_id AND c."companyId" = p_company_id
  )
  SELECT line_id, element_id FROM tree;
$$;

-- The funding position of each line on p_as_of (spec *Funding*).
CREATE OR REPLACE FUNCTION get_contract_line_funding(p_company_id TEXT, p_line_ids TEXT[], p_as_of DATE)
RETURNS TABLE (
  "customerContractLineId" TEXT, "billed" NUMERIC, "unbilled" NUMERIC,
  "incurred" NUMERIC, "recentCost" NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH lines AS (SELECT unnest(p_line_ids) AS line_id),
  items AS (
    SELECT b."customerContractLineId" AS line_id,
      SUM(b."amount") FILTER (WHERE b."status" = 'Billed') AS billed,
      SUM(b."amount") FILTER (WHERE b."status" IN ('Unbilled', 'On Hold')) AS unbilled
    FROM "projectBillableItem" b
    WHERE b."companyId" = p_company_id AND b."customerContractLineId" = ANY (p_line_ids)
    GROUP BY b."customerContractLineId"
  ),
  costs AS (
    SELECT s."customerContractLineId" AS line_id,
      SUM(pl."amount") FILTER (WHERE pl."postingDate" <= p_as_of) AS incurred,
      SUM(pl."amount") FILTER (WHERE pl."postingDate" > p_as_of - 90 AND pl."postingDate" <= p_as_of) AS recent
    FROM get_contract_line_subtree(p_company_id, p_line_ids) s
    JOIN "projectLedger" pl ON pl."projectElementId" = s."projectElementId" AND pl."companyId" = p_company_id
    GROUP BY s."customerContractLineId"
  )
  SELECT l.line_id, COALESCE(i.billed, 0), COALESCE(i.unbilled, 0),
         COALESCE(c.incurred, 0), COALESCE(c.recent, 0)
  FROM lines l
  LEFT JOIN items i ON i.line_id = l.line_id
  LEFT JOIN costs c ON c.line_id = l.line_id;
$$;
```

5. Check the `projectBillableItem` columns in the field service Phase A migration (`grep -n "statusReason\|customerContractLineId" packages/database/supabase/migrations/*_service-projects.sql`). If `statusReason` or `customerContractLineId` is missing, STOP and report.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS\|CREATE OR REPLACE FUNCTION" packages/database/supabase/migrations/*_project-billing.sql
# Expected: 3
```

**Out of scope:** `projectCostRelief`, `contractLossProvisionAccount` and the revenue snapshot columns (Phase 4b).

---

## Task 3: Apply migrations, regenerate types, ship RLS and the enum mirrors

**Depends on:** 2
**Files:**
- Modify: `packages/database/src/authz/manifest.ts`
- Modify: `packages/jobs/src/backups/id-refs.ts`
- Modify: `packages/database/src/audit.config.ts`
- Modify: `apps/erp/app/modules/sales/sales.models.ts` (enum mirrors `:1643-1706`)
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` (`REVENUE_LINE_DESCRIPTIONS` `:1206-1220`)
- Modify: generated types

**Steps:**
1. Run `pnpm db:migrate`, then `pnpm run generate:types`.
2. Add the RLS rule `customerContractLaborRate: company("sales")`, as the other contract tables have.
3. Run `pnpm --filter @carbon/database authz migration project-billing-rls`, then `pnpm db:migrate`, then `pnpm run generate:types`.
4. Add `ID_REF_COLUMNS` entries:
   - `customerContractLaborRate: ["employeeId"]` (the other ids have FKs; check the file's rule for FK columns and follow it);
   - merge `"voidedSalesInvoiceId"` into the `projectBillableItem` entry.
5. Add `projectBillableItem` to `audit.config.ts` as an entity, if field service Phase A did not. Copy an existing entity entry. The review actions of Task 14 then reach the audit log.
6. In `sales.models.ts`, add these mirrors:

```ts
export const contractBillingMethods = [
  "Fixed",
  "Time & Materials",
  "Cost Plus"
] as const satisfies readonly Enums["contractBillingMethod"][];

/** Revenue methods a Fixed line plans on a schedule. */
export const contractScheduleRevenueMethods = ["Daily", "Even Period"] as const;
```

   Keep `contractRevenueMethods` as the full enum list, in enum order: `"Daily"`, `"Even Period"`, `"Right to Invoice"`, `"Percent Complete"`.
7. Add the two new keys to `REVENUE_LINE_DESCRIPTIONS`. The `Record<RevenueScheduleType, …>` refuses to compile without them:

```ts
"Cost Relief": { debit: "Contract cost recognized", credit: "Project WIP relieved" },
"Loss Provision": { debit: "Contract loss provided", credit: "Contract loss provision" }
```

8. Run `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database --filter=@carbon/server-functions --filter=@carbon/jobs`. Fix every exhaustive `Record` or `switch` that the new enum values break. Use the descriptions above, or treat the new revenue methods like Daily where the code only labels them.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database --filter=@carbon/server-functions --filter=@carbon/jobs
# Expected: exit code 0
```

**Out of scope:** the form fields (Task 15).

---

## Task 4: Add the pure billing helpers

**Depends on:** 3
**Files:**
- Create: `packages/utils/src/project-billing.ts`
- Create: `packages/utils/src/project-billing.test.ts`
- Modify: `packages/utils/src/index.ts` — export it
- Modify: `apps/erp/app/modules/projects/ui/Costs/ProjectCostsTree.tsx` — call `estimateAtCompletion`
- Copy from (precedent): `packages/utils/src/contract-invoice-plan.ts` (pure helpers and tests)

**Steps:**
1. Export these constants: `BILLABLE_REASON_NO_BILL_RATE = "No bill rate"`, `BILLABLE_REASON_NO_HOURS = "No hours"`, `BILLABLE_REASON_FUNDING_LIMIT = "Funding limit"`.
2. Export `resolveBillRate(args)`. It returns the most specific rate effective on `date`, or null (spec *Bill rates*):

```ts
export function resolveBillRate(args: {
  date: string;                       // YYYY-MM-DD
  employeeId: string | null;
  laborCategoryId: string | null;
  contractRates: { employeeId: string | null; laborCategoryId: string | null; billRate: number; effectiveFrom: string }[];
  categoryRates: { laborCategoryId: string; billRate: number | null; effectiveFrom: string }[];
}): number | null
```

   1. The newest contract rate for the employee with `effectiveFrom <= date`.
   2. Else the newest contract rate for the labor category.
   3. Else the newest category rate row with `effectiveFrom <= date`. Its `billRate` may be null; then return null.
   4. Compare dates as `YYYY-MM-DD` strings.
3. Export `priceTimeAndMaterialsItem(args)`. It returns `{ quantity, unitPrice, amount, status, statusReason } | null` (spec *Billable items* table, decision P10):
   1. `Machine`, `Overhead` or `Burden` cost: null (decision 8).
   2. `Labor` with null hours: quantity 1, unit price 0, On Hold, `BILLABLE_REASON_NO_HOURS`.
   3. `Labor` with no rate: quantity = hours, unit price 0, On Hold, `BILLABLE_REASON_NO_BILL_RATE`.
   4. `Labor`: quantity = hours, unit price = rate, amount = `round(hours × rate)`, Unbilled.
   5. Any other cost type: quantity 1, unit price = amount = `round(cost × (1 + handling))`, Unbilled.
   6. Cost types `Material Variance` and `Payback Variance` follow rule 5.
4. Export `estimateAtCompletion({ plan, committed, actual, override })`. It returns `override` when it is not null, else `actual + committed + max(plan − actual − committed, 0)`. Change `ProjectCostsTree` to call it, so the Costs tab and the funding notice agree.
5. Export `sumSubtree(rows, elements, rootId)`. It sums `plan` (material + labor + other), `committed` and `actual` of the root and every descendant. `rows` has the `get_project_cost_summary` shape. `elements` are `{ id, parentId }`.
6. Export `fundingNotice(args)` (spec *Funding*, decisions P13 and P14):

```ts
export function fundingNotice(args: {
  asOf: string;
  incurred: number;
  recentCost: number;                 // the last 90 days
  remainingPlan: number | null;       // null when the subtree has no plan
  fundedCost: number;
  noticePercent: number;
  noticeWindowDays: number;
  thresholdNoticeFundedCost: number | null;
  runOutNoticeFundedCost: number | null;
}): { expected: number; runOutDate: string | null; threshold: boolean; runOut: boolean }
```

   1. `averageDailyCost = recentCost / 90`.
   2. `expected = round(averageDailyCost × noticeWindowDays)`, capped at `remainingPlan` when it is not null.
   3. `runOutDate` = `asOf` + `ceil((fundedCost − incurred) / averageDailyCost)` days, with `CalendarDate.add`. Use `round(x, 0, RoundingMode.Up)`. Null when `averageDailyCost <= 0`. `asOf` when `incurred >= fundedCost`.
   4. `threshold` = `incurred + expected >= noticePercent × fundedCost` and `thresholdNoticeFundedCost` differs from `fundedCost`.
   5. `runOut` = `runOutDate` is not null, `runOutDate <= asOf + noticeWindowDays`, and `runOutNoticeFundedCost` differs from `fundedCost`.
7. Export `takeWithinFunding(items, args)`. Items are `{ id, amount, postingDate }` sorted by posting date, then id:
   1. Start from `billed` (Σ Billed items of the line).
   2. Take items in order while `billed + amount <= fundedAmount`. A null `fundedAmount` takes every item.
   3. Stop at the first item that does not fit. Return `{ take, held }`; `held` is that item and every later one.
8. Export `planProjectInvoiceLines(items, args)` (decision P11). Each item has `{ id, costType, laborCategoryId, laborCategoryName, quantity, unitPrice, amount, billingMethod }`. It returns lines `{ description, quantity, unitPrice, itemIds }`:
   1. T&M Labor: one line per (category, unit price). Quantity = Σ hours. Description = the category name.
   2. Cost Plus Labor: one line per category. Quantity 1, unit price = Σ amount. Description = "<category> — <hours> h".
   3. Other cost: one line per cost type. Quantity 1, unit price = Σ amount. Description = the cost type.
   4. If a group nets to 0 hours with a nonzero amount, use quantity 1 and unit price = Σ amount.
   5. Order: labor lines by category name, then the other lines in `projectCostType` enum order.
9. Export `projectInvoiceHold(mode, items)`, beside `contractInvoiceHold`:
   1. `Draft Only` → null.
   2. An item with `voidedInvoiceReadableId` → `recurringHoldRebill(ids)`.
   3. An item with a negative amount → `PROJECT_HOLD_CREDIT = "Includes a credit for a reversed charge"`.
   4. Else null.
10. Export `selectRowsToBill(rows, itemByLedgerId)`. It returns the ledger rows that need an item:
    1. Skip a row that has an item.
    2. Skip a row with `reversalOfId` whose original has an item (posting reversed that item).
    3. Skip an original and its reversal when neither has an item.
11. Write `project-billing.test.ts` with these cases from the spec's acceptance criteria:
    1. 6 h at the Engineer II default 150.00 gives 900.00.
    2. A contract rate of 160.00 for Engineer II gives 960.00.
    3. An employee rate of 175.00 gives 1,050.00.
    4. No rate anywhere gives On Hold, "No bill rate".
    5. A 200.00 material issue at handling 10 % gives 220.00.
    6. An overhead row gives null.
    7. Funded 10,000.00, billed 0, items 6,000.00 then 5,000.00: take the first, hold the second.
    8. Funded cost 100,000.00, incurred 60,000.00, recent cost 27,000.00 (300.00 a day): expected 18,000.00, threshold true.
    9. The same with `thresholdNoticeFundedCost = 100000`: threshold false.
    10. `planProjectInvoiceLines` groups two Engineer II items at 150.00 and one at 160.00 into two lines.
    11. `selectRowsToBill` rules 1–3, one case each.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- project-billing
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=erp
# Expected: exit code 0
```

**Out of scope:** Cost Plus pricing (Task 5, commercial). Percent Complete math (Phase 4b).

---

## Task 5: Add the commercial project revenue module and Cost Plus pricing

**Depends on:** 4
**Files:**
- Modify: `packages/ee/src/plan.ts` — `PROJECT_REVENUE`
- Create: `packages/ee/src/project-revenue/pricing.ts`
- Create: `packages/ee/src/project-revenue/pricing.test.ts`
- Create: `packages/ee/src/project-revenue/index.ts`
- Create: `packages/ee/src/project-revenue/service.server.ts`
- Modify: `packages/ee/package.json` — exports
- Copy from (precedent): `packages/ee/src/forecast.server.ts` (`requireEntitlement` in an authoring function); `packages/ee/src/workflows.server.ts:27-42` (`workflowsEnabledForCompany`, the degrade check with `getCarbonServiceRole`)

**Steps:**
1. Add `PROJECT_REVENUE: [Plan.Business, Plan.Partner]` to `FEATURE_PLANS`, with a comment: "Cost Plus billing, Percent Complete revenue and the contract loss provision."
2. In `pricing.ts` (pure, client-safe), export `priceCostPlusItem({ costType, cost, hours, feePercent })`. It returns `{ quantity, unitPrice, amount }`:
   1. `amount = round(cost × (1 + feePercent))` for every cost type (spec table).
   2. Labor with hours: quantity = hours, unit price = `round(amount / hours)`.
   3. Otherwise quantity 1, unit price = amount.
3. `index.ts` re-exports `pricing.ts`. Add the exports `"./project-revenue": "./src/project-revenue/index.ts"` and `"./project-revenue.server": "./src/project-revenue/service.server.ts"`.
4. In `service.server.ts`, export:
   - `projectRevenueEnabledForCompany(companyId)`: `companyHasFeature(getCarbonServiceRole(), companyId, { feature: "PROJECT_REVENUE" })`;
   - `requireProjectRevenueEntitlement(client, companyId)`: `requireEntitlement(client, companyId, "PROJECT_REVENUE")`.
5. Export `generateCostPlusItems(db, args)`. Signature:

```ts
export async function generateCostPlusItems(
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: { companyId: string; userId: string; through: string; customerContractLineId?: string }
): Promise<{ generated: number; gated: boolean }>
```

   1. If `projectRevenueEnabledForCompany` is false, return `{ generated: 0, gated: true }`. Write nothing.
   2. Read the live Cost Plus lines (decision P8, on `through`), or the one line asked for.
   3. Read their subtrees with `get_contract_line_subtree`, one call.
   4. Read the subtree ledger rows with `postingDate <= through`, `unallowable = false`, of Contract-treatment projects. Read their items. One query each.
   5. Call `selectRowsToBill`. Price each row with `priceCostPlusItem`.
   6. Insert the items with one statement: `customerContractLineId`, project, element, `projectLedgerId`, `itemId`, the description, status Unbilled.
   7. Run in a transaction when `db` is not already one.
6. Write `pricing.test.ts`:
   1. Fee 8 %, labor cost 1,000.00, 10 h: amount 1,080.00, quantity 10, unit price 108.00.
   2. Fee 8 %, overhead 500.00: amount 540.00, quantity 1.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- project-revenue
# Expected: 2 passed
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit code 0
pnpm --filter @carbon/checks license-headers
# Expected: the new ee files carry LicenseRef-Carbon-Commercial
```

**Out of scope:** the Percent Complete synthesizer and the loss provision (Phase 4b adds them to this module).

---

## Task 6: Keep billing lines out of the contract schedule

**Depends on:** 3
**Files:**
- Modify: `packages/database/src/contract-schedule.ts` (`ContractLineTerms` `:45-54`, `planInvoiceSchedule` `:362`)
- Modify: `packages/database/src/contract-revenue-schedule.ts` (`planRevenueSchedule` `:193`)
- Modify: `packages/server-functions/src/post-customer-contract/schedule-writes.ts` (`toLineTerms` `:299`)
- Modify: `apps/erp/app/routes/x+/contract+/$id.tsx` (the previews at `:156`, `:260`, `:296`)
- Modify: the tests of both database files (`ls packages/database/src | grep contract`)

**Steps:**
1. Add `billingMethod?: "Fixed" | "Time & Materials" | "Cost Plus"` to `ContractLineTerms`. Absent means Fixed.
2. In `planInvoiceSchedule`, skip a line whose `billingMethod` is set and is not `Fixed`. `reconcileContractSchedule` calls it, so it skips them too.
3. In `planRevenueSchedule`, skip a line whose `revenueMethod` is `Right to Invoice` or `Percent Complete`. Phase 4b's synthesizer writes those months.
4. `toLineTerms` copies `billingMethod` from the row.
5. In `$id.tsx`, pass `billingMethod` into the line terms. Skip progress lines before the direct `revenuePreview` call.
6. Add tests:
   1. A T&M line next to a Recurring line plans rows for the Recurring line only.
   2. A Fixed line with `Percent Complete` plans no revenue months.

**Verify:**
```bash
pnpm --filter @carbon/database test -- contract
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/server-functions --filter=erp
# Expected: exit code 0
```

**Out of scope:** the revenue run (Phase 4b).

---

## Task 7: Validate billing lines at confirm and amend

**Depends on:** 6, 8
**Files:**
- Modify: `packages/server-functions/src/post-customer-contract/index.ts` (confirm `:344-380`, amend `:1300-1330`, `amendmentLine` `:244-265`, `amendmentChange` `:267-283`, `contractRevenueMethods` `:123`)
- Modify: `packages/server-functions/src/post-customer-contract/contract-lifecycle.test.ts`

**Steps:**
1. Extend the local `contractRevenueMethods` with `"Right to Invoice"` and `"Percent Complete"`.
2. Add these optional fields to `amendmentLine`: `billingMethod`, `projectElementId`, `materialHandlingPercent`, `feePercent`, `fundedAmount`, `fundedCost`, `noticePercent`, `noticeWindowDays`, `ceilingAmount`. Percents arrive as percent points; store them with `fraction`.
3. Add `checkBillingLines(trx, scope, { contract, lines, asOf })`. It returns a list of problems:
   1. The contract currency must equal the company base currency (P5).
   2. The line's project must have `costTreatment = 'Contract'`.
   3. The element must have `isBilling = true`.
   4. The element must not equal, contain or sit under the element of another live billing line (P7). Use `get_contract_line_subtree` for the other lines and for this line, one call.
   5. A T&M line must not use Percent Complete (P6). The DB CHECK backs this; the message is for the user.
4. Call it in confirm after the item check (`:372-378`). Add its problems to `problems`.
5. In amend:
   1. Refuse a `change` op on a billing line (P9). The message: "Edit a project billing line's rates and funding on the line itself".
   2. Run `checkBillingLines` for the added billing lines.
6. After confirm, and after an amend that adds a T&M line, call `generateTimeAndMaterialsItems(trx, …)` (Task 8) for each T&M line (P15).
7. Add `databaseTest` cases:
   1. Confirming a second T&M line for the same billing element is refused.
   2. A T&M line on a project with treatment Expense is refused.
   3. A confirmed T&M line gets items for the element's earlier ledger rows.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- contract-lifecycle
# Expected: all tests pass
```

**Out of scope:** Cost Plus items at confirm. The generator (Task 5) creates them.

---

## Task 8: Write T&M billable items at posting

**Depends on:** 4
**Files:**
- Modify: `packages/server-functions/src/lib/project-posting.ts`
- Modify: `packages/server-functions/src/lib/project-posting.test.ts`
- Modify: every server function that inserts `projectLedger` rows (step 4 finds them)

**Steps:**
1. Add `loadContractBillingContext(trx, { companyId, rows })`. With at most 4 queries, it returns:
   1. the rows' projects with `costTreatment`, joined to their live billing lines (P8), with `billingMethod` and `materialHandlingPercent`;
   2. their subtrees, from `get_contract_line_subtree`;
   3. the contract labor rates of those lines;
   4. the `laborCategoryRate` rows of the rows' labor categories.
2. Add the pure `buildContractBillableItem({ ledgerRow, line, contractRates, categoryRates, description })`:
   1. Return null when the line is Cost Plus (P1), or the row is `unallowable`.
   2. Price with `resolveBillRate` and `priceTimeAndMaterialsItem`.
   3. Fill `customerContractLineId`, project, element, `projectLedgerId`, `itemId` and the status.
3. Add `insertProjectLedgerRows(trx, { companyId, userId, rows })`:
   1. Insert the rows with one statement, `RETURNING` every column.
   2. Keep only rows of Contract-treatment projects. Load the context.
   3. For a row with `reversalOfId`: if the original has an item, apply `reverseBillableItem` (Phase A). Write an `update` or an `insert`.
   4. For any other row under a live T&M line: insert the item from `buildContractBillableItem`.
   5. Return the inserted ledger rows.
4. Find every ledger insert: `grep -rn 'insertInto("projectLedger")' packages/server-functions/src`. Replace each with `insertProjectLedgerRows`. Keep each call's rows and its transaction.
5. Add `generateTimeAndMaterialsItems(trx, { companyId, userId, customerContractLineId, through })`:
   1. Read the line. If it is not a live T&M line on `through`, return 0.
   2. Read the subtree ledger rows posted on or before `through`, and their items, one query each.
   3. Call `selectRowsToBill`, then `buildContractBillableItem`, then insert with one statement.
   4. Return the count.
6. Check for SQL inserts: `grep -rln 'INSERT INTO "projectLedger"' packages/database/supabase/migrations`. If one exists, STOP and report. A SQL insert would skip the hook.
7. Leave the field service path for `Service` projects as Phase A wrote it. Service projects have treatment By Coverage, so step 3.2 skips them.
8. Add tests:
   1. Pure: `buildContractBillableItem` returns null for a Cost Plus line.
   2. `databaseTest` in `project-posting.test.ts`: a T&M line bills element `P101-2` at handling 10 %. A 6 h timesheet on a child of `P101-2` at Engineer II (150.00) gives one Unbilled item of 900.00. A 200.00 material issue gives 220.00. An overhead row gives no item.
   3. `databaseTest`: a timesheet correction of an Unbilled item writes the item off with "Reversed".

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- project-posting post-timesheet post-project-issue
# Expected: all tests pass
grep -rn 'insertInto("projectLedger")' packages/server-functions/src | grep -v project-posting.ts
# Expected: no output
```

**Out of scope:** Cost Plus items (Task 5). The audit log of posting writes.

---

## Task 9: Add `generate-contract-billable-items`

**Depends on:** 8
**Files:**
- Create: `packages/server-functions/src/generate-contract-billable-items/index.ts`
- Create: `packages/server-functions/src/generate-contract-billable-items/generate-contract-billable-items.test.ts`
- Modify: `packages/server-functions/src/invoke.ts` — register it
- Copy from (precedent): `packages/server-functions/src/create-contract-invoices/index.ts:865-889` (input and `defineServerFn`)

**Steps:**
1. The server function input: `{ customerContractLineId, through }` (`YYYY-MM-DD`). Permissions: `{ update: "sales" }` (spec decision 16).
2. In one transaction, call `generateTimeAndMaterialsItems` (Task 8). Refuse a Cost Plus line with "Cost Plus items come from the Project Revenue feature". The ERP sends those to Task 5.
3. Update the permissions snapshot: `pnpm --filter @carbon/server-functions test -- permissions-manifest -u`. Review the diff.
4. Add a `databaseTest`: two older ledger rows, one already with an item. The call creates one item. A second call creates none.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- generate-contract-billable-items permissions-manifest
# Expected: all tests pass
```

**Out of scope:** a job that backfills every line. Confirm (Task 7) and the line action (Task 16) call it.

---

## Task 10: Add `create-project-billing-invoices`

**Depends on:** 4, 6
**Files:**
- Create: `packages/server-functions/src/create-contract-invoices/insert-invoice.ts`
- Modify: `packages/server-functions/src/create-contract-invoices/index.ts` (`insertContractInvoice` `:739-863`, `contractLocationId` `:625`)
- Create: `packages/server-functions/src/create-project-billing-invoices/index.ts`
- Create: `packages/server-functions/src/create-project-billing-invoices/create-project-billing-invoices.test.ts`
- Modify: `packages/server-functions/src/invoke.ts`

**Steps:**
1. 🛑 The contract invoicing path serves live customers. Change it only by moving code, and keep its tests green.
2. Move the header, opportunity, shipment and line inserts of `insertContractInvoice` into `insertDraftContractInvoice(trx, scope, { asOf, contract, locationId, holdReason, lines })` in `insert-invoice.ts`. It returns the invoice id and the inserted line ids in `sortOrder`. Move `contractLocationId` there too.
3. `insertContractInvoice` calls it, then stamps the planned invoice and its rows as today.
4. Input: `{ asOf, customerContractId? }`. Permissions: `{ update: "sales", create: "invoicing" }`. The result has the shape of `ContractInvoiceGenerationResult`.
5. Read the Active contracts that have a live billing line (P8) with one query. Each contract runs in its own transaction, as `createContractInvoicesForDueInvoices` does (`:112-167`).
6. Per contract, inside the transaction:
   1. Lock the contract with `loadContractForUpdate`.
   2. The period end = the latest `end` of `billingGrid(toTerms(contract), asOf)` that is on or before `asOf`. If none, skip the contract.
   3. Clear `statusReason = 'Funding limit'` on the lines' Unbilled items.
   4. Read the Unbilled items of the contract's billing lines whose ledger row has `postingDate <= periodEnd`. Order by posting date, then id. Lock them `FOR UPDATE`.
   5. Read each line's funding with `get_contract_line_funding`, one call.
   6. Per line, call `takeWithinFunding`. Set `statusReason = 'Funding limit'` on the held items.
   7. If nothing is taken, skip the contract.
   8. Build the invoice lines with `planProjectInvoiceLines`, per contract line in line order.
   9. Fill each invoice line:
      - `itemId`, `customerContractId` and `customerContractLineId` from the contract line;
      - `projectId`: the line's, else the contract's;
      - `taxPercent` of the line, `discountPercent` 0, null service dates;
      - `unitPrice` through `toBaseAmount(…, contract.exchangeRate)`.
   10. Compute the hold with `projectInvoiceHold`, from the effective invoice automation (`effectiveInvoiceAutomation`, as `draftDueInvoices` does).
   11. Call `insertDraftContractInvoice`.
   12. Stamp each taken item: `salesInvoiceLineId` = its line, status `Billed`, clear `voidedSalesInvoiceId`.
7. Update the permissions snapshot (`-u`) and review it.
8. Add `databaseTest` cases from the spec's acceptance criteria:
   1. **Invoice:** one Engineer II labor line and one Material line. The items become Billed.
   2. **Funding stop:** funded 10,000.00, items 6,000.00 and 5,000.00. The invoice takes 6,000.00. The second item stays Unbilled with "Funding limit".
   3. A second call on the same day drafts nothing.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- create-project-billing-invoices contract-lifecycle permissions-manifest
# Expected: all tests pass, including the existing contract tests
```

**Out of scope:** the job wiring (Task 13). Posting: the contract branch of `post-sales-invoice` (`:1155-1232`) keys on `customerContractLineId` and needs no change.

---

## Task 11: Release billable items on Draft delete and on VOID

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.server.ts` (`releaseRecurringInvoiceStamps` `:439-518`, `deleteSalesInvoiceReleasingRentals` `:527-571`)
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts` (VOID branch, `invoiceLineIds` `:2497`, contract release `:2667-2695`)
- Modify: `packages/server-functions/src/post-sales-invoice/post-sales-invoice.test.ts` (created by field service Phase A)

**Steps:**
1. Read the field service Phase A change in `releaseRecurringInvoiceStamps`. It already returns stamped items to `Unbilled`. Confirm that `deleteSalesInvoiceReleasingRentals` selects lines that a billable item stamps (`:552-557`). If either is missing, add it as Phase A Task 12 steps 4–5 describe.
2. In the VOID branch, after the contract release (`:2667-2695`), add one update:

```ts
if (invoiceLineIds.length > 0) {
  await trx
    .updateTable("projectBillableItem")
    .set({
      status: "Unbilled",
      salesInvoiceLineId: null,
      voidedSalesInvoiceId: invoiceId,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .where("companyId", "=", companyId)
    .where("salesInvoiceLineId", "in", invoiceLineIds)
    .where("status", "=", "Billed")
    .execute();
}
```

3. This covers service order invoices too. Field service Phase A released items on delete only.
4. Add `databaseTest` cases:
   1. Deleting a Draft project billing invoice returns its items to Unbilled.
   2. Voiding a posted one returns them to Unbilled with `voidedSalesInvoiceId` set.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-sales-invoice && pnpm exec turbo run typecheck --filter=erp
# Expected: all tests pass; typecheck exits 0
```

**Out of scope:** credit memos against billed items. A reversal creates a negative item instead.

---

## Task 12: Add the `ContractFundingThreshold` notification

**Depends on:** none
**Files:**
- Modify: `packages/notifications/src/index.ts` (enum `:12-63`, topic `:188`, heading `:305`, CTA `:345`)
- Modify: `packages/jobs/src/inngest/functions/notifications/content.ts` (beside `RecurringInvoicing` `:1367`)
- Modify: `apps/erp/app/routes/api+/link.ts` (beside `:98`)
- Modify: `apps/erp/app/components/Layout/Topbar/Notifications.tsx` (beside `:352`)

**Steps:**
1. Add `ContractFundingThreshold = "contract-funding-threshold"`, with the comment "Payload-carried like RecurringInvoicing: the figures arrive as `title` and `body`; `documentId` is the contract."
2. Topic: `NotificationTopic.Sales`. Heading: "Contract funding notice". CTA: "View contract".
3. Content: `description` = `opts.title`, `details` = one row with label "Funding" and value `opts.body`.
4. Link and topbar: `path.to.contractDetails(documentId)`, icon `LuGauge`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/notifications --filter=@carbon/jobs --filter=erp
# Expected: exit code 0
```

**Out of scope:** the email template (the generic notification email renders it).

---

## Task 13: Wire project billing into the recurring billing job

**Depends on:** 5, 10, 12
**Files:**
- Modify: `packages/jobs/src/inngest/functions/scheduled/recurring-billing.ts` (discovery `:59-74`, steps `:111-241`, digest owners `:360-384`)
- Create: `packages/jobs/src/invoicing/contract-funding.ts`
- Create: `packages/jobs/src/invoicing/contract-funding.test.ts`

**Steps:**
1. Discovery: add a third query for companies with a live billing line. Set `hasProjectBilling` on the company.
2. After the contract step, when `hasProjectBilling`:
   1. Step `cost-plus-items-${company.id}`: call `generateCostPlusItems(getJobDatabaseClient(), { companyId, userId: "system", through: asOf })`. Log when `gated` is true.
   2. Step `project-billing-${company.id}`: invoke `create-project-billing-invoices` with `asOf`, as the contract step invokes its function. Push each invoice into `invoices` with `sourceId` = the contract id.
   3. Step `contract-funding-${company.id}`: call `checkContractFunding` (step 3). Then send one `step.sendEvent` per notice.
3. In `contract-funding.ts`, write `checkContractFunding(db, { companyId, asOf })`:
   1. Read the live billing lines with `fundedCost` set, with the contract's `salesPersonId`, `createdBy` and the project's `ownerId`.
   2. Read the funding with `get_contract_line_funding`, one call.
   3. Read `get_project_cost_summary` once per distinct project, and the elements of those projects in one query. Use `sumSubtree` and `estimateAtCompletion` for the remaining plan and the EAC.
   4. Call `fundingNotice` per line.
   5. Stamp `thresholdNoticeFundedCost` or `runOutNoticeFundedCost` with the line's `fundedCost`, one update per stamp kind.
   6. Return the notices: `{ customerContractId, title, body, userIds }`.
   7. Keep steps 4 and 6 in a pure `buildFundingNotices(lines, funding, costs, asOf)`, so a test needs no database.
4. The recipients are the sales person and the project owner. If both are null, use the contract's creator, unless it is `system`.
5. The title: "<contract id> line <n>: 75 % of funded cost" or "<contract id> line <n>: funds run out by <date>". The body states funded cost, incurred, expected, EAC and the run-out date, formatted with `formatMoney` and `formatDate`.
6. Send each with `name: "carbon/notify"`, `event: NotificationEvent.ContractFundingThreshold`, `documentId` = the contract id, `recipient: { type: "users", userIds }`.
7. Write `contract-funding.test.ts` for `buildFundingNotices`:
   1. Funded cost 100,000.00, incurred 60,000.00 and 300.00 a day give one threshold notice.
   2. The same line with `thresholdNoticeFundedCost = 100000` gives none.
   3. Both recipients null and the creator `system` give a notice with no users, which the job skips.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- contract-funding && pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: all tests pass; typecheck exits 0
```

**Out of scope:** automation, owners and the digest. They key on `salesInvoice.customerContractId` (`automate-invoice.ts:169-238`, `:113-149`, `:499`) and need no change.

---

## Task 14: Add the contract and project services

**Depends on:** 3, 4
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` (`contractLineFields` `:1881-1904`, `checkContractLine` `:1906-1950`)
- Modify: `apps/erp/app/modules/sales/sales.service.ts`
- Modify: `apps/erp/app/modules/projects/projects.models.ts`, `projects.service.ts`
- Create: `apps/erp/test/project-billing-models.test.ts`

**Steps:**
1. Add these optional fields to `contractLineFields`:
   - `billingMethod` (default `Fixed`) and `projectElementId`;
   - `materialHandlingPercent` and `feePercent`, with `percentPoints`;
   - `fundedAmount`, `fundedCost` and `ceilingAmount`;
   - `noticePercent` (percent points 75–85) and `noticeWindowDays` (30–90).
2. Extend `checkContractLine`:
   1. A billing line needs `projectId` and `projectElementId`.
   2. A Cost Plus line needs `feePercent`.
   3. The revenue method follows decision P6.
   4. For a billing line, the route forces `quantity = 1`, `rate = 0`, `revenueType = "One-time"` before save.
3. Add `contractLaborRateValidator` (line, labor category or employee, bill rate ≥ 0, effective from) and `contractLineFundingValidator` (the five funding fields).
4. In `sales.service.ts`, add (client first, `{ data, error }`):
   - `getContractLaborRates(client, customerContractLineId, companyId)`;
   - `upsertContractLaborRate(client, rate)` and `deleteContractLaborRate(client, id, companyId)`;
   - `getContractLineFunding(client, { companyId, lineIds, asOf })`: `client.rpc("get_contract_line_funding", …)`;
   - `updateContractLineFunding(client, { id, companyId, userId, …funding })`. It writes only the funding columns. It allows Draft and Active contracts (P9).
5. In `projects.models.ts`, add `billableItemActionValidator` with these fields:
   - `ids`: one or more;
   - `action`: `hold`, `release`, `writeOff` or `price`;
   - `reason`: required for `writeOff` and `hold`;
   - `unitPrice`: required for `price`.
6. In `projects.service.ts`, add:
   - `getContractBillableItems(client, { companyId, customerContractLineId?, projectId?, status? })`, with the ledger row's posting date and cost type, and the invoice id;
   - `updateProjectBillableItems(client, { companyId, userId, ids, action, reason, unitPrice })`:
     - `hold`: Unbilled → On Hold, `statusReason` = the reason;
     - `release`: On Hold → Unbilled, clear the reason;
     - `writeOff`: Unbilled or On Hold → Written Off, the reason;
     - `price`: Unbilled or On Hold, set `unitPrice` and `amount = round(quantity × unitPrice)`; release an item held for "No bill rate".
   - Refuse Billed and Written Off items in every action.
7. Write `project-billing-models.test.ts`: the validator refuses a write-off with no reason, and a Cost Plus line with no fee.
8. Run `pnpm run generate:mcp`. Review the new tool entries.

**Verify:**
```bash
pnpm --filter erp test -- project-billing-models && pnpm exec turbo run typecheck --filter=erp
# Expected: all tests pass; typecheck exits 0
```

**Out of scope:** UI (Tasks 15–19).

---

## Task 15: Add the billing fields to the contract line form

**Depends on:** 5, 14
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractLineForm.tsx`
- Create: `apps/erp/app/components/Form/BillingElement.tsx`
- Modify: `apps/erp/app/components/Form/index.ts`
- Create: `apps/erp/app/routes/api+/projects.billing-elements.ts`
- Modify: `apps/erp/app/routes/x+/contract+/$id.lines.new.tsx`, `$id.$lineId.details.tsx`, `$id.lines.add.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractAmendModal.tsx`
- Copy from (precedent): `apps/erp/app/components/Form/ChargeNumber.tsx` (projects Phase 1a Task 31); `apps/erp/app/hooks/usePlanGate.ts`; `apps/erp/app/components/UpgradeOverlay/`

**Steps:**
1. `BillingElement` is a `Combobox` of the elements of one project with `isBilling = true`. The API route takes `projectId` and requires `view: "projects"`. It returns elements of Contract-treatment projects only.
2. In `ContractLineForm`, add **Billing method** (a select of `contractBillingMethods`) above the item.
3. For T&M and Cost Plus:
   1. Hide quantity, rate, rate unit and revenue type.
   2. Show **Billing element** (`BillingElement`, filtered by the line's project).
   3. Show **Handling %** (T&M) or **Fee %** (Cost Plus).
   4. Show **Funded amount**, **Funded cost**, **Notice at %** (default 75), **Notice window (days)** (default 60) and **Ceiling** (Cost Plus).
   5. Limit **Revenue method** by decision P6. Default it to Right to Invoice (T&M) or Percent Complete (Cost Plus).
4. For Fixed, keep today's fields. Add `Percent Complete` to the revenue method, which shows **Billing element** when chosen.
5. Gating (rule 3 of `commercial-licensing.md`): keep Cost Plus and Percent Complete visible. When `usePlanGate({ feature: "PROJECT_REVENUE" }).isGated`, show an inline upgrade notice under the field after the user picks one.
6. Change each line route action:
   1. If the billing method is Cost Plus or the revenue method is Percent Complete, call `requireProjectRevenueEntitlement(client, companyId)`.
   2. Catch `EntitlementError`. Return a flash error with `defaultUpgradeMessage`.
7. In each action, force `quantity = 1`, `rate = 0`, `revenueType = "One-time"` and clear `rateUnit` for a billing line.
8. The amend modal's **Add line** uses the same fields. Its **Change** action is hidden for billing lines (P9).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** the billing drawer (Task 16).

---

## Task 16: Add the contract line billing drawer

**Depends on:** 5, 9, 14
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/$id.$lineId.billing.tsx`
- Create: `apps/erp/app/routes/x+/contract+/$id.$lineId.labor-rates.tsx` (action-only)
- Create: `apps/erp/app/routes/x+/contract+/$id.$lineId.funding.tsx` (action-only)
- Create: `apps/erp/app/routes/x+/contract+/$id.$lineId.generate.tsx` (action-only)
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractLineBilling.tsx`, `ContractLaborRates.tsx`, `FundingBar.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `contractLineBilling(id, lineId)` and the three action paths
- Copy from (precedent): `apps/erp/app/routes/x+/contract+/$id.$lineId.details.tsx` (drawer route); `apps/erp/app/modules/sales/ui/Contracts/ContractProductsGrid.tsx` (editable grid); `packages/react/src/BarProgress.tsx`; `apps/erp/app/modules/service/ui/Billing/BillableItemsTable.tsx` (field service Phase A)

**Steps:**
1. The loader requires `view: "sales"`. It loads the line, its labor rates, `getContractLineFunding` on the company's today, and `getContractBillableItems` for the line.
2. `ContractLaborRates`: an editable grid with labor category **or** employee, bill rate and effective from. Each change posts to `labor-rates.tsx` (`update: "sales"`).
3. `FundingBar` shows billed, unbilled, incurred, funded amount, funded cost and ceiling. Use `BarProgress` segments. Show the notice percent as a marker on the funded cost.
4. **Edit funding** opens a modal with the five funding fields. It posts to `funding.tsx`, which calls `updateContractLineFunding`.
5. The items table lists posting date, cost type, description, quantity, unit price, amount, status and reason. Held items for "Funding limit" show the reason in amber.
6. **Generate billable items** posts to `generate.tsx`:
   1. For a T&M line, invoke `generate-contract-billable-items` with today.
   2. For a Cost Plus line, call `generateCostPlusItems` from `@carbon/ee/project-revenue.server`. If `gated` is true, flash `defaultUpgradeMessage`.
7. Link the drawer from the line's row menu in `ContractProductsGrid` as **Billing**, for billing lines only.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** bulk review actions (Task 18).

---

## Task 17: Add the Project billing section and the backup report

**Depends on:** 10, 14
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractProjectBilling.tsx`
- Modify: `apps/erp/app/routes/x+/contract+/$id.details.tsx` (sections `:63-90`)
- Modify: `apps/erp/app/modules/sales/ui/Contracts/index.ts`
- Create: `apps/erp/app/routes/x+/contract+/$id.billing-backup.$invoiceId.tsx`
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Contracts/ContractInvoices.tsx` (section card and table)

**Steps:**
1. `$id.details.tsx` loads the billing lines and their funding with one `getContractLineFunding` call. It renders `ContractProjectBilling` after `ContractInvoices`, only when the contract has a billing line.
2. The section lists each billing line: billing element, method, billed, unbilled, funded amount, a small `FundingBar`, and a link to the line's billing drawer.
3. Below it, list the project billing invoices: the sales invoices with lines that billable items stamp. Each row links to its backup report.
4. The backup report lists every item stamped by the invoice: posting date, element, cost type, employee, labor category, hours, unit price, amount, the ledger document. It has CSV export (`.claude/rules/table-csv-export.md`) and requires `view: "sales"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** a printed backup PDF.

---

## Task 18: Add Projects → Billing and the project Billing tab

**Depends on:** 14
**Files:**
- Create: `apps/erp/app/routes/x+/projects+/billing.tsx`
- Create: `apps/erp/app/routes/x+/projects+/billing.update.tsx` (action-only)
- Create: `apps/erp/app/routes/x+/project+/$projectId.billing.tsx`
- Create: `apps/erp/app/modules/projects/ui/Billing/ProjectBillableItemsTable.tsx`, `BillableItemActionModal.tsx`, `ProjectBillingLines.tsx`
- Modify: `apps/erp/app/modules/projects/ui/useProjectsSubmodules.tsx` — **Billing** in the Manage group
- Modify: `apps/erp/app/modules/projects/ui/Project/useProjectNavigation.tsx` — a **Billing** tab
- Modify: `apps/erp/app/utils/path.ts` — `projectsBilling`, `projectsBillingUpdate`, `projectBilling(projectId)`
- Copy from (precedent): `apps/erp/app/modules/inventory/ui/Kanbans/KanbansTable.tsx` (`withSelectableRows` and bulk actions); `apps/erp/app/modules/service/ui/Billing/BillableItemsTable.tsx`

**Steps:**
1. `billing.tsx` requires `view: "projects"`. It lists contract billable items with filters for status, project and contract line. Default filter: status Unbilled or On Hold.
2. Bulk actions on the selected rows: **Hold** (reason), **Release**, **Write off** (reason required) and **Edit price** (one row only). Each opens `BillableItemActionModal`, which posts to `billing.update.tsx`.
3. `billing.update.tsx` requires `update: "projects"`. It validates with `billableItemActionValidator` and calls `updateProjectBillableItems`.
4. The project **Billing** tab shows the project's contract lines (`ProjectBillingLines`): contract, line, billing element, method, funding (`FundingBar`). Below, the project's billable items in `ProjectBillableItemsTable`.
5. Phase 4b adds the percent complete and the revenue recognized to date to `ProjectBillingLines`. Leave a `revenue` prop typed as optional.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** Service project items. The Service module reviews them (field service Phase A Task 25).

---

## Task 19: Add the bill rate to labor categories

**Depends on:** 14
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` (`laborCategoryRateValidator`)
- Modify: `apps/erp/app/modules/projects/projects.service.ts` (`upsertLaborCategoryRate`)
- Modify: `apps/erp/app/modules/projects/ui/LaborCategories/LaborCategoryForm.tsx` (the rates grid)
- Modify: `apps/erp/app/modules/projects/ui/LaborCategories/LaborCategoriesTable.tsx`

**Steps:**
1. Add optional `billRate` (≥ 0) to the validator and the upsert.
2. Add a **Bill rate** column beside **Cost rate** in the rates grid. Format it with `INPUT_FORMAT.rate` and `INPUT_STEP.rate`.
3. The table shows the current bill rate beside the current cost rate.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** bill rates per customer outside a contract.

---

## Task 20: Update the rules, AGENTS.md, docs and spec

**Depends on:** 1–19
**Files:**
- Create: `.claude/rules/project-billing.md` (with `paths:` for `packages/server-functions/src/create-project-billing-invoices/**`, `packages/server-functions/src/generate-contract-billable-items/**`, `packages/ee/src/project-revenue/**`, `packages/utils/src/project-billing.ts`)
- Modify: `.claude/rules/projects-system.md`, `.claude/rules/commercial-licensing.md` (rollout status: Project revenue)
- Modify: `apps/erp/app/modules/sales/AGENTS.md` (Contracts: billing lines), `packages/server-functions/AGENTS.md`
- Modify: `AGENTS.md` (Task Router: a Project billing row)
- Create: `docs/content/docs/reference/project-billing.mdx`
- Modify: `.ai/specs/2026-10-09-project-billing.md`

**Steps:**
1. Document only committed code. Ground every claim in a file.
2. In the spec, record decisions P1–P15 and mark Phase 4a done in *Delivery phases*.
3. Correct the spec where the plan changed it:
   1. `statusReason` replaces `holdReason` (P3).
   2. Cost Plus items come from the generator, not from posting (P1).
   3. The funding check runs daily (P12).
4. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
pnpm --filter @carbon/checks license-headers
# Expected: no files changed
```

**Out of scope:** the changelog entry (it waits for Phase 4b).

---

## Task 21: Verify in the browser

**Depends on:** 1–20
**Files:**
- Create: `.ai/playbooks/project-billing-phase-4a.md` (written by `/test`)

**Steps:**
1. Run `/test` on a company with accounting on and a Contract-treatment project. Use local dev, where every plan feature passes.
2. Cover the spec's Phase 4a acceptance criteria:
   1. **T&M item:** 6 h at Engineer II on a child of the billing element gives 900.00. A 200.00 material issue gives 220.00. An overhead row gives no item.
   2. **Rate lookup:** a contract rate of 160.00 gives 960.00; an employee rate of 175.00 gives 1,050.00; no rate gives On Hold, "No bill rate".
   3. **Cost Plus item:** after **Generate billable items**, a 1,000.00 labor cost gives 1,080.00 and a 500.00 overhead row gives 540.00.
   4. **Review:** hold one item, edit a second item's price, write off a third with a reason. The audit log shows all three.
   5. **Invoice:** run the recurring billing job (Inngest dev UI). One Draft invoice has labor by category and one Material line. The items are Billed. Deleting the Draft returns them to Unbilled. Voiding a posted invoice returns them to Unbilled.
   6. **Funding stop:** funded 10,000.00 with items of 6,000.00 and 5,000.00 bills 6,000.00. The second item shows "Funding limit".
   7. **Funding notice:** the job sends one notice at 78,000.00 against 75,000.00. A second run sends none.
   8. **One line per billing element:** confirming a second T&M line for the same element is refused.
   9. **Gating:** with `PROJECT_REVENUE` off, choosing Cost Plus shows the upgrade notice and saving is refused.
3. Save the playbook to `.ai/playbooks/project-billing-phase-4a.md`.

**Verify:**
```bash
ls .ai/playbooks/project-billing-phase-4a.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** revenue (Phase 4b).

## Execution notes

- Task 1: the plan's verify greps `ADD VALUE\|CREATE TYPE`; the header comment avoids the phrase so the count is 5.
- Task 2: `projectBillableItem_contractLine_fkey` already existed (field service Phase A); the `duplicate_object` guard skips it. Added indexes on every FK column of `customerContractLaborRate` (`companyId`, line, category, employee, `createdBy`, `updatedBy`) and `NOTIFY pgrst`. The commit used `CARBON_SKIP_MANIFEST_CHECK=1`: `crbn migrate` regenerated the types into the working tree, which the MCP digest check reads; Task 3 commits the types and the regenerated digest.
- Task 3: `employeeId` on `customerContractLaborRate` is not in `ID_REF_COLUMNS`: it has an FK to `user`, and the file's rule excludes user refs. Only `voidedSalesInvoiceId` was added. `projectBillableItem` became an audit entity ("Billable Item").
- Task 3: `contractRevenueMethods` is the full enum list, so the type-exhaustive label records in `ContractAmendments`, `ContractRevenue`, `ContractRevenueGrid`, `ContractLineForm` and `revenue-waterfall` gained the new labels. The line form and the revenue grid offer `contractScheduleRevenueMethods` (Daily, Even Period) as options, so a Fixed line cannot pick Right to Invoice before Task 15 adds the billing form.
- Task 3: Task 7 step 1 moved here. The server function's local `contractRevenueMethods` now has all 4 values; without it the ERP amendment validator and the server function's input disagreed and the amend route failed to typecheck.
- Task 3: `copyLineValues` (`schedule-writes.ts`) lists its columns by name, so it now carries the 11 new line columns. Without this, an amend `change` of a Fixed Percent Complete line would drop `projectElementId`. The amend `add` branch writes the new columns with their defaults; Task 7 fills them from the amendment line.
- Task 3: `/translate` was not run (branch practice: once before the PR).
- Task 4: `ProjectCostsTree` no longer computes the estimate; `buildProjectCostFigures` in `projects.models.ts` does, through its own `estimateAtCompletion`. That function moved to `@carbon/utils` unchanged, and `projects.models.ts` imports and re-exports it, so the Costs tab and the funding notice share one copy. `ProjectCostsTree.tsx` is unchanged.
- Task 4: `priceTimeAndMaterialsItem` takes `{ costType, cost, hours, rate, materialHandlingPercent }` (the rate already resolved by `resolveBillRate`). `planProjectInvoiceLines` applies rule 4 (0 hours → quantity 1 at the amount) to every hourly group, which also covers a group whose items net to 0. `selectRowsToBill` takes any `{ has(id) }` (a `Set` or a `Map`). `PROJECT_COST_TYPE_ORDER` is exported for the line order.
- Task 5: `generateCostPlusItems` takes `Kysely<KyselyDatabase>` (a `KyselyTx` is one) and uses `db.isTransaction` to decide whether to open a transaction. It reads the subtree ledger rows with one SQL join through `get_contract_line_subtree` (lines, rows, items: 3 reads), and inserts in batches of 1,000 rows. An item's description is `<cost type> — <document type>`, and its `itemId` is the ledger row's. A Labor row with 0 hours prices as quantity 1. No database test: the generator's gate reads the plan through the service role, which needs the server env in a test process; Tasks 9 and 13 exercise it.
- Task 6: the route builds its line terms with `toContractLineTerms` (`ui/Contracts/contractTerms.ts`), so `billingMethod` is passed there; `ContractSummary` gets it too. A new exported `isProgressRevenueMethod` (`contract-revenue-schedule.ts`, re-exported by `@carbon/utils`) is the one test for Right to Invoice and Percent Complete, used by `planRevenueSchedule` and the route's direct `revenuePreview` call.
- Task 7: partly done. Steps 1–5 and test cases 1–2 are committed. Step 6 (the T&M backfill at confirm and at an amend `add`, P15) and test case 3 need `generateTimeAndMaterialsItems`, which Task 8 adds; the plan orders Task 7 after Task 8, and this run was asked for Tasks 1–7 only. Add them when Task 8 lands: call `generateTimeAndMaterialsItems(trx, …)` for each T&M line at the end of `confirm` and after the line insert in `amend`.
- Task 7: `checkBillingLines(trx, scope, { contract, lines })` takes no `asOf`. "Live" for the overlap test is "an Active contract whose line dates overlap this line's dates", not "live on one day", so a future-dated line also clashes. It walks the element tree in memory (one read of the projects' elements) instead of `get_contract_line_subtree`, because an amendment's added line has no id yet. The currency rule (P5) also applies to a Fixed Percent Complete line; the treatment and billing element rules apply to T&M and Cost Plus lines only. Amend runs the check after it writes the end dates of the lines it ends, so "end line A, add line B on the same element" passes.
- Task 7: an amend `add` fills the 9 billing fields from the amendment line (percents in percent points, converted with `fraction`; `noticePercent` defaults to 0.75 and `noticeWindowDays` to 60).
- Task 8: step 6 found SQL inserts into `projectLedger`: `complete_job_to_inventory` and `backflush_job_materials` (latest in `20261010160658_complete-job-grouped.sql`) write Labor, Machine and Material rows of consume-to-project jobs. The plan says STOP. The smallest adaptation keeps the task: posting writes items for every TypeScript path, and the T&M backfill (`generateTimeAndMaterialsItems`) catches the SQL rows. `create-project-billing-invoices` (Task 10) runs the backfill for each T&M line before it reads the items, so no row misses an invoice. Until then, a SQL row has no item in the review list.
- Task 8: `insertProjectLedgerRows` returns every column. `reverseProjectLedgerRows` now calls it, so a void of a receipt, purchase invoice, charge or reimbursement reverses the contract items too.
- Task 8: `loadContractBillingContext` reads the live billing lines joined to the contract and the project treatment (one query), the subtrees, then the contract and category rates only when a Labor row sits under a line. The reversal path reads the originals' items in one more query. It reads only items with a contract line, so a field service item is never reversed twice.
- Task 8: an item's description is `<cost type> — <document type>`, as the Cost Plus generator writes. `buildContractBillableItem` takes `createdBy` and returns null for every line that is not Time & Materials.
- Task 8: the database tests call `insertProjectLedgerRows` directly through a shared fixture, `lib/project-billing-test-fixture.ts`, which Tasks 7, 9 and 10 reuse. The verify grep still lists 4 test files that seed ledger rows directly. They are fixtures, not posting paths.
- Task 7 (finished after Task 8): confirm runs the T&M backfill for each T&M line as its last step, after the status becomes Active, with `through` = the payload's `asOf`. Amend reads the added lines back with `RETURNING ("id", "billingMethod")` and runs the backfill for each added T&M line. A line that starts after `asOf` is not live yet, so the backfill writes nothing; posting and the invoice source bill its rows later. Test case 3 posts a 200.00 Material row while the contract is a Draft (no item), confirms, and expects one 220.00 Unbilled item.
- Task 9: the server function also refuses a Fixed line ("Only a Time & Materials line has billable items") and returns `NotFoundError` for an unknown line. It returns `{ generated }`. A second test pins the Cost Plus refusal.
