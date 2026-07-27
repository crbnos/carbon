# Period close

> Locking and closing a fiscal period: the close checklist, what a locked period stops, and how to reopen.

Bookkeeping happens continuously, but the books get *finalized* one period at a time. An accounting period is a dated window (a calendar month) that every posting falls into by its posting date. Closing it is the act of declaring that month's numbers final: no more postings land in it, and its balances are snapshotted for reporting. Carbon runs this as a three-state lifecycle with a NetSuite-style checklist gating the close.

The whole surface is gated on **accounting enabled** (`companySettings.accountingEnabled`). With accounting off, no journals are written, so there is nothing to close.

## The close lifecycle

A period carries a **close status** (`periodCloseStatus`) that moves in one direction, then back only by explicit reopen. This is a separate axis from the legacy `Active`/`Inactive` flag, which just marks the current period for lazy auto-creation.

  - **Open**: Postings land freely. Operational documents (receipts, shipments, invoices, payments) and journals both post by their date.
  - **Locked**: Operational postings are refused; accounting adjustments can still be posted. The staging state you review in before finalizing.
  - **Closed**: The month is final. Nothing enters, leaves, or changes. Balances are snapshotted. Reopen to post again.

A period must be **Locked before it can be Closed** — closing an Open period is refused with *"Period must be locked before closing."* The transitions live in `accounting.service.ts` (`lockAccountingPeriod`, `unlockAccountingPeriod`, `closeAccountingPeriod`, `reopenAccountingPeriod`), each rejecting a move from the wrong starting state.

A **Locked** period still accepts *accounting adjustments* — a manual journal posted with an accounting-adjustment intent goes through. It only blocks *operational* documents. A **Closed** period blocks everything, including reversals into it. Lock when operations are done for the month but the accountants aren't; close when the books are final.

## What a locked or closed period stops

The gate lives in `getOrCreateAccountingPeriod`, which every posting path calls before it writes:

  - **Closed**: Any posting is refused with *"Accounting period is closed. Reopen it before posting."* — operational documents and adjustments alike.
  - **Locked**: Operational documents are refused with *"Accounting period is locked. Post as an accounting adjustment or unlock the period first."* Accounting adjustments pass.
  - **Open**: Everything posts normally.

A database trigger (`check_accounting_period_open`) is the hard backstop underneath the service check: it rejects any `INSERT`, `DELETE`, or period-move of a journal into or out of a **Closed** period, so even a service-role job or edge function can't slip a posting into a closed month. (Locked semantics need actor identity, so they're enforced at the service layer; the trigger only guards the Closed invariant.) The one exception the trigger allows: a `Posted → Reversed` status flip, since the offsetting reversal lands in an open period.

## The close checklist

Closing runs through a persisted checklist — a company-level template of task definitions (`periodCloseTaskDefinition`) plus per-period instances (`periodCloseTask`) materialized the first time you open a period's close screen. Nine system tasks seed with every company (they can be deactivated but never deleted). Each task has a **type** (`Auto`, `Action`, or `Manual`) and Auto tasks carry a **severity**.

  - **Auto**: A readiness evaluator the system runs live — the task shows Done when the check passes, Open when it fails. You don't tick these; they reflect real state.
  - **Action**: A task whose completion *is* a lifecycle transition. "Lock the period" is an Action task: its button drives the Open→Locked flip, and its Done state is read from the period's close status, not a stored tick.
  - **Manual**: A human sign-off (e.g. "Review financial statements") you mark Done yourself.

Auto tasks fail *closed*: an Auto task whose evaluator can't be found is treated as failing, not silently passed, so the close stays gated and the reason stays visible.

### Severities gate differently

An Auto task's **severity** (`periodCloseTaskSeverity`) decides whether a failing check blocks the close or merely warns:

  - **Blocker**: A failing Blocker check hard-stops the close. You cannot close the period until it passes (or the task is skipped, which Blockers disallow).
  - **Warning**: A failing Warning check surfaces the issue but doesn't stop the close. You can proceed, or skip the task with a reason.

The seeded checks, from `computePeriodReadiness`:

| Check | Severity | Fails when |
| --- | --- | --- |
| Post pending operational documents | Blocker | Un-posted receipts/shipments/invoices dated in this period exist. |
| Post or re-date draft journal entries | Blocker | Draft journal entries are dated in this period. |
| Trial balance in balance for the period | Blocker | Any posted journal has unequal debits and credits. |
| Post depreciation runs covering the period | Warning | A draft depreciation run ends in this period. |
| Match & eliminate intercompany transactions | Warning | Unmatched intercompany transactions involve this company. |

A seventh seeded Auto task, **Review negative on-hand inventory** (Warning), has no live evaluator yet, so it fails closed and stays a standing Warning you resolve by skipping with a reason. The remaining three seeded tasks are the two Action steps (**Lock the period**, **Close the period**) and one Manual step (**Review financial statements**).

### Completing and skipping tasks

An `Action`/`Manual` task is marked Done with `completeTask` (optional notes). Any non-Blocker task can be skipped with `skipTask`, which **always requires a non-empty reason** — and the service additionally refuses to skip a **Blocker** task. Auto tasks are never manually completed; their state is derived from the live readiness check every time the checklist loads.

The close itself (`closePeriodWithChecklist`) re-evaluates the whole checklist server-side. It refuses to close unless **every required task resolves to Done or Skipped and no Blocker check is failing**, surfacing the specific blocking task in the error. Never trust a disabled button: the gate is enforced on the server, and the DB trigger is the final backstop.

Periods close and reopen in order. Closing refuses if any **earlier** period isn't Closed (*"Earlier periods must be closed first"*). Reopening refuses if any **later** period is still Closed (*"Later periods must be reopened first"*) — you reopen from the most recent close backwards.

## Reopening

Reopening (`reopenAccountingPeriod`) flips a **Closed** period back to **Open**, clears its `closedAt`/`closedBy`, and deletes the balance snapshots the close wrote (its own and any later snapshot that embedded it, since snapshots are cumulative through their period's end date). After reopening, postings into the month resume and the balance reads fall back to a full-history scan until the period is closed again. A period that isn't Closed can't be reopened.

Unlocking (`unlockAccountingPeriod`) is the milder inverse: it moves **Locked** back to **Open** so operational documents can post again, clearing `lockedAt`/`lockedBy`. It writes no snapshots and touches no balances.

## Fiscal periods and the calendar

Periods are generated per **fiscal year** — twelve monthly periods from the company's fiscal start month, via `createFiscalYearPeriods` (idempotent; it skips any period number already present). Each period carries a `fiscalYear` and `periodNumber` derived from that start month: a fiscal year is named for the calendar year it *ends* in, so a July-start FY beginning in 2025 is FY2026.

Once the calendar is **committed** — any posting exists, or any period is Locked/Closed — the fiscal start month locks (`getFiscalCalendarCommitted`), because re-labeling already-reported periods would rewrite history. An empty, Open period can still be deleted (`deleteAccountingPeriod`) and regenerated; a period with journals posted to it, or in any non-Open state, cannot.

## Related

  - Accounting & the ledger Accounts, journals, dimensions, and the postings every flow produces.
  - Invoices Where sales and purchase invoice postings come from — the operational documents a close gates.

## Troubleshooting

Exact errors from the close/reopen lifecycle and the checklist gate.

### "Period must be locked before closing."
You tried to close a period that is still **Open**. The lifecycle is Open → Locked → Closed; closing is only allowed from **Locked**. Run the "Lock the period" checklist step (Open → Locked) first, then close.

### "Accounting period is closed. Reopen it before posting."
The posting date falls in a **Closed** period, and a Closed period refuses every posting — operational documents and accounting adjustments alike. Reopen the period, or change the document's posting date to an Open period.

### "Accounting period is locked. Post as an accounting adjustment or unlock the period first."
The period is **Locked**, which blocks *operational* documents (receipts, shipments, invoices, payments) but still accepts *accounting adjustments*. Either post the entry as an accounting adjustment, or unlock the period back to Open.

### "Earlier periods must be closed first (sequential close)"
Periods close in order. An earlier period is not yet **Closed**, so this one can't close. Close the earliest open period first and work forward.

### "Later periods must be reopened first (reopen from the most recent close backwards)"
Reopening runs in reverse: a **later** period is still Closed, so this one can't reopen. Reopen from the most recent close backwards until you reach this period.

### "A reason is required to skip a task"
Skipping a checklist task requires a non-empty reason. Enter a reason and skip again — a blank reason is rejected.

### "Blocker tasks cannot be skipped; resolve the underlying issue first"
The task's severity is **Blocker**, and Blockers can never be skipped — only resolved. Fix the underlying condition (post the pending document, balance the journal, etc.) so the Auto check passes; only **Warning** tasks can be skipped with a reason.

### The Close button is disabled or the close is refused
The close re-evaluates the whole checklist server-side and refuses unless **every required task is Done or Skipped and no Blocker check is failing** — the error names the specific blocking task. A database trigger (`check_accounting_period_open`) is the final backstop: it raises *"Accounting period is closed for posting date …"* / *"Cannot delete journal …: accounting period is closed"* if anything tries to post into or delete a journal from a Closed period, even a service-role job.

### A period won't delete or its fiscal start month is locked
An accounting period can only be deleted while it's **empty and Open**; one with posted journals, or in any Locked/Closed state, refuses. The fiscal start month locks once the calendar is *committed* — any posting exists, or any period is Locked/Closed — because relabeling reported periods would rewrite history.
