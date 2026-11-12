---
paths:
  - "packages/documents/src/template/**"
  - "packages/documents/src/pdf/**"
  - "apps/erp/app/routes/x+/templates+/**"
  - "apps/erp/app/components/DocumentTemplateEditor/**"
---

# Document Template Customizer

A block-based template engine in `@carbon/documents` drives every document PDF
(invoices, quotes, POs, travelers, etc.) and the tracking-label PDF/ZPL. Users
customize templates per-company in a live editor; templates are resolved against
defaults at render time. Related printing/queue mechanics live in
[printing-system.md](printing-system.md).

## Storage (`documentTemplate` + `documentSection` tables)

Created by `packages/database/supabase/migrations/20260609143732_document-template.sql`
(later migrations only backfill `blocks` JSONB — no structural changes).

- **`documentTemplate`** — composite PK `("id","companyId")`, `UNIQUE (companyId, documentType)`
  (one template per doc type per company). Columns: `documentType` (plain `TEXT`,
  **not** a Postgres enum), `formatVersion INTEGER DEFAULT 1`, `blocks JSONB`,
  `theme JSONB`, `settings JSONB`, nullable `headerSectionId`/`footerSectionId`
  (soft refs to `documentSection`, **no FK** — a deleted section is skipped at
  render), plus audit cols. Realtime-enabled. RLS allows SELECT only: the server saves it
  as the system, after validating its figures (`saveDocumentTemplate`).
- **`documentSection`** — company-global reusable rich-text sections. `placement`
  (`body|header|footer`, plain TEXT), `content JSONB`, `config JSONB` (header:
  logo + visible company fields; footer: registration line
  `showRegistrationLine`/`registrationNumber`, merge-field capable). Editing a
  built-in section **forks** it into a row (`upsertDocumentSection`).

JSON columns are untyped in generated DB types. `toDocumentTemplate(row, type)`
(`template/schema.ts`) is the **one** cast point — callers use it instead of
re-deriving the shape. Expect tsc `.blocks does not exist` errors until DB types
are regenerated; that's expected, not a bug.

## Template model (`packages/documents/src/template/`)

- **schema.ts** — zod. `documentTemplateTypeSchema` enum = the 12 supported types:
  `salesInvoice, salesOrder, salesReturnOrder, purchaseOrder, purchaseReturnOrder,
  purchasingRfq, quote, packingSlip, stockTransfer, jobTraveler, issue, trackingLabel` (note `salesInvoice`/`salesOrder`, not bare
  `invoice`/`order`). `blockSchema` is a discriminated union keyed on `type`:
  built-ins carry only `id`+`visible` (some add `options`); extension blocks
  include `richText, keyValue, spacer, shared, field, customField, watermark`.
  `documentTemplateSchema` = `formatVersion + blocks + theme + settings +
  header/footerSectionId`. `CURRENT_TEMPLATE_FORMAT_VERSION = 1`.
- **defaults.ts** — `BLOCK_META` (one entry **required** per block type),
  `DEFAULT_TEMPLATES` (one per doc type), `DOCUMENT_CATALOG` + `getDocumentLabel`,
  `resolveTemplate(type, stored)` (read-time normalizer: falls back to the default
  and **appends missing built-in blocks hidden** so old rows survive new blocks —
  except a block whose `BLOCK_META` sets `showWhenAppended`, appended visible
  because it prints nothing until its data exists; today only `approval`),
  `BUILT_IN_SECTIONS`, `collectSectionIds`.
- **merge.ts** and **mergeFields.ts** — `interpolateContent` and token helpers in the first; the `{token}` merge-field catalog, one table per document, in the second. `interpolateContent` fills
  header/footer/richText/shared/terms at render (keyValue/field use
  `interpolateString`). A paragraph whose merge fields ALL resolve empty is
  dropped (and a list left empty with it), so "Approved by {order.approvedBy}"
  prints nothing on an unapproved PO; a Rich Text or Shared block whose
  content drops out entirely is not rendered, heading included.

## Editable texts (`template/texts/`)

Every printed heading, field label, column header and fixed sentence of a block document comes from a text catalog, not a literal.
Spec: `.ai/specs/2026-11-04-editable-block-content.md`.

- **Catalog:** one file per document type (`texts/<doc>.ts`, `<doc>Texts`, `as const satisfies DocumentTextCatalog`), registered in `TEXT_CATALOG` (`texts/index.ts`). Each entry is `{ key, kind, default }`. `kind` is `heading`, `field` (a row, usually a label and its value), `column` (a table header), `text` or `value` (see "Values are variables"). Only `field` and `column` can be hidden (`isHideable`). The `document` entry holds texts outside any block: the title, `FOOTER_TEXTS` ("Page", "of"), and tables that are not blocks (job traveler materials).
- **Stored:** every block may carry `text` (only the changed texts, keyed by catalog key) and `hidden` (hidden `field`/`column` keys), both on `baseFields`. `settings.text` and `settings.hidden` hold the `document` entry's changes. A missing key prints the catalog default, so a default changed in code reaches every template that never edited it. An empty string prints nothing.
- **Render:** a block calls `makeText(<doc>Texts.<blockType>, block, data.vars)` and prints `t("key")`; `t.shows("key")` gates a hideable row or column. Tables use `columnWidths` (`pdf/blocks/columns.ts`): a hidden column's width goes to the description column. Each driver calls `documentChrome` for the document's words, sections and printed blocks, and renders `DocumentPage` (`pdf/blocks/`), which holds the `Template` and its PDF properties. The packing slip picks `title`, `rentalTitle` or `receivingReportTitle` by its `documentType` prop.
- **Variables:** `MERGE_FIELDS` is `as const`, so `MergeToken<"<doc>">` is a type and each `vars.ts` builder returns `Record<MergeToken<doc>, string>`: a missing token fails the type check. ZPL `labelVars` calls `buildLabelVars`.
- **Save guard:** `validateTemplateText` (`texts/validate.ts`) refuses an unknown text key, hiding a non-hideable key, and an unknown `{variable}` in any text the template holds (the `text` maps, rich text, key-value rows, field values, terms, approval, tax label, label fields, the footer registration line). The editor runs it before submit and shows the error under the row (`textErrors`); `saveDocumentTemplate` runs it again and refuses with a `validation` error. A template saved before this check still renders.
- **Editor:** `TextConfig.tsx` shows one text at a time in every block panel that has catalog entries. A picker lists them, grouped by what prints them (`groupTexts`: a heading, or a table column with its row values) and named by `wordName` from the catalog's default, never from what the user typed (its words before any variable, else its variables' names), with previous and next buttons. Below it are the `WordInput` (a field that shows a known `{token}` as a chip with its merge-field label), "Insert value" (a searchable list by name or group; inserts at the caret) and, for fields and columns, a Show switch. A hidden text stays in the picker, marked. The shown text is `textFocus`, set by the picker, the buttons, a click on the page and a failed save; selecting another block clears it, and the panel falls back to the first text. It shows no "changed" marker and has no per-text Reset. `DocumentTextConfig` edits the document texts in `HEADER_TEXT_KEYS` in the header panel and the others in the footer panel.
- **Click to jump:** the preview draws the server's PDF with pdf.js (`PreviewPages.tsx`, lazy) so a click reaches the editor. `groupLines` (`previewClick.ts`) groups the clicked page's text-layer runs into lines by their top, and `resolveClick` routes the click. `fillPrintedTexts` (`previewText.ts`) first puts the values into the texts, so each knows what it printed; a text whose values are all empty is left out, with its label, so it cannot shift the order. The values are the collector's: `$type.values` (the sample or the picked record, default words, every block visible) on a template, `document-edit.$type.$id.values` on one document, both through `useLoadPrintedValues` into the store's `documentValues`; only document mode draws pencils from them. Without them a click reads only the words. `findPrintedText` compares whole stretches of runs with what each text printed, ignoring spaces and case, so a word inside a value is never taken for a text. A text's word that several texts print ("Total" in the table and the summary) goes to the first not yet found at or after the last text found, because texts print in order and a block can leave one out; a block that repeats falls back to its own texts, and a lone match is never a `column`. A value of its own place (`of`) or shorter than three characters is not matched this way, because the same figure can print in another column: it resolves by position, as the value of the label on its line (unless a heading of the same block starts between them), else what printed these words in the column it sits under, else the longest text that printed them or holds them as a piece of a wrapped line, else the column's value, else the nearest text above. `isHeaderDetails` sends what prints above the title (the company's details), or above the first page's first text when no title prints, to the header's panel. A run in the footer's band (`FOOTER_TOP`) only matches `FOOTER_LINE_TEXT_KEYS` and otherwise opens the footer's panel, because the registration line and the document id are not texts. The summary's tax label is its own option, so `printedTexts` adds it for the tax amount's row. `printedTexts` also adds what a block prints from its own settings (`ownTexts`: label fields, rich text, key-value rows, a custom field's label, the approval heading) and the paragraphs of its shared, header and footer sections, where a click only selects the block. `focusText` selects the owning panel and the panel shows that text with the caret in it. A click reads the words the shown PDF was drawn from, not a draft that has moved on. `PreviewPages` outlines the clicked run until the panel moves to another text or the preview redraws. A hidden text prints nothing, so it can only be reached from the panel. `previewClick.pdf.test.ts` clicks every run of every sample through real pdf.js.
- **Values are variables (all 11 page documents):** a value prints from a text, not from code. A labelled row is one text (`Date: {order.date}`); a row with only a value is `{supplier.name}`. A value in a place of its own (a table cell, an amount) is kind `value`, with `of` naming its column or label; the editor shows it under that row, and hiding the column hides it. `row` marks a text printed once per table row and names its variables by prefix (`line` for `{line.quantity}`): it can also use those `LINE_MERGE_FIELDS`, filled by `build<Doc>LineVars` and passed as `t("qtyCell", row)`; `validateTemplateText` refuses them anywhere else. `t.prints(key, row)` is false when the row or its owner (`of`) is hidden, when it is empty, or when every variable in it is empty, so "Reference:" never prints alone. Formatting (dates, money) lives in `vars.ts`. A party's address is `addressFields` (`mergeFields.ts`), `addressTexts` (`texts/shared.ts`), `addressVars` (`pdf/blocks/textVars.ts`) and `AddressRows` (`pdf/blocks/textRows.tsx`). `texts.test.ts` checks every default's variables, `of` and `row`, because `validateTemplateText` only reads stored words. What stays code: images, QR codes and barcodes, signatures, rich-text notes and terms, custom field blocks, the summary tax label (its own option), the footer document id, the footer's registration sentence, and tracking labels, whose values print beside the blocks' own `label`. The company name and address in the header come from the header options, not from texts.
- **Figures stay variables:** `amount: true` (`mergeFields.ts`) marks a figure: money or a quantity. `validateTemplateText` refuses (`amountRemoved`) a stored text, in a block or the document's own texts, that drops a figure its default prints, so a typed number cannot replace what the record says, or a number or sign beside a figure (`amountChanged`): `1{line.quantity}` prints 15 for 5, `{line.number} {line.quantity}` prints "1 5", `{line.quantity}k` says another figure. A variable beside it counts as the number it prints, or as nothing. This guards what a template's words do to a figure. It cannot read meaning: words stay free ("ten {line.quantity}"), a figure's column can be hidden and a number typed in another text, and rich text, key-value rows and field blocks can say what they like. A changed value next to a figure is shown on the page but not checked. Words around the figure are fine, and so is hiding its column. `fixed: true` marks a value one document cannot change with a pencil, though the words may leave it out, and so can be retyped in its place (by design): a document or line number, a revision, a currency, a unit, a percent, a serial, and what differs per page of a traveler. `isEditableValue` is false for both. `validate.test.ts` checks these flags by name on every page document. Line fields are defined once in `LINE`, so a flag cannot differ by document.
- **Variable names:** `label` and `group` in `mergeFields.ts` are English. The editor translates them with `MERGE_FIELD_NAMES` and `useMergeFieldName` (`mergeFieldNames.ts`), because `@carbon/documents` also renders outside the apps, where Lingui's macros do not run. A new name goes in that file too; `mergeFieldNames.test.ts` fails without it.
- **Rich text marks:** `Note.tsx` prints bold, underline and strikethrough. Italic prints only when the font has an italic face (`fontHasItalic`), because asking react-pdf for a missing one fails the document.
- **Not in the catalog (own fields):** summary `options.taxLabel` (default `DEFAULT_SUMMARY_OPTIONS.taxLabel`, "Taxes", in every summary), approval `heading`, label blocks' `label`, custom field `label`.
- **A new fixed string in a block must go into its catalog.** A literal breaks the "every text is editable" promise.

## Edits to one document (`documentEdit`)

One record's document can print differently from the company template. Spec: `.ai/specs/2026-11-04-per-document-edits.md`.

- **Table:** `documentEdit` (`20261104144659_document-edit.sql`), one row per `("companyId", "documentType", "documentId")`. `blocks` is keyed by block id (`{ text?, hide?, show?, visible?, content? }`), `settings` holds `{ text?, hide?, show?, valueEdits? }`. Only the changes are stored; no row means no edits. RLS (`authz/manifest.ts`, `documentEditReader`): whoever can read a record can read its edit, by the record's own read rule. There are no write policies, so the API refuses every write: a save runs as the system after it validates the edit and checks the lock. `document-edit-authz.test.sql` proves this as the real role. An AFTER DELETE trigger on each of the 11 record tables (`delete_document_edit`, the same migration) removes the row with its record, because the table has no foreign key.
- **Types:** `DOCUMENT_EDIT_TYPES` (`template/edit.ts`): the 11 page documents; tracking labels are out. `DOCUMENT_EDIT_RECORDS` (`settings.utils.ts`) maps each type to its table (a packing slip is a `shipment`, a traveler a `job`, an issue a `nonConformance`), readable id, `is<Doc>Locked`, module and Notes column.
- **Shape logic:** `applyDocumentEdit(template, edit)` merges an edit over a resolved template; `diffDocumentEdit(type, template, edited)` keeps only what differs (a word typed back to the template's word leaves no key). A word the document did not change keeps following the template, and so does what the template hides later: `hide` and `show` store only the document's own changes to the hidden list.
- **Render:** every renderer resolves the template, then applies the edit: `getDocumentEdit` (`@carbon/lib/document-edit.server`) when no `edit` argument is passed, the given draft otherwise. A failed read throws, because printing or emailing a document without its edits would be wrong. `getDocumentEdit` also drops any stored value of a locked variable (`withoutLockedValues`). So the live PDF, the PDF saved at send time and the email attachment print the same words. The stock transfer and issue renderers live in `inventory/stock-transfer.pdf.tsx` and `quality/quality.pdf.tsx`.
- **Save:** `settings.saveDocumentEdit` (keyed permission `{ by: "documentType" }`) diffs the posted draft against the company template (`getCompanyTemplate`), validates it with `validateDocumentEdit` (only what the edit changed, so a company template's own problem cannot stop a document's save), and writes the row and the record's notes column in one transaction (`saveDocumentEditRow`, `settings/settings.service.ts`), which holds the record's row and refuses a locked one (`rule`, "This document is locked.") (an empty edit deletes the row). `settings.getDocumentEditor` loads the modal's data.
- **Routes:** `api+/document-edit.$type.$id.ts` (loader + save), `api+/document-edit.$type.$id.preview.ts` (the real renderer with the draft, via `renderDocumentWithEdit`, `settings/document-edit.pdf.tsx`).
- **UI:** `useDocumentEditModal` and `EditDocumentMenuItem` (`components/DocumentEditModal.tsx`, small, on every record page) lazily load `DocumentEditModalContent.tsx`, which opens the editor in document mode (`DocumentTemplateProvider` `document` prop). The hook mounts the modal only while it is open, so each open reads fresh data. Once it has loaded, Cancel is the only way out: Escape and a click outside do nothing, so a stray key cannot lose a draft. No add, reorder, remove, Options, font or colors; Terms and Notes editors on their blocks; "Reset to template". A locked record opens read-only.
- **Changed values:** one document can print its own text in place of a value (`settings.valueEdits`: `{ document: { token: text }, rows: { "<prefix>:<record id>": { token: text } } }`). It sits on the edit's `settings`, so `applyDocumentEdit` puts it on the printed template and every driver reads it there; a company template save drops it. Each driver builds `documentValues(settings.valueEdits, valueCollector)` (`template/values.ts`), wraps its variables in `values.document(...)`, and each table row calls `data.values.row(prefix, id, build…(…))`. A new table must do the same. `isEditableValue` is false for `amount` and `fixed` fields (quantities, and values the table fills itself); `validateTemplateText` refuses those as `valueLocked`. The record never changes. A changed row wraps the line table. Row entries are keyed by line id. A quote revision and a restore rewrite the keys; an entry whose line is gone is ignored.
- **Editing a value:** in document mode, `WordInput` draws a pencil on each chip whose value this document can change. It opens `ValueEditor.tsx`, a small popover anchored to the chip; a value printed per table row lists one box per row. `api+/document-edit.$type.$id.values.ts` reads the record's values by rendering once with a collector, every block visible and no changed values. `valueTargets.ts` lists what a panel's current words print. The modal reads it with a plain `fetch`, because a fetcher's failed load replaces the whole page with its error screen; without the values there are no pencils, and the words can still be edited. A preview click reads these values through `fillPrintedTexts` (see "Click to jump").
- **Preview and download:** the preview route needs update rights on the record's module, because only those users can open the modal. It answers 404 for a record outside the session's company. A locked record prints its saved edits and ignores the posted draft. A draft with a figure problem (`isFigureProblem`) answers 400, so no figure the record does not say reaches a PDF, and `intent=download` also refuses every other problem in the edit. The template preview route refuses the same figure problems, drops `valueEdits`, and needs `update: settings` to print on a real record. `toDocumentTemplate` also drops `valueEdits`, and `documentTemplate` has no write policies: the server saves it after validating. The editor runs the same check before each preview (`draftProblems`). `useTextErrors` derives the errors from the draft, so they are always current and nothing stores them. A quote revision rewrites row keys through its old-to-new line map (`rewriteValueEditRowKeys`), and a company restore through its id map. Notes are posted only when the user changed them (`changedNotes`). A save then leaves notes changed elsewhere alone, and a preview or download prints the typed ones: `edit.notes`, which `applyDocumentEdit` puts on the Notes block and `printedNotes` reads. `documentEdit` has no column for them, and `blockSchema` has no such field, so nothing posted or saved can set it. A save that changed the notes reloads the page (`navigate(0)` in `onSaved`), because each record page's Notes box keeps its own copy and saves it on the next keystroke.
- **Copies:** a quote revision copies the source quote's row (`copyDocumentEdit`, inside the `quoteToQuote` transaction, so the revision and its edits save together); conversions start with no edits.

## Editor UI

`apps/erp/app/components/DocumentTemplateEditor/` — `index.tsx` (rails + toolbar
with a live-record preview combobox), `context.tsx` (state/actions), plus
`BlockList`, `BlockConfig`, `FontConfig`, `ThemeConfig`, `SectionFormModal`,
`TemplatePreview`, `PreviewPages`, `previewText`, `previewClick`, `PanelSection`, `WordInput`,
`TextConfig`, `MergeFieldMenu`, `NumberRow`, `LogoCropper`, `labelConfigs`,
`useHeaderConfig`, `useTemplateConflict`.

Every rail section folds (`PanelSection`; `RememberedSection` keeps the state in
local storage per section id). Left rail: Top of page (header, logo, watermark), Body (the
sortable blocks on the page, with Add block; the Summary is nested under Line Items and `keepSummaryWithLineItems` keeps it directly after them in the stored order and when a template resolves), Bottom of page (footer), Not on the
page (body blocks switched off, folded, only when there are some), Font, Colors.
Hiding a block never moves it, so showing it again puts it back in place. Right
panel: a block's own settings under "Options", then its texts, one at a time.

## Routes / services

- `x+/templates+/$type.tsx` — loader resolves template + sections + custom fields
  + preview entities + terms seed; action validates (`documentTemplateValidator`,
  `settings.models.ts`) and calls `settings.saveDocumentTemplate`.
- `x+/templates+/$type.values.tsx` — GET reads what a preview prints, for its clicks (`templatePreviewProps`, `document-edit.pdf.tsx`).
- `x+/templates+/$type.preview.tsx` — POST renders the draft layout via
  `DOCUMENT_PDFS` (optionally against a real record via `previewId`;
  `buildPreviewProps` in `settings.service.ts`).
- File routes `file+/<doc>+/$id[.]pdf.tsx` call a renderer in `<module>.pdf.tsx` — canonical
  consume path: `getPrintedTemplate` (`@carbon/lib/document-edit.server`: the template with this
  document's edits) → `resolveSections(collectSectionIds(...))` → `ensureFont(...)` →
  `renderToStream(<DocPDF template sections />)`.
- Services in `apps/erp/app/modules/settings/settings.service.ts`:
  `getDocumentTemplate`, `getDocumentTemplateConfig`, `upsertDocumentTemplate`,
  `getDocumentSections(ByIds)`, `resolveSections`, `upsertDocumentSection`,
  `getTerms`. MES mirrors the read path in `apps/mes/app/services/inventory.service.ts`.

## Render architecture (`packages/documents/src/pdf/`)

Each doc is a thin driver (`<Doc>PDF.tsx`) + a per-doc block registry. The driver
resolves the template, builds a data bag + merge vars, then renders
`<DocumentPage>` (`pdf/blocks/DocumentPage.tsx`), which prints `<Template>` and each visible block through `registry`. `pdf/blocks/<doc>/`
holds `types.ts`, `vars.ts`, one component per block, and `registry.tsx`
(`Record<DocumentBlockType, BlockRenderer>` — **must key every block type**; unused
→ `() => null`). `pdf/components/Template.tsx` is the `<Document><Page>` chrome.
`pdf/preview-documents.tsx` (`DOCUMENT_PDFS[type] = { Component, sample }`) dispatches
the generic preview.

**Adding a block type** to the union breaks every registry → add the key to all
registries + a `BLOCK_META` entry + (if built-in) a `DEFAULT_TEMPLATES` entry.

## Approval block (purchase orders)

The built-in `approval` block (`pdf/blocks/purchaseOrder/ApprovalBlock.tsx`)
prints a heading, the approver's signature (max 40 pt high) over a line, and a
caption, and nothing while the order is unapproved. Its options, set in the
editor's `ApprovalConfig`: `heading` (absent = `DEFAULT_APPROVAL_HEADING`,
"Approved By"; an empty string prints none), `showSignature` (default true)
and `content`, a rich-text caption with merge fields (empty =
`DEFAULT_APPROVAL_CAPTION`: `{order.approvedBy}`, a line break,
`{order.approvedDate}`). "Approved by … on …" text belongs in this caption,
not in a separate Rich Text block, or the PDF prints it twice. It is last in the default PO layout and
is appended visible to saved templates. Its data is `PurchaseOrderData.approval`
from `getPurchaseOrderApproval(…, { withSignature: true })`
(`purchasing.service.ts`), which reads the file recorded on the approval
(`approvalRequest.decisionSignaturePath`, private `signatures` bucket) as a data
URL. Every other registry renders it as `null`. Spec:
`.ai/specs/2026-10-28-approval-signatures.md`.

## Tracking label specifics

`trackingLabel` renders via `pdf/ProductLabelPDF.tsx` (block-driven) and ZPL via
`zpl/ProductLabelZPL.tsx` (`generateProductLabelZPL`; emits only visible fields in
block order, skips extension/custom blocks — no ZPL equivalent). The queued
print-job path also loads `documentTemplate` with `documentType="trackingLabel"`
so auto-printed labels match the customizer (see
[printing-system.md](printing-system.md), `renderItemBuiltIn`). Label **size/grid
is NOT in the template** — it stays a print-time `?labelSize=` choice (Avery presets
in `@carbon/utils` `labelSizes`; ZPL needs a `labelSize.zpl` config).

## Terms & Conditions

The built-in `terms` block carries optional rich-text `content`; renderers call
`resolveTerms(block, data.terms, vars)` — the authored content (interpolated) when
present, else the company `terms` table setting (`salesTerms`/`purchasingTerms`),
which routes still pass as the seed/fallback.

ZPL/B&W label logos: `resolveLabelLogo` (`@carbon/documents/labels`) crops, thresholds and resizes the company logo with `renderLabelLogo` (`@carbon/files/media`) into a mono PNG data URL and a `^GFA` field.
