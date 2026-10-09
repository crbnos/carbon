# Kanban replenishment level (Transfer kanban)

Last tested: 2026-10-09
Routes: `/x/inventory/kanbans/new?location=<id>`, `/x/inventory/kanbans/<id>`, `/api/kanban/<id>` (scan),
`/x/inventory/stock-transfers?filter=source:eq:Kanban`, `/x/stock-transfer/<id>`,
`/x/inventory/quantities/<itemId>/details` (Update Inventory), `/file/kanban/labels/order.pdf?ids=<id>`

## Prerequisites
- Dev stack up, with the Inngest dev server. `pnpm db:migrate` sets the Vault secret `inngest_event_url`.
  Check that `carbon-kanban-level-check` is registered:
  `curl -s localhost:<inngest port>/v0/gql -d '{"query":"{ functions { slug } }"}' -H 'content-type: application/json'`.
- Carbon Development → Manufacturing Plant (`loc_DNvXGZG8keWBKLrUhgd6sH`). An untracked item with
  stock in one storage unit and 0 in another. Used: `FST-M6-A286`, From `A1-L1` (151), To `A1-L2` (0).
  Do not use the `PLN-` items.
- Projected quantity counts EVERY open transfer into the To unit, the scan's ones too. Re-read it before
  you predict the next signal:
  `SELECT * FROM get_kanban_projected_quantities('<companyId>', ARRAY['<kanbanId>']);`

## Steps
### 1. Form
- New Kanban → Replenishment System combobox (the one showing "Buy") → option "Transfer".
  Fields appear in this order: Item, System, Location, From, To, Quantity, Replenishment Level
  (with a "What is Replenishment Level?" help button). With Buy there is no level field.
- Pick Transfer BEFORE the item. Then pick the item: the system stays Transfer, and To fills with the
  item's default bin.
- From = To → submit → "From and to storage units must be different".
### 2. Create (save path)
- To = A1-L2, Quantity 5, Level 3 → requestSubmit "Create Kanban".
- Within about 10 s: one Released transfer, created by System. Note: "Kanban replenishment — FST-M6-A286,
  A1-L1 → A1-L2, 5 EA. Signal: level 3 (projected 0)." Line A1-L1 → A1-L2, quantity 5.
- List row: Replenishment Level 3, Projected (To) 5, no pill.
### 3. Stock movement path
- Item quantities page → Update Inventory → Storage Unit A1-L2, Positive Adjustment, Quantity 8 → Save.
  Projected 13, so no transfer.
- Edit the kanban, Level 10 → Update Kanban. 13 is not below 10, so no transfer.
- Update Inventory → A1-L2, Negative Adjustment, Quantity 4 → Save. Projected 9 is below 10, so one transfer
  appears about 1 s later. Note "…Signal: level 10 (projected 9)."
### 4. Scan
- Open `/api/kanban/<id>` → redirects to a new transfer. Note "…Signal: scan by <name>.", created by you.
### 5. Marking
- Stock Transfers list: the Source column shows Kanban or Manual. `?filter=source:eq:Kanban` and `:Manual` split them.
- Transfer header meta line: "Created … by System · [Kanban]". The badge opens `/x/inventory/kanbans/<id>`.
### 6. Label
- `fetch('/file/kanban/labels/order.pdf?ids=<id>')` from the logged-in page. Decompress the Flate streams
  (no pdftotext here). The text runs `A1-L1 -> A1-L2`, `QTY: 5`, `MIN: 10`. The unit suffix comes from
  `purchaseUnitOfMeasureCode`, which a Transfer kanban leaves empty, so neither line shows a unit.
### 7. Below level pill and clearing
- Set a level above projected + quantity: one transfer fires, and the list shows "<n> Below level" in red.
- Clear the level (see Selector Notes) → stored NULL; Level and Projected render blank.

## Selector Notes
- Comboboxes: click the combobox ref, then pick the option with
  `[...document.querySelectorAll('[role=option],[cmdk-item]')].find(x=>x.textContent.trim().startsWith('A1-L2')).click()`.
- The level is a react-aria Number field. Read it from `[role=dialog] input[name=replenishmentLevel]`.
- **Wait about 8–10 s after opening the edit drawer before you touch it.** A click while it slides in lands
  on the overlay and closes the drawer. The URL then drops to `/x/inventory/kanbans` with no query.
- To CHANGE a value that is already set, do not `fill` (it appends: "20" + "30" became 2030).
  Focus and select from script, then press keys:
  `el.focus(); el.select()` on the last visible non-named input in the dialog, `press Backspace`
  (or type), then focus another input to blur.
- `fill @ref ""` does not clear the field. The hidden input keeps the old value.
- Submit with `form.requestSubmit(submitButton)`. Button texts: "Create Kanban", "Update Kanban", "Save".
- `psql -c` with two statements prints only the last result. Run one statement per check.

## Common Failures
- A level far above the quantity creates one transfer per signal, including the hourly sweep. If you
  type a wrong level, clear it at once, or the sweep keeps adding transfers.
