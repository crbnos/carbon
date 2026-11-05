# Government Contracting Phase 5c (budget control, earned value, stop work, ACWP export)

Last tested: 2026-10-12
Routes: /x/project/<projectId>/settings, /x/project/<projectId>/element/<elementId>,
/x/project/<projectId>/baselines, /x/project/<projectId>/costs, /x/purchase-order/<id>/details,
/x/timesheet, /x/projects/approvals, /x/accounting/periods/<periodId>/close

## Prerequisites
- Satellite dataset company (Carbon Development); project ORBSEC Constellation Block 2
  (`prj_5vCwDZeAP2MHdjqYeYe7iP`, Direct, Released). Work packages: OB2-3 0/100, OB2-6 50/50
  (In Progress), OB2-9 Percent Complete, OB2-10 Level of Effort; control accounts OB2-1, OB2-7.
- `CARBON_EDITION=enterprise` in `.env`, so `GOVERNMENT_CONTRACTING` is on for every company.
  The Community-plan gate cannot be tested without restarting the dev server on another edition.
- The element page shows the Government contracting / Earned Value groups only with
  `companySettings.timekeepingControls = 'DCAA'`.
- If the project has no baseline, take one (step 3). The work package budgets/dates must be
  set BEFORE the baseline, because BAC and the schedule come from the baseline snapshot.

## Steps
### 1. Budget control settings
- Project → Settings (sidebar, bottom). Card "Project Control": Budget Control combobox → Block;
  Tolerance number field → fill `0`, then click the "Project Control" heading to blur.
- requestSubmit the form that contains "Budget Control" (its own Save button). Toast
  "Control settings saved".

### 2. Work package budget and dates
- Element page → right sidebar, Work group: Budget "+" button opens an inline number field;
  fill `10000`, blur by clicking the "Work" heading. Saves on blur.
- Start date / Target date: the "Calendar" buttons under State/Owner; pick Oct 1 and Nov 30.

### 3. Take a baseline
- Project ⋯ → Baselines (or /baselines) → "Take Baseline", name it, requestSubmit the dialog
  form (button "Take Baseline"). Toast "Baseline taken"; `projectBaseline.formatVersion = 2`
  with a `schedule` array.

### 4. Earned value on the Costs tab
- Project → Costs. "Earned value" section under the cost tree. A 50/50 work package with BAC
  $10,000 that is Started shows Planned value $5,000 and Earned value $5,000. CPI shows "—"
  until the work package has ledger cost; after 6 h × $92 posted it showed CPI 9.05797,
  SPI 1, EAC $1,104.00.

### 5. PO line over budget (Block)
- New PO (navigate from Purchasing → Orders → "Add Purchase Order", NOT by direct URL),
  supplier AstroMill Machining. "Add Line Item" opens the line modal: Item BAT-LIION-48V
  ($2,400), Charge Number combobox → type `OB2-6`, Quantity 5 (blur).
- New line (modal): the line is NOT saved, but the modal closes and no message shows (FAIL,
  see Common Failures).
- Edit an existing line (open it from the explorer) to quantity 5 → field error under Quantity:
  "OB2-6 … goes over its budget of $10,000.00 by $2,000.00." Line keeps quantity 4.

### 6. Timesheet over budget (warns, notifies owner)
- My Time → Add row → Charge Number OB2-10 (budget $300) → Add. Click the Mon cell, fill 8,
  press Enter. Toast: "OB2-10 … goes over its budget of $300.00 by $380.00." Entry saved.
- Bell icon shows "Budget exceeded on ORBSEC Constellation Block 2" (`notification.event =
  project-budget-exceeded`, to the project owner).

### 7. Stop work / Resume
- Project header ⋯ → "Stop work" → dialog with Order date (today) → requestSubmit its form.
  Toast "Stop-work order issued"; badge On Hold. Overview → Needs attention:
  "Stop-work order since Oct 12, 2026, ends Jan 10, 2027".
- Charge number pickers (My Time → Add row) no longer list the project ("No option found.").
- ⋯ → "Resume work" (no dialog). Toast "Work resumed"; status Released, `stopWorkDate` null.

### 8. Close Earned Value / ACWP export
- Accounting → Accounting Periods → row ⋯ → Close Period. Only the earliest non-Closed period
  can close (sequential), and it must be Locked. "Close Earned Value" button sits on the
  "Close earned value for the period" task.
- Costs → Earned value period select → a Closed period (FY2025 P12) → "Export ACWP" link
  `/api/earned-value/acwp.csv?periodId=…&projectId=…` → 200 `text/csv`,
  `acwp-2025-12.csv`, header `Project,Charge Number,Element,Control Account,Fiscal Year,Period,
  Element of Cost,Cost Class,Hours,Amount`. An Open period answers 400 "Close the period before
  you export its actual cost."

## Selector Notes
- Direct `agent-browser open` of a deep URL often leaves the page un-hydrated (hydration
  mismatch, then "Failed to fetch dynamically imported module"): clicks do nothing. Either
  navigate client-side from a module link, or `reload` and wait ~25 s, then retry.
- My Time grid: click a cell, a textbox appears; `fill` then `press Enter`. Future dates are
  read-only. A change to a saved cell opens "Change Time" (reason required, despite the
  "Optional" label); a late date opens "Late Entry".
- Labor Category drawer Save button sits outside the form: use `button.form.requestSubmit(button)`.

## Common Failures
- New PO line in the modal: Block refusal is silent. `PurchaseOrderLineForm` closes the modal
  in `onSubmit` (`type === "modal"`), so the `validationError` from `$orderId.new.tsx` never
  renders.
- Stop work: a NEW entry on an existing My Time row of the stopped project saves (only the
  picker filters On Hold projects; `save-timesheet-entry` does not check project status).
- Close period on the seeded company is blocked by the seeded Draft journal JE-SEED-001 in
  January 2026 ("Post or re-date draft journal entries").
- The seeded baseline (commit 7d79066e63) is missing in a database seeded before that commit;
  take one by hand.
