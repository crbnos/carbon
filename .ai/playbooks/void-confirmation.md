# Void confirmation dialogs

## Scope

Six user-facing Void actions exist: payments, credit/debit memos, sales invoices,
purchase invoices, receipts, and shipments. Payments and memos use ConfirmDelete
with a Void title/button; the other four use dedicated Void modals.

## Setup

Use the test and auth skills with ERP_URL from `.env.local`, then select an
isolated local company with accounting enabled. Prepare a fresh posted payment
and a separate unapplied posted credit/debit memo owned by the test. Never void
an existing customer record just to test confirmation. Do not reset the database.
The September 9 fixtures/scripts and before/after evidence are under
`.context/void-confirmation/` (gitignored).

## Payment and memo checks

Repeat on `/x/payments/{paymentId}` and `/x/credits/{memoId}`:

1. Record the Posted status and the document's journal lines from the database.
2. Click the header's Void button. A modal must appear naming the document and
   explaining that accounting entries and applications will be reversed.
   Confirm Cancel has focus; the header action must be `type="button"`.
3. Click Cancel. Verify the modal disappears and status/journal lines are unchanged.
4. Reopen and press Escape. Verify the same. Reopen and use the Close button;
   verify the same. No request to the document's `/void` action is allowed.
5. Reopen and confirm using the modal's destructive Void submit button. Verify
   loading disables that button. After completion, the modal closes, the page
   shows Voided, and the header no longer offers Void.
6. Verify the persisted status is Voided, with exactly one reversal and a zero
   net balance on every original journal account.

Use real browser clicks. If this CLI's click does not invoke a React handler,
DOM `.click()` on the actual button or `button.form.requestSubmit(button)` on the
confirmation exercises the same application handler. Wrap evals in IIFEs to avoid
persistent top-level binding collisions. Await each browser command before the
next; do not navigate while a dialog test or submission is still running.

## Existing invoice/inventory checks

On posted sales/purchase invoices and receipts/shipments, the header/menu Void
item must only open its dedicated modal. The form that posts to `/void` must
remain inside that modal. Existing permission/status checks still govern whether
Void is offered.

## Last verification: 2026-09-09

Both payment and memo passed: confirmation title/consequences, Cancel initially
focused, Cancel and Escape leaving exact persisted state/journals unchanged,
confirm disabling during loading and ignoring a second click, dialog closing and
Voided status after completion. Payment Close dismissal also preserved state.
Both records had exactly one reversal per original account, netting to zero.
Before the fix, fresh baseline records reproduced the immediate one-click void
and failed the browser assertion that a dialog must appear.

Checks: 29 existing payment form/composer tests, scoped ERP typecheck, scoped
Biome, and the missing-translation check passed. The four existing dedicated
invoice/inventory modal call sites were verified by source audit. The glossary
checker has existing findings plus eight grammatical-form matches on the new
translations; see the local localization report for the reviewed delta.
