# Printing & labels

> Printer routing, ZPL and PDF labels, and the print-job queue that turns a receipt or a finished job into a label on a shelf.

When you post a receipt, split a batch, or finish the first operation on a job, Carbon can put a physical label on the part without you asking. That path is the printing system: a queue of print jobs, a set of **printer routes** that map a location and a context to a physical printer, and two renderers, ZPL for thermal label printers and PDF for documents.

This is a separate machine from the PDF documents Carbon emails and archives (invoices, purchase orders, quotes, job travelers). Those are generated on demand and delivered as files. Printing is about getting bytes to a **physical printer** on the shop floor, and its default output is a thermal ZPL label, not a page.

## Two renderers, one queue

A print job renders in one of two formats, chosen by the printer it's routed to:

- **ZPL** is the text command language thermal label printers speak. It's the default for part and storage labels. A ZPL label needs a media size with ZPL dimensions configured, or it can't render.
- **PDF** is a real document, rendered by the same React-PDF engine that produces invoices and travelers. Kanban cards are **PDF only**, so a kanban card sent to a ZPL-only printer fails unless a template covers it.

Three document types exist (`packages/printing/src/registry.ts:10`):

- **productLabel**: Labels for tracked entities (serial or batch numbers). Printed from a `Receipt`, `Shipment`, `Operation`, `Entity`, `Job`, `Split`, or `StockTransfer`.
- **storageUnitLabel**: Labels for shelves, bins, and storage locations. Printed from a `StorageUnit`.
- **kanbanCard**: Replenishment cards for kanban bins. Printed from a `Kanban`.

The source document is what maps to the doc types worth printing. Posting a shipment yields product labels; scanning a storage unit yields a storage label. `getDocumentTypesForSource` does that lookup (`registry.ts:49`).

## Printer routes

A **printer route** is one physical printer (`printerRoute` table, `20260326000000_print-manager.sql:37`). Each route carries:

- **name**: What you call the printer, unique per location. "e.g. Zebra 2x1".
- **format**: "ZPL (Thermal Label)" or "PDF (Document)". A CHECK constraint enforces the two values.
- **mediaSizeId**: The label size this printer loads. ZPL printers only offer thermal (ZPL-capable) sizes; PDF printers offer all.
- **printerUrl**: The ProxyBox HTTP endpoint jobs are delivered to, e.g. `https://pbx-XXXX.pbxz.cloud/api/v1/print/…`.
- **apiKey**: Optional key sent as an `X-API-Key` header on delivery.
- **templateId**: A BinderyPress template id. "Leave blank for built-in" — leave empty to use Carbon's built-in renderers.
- **locationId**: The location the printer lives at (optional; a route can be company-wide).

You manage routes under **Settings → Printing** (`apps/erp/app/routes/x+/settings+/printing.tsx`). Each route has a **Test** action that sends a small ZPL test label straight to its `printerUrl`, so you can prove a printer is reachable before wiring it into a workflow. Test print only works for ZPL printers with a media size, and returns `"Test label sent to printer"` on success.

Carbon reaches printers through **ProxyBox**, an HTTP endpoint on the shop-floor network. Carbon never talks to a printer's raw port. Delivery is a POST of the rendered bytes to `printerUrl`. If a route also has a `templateId` and the deployment has a BinderyPress key, rendering is delegated to BinderyPress instead of the built-in renderer.

## Assignments: which printer, in which context

A route is the printer; an **assignment** decides when it's used. Assignments live in the company's printing settings (`companySettings.printing` JSONB), one block per location. Within a location you assign a printer to each **context** (`packages/printing/src/assignments.ts:7`):

- **default**: The location's fallback printer. Every other context inherits this one when it has no printer of its own.
- **shipping**: Used when the source document is a `Shipment`.
- **receiving**: Used when the source document is a `Receipt`.
- **inventory**: Used for a `StockTransfer` or a `StorageUnit`.
- **workCenter**: Per work center, for labels printed from a job operation. A work center with no assignment inherits the location default outright.

Each context row also carries an **Auto-print** switch. When it's on, the matching business event prints without a click. `getPrinterContextForSource` maps the source document to its context, and `resolveContextAssignment` walks the fallback: an unassigned context uses the location's default printer.

The auto-print switch defaults **on** for a context that has no explicit entry, even when the location default has auto-print off. If you want a location's shipping station silent, set its shipping row explicitly, don't rely on the default row.

Because routing is resolved from a Redis cache (key `printing:{companyId}:{locationId}:{context}`, 1-hour TTL), any change to a route or an assignment invalidates the cache for the company. If you edit a printer and the old one keeps printing, the cache is the thing that just got cleared for you on save.

## The print-job queue

Every print, manual or automatic, becomes a **`printJob`** row (`20260326000000_print-manager.sql:80`) and moves through a fixed set of statuses:

- **generating**: The job exists; its content is being rendered (ZPL text or a base64 PDF).
- **queued**: Rendered and ready. Carbon sends a delivery event to push it to the printer.
- **printing**: Handed to ProxyBox; delivery is in flight.
- **completed**: Delivered, or rendered with no printer to send to (a download-only job).
- **failed**: Rendering or delivery failed. The `error` column holds the reason and `attempts` counts tries.

Each job records its `origin`, one of **auto** (an automatic print behind a business event), **manual** (someone clicked print), or **reprint** (re-run from the jobs list). It also keeps the `sourceDocument`, `sourceDocumentId`, a readable id, the `contentType`, and the `printerUrl` it was sent to.

You watch the queue under **Settings → Printing → Print jobs** (`printing.jobs.tsx`). The table streams in real time and shows status, description, source, type, origin, and when. Expanding a row exposes the printer URL, attempts, timestamps, and any error. From there you can **View** the content (ZPL previews via Labelary, PDF via an inline frame), **Reprint** it (a fresh job with `origin: "reprint"`), or **Delete** it.

Print jobs are pruned on a schedule: completed jobs after 30 days, failed jobs after 90. A failed job stays around long enough to diagnose.

## Auto-print behavior

Auto-print is the point of the whole system: labels appear when the physical world moves, no button. After a business event Carbon resolves the printer config for the relevant location and context, checks its `autoPrint` flag (treated as **on** when nothing is configured), and enqueues a job. The whole block is wrapped in try/catch so a printer problem never blocks the receipt, shipment, or job it's attached to.

The wired-in events:

| Event | Context | Prints |
| --- | --- | --- |
| Post a receipt | receiving | Product labels for received tracked entities. |
| Post a shipment | shipping | Product labels, plus `Split` labels for batch splits. |
| Split a stock-transfer line | inventory | A `Split` label, and an `Entity` reprint of the original batch. |
| Complete the first operation on a job (MES) | work center | The job's product label. |

To stop a station auto-printing, turn off Auto-print on that location's context row. To trigger a print by hand instead, use the **Print** button on the relevant screen, or send a source document to the manual print route (`/x/print`), which validates the request and enqueues the same kind of job.

Automatic prints for the same source document are **de-duplicated within 30 seconds**. If two events fire for one entity in quick succession, the second is dropped rather than printing a duplicate label. Manual prints and reprints are never de-duplicated.

## Print vs download

Not every screen has a configured printer. The **Print** button adapts: if the location has any printer routes, it opens a printer picker (pre-selecting the resolved default) and enqueues a job on confirm. If there are no routes at all, it opens a **download** modal instead, offering the same label as a ZPL or PDF file to save and print yourself. So a shop with no ProxyBox printers still gets labels, just as downloads rather than pushes.

## Label sizes

Media sizes are a fixed catalog (`packages/utils/src/labels.ts`): `label2x1`, `label4x2`, metric `label100x50mm` and `label50x25mm`, and PDF-only `avery5163`. Only sizes with ZPL dimensions can print to a thermal printer; a PDF-only size like Avery can't.

Two places set a size. A printer route pins its own `mediaSizeId` (the size loaded in that physical printer). And the company has a **default product-label size** (`companySettings.productLabelSize`), set on the document-template screen, used by the interactive label-download routes when no route dictates one. See `docs/reference/company-settings` for where that default lives, and `docs/reference/documents` for the customizer that styles the built-in label templates.

  - Company settings Where the default product-label size and other company-wide printing defaults live.
  - Inventory & locations Storage-unit labels and the tracked entities most print jobs describe.
  - Traceability The serial and batch numbers a product label carries.
  - Kanban Replenishment bins and the PDF cards you print for them.

## Troubleshooting

Why a label didn't print, and the exact strings the printing system surfaces.

### My label didn't print (no error shown)
Most silent failures are configuration, not crashes. Check, in order: (1) the location + context has a printer route assigned and its **Auto-print** switch is on; (2) the printer route has a `printerUrl` — a route with no reachable ProxyBox endpoint means the job renders but can't deliver; (3) the print job isn't sitting in **failed** in Settings → Printing → Print jobs (open the row for the `error`). Auto-print is also wrapped in try/catch, so a failure is logged as "Auto-print failed" and never surfaces on the receipt/shipment screen — the print jobs list is the place to look.

### Nothing printed after posting, and there's no print job at all
The location/context resolved to no printer *and* auto-print was off, or the source document isn't one Carbon auto-prints from. Auto-print only fires on receipt post, shipment post, stock-transfer split, and MES first-operation completion. For anything else, use the **Print** button or the manual route.

### "Print jobs already exist for … …"
The 30-second auto-dedupe fired: an automatic print job for the same source document id was created less than 30 seconds ago, so this one was dropped (non-retriable) to avoid a duplicate label. Expected when two events fire for one entity in quick succession. To force a second copy, reprint from the print jobs list — reprints aren't de-duplicated.

### "Document type "…" requires a BinderyPress template."
The job's document type has no built-in renderer and the route has no `templateId` (or no BinderyPress key is configured). Either assign a route whose format Carbon can render built-in, or set a BinderyPress `templateId` on the printer route.

### "Rendering failed: …"
The job's content couldn't be generated. A common cause: a ZPL label routed to a media size that has no ZPL dimensions (built-in ZPL requires a ZPL-capable label size). Check the printer route's media size, or that a kanban card (PDF only) isn't being sent to a ZPL-only printer.

### "Delivery timed out — content may have been printed. …"
ProxyBox didn't answer in time. This is intentionally **not retried** because the label may already have printed — retrying would print a duplicate. Verify at the printer; if it didn't print, reprint from the jobs list.

### "Print job not found: …" / "Print job has no content"
The delivery step couldn't load the job or its content. "no content" means the job never finished rendering (still generating, or rendering failed first). Check the job's status and error in the print jobs list.

### "ProxyBox delivery failed: … … — …"
The printer's ProxyBox endpoint returned an HTTP error. The trailing text is ProxyBox's own response. Usually the printer is offline, the `printerUrl` is wrong, or the `apiKey` is missing/invalid. Use the route's **Test** action to isolate reachability.

### "Test print is only supported for ZPL label printers with a media size configured."
The Test action only works on a ZPL-format route that has a media size set. PDF routes and ZPL routes without a media size can't be test-printed.

### "Cannot reprint a job with no content" / "Cannot reprint a job that is still generating"
Reprint copies the original job's rendered content into a new job. A job that never rendered (still generating, or failed before render) has nothing to copy — resolve the original first, or trigger a fresh print from the source document.
