# Review — edits to one document

- **Target:** `feat/document-editor-edits`, commits `63673b788c..HEAD` (per-document edits), plus the editor redesign files in `63673b788c` that no earlier review covered (`TextConfig`, `WordInput`, `PreviewPages`, `previewText`, `PanelSection`, `BlockList`, `index.tsx`).
- **Base:** `63673b788c`. The editable-text work before it was reviewed in `.ai/plans/2026-11-04-editable-block-content-review.md`.
- **Working tree:** clean when reviewed.

## Blockers

### B1. A quote revision can fail after the revision exists

`apps/erp/app/modules/sales/sales.service.ts:413` calls `copyDocumentEdit` after the get-method posting has created the new quote. `copyDocumentEdit` is a Kysely write and throws on failure. `copyQuote` returns `{ data, error }` everywhere else, and the duplicate route (`routes/x+/quote+/$quoteId.duplicate.tsx:33`) has no `try`. So a failed copy answers 500 while the revision row already exists. The user sees "failed" and gets a revision anyway.

**Fix:** catch the error, log it with the quote ids, and return the posting's result. A revision without the copied words is recoverable; a phantom failure is not. Copying inside the posting's own transaction would be atomic, but it needs a change to get-method for one table. That is not worth it here.

### B2. The lock is checked outside the write

`saveDocumentEdit` reads the record and its lock at `settings.server.ts:1602`, then writes in a separate transaction at `settings.service.ts:9359`. A finalize can commit between the two. The edit then lands on a sent document, and the saved PDF no longer matches what the record prints.

**Fix:** in `saveDocumentEditRow`'s transaction, read the record row first with `SELECT status … WHERE id AND "companyId" FOR UPDATE` and refuse when `isLocked(status)`. The finalize's own status update then waits for the save, or the save waits for the finalize and refuses.

### B3. `settings.models.ts` crossed 1,000 lines

It grew from 924 to 1,087 lines. Most of the growth is the document-edit map (`DOCUMENT_EDIT_RECORDS`, the two permission maps, `DOCUMENT_TERMS_FIELD`) and `documentEditValidator`.

**Fix:** move the map and the two permission maps to `settings.utils.ts`, which exists and is the browser-safe home the module-files rule names. Keep only `documentEditValidator` in models.

### B4. The same template-plus-edit block is pasted 11 times, and a second loader duplicates an existing one

Every renderer now repeats this block:

```ts
applyDocumentEdit(
  resolveTemplate(t, toDocumentTemplate(row, t)),
  edit !== undefined ? edit : await getDocumentEdit(client, { companyId, documentType: t, documentId })
)
```

It appears in `purchasing.pdf.tsx` (3 times), `sales.pdf.tsx` (3 times), `packing-slip.pdf.tsx`, `production.pdf.tsx`, `inventory/stock-transfer.pdf.tsx`, `quality/quality.pdf.tsx` and `packages/lib/src/sales-invoice-document.server.tsx`. Three more problems come with it:

- The edit is read after the parallel loads, so every PDF render gets one more sequential round trip.
- `edit?: DocumentEdit | null` is a three-state argument: `undefined` means "load it", `null` means "none", and a value means "use this draft".
- `getResolvedDocumentTemplate` (`settings.service.ts:9295`) does what `getDocumentTemplateConfig` (`settings.service.ts:945`) already does, plus `resolveTemplate`.

**Code-judo:** add one reader in `@carbon/lib/document-edit.server`:

```ts
getPrintedTemplate(client, { companyId, documentType, documentId }, draft?: DocumentEdit)
// reads the documentTemplate row and the documentEdit row in parallel,
// resolves the template, applies the draft or else the saved edit
```

Each renderer's `getDocumentTemplate` + `toDocumentTemplate` + `resolveTemplate` + edit block becomes one call. The edit read joins the parallel loads. `getResolvedDocumentTemplate` is deleted: the two service functions call `getDocumentTemplateConfig` and `resolveTemplate`. About 120 lines go away, and a twelfth renderer cannot forget the edit.

## Code-judo / simplification

### J1. Send the edit, not the whole draft

The modal posts every block and the full settings (`context.tsx` save, `document-edit.$type.$id.preview.ts`). The server then diffs them against the template it loads at save time. If the company template changes while the modal is open, every word the user left alone is diffed against the new template and stored as an edit. That pins the old wording on this document (see R1).

**Simpler:** the client already holds the template it showed (`document.template`). Compute `diffDocumentEdit` in the browser, which the package already exports, and post the edit. The server parses it with `documentEditSchema`, validates `applyDocumentEdit(template, edit)` and stores it. The preview route takes the same payload. This also removes the round trip through the full block array.

### J2. Document-mode checks are scattered across four files

`isDocument` / `locked` checks now sit in `index.tsx` (3), `BlockList.tsx` (8), `BlockConfig.tsx` (4) and `TextConfig.tsx` (3). Each one is a bare boolean, and the reason lives in a comment at each site.

**Simpler:** one hook, `useEditorAbilities()` in `context.tsx`, returns named abilities derived from the store once: `arrangeBlocks` (add, drag, remove, header/footer/logo, font, colors, Options) and `editWords` (false when locked). Each site then reads `abilities.arrangeBlocks` instead of re-deriving it, and a third mode later changes one function.

## Performance

- **Edit lookup:** `EXPLAIN ANALYZE` with 50,000 `documentEdit` rows showed an index scan on `documentEdit_companyId_documentType_documentId_key`, 0.037 ms. Database time is not a concern.
- **Round trips:** each PDF render adds one sequential PostgREST call, because the edit is read after `Promise.all`. B4 removes it.
- No list, view or default page path changed. The renderers run on demand, on send, and in the invoice jobs.

## Risks / questions

- **R1. Stale template pinning.** This is the J1 scenario: a template change made while a modal is open turns untouched words into stored edits on save. It is rare, but silent.
- **R2. Read policy.** `documentEdit` SELECT allows any employee of the company (`authz/manifest.ts`), including employees who cannot view the record's module. Rows hold words, not record data. It is acceptable, but it is not module-scoped like the records.
- **R3. Untested security and lock rules.** No committed test covers the lock refusal, the keyed permission or the RLS writer rule as a real role. The E2E run proved the lock refusal as the test user. It did not run criterion 11 (a user without update rights), because no restricted user exists. A database test in `apps/erp/test/database/` should insert as a sales-only employee and expect a PO row refused.
- **R4. Two sources for the module mapping.** `documentEditWriter` (`authz/manifest.ts`) and `DOCUMENT_EDIT_RECORDS.module` state the same mapping twice, and nothing checks that they agree. A small test that imports both would catch drift.
- **R5. Notes skip the module update functions.** The save writes the notes column directly (`settings.service.ts`, `saveDocumentEditRow`). All 11 tables have `updatedBy` and `updatedAt` (checked with `information_schema`), and database triggers still fire. Any check a module's own update function adds beyond the lock is not applied. None was found for notes, but this was checked for invoices only (`refuseLockedInvoices`, which the lock already covers).

## Docs freshness

- `.ai/specs/2026-11-04-per-document-edits.md` says "Implemented" but sits in `.ai/specs/`. The specs AGENTS.md moves a finished spec to `implemented/` (ask first).
- `.claude/rules/document-template-customizer.md` still says "the 9 supported types" in the Template model section. There are 12; this predates this branch.

## TLDR

- **B1** A failed edit copy turns a successful quote revision into a 500 (`sales.service.ts:413`).
- **B2** The lock is checked outside the write transaction, so a finalize can slip between (`settings.server.ts:1602` → `settings.service.ts:9359`).
- **B3** `settings.models.ts` went from 924 to 1,087 lines; move the map to `settings.utils.ts`.
- **B4** The template-plus-edit block is pasted 11 times, with a duplicate loader and an extra round trip; replace them with one `getPrintedTemplate`.
- **J1** Post the edit, not the full draft; removes stale-template pinning.
- **J2** Replace scattered `isDocument`/`locked` booleans with one `useEditorAbilities()`.
- **Perf** The lookup is 0.037 ms at 50k rows; there is one extra sequential call per render (fixed by B4).
- **R1–R5** Stale pinning; company-wide read policy; no committed security/lock test; mapping stated twice; notes bypass module update functions.
- **Docs** Move the spec to `implemented/`; fix the stale "9 supported types" line.

## Verdict

**Block.** B1 and B2 are correctness and concurrency bugs. B3 breaks the 1,000-line rule. B4 leaves a large, clear simplification on the table.

## Fixes (2026-11-04)

| Blocker | Fix | Commit | Proof |
|---|---|---|---|
| B4 | `getPrintedTemplate` (`@carbon/lib/document-edit.server`) reads the template row and the edit in parallel; all 11 renderers and the save/preview paths use it; `getResolvedDocumentTemplate` is deleted. Net −115 lines. | `58ee20ba16` | All 11 types saved an edit and printed it again; erp, lib and jobs typecheck. |
| B2 | `saveDocumentEditRow` reads the record `FOR UPDATE` inside its transaction and refuses a locked record; the service function maps that to "This document is locked." | this commit | A save run while another transaction held the PO at To Receive waited 4.8 s, then answered `rule` "This document is locked."; the stored edit did not change. |
| B1 | `copyQuote` catches and logs a failed edit copy and returns the posting's result. | this commit | A new quote revision (2) answered 200 and got the source's edits. |
| B3 | The document-edit map, its permission maps and `DOCUMENT_TERMS_FIELD` moved to `settings.utils.ts`. `settings.models.ts` is 934 lines (924 at base). | this commit | erp typecheck; `@carbon/checks` 59 files / 419 tests. |

J1, J2, R1–R5 and the docs items stay open as follow-ups.
