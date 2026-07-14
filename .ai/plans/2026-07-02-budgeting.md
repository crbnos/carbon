# GL Budgeting (Phase 1) — Implementation Plan

## Overview

- **Design Spec:** `.ai/specs/2026-07-02-budgeting.md` (status: in-progress, all open questions resolved). This plan covers **Phase 1 — Core budgeting** only. Phases 2 (commitments & budget control) and 3 (reporting integration & consolidation) get their own plan files after Phase 1 ships.
- **Research:** `.ai/research/budgeting.md`
- **Prerequisite:** `.ai/plans/2026-07-02-period-closing.md` executed first — Phase 1 relies on `accountingPeriod.fiscalYear`/`periodNumber` (migration `20260702044133`, already drafted) and the `createFiscalYearPeriods` service (period-close plan Task 4).
- **Tasks:** 17 tasks (~70–90 min of work) + gated verification
- **Branch:** `feature/budgeting`

**Ground rules for the executor (same as the period-closing plan):**

- Do NOT regenerate or commit `packages/database/src/types.ts` — committed types are cloud-generated. The new `budget`/`budgetLine` tables and `budgetVsActual` RPC are absent from them; access via `(client as any).from("budget")` / `(client as any).rpc("budgetVsActual", ...)` casts (established pattern, e.g. `(client as any).from("itemSamplingPlan")`).
- Do NOT rebuild the database. Apply the migration with `pnpm db:migrate` only, when the local stack is up (Task 16).
- Typecheck per package (`pnpm --filter @carbon/erp typecheck`), never whole-repo `tsc --noEmit`.
- Commit only at the marked checkpoints, after verification passes (check-and-commit gate).
- UI components use plain strings (the CostCenterForm precedent); only `useAccountingSubmodules.tsx` uses Lingui `t` macros.

**Two deliberate simplifications vs the spec text (spec updated to match):**

1. Copy/seed are **SQL functions in the migration** (atomic INSERT…SELECT, RLS-invoker), not Kysely transactions — avoids `as any` Kysely casts entirely.
2. Matrix cells write **per-cell from the browser Supabase client** with optimistic state (the QuoteLinePricing precedent): update-by-id when the cell row exists, insert otherwise, delete on zero — no batched route action and no reliance on PostgREST `onConflict` against the NULLS NOT DISTINCT constraint.
3. Prior-year-profile spreading is delivered by **seed-from-actuals** (it preserves the source year's monthly shape by construction; `p_spread = 'even'` flattens it). Row-level matrix helpers are Fill and Distribute only.

## Dependencies

```
Task 1–2 (migration: schema, then functions)
  └─ Task 16 (apply migration) — deferred until stack is up
Task 3 (models) ─┬─ Task 5 (services) ─┬─ Task 9–10 (list/new/edit/delete/approve routes)
Task 4 (types)  ─┘                     ├─ Task 11–12 (matrix component + route)
Task 6 (path.ts) — needed by 7–14      └─ Task 13 (budget vs actual report)
Task 7 (BudgetForm) ── Task 9
Task 8 (BudgetsTable) ── Task 9
Task 14 (sidebar) — after Task 6
Task 15 (CSV import) — after Task 1–2 land; independent of UI tasks
Task 17 (typecheck/lint/AGENTS.md) — last code task
```

---

## Task 1: Migration — schema (enum, tables, trigger, RLS)

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_budgeting.sql`

**Steps:**

1. Create the migration file:

```bash
pnpm db:migrate:new budgeting
# Creates packages/database/supabase/migrations/<timestamp>_budgeting.sql
```

Verify the generated timestamp sorts AFTER `20260702044133_period-close-lifecycle.sql` and its HHMMSS portion is not `000000` (rename with random HHMMSS if needed).

2. Write the schema section:

```sql
-- Budgeting Phase 1: budget + budgetLine
-- Amounts are GL-signed (positive = debit), matching journalLine.amount.
-- Spec: .ai/specs/2026-07-02-budgeting.md

DO $$ BEGIN
  CREATE TYPE "budgetStatus" AS ENUM ('Draft', 'Approved', 'Archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "budget" (
    "id" TEXT NOT NULL DEFAULT id('bud'),
    "companyId" TEXT NOT NULL,

    "name" TEXT NOT NULL,
    "description" TEXT,
    "fiscalYear" INTEGER NOT NULL,
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

CREATE INDEX IF NOT EXISTS "budget_companyId_idx" ON "budget" ("companyId");
CREATE INDEX IF NOT EXISTS "budget_createdBy_idx" ON "budget" ("createdBy");
CREATE INDEX IF NOT EXISTS "budget_companyId_fiscalYear_idx" ON "budget" ("companyId", "fiscalYear");

DO $$ BEGIN
  ALTER TABLE "budget" ADD CONSTRAINT "budget_companyId_name_key"
      UNIQUE ("companyId", "name");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "budgetLine" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,

    "accountId" TEXT NOT NULL,
    "accountingPeriodId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "amount" NUMERIC NOT NULL DEFAULT 0,

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

CREATE INDEX IF NOT EXISTS "budgetLine_companyId_idx" ON "budgetLine" ("companyId");
CREATE INDEX IF NOT EXISTS "budgetLine_budgetId_idx" ON "budgetLine" ("budgetId", "companyId");
CREATE INDEX IF NOT EXISTS "budgetLine_accountId_idx" ON "budgetLine" ("accountId");
CREATE INDEX IF NOT EXISTS "budgetLine_accountingPeriodId_idx" ON "budgetLine" ("accountingPeriodId");
CREATE INDEX IF NOT EXISTS "budgetLine_costCenterId_idx" ON "budgetLine" ("costCenterId");
CREATE INDEX IF NOT EXISTS "budgetLine_createdBy_idx" ON "budgetLine" ("createdBy");

DO $$ BEGIN
  ALTER TABLE "budgetLine" ADD CONSTRAINT "budgetLine_cell_key"
      UNIQUE NULLS NOT DISTINCT ("budgetId", "companyId", "accountId", "accountingPeriodId", "costCenterId");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

-- Hard backstop (period-close trigger pattern): lines writable only in Draft.
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

DROP TRIGGER IF EXISTS "budgetLine_check_editable" ON "budgetLine";
CREATE TRIGGER "budgetLine_check_editable"
  BEFORE INSERT OR UPDATE OR DELETE ON "budgetLine"
  FOR EACH ROW EXECUTE FUNCTION check_budget_editable();

-- RLS
ALTER TABLE "public"."budget" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."budget";
CREATE POLICY "SELECT" ON "public"."budget"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."budget";
CREATE POLICY "INSERT" ON "public"."budget"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."budget";
CREATE POLICY "UPDATE" ON "public"."budget"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."budget";
CREATE POLICY "DELETE" ON "public"."budget"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

ALTER TABLE "public"."budgetLine" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."budgetLine";
CREATE POLICY "SELECT" ON "public"."budgetLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."budgetLine";
CREATE POLICY "INSERT" ON "public"."budgetLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."budgetLine";
CREATE POLICY "UPDATE" ON "public"."budgetLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."budgetLine";
CREATE POLICY "DELETE" ON "public"."budgetLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);
```

3. Do NOT apply yet — application is Task 16.

---

## Task 2: Migration — SQL functions (copy, seed, report)

**Files:**
- Modify: the Task 1 migration file (append)

**Steps:**

1. Append the copy function. It replaces the target budget's lines with the source's, remapping periods by `periodNumber` across fiscal years and multiplying by the factor. The Task 1 trigger enforces target-is-Draft per row; SECURITY INVOKER keeps RLS in force.

```sql
CREATE OR REPLACE FUNCTION "copyBudgetLines"(
  p_company_id TEXT,
  p_source_budget_id TEXT,
  p_target_budget_id TEXT,
  p_adjustment_factor NUMERIC DEFAULT 1,
  p_created_by TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM "budgetLine"
  WHERE "budgetId" = p_target_budget_id AND "companyId" = p_company_id;

  INSERT INTO "budgetLine"
    ("companyId", "budgetId", "accountId", "accountingPeriodId", "costCenterId", "amount", "createdBy")
  SELECT
    p_company_id,
    p_target_budget_id,
    bl."accountId",
    tp."id",
    bl."costCenterId",
    ROUND(bl."amount" * p_adjustment_factor, 2),
    COALESCE(p_created_by, bl."createdBy")
  FROM "budgetLine" bl
  JOIN "budget" sb ON sb."id" = bl."budgetId" AND sb."companyId" = bl."companyId"
  JOIN "budget" tb ON tb."id" = p_target_budget_id AND tb."companyId" = p_company_id
  JOIN "accountingPeriod" sp
    ON sp."id" = bl."accountingPeriodId" AND sp."companyId" = p_company_id
  JOIN "accountingPeriod" tp
    ON tp."companyId" = p_company_id
   AND tp."fiscalYear" = tb."fiscalYear"
   AND tp."periodNumber" = sp."periodNumber"
  WHERE bl."budgetId" = p_source_budget_id
    AND bl."companyId" = p_company_id
    AND bl."amount" != 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
```

2. Append the seed-from-actuals function. Aggregates posted journal lines by account × period-number × cost center (via the CostCenter-type dimension) for the source fiscal year and writes them into the target budget's matching periods. `p_spread = 'source'` keeps the monthly profile; `'even'` divides the annual total evenly across the target FY's periods.

```sql
CREATE OR REPLACE FUNCTION "seedBudgetLinesFromActuals"(
  p_company_id TEXT,
  p_source_fiscal_year INTEGER,
  p_target_budget_id TEXT,
  p_adjustment_factor NUMERIC DEFAULT 1,
  p_spread TEXT DEFAULT 'source',           -- 'source' | 'even'
  p_created_by TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM "budgetLine"
  WHERE "budgetId" = p_target_budget_id AND "companyId" = p_company_id;

  WITH "costCenterDim" AS (
    SELECT d."id"
    FROM "dimension" d
    JOIN "company" c ON c."companyGroupId" = d."companyGroupId"
    WHERE c."id" = p_company_id AND d."entityType" = 'CostCenter'
    LIMIT 1
  ),
  "actuals" AS (
    SELECT
      jl."accountId",
      sp."periodNumber",
      jld."valueId" AS "costCenterId",
      SUM(jl."amount") AS "amount"
    FROM "journalLine" jl
    JOIN "journal" j ON j."id" = jl."journalId" AND j."companyId" = p_company_id
    JOIN "accountingPeriod" sp
      ON sp."id" = j."accountingPeriodId"
     AND sp."companyId" = p_company_id
     AND sp."fiscalYear" = p_source_fiscal_year
    LEFT JOIN "journalLineDimension" jld
      ON jld."journalLineId" = jl."id"
     AND jld."dimensionId" = (SELECT "id" FROM "costCenterDim")
    WHERE jl."companyId" = p_company_id
      AND jl."accountId" IS NOT NULL
    GROUP BY jl."accountId", sp."periodNumber", jld."valueId"
  ),
  "shaped" AS (
    SELECT
      a."accountId",
      tp."id" AS "accountingPeriodId",
      a."costCenterId",
      CASE
        WHEN p_spread = 'even' THEN
          ROUND((SUM(a."amount") OVER (PARTITION BY a."accountId", a."costCenterId"))
            * p_adjustment_factor
            / (COUNT(*) OVER (PARTITION BY a."accountId", a."costCenterId")), 2)
        ELSE ROUND(a."amount" * p_adjustment_factor, 2)
      END AS "amount"
    FROM "actuals" a
    JOIN "budget" tb ON tb."id" = p_target_budget_id AND tb."companyId" = p_company_id
    JOIN "accountingPeriod" tp
      ON tp."companyId" = p_company_id
     AND tp."fiscalYear" = tb."fiscalYear"
     AND tp."periodNumber" = a."periodNumber"
  )
  INSERT INTO "budgetLine"
    ("companyId", "budgetId", "accountId", "accountingPeriodId", "costCenterId", "amount", "createdBy")
  SELECT p_company_id, p_target_budget_id, s."accountId", s."accountingPeriodId",
         s."costCenterId", s."amount", p_created_by
  FROM "shaped" s
  WHERE s."amount" != 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
```

Note: `'even'` divides across the periods that had activity (the partition count). Fully-even 12-way spreads of sparse actuals are refined in the matrix; this matches "flatten what existed".

3. Append the report function:

```sql
CREATE OR REPLACE FUNCTION "budgetVsActual"(
  p_company_id TEXT,
  p_budget_id TEXT,
  p_cost_center_id TEXT DEFAULT NULL,
  p_rollup BOOLEAN DEFAULT TRUE,
  p_untagged BOOLEAN DEFAULT FALSE
) RETURNS TABLE (
  "accountId" TEXT,
  "number" TEXT,
  "name" TEXT,
  "class" "glAccountClass",
  "incomeBalance" "glIncomeBalance",
  "periodNumber" INTEGER,
  "budget" NUMERIC,
  "actual" NUMERIC
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH "targetBudget" AS (
    SELECT b."id", b."companyId", b."fiscalYear"
    FROM "budget" b
    WHERE b."id" = p_budget_id AND b."companyId" = p_company_id
  ),
  "periods" AS (
    SELECT ap."id", ap."periodNumber"
    FROM "accountingPeriod" ap
    JOIN "targetBudget" tb ON ap."companyId" = tb."companyId"
     AND ap."fiscalYear" = tb."fiscalYear"
  ),
  "costCenterDim" AS (
    SELECT d."id"
    FROM "dimension" d
    JOIN "company" c ON c."companyGroupId" = d."companyGroupId"
    WHERE c."id" = p_company_id AND d."entityType" = 'CostCenter'
    LIMIT 1
  ),
  "costCenters" AS (
    -- the selected cost center (+ descendants when p_rollup)
    WITH RECURSIVE "tree" AS (
      SELECT cc."id" FROM "costCenter" cc
      WHERE cc."id" = p_cost_center_id AND cc."companyId" = p_company_id
      UNION ALL
      SELECT child."id" FROM "costCenter" child
      JOIN "tree" t ON child."parentCostCenterId" = t."id"
      WHERE p_rollup
    )
    SELECT "id" FROM "tree"
  ),
  "budgetSide" AS (
    SELECT bl."accountId", p."periodNumber", SUM(bl."amount") AS "amount"
    FROM "budgetLine" bl
    JOIN "periods" p ON p."id" = bl."accountingPeriodId"
    WHERE bl."budgetId" = p_budget_id
      AND bl."companyId" = p_company_id
      AND (
        (p_untagged AND bl."costCenterId" IS NULL)
        OR (NOT p_untagged AND p_cost_center_id IS NULL)
        OR (NOT p_untagged AND bl."costCenterId" IN (SELECT "id" FROM "costCenters"))
      )
    GROUP BY bl."accountId", p."periodNumber"
  ),
  "actualSide" AS (
    SELECT jl."accountId", p."periodNumber", SUM(jl."amount") AS "amount"
    FROM "journalLine" jl
    JOIN "journal" j ON j."id" = jl."journalId" AND j."companyId" = p_company_id
    JOIN "periods" p ON p."id" = j."accountingPeriodId"
    WHERE jl."companyId" = p_company_id
      AND jl."accountId" IS NOT NULL
      AND (
        (p_untagged AND NOT EXISTS (
          SELECT 1 FROM "journalLineDimension" jld
          WHERE jld."journalLineId" = jl."id"
            AND jld."dimensionId" = (SELECT "id" FROM "costCenterDim")
        ))
        OR (NOT p_untagged AND p_cost_center_id IS NULL)
        OR (NOT p_untagged AND EXISTS (
          SELECT 1 FROM "journalLineDimension" jld
          WHERE jld."journalLineId" = jl."id"
            AND jld."dimensionId" = (SELECT "id" FROM "costCenterDim")
            AND jld."valueId" IN (SELECT "id" FROM "costCenters")
        ))
      )
    GROUP BY jl."accountId", p."periodNumber"
  )
  SELECT
    a."id",
    a."number",
    a."name",
    a."class",
    a."incomeBalance",
    COALESCE(b."periodNumber", act."periodNumber"),
    COALESCE(b."amount", 0),
    COALESCE(act."amount", 0)
  FROM "budgetSide" b
  FULL OUTER JOIN "actualSide" act
    ON act."accountId" = b."accountId" AND act."periodNumber" = b."periodNumber"
  JOIN "account" a ON a."id" = COALESCE(b."accountId", act."accountId")
  ORDER BY a."number", COALESCE(b."periodNumber", act."periodNumber");
END;
$$;
```

2. Sanity-read the whole migration once against the spec's Data Model section.
3. Do NOT apply yet.

**✅ CHECKPOINT: commit** — `git add packages/database/supabase/migrations && git commit -m "feat(accounting): budgeting schema, copy/seed/report functions"`

---

## Task 3: Models — statuses + validators

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts`

**Steps:**

1. Next to `costCenterValidator` (line ~411), add:

```typescript
export const budgetStatusType = ["Draft", "Approved", "Archived"] as const;

export const budgetValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().optional()),
  fiscalYear: zfd.numeric(
    z.number().int().min(2000, { message: "Fiscal year is required" }).max(2200)
  ),
  source: z.enum(["none", "budget", "actuals"]).optional(),
  sourceBudgetId: zfd.text(z.string().optional()),
  sourceFiscalYear: zfd.numeric(z.number().int().optional()),
  adjustmentFactor: zfd.numeric(z.number().positive().optional()),
  spread: z.enum(["source", "even"]).optional()
});

export const budgetStatusTransitionValidator = z.object({
  intent: z.enum(["approve", "archive"])
});
```

(The `source*` fields only apply on create; the edit form hides them.)

---

## Task 4: Types — manual budget types

**Files:**
- Modify: `apps/erp/app/modules/accounting/types.ts`

**Steps:**

1. Below the `CostCenter` types (line ~46), add. These are hand-written because the tables are absent from the cloud-generated DB types:

```typescript
export type BudgetStatus = (typeof budgetStatusType)[number];

export type Budget = {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  fiscalYear: number;
  status: BudgetStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type BudgetLine = {
  id: string;
  companyId: string;
  budgetId: string;
  accountId: string;
  accountingPeriodId: string;
  costCenterId: string | null;
  amount: number;
};

export type BudgetVsActualRow = {
  accountId: string;
  number: string;
  name: string;
  class: string | null;
  incomeBalance: string | null;
  periodNumber: number;
  budget: number;
  actual: number;
};
```

2. Add `budgetStatusType` to this file's imports from `./accounting.models` (match the existing import style at the top of `types.ts`).

---

## Task 5: Services — budget CRUD, lines, RPC wrappers

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts`

**Steps:**

1. Below the cost-center functions (after `upsertCostCenter`, line ~935), add. All `budget`/`budgetLine`/RPC access is cast (`as any`) because the cloud-generated types don't include them:

```typescript
export async function deleteBudget(
  client: SupabaseClient<Database>,
  budgetId: string,
  companyId: string
) {
  return (client as any)
    .from("budget")
    .delete()
    .eq("id", budgetId)
    .eq("companyId", companyId)
    .eq("status", "Draft");
}

export async function getBudget(
  client: SupabaseClient<Database>,
  budgetId: string,
  companyId: string
): Promise<{ data: Budget | null; error: PostgrestError | null }> {
  return (client as any)
    .from("budget")
    .select("*")
    .eq("id", budgetId)
    .eq("companyId", companyId)
    .single();
}

export async function getBudgets(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = (client as any)
    .from("budget")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "fiscalYear", ascending: false },
      { column: "name", ascending: true }
    ]);
  }

  return query as unknown as Promise<{
    data: Budget[] | null;
    count: number | null;
    error: PostgrestError | null;
  }>;
}

export async function getBudgetsList(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{ data: Pick<Budget, "id" | "name" | "fiscalYear" | "status">[] | null; error: PostgrestError | null }> {
  return (client as any)
    .from("budget")
    .select("id, name, fiscalYear, status")
    .eq("companyId", companyId)
    .order("fiscalYear", { ascending: false })
    .order("name");
}

export async function upsertBudget(
  client: SupabaseClient<Database>,
  budget:
    | {
        name: string;
        description?: string;
        fiscalYear: number;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      }
    | {
        id: string;
        name: string;
        description?: string;
        fiscalYear: number;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      }
): Promise<{ data: { id: string } | null; error: PostgrestError | { message: string } | null }> {
  if ("createdBy" in budget) {
    // Ensure the fiscal year's periods exist before the matrix needs them.
    const periods = await (client as any)
      .from("accountingPeriod")
      .select("id")
      .eq("companyId", budget.companyId)
      .eq("fiscalYear", budget.fiscalYear)
      .limit(1);
    if (periods.error) return { data: null, error: periods.error };
    if (!periods.data || periods.data.length === 0) {
      const generated = await createFiscalYearPeriods(client, {
        companyId: budget.companyId,
        fiscalYear: budget.fiscalYear,
        userId: budget.createdBy
      });
      if (generated.error) return { data: null, error: generated.error };
    }

    return (client as any).from("budget").insert([budget]).select("id").single();
  }
  const { id, ...update } = budget;
  return (client as any)
    .from("budget")
    .update(sanitize(update))
    .eq("id", id)
    .eq("companyId", budget.companyId)
    .eq("status", "Draft")
    .select("id")
    .single();
}

export async function approveBudget(
  client: SupabaseClient<Database>,
  args: { budgetId: string; companyId: string; userId: string }
) {
  return (client as any)
    .from("budget")
    .update({
      status: "Approved",
      approvedBy: args.userId,
      approvedAt: new Date().toISOString(),
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.budgetId)
    .eq("companyId", args.companyId)
    .eq("status", "Draft")
    .select("id")
    .single();
}

export async function archiveBudget(
  client: SupabaseClient<Database>,
  args: { budgetId: string; companyId: string; userId: string }
) {
  return (client as any)
    .from("budget")
    .update({
      status: "Archived",
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.budgetId)
    .eq("companyId", args.companyId)
    .eq("status", "Approved")
    .select("id")
    .single();
}

export async function getBudgetLines(
  client: SupabaseClient<Database>,
  budgetId: string,
  companyId: string
): Promise<{ data: BudgetLine[] | null; error: PostgrestError | null }> {
  return (client as any)
    .from("budgetLine")
    .select("id, budgetId, companyId, accountId, accountingPeriodId, costCenterId, amount")
    .eq("budgetId", budgetId)
    .eq("companyId", companyId);
}

export async function copyBudgetLines(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    sourceBudgetId: string;
    targetBudgetId: string;
    adjustmentFactor: number;
    userId: string;
  }
) {
  return (client as any).rpc("copyBudgetLines", {
    p_company_id: args.companyId,
    p_source_budget_id: args.sourceBudgetId,
    p_target_budget_id: args.targetBudgetId,
    p_adjustment_factor: args.adjustmentFactor,
    p_created_by: args.userId
  });
}

export async function seedBudgetLinesFromActuals(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    sourceFiscalYear: number;
    targetBudgetId: string;
    adjustmentFactor: number;
    spread: "source" | "even";
    userId: string;
  }
) {
  return (client as any).rpc("seedBudgetLinesFromActuals", {
    p_company_id: args.companyId,
    p_source_fiscal_year: args.sourceFiscalYear,
    p_target_budget_id: args.targetBudgetId,
    p_adjustment_factor: args.adjustmentFactor,
    p_spread: args.spread,
    p_created_by: args.userId
  });
}

export async function getBudgetVsActual(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    budgetId: string;
    costCenterId?: string | null;
    rollup?: boolean;
    untagged?: boolean;
  }
): Promise<{ data: BudgetVsActualRow[] | null; error: PostgrestError | null }> {
  return (client as any).rpc("budgetVsActual", {
    p_company_id: args.companyId,
    p_budget_id: args.budgetId,
    p_cost_center_id: args.costCenterId ?? undefined,
    p_rollup: args.rollup ?? true,
    p_untagged: args.untagged ?? false
  });
}

export async function getAccountingPeriodsForFiscalYear(
  client: SupabaseClient<Database>,
  companyId: string,
  fiscalYear: number
): Promise<{
  data: { id: string; periodNumber: number; startDate: string; endDate: string }[] | null;
  error: PostgrestError | null;
}> {
  return (client as any)
    .from("accountingPeriod")
    .select("id, periodNumber, startDate, endDate")
    .eq("companyId", companyId)
    .eq("fiscalYear", fiscalYear)
    .order("periodNumber");
}
```

2. Add `Budget`, `BudgetLine`, `BudgetVsActualRow` to the file's type imports from `./types` (the file already imports types from there; match style). `createFiscalYearPeriods` is defined in this same file by the period-close plan (Task 4 there) — no import needed.

3. Verify:

```bash
pnpm --filter @carbon/erp typecheck 2>&1 | grep -i "budget" | head
# Expected: no errors mentioning budget files
```

---

## Task 6: path.ts — budget routes

**Files:**
- Modify: `apps/erp/app/utils/path.ts`

**Steps:**

1. In the app-routes block near `costCenters` (lines ~572–575), add alphabetically:

```typescript
budget: (id: string) => generatePath(`${x}/accounting/budgets/${id}`),
budgets: `${x}/accounting/budgets`,
budgetVsActual: `${x}/accounting/budget-vs-actual`,
```

2. Near `deleteCostCenter` (line ~690):

```typescript
deleteBudget: (id: string) =>
  generatePath(`${x}/accounting/budgets/delete/${id}`),
```

3. Near `newCostCenter` (line ~1183):

```typescript
newBudget: `${x}/accounting/budgets/new`,
```

4. Near the other edit/approve-style helpers (keep alphabetical placement within the object):

```typescript
approveBudget: (id: string) =>
  generatePath(`${x}/accounting/budgets/approve/${id}`),
editBudget: (id: string) =>
  generatePath(`${x}/accounting/budgets/edit/${id}`),
```

---

## Task 7: BudgetForm component

**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Budgets/BudgetForm.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Budgets/index.ts`

**Steps:**

1. `BudgetForm.tsx` — clone of `CostCenterForm.tsx` with the seed section. The budgets list for "copy from" comes from the list route's loader via `useRouteData`:

```typescript
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Hidden,
  Input,
  Number as NumberField,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { budgetValidator } from "../../accounting.models";
import type { Budget } from "../../types";

type BudgetFormProps = {
  initialValues: z.infer<typeof budgetValidator>;
  open?: boolean;
  onClose: () => void;
};

const BudgetForm = ({ initialValues, open = true, onClose }: BudgetFormProps) => {
  const permissions = usePermissions();
  const routeData = useRouteData<{ budgets: Budget[] }>(path.to.budgets);
  const budgets = routeData?.budgets ?? [];

  const isEditing = initialValues.id !== undefined;
  const [source, setSource] = useState<string>(initialValues.source ?? "none");
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={budgetValidator}
            method="post"
            action={
              isEditing
                ? path.to.editBudget(initialValues.id!)
                : path.to.newBudget
            }
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Budget
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <NumberField name="fiscalYear" label="Fiscal Year" />
                <TextArea name="description" label="Description" />
                {!isEditing && (
                  <>
                    <Select
                      name="source"
                      label="Start From"
                      options={[
                        { value: "none", label: "Empty budget" },
                        { value: "budget", label: "Copy another budget" },
                        { value: "actuals", label: "Prior-year actuals" }
                      ]}
                      onChange={(option) => setSource(option?.value ?? "none")}
                    />
                    {source === "budget" && (
                      <Select
                        name="sourceBudgetId"
                        label="Source Budget"
                        options={budgets.map((b) => ({
                          value: b.id,
                          label: `${b.name} (FY${b.fiscalYear})`
                        }))}
                      />
                    )}
                    {source === "actuals" && (
                      <NumberField
                        name="sourceFiscalYear"
                        label="Actuals From Fiscal Year"
                      />
                    )}
                    {source !== "none" && (
                      <>
                        <NumberField
                          name="adjustmentFactor"
                          label="Adjustment Factor"
                          helperText="1.05 = last year + 5%"
                        />
                        <Select
                          name="spread"
                          label="Spread"
                          options={[
                            { value: "source", label: "Match source periods" },
                            { value: "even", label: "Spread evenly" }
                          ]}
                        />
                      </>
                    )}
                  </>
                )}
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default BudgetForm;
```

Adjust the `Select`/`NumberField`/`TextArea` imports to the exact names exported from `~/components/Form` (check the barrel; e.g. the number input may be `Number`, `NumberInput`, or `NumberField`, and `helperText` may be `description` — mirror whatever `CostCenterForm`-adjacent forms use).

2. `index.ts`:

```typescript
import BudgetForm from "./BudgetForm";
import { BudgetMatrix } from "./BudgetMatrix";
import { BudgetsTable } from "./BudgetsTable";

export { BudgetForm, BudgetMatrix, BudgetsTable };
```

(`BudgetMatrix`/`BudgetsTable` are created in Tasks 8 and 11 — create the barrel now, it will typecheck after those land.)

---

## Task 8: BudgetsTable component

**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Budgets/BudgetsTable.tsx`

**Steps:**

1. Simple row list styled like `CostCentersListView` (header row + bordered rows + actions dropdown). Name navigates to the matrix:

```typescript
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import { Link } from "react-router";
import {
  LuArchive,
  LuCheck,
  LuEllipsisVertical,
  LuPencil,
  LuTrash2
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { Budget } from "../../types";

const statusVariant = (status: Budget["status"]) => {
  switch (status) {
    case "Approved":
      return "green";
    case "Archived":
      return "secondary";
    default:
      return "outline";
  }
};

export function BudgetsTable({
  budgets,
  onEdit,
  onDelete,
  onApprove
}: {
  budgets: Budget[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onApprove: (id: string) => void;
}) {
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "accounting");
  const canDelete = permissions.can("delete", "accounting");

  return (
    <div className="bg-card overflow-hidden h-full">
      <div className="grid grid-cols-[1fr_120px_120px_auto] items-center border-b border-border bg-card h-11 px-6 gap-3">
        <span className="text-sm font-medium text-foreground/80">Budget</span>
        <span className="text-sm font-medium text-foreground/80">
          Fiscal Year
        </span>
        <span className="text-sm font-medium text-foreground/80">Status</span>
        <span className="text-sm font-medium text-foreground/80">Actions</span>
      </div>
      {budgets.map((budget) => (
        <div
          key={budget.id}
          className="grid grid-cols-[1fr_120px_120px_auto] items-center gap-3 border-b border-border px-6 py-3 transition-colors hover:bg-accent/50"
        >
          <div className="flex flex-col gap-0 min-w-0">
            <Link
              to={path.to.budget(budget.id)}
              className="text-sm font-medium text-foreground hover:underline truncate"
            >
              {budget.name}
            </Link>
            {budget.description && (
              <span className="text-xs text-muted-foreground truncate">
                {budget.description}
              </span>
            )}
          </div>
          <span className="text-sm text-foreground">{budget.fiscalYear}</span>
          <div>
            <Badge variant={statusVariant(budget.status)}>{budget.status}</Badge>
          </div>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label="Actions"
                  icon={<LuEllipsisVertical />}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  disabled={budget.status !== "Draft" || !canUpdate}
                  onClick={() => onEdit(budget.id)}
                >
                  <LuPencil className="mr-2 size-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={budget.status !== "Draft" || !canUpdate}
                  onClick={() => onApprove(budget.id)}
                >
                  <LuCheck className="mr-2 size-4" />
                  Approve
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={budget.status !== "Approved" || !canUpdate}
                  onClick={() => onApprove(budget.id)}
                >
                  <LuArchive className="mr-2 size-4" />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={budget.status !== "Draft" || !canDelete}
                  onClick={() => onDelete(budget.id)}
                >
                  <LuTrash2 className="mr-2 size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ))}
      {budgets.length === 0 && (
        <div className="px-6 py-10 text-sm text-muted-foreground">
          No budgets yet. Create one to start planning.
        </div>
      )}
    </div>
  );
}
```

If `Badge` variants differ (check `packages/react` Badge variants), map to the nearest existing variants — do not invent new ones.

---

## Task 9: Routes — list + new

**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/budgets.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/budgets.new.tsx`

**Steps:**

1. `budgets.tsx` (clone of `cost-centers.tsx` shape):

```typescript
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Heading, HStack } from "@carbon/react";
import { useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { New } from "~/components";
import { getBudgets } from "~/modules/accounting";
import { BudgetsTable } from "~/modules/accounting/ui/Budgets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Budgets",
  to: path.to.budgets
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const budgets = await getBudgets(client, companyId);

  if (budgets.error) {
    throw redirect(
      path.to.accounting,
      await flash(request, error(budgets.error, "Failed to load budgets"))
    );
  }

  return {
    budgets: budgets.data ?? []
  };
}

export default function Route() {
  const { budgets } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const handleEdit = useCallback(
    (id: string) => navigate(path.to.editBudget(id)),
    [navigate]
  );
  const handleDelete = useCallback(
    (id: string) => navigate(path.to.deleteBudget(id)),
    [navigate]
  );
  const handleApprove = useCallback(
    (id: string) => navigate(path.to.approveBudget(id)),
    [navigate]
  );

  return (
    <div className="w-full">
      <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
        <Heading size="h3">Budgets</Heading>
        <HStack>
          <New label="Budget" to={path.to.newBudget} variant="primary" />
        </HStack>
      </div>
      <BudgetsTable
        budgets={budgets}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onApprove={handleApprove}
      />
      <Outlet />
    </div>
  );
}
```

2. `budgets.new.tsx` (clone of `cost-centers.new.tsx`; after header insert, run the optional seed and land on the matrix):

```typescript
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  budgetValidator,
  copyBudgetLines,
  seedBudgetLinesFromActuals,
  upsertBudget
} from "~/modules/accounting";
import { BudgetForm } from "~/modules/accounting/ui/Budgets";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(budgetValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id: _id,
    source,
    sourceBudgetId,
    sourceFiscalYear,
    adjustmentFactor,
    spread,
    ...d
  } = validation.data;

  const createBudget = await upsertBudget(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createBudget.error || !createBudget.data) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(createBudget.error, "Failed to create budget"))
    );
  }

  const budgetId = createBudget.data.id;

  if (source === "budget" && sourceBudgetId) {
    const copied = await copyBudgetLines(client, {
      companyId,
      sourceBudgetId,
      targetBudgetId: budgetId,
      adjustmentFactor: adjustmentFactor ?? 1,
      userId
    });
    if (copied.error) {
      throw redirect(
        path.to.budget(budgetId),
        await flash(request, error(copied.error, "Budget created, but copying lines failed"))
      );
    }
  }

  if (source === "actuals" && sourceFiscalYear) {
    const seeded = await seedBudgetLinesFromActuals(client, {
      companyId,
      sourceFiscalYear,
      targetBudgetId: budgetId,
      adjustmentFactor: adjustmentFactor ?? 1,
      spread: spread ?? "source",
      userId
    });
    if (seeded.error) {
      throw redirect(
        path.to.budget(budgetId),
        await flash(request, error(seeded.error, "Budget created, but seeding from actuals failed"))
      );
    }
  }

  throw redirect(
    path.to.budget(budgetId),
    await flash(request, success("Budget created"))
  );
}

export default function NewBudgetRoute() {
  const navigate = useNavigate();

  const initialValues = {
    name: "",
    fiscalYear: new Date().getFullYear() + 1,
    source: "none" as const
  };

  return (
    <BudgetForm onClose={() => navigate(-1)} initialValues={initialValues} />
  );
}
```

---

## Task 10: Routes — edit, delete, approve/archive

**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/budgets.edit.$budgetId.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/budgets.delete.$budgetId.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/budgets.approve.$budgetId.tsx`

**Steps:**

1. `budgets.edit.$budgetId.tsx` (clone of `cost-centers.$costCenterId.tsx`):

```typescript
import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { budgetValidator, getBudget, upsertBudget } from "~/modules/accounting";
import { BudgetForm } from "~/modules/accounting/ui/Budgets";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { budgetId } = params;
  if (!budgetId) throw notFound("Budget ID was not found");

  const budget = await getBudget(client, budgetId, companyId);
  if (budget.error || !budget.data) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(budget.error, "Failed to get budget"))
    );
  }

  return { budget: budget.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { budgetId } = params;
  if (!budgetId) throw notFound("Budget ID was not found");

  const formData = await request.formData();
  const validation = await validator(budgetValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, source, sourceBudgetId, sourceFiscalYear, adjustmentFactor, spread, ...d } =
    validation.data;

  const updateBudget = await upsertBudget(client, {
    id: budgetId,
    ...d,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateBudget.error) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(updateBudget.error, "Failed to update budget"))
    );
  }

  throw redirect(
    path.to.budgets,
    await flash(request, success("Budget updated"))
  );
}

export default function EditBudgetRoute() {
  const { budget } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: budget.id,
    name: budget.name,
    description: budget.description ?? undefined,
    fiscalYear: budget.fiscalYear
  };

  return (
    <BudgetForm
      onClose={() => navigate(-1)}
      key={initialValues.id}
      initialValues={initialValues}
    />
  );
}
```

2. `budgets.delete.$budgetId.tsx` (clone of `cost-centers.delete.$costCenterId.tsx` — loader fetches via `getBudget(client, budgetId, companyId)`, action requires `delete: "accounting"` and calls `deleteBudget(client, budgetId, companyId)`, component renders `ConfirmDelete` with `action={path.to.deleteBudget(budgetId)}`, `name={budget.name}`, text `Are you sure you want to delete the budget: ${budget.name}? This cannot be undone. Only Draft budgets can be deleted.`, cancel navigates to `path.to.budgets`).

3. `budgets.approve.$budgetId.tsx` — confirm modal driving approve OR archive by current status:

```typescript
import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { approveBudget, archiveBudget, getBudget } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { budgetId } = params;
  if (!budgetId) throw notFound("budgetId not found");

  const budget = await getBudget(client, budgetId, companyId);
  if (budget.error || !budget.data) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(budget.error, "Failed to get budget"))
    );
  }

  return { budget: budget.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { budgetId } = params;
  if (!budgetId) throw notFound("budgetId not found");

  const budget = await getBudget(client, budgetId, companyId);
  if (budget.error || !budget.data) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(budget.error, "Failed to get budget"))
    );
  }

  const transition =
    budget.data.status === "Draft"
      ? await approveBudget(client, { budgetId, companyId, userId })
      : await archiveBudget(client, { budgetId, companyId, userId });

  if (transition.error) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(transition.error, "Failed to update budget status"))
    );
  }

  throw redirect(
    path.to.budgets,
    await flash(
      request,
      success(
        budget.data.status === "Draft" ? "Budget approved" : "Budget archived"
      )
    )
  );
}

export default function ApproveBudgetRoute() {
  const { budgetId } = useParams();
  const { budget } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!budget || !budgetId) return null;

  const isDraft = budget.status === "Draft";

  return (
    <ConfirmDelete
      action={path.to.approveBudget(budgetId)}
      name={budget.name}
      text={
        isDraft
          ? `Approve the budget: ${budget.name}? Approved budgets are locked — revise by copying to a new draft.`
          : `Archive the budget: ${budget.name}?`
      }
      onCancel={() => navigate(path.to.budgets)}
    />
  );
}
```

If `ConfirmDelete` hardcodes destructive copy/styling, check `~/components/Modals` for a generic `Confirm` and use that instead — same props shape.

**✅ CHECKPOINT: commit** — models, types, services, paths, form, table, CRUD routes: `git add -A && git commit -m "feat(accounting): budget CRUD (models, services, routes, UI)"`

---

## Task 11: BudgetMatrix component

**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Budgets/BudgetMatrix.tsx`

**Steps:**

1. Grid = `Table/Thead/Tbody/Tr/Td` with `EditableNumberCell` per period cell, per the QuoteLinePricing precedent: optimistic local state keyed by cell, update-by-id / insert / delete-on-zero via the browser client (`useCarbon`), toast on failure. Amounts stored GL-signed; displayed natural per account class.

```typescript
import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Button,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { LuDownload, LuUpload } from "react-icons/lu";
import { EditableNumberCell } from "~/components/EditableNumberCell";
import { ImportCSVModal } from "~/components/ImportCSVModal";
import { path } from "~/utils/path";
import type { Budget, BudgetLine } from "../../types";

type MatrixAccount = {
  id: string;
  number: string | null;
  name: string | null;
  class: string | null;
  incomeBalance: string | null;
};

type MatrixPeriod = { id: string; periodNumber: number };

// GL-signed storage: debit-normal classes store entered value as-is;
// credit-normal classes store the negation. Display reverses it.
const isDebitNormal = (accountClass: string | null) =>
  accountClass === "Asset" || accountClass === "Expense";
const toStored = (value: number, accountClass: string | null) =>
  isDebitNormal(accountClass) ? value : -value;
const toDisplay = (amount: number, accountClass: string | null) =>
  isDebitNormal(accountClass) ? amount : -amount;

const cellKey = (accountId: string, periodId: string) =>
  `${accountId}:${periodId}`;

export function BudgetMatrix({
  budget,
  accounts,
  periods,
  lines,
  costCenters,
  companyId,
  userId
}: {
  budget: Budget;
  accounts: MatrixAccount[];
  periods: MatrixPeriod[];
  lines: BudgetLine[];
  costCenters: { id: string; name: string }[];
  companyId: string;
  userId: string;
}) {
  const { carbon } = useCarbon();
  const isEditable = budget.status === "Draft";

  // null = company-level cells
  const [costCenterId, setCostCenterId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [classFilter, setClassFilter] = useState<"Income Statement" | "All">(
    "Income Statement"
  );
  const [search, setSearch] = useState("");

  // cells for the active cost-center slice
  const [cells, setCells] = useState<
    Record<string, { id: string | null; amount: number }>
  >(() => buildCells(lines, null));

  function buildCells(all: BudgetLine[], cc: string | null) {
    const next: Record<string, { id: string | null; amount: number }> = {};
    for (const line of all) {
      if ((line.costCenterId ?? null) !== cc) continue;
      next[cellKey(line.accountId, line.accountingPeriodId)] = {
        id: line.id,
        amount: line.amount
      };
    }
    return next;
  }

  const [allLines, setAllLines] = useState<BudgetLine[]>(lines);

  const switchCostCenter = useCallback(
    (cc: string | null) => {
      setCostCenterId(cc);
      setCells(buildCells(allLines, cc));
    },
    [allLines]
  );

  const visibleAccounts = useMemo(
    () =>
      accounts.filter((a) => {
        if (classFilter === "Income Statement" && a.incomeBalance !== "Income Statement")
          return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          (a.number ?? "").toLowerCase().includes(q) ||
          (a.name ?? "").toLowerCase().includes(q)
        );
      }),
    [accounts, classFilter, search]
  );

  const writeCell = useCallback(
    async (account: MatrixAccount, periodId: string, displayValue: number) => {
      if (!carbon) return;
      const key = cellKey(account.id, periodId);
      const existing = cells[key];
      const stored = toStored(displayValue, account.class);

      // optimistic
      setCells((prev) => ({
        ...prev,
        [key]: { id: existing?.id ?? null, amount: stored }
      }));

      if (displayValue === 0 && existing?.id) {
        const del = await (carbon as any)
          .from("budgetLine")
          .delete()
          .eq("id", existing.id)
          .eq("companyId", companyId);
        if (del?.error) {
          toast.error("Failed to clear budget amount");
          setCells((prev) => ({ ...prev, [key]: existing }));
          return;
        }
        setCells((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setAllLines((prev) => prev.filter((l) => l.id !== existing.id));
        return;
      }

      if (existing?.id) {
        const update = await (carbon as any)
          .from("budgetLine")
          .update({
            amount: stored,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .eq("id", existing.id)
          .eq("companyId", companyId);
        if (update?.error) {
          toast.error("Failed to update budget amount");
          setCells((prev) => ({ ...prev, [key]: existing }));
        } else {
          setAllLines((prev) =>
            prev.map((l) => (l.id === existing.id ? { ...l, amount: stored } : l))
          );
        }
      } else if (displayValue !== 0) {
        const insert = await (carbon as any)
          .from("budgetLine")
          .insert({
            budgetId: budget.id,
            companyId,
            accountId: account.id,
            accountingPeriodId: periodId,
            costCenterId,
            amount: stored,
            createdBy: userId
          })
          .select("id")
          .single();
        if (insert?.error || !insert?.data) {
          toast.error("Failed to save budget amount");
          setCells((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        } else {
          const newLine: BudgetLine = {
            id: insert.data.id,
            companyId,
            budgetId: budget.id,
            accountId: account.id,
            accountingPeriodId: periodId,
            costCenterId,
            amount: stored
          };
          setCells((prev) => ({
            ...prev,
            [key]: { id: newLine.id, amount: stored }
          }));
          setAllLines((prev) => [...prev, newLine]);
        }
      }
    },
    [carbon, cells, companyId, userId, budget.id, costCenterId]
  );

  const fillRow = useCallback(
    (account: MatrixAccount) => {
      const first = cells[cellKey(account.id, periods[0]?.id ?? "")];
      if (!first) return;
      const displayValue = toDisplay(first.amount, account.class);
      for (const period of periods.slice(1)) {
        void writeCell(account, period.id, displayValue);
      }
    },
    [cells, periods, writeCell]
  );

  const distributeRow = useCallback(
    (account: MatrixAccount) => {
      const first = cells[cellKey(account.id, periods[0]?.id ?? "")];
      if (!first) return;
      const annual = toDisplay(first.amount, account.class);
      const per = Math.round((annual / periods.length) * 100) / 100;
      for (const period of periods) {
        void writeCell(account, period.id, per);
      }
    },
    [cells, periods, writeCell]
  );

  const exportCsv = useCallback(() => {
    const header = [
      "budget",
      "accountNumber",
      "costCenter",
      ...periods.map((p) => `period${p.periodNumber}`)
    ];
    const ccName = costCenters.find((c) => c.id === costCenterId)?.name ?? "";
    const rows = visibleAccounts
      .map((account) => {
        const values = periods.map((p) => {
          const cell = cells[cellKey(account.id, p.id)];
          return cell ? toDisplay(cell.amount, account.class) : "";
        });
        if (values.every((v) => v === "")) return null;
        return [budget.name, account.number ?? "", ccName, ...values];
      })
      .filter(Boolean) as (string | number)[][];
    const csv = [header, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${budget.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [budget.name, cells, costCenterId, costCenters, periods, visibleAccounts]);

  return (
    <div className="w-full">
      <div className="flex px-4 py-3 items-center gap-2 justify-between bg-card border-b border-border w-full flex-wrap">
        <HStack>
          <span className="text-sm font-medium">{budget.name}</span>
          <Badge variant={budget.status === "Approved" ? "green" : "outline"}>
            {budget.status}
          </Badge>
          <span className="text-sm text-muted-foreground">
            FY{budget.fiscalYear}
          </span>
        </HStack>
        <HStack>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={costCenterId ?? ""}
            onChange={(e) => switchCostCenter(e.target.value || null)}
          >
            <option value="">Company-level</option>
            {costCenters.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.name}
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={classFilter}
            onChange={(e) =>
              setClassFilter(e.target.value as "Income Statement" | "All")
            }
          >
            <option value="Income Statement">Income Statement</option>
            <option value="All">All Accounts</option>
          </select>
          <input
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            placeholder="Search accounts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            variant="secondary"
            leftIcon={<LuDownload />}
            onClick={exportCsv}
          >
            Export
          </Button>
          {isEditable && (
            <Button
              variant="secondary"
              leftIcon={<LuUpload />}
              onClick={() => setShowImport(true)}
            >
              Import
            </Button>
          )}
        </HStack>
      </div>

      {!isEditable && (
        <div className="px-4 py-2 text-sm bg-muted text-muted-foreground border-b border-border">
          This budget is {budget.status.toLowerCase()} and read-only. Copy it to
          a new draft from the <Link className="underline" to={path.to.newBudget}>New Budget</Link> form to revise.
        </div>
      )}

      <div className="overflow-auto">
        <Table>
          <Thead>
            <Tr>
              <Th className="w-[280px] sticky left-0 bg-card z-10">Account</Th>
              {periods.map((p) => (
                <Th key={p.id} className="text-right min-w-[110px]">
                  P{p.periodNumber}
                </Th>
              ))}
              <Th className="text-right min-w-[120px]">Total</Th>
              {isEditable && <Th className="w-[130px]" />}
            </Tr>
          </Thead>
          <Tbody>
            {visibleAccounts.map((account) => {
              const rowTotal = periods.reduce((sum, p) => {
                const cell = cells[cellKey(account.id, p.id)];
                return sum + (cell ? toDisplay(cell.amount, account.class) : 0);
              }, 0);
              return (
                <Tr key={account.id} className="group">
                  <Td className="sticky left-0 bg-card z-10 border-r border-border">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {account.number}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {account.name}
                      </span>
                    </div>
                  </Td>
                  {periods.map((p) => {
                    const cell = cells[cellKey(account.id, p.id)];
                    const display = cell
                      ? toDisplay(cell.amount, account.class)
                      : 0;
                    return (
                      <Td key={p.id} className="text-right group-hover:bg-muted/50">
                        <EditableNumberCell
                          value={display}
                          formatOptions={{
                            style: "decimal",
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          }}
                          isEditable={isEditable}
                          onChange={(value) =>
                            writeCell(account, p.id, value ?? 0)
                          }
                        />
                      </Td>
                    );
                  })}
                  <Td className="text-right font-medium tabular-nums">
                    {rowTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </Td>
                  {isEditable && (
                    <Td>
                      <HStack spacing={1}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => fillRow(account)}
                        >
                          Fill
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => distributeRow(account)}
                        >
                          ÷12
                        </Button>
                      </HStack>
                    </Td>
                  )}
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </div>

      {showImport && (
        <ImportCSVModal
          table="budgetLine"
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
```

2. Reconcile against the real precedents while implementing:
   - `EditableNumberCell` props: match its actual signature (`value`, `formatOptions`, `minValue`, `isEditable`, `onChange`) from `apps/erp/app/components/EditableNumberCell.tsx`.
   - `useCarbon` import: match wherever `QuoteLinePricing.tsx` gets its `carbon` client from.
   - `Button` `leftIcon` prop: match the real `@carbon/react` Button API.
   - Native `<select>`/`<input>` are acceptable here only if no lightweight `Select`/`SearchInput` exists outside form contexts — check `@carbon/react` `Select`/`Combobox` first and prefer it.
   - "Fill" reads P1 and copies it to P2..P12; "÷12" distributes P1's value as an annual figure. Both are client loops over `writeCell` (sequential awaits are fine at 11–12 requests).

---

## Task 12: Route — matrix page

**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/budgets_.$budgetId.tsx`

The trailing underscore (`budgets_`) opts out of nesting inside `budgets.tsx` (remix-flat-routes), making the matrix a full page at `/x/accounting/budgets/:budgetId`.

**Steps:**

1. Create:

```typescript
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getAccountingPeriodsForFiscalYear,
  getBudget,
  getBudgetLines,
  getCostCentersList
} from "~/modules/accounting";
import { BudgetMatrix } from "~/modules/accounting/ui/Budgets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Budgets",
  to: path.to.budgets
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId, userId } = await requirePermissions(
    request,
    {
      view: "accounting",
      role: "employee"
    }
  );

  const { budgetId } = params;
  if (!budgetId) throw notFound("Budget ID was not found");

  const budget = await getBudget(client, budgetId, companyId);
  if (budget.error || !budget.data) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(budget.error, "Failed to get budget"))
    );
  }

  const [accounts, periods, lines, costCenters] = await Promise.all([
    client
      .from("accounts")
      .select("id, number, name, class, incomeBalance")
      .eq("companyGroupId", companyGroupId)
      .eq("active", true)
      .eq("directPosting", true)
      .order("number", { ascending: true }),
    getAccountingPeriodsForFiscalYear(client, companyId, budget.data.fiscalYear),
    getBudgetLines(client, budgetId, companyId),
    getCostCentersList(client, companyId)
  ]);

  if (accounts.error) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(accounts.error, "Failed to load accounts"))
    );
  }
  if (periods.error || !periods.data || periods.data.length === 0) {
    throw redirect(
      path.to.budgets,
      await flash(
        request,
        error(
          periods.error,
          `No accounting periods exist for fiscal year ${budget.data.fiscalYear}`
        )
      )
    );
  }

  return {
    budget: budget.data,
    accounts: (accounts.data ?? []).filter((a) => a.id !== null),
    periods: periods.data,
    lines: lines.data ?? [],
    costCenters: costCenters.data ?? [],
    companyId,
    userId
  };
}

export default function BudgetMatrixRoute() {
  const { budget, accounts, periods, lines, costCenters, companyId, userId } =
    useLoaderData<typeof loader>();

  return (
    <BudgetMatrix
      budget={budget}
      accounts={accounts as any}
      periods={periods}
      lines={lines}
      costCenters={costCenters}
      companyId={companyId}
      userId={userId}
    />
  );
}
```

2. Verify the `accounts` view exposes `directPosting` and `companyGroupId` (it selects `account.*` plus category names — check the newest `accounts` view migration). If not, query the `account` table directly with the same columns plus `.eq("companyId", companyId)`.

---

## Task 13: Budget vs Actual report

**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/budget-vs-actual.tsx`

**Steps:**

1. Create (loader shape below is complete; match the header/filter JSX classNames to `trial-balance.tsx` — read that file first and mirror its layout primitives):

```typescript
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Badge, Heading, HStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import {
  redirect,
  useLoaderData,
  useNavigate,
  useSearchParams
} from "react-router";
import {
  getBudgetsList,
  getBudgetVsActual,
  getCostCentersList
} from "~/modules/accounting";
import type { BudgetVsActualRow } from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Budget vs Actual",
  to: path.to.budgetVsActual
};

const isDebitNormal = (accountClass: string | null) =>
  accountClass === "Asset" || accountClass === "Expense";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const budgetId = url.searchParams.get("budgetId");
  const costCenterId = url.searchParams.get("costCenterId");
  const fromPeriod = Number(url.searchParams.get("from") ?? 1);
  const toPeriod = Number(url.searchParams.get("to") ?? 12);

  const [budgets, costCenters] = await Promise.all([
    getBudgetsList(client, companyId),
    getCostCentersList(client, companyId)
  ]);

  if (budgets.error) {
    throw redirect(
      path.to.accounting,
      await flash(request, error(budgets.error, "Failed to load budgets"))
    );
  }

  // Default to the most recently approved budget, else the first budget.
  const defaultBudget =
    budgets.data?.find((b) => b.status === "Approved") ?? budgets.data?.[0];
  const selectedBudgetId = budgetId ?? defaultBudget?.id ?? null;

  let rows: BudgetVsActualRow[] = [];
  let untaggedActual = 0;

  if (selectedBudgetId) {
    const result = await getBudgetVsActual(client, {
      companyId,
      budgetId: selectedBudgetId,
      costCenterId,
      rollup: true
    });
    if (result.error) {
      throw redirect(
        path.to.accounting,
        await flash(request, error(result.error, "Failed to load budget vs actual"))
      );
    }
    rows = (result.data ?? []).filter(
      (r) => r.periodNumber >= fromPeriod && r.periodNumber <= toPeriod
    );

    if (costCenterId) {
      const untagged = await getBudgetVsActual(client, {
        companyId,
        budgetId: selectedBudgetId,
        untagged: true
      });
      untaggedActual = (untagged.data ?? [])
        .filter((r) => r.periodNumber >= fromPeriod && r.periodNumber <= toPeriod)
        .reduce((sum, r) => sum + r.actual, 0);
    }
  }

  // Aggregate per account over the period range, natural-signed per class.
  const byAccount = new Map<
    string,
    { number: string; name: string; class: string | null; budget: number; actual: number }
  >();
  for (const row of rows) {
    const sign = isDebitNormal(row.class) ? 1 : -1;
    const entry = byAccount.get(row.accountId) ?? {
      number: row.number,
      name: row.name,
      class: row.class,
      budget: 0,
      actual: 0
    };
    entry.budget += sign * row.budget;
    entry.actual += sign * row.actual;
    byAccount.set(row.accountId, entry);
  }

  return {
    budgets: budgets.data ?? [],
    costCenters: costCenters.data ?? [],
    selectedBudgetId,
    costCenterId,
    fromPeriod,
    toPeriod,
    untaggedActual,
    accounts: Array.from(byAccount.entries()).map(([accountId, v]) => ({
      accountId,
      ...v,
      variance: v.actual - v.budget,
      variancePercent: v.budget !== 0 ? ((v.actual - v.budget) / Math.abs(v.budget)) * 100 : null
    }))
  };
}

export default function BudgetVsActualRoute() {
  const {
    budgets,
    costCenters,
    selectedBudgetId,
    costCenterId,
    fromPeriod,
    toPeriod,
    untaggedActual,
    accounts
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const format = (n: number) =>
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  return (
    <div className="w-full">
      <div className="flex px-4 py-3 items-center gap-2 justify-between bg-card border-b border-border w-full flex-wrap">
        <Heading size="h3">Budget vs Actual</Heading>
        <HStack>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={selectedBudgetId ?? ""}
            onChange={(e) => setParam("budgetId", e.target.value)}
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} (FY{b.fiscalYear}
                {b.status === "Approved" ? ", approved" : ""})
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={costCenterId ?? ""}
            onChange={(e) => setParam("costCenterId", e.target.value)}
          >
            <option value="">All cost centers</option>
            {costCenters.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.name}
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={String(fromPeriod)}
            onChange={(e) => setParam("from", e.target.value)}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>
                From P{p}
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={String(toPeriod)}
            onChange={(e) => setParam("to", e.target.value)}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>
                To P{p}
              </option>
            ))}
          </select>
        </HStack>
      </div>

      {costCenterId && untaggedActual !== 0 && (
        <div className="px-4 py-2 text-sm bg-muted text-muted-foreground border-b border-border">
          {format(Math.abs(untaggedActual))} of actuals in this range are not
          tagged to any cost center and are excluded from this view.
        </div>
      )}

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border h-11">
              <th className="text-left px-6 font-medium text-foreground/80">
                Account
              </th>
              <th className="text-right px-6 font-medium text-foreground/80">
                Budget
              </th>
              <th className="text-right px-6 font-medium text-foreground/80">
                Actual
              </th>
              <th className="text-right px-6 font-medium text-foreground/80">
                Variance
              </th>
              <th className="text-right px-6 font-medium text-foreground/80">
                Variance %
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr
                key={a.accountId}
                className="border-b border-border hover:bg-accent/50"
              >
                <td className="px-6 py-2">
                  <span className="font-medium">{a.number}</span>{" "}
                  <span className="text-muted-foreground">{a.name}</span>
                </td>
                <td className="px-6 py-2 text-right tabular-nums">
                  {format(a.budget)}
                </td>
                <td className="px-6 py-2 text-right tabular-nums">
                  {format(a.actual)}
                </td>
                <td
                  className={`px-6 py-2 text-right tabular-nums ${
                    a.variance > 0 ? "text-destructive" : ""
                  }`}
                >
                  {format(a.variance)}
                </td>
                <td className="px-6 py-2 text-right tabular-nums">
                  {a.variancePercent === null ? (
                    <Badge variant="outline">No budget</Badge>
                  ) : (
                    `${a.variancePercent.toFixed(1)}%`
                  )}
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-10 text-muted-foreground text-sm"
                >
                  No data for this selection.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Note: "Variance > 0 = over budget" holds for expense accounts in natural sign; for revenue accounts a positive variance means beating plan — refine the color rule to `class === "Expense" && variance > 0` if the simple rule reads wrong during review.

---

## Task 14: Sidebar — accounting submodules

**Files:**
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx`

**Steps:**

1. Add to the **Reports** group (after Trial Balance):

```typescript
{
  name: t`Budget vs Actual`,
  to: path.to.budgetVsActual,
  role: "employee",
  icon: <LuTarget />
},
```

2. Add to the **General Ledger** group (next to Journal Entries):

```typescript
{
  name: t`Budgets`,
  to: path.to.budgets,
  role: "employee",
  icon: <LuWallet />
},
```

3. Add `LuTarget` and `LuWallet` to the `react-icons/lu` import list (pick different Lu icons if these collide with existing entries' style).

**✅ CHECKPOINT: commit** — `git add -A && git commit -m "feat(accounting): budget matrix, budget vs actual report, sidebar"`

---

## Task 15: CSV import — budgetLine

Wide format: one row per account (× cost center), one column per period. Columns: `budget` (enum → budget), `accountNumber`, `costCenter` (optional enum), `period1`…`period12`.

**Files:**
- Modify: `apps/erp/app/modules/shared/imports.models.ts`
- Modify: `packages/database/supabase/functions/import-csv/index.ts`

**Steps:**

1. In `imports.models.ts`, add to `fieldMappings` (mirror the `workCenter` entry's exact shape, ~line 1401):

```typescript
budgetLine: {
  budget: {
    label: "Budget",
    required: true,
    type: "enum",
    enumData: {
      description: "The budget to import lines into (must be Draft)",
      fetcher: async (client, companyId) => {
        return (client as any)
          .from("budget")
          .select("id, name")
          .eq("companyId", companyId)
          .eq("status", "Draft")
          .order("name");
      }
    }
  },
  accountNumber: { label: "Account Number", required: true, type: "string" },
  costCenter: {
    label: "Cost Center",
    required: false,
    type: "enum",
    enumData: {
      description: "Optional cost center for these amounts",
      fetcher: async (client, companyId) => {
        return client
          .from("costCenter")
          .select("id, name")
          .eq("companyId", companyId)
          .order("name");
      }
    }
  },
  period1: { label: "Period 1", required: false, type: "number" },
  period2: { label: "Period 2", required: false, type: "number" },
  period3: { label: "Period 3", required: false, type: "number" },
  period4: { label: "Period 4", required: false, type: "number" },
  period5: { label: "Period 5", required: false, type: "number" },
  period6: { label: "Period 6", required: false, type: "number" },
  period7: { label: "Period 7", required: false, type: "number" },
  period8: { label: "Period 8", required: false, type: "number" },
  period9: { label: "Period 9", required: false, type: "number" },
  period10: { label: "Period 10", required: false, type: "number" },
  period11: { label: "Period 11", required: false, type: "number" },
  period12: { label: "Period 12", required: false, type: "number" }
},
```

2. Add `budgetLine: "accounting"` to `importPermissions` (~line 1589).

3. Add a `budgetLine` entry to `importSchemas` (~line 1654) mirroring the exact zod shape of the `workCenter` entry (column-name strings per field; `budget` and `accountNumber` required, the rest optional).

4. In the edge function, add `"budgetLine"` to the table enum (line ~18–32).

5. Add the case block in the switch (following the `workCenter` block's structure, but resolving references and upserting by cell key — no externalIdMap):

```typescript
case "budgetLine": {
  // Resolve referenced entities once.
  const budgetIds = new Set(
    mappedRecords.map((r) => r.budget).filter(Boolean)
  );
  const budgets = await trx
    .selectFrom("budget" as any)
    .select(["id", "fiscalYear", "status"] as any)
    .where("companyId", "=", companyId)
    .where("id", "in", [...budgetIds])
    .execute();
  const budgetById = new Map(budgets.map((b: any) => [b.id, b]));

  const accountNumbers = new Set(
    mappedRecords.map((r) => r.accountNumber?.trim()).filter(Boolean)
  );
  const accounts = await trx
    .selectFrom("account")
    .select(["id", "number"])
    .where("companyId", "=", companyId)
    .where("number", "in", [...accountNumbers])
    .execute();
  const accountByNumber = new Map(accounts.map((a) => [a.number, a.id]));

  const fiscalYears = new Set(
    [...budgetById.values()].map((b: any) => b.fiscalYear)
  );
  const periods = await trx
    .selectFrom("accountingPeriod" as any)
    .select(["id", "fiscalYear", "periodNumber"] as any)
    .where("companyId", "=", companyId)
    .where("fiscalYear", "in", [...fiscalYears])
    .execute();
  const periodByYearAndNumber = new Map(
    periods.map((p: any) => [`${p.fiscalYear}:${p.periodNumber}`, p.id])
  );

  let rowIndex = 0;
  for (const record of mappedRecords) {
    rowIndex++;
    const budget = budgetById.get(record.budget) as any;
    if (!budget) {
      summary.errors.push({ row: rowIndex, reason: "Unknown budget" });
      continue;
    }
    if (budget.status !== "Draft") {
      summary.errors.push({
        row: rowIndex,
        reason: `Budget is ${budget.status} — only Draft budgets can be imported into`
      });
      continue;
    }
    const accountId = accountByNumber.get(record.accountNumber?.trim());
    if (!accountId) {
      summary.errors.push({
        row: rowIndex,
        reason: `Unknown account number: ${record.accountNumber}`
      });
      continue;
    }
    const costCenterId = record.costCenter || null;

    for (let periodNumber = 1; periodNumber <= 12; periodNumber++) {
      const raw = record[`period${periodNumber}`];
      if (raw === undefined || raw === null || String(raw).trim() === "") {
        continue;
      }
      const amount = parseFloat(String(raw).replace(/[$,]/g, ""));
      if (Number.isNaN(amount)) {
        summary.errors.push({
          row: rowIndex,
          reason: `Invalid amount in period ${periodNumber}: ${raw}`
        });
        continue;
      }
      const accountingPeriodId = periodByYearAndNumber.get(
        `${budget.fiscalYear}:${periodNumber}`
      );
      if (!accountingPeriodId) {
        summary.errors.push({
          row: rowIndex,
          reason: `No accounting period ${periodNumber} for fiscal year ${budget.fiscalYear}`
        });
        continue;
      }

      await trx
        .insertInto("budgetLine" as any)
        .values({
          budgetId: budget.id,
          companyId,
          accountId,
          accountingPeriodId,
          costCenterId,
          amount,
          createdBy: userId,
          createdAt: new Date().toISOString()
        } as any)
        .onConflict((oc: any) =>
          oc.constraint("budgetLine_cell_key").doUpdateSet({
            amount,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
        )
        .execute();
      summary.inserted++;
    }
  }
  break;
}
```

Adapt variable names (`mappedRecords`, `summary`, `trx`, `companyId`, `userId`) to the exact identifiers in scope in the switch — read the neighboring `workCenter` case first. Note: imported amounts are **GL-signed as stored** (the exported CSV round-trips natural values for display but the export writes natural sign — reconcile by documenting that import expects the same natural sign as export produces and applying the class-based sign flip: resolve each account's `class` in the account query above, then store `isDebitNormal ? amount : -amount` exactly like the matrix. Add `"class"` to the account select and apply the flip.)

6. Enum note: the CSV enum-mapping UI maps CSV values → ids via `enumMappings`, so `record.budget` / `record.costCenter` arrive as ids — verify against how the `workCenter` case treats its `locationId` enum field and match.

**✅ CHECKPOINT: commit** — `git add -A && git commit -m "feat(accounting): budget line CSV import"`

---

## Task 16: Apply migration + SQL smoke test (requires local stack)

**Steps:**

1. With the local stack up (`crbn up` — user runs this; do not rebuild anything):

```bash
pnpm db:migrate
# Expected: applies 20260702044133_period-close-lifecycle.sql (if pending) and the budgeting migration without error
```

2. Smoke-test in psql (get the port from `.env.local` `PORT_DB`):

```sql
-- Draft-only trigger: create a budget, approve it, try to write a line
INSERT INTO "budget" ("companyId", "name", "fiscalYear", "createdBy")
VALUES ('<companyId>', 'Trigger Test', 2027, '<userId>') RETURNING "id";
-- write a line while Draft: should succeed (needs a real accountId + accountingPeriodId)
UPDATE "budget" SET "status" = 'Approved' WHERE "name" = 'Trigger Test';
-- write a line now: should fail with 'Budget is Approved — copy it to a new draft to revise'
-- cleanup
DELETE FROM "budget" WHERE "name" = 'Trigger Test';
```

3. Verify the cell-uniqueness constraint treats NULL cost centers as equal:

```sql
-- two inserts with the same (budget, account, period, NULL) → second must fail
```

4. Do NOT run `pnpm db:types` and do NOT commit any types.ts changes.

---

## Task 17: Typecheck, lint, AGENTS.md

**Files:**
- Modify: `apps/erp/app/modules/accounting/AGENTS.md` (if the module has one — check; otherwise the root accounting docs reference)

**Steps:**

1. Verify:

```bash
pnpm --filter @carbon/erp typecheck
# Expected: passes (pre-existing errors unrelated to budget files are acceptable — compare against main)
pnpm run lint
# Expected: no new Biome errors in touched files
```

2. Update `modules/accounting` AGENTS.md: add the new service functions (`getBudgets`, `getBudget`, `getBudgetsList`, `upsertBudget`, `approveBudget`, `archiveBudget`, `deleteBudget`, `getBudgetLines`, `copyBudgetLines`, `seedBudgetLinesFromActuals`, `getBudgetVsActual`, `getAccountingPeriodsForFiscalYear`), the two tables, the `budgetVsActual`/`copyBudgetLines`/`seedBudgetLinesFromActuals` RPCs, and the routes.

3. Product docs (`docs/content/` Accounting → Budgets page + glossary) are written when the feature ships to users — track as a follow-up, not part of this branch's gate.

**✅ FINAL CHECKPOINT: commit** — `git add -A && git commit -m "feat(accounting): budgeting phase 1 — verification + docs"`

---

## Post-plan verification (acceptance criteria spot-checks)

With the stack up and migration applied, walk the Phase 1 acceptance criteria from the spec:

1. Create "2027 Plan" (FY2027) → periods auto-created, budget appears, matrix opens with 12 period columns.
2. Enter 5,000 in P1 for an expense account → Fill and ÷12 behave; reload persists; zeroing a cell deletes its row (check `budgetLine` count).
3. Switch cost center to a real cost center → cells are a separate slice; company-level cells unchanged.
4. New budget "2027 Stretch" copying "2027 Plan" ×1.1 → lines equal source × 1.1.
5. Seed from FY2026 actuals (requires posted journals locally; enable accounting per `.ai/` memory: `/x/settings/accounting`) → lines match `journalLine` aggregates.
6. Approve "2027 Plan" → matrix read-only; SQL insert on its lines fails.
7. Budget vs Actual → Actual ties to trial balance for the same range; cost-center filter + untagged banner behave.
8. Export CSV from the matrix → edit a value → import through the modal → cell updated.

UI verification per house rules: boot with `crbn up`, verify via agent-browser before calling Phase 1 done.
