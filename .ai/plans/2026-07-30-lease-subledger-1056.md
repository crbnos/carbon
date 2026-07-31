# Lease Subledger (ASC 842 / IFRS 16) — Implementation Plan (#1056)

> Spec: `.ai/specs/2026-07-04-lease-accounting.md`
> Branch: `feat/lease-subledger-1056` → PR target `main`
> Date: 2026-07-30

## Environment reality → two-phase delivery

This dispatch env has **no Postgres / no booted Supabase stack**, so
`pnpm run generate:types` cannot run. Every DB-adding PR on `main` commits a
regenerated `packages/database/src/types.ts`; without a DB we cannot regenerate,
so **any TS that references a new table/column cannot typecheck**. This is the
exact constraint under which IC matching (#1224), IC netting (#1239) and close
automation (#1287) all shipped **schema-only foundations** with TS consumers
deferred to a follow-up PR after the user runs `pnpm db:migrate`.

Therefore this issue is split:

- **PR A — Schema foundation (THIS PR).** Migrations + seed data only. Verifiable
  here (biome, `@carbon/checks` conformance, `@carbon/database` typecheck). No TS
  that reads the new tables.
- **PR B — TS consumers (DEFERRED, execute-ready below).** Services, server
  transactions, utils, models, routes/UI, Inngest cron, close-checklist evaluator
  + task-definition registration, IFRS-16 generator, recurring-invoice templates,
  disclosures. Built after the user applies PR A's migration and regenerates types.

## Dependency status (verified 2026-07-30 against `origin/main`)

| Dep | State | Effect |
|-----|-------|--------|
| Period-closing (`periodCloseTaskDefinition`) | ✅ on main (`20260702044133`) | Checklist infra exists. **But** an unregistered `autoCheckKey` fails closed → the "Post lease journals" definition seed is **deferred to PR B** (registered together with its evaluator). |
| Multi-book adjustment book | ❌ not landed (no migration) | IFRS-16 generator (§7) is read-only over persisted schedule columns; **deferred**, non-blocking by spec design. |
| Close-automation recurring-journal machinery | ❌ not on main | Auto-create recurring purchase-invoice templates (open-Q resolution) is a TS consumer; **deferred to PR B**; clearing + manual invoice is the v1 fallback. |
| GAP-3 standard costing | incomplete | Lessor sales-type commencement JE stays **system-drafted / user-posted** by design. |

Nothing hard-blocks the schema foundation.

---

## PR A — Schema foundation (this PR)

Grounded on the fixed-asset subledger (`20260524143826/27`, `20260525084319`) and
period-close (`20260702044133`) precedents. Conventions applied:

- **Modern table style** (period-close, not the older `xid()` fixed-asset style):
  `id('prefix')` defaults, composite PK `("id","companyId")`, inline audit FKs,
  full audit quartet (`createdBy`/`createdAt`/`updatedBy`/`updatedAt`) on every table.
- **Bare `NUMERIC`** everywhere — the `no-numeric-precision` conformance gate rejects
  `NUMERIC(x,y)` (spec's `NUMERIC(8,5)`/`NUMERIC(5,2)` stripped).
- **RLS**: 4 policies/table. SELECT via `get_companies_with_employee_permission('accounting_view')`
  (matches the fixed-asset sibling — financial subledger read); writes via
  `accounting_create`/`update`/`delete`. Schema-qualified, `::text[]`.
- **Enum `ADD VALUE` isolated** in its own migration (can't share a txn with usage).

### Migration A1 — `20260730161500_lease-enums.sql`
- `ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Lease';`

### Migration A2 — `20260730161600_lease-subledger.sql`
1. `CREATE TYPE` ×8: `leaseRole`, `leaseStatus`, `lesseeClassification`,
   `lessorClassification`, `leasePaymentFrequency`, `leasePaymentTiming`,
   `leaseEventType`, `leaseOptionType`.
2. `ALTER TABLE "companySettings"` +5 policy-election columns (bare NUMERIC).
3. `CREATE TABLE` ×9 + indexes + RLS: `leaseClass`, `lease`, `leasePaymentTerm`,
   `leaseOption`, `leaseVariablePayment`, `leaseScheduleLine`, `leaseEvent`,
   `leaseRun`, `leaseRunLine`.
4. Seed `lease` + `leaseRun` sequences (`INSERT ... SELECT FROM "company"`).
5. Seed 11 lease GL accounts for existing company groups (set-based
   `INSERT ... SELECT FROM "companyGroup" CROSS JOIN (VALUES …) JOIN parent-by-name`,
   `ON CONFLICT (name, companyGroupId) DO NOTHING`).

**GL account numbers assigned (chart-collision audit done 2026-07-30 — all free):**

| # | Name | Parent group | accountType | class |
|---|------|--------------|-------------|-------|
| 1370 | Right-of-Use Assets | Property, Plant & Equipment | Fixed Asset | Asset |
| 1380 | Accumulated ROU Amortization | Property, Plant & Equipment | Accumulated Depreciation | Asset |
| 1450 | Net Investment in Leases | Other Assets | Other Asset | Asset |
| 2180 | Lease Clearing | Current Liabilities | Other Current Liability | Liability |
| 2190 | Straight-Line Rent Accrual | Current Liabilities | Other Current Liability | Liability |
| 2440 | Lease Liability | Long-Term Liabilities | Long Term Liability | Liability |
| 4150 | Lease Income | Other Income | Other Income | Revenue |
| 4160 | Interest Income on Leases | Other Income | Other Income | Revenue |
| 6120 | Operating Lease Expense | Operating Expenses | Expense | Expense |
| 6130 | Variable Lease Expense | Operating Expenses | Expense | Expense |
| 6330 | ROU Amortization Expense | Depreciation & Amortization | Other Expense | Expense |

Lessee **interest expense** reuses existing `7010` Interest Expense (no new account).

### Migration A3 — `20260730161700_seed-lease-classes.sql`
- Seed 3 `leaseClass` rows/company (Real Estate, Equipment, Vehicles), all mapping
  to the lease accounts above (`interestExpenseAccountId → 7010`), lessor accounts
  populated too. `INSERT ... SELECT FROM "company" CROSS JOIN (VALUES …) JOIN account
  BY number`, `WHERE isEliminationEntity IS NOT TRUE`, `ON CONFLICT (name, companyId)`.

### seed.data.ts / seed-company (new-company parity)
- `packages/database/supabase/functions/lib/seed.data.ts`: add the 11 accounts to
  `accounts`, `lease`/`leaseRun` to `sequences`, and a new `leaseClasses` array.
- `packages/database/supabase/functions/seed-company/index.ts`: insert `leaseClass`
  rows for new companies (cast `(trx as any)` — table is newer than generated Kysely
  types, exactly the `periodCloseTaskDefinition` precedent at L323).

### NOT in PR A (deferred, fails-closed or needs regen)
- `periodCloseTaskDefinition` "Post lease journals" seed — needs its evaluator.
- All `*.models.ts` / `*.service.ts` / `*.server.ts` / `*.utils.ts` / routes / UI.

### PR A verification (runnable here)
- `pnpm --filter @carbon/checks test` (conformance — NUMERIC precision, RLS, etc.)
- `pnpm --filter @carbon/checks clobbers`
- `pnpm exec biome check` on changed files
- `pnpm exec turbo run typecheck --filter=@carbon/database`
- Grep baseline: lease tables + `'Lease'` source value present in migrations.

---

## PR B — TS consumers (execute-ready, after `pnpm db:migrate` regen)

Do these in `apps/erp/app/modules/accounting/` beside fixed assets. Order:

1. **models** — `accounting.models.ts`: `leaseValidator`, `leaseClassValidator`,
   `leasePaymentTermValidator`, `leaseOptionValidator`, `leaseVariablePaymentValidator`,
   `leaseEventValidator`, `leaseRunValidator` + enum arrays (`leaseRoles`,
   `lesseeClassifications`, `lessorClassifications`, `leasePaymentFrequencies`,
   `leasePaymentTimings`, `leaseEventTypes`, `leaseOptionTypes`).
2. **utils** — ✅ **DONE (commit `afdfd7cf9`, on branch/PR #1289).**
   `accounting.utils.ts`: `presentValue()`, `periodicLeaseRate()`, `expandPaymentTerms()`,
   `classifyLease()`, `buildLeaseSchedule()` (emits both expense patterns per line;
   last line absorbs rounding to close liability to 0). Pure/DB-independent, so it
   shipped ahead of type regen. 21 unit tests (TDD) prove the spec's worked example:
   36mo × $10,000 arrears @ 6% → liability $328,710.16; line 1 interest $1,643.55 /
   principal $8,356.45 / closing $320,353.71; line 36 → $0.00; Advance timing +
   quarterly frequency + IDC/incentives + all five classification tests covered.
   Gates green here: vitest (90), biome, `erp` typecheck. **The service/server layer
   (step 4) consumes these calc fns; still needs regen.**
3. **service** — `accounting.service.ts`: CRUD + `getLeases`, `getLeaseSchedule`,
   `getLeaseRun(s)`, `getLeaseMaturityAnalysis`, `getLeaseWeightedAverages`,
   `getLeaseCashPaidSummary` (disclosures §8).
4. **server** — `accounting.server.ts` Kysely txns: `activateLease()`,
   `processLeaseEvent()`, `postLeaseRun()` (source `'Lease'`,
   `getOrCreateAccountingPeriod(…, "accounting")`; block Closed, allow Locked).
5. **routes/UI** — `x+/accounting+/leases*|lease-classes*|lease-runs*|lease-disclosures`,
   `x+/lease+/$leaseId.{tsx,activate,modify,terminate,delete}`,
   `x+/lease-run+/$leaseRunId.{tsx,post,delete}`; `ui/Leases/` (mirror `FixedAssets/`).
6. **jobs** — `packages/jobs` monthly per-company cron `lease-run-proposal` (Draft
   `leaseRun` + lines; idempotent one-per-company-per-period).
7. **close checklist** — register `unposted-lease-schedules` evaluator in the
   readiness registry **and** seed the `periodCloseTaskDefinition` row (Auto, Warning,
   after depreciation) — both in the same PR (fails-closed otherwise).
8. **recurring invoices** — activation auto-creates recurring purchase-invoice
   templates once the close-automation machinery lands; clearing is the fallback.
9. **IFRS-16 generator** — register `ifrs16-lease` in the multi-book generator
   framework when it lands (pure reader over persisted schedule columns).
10. **docs / AGENTS.md / rule** — update `modules/accounting/AGENTS.md`; add a
    `.claude/rules/lease-subledger.md`; move the spec to `implemented/`.

## Acceptance criteria coverage
PR A satisfies the grep/schema baseline + `'Lease'` source-type criterion. PR B
satisfies the numeric-example, classification, modification/termination, lessor,
Inngest-idempotency, close-checklist, disclosure, and IFRS-16 criteria (each has a
unit or e2e proof listed above).
</content>
</invoke>
