# Stock Transfer — decimal batch pick (identity-flip split)

Last tested: 2026-09-23
Route: `/x/inventory/stock-transfers` → transfer → `/x/stock-transfer/<id>/scan/<lineId>`

## Prerequisites
- A **batch-tracked** item with a fractional UoM (e.g. `MAT-AL7075-PLT`) and an
  **Available batch lot** with more on-hand than you intend to pick (partial draw
  is what triggers the split). Create one via a positive inventory adjustment,
  e.g. lot `XFER-DEC` = 5.5 lb at `A2-L1` (see
  `inventory-adjustment-decimal-batch.md`).
- Two storage units in the location (source `A2-L1`, destination `A2-L2`).

## Steps

### 1. Create the transfer with a controllable decimal line
- The **"Add Stock Transfer"** wizard is demand-driven: its only destinations
  are bins/locations that already NEED stock, and it creates the transfer as
  **Released** (non-editable). This makes a clean bin→bin decimal line hard.
- Reliable path: create ANY transfer via the wizard (pick the demand row as
  destination, add a source, Create Transfer), then on the transfer page
  **More options → Reopen** (→ Draft). Reopen reveals **Add Line**.
- **Add Line**: Item = the batch item; Quantity = your decimal (e.g. `2.25`);
  From Storage Unit = `A2-L1`; To Storage Unit = `A2-L2`. Save.
  - The From/To storage-unit dropdown options are rendered in a portal and may
    NOT appear in `snapshot -i`; read/click them via
    `document.querySelectorAll('[role=option],[cmdk-item]')`.
- Re-**Release** (button enabled once a line exists). Release/Complete disabled +
  no "Add Line" ⇒ it's Released.

### 2. Pick the lot (partial → split)
- Click the line's **Pick** button (native agent-browser `click @ref`; a
  synthetic `.click()` may not fire the React navigate). It opens the scan route
  `.../scan/<lineId>` as a `TrackedEntityPicker` modal.
- **Select** tab → the lot shows "`XFER-DEC` · N available · A2-L1" with a Pick
  button. Click it. The picker submits `min(lineQty − pickedQty, lotAvailable)` —
  here `min(2.25, 5.5) = 2.25`, a PARTIAL of the lot.
- Success toast: **"Tracked entity scanned and transferred"**.

### 3. Verify the split
- Item detail storage-unit table shows the lot split across bins:
  `A2-L1 | 3.25 | XFER-DEC` (parent kept its id, decremented) and
  `A2-L2 | 2.25 | XFER-DEC` (new child at the destination). Sum = original 5.5.
- `/x/inventory/tracked-entities?search=XFER-DEC` shows **2 rows, both AVAILABLE**:
  `2.25` (child) and `3.25` (parent). All clean decimals — no float residue, no
  Consumed husk. This is the identity-flip split with `buildBatchSplitRecords`
  rounding at the persist boundary + the `isFullDraw` gate.

## Common Failures
- **Empty transfer after the wizard.** The wizard's only destination for the item
  was "No storage unit" (null bin); the header is created but no usable line.
  Reopen → Add Line as above.
- **Pick button "does nothing".** Use agent-browser's native `click @ref`, not a
  DOM `.click()` — the button navigates via React Router.
- If the draw covers the whole lot it's a FULL draw (no split). The draw is
  `min(lineQty − pickedQty, lotAvailable)`, so the test is
  `lineQty − pickedQty ≥ lotAvailable` — the line TOTAL is not the right
  comparison once something has already been picked (`lineQty=2.25`,
  `pickedQty=1`, `lotAvailable=2` is a partial draw of `1.25`). To force a
  split, keep the line's REMAINING quantity below the lot's available.
