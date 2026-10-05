# Period Runs (revenue recognition and depreciation)

Last tested: 2026-10-04
Routes: /x/accounting/revenue-recognition-runs, /x/revenue-recognition-run/<id>,
/x/accounting/depreciation-runs, /x/depreciation-run/<id>

## Prerequisites
- Revenue recognition needs Planned `revenueRecognitionSchedule` rows. A fresh
  demo dataset has none; insert Deferral rows on a posted invoice line (debit
  `accountDefault.deferredRevenueAccount`, credit `salesAccount`) or post a
  Service invoice with service dates.
- Depreciation needs Active fixed assets; the demo DR000001 Draft is stale after
  the per-month change, so Post refuses it until Recalculate.
- Use an isolated browser session (`AGENT_BROWSER_SESSION=<name>`) — other
  Conductor sessions share the default one and navigate it away mid-test.

## Steps
### 1. New run — "New Run" opens a modal with a date picker that writes a hidden
`input[name=periodEnd]`. Set that value, then `requestSubmit` the modal form.
- A month after the current one → toast "<Month Year> has not started yet."
- A period that already has a Draft → redirect to it, "<RR> is already a draft".
### 2. Post — `requestSubmit` the form of the "Post" button (header, Draft only).
- Stale Draft → "… is out of date …; recalculate it before posting".
### 3. Recalculate — header button beside Post (Draft only), then the dialog's
"Recalculate" button (`requestSubmit` its form). Toast "Recalculated <run>: N lines".
### 4. Reverse Run — "More options" (⋮) → menuitem "Reverse Run" → dialog button
"Reverse Run" (`requestSubmit`). Toast "Reversed <run>. It is a draft again."
### 5. Close checklist — /x/accounting/periods/<periodId>/close. The two run
tasks show "N entries to recognize · $X" / "N assets to depreciate · $X" and
"Post draft run <id>" links. **Create Run** shows only when something is due
and the period has no Draft run; it redirects to the new Draft.
- Nothing due: the action refuses ("Nothing to depreciate for this period" /
  "Nothing to recognize for this period") and creates no run. The button is
  hidden then, so POST `intent=create-depreciation-run` to `<route>.data` with
  curl and the browser's `carbon` cookie; decode the `set-cookie` flash.
- To see depreciation due on dev data, reverse and delete the latest run
  first, then Create Run and Post to restore it.
### 6. Verify in the database — journals per month (`postingDate` = month end, in
its own `accountingPeriod`), Active period unchanged, rows/assets restored.

## Selector Notes
- Toasts disappear in ~3 s; poll `agent-browser snapshot` every 0.7 s after submit.
- After a fetcher-driven action the page may not revalidate until reload.

## Common Failures
- Vite overlay / 502 while another session edits files — wait and reload.
- Reverse Run refuses while another Draft holds the same revenue period.
