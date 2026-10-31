# Tracked stock integrity

Four bugs, one invariant: Batch and Serial stock always belongs to a numbered
unit, and an issue never counts material as issued without moving stock.

- Bug 16: a Batch item could hold stock with no batch. The app let an item
  with stock change to Batch. A positive adjustment with a blank Batch Number
  made a batch with no number.
- Bug 25: an API, MCP or direct MES-route increase of a Batch or Serial item
  that named no unit booked untracked stock.
- Bug 15: the Parts panel + reads the item's type and asks for a batch. The
  part row reads the job line's flag and asks for a quantity only. The cascade
  updated that flag on Draft and Planned jobs only.
- Bug 17: an issue from the part row raised `quantityIssued` and posted no
  ledger row. `partToOperation` writes a ledger row for Inventory items only.

## Tasks

- [x] **Adjustment posting** (`postInventoryAdjustment`, `inventory.service.ts`):
  on the increase path, refuse a Batch or Serial item with no
  `trackedEntityId`, and a new unit with no `readableId`. Pure rule
  `stockIncreaseRefusal` (`inventory.utils.ts`). Every caller goes through the
  posting: `adjustInventory` (ERP page, API, MCP), the MES adjustment route.
  Decreases are unchanged, so untracked stock can still be drained.
- [x] **Tool description**: `adjustInventory` remarks and `@param` for
  `trackedEntityId` / `readableId`; regenerate the MCP digest.
- [x] **Adjustment form** (`InventoryStorageUnits.tsx`): Batch / Serial Number
  is marked required for a new unit on a positive adjustment or Set Quantity.
- [x] **Tracking type change** (`setItemTrackingType`, `items.server.ts`):
  refuse Batch or Serial while an item (not already of that type) has a
  positive untracked balance at any location. `getItemsWithUntrackedStock`
  (`items.service.ts`, Kysely, mirrors the strict-backflush untracked sum),
  message from `trackingTypeChangeRefusal` (`items.utils.ts`), returned as
  `rule` like `setItemActive`'s refusal.
- [x] **Cascade** (`cascadeItemTrackingType`): job material flags also follow
  the item on released jobs (not Completed/Closed/Cancelled) for lines with
  nothing issued. Job make methods stay Draft/Planned only.
- [x] **Issue posting** (`issue` `partToOperation`): refuse a Batch or Serial
  item by its current type (`untrackedIssueRefusal`), before any write.
- [x] Tests: `inventory.utils.test.ts`, new `items.utils.test.ts`.
- [x] Sync: items, inventory and production AGENTS.md; `inventory-system.md`;
  docs `reference/inventory.mdx`, `items.mdx`, `mes.mdx`.
- [x] Verify: scoped erp and mes typecheck, the tests above, Biome.

## Decisions

- 15/17: cascade plus a posting refusal, not a MES modal change. The stale flag
  is the cause, and every flag reader (part row window, operation backflush,
  job-completion backflush, picking, step backflush) follows a fixed line. The
  refusal covers lines the cascade leaves (something issued, or switched before
  this fix) and direct posts. The modal still reads the line flag.
- Released-job cascade runs in both directions, like the Draft/Planned one.
- 16(a) checks only a change to Batch or Serial; leaving Batch/Serial is
  unchanged. Re-setting an item's current type skips the check and re-runs the
  cascade, which repairs stale released lines.
- Untracked Unscrap of a Batch or Serial item is left as it was.
- No backfill migration for existing stale job lines.
