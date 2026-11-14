# Change a document's values — implementation plan

**Spec / source:** `.ai/specs/2026-11-05-document-value-edits.md`
**Branch:** `feat/document-editor-edits` (uncommitted work on top of `7d02ac3c00`; commits only on request)

## Progress
- [x] Task 1: Value edits in the template package
- [x] Task 2: Drivers and table rows apply and report values
- [x] Task 3: Renderers take a collector; values route; preview and download rules
- [x] Task 4: Rich text marks
- [x] Task 5: Summary stays with Line Items
- [x] Task 6: Values section and Download in the editor
- [x] Task 7: Clicks jump to value boxes
- [x] Task 8: Translations, docs and end-to-end check

## Dependencies
Task 2 needs 1. Task 3 needs 2. Tasks 4 and 5 are independent. Task 6 needs 3. Task 7 needs 6. Task 8 needs all.

---

## Task 1: Value edits in the template package

**Files:** Create `packages/documents/src/template/values.ts`. Modify `template/schema.ts`, `template/merge.ts`, `template/edit.ts`, `template/texts/validate.ts`, `template/index.ts`, plus tests.

**Steps:**
1. `schema.ts`: `valueEditsSchema = z.object({ document: z.record(z.string(), z.string()).optional(), rows: z.record(z.string(), z.record(z.string(), z.string())).optional() })`, and `valueEdits: valueEditsSchema.optional()` on `documentSettingsSchema`.
2. `merge.ts`: `fixed?: true` on `MergeField`, set on every quantity token (`job.quantity`, `job.scrapQuantity`, `price.quantity`, `material.quantity`, `association.quantity`, `line.quantity`, `line.shippedQuantity`, `line.orderQuantity`, `unit.quantity`) and packing slip `line.serialBatch`. Export `isEditableValue(field)`: false for `amount` or `fixed`.
3. `values.ts`: `ValueCollector`, `CollectedValues`, `DocumentValues`, `documentValues(edits, collector)` with `document(vars)` and `row(prefix, id, vars)`, `isEmptyValueEdits`, and `setValueEdit(edits, rowKey, token, text, recordValue)` that drops an entry equal to the record's value.
4. `edit.ts`: `documentEditSchema.settings` takes `valueEdits`; `applyDocumentEdit` sets it; `diffDocumentEdit` keeps it when not empty.
5. `validate.ts`: code `valueLocked` for any token in `settings.valueEdits` that is not editable (`blockId: "document"`, `field: token`).

**Verify:** `pnpm --filter @carbon/documents exec vitest run src/template` — all pass, including new tests for row keys, an override, the collector and `valueLocked`.

**Out of scope:** renderers and the editor.

## Task 2: Drivers and table rows apply and report values

**Files:** Modify the 11 `pdf/*PDF.tsx` drivers, each `pdf/blocks/**/types.ts`, and the row sites.

**Steps:**
1. Each driver takes `valueCollector?: ValueCollector`, builds `const values = documentValues(settings.valueEdits, valueCollector)`, wraps `vars` in `values.document(...)`, and adds `values` to its data bag. `JobTravelerPDF`'s `buildData` and page do the same.
2. Row sites become `data.values.row(prefix, id, build…(…))`: `line` with `line.id` for tables of lines; quote `line`, `price` (`${line.id}:${quantity}`), `charge` (`${line.id}:${quantity}:${charge.description}`); issue `task`, `inspection` (`record.id`), `association` (row's id or position), `reviewer`; packing slip `line`, `unit`; job traveler `operation`, `step`, `material`.
3. A block that passes a variable through row vars (`job.salesOrder`, `issue.initiatedBy`) reads it from `data.vars` first, so an edit wins over the fallback word.

**Verify:** `pnpm --filter @carbon/documents exec tsc --noEmit` has no errors; `pnpm --filter @carbon/documents test` passes. Old/new text diff across all documents with no edits prints identical text. If a row has no stable id, use its position.

**Out of scope:** routes.

## Task 3: Renderers, values route, preview and download rules

**Files:** Modify the 11 render functions (`purchasing.pdf.tsx`, `sales.pdf.tsx`, `packing-slip.pdf.tsx`, `production.pdf.tsx`, `stock-transfer.pdf.tsx`, `quality.pdf.tsx`, `packages/lib/src/sales-invoice-document.server.tsx`), `settings/document-edit.pdf.tsx`, `routes/api+/document-edit.$type.$id.preview.ts`, `utils/path.ts`, `settings.server.ts`. Create `routes/api+/document-edit.$type.$id.values.ts`. Precedent: `routes/api+/document-edit.$type.$id.ts`.

**Steps:**
1. Thread `valueCollector` from `renderDocumentWithEdit` to each driver.
2. Values route: update permission on the record's module; render with every block visible and the saved words, no `valueEdits`; answer `{ data: CollectedValues }`.
3. Preview: when posted `valueEdits` differ from saved ones, or `intent=download`, require update on the module; refuse a locked record with changed values (`409`), refuse `valueLocked` always (`400`). `intent=download` runs `validateTemplateText` and answers `400` with the messages; a good answer uses `attachment`.
4. `saveDocumentTemplate` drops `settings.valueEdits` before storing.

**Verify:** `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/lib` succeeds; a browser fetch checks each answer in Task 8.

**Out of scope:** the modal UI.

## Task 4: Rich text marks

**Files:** Modify `pdf/components/Note.tsx`. Create `pdf/components/Note.test.ts`.

**Steps:** in `case "text"`, wrap marked text in a nested `<Text>` with `fontWeight: "bold"` for `bold` and `textDecoration` for `underline` and `strike`. Other marks print plain. Export a pure `markStyle(marks)` for the test.

**Verify:** the test passes; a rendered PDF with bold text lists a bold face in `pdffonts`.

**Out of scope:** italic faces.

## Task 5: Summary stays with Line Items

**Files:** Modify `template/defaults.ts`, `DocumentTemplateEditor/context.tsx`, `template/template.test.ts`.

**Steps:** add and export `keepSummaryWithLineItems(blocks)`; apply it where `resolveTemplate` returns stored blocks and after `arrayMove` in `reorder`.

**Verify:** tests for a block between them, Line Items moved past others, a document with no Summary, and the unchanged order.

**Out of scope:** `BlockList.tsx`.

## Task 6: Values section and Download in the editor

**Files:** Create `DocumentTemplateEditor/ValueConfig.tsx`. Modify `context.tsx`, `BlockConfig.tsx`, `components/DocumentEditModal.tsx`. Precedent: `TextConfig.tsx` and `PanelSection.tsx`.

**Steps:**
1. Store: `documentValues`, `setDocumentValues`, `valueFocus`, `focusValue`. `DocumentEditModal` loads the values route once.
2. `ValueConfig`: the tokens the panel's current words print, editable ones only. Document values first, then rows grouped per prefix, titled with the group name and number. A multi-line box per value, a put-back button when changed, read-only when locked, spinner until loaded.
3. Top bar: Download posts the draft with `intent=download`, saves the blob as `<label>.pdf`, and shows the server's message on refusal.
4. Message for `valueLocked` in `describe`.

**Verify:** `pnpm exec turbo run typecheck --filter=erp`; Biome passes; checked in the browser in Task 8.

**Out of scope:** the company template editor, which never shows the section.

## Task 7: Clicks jump to value boxes

**Files:** Modify `previewText.ts`, `previewText.test.ts`, `TemplatePreview.tsx`, `ValueConfig.tsx`.

**Steps:** `valueTargets(type, blocks, settings, collected)` lists editable values in print order, with scope, row and token. `findPrintedValue(lines, clicked, targets)`: a run equal to a value, a run holding a value of 3+ characters, or a run that starts a value; for repeats, the n-th run is the n-th target. `onTextClick` tries it first when values are loaded.

**Verify:** tests for an address line, two "Contact:" rows, repeated text in two rows, and a miss falling back to `findPrintedText`.

**Out of scope:** template mode.

## Task 8: Translations, docs and end-to-end check

**Steps:**
1. `pnpm lingui:extract`, `pnpm lingui:clean`; fill new strings in all 12 languages; `pnpm lingui:compile`.
2. Update `.claude/rules/document-template-customizer.md` and the spec status; add a run log at `.ai/runs/2026-11-05-document-value-edits-e2e.md`.
3. Walk the spec's 14 acceptance criteria in the browser and with direct requests.
4. Full checks: `pnpm --filter @carbon/documents test`, editor vitest, `pnpm --filter @carbon/checks test`, `pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/jobs --filter=@carbon/lib --concurrency=1`.

**Verify:** every criterion recorded with its proof in the run log.

**Out of scope:** committing.
