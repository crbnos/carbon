# Fix: SO line marked "Shipped" with no shipment (Non-Inventory Parts)

## Problem
Sales order line PRT-103771.A (S000328) shows a green **SHIPPED** badge, but no
shipment exists and `job.quantityShipped = 0/3`. The badge is data-driven:
`getSalesOrderJobStatus` (`packages/utils/src/status.ts:145`) shows "Shipped" when
`isCompleted && line.sentComplete`. So `salesOrderLine.sentComplete = true` with no shipment.

## Root cause
Two code paths disagree on what "never ships" means:
- **Shipment creation** (`create` edge fn, `functions/create/index.ts:2027`) skips only
  `salesOrderLineType === "Service"` — a Non-Inventory **Part** DOES get a shipment line and ships normally.
- **Job completion** (`complete_job_to_inventory`, newest def
  `20260727031247_inspection-production-links.sql:262`) fulfills the SO line
  (`sentComplete/quantitySent/sentDate`) for **every** `itemTrackingType = 'Non-Inventory'` item.

`itemTrackingType = 'Non-Inventory'` ⊋ `type = 'Service'`. A Non-Inventory Part is
Non-Inventory-tracked but has `salesOrderLineType = 'Part'`, so it ships — yet completion
auto-marks it fulfilled. Same flaw in `recompute_service_line_fulfillment`
(`20260723132843`).

## Fix (one migration, fix-forward — prior migrations are on main)
1. `complete_job_to_inventory` — narrow the SO-line fulfillment guard from
   `itemTrackingType = 'Non-Inventory'` to also require `salesOrderLineType = 'Service'`.
   (Only the fulfillment block; the other Non-Inventory guards — inventory/COGS skips — are correct and untouched.)
2. `recompute_service_line_fulfillment` — same narrowing (keeps reopen recompute consistent).
3. Data repair: reset `quantitySent=0, sentComplete=false, sentDate=NULL` on lines that were
   erroneously auto-fulfilled — Non-Inventory, non-Service, `sentComplete=true`, have a
   Completed/Closed job, and have NO shipmentLine with `shippedQuantity > 0`. Idempotent.

## Verification
- `pnpm exec turbo run typecheck --filter=@carbon/database` (no type surface change; sanity).
- Confirm the affected production row via the diagnostic query once DB reachable.
- Genuine Service Make-to-Order lines still fulfill on completion (guard still matches them).
