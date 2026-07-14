# Accounting Cutover & Activation

> Status: in-progress
> Author: Claude (with Brad Barbin)
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1057
> Implements: `.ai/plans/2026-07-03-public-company-readiness-roadmap.md` §Cutover (runbook followed verbatim)
> Depends on: `.ai/specs/2026-07-02-period-closing.md` (close lifecycle + `journal_check_period_open` trigger) — activation cannot ship before it lands
> Related: `.ai/specs/2026-07-03-public-company-readiness.md` (resolved: "accounting is a switch" does NOT survive)

## TLDR

`companySettings.accountingEnabled` is a temporary internal feature flag, resolved on 2026-07-03 to never become a product concept. This spec builds the machinery that retires it: a **one-way, per-company activation event** (config-completeness check → opening-balance wizard → permissioned confirmation) that posts an opening trial balance as a new `'Opening Balance'` journal dated cutover − 1 day, stamps `company.accountingActivatedAt/By`, locks `baseCurrencyCode` and `fiscalYearSettings`, generates the fiscal year's periods, and **closes every pre-cutover period** so the period-close trigger guarantees empty pre-history — the opening journal is the only bridge from the past. New companies at GA activate from creation via `seed-company` with a zero ledger. Once every active company carries `accountingActivatedAt`, one PR removes the enumerated `accountingEnabled` reads and a follow-up migration drops the column.

## Problem Statement

- Nine posting edge functions, three job-costing DB functions, and fourteen ERP app files branch on `accountingEnabled`. When the flag is off, operational documents post inventory/item ledgers but **no GL** — flipping the flag later would leave a company with stock and invoices that have no accounting history, and nothing stops a backdated document from then generating GL into periods that predate real books.
- There is no way for an existing company to *start* accounting correctly: no opening balances, no assertion that subledgers tie to the GL on day one, no lock on the currency/fiscal settings the ledger is denominated in.
- `seed-company` creates companies with `accountingEnabled = false` (column default); at GA new companies must get accounting always-on from creation.
- The GA gate (roadmap §Cutover) requires cutover tooling "shipped and exercised on at least two internal companies" before the flag can be removed. That tooling does not exist.

## Proposed Solution

### 1. One-way activation event

A per-company, permissioned, irreversible event, exposed as a wizard at `/x/accounting/activation`. Requires `accounting_update` (`requirePermissions({ update: "accounting" })`) plus an explicit typed confirmation (the company name), because it is one-way: there is no deactivation path, by design.

**Config-completeness check** (`getActivationReadiness`) — all must pass before the wizard advances past step 1:

| Check | Passes when |
|---|---|
| Chart of accounts | ≥ 1 posting account exists for the company |
| Account defaults | The company's `accountDefault` row exists and **every referenced default account column is set** and resolves to an active account |
| Fixed-asset classes | Every active `fixedAssetClass` has its asset + accumulated-depreciation accounts set (only when assets exist) |
| Fiscal settings | `fiscalYearSettings` row exists; user confirms `startMonth` in the wizard (it locks at activation) |
| Base currency | `company.baseCurrencyCode` set (locks at activation) |
| Tax codes | Every active customer/supplier has a tax code assigned — enforced only when the multi-jurisdiction tax spec is live for the company; otherwise informational |
| Bank accounts | Every active `bankAccount` is GL-linked (has its GL account set) |
| Cutover date | First day of a fiscal period (derived from `startMonth`) — see §3 |

**What activation does**, in one orchestrated server transaction (order matters — the opening journal must post *before* its period closes):

1. Re-run readiness + opening-balance validations server-side (never trust the wizard's client state).
2. Generate the cutover fiscal year's periods via the period-closing spec's `createFiscalYearPeriods`, plus the single prior period containing cutover − 1 day if not already present.
3. Post the opening-balance Draft journal (§2) through `postJournalEntry` (source `"accounting"`), dated cutover − 1.
4. **Close all periods with `endDate` < cutover date** — a dedicated `closePreCutoverPeriods` bulk path (see Design Decisions: it bypasses the close checklist because these periods are empty except the opening journal). The `journal_check_period_open` trigger then guarantees pre-history stays empty: no retroactive GL from old operational documents, ever.
5. Stamp `company.accountingActivatedAt = now()`, `accountingActivatedBy = userId`, `accountingCutoverDate = cutoverDate`.
6. Set `companySettings.accountingEnabled = true` — the mechanical bridge until flag retirement (§5); all posting paths turn on.
7. Write the audit log entry for the activation event (§6).

From `accountingActivatedAt` forward, a `SECURITY DEFINER` trigger rejects updates to `company.baseCurrencyCode` and to `fiscalYearSettings.startMonth` (the ledger's denomination and calendar are frozen facts once books exist).

### 2. Opening-balance wizard

The wizard builds a **Draft journal** — new `journalEntrySourceType` value `'Opening Balance'`, `postingDate` = cutover − 1 day — as the proposed opening trial balance. The Draft journal *is* the wizard state: editable via the existing journal-entry line editor, no parallel staging tables.

**Proposed lines** (each section regenerable independently; proposals are suggestions the user can edit):

| Section | Source | Lines proposed |
|---|---|---|
| Inventory | `costLedger`/`itemCost` valuation as of cutover (existing `get_inventory_value_by_location` totals, grouped by posting-group inventory account) | Dr each inventory account for its valuation total |
| AR | Open sales-invoice balances via `get_ar_open_by_customer` as of cutover − 1 | Dr AR control account(s). Post-tax-spec: net + tax split (revenue-side detail stays in the prior system; the split populates the tax ledger's opening liability); pre-tax-spec: gross to control |
| AP | Open purchase-invoice balances via `get_ap_open_by_supplier` as of cutover − 1 | Cr AP control account(s), same net + tax split rule |
| Fixed assets | The `fixedAsset` register: Σ `acquisitionCost` and Σ `accumulatedDepreciation` per `fixedAssetClass` | Dr class asset account; Cr class accumulated-depreciation account |
| Everything else | Manual entry (cash, loans, equity, accruals) | User-entered rows + a live **remaining-to-balance** line the wizard maintains and the user must consciously assign to a real account (typically opening equity) before validation |

**Validations** — all must pass before the Activate button enables, and are re-run inside the activation transaction:

1. **Journal balances**: Σ signed line amounts = 0 (± 0.01).
2. **AR/AP tie-outs**: because pre-cutover GL is empty by construction, the draft journal's control-account lines *are* the GL side. The validation compares Σ draft lines on the AR (resp. AP) control accounts against the subledger totals from `get_ar_open_by_customer`/`get_ap_open_by_supplier` as of cutover − 1 — the same subledger arithmetic `get_ar_tie_out`/`get_ap_tie_out` use, so the first real tie-out run after activation passes by construction. Variance > 0.01 blocks.
3. **Inventory valuation vs GL**: Σ draft lines on inventory accounts must equal the `costLedger`/`itemCost` valuation total per account. Variance > 0.01 blocks.
4. **Fixed-asset register vs GL**: draft asset/accumulated-depreciation lines must equal register sums per class. Variance > 0.01 blocks (skipped when no assets exist).

**Alternative path — prior-system closing TB (CSV import)**: instead of section-by-section proposals, import the old GL's closing trial balance as CSV (`accountNumber, description, debit, credit`), mapped to Carbon accounts by account number with an inline mapping step for misses. This *replaces the proposal step only* — the same four validations run unchanged, which means open AR/AP invoices and inventory quantities/costs **must already be migrated into Carbon** (via the existing CSV import system) before activation, so the subledger side of each tie-out exists. The TB is the assertion; Carbon's subledgers are the evidence. A TB that doesn't tie is a data-migration bug surfaced *before* activation, not after.

### 3. Cutover date: fiscal-period start only

**RESOLVED (Brad, 2026-07-04): cutover happens only at a fiscal-period start.** The wizard's date picker offers only first-of-period dates.

Mid-year cutovers (any period start that isn't period 1) are supported, but a **YTD P&L reload is out of scope for v1**: the opening journal is balance-sheet-shaped, and the prior system's YTD net income arrives collapsed inside the manual equity section (current-year-earnings line), not as per-account P&L history. Consequence, documented in the wizard: Carbon's income statement shows post-cutover activity only for the stub year; YTD comparatives for that year live in the prior system. **v2 workaround (deferred)**: one opening journal per elapsed period of the cutover year, restoring monthly P&L granularity — the `'Opening Balance'` source type and validation machinery already accommodate it.

### 4. New-company path at GA

`seed-company` activates accounting at creation: after seeding COA, `accountDefault`, `fiscalYearSettings`, and the `PRIMARY` book (Phase 0 schema seed), it stamps `accountingActivatedAt = now()`/`accountingActivatedBy = userId`, sets `accountingCutoverDate` = first day of the creation period, sets `accountingEnabled = true`, generates the current fiscal year's periods, and closes periods that end before the creation period (same empty-pre-history invariant). **No opening balances** — the ledger starts at zero on day one; no wizard, no tie-outs. Until the GA gate is met this behavior sits behind a `SEED_ACCOUNTING_ACTIVE` env toggle so internal companies exercise it first.

### 5. Flag retirement

**Complete reader inventory of `accountingEnabled`** (verified by grep, 2026-07-04 — the removal PR checklist):

- **Edge functions** (`packages/database/supabase/functions/`): `post-receipt`, `post-shipment`, `post-purchase-invoice`, `post-sales-invoice`, `post-payment`, `post-memo`, `issue`, `close-job`, `post-production-event`.
- **DB functions** (latest definitions): `backflush_job_materials` + `complete_job_to_inventory` (`20260630092517_job-costing-item-dimension.sql`), `sync_finish_job_operation` (`20260511120000_backflush-job-materials.sql`).
- **ERP app**: `modules/settings/settings.service.ts`; `modules/accounting/ui/useAccountingSubmodules.tsx`; `modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTree.tsx`; `modules/invoicing/ui/Dashboard/InvoicingDashboard.tsx`; `modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader.tsx`; `modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceHeader.tsx`; routes `x+/invoicing+/_index.tsx`, `receivables.tsx`, `receivables.adjust.tsx`, `payables.tsx`, `payables.adjust.tsx`, `x+/sales-invoice+/$invoiceId.status.tsx`, `x+/purchase-invoice+/$invoiceId.status.tsx`, `x+/settings+/accounting.tsx`.
- **Generated** (fall out of `pnpm run generate:types` after the drop migration): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`, `packages/database/supabase/functions/lib/types.ts`.
- **Schema**: `20260508000000_accounting-enabled.sql` (adds the column); docs language in `docs/content/docs/reference/accounting.mdx` (rewritten at GA — accounting is not optional).

**Retirement sequence** (roadmap §Cutover step 5 + GA gate):

1. GA gate met: Phase ∅ fully landed; Phase 0 fully landed; cutover tooling exercised end-to-end on **at least two internal companies**.
2. Every active company has `accountingActivatedAt` set (verified by query; stragglers are cut over or archived).
3. **Removal PR**: delete every `accountingEnabled` read above — edge functions and DB functions treat accounting as unconditionally on; ERP surfaces gate on `accountingActivatedAt IS NOT NULL` where a gate is still meaningful (activation wizard entry) or drop the branch entirely. `settings+/accounting.tsx` loses the flag; the wizard is the only "turn on accounting" surface.
4. **Follow-up migration** drops `companySettings.accountingEnabled` + re-runs `generate:types`.

### 6. Audit posture

The activation event, the opening journal, the config-lock trigger installs/rejections, and every pre-cutover period close are **audit-logged** (audit log system, `.ai/rules/audit-log-system.md`; Phase 0 Spec A makes the accounting trail synchronous, append-only, immutable). `accountingCutoverDate` is the start of auditable history in Carbon — anything earlier lives in the prior system's records under its retention policy, and the roadmap's "first close" step (parallel-run TB comparison at month 1) is the migration's audit evidence. The opening journal is itself immutable once posted (period-closing fold-in) and repairable only by reversal into an open period.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Multi-tenancy | **No new tables.** New columns on existing `company` (single-col PK, legacy); wizard state = the Draft `'Opening Balance'` journal + `journalLine` rows | Heuristic satisfied by inheritance; a staging table would duplicate the journal editor and need its own RLS/audit for zero gain |
| 2 | Service shape | `getActivationReadiness` / `buildOpeningBalanceProposal` / `validateOpeningBalance` / `activateAccounting` / `closePreCutoverPeriods` in `accounting.service.ts`, `(client, ...)` → `{data, error}`, never throw | `.ai/rules/conventions-services.md`; one module service file |
| 3 | RLS coverage | No new tables ⇒ no new policies; `company` activation columns writable only via the service path (existing company UPDATE policy + lock trigger backstop) | Trigger is `SECURITY DEFINER` so service-role writers are equally bound |
| 4 | Permission scoping | Wizard route `requirePermissions({ update: "accounting" })`; activation additionally demands typed company-name confirmation | Matches fiscal-year-settings and journal-posting precedent (period-closing spec); one-way events need friction, not a new RBAC tier (ask-first) |
| 5 | Form pattern | `ValidatedForm` + zod validators (`accounting.models.ts`) + route actions with `intent` (`propose` \| `import-tb` \| `validate` \| `activate`) | `settings+/accounting.tsx` precedent |
| 6 | Module layout | Everything in `apps/erp/app/modules/accounting/` (models/service/ui) + routes under `x+/accounting+/` | No scattering; activation is an accounting concern |
| 7 | Backward compatibility | Additive migration (enum value + nullable columns + triggers). Flag semantics unchanged until the removal PR; `seed-company` change env-gated until GA. Posting edge functions untouched by this spec | FROZEN surfaces unaffected; retirement is its own reviewed PR with the §5 checklist |
| 8 | One-way | No deactivation, no un-activation, ever | A ledger that can be switched off is the exact posture resolved against on 2026-07-03; reversal would orphan posted GL |
| 9 | Opening journal placement | Dated cutover − 1, **posted before** pre-cutover periods close (activation step ordering) | The close trigger would reject it afterward; closing behind it makes it the unique bridge — invariant by construction, not convention |
| 10 | Pre-cutover closes bypass the checklist | Dedicated `closePreCutoverPeriods` bulk path: stamps `closeStatus='Closed'`, `closedAt/By`, audit-logs each period; skips `periodCloseTask` instantiation | The 9-task checklist is meaningless for periods that structurally contain at most one journal; sequential-close invariant preserved (closes run oldest-first) |
| 11 | Tie-out mechanics | Validate draft lines against subledger RPC totals (`get_ar_open_by_customer`/`get_ap_open_by_supplier`, inventory valuation, asset register) rather than teaching `get_ar_tie_out`/`get_ap_tie_out` to see Draft journals | RPCs stay Posted-only (financial-reporting fold-in); post-activation tie-outs pass by construction |
| 12 | Grandfathering internal companies | Companies already running with `accountingEnabled = true` are backfilled by the migration: `accountingActivatedAt = now()`, `accountingActivatedBy` = system, `accountingCutoverDate` = start of earliest period containing a posted journal; no wizard, no tie-outs (their history is already in Carbon) | They never had a cutover; forcing a synthetic one would fabricate an opening journal on top of real history. Locks apply from backfill forward |
| 13 | CSV TB prerequisite | Open AR/AP invoices + inventory must be migrated before TB import; validations enforce it | The TB alone is unverifiable; tie-outs need the subledger side to exist |

## Data Model Changes

One idempotent migration (`pnpm db:migrate:new accounting-activation`), then `pnpm run generate:types`:

```sql
-- New journal source type (enum ADD VALUE pattern per database-migration-patterns)
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Opening Balance';

-- Activation stamp on company (legacy single-column PK table; additive columns only)
ALTER TABLE "company"
  ADD COLUMN IF NOT EXISTS "accountingActivatedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "accountingActivatedBy" TEXT REFERENCES "user"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "accountingCutoverDate" DATE;

-- Config locks: baseCurrencyCode + fiscal settings freeze once activated
CREATE OR REPLACE FUNCTION check_accounting_config_locked() RETURNS TRIGGER
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'company' THEN
    IF OLD."accountingActivatedAt" IS NOT NULL
       AND NEW."baseCurrencyCode" IS DISTINCT FROM OLD."baseCurrencyCode" THEN
      RAISE EXCEPTION 'baseCurrencyCode is locked: accounting was activated %', OLD."accountingActivatedAt";
    END IF;
    IF OLD."accountingActivatedAt" IS NOT NULL
       AND (NEW."accountingActivatedAt" IS DISTINCT FROM OLD."accountingActivatedAt"
         OR NEW."accountingActivatedBy" IS DISTINCT FROM OLD."accountingActivatedBy"
         OR NEW."accountingCutoverDate" IS DISTINCT FROM OLD."accountingCutoverDate") THEN
      RAISE EXCEPTION 'accounting activation is one-way and immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'fiscalYearSettings' THEN
    IF EXISTS (SELECT 1 FROM "company" c WHERE c."id" = NEW."companyId"
               AND c."accountingActivatedAt" IS NOT NULL)
       AND NEW."startMonth" IS DISTINCT FROM OLD."startMonth" THEN
      RAISE EXCEPTION 'fiscal year settings are locked: accounting is activated';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "company_accounting_config_locked" ON "company";
CREATE TRIGGER "company_accounting_config_locked"
  BEFORE UPDATE ON "company" FOR EACH ROW EXECUTE FUNCTION check_accounting_config_locked();
DROP TRIGGER IF EXISTS "fiscalYearSettings_accounting_config_locked" ON "fiscalYearSettings";
CREATE TRIGGER "fiscalYearSettings_accounting_config_locked"
  BEFORE UPDATE ON "fiscalYearSettings" FOR EACH ROW EXECUTE FUNCTION check_accounting_config_locked();

-- Grandfather backfill (Design Decision 12): companies already live on the flag
UPDATE "company" c SET
  "accountingActivatedAt" = NOW(),
  "accountingActivatedBy" = 'system',
  "accountingCutoverDate" = sub."cutover"
FROM (
  SELECT j."companyId", MIN(ap."startDate") AS "cutover"
  FROM "journal" j JOIN "accountingPeriod" ap ON ap."id" = j."accountingPeriodId"
  WHERE j."status" = 'Posted' GROUP BY j."companyId"
) sub
WHERE sub."companyId" = c."id" AND c."accountingActivatedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "companySettings" s
              WHERE s."id" = c."id" AND s."accountingEnabled" = true);
```

Flag-retirement follow-up migration (separate, after the §5 removal PR ships):

```sql
ALTER TABLE "companySettings" DROP COLUMN IF EXISTS "accountingEnabled";
```

## API / Service Changes

All in `apps/erp/app/modules/accounting/accounting.service.ts` (+ zod in `accounting.models.ts`):

```ts
getActivationReadiness(client, companyId)
// → { data: { checks: ReadinessCheck[]; cutoverDateOptions: string[] }, error }

buildOpeningBalanceProposal(client, { companyId, cutoverDate, section, userId })
// section: 'inventory' | 'ar' | 'ap' | 'fixedAssets' — (re)generates that section's
// lines on the company's Draft 'Opening Balance' journal (creates it if missing,
// dated cutoverDate − 1); idempotent per section (delete + reinsert its lines)

importOpeningTrialBalance(client, { companyId, cutoverDate, rows, userId })
// CSV path: replaces ALL proposal lines with mapped TB rows; unmapped accounts error

validateOpeningBalance(client, { companyId, journalId })
// → { data: { balanced, arTieOut, apTieOut, inventoryTieOut, fixedAssetTieOut }, error }
// each: { draftAmount, subledgerAmount, variance, pass }

activateAccounting(client, { companyId, userId, confirmation })
// orchestration of §1 steps 1–7 in one transaction; rejects unless every readiness
// check and every validation passes and confirmation === company.name

closePreCutoverPeriods(client, { companyId, cutoverDate, userId })
// internal to activateAccounting; oldest-first, audit-logged per period
```

**Routes** (new, `apps/erp/app/routes/x+/accounting+/`):
- `activation.tsx` — loader (`view: "accounting"`) returns readiness + draft journal + validations; action (`update: "accounting"`) with `intent`: `propose` | `import-tb` | `validate` | `activate`.
- `activation.import.tsx` — CSV upload + account-mapping step (existing CSV import system patterns).

**Edge function**: `seed-company` gains the §4 activation block (env-gated until GA). No changes to posting edge functions in this spec.

## UI Changes

- **Activation wizard** (`/x/accounting/activation`, linked from `settings+/accounting.tsx` and `useAccountingSubmodules` when `accountingActivatedAt IS NULL`): four steps — (1) readiness checklist with red/green rows and deep links to fix each miss + cutover-date picker (period starts only, with the §3 mid-year P&L note); (2) opening balances — per-section Propose buttons or the CSV TB import, editing via the existing journal-entry line editor, live remaining-to-balance indicator; (3) validation — the four tie-out cards with draft vs subledger amounts and variances; (4) activate — consequences summary (one-way; locks; pre-cutover closes; audit start date), typed company-name confirmation, Activate button.
- **Post-activation**: wizard route redirects to `/x/accounting/periods`; settings page shows a read-only "Accounting activated {date} by {user}" banner; `baseCurrencyCode` and fiscal-year fields render disabled with a lock tooltip.
- Flash messages on every action per `.ai/rules/flash-system.md`.

## Acceptance Criteria

Two-company end-to-end per the roadmap GA gate — company A (wizard-proposal path), company B (prior-system CSV TB path), both taken from flag-off to activated:

- [ ] Company A with a missing `accountDefault` account cannot pass step 1; fixing it flips the readiness row without restarting the wizard; the cutover date picker offers only fiscal-period-start dates.
- [ ] Company A's proposals tie: inventory lines equal `get_inventory_value_by_location` totals; AR/AP lines equal `get_ar_open_by_customer`/`get_ap_open_by_supplier` totals as of cutover − 1; fixed-asset lines equal register Σ cost / Σ accumulated depreciation per class; the remaining-to-balance line updates live and blocks activation until assigned.
- [ ] Company B: importing a closing TB with an unmapped account number errors with the row identified; after mapping, the same four validations run; a TB whose AR control differs from Carbon's open-invoice total by > 0.01 blocks activation with the variance shown.
- [ ] Activating either company (with `accounting_update` + typed company name): posts the `'Opening Balance'` journal dated cutover − 1 as Posted; stamps `accountingActivatedAt/By` + `accountingCutoverDate`; generates the fiscal year's periods; closes every period ending before cutover (visible on `/x/accounting/periods`); a user without `accounting_update` gets a 403 on the action.
- [ ] Post-activation, `get_ar_tie_out` and `get_ap_tie_out` as of the cutover date return variance ≤ 0.01 for both companies; the trial balance as of cutover − 1 equals exactly the opening journal.
- [ ] Post-activation, posting a backdated receipt or manual JE dated before cutover fails with the period-closed error (service gate and direct service-role `INSERT` against the trigger); reversing the opening journal creates the reversal in the current open period.
- [ ] Post-activation, updating `company.baseCurrencyCode` or `fiscalYearSettings.startMonth` fails (via PostgREST with user credentials AND with the service role); clearing `accountingActivatedAt` fails.
- [ ] Activation event, opening journal, config-lock rejections, and each pre-cutover period close appear in the audit log with user + timestamp.
- [ ] With `SEED_ACCOUNTING_ACTIVE` on, a freshly seeded company has `accountingActivatedAt` set, `accountingEnabled = true`, current-FY periods generated, pre-creation periods closed, and zero journals other than none (empty ledger); without the env flag, seeding behaves as today.
- [ ] Migration backfills grandfathered companies (flag on + posted journals) with activation stamps and a cutover date equal to their earliest posted-journal period start; flag-off companies remain unstamped; migration applies idempotently twice.
- [ ] The §5 reader inventory is verified empty of stragglers by `grep -rn accountingEnabled` limited to non-generated files at removal-PR time (criterion for the retirement PR, not this spec's PRs).
- [ ] `pnpm run generate:types`, scoped `typecheck`, and `pnpm run lint` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Subledger data changes between validation and activation (e.g., a receipt posts mid-wizard) | Med | Validations re-run inside the activation transaction; any variance aborts with a "re-validate" flash |
| Enum `ADD VALUE` cannot run inside the same transaction as its first use | Low | Enum value added in its own migration statement wave (established `ADD VALUE IF NOT EXISTS` pattern); service usage ships after migration applies |
| Grandfather backfill locks fiscal settings for an internal company that still wanted to change them | Low | Internal companies only; a one-off SQL unlock (clear stamp, change, re-stamp) is available to us pre-GA and is itself audit-visible |
| `closePreCutoverPeriods` on a company with years of empty lazy-created periods is slow / partially fails | Low | Bulk single-statement close oldest-first inside the transaction; all-or-nothing |
| Mid-year cutover users expect YTD P&L in Carbon and are surprised | Med | Wizard step 1 shows the §3 note at date selection; docs updated; v2 monthly-opening-journal path documented |
| Activation transaction spans period generation + posting + closes and exceeds statement timeout on large datasets | Med | Proposal/validation (the heavy reads) happen pre-transaction; the transaction itself writes bounded rows (1 journal + N periods) |

## Open Questions

> All blocking questions resolved before writing (per spec-writing Step 5); resolutions baked in above.

- [x] **Does "accounting is a switch" survive?** — **Answer (Brad, 2026-07-03): No.** Temporary internal flag; always-on at GA; one-way cutover event for existing companies; flag removed from the codebase. (Readiness spec, resolved inline.)
- [x] **Mid-year cutover / YTD P&L reload?** — **Answer (Brad, 2026-07-04):** Cutover only at a fiscal-period start; mid-year YTD P&L reload deferred to v2 (workaround: monthly opening journals). v1 opening journal is balance-sheet-shaped with YTD earnings collapsed into equity. (§3.)
- [x] **Wizard state storage** — **Answer:** The Draft `'Opening Balance'` journal is the state; no staging tables. (Design Decision 1.)
- [x] **Do pre-cutover closes run the close checklist?** — **Answer:** No — dedicated bulk path, audit-logged per period, sequential-close invariant preserved. (Design Decision 10.)
- [x] **Grandfathered internal companies** — **Answer:** Migration backfills activation stamps from earliest posted-journal period; no synthetic wizard run. (Design Decision 12.)
- [x] **Retirement-PR timing vs archived companies**: the "every active company has `accountingActivatedAt`" query needs a definition of *active* (billing status? recent login?) — companies that are dormant-but-not-deleted could block flag removal indefinitely. Recommend: active = non-archived with activity in the last 90 days; dormant companies get force-activated with zero opening balances or archived. Needs Brad's call at retirement time — blocks the removal PR (§5 step 2), **not** this spec's implementation. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Active = non-archived with any activity in the trailing 90 days. At retirement time, dormant non-archived companies are force-activated at zero balances or archived — they never block the flag-removal PR indefinitely.

## Changelog

- 2026-07-04: Created. Implements roadmap §Cutover verbatim (activation event, opening-balance wizard + CSV TB path, seed-company GA path, flag-retirement inventory + GA gate, audit posture). Cutover-at-period-start resolved by Brad same day; mid-year YTD reload deferred with documented workaround. Reader inventory of `accountingEnabled` verified by grep across edge functions, DB functions, ERP app, and generated types.
- 2026-07-04: Remaining open questions resolved under the program ambition heuristic (ambitious scope now; back-out valves at plan stage).
