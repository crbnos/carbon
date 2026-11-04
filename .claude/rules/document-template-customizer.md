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
  render), plus audit cols. Realtime-enabled. RLS gated on the **settings** module
  (`settings_create/update/delete`).
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

- **schema.ts** — zod. `documentTemplateTypeSchema` enum = the 9 supported types:
  `salesInvoice, salesOrder, purchaseOrder, quote, packingSlip, stockTransfer,
  jobTraveler, issue, trackingLabel` (note `salesInvoice`/`salesOrder`, not bare
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
- **merge.ts** — `{token}` merge-field catalog; `interpolateContent` fills
  header/footer/richText/shared/terms at render (keyValue/field use
  `interpolateString`). A paragraph whose merge fields ALL resolve empty is
  dropped (and a list left empty with it), so "Approved by {order.approvedBy}"
  prints nothing on an unapproved PO; a Rich Text or Shared block whose
  content drops out entirely is not rendered, heading included.

## Editable texts (`template/texts/`)

Every printed heading, field label, column header and fixed sentence of a block document comes from a text catalog, not a literal.
Spec: `.ai/specs/2026-11-04-editable-block-content.md`.

- **Catalog:** one file per document type (`texts/<doc>.ts`, `<doc>Texts`, `as const satisfies DocumentTextCatalog`), registered in `TEXT_CATALOG` (`texts/index.ts`). Each entry is `{ key, kind, default }`. `kind` is `heading`, `field` (a label before one value), `column` (a table header) or `text`. Only `field` and `column` can be hidden (`isHideable`). The `document` entry holds texts outside any block: the title, `FOOTER_TEXTS` ("Page", "of"), and tables that are not blocks (job traveler materials).
- **Stored:** every block may carry `text` (only the changed texts, keyed by catalog key) and `hidden` (hidden `field`/`column` keys), both on `baseFields`. `settings.text` and `settings.hidden` hold the `document` entry's changes. A missing key prints the catalog default, so a default changed in code reaches every template that never edited it. An empty string prints nothing.
- **Render:** a block calls `makeText(<doc>Texts.<blockType>, block, data.vars)` and prints `t("key")`; `t.shows("key")` gates a hideable row or column. Tables use `columnWidths` (`pdf/blocks/columns.ts`): a hidden column's width goes to the description column. Each driver builds `dt = makeText(<doc>Texts.document, settings, vars)` for the title (`data.documentTitle`) and passes `footerText` to `Template`. The packing slip picks `title` or `rentalTitle` by its `kind` prop.
- **Variables:** `MERGE_FIELDS` is `as const`, so `MergeToken<"<doc>">` is a type and each `vars.ts` builder returns `Record<MergeToken<doc>, string>`: a missing or extra token fails the type check. ZPL `labelVars` calls `buildLabelVars`.
- **Save guard:** `validateTemplateText` (`texts/validate.ts`) refuses an unknown text key, hiding a non-hideable key, and an unknown `{variable}` in any text the template holds (the `text` maps, rich text, key-value rows, field values, terms, approval, tax label, label fields, the footer registration line). The editor runs it before submit and shows the error under the row (`textErrors`); `saveDocumentTemplate` runs it again and refuses with a `validation` error. A template saved before this check still renders.
- **Editor:** `TextConfig.tsx` adds a folding "Words on the page" section to every block panel that has catalog entries. A heading starts a group named by what it prints ("Supplier", "Order Info"); a search box shows from 7 texts. Each row is a `WordInput` (a one-line field that shows a known `{token}` as a chip with its merge-field label), the "Value" menu (inserts at the caret) and an eye for fields and columns. It shows no "changed" marker and has no per-text Reset. `DocumentTextConfig` edits the title in the header panel and the other document texts in the footer panel.
- **Click to jump:** the preview draws the server's PDF with pdf.js (`PreviewPages.tsx`, lazy) so a click reaches the editor. `PreviewPages` groups the clicked page's text-layer runs into lines (by their top), and `findPrintedText` (`previewText.ts`) reads each line: every printed text is a whole-word, case-insensitive pattern (headings print in capitals; a `{token}` matches what it printed), the longest wins left to right, and the n-th match of words several texts print ("Total" in the table and the summary) is the n-th of those texts in print order. A click on a value points at the nearest text before it: the label on its line, else the heading above. `focusText` selects the owning panel (the title goes to the header, other document texts to the footer) and the panel opens the group, scrolls to the row, flashes it for 1 s and focuses it. A hidden text prints nothing, so it can only be reached from the panel.
- **Not in the catalog (own fields):** summary `options.taxLabel` (default `DEFAULT_SUMMARY_OPTIONS.taxLabel`, "Taxes", in every summary), approval `heading`, label blocks' `label`, custom field `label`.
- **A new fixed string in a block must go into its catalog.** A literal breaks the "every text is editable" promise.

## Edits to one document (`documentEdit`)

One record's document can print differently from the company template. Spec: `.ai/specs/2026-11-04-per-document-edits.md`.

- **Table:** `documentEdit` (`20261104144659_document-edit.sql`), one row per `("companyId", "documentType", "documentId")`. `blocks` is keyed by block id (`{ text?, hidden?, visible?, content? }`), `settings` holds `{ text?, hidden? }`. Only the changes are stored; no row means no edits. RLS (`authz/manifest.ts`): any employee reads; a write needs the update permission of the record's module (`documentEditWriter`). `documentId` is in `ID_REF_COLUMNS`.
- **Types:** `DOCUMENT_EDIT_TYPES` (`template/edit.ts`): the 11 page documents; tracking labels are out. `DOCUMENT_EDIT_RECORDS` (`settings.models.ts`) maps each type to its table (a packing slip is a `shipment`, a traveler a `job`, an issue a `nonConformance`), readable id, `is<Doc>Locked`, module and Notes column.
- **Shape logic:** `applyDocumentEdit(template, edit)` merges an edit over a resolved template; `diffDocumentEdit(type, template, edited)` keeps only what differs (a word typed back to the template's word leaves no key). A word the document did not change keeps following the template.
- **Render:** every renderer resolves the template, then applies the edit: `getDocumentEdit` (`@carbon/lib/document-edit.server`) when no `edit` argument is passed, the given draft otherwise. So the live PDF, the PDF saved at send time and the email attachment print the same words. The stock transfer and issue renderers live in `inventory/stock-transfer.pdf.tsx` and `quality/quality.pdf.tsx`.
- **Save:** `settings.saveDocumentEdit` (keyed permission `{ by: "documentType" }`) refuses a locked record (`rule`, "This document is locked."), diffs the posted draft against the company template, validates it with `validateTemplateText`, and writes the row and the record's notes column in one transaction (an empty edit deletes the row). `settings.getDocumentEditor` loads the modal's data.
- **Routes:** `api+/document-edit.$type.$id.ts` (loader + save), `api+/document-edit.$type.$id.preview.ts` (the real renderer with the draft, via `renderDocumentWithEdit`, `settings/document-edit.pdf.tsx`).
- **UI:** `DocumentEditModal` / `useDocumentEditModal` / `EditDocumentMenuItem` (`components/DocumentEditModal.tsx`) open the editor in document mode (`DocumentTemplateProvider` `document` prop): no add, reorder, remove, Options, font or colors; Terms and Notes editors on their blocks; "Reset to template". A locked record opens read-only.
- **Copies:** a quote revision copies the source quote's row (`copyDocumentEdit` in `copyQuote`); conversions start with no edits.

## Editor UI

`apps/erp/app/components/DocumentTemplateEditor/` — `index.tsx` (rails + toolbar
with a live-record preview combobox), `context.tsx` (state/actions), plus
`BlockList`, `BlockConfig`, `FontConfig`, `ThemeConfig`, `SectionFormModal`,
`TemplatePreview`, `PreviewPages`, `previewText`, `PanelSection`, `WordInput`,
`TextConfig`, `MergeFieldMenu`, `NumberRow`, `LogoCropper`, `labelConfigs`,
`useHeaderConfig`, `useTemplateConflict`.

Every rail section folds (`PanelSection`; `RememberedSection` keeps the state in
local storage per section id). Left rail: Top of page (header, logo, watermark), Body (the
sortable blocks on the page, with Add block), Bottom of page (footer), Not on the
page (body blocks switched off, folded, only when there are some), Font, Colors.
Hiding a block never moves it, so showing it again puts it back in place. Right
panel: a block's own settings under "Options", then "Words on the page".

## Routes / services

- `x+/templates+/$type.tsx` — loader resolves template + sections + custom fields
  + preview entities + terms seed; action validates (`documentTemplateValidator`,
  `settings.models.ts`) and calls `upsertDocumentTemplate`.
- `x+/templates+/$type.preview.tsx` — POST renders the draft layout via
  `DOCUMENT_PDFS` (optionally against a real record via `previewId`;
  `buildPreviewProps` in `settings.service.ts`).
- File routes `file+/<doc>+/$id[.]pdf.tsx` — canonical consume path:
  `getDocumentTemplate` → `toDocumentTemplate` → `resolveTemplate` →
  `resolveSections(collectSectionIds(...))` → `ensureFont(...)` →
  `renderToStream(<DocPDF template sections />)`.
- Services in `apps/erp/app/modules/settings/settings.service.ts`:
  `getDocumentTemplate`, `getDocumentTemplateConfig`, `upsertDocumentTemplate`,
  `getDocumentSections(ByIds)`, `resolveSections`, `upsertDocumentSection`,
  `getTerms`. MES mirrors the read path in `apps/mes/app/services/inventory.service.ts`.

## Render architecture (`packages/documents/src/pdf/`)

Each doc is a thin driver (`<Doc>PDF.tsx`) + a per-doc block registry. The driver
resolves the template, builds a data bag + merge vars, then renders
`<Template>{visibleBlocks.map(registry[block.type])}</Template>`. `pdf/blocks/<doc>/`
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
