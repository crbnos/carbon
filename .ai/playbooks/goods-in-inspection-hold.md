# Goods-In Inspection Hold

Last tested: 2026-11-04 (steps 1–6). Steps 7–10 added 2026-11-10 from the code and
the database tests; not yet run in a browser.
Routes: /x/settings/quality, /x/purchase-order/<id>/details → Receive,
/x/receipt/<id>/details, /x/inventory/receipts, /x/inspection/<lotId>,
/x/stock-transfer/<id>
Spec: .ai/specs/2026-11-03-goods-in-inspection-hold.md

## Prerequisites
- Seeded satellite company (`crbn up`). PO000018 is "To Receive and Invoice" with
  PCB-BARE-REV3 × 25: an untracked part with a Receipt inspection plan.
- A non-nettable storage unit at Manufacturing Plant besides MRB-Hold. A dataset
  seeded after 2026-11-03 has "QC-Inspection" and the plant's two settings
  already set. On an older seed, insert one (copy MRB-Hold's warehouseId and
  storageTypeIds — the Quarantine type makes it non-nettable).

## Steps
### 1. Settings → Quality → "Goods-in storage" card
- One row per location, two comboboxes (Inspection, Rejected). Headquarters shows
  both disabled with "No non-nettable storage units".
- Plant row: click the first combobox → option "QC-Inspection"; second → "MRB-Hold".
  Each change saves at once. Verify toast "Goods-in storage updated".
- Server refusal of a nettable unit: POST FormData `intent=setLocationGoodsInStorage`
  to `/x/settings/quality.data?_routes=routes%2Fx%2B%2Fsettings%2B%2Fquality` →
  `rule` "Choose a non-nettable storage unit." (422).

### 2. Receive PO000018
- PO details → button "Receive" → `/x/receipt/<id>/details`.
- Verify: header badge "Inspection required"; PCB line has the red clipboard
  mark, an "Inspection required" badge and Storage Unit = QC-Inspection.
- The battery line (BAT-LIION-48V) is batch-tracked: fill its Received with 0
  and blur, or Post stays disabled ("Batch number is required").

### 3. Post refusal on a nettable unit
- PCB line Storage Unit combobox → "A1-L2 Aisle-A". Red text under it:
  "Choose a non-nettable storage unit at this location for inspected parts."
- Post → modal → requestSubmit "Post Receipt". Toast
  "PCB-BARE-REV3 needs inspection. Choose a non-nettable storage unit at
  Manufacturing Plant."; stays Draft.
- A line that delivers to another location is checked against that location's
  units, not the receipt's.

### 4. Post
- Set the line back to QC-Inspection. Post → requestSubmit "Post Receipt" →
  "Rule Violation" (seeded propellant-tank warning) → click "Acknowledge & continue".
- Verify: header "Posted" + "Pending Inspection"; line badge "Pending";
  Documents lists the INS lot.
- Receipts list: "Inspection" column; sidebar "Pending inspection" link filters
  `inspectionStatus:in:Pending Inspection,Inspection In Progress`.

### 5. Partial (untracked)
- `/x/inspection/<lotId>` → button "Partial" → modal "Partial Lot".
- Fill "Accepted quantity" 20 (text "5 will stay held as rejected."), reason,
  Issue Type defaults. No NCR checkbox (required for untracked).
- requestSubmit "Mark Partial" → redirects to the new issue.
- Verify (DB): lot Partial, acceptedQuantity 20, storageUnitId = MRB-Hold;
  ledger QC-Inspection 20, MRB-Hold 5; receipt "Partially Passed";
  `inspection_held_quantity` = 5; NCR item 5 × Scrap.

### 6. Put Away
- Receipt → button "Put Away" → toast "Putaway created", redirects to the new
  stock transfer: one line PCB × 20, QC-Inspection → A1-L1 (the part's default
  bin). It is Released because every line has a To unit; one transfer is made
  per line location.
- Line button "Pick" → transfer Completed → receipt header "Put Away"; the
  Put Away button is gone.

### 7. Put Away with no To unit
- Before step 6, remove PCB-BARE-REV3's default storage unit at the plant
  (item → Inventory → pick method).
- Put Away → the transfer is **Draft** and the line's To is empty.
- Release → toast "Choose the To storage unit of every Put Away line first.";
  stays Draft.
- Edit the line: changing the quantity or From unit is refused ("A Put Away line
  moves what the receipt holds. Only its To storage unit can change."). Set
  only To → saves. Release → Released; Pick works as in step 6.

### 8. Void a receipt with a Put Away
- On a receipt whose lot Passed: Put Away, then void the receipt before picking.
  The void posts and the Put Away transfer is gone.
- Same, but pick part of the line first → toast "Cannot void: Put Away ST-… has
  picked stock. Unpick it first."
- The step-5 receipt (untracked Partial) → toast "Cannot void: inspection INS-…
  accepted part of this stock and holds the rest under its NCR. …".

### 9. NCR rules for a receipt lot
- Issue (not the lot's NCR) → Associations → add inspection → the step-5 lot →
  refused: "Inspection lot INS-… already has its NCR. A receipt lot belongs to one
  NCR."
- The lot's own NCR → add another receipt lot → refused: "A Partial inspection lot
  must be the only lot on its NCR. …"
- Close the lot's NCR (Use As Is or Scrap), then Reopen → refused: "This NCR
  released the rejected part of inspection lot INS-…, so it cannot be reopened."

### 10. Smaller checks
- Settings card: a user without Resources update sees the two comboboxes
  disabled.
- Inventory sidebar: on "Pending inspection", only that link is highlighted, not
  "Receipts".
- Partial dialog on a serial lot with no issue types and "Open an NCR" ticked:
  "Mark Partial" is disabled; untick it to mark Partial without an NCR.
- A serial lot accepted with one failed unit: Put Away offers the passed units,
  and the receipt reaches "Put Away" once they are picked.

## Selector Notes
- Comboboxes in the settings card have no label; order is HQ inspection, HQ
  rejected, Plant inspection, Plant rejected.
- Post modal and Partial modal submit with `form.requestSubmit(button)`; a
  click does nothing.
- "Acknowledge & continue" is a plain button (click works).
- `agent-browser screenshot` needs an absolute path.

## Common Failures
- "Sign-ups are disabled…" at login: the stack's ports are out of sync
  (`.env.local` vs containers) so GoTrue's settings cannot be read; Enterprise
  then refuses. `crbn down && crbn up`.
