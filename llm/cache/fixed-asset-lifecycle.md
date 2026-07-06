# Fixed Asset Lifecycle System

## Overview

Fixed assets can be acquired, tracked, depreciated, and disposed through the ERP system. They integrate with purchasing (acquisition), sales (disposal), and accounting (GL entries).

## Database Tables

- `fixedAsset` — Master record: status (Draft/Active/Fully Depreciated/Disposed), acquisitionCost, accumulatedDepreciation, disposalDate, disposalMethod (Sale/Scrapping), saleProceeds
- `fixedAssetClass` — Classification with GL accounts: assetAccountId, accumulatedDepreciationAccountId, depreciationExpenseAccountId, writeOffAccountId, writeDownAccountId, disposalAccountId
- `fixedAssetDisposal` — Disposal record: netBookValueAtDisposal, gainLoss, saleProceeds, journalId

## Line Type Integration

SO lines (`salesOrderLineType`), SI lines (`invoiceLineType`), PO lines (`purchaseOrderLineType`), PI lines (`invoiceLineType`) all support "Fixed Asset" as a line type with an `assetId` foreign key.

### Views

The `salesOrderLines`, `salesInvoiceLines`, `purchaseOrderLines`, `purchaseInvoiceLines` views join to fixedAsset to expose `assetReadableId` and `assetName`. Since TS types may not be regenerated, access via `(line as any).assetReadableId`.

## Acquisition Path (Draft → Active)

1. **Via Receipt Posting** (`post-receipt` edge function): When a PO receipt with a Fixed Asset line is posted, the asset's acquisitionCost is incremented, acquisitionDate and depreciationStartDate are set (if not already), and status changes from Draft to Active.

2. **Via Purchase Invoice Posting** (`post-purchase-invoice` edge function): Same activation logic for the no-PO path. GL: Debit asset class's assetAccountId, Credit payablesAccount.

## Disposal Path (Active/Fully Depreciated → Disposed)

1. **Manual Disposal** (`$fixedAssetId.dispose.tsx`): Creates journal entries to clear accumulated depreciation, write off NBV, and remove asset at cost. Creates fixedAssetDisposal record.

2. **Via Shipment Posting** (`post-shipment` edge function): When a shipment with a Fixed Asset SO line is posted, the asset is disposed. GL entries mirror manual disposal. Skips item ledger and COGS entries.

3. **Via Sales Invoice Posting** (`post-sales-invoice` edge function): For the no-SO path. Disposes asset AND creates AR/revenue entries for sale proceeds. Records saleProceeds and gainLoss on fixedAssetDisposal.

## Form Pattern

SO and SI line forms use a Tabs pattern (Item/Asset tabs) mirroring the PO line form. The asset tab shows a Combobox to select assets with status Active or Fully Depreciated. Hidden fields carry `salesOrderLineType="Fixed Asset"` and description across tab switches.

## Key Files

- Forms: `SalesOrderLineForm.tsx`, `SalesInvoiceLineForm.tsx`, `PurchaseOrderLineForm.tsx`
- Validators: `sales.models.ts` (salesOrderLineValidator), `invoicing.models.ts` (salesInvoiceLineValidator)
- Edge functions: `post-receipt/index.ts`, `post-purchase-invoice/index.ts`, `post-shipment/index.ts`, `post-sales-invoice/index.ts`
- PDF utils: `packages/documents/src/utils/sales-order.ts`, `sales-invoice.ts`
- Explorers: `SalesOrderExplorer.tsx`, `SalesInvoiceExplorer.tsx`
- Summaries: `SalesOrderSummary.tsx`, `SalesInvoiceSummary.tsx`
- Detail page: `$fixedAssetId.tsx` (Actions dropdown with state-aware Purchase/Sell/Dispose links)
