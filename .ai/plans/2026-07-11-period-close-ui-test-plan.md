# UI Test Plan — Accounting Period Close Lifecycle (`loop/1031`)

Branch adds a **NetSuite-style period-close lifecycle + checklist** to the ERP accounting module.
This plan tests it through the browser only. All references grounded against the branch diff.

## What the branch ships (UI-facing)

- **Sidebar nav**: "Accounting Periods" under Accounting → *General Ledger* (icon: calendar-check).
  Route `/x/accounting/periods`. Requires `employee` role. (`useAccountingSubmodules.tsx`)
- **Periods list** (`periods.tsx`): table of periods — Period label (`FY{year} · Period {n}`),
  Date Range, Status (Active/Inactive), **Close Status** badge, and a **Close** / **View** action.
  Close-status badge colors: `Open`=gray, `Locked`=orange, `Closed`=green. Empty state: "No accounting periods yet".
- **Close checklist modal** (`periods.$periodId.close.tsx`): xlarge modal over the list.
  Task table (Task / Type / Severity / Status / Actions), a destructive **blockingReason** alert,
  and a footer **Close Period** button disabled until `canClose`.
- **9 seeded checklist tasks** per company (system definitions):

  | # | Task | Type | Severity | Auto check |
  |---|------|------|----------|-----------|
  | 1 | Post pending operational documents | Auto | Blocker | `pending-postings` |
  | 2 | Post or re-date draft journal entries | Auto | Blocker | `draft-journals` |
  | 3 | Lock the period | Action | — | — |
  | 4 | Post depreciation runs covering the period | Auto | Warning | `draft-depreciation` |
  | 5 | Match & eliminate intercompany transactions | Auto | Warning | `unmatched-ic` |
  | 6 | Review negative on-hand inventory | Auto | Warning | `negative-inventory` (stub, always failing) |
  | 7 | Trial balance in balance for the period | Auto | Blocker | `tb-balanced` |
  | 8 | Review financial statements | Manual | — | — |
  | 9 | Close the period | Action | — (not required) | — |

- **Posting gates** wired into `getOrCreateAccountingPeriod`: posting into a **Closed** period is
  blocked for all sources; posting into a **Locked** period is blocked for `operational` sources
  (receipts/shipments/invoices) but allowed for `accounting` sources (depreciation post, asset dispose).
- **DB immutability trigger**: a `Posted` journal can't be deleted/edited (only Posted→Reversed).

## ⚠️ Critical finding to verify first (likely a blocker for the happy path)

**There is no UI to move a period into `Locked`.** `closePeriodWithChecklist` refuses to close unless
`closeStatus === "Locked"` (`accounting.service.ts:848` → *"Period must be locked before closing."*).
But:
- The "Lock the period" task is an **Action** task; marking it **Done** calls `completeCloseTask`, which
  only sets `status='Done'` — it does **not** set `closeStatus='Locked'`.
- The only callers of `lockAccountingPeriod` are **MCP tools** (`tool-metadata.json`); no ERP route or
  button dispatches a lock intent.

**Consequence:** even with every checklist task resolved, clicking **Close Period** on a fresh `Open`
period should fail with *"Period must be locked before closing."* Test T5 confirms this; T6 covers the
close only after locking out-of-band. If the happy-path close is meant to work UI-only, this is a bug to
report, not a test failure to hide.

## Prerequisites

1. Local stack running: `crbn up` (portless `*.dev`). Log in via `/auth`.
2. **Accounting enabled**: `/x/settings/accounting` → turn on (crbn reset seeds `accountingEnabled=false`;
   GL posting/period creation is inert otherwise).
3. **At least one period must exist.** Periods are created lazily by posting (`getOrCreateAccountingPeriod`);
   there is **no "Generate periods" button** in the UI. To get a period to test, either:
   - post any operational document dated in the target month (creates that month's period `Open`), or
   - create/lock a period out-of-band via the Carbon MCP tools (`accounting_lockAccountingPeriod`) or SQL.
4. Note the **companyId** — the 9 task definitions seed per company on migration; a company created before
   the migration should still have them (seeded by `INSERT … FROM company`), but verify in T2.

## Test cases

### T1 — Nav + list render
- Go to `/x/accounting`. **Expect** "Accounting Periods" in the *General Ledger* group; click it.
- **Expect** `/x/accounting/periods` renders. With no periods → "No accounting periods yet".
  With periods → one row each, correct Period label, Date Range, Status, and a colored Close Status badge.
- Action button reads **Close** for non-closed, **View** for `Closed` periods.

### T2 — Open the checklist modal
- Click **Close** on an `Open` period. **Expect** xlarge modal titled *Close FY… · Period …* with the
  9 seeded tasks listed, correct Type/Severity per the table above.
- **Expect** Auto tasks have **no** "Mark Done" button; Blocker tasks have **no** "Skip" button.
- **Expect** the "Review negative on-hand inventory" task shows **Open** (stub always fails) and the
  blockingReason/Close-disabled state reflects unresolved required tasks.

### T3 — Auto-check reflects real data (Blocker path)
- Seed a **Draft journal entry** dated inside the period (or a Draft receipt/shipment/invoice).
- Reopen the checklist. **Expect** the matching Auto task ("Post or re-date draft journal entries" /
  "Post pending operational documents") shows **Open**, a **blockingReason** alert is shown, and
  **Close Period is disabled**.
- Post/void that document, reopen. **Expect** the task flips to **Done** automatically (no manual action).

### T4 — Manual/Action complete + Skip validation
- On a Warning task (e.g. "Review negative on-hand inventory"): click **Skip** → inline reason input
  appears. Submit **empty** → **Expect** rejection (reason required). Submit with a reason →
  **Expect** status **Skipped**, reason shown, toast "Task skipped".
- On "Review financial statements" (Manual): **Mark Done** → **Expect** status **Done**, toast "Task marked done".
- On "Lock the period" (Action): **Mark Done** → **Expect** status **Done** (but note: this does *not*
  lock the period — see T5).
- On any **Blocker** Auto task that is failing: **Expect** no Skip button is offered, and it cannot be
  bypassed from the UI.

### T5 — Close blocked when not Locked (the critical finding)
- Resolve/skip every required task so the checklist would otherwise be complete (all Warnings skipped,
  Manual done, Auto blockers passing). If `canClose` becomes true the **Close Period** button enables.
- Click **Close Period**. **Expected (current branch):** error toast *"Period must be locked before
  closing."* and the period stays non-closed. **Record this** — if UI-only close is intended, file as a bug.

### T6 — Full close (after locking out-of-band)
- Lock the period out-of-band (MCP `accounting_lockAccountingPeriod`, or set `closeStatus='Locked'`).
- Reopen the list → **Expect** Close Status badge = **Locked** (orange).
- Open checklist, ensure all required tasks Done/Skipped, click **Close Period**.
  **Expect** redirect to the list, toast "Period closed", badge = **Closed** (green), action button = **View**.
- Reopen a `Closed` period via **View** → checklist read-only-ish; **Close Period** disabled or close
  rejected with *"Period is already closed."*

### T7 — Sequential close guard
- With two consecutive periods both Locked, close the **later** one first. **Expect** rejection:
  *"Earlier periods must be closed first (sequential close)."*
- Close the earlier one, then the later — **Expect** success.

### T8 — Posting gates (Locked / Closed period)
- Into a **Locked** period: attempt an operational post (create/post a receipt or invoice dated in it).
  **Expect** error mentioning the period is locked. Then post a **depreciation run** / **dispose an asset**
  dated in the same Locked period — **Expect** success (accounting source bypasses the lock).
- Into a **Closed** period: attempt any post. **Expect** *"Accounting period is closed. Reopen it before posting."*

### T9 — Permissions
- As a user **without** `accounting_update`: open the checklist. **Expect** Mark Done / Skip / Close all
  fail server-side (action requires `update: "accounting"`), even if buttons render.
- As a user without `accounting_view` / non-employee: **Expect** the nav item hidden and the route
  redirects.

## Reporting

- Capture a screenshot of: the periods list, the checklist modal with a blockingReason, and the T5 result.
- Lead the report with the T5/lock-gap outcome — it determines whether the close happy-path is reachable
  through the UI at all on this branch.
