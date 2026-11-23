# Stock Transfer UI redesign — research + plan

Status: **implemented 2026-11-03** (uncommitted on branch). Decisions below were taken autonomously at the user's request; see §6.
Mockup: `.context/stock-transfer-mockup.html` (screenshot `.context/mockup-full.png`).
Sibling: Warehouse Transfer (`modules/inventory/ui/WarehouseTransfers/`) for the document page; the
wizard has no sibling, it is the one place this flow is built.

## 1. What is wrong today (verified in code)

| # | Problem | Where |
|---|---|---|
| P1 | The wizard starts from the **destination** ("Transfer To", step 1), then asks for the source. Users think source → destination. | `StockTransferWizard.tsx:85-87, 544-545, 725`. Reversed deliberately in #1306 ("pull-based"). |
| P2 | The destination list only holds **item × bin pairs with activity**: a non-zero ledger balance, open job demand, open transfers, or incoming PO/job output. You cannot move stock into an empty bin, or a bin the item has never been in. **This is the main complaint.** | RPC `get_item_storage_unit_requirements_by_location`, `20260923134421_stock-transfer-wizard-negative-stock.sql:139-176` |
| P3 | The destination grid is hard to read: 6 numeric columns (On Storage Unit / Required / Available / Incoming), and "Required" means job demand plus outbound transfers. | `StockTransferWizard.tsx:392-534` |
| P4 | Each destination row repeats the item, so one item in 5 bins becomes 5 rows. There are no bulk paths: no "move everything in this bin", no shared destination. | — |
| P5 | The wizard creates the transfer as **Released** (`inventory.service.ts:6262`). Lines can only be added or edited in **Draft** (`isStockTransferLocked`, `inventory.models.ts:719`). So "Add Line" on a new transfer needs Reopen first. | `StockTransferLines.tsx:323-327` |
| P6 | A simple desk move takes too many steps: list → wizard → Select → Add → Create → detail page → Pick on every line. | — |
| P7 | No validation for from ≠ to (validator, service, or DB CHECK). Quantity above on-hand is not checked for untracked lines, either at creation or at pick (an untracked pick never checks on-hand and has no row lock). | `inventory.models.ts:725-783`, `inventory.service.ts:8979` |
| P8 | The detail line shows a red/green count pill and no progress or bin on-hand. Picking is all or nothing for untracked lines. | `StockTransferLines.tsx:166-173, 213-237` |

Things that already work and should be reused:
- The `StorageUnit` picker already lists **every leaf bin** at the location, with a `Qty:` helper per item, and supports "+ New storage unit" (`components/Form/StorageUnit.tsx`, `useStorageUnitLeafOptions`). The detail page's line form uses it. Only the wizard has P2.
- `TrackedEntityPicker` is used for scanning or selecting a lot or serial in the source bin at pick time (`$id.scan.$lineId.tsx`, `assertInSourceBin`).
- `useRuleViolations` already gates create with storage rules.

## 2. What competitors do (summary, sources in the research transcript)

Odoo, NetSuite, Business Central, SAP B1/EWM, Katana, Acumatica, ShipHero and Sortly mostly work like this:
1. **Source first**, chosen from where the stock is. The picker shows only bins holding the item, with on-hand.
2. **Destination free**: any active bin, empty included. It is often defaulted from a header ("To Bin" in BC) or the item's default bin.
3. **Two modes**: a one-shot **Move** from a stock row (Odoo Relocate, Sortly, BC Bin Contents), and a multi-line document for reorganizing.
4. **Quantity defaults to available** and is capped inline. Serials and lots are limited to the source bin.
5. **Bulk**: "Get bin contents" / "move all in this location".
6. **One commit step** (Validate / Post / Done). Nobody makes a user create and then pick separately for an ad-hoc move.

Common pitfalls named in their docs, all present in Carbon today: destination limited to occupied bins; destination before source; quantity errors found only on save; from = to allowed.

## 3. Proposed design

### A. New Stock Transfer drawer (replaces the wizard), source → destination
- **Left, "Choose stock to move"**: item × bin rows with on-hand ≠ 0 at the location.
  - View toggle: **By bin** (grouped by bin, with "Move all N items →") or **By item**.
  - Filter chips: **All stock / Short for jobs / Negative**. "Short for jobs" keeps the #1306 pull-based case as a filter rather than the whole flow.
  - Search box that also takes a scanned barcode (item or bin).
  - Row actions: **Move →** adds a line with From fixed. **Fill ←** on a shortage row adds a line with To fixed; its From picker then lists only bins holding the item.
- **Right, "Where does it go?"**: an editable line table: Item | From (with available) | → | To | Quantity | remove.
  - **To** uses the `StorageUnit` picker in controlled mode (all leaf bins). Extend it to pin the item's current and default bins at the top, add an "empty" or rack-path helper, and keep "+ New storage unit".
  - **"Send all to [bin]"** in the pane header fills every empty To.
  - Inline errors: To = From; quantity > available (remaining after the other lines drawing on the same bin); quantity 0. Create stays disabled until there are no errors.
- **Footer**: "N lines · M units · K need attention" | Clear | **Create Transfer** (Released, picked later on the floor) | **Create & Move Now** (primary: create, then pick every untracked line in one server call; with tracked lines it becomes "Create & Pick" and opens the detail page at the first tracked line).
- Keep the drawer free of URL params (same reason as today). State stays in the zustand store (`stores/stock-transfer.ts`), whose line key is already (item, from, to).

### B. Quick "Move to another bin" modal
- A row action on Item → Inventory storage-unit rows (`InventoryStorageUnits.tsx`, next to "Update Quantity"). Later, also on a storage unit's contents.
- Fields: From (read-only, with on-hand) / To (any bin) / Quantity (default and max = row quantity) / Lot-serial (tracked only, preset from the row's `trackedEntityId`).
- Submit creates a one-line Stock Transfer and picks it straight away. It reuses the same ops, so the ledger and audit trail are unchanged. The toast links the `ST-…`.

### C. Detail page tweaks
- Each line reads "From → To · N there now", with progress `x / y` (neutral `Badge`; green only when fully picked) instead of the red count pill.
- **Pick All** header action for untracked lines.
- Allow add/edit lines while **Released with nothing picked** (decision D3), or create as Draft from the drawer's "Create Transfer" path.

### D. Server hardening, needed whichever UI we choose
- Refuse `fromStorageUnitId = toStorageUnitId`: in `stockTransferValidator` / `stockTransferLineValidator`, in the service functions, and in a DB CHECK (`IS DISTINCT FROM`, which allows two nulls? decide).
- Untracked pick: lock the line row and refuse an over-pick (picked + q > quantity). Refusing on-hand going negative is a policy call (D5); the wizard deliberately shows negative bins, so Carbon allows negative stock.
- New op `pickAllStockTransferLines(stockTransferId)` (or `createStockTransfer({ …, moveNow: true })`): one Kysely transaction that posts every untracked line through the existing `postStockTransfer`, so storage rules and the ledger behave exactly as today.

### Data needs, mostly existing
- Left pane: the existing `_by_location` RPC already returns on-hand / required / incoming per item × bin. Filter client-side to on-hand ≠ 0 for "All stock" and to the shortage rule for "Short for jobs". **No RPC change needed.** Optionally drop rows where on-hand = 0 and required = 0 in SQL later.
- To picker: `path.to.api.storageUnitsTree(locationId)` plus `storageUnitsWithQuantities(locationId, itemId)`. This is already what `useStorageUnitLeafOptions` reads.
- Fill ← From picker: the `_by_location_and_item` RPC (already used), filtered to on-hand > 0.

## 4. Decisions needed before implementation

- **D0. Destination = any bin (DECIDED 2026-11-03, user).** Every surface that chooses a "To" bin
  (the drawer's line To, "Send all to", the Fill ← flow's fixed To, the quick Move modal, the
  detail line form) offers every leaf bin at the location: empty bins, bins the item has never
  been in, and a newly created bin. "Where it already lives" only orders the list; it never
  filters it. Nothing on the server may refuse a destination for lacking stock or history.

- **D1. Reverse the #1306 "pull-based" order?** Recommendation: yes. Source first is the industry norm and matches how users think, and the shortage case survives as the "Short for jobs" filter plus Fill ←. Sid made the original change deliberately, so check with them.
- **D2. "Create & Move Now" as the primary button?** Recommendation: yes for desk users. "Create Transfer" stays for floor-picked transfers and kanban parity.
- **D3. Editing a Released transfer:** allow add/edit while nothing is picked, or keep Draft-only and have the drawer create Draft? Recommendation: allow while `pickedQuantity = 0` on every line. That needs a service change to `unlockedStockTransfer` plus `isStockTransferLocked`.
- **D4. Tracked items:** choose the lot or serial at creation (Katana/NetSuite style), or keep pick-time selection? Recommendation: keep pick-time in the drawer, and preset it only in the quick Move modal, where the row already names the entity.
- **D5. Negative stock:** block a transfer that drives the source bin negative, or warn only? Recommendation: inline warning in the UI, no server block (Carbon allows negative stock elsewhere).
- **D6. Scope:** ship A + D first (fixes the complaint), then B, then C? Or all at once?

## 5. Implementation phases (after decisions)

- [x] **Phase 1, server guards (D)**: from ≠ to in validators, service and migration; untracked over-pick lock; `moveNow` / pick-all op; tests in `inventory.models.test.ts` plus a service test.
- [x] **Phase 2, new drawer (A)**: rewrite `StockTransferWizard.tsx` as source → destination; extend the `StorageUnit` picker with pinned "already here" bins; update `stores/stock-transfer.ts` (lines keyed the same, add `defaultToStorageUnitId`); Lingui strings; browser-verify at 1440 / 1024 / 390.
- [x] **Phase 3, quick Move (B)**: modal in `modules/inventory/ui/StockTransfers/`; row action in `InventoryStorageUnits.tsx`; posts to `newStockTransfer` with `moveNow`.
- [x] **Phase 4, detail polish (C)**: line layout, Pick All, editing while Released (D3).
- [ ] Docs: update `modules/inventory/AGENTS.md` (Stock Transfer bullet + service table), the user docs page if one exists, and a changelog entry.

Validation per phase: `pnpm exec turbo run typecheck --filter=erp`, `pnpm run lint`, vitest for inventory models/service, and `/test` in the browser.

## 6. What was decided and built (2026-11-03)

- D0 any destination ✓. D1 source first ✓ ("Needs stock" + Fill keeps the pull case). D2 "Create & Move Now" primary ✓ (`moveNow`).
- D3 **not** done: a line added to a Released transfer would skip the storage-rule check that Release runs, so lines stay Draft-only. The drawer builds every line before create, which removes most of the need.
- D4 pick-time for the drawer; the quick Move names the unit, so a serial or batch row is picked on create. A tracked item's untracked row has Move disabled (nothing a transfer could pick).
- D5: the UI blocks a line over the source's on-hand (less other lines' draws); the server does not (negative stock stays allowed for API callers).
- From ≠ To enforced in validators + every create/update operation; **no DB CHECK** (schema change on a production table needs sign-off).
- Untracked single pick now locks the line and refuses an over-pick; the detail Pick sends what is left.
- New: `pickAllStockTransferLines` (+ header **Pick All**), `pickUntrackedStockTransferLines` building block, `StockTransferMoveModal`, `StorageUnit` `stockedFirst` / `excludeId`.
- Verified in the browser at 1440 / 1024 / 390: move into an empty bin (ledger pair checked), Move all, Send all to, Fill, By item, Create Transfer → Pick All, single Pick, quick Move (untracked and batch partial split).
- Open: translations for the new strings are empty in non-English catalogs (`/translate`).

## Later change (2026-11-03)

Create & Move Now and the per-line serial / batch picker were removed from the New Stock Transfer page: Create Transfer is its only action and every line is picked on the transfer page. `moveNow` stays on `createStockTransfer` for the Move to Another Storage Unit modal, its only caller.
