# Review — the document editor branch, all changes

- **Target:** `feat/document-editor-edits`, all commits and all uncommitted work, against `6dca4e9d45`: 222 files, +15,333 / −3,679 (translations excluded).
- **Method:** three independent read-only reviews (server, engine, editor UI), plus live runs. Each finding says how it was proved: **ran** (executed against the local stack) or **read** (confirmed in the code, not executed).
- **Passing today:** `@carbon/documents` 182 tests, editor 29, `@carbon/checks` 419. Typecheck of erp, mes, jobs, lib and documents passes. Biome is clean on 213 files. `db:check:datasets` passes for satellite. `db:check:backups` fails; see R1.

## Blockers

### B1. Test data and the spec use a product name from outside the seed data

`pdf/blocks/lineVars.test.ts:63,70,73,75`, `template/values.test.ts:11,20`, `template/texts/validate.test.ts:51`, `DocumentTemplateEditor/valueTargets.test.ts:129,134`, `.ai/specs/2026-11-05-document-value-edits.md:35`.

The name is a real identifier, which the repo's rules forbid (**ran:** matched against its source). All of these are uncommitted.

**Fix:** use a seeded demo item in every listed line, and check the rest of the spec's wording.

### B2. A quantity can be replaced by typed text

`template/texts/validate.ts:124-128,177` builds its guard from `field.amount` only, and quantities are `fixed`. The `settings.text` loop at `:214` has no guard at all. A stored `qtyCell: "999999"` validates clean on all 11 documents and passes through save, download and preview. The same applies to `{job.quantity}`, `{price.quantity}` and `materialsQuantityCell`. This breaks the decision that amounts and quantities stay protected. No test covers it. (**read**, and a throwaway script in the server review)

**Fix:** `!isEditableValue(field)` in one shared check that both loops call.

### B3. A direct API write skips every guard

`packages/database/src/authz/manifest.ts:506` gives any `*_update` user write access to `documentEdit`, and `template/values.ts:44,49` prints whatever is stored. Validation and the lock check live only in the app's save path, so a direct PostgREST write skips them. The app never uses these policies, because every write goes through `ctx.asSystem.pg`. (**ran:** as `authenticated`, the database accepted an insert for `salesInvoice` with `valueEdits.document["order.total"] = "$1"`. The record id did not exist.)

**Fix:** drop the three write policies, so API writes are refused. Filter edits at render with `isEditableValue`, so a stored amount never prints.

### B4. Preview returns a real PDF with changed amounts, for view-only users

`routes/api+/document-edit.$type.$id.preview.ts:74,79,91`. The route asks for update rights only when `valueEdits` change or the request sends `intent=download`. The route ignores `amountRemoved` unless the request downloads. A view-only user can POST `totalValue: "$1"` on a locked invoice and get the same PDF bytes back without the download intent. A user with update rights can also download a locked record with changed words. `record.data?.locked` fails open when the read errors.

`routes/x+/templates+/$type.preview.tsx:34,89-127` needs only `view: settings`, and renders a real record with whatever `valueEdits` are posted. (**read**)

**Fix:** a draft that differs from the saved edit needs update rights and an unlocked record; otherwise render the saved edit and ignore the draft. Strip `valueEdits` in the template preview.

### B5. Invoice edits use the wrong permission

`modules/settings/settings.utils.ts:110` keys `salesInvoice` to `sales`, but the table's rule is `invoicing` (`authz/manifest.ts:1429`), and the save runs as the system. A user with `sales_update` and `invoicing_view` can rewrite an invoice's `externalNotes` and printed words without `invoicing_update`. An invoicing clerk without `sales_update` cannot edit at all. (**read**)

**Fix:** use `invoicing` in the map. B3 removes the matching RLS rule.

### B6. A value changed on one traveler page prints on every page

`template/merge.ts:456,459,460` make `job.methodRevision`, `item.name` and `item.trackingType` editable at document level, and `pdf/JobTravelerPDF.tsx:75,120` builds them per make-method page. Renaming the root item prints that name on each sub-assembly's page too. The editor shows only the first page's value, and `template/values.test.ts:41` asserts that as correct. (**read**)

**Fix:** key them with `values.row("method", makeMethod.id, …)`, or mark them `fixed`.

### B7. Reopening the modal loads stale data, and Save overwrites newer work

`components/DocumentEditModal.tsx:60-65,91`. The fetcher still holds the first load's data, and the new store starts from that data. The store is created once (`context.tsx:443`), so it ignores the fresh load. (**ran:** changed the edit in the database while the modal was closed, reopened it, and the old title still showed.) Save overwrites notes the same way (`context.tsx:515`).

**Fix:** render the modal only while it is open in `useDocumentEditModal`, and drop the `open` prop and its effect.

### B8. Escape or a click outside silently throws away the draft

`components/DocumentEditModal.tsx:70-73`. No code stops either action. `BlockConfig.tsx:219` also shows "Manage shared sections" in document mode, which navigates away. (**ran:** Escape closed the modal with no prompt. The test did not establish that the draft was dirty at that moment. The code has no check either way.)

**Fix:** once the editor has loaded, prevent both on `ModalContent`. Hide the link in document mode. Decide whether Cancel on a dirty draft should ask.

### B9. Failed reads fail open

`packages/lib/src/document-edit.server.ts:44,53,82`. A failed edit read makes a send print and email the document without its edits. A failed template read makes `saveDocumentEdit` (`settings.server.ts:1616`) diff against the default template and store a wrong edit. (**read**)

**Fix:** throw on a failed read. Refuse the save. Render paths must decide explicitly, not by a silent null.

### B10. The tests would not catch reverts of the protections

- `pdf/components/Note.test.ts` tests only `markStyle`. Reverting `Note.tsx:139-142` passes.
- `pdf/preview-documents.test.ts` asserts `length > 0`. Blank values pass.
- `pdf/blocks/lineVars.test.ts:72-75` tests a generic spread, not a render.
- `template/texts/validate.test.ts:91` lets a new unflagged money token pass.
- Nothing tests B2, B3 or B4 as the real caller.

(**read**)

**Fix:** extract text from each sample and snapshot it. Add guard tests for B2 to B4.

## Code-judo / simplification

- **J1. Return orders are one component twice.** `pdf/blocks/salesReturnOrder/LineItemsBlock.tsx` and `purchaseReturnOrder/LineItemsBlock.tsx` are identical after renaming (**ran:** `diff` is empty). `vars.ts` and `PartiesBlock.tsx` differ mainly by the party. Use one `returnOrder/` block that takes the texts and lines.
- **J2. Line fields are retyped per document with their flags.** `template/merge.ts:516-783` is the root cause of S1. Define one `LINE = { quantity: {…, fixed}, taxPercent: … }` that each document picks from, about 265 lines down to about 90. Move the tables (`:113-815`) to `mergeFields.ts`.
- **J3. Terms and Notes blocks repeat.** `purchaseOrder/TermsBlock.tsx` and `salesOrder/TermsBlock.tsx` are identical after renaming (**ran:** `diff` is empty). Use `makeTermsBlock(texts, get)` and `makeNotesBlock(texts, get)`.
- **J4. Eleven drivers repeat the same stanza** (`documentValues`, `dt`, `documentTitle`, `documentNumber`, `footerText`), for example `SalesOrderPDF.tsx:80-95,131,173`. Use `printedDocument(texts, settings, build, collector)`.
- **J5. 111 `w.x ? … : null` ternaries in the tables** (**ran:** grep count). A `<Cell width={w.x}>` that returns null deletes them.
- **J6. `printedTexts` and `valueTargets` repeat one walk.** Extract `printedEntries`; this also fixes S4.
- **J7. Rich Text, Terms and Approval repeat token and insert logic** in `BlockConfig.tsx:613-757`. Extract `TokenEditor`.
- **J8. Dead code.** `TextConfig.tsx:80-111` (`own`, `others`, `orUndefined`, `otherHidden`); `context.tsx:457,469,517,528` (`savedRef` is always true); `PanelSection` and `useSectionOpen` have no outside callers; `MergeFieldMenu`'s `"Field"` default; `applyDocumentEdit` runs twice at `DocumentEditModal.tsx:96,100`; `const resolved = templateConfig` aliases such as `sales.pdf.tsx:196`.

## Performance

- **Edit lookup, on every PDF:** 200,000 `documentEdit` rows, unique index scan. 0.03 ms as owner, 1.0 ms as `authenticated` under RLS (**ran**, rolled back). No regression.
- **PDF render:** 300-line purchase order, 3.5 s old and new (earlier review, not re-run).
- **Opening the modal renders the PDF twice:** `document-edit.$type.$id.values.ts` runs a full render only to collect values, and the preview runs another. On a 300-line document that is about 7 s of server CPU per open, estimated from the render number and not measured. The values only need the block tree, not layout.

## Should-fix

- **S1. Percents, currency and numbers can be changed.** Percents and currency: `merge.ts:542,632,652,673,733` and `171,234,257,278,316,366`. `line.taxPercent = "0%"` prints beside the real tax amount. "Total (EUR)" can sit beside "Taxes (USD)", because `SummaryBlock.tsx:106` prints the record's currency. `*.number` can be edited while `SalesInvoicePDF.tsx:175` prints the record's in the footer, so one page carries two numbers. `line.unit` is fixed only on the RFQ (`merge.ts:747`). Needs a product decision; the safe default is `fixed`.
- **S2. A record outside the session's company still prints.** `preview.ts:39` and `values.ts:33` do not check the record belongs to the active company. A user in two companies gets B's record with A's template. Call `getDocumentEditRecord` first and answer 404.
- **S3. Any employee can read edits** (`manifest.ts:507`), including typed values and terms, without the module's view permission. Mirror each record's read rule, including its `anyOf` sets.
- **S4. Issue documents show a value twice.** `{issue.number}` is in `documentNumber` and `issueNumber`. `valueTargets.ts:58,115,119` keeps a separate `seen` per call. `ValueEditor.tsx:58,97` then shows two "per-row" boxes with a duplicate React key.
- **S5. A failed save can name nothing.** `context.tsx:503-505`: a non-catalog field (`rows.0.value`, `content`, `taxLabel`, a `valueLocked` token) shows the first text with no error, while the toast says "highlighted". Toast the first problem's message; have `BlockConfig` list errors with no catalog key.
- **S6. A company block can stop every document save.** `settings.server.ts:1625` and `preview.ts:91` validate the whole printed template. A Rich Text block with an old unknown `{x}` still renders but refuses every save, and document mode cannot fix it. Validate only what the edit changed.
- **S7. Reset leaves old terms showing.** `context.tsx:294`: `Editor` reads `initialValue` once, so the next keystroke restores them. Also set `selectedId: null, textFocus: null`.
- **S8. Enter during IME composition blurs the field** (`WordInput.tsx:196`), affecting ja, zh and ko. Check `e.nativeEvent.isComposing`.
- **S9. A partial match beats a printed label.** `valueTargets.ts:183-186` runs first, so clicking "Total" with a company named "Total Engineering Ltd" opens the company text.
- **S10. The Show switch can do nothing.** `expectedSetup`, `expectedLabor` and `expectedMachine` are hideable with `of: expectedTimes` (`texts/jobTraveler.ts:143-159`). With the owner hidden, the switch has no effect. Disable it then.
- **S11. Two quote charges can share an edit.** `quote/LineItemsBlock.tsx:230` keys on the description, so two "Setup" charges share one edit and the collector drops the second. Key on the `additionalCharges` key.
- **S12. Rows with null ids share an edit** (`values.ts:47` gives `line:null`). Skip the edit when the id is null.
- **S13. English-only strings in document mode.** `BlockConfig.tsx:122,125,150,180,685,689,690,338`; `BlockList.tsx:443,489,570`; `ValueEditor.tsx:94,107` concatenates a row name. Picker names (`TextConfig.tsx:162`) are English under other locales.
- **S14. Stray files.** `v0.png` to `v5.png` in the repo root are not ignored and would be swept into a commit. Delete them.
- **S15. Phones.** The pencil is opaque over the chip's label and is unreachable by keyboard (`WordInput.tsx:17,91`). A page tap focuses the field while its pane is still hidden (`TextConfig.tsx:304`, `index.tsx:186`). (**read**)
- **S16. Row-value keys go stale.** `valueEdits.rows` keys hold line ids, and `id-refs` rewrites only `documentId`, so a foreign restore or quote revision drops typed row values silently. A deleted record also leaves its `documentEdit` row behind.

## Risks / questions

- **R1. The branch is 27 commits behind `main`** and 18 changed files in `packages/documents` and the editor overlap, including `Note.tsx`, `Template.tsx` and the packing slip blocks. `db:check:backups` fails with 55 blocking changes because `main`'s manifest names tables this branch does not have yet. Re-run after merging. `packages/jobs/manifests/schema.json` still lacks `documentEdit`; the hook regenerates it on commit.
- **R2. Output changes for saved documents.** `{invoice.dateIssued}`, `{order.date}`, `{job.startDate}` and `{issue.openDate}` in saved headers, footers and terms now print localized instead of ISO (**read**). Put it in the changelog.
- **R3. Saved templates can move.** `keepSummaryWithLineItems` (`defaults.ts:715`) prints totals above notes on reprints of a template saved `[lineItems, notes, summary]`. This is the requested fix, but it changes old output.
- **R4. Not run.** The PDF at send and email; a view-only or restricted user live; a real rental line; two concurrent saves (read only: `FOR UPDATE` and the unique key serialize them, last writer wins, no version check); phones in a browser; findings marked **read**.
- **R5. Payload size.** `documentEditValidator` has no size limits, and unknown tokens and row keys are stored forever.

## Docs freshness

- `.claude/rules/document-template-customizer.md:88` still names `settings.models.ts`; the map moved to `settings.utils.ts`.
- `pdf/blocks/vars.ts:19-21`: the "must stay in sync" comment is stale, because `Record<MergeToken>` enforces it.
- Wrong comments: `context.tsx:65`, `index.tsx:214` (iframe), `DocumentEditModal.tsx:146` (Values section), `PanelSection.tsx:21-23`, `WordInput.tsx:80`.
- `BlockConfig.tsx:178-181` says "Reorder", which is false in document mode. `DocumentEditModal.tsx:209` still reserves space for the removed X.
- Move the 2026-11-04 and 2026-11-05 specs to `implemented/` once this ships.

## Verdict

**Block**, at the time of the review. B1 to B9 are correctness, permission or data-loss bugs, and B10 is why they got through. J1 to J8 delete a lot of code but need not hold the release.

## Outcomes

Decided to lock tax percent, currency and document numbers. Every finding below is fixed unless the table says otherwise. Nothing is committed.

| Item | Outcome | Proof |
|---|---|---|
| B1 | Seeded demo names replace the name in all listed lines. | `grep` over the changed files finds none. |
| B2 | Quantities carry `amount`. One check covers block and document texts. | `validate.test.ts`. A preview POST of `qtyCell: "999999"` answered 400. In the modal, the box shows the error and the page does not print the number. |
| B3 | `documentEdit` has one policy, SELECT. `getDocumentEdit` drops stored locked values. | `document-edit-authz.test.sql` runs as `authenticated`: insert refused, update and delete touch 0 rows. `edit.test.ts`. |
| B4 | The preview route needs update rights. A locked record ignores a draft. Figure problems answer 400. The template preview drops `valueEdits`. | A POST with `order.total` answered 400. A locked PO answered the same 19,575 bytes with and without a draft. |
| B5 | `salesInvoice` uses the `invoicing` module, and its read rule mirrors the table's. | SQL test: `invoicing_view` reads an invoice's edit, `sales_view` does not. Typecheck. |
| B6 | `job.methodRevision`, `item.name`, `item.trackingType`, `item.readableId` and `job.batchNumber` are `fixed`. | `validate.test.ts`. |
| B7 | The modal mounts only while open. | **Ran:** after a database change, the reopened modal showed the new title. |
| B8 | Escape and outside clicks do nothing once loaded. The sections link is hidden in document mode. Cancel stays silent, because it is an explicit choice. | **Ran:** the modal stayed open after both. |
| B9 | Failed reads throw. | Read only. No run forced a failed read. |
| B10 | Text snapshots of all 12 samples, a render-level `Note` test, flag guards, the SQL test. The tautology test is gone. | The snapshot caught a lost "Return To" heading during J1. |
| J1 | One return-order line table and parties box. `vars.ts` stays per document. | Snapshot unchanged. |
| J2 | `mergeFields.ts` holds the tables, and `LINE` defines each line field once. | Typecheck, `mergeFieldNames.test.ts`. |
| J3 | `makeTermsBlock` and `makeNotesBlock` serve 6 documents. RFQ, packing slip, traveler and issue differ and keep their own. | Snapshot unchanged. |
| J4 | `documentChrome` serves 7 drivers. Issue, job traveler, packing slip and RFQ differ and keep their stanza. | Snapshot unchanged. |
| J5 | `Cell` and `TextCell` replace 102 of 111 column checks. The RFQ table names its widths in a style map, so 8 stay, plus one with a second condition. | Snapshot unchanged. Geometry was not compared. |
| J6 | `printedEntries` is the one walk. | `valueTargets.test.ts`, `previewText.test.ts`. |
| J7 | `TokenEditor` serves all three rich-text editors. | Typecheck. |
| J8 | Dead code removed, as listed. | Typecheck, Biome. |
| S1 | Locked with `fixed`. | `validate.test.ts`. |
| S2, S3 | Record check first; read rule mirrors the record's. | POST for a missing record answered 404. SQL test. |
| S4, S9 | One value per panel; a printed word beats a partial match. | `valueTargets.test.ts`. |
| S5, S6 | Toast names the first problem, `BlockFieldErrors` shows errors with no text, `validateDocumentEdit` checks only the edit. | `edit.test.ts`. **Ran:** the toast showed the figure message. |
| S7, S8, S10, S11, S12, S15 | Fixed as listed. | Read only, except typecheck and existing tests. |
| S13 | Listed strings use Lingui, in all 12 languages (machine-written). Picker names stay English, as the default words they name print in English. | Extract and typecheck. |
| S14 | Files deleted. | `git status`. |
| S16 | Row keys follow a quote revision and a restore. A trigger on each record table removes the edit. | **Ran:** deleting a PO in a rolled-back transaction removed its edit. The key rewrites have no committed test yet. |

R1 stays open: merge `main` before release. R2 and R3 are behaviour notes for the changelog. R5 stays open.

## Second pass

A second review read the fixes above. These are its findings and what happened to each.

| Finding | Outcome | Proof |
|---|---|---|
| A stored `documentTemplate` could carry `valueEdits` and typed figures through a direct API write, so the first B3 fix left a second path open. | `toDocumentTemplate` drops `valueEdits`. `documentTemplate` has one policy, SELECT. | `edit.test.ts`. The SQL test fails on any write policy on either table. |
| The template preview printed a real record with a draft for a user with only `view: settings`. | A real record now needs `update: settings`, and the picker hides without it. | Read only. No view-only user exists locally. |
| The invoice PDF route still asked for `sales`. | It asks for `invoicing`. | Typecheck. |
| A failed edit copy on a quote revision was silent. | The user sees a warning. | Typecheck only. No run forced the failure. |
| `documentChrome`: the first pass said 4 drivers differ. | False. All 11 use it. | Snapshot unchanged. |
| Factories for Terms, Notes and return orders added generics for nothing, and keys widened to `string`. | Plain components with typed keys. One `buildReturnOrderLineVars`. | Typecheck, snapshot unchanged. |
| `textErrors` was stored and synced, and flickered on each keystroke. | `useTextErrors` derives it from the draft. The state and its clears are gone. | **Ran:** the error stayed through two keystrokes. |
| `mergeFields.ts` grew. | `value`, `figure` and `locked` helpers: 811 lines down to 501. | Typecheck, `mergeFieldNames.test.ts`, snapshot unchanged. |
| The RFQ's 8 column checks were left for a false reason. | They use `TextCell`. | Snapshot unchanged. |
| Missing tests. | Row key rewrite, restore transform, quote line pairing, a hidden column, all 5 per-page tokens, the cleanup trigger. | All pass. |
| `REVOKE` in the cleanup migration breaks the migration rule. | Removed. | `@carbon/checks`. |

**Left as they are:**

- `operation.setupTime`, `laborTime`, `machineTime`, `price.leadTime` and `quote.maxLeadTime` stay editable. The rule was "all but amounts and quantities". This needs the owner's decision.
- Picker names stay English.
- A failed read during a save or print is a generic 500. The cause is logged.
- `document-edit-authz.test.sql` runs by hand, like its siblings. No runner exists.
- R1 still stands: merge `main` before release.

## Third pass

A third review read the whole branch again, after the second pass's fixes. It changed no code. **Verdict: Block**, because of T1 to T3. Each is a small fix.

The local database and app were stopped for this pass, so nothing below ran against a live record. **Read** means proven from the code. **Ran** means measured.

### Blockers

**T1. Typed notes never reach the preview or the Download.** `TemplatePreview.tsx:68-75` and `DocumentEditModal.tsx:184-186` post no notes, `document-edit.$type.$id.preview.ts` reads only `blocks` and `settings`, and each renderer prints the notes stored on the record. So a user types new notes, the preview does not change, and Download gives a PDF with the old notes. The comment at `DocumentEditModal.tsx:179` says "Prints what is on screen, saved or not", and that is false for notes. Fix: post the draft notes, and let `renderDocumentWithEdit` print them in place of the record's. A locked record keeps ignoring them. (**read**)

**T2. Save overwrites the record's notes even when the user did not touch them.** `context.tsx:538-539` always posts `notes`, and `settings.service.ts:9389` always writes them. If someone changes the notes on the record's page while the modal is open, a Save that only renamed a heading restores the old notes with no warning. It also changes the record's `updatedAt` and `updatedBy` on every save. Fix: post `notes` only when they differ from `baseline.notes`. The server already skips them when absent. (**read**)

**T3. A failed values read replaces the whole record page with an error screen, and the draft is lost.** `document-edit.$type.$id.values.ts:45,82` throws a 500, and lines 51-52 can throw too. React Router sends a thrown fetcher loader error to the nearest route boundary (`setFetcherError`, react-router 7.18.4). The route also forces every block visible (line 67), so a block the real PDF never prints can cause it. The values only add pencils, so losing them should not stop the editor. Fix: log the failure and return `data({ data: null }, { status: 500 })`, so the editor stays open without pencils. (**read**, not forced)

### Performance

- **New cost on 11 record pages (ran).** `DocumentEditModal.tsx` imports the whole editor statically, and each record page imports the hook from that file. The editor adds **191 KB minified, 52 KB gzipped**, with React, `@carbon/react` and the other shared libraries left out. This is an esbuild measurement, not the Vite build. These pages imported no `@carbon/documents/template` directly before, and most visits never open the modal. `PreviewPages.tsx` already stays lazy for this reason. Fix: keep `useDocumentEditModal` and `EditDocumentMenuItem` in the small file, and load the modal with `lazy()` from a new one. No import in the 11 headers changes.
- **Validation per keystroke (ran).** `validateDocumentEdit` with `diffDocumentEdit`, 300 changed rows: 0.02 to 0.05 ms. No problem.
- **Edit lookup (earlier pass).** 200,000 rows, 1.0 ms under RLS. Not re-run.
- **Opening the modal renders the PDF twice.** Still open, and still an estimate of about 7 s of server CPU on a 300-line document.

### Simplification

- **J9. The preview and values routes repeat one guard.** `document-edit.$type.$id.preview.ts:36-55` and `document-edit.$type.$id.values.ts:28-47` both check the type, permission, record read, log and 404. Extract `requireDocumentEditRecord(request, params)`.
- **J10. `documentEditViewPermissions` is a second gate that nothing reaches.** `settings.utils.ts:172` gives the modal's loader `view`, but the menu item, the values route and the preview route all need `update`. Its comment, "Opening the editor needs view permission", is misleading. Delete it and use `documentEditPermissions`.
- **J11. One list of variables is built in 6 places.** `edit.ts:238`, `validate.ts:122,254`, `valueTargets.ts:45`, `ValueEditor.tsx:47` and `TextConfig.tsx:118` all join `getMergeFields` and `getLineMergeFields`. Two of them, plus `valueTargets.ts` in reverse, work out which values can change. Add `allMergeFields(type)` and `lockedTokens(type)`.
- **J12, optional. `renderDocumentWithEdit` is a 130-line switch.** The 11 renderers differ only in the name of their id argument and whether they return a `Response`. Giving them one shape makes the switch a table, but it also touches about 20 callers, so it can wait.

### Risks and questions

- **The database was stopped.** The cost of the delete trigger is unmeasured. It does one index lookup per deleted row (**read**). The generated types confirm that all 10 notes columns are JSON and that the record tables have `status`, `updatedBy` and `updatedAt`.
- **No automated test covers the save path.** No test mentions `saveDocumentEdit`, `DocumentEditModal`, `draftProblems` or `useTextErrors`. Removing the save's lock check, the preview's locked branch or a fix for T2 would fail no test. The lock has only been checked by hand.
- **Two people editing one document:** the last save wins with no warning. The template editor has `useTemplateConflict` for this, and document mode does not use it.
- **Decision, now wider.** Setup, labor and machine times and lead times are editable, and so are dates such as `invoice.dateDue` (`mergeFields.ts:66`), a date a customer pays by. The rule "all but amounts and quantities" allows this.
- **Still open:** merge `main` (R1), the not-run list (R4), payload limits (R5), and English names in the picker.

### Suggested improvements

- **The lock message is wrong for most documents.** "Locked: this document was sent." (`DocumentEditModal.tsx:218`, from the spec) also shows for a completed job, a closed issue and a posted shipment. Use "Locked: this record can no longer change."
- **Download errors are raw English.** `preview.ts:75` returns the API wording, with `{tokens}`, into a toast. Check `draftProblems` before the request, as Save does.
- **The preview goes stale silently.** `TemplatePreview.tsx:81` returns on a failed response and keeps the old pages with no message. This existed before the branch.
- **Fold the unshipped migrations.** `documentEdit` is not on `main`, yet `20261104144747` creates write policies that `20261105135214` drops. Fold them before merging, so `main` never holds a table that briefly accepted direct writes.

### Docs freshness

- `.claude/rules/document-template-customizer.md:28` still says `settings_create/update/delete` gate `documentTemplate`. It now has SELECT only.
- The same file at line 124 gives `getDocumentTemplate` as the file routes' path. They now go through `getPrintedTemplate`.
- `.ai/specs/2026-11-04-per-document-edits.md:64,71,126` says invoices need `sales` and that notes are a separate call. Invoices now need `invoicing`, and notes save in one transaction with the edit.
- Move the three specs to `.ai/specs/implemented/` when this ships.

### Passes with nothing to report

- **Tenant scoping:** both routes read the record with the caller's client and the session's company, and the system writes filter on `companyId`.
- **Deploy safety:** dropping the `documentTemplate` write policies is safe for old pods, because the save on `main` already writes through `ctx.asSystem.pg`.
- **Rendering paths:** every caller of the 11 renderers goes through the same edit read. Each file route's permission I checked is one the `documentEdit` read rule accepts.
- **Stray content:** no customer names, debug code or stray files.

### Third pass outcomes

| Finding | Outcome | Proof |
|---|---|---|
| T1: typed notes missing from the preview and Download | The preview and Download post changed notes, and all 10 Notes blocks print them through `printedNotes`. A locked record ignores them. | **Ran:** typed notes appeared in the preview and the Download request, and the record stayed unchanged. A test prints the draft notes on all 10 documents, and it fails when the fix is removed from the packing slip. |
| T2: Save overwrites untouched notes | Notes are posted only when changed (`changedNotes`). | **Ran:** changed the notes in the database with the modal open, then saved a word. The notes stayed and `updatedAt` did not move. `context.test.ts` covers the rule. |
| T3: failed values read replaces the page | The modal reads the values with a plain `fetch`. | **Ran:** with a forced 500 the page and modal stay, with no pencils. Without it, pencils show. The server failing by itself was not forced. |
| Editor loaded on 11 record pages | `DocumentEditModal.tsx` is now the hook and menu item, and it loads `DocumentEditModalContent.tsx` lazily. | **Ran:** esbuild, 52 KB gzipped on the page down to 0.5 KB; the editor is its own 52 KB chunk. The Vite build was not measured. The modal opened from the lazy chunk in the running app. |
| J9, duplicate route guard | `requireDocumentEditRecord`. | Typecheck. Both routes ran. |
| J10, second gate | `documentEditViewPermissions` deleted. | Typecheck. The modal opened. |
| J11, one list in 6 places | `allMergeFields` and `lockedTokens`. | Typecheck, snapshot unchanged. |
| Lock message | "Locked: this record can no longer change.", in all 13 languages. The 12 translations are machine-written. | **Ran:** shown on a locked purchase order. |
| Download errors in raw English | Download refuses with `refuseDraft`, as Save does. | **Ran:** "Unknown variable {nonsense}" in a toast. Fourth pass: this message is marked for translation but has no translations yet. |
| Stale docs | The rule, the spec and a new lesson. | Read. |

**Left as they are:**

- **J12, the renderer switch.** Optional, and it touches about 20 callers.
- **The preview going stale silently.** It existed before this branch, and it is a separate change.
- **Folding the unshipped migrations.** Local databases have them applied, so folding needs a database rebuild. It should happen just before the merge, with approval.
- **Automated tests for the save's lock check and the preview's locked branch.** The repo has no way to test these operations with a real database, so they remain checked by hand.
- **The decision** on times, lead times and due dates, and everything under "Still open" above.

## Fourth pass

A fourth review read the third pass's fixes and ran the items that had stayed on the "not run" list, with the app running. It changed no product code. **Verdict: Block**, because of F1, a loss of saved text. The fix is small. Everything else passed or is minor.

### Blocker

**F1, fixed below. After a modal save, typing in the page's Notes box erases the notes just saved.** `SupplierInteractionNotes.tsx:52-55` copies the notes into `useState` once, and the box writes straight to the record on change (`:63-66`). So after a modal Save, the page keeps the old notes on screen, and the next keystroke there saves old text plus the new word over the modal's notes. (**ran**, on a purchase order: saved "Saved from modal QA" in the modal, the page still showed nothing, typed "Typed on page", and the database then held only "Typed on page".) `ShipmentNotes.tsx` and `OpportunityNotes.tsx` use the same pattern (**read**); the other record pages were not checked. The repo's own rule warns against this copy (`no-state-copy-of-loader-data`), but it predates this branch. The modal is what now makes it lose data.

Fix: when a Save changed the notes, reload the page with `navigate(0)` from `useDocumentEditModal`'s `onSaved`. That is one change for all 10 documents, and it runs only for a Save that changed the notes. Keying each Notes box on its text is worse, because the page's own save would then remount the box while the user types.

### Suggested improvements

- **F2. Four new messages have no translation in any of the 12 languages.** "Amounts and quantities can't be changed on one document.", "Unknown variable {variable}", "This text can't be hidden" and "This text is not part of this document" have an empty `msgstr`, so they show in English. The other 179 messages this branch added are filled in. (**ran:** a script compared every new message with each catalog.) The third pass's outcome table wrongly implied these were translated, and that line is now corrected.
- **F3. On a phone, tapping a word opens its panel but does not put the caret in the field.** Focus stays on the dialog. The same click on desktop does focus the field, and the comment at `TextConfig.tsx` says the phone case is handled. (**ran**, in a phone-sized browser with a mouse click, so a real phone may differ. Cause not traced.)
- **F4. A failed chunk load has no handler.** A tab left open across a deploy that clicks "Edit document" fails its dynamic import, and the page shows the route's error screen. No draft is at risk at that moment, and the app's 10 other `lazy()` calls behave the same way (**read:** no `vite:preloadError` or chunk-error handling found). Not run.

### Performance

- **Delete trigger (ran, rolled back).** Deleting 10,000 stock transfers with 210,000 `documentEdit` rows: `delete_document_edit` took 77 ms in total, about 0.008 ms per row, out of 287 ms for the whole delete. No row was left behind.

### Checks that passed

| Check | Result |
|---|---|
| Variables compared with `main`, per document | None removed from any of the 12 documents, so saved templates keep working. **Ran.** |
| Saved edit in the real PDF route | Prints the edit. **Ran.** |
| PDF saved at send | Finalized a purchase order. The stored PDF carries the edit. **Ran.** |
| Failed read of the edits | Renamed the table: the PDF route answers 500 and prints nothing. **Ran**, then restored. |
| Save on a locked record | Refused with "This document is locked." Words and notes unchanged. **Ran.** |
| Preview on a locked record | Answers 200 and ignores a posted draft and notes. **Ran.** |
| View-only user | No menu item. Save is refused as forbidden. Values, preview and the template preview on a real record redirect. The PDF still opens, which is correct. **Ran**, then rights restored. The modal's loader answers 200, and its body was not captured; the code returns the same forbidden error as Save (**read**). |
| Four saves at once | All answer 200, one row remains, and the last write wins. **Ran.** |
| Phone width (390 px) | Bottom sheet, no sideways scroll, Download and Save on screen, tabs work, the pencil's popover stays on screen. Tapping outside and Escape keep the editor open. **Ran**, in a browser. |

**Not run:** the email attachment, a real rental line, a real phone.

**Local test data:** the test purchase order is back to Draft with its edit and empty notes restored, and the test PDF is deleted. The finalize may have written other local rows, which were not checked. Any app restart may repeat a port mismatch seen in `crbn up`: the containers came up on the old ports until they were recreated. Its cause was not found.

### Fourth pass outcome

**F1, fixed.** A Save that changed the notes reloads the page (`navigate(0)`, `DocumentEditModalContent.tsx`). A Save that did not change them just closes the modal. Run on one purchase order; the other record pages were not run, but the fix does not depend on the page. The "Saved this document" message does not survive the reload, so the new notes on the page are the only confirmation. No automated test covers this, because the repo has no browser tests for the modal.

F2 to F4 are still open.

**The `WordInput` field and the Notes and Terms editors** had a gray fill and a heavy focus ring that no other input uses. They now match the standard `Input`: transparent, with a thin border and a soft focus ring. A field with an error keeps its red border while focused.

## Fifth pass

A fifth review read the whole branch after the merge of `main`. **Verdict: Block**, at the time of the review. The findings below are fixed unless the table says otherwise.

| Finding | Outcome | Proof |
|---|---|---|
| Words could replace a locked value: a tax text of `0%` or a document number of `INV-TYPED-999` passed validation. | **Kept.** The pencil stays off these values, and the words holding them can be retyped. The spec and rule now say so. | **Ran:** validation returned no problems. |
| A digit against a figure passed validation: `1{line.quantity}` would print 15 for 5. | Refused as `amountChanged`, in a template and on one document, and a preview refuses it too. Translated into all 12 languages (machine-written). | `validate.test.ts`. A test also finds no default text that breaks the rule. |
| A revision and its edits saved separately, and pairing lines by their contents lost changed values on identical lines. | `copyDocumentEdit` runs inside the `quoteToQuote` transaction, using the line map built there. `pairCopiedQuoteLines` and the `documentEditsCopied` warning are gone, and `copyQuote` matches `main` again. | `document-edit.test.ts`, on the local database. |
| Nothing tested the save's lock or the preview's locked branch. | Both are tested. The third pass said the repo could not test this with a real database. That was wrong: `apps/erp/test/database` does. | **Ran:** removing the lock check and removing the locked branch each failed one test. Both were then restored. |
| `getPrintedTemplate` took `null` to mean "the company template alone". | `getCompanyTemplate`. | Typecheck. |
| The download rewrote a header the modal never reads. | Removed. | Typecheck. Not run in a browser. |
| The lock was checked twice, and a missing record reported as locked. | One check, in the transaction. `saveDocumentEditRow` answers `saved`, `locked` or `notFound`. | `document-edit.test.ts`. |
| A traveler's title and footer words printed blank for most variables. | They read the same variables as the page body. | Typecheck, snapshot unchanged. Not run with such a variable. |
| `const resolved = templateConfig` aliases, a cast on `draftNotes`, and copies of `jsonb`. | Removed or typed. The document edit functions moved to `settings/document-edit.service.ts`, which also keeps `production.service.ts` from importing `settings.service.ts`. | Typecheck, snapshot unchanged. |
| A migration created write policies that a later one dropped. | Folded: the table and its cleanup trigger are one migration, and the generated read-only policy is the only policy. The two migrations stay separate because a policy may only ship in a generated migration. | **Ran:** rebuilt the table from the files in a rolled-back transaction: 11 triggers and one SELECT policy. `document-edit-authz.test.sql` passes. |

**Left as they are:**

- `document-edit-authz.test.sql` is not in CI. CI has no database, and none of the 39 SQL tests there run in it. The new database tests also skip without a local database, so only the preview test and the validation tests run in CI.
- The risks under the third pass's "Still open", and the deploy order between `supabase.yml` and `build-images.yml`.

`main` was then merged. Its supplier part ID on purchase orders now prints from the catalog (`supplierPartCell`, `{line.supplierPartId}`), so it can be edited like any other text. The line description reads the item ID directly, because `getLineDescription` now adds the supplier number for emails. The text snapshot gained only the supplier part line.

F2 from the fourth pass is fixed: the 4 messages it named, and 2 more variable names, now have translations in all 12 languages (machine-written).
