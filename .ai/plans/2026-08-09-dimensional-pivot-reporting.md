# Dimensional Pivot Reporting — implementation plan

**Spec:** .ai/specs/2026-08-09-dimensional-pivot-reporting.md
**Research:** .ai/research/dimensional-pivot-reporting.md
**Branch:** financial-reports-module

## Progress
- [x] Task 1: Write the migration (reportView + indexes + 2 RPCs + reportPin key migration)
- [x] Task 2: Validate the migration in a rolled-back transaction with fixtures
- [x] Task 3: Apply migration and regenerate DB types
- [x] Task 4: Add the analytics registry + pivot validators to accounting.models.ts
- [x] Task 5: Add pivot + reportView service functions to accounting.service.ts
- [x] Task 6: Build pivotTree.ts (pure pivot assembly) + unit tests
- [x] Task 7: Build PivotControlBar + SaveViewModal components
- [x] Task 8: Build PivotTree component + PivotLinesDrawer
- [x] Task 9: Add analytics routes + path helpers
- [x] Task 10: Redirect old reports, update hub cards, remove dead code
- [x] Task 11: i18n extract + lint + scoped typecheck gate (hi/tr/ko translations deferred per Brad)
- [ ] Task 12: Browser verification via /test (Brad is handling this)

## Dependencies
- Task 2 needs Task 1; Task 3 needs Task 2.
- Task 4 needs Task 3 (generated types for enums used in validators).
- Tasks 5 and 6 both need Task 4 and are independent of each other (parallelizable).
- Task 7 needs Task 4; Task 8 needs Tasks 4+6. Tasks 7 and 8 are independent of each other.
- Task 9 needs Tasks 5, 7, 8. Task 10 needs Task 9. Task 11 needs Task 10. Task 12 last.

## Context every executor must read first

- Spec: `.ai/specs/2026-08-09-dimensional-pivot-reporting.md` (design + acceptance criteria)
- `.claude/rules/workflow-database-migration.md`, `.claude/rules/conventions-database.md` (Task 1)
- `.claude/rules/conventions-services.md` (Task 5), `.claude/rules/conventions-forms.md` (Task 7)
- `apps/erp/app/modules/accounting/AGENTS.md`
- Key facts:
  - `journalLine.amount` is stored **natural-signed**: positive moves the account
    toward its natural balance (positive on a Revenue account = more revenue).
    See `.ai/lessons.md` "Journal debit/credit is derived from account class".
  - Dimensions: `dimension` (per `companyGroupId`, has `entityType`), tags in
    `journalLineDimension(journalLineId, dimensionId, valueId, companyId)`.
  - `journalLines` view = `journalLine` ⨝ `journal` (adds `postingDate`,
    `journalEntryId`, `status`) and already excludes Draft; RPCs below join the
    base tables directly like `accountTreeBalancePeriodSeries` does.
  - Period buckets come only from `computeReportPeriodBuckets` in `@carbon/utils`.

---

## Task 1: Write the migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_dimensional-pivot-reporting.sql` (via `pnpm db:migrate:new dimensional-pivot-reporting` — never hand-pick the timestamp)
- Copy from (precedent): `packages/database/supabase/migrations/20260809151458_balance-rpc-period-series.sql` (RPC style/header), `packages/database/supabase/migrations/20260809161618_report-pins.sql` (report-table RLS style)

**Steps:**

1. Run `pnpm db:migrate:new dimensional-pivot-reporting`. Put all SQL below in
   the generated file. Every statement must be idempotent (guards shown).

2. Enum + `reportView` table + RLS:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reportViewVisibility') THEN
    CREATE TYPE "reportViewVisibility" AS ENUM ('Private', 'Company');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "reportView" (
    "id" TEXT NOT NULL DEFAULT id('rv'),
    "companyId" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "visibility" "reportViewVisibility" NOT NULL DEFAULT 'Private',
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "reportView_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "reportView_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reportView_name_unique" UNIQUE ("companyId", "reportKey", "name")
);

CREATE INDEX IF NOT EXISTS "reportView_companyId_idx" ON "reportView" ("companyId");
CREATE INDEX IF NOT EXISTS "reportView_createdBy_idx" ON "reportView" ("createdBy");

ALTER TABLE "reportView" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "reportView";
CREATE POLICY "SELECT" ON "reportView" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND ("visibility" = 'Company' OR "createdBy" = (SELECT auth.uid())::text)
);
DROP POLICY IF EXISTS "INSERT" ON "reportView";
CREATE POLICY "INSERT" ON "reportView" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND "createdBy" = (SELECT auth.uid())::text
);
DROP POLICY IF EXISTS "UPDATE" ON "reportView";
CREATE POLICY "UPDATE" ON "reportView" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND "createdBy" = (SELECT auth.uid())::text
);
DROP POLICY IF EXISTS "DELETE" ON "reportView";
CREATE POLICY "DELETE" ON "reportView" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND "createdBy" = (SELECT auth.uid())::text
);
```

3. Aggregation indexes on `journalLineDimension`. First grep existing indexes
   (`grep -rn 'journalLineDimension' packages/database/supabase/migrations/ | grep -i 'index'`);
   add only what's missing:

```sql
CREATE INDEX IF NOT EXISTS "journalLineDimension_line_dimension_idx"
  ON "journalLineDimension" ("journalLineId", "dimensionId");
CREATE INDEX IF NOT EXISTS "journalLineDimension_company_dimension_value_idx"
  ON "journalLineDimension" ("companyId", "dimensionId", "valueId", "journalLineId");
```

4. The pivot RPC. plpgsql (never `LANGUAGE sql` — planner inlining drops
   ordering; see `.ai/lessons.md`), SECURITY INVOKER, mirroring the sibling
   RPC's header-comment style. Contract notes to include in the SQL comment:
   p_period_ends comes from `computeReportPeriodBuckets` (sorted ascending,
   distinct, max == p_end); exactly one account-scope param is non-null;
   p_column_dimension and p_period_ends are mutually exclusive; NULL
   rowValue/columnKey means Unassigned; app re-sorts (never trust RPC order).

```sql
DROP FUNCTION IF EXISTS "journalDimensionPivot";
CREATE OR REPLACE FUNCTION "journalDimensionPivot" (
  p_company_group_id TEXT,
  p_company_id TEXT,
  p_start DATE,
  p_end DATE,
  p_account_classes TEXT[] DEFAULT NULL,
  p_account_types TEXT[] DEFAULT NULL,
  p_account_ids TEXT[] DEFAULT NULL,
  p_row_dimension_1 TEXT DEFAULT NULL,
  p_row_dimension_2 TEXT DEFAULT NULL,
  p_column_dimension TEXT DEFAULT NULL,
  p_period_ends DATE[] DEFAULT NULL,
  p_filters JSONB DEFAULT NULL,
  p_group_limit INT DEFAULT 1000
)
RETURNS TABLE (
  "rowValue1Id" TEXT,
  "rowValue2Id" TEXT,
  "columnKey" TEXT,
  "amount" NUMERIC,
  "quantity" NUMERIC,
  "lineCount" BIGINT,
  "hasMore" BOOLEAN
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'journalDimensionPivot requires p_company_id';
  END IF;
  IF p_account_classes IS NULL AND p_account_types IS NULL AND p_account_ids IS NULL THEN
    RAISE EXCEPTION 'journalDimensionPivot requires an account scope';
  END IF;
  IF p_column_dimension IS NOT NULL AND p_period_ends IS NOT NULL THEN
    RAISE EXCEPTION 'journalDimensionPivot: column axis is a dimension OR period ends, not both';
  END IF;

  RETURN QUERY
  WITH "scopedLines" AS (
    SELECT jl."id" AS "lineId", jl."amount" AS "lineAmount",
           COALESCE(jl."quantity", 0) AS "lineQuantity", j."postingDate"
    FROM "journal" j
    INNER JOIN "journalLine" jl ON jl."journalId" = j."id"
    INNER JOIN "account" a
      ON a."id" = jl."accountId" AND a."companyGroupId" = p_company_group_id
    WHERE j."companyId" = p_company_id
      AND jl."companyId" = p_company_id
      AND j."status" <> 'Draft'
      AND j."postingDate" >= p_start
      AND j."postingDate" <= p_end
      AND (
        (p_account_ids IS NOT NULL AND jl."accountId" = ANY(p_account_ids))
        OR (p_account_types IS NOT NULL AND a."accountType"::TEXT = ANY(p_account_types))
        OR (p_account_classes IS NOT NULL AND a."class"::TEXT = ANY(p_account_classes))
      )
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_filters, '[]'::jsonb)) AS f
        WHERE NOT EXISTS (
          SELECT 1 FROM "journalLineDimension" fd
          WHERE fd."journalLineId" = jl."id"
            AND fd."companyId" = p_company_id
            AND fd."dimensionId" = f->>'dimensionId'
            AND fd."valueId" IN (SELECT jsonb_array_elements_text(f->'valueIds'))
        )
      )
  ),
  "taggedLines" AS (
    SELECT
      sl."lineId", sl."lineAmount", sl."lineQuantity",
      d1."valueId" AS "r1",
      d2."valueId" AS "r2",
      CASE
        WHEN p_column_dimension IS NOT NULL THEN dc."valueId"
        WHEN p_period_ends IS NOT NULL THEN (
          SELECT MIN(pe)::TEXT FROM unnest(p_period_ends) pe
          WHERE pe >= sl."postingDate"
        )
        ELSE 'total'
      END AS "colKey"
    FROM "scopedLines" sl
    LEFT JOIN "journalLineDimension" d1
      ON p_row_dimension_1 IS NOT NULL
      AND d1."journalLineId" = sl."lineId"
      AND d1."companyId" = p_company_id
      AND d1."dimensionId" = p_row_dimension_1
    LEFT JOIN "journalLineDimension" d2
      ON p_row_dimension_2 IS NOT NULL
      AND d2."journalLineId" = sl."lineId"
      AND d2."companyId" = p_company_id
      AND d2."dimensionId" = p_row_dimension_2
    LEFT JOIN "journalLineDimension" dc
      ON p_column_dimension IS NOT NULL
      AND dc."journalLineId" = sl."lineId"
      AND dc."companyId" = p_company_id
      AND dc."dimensionId" = p_column_dimension
  ),
  "rowGroups" AS (
    SELECT tl."r1", tl."r2",
           ROW_NUMBER() OVER (ORDER BY ABS(SUM(tl."lineAmount")) DESC NULLS LAST) AS rn,
           COUNT(*) OVER () AS "totalGroups"
    FROM "taggedLines" tl
    GROUP BY tl."r1", tl."r2"
  ),
  "keptGroups" AS (
    SELECT rg."r1", rg."r2", rg."totalGroups"
    FROM "rowGroups" rg
    WHERE rg.rn <= p_group_limit
  )
  SELECT
    tl."r1" AS "rowValue1Id",
    tl."r2" AS "rowValue2Id",
    tl."colKey" AS "columnKey",
    SUM(tl."lineAmount") AS "amount",
    SUM(tl."lineQuantity") AS "quantity",
    COUNT(*)::BIGINT AS "lineCount",
    (SELECT COALESCE(MAX(kg2."totalGroups"), 0) FROM "keptGroups" kg2) > p_group_limit AS "hasMore"
  FROM "taggedLines" tl
  INNER JOIN "keptGroups" kg
    ON kg."r1" IS NOT DISTINCT FROM tl."r1"
    AND kg."r2" IS NOT DISTINCT FROM tl."r2"
  GROUP BY tl."r1", tl."r2", tl."colKey";
END;
$$;
```

5. The drill-through RPC. Match semantics: a row/column dimension param that is
   NULL = no constraint; dimension set + value NULL = the Unassigned bucket
   (line has NO tag for that dimension); dimension set + value set = tag equals
   value. A period column narrows `postingDate` instead. **Before writing the
   RETURNS clause, check the column types of `journal."journalEntryId"`,
   `journalLine."documentType"`, `account."number"` in
   `packages/database/src/types.ts` and match them exactly. If any differs from
   the sketch, adjust the sketch — do not cast blindly.**

```sql
DROP FUNCTION IF EXISTS "journalDimensionPivotLines";
CREATE OR REPLACE FUNCTION "journalDimensionPivotLines" (
  p_company_group_id TEXT,
  p_company_id TEXT,
  p_start DATE,
  p_end DATE,
  p_account_classes TEXT[] DEFAULT NULL,
  p_account_types TEXT[] DEFAULT NULL,
  p_account_ids TEXT[] DEFAULT NULL,
  p_filters JSONB DEFAULT NULL,
  p_row_dimension_1 TEXT DEFAULT NULL,
  p_row_value_1 TEXT DEFAULT NULL,
  p_row_dimension_2 TEXT DEFAULT NULL,
  p_row_value_2 TEXT DEFAULT NULL,
  p_column_dimension TEXT DEFAULT NULL,
  p_column_value TEXT DEFAULT NULL,
  p_column_period_start DATE DEFAULT NULL,
  p_column_period_end DATE DEFAULT NULL,
  p_line_limit INT DEFAULT 500
)
RETURNS TABLE (
  "id" TEXT,
  "postingDate" DATE,
  "journalEntryId" TEXT,
  "accountId" TEXT,
  "accountName" TEXT,
  "accountNumber" TEXT,
  "description" TEXT,
  "documentType" TEXT,
  "documentId" TEXT,
  "amount" NUMERIC,
  "quantity" NUMERIC
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    jl."id",
    j."postingDate",
    j."journalEntryId"::TEXT,
    jl."accountId",
    a."name" AS "accountName",
    a."number" AS "accountNumber",
    jl."description",
    jl."documentType"::TEXT,
    jl."documentId",
    jl."amount",
    COALESCE(jl."quantity", 0) AS "quantity"
  FROM "journal" j
  INNER JOIN "journalLine" jl ON jl."journalId" = j."id"
  INNER JOIN "account" a
    ON a."id" = jl."accountId" AND a."companyGroupId" = p_company_group_id
  WHERE j."companyId" = p_company_id
    AND jl."companyId" = p_company_id
    AND j."status" <> 'Draft'
    AND j."postingDate" >= COALESCE(p_column_period_start, p_start)
    AND j."postingDate" <= COALESCE(p_column_period_end, p_end)
    AND (
      (p_account_ids IS NOT NULL AND jl."accountId" = ANY(p_account_ids))
      OR (p_account_types IS NOT NULL AND a."accountType"::TEXT = ANY(p_account_types))
      OR (p_account_classes IS NOT NULL AND a."class"::TEXT = ANY(p_account_classes))
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_filters, '[]'::jsonb)) AS f
      WHERE NOT EXISTS (
        SELECT 1 FROM "journalLineDimension" fd
        WHERE fd."journalLineId" = jl."id"
          AND fd."companyId" = p_company_id
          AND fd."dimensionId" = f->>'dimensionId'
          AND fd."valueId" IN (SELECT jsonb_array_elements_text(f->'valueIds'))
      )
    )
    AND (
      p_row_dimension_1 IS NULL
      OR (p_row_value_1 IS NULL AND NOT EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_row_dimension_1))
      OR (p_row_value_1 IS NOT NULL AND EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_row_dimension_1 AND d."valueId" = p_row_value_1))
    )
    AND (
      p_row_dimension_2 IS NULL
      OR (p_row_value_2 IS NULL AND NOT EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_row_dimension_2))
      OR (p_row_value_2 IS NOT NULL AND EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_row_dimension_2 AND d."valueId" = p_row_value_2))
    )
    AND (
      p_column_dimension IS NULL
      OR (p_column_value IS NULL AND NOT EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_column_dimension))
      OR (p_column_value IS NOT NULL AND EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_column_dimension AND d."valueId" = p_column_value))
    )
  ORDER BY j."postingDate", jl."id"
  LIMIT p_line_limit;
END;
$$;
```

6. `reportPin` key migration (old analytics cards → new generic-report keys),
   dedupe-safe and idempotent:

```sql
UPDATE "reportPin" rp SET "reportKey" = 'revenue'
WHERE rp."reportKey" = 'revenue-by-customer'
  AND NOT EXISTS (
    SELECT 1 FROM "reportPin" x
    WHERE x."reportKey" = 'revenue'
      AND x."userId" = rp."userId" AND x."companyId" = rp."companyId");

UPDATE "reportPin" rp SET "reportKey" = 'expenses'
WHERE rp."reportKey" = 'expenses-by-supplier'
  AND NOT EXISTS (
    SELECT 1 FROM "reportPin" x
    WHERE x."reportKey" = 'expenses'
      AND x."userId" = rp."userId" AND x."companyId" = rp."companyId");

DELETE FROM "reportPin"
WHERE "reportKey" IN ('revenue-by-customer', 'expenses-by-supplier');
```

**Verify:**
```bash
ls packages/database/supabase/migrations/ | tail -3
# Expected: the new *_dimensional-pivot-reporting.sql is the newest file (timestamp
# greater than every existing migration; HHMMSS not 000000)
```

**Out of scope:** Do not touch `journalLine`, `journalLineDimension` columns,
any posting function, or existing balance RPCs.

---

## Task 2: Validate the migration in a rolled-back transaction with fixtures

**Depends on:** Task 1
**Files:**
- Create: `.ai/scratch/pivot-migration-validate.sql` (gitignored scratch, fine for throwaway validation)

**Steps:**

1. The local stack must be running (`crbn up`, plain portless mode). Get the DB
   URL from `.env.local` (`SUPABASE_DB_URL`). If the stack cannot boot, STOP
   and report — do not skip validation.
2. Write a validation script that runs entirely inside one transaction as
   `supabase_admin` (pattern: memory/lessons "migration validation via
   rolled-back psql txn"):
   - `BEGIN;`
   - `\i` the new migration file.
   - Insert fixtures (any existing `companyId`/`companyGroupId` from the local
     `company` table; disable nothing — journals inserted as `status =
     'Posted'` with natural-signed amounts per the lesson):
     - 1 journal, postingDate in-range, 3 `journalLine` rows on a Revenue-class
       account: +100 tagged CustomerType A, +200 tagged CustomerType B, +50
       with no tag. Tag via `journalLineDimension` rows using the seeded
       CustomerType dimension (`SELECT id FROM dimension WHERE "entityType" =
       'CustomerType' AND "companyGroupId" = ...`).
     - 1 additional journal with `status = 'Draft'`, same account, +999 tagged
       CustomerType A — must NOT appear in any result (Draft exclusion).
   - Assertions (each a `SELECT ... ; -- expect:` block, eyeball or `\gset` +
     `DO` asserts):
     a. `journalDimensionPivot(companyGroupId, companyId, start, end,
        p_account_classes => ARRAY['Revenue'], p_row_dimension_1 =>
        <customerTypeDimId>)` returns 3 rows: (A, 100), (B, 200), (NULL, 50) —
        NULL row = Unassigned; amounts positive (natural sign).
     b. Same call with `p_period_ends => ARRAY[end]` returns the same sums
        with `columnKey = end::text`.
     c. `p_filters => '[{"dimensionId":"<dim>","valueIds":["<A>"]}]'` returns
        only the A row.
     d. `p_group_limit => 1` returns only the B row (largest ABS) with
        `hasMore = true`.
     e. `journalDimensionPivotLines(..., p_row_dimension_1 => <dim>,
        p_row_value_1 => NULL)` returns exactly the untagged +50 line.
     f. `journalDimensionPivotLines(..., p_row_value_1 => <A>)` sums to 100.
   - `ROLLBACK;`
3. Run it: `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f .ai/scratch/pivot-migration-validate.sql`
4. If assertion (a) shows negative revenue amounts, the natural-sign
   assumption is wrong — STOP and report; the service layer would need a sign
   multiplier and the spec's sign section must be revisited. Do not improvise.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f .ai/scratch/pivot-migration-validate.sql
# Expected: script completes with ROLLBACK; all DO-block asserts pass (no exception);
# no rows left behind (SELECT count(*) FROM "reportView" unchanged after rollback)
```

**Out of scope:** Do not commit fixtures; do not leave the transaction open; do
not disable triggers.

---

## Task 3: Apply migration and regenerate DB types

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/src/types.ts` — regenerated, never hand-edited
- Modify: `packages/database/supabase/functions/lib/types.ts` — regenerated

**Steps:**
1. `pnpm db:migrate` (applies pending migrations to the local dev DB).
2. `pnpm run generate:types`.

**Verify:**
```bash
grep -c 'reportView\|journalDimensionPivot' packages/database/src/types.ts
# Expected: > 0 (table type + both RPC Function entries present)
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** No hand edits to generated files.

---

## Task 4: Add the analytics registry + pivot validators to accounting.models.ts

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — append near the existing report validators (`financialReportColumns` ~L71, `financialReportParamsValidator` ~L82, `dimensionEntityTypes` ~L608)

**Steps:**

1. Add (exact shapes; adjust only if a name collides — then STOP and pick a
   prefixed name, don't restructure existing exports):

```ts
export const analyticsReportKeys = [
  "revenue",
  "expenses",
  "cogs",
  "inventory-change",
  "scrap",
] as const;
export type AnalyticsReportKey = (typeof analyticsReportKeys)[number];

// Account scope: exactly one selector. "scrapAccounts" resolves at runtime to
// accountDefault.scrapAccount (see getScrapAccountIds in accounting.service.ts).
export type AnalyticsAccountScope =
  | { classes: Database["public"]["Enums"]["glAccountClass"][] }
  | { types: Database["public"]["Enums"]["accountType"][] }
  | { source: "scrapAccounts" };

export type AnalyticsReportDefinition = {
  key: AnalyticsReportKey;
  accountScope: AnalyticsAccountScope;
  // default pivot state applied when the URL has no pivot params.
  // rows entries use the "et:<entityType>" alias resolved by the loader.
  defaultRows: string[];
};

export const analyticsReports: Record<AnalyticsReportKey, AnalyticsReportDefinition> = {
  revenue: { key: "revenue", accountScope: { classes: ["Revenue"] }, defaultRows: ["et:CustomerType"] },
  expenses: { key: "expenses", accountScope: { classes: ["Expense"] }, defaultRows: ["et:SupplierType"] },
  cogs: { key: "cogs", accountScope: { types: ["Cost of Goods Sold"] }, defaultRows: ["et:ItemPostingGroup"] },
  "inventory-change": { key: "inventory-change", accountScope: { types: ["Inventory"] }, defaultRows: ["et:ItemPostingGroup"] },
  scrap: { key: "scrap", accountScope: { source: "scrapAccounts" }, defaultRows: ["et:ScrapReason"] },
};

export const pivotMeasures = ["amount", "quantity", "count"] as const;

export const pivotColumnAxisValidator = z.discriminatedUnion("type", [
  z.object({ type: z.literal("period"), bucket: z.enum(financialReportColumns) }),
  z.object({ type: z.literal("dimension"), dimensionId: z.string().min(1) }),
]);

export const pivotStateValidator = z.object({
  rows: z.array(z.string().min(1)).max(2).default([]),
  columnAxis: pivotColumnAxisValidator.default({ type: "period", bucket: "month" }),
  measure: z.enum(pivotMeasures).default("amount"),
  percentOfTotal: z.boolean().default(false),
  filters: z
    .array(z.object({ dimensionId: z.string().min(1), valueIds: z.array(z.string()).min(1) }))
    .default([]),
});
export type PivotState = z.infer<typeof pivotStateValidator>;

export const reportViewValidator = z.object({
  id: zfd.text(z.string().optional()),
  reportKey: z.enum(analyticsReportKeys),
  name: z.string().min(1, { message: "Name is required" }).max(100),
  visibility: z.enum(["Private", "Company"]),
  // JSON-encoded PivotState; parsed with pivotStateValidator in the action
  config: z.string().min(2),
});
```

   Display names for report keys/measures live in the UI with Lingui (Task 7),
   not in the models file (msg descriptors don't belong in models).

2. **URL param contract** (document as a comment above `pivotStateValidator`;
   the loader in Task 9 and the control bar in Task 7 both implement it):
   - `rows` = comma-separated list, each item a `dimension.id` or `et:<entityType>` alias
   - `col` = `period:month|quarter|year` or `dim:<dimensionId>`
   - `measure` = `amount|quantity|count`; `pct` = `1` when percentOfTotal
   - `filters` = JSON-encoded `[{dimensionId, valueIds}]` (URL-encoded)
   - `startDate`/`endDate` — same params the existing `ReportFilters` writes

3. Export any new types from the module barrel if not already covered by
   `export *` (check `apps/erp/app/modules/accounting/index.ts`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** Do not modify existing validators or `financialReportParamsValidator`.

---

## Task 5: Add pivot + reportView service functions to accounting.service.ts

**Depends on:** Task 4 (parallel with Task 6)
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — add functions near the existing report functions (`getAccountPeriodSeries` ~L347) and reportPin functions (`getReportPins` ~L832)
- Modify: `apps/erp/app/modules/accounting/types.ts` — derived types
- Copy from (precedent): `getAccountPeriodSeries` (RPC call + period buckets), `getReportPins`/`upsertReportPin` (simple table CRUD), `getEntityDimensionValues` ~L2982 (entityType → source-table mapping)

**Steps:**

1. `getScrapAccountIds(client, companyId)`: `SELECT scrapAccount FROM
   accountDefault WHERE companyId = ...`; returns `{ data: string[], error }`
   (empty array if null). (Grep confirmed `scrapAccount` exists only on
   `accountDefault` — no posting-group override.)

2. `getDimensionPivot(client, args)` with:

```ts
args: {
  companyId: string;
  companyGroupId: string;
  report: AnalyticsReportDefinition;
  scrapAccountIds?: string[];       // required when accountScope.source === "scrapAccounts"
  startDate: string;                // YYYY-MM-DD
  endDate: string;
  periodEnds?: string[];            // from computeReportPeriodBuckets, when columnAxis is period
  state: PivotState;                // rows already resolved to dimension ids (loader does et: resolution)
}
```

   - Calls `client.rpc("journalDimensionPivot", {...})` mapping: scope →
     `p_account_classes`/`p_account_types`/`p_account_ids` (scrap →
     scrapAccountIds; if scrapAccountIds is empty, return
     `{ data: { groups: [], columnKeys: [], hasMore: false, valueNames: {} }, error: null }`
     without calling the RPC), rows → `p_row_dimension_1/2`, columnAxis →
     `p_column_dimension` or `p_period_ends`, filters → `p_filters`.
   - Collects distinct non-null `rowValue1Id`/`rowValue2Id`/`columnKey`
     (columnKey only when the column axis is a dimension) and resolves display
     names per the tagged dimension's `entityType`.
   - **Name resolution:** read `getEntityDimensionValues` (~L2982) first. Factor
     its entityType→(table, id column, name column) mapping into a reusable
     helper `resolveDimensionValueNames(client, companyId, companyGroupId,
     requests: { entityType, valueIds }[])` → `Record<string, string>`. Reuse
     the mapping — do NOT invent table names. Only query the ids actually
     returned (≤1,000 groups), batched per entityType with `.in("id", ids)`.
     If the existing mapping can't be factored without changing
     `getEntityDimensionValues` behavior, duplicate the mapping table into the
     helper and leave the original untouched.
   - Returns `{ data: { groups, columnKeys, hasMore, valueNames }, error }`,
     `groups` sorted descending by `ABS(amount)` **in TypeScript** (never trust
     RPC ordering — lesson).

3. `getDimensionPivotLines(client, args)` — same scope/filter args plus
   `{ rowDimension1?, rowValue1?, rowDimension2?, rowValue2?, columnDimension?,
   columnValue?, columnPeriodStart?, columnPeriodEnd? }`; calls
   `journalDimensionPivotLines`; re-sorts by postingDate in TS.

4. `getReportViews(client, { companyId, reportKey? })` — `.from("reportView")
   .select("*").eq("companyId", companyId)` (+ `.eq("reportKey", reportKey)`),
   RLS handles visibility. `upsertReportView(client, view)` — insert or update
   (id present → update with `updatedBy`/`updatedAt`; absent → insert with
   `createdBy`); returns the row. `deleteReportView(client, id, companyId)`.
   All follow `{ data, error }` — never throw (conventions-services).

5. In `types.ts`, add `export type DimensionPivot = NonNullable<Awaited<ReturnType<typeof getDimensionPivot>>["data"]>;`
   and the same for `DimensionPivotLine`, `ReportView` (follow the file's
   existing `Awaited<ReturnType<...>>` style).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** No changes to `getEntityDimensionValues` behavior, no changes
to existing report service functions, no new service files.

---

## Task 6: Build pivotTree.ts (pure pivot assembly) + unit tests

**Depends on:** Task 4 (parallel with Task 5)
**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Reports/pivotTree.ts`
- Create: `apps/erp/app/modules/accounting/ui/Reports/pivotTree.test.ts`
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/Reports/reportTree.ts` (flat-tree builder style + its test if one exists), `apps/erp/app/components/TreeView/` (the `FlatTreeItem` shape: `id, parentId, children, hasChildren, level, data`)

**Steps:**

1. Pure functions (no React, no client):

```ts
export type PivotCellValue = { amount: number; quantity: number; lineCount: number };
export type PivotRowNode = {
  key: string;                 // "<r1 ?? '∅'>|<r2 ?? '∅'>" composite
  rowValue1Id: string | null;  // null = Unassigned
  rowValue2Id: string | null;
  label: string;               // resolved name or "Unassigned"
  cells: Record<string, PivotCellValue>;  // by columnKey
  total: PivotCellValue;
};

export function buildPivotTree(args: {
  groups: /* RPC rows from getDimensionPivot */;
  valueNames: Record<string, string>;
  columnKeys: string[];        // ordered: period ends ascending, or dimension values sorted by grand total desc
  rowCount: 0 | 1 | 2;
  maxColumns?: number;         // default 50
}): {
  flatTree: FlatTreeItem<PivotRowNode>[];  // level-1 groups with nested level-2 children, subtotals on parents
  columnKeys: string[];                    // possibly truncated (see columnsTruncated)
  columnTotals: Record<string, PivotCellValue>;
  grandTotal: PivotCellValue;
  columnsTruncated: boolean;               // true when > maxColumns distinct columns — UI must show a banner
}
```

   Rules: parent rows (dimension 1) aggregate their children's cells; Unassigned
   sorts last; everything else sorted by `ABS(total[measure])` descending; when
   `columnsTruncated`, keep the top `maxColumns` columns by grand total and DROP
   the rest from `columnKeys` (the banner states truncation — no silent cap).
2. `applyPercentOfTotal(cells, columnTotals)` helper returning percentages per
   column (0 when the column total is 0 — no division by zero).
3. `pivotToCsvRows(tree, columnKeys, measure)` returning `string[][]` for the
   export (header row + data rows exactly as rendered).
4. Tests (vitest, colocated `pivotTree.test.ts`; run like the existing erp unit
   tests — check how `reportTree` or `executivePnl` tests are invoked first).
   Cases: (a) 1-dim rows with Unassigned sorting last and correct totals;
   (b) 2-dim nesting with parent subtotals = sum of children; (c) column totals
   + grand total consistency; (d) percentOfTotal sums to 100 per column
   (within float tolerance) and 0-total column yields 0s; (e) column truncation
   sets `columnsTruncated` and keeps top-N by grand total; (f) CSV rows match
   the tree. Use optional chaining on indexed access (`arr[0]?.prop`) —
   `noUncheckedIndexedAccess` is on.

**Verify:**
```bash
pnpm --filter erp test -- pivotTree
# Expected: all pivotTree tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** No React components here; no data fetching.

---

## Task 7: Build PivotControlBar + SaveViewModal components

**Depends on:** Task 4 (parallel with Task 8)
**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Reports/PivotControlBar.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Reports/SaveViewModal.tsx`
- Modify: `apps/erp/app/modules/accounting/ui/Reports/index.ts` — export both
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/Reports/ReportFilters.tsx` (filter-bar layout, URL-param writing, download button), `apps/erp/app/components/PeriodSelector.tsx` (range variant), `apps/erp/app/modules/accounting/ui/JournalEntries/DimensionSelector.tsx` (dimension value picker incl. lazy high-cardinality entities)

**Steps:**

1. `PivotControlBar` props: `reportKey`, `dimensions` (from
   `getActiveDimensionsWithValues` loader data), `state: PivotState`,
   `savedViews`, `accountScopeLabel`. It renders, in ReportFilters' visual
   style (same HStack/spacing/size conventions — ERP `size="md"`):
   - Rows: two dimension selects (second enabled only when first set; can't
     pick the same dimension twice)
   - Columns: a segmented/select control: Month / Quarter / Year / By dimension
     (+ dimension select when "By dimension")
   - Values: measure select (Amount/Quantity/Count) + "% of total" toggle
   - Filters: add-filter popover → dimension → multi-select values (lazy-load
     values for Customer/Supplier/Item via the same mechanism
     DimensionSelector uses — read it first)
   - `PeriodSelector` (range variant) + account-scope chip (read-only Badge) +
     saved-view select (grouped Private/Company) + Save view button + CSV
     download + reset
   - All state changes write URL search params per the Task 4 contract
     (`setSearchParams`, replace, like ReportFilters does). No local state
     that isn't in the URL.
2. `SaveViewModal`: `ValidatedForm` + `reportViewValidator` posting to the
   route action (Task 9). Fields: Name (Input), Visibility (Select:
   Private/Company), hidden `reportKey` + `config` (JSON.stringify of current
   PivotState). Follow `.claude/rules/conventions-forms.md`; Modal from
   `@carbon/react`. Editing an existing view pre-fills + passes `id`.
   Delete button (owner only — compare `createdBy` to `useUser()` id) submits
   intent=delete.
3. All user-facing strings via Lingui (`useLingui().t` / `<Trans>`); counts
   shown plainly (never parenthesized).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** No route/loader code; no pivot rendering.

---

## Task 8: Build PivotTree component + PivotLinesDrawer

**Depends on:** Tasks 4+6 (parallel with Task 7)
**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Reports/PivotTree.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Reports/PivotLinesDrawer.tsx`
- Modify: `apps/erp/app/modules/accounting/ui/Reports/index.ts` — export both
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/Reports/MultiPeriodStatementTree.tsx` (TreeView-based multi-column report tree — the closest existing screen; clone its structure), `apps/erp/app/modules/accounting/ui/Reports/AccountLedgerDrawer.tsx` (drill-through drawer)

**Steps:**

1. `PivotTree`: renders `buildPivotTree` output with `TreeView`/`useTree`
   exactly the way MultiPeriodStatementTree renders its tree: expandable
   level-1/level-2 rows, one numeric column per `columnKey` (period label via
   `getPeriodColumnLabel` from `exportReport.ts` when the axis is period;
   `valueNames` otherwise), plus a Total column; column-totals footer row and
   grand total; measure formatting — amount via the report's currency
   formatting used in MultiPeriodStatementTree, quantity/count as plain
   numbers, percentages with one decimal when `percentOfTotal`. Unassigned
   label italic/muted. `columnsTruncated` or `hasMore` → an explicit banner
   line above the tree ("Showing top 1,000 groups by amount" / "Showing top 50
   columns"). Tabular numbers (`make-interfaces-feel-better`: use the same
   number-cell classes as the precedent).
2. Cell + row-total click opens `PivotLinesDrawer` (also double-click):
   Drawer (overlay, per detail-view convention) fetching
   `analyticsReportLines` (Task 9) via `useFetcher` with the cell coordinates
   (rowValue ids, columnKey → dimension value or period start/end resolved from
   the bucket). Shows a simple table: Posting Date (`formatDate` from
   `@carbon/utils` — never `new Date`), Journal (link to the journal entry
   using the same link target AccountLedgerDrawer uses), Account, Description,
   Document, Amount, Quantity; footer sums; the 500-line cap surfaced as a
   banner when `lines.length === 500`.
3. Empty state when no groups: icon + "No journal lines in scope for this
   period" (Lingui), matching the empty-state pattern in the precedent tree.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** No loader/action code; no changes to TreeView itself.

---

## Task 9: Add analytics routes + path helpers

**Depends on:** Tasks 5, 7, 8
**Files:**
- Create: `apps/erp/app/routes/x+/reports+/analytics.$reportKey.tsx`
- Create: `apps/erp/app/routes/x+/reports+/analytics.$reportKey.lines.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `analyticsReport: (key: string) => ...` and `analyticsReportLines: (key: string) => ...` in alphabetical position
- Copy from (precedent): `apps/erp/app/routes/x+/reports+/income-statement.tsx` (loader shape: params → `computeReportPeriodBuckets` → service → tree component), `apps/erp/app/routes/x+/reports+/revenue-by-customer.tsx` (timezone-aware `defaultReportRange` handling)

**Steps:**

1. `analytics.$reportKey.tsx`:
   - `handle.breadcrumb`: msg-descriptor per key (switch over
     `analyticsReportKeys`; unknown key → 404 via `data(null, { status: 404 })`
     — check how sibling routes 404 first and copy that).
   - Loader: `requirePermissions(request, { view: "accounting", role:
     "employee" })` destructuring `{ client, companyId, companyGroupId }`.
     Parse URL params per the Task 4 contract into `PivotState`
     (`pivotStateValidator.safeParse` on the assembled object; invalid → fall
     back to the report default + keep going). Resolve `et:<entityType>` row
     aliases to dimension ids via `getDimensions` filtered to active — if no
     dimension exists for the alias, drop that row selection. Dates default
     via `defaultReportRange` + `getCompanyTimeZone` exactly like
     revenue-by-customer.tsx does today. When columnAxis is period, compute
     `periodEnds` with `computeReportPeriodBuckets(startDate, endDate, bucket,
     fiscalStartMonth)` (see income-statement.tsx for the fiscal month
     lookup). Load in parallel (`Promise.all`): `getDimensionPivot`,
     `getActiveDimensionsWithValues`, `getReportViews(client, { companyId,
     reportKey })`, and `getScrapAccountIds` when the report is scrap.
   - Action: `assertIsPost`; parse `intent` — `save` validates
     `reportViewValidator` via `validator(...).validate(formData)`, parses
     `config` with `pivotStateValidator` (invalid → flash error), calls
     `upsertReportView`; `delete` calls `deleteReportView` (RLS enforces
     ownership; surface the error via flash if it fails). Return plain objects
     + `flash` per route conventions — success stays on the page with a
     success flash (no redirect needed; the view list refreshes via loader
     revalidation).
   - Component: `PivotControlBar` + `PivotTree` wired to loader data; CSV
     download uses `pivotToCsvRows` + the exact download mechanism
     `ReportFilters`/`exportReport.ts` uses today.
2. `analytics.$reportKey.lines.tsx`: loader-only fetcher route (same
   permissions) parsing the same scope params + cell coordinates
   (`r1`,`r2`,`col` params; `r1=∅` sentinel for Unassigned must be
   distinguished from absent — use `r1null=1`-style flags, mirroring the RPC's
   NULL semantics) and returning `getDimensionPivotLines` data. If a
   `.lines.tsx` sibling route nests awkwardly under `$reportKey` (flat-routes
   dot-nesting makes it a child of the report route — that is fine for a
   fetcher), verify with `pnpm --filter erp exec react-router routes` if
   unsure; if it renders as a nested Outlet instead of a resource route, move
   it to `apps/erp/app/routes/api+/accounting.analytics-lines.tsx` and update
   `path.ts` accordingly.
3. `path.ts`: `analyticsReport: (key: string) => \`${x}/reports/analytics/${key}\``
   (+ lines helper matching wherever the fetcher route landed).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** Hub cards and redirects (Task 10); no new permissions scopes.

---

## Task 10: Redirect old reports, update hub cards, remove dead code

**Depends on:** Task 9
**Files:**
- Modify: `apps/erp/app/routes/x+/reports+/revenue-by-customer.tsx` — replace with a redirect loader
- Modify: `apps/erp/app/routes/x+/reports+/expenses-by-supplier.tsx` — replace with a redirect loader
- Modify: `apps/erp/app/routes/x+/accounting+/reports.tsx` — swap the two Analytics cards for the five generic reports + saved-views list
- Modify: `apps/erp/app/utils/path.ts` — remove `revenueByCustomer` / `expensesBySupplier` after all references are updated
- Possibly delete: `SpendByPartyReport` + `getRevenueByCustomer` / `getExpensesBySupplier` (invoicing module) — only if unreferenced

**Steps:**

1. Replace each old route file's contents with only:
   `export async function loader() { throw redirect(path.to.analyticsReport("revenue") + "?rows=et:Customer"); }`
   (expenses → `analyticsReport("expenses") + "?rows=et:Supplier"`). Keep the
   file (URL keeps working); remove the old component/loader imports.
2. Hub (`x+/accounting+/reports.tsx`): replace the `revenue-by-customer` and
   `expenses-by-supplier` `ReportDefinition` entries with five entries — keys
   exactly `revenue`, `expenses`, `cogs`, `inventory-change`, `scrap` (they
   must match the Task 1 reportPin migration), category `t\`Analytics\``,
   `defaultPinned: false`, `to: path.to.analyticsReport(key)`, names/
   descriptions via Lingui (e.g. `t\`Revenue\`` / `t\`Slice revenue by any
   dimension\``). Add the AR/AP aging cards untouched. Below the Analytics
   card grid, list saved views: extend the hub loader with
   `getReportViews(client, { companyId })` and render each view as a small
   link row (name + report + owner/shared badge) →
   `path.to.analyticsReport(view.reportKey)` + `?view=<id>`; the analytics
   loader applies a `view` param by loading that reportView's config (add
   this handling to Task 9's loader — parse `view` param first, URL params
   still win when present).
3. Grep for now-dead code: `grep -rn "SpendByPartyReport\|getRevenueByCustomer\|getExpensesBySupplier" apps/`
   — if the only references were the two replaced routes, delete the component
   and service functions and update the invoicing barrel exports
   (`apps/erp/app/modules/invoicing/index.ts`, `ui/index.ts`,
   `ui/Reports/index.ts` as applicable). If anything else references them
   (e.g. ARAPWorkbench), leave them and note it in the run record.
4. Grep for remaining `path.to.revenueByCustomer` / `path.to.expensesBySupplier`
   references; the redirect routes themselves should use literal old paths in
   `handle`/nothing — after all references are gone, delete the two path
   helpers. If the redirect route files need a path constant, inline the
   string.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -rn "revenueByCustomer\|expensesBySupplier" apps/erp/app/utils/path.ts
# Expected: no matches
```

**Out of scope:** AR/AP aging reports; inventory-valuation; do not touch `ARAPWorkbench` unless the grep in step 3 says it references deleted code (then STOP and report instead of deleting).

---

## Task 11: i18n extract + lint + scoped typecheck gate

**Depends on:** Task 10
**Files:**
- Modify: `packages/locale/locales/*/erp.po` — extracted strings

**Steps:**
1. `pnpm run lingui:extract` (updates the .po catalogs with the new strings).
2. Fill missing translations for the new strings via the `/translate` skill
   (or leave for the check-and-commit gate if executing task-by-task — it runs
   /translate when locale files changed).
3. `pnpm run lint` — fix any Biome findings in the new files.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm run lint
# Expected: exit 0 (no errors)
git diff --stat packages/locale/locales/en/erp.po
# Expected: new msgids for the pivot UI strings
```

**Out of scope:** No locale-list changes.

---

## Task 12: Browser verification via /test

**Depends on:** Task 11
**Files:** none (verification only; playbook may be cached to `.ai/playbooks/`)

**Steps:**

1. Boot the stack with plain `crbn up` (portless). If accounting is disabled
   locally (fresh reset), enable it at `/x/settings/accounting` first
   (memory: crbn reset seeds `accountingEnabled=false`).
2. Ensure there is dimension-tagged data: post at least (a) a sales invoice
   (tags Customer/CustomerType) and (b) a stock scrap with a scrap reason
   (tags ScrapReason — flow from #1355). If seeded data already contains
   posted journals with tags (check via the trial balance + a quick pivot),
   skip creation.
3. Run `/test` against the branch diff with this scenario list (maps to the
   spec's acceptance criteria):
   - `/x/reports/analytics/scrap` → default rows=ScrapReason; groups per
     reason; drill-through drawer sums equal the cell.
   - `/x/reports/analytics/revenue?rows=et:CustomerType` with month columns →
     positive amounts; switch measure to Quantity and Count; toggle % of
     total (columns sum to 100%).
   - Set rows to two dimensions (ScrapReason → Item) → nested tree with
     parent subtotals.
   - `/x/reports/analytics/inventory-change?rows=et:ItemPostingGroup` →
     signed net change per item group (positive when inventory rose, e.g.
     after a receipt/completion; negative after a scrap/issue).
   - Column axis = dimension (Location) → per-location columns + totals.
   - Add a Location filter → all cells restricted consistently.
   - Save a view (visibility Company) → appears on the reports hub; open via
     the hub link; URL round-trip (copy URL into a new tab reproduces state).
   - `/x/reports/revenue-by-customer` → 302 redirect to the analytics preset.
   - CSV download matches rendered rows.
   Note: agent-browser + ValidatedForm → submit via `requestSubmit(button)`,
   blur react-aria fields to commit values (memory: agent-browser RVF forms).
4. Screenshots of the pivot (1-dim, 2-dim nested, dimension columns, drawer)
   for the PR per the surface-designs feedback.

**Verify:**
```bash
# /test produces a pass/fail table; all scenarios above must pass.
# Expected: PASS on every scenario; screenshots saved for the PR.
```

**Out of scope:** No production data; no Xero/sync verification; do not run `crbn reset`.
