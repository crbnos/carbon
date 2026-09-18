# Mirror purchase-returns + shipments work into sales-returns (RMAs) + receipts

Branch: `returns-module`. Mirrors the `b82c278b66` purchase-return/shipment UI+data
work onto the sales-return (RMA) and receipt sides. Decisions locked: **A = RPC
(faithful mirror), B = reopen-to-Draft in scope, picker = receipt-side only (no RMA-line
tracked-entity picker — domain-asymmetric, left untouched).**

## Do NOT mirror (domain asymmetry — verified)
Tracked-entity pre-selection on the RMA line: `TrackedEntityPicker`,
`returnableEntities`/`selectedEntityIds`/`pickedEntityLabels`, `trackedEntityIds` submit,
a `set*` write path, the `$id.new` auto-select block. The RMA's entity provenance is
captured at the **receipt** (`ReturnEntityForm`); `salesReturnOrderLineTrackedEntity` is
read-only legacy. Preserve sales-only Disposition select + `salesResolvePrice` pricing.

## Tasks

### Receipts (inventory)
- [ ] R1. `ReceiptForm.tsx` `SourceDocumentLink`: add `Sales Return Order` case →
      `path.to.salesReturnOrderDetails`, `LuUndo2` icon, gate `view`,`sales`. + import `LuUndo2`.

### Sales Returns (RMA) — data layer
- [x] S1. `get_returnable_shipment_lines` RPC (mirror of `get_returnable_receipt_lines`,
      but sales semantics: unit price from `salesOrderLine.unitPrice` (no conversion
      factor), UoM COALESCE(sol, sl)). Folded INLINE into the existing branch migration
      `20260909195813_returnable-receipt-lines-rpc.sql` (NOT a new migration) — user runs
      `crbn reset` to rebuild + regenerate types.
- [ ] S2. `sales.service.ts` `getReturnableLinesForCustomer`: replace JS fan-out with the
      RPC (search/limit/offset/totalCount) — mirror `getReturnableLinesForSupplier`.
- [ ] S3. `sales.service.ts` `reopenSalesReturnOrder`: mirror `reopenPurchaseReturnOrder`
      (Confirmed/Cancelled → Draft, row-locked). Export from module barrel.
- [ ] S4. `routes/x+/sales-return-order+/returnable-lines.tsx`: add search/limit/offset +
      return `totalCount`.
- [ ] S5. `routes/x+/sales-return-order+/$id.status.tsx`: accept `"Draft"`, call reopen.
- [ ] S6. `routes/x+/sales-return-order+/$id.$lineId.details.tsx` loader: also resolve
      internal source-doc ids (`shipment(id,…)`, `salesOrder(id,…)`, `salesInvoice(id,…)`),
      add to `linkage`.

### Sales Returns (RMA) — UI
- [ ] S7. `ReturnableLinesModal.tsx`: rewrite to mirror `ReturnableReceiptLinesModal`
      (debounced search + pagination "Show more" + selected-line snapshot + counts).
- [ ] S8. `SalesReturnOrderLineForm.tsx`: `SourceReference` navigable links (replace
      Badges); `areLineFieldsLocked = isEditing && status !== "Draft"` → `isReadOnly` on
      Item/qty/unitPrice/restockFee. Keep Disposition + salesResolvePrice.
- [ ] S9. `SalesReturnOrderHeader.tsx`: add Reopen dropdown item + statusFetcher
      (mirror `PurchaseReturnOrderHeader`).

## Verify
- `pnpm exec turbo run typecheck --filter=erp` (after user applies migration + regen types).
- No commit unless asked.
</content>
</invoke>
