-- Purchase orders raised by the planning pages skip the approval rule when the
-- company allows it (on by default).
--
-- "createdFromPlanning" is set only on a PO the planning Order button creates.
-- Any manual line change afterwards — adding, editing or deleting a line on the
-- PO page, the API or MCP (upsertPurchaseOrderLine / deletePurchaseOrderLine) —
-- clears it, so an MRP purchase order cannot be padded to dodge approval.
-- Planning's own writes (its Order button, Apply, the drawer's inline edit)
-- keep it. The finalize route reads both columns.
ALTER TABLE "purchaseOrder"
  ADD COLUMN IF NOT EXISTS "createdFromPlanning" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "skipApprovalForPlanningPurchaseOrders" BOOLEAN NOT NULL DEFAULT true;
