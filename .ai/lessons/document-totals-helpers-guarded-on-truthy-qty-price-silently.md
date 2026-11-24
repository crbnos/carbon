---
paths: []
triggers: []
promoted: null
---
# Document totals helpers guarded on truthy qty/price silently drop shipping- or tax-only lines

**Context:** Adding line-level shipping cost display to the purchase order PDF (`packages/documents/src/pdf/blocks/purchaseOrder/`). A PO line with a 0.00 unit price and a 30.00 `supplierShippingCost` rendered Total and Subtotal as 0 on the PDF.

**Problem:** The totals helpers in `packages/documents/src/utils/` (`purchase-order.ts` `getLineTotal`/`getTotal`, and the same pattern in `sales-order.ts`/`sales-invoice.ts` `getLineSubtotal`/`getLineTaxableSubtotal`) wrapped the whole formula in `if (line?.qty && line?.unitPrice)` — so any line whose value was only shipping, add-on, or tax contributed 0 to the document, even though those amounts were displayed elsewhere on the page and included in posting math.

**Rule:** Compute document money formulas unconditionally with `?? 0` per term — never gate the whole formula on one term being truthy. Also keep a document's Subtotal semantics identical to that module's in-app summary (PO PDF Subtotal = qty × price + line shipping, matching `PurchaseOrderSummary.tsx`), and lock the helpers with unit tests (`packages/documents/src/utils/document-totals.test.ts`).

**Applies to:** `packages/documents/src/utils/{purchase-order,sales-order,sales-invoice,quote}.ts`, PDF Summary/LineItems blocks, `email/{PurchaseOrder,SalesOrder,SalesInvoice}Email.tsx`, and any new document totals code.
