# Use As Is → Put Away

Last tested: 2026-11-16
Routes: /x/purchase-order/<id>/details → Receipts → New Receipt,
/x/receipt/<id>/details, /x/inspection/<lotId>, /x/issue/<id>/details,
/x/stock-transfer/<id>
Rule: `.claude/rules/inspection-system.md` → "Use As Is → Put Away"

## Prerequisites
- Seeded satellite company. Manufacturing Plant has Inspection unit
  "QC-Inspection" and Rejected unit "MRB-Hold" (Settings → Quality).
- PO000020 "To Receive and Invoice": PCB-BARE-REV3 × 25 (untracked, Receipt
  inspection plan, default bin A1-L1) and BAT-LIION-48V × 25 (batch).
- One PO can be received several times: header button "Receipts" → menu item
  "New Receipt" (the header shows "Receive" only before the first receipt).

## Steps
### 1. Receive part of the PO
- New Receipt → Draft. Set "Received quantity for BAT-LIION-48V" to 0 and
  "Received quantity for PCB-BARE-REV3" to e.g. 10; blur each (click "External
  Reference"). The save lands a few seconds after the blur.
- "Post" → requestSubmit the "Post Receipt" form → "Rule Violation" →
  click "Acknowledge & continue". Receipt Posted, "Pending Inspection".

### 2a. Partial → Use As Is (two Put Away lines)
- `/x/inspection/<lotId>` → "Partial" → fill "Accepted quantity" 6, reason →
  requestSubmit "Mark Partial" → redirects to the NCR (4 held in MRB-Hold).
- Receipt → "Put Away" → transfer of 6 QC-Inspection → A1-L1 → "Pick".
  Receipt reads "Put Away" (the 4 are still under the open NCR).
- NCR → disposition combobox "Status" → option "Use As Is" → "Start" →
  "Complete". The receipt drops back to "Partially Passed".
- Receipt → "Put Away" is back → transfer of 4 **MRB-Hold → A1-L1** → "Pick".
  Receipt "Put Away", button gone.

### 2b. Reject → Use As Is
- Inspection → "Reject Lot" → fill "Reason", keep "Open an NCR for MRB
  disposition" ticked → requestSubmit the modal's "Reject Lot".
- Receipt: no "Put Away" button while the NCR is open; "Inspection Failed".
- NCR → "Use As Is" → Start → Complete → Receipt "Put Away" button → transfer
  of all units **QC-Inspection → A1-L1** (the write-off is restored where it was
  taken) → Pick → receipt "Put Away".

### 2c. Reject → Rework
- Same as 2b with "Rework": the stock is back in QC-Inspection, no "Put Away"
  button, receipt stays "Inspection Failed".

### 3. Serial: a Put Away line takes only the units it offers
- Prerequisite: a serial part we buy with a Receipt inspection plan. The
  satellite seed has none: RW-010 (serial, supplier Deep Space RF, default bin
  A2-L2) needs an Active `inspectionDocument` and an
  `itemInspectionDocumentAssignment` (usage Receipt), or assign one on the
  item's Quality tab.
- New PO (`/x/purchase-order/new`): Supplier "Deep Space RF", requestSubmit
  "Save" → "Add Line Item" → Item RW-010, Quantity 3 → Save → "Finalize" →
  dialog "Finalize" → status Needs Approval → "Approve" → dialog "Approve".
- "Receive" → three "Serial number N for RW-010" boxes, fill and blur each →
  Post (acknowledge rules).
- Inspection: By part grid, row per serial, Pass / Fail buttons. Pass unit 1,
  Fail units 2 and 3 → "Partial" → keep "Open an NCR…" → "Mark Partial".
- NCR: "More actions" → "Split line" → tick unit 3 → "Split". First row "Use
  As Is", second "Rework" → Start → Complete. Units 2 and 3 are now both
  Available in MRB-Hold.
- Receipt → Put Away → two lines: MRB-Hold → A2-L2 and QC-Inspection → A2-L2.
- MRB-Hold line "Pick" → "Select" tab lists only unit 2. Scan tab with unit 3
  shows the red ×. A direct POST of unit 3 to
  `/x/stock-transfer/<id>/scan/<lineId>.data` (JSON: itemId, locationId,
  stockTransferId, trackedEntityId, quantity 1) returns "… is not part of this
  Put Away …" and picks nothing.
- Pick unit 2, then unit 1 on the QC line → transfer Completed, receipt
  "Put Away", unit 3 left in MRB-Hold.

## Selector Notes
- The NCR's disposition picker is the combobox labelled "Status" in the
  Disposition card; options Pending / Return to Supplier / Rework / Scrap /
  Use As Is. It saves on pick.
- "Complete" on the NCR is disabled until "Start".
- Modal submits (Post Receipt, Mark Partial, Reject Lot) need
  `form.requestSubmit(button)`; the Reject modal's button has the same text as
  the page button, so take the last match inside a form.

## Common Failures
- `agent-browser open` right after launching can land on about:blank; open again.
- Another agent may drive the default agent-browser session (the page jumps to
  another worktree's app, or to the login page where a stale ref is "Sign in
  with Google"). Use `AGENT_BROWSER_SESSION=<name>` on every command.
