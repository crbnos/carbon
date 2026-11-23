# Per-document edits — codebase research (2026-11-04)

Read-only survey of how document PDFs are rendered, stored, sent and locked today, to design edits to one document. Paths are relative to the repo root. **[UNVERIFIED]** marks claims not confirmed by reading code.

## 1. Rendering

- Every page document renders live from current data on each request through one chain: `getDocumentTemplate` (`apps/erp/app/modules/settings/settings.service.ts:919-931`) → `toDocumentTemplate` (`packages/documents/src/template/schema.ts:497-512`) → `<Doc>PDF`, which calls `resolveTemplate` (`defaults.ts:643-698`) itself.
- `makeText(entries, stored, vars)` reads `stored.text[key] ?? default` and `stored.hidden` (`texts/index.ts:51-63`). Built-in block ids equal their type (`defaults.ts:356-388`).
- The one exception is an invoice sent through Stripe, which stores Stripe's own PDF (`packages/stripe/src/send-sales-invoice.server.ts:140-180`).

| Type | Renderer | Call sites |
|---|---|---|
| purchaseOrder | `renderPurchaseOrderPdf` `apps/erp/app/modules/purchasing/purchasing.pdf.tsx:78` | file route `file+/purchase-order+/$orderId[.]pdf.tsx:21`; `attachPurchaseOrderPdf` `purchasing.service.ts:6874-6926`, called by `finalizePurchaseOrderAndNotify` (`purchasing.server.ts:2686`) and `releaseApprovedPurchaseOrder` (`purchasing.service.ts:7063`) |
| purchaseReturnOrder | `renderPurchaseReturnOrderPdf` `purchasing.pdf.tsx:254` | file route; `confirmReturnOrder` `purchasing.server.ts:2939` |
| purchasingRfq | `renderPurchasingRfqPdf` `purchasing.pdf.tsx:420` | file route only |
| quote | `renderQuotePdf` `apps/erp/app/modules/sales/sales.pdf.tsx:71` | file route; `finalizeAndSendQuote` `sales.server.ts:1139` → `attachDocumentPdf` (`sales.service.ts:12187-12240`) |
| salesOrder | `renderSalesOrderPdf` `sales.pdf.tsx:241` | file route; `attachSalesOrderPdf` `sales.service.ts:12306-12327` (convert, digital accept, confirm) |
| salesReturnOrder | `renderSalesReturnOrderPdf` `sales.pdf.tsx:413` | file route; `confirmReturnOrder` `sales.server.ts:2496` |
| salesInvoice | `loadSalesInvoiceDocument` + `renderSalesInvoicePdf` `packages/lib/src/sales-invoice-document.server.tsx:133,392` | file route; `sendPostedSalesInvoice` `invoicing.service.ts:5224`; jobs `packages/jobs/src/invoicing/automate-invoice.ts:551,559` (attach, email, recurring billing, invoice-automate) |
| packingSlip | `renderPackingSlip` `apps/erp/app/modules/inventory/packing-slip.pdf.tsx:52` | file route `file+/shipment+/$id[.]pdf.tsx`; `savePackingSlip` `inventory.service.ts:6829-6895` from `postShipment` |
| stockTransfer | inline in `file+/stock-transfer+/$id[.]pdf.tsx` | that route only |
| jobTraveler | `renderJobTravelerPdf` `apps/erp/app/modules/production/production.pdf.tsx:60` | `file+/traveler+/$id[.]pdf.tsx`, `file+/job+/$jobId.traveler[.]pdf.tsx` |
| issue | inline in `file+/issue+/$id[.]pdf.tsx` | that route only |
| trackingLabel | `ProductLabelPDF` / `generateProductLabelZPL` | ~15 ERP, MES and print-job sites; a label belongs to a tracked entity, not a document |

- The template editor's preview (`x+/templates+/$type.preview.tsx`, `buildPreviewProps` `settings.service.ts:1910-2084`) loads a real record for salesInvoice, salesOrder, purchaseOrder, quote and stockTransfer only; the other types fall back to sample data.

## 2. Stored PDFs

Rendered PDFs are saved only at send/finalize moments: the company bucket plus a `document` row (`upsertDocument`, `apps/erp/app/modules/documents/documents.service.ts:152`), named `<displayId> - <UTC second>.pdf` (`packages/files/src/stored-document.ts:13-15`).

| Doc | When saved |
|---|---|
| PO | finalize (no approval) or approval release (`purchasing.service.ts:6896`) |
| Quote | `finalizeAndSendQuote` (`sales.server.ts:1147-1151`) |
| Sales order | confirm / convert / digital accept (`sales.service.ts:12322`) |
| Sales / purchase return order | confirm |
| Sales invoice | manual post (timestamped, `invoicing.service.ts:5300-5305`); automation overwrites a fixed path (`automate-invoice.ts:561-567`) |
| Packing slip | shipment post, Sales Order source only (`inventory.service.ts:6871`) |

- Never saved: RFQ, stock transfer, job traveler, issue, labels.
- Emails attach the saved file (signed URL), never a fresh render. The quote share link downloads the saved finalize PDF (`routes/share+/quote.$id.pdf.tsx:48-55`).
- The header "Preview ▸ PDF" always renders live, so after a send there are two copies: the saved snapshot and the live render.

## 3. Statuses and existing locks

Each module has a pure `is<Doc>Locked(status)` in its `.models.ts`; there is no shared hook and no `isLocked` column.

- PO: `isPurchaseOrderLocked` (`purchasing.models.ts:740-756`; To Receive, To Receive and Invoice, To Invoice, Completed, Closed). Revisions reopen in place (`reopenPurchaseOrderAsRevision`).
- Quote: `isQuoteLocked` = not Draft (`sales.models.ts:1205-1207`). A revision is a new quote row.
- Sales order: `isSalesOrderLocked` (`sales.models.ts:1176-1189`).
- Sales invoice: `isSalesInvoiceLocked` = not Draft (`invoicing.models.ts:75-79`); server `refuseLockedInvoices` (`invoicing.server.ts:105-118`).
- Sales / purchase return order: locked when Completed or Cancelled (`sales.models.ts:1278-1290`, `purchasing.models.ts:1155-1166`).
- RFQ: `isRfqLocked` (Requested, Closed; `purchasing.models.ts:716-729`).
- Shipment: read-only when Posted or Voided (`ShipmentLines.tsx:233-235`).
- Stock transfer: `isStockTransferLocked` = not Draft (`inventory.models.ts:730-734`).
- Job: `JOB_LOCKED_STATUSES` (`packages/utils/src/job-status.ts:6-16`).
- Issue: `isIssueLocked` = Closed (`quality.models.ts:57-59`).

## 4. Where "Edit document" fits

- PO, sales order, invoice: the header "Preview ▾" dropdown with "PDF" (`PurchaseOrderHeader.tsx:~339-361`, `SalesOrderHeader.tsx:~410-432`, `SalesInvoiceHeader.tsx:~449-471`).
- Quote: `QuoteHeader.tsx:~230-252` dropdown.
- Return orders, RFQ: overflow "PDF" record action.
- Issue: "Report" item; Job: "Job Traveler" item; Shipment / Stock transfer: Documents tab rows.

## 5. Storage and merge point

- No per-record override column or table exists. Record tables have `customFields`, `externalNotes`, `internalNotes` (or `notes`/`content`) JSON only; `customFields` is form-owned and should not be reused.
- Best merge point: right after `toDocumentTemplate(...)` in each renderer. Overrides in the same shape as the template (`block.text` / `block.hidden` keyed by block id, `settings.text` / `settings.hidden`) need no renderer change, since `makeText` already reads them.
- A company with no saved template has a null template: resolve the default first so the override has blocks to land on.
- Overrides should run through `validateTemplateText` (`texts/validate.ts`).

## 6. Permissions

- View PDFs: purchasing (PO, PRO, RFQ), sales (quote, SO, SRO, invoice), inventory (shipment, stock transfer), quality (issue); traveler routes: any company member.
- Edit records: update purchasing / sales / inventory / production / quality; invoice field edits use update sales, post and send use update invoicing.
- Template editing: update settings.

## Risks

- An override must reach every render path, including the send-time snapshot.
- Invoice automation overwrites a fixed path; manual post writes timestamped copies.
- Quote revisions are new rows, so overrides would need copying.
- Stripe-sent invoices ignore templates.
