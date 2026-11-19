# Edits to one document — implementation plan

**Spec / source:** `.ai/specs/2026-11-04-per-document-edits.md`
**Branch:** `feat/document-editor-edits` (worktree `carbon-feat-document-editor-edits`)
**Research:** `.ai/research/2026-11-04-per-document-edits-codebase.md` (render call sites, locks, menus)

## Progress
- [x] Task 1: Add the `documentEdit` table, its RLS rule and its backup id ref
- [x] Task 2: Apply and diff an edit in `@carbon/documents`
- [x] Task 3: Read an edit from the database (`@carbon/lib`)
- [x] Task 4: Map each document type to its record, lock, permission and notes column
- [x] Task 5: Apply the saved edit in every renderer
- [x] Task 6: Add the service functions (load, preview, save)
- [x] Task 7: Add the resource routes
- [x] Task 8: Copy edits when a quote is copied
- [x] Task 9: Give the editor a document mode
- [x] Task 10: Add `DocumentEditModal` and "Edit document" on the 11 records
- [x] Task 11: Docs, translations, checks
- [x] Task 12: End-to-end verification

## Dependencies
Task 2 needs nothing. Task 3 needs Task 1. Task 5 needs Tasks 2–3. Task 6 needs Tasks 2–5. Task 7 needs Task 6.
Task 8 needs Task 1. Task 9 needs Task 7. Task 10 needs Task 9. Tasks 11–12 come last.

## Shared definitions (used by several tasks)

```ts
// packages/documents/src/template/edit.ts
export const blockEditSchema = z.object({
  text: z.record(z.string(), z.string()).optional(),
  hidden: z.array(z.string()).optional(),
  visible: z.boolean().optional(),
  content: z.any().optional() // Terms rich text (JSONContent)
});
export const documentEditSchema = z.object({
  blocks: z.record(z.string(), blockEditSchema).default({}),
  settings: z.object({
    text: z.record(z.string(), z.string()).optional(),
    hidden: z.array(z.string()).optional()
  }).default({})
});
export type DocumentEdit = z.infer<typeof documentEditSchema>;
export const DOCUMENT_EDIT_TYPES = [
  "purchaseOrder", "purchaseReturnOrder", "purchasingRfq", "quote", "salesOrder",
  "salesReturnOrder", "salesInvoice", "packingSlip", "stockTransfer", "jobTraveler", "issue"
] as const satisfies readonly DocumentTemplateType[];
export type DocumentEditType = (typeof DOCUMENT_EDIT_TYPES)[number];
```

---

## Task 1: Add the `documentEdit` table, its RLS rule and its backup id ref

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_document-edit.sql` (via `pnpm db:migrate:new document-edit`)
- Modify: `packages/database/src/authz/manifest.ts` — rule for `documentEdit`
- Modify: `packages/jobs/src/backups/id-refs.ts` — `documentEdit: ["documentId"]`
- Copy from (precedent): `packages/database/supabase/migrations/20260609143732_document-template.sql`

**Steps:**
1. Run `pnpm db:migrate:new document-edit`. If HHMMSS is `000000`, rename the file with a random HHMMSS.
2. Write the table:
   ```sql
   CREATE TABLE "documentEdit" (
     "id" TEXT NOT NULL DEFAULT id('dedit'),
     "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
     "documentType" TEXT NOT NULL CHECK ("documentType" IN ('purchaseOrder','purchaseReturnOrder','purchasingRfq','quote','salesOrder','salesReturnOrder','salesInvoice','packingSlip','stockTransfer','jobTraveler','issue')),
     "documentId" TEXT NOT NULL,
     "blocks" JSONB NOT NULL DEFAULT '{}'::jsonb,
     "settings" JSONB NOT NULL DEFAULT '{}'::jsonb,
     "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
     "updatedBy" TEXT REFERENCES "user"("id"),
     "updatedAt" TIMESTAMP WITH TIME ZONE,
     PRIMARY KEY ("id", "companyId"),
     UNIQUE ("companyId", "documentType", "documentId")
   );
   CREATE INDEX "documentEdit_companyId_idx" ON "documentEdit" ("companyId");
   CREATE INDEX "documentEdit_createdBy_idx" ON "documentEdit" ("createdBy");
   CREATE INDEX "documentEdit_updatedBy_idx" ON "documentEdit" ("updatedBy");
   ALTER TABLE "documentEdit" ENABLE ROW LEVEL SECURITY;
   ```
   Copy the audit-column and index style of the precedent if it differs.
3. Add the rule beside `documentTemplate` in `manifest.ts`. Each write needs the update permission of the row's type:
   ```ts
   const documentEditWriter = or(
     and(where<"documentEdit">((eb) => eb("documentType", "in", ["purchaseOrder","purchaseReturnOrder","purchasingRfq"])), inCompany("companyId", "purchasing_update")),
     and(where<"documentEdit">((eb) => eb("documentType", "in", ["quote","salesOrder","salesReturnOrder","salesInvoice"])), inCompany("companyId", "sales_update")),
     and(where<"documentEdit">((eb) => eb("documentType", "in", ["packingSlip","stockTransfer"])), inCompany("companyId", "inventory_update")),
     and(where<"documentEdit">((eb) => eb("documentType", "=", "jobTraveler")), inCompany("companyId", "production_update")),
     and(where<"documentEdit">((eb) => eb("documentType", "=", "issue")), inCompany("companyId", "quality_update"))
   );
   documentEdit: policies({
     select: inCompany("companyId", "employee"),
     insert: documentEditWriter,
     update: { using: documentEditWriter, check: documentEditWriter },
     delete: documentEditWriter
   }),
   ```
   If `policies` does not take `{ using, check }` for update, copy the shape the `note` rule uses.
4. Add `documentEdit: ["documentId"]` to `ID_REF_COLUMNS` (alphabetical order).
5. Run `pnpm db:migrate`. It applies the migration, syncs the RLS rule and regenerates types.
6. Run `pnpm --filter @carbon/database authz migration document-edit-rls`.

**Verify:**
```bash
pnpm --filter @carbon/database authz check   # Expected: no drift (exit 0)
grep -n '"documentEdit"' packages/database/src/types.ts | head -1   # Expected: one match
pnpm --filter @carbon/database exec vitest run src/authz   # Expected: all pass
```

**Out of scope:** demo datasets. No screen lists edits, so an empty table shows nothing wrong.

## Task 2: Apply and diff an edit in `@carbon/documents`

**Depends on:** none
**Files:**
- Create: `packages/documents/src/template/edit.ts` (shared definitions above, plus the two functions)
- Create: `packages/documents/src/template/edit.test.ts`
- Modify: `packages/documents/src/template/index.ts` — `export * from "./edit"`
- Copy from (precedent): `packages/documents/src/pdf/blocks/columns.ts` + its test

**Steps:**
1. `applyDocumentEdit(template: DocumentTemplate, edit: DocumentEdit | null): DocumentTemplate`:
   - Null edit → return `template`.
   - For each block with `edit.blocks[block.id]`: `text = { ...block.text, ...e.text }`; `hidden = e.hidden ?? block.hidden`; `visible = e.visible ?? block.visible`; if `e.content !== undefined` set `content` (Terms only).
   - `settings.text = { ...settings.text, ...edit.settings.text }`; `settings.hidden = edit.settings.hidden ?? settings.hidden`.
   - Ignore entries whose block id the template does not have.
2. `diffDocumentEdit(documentType, base: DocumentTemplate, edited: Pick<DocumentTemplate, "blocks" | "settings">): DocumentEdit`:
   - For each base block with a same-id edited block: keep a `text` key when the edited printed text differs from the base printed text (printed = `text[key] ?? catalog default`, from `getTextEntries`).
   - Keep `hidden` when the sorted arrays differ. Keep `visible` when it differs. Keep `content` when `JSON.stringify` differs.
   - Do the same for `settings.text` / `settings.hidden` with the `document` entries.
   - Drop empty block entries. An edit with no blocks and an empty `settings` means "no edit".
3. `isEmptyDocumentEdit(edit): boolean`.
4. Tests (behaviour sentences): apply keeps an unchanged word following the template; apply overrides a changed word; apply ignores a missing block id; diff of the base against itself is empty; diff round-trips (apply(base, diff(base, edited)) prints what edited prints); a word set back to the template's word leaves no key.

**Verify:**
```bash
pnpm --filter @carbon/documents exec vitest run src/template/edit.test.ts   # Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/documents   # Expected: 1 successful
```

## Task 3: Read an edit from the database (`@carbon/lib`)

**Depends on:** Task 1
**Files:**
- Create: `packages/lib/src/document-edit.server.ts`
- Modify: `packages/lib/package.json` — export `"./document-edit.server"`
- Copy from (precedent): the export of `./sales-invoice-document.server` in `packages/lib/package.json`

**Steps:**
1. `getDocumentEdit(client: SupabaseClient<Database>, args: { companyId: string; documentType: DocumentEditType; documentId: string }): Promise<DocumentEdit | null>`: select `blocks, settings` with the 3 filters, `.maybeSingle()`. Parse with `documentEditSchema.safeParse`; return null on no row or a parse failure (log the failure with `getLogger`).
2. (Dropped while building: renderers call `applyDocumentEdit` directly, so a wrapper adds nothing.)

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib   # Expected: 1 successful
```

## Task 4: Map each document type to its record, lock, permission and notes column

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — the map (the module-files rule allows one models file per module)

**Steps:**
1. Add `DOCUMENT_EDIT_RECORDS: Record<DocumentEditType, DocumentEditRecord>` with:
   `{ table, label column (readable id), statusColumn, isLocked(status) , module: "purchasing" | "sales" | "inventory" | "production" | "quality", notesColumn: string | null }`.
   | type | table | readable id | lock | module | notes |
   |---|---|---|---|---|---|
   | purchaseOrder | purchaseOrder | purchaseOrderId | `isPurchaseOrderLocked` | purchasing | externalNotes |
   | purchaseReturnOrder | purchaseReturnOrder | returnOrderId (check column) | `isPurchaseReturnOrderLocked` | purchasing | externalNotes |
   | purchasingRfq | purchasingRfq | rfqId | `isRfqLocked` | purchasing | notes |
   | quote | quote | quoteId | `isQuoteLocked` | sales | externalNotes |
   | salesOrder | salesOrder | salesOrderId | `isSalesOrderLocked` | sales | externalNotes |
   | salesReturnOrder | salesReturnOrder | returnOrderId (check column) | `isSalesReturnOrderLocked` | sales | externalNotes |
   | salesInvoice | salesInvoice | invoiceId | `isSalesInvoiceLocked` | sales | externalNotes |
   | packingSlip | shipment | shipmentId | status Posted or Voided | inventory | externalNotes |
   | stockTransfer | stockTransfer | stockTransferId | `isStockTransferLocked` | inventory | null |
   | jobTraveler | job | jobId | status in `JOB_LOCKED_STATUSES` | production | notes |
   | issue | nonConformance | nonConformanceId | `isIssueLocked` | quality | content |
   Confirm each readable-id column and lock function name in the generated types / models file before you write it.
2. Export `documentEditPermissions` = `Record<DocumentEditType, { update: module }>` for `defineServiceFn`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1   # Expected: 2 successful
```

## Task 5: Apply the saved edit in every renderer

**Depends on:** Tasks 2–3
**Files (renderers from research section 1):**
- Modify: `apps/erp/app/modules/purchasing/purchasing.pdf.tsx` (PO, PRO, RFQ)
- Modify: `apps/erp/app/modules/sales/sales.pdf.tsx` (quote, SO, SRO)
- Modify: `packages/lib/src/sales-invoice-document.server.tsx` (invoice)
- Modify: `apps/erp/app/modules/inventory/packing-slip.pdf.tsx`
- Modify: `apps/erp/app/modules/production/production.pdf.tsx`
- Create: `apps/erp/app/modules/inventory/stock-transfer.pdf.tsx` (move the inline render out of `routes/file+/stock-transfer+/$id[.]pdf.tsx`)
- Create: `apps/erp/app/modules/quality/quality.pdf.tsx` (move the inline render out of `routes/file+/issue+/$id[.]pdf.tsx`)
- Copy from (precedent): `apps/erp/app/modules/inventory/packing-slip.pdf.tsx`

**Steps:**
1. Give each render function an optional last argument `edit?: DocumentEdit | null`.
2. In each, right after `toDocumentTemplate(...)`: resolve the template (`resolveTemplate(type, template)`, so a null template gets the default blocks). If `edit === undefined`, load it with `getDocumentEdit` (the render's client and company). Then `template = applyDocumentEdit(resolved, edit)`.
3. Move the stock transfer and issue route bodies into `renderStockTransferPdf` / `renderIssuePdf`; the routes call them. Behaviour stays the same.
4. Job traveler: the edit belongs to the job, so both traveler routes use the job id.
5. Do not touch tracking label renderers.

If a renderer reads the template before data that changes block ids, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/lib --filter=@carbon/jobs --concurrency=1   # Expected: all successful
```

## Task 6: Add the service functions (load, preview, save)

**Depends on:** Tasks 2–5
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — 2 service functions
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — building blocks
- Create: `apps/erp/app/modules/settings/document-edit.pdf.tsx` — `renderDocumentWithEdit(type, ...)` dispatcher to the renderers of Task 5
- Copy from (precedent): `saveDocumentTemplate` (`settings.server.ts:1532`)

**Steps:**
1. `getDocumentEditor` (`permission: { by: "documentType", rules: documentEditViewPermissions }`, view of the module): returns `{ documentType, documentId, label, locked, template (resolved company template), edit, notes, sections, headerConfig }`. It loads the record row by id and `companyId`; it returns `ctx.error("notFound", …)` when there is none.
2. `saveDocumentEdit` (`permission: { by: "documentType", rules: documentEditPermissions }`), input `{ documentType, documentId, blocks, settings, notes? }`:
   1. Load the record; refuse `notFound` if missing.
   2. If locked, return `ctx.error("validation", "This document is locked.")`.
   3. Load the resolved company template. `edit = diffDocumentEdit(type, template, { blocks, settings })`.
   4. Run `validateTemplateText` on `applyDocumentEdit(template, edit)`; refuse with the joined messages.
   5. In one `ctx.transaction`: delete the row when `isEmptyDocumentEdit(edit)`, else upsert on `("companyId","documentType","documentId")` with `createdBy`/`updatedBy` = `ctx.auditUserId`; if `notes` is present and the type has a notes column, update that column, `updatedBy`, `updatedAt` on the record (scoped by `companyId`).
3. The preview is not a service function: the route of Task 7 calls the dispatcher with `diffDocumentEdit(...)` of the posted draft.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1   # Expected: 2 successful
```

## Task 7: Add the resource routes

**Depends on:** Task 6
**Files:**
- Create: `apps/erp/app/routes/api+/document-edit.$type.$id.ts` — loader = `getDocumentEditor`, action = `saveDocumentEdit`
- Create: `apps/erp/app/routes/api+/document-edit.$type.$id.preview.ts` — action returns the PDF
- Modify: `apps/erp/app/utils/path.ts` — `path.to.api.documentEdit(type, id)`, `documentEditPreview(type, id)`
- Copy from (precedent): `apps/erp/app/routes/x+/templates+/$type.preview.tsx`, `x+/templates+/$type.tsx` action

**Steps:**
1. Validate `$type` with `z.enum(DOCUMENT_EDIT_TYPES)`; a bad type answers 404.
2. The preview action reads `blocks`, `settings` (JSON form fields), loads the company template, diffs, then calls `renderDocumentWithEdit`. It checks view permission of the module first.
3. The save action parses JSON fields and calls `api.settings.saveDocumentEdit`; return the result to the fetcher.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1   # Expected: 2 successful
```

## Task 8: Copy edits when a quote is copied

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `copyQuote` (`:387`)

**Steps:**
1. After the copy writes the target quote, read the source `documentEdit` row (`documentType = 'quote'`, `documentId = sourceId`, same company). If one exists, upsert it for `targetId`.
2. Use the same client and transaction as the surrounding writes.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1   # Expected: 2 successful
```

## Task 9: Give the editor a document mode

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/components/DocumentTemplateEditor/context.tsx` — optional `document` prop
- Modify: `TemplatePreview.tsx`, `BlockList.tsx`, `BlockConfig.tsx`, `index.tsx` (export the panes for the modal)
- Create: `apps/erp/app/components/DocumentTemplateEditor/NotesConfig.tsx`
- Copy from (precedent): `TermsConfig` in `BlockConfig.tsx` (rich text + `MergeFieldMenu`)

**Steps:**
1. `DocumentTemplateProps.document?: { id: string; label: string; locked: boolean; notes: JSONContent | null; template: { blocks; settings } }`. The store keeps `document` and `notes`; `isDirty` includes `notes`.
2. Save in document mode posts `documentType, documentId, blocks, settings, notes` to `path.to.api.documentEdit(type, id)`; toast "Saved this document".
3. Store action `resetToTemplate()`: set `blocks` and `settings` to `document.template`.
4. `TemplatePreview` in document mode posts to the document preview route.
5. `BlockList` in document mode: no Add block, no drag handle, no remove; header/footer rows have no eye; no Logo row.
6. `ControlRail` in document mode: no Font and Colors sections.
7. `BlockConfig` in document mode: no "Options"; Terms block shows `TermsConfig`; Notes block shows `NotesConfig` (rich text editor over `notes`); words as today.
8. When `document.locked`, every input is disabled (`WordInput disabled`, eyes disabled, editors read-only) and Save is hidden.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1   # Expected: 2 successful
pnpm exec biome check apps/erp/app/components/DocumentTemplateEditor/   # Expected: no errors
```

## Task 10: Add `DocumentEditModal` and "Edit document" on the 11 records

**Depends on:** Task 9
**Files:**
- Create: `apps/erp/app/components/DocumentEditModal.tsx`
- Modify the 11 menus listed in research section 4 (PO, SO, invoice, quote headers; return order and RFQ overflow; issue; job; shipment and stock transfer documents tabs)
- Copy from (precedent): a full-size `Modal` in `apps/erp/app/components` (find one with `size="full"` or the widest `ModalContent`)

**Steps:**
1. The modal fetches `path.to.api.documentEdit(type, id)` with `useFetcher` on open, then renders `DocumentTemplateProvider` with `document` mode, the 3 panes and a top bar: "Editing {label} only", Reset to template, Cancel, Save.
2. Locked: a line "Locked: this document was sent." and no Save.
3. Each menu shows "Edit document" next to "PDF" only when `permissions.can("update", module)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1   # Expected: 2 successful
```

## Task 11: Docs, translations, checks

**Depends on:** Tasks 1–10
**Steps:**
1. Add a "Edits to one document" section to `.claude/rules/document-template-customizer.md` (table, merge point, lock, modal).
2. `pnpm lingui:extract` then `pnpm lingui:clean`.
3. `pnpm exec biome check` on changed files; `@carbon/documents` tests; erp tests for the editor folder.

**Verify:**
```bash
pnpm --filter @carbon/documents exec vitest run   # Expected: all pass
```

## Task 12: End-to-end verification

**Depends on:** Task 11
**Steps:** run spec acceptance criteria 1–15 in the browser (`AGENT_BROWSER_SESSION` set, `/auth` skill), read PDFs with `pdftotext`, read rows with `psql`. Record results in `.ai/runs/2026-11-04-per-document-edits-e2e.md`.

**Verify:** every criterion PASS or a reason in the run log.
