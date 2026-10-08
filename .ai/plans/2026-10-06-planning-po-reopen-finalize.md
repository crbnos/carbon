# Planning: reopen / finalize purchase orders from the action menu

Context: a planning action on a committed PO shows **Review**. The planner had to
leave the page, reopen the PO, come back, and wait for MRP before Apply showed.

Decisions (2026-10-06, with Brad):
- Reopen from planning moves the PO to **Planned**, not Draft — Draft is not MRP
  supply (`openPurchaseOrderLines` excludes it), so a Draft PO's lines drop out
  and the next run suggests the whole need again as a new order.
- Mirror the PO page: **Reopen** (no revision) and **Reopen as Revision** (only
  a released PO: locked status + orderDate) are separate items.
- **Finalize** reuses `PurchaseOrderFinalizeModal` + the finalize route.

## Tasks

- [x] Status route (`purchase-order+/$orderId.status.tsx`): reopen semantics
      (delete permission from a locked status, pending approvals cancelled,
      revision) apply to a reopen to Planned as well as Draft.
      `reopenPurchaseOrderAsRevision` / `canCreatePurchaseOrderRevision` take
      the target status.
- [x] `getPlanningActions`: embed the line's promised date, the delivery's
      promised date and the PO's orderDate.
- [x] `PlanningActionRowActions`: Review vs Apply from the LIVE PO status
      (`planningActionNeedsReview`, pure + tested); ⋯ gains Reopen / Reopen as
      Revision (committed PO) and Finalize (Draft / Planned PO).
- [x] Finalize from planning: `api+/purchasing.purchase-order.$id.finalize.ts`
      (PO + default CC) and `PurchaseOrderFinalizeModal` takes the id as a prop.
- [x] Apply quantity is received-aware: `purchaseQuantity` = received + the
      suggested remaining (a reopened PO can carry receipts).
- [x] MRP: an order late within the reschedule tolerance counts from its first
      need week when sizing (no "Increase 100 → 200" for a need it covers).
- [x] Remove unused `withoutOrdersFoldedIntoIncreases` (already removed in the working tree).
- [x] Verify: vitest (planning + erp tests touched), erp typecheck, biome.
