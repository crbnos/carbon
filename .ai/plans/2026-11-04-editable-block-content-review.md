# Review: editable block content (`feat/document-editor-edits`)

This is a strict review of the uncommitted diff against `origin/main` (HEAD), plus the untracked files.
The review changed no source file. Typecheck, Biome and vitest did not run, because of the memory limit.
Two small `tsx` probes ran against the package source. Their output is quoted where a finding uses it.
Each finding was checked again in the code before it went into this file.

---

## Blockers

### B1. A Stock Transfer, Job Traveler or Issue template cannot be saved with an edited footer

- `saveDocumentTemplate` reads the footer section. It checks the footer's `registrationNumber` against the variables of the document type (`apps/erp/app/modules/settings/settings.server.ts:1546-1571`).
- The footer modal writes `DEFAULT_FOOTER_OPTIONS` into every footer section a user saves (`SectionFormModal.tsx:93-96`, `118`).
- That default is `"{company.registrationNumber}"` (`packages/documents/src/template/schema.ts:294-299`).
- `STOCK_TRANSFER_MERGE_FIELDS` (`merge.ts:230`), `JOB_TRAVELER_MERGE_FIELDS` (`merge.ts:239`) and `ISSUE_MERGE_FIELDS` (`merge.ts:251`) have only the company name, city and country.
- These 3 types do not print the registration line at all. `REGISTRATION_LINE_DOCUMENT_TYPES` excludes them (`schema.ts:429-438`).
- Proof. A tsx probe called `validateTemplateText` with the default registration number as the extra text:
  ```
  stockTransfer ["Footer › Registration number: unknown variable {company.registrationNumber}"]
  jobTraveler   ["Footer › Registration number: unknown variable {company.registrationNumber}"]
  issue         ["Footer › Registration number: unknown variable {company.registrationNumber}"]
  salesInvoice  []
  ```
- The check is also in the wrong place. `saveDocumentSection` writes the registration line and validates nothing, so a bad line is still writable.
- The client check (`context.tsx:377`) never sees the footer. The user gets a server toast that the template editor cannot fix.

Fix (it is also a simplification):

1. Delete the footer read in `saveDocumentTemplate` (`settings.server.ts:1544-1563`).
2. Delete the `extraTexts` parameter of `validateTemplateText` (`validate.ts:96`, `185-187`) and its test case (`validate.test.ts`, last case).
3. In `saveDocumentSection`, validate `registrationNumber` against `COMPANY_MERGE_FIELDS`. The modal offers exactly that list (`SectionFormModal.tsx:227`).

This also removes one DB read from each template save.

### B2. "Reset all text" in the header or footer panel deletes every document text

- `DocumentTextConfig` shows only some rows (`only` / `except`, `TextConfig.tsx:40-52`).
- But it passes all of `settings.text` and `settings.hidden` as `stored` (`TextConfig.tsx:58`).
- `changed` counts all keys (`TextConfig.tsx:80`).
- The Reset button calls `onChange({ text: undefined, hidden: undefined })` (`TextConfig.tsx:106-109`). That sets both settings to `undefined` (`TextConfig.tsx:59-62`).
- Example: a user changes "Page" to "Seite" in the footer panel. The header panel shows only the title, but it now shows "Reset all text" too. A click there also resets the footer words, the materials columns and their hidden state.

Fix: compute `changed` and `hidden` over the rows that the panel shows. Reset only those keys. J2 removes the split panel, which also removes this bug.

### B3. The "Show" switch on the purchase return's "Supplier RMA #:" does nothing

- The catalog makes `supplierRmaNumber` a `field` in the `document` entry (`texts/purchaseReturnOrder.ts:11`).
- So the footer panel shows a Show switch for it, and `validateTemplateText` accepts it in `hidden` (`validate.ts:174-183`).
- The driver reads only the label (`PurchaseReturnOrderPDF.tsx:84`). The header prints it with no check (`blocks/purchaseReturnOrder/HeaderBlock.tsx:17`).
- `rg '\.shows\(' packages/documents/src/pdf/*PDF.tsx` finds no match.
- The user edits this text in the footer panel, but the PDF prints it in the header.

Fix: gate it with `dt.shows("supplierRmaNumber")`, or make it `kind: "text"`. J2 is the better fix.

### B4. The tracking label offers `company.*` variables, and the ZPL prints them empty

- The diff adds `company.name`, `company.city` and `company.country` to `TRACKING_LABEL_MERGE_FIELDS` (`merge.ts:262-276`). The variable menu now offers them on label blocks.
- The ZPL's `labelVars` calls `buildLabelVars(item)` with no company (`zpl/ProductLabelZPL.tsx:15-17`). Its own comment says that the `company.*` tokens print empty.
- The PDF passes the company (`ProductLabelPDF.tsx:134`).
- So `{company.name}` prints on the PDF label and is blank on the Zebra label. This breaks spec goal 6: "The tracking label PDF and its ZPL print the same texts."
- Each ZPL caller already has the company, because it builds the logo from it. An example is the print job (`packages/jobs/src/inngest/functions/tasks/print-job/renderers.tsx:140-165`).

Fix:

1. Delete the `labelVars` wrapper.
2. Add a `company` argument to `generateProductLabelZPL`.
3. Call `buildLabelVars(item, company)`.

The other fix is to remove `company.*` from the tracking label catalog.

### B5. The editor labels are the English defaults, so rows clash and messages are not translated

- Each row's label is `entry.default` (`TextConfig.tsx:172-173`). The validation messages use it too (`validate.ts:131`, `141`).
- A tsx probe over `TEXT_CATALOG` found 7 duplicate labels inside one panel:
  ```
  purchaseOrder.parties: "VAT:" -> supplierVat, companyVat
  purchaseOrder.parties: "EORI:" -> supplierEori, companyEori
  purchaseOrder.parties: "Contact:" -> supplierContact, buyerContact
  purchaseOrder.parties: "Email:" -> supplierEmail, buyerEmail
  quote.lineItems: "Tax & Fees" -> columnTaxAndFees, lineTaxAndFees
  packingSlip.lineItems: "Description" -> description, rentalDescription
  packingSlip.lineItems: "Qty" -> qty, rentalQty
  ```
- Acceptance criterion 3 says "turn off Show for EORI:". The PO Parties panel has 2 "EORI:" rows, so the criterion is ambiguous.
- The message "Parties › VAT: unknown variable …" does not say which VAT.
- Spec §1 makes the catalog the single source for the editor labels. Spec §6.7 says that all new editor copy uses Lingui.
- The `validate.ts` messages (`unknown variable`, `unknown text`, `cannot be hidden`) are English literals. The editor shows them as they are (`TextConfig.tsx:189`, `context.tsx:401`).

Fix:

1. Make `validateTemplateText` return structured problems: `{ blockId, field, code, token }`.
2. Let the editor write each message with Lingui.
3. Give each catalog entry a label that tells it apart, or a group such as Supplier and Company. The editor shows it through Lingui.
4. Keep `default` for the printed text only.

---

## Code-judo / simplification

### J1. Render each table from one column list (the largest win)

- Each table writes every column twice, as `w.key ? (<cell style={{ width: w.key }}>) : null`. One copy is in the header, one is in the row.
- `rg -c 'w\.[a-zA-Z]+'` counts: PO 36, invoice 22, quote 24, packing slip 24, purchase return 21, sales return 21, stock transfer 16, sales order 16, RFQ 12, traveler operations 12.
- PO line items grew from 210 to 302 lines. The quote grew from 347 to 410. The invoice grew from 226 to 280.

Do this instead:

1. Give each table one array of `{ key, width, align, cell: (line) => ReactNode }`.
2. Map the visible columns once for the header, with `t(key)`.
3. Map them once per row, with `cell(line)`.

The ternaries go away. The header and the row can no longer drift apart.

Also make the grow column (`description`, `operation`, `materialsDescription`) not hideable:

- This deletes the fallback branch of `columnWidths` (`pdf/blocks/columns.ts:19-21`) and its third test (`columns.test.ts:28-33`).
- It also stops a real data loss. The invoice description cell holds the line's Tax & Fees rows and the thumbnail (`pdf/blocks/LineItemsBlock.tsx:142-205`). If a user hides "Description", every line loses its shipping, add-on and tax amounts.

### J2. Move the texts that print in the header to the `header` block

- `title`, `salesOrderPrefix` (`texts/jobTraveler.ts:10-12`) and `supplierRmaNumber` (`texts/purchaseReturnOrder.ts:11`) print in the header block. The catalog keeps them in the `document` entry.
- That choice caused 3 extra parts:
  - the `only` / `except` filter of `DocumentTextConfig` (`TextConfig.tsx:40-52`, used at `BlockConfig.tsx:119` and `180`);
  - the title branch in `save()` (`context.tsx:393-399`);
  - a `documentTitle` field on all 12 data bags (`blocks/*/types.ts`), plus `salesOrderPrefix` and `supplierRmaLabel`.
- Put them in `<doc>Texts.header`. Then each `HeaderBlock` calls `makeText` like every other block.
- The driver reads the title for the PDF metadata from the header block. `resolveTemplate` always keeps that block (`defaults.ts:686-691`).
- `document` then keeps only the footer words, "Issue #" and the materials table. B2 and B3 go away with this change.

### J3. `validateTemplateText` runs the same check twice

- The block loop (`validate.ts:119-155`) and the settings loop (`validate.ts:158-183`) do the same 3 checks: unknown key, unknown variable, not hideable.
- Merge them into one `checkStored(id, label, entries, stored)`. Call it once per block and once for `settings`.
- About 25 lines go away, and the 2 message formats can no longer drift apart.

### J4. 6 catalog files copy the same entries

- `{ notes, none }` is in 6 files. The "Terms & Conditions" heading is in 6 files (`rg -c` over `texts/*.ts`).
- `shared.ts` already holds `FOOTER_TEXTS`. Add `NOTES_TEXTS` and `TERMS_TEXTS` there, and spread them like `FOOTER_TEXTS`.

### J5. 99 copies of the same "label: value" line

- The pattern `t.shows(k) && value ? <Text>{t(k)} {value}</Text> : null` occurs 99 times (`rg -c 't\.shows\('`).
- The biggest counts are PO parties 19, invoice parties 13, traveler details 12, quote 11 and sales order 11.
- Use one `<FieldLine t={t} k="taxId" value={…} />`, or a `t.line(k, value)` helper.
- The helper also fixes the leading space that an empty label prints (see Risks).

### J6. Small deletions

- `labelVars` is now a one-line wrapper (`zpl/ProductLabelZPL.tsx:15-17`). Call `buildLabelVars` directly (see B4).
- `StoredText` has 2 identical declarations (`texts/index.ts:37`, `TextConfig.tsx:15`). Export it once.
- `JobTravelerPageContent` builds the same `makeText` twice: in `buildData` (`JobTravelerPDF.tsx:68`) and at `JobTravelerPDF.tsx:107`. Return it from `buildData`.
- `Summary.tsx:66-72` adds "Phone:", "Email:" and "Website:" defaults and 3 `!== null` branches.
  Its only caller (`stockTransfer/DetailsBlock.tsx:52-59`) always passes all 3. The defaults are dead copies of the catalog.
- No driver reads `PDF.title` now (`packages/documents/src/types.ts:23`). An `rg` over `pdf/*.tsx` confirms it.
  - Remove the field, and remove `"title"` from the `Omit` in `JobTravelerPDF.tsx:56`.
  - Then a stray `title=` is a type error, not a silent no-op.
  - An `rg` over `apps` and `packages` found no caller of the 12 drivers that still passes `title`.
- There is a circular import. `texts/index.ts:93` re-exports `./validate`, and `validate.ts:9` imports `getTextEntries` and `isHideable` from `./index`.
  Move `makeText`, `TEXT_CATALOG`, `getTextEntries` and `isHideable` to `texts/catalog.ts`. Let `index.ts` only re-export.
- All 12 drivers repeat `footerText={{ pageLabel: dt("page"), ofLabel: dt("of") }}` (for example `SalesInvoicePDF.tsx:165`).
  Let `Template` take `text={dt}` and read the 2 words itself.
- Optional: spec D6 keeps `options.taxLabel` outside the catalog.
  - So 4 summary blocks copy `taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel` (`rg` count 4).
  - `authoredTexts` needs its own branch for it (`validate.ts:66-73`).
  - `resolveTemplate` already normalizes stored rows when it reads them (`defaults.ts:643`). It can map `options.taxLabel` to `text.tax` with no data migration.
  - That deletes the 4 copies and the branch.

---

## Performance

- `makeText` builds a `Map` of fewer than 30 entries per block render. It interpolates once per `t()` call (`texts/index.ts:51-64`).
  This cost is small next to the react-pdf layout. Rendering makes no DB call. A template with no changes costs one Map per block.
- The stock transfer calls `t("any")` 2 times inside the sort comparator, which gives O(n log n) interpolations (`stockTransfer/LineItemsBlock.tsx`, the `.sort` callback).
  Move it out of the sort: `const any = t("any")`.
- A save with a footer makes one extra `resolveSections` read (`settings.server.ts:1549`). The header has its own read (`settings.server.ts:1581`).
  The B1 fix removes the extra read. If the read stays, merge both ids into one call.

---

## Risks / questions

- **Not run:** typecheck, Biome and vitest did not run. So the compiler did not confirm the type-level claims:
  - each `vars.ts` builder returns `Record<MergeToken<doc>, string>`;
  - `columnWidths` catches a column key typo through `t.shows`;
  - `TextFn` catches a wrong key.
- **Invoice PDF metadata title:** the title changes from "Sales Invoice" to "Invoice".
  - `packages/lib/src/sales-invoice-document.server.tsx` no longer passes `title: "Sales Invoice"`. The catalog default is "Invoice" (`texts/salesInvoice.ts:10`).
  - The printed header already said "Invoice" (`git show HEAD:…/blocks/HeaderBlock.tsx:12`).
  - Only `<Document title>` changes. Is that intended?
- **PO summary:** for a template with no tax label, the fallback changes from "Tax" to "Taxes". Spec §7 intends this.
- **ERP job traveler render:** `production.pdf.tsx:282-285` builds only 2 of the 9 job variables by hand.
  - The diff now uses those variables for the title and the footer words (`production.pdf.tsx:291-292`).
  - The header uses all 9, through `buildJobTravelerVars` (`JobTravelerPDF.tsx:67`).
  - So a title such as `Traveler {job.dueDate}` shows the date in the header, but a blank in the metadata and the footer.
  - Use `buildJobTravelerVars` there. This review did not check that the package exports it publicly.
- **Rolling deploy:** an old server parses `blockSchema` without `text` and `hidden`, so zod strips them. If a save reaches an old instance, the user's changes are lost.
  New code that reads an old row prints the defaults. `resolveTemplate` spreads `settings` (`defaults.ts:656-657`) and keeps the stored blocks as they are (`defaults.ts:693-700`). No migration is needed.
- **MCP digest:** in `tool-manifest.digest.json`, 2 hashes changed: the input schema of `saveDocumentTemplate` and the response of `getDocumentTemplateConfig`.
  Both come from `blockSchema` and `documentSettingsSchema`, which gained `text` and `hidden`. The change is expected, not an accident.
- **Old templates with a stray `{word}`:** a template whose rich text, terms or key-value rows hold such a token cannot be saved until the user fixes it (spec D7).
  For those fields, the editor shows the error only as a toast and a block selection. Only `TextConfig.tsx:79` reads `textErrors`.
  The rule doc says "shows the error under the row". That is true only for catalog texts.
- **ZPL barcodes:** `zplBarcode` still writes `^FD${value}` with no escape (`ProductLabelZPL.tsx:31-41`). The `value` is template text that the user wrote.
- **Text fragments with leading or trailing spaces:** the probe found 5 (`" by "`, `", quoting reference "`, `"SO# "`, `" Number:"`, `"Supplier "`).
  A user can easily lose those spaces in a plain input. The fragments also fix the word order, which blocks a per-language template (slice 2).
- **Empty label:** an emptied `field` label prints the value with a leading space (" value").
- **No size limit:** the schema puts no limit on `text` keys or values (`schema.ts:20-23`, `402-405`). The API and the MCP tool can reach this.
- **Literal left in a block:** `CustomFieldBlock.tsx:10-11` prints "Yes" and "No". Should these stay outside the catalog?
- **Security / tenant isolation:** no issue found.
  - The footer read uses `ctx.asCaller.supabase` (RLS) and `ctx.company.id` (`settings.server.ts:1549`).
  - `resolveSections` filters by `companyId` (`settings.service.ts:1161`).
  - The permission is the same as before: `{ update: "settings" }`.
- **Concurrency:** the footer read runs before the upsert transaction, outside it. A footer edit at the same time can make the check stale. The B1 fix removes the read.

### Assumptions audit

| Assumption | Evidence |
|---|---|
| `resolveTemplate` keeps `block.text/hidden` and `settings.text/hidden` | `defaults.ts:630-635` (no-op migrate), `656-657`, `693-700` |
| Both save parses keep `text/hidden` | every block schema spreads `baseFields` (`schema.ts:32`, `95…248`); `documentTemplateValidator` uses `blockSchema` and `documentSettingsSchema` (`settings.models.ts:903-907`); the `saveDocumentTemplate` input uses the same schemas (`settings.server.ts:1531-1536`) |
| The preview passes `settings.text` | `$type.preview.tsx:46-50`, `127` |
| Each render path passes the stored template | invoices: `loadSalesInvoiceDocument` (`sales-invoice-document.server.tsx:248`, `368`), which auto-invoice calls (`automate-invoice.ts:551`); print queue (`renderers.tsx:154`, `87`, `94`); issue file route (`issue+/$id[.]pdf.tsx:210`); MES labels (`$id.labels[.]pdf.tsx:89`) |
| No caller still passes `title` | `rg` over the JSX callers of the 12 drivers: no `title=` |
| Error keys `${blockId}:${field}` match | `context.tsx` writes `${problem.blockId}:${problem.field}`; `TextConfig.tsx:122` reads `${errorPrefix}:${entry.key}`, with the prefix `block.id` or `"document"`, as `validate.ts` emits |
| Each catalog key is used | a script compared `texts/*.ts` with `pdf/blocks/<doc>` and the drivers: no unused key |

---

## Suggested improvements

- Add a test: each `DEFAULT_TEMPLATES[type]` passes `validateTemplateText`, with a footer that holds `DEFAULT_REGISTRATION_NUMBER`. That test catches B1.
- Add a test: a hidden column removes the header cell and the row cells together. After J1, test the column map.
- If the user types the default back, store nothing. In `setText` (`TextConfig.tsx:83-90`), delete the key when `value === entry.default`. Then a later change to the default still reaches that template.
- Rename the `kind` prop of `PackingSlipPDF` (`PackingSlipPDF.tsx:47`) to the thing it decides, for example `slipType`. This follows the "never `kind`" naming rule (`.claude/rules/conventions-database.md:87`).
- `getMergeFields(documentType: string)` keeps a cast (`merge.ts:297-300`). Type the parameter as `DocumentTemplateType` and drop the cast.
- Run `/translate`. The new msgids have an empty `msgstr` in each locale, for example "Reset all text" and "Text" in `de/erp.po`.

### Test realism

- `texts.test.ts`, `validate.test.ts` and `columns.test.ts` test new modules. A revert makes them fail at once.
- The `template.test.ts` additions fail on a revert, because zod would strip `text` and `hidden`.
- The `productLabelZPL.test.ts` additions fail on a revert. The old code wrote `^FD${text}^FS` and `${block.label}: ${value}` (`git diff zpl/ProductLabelZPL.tsx`).
- Gaps: no test renders a hidden field or column, no test covers document-level `hidden`, and no test runs over all default templates.

### Structure checks

- No file went past 1000 lines. `settings.server.ts` had 3402 lines before and has 3438 now. The next biggest changed file is `BlockConfig.tsx`, with 754.
- `columnWidths` duplicates no existing helper. An `rg` for width helpers in `documents`, `printing` and `utils` found only label geometry.

---

## Docs freshness

- `.claude/rules/document-template-customizer.md:109-110` says that each registry is "`Record<DocumentBlockType, BlockRenderer>` — must key every block type; unused → `() => null`".
  That is now false. The invoice registry is `Partial` and spreads `extensionBlocks` (`pdf/blocks/registry.tsx:24-27`). Every other non-label registry is `Partial` too (`rg 'Partial<' pdf/blocks/*/registry.tsx`).
- The same rule says that the type enum has 9 types. It has 12 (`schema.ts:409-422`). This was already wrong before the branch. Fix it in the same edit.
- The rule's Save guard bullet says that the editor "shows the error under the row". That is true only for catalog texts (see Risks).
- The spec still names `template/texts.ts` and a `blockText(...)` helper (§1, §3, §5). The code has a `template/texts/` folder and `makeText`. The spec changelog does not record the rename.
- `packages/documents/AGENTS.md`: the new "Never print a label as a literal" line is correct.

---

## TLDR

- B1: a Stock Transfer, Job Traveler or Issue template with an edited footer cannot be saved. Move the check to `saveDocumentSection`.
- B2: "Reset all text" in the header or footer panel deletes all document texts, not only the shown ones.
- B3: the purchase return "Supplier RMA #:" Show switch does nothing, and the user edits it in the wrong panel.
- B4: the tracking label offers `company.*`, and the ZPL prints it empty. Pass the company to the ZPL.
- B5: editor labels and messages are English defaults: duplicate rows ("VAT:" ×2, "EORI:" ×2) and untranslated messages.
- J1: render each table from one column list (about 190 ternaries). Make the grow column unhideable, which stops the tax-row loss.
- J2: move the header texts to the `header` block. This deletes `only`/`except`, the `save()` title branch and 12 `documentTitle` fields.
- J3: merge the block loop and the settings loop of `validateTemplateText`.
- J4: add `NOTES_TEXTS` and `TERMS_TEXTS` to `shared.ts`.
- J5: one `FieldLine` helper for the 99 label/value gates.
- J6: delete the `labelVars` wrapper, the second `StoredText`, the double `makeText`, the dead `Summary` defaults, `PDF.title` and the circular import.
- Performance: small. Move `t("any")` out of the sort, and drop the extra footer read.
- Risks: invoice metadata title, ERP traveler variables, rolling-deploy stripping, unescaped ZPL barcodes, space-sensitive fragments, no size limit.
- Docs: the registry rule, the enum count, the error-placement claim and the spec names are out of date.

## Verdict

**Block.** There are 5 correctness bugs, and B1 breaks saving on 3 document types. J1 and J2 are large simplifications that the branch does not take.

---

## Blocker fixes (2026-11-04)

Nothing is committed, so no commit SHA is given. Each fix was checked in the running app (localhost mode) and by the checks named below.

| Blocker | Status | Fix | Proof |
|---|---|---|---|
| B1 | Fixed | `saveDocumentTemplate` no longer reads the footer, and `validateTemplateText` lost its `extraTexts` parameter. `saveDocumentSection` checks the registration number against `COMPANY_MERGE_FIELDS` with the new `unknownVariables`. | A Job Traveler template saved after the footer section was saved with `{company.registrationNumber}`. A footer saved with `{company.nope}` was refused, and the stored row did not change. |
| B2 | Fixed | `DocumentTextConfig` reads and replaces only its own keys of `settings.text` and `settings.hidden`. | "Reset all text" in the footer panel removed "Seite" and "von". The title "Buy Order" stayed. |
| B3 | Fixed | The document entry `supplierRmaNumber` is `kind: "text"`, so it has no Show switch. The Parties row with the same key stays a hideable `field`. | Catalog sanity test and type check. |
| B4 | Fixed | `generateProductLabelZPL` takes a `company` argument and calls `buildLabelVars(item, company)`. The `labelVars` wrapper is gone. `getCompanyLogoForLabel` (ERP and MES) and the print job's `loadProductLabelContext` read the name, city and country in the query they already made. All 8 ZPL callers pass it. | A label text "Made by {company.name}" printed the company name in both the ZPL and the PDF. |
| B5 | Fixed | `TextEntry.section` tags the 12 rows that share a default with a sibling. The editor shows the tag translated. `TextProblem` has `code` and `token`, and the editor writes its messages with Lingui. API and MCP callers keep the English `message`. | The PO Parties panel showed "VAT: · Supplier" and "VAT: · Your company". `lingui:extract` found the new strings. |
| J1 (part) | Fixed | The main column of each table (description, item, operation, materials description, rental description) is `kind: "text"`, so it cannot be hidden and lose the line's details. | Catalog files. |

Checks after the fixes: the documents type check and tests (18 files, 132 tests) passed. The erp, mes and jobs type checks passed (`turbo --concurrency=1`). Biome passed on every changed file.

The code-judo items J1 (one column list per table), J2 (header texts on the header block), J3–J6 and the suggested improvements are not done. They are follow-ups for the user to decide.
