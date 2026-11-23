# Non-nettable Storage Units and Types

Last tested: 2026-10-28
Routes: /x/inventory/storage-types, /x/inventory/storage-units,
/x/part/<itemId>/planning, /x/purchasing/planning, /x/picking-list/schedule

## Prerequisites
- `pnpm db:seed:dev -- --email test@carbon.ms --dataset satellite` (any dataset):
  seeds a non-nettable "Quarantine" storage type and an empty "MRB-Hold" unit.
- A bought item on an open job's materials with warehouse stock, e.g. BRG-6201
  (satellite), and one batch-tracked item with a lot, e.g. BAT-LIION-48V.

## Steps
### 1. Storage types list and form
- `/x/inventory/storage-types` — "Non-nettable" column; Quarantine checked.
- Open Quarantine — bordered "Non-nettable" switch is on. Toggle, then
  requestSubmit the form whose button reads "Save". DB: `storageType.nettable`
  flips and every unit with the type gets `storageUnit.effectiveNettable` flipped.
- `?filter=nettable:eq:false` shows only Quarantine.

### 2. Storage units list, inheritance
- `/x/inventory/storage-units?search=MRB` — MRB-Hold checked (through its type).
- Open it — switch OFF, description "Already non-nettable through its storage type
  Quarantine" (a child unit reads "…through its parent MRB-Hold"). Saving unchanged
  keeps `nettable=true, effectiveNettable=false`.
- New child: `/x/inventory/storage-units/new?parentId=<MRB-Hold id>&location=<loc>`,
  fill Name "MRB-Hold-Shelf-1", requestSubmit "Save" — child gets `effectiveNettable=false`.
- Toggle a parent rack (Aisle-A): all its children flip, and
  `itemStockQuantities.quantityNonNettable` moves by their stock.
- `?filter=effectiveNettable:eq:false` lists every non-nettable unit, children included.

### 3. Stock into quarantine, planning
- Item inventory page `/x/inventory/quantities/<itemId>/details` → "Update
  Inventory" modal: Storage Unit combobox (type "MRB", pick MRB-Hold-Shelf-1),
  Quantity fill + blur, requestSubmit "Save". A demo storage-rule warning may
  appear: "Acknowledge & continue".
- `/x/part/<itemId>/planning` — Quantity on Hand card shows physical on-hand
  with "N in non-nettable storage, not planned against"; the forecast loader
  returns `quantityNettable` = on-hand − non-nettable.
- `/x/purchasing/planning?search=<item>` — the RPC's quantityOnHand is nettable.

### 4. Picking
- `/x/picking-list/schedule?location=<loc>` — tick an operation card's checkbox,
  click "Generate Picking List N". The line's source bin is never a
  non-nettable unit even when it holds the most stock.
- Tracked: `/x/picking-list/<id>/tracked/<lineId>` (ERP) and
  `${MES_URL}/x/picking/<id>/tracked/<lineId>` (MES) return JSON `entities`; a lot
  in a non-nettable unit is absent.

### 5. Release with a stock transfer
- `/x/inventory/stock-transfers` → "Add Stock Transfer" (wizard). Search the
  item in "Transfer To", Select the destination row (e.g. its Default bin).
  "Transfer From" lists the non-nettable unit as a source ("2 available") —
  click its Add, then "Create Transfer" (created Released).
- On the transfer, click the line's "Pick" (native click) → picker modal →
  "Select" tab: the lot in the non-nettable unit is offered. Click its Pick;
  the transfer completes.
- DB: the lot is at the destination and `quantityNonNettable` drops by it; the
  picking-list tracked routes offer the lot again.

### 6. Kanbans refuse a non-nettable unit
- `/x/inventory/kanbans/new`: Item combobox (type the part number, click the option),
  Replenishment System "Make", Storage Unit "MRB-Hold-Shelf-1", requestSubmit the form
  whose submit button reads "Create Kanban". Toast: "MRB-Hold-Shelf-1 is non-nettable. A
  kanban cannot replenish into or from a non-nettable storage unit."; no row is written.
  The same form with a nettable unit creates the kanban; editing it to the non-nettable
  unit ("Update Kanban") is refused the same way.

### 7. CSV import
- Storage Units list → "Table actions" → "Import Storage Units CSV". Upload with
  `agent-browser upload "input[type=file]" <file>`; the "Non-nettable" header maps on its
  own. Next → Confirm Import. `yes` makes a unit non-nettable; a blank cell on an
  existing unit leaves its flag alone.

## Selector Notes
- The switch: `document.querySelector('form button[role=switch]')`.
- Storage unit list scrolls an inner container — use `?search=` instead.
- `/x/picking-list/new` and `/quantities/<id>/adjustment` are action-only.

## Common Failures
- Dev server "Cannot find package '@tiptap/core'": the worktree was installed with
  pnpm's global virtual store. Reinstall with
  `pnpm install --config.enable-global-virtual-store=false --config.confirmModulesPurge=false`.
