# Printing System

## Overview

The Print Manager is a centralized print job queue at `packages/printing/` (`@carbon/printing`). Full design doc at `packages/printing/printing-integration.md`.

## Key Packages

- **@carbon/printing** (`packages/printing/`) — Print job queue, delivery, routing, document type registry, settings management, BinderyPress client, Redis printer-config cache. Two entry points:
  - `@carbon/printing` (`src/index.ts`) — isomorphic: validators, registry, service functions, types
  - `@carbon/printing/printing.server` (`src/printing.server.ts`) — server-only: `getCachedPrinterConfig`, `invalidatePrinterCache`, `sendToProxyBox`, `renderWithBinderyPress`
- **@carbon/documents** (`packages/documents/`) — PDF and ZPL renderers (SalesInvoicePDF, KanbanLabelPDF, ProductLabelZPL, StorageUnitLabelZPL, PackingSlipPDF, etc.). The print system's built-in renderers call into this package for actual content generation.

## Architecture

Two Inngest tasks (triggered via `trigger("print-job", payload)` from `@carbon/jobs`; event payloads defined in `packages/lib/src/events.ts`):

- **print-job** (`packages/jobs/src/inngest/functions/tasks/print-job.tsx`) — Content generation. Payload: `{ sourceDocument, sourceDocumentId, companyId, userId, locationId?, workCenterId?, printerRouteId? }`. 30-second dedupe: skips if an `origin = "auto"` printJob for the same sourceDocumentId was created in the last 30s. Resolves printer config once up front:
  1. If `printerRouteId` is passed (manual print), fetches that route directly.
  2. Else derives a context from sourceDocument (Shipment → shipping, Receipt → receiving, StockTransfer/StorageUnit → inventory, else workCenter if workCenterId present, else default) and calls `getCachedPrinterConfig`.
  Falls back to `docType.defaultFormat` and mediaSizeId `"label2x1"` when no printer is configured. Per-item streaming: creates job with `generating` status (visible immediately), renders content via built-in renderer or BinderyPress (when route has a templateId), updates job with content (→ `queued`), triggers delivery.
- **print-job-deliver** (`packages/jobs/src/inngest/functions/tasks/print-job-deliver.ts`) — Delivery. Sends content to printer via ProxyBox HTTP POST (`sendToProxyBox` from `@carbon/printing/printing.server`).

## Document Type Registry

`packages/printing/src/registry.ts` — Defines `DocumentTypeDefinition` entries. Currently:
- `productLabel` — ZPL, sources: Receipt, Shipment, Operation, Entity, Job, Split, StockTransfer
- `kanbanCard` — PDF, sources: Kanban
- `storageUnitLabel` — ZPL, sources: StorageUnit ("Labels for shelves, bins, and storage locations")

Each type has a data resolver in print-job.tsx (`resolvers` map: productLabel → resolveTrackedEntityData, kanbanCard → resolveKanbanData, storageUnitLabel → resolveStorageUnitData) and a built-in render branch. Adding a new type: add registry entry + resolver + renderer branch.

## Database Tables

- **printerRoute** — Printer definitions. Columns: id(pr), companyId, locationId, name, format(zpl/pdf), mediaSizeId, printerUrl, apiKey, templateId, createdAt, updatedAt. Unique on (companyId, COALESCE(locationId,''), name).
- **printJob** — Job queue + audit trail. Columns: id(pj), companyId, status(generating/queued/printing/completed/failed), contentType(zpl/pdf, nullable), content(nullable), printerUrl, sourceDocument, sourceDocumentId, sourceDocumentReadableId, description, origin(auto/manual/reprint), error, attempts, createdBy, createdAt, updatedAt, updatedBy, completedAt. Realtime-enabled.

## PrintingSettings (JSONB on companySettings.printing)

Per-location assignments with per-context printer + auto-print:

```typescript
type ContextAssignment = { printerRouteId: string | null; autoPrint: boolean };
type LocationAssignment = {
  defaultPrinterRouteId: string | null;
  defaultAutoPrint: boolean;
  shipping: ContextAssignment;
  receiving: ContextAssignment;
  inventory: ContextAssignment;
  workCenters: Record<string, ContextAssignment>; // keyed by workCenterId
};
type PrintingSettings = { assignments: Record<string, LocationAssignment> }; // keyed by locationId
```

Contexts (`updateAssignmentValidator` in models.ts): `default | shipping | receiving | inventory | workCenter`.

## Printer Route Resolution

Context assignment's printerRouteId first; if null, falls back to the location's `defaultPrinterRouteId`. Resolution happens in two places that must stay in sync:
- Server: `resolvePrinterConfig` in `packages/printing/src/cache.server.ts`
- Client: `resolvePrinterRoute` in `apps/{erp,mes}/app/hooks/usePrinting.tsx`

## Redis Printer Config Cache

`packages/printing/src/cache.server.ts` (uses `@carbon/kv` redis):
- `getCachedPrinterConfig(client, companyId, locationId, context, contextId?)` → `CachedPrinterConfig { printerRouteId, printerUrl, format, mediaSizeId, templateId, autoPrint }`. Cache key `printing:{companyId}:{locationId}:{context}` (workCenter: `wc:{contextId}`), TTL 1 hour. Redis failures fall through to DB silently.
- `invalidatePrinterCache(companyId)` — deletes `printing:{companyId}:*`. Called from the printing settings action (printer upsert, assignment update) and `printing.$id.delete.tsx`.

## Module Structure (packages/printing/src/)

- `types.ts` — PrintingSettings, LocationAssignment, ContextAssignment, PrinterRoute, PrintJob, status/origin/contentType unions
- `registry.ts` — documentTypeRegistry, getDocumentTypesForSource(), getDocumentType(), getDocumentTypeOptions()
- `service.ts` — DB functions: getPrintJobs, getPrintJob, getPrintJobContent, createPrintJob (defaults to generating status, null content), updatePrintJobContent (sets content, transitions to queued), updatePrintJobStatus, getPrinterRoutes, getPrinterRoute, upsertPrinterRoute, deletePrinterRoute, getPrintingSettings, updatePrintingSettings
- `models.ts` — Zod validators: printerRouteValidator (includes templateId), updateAssignmentValidator, reprintValidator
- `cache.server.ts` — Redis printer-config cache (see above)
- `delivery/proxybox.ts` — sendToProxyBox() HTTP POST
- `generation/binderypress.ts` — renderWithBinderyPress() calls https://api.binderypress.dev/v1/render

## Client-Side Printing (ERP and MES, mirrored)

- Root layouts (`apps/{erp,mes}/app/routes/x+/_layout.tsx`) load `getPrinterRoutes` and expose `printerRoutes` in route data.
- **usePrinting** (`apps/{erp,mes}/app/hooks/usePrinting.tsx`) — reads `companySettings.printing` + `printerRoutes` from the authenticated root route data. Returns `{ printing, printerRoutes, resolvePrinterRoute(locationId, context, workCenterId?), hasPrinter(...) }`.
- **PrintButton** (`apps/{erp,mes}/app/components/PrintButton.tsx`) — props: sourceDocument, sourceDocumentId, locationId, context (shipping/receiving/inventory/workCenter), workCenterId?, fileRoutes ({pdf, zpl} URL builders). If any printer routes exist: opens a printer-select modal (pre-selects the resolved route) and POSTs JSON to `path.to.manualPrint`. If no printers configured: falls back to **LabelDownloadModal** (download ZPL/PDF at a chosen label size from `labelSizes` in `@carbon/utils`, via the fileRoutes prop).
- **Manual print route** (`apps/{erp,mes}/app/routes/x+/print.tsx`, `path.to.manualPrint` = `/x/print`) — POST JSON `{ sourceDocument, sourceDocumentId, locationId?, workCenterId?, printerRouteId? }` → `trigger("print-job", ...)`. Returns `{ success, message }`.
- PrintButton replaced the old "Tracking Labels" download dropdowns in: ReceiptForm, ShipmentForm, StockTransferHeader, StorageUnitForm, JobMakeMethodTools (ERP); JobOperation, IssueMaterialModal (MES).
- **StorageUnitsTable** (`apps/erp/app/modules/inventory/ui/StorageUnits/StorageUnitsTable.tsx`) — tree multi-select with checkboxes (children inherit parent selection); bulk "Print N Labels" opens a printer-select modal (one manualPrint POST per selected id) or falls back to label download when no printers exist.

## Label File Routes (ERP)

- `apps/erp/app/routes/file+/stock-transfer+/$id.labels[.]zpl.tsx` / `$id.labels[.]pdf.tsx` — product labels for tracked entities on stock transfer lines; optional `lineId` query param; ZPL route redirects to the PDF route if the label size has no ZPL config. Shared data fetch in `labels.server.ts` (`getStockTransferLabelItems`).
- `apps/erp/app/routes/file+/storage-unit+/labels[.]zpl.tsx` / `labels[.]pdf.tsx` — `?ids=` comma-separated storage unit ids; renders name-only labels via `generateStorageUnitLabelZPL` (`packages/documents/src/zpl/StorageUnitLabelZPL.tsx`).
- Path helpers: `path.to.file.stockTransferLabelsPdf/Zpl(id, { labelSize, lineId })`, `path.to.file.storageUnitLabelsZpl/Pdf(ids, { labelSize })`.

## Settings UI

`apps/erp/app/routes/x+/settings+/printing.tsx` (`path.to.printingSettings`) — two cards: Printers (CRUD + test print) and Assignments (per-location rows: Default, Shipping, Receiving, Inventory, and one row per Work Center — each with a printer select and auto-print toggle). Actions invalidate the Redis printer cache. "View Prints" links to the jobs page.

The old standalone label-size settings page (`x+/settings+/labels.tsx`) was removed.

## Print Jobs UI

`apps/erp/app/routes/x+/settings+/printing.jobs.tsx` (`path.to.printingSettingsJobs`) — PrintJobsTable with status/origin/sourceDocument/contentType filters, view content drawer, reprint (creates a new job with origin `reprint`), realtime updates via `useRealtime`. (The former standalone `x+/print-manager.tsx` route no longer exists.)

## Business Event Integration Points (auto-print)

All check `getCachedPrinterConfig(...).autoPrint` (default true) before triggering, wrapped in try/catch that never blocks the parent operation:

- Receipt posting: `apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx` (receiving context)
- Shipment posting: `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx` (shipping context)
- MES serial/batch completion: `apps/mes/app/routes/x+/complete.tsx` (workCenter context)
- Stock transfer batch splits: `apps/erp/app/routes/x+/stock-transfer+/$id.line.quantity.tsx` and `$id.scan.$lineId.tsx` — print the new Split entity AND reprint the original Entity (its quantity changed), passing locationId
- Other trigger sites: `apps/erp/app/routes/x+/maintenance+/$dispatchId.add-and-issue.tsx`, `apps/mes/app/routes/x+/issue-tracked-entity.tsx`

Dedupe is handled inside the print-job task (30-second window on auto jobs per sourceDocumentId).

## Cleanup

In `packages/jobs/src/inngest/functions/scheduled/cleanup.ts`: completed jobs > 30 days deleted, failed jobs > 90 days deleted.
