# Purchasing Module

Purchase orders, supplier management, supplier quotes/interactions, RFQs, and procurement planning. Handles the full procure-to-receive lifecycle including supplier approval workflows, quote finalization, and conversion to purchase orders.

## Key Domain Concepts

- **Purchase Order (PO)** — document sent to a supplier. Statuses: Draft → Needs Approval → To Review → To Receive → To Receive and Invoice → To Invoice → Completed. MUST use `closePurchaseOrder` to close manually.
- **Supplier Interaction** — umbrella entity linking a supplier quote to RFQs, POs, and documents. A supplier quote always lives under an interaction.
- **Supplier Quote** — vendor-side pricing with line-level price breaks (`supplierQuoteLinePrice`). Can be finalized (`finalizeSupplierQuote`) and converted to POs via the `convert` edge function.
- **RFQ (Request for Quotation)** — solicits pricing from multiple suppliers. Links to supplier quotes via `purchasingRfqToSupplierQuote`. Statuses managed by `updatePurchasingRFQStatus`.
- **Conversion Factor** — when a supplier's UoM differs from stocking UoM, `conversionFactor` on `purchaseOrderLine` scales quantities at receipt: `inventoryQty = purchaseQty × conversionFactor`. See `.ai/rules/purchasing-conversion-factors.md`.
- **Purchasing Planning** — MRP-driven planned orders surfaced via `getPurchasingPlanning` (calls `get_purchasing_planning` RPC).

## Safety

### Always
- MUST scope all queries by `companyId` — purchasing data is multi-tenant.
- MUST use the `convert` edge function for supplier-quote → PO conversion — never hand-roll inserts.
- MUST preserve `conversionFactor` on PO lines when editing — it drives receipt quantity math.
- MUST use `finalizePurchaseOrder` / `finalizeSupplierQuote` for finalization — they enforce business rules.

### Ask First
- Changing PO status (approval/finalization workflows have business rules).
- Deleting suppliers or POs that may have linked receipts or invoices.

### Never
- Bypass the approval workflow by directly setting status to `To Receive`.
- Delete receipt lines that have already been posted to inventory.
- Directly INSERT into `purchaseOrder` — MUST use `insertPurchaseOrder` / `upsertPurchaseOrder`.

## Validation Commands

```bash
pnpm --filter @carbon/erp typecheck
pnpm --filter @carbon/erp test
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `purchaseOrder` / `purchaseOrders` (view) | PO header: supplier, status, dates, location; view adds `receivableQuantity`/`receivedQuantity` aggregates (drives the list's Received progress bar and the derived "Partially Received" header chip — display-only, not a status enum value) |
| `purchaseOrderLine` | Line items: item, quantity, price, conversionFactor, jobId |
| `purchaseOrderDelivery` / `purchaseOrderPayment` | PO delivery and payment terms |
| `supplier` / `suppliers` (view) | Vendor master: name, type, status, tax info |
| `supplierContact` / `supplierLocation` | Supplier address book |
| `supplierProcess` | Which manufacturing processes a supplier offers |
| `supplierInteraction` | Container for a supplier quote exchange |
| `supplierQuote` / `supplierQuoteLine` / `supplierQuoteLinePrice` | Vendor pricing at quantity breaks |
| `purchasingRfq` / `purchasingRfqLine` / `purchasingRfqSupplier` | RFQ header, lines, and invited suppliers |
| `terms` | Payment/delivery terms reference data |

## Key Service Functions

- `getPurchaseOrder` / `getPurchaseOrders` / `getPurchaseOrderLines` — read POs
- `closePurchaseOrder` — marks a PO closed
- `shortClosePurchaseOrderLine` — Kysely transaction; sets a line's `receivedComplete` ("Stop/Resume Receiving") and recomputes the header status. Open-PO supply queries (`get_inventory_quantities`, `openPurchaseOrderLines`, `get_job_quantity_on_hand`) exclude `receivedComplete` lines, so short-closed remainders stop counting as incoming stock
- `convertSupplierQuoteToOrder` — calls `convert` edge function
- `duplicatePurchaseOrder` — copies a PO with new sequence
- `finalizePurchaseOrder` / `finalizeSupplierQuote` — lock documents for processing
- `sendSupplierQuote` — sends quote to supplier
- `getPurchasingPlanning` — MRP-driven planned order view (RPC `get_purchasing_planning`)
- `getSupplierApprovalContext` — reads approval workflow state
- `getPurchasingRFQ` / `getPurchasingRFQs` / `upsertPurchasingRFQ` — RFQ management
- `getSupplierQuotesForComparison` — side-by-side quote comparison
- `getDefaultAttachmentsForPO` — default document attachments for PO creation

## Key Exports

```typescript
import { getPurchaseOrder, upsertPurchaseOrder, getSuppliers } from "~/modules/purchasing";
import { purchaseOrderValidator, supplierValidator } from "~/modules/purchasing";
```

## Related Modules

- **inventory** — receipts consume PO lines; `purchaseOrderLine.quantityReceived` updated on receipt
- **items** — `purchaseOrderLine.itemId` → item master; supplier parts pricing in items module (`supplierPart`)
- **production** — jobs link to PO lines via `jobId` for outside operations and purchased materials
- **accounting** — purchase invoices tie to POs; posting groups drive GL entries
- **sales** — supplier quotes can originate from sales RFQ workflows

## Rules References

- `.ai/rules/purchasing-conversion-factors.md` — UoM conversion on PO lines (factor math, gotchas)
- `.ai/rules/method-material-sourcing.md` — how method materials determine sourcing type (Buy/Make/Pull)
- `.ai/rules/conventions-services.md` — service function shape and naming
