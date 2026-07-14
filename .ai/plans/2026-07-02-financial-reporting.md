# Financial Reporting — Implementation Plan

> ⚠️ **2026-07-03 delta (readiness roadmap):** the spec gained Posted-only balances (`2026-07-03-public-company-readiness.md` SD-1 → spec §11): add `p_include_drafts BOOLEAN DEFAULT FALSE` to `accountTreeBalancesByCompany` and the redefined `trialBalance` RPC, an "Include drafts" toggle on report filters, and drawer-follows-parent behavior in the drill-down. See `.ai/plans/2026-07-03-public-company-readiness-roadmap.md`.

## Overview

- **Design Spec:** `.ai/specs/2026-07-02-financial-reporting.md` (status: in-progress, all open questions resolved)
- **Research:** `.ai/research/financial-reporting.md`
- **Tasks:** 24 tasks + gated verification
- **Branch:** `feature/financial-reporting`

Scope = the full spec (former Phase 2 folded into v1): statement of cash flows
(indirect; single-company AND consolidated with FX-effect line), Retained
Earnings / Net Income split, GL detail report + journal drawer + drill-down
links, four-column trial balance, comparative columns, CSV export, PDF
financial statements package, period picker, and saved report views. Still out
of scope: cash-basis toggle, dimension-filtered statements, PDF customization,
shared views.

**Ground rules for the executor:**

- Do NOT regenerate or commit `packages/database/src/types.ts` — committed types are cloud-generated. Access new columns (`account.cashFlowActivity`, new `trialBalance` RPC return columns) via `as unknown as` / `(client as any)` casts (established pattern; see the period-closing plan and `(client as any).from("itemSamplingPlan")` in post-receipt).
- Do NOT rebuild the database. Apply the migration with `pnpm db:migrate` only, when the local stack is up (Task 22).
- Typecheck per package (`pnpm --filter @carbon/erp typecheck`), never whole-repo `tsc --noEmit` (OOMs).
- Sign convention (load-bearing): `journalLine.amount` is **class-normal signed** — positive = the account's natural direction (debit for Asset/Expense, credit for Liability/Equity/Revenue). See `packages/utils/src/accounting.ts`. Never assume "positive = debit" globally.
- Commit only at marked checkpoints after verification passes (check-and-commit gate); never auto-commit.

## Dependencies

```
Task 1 (migration file) ── Task 22 (apply migration) — deferred until stack is up
Task 2 (models/types) ─┬─ Task 3 (pure utils + tests)
                       ├─ Task 4 (RE/CYE split service) ── Task 10 (statement tree display + drill links)
                       ├─ Task 5 (cash flow service) ─┬─── Task 8 (cash-flow route/UI)
                       │                              └─── Task 16 (rates + consolidated SCF service) ── Task 17 (consolidated SCF UI)
                       └─ Task 6 (GL detail service) ───── Task 9 (general-ledger route/UI)
Task 7 (path.ts + nav) — independent; needed by Tasks 8, 9, 11
Task 11 (journal drawer) — after Task 7
Task 12 (comparatives) — after Task 4
Task 13 (trial balance UI) — after Tasks 1 (SQL shape), 7
Task 14 (account form select) — after Task 2
Task 15 (CSV export buttons) — after Tasks 8, 10, 13
Task 18 (period picker) — after Task 7 (reads period-closing columns; hides gracefully)
Task 19 (report views service + resource route) — after Tasks 1 (table), 2
Task 20 (report views UI in filters) — after Task 19
Task 21 (PDF package: component + route + buttons) — after Tasks 4, 5, 16
Task 22 (apply migration) — env-gated, before Task 23
Task 23 (full gate: typecheck/lint/tests) — after all code tasks
Task 24 (browser verification /test) — last
Independent of each other (parallel-safe): 3∥4∥5∥6, 8∥9∥11∥13∥14, 16∥18∥19
```

## Progress

- [ ] Task 1: Migration — `cashFlowActivity` enum/column, `accounts` view, `reportView` table, four-column `trialBalance` RPC
- [ ] Task 2: Models & types — cash flow enums, validator field, statement types
- [ ] Task 3: Pure helpers + unit tests — activity mapping, fiscal year start, cash flow builder
- [ ] Task 4: Service — Retained Earnings / Net Income split in `getFinancialStatementBalances`
- [ ] Task 5: Service — `getCashFlowStatement`
- [ ] Task 6: Service — `getGeneralLedgerLines` + opening balance
- [ ] Task 7: Paths + accounting nav entries
- [ ] Task 8: Route + UI — cash flow statement
- [ ] Task 9: Route + UI — general ledger detail report
- [ ] Task 10: Statement trees — RE/CYE display, drill links, unclassified warning
- [ ] Task 11: Route + UI — journal entry drawer
- [ ] Task 12: Comparative columns on income statement + balance sheet
- [ ] Task 13: Trial balance — four-column UI + drill links
- [ ] Task 14: Account form — Cash Flow Activity select
- [ ] Task 15: CSV export buttons on statement reports
- [ ] Task 16: Service — currency rates helper + consolidated cash flow
- [ ] Task 17: Cash flow UI — consolidated mode + FX-effect line
- [ ] Task 18: Period picker in ReportFilters
- [ ] Task 19: Report views — models, service, resource route
- [ ] Task 20: Report views UI — dropdown + save/delete in ReportFilters
- [ ] Task 21: PDF financial statements package
- [ ] Task 22: Apply migration locally
- [ ] Task 23: Full verification gate
- [ ] Task 24: Browser verification (/test)

---

## Task 1: Migration — `cashFlowActivity` + `accounts` view + four-column `trialBalance` RPC

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_financial-reporting.sql` (via `pnpm db:migrate:new financial-reporting`; if the generated HHMMSS is `000000`, rename the file with a randomized HHMMSS)

**Steps:**

1. `pnpm db:migrate:new financial-reporting`
2. Write exactly this SQL (forked from the newest `trialBalance` definition in `20260315000001_per-company-balance-rpc.sql`; all statements idempotent):

```sql
-- Financial reporting: cash flow classification + four-column trial balance
-- Spec: .ai/specs/2026-07-02-financial-reporting.md

-- 1. Cash flow activity override (QuickBooks Desktop "Classify Cash" pattern).
--    NULL = derive from accountType at read time.
DO $$ BEGIN
  CREATE TYPE "cashFlowActivity" AS ENUM ('Operating', 'Investing', 'Financing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "account"
  ADD COLUMN IF NOT EXISTS "cashFlowActivity" "cashFlowActivity";

-- 2. Recreate the accounts view so the new column is exposed
--    (view is a plain SELECT *; see 20260229000003_chart-of-accounts-tree.sql)
DROP VIEW IF EXISTS "accounts";
CREATE VIEW "accounts" WITH(SECURITY_INVOKER=true) AS
SELECT * FROM "account";

-- 3. Saved report views — personal-preference table mirroring
--    userModulePreference (20260512174538_menu-customization.sql):
--    simple PK, owner-scoped RLS, (userId, companyId, report, name) unique.
--    No createdBy/updatedBy: ownership IS userId (matches precedent).
CREATE TABLE IF NOT EXISTS "reportView" (
  "id" TEXT NOT NULL DEFAULT id('rpv'),
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "report" TEXT NOT NULL CHECK ("report" IN
    ('balance-sheet', 'income-statement', 'cash-flow', 'trial-balance', 'general-ledger')),
  "name" TEXT NOT NULL,
  "params" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "reportView_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reportView_userId_companyId_report_name_key"
    UNIQUE ("userId", "companyId", "report", "name")
);

CREATE INDEX IF NOT EXISTS "reportView_userId_companyId_idx"
  ON "reportView" ("userId", "companyId");

ALTER TABLE "reportView" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "SELECT" ON "reportView"
    FOR SELECT USING ("userId" = auth.uid()::text);
  CREATE POLICY "INSERT" ON "reportView"
    FOR INSERT WITH CHECK ("userId" = auth.uid()::text);
  CREATE POLICY "UPDATE" ON "reportView"
    FOR UPDATE USING ("userId" = auth.uid()::text);
  CREATE POLICY "DELETE" ON "reportView"
    FOR DELETE USING ("userId" = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Four-column trial balance. Return shape changes, so DROP first
--    (CREATE OR REPLACE cannot change an OUT row type).
DROP FUNCTION IF EXISTS "trialBalance"(TEXT, TEXT, DATE, DATE);

CREATE FUNCTION "trialBalance" (
  p_company_group_id TEXT,
  p_company_id TEXT DEFAULT NULL,
  from_date DATE DEFAULT (now() - INTERVAL '100 year'),
  to_date DATE DEFAULT now()
)
RETURNS TABLE (
  "accountId" TEXT,
  "accountNumber" TEXT,
  "accountName" TEXT,
  "accountClass" "glAccountClass",
  "incomeBalance" "glIncomeBalance",
  "openingDebit" NUMERIC(19, 4),
  "openingCredit" NUMERIC(19, 4),
  "periodDebits" NUMERIC(19, 4),
  "periodCredits" NUMERIC(19, 4),
  "debitBalance" NUMERIC(19, 4),
  "creditBalance" NUMERIC(19, 4),
  "netChange" NUMERIC(19, 4)
)
LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH "movements" AS (
    -- Per-leaf period debit/credit sums. A line is a debit when its sign
    -- matches the account's natural-debit direction (class-normal signing).
    SELECT
      a."id" AS "mAccountId",
      COALESCE(SUM(
        CASE WHEN j."postingDate" >= from_date AND j."postingDate" <= to_date
          AND ((a."class" IN ('Asset', 'Expense') AND jl."amount" > 0)
            OR (a."class" IN ('Liability', 'Equity', 'Revenue') AND jl."amount" < 0))
        THEN ABS(jl."amount") ELSE 0 END), 0) AS "periodDebits",
      COALESCE(SUM(
        CASE WHEN j."postingDate" >= from_date AND j."postingDate" <= to_date
          AND ((a."class" IN ('Asset', 'Expense') AND jl."amount" < 0)
            OR (a."class" IN ('Liability', 'Equity', 'Revenue') AND jl."amount" > 0))
        THEN ABS(jl."amount") ELSE 0 END), 0) AS "periodCredits"
    FROM "account" a
    LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
      AND (p_company_id IS NULL OR jl."companyId" = p_company_id)
    LEFT JOIN "journal" j ON j."id" = jl."journalId"
    WHERE a."companyGroupId" = p_company_group_id
      AND a."isGroup" = false
      AND a."active" = true
    GROUP BY a."id"
  )
  SELECT
    a."id" AS "accountId",
    a."number" AS "accountNumber",
    a."name" AS "accountName",
    a."class" AS "accountClass",
    a."incomeBalance",
    -- Opening = balanceAtDate − netChange, split by class direction
    CASE
      WHEN a."class" IN ('Asset', 'Expense') AND (b."balanceAtDate" - b."netChange") > 0 THEN (b."balanceAtDate" - b."netChange")
      WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND (b."balanceAtDate" - b."netChange") < 0 THEN ABS(b."balanceAtDate" - b."netChange")
      ELSE 0::NUMERIC(19, 4)
    END AS "openingDebit",
    CASE
      WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND (b."balanceAtDate" - b."netChange") >= 0 THEN (b."balanceAtDate" - b."netChange")
      WHEN a."class" IN ('Asset', 'Expense') AND (b."balanceAtDate" - b."netChange") < 0 THEN ABS(b."balanceAtDate" - b."netChange")
      ELSE 0::NUMERIC(19, 4)
    END AS "openingCredit",
    COALESCE(m."periodDebits", 0)::NUMERIC(19, 4) AS "periodDebits",
    COALESCE(m."periodCredits", 0)::NUMERIC(19, 4) AS "periodCredits",
    -- Closing (existing semantics, unchanged)
    CASE
      WHEN a."class" IN ('Asset', 'Expense') AND b."balanceAtDate" > 0 THEN b."balanceAtDate"
      WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND b."balanceAtDate" < 0 THEN ABS(b."balanceAtDate")
      ELSE 0::NUMERIC(19, 4)
    END AS "debitBalance",
    CASE
      WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND b."balanceAtDate" >= 0 THEN b."balanceAtDate"
      WHEN a."class" IN ('Asset', 'Expense') AND b."balanceAtDate" < 0 THEN ABS(b."balanceAtDate")
      ELSE 0::NUMERIC(19, 4)
    END AS "creditBalance",
    b."netChange"
  FROM "account" a
  INNER JOIN "accountTreeBalancesByCompany"(p_company_group_id, p_company_id, from_date, to_date) b
    ON b."accountId" = a."id"
  LEFT JOIN "movements" m ON m."mAccountId" = a."id"
  WHERE a."isGroup" = false
    AND a."companyGroupId" = p_company_group_id
    AND a."active" = true
    AND (b."balanceAtDate" != 0 OR b."netChange" != 0)
  ORDER BY a."number";
END;
$$;
```

3. Do NOT apply yet — application is Task 22. Do NOT run `pnpm db:types`.

**Verify:**
```bash
ls packages/database/supabase/migrations/ | grep financial-reporting
# Expected: one file, timestamp newer than every existing migration, HHMMSS not 000000
grep -c "IF NOT EXISTS\|IF EXISTS\|duplicate_object" packages/database/supabase/migrations/*financial-reporting.sql
# Expected: >= 7 (idempotency guards present, incl. reportView table/index/policies)
```

**Out of scope:** RLS on existing tables (`account` policies already cover the new column), `accountTreeBalancesByCompany` (unchanged), any backfill of `cashFlowActivity` (NULL = derive from accountType is the design), `createdBy`/`updatedBy` on `reportView` (ownership is `userId`, matching the `userModulePreference` precedent).

---

## Task 2: Models & types — cash flow enums, validator field, statement types

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — add `cashFlowActivities`; extend `accountValidator`
- Modify: `apps/erp/app/modules/accounting/types.ts` — add cash flow / GL detail types

**Steps:**

1. In `accounting.models.ts`, next to the other enum arrays, add:

```typescript
export const cashFlowActivities = ["Operating", "Investing", "Financing"] as const;
```

2. Find `accountValidator` and add the optional field (matches other optional enum fields in the same validator):

```typescript
cashFlowActivity: z.enum(cashFlowActivities).optional(),
```

3. In `types.ts`, add:

```typescript
export type CashFlowActivity = (typeof cashFlowActivities)[number];

export type CashFlowLine = {
  accountId: string;
  number: string | null;
  name: string;
  amount: number; // signed cash effect for the period
};

export type CashFlowStatement = {
  netIncome: number;
  operating: CashFlowLine[]; // excludes the Net Income line
  investing: CashFlowLine[];
  financing: CashFlowLine[];
  unclassified: CashFlowLine[];
  operatingTotal: number; // netIncome + Σ operating
  investingTotal: number;
  financingTotal: number;
  unclassifiedTotal: number;
  netChangeInCash: number; // Σ Bank/Cash netChange
  beginningCash: number;
  endingCash: number;
  unreconciledDifference: number; // 0 when the identity holds
};
```

(import `cashFlowActivities` from `./accounting.models`). Re-export nothing new from `index.ts` manually — the barrel already does `export * from "./accounting.models"` / `"./types"`; confirm both lines exist.

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -5
# Expected: exits 0 (or only pre-existing errors unrelated to accounting module)
```

**Out of scope:** UI components, service functions.

---

## Task 3: Pure helpers + unit tests — activity mapping, fiscal year start, cash flow builder

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.utils.ts` — three pure functions
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts` — tests (precedent: existing tests in this file)

**Steps:**

1. Add to `accounting.utils.ts` (types from `./types`):

```typescript
// Default cash flow bucket by accountType. NULL/unknown → null (unclassified).
// "Excluded" = Bank/Cash (the reconciliation target, not a flow line).
export function getCashFlowActivityForAccountType(
  accountType: string | null
): CashFlowActivity | "Excluded" | null {
  switch (accountType) {
    case "Bank":
    case "Cash":
      return "Excluded";
    case "Accounts Receivable":
    case "Inventory":
    case "Other Current Asset":
    case "Accumulated Depreciation":
    case "Accounts Payable":
    case "Other Current Liability":
    case "Tax":
      return "Operating";
    case "Fixed Asset":
    case "Other Asset":
    case "Investments":
      return "Investing";
    case "Long Term Liability":
    case "Equity - No Close":
    case "Equity - Close":
    case "Retained Earnings":
      return "Financing";
    default:
      return null;
  }
}

// Fiscal year start date (YYYY-MM-DD) for the fiscal year containing asOfDate.
// startMonth is the month name from fiscalYearSettings ("January".."December");
// null/undefined falls back to January (calendar year).
export function getFiscalYearStartDate(
  startMonth: string | null | undefined,
  asOfDate: string
): string;

// Pure indirect-method builder. `accounts` = leaf accounts with
// { id, number, name, class, incomeBalance, accountType, cashFlowActivity },
// `balances` = accountId → { balanceAtDate, netChange } for [startDate, endDate].
// Net income = Σ IS leaves of rootSign(class) × netChange (Revenue +, Expense −).
// Cash effect of a non-cash BS leaf = class === "Asset" ? -netChange : +netChange.
// Bucket = account.cashFlowActivity ?? getCashFlowActivityForAccountType(accountType).
// Excluded (Bank/Cash): beginningCash += balanceAtDate - netChange;
// netChangeInCash += netChange. Lines with amount === 0 are omitted.
// unreconciledDifference = (netIncome + operatingΣ + investingΣ + financingΣ
//   + unclassifiedΣ) - netChangeInCash.
export function buildCashFlowStatement(
  accounts: CashFlowAccountInput[],
  balances: Map<string, { balanceAtDate: number; netChange: number }>,
  ): CashFlowStatement;
```

Implement both fully (the comment blocks above are the exact semantics; define and export `CashFlowAccountInput` in `types.ts`). For `getFiscalYearStartDate`: map month name → 1–12; FY start = most recent occurrence of that month's 1st on or before `asOfDate` (e.g. startMonth "April", asOfDate "2026-03-31" → "2025-04-01"; asOfDate "2026-04-01" → "2026-04-01"). Use plain string/date math consistent with existing helpers in this file — no new deps.

2. Add tests to `accounting.utils.test.ts` covering:
   - mapping: each accountType group → expected bucket; `null` → `null`; `"Bank"` → `"Excluded"`.
   - fiscal year start: January default; mid-year start month before/on/after boundary (the three April cases above).
   - cash flow builder: the spec's acceptance scenario — cash sale 100 (Bank +100 debit / Revenue +100), credit sale 50 (AR +50 / Revenue +50), depreciation 20 (Expense +20 / AccumDep −20 — class Asset, credit ⇒ negative). Assert: netIncome = 130... **compute carefully**: Revenue netChange = +150 (class-normal), Expense +20 ⇒ netIncome = 150 − 20 = 130. AR (Asset) netChange +50 ⇒ effect −50. AccumDep (Asset) netChange −20 ⇒ effect +20. Operating total = 130 − 50 + 20 = 100. Bank netChange +100 ⇒ netChangeInCash = 100, beginningCash = balanceAtDate − netChange, ending = beginning + 100, unreconciledDifference = 0.
   - unclassified: an account with `accountType: null` lands in `unclassified` and the identity still holds (difference 0).
   - override: same account with `cashFlowActivity: "Financing"` moves buckets.

**Verify:**
```bash
pnpm --filter @carbon/erp test -- accounting.utils
# Expected: all tests pass, including the new describe blocks
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
```

**Out of scope:** service functions, any DB access in these helpers (pure functions only).

---

## Task 4: Service — Retained Earnings / Net Income split

**Depends on:** Tasks 2, 3
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getFinancialStatementBalances` (line ~136)

**Steps:**

1. When `args.includeCurrentYearEarnings` is true:
   a. Fetch fiscal year settings via the existing `getFiscalYearSettings(client, companyId)` (line ~587). If `companyId` is null (consolidated callers pass a concrete id today — balance-sheet.tsx always passes one; if null, fall back to January).
   b. Compute `fiscalYearStart = getFiscalYearStartDate(settings?.startMonth, endDate)` where `endDate = args.endDate ?? today`.
   c. Make ONE additional `client.rpc("accountTreeBalancesByCompany", { p_company_group_id, p_company_id, from_date: fiscalYearStart, to_date: endDate })` call. For income-statement **leaf** accounts (`incomeBalance === "Income Statement" && !isGroup`), with `sign = rootSignMultiplier(a.class)`:
      - `currentYearEarnings = Σ sign × netChange` (FY window)
      - `priorYearsEarnings = Σ sign × (balanceAtDate − netChange)` (inception → FY start)
   d. Keep the existing "Net Income" synthetic row (`NET_INCOME_ACCOUNT_ID`) but set its `balance`/`balanceAtDate` to `currentYearEarnings` (its `netChange` stays the report-window IS net change as computed today).
   e. Find the Retained Earnings account row: leaf with `accountType === "Retained Earnings"` (read via cast: `(a as unknown as { accountType: string | null }).accountType` — the `accounts` view row type may not include it in committed types). If found: add `priorYearsEarnings` to its `balance` and `balanceAtDate`, and set a flag the UI can read (`isComputed: true` — extend the mapped row type locally). Add `priorYearsEarnings + currentYearEarnings` to the equity **group** row exactly where the code adds the single net income today (replacing the current single-line addition — total added to equity must equal old behavior).
   f. If NO Retained Earnings account exists: legacy behavior — Net Income row carries `balanceAtDate` = all-inception IS total (current code path), and return a `warnings: ["no-retained-earnings-account"]` marker alongside data (extend the return to `{ data, warnings, error }`; callers that ignore `warnings` still compile).
2. Preserve: `applyRootSignCorrection` still runs last; the Net Income row stays `isSystem: false`, parented to the equity group.
3. If the equity-group/balance-sheet-root lookup logic (lines ~197–205) doesn't match this description when you read it, STOP and report — do not improvise.

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
grep -n "priorYearsEarnings\|getFiscalYearStartDate" apps/erp/app/modules/accounting/accounting.service.ts | head -5
# Expected: both symbols present in getFinancialStatementBalances
```

**Out of scope:** UI rendering of the computed rows (Task 10), consolidation path changes (`getConsolidatedBalances` calls this function per company and inherits the split automatically — do not modify it).

---

## Task 5: Service — `getCashFlowStatement`

**Depends on:** Tasks 2, 3
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — new function after `getFinancialStatementBalances`

**Steps:**

1. Add:

```typescript
export async function getCashFlowStatement(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string,
  args: { startDate: string | null; endDate: string | null }
) {
  // 1) accounts: client.from("accounts").select("*")
  //      .eq("companyGroupId", companyGroupId).eq("active", true)
  //      .eq("isGroup", false)
  // 2) balances: client.rpc("accountTreeBalancesByCompany", {...})
  //      from_date: args.startDate ?? getDateNYearsAgo(50)..., to_date: args.endDate ?? today
  //    (same defaults as getFinancialStatementBalances)
  // 3) build the Map<accountId, {balanceAtDate, netChange}> from the RPC rows
  // 4) return { data: buildCashFlowStatement(accountInputs, balancesMap), error: null }
  //    accountInputs read cashFlowActivity via cast:
  //    (a as unknown as { cashFlowActivity: CashFlowActivity | null }).cashFlowActivity
}
```

Follow the exact fetch/error-handling pattern of `getFinancialStatementBalances` (parallel `Promise.all`, return the first error response untouched). `companyId` is required — this function computes one company in its local currency; Task 16's `getConsolidatedCashFlowStatement` composes it across companies.

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
grep -n "export async function getCashFlowStatement" apps/erp/app/modules/accounting/accounting.service.ts
# Expected: one match
```

**Out of scope:** consolidation/translation (deferred to Phase 2), route wiring (Task 8).

---

## Task 6: Service — `getGeneralLedgerLines` + opening balance

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — two new functions
- Modify: `apps/erp/app/modules/accounting/types.ts` — `GeneralLedgerLine` row type via `Awaited<ReturnType<...>>` pattern if needed

**Steps:**

1. Add a paginated list function (pattern: any list function using `setGenericQueryFilters`, e.g. the journals list in this file):

```typescript
export async function getGeneralLedgerLines(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    accountId: string | null;
    startDate: string | null;
    endDate: string | null;
    status: string[] | null; // journal.status values; default ["Posted", "Reversed"]
  }
) {
  let query = client
    .from("journalLine")
    .select("*, journal!inner(id, journalEntryId, postingDate, status, sourceType, description)", { count: "exact" })
    .eq("companyId", companyId);
  if (args.accountId) query = query.eq("accountId", args.accountId);
  if (args.startDate) query = query.gte("journal.postingDate", args.startDate);
  if (args.endDate) query = query.lte("journal.postingDate", args.endDate);
  query = query.in("journal.status", args.status ?? ["Posted", "Reversed"]);
  query = setGenericQueryFilters(query, args, [
    { column: "journal(postingDate)", ascending: true },
  ]);
  return query;
}
```

If the embedded-resource orderBy syntax (`journal(postingDate)`) fails at runtime/typecheck, order by `createdAt` ascending instead and STOP to note the limitation in the task checklist — do not silently drop ordering. If `journal!inner(...)` embedding fails typecheck because of the composite-key relationship, fall back to two queries (lines page, then `in("id", journalIds)` header fetch) — keep the return shape `{ data, count, error }`.

2. Add the opening-balance helper (single account, for the running-balance row):

```typescript
export async function getGeneralLedgerOpeningBalance(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string,
  accountId: string,
  beforeDate: string // filter-window start; opening = balance through beforeDate - 1 day
) {
  // call accountTreeBalancesByCompany with from_date = beforeDate, to_date = beforeDate,
  // find the account row, return balanceAtDate - netChange (balance strictly before beforeDate)
}
```

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
```

**Out of scope:** dimension columns on the GL report (future), CSV specifics (shared Table handles it).

---

## Task 7: Paths + accounting nav entries

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — after `incomeStatement` (line ~578)
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — after the Trial Balance entry (line ~55)

**Steps:**

1. `path.ts` additions beside the existing report paths:

```typescript
cashFlowStatement: `${x}/accounting/cash-flow`,
generalLedger: `${x}/accounting/general-ledger`,
journalEntry: (id: string) => `${x}/accounting/journals/${id}`,
```

(match the exact style of neighbors; `journalEntry` goes in the function-style section if the file separates statics from functions — follow local ordering.)

2. `useAccountingSubmodules.tsx`: add two entries in the same group as Balance Sheet / Income Statement / Trial Balance, matching their object shape exactly:
   - `name: t`Cash Flow``, `to: path.to.cashFlowStatement`
   - `name: t`General Ledger``, `to: path.to.generalLedger`

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
grep -n "cashFlowStatement\|generalLedger" apps/erp/app/utils/path.ts
# Expected: both present
```

**Out of scope:** MES paths, breadcrumb handles (each route file defines its own).

---

## Task 8: Route + UI — cash flow statement

**Depends on:** Tasks 5, 7
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/cash-flow.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Reports/CashFlowStatement.tsx`
- Modify: `apps/erp/app/modules/accounting/ui/Reports/index.ts` — export it
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/balance-sheet.tsx` (route/loader shape, `ReportFilters` usage) and `apps/erp/app/modules/accounting/ui/Reports/TrialBalanceTable.tsx` (flat report table with totals styling)

**Steps:**

1. Route: copy `balance-sheet.tsx`'s structure. Loader: `requirePermissions(request, { view: "accounting", role: "employee" })`; read `companies`, `startDate`, `endDate` params; resolve `selectedCompanyId` as balance-sheet does. **This task builds the single-company path only**: when `companiesParam === "all"`, temporarily fall back to the session `companyId` (Task 17 replaces this fallback with the consolidated branch — leave a `// TODO(Task 17)` on that line). Call `getCashFlowStatement(client, companyGroupId, selectedCompanyId, { startDate, endDate })`; on error, redirect to `path.to.accounting` with flash (copy the pattern verbatim). `handle.breadcrumb: "Cash Flow"`, `to: path.to.cashFlowStatement`.
2. `CashFlowStatement.tsx`: render the sections in order — Operating (first line "Net Income", then each `operating` line), Investing, Financing, Unclassified (only when non-empty, with an amber header warning: "N accounts have no cash flow activity — set an account type or override"), then the footer block: Net change in cash / Cash at beginning of period / Cash at end of period / (Unreconciled difference row only when non-zero, styled destructive). Use the table primitives `TrialBalanceTable.tsx` uses (grep its imports — `@carbon/react` `Table`/`Thead`/`Tbody` wrappers) and the same currency formatting helper it uses. Section subtotal rows use the same styling as that table's totals row. Each account line's amount links to `path.to.generalLedger + "?accountId={id}&startDate=...&endDate=..."`; the Net Income line links to `path.to.incomeStatement` with the same window.
3. `ReportFilters` reuse: pass the same props balance-sheet passes (the "All companies" option stays visible — it resolves to the fallback until Task 17 wires the consolidated branch).
4. No parenthesized counts anywhere (house style).

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
```

**Out of scope:** consolidated mode, translation toggle on this report, PDF/print.

---

## Task 9: Route + UI — general ledger detail report

**Depends on:** Tasks 6, 7
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/general-ledger.tsx`
- Create: `apps/erp/app/modules/accounting/ui/GeneralLedger/GeneralLedgerTable.tsx` (+ `index.ts` barrel in that folder; re-export from `ui/index.ts` if one exists — follow how `ui/Reports` is exported)
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntriesTable.tsx` (shared `Table`-based accounting list + its route `journals.tsx` loader pattern)

**Steps:**

1. Route loader: `requirePermissions({ view: "accounting", role: "employee" })`; parse `accountId`, `startDate`, `endDate`, `status` (multi), plus standard table params via the same helper `journals.tsx` uses (`getGenericQueryFilters` — copy its param parsing exactly). Call `getGeneralLedgerLines`. When `accountId` is set AND sort is default (posting date ascending): also call `getGeneralLedgerOpeningBalance` with `beforeDate = startDate ?? epoch` and return `openingBalance`.
2. `GeneralLedgerTable.tsx`: columns — Posting Date, Journal (the `journal.journalEntryId` readable id, linked to `path.to.journalEntry(journal.id)`), Source (`journal.sourceType`), Description (line description ?? journal description), Debit (`toDisplayDebit(amount, accountClass)`), Credit (`toDisplayCredit(amount, accountClass)`), and — single-account mode only — Running Balance (client-computed: opening + cumulative class-signed amount per row, page-local starting from `openingBalance`; hide the column when paginated past page 1 or sorted non-default). Debit/credit formatting: import from `@carbon/utils` (`toDisplayDebit`/`toDisplayCredit`); account class comes from the account filter's selected account (fetch account row in loader when `accountId` set). Filters row: account combobox (grep for an existing account selector component — `Account` field in `~/components/Form` used by journal entry form; use the same), date range pickers, status filter.
3. First row (single-account mode): synthetic "Opening balance" row above the data rows showing `openingBalance`.
4. Underscore rule: no accessorKey may contain `_` (Table export crashes otherwise).

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
```

**Out of scope:** editing anything (read-only report), dimension/cost-center columns, Draft journals in running balance (excluded by design even when the status filter shows them).

---

## Task 10: Statement trees — RE/CYE display, drill links, unclassified warning

**Depends on:** Tasks 4, 7
**Files:**
- Modify: `apps/erp/app/modules/accounting/ui/Reports/FinancialStatementTree.tsx` — leaf links, computed-row affordances
- Modify: `apps/erp/app/routes/x+/accounting+/balance-sheet.tsx` — pass warnings + window params through
- Modify: `apps/erp/app/routes/x+/accounting+/income-statement.tsx` — pass window params through

**Steps:**

1. `FinancialStatementTree.tsx`: leaf rows (`!isGroup`, real accounts) — wrap the balance amount in a `Link` to `path.to.generalLedger + "?accountId={id}&startDate={window start}&endDate={window end}"` (add `startDate`/`endDate` props to the tree, passed from each route's params; balance sheet passes no startDate → omit the param, GL report then shows inception-to-date). The synthetic Net Income row (`id === NET_INCOME_ACCOUNT_ID`) links to `path.to.incomeStatement` with the fiscal-YTD window instead; give it and the augmented Retained Earnings row (`isComputed` flag from Task 4) a muted "computed" tooltip: Net Income — "Income statement activity for the current fiscal year (computed, not posted)"; Retained Earnings — "Posted balance plus prior fiscal years' net income (computed, not posted)". Use the existing tooltip primitive already imported in the tree or `@carbon/react`'s `Tooltip`.
2. `balance-sheet.tsx`: surface `warnings` from `getFinancialStatementBalances` — when it contains `"no-retained-earnings-account"`, render an amber alert above the tree: "No Retained Earnings account found — prior-year income is shown inside Net Income. Add an account with type Retained Earnings." (use the alert component `ChartOfAccountsTree.tsx` or another accounting screen already uses; grep `Alert` in `apps/erp/app/modules/accounting/ui/`).
3. Keep consolidated mode untouched: links render the same; `translatedBalance` display unchanged.

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
grep -n "generalLedger" apps/erp/app/modules/accounting/ui/Reports/FinancialStatementTree.tsx | head -3
# Expected: link present
```

**Out of scope:** comparison columns (Task 12), tree virtualization changes.

---

## Task 11: Route + UI — journal entry drawer

**Depends on:** Task 7
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/journals.$journalId.tsx`
- Create: `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryDrawer.tsx` (+ export from that folder's `index.ts`)
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/cost-centers.$costCenterId.tsx` (Drawer child-route pattern under a list route) and `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryForm.tsx` (line rendering primitives)

**Steps:**

1. Route: loader `requirePermissions({ view: "accounting" })`; `getJournalEntry(client, journalId)` (exists, service line ~1665 — verify it returns header + lines; if it returns header only, also call the lines query used by `journals.tsx`'s expanded view or fetch `journalLine` by `journalId` + `companyId`). Render `<JournalEntryDrawer>`; on close, navigate to `path.to.journals` (mirror the cost-centers close behavior). This must be a **Drawer overlay**, not a page (detail-view convention).
2. Drawer content (read-only): header — journalEntryId, posting date, status badge, source type, description; lines table — account number + name, description, Debit, Credit (`toDisplayDebit`/`toDisplayCredit` with each line's account class — `getJournalEntry`'s select must include the account relation; extend its select if needed), totals row proving debits = credits.
3. Verify `journals.tsx` renders an `<Outlet />` for child routes; if it does not, add one (same as the cost-centers list route does).

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
```

**Out of scope:** editing/reversing from the drawer (existing actions stay where they are), dimensions display.

---

## Task 12: Comparative columns on income statement + balance sheet

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/routes/x+/accounting+/income-statement.tsx` — `compare` param + second balance call
- Modify: `apps/erp/app/routes/x+/accounting+/balance-sheet.tsx` — same
- Modify: `apps/erp/app/modules/accounting/ui/Reports/ReportFilters.tsx` — Compare select
- Modify: `apps/erp/app/modules/accounting/ui/Reports/FinancialStatementTree.tsx` — comparison + variance columns

**Steps:**

1. `ReportFilters.tsx`: add a `Select` labeled `Compare` with options None / Previous period / Previous year, writing `compare=none|priorPeriod|priorYear` to search params via the existing `setParams` helper (copy the DatePicker param-writing style at lines ~81–90). Render it only when a new optional prop `showCompare` is true (statements pass true; trial balance/cash flow don't pass it).
2. Window math (small pure helper `getComparisonWindow(compare, startDate, endDate, mode)` in `accounting.utils.ts` + unit tests in `accounting.utils.test.ts`):
   - income statement (`mode: "range"`): priorPeriod → same-length window ending the day before `startDate`; priorYear → both dates minus one year. Null `startDate` (inception) → comparison disabled (return null).
   - balance sheet (`mode: "asOf"`): priorPeriod → `endDate` minus one month; priorYear → minus one year. Null `endDate` → treat as today first.
3. Loaders: when `compare !== none` and a window resolves, run the same data call again with the comparison window — `getFinancialStatementBalances` single-company, `getConsolidatedBalances` consolidated (same branch the route already has) — and return `comparison: { byAccountId: Record<string, number> }` mapping account id → the same field the primary tree displays (`balanceAtDate` for balance sheet, `netChange` for income statement; translated variants in consolidated mode).
4. `FinancialStatementTree.tsx`: when `comparison` prop present, three extra columns — Comparison, $ Variance (primary − comparison), % Variance (`comparison === 0 ? "—" : (variance / |comparison|) × 100`, one decimal). Computed rows (Net Income, augmented RE) get comparison values only if present in the comparison map (Net Income row: include it in the map by reusing the synthetic row from the comparison call); otherwise render "—". Column headers via the tree's existing header style.

**Verify:**
```bash
pnpm --filter @carbon/erp test -- accounting.utils
# Expected: getComparisonWindow tests pass (6+ cases incl. nulls)
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
```

**Out of scope:** budget comparison (budgeting spec Phase 3 plugs into these columns later), period-boundary snapping (Phase 2), %-of-revenue columns.

---

## Task 13: Trial balance — four-column UI + drill links

**Depends on:** Tasks 1 (SQL shape), 7
**Files:**
- Modify: `apps/erp/app/modules/accounting/ui/Reports/TrialBalanceTable.tsx` — column groups + links + totals
- Modify: `apps/erp/app/routes/x+/accounting+/trial-balance.tsx` — pass window params for links (loader's `getTrialBalance` call is unchanged)

**Steps:**

1. The RPC now returns four extra columns. Committed types won't know them — cast the RPC response rows once at the boundary: `const rows = (data ?? []) as unknown as TrialBalanceRow[]` with `TrialBalanceRow` defined in `types.ts` listing all 12 return fields.
2. `TrialBalanceTable.tsx`: grouped headers — Opening (Debit | Credit), Period (Debits | Credits), Closing (Debit | Credit) — plus Net Change if currently shown; footer totals per column; assert visually that opening-debit total = opening-credit total and same for period and closing (render the three pairs; no parenthesized numbers). Account number/name cell links to `path.to.generalLedger + "?accountId=...&startDate=...&endDate=..."` using the report's current window.
3. If `TrialBalanceTree.tsx` (the hierarchical variant) renders the same RPC data, apply the closing-balance columns there unchanged — the tree keeps its existing columns; only the flat table gets the four-column treatment. If the tree breaks typecheck from the row cast, fix the shared type, not the tree's display.

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
grep -n "openingDebit\|periodDebits" apps/erp/app/modules/accounting/ui/Reports/TrialBalanceTable.tsx | head -3
# Expected: new columns rendered
```

**Out of scope:** changing `getTrialBalance`'s signature, the consolidated trial balance translation logic.

---

## Task 14: Account form — Cash Flow Activity select

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/accounting/ui/ChartOfAccounts/ChartOfAccountForm.tsx`
- Copy from (precedent): the existing `accountType` / class Select fields inside the same form

**Steps:**

1. Add a `Select` (from `~/components/Form`, same import the form already uses) named `cashFlowActivity`, label "Cash Flow Activity", options: `[{ value: "", label: "Default (from account type)" }, ...cashFlowActivities.map(...)]`. Render it only when the form's `incomeBalance` value is `"Balance Sheet"` (mirror however the form conditionally shows other fields; if it doesn't do conditional fields, show it always with the helper text "Used by the cash flow statement; income statement accounts roll into Net Income").
2. Confirm the route action that persists the form (`charts.new.tsx` / `charts.$accountId.tsx`) passes validator output straight to the upsert — since `accountValidator` gained the field (Task 2), no action change should be needed; the DB write needs a cast only if the generated `account` Insert/Update type rejects the column (`insert([{ ...data } as any])` — match how the period-closing plan handles unknown columns). If the upsert filters fields explicitly, add `cashFlowActivity` to the allowed list.

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
```

**Out of scope:** bulk-editing activities, CSV import of accounts.

---

## Task 15: CSV export buttons on statement reports

**Depends on:** Tasks 8, 10, 13
**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Reports/ExportReportButton.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/{balance-sheet,income-statement,cash-flow,trial-balance}.tsx` — render it in the filter row
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRateForm.tsx` (standalone `json2csv` download — Blob + anchor pattern)

**Steps:**

1. `ExportReportButton.tsx`: props `{ rows: Record<string, string | number | null>[]; filename: string }`; on click, `json2csv(rows, { emptyFieldValue: "" })` → Blob → anchor download (copy the ExchangeRateForm mechanics exactly, including the `json-2-csv` import name). Icon button labeled "Export CSV" matching the filter-bar button styling used in `ReportFilters.tsx`.
2. Each route maps its loaded data to flat rows: statements → `{ number, name, balance/netChange, comparison?, variance? }` per visible account row (indent group rows with two spaces per depth in the name); cash flow → `{ section, name, amount }` + footer rows; trial balance → the 12 RPC columns. Filename: `balance-sheet-{endDate}.csv`, `income-statement-{endDate}.csv`, `cash-flow-{endDate}.csv`, `trial-balance-{endDate}.csv` (fall back to today when endDate is null).
3. GL detail already exports via the shared `Table` — do not add a second button there.

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
```

**Out of scope:** PDF export (Phase 2), server-side export, Excel formatting.

---

## Task 16: Service — currency rates helper + consolidated cash flow

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — two new functions after `getCashFlowStatement`
- Modify: `apps/erp/app/modules/accounting/types.ts` — extend `CashFlowStatement` with `effectOfExchangeRates?: number`

**Steps:**

1. Rate helper — mirror the exact fallback chain of `translateTrialBalance` in `packages/database/supabase/migrations/20260315000002_exchange-rate-history.sql` (average = `AVG(rate)` over the window; closing = latest `rate` on/before a date; fallbacks average → closing → 1; `translated = local × rate`). Read that migration before implementing; if the rate direction there is not `local × rate = parent`, STOP and report.

```typescript
export async function getCurrencyRatesForWindow(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  currencyCode: string,
  args: { startDate: string | null; endDate: string | null }
) {
  // Query exchangeRateHistory (companyGroupId + currencyCode):
  //  - average: AVG of rate where effectiveDate in [startDate, endDate]
  //  - closingAtStart: latest rate where effectiveDate <= startDate (window
  //    open; beginning cash is the balance *before* startDate)
  //  - closingAtEnd: latest rate where effectiveDate <= endDate
  // Apply fallbacks per rate: average ?? closingAtEnd ?? 1; closing ?? 1.
  // Return { data: { average, closingAtStart, closingAtEnd }, error: null }.
  // When currencyCode equals the parent/base currency or no rows exist, all 1.
}
```

Fetch rows once with `.gte`/`.lte` on `effectiveDate` plus one query for the latest-before-start rate; compute in TS (no new RPC).

2. Consolidated statement:

```typescript
export async function getConsolidatedCashFlowStatement(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyIds: string[],
  parentCurrency: string,
  args: { startDate: string | null; endDate: string | null }
) {
  // For each company (Promise.all):
  //   - getCashFlowStatement (local currency)
  //   - company.baseCurrencyCode → getCurrencyRatesForWindow
  //   - translate: every section line amount and netIncome × average;
  //     beginningCash × closingAtStart; endingCash × closingAtEnd
  // Merge section lines across companies by accountId (shared chart), summing
  // translated amounts; sum netIncome/beginningCash/endingCash.
  // effectOfExchangeRates = endingCash − beginningCash −
  //   (netIncome + operatingΣ + investingΣ + financingΣ + unclassifiedΣ)
  // netChangeInCash (displayed) = endingCash − beginningCash.
  // Return { data: CashFlowStatement & { effectOfExchangeRates }, error }.
}
```

Companies list comes from the caller (route already loads `getCompaniesInGroup` — pass `baseCurrencyCode` per company through rather than re-fetching). Do NOT apply `generateEliminations` here — elimination journals are non-cash balanced adjustments; the elimination company's own journals are included when its id is in `companyIds` (same as other statements).

3. Unit-test the pure merge/plug math: extract a pure `mergeTranslatedCashFlows(perCompany: TranslatedCompanyFlow[])` into `accounting.utils.ts` and add tests in `accounting.utils.test.ts`: (a) two same-currency companies (all rates 1) → FX effect exactly 0, sections sum; (b) one foreign company with average 1.1, closingAtStart 1.0, closingAtEnd 1.2 → FX effect = ending×1.2 − beginning×1.0 − flows×1.1 (assert the identity Beginning + flows + FX = Ending in parent currency).

**Verify:**
```bash
pnpm --filter @carbon/erp test -- accounting.utils
# Expected: mergeTranslatedCashFlows tests pass (same-currency zero-FX case + foreign-rate identity case)
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
```

**Out of scope:** eliminations on the SCF (non-cash by construction), historical-rate equity handling (SCF uses average/closing only), caching rates.

---

## Task 17: Cash flow UI — consolidated mode + FX-effect line

**Depends on:** Tasks 8, 16
**Files:**
- Modify: `apps/erp/app/routes/x+/accounting+/cash-flow.tsx` — multi-company branch
- Modify: `apps/erp/app/modules/accounting/ui/Reports/CashFlowStatement.tsx` — FX line + currency label
- Copy from (precedent): the multi-company branch in `apps/erp/app/routes/x+/accounting+/balance-sheet.tsx` (lines ~47–88: `companiesParam === "all"`, parent currency resolution)

**Steps:**

1. Route: replace Task 8's `// TODO(Task 17)` single-company fallback. Copy balance-sheet's `selectedCompanyIds`/`isMultiCompany`/`parentCurrency` resolution; when `isMultiCompany && parentCurrency`, call `getConsolidatedCashFlowStatement(client, companyGroupId, selectedCompanyIds, parentCurrency, { startDate, endDate })` (pass each company's `baseCurrencyCode` from the already-loaded companies list); else keep the single-company call. Return `parentCurrency` + `isMultiCompany` for display.
2. `CashFlowStatement.tsx`: accept optional `effectOfExchangeRates` and `currencyCode` props. When `effectOfExchangeRates` is defined, render an "Effect of exchange rate changes on cash" row between the Financing section and the cash reconciliation footer (same row styling as section subtotals). Show the currency code in the header when provided (consolidated = parent currency). In consolidated mode, line-level drill links to the GL detail remain per-account but without a company filter — append no `companyId` param.
3. The footer identity in consolidated mode: Beginning + Net change (flows) + FX effect = Ending — assert visually by rendering Net change as `endingCash − beginningCash − effectOfExchangeRates` (flows-only) so the four footer rows sum exactly.

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
grep -n "effectOfExchangeRates" apps/erp/app/modules/accounting/ui/Reports/CashFlowStatement.tsx | head -2
# Expected: prop consumed
```

**Out of scope:** `showTranslated` toggle on single foreign-currency company (BS/IS-only concern), CTA (balance-sheet concept, not SCF).

---

## Task 18: Period picker in ReportFilters

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/modules/accounting/ui/Reports/ReportFilters.tsx` — Dates | Period mode toggle
- Modify: `apps/erp/app/routes/x+/accounting+/{balance-sheet,income-statement,cash-flow,trial-balance,general-ledger}.tsx` — loaders pass `periods` data
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getReportingPeriods`

**Steps:**

1. Service (reads period-closing's columns directly so this feature depends only on that MIGRATION, not its services):

```typescript
export async function getReportingPeriods(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const result = await client
    .from("accountingPeriod")
    .select("id, startDate, endDate")
    .eq("companyId", companyId)
    .order("startDate", { ascending: false });
  if (result.error) return result;
  // fiscalYear/periodNumber are period-closing columns absent from committed
  // types — read via cast; rows where either is null are filtered out.
  const rows = (result.data ?? []) as unknown as {
    id: string; startDate: string; endDate: string;
    fiscalYear: number | null; periodNumber: number | null;
  }[];
  return { data: rows.filter((r) => r.fiscalYear !== null && r.periodNumber !== null), error: null };
}
```

Select `"*"` if the narrowed select rejects unknown columns at runtime — the cast handles the shape either way. If the `accountingPeriod` table has no `fiscalYear` column at all (period-closing migration not applied), PostgREST returns every row with the cast fields `undefined` → the filter yields `[]` → the toggle hides. Confirm this degradation path works; if selecting explicit missing columns errors instead, fall back to `select("*")`.

2. `ReportFilters.tsx`: add a two-option segmented control Dates | Period (render only when a new optional `periods` prop is non-empty). Period mode replaces the two DatePickers with: fiscal year `Select` (distinct `fiscalYear` desc) + period `Select` ("Full year" + periods of that FY as "P{periodNumber} ({MMM})"). On selection, write `startDate`/`endDate` of the chosen period (or FY span for "Full year") via the existing `setParams` call (line ~84 pattern) — nothing else in any loader changes. Track mode in a `mode` search param so it survives navigation; default `dates`.
3. Each of the five report loaders: call `getReportingPeriods(client, selectedCompanyId ?? companyId)` and pass `periods` to `ReportFilters`. Comparison column header (Task 12's tree): when `mode=period` and a comparison is active, label the comparison column with the computed window's month/period name instead of the raw dates (pure display; reuse the window dates already returned by the loader).

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
pnpm --filter @carbon/erp test -- accounting.utils
# Expected: still green (no util regressions)
```

**Out of scope:** creating/generating periods (period-closing's `/x/accounting/periods` UI), snapping compare presets to non-monthly calendars (periods are monthly by construction), locking/closing semantics.

---

## Task 19: Report views — models, service, resource route

**Depends on:** Tasks 1 (table), 2
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `reportViewValidator`
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — three functions
- Create: `apps/erp/app/routes/x+/accounting+/report-views.tsx` — resource route (action only)
- Modify: `apps/erp/app/utils/path.ts` — `reportViews: `${x}/accounting/report-views``
- Copy from (precedent): any small intent-based action route in `x+/accounting+/` (e.g. the delete routes) for the action shape

**Steps:**

1. Validator:

```typescript
export const reportViewValidator = z.object({
  id: zfd.text(z.string().optional()),
  report: z.enum(["balance-sheet", "income-statement", "cash-flow", "trial-balance", "general-ledger"]),
  name: z.string().min(1, { message: "Name is required" }),
  params: z.string(), // JSON-stringified search params from the client
});
```

2. Service (RLS is owner-scoped, but scope queries defensively anyway). `reportView` is absent from committed types — use `(client as any).from("reportView")` with explicit row typing on the way out (`ReportView` type in `types.ts`: `{ id, userId, companyId, report, name, params: Record<string, string> }`):

```typescript
getReportViews(client, companyId: string, userId: string, report: string)
  // select *, eq companyId + userId + report, order name; parse params JSONB
upsertReportView(client, view: { id?: string; userId: string; companyId: string; report: string; name: string; params: Record<string, string> })
  // insert or update-by-id; set updatedAt on update
deleteReportView(client, id: string, userId: string)
  // delete eq id + userId (defense in depth on top of RLS)
```

3. Resource route: action only (`assertIsPost`), `requirePermissions(request, { view: "accounting" })` (personal data — the report's own view permission suffices; do NOT require update/create on accounting). `intent` field: `save` → validate with `reportViewValidator`, `JSON.parse(params)` into a record, call `upsertReportView` with `userId` from the session; `delete` → `deleteReportView(client, id, userId)`. Return `{ success: true }` or flash error — plain objects, never `Response.json`.

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
grep -n "reportViews" apps/erp/app/utils/path.ts
# Expected: present
```

**Out of scope:** sharing views across users, view management screen (dropdown-only in v1), MCP tool exposure.

---

## Task 20: Report views UI — dropdown + save/delete in ReportFilters

**Depends on:** Task 19
**Files:**
- Modify: `apps/erp/app/modules/accounting/ui/Reports/ReportFilters.tsx` — views dropdown + save popover
- Modify: `apps/erp/app/routes/x+/accounting+/{balance-sheet,income-statement,cash-flow,trial-balance,general-ledger}.tsx` — loaders return `reportViews` via `getReportViews`
- Copy from (precedent): `apps/erp/app/components/Table/components/TableHeader.tsx` saved-views affordance for visual placement; a `DropdownMenu` from `@carbon/react` for the menu itself

**Steps:**

1. `ReportFilters` gains optional props `report: string` and `views: ReportView[]`. When provided, render a "Views" `DropdownMenu` (leftmost in the filter row): one item per saved view (click = `navigate({ search: new URLSearchParams(view.params).toString() })`), each with a delete icon button submitting `intent=delete` + `id` to `path.to.reportViews` via `useFetcher`; a divider; "Save current view…" opening a small popover with a name input that submits `intent=save`, `report`, `name`, and `params = JSON.stringify(Object.fromEntries(currentSearchParams))` to the same route via `ValidatedForm` + `reportViewValidator`.
2. On successful save/delete, `revalidate` (fetcher completion already triggers loader revalidation; confirm the views list refreshes — if not, call `useRevalidator().revalidate()` on `fetcher.state === "idle" && fetcher.data?.success`).
3. Each report loader: `getReportViews(client, companyId, userId, "<report-slug>")` and pass through. Keep the dropdown hidden when `views` prop is undefined (e.g. other future consumers of ReportFilters).

**Verify:**
```bash
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
```

**Out of scope:** renaming views inline (delete + re-save covers v1), default/pinned views.

---

## Task 21: PDF financial statements package

**Depends on:** Tasks 4, 5, 16
**Files:**
- Create: `packages/documents/src/pdf/FinancialStatementsPDF.tsx`
- Modify: `packages/documents/src/pdf/index.ts` — barrel export
- Create: `apps/erp/app/routes/file+/accounting+/financial-statements[.]pdf.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `financialStatementsPdf` path helper (with query-param builder)
- Modify: `apps/erp/app/routes/x+/accounting+/{balance-sheet,income-statement,cash-flow}.tsx` — "Download PDF" button beside Export CSV
- Copy from (precedent): route shape `apps/erp/app/routes/file+/sales-invoice+/$id[.]pdf.tsx` (renderToStream → Buffer → `application/pdf` response, `ensureFont` before render); component style `packages/documents/src/pdf/components/Template.tsx` shell per `.ai/rules/pdf-generation-patterns.md` (hand-built tree — NOT block-registry; check how `KanbanLabelPDF.tsx` imports `useTw`/`tw` for styling)

**Steps:**

1. `FinancialStatementsPDF.tsx`: props `{ company: { name, logo? }, currencyCode, startDate, endDate, balanceSheet: StatementRow[], incomeStatement: StatementRow[], cashFlow: CashFlowStatement & { effectOfExchangeRates?: number } }` where `StatementRow = { name, number?, depth, amount, isGroup, isComputed? }` (flattened tree, depth-indented). Render inside `<Template title="Financial Statements" meta={{...}}>`: one section per statement (new `<Page>` per statement via three Template-wrapped pages OR one Template with page breaks — follow whatever `Template.tsx` supports; if Template is single-page-flow only, render three `<Page>` elements inside one `<Document>` manually reusing Template's header/footer components and STOP-note the deviation). Rows: name (indented 8pt per depth), right-aligned amount (`text-[9px]`, `tabular-nums` if supported); group rows bold; computed rows italic with a "(computed)" suffix; section totals with top border. Style exclusively via `useTw()`/`tw` semantic grays.
2. Route: `requirePermissions(request, { view: "accounting", role: "employee" })`; parse `companies`, `startDate`, `endDate` from the query string; resolve company selection exactly as `balance-sheet.tsx` does; fetch the three datasets with the same service calls the three screens use (`getFinancialStatementBalances` ×2 filtered by `incomeBalance`, or `getConsolidatedBalances` when multi-company; `getCashFlowStatement` / `getConsolidatedCashFlowStatement`); flatten trees to `StatementRow[]` (depth from parent chain, same ordering as the screens); `await ensureFont(...)` (default family) then `renderToStream(<FinancialStatementsPDF ... />)`; drain to Buffer; respond `application/pdf` with `Content-Disposition: inline; filename="{company} - Financial Statements {endDate}.pdf"`.
3. Buttons: on the three statement routes, an icon-link "Download PDF" beside the Export CSV button, `href = path.to.financialStatementsPdf + "?" + currentSearchParams` opening in a new tab.
4. Run `pnpm --filter @carbon/documents build` once if `fonts.data.ts` is missing locally (gitignored, generated).

**Verify:**
```bash
pnpm --filter @carbon/documents typecheck 2>&1 | tail -3
# Expected: exit 0
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
grep -n "FinancialStatementsPDF" packages/documents/src/pdf/index.ts
# Expected: exported
```

**Out of scope:** document-template customizer integration (`DOCUMENT_PDFS` registration is for customizable/previewable docs — skip it), trial balance / GL detail in the PDF, ZPL/printing, email delivery.

---

## Task 22: Apply migration locally

**Depends on:** Task 1 (and the local stack being up — if `crbn up` isn't running, STOP and ask the user; never rebuild the DB)
**Files:** none (applies `packages/database/supabase/migrations/*financial-reporting.sql`)

**Steps:**

1. `pnpm db:migrate` (crbn migrate; it may regenerate local types — do NOT commit any `packages/database/src/types.ts` diff; `git checkout -- packages/database/src/types.ts` afterwards if it changed).
2. Smoke the RPC and column with psql (get `PORT_DB` from `.env.local`):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:$PORT_DB/postgres" -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='account' AND column_name='cashFlowActivity';"
# Expected: one row
psql "postgresql://postgres:postgres@127.0.0.1:$PORT_DB/postgres" -c \
  "SELECT proname, pronargs FROM pg_proc WHERE proname='trialBalance';"
# Expected: one row, 4 args
psql "postgresql://postgres:postgres@127.0.0.1:$PORT_DB/postgres" -c \
  "SELECT relrowsecurity FROM pg_class WHERE relname='reportView';"
# Expected: one row, t (table exists with RLS enabled)
```

3. Re-apply idempotency check: run the migration file once more via psql `-f`; expect zero errors.

**Verify:** (the psql outputs above)

**Out of scope:** deploying, seeding data.

---

## Task 23: Full verification gate

**Depends on:** all code tasks (2–21) + Task 22
**Files:** none

**Steps + Verify:**

```bash
pnpm --filter @carbon/erp test -- accounting
# Expected: all accounting tests pass (utils incl. cash-flow/fiscal-year/comparison/merge-translated suites)
pnpm --filter @carbon/erp typecheck 2>&1 | tail -3
# Expected: exit 0
pnpm --filter @carbon/documents typecheck 2>&1 | tail -3
# Expected: exit 0 (FinancialStatementsPDF)
pnpm run lint 2>&1 | tail -5
# Expected: no new errors (Biome clean on changed files)
git status --porcelain -- packages/database/src/types.ts
# Expected: empty (committed types untouched)
```

Then commit via the check-and-commit gate (user-approved checkpoints only).

---

## Task 24: Browser verification (/test)

**Depends on:** Task 23, local stack up, accounting enabled (`/x/settings/accounting` — crbn reset seeds it off)
**Files:** none

**Steps:**

1. Run the `/test` skill against the feature branch with this scenario list (it will use `/login` + agent-browser; RVF forms submit via `requestSubmit`):
   - Post (or reuse seeded) journals so there is prior-fiscal-year and current-year revenue; open `/x/accounting/balance-sheet` → Retained Earnings and Net Income are separate rows, equity totals match the trial balance's equity closing total, root ≈ 0.
   - `/x/accounting/cash-flow` for the current month → sections render; Beginning + Net change = Ending; no Unreconciled difference on seeded data; Unclassified section only if seeded chart has untyped accounts (then the warning shows).
   - Click a balance-sheet leaf amount → lands on `/x/accounting/general-ledger?accountId=...` with matching total; opening-balance row present; click a line → journal drawer opens with balanced totals.
   - Income statement with `Compare: Previous year` → three extra columns, sane variance math on one spot-checked account.
   - Trial balance → Opening/Period/Closing groups each foot to equal debits and credits; Export CSV downloads on all four reports.
   - Account form: set an Other Current Liability account's Cash Flow Activity to Financing → cash flow statement moves its line.
   - Cash flow with `Companies: All` → sections in the parent currency, an "Effect of exchange rate changes on cash" row present, and Beginning + Net change + FX effect = Ending (exactly 0 FX when all companies share the currency).
   - "Download PDF" on the balance sheet → an `application/pdf` response opens containing all three statements; spot-check one total per statement against the screens.
   - With period-closing's migration applied and periods generated: switch filters to Period mode, pick "FY · P{current}" → dates populate and the report matches the same manual date range; with no periods, the toggle is absent.
   - Save a view "Board pack" on the income statement (consolidated + prior-year compare), navigate away, reapply from the Views dropdown → identical URL params; delete it → gone from the dropdown.
2. Capture screenshots of each report for the PR (house rule: net-new UI PRs include agent-browser screenshots).

**Verify:** `/test` playbook passes all scenarios; screenshots saved.

**Out of scope:** performance testing, Xero-sync interactions.
