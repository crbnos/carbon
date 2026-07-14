# Close Automation: Scheduled Depreciation, Prepaid Amortization, Recurring Journals, Auto-Reversing Accruals

> Status: in-progress (all open questions resolved pre-writing, per the updated spec-writing flow)
> Author: Claude (with Brad Barbin)
> Date: 2026-07-04
> Tracking issue: [crbnos/carbon#1039](https://github.com/crbnos/carbon/issues/1039)
> Parent: `.ai/specs/2026-07-03-public-company-readiness.md` (findings GAP-4.1, GAP-6) · `.ai/specs/2026-07-04-accounting-implementation-meta.md` (Phase 1)
> Depends on: `.ai/specs/2026-07-02-period-closing.md` (#1031 — close lifecycle + persisted checklist) · `.ai/specs/2026-07-04-document-approvals.md` (#1032 — JE approval gating)

## TLDR

One Inngest scheduled function — the **close-calendar job** — automates the four recurring period-end mechanics Carbon lacks: (1) **scheduled depreciation proposals** — Draft `depreciationRun`s created monthly for every company with due Active assets; posting stays human (**propose-only**, resolved by Brad 2026-07-04), (2) **prepaid-expense amortization** — AP invoice lines flagged prepaid post to the (currently dead) `accountDefault.prepaymentAccount` and spawn a straight-line `prepaidSchedule` whose monthly amortization journals the job drafts, (3) **recurring journal templates** — fixed-amount template header/lines with monthly/quarterly/annual frequency; the job drafts the journal and advances `nextRunDate`, and (4) **auto-reversing accruals** — an `autoReverseOn` date on manual JEs; on arrival the job posts the mirror reversal into the next period automatically via the existing `reversalOfId`/`reversedById` machinery. All generated journals carry new *accounting* source types (`Prepaid Amortization`, `Recurring Journal` — additive enum values) so they obey the period-close Locked/Closed matrix, and every close-checklist integration lands by **registering `periodCloseTaskDefinition` rows** (per the meta-spec coordination rule — never a parallel mechanism): seeded task 4's `draft-depreciation` auto-check tightens to "proposal generated **and** posted," and two new definitions register — "Prepaid amortization posted" and "Recurring journals generated." Accrual reversals need no task (justified below: the next period's existing draft-journals Blocker catches any failed auto-post).

## Problem Statement

Period close is now a real control (#1031), but the work that fills a close calendar is entirely manual:

- **Depreciation never proposes itself** (GAP-4.1). A controller must remember to open `/x/accounting/depreciation-runs`, click New, and post — every month, per company. `.ai/rules/fixed-asset-lifecycle.md` states it plainly: "no scheduled/cron job exists." Miss a month and seeded checklist task 4 only warns about *draft* runs — a run that was never created passes silently.
- **No prepaid-expense machinery** (GAP-6). `accountDefault.prepaymentAccount` has existed since `20230820020844_posting-groups.sql:52` and is selected into every posting-group view — but no posting path ever debits or amortizes it. An annual insurance invoice hits expense in full in month 1; the controller maintains the amortization spreadsheet NetSuite retired a decade ago.
- **No recurring journals** (GAP-6). Rent, insurance allocations, and standing management fees are re-keyed by hand monthly — the highest-volume source of JE typos an auditor samples.
- **No auto-reversing accruals** (GAP-6). A month-end accrual requires the controller to remember the manual reversal next month; forget it and the expense doubles. The `reversalOfId`/`reversedById` columns (`20260402000000_journal-entries.sql:44-45`) already model the linkage — nothing schedules it.

Only GR/IR accrual automation exists today. Verified: zero code hits for recurring/prepaid/accrual journal machinery in `apps/erp/app/modules/accounting/`.

## Proposed Solution

### The close-calendar job (one Inngest function, four steps)

A single scheduled function `period-close-automation` in `packages/jobs/src/inngest/functions/scheduled/period-close-automation.ts`, following the `update-exchange-rates` pattern (service-role client, per-company loop, `step.run` per concern, `retries: 2`). **Daily cron** (`0 2 * * *`), not monthly: each step is an idempotent "is anything due?" check, so a missed fire self-heals next day, quarterly/annual recurrences need no second schedule, and accrual reversals land on day 1 rather than waiting for a month-end tick. Rows created by the job stamp `createdBy = 'system'` (the seeded system user, `20230123004317_companies-rls.sql:76`).

| Step | Due condition | Action |
|---|---|---|
| 1. Depreciation proposal | Month M has ended and no `depreciationRun` with `periodEnd` = last day of M exists for a company with Active assets | Insert Draft run + lines via the same shared service the manual route uses |
| 2. Prepaid amortization | An Active `prepaidSchedule` has an entry with `amortizationDate <= today` and no `journalId` | Draft one amortization journal per due entry |
| 3. Recurring journals | An active `recurringJournalTemplate` has `nextRunDate <= today` | Draft the journal from template lines; advance `nextRunDate` by frequency |
| 4. Accrual reversal | A Posted journal has `autoReverseOn <= today` and `reversedById IS NULL` | **Post** the mirror reversal dated `autoReverseOn`, link both ways |

**Propose-only posture (Resolution 1, Brad 2026-07-04).** Steps 1–3 create **Draft** documents only; a human posts. Prepaid and recurring journals post through `postJournalEntry`, so #1032's journal-entry approval rules gate them automatically where configured. Depreciation-run posting keeps its existing route action in v1; extending `approvalDocumentType` with `'depreciationRun'` so run-posting parks behind an approval rule is a small additive follow-on to #1032 (see Open Questions). Step 4 is the deliberate exception: the reversal is a deterministic mirror of an already-approved entry — SAP (FBS1/F.81) and NetSuite both post the reversal automatically — so it posts without a human touch, respecting the period matrix below.

### 1. Scheduled depreciation proposals (GAP-4.1)

Extract the body of `routes/x+/accounting+/depreciation-runs.new.tsx` into a shared service `createDepreciationRunProposal(client, { companyId, userId })` in `accounting.service.ts` (reusing `getNextPeriodEnd`, `buildDepreciationLines`, the tax-depreciation toggle, and the existing "run already exists for this period" guard). The route and the job call the same function — one code path, per the meta-spec's never-parallel rule. The job proposes runs up to the most recently *ended* month only (never a future period), catching up one period per day if several are missing.

**Checklist task 4 tightens.** The `draft-depreciation` auto-check evaluator in `getPeriodCloseReadiness` currently only flags Draft runs. It becomes: *fail when no run whose `periodEnd` falls inside the period exists (proposal missing) OR such a run exists with `status = 'Draft'` (proposed, unposted)*. This is a semantics change to an existing evaluator, not a new task — the seeded definition row is untouched; its meaning is "proposal generated + posted."

Toggle: `companySettings.depreciationProposalsEnabled BOOLean DEFAULT true`. Default on — a Draft run is a deletable proposal with zero GL effect, and defaulting off would recreate the exact close-calendar risk GAP-4.1 names.

### 2. Prepaid-expense amortization (GAP-6)

**Flag at AP invoice entry.** A `G/L Account` purchase invoice line gains a prepaid toggle plus schedule parameters (amortization start date, number of months; method fixed to Straight Line in v1). On `post-purchase-invoice`, a flagged line debits the **prepaid account** — `accountDefault.prepaymentAccount`, activated at last — instead of the line's expense account, and creates a `prepaidSchedule` capturing the line's expense account as the amortization target. Amounts are the line's **base-currency** posted amount (`journalLine.amount` is already base), so schedules never carry FX exposure.

**Schedule → entries → journals.** Schedule creation precomputes one `prepaidScheduleEntry` per month: straight-line `totalAmount / months` rounded to 2dp, remainder folded into the final entry so the schedule always sums exactly. Each due entry gets a Draft journal (Debit expense / Credit prepaid, `sourceType: 'Prepaid Amortization'`, dimensions copied from the source invoice line); posting stamps `journalId` on the entry and completes the schedule when the last entry posts.

**Register report.** A prepaid schedule register page lists schedules with original amount, amortized-to-date, and remaining balance, with a header tie-out row: Σ remaining balances vs. the GL balance of the prepaid account as of the selected period end. Any difference (manual postings to the account) renders as a highlighted reconciling amount — the tie-out auditors ask for.

**New checklist definition:** "Prepaid amortization posted" — Auto, `autoCheckKey: 'prepaid-amortization'`, Warning. Fails when any entry with `amortizationDate` on/before the period end lacks a posted journal.

### 3. Recurring journal templates (GAP-6)

`recurringJournalTemplate` (name, description, frequency `Monthly | Quarterly | Annually`, `nextRunDate`, optional `endDate`, `active`) + `recurringJournalTemplateLine` (account, description, fixed debit/credit amount, dimensions v2). Balance is validated at template save (Σ debits = Σ credits) — the same rule `postJournalEntry` enforces. The job drafts a journal dated `nextRunDate` with `sourceType: 'Recurring Journal'`, then advances `nextRunDate` by the frequency (`endDate` passed ⇒ template deactivates). Generated drafts are ordinary journal entries: edited, posted (through JE approvals where a rule matches), or deleted via the existing JE surface.

Management UI: a "Recurring Journals" section in accounting — templates table + `ValidatedForm` header with a line editor reusing the journal-entry line components, plus a "Generate now" row action calling the same generation service as the job.

**New checklist definition:** "Recurring journals generated" — Auto, `autoCheckKey: 'recurring-journals'`, Warning. Fails when any active template's `nextRunDate` is on/before the period end (generation overdue). *Posting* the generated drafts is deliberately not re-checked here — the existing seeded **draft-journals Blocker** (task 2) already fails on any Draft journal dated in the period; the layering keeps each evaluator single-purpose.

### 4. Auto-reversing accruals (GAP-6)

One nullable column: `journal.autoReverseOn DATE`. The JE form exposes an "Auto-reverse" toggle that defaults the date to day 1 of the month following the posting date (editable, must be > postingDate — CHECK constraint). Set while Draft, so posted-record immutability is never touched.

When `autoReverseOn` arrives, the job posts the reversal through the existing `reverseJournalEntry` machinery: mirror lines, `reversalOfId` on the new entry, original transitions `Posted → Reversed` with `reversedById` — exactly the transition the immutability trigger permits. Period rules, in order:

- Reversal period **Open**: post dated `autoReverseOn`.
- Reversal period **Locked**: still post — the reversal is an *accounting* source (`getOrCreateAccountingPeriod(…, source: "accounting")`), which the Locked matrix allows.
- Reversal period **Closed** (pathological — closing N+1 with a pending reversal implies N closed with it too): do **not** post; skip and retry daily, surfacing in the job log. The close boundary is never punched.
- Reversal period doesn't exist yet: lazy-created by `getOrCreateAccountingPeriod`, as today.

**No checklist task — justified.** The pending reversal belongs to period N+1, not the period being closed; on day 1 it auto-posts, so by the time N+1's close begins there is nothing pending by construction. The one failure mode — the job drafts nothing, but a `reverseJournalEntry` failure could leave the original un-reversed — is caught because the *original* entry still shows `autoReverseOn` past-due with `reversedById IS NULL`, and any manually-intervened Draft reversal in N+1 trips that period's draft-journals Blocker. Adding a task would duplicate an existing control.

### Source types and the period matrix (scope item 6)

Two additive enum values (the established pattern — `20260504000000:22-25`, `20260524143826:2-3`, `20260630093809:182-184`):

```sql
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Prepaid Amortization';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Recurring Journal';
```

Depreciation proposals keep `'Asset Depreciation'`; accrual reversals inherit the source entry's type (`'Manual'`) per existing `reverseJournalEntry` behavior. All four flows are **accounting** sources under #1031's matrix: post into Open or Locked periods (Locked human posts still require `update: accounting`), never into Closed — service gate plus the DB trigger backstop, which binds the service-role job too.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Automation posture | Propose-only: job drafts, humans post (accrual reversal is the sole auto-post) | **Resolved (Brad 2026-07-04).** Keeps a human control point on every new GL posting; drafted journals flow through #1032 approvals where a rule matches; reversals are deterministic mirrors of approved entries (SAP F.81 / NetSuite behavior) |
| Job shape | One Inngest function, daily cron, one `step.run` per concern | `update-exchange-rates` precedent; daily + idempotent due-checks self-heal missed fires and cover quarterly/annual frequencies without extra schedules |
| Depreciation code path | Extract `createDepreciationRunProposal` shared by route + job | Meta-spec rule: register into existing mechanisms, never build parallel ones |
| Task-4 auto-check | Extend `draft-depreciation` evaluator to "run exists AND posted" | A never-created run must fail the check; same definition row, no new task |
| Prepaid GL flow | Debit `prepaymentAccount` directly at invoice posting (no post-then-reclass) | One journal, no expense flicker in reports; NetSuite amortization-schedule behavior; finally activates the dead default |
| Prepaid schedule grain | Precomputed `prepaidScheduleEntry` rows, remainder in final entry | Register report + GL tie-out need per-month persisted amounts; rounding is settled once at creation |
| Prepaid currency | Schedules amortize the base-currency posted amount | `journalLine.amount` is already base; avoids FX churn inside schedules |
| Recurring v1 scope | Fixed amounts, no dimensions/allocation formulas | GAP-6 names fixed-amount templates as v1; drafts are editable before posting anyway |
| Accrual reversal storage | `journal.autoReverseOn` column; no pending-reversals table | The (autoReverseOn, reversedById) pair fully encodes "pending"; reuses `reverseJournalEntry` + Posted→Reversed transition unchanged |
| Reversal into Locked period | Allowed (accounting source, service-role) | Matches #1031's matrix — Locked blocks operational sources only; a day-1 reversal is exactly the adjustment Locked exists for |
| Checklist integration | Register 2 new `periodCloseTaskDefinition` system rows + tighten 1 evaluator; no task for reversals | Meta-spec coordination rule (#1039 registers, never re-invents); reversal failure is covered by N+1's draft-journals Blocker |
| H1 Multi-tenancy | All 3 new tables: `companyId`, composite PK `("id","companyId")`, `id('prefix')` defaults (`ppd`/`ppde`/`rjt`/`rjtl`) | Convention; `depreciationRun` keeps its legacy `xid()` PK — no churn |
| H2 Service shape | All new functions in `accounting.service.ts`, `(client, …) → {data, error}`, never throw | `.ai/rules/conventions-services.md`; no new service files |
| H3 RLS | Four policies per new table gated on `accounting_view/create/update/delete` employee permissions | `depreciationRun` policy precedent (`20260524143827:280-289`) |
| H4 Permissions | Routes: `view/create/update/delete: "accounting"`; job uses service role | Matches depreciation-run and JE routes |
| H5 Forms | `ValidatedForm` + zod validators in `accounting.models.ts` + route actions with `intent` | Repo convention |
| H6 Module layout | Models/services extend the existing accounting module files; UI under `accounting/ui/` | One service/models file per module |
| H7 Backward compat | Enum values additive; `purchaseInvoiceLine` + `journal` + `companySettings` columns nullable/defaulted; no signature breaks (`createDepreciationRunProposal` is an extraction) | Existing callers unaffected; `post-purchase-invoice` change is behavior-gated on the new flag |

## Data Model Changes

One migration (`pnpm db:migrate:new close-automation`), then `pnpm run generate:types`:

```sql
-- Additive source types
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Prepaid Amortization';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Recurring Journal';

-- Auto-reversing accruals
ALTER TABLE "journal" ADD COLUMN IF NOT EXISTS "autoReverseOn" DATE;
ALTER TABLE "journal" ADD CONSTRAINT "journal_autoReverseOn_check"
  CHECK ("autoReverseOn" IS NULL OR "autoReverseOn" > "postingDate");

-- Depreciation proposal toggle
ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS
  "depreciationProposalsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Prepaid flag + schedule params on AP invoice lines (G/L Account lines only)
ALTER TABLE "purchaseInvoiceLine"
  ADD COLUMN IF NOT EXISTS "isPrepaid" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "prepaidStartDate" DATE,
  ADD COLUMN IF NOT EXISTS "prepaidMonths" INTEGER,
  ADD CONSTRAINT "purchaseInvoiceLine_prepaid_check" CHECK (
    "isPrepaid" = false OR
    ("invoiceLineType" = 'G/L Account' AND "prepaidStartDate" IS NOT NULL
      AND "prepaidMonths" IS NOT NULL AND "prepaidMonths" > 0)
  );

CREATE TABLE IF NOT EXISTS "prepaidSchedule" (
  "id" TEXT NOT NULL DEFAULT id('ppd'),
  "companyId" TEXT NOT NULL,
  "purchaseInvoiceId" TEXT,                      -- source document
  "purchaseInvoiceLineId" TEXT,
  "description" TEXT NOT NULL,
  "prepaidAccountId" TEXT NOT NULL,              -- resolved prepaymentAccount (by id, per control-account lesson)
  "expenseAccountId" TEXT NOT NULL,              -- amortization target from the invoice line
  "totalAmount" NUMERIC NOT NULL,                -- base currency
  "startDate" DATE NOT NULL,
  "months" INTEGER NOT NULL CHECK ("months" > 0),
  "method" TEXT NOT NULL DEFAULT 'Straight Line',
  "status" TEXT NOT NULL DEFAULT 'Active',       -- 'Active' | 'Complete' | 'Cancelled'
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "prepaidSchedule_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "prepaidSchedule_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "prepaidScheduleEntry" (
  "id" TEXT NOT NULL DEFAULT id('ppde'),
  "companyId" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "amortizationDate" DATE NOT NULL,              -- last day of each month
  "amount" NUMERIC NOT NULL,
  "journalId" TEXT REFERENCES "journal"("id"),   -- set when the drafted journal posts
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "prepaidScheduleEntry_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "prepaidScheduleEntry_schedule_date_key" UNIQUE ("companyId", "scheduleId", "amortizationDate")
);

CREATE TABLE IF NOT EXISTS "recurringJournalTemplate" (
  "id" TEXT NOT NULL DEFAULT id('rjt'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "frequency" TEXT NOT NULL DEFAULT 'Monthly',   -- 'Monthly' | 'Quarterly' | 'Annually'
  "nextRunDate" DATE NOT NULL,
  "endDate" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "recurringJournalTemplate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "recurringJournalTemplate_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "recurringJournalTemplateLine" (
  "id" TEXT NOT NULL DEFAULT id('rjtl'),
  "companyId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "description" TEXT,
  "debit" NUMERIC NOT NULL DEFAULT 0,
  "credit" NUMERIC NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "recurringJournalTemplateLine_pkey" PRIMARY KEY ("id", "companyId")
);

-- RLS: ENABLE + four policies per table gated on accounting_* employee
-- permissions, following the depreciationRun precedent (SELECT shown; INSERT/
-- UPDATE/DELETE analogous with create/update/delete permissions):
ALTER TABLE "prepaidSchedule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "prepaidSchedule" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
-- (same pattern for prepaidScheduleEntry, recurringJournalTemplate, recurringJournalTemplateLine)

-- Checklist registration (#1031 substrate — INSERT ... ON CONFLICT DO NOTHING per company,
-- plus seed-company for new companies): two new system definitions,
-- ordered after seeded task 4:
--   ('Prepaid amortization posted','Auto','prepaid-amortization','Warning', isSystem)
--   ('Recurring journals generated','Auto','recurring-journals','Warning', isSystem)
```

## API / Service Changes

`apps/erp/app/modules/accounting/accounting.service.ts` (+ zod in `accounting.models.ts`, barrel exports):

```ts
// Depreciation (extraction — route + job share it)
createDepreciationRunProposal(client, { companyId, userId })          // Draft run + lines; no-op if run exists

// Prepaids
createPrepaidSchedule(client, { companyId, invoiceLineId, ... })      // called from post-purchase-invoice
getPrepaidSchedules(client, companyId, { status? })                   // register, with remaining-balance rollup
generatePrepaidAmortizationJournals(client, { companyId })            // Draft JE per due entry (job step 2)
cancelPrepaidSchedule(client, { scheduleId, companyId, userId })      // only while no entry posted

// Recurring journals
get/insert/update/deactivateRecurringJournalTemplate(...)             // template + lines CRUD
generateRecurringJournals(client, { companyId })                      // Draft JEs due, advance nextRunDate (job step 3)

// Accrual reversals
postDueJournalReversals(client, { companyId })                        // wraps reverseJournalEntry per due journal (job step 4)

// Evaluators (extend getPeriodCloseReadiness)
//   draft-depreciation  → fails when no run covers the period OR covering run is Draft
//   prepaid-amortization → fails on due entries without a posted journal
//   recurring-journals   → fails when an active template's nextRunDate <= period end
```

Callers to update:

- `post-purchase-invoice` edge function — flagged lines debit `prepaymentAccount` (resolved to an account id via the posting-group views) instead of the expense account; call `createPrepaidSchedule`. **Coordination:** this touches the shared `post-*` surface (meta-spec rule for #1030/#1031/#1036/#1047) — rebase on their merged state, never run concurrently.
- `journalEntryValidator` / JE form action — accept `autoReverseOn`.
- New Inngest function registered in `packages/jobs/src/inngest/functions/scheduled/index.ts` + functions index.

Routes (under `routes/x+/accounting+/`): `recurring-journals*` (list/new/edit/generate), `prepaid-schedules*` (register list + detail drawer with entries and tie-out, cancel action).

## UI Changes

- **Purchase invoice line form**: "Prepaid" toggle on G/L Account lines revealing start date + months; badge on flagged lines.
- **Prepaid schedule register** (`/x/accounting/prepaid-schedules`): table (source invoice, accounts, total, amortized, remaining, status), Σ-remaining vs GL prepaid-account balance tie-out header, drawer with monthly entries + posted-journal links.
- **Recurring journals** (`/x/accounting/recurring-journals`): templates table (frequency, next run, active), form with line editor (balance-validated), "Generate now" action.
- **Journal entry form**: "Auto-reverse" toggle + date (defaults to day 1 of next month); Reversed originals already render via existing status badges.
- **Depreciation runs table**: job-created Draft rows appear with a "Proposed" indicator (`createdBy = 'system'`).
- **Close drawer**: the two new Auto tasks render via #1031's existing checklist UI with drill links (due prepaid entries, overdue templates). No new mechanism.
- Flash messages on all actions per `.ai/rules/flash-system.md`.

## Acceptance Criteria

- [ ] With Active assets and no run for the just-ended month, the daily job creates exactly one Draft `depreciationRun` (correct `periodEnd`, lines matching `buildDepreciationLines`, `createdBy = 'system'`); a second firing creates nothing; `companySettings.depreciationProposalsEnabled = false` suppresses it; posting stays manual via the existing route.
- [ ] Checklist task 4 fails when no run covers the period, fails while the covering run is Draft, and passes once it posts.
- [ ] Posting an AP invoice with a line flagged prepaid (12 months) debits the configured `prepaymentAccount` — not the expense account — and creates a `prepaidSchedule` with 12 entries summing exactly to the line's base amount (rounding remainder in month 12).
- [ ] The job drafts an amortization journal (`sourceType 'Prepaid Amortization'`, Debit expense / Credit prepaid) for each due entry; posting it stamps `journalId` and the register's remaining balance ties to the GL prepaid account; the "Prepaid amortization posted" task fails until due entries post.
- [ ] A monthly template with `nextRunDate` today yields one Draft journal (`sourceType 'Recurring Journal'`, lines matching the template) and `nextRunDate` advances one month (quarterly: +3, annually: +12); a template past `endDate` deactivates; the "Recurring journals generated" task fails while a due template hasn't generated.
- [ ] A posted JE with `autoReverseOn = day 1 next period` is automatically reversed on that date: mirror entry posted with `reversalOfId`, original `Posted → Reversed` with `reversedById`; posting succeeds when the reversal period is Locked, is skipped-and-retried when Closed, and lazy-creates a missing period.
- [ ] Generated prepaid/recurring drafts posted through `postJournalEntry` park behind a configured #1032 journal-entry approval rule like any manual JE.
- [ ] Direct SQL insert of a `'Prepaid Amortization'` journal into a Closed period is rejected by the #1031 trigger (accounting sources respect the matrix).
- [ ] RLS: a user without `accounting_view` reads zero rows from all four new tables.
- [ ] Migration applies idempotently twice; `pnpm run generate:types`, scoped `typecheck`, and `pnpm run lint` pass; `pnpm --filter @carbon/jobs test` passes.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `post-purchase-invoice` edit collides with in-flight #1030/#1031/#1036/#1047 work on the shared `post-*` surface | Med | Meta-spec coordination rule: rebase on merged state; prepaid branch is additive and gated on `isPrepaid` |
| Draft-run proposals surprise companies mid-close ("who created this?") | Low | "Proposed"/system attribution in the UI; settings toggle; drafts have zero GL effect |
| Auto-posted reversal fails repeatedly (e.g. account deactivated) and silently retries forever | Med | Job logs per-journal errors; past-due `autoReverseOn` with `reversedById IS NULL` is queryable — surface as a badge on the JE list in v1.1 if it occurs in practice |
| Rounding drift between schedule entries and GL | Low | Remainder-in-final-entry at creation; entries are immutable once journaled |
| Duplicate generation if the job fires twice (Inngest retry) | Med | Idempotency by construction: unique (schedule, date) entry key, `nextRunDate` advance in the same transaction as the draft insert, run-exists guard, `reversedById` check |
| Prepaid flag misuse on inventory-linked lines | Low | CHECK constraint restricts to `G/L Account` lines |

## Open Questions

> Resolutions below were settled with Brad before writing (grill 2026-07-04); one scope question remains open.

- [x] **Auto-post depreciation or propose-only?** — **Resolved (Brad, 2026-07-04): propose-only.** The scheduler creates Draft runs; posting stays human and flows through document approvals (#1032) where a rule matches. Task 4's auto-check reflects "proposal generated + posted."
- [x] **Prepaid v1 method scope** — Straight-line only, flagged at AP invoice line entry, debiting `prepaymentAccount` directly at posting; custom curves/usage-based deferred.
- [x] **Recurring template v1 scope** — Fixed amounts, monthly/quarterly/annual, Draft output; formulas/allocations/dimensions deferred (drafts are editable pre-post).
- [x] **Accrual reversal mechanism** — Flag on the manual JE (`autoReverseOn`), auto-posted day 1 of the next period via existing `reversalOfId` machinery; posts under Locked (accounting source), never under Closed.
- [x] **Checklist integration** — Register definitions on the #1031 substrate only: tighten `draft-depreciation`, add `prepaid-amortization` + `recurring-journals`; no task for accrual reversals (next period's draft-journals Blocker covers the failure mode).
- [x] **Source types** — Additive `journalEntrySourceType` values `'Prepaid Amortization'` and `'Recurring Journal'`; both classified accounting sources under the period matrix.
- [x] **Depreciation-run posting behind approvals?** — Resolution 1 says run posting "flows through #1032 where a rule matches," but #1032's v1 document types are JE/payment/invoice/memo — depreciation runs post via their own route, not `postJournalEntry`. Extend `approvalDocumentType` with `'depreciationRun'` in this spec (small additive PO-pattern wiring), or defer to a #1032 follow-up and rely on `update: accounting` permission in v1? Affects scope coordination with #1032's in-flight plan. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Extend `approvalDocumentType` with `'depreciationRun'` in THIS workstream — amount = run total, reusing the engine's tiers and no-self-approval. Back out to `update: accounting`-only at plan stage if the engine extension crowds v1.

## Changelog

- 2026-07-04: Created — readiness findings GAP-4.1 + GAP-6 (`2026-07-03-public-company-readiness.md`), Phase 1 of the remediation roadmap; propose-only posture resolved by Brad 2026-07-04. Builds on #1031's close checklist (registers definitions, per the meta-spec coordination rule) and #1032's approval engine; activates the dormant `accountDefault.prepaymentAccount`.
- 2026-07-04: Remaining open questions resolved under the program ambition heuristic (ambitious scope now; back-out valves at plan stage).
