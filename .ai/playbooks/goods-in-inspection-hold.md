# Goods-In Inspection Hold

Last tested: 2026-11-04
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
  "Choose a non-nettable storage unit for inspected parts."
- Post → modal → requestSubmit "Post Receipt". Toast
  "PCB-BARE-REV3 needs inspection. Choose a non-nettable storage unit."; stays Draft.

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
- Receipt → button "Put Away" → redirects to the new stock transfer (Released):
  one line PCB × 20, QC-Inspection → A1-L1 (the part's default bin).
- Line button "Pick" → transfer Completed → receipt header "Put Away"; the
  Put Away button is gone.

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
