# Implementation Plan — Close Automation (#1039)

> Spec: `.ai/specs/2026-07-04-close-automation.md`
> Issue: [crbnos/carbon#1039](https://github.com/crbnos/carbon/issues/1039)
> Branch: `feat/close-automation-1039` → `main`
> Status: **Phase 0 (schema foundation) + the pure amortization/date math (from Phases 3–4) shipped in this PR. The remaining TS — service/edge/route/UI/job/checklist layers — is execute-ready and blocked only on `pnpm run generate:types` against a live DB.**
>
> **Pulled forward (pure, DB-independent, no type regen needed):** `accounting.utils.ts` gained
> `buildPrepaidScheduleEntries(totalAmount, months, startDate)` (straight-line, remainder folded into the
> **final** entry so Σ === total exactly; `amortizationDate` = last day of each month) and
> `advanceRecurringDate(dateStr, frequency)` (+1/+3/+12 months, clamps day to the target month's length so
> Jan 31 → Feb 28/29, never rolls forward). 17 TDD unit tests (module suite 80 passing). Gates green here:
> vitest, biome, `erp` typecheck. Phase 3's `createPrepaidSchedule` precompute and Phase 4's
> `generateRecurringJournals` advance-step consume these directly — the DB-touching wrappers are all that
> remains for those two mechanics.

## Dependency status

- **#1031 period close** — ✅ CLOSED. Substrate (`periodCloseTaskDefinition`, `computePeriodReadiness`,
  `evaluateCloseChecklist`, `check_accounting_period_open` trigger, `getOrCreateAccountingPeriod(source)`)
  is present and mapped below.
- **#1032 document approvals** — ⚠️ OPEN. Only touches the *optional* depreciation-run approval extension
  (Open Question in the spec). **Back-out taken (plan-stage valve the spec authorises):** do NOT extend
  `approvalDocumentType` with `'depreciationRun'` in this workstream. Depreciation-run posting stays gated
  by `update: accounting` (its existing route permission) in v1; the approval extension is a clean follow-on
  to #1032 once it merges. Prepaid + recurring drafts still post through `postJournalEntry`, so they inherit
  #1032's JE approval automatically when that lands — no coupling.

## Why the TS is deferred (environment constraint)

`pnpm run generate:types` (`scripts/generate-db-types.ts`) runs `supabase gen types` against a **local running
Supabase** (`SUPABASE_DB_URL` must be localhost) and rewrites `packages/database/src/types.ts` +
`packages/database/supabase/functions/lib/types.ts`. This dispatch environment has **no database, no Docker,
and no `supabase` CLI**. Every TS consumer below references the new tables / columns / enum values, so it
cannot typecheck or run until types are regenerated. Phase 0 (the migration) is the correct, verifiable,
fully-additive foundation that unblocks all of it.

**First action when a DB is available:** apply the migration, then regenerate types.

```bash
pnpm db:migrate          # applies 20260730120000_close-automation.sql
pnpm run generate:types  # regenerates packages/database/src/types.ts + functions/lib/types.ts
```

---

## Phase 0 — Schema foundation (DONE, in this PR)

`packages/database/supabase/migrations/20260730120000_close-automation.sql`:

- Enum: `journalEntrySourceType` += `'Prepaid Amortization'`, `'Recurring Journal'` (bare `ADD VALUE IF NOT EXISTS`).
- `journal.autoReverseOn DATE` + CHECK `(autoReverseOn IS NULL OR autoReverseOn > postingDate)`.
- `companySettings.depreciationProposalsEnabled BOOLEAN NOT NULL DEFAULT true`.
- `purchaseInvoiceLine`: `isPrepaid` / `prepaidStartDate` / `prepaidMonths` + CHECK restricting prepaid to `'G/L Account'` lines.
- Tables (composite PK `("id","companyId")`, company FK CASCADE, accounting-permission RLS × 4, indexes):
  `prepaidSchedule`, `prepaidScheduleEntry`, `recurringJournalTemplate`, `recurringJournalTemplateLine`. All four
  carry the full `createdBy`/`createdAt`/`updatedBy`/`updatedAt` audit set (`createdBy` NOT NULL, `*By` inline
  `"user"("id")`) — including the two child tables, which the services populate.
- **Composite tenant FKs** (mirrors `20260703143904_composite-tenant-fks.sql`): the account/journal references
  are scoped by `companyId`, so a row in company A cannot point at another company's account/journal.
  `account`/`journal` get a trivially-unique `UNIQUE ("id","companyId")` (id is already the PK) to serve as the
  composite target; `prepaidSchedule.{prepaidAccountId,expenseAccountId}` and `recurringJournalTemplateLine.accountId`
  → `account("id","companyId")` (RESTRICT); `prepaidScheduleEntry.journalId` → `journal("id","companyId")` with
  PG15 column-list `ON DELETE SET NULL ("journalId")` (nulls only `journalId`, never the NOT NULL `companyId`).

**Deliberately NOT in Phase 0 — the two `periodCloseTaskDefinition` rows.** Registering a definition whose
`autoCheckKey` has no evaluator *fails closed*: `evaluateCloseChecklist`
(`apps/erp/app/modules/accounting/accounting.service.ts:1573`) synthesizes a `failing:true` check, and a
`required:true` Auto task then trips the `incomplete` close-gate branch (`:1621`) — blocking period close
until a user skips it. So the rows land **together with their evaluators** in Phase 5. (Verified: an unknown
key never throws — `computePeriodReadiness` runs a fixed 5-check array and ignores the definition rows.)

Verification (done): `pnpm --filter @carbon/checks test` (conformance gate) green; no `NUMERIC(x,y)`, no
`has_company_permission(`.

---

## Phase 1 — Zod models + barrel (`accounting.models.ts`, `index.ts`)

`apps/erp/app/modules/accounting/accounting.models.ts`:

1. Add `'Prepaid Amortization'`, `'Recurring Journal'` to the `journalEntrySourceTypes` array (`:468-490`) —
   keeps the TS mirror in sync with the DB enum or types drift.
2. `recurringJournalTemplateValidator` — `name` (min 1), `description` optional, `frequency`
   `z.enum(['Monthly','Quarterly','Annually'])`, `nextRunDate` (date string), `endDate` optional, `active`
   boolean; plus a `lines` array (accountId min 1, description optional, debit/credit `zfd.numeric` ≥ 0,
   sortOrder). Add a `.superRefine` enforcing Σdebit = Σcredit (mirror `postJournalEntry`'s tolerance 0.001)
   and ≥ 1 line.
3. `prepaidScheduleCancelValidator` — `{ id }`.
4. `journalEntryValidator` (existing) — add optional `autoReverseOn` date; refine `> postingDate` when present.
5. Purchase-invoice-line validator (locate the AP line validator) — add `isPrepaid` bool, `prepaidStartDate`,
   `prepaidMonths` int > 0; refine: when `isPrepaid`, require line type `'G/L Account'` + both params.

Export new validators/types from `apps/erp/app/modules/accounting/index.ts`.

**Verify:** `pnpm exec turbo run typecheck --filter=@carbon/erp` (needs `pnpm --filter erp typegen` first in a
fresh worktree — see AGENTS memory).

---

## Phase 2 — Depreciation proposal extraction (`accounting.service.ts`)

Extract the body of `routes/x+/accounting+/depreciation-runs.new.tsx`'s action (steps 2–9: next-period-end,
run-exists guard, tax toggle, fetch Active assets, last posted run, usage logs, `buildDepreciationLines`,
`insertDepreciationRun`) into:

```ts
export async function createDepreciationRunProposal(
  client: SupabaseClient<Database>,
  { companyId, userId }: { companyId: string; userId: string }
): Promise<{ data: { id: string; depreciationRunId: string } | null; error: ... | { message: string } | null }>
```

- Reuse existing helpers: `getNextPeriodEnd` / `buildDepreciationLines` (`accounting.utils.ts`),
  `insertDepreciationRun` (`accounting.service.ts:3838`), `companySettings.assetTaxDepreciationEnabled`.
- Return a discriminated result for "run already exists for this period" (no-op, not an error) so the job can
  skip silently and the route can flash. `createdBy = userId` (job passes `'system'`).
- **Rewire the route** `depreciation-runs.new.tsx` to call `createDepreciationRunProposal(client, {companyId, userId})`
  and map the result to its existing flashes/redirects — one code path, per the meta-spec never-parallel rule.

**Verify:** typecheck; manual — clicking "New" on `/x/accounting/depreciation-runs` still creates a Draft run.

---

## Phase 3 — Prepaid amortization services + `post-purchase-invoice`

`accounting.service.ts`:

- `createPrepaidSchedule(client, { companyId, purchaseInvoiceId, purchaseInvoiceLineId, description, prepaidAccountId, expenseAccountId, totalAmount, startDate, months, createdBy })`
  — inserts `prepaidSchedule` + precomputes `months` `prepaidScheduleEntry` rows via
  **`buildPrepaidScheduleEntries(totalAmount, months, startDate)`** (✅ shipped in this PR — `accounting.utils.ts`,
  tested): `floor(totalAmount/months)` whole cents each, leftover cents folded into the **final** entry so
  Σ = totalAmount exactly and **no entry is ever negative** (floor-based, so the final remainder is non-negative);
  `amortizationDate` = last day of each month from `startDate`. This service just persists what the helper returns.
  Stamp `createdBy` on both the schedule and every entry row (the migration makes `createdBy` NOT NULL on both).
- `getPrepaidSchedules(client, companyId, { status? })` — register rows with amortized-to-date (Σ entries with
  `journalId`) and remaining rollup; plus a GL tie-out helper: Σ remaining vs the prepaid account's GL balance
  at a period end.
- `generatePrepaidAmortizationJournals(client, { companyId })` — for each `prepaidScheduleEntry` with
  `amortizationDate <= today` AND `journalId IS NULL`: draft one journal (`sourceType:'Prepaid Amortization'`,
  Debit `expenseAccountId` / Credit `prepaidAccountId`, dimensions copied from the source line), dated the
  entry date, and **stamp `entry.journalId` with the draft's id in the SAME transaction as the draft insert.**
  This is the durable duplicate guard: stamping `journalId` at draft time (not at posting) means the
  `..._due_idx` partial index (`WHERE journalId IS NULL`) stops selecting the entry immediately, so an Inngest
  retry cannot create a second Draft journal for the same entry. Posting stays a separate human/approval step;
  whether a journal is Posted vs still Draft is read from the **journal's own status**, not inferred from
  `journalId` being NULL — the schedule completes when the last entry's journal reaches Posted. Belt-and-braces:
  the unique `(companyId, scheduleId, amortizationDate)` key still dedupes the entry rows themselves.
- `cancelPrepaidSchedule(client, { id, companyId, userId })` — only when no entry has a `journalId`; sets
  `status='Cancelled'`.

`post-purchase-invoice` edge fn (`packages/database/supabase/functions/post-purchase-invoice/index.ts`, `G/L Account`
case `:1673`, inside the Kysely trx at `:1746`): when `invoiceLine.isPrepaid`, debit
`accountDefaults.data.prepaymentAccount` instead of the line's expense account (credit `payablesAccount`
unchanged), and insert a `prepaidSchedule` (+ entries) capturing the line's expense account as
`expenseAccountId`, base-currency posted amount as `totalAmount`. **Coordination:** rebase on merged
#1030/#1031/#1036/#1047 state before touching this shared `post-*` surface; the branch is additive and gated on
`isPrepaid`. Regenerate `functions/lib/types.ts` (same `generate:types` run) so the edge fn sees the new columns.

**Verify:** `pnpm --filter @carbon/jobs test` (schedule math unit test — 12 months sums exactly, remainder in
month 12); manual AP invoice post with a prepaid line hits `prepaymentAccount`.

---

## Phase 4 — Recurring journal templates + auto-reversal service

`accounting.service.ts`:

- `get/insert/update/deactivateRecurringJournalTemplate(...)` — header + lines CRUD (delete-and-reinsert lines
  on update, per repo line-editor convention). Balance validated in the model (Phase 1). Populate the audit
  columns on **both** the template and its lines — the migration gives `recurringJournalTemplateLine` the full
  `createdBy`/`createdAt`/`updatedBy`/`updatedAt` set (`createdBy` NOT NULL), so pass `createdBy` on insert and
  `updatedBy` on the delete-and-reinsert update path.
- `generateRecurringJournals(client, { companyId })` — for each `active` template with `nextRunDate <= today`
  and (`endDate IS NULL` OR `nextRunDate <= endDate`): draft a journal dated `nextRunDate`
  (`sourceType:'Recurring Journal'`, lines from template), then advance `nextRunDate` via
  **`advanceRecurringDate(nextRunDate, frequency)`** (✅ shipped in this PR — `accounting.utils.ts`, tested;
  +1/+3/+12 months, day clamped to the target month's length); if the advanced date passes `endDate`, set
  `active=false`. Advance in the **same transaction** as the draft insert (idempotency under retry).
- `postDueJournalReversals(client, { companyId })` — for each Posted `journal` with `autoReverseOn <= today`
  and `reversedById IS NULL`: call the existing `reverseJournalEntry(client, id, {companyId, userId:'system'})`
  but dated `autoReverseOn` (not today — extend `reverseJournalEntry` with an optional `postingDate`, defaulting
  to today, so existing callers are unaffected). **Resolve the period for the posting date, not today:** the
  reversal is posted on `autoReverseOn` (a past-or-present catch-up date that can differ from today), so resolve/
  lazily create the period covering **`autoReverseOn`** via `getOrCreateAccountingPeriod(autoReverseOn, "accounting")`
  before posting — creating a period for *today* leaves the `autoReverseOn` period absent (or the trigger rejects
  the row for a date outside any active period). Period rules keyed on the `autoReverseOn` period: Open/Locked →
  post (reversal is an **accounting** source; the `"accounting"` arg already allows Locked); Closed → skip + log,
  retry next day (the `check_accounting_period_open` trigger backstops the closed case).

**Verify:** `pnpm --filter @carbon/jobs test` (frequency advance +1/+3/+12; endDate deactivation; reversal links
both ways).

---

## Phase 5 — Close-checklist integration (evaluators + registration, together)

`accounting.service.ts` `computePeriodReadiness` (`:1244`, the fixed `checks[]` at `:1427-1465`):

1. **Tighten** the existing `draft-depreciation` check: fail when **no** run's `periodEnd` falls in the period
   (proposal missing) **OR** a covering run has `status='Draft'` (proposed, unposted). Passes only when a
   covering run is Posted.
2. **Add** `prepaid-amortization` (Warning): fail when any `prepaidScheduleEntry` with `amortizationDate <=`
   period end lacks a posted `journalId`.
3. **Add** `recurring-journals` (Warning): fail when any `active` `recurringJournalTemplate` has
   `nextRunDate <=` period end (generation overdue).

Register the two new definitions **in the same PR as the evaluators** — three surfaces:

- Migration (new file, Phase 5): `INSERT INTO "periodCloseTaskDefinition" (...) SELECT c.id, d.* FROM company c
  CROSS JOIN (VALUES ('Prepaid amortization posted','Auto','prepaid-amortization',9,true,'Warning'),
  ('Recurring journals generated','Auto','recurring-journals',10,true,'Warning')) d(...) ... ON CONFLICT
  ("companyId","name") DO NOTHING WHERE EXISTS (SELECT 1 FROM "user" WHERE id='system')` — additive, matches
  `20260702044133`'s idempotent form (not the destructive wipe in `20260712142905`).
- `packages/database/supabase/functions/lib/seed.data.ts` `periodCloseTaskDefinitions` array (`:869`) — add the
  two objects so **new** companies get them.
- The `computePeriodReadiness` `checks[]` — the actual evaluators (above).

**Verify:** `pnpm --filter erp test` (evaluator unit tests: missing/Draft/Posted depreciation; due prepaid; due
template); manual — close drawer shows the two Auto tasks with drill links.

---

## Phase 6 — Inngest scheduled job

`packages/jobs/src/inngest/functions/scheduled/period-close-automation.ts` (pattern:
`update-exchange-rates.ts` — service-role client, per-company loop, `retries: 2`, daily cron `0 2 * * *`).
Four `step.run`s calling the Phase 2–4 services per company:

1. `createDepreciationRunProposal` — only for companies with `depreciationProposalsEnabled` and Active assets,
   catching up one ended period per day. `createdBy:'system'`.
2. `generatePrepaidAmortizationJournals`.
3. `generateRecurringJournals`.
4. `postDueJournalReversals`.

Register in `packages/jobs/src/inngest/functions/scheduled/index.ts` + the functions index.

**Verify:** `pnpm --filter @carbon/jobs test`; local Inngest dev trigger creates Draft runs + drafts + posts
due reversals; second fire is a no-op (idempotent).

---

## Phase 7 — Routes + UI

Under `apps/erp/app/routes/x+/accounting+/` (permissions `view/create/update/delete: "accounting"`):

- `recurring-journals*` (list / new / edit / `generate` action calling `generateRecurringJournals`), form with the
  balance-validated line editor reusing JE line components.
- `prepaid-schedules*` (register list with Σ-remaining vs GL tie-out header; detail drawer: monthly entries +
  posted-journal links; cancel action).

UI edits: purchase-invoice line form ("Prepaid" toggle on G/L lines → start date + months; badge); JE form
("Auto-reverse" toggle + date defaulting to day 1 of next month); depreciation-runs table ("Proposed" indicator
for `createdBy='system'`). Flash messages per `.ai/rules/flash-system.md`. Add nav entries.

**Verify:** `/test` skill on each new route; `pnpm run lint`; scoped typecheck; `/translate` for new i18n strings.

---

## Cross-cutting

- **Company backup/restore** (`.claude/rules/company-backup-restore.md`): add the four new tables to the
  enumerated set if that system lists tables explicitly — check when implementing Phase 3/4.
- **AGENTS.md sync**: update `apps/erp/app/modules/accounting/AGENTS.md` (new service fns + tables) and, if a
  fixed-asset/accounting rule names the "no scheduled job exists" fact, correct it.
- **Final gate:** migration applies twice idempotently; `generate:types`; scoped `typecheck`; `pnpm run lint`;
  `pnpm --filter @carbon/jobs test`; `pnpm --filter erp test`; targeted `/test`.

## Acceptance criteria → phase map

Spec ACs map: depreciation proposal + task-4 tighten → Phase 2/5/6; prepaid post + schedule + journals + tie-out
+ task → Phase 3/5/6; recurring generation + advance + endDate + task → Phase 4/5/6; auto-reversal + Locked/Closed
→ Phase 4/6; approval pass-through → inherited via `postJournalEntry` (Phase 3/4); Closed-period SQL rejection →
existing `check_accounting_period_open` trigger (no work); RLS zero-rows → Phase 0 (shipped); migration idempotent
+ gates green → Phase 0 shipped, rest per phase.
