# MRP planned orders (MRP v2 Phase 2a)

Last tested: 2026-11-15
Routes: /x/production/planning, /x/purchasing/planning (drawer: `?location=<id>&item=<itemId>`),
/x/part/<itemId>/planning, /x/resources/locations/<locationId>

## Prerequisites
- Satellite demo data. SAT-1000 at Manufacturing Plant: Fixed Reorder Quantity, reorder point 3,
  quantity 5. MRP gives it about 7 Planned orders of 5. It is `requiresConfiguration`, so its
  Make is refused ("Manufacturing requires configuration"). No other common-segment Make item
  has planned orders (its subassemblies are Make to Order and are excluded), so test the
  convert step on a Buy item.
- A Buy planned order you can place must release on or after the location's today
  (America/Chicago). An earlier start is refused. Find one:
  `select i."readableIdWithRevision", po.id, po.quantity, po."releaseDate", po."dueDate" from "plannedOrder" po join item i on i.id=po."itemId" where po."orderType"='Buy' and po.status='Planned' and po."releaseDate" >= <today> order by 4;`
  (e.g. FST-M6-A286, 200 due in a week ~3 weeks out).
- Run MRP from a logged-in page: `agent-browser eval "fetch('/api/mrp',{method:'POST'}).then(r=>r.status)"` → 200.
- Use an isolated `AGENT_BROWSER_SESSION`.

## Steps
### 1. MRP explodes the planned orders
After a run, the grid row of SAT-1000 reads "Urgent Make 35". DB: the components under its
Make to Order subassemblies (FST-M6-A286, 24 + 16 per unit) have `demandForecast`
(`forecastMethod = 'mrp'`) of 200 per week = 5 × 40.

### 2. Drawer: Planned Orders section
Open the drawer by URL. Above "Suggested Jobs" is "Planned Orders", a grid with the columns
Status, Release Date, Due Date, Quantity, (action), Suggestion. A row reads e.g.
"Planned 8 Nov 2026 15 Nov 2026 5 Firm". To read the quantity's trace tooltip, hover the
quantity cell. The tooltip is Base UI: read it with
`document.getElementById(span[data-base-ui-tooltip-trigger][data-popup-open].getAttribute('aria-describedby')).textContent`
→ "Projected stock -2 → Fixed Reorder Quantity 5 → explode 5".

### 3. Firm / Unfirm / edit
- Click the row's "Firm" button. After about 8 s (MRP re-runs) the row reads "Firm … Unfirm"
  and the DB status is Firm with `firmedBy`. "Unfirm" sets it back.
- Edit a Planned order's quantity: click the quantity cell (it becomes textbox "Quantity"),
  `fill`, then click the drawer heading. Dialog "Keep your numbers through plan updates?"
  → button "Keep my numbers". DB: Firm, new quantity. The week's Make action
  `suggestedQuantity` = the sum of that week's Planned + Firm orders. Suggested Jobs lists
  both orders.
- Editing a Firm order asks nothing. Restore: set the quantity back, then Unfirm. MRP-owned
  rows come back with new ids. That is expected.

### 4. Time fence on the item Planning tab
The Planning card has the groups "Reorder policy", "Planning window" and "Ownership".
Textbox "Planning time fence (days) Optional" has the placeholder "Location default: N".
Fill 10, blur onto another field, then `requestSubmit` the form that holds
`input[name=reorderingPolicy]` (its first "Save"). Recalculate and reopen the drawer: rows
with release ≤ today + 10 read "Planned Fence …".

### 5. Convert by Order (Buy)
Purchasing drawer: remove the other Suggested Orders rows ("Remove order", bottom-up), then
click the drawer's "Order" with eval (see notes). DB: the planned order is Converted with
`purchaseOrderLineId`, the PO line sits on a Planned PO, and the Order action is Actioned.
Reopen the drawer: the order is gone from Planned Orders and the PO shows under Open Orders.

### 6. Location form
`/x/resources/locations/<id>` opens drawer "Edit Location" with textbox "Planning time fence
(days) Optional" (value 0).

## Selector Notes
- Drawer buttons can be covered: click them with
  `[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Make'|'Order'|'Unfirm').click()`.
- To clear a react-aria number field, click it, press `Meta+a`, then `Backspace`, then click
  another field. `fill ""` does nothing.
- Blur only onto a field you just snapshotted. A stale ref can be a link and navigates away,
  which drops the edits.
- Grid rows: the expanded row's Order line has an "Order" button and a "More options" menu
  (Assign to Me, Dismiss). A change line (Expedite) has "Apply".

## Common Failures
- "Manufacturing requires configuration for SAT-1000" on Make: item data, not planned orders.
- "Failed to load stock" toast on Buy items: the known forecast-route `.single()` issue.
- The item Planning form shows an empty (NULL) fence and horizon as "0", so a save writes 0
  for both. To keep "inherit", clear them before saving and check that the DB is NULL.
- After a convert, the next run can raise an Expedite on the new PO line to an overdue need
  and plan its week again. That is correct netting, not a duplicate.
