---
paths:
  - "packages/printing/**"
  - "packages/documents/**"
  - "packages/jobs/src/inngest/functions/tasks/print-job/**"
---

# Printing System

Label/document printing: a queue of `printJob` rows, generated and delivered by two
**Inngest** functions, rendered by `@carbon/documents`, routed to physical printers via
a ProxyBox HTTP endpoint. There is no Trigger.dev here.

## Packages

- **`@carbon/printing`** (`packages/printing/`) — isomorphic core + server + UI. Three exports:
  - `.` (`src/index.ts`) — registry, validators, assignment helpers, DB service fns, types
  - `./printing.server` (`src/printing.server.ts`) — `getCachedPrinterConfig`,
    `invalidatePrinterCache`, `sendToProxyBox`, `renderWithBinderyPress`
  - `./ui` (`src/ui/index.ts`) — `PrintingProvider`/`usePrinting`, `PrintButton`, `LabelDownloadModal`
- **`@carbon/documents`** (`packages/documents/`) — actual renderers. PDFs via `@react-pdf/renderer`
  React components (`pdf/ProductLabelPDF`, `pdf/StorageUnitLabelPDF`, `pdf/KanbanLabelPDF`, plus
  invoice/PO/quote/traveler docs); ZPL via `zpl/ProductLabelZPL`, `zpl/StorageUnitLabelZPL`,
  `zpl/KanbanLabelZPL` (`generateProductLabelZPL`, `generateStorageUnitLabelZPL`,
  `generateKanbanLabelZPL`).

## Document type registry — `packages/printing/src/registry.ts`

`documentTypeRegistry` entries (`id`, `sourceDocuments[]`, `builtInRenderer: "zpl"|"pdf"|null`,
`defaultFormat`):
- `productLabel` — sources `Receipt, Shipment, Operation, Entity, Job, Split, StockTransfer`; default zpl
- `kanbanCard` — source `Kanban`; default pdf, ZPL on media of 3" x 2" and up (see `kanban-system.md` → Labels)
- `storageUnitLabel` — source `StorageUnit`; default zpl

`getDocumentTypesForSource(sourceDocument)` maps a source doc → the doc-type ids to print.

## Request flow

1. **Enqueue.** Callers fire `trigger("print-job", payload)` (`@carbon/lib` trigger → Inngest event
   `carbon/print-job`). Payload: `{ sourceDocument, sourceDocumentId, companyId, userId, locationId?,
   workCenterId?, printerRouteId? }` (`packages/lib/src/events.ts`).
2. **Generate** — `print-job/index.tsx` (`packages/jobs/src/inngest/functions/tasks/print-job/`,
   `retries: 0`):
   - **One step, `create-print-jobs`,** holds the dedupe, the printer config and every job write, so
     they run once. A step makes Inngest run the function again from the top; when the job writes
     sat outside a step, each `deliver-<jobId>` send re-ran the dedupe, which found the job just
     written and threw — only a document's FIRST label ever printed (a Make kanban's Create card,
     never Start or Complete).
   - **30s auto-dedupe:** if an `origin="auto"` `printJob` for the same `sourceDocumentId`+`companyId`
     was created in the last 30s, throws `NonRetriableError`. Every job the task writes is
     `origin="auto"`, the manual route's included.
   - **Resolve printer config once:** explicit `printerRouteId` → fetch that route; else if `locationId`,
     `getCachedPrinterConfig(client, companyId, locationId, getPrinterContextForSource(sourceDocument,
     workCenterId), workCenterId)`. Falls back to `docType.defaultFormat` and media size `"label2x1"`
     when no config.
   - For each doc-type-for-source: resolve items (`resolvers.ts`: `resolveTrackedEntityData` /
     `resolveKanbanData` / `resolveStorageUnitData`), then per item create a `printJob` (`generating`),
     render (`renderers.tsx`), update content (→ `queued`), and if a `printerUrl` exists collect it
     for delivery (else mark `completed`). After the step, one `step.sendEvent("deliver", …)` sends a
     `carbon/print-job-deliver` event per collected job.
3. **Deliver** — `print-job-deliver.ts` (event `carbon/print-job-deliver`, `retries: 0`): loads the job,
   sets `printing`, looks up the route `apiKey` by `printerUrl`, `sendToProxyBox` (PDF content is
   base64 → Buffer), then `completed`. Timeouts throw `NonRetriableError` (content may already have
   printed — avoid duplicate copies).

## PDF/ZPL generation — `print-job/renderers.tsx`

- `renderItemWithTemplate` — used when the route has a `templateId` **and** `BINDERY_PRESS_API_KEY`
  is set; calls `renderWithBinderyPress` (POST `https://api.binderypress.dev/v1/render`, `delivery:
  "inline"`; ZPL returns text, PDF/PNG returns base64).
- `renderItemBuiltIn` — used when no template but `builtInRenderer !== null`. PDF path renders the
  React-PDF component via `renderToStream` → base64. `productLabel` loads the company's
  `documentTemplate` (`documentType="trackingLabel"`) + logo so queued jobs match the customizer.
  ZPL requires a `labelSize.zpl` config (`requireZplCapable`). A kanban card needs media that
  `canHoldKanbanLabel` accepts for ZPL; a PDF printer with smaller media prints the company's
  `kanbanLabelSize` instead.
- If neither (`builtInRenderer === null`, no template) → job fails asking for a BinderyPress template.

## Printer routing & assignments

- **`printerRoute`** table (`pr` id) = physical printer: `companyId, locationId?, name, format(zpl|pdf
  CHECK), mediaSizeId?, printerUrl, apiKey?, templateId?`. Unique `(companyId, COALESCE(locationId,''),
  name)`. (`20260326000000_print-manager.sql`; `templateId` added `20260509000000`.)
- **Assignments** live in `companySettings.printing` JSONB (`PrintingSettings` →
  `assignments[locationId]: LocationAssignment`). Contexts (`printerContexts`, `assignments.ts`):
  `default | shipping | receiving | inventory | kanban | workCenter`. `getPrinterContextForSource` maps
  Shipment→shipping, Receipt→receiving, StockTransfer/StorageUnit→inventory, Kanban→kanban, else
  workCenter if a workCenterId is present, else default. Stored settings written before a context
  existed have no key for it; every reader uses `?.` and resolution falls back to the default.
  `removePrinterRoute` clears the deleted route from every context.
- **Resolution** is shared via `resolveContextAssignment(assignment, context, workCenterId?)` in
  `assignments.ts` — called by both the server cache (`cache.server.ts`) and the client
  (`ui/PrintingProvider.tsx` `usePrinting`), so they stay in sync. A context with no printer falls back
  to the location default printer (keeping its own `autoPrint`); `workCenter` with no entry inherits the
  default outright.

## Redis printer-config cache — `packages/printing/src/cache.server.ts`

`getCachedPrinterConfig(...)` → `CachedPrinterConfig { printerRouteId, printerUrl, format, mediaSizeId,
templateId, autoPrint }`. Key `printing:{companyId}:{locationId}:{context}` (workCenter →
`...:wc:{contextId}`), TTL 1h (`@carbon/kv` redis). Redis failures fall through to DB silently.
`invalidatePrinterCache(companyId)` deletes `printing:{companyId}:*` — call it after any printer-route
upsert/delete or assignment update.

## printJob table

`pj` id; `status` (`generating|queued|printing|completed|failed`), `contentType?(zpl|pdf)`, `content?`
(ZPL text or base64 PDF), `printerUrl`, `sourceDocument`, `sourceDocumentId`, `sourceDocumentReadableId?`,
`description`, `origin(auto|manual|reprint)`, `error?`, `attempts`, audit cols, `completedAt?`.
Realtime-enabled. RLS gated on `printing_*` permissions (Printing module). Cleanup
(`scheduled/cleanup.ts`): completed > 30d and failed > 90d deleted.

## App wiring (ERP + MES)

- Root `x+/_layout.tsx` loads `getPrinterRoutes` + `companySettings.printing` and mounts
  `<PrintingProvider value={{ printing, printerRoutes, useMetric, printPath: path.to.manualPrint,
  settingsPath: path.to.printingSettings, settingsExternal? }}>`. MES points `settingsPath` at the ERP URL
  (`settingsExternal: true`).
- **`PrintButton`** (`@carbon/printing/ui`) — props `{ sourceDocument, sourceDocumentId, locationId,
  context, workCenterId?, fileRoutes:{pdf,zpl} }`. If any routes exist: opens a printer-select modal
  (pre-selects the resolved route), POSTs JSON to `printPath` (`/x/print`). If none:
  `LabelDownloadModal` (download ZPL/PDF via `fileRoutes`).
- **Manual route** `apps/{erp,mes}/app/routes/x+/print.tsx` (`path.to.manualPrint` = `/x/print`):
  validates `manualPrintValidator`, calls `trigger("print-job", ...)`.
- **Settings** `apps/erp/app/routes/x+/settings+/printing.tsx` (`path.to.printingSettings`): printers CRUD
  + test print, per-location assignment rows, through the `savePrinterRoute` / `testPrinterRoute` /
  `removePrinterRoute` and `assignPrinter` service functions (`apps/erp/app/modules/settings/settings.server.ts`),
  which invalidate the Redis cache; deleting a route clears every assignment that named it. Print jobs
  UI: `printing.jobs.tsx` (`path.to.printingSettingsJobs`) with reprint (`reprintPrintJob`,
  origin `reprint`) + realtime.
- **Label file routes** (interactive download, ERP) under `apps/erp/app/routes/file+/` — e.g.
  `stock-transfer+/$id.labels[.]{pdf,zpl}.tsx` (+ `labels.server.ts` `getStockTransferLabelItems`),
  `storage-unit+/labels[.]{pdf,zpl}.tsx`, plus `entity+`, `receipt+`, `shipment+`, `operation+`, `kanban+`.

## Auto-print integration points

After a business event, code checks `getCachedPrinterConfig(...).autoPrint` (default `true` when null),
wrapped in try/catch that never blocks the parent op, then `trigger("print-job", ...)`:
- Receipt post `postReceipt` (receiving); Shipment post `postShipment` (shipping; also prints
  `Split` entities); Kanban create `createKanban` (kanban; one card per action, three for Make) — these three through
  `autoPrint` in `inventory.service.ts`; Stock-transfer split, from the line pick operations (Split + Entity reprint) —
  all in `apps/erp/app/modules/inventory/inventory.server.ts`; MES first-operation completion of a serial or batch unit,
  `autoPrintFirstOperationLabel` (`apps/mes/app/services/printing.server.ts`, workCenter), called by
  every completion path: the Complete form (`x+/complete.tsx`), the QR / kanban Complete scan
  (`x+/end.$operationId.tsx`), and inspection lots (`postSerialCompletions` / `postBulkCompletion`
  in `services/quality.server.ts`). A new path that completes a tracked unit must call it too, or that
  path mints serials with no label. "First" is the routing's answer, `isFirstOperationOfMakeMethod`
  (`services/operations.service.ts`: no `jobOperationDependency` predecessor in the same make method),
  the check the operation and assembly views use. Counting the unit's `Operation <id>` markers
  reprinted a label at every later operation whenever the unit completed there had one or none.

## Gotchas

- Built-in **ZPL** needs `labelSize.zpl`; a kanban card also needs media of at least 3" x 2"
  (`label3x2`, `label4x2`, `label100x50mm`), or the job fails.
- Both Inngest fns use `retries: 0`; delivery timeouts are intentionally non-retriable to avoid dupes.
- `print-job/` is a **directory** (`index.tsx` / `renderers.tsx` / `resolvers.ts`), not a single file.
  `.tsx` because renderers instantiate React-PDF components.
- Two enqueue paths (manual route, auto-print sites) but **one** task; the 30s dedupe only covers
  `origin="auto"`.
