# Print Manager Integration

## 1. Overview

The Print Manager is a centralized print job queue and management system integrated into Carbon's ERP and MES applications. It provides automated document printing triggered by business events, a persistent audit trail of all print activity, and operator-facing tools for viewing output, reprinting, and managing printer infrastructure.

### The Problem

Before the Print Manager, Carbon's printing infrastructure was fragmented across several disconnected systems:

- **crbnos/zpl-print** was an external standalone print server in a separate repository. It required manual ngrok tunnel setup, only supported ZPL (not PDF), and managed work center to printer mappings in a local configuration file that Carbon had no awareness of.

- **Hardcoded file+/ routes** generated content on demand as downloadable files. Operators had to manually navigate to these routes, download the generated ZPL or PDF, and then send the content to a printer through some external mechanism. There was no automation, no retry capability, and no record of what was printed.

- **No automation or audit trail** meant that posting a receipt, shipping an order, or completing an operation required manual steps to print associated documents. There was no visibility into whether documents had been printed, no way to reprint a failed job, and no centralized log of print activity.

The Print Manager replaces all of these with a single integrated system. The crbnos/zpl-print repository is retired entirely. The existing file+/ routes are superseded by the generation task, which produces content and stores it on the print job record. The work center to printer mapping that previously lived in zpl-print's configuration file is now stored in Carbon's database as printer routes, accessible through a settings UI.

### What the Print Manager Provides

- Automatic printing triggered by business events (receipt posting, shipment posting, kanban replenishment, operation completion) with per-event toggle controls
- A two-task architecture that decouples content generation from printer delivery, enabling independent evolution of each layer
- A document type registry that defines which document types are generated for each business event, with support for both built-in renderers and external template APIs (BinderyPress)
- A persistent print job table that serves as both the processing queue and the historical audit trail
- A Print Manager UI accessible as a top-level module in ERP, with MES linking to the same interface, providing status visibility, output viewing (including visual ZPL preview via Labelary), reprinting, and job management
- Printer route configuration with cascading overrides: default assignments, location-specific overrides, and work center-specific overrides
- Template assignment configuration that maps each document type to a printer and optional BinderyPress template
- Test print capabilities through the settings UI

---

## 2. Architecture

The Print Manager is built on two decoupled Trigger.dev tasks connected by a database table that serves as both the job queue and the audit trail.

### The Two-Task Design

**print-job** is the content generation task. It receives a source document type and identifier, looks up the document type registry to determine which output documents to generate, and then processes each item individually: creates a print job record immediately with `generating` status (so it appears in the Print Manager right away), renders the content for that item (via BinderyPress or built-in renderers), updates the job with the rendered content (transitioning to `queued`), and triggers the delivery task. This per-item streaming approach means the first document starts printing while later documents are still being generated.

**print-job-deliver** is the printer delivery task. It reads a print job record, resolves the current API key from the printer route table, sends the stored content to the physical printer via an HTTP POST, and updates the job status to completed or failed.

### Why They Are Decoupled

The separation of generation from delivery provides several architectural benefits:

**Delivery backend independence.** ProxyBox is the current delivery backend, but the delivery task is the only code aware of how content reaches a physical printer. Replacing ProxyBox with CUPS, PrintNode, direct IPP, or any other print server means modifying only the delivery task. The generation task, the Print Manager UI, and all business event integrations remain untouched.

**Reprints skip generation.** When an operator reprints a job, the stored content is already available on the job record. The system creates a new print job with the same content and triggers only the delivery task. There is no need to re-fetch entity data or re-generate content, which could produce different results if the underlying data has changed.

**Generation backend independence.** The generation task is the single point of content creation. It supports both built-in renderers and the BinderyPress external rendering API. Switching a document type from built-in to BinderyPress rendering requires only assigning a template ID in the settings UI.

### Content Flow

The complete flow from business event to physical printer follows this path:

1. A business event occurs (for example, a receipt is posted)
2. The action handler checks whether auto-printing is enabled for that event type in company settings
3. If enabled, the handler triggers the print-job task with the source document type, document identifier, company identifier, user identifier, and optional location and work center identifiers
4. The generate task reads company settings, determines which document types apply to this source document via the registry, and for each document type resolves the target printer through the cascading override system
5. For each item to be printed, the generate task creates a print job record with `generating` status (visible in the Print Manager immediately), renders the content, updates the job with the content (transitioning to `queued`), and triggers the print-job-deliver task
6. The deliver task reads the job, resolves the API key fresh from the printer route table, marks the job as printing, sends the content to the printer endpoint, and updates the status to completed or failed

### Direct Task Triggering

The Print Manager uses direct Trigger.dev task triggering rather than Carbon's PGMQ event system. The event system polls on a one-minute cron interval, which introduces unacceptable latency for printing. An operator who posts a receipt expects printing to start within seconds, not up to a minute later. Direct task triggering provides near-instant execution (typically one to five seconds). This is consistent with how other latency-sensitive operations in Carbon work, including post-transactions, schedule-job, and notify.

---

## 3. Database Schema

The Print Manager adds a permission module, a JSONB settings column, and two new tables through a single migration.

### The Printing Permission Module

The migration adds a "Printing" value to the module enum, which controls Row Level Security policies on both new tables. Permissions are seeded for the Admin and Management employee types with full CRUD access. All existing users receive printing permissions mirrored from their current Settings permissions, so anyone who can manage settings can immediately manage printing.

Four permission keys are used: printing_view, printing_create, printing_update, and printing_delete. These are evaluated by the standard get_companies_with_employee_permission function used across all of Carbon's RLS policies.

### The companySettings.printing Column

The migration adds a `printing` JSONB column to the `companySettings` table. This column stores a `PrintingSettings` object with four top-level fields:

- **autoPrint** contains boolean toggles for each business event: `receiptLabels`, `shipmentLabels`, and `operationLabels`
- **assignments** maps each document type ID (such as "productLabel" or "kanbanCard") to a `TemplateAssignment` containing a `printerRouteId` and an optional `templateId` (for BinderyPress templates)
- **locationOverrides** maps location IDs to document type IDs to printer route IDs, providing location-specific printer routing
- **workCenterOverrides** maps work center IDs to document type IDs to printer route IDs, providing work center-specific printer routing

### The printerRoute Table

The printerRoute table defines printer endpoints, optionally scoped to specific locations. Each row represents one configured printer.

**Key columns:**

- **id** is a text primary key with the "pr" prefix, auto-generated by Carbon's standard id() function
- **companyId** references the company table and is part of the composite primary key, ensuring tenant isolation
- **locationId** is an optional reference to the location table. When set, the printer is associated with a specific facility location
- **name** is a required human-readable name for the printer (such as "Zebra 2x1" or "Shipping Printer")
- **format** identifies the output format, constrained to "zpl" or "pdf"
- **mediaSizeId** is an optional text field identifying the physical media size (such as "label2x1" for a two-by-one inch thermal label, "label4x2" for a four-by-two inch). Legacy identifiers "zebra2x1" and "zebra4x2" are also supported. This is used for ZPL generation to determine dimensions
- **printerUrl** is the full HTTP endpoint URL for the print server (for example, a ProxyBox endpoint)
- **apiKey** is an optional per-route API key that authenticates requests to the print server
- **createdAt** and **updatedAt** are timestamp columns for record tracking

**Unique constraints** are enforced through a unique index on `(companyId, COALESCE(locationId, ''), name)`, ensuring printer names are unique within a company and location scope.

**Row Level Security** policies on printerRoute use the Printing permission module for all four operations (SELECT, INSERT, UPDATE, DELETE).

### Printer Route Resolution Logic

When the generation task needs to determine which printer to send a document to, it uses a cascading override system stored in the PrintingSettings JSONB:

1. **Work center override**: If a work center ID is available (from an MES operation), the task checks `workCenterOverrides[workCenterId][documentTypeId]` for a printer route ID
2. **Location override**: If no work center override exists and a location ID is available, the task checks `locationOverrides[locationId][documentTypeId]` for a printer route ID
3. **Default assignment**: If neither override exists, the task uses `assignments[documentTypeId].printerRouteId` as the default

Once a printer route ID is resolved through this cascade, the task fetches the full route record by ID from the printerRoute table to obtain the printer URL, format, media size, and other configuration.

This design allows operators at different work centers to have output routed to their nearest printer, while locations can have their own defaults, and a company-wide default serves as the fallback.

### The printJob Table

The printJob table serves a dual purpose. It is the processing queue for active print jobs and the historical audit trail for completed and failed jobs.

**Key columns:**

- **id** uses the "pj" prefix, auto-generated
- **companyId** is part of the composite primary key
- **status** is constrained to five values: generating, queued, printing, completed, and failed. The default is `generating`
- **contentType** is either "zpl" or "pdf", or null while the job is in `generating` status
- **content** stores the generated content as text, or null while the job is in `generating` status. ZPL content is stored as-is (typically around 500 bytes). PDF content is stored as a base64-encoded string (typically 50 to 300 kilobytes). This is practical for PostgreSQL text columns and avoids the complexity of external file storage for these small payloads
- **printerUrl** is the resolved printer endpoint URL at the time the job was created. This column is NOT NULL; when no printer route is resolved, an empty string is stored
- **sourceDocument** identifies the type of business entity that triggered the job (Receipt, Shipment, Kanban, Operation, or Entity)
- **sourceDocumentId** is the database identifier of that entity
- **sourceDocumentReadableId** is the human-readable identifier (such as "R-001" for a receipt)
- **description** is a human-readable summary displayed in the Print Manager UI (such as "R-001 -- ITEM-123 SN-456")
- **origin** tracks how the job was created: "auto" for business event triggers, "manual" for user-initiated prints, or "reprint" for jobs created from the reprint action
- **error** stores the error message when a job fails
- **attempts** tracks how many delivery attempts have been made
- **createdBy** references the user who triggered the job
- **createdAt** records when the job was created
- **updatedAt** and **updatedBy** track the most recent modification
- **completedAt** records when delivery succeeded

**Indexes** cover the most common query patterns: by company, by company and status, and by company and creation date (descending for most-recent-first listing in the Print Manager UI).

**Row Level Security** policies on printJob also use the Printing permission module.

### Realtime Subscription

The printJob table is added to the Supabase Realtime publication. This enables the Print Manager UI to subscribe to live status updates. When a job transitions from generating to queued to printing to completed (or failed), the UI reflects the change without requiring a page refresh.

---

## 4. Shared Package (@carbon/printing)

The printing system's shared logic lives in a dedicated package at packages/printing, published as @carbon/printing. This package is consumed by the ERP application, the MES application, and the Trigger.dev task package.

### Relationship to @carbon/documents

The `@carbon/documents` package (at packages/documents) is Carbon's established home for PDF and ZPL renderers. It contains React PDF components for invoices, kanban cards, packing slips, purchase orders, quotes, and more, as well as ZPL generators for product labels. The built-in renderers in the print-job generation task use components from `@carbon/documents` to produce content.

`@carbon/printing` does not duplicate rendering logic. It owns the print job queue, delivery infrastructure, printer routing, document type registry, and settings management. When a built-in renderer is needed, the generation task calls into `@carbon/documents` for the actual content generation.

### Why a Shared Package

Three separate consumers need access to the same types, service functions, validators, and delivery logic:

- The ERP application uses service functions in its Print Manager and Settings routes, types for casting printing settings, the document type registry for building assignment UIs, and validators for form handling
- The MES application uses the same types for its auto-print integration in the operation completion flow
- The Trigger.dev task package uses service functions for creating and updating print jobs, resolving printer routes, the document type registry for determining which documents to generate, and both the ProxyBox delivery function and the BinderyPress rendering function

Centralizing this logic in a shared package eliminates duplication and ensures that all consumers operate on the same data access patterns, type definitions, and validation rules.

### Module Structure

**types** defines the TypeScript types for the printing system. This includes PrintingSettings (the full settings object with auto-print toggles, template assignments, and override maps), TemplateAssignment (linking a document type to a printer route and optional BinderyPress template), PrinterRoute (a printer configuration record), PrintJob (a print job record), and the union types for job status, origin, and content type.

**registry** defines the document type registry. Each entry is a `DocumentTypeDefinition` with an ID, display name, list of source documents that trigger it, a built-in renderer identifier (or null), a default format, and a description. The current registry contains two entries: "productLabel" (ZPL, triggered by Receipt, Shipment, Operation, and Entity source documents) and "kanbanCard" (PDF, triggered by Kanban source documents). Helper functions provide lookup by ID, lookup by source document, and option list generation for UI selects. See Section 14 for how to add new entries.

**service** provides all database access functions. For print jobs: paginated listing (excluding the content column for performance), single job retrieval, content-only retrieval (used for view and reprint operations), job creation (defaults to `generating` status with null content), content update (sets content and transitions to `queued`), and status updates. For printer routes: listing all routes, fetching a single route by ID, upsert (create or update), and deletion. For printing settings: reading and updating the full PrintingSettings JSONB from the companySettings table.

**models** contains Zod validators for form submissions. The auto-print settings validator handles the four boolean toggle fields. The printer route validator handles route creation and update with fields for name, format, mediaSizeId, locationId, printerUrl, and apiKey. The assignment settings validator is dynamically built from the document type registry, generating `{documentTypeId}_printerRouteId` and `{documentTypeId}_templateId` fields for each registered type. The location override and work center override validators handle adding overrides with locationId/workCenterId, document type, and printer route ID fields. The reprint validator handles the reprint action with an optional printer URL override.

**delivery/proxybox** provides the ProxyBox delivery function. This is the only module aware of the specific HTTP protocol for reaching a ProxyBox print server.

**generation/binderypress** provides the BinderyPress rendering function. It calls the BinderyPress API (`https://api.binderypress.dev/v1/render`) with a template ID, bound data, and output format, and returns the rendered content. For ZPL responses it returns the text directly; for PDF responses it returns a base64-encoded string. This module has a 30-second request timeout.

**index** is the barrel export that re-exports all public symbols from the package, including types, registry functions and types, all service functions, all validators, the ProxyBox delivery function, and the BinderyPress rendering function.

---

## 5. Content Generation

The print-job task is responsible for determining which document types to generate, fetching entity data, generating content (via built-in renderers or BinderyPress), and creating print job records. It runs with a single attempt (no retries), because if the required data is missing from the database, retrying will not make it appear.

### Task Flow

1. **Read company settings** to obtain the PrintingSettings JSONB (which contains assignments, overrides, and the product label size configuration)
2. **Determine document types** by querying the document type registry for all types triggered by this source document (for example, a "Receipt" source document triggers the "productLabel" document type)
3. **For each document type**, resolve the target printer through the cascading override system and resolve data using the document-type-specific data resolver
4. **For each item**, process individually in a streaming fashion:
   a. **Create a print job** with `generating` status and no content. The job is immediately visible in the Print Manager
   b. **Render content** by either calling BinderyPress (if a template ID is assigned and the API key is configured) or using the built-in renderer. If rendering fails, the job is marked as `failed` with the error message
   c. **Update the job** with the rendered content and transition to `queued` status
   d. **Trigger delivery** if a printer URL is resolved. Jobs without a printer URL (empty string) are marked as completed immediately (the content is stored and available for manual reprinting from the Print Manager)

This per-item approach means the first document starts printing while later documents are still being rendered, rather than waiting for all content to be generated before any delivery begins.

### Document Type Registry

The generation task is driven by the document type registry (`packages/printing/src/registry.ts`), which maps source documents to the output document types that should be generated for them. The registry currently contains two entries:

**productLabel** is triggered by Receipt, Shipment, Operation, and Entity source documents. Its built-in renderer generates ZPL via `@carbon/documents/zpl`. When a BinderyPress template ID is assigned, the task calls the BinderyPress API instead.

**kanbanCard** is triggered by the Kanban source document. Its built-in renderer generates PDF via `@carbon/documents/pdf`. It can also be rendered via BinderyPress when a template is assigned.

Adding a new document type (such as an invoice, packing slip, or routing sheet) requires adding an entry to the registry, implementing a data resolver, and optionally implementing a built-in renderer. All existing infrastructure (route resolution, job creation, delivery, settings UI) works automatically. See Section 14 for a step-by-step example.

### Data Resolvers

Each document type has a registered data resolver function that fetches the relevant entity data from the database.

**resolveTrackedEntityData** serves the productLabel document type. It queries the trackedEntity table filtered by the source document context:
- For **Receipt** and **Shipment**: queries tracked entities whose matching attribute (Receipt or Shipment) equals the source document ID
- For **Operation**: looks up the job operation to find its job make method, then queries tracked entities associated with that make method
- For **Entity**: fetches the single tracked entity by ID

The resolver then enriches the tracked entities by batch-querying the item table for part numbers and revisions, returning a list of data items for rendering.

**resolveKanbanData** serves the kanbanCard document type. It fetches the kanban record from the kanbans view, including item information, location, shelf, supplier, and quantity. If the kanban has a thumbnail image, the task downloads it from Supabase Storage and converts it to a base64 data URI. It also constructs a URL to the ERP kanban API route for additional card data.

### Built-in Renderers

**renderBuiltInProductLabel** generates ZPL content for tracked entity labels. It uses the media size configuration to determine dimensions and generates one ZPL block per item.

**renderBuiltInKanban** generates PDF content using a React PDF component from `@carbon/documents`. It renders a kanban card with the item thumbnail (if available), item details, location, supplier, and quantity information. The PDF stream is converted to a base64-encoded string for storage.

### BinderyPress Integration

When a document type has a template ID assigned in the settings and the `BINDERY_PRESS_API_KEY` environment variable is configured, the generation task calls `renderWithBinderyPress()` instead of the built-in renderer. The BinderyPress API accepts a template ID, the resolved data items, and the desired output format (zpl or pdf), and returns rendered content. This allows document layouts to be designed through the BinderyPress visual designer rather than requiring source code changes.

Carbon provides default BinderyPress templates for each document type:

| Document Type | Template ID | Format | Description |
|---|---|---|---|
| Product Label | `carbon:product-label-2x1` | ZPL | 2x1" thermal label for tracked entities |
| Kanban Card | `carbon:kanban-letter` | PDF | Letter-size kanban replenishment card |

These template IDs are entered in the Template Assignments section of the printing settings. Custom templates can be created in the BinderyPress designer and assigned in place of the defaults.

---

## 6. Printer Delivery

The print-job-deliver task handles the final step: sending generated content to a physical printer through a print server.

### Task Configuration

The delivery task is configured with three maximum attempts, exponential backoff with a factor of two, and randomized retry timing. This provides resilience against transient network issues while avoiding rapid-fire retries that could overwhelm a print server.

### Delivery Flow

1. **Read the print job** record from the database, including its content, content type, printer URL, current status, and attempt count
2. **Validate content** — if content or contentType is null (which should not happen in normal operation but guards against race conditions), mark the job as `failed` and abort without retrying
3. **Resolve the API key** fresh from the printerRoute table by matching the printer URL and company identifier. The API key is deliberately not stored on the print job itself. This means that if an administrator rotates the API key on a printer route, the new key takes effect on the very next delivery attempt without needing to update any existing job records
4. **Mark the job as printing** and increment the attempt counter
5. **Decode the content** if it is PDF (converting from base64 to a binary buffer). ZPL content is sent as-is since it is plain text
6. **Send to ProxyBox** using the delivery function, which performs an HTTP POST with the content as the request body, an octet-stream content type, and the API key header if present
7. **Update the job status** to completed on success (setting completedAt) or to failed on error (storing the error message)

Note: On error, the job is marked as "failed" before the retry decision is made. If the error is retryable, the task re-throws and Trigger.dev will pick it up again, at which point it transitions back to "printing". This means there is a brief window during retries where a job shows as "failed" in the UI before switching back to "printing" on the next attempt.

### The ProxyBox Delivery Backend

The sendToProxyBox function is a straightforward HTTP POST. It sets the Content-Type header to application/octet-stream, optionally includes the X-API-Key header, sends the content as the request body, and enforces a thirty-second timeout using an AbortSignal. If the response status is not successful, it throws an error with the status code and any response body text.

### Retry Strategy

The retry behavior distinguishes between two categories of failure:

**Connection errors** (such as connection refused, DNS resolution failure, or network unreachable) indicate that the content never reached the print server. These errors trigger a retry, because sending the content again is safe.

**Timeout errors** indicate that the HTTP request was sent but the response was not received within the timeout window. In this scenario, the content may have already been received and printed by the print server. Retrying would risk printing duplicate copies. When a timeout is detected (identified by the AbortError name or timeout-related error messages), the task throws an AbortTaskRunError, which tells Trigger.dev to permanently fail the run without retrying.

This is a conservative approach that prevents duplicate prints at the cost of occasionally requiring a manual reprint when a timeout was actually a delivery failure. A future improvement would be to use ProxyBox idempotency keys to make retries safe even after timeouts.

---

## 7. Business Event Integration

Four business events trigger automatic printing. Each integration follows the same pattern: a small block of code inserted into the existing action handler, wrapped in a try/catch that never blocks the parent operation.

### The Integration Pattern

Each auto-print block:

1. Reads the printing settings from companySettings using a service-role Supabase client (bypassing RLS to ensure the query succeeds regardless of the user's permission level)
2. Checks whether the relevant auto-print toggle is enabled
3. If enabled, triggers the print-job task with the source document type, document identifier, company and user identifiers, optional location ID, and optional work center ID
4. Catches any error silently (logging it but not re-throwing), so that a printing failure never prevents the business operation from completing

### Idempotency Keys

Each trigger call includes an idempotency key with a five-minute TTL. The key is constructed from the source document type and identifier (for example, "auto-print-Receipt-abc123"). This prevents duplicate print jobs if the business event is somehow triggered twice within the five-minute window, which could happen from double-clicks, browser refreshes, or retry logic in upstream systems.

### Receipt Posting

The auto-print block is inserted in the receipt posting action after the successful post-receipt edge function call but before the redirect. It uses a nested try/catch that is separate from the outer try/catch. This separation is critical because the outer catch block resets the receipt status back to Draft when an error occurs. If the auto-print try/catch were merged with the outer one, a printing error would incorrectly reset the receipt to Draft even though the posting itself succeeded.

Additionally, the outer catch block must re-throw Response objects. Remix/React Router redirects are thrown as Response objects. Without re-throwing them, the outer catch would swallow the redirect and the user would not be navigated to the receipt page after posting.

The trigger payload includes `locationId` from the receipt record, enabling location-based printer routing.

### Shipment Posting

The shipment posting integration follows the same pattern as receipts: a nested try/catch after the successful post-shipment edge function call, checking the shipmentLabels toggle, with the same outer catch re-throw pattern for Response objects. The trigger payload includes `locationId` from the shipment record.

### Kanban Replenishment

The kanban integration triggers when a kanban order is created, in both the Make (job order) and Buy (purchase order) paths. Both paths pass the kanban's `locationId` in the trigger payload for location-based printer routing. The format determination (PDF for kanban cards) happens inside the generation task via the document type registry, not in the business event handler.

### MES Operation Completion

The MES operation completion flow has two auto-print integration points corresponding to the two tracking types:

**Serial tracking** uses the Entity source document type with the completed entity identifier. An important detail: the MES completion flow creates a new tracked entity (the next serial number to be reserved) and returns its identifier. The auto-print must use the completed entity identifier from the form submission, not the newly created one. Printing a document for the entity that was just completed (and is now in inventory) is correct; printing one for the entity that was just reserved (and has not been manufactured yet) is not.

**Batch tracking** uses the Operation source document type with the job operation identifier. This generates documents for all tracked entities associated with the operation's make method, which is appropriate for batch operations where multiple entities are created at once. The idempotency key for batch operations appends "-batch" to distinguish it from serial-tracking keys for the same operation.

Both MES paths pass the `workCenterId` and `locationId` (resolved from the work center record) in the trigger payload. This enables the full cascading override resolution: work center-specific routing takes precedence over location-specific routing, which takes precedence over the default assignment.

---

## 8. Settings UI

The printing settings page is located in the ERP application under Settings and is accessible to users with settings permissions.

### Auto-Print Toggles

The top section of the settings page displays four boolean toggles, one for each supported business event:

- Print when receipts are posted
- Print when shipments are posted
- Print kanban cards when triggered
- Print when operations complete

These toggles are backed by a validated form using the autoPrintSettingsValidator. When saved, the values are stored in the `autoPrint` field of the PrintingSettings JSONB object on the companySettings table's printing column.

### Printer Management

The printers section displays all configured printer routes as a list of cards. Each card shows the printer name, format (ZPL or PDF), media size (if configured), location scope (if set), the printer URL, and whether an API key is configured (displayed as masked dots for security).

Each route has two actions: Test Print and Delete. A form allows creating new routes by specifying the name, format, media size, location, printer URL, and optional API key. Existing routes can be updated via upsert.

When a printer route is deleted, the action handler performs dangling reference cleanup: it scans the PrintingSettings JSONB for any assignments, location overrides, or work center overrides that reference the deleted route and removes them. This prevents stale references from causing errors in the generation task.

### Template Assignments

The template assignments section maps each document type (from the registry) to a printer route and an optional BinderyPress template ID. For each document type, the UI shows a dropdown to select the target printer and a text field for the template ID. When a template ID is assigned and the BinderyPress API key is configured, the generation task will use BinderyPress rendering instead of the built-in renderer for that document type.

This section is driven entirely by the document type registry. Adding a new entry to the registry automatically adds a row here. The section is backed by the assignmentSettingsValidator, which is dynamically built from the registry.

### Location Overrides

The location overrides section allows configuring location-specific printer routing. Each override maps a location and document type combination to a specific printer route. When a print job is triggered from a business event associated with a particular location, the override takes precedence over the default assignment.

The UI displays existing overrides as a list with delete actions and provides a form to add new overrides by selecting a location, document type, and printer route.

### Work Center Overrides

The work center overrides section allows configuring work center-specific printer routing. Each override maps a work center and document type combination to a specific printer route. Work center overrides take the highest precedence in the cascade: they override both location overrides and default assignments.

This is particularly useful in MES operation completion flows, where the work center ID is available and operators need output printed at the printer nearest their station.

### Test Print

The test print feature generates a real ZPL test page and sends it directly to the configured printer endpoint from the server-side action. The generated output includes the text "Test Print", the media size ID and dimensions (calculated from the configured media size at 203 DPI), and a timestamp. This provides immediate verification that the printer route is correctly configured and the printer is reachable.

Test print is only supported for ZPL-format printers that have a media size configured. PDF-format printers cannot be trivially tested from the settings action. The UI surfaces a message suggesting that document printers can be tested by triggering a kanban print.

The test print looks up the route's URL and API key server-side using the route identifier, rather than accepting sensitive values like the API key from the form. This prevents API keys from being exposed in client-side form data.

### Loader Data

The settings loader fetches company settings, printer routes, work centers, and locations. Work centers and locations are needed to populate the override form dropdowns.

---

## 9. Print Manager UI

### ERP Print Manager

The Print Manager is a top-level module in the ERP application, accessible from the sidebar navigation. It is not nested under Settings because operators on the shop floor need quick, direct access to view and manage their print jobs.

**Loader.** The route requires printing_view permission (expressed as `{ view: "printing" }` in the permission check). It fetches a paginated list of print jobs (excluding the content column for performance, with a limit of 50) and the list of printer routes. The job list supports filtering by status via URL search parameters.

**Action.** The route supports three intents:

- **reprint** fetches the original job's content and source document metadata, creates a new print job with origin set to "reprint" and the same content, and triggers the delivery task. The printer URL defaults to the original job's printer but can be overridden via a form field.
- **delete** performs a hard delete of a print job record.
- **viewContent** fetches only the content column for a specific job and returns it in the action response data, which the component uses to display the output.

**Table.** The Print Manager displays jobs in a table with columns for status, description, source document type, content type (ZPL or PDF), origin (auto, manual, or reprint), creation timestamp, and actions.

**Status badges** use color coding: purple for generating, yellow for queued, blue for printing, green for completed, and red for failed. Failed jobs also display their error message below the description.

**View Output** loads the job's content via the viewContent action and displays it in a panel. ZPL content is rendered as a visual preview using the Labelary API: the component parses `^PW` (width) and `^LL` (height) commands from the ZPL to determine dimensions in dots, converts to inches at 203 DPI (8 dpmm), and fetches a rendered PNG from `api.labelary.com`. The raw ZPL source is also displayed below the preview image. If the Labelary request fails, only the raw ZPL text is shown. PDF content is rendered in an iframe using a base64 data URI.

**Reprint** creates a new job from the stored content and triggers delivery. This does not re-generate the document -- it sends the exact same content that was generated originally. The View and Reprint buttons are disabled for jobs in `generating` status, since no content exists yet.

**Status filtering** is available through a dropdown that filters the job list by status (generating, queued, printing, completed, failed, or all).

### MES Print Manager Access

The MES application does not have its own Print Manager route. Instead, its sidebar includes a Print Manager link that navigates to the ERP Print Manager at `${ERP_URL}/x/print-manager`. This provides MES operators with access to the same print job visibility and management tools through a single, shared interface.

### Realtime Updates

The Print Manager component subscribes to Supabase Realtime on the printJob table. When a job's status changes (for example, from generating to queued to printing to completed), the table updates automatically without requiring a page refresh. This gives operators live feedback on whether their documents have been printed.

---

## 10. Print Job Lifecycle

### Status Progression

A print job moves through the following statuses:

**Generating** is the initial status for auto-generated jobs. The job record has been created with a description and printer URL but no content yet. The content is being rendered (via BinderyPress or a built-in renderer). The job is visible in the Print Manager with a purple badge, but the View and Reprint actions are disabled. If rendering fails, the job transitions directly to `failed` with an error message.

**Queued** means content has been rendered and stored on the job. The delivery task has been triggered and the job is waiting to be picked up. In practice, jobs spend very little time in this status because the delivery task is chained immediately after content is set. Reprinted jobs start directly in `queued` status since they already carry the original content.

**Printing** indicates that the delivery task has started processing the job. The task has read the job, resolved the API key, and is about to send (or is in the process of sending) the content to the print server. The attempt counter is incremented at this point.

**Completed** means the content was successfully delivered to the print server, which responded with a success status. The completedAt timestamp is set, and any previous error message is cleared.

**Failed** means the delivery attempt encountered an error. The error message is stored on the job. If the error was a connection-type failure, the Trigger.dev retry mechanism may attempt delivery again (up to three attempts total). Note that the job is marked as "failed" before the retry decision, so there is a brief window where a retrying job shows as "failed" in the UI before transitioning back to "printing" on the next attempt. If all retries are exhausted or the error was a timeout (which aborts retries), the job remains in failed status.

### No-Route Jobs

When the generation task cannot resolve a printer URL (no matching assignment or override exists for the required document type), it creates the job with an empty string as the printer URL and immediately marks it as completed. The content is stored and available for manual reprinting through the Print Manager. This ensures that jobs are never lost even when printer infrastructure is not yet configured.

### Reprints

When an operator triggers a reprint from the Print Manager, a new print job is created with:

- The same content, content type, source document type, source document identifier, readable identifier, and description as the original job
- Status set to `queued` (skipping `generating` since the content already exists)
- Origin set to "reprint" to distinguish it from auto-generated jobs in the audit trail
- The operator's user identifier as the creator
- The printer URL from the original job (or an overridden URL if specified)

The new job then follows the normal lifecycle from `queued`: the delivery task is triggered, and the job progresses through printing and completed or failed. The original job is not modified.

This approach preserves the complete source document context on reprinted jobs, which means the Print Manager's source document column and description remain meaningful even for reprints.

---

## 11. Cleanup

Print job records accumulate over time and need periodic pruning. The cleanup logic is integrated into Carbon's existing scheduled cleanup task, which runs on a cron schedule.

The cleanup applies two retention rules:

- **Completed jobs older than 30 days** are deleted. These jobs have served their purpose -- the documents were printed successfully and the audit record has been available for a month.
- **Failed jobs older than 90 days** are deleted. Failed jobs are retained longer because they may be useful for diagnosing recurring printer issues or configuration problems.

Both deletions are executed as parallel database operations filtering by status and the relevant timestamp column (completedAt for completed jobs, createdAt for failed jobs). Errors from either operation are logged but do not interrupt the rest of the cleanup task.

Jobs in queued or printing status are never cleaned up, regardless of age. A job stuck in one of these statuses for an extended period indicates a problem that should be investigated, not silently removed.

---

## 12. Content Generation: Built-in Renderers, file+/ Routes, and BinderyPress

Carbon currently has three ways to generate printed or printable content. Understanding how they relate -- and where they are headed -- is important context for working on the printing system.

### @carbon/documents (built-in renderers)

The `@carbon/documents` package (`packages/documents/`) contains React PDF components and ZPL generators. These include `SalesInvoicePDF`, `QuotePDF`, `PurchaseOrderPDF`, `PackingSlipPDF`, `KanbanLabelPDF`, `ProductLabelZPL`, and others. They are hardcoded React templates that accept data props and produce rendered output.

Within the Print Manager, the built-in renderers in the print-job generation task use these components to produce content when no BinderyPress template is assigned. They exist so the printing system works out of the box without requiring a BinderyPress account. Once a BinderyPress template ID is assigned to a document type in settings, the built-in renderer for that type becomes unused -- the generation task calls BinderyPress instead.

Outside of printing, `@carbon/documents` is also used for email templates (user invitations, verification emails), PDF attachments sent with business transactions (sales order confirmations, purchase order emails to suppliers), and the `file+/` download routes described below.

### file+/ routes (legacy download approach)

The `file+/` routes in the ERP and MES applications (such as `file+/sales-invoice+/$id[.]pdf.tsx`, `file+/receipt+/$id.labels[.]zpl.tsx`) are the old approach to printing. They render content on demand using `@carbon/documents` components and serve it as a downloadable file. Operators had to navigate to these routes, download the file, and manually send it to a printer.

The Print Manager supersedes these routes for printing purposes. The `file+/` routes may still be useful as a direct-download or preview mechanism, but for actual printing they are replaced by the generation task, which creates print jobs and delivers content to printers automatically.

### BinderyPress (target generation backend)

BinderyPress is an external label and document design API that accepts a template ID, bound data, and output format, and returns rendered content (ZPL or PDF). The Print Manager already integrates with it: when a document type has a template ID assigned and the `BINDERY_PRESS_API_KEY` environment variable is set, the generation task calls `renderWithBinderyPress()` instead of the built-in renderer.

BinderyPress is the intended long-term replacement for all of Carbon's hardcoded React templates -- not just for printing. Any place in the system that generates a document from data could use BinderyPress instead of a `@carbon/documents` component:

- **Print Manager document types** (product labels, kanban cards, invoices, etc.) -- already supported via template assignments in settings
- **PDF attachments on business transactions** (sales order confirmations emailed to customers, purchase orders emailed to suppliers) -- could call BinderyPress to render the PDF instead of the React component
- **Email templates** (invitation emails, verification emails) -- could be designed in BinderyPress rather than maintained as React email components
- **file+/ download routes** -- could be converted to call BinderyPress for on-demand rendering

This would give Carbon users the ability to customize the layout and branding of all generated documents through a visual designer, without requiring source code changes. The React templates in `@carbon/documents` would remain as fallbacks for environments without a BinderyPress account.

---

## 13. Future Considerations

### ProxyBox Idempotency Keys

The current delivery task uses an AbortTaskRunError to prevent retrying after timeouts, because a timeout may mean the content was already delivered and printed. This is conservative but occasionally requires a manual reprint when a timeout was genuinely a delivery failure. ProxyBox could support an idempotency key header that allows the print server to deduplicate requests. With this in place, the delivery task could safely retry after timeouts, because the print server would recognize and discard the duplicate request. This would eliminate the need for the timeout-specific abort logic.

### Work Center Filtering in the Print Manager

The Print Manager currently shows all print jobs for the company. In a large manufacturing facility with many work centers and printers, it would be useful to filter jobs by work center or location, showing operators only the jobs relevant to their station. This would require storing the work center or location identifier on the print job record (they are currently only used during printer route resolution and not persisted on the job).

### Additional Delivery Backends

The delivery architecture is designed for multiple backends. The current ProxyBox integration is one module under the delivery directory in the printing package. Additional backends could include:

- **CUPS** for direct printing to network printers on Linux-based systems without a ProxyBox device
- **PrintNode** as a cloud-hosted print relay service
- **Direct IPP** for printers that expose an Internet Printing Protocol endpoint on the local network

Each backend would be implemented as a sibling module in the delivery directory, and the delivery task would select the appropriate backend based on the printer route configuration.

---

## 14. Adding a New Document Type

This section walks through adding a new printable document type to the Print Manager, using a sales invoice as the example. The system is designed so that most infrastructure (settings UI, route resolution, delivery, Print Manager) works automatically once a registry entry exists.

### Step 1: Add a registry entry

In `packages/printing/src/registry.ts`, add an entry to the `documentTypeRegistry` array:

```typescript
{
  id: "salesInvoice",
  displayName: "Sales Invoice",
  sourceDocuments: ["SalesInvoice"],
  builtInRenderer: "pdf" as const,
  defaultFormat: "pdf" as const,
  description: "Invoices for completed sales orders"
}
```

The fields mean:

- **id** is the key used in PrintingSettings assignments and overrides. It must be unique across the registry.
- **displayName** is what appears in the Settings UI (Template Assignments, Location Overrides, Work Center Overrides dropdowns).
- **sourceDocuments** lists which source document values trigger this document type. When the print-job task receives `sourceDocument: "SalesInvoice"`, it queries the registry and finds this entry. A document type can be triggered by multiple source documents (productLabel is triggered by Receipt, Shipment, Operation, and Entity).
- **builtInRenderer** is `"zpl"`, `"pdf"`, or `null`. This tells the generation task which built-in rendering path to use when no BinderyPress template is assigned. Set to `null` if there is no built-in renderer (BinderyPress-only).
- **defaultFormat** is used when no printer route is resolved (for example, for no-route jobs). It determines the contentType stored on the print job.

Once this entry exists, the Settings UI automatically shows "Sales Invoice" in the Template Assignments section and in the Location/Work Center Override dropdowns. No UI changes needed.

### Step 2: Add a data resolver

In `packages/jobs/trigger/print-job.tsx`, add a resolver function and register it in the resolver map.

The resolver receives the Supabase client and the source document ID, and returns a `ResolvedData` object: an array of items (the data that will be passed to the renderer) and an optional human-readable ID for the source document.

For a sales invoice, the resolver would query the sales invoice table for the invoice details (customer, line items, totals, etc.) and return them as the items array. The readable ID would be the invoice number (e.g., "INV-001").

Register it in the resolver map keyed by the document type ID:

```typescript
const resolvers: Record<string, ResolverFn> = {
  productLabel: resolveTrackedEntityData,
  kanbanCard: resolveKanbanData,
  salesInvoice: resolveInvoiceData,  // new
};
```

### Step 3: Add a built-in renderer (optional)

If `builtInRenderer` is set to `"pdf"` or `"zpl"`, the generation task needs a corresponding render function. For a PDF invoice, this would use a React PDF component from `@carbon/documents` (e.g., the existing `SalesInvoicePDF` component at `packages/documents/src/pdf/SalesInvoicePDF.tsx`).

The render function receives the resolved data items and returns an array of `GeneratedContent` objects, each containing:
- `content`: the rendered output (ZPL string or base64-encoded PDF)
- `contentType`: `"zpl"` or `"pdf"`
- `description`: human-readable text shown in the Print Manager (e.g., "INV-001 -- Acme Corp")
- `sourceDocumentReadableId`: the human-readable ID (e.g., "INV-001")

For document types that produce a single output per source document (like an invoice), the array will have one element. For types that produce multiple outputs (like productLabel, which creates one per tracked entity), the array will have many.

If `builtInRenderer` is `null`, the generation task will only use BinderyPress rendering for this document type. A template ID must be assigned in settings for it to produce output.

### Step 4: Add a trigger point

There are two ways to trigger printing for the new document type:

**Auto-print (business event trigger):** Add an auto-print block in the relevant action handler, following the pattern in Section 7. This requires adding a new toggle to the `autoPrint` settings (update the `PrintingSettings` type, the `autoPrintSettingsValidator`, and the Settings UI toggle list).

**Manual print (button on a form):** Add a "Print" button to the document's UI route. In the action handler, trigger the print-job task directly:

```typescript
await tasks.trigger("print-job", {
  sourceDocument: "SalesInvoice",
  sourceDocumentId: invoiceId,
  companyId,
  userId,
  locationId: invoice.locationId ?? undefined,
});
```

Both approaches can coexist -- a document type can have auto-print on a business event and a manual print button on its form.

### What works automatically

Once the registry entry and resolver exist, the following require zero additional code:

- **Settings UI:** The document type appears in Template Assignments, Location Overrides, and Work Center Overrides
- **Printer route resolution:** The cascading override system resolves the printer for the new type using the same logic as all other types
- **Print job creation and delivery:** Jobs are created and delivered through the same pipeline
- **Print Manager UI:** Jobs appear in the table with the correct source document context
- **Reprints:** Operators can reprint the document from the Print Manager
- **Cleanup:** Old jobs are pruned on the same schedule as all other types
