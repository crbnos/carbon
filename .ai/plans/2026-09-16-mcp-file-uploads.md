# Plan: MCP file uploads (job / item / opportunity / supplier interaction)

**Date:** 2026-09-16
**Branch:** malabo
**Goal:** Let the ERP MCP server upload files/documents for the entities that
today can only be uploaded from the browser, by adding server-side methods to the
module service files so the MCP tool generator picks them up.

**Status: IMPLEMENTED (2026-09-16).** 8 new tools generated (`check:manifest` green,
1564 ops); `tsgo --noEmit` clean; Biome clean. OAuth-connector path only (per user).
Deviation from the draft below: the job and opportunity-line URL-minters were kept
minimal (`{ companyId, <id>, name }`) — the `scope`/`itemId` "parts" toggle was
dropped, since attaching to a part is already `items_createItemDocumentUploadUrl`.

## Decisions (locked with user)

1. **Per-module methods** — one URL-minting tool per entity (in each module's
   `*.service.ts`), not one generic tool. Each entity has its own id/folder shape
   (crucially, an opportunity's **storage-folder id** `opportunityId` differs from
   the document row's `sourceDocumentId` = the quote/order id), so a generic
   `sourceDocument`-keyed tool cannot reconstruct the folder id. Per-module wins.
2. **Signed-URL two-step transport** — MCP has no binary channel. The agent gets a
   presigned upload URL, PUTs the bytes straight to Supabase storage, then calls a
   confirm tool that writes the `document` metadata row. No file bytes ever pass
   through the model context or the MCP dispatch.

## How uploads work today (grounding)

Every entity uploads in the **browser** via a `use*Documents` hook, identical shape:
1. `carbon.storage.from("private").upload(path, file, { cacheControl, upsert: true })`
2. POST FormData → `/x/documents/new` → `upsertDocument(client, {...})` (the only
   server-side piece; requires only auth, no module permission — see `new.tsx`).

Storage path is always `${companyId}/{folder}/{entityId}/${stripSpecialCharacters(name)}`
in the single `"private"` bucket. The `document.size` column is stored in **KB**
(`Math.round(bytes/1024)`). Per-entity mapping (verified against the hooks):

| Entity | folder | folder entityId | sourceDocument | sourceDocumentId |
|---|---|---|---|---|
| Job | `job` (or `parts` w/ itemId) | jobId | `"Job"` | jobId |
| Item | `parts` | itemId | item `type` | itemId |
| Opportunity | `opportunity` | **opportunityId** | `type` (Quote/Sales Order/RFQ/Sales Invoice) | **id** (quote/order id) |
| Opportunity line | `opportunity-line` (or `parts` w/ itemId) | lineId | `type` | id |
| Supplier interaction | `supplier-interaction` | interactionId | `type` (PO/Supplier Quote/…) | id |
| Supplier interaction line | `supplier-interaction-line` | lineId | `type` | id |

**Reuse fact:** `documents_upsertDocument` is *already* an MCP tool — the metadata
half exists. The only missing half is minting a folder-scoped upload URL.
`createSignedUploadUrl(path, { upsert: true })` is already used in `@carbon/jobs`
(precedent) and needs no `.server` import (it's on the supabase client), so all new
methods can live in plain `*.service.ts` files (no `*.mcp.server.ts` needed).

## New methods

### `documents.models.ts` (pure, NOT a tool — generator only scans service files)
- `buildDocumentUploadPath({ companyId, folder, entityId, name }): string`
  → `${companyId}/${folder}/${entityId}/${stripSpecialCharacters(name)}`.
  Single source of truth for the path convention.

### `documents.service.ts`
- `createDocumentUploadUrl(client, { companyId, folder, entityId, name })`
  — generic escape hatch (covers Issue/Shipment/Gauge folders with no dedicated
  wrapper). Builds the path via `buildDocumentUploadPath`, calls
  `client.storage.from("private").createSignedUploadUrl(path, { upsert: true })`,
  returns `{ data: { path, token, signedUrl }, error }`.
  JSDoc (→ tool description) documents the two-step flow.
- `insertUploadedDocument(client, { companyId, createdBy, path, name, size, sourceDocument, sourceDocumentId })`
  — ergonomic wrapper over `upsertDocument` that defaults
  `readGroups/writeGroups: [createdBy]` (an MCP agent can't guess group ids) and
  stores `size` as KB. This is the step-2 "confirm" tool. `size` is documented as
  **KB** to match the column; note the `Math.round` is a file-size site (numeric-
  precision baseline category), not a value-bearing rounding violation.

### Per-module URL-minting wrappers (each → one MCP tool)
Thin: import `buildDocumentUploadPath` from `~/modules/documents`, call
`createSignedUploadUrl`. Ergonomic, correctly-typed entry points that encode each
entity's folder + id.
- `production.service.ts`: `createJobDocumentUploadUrl(client, { companyId, jobId, name, itemId?, scope? })`
  — `scope: "job" | "parts"` (default `"job"`; `"parts"` requires `itemId`).
- `items.service.ts`: `createItemDocumentUploadUrl(client, { companyId, itemId, name })`.
- `sales.service.ts`: `createOpportunityDocumentUploadUrl(client, { companyId, opportunityId, name })`
  and `createOpportunityLineDocumentUploadUrl(client, { companyId, lineId, name, itemId? })`.
- `purchasing.service.ts`: `createSupplierInteractionDocumentUploadUrl(client, { companyId, interactionId, name })`
  and `createSupplierInteractionLineDocumentUploadUrl(client, { companyId, lineId, name })`.

Each wrapper's JSDoc first sentence becomes the tool description and spells out:
"Returns a presigned upload URL. PUT the file bytes to `signedUrl` (or
`uploadToSignedUrl(path, token, file)`), then call `documents_insertUploadedDocument`
with the returned `path` (sourceDocument=`<type>`, sourceDocumentId=`<id>`)."

## The agent-facing flow (per upload)
1. Call `production_createJobDocumentUploadUrl` (etc.) → `{ path, token, signedUrl }`.
2. HTTP `PUT signedUrl` with the file bytes (`x-upsert: true`).
3. Call `documents_insertUploadedDocument` with `{ path, name, size(KB),
   sourceDocument, sourceDocumentId }` → writes the `document` row.
   File then appears in the entity's document panel (panels list the storage folder
   directly, and the row is written — both read strategies covered).

## Tasks
1. `documents.models.ts`: add `buildDocumentUploadPath` (+ unit test if a models
   test file exists).
2. `documents.service.ts`: add `createDocumentUploadUrl`, `insertUploadedDocument`.
3. `production/items/sales/purchasing` `*.service.ts`: add the six wrappers; export
   from each module barrel `index.ts` if the barrel enumerates (most use `export *`).
4. Regenerate MCP metadata: `pnpm generate:mcp` (also runs on typecheck/build), then
   `pnpm check:manifest` to refresh `tool-manifest.digest.json`.
5. Typecheck each touched app package: `pnpm exec turbo run typecheck --filter=erp`.
6. Docs freshness: update `.claude/rules/mcp-tools-reference.md` (note the new
   upload tools + two-step flow) and the four module `AGENTS.md` "Key Service
   Functions" lists. Docs API pages regenerate from the manifest automatically.

## Verification
- `pnpm generate:mcp` succeeds; new tools appear in `tool-metadata.json`
  (grep `createJobDocumentUploadUrl`, `insertUploadedDocument`).
- `pnpm check:manifest` green (digest updated + staged).
- `pnpm exec turbo run typecheck --filter=erp` green.
- Manual (with a running stack, user-driven): via the MCP connector, run the
  3-step flow for a job and confirm the file shows in the job's Documents panel.

## Risks / open caveats
- **API-key auth path may not work for the upload step.** `createSignedUploadUrl`
  hits storage RLS on the `private` bucket. The OAuth-connector path uses a
  user-scoped client (`auth.uid()` set → storage RLS passes), so it works. The
  `carbon-key` API-key client is not a Supabase JWT (`auth.uid()` is null), so
  storage RLS likely denies — same class of limitation as the MCP note-table tools.
  Primary supported path is the OAuth connector; confirm storage RLS behavior for
  API keys and, if it must work, decide whether the URL-mint should use a
  service-role client (adds an explicit `hasPermission` gate like
  `production.mcp.server.ts`). **Decide during implementation.**
- **Permission gate.** Generator classifies `create*` → WRITE and the oRPC gate
  requires `<module>_create` for API-key callers. `upsertDocument`'s own route uses
  `{}` (auth only), so there is a mild inconsistency; acceptable (attaching a doc to
  an opportunity ≈ a sales write). Note, don't block on it.
- **Size unit.** `insertUploadedDocument` takes `size` in **KB** to match the column
  and the existing hooks. Document it in the schema; the agent divides bytes/1024.

## Non-goals
- Refactoring the client hooks to call these new service functions (possible future
  DRY win — the wrappers are client-safe — but out of scope here).
- Any new binary/streaming channel in the MCP transport.
- New entities beyond the five that have upload hooks today.
