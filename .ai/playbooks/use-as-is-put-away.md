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
