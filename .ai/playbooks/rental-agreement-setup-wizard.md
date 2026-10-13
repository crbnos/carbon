# Rental Agreement Setup Wizard

Last tested: 2026-10-07
Routes: /x/rental-agreement/new, /x/rental-agreement/:id/setup/{details,units,billing,accounting,review},
/x/part/:itemId/inventory, /x/fixed-asset/capitalize

## Prerequisites
- An Available fleet unit. If `fleetAssets` is empty, make one the way the Add
  Units alert says: a serial-tracked part with SERIALIZED stock (ledger rows with
  `trackedEntityId`). Stock without serials shows no Capitalize action — add some
  with Part → Inventory → "Update Inventory" (storage unit combobox → option,
  Serial Number textbox, quantity 1, requestSubmit the dialog's form). Then the
  Storage Units card shows a building-icon link per serial
  (`a[href*="fixed-asset/capitalize"]`); its page "Capitalize as Fixed Asset"
  defaults the class to Rental Fleet — requestSubmit the form whose button
  contains "Capitalize". RW-010 in the dev company works.
- A customer (NovaSat Networks has no sales contact → no invoice email sent).
- Isolated session: `export AGENT_BROWSER_SESSION=<workspace>`; set
  `agent-browser set viewport 1440 1000` (the sticky footer covers fields at the
  default size).
- DB checks: `docker exec -i <stack>-postgres-1 psql -U postgres -d postgres -At -c "<sql>"`.

## Steps
### 1. Details (/x/rental-agreement/new)
Customer = first combobox → option. Term radiogroup: radio "Fixed Term…" — Next
is DISABLED until the End Date is set. End Date = the second date group: click its
month spinbutton, `keyboard type "10062027"`, Tab. requestSubmit the form whose
submit button contains "Next" → `/setup/units`.

### 2. Units
Empty state → "Add Units" → modal with the info alert "Don't see a serial
number?", Fleet Units multi-select (click options), Rate Frequency select;
requestSubmit the dialog's form. Units with no rate on file come in at 0 and show
"No rate" in red. Rate cell: click the "No rate" text → textbox → fill → Tab
(saves via `$lineId/update`). Frequency cell: click the td with "Monthly" →
combobox → option. Remove: row's last button (dispatch pointerdown + click) →
menuitem "Remove Unit" → requestSubmit the dialog form ("Delete") → stays on
/setup/units.

### 3. Billing
Click text "Arrears"; Deposit / Tax Percent textboxes (`8.25%`) fill + Tab. Each
saves on its own (`rental-agreement/update`).

### 4. Accounting
With an end date: End of Term inputs + switches; clicking the "Specialized asset"
switch flips the preview card to Sale. Unit Inputs grid: click the second td of
the unit's row (Fair Value) → textbox → fill → Tab.

### 5. Review → Activate
A unit at rate 0 is listed red ("… has no rate.") and Activate is disabled; a
direct POST to `/activate` is refused too (status stays Draft). With every unit
priced: footer "Activate" → dialog button "Activate MOD+ENTER" → lands on
`/details`, status Active, billing periods cut.

### 6. Redirects
A Draft opened from the list or at `/details` lands on `/setup/units`; an Active
agreement's `/setup/*` lands on `/details`.

## Common Failures
- Clicking the sticky-footer-covered Tax field fails — use a taller viewport.
- The contract wizard shares `~/components/Setup`: smoke /x/contract/new and each
  `/setup/<step>` of a Draft contract after touching it.
