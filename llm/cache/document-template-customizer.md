# Document Template Customizer

Lets users customize the built-in PDF documents (reorder/hide sections, add
extension blocks, theme colors, fonts, page header/footer) with a live preview.
Editor lives at `apps/erp/app/routes/x+/templates+/`.

## Supported documents

`documentTemplateTypeSchema` enum (`packages/documents/src/template/schema.ts`)
and `DOCUMENT_CATALOG` (`defaults.ts`, `supported: true`) currently cover 9:
salesInvoice, salesOrder, purchaseOrder, quote (transactional); packingSlip
(fulfillment); stockTransfer (transfer); jobTraveler, issue; and trackingLabel
(the tracked-entity label — group "Labels").

## Template model (`packages/documents/src/template/`)

- **schema.ts** — zod. `blockSchema` is a discriminated union keyed on `type`.
  Built-in blocks (`builtInBlock("…")`) carry only `id`+`visible`; some carry
  `options` (header logo/fields, lineItems thumbnails/zebra, summary taxLabel).
  Extension blocks: `richText`, `keyValue`, `spacer`, `shared`, `customField`.
  `documentSettingsSchema` = fontFamily + footer page-numbers/format +
  registration line. `documentTemplateSchema` = blocks + theme + settings +
  header/footerSectionId.
- **defaults.ts** — `BLOCK_META` (label/isBuiltIn/removable/hideable/addable per
  block type — **every** block type must have an entry), default block-list
  helpers (`transactionalBlocks`/`fulfillmentBlocks`/`transferBlocks`/
  `jobTravelerBlocks`/`issueBlocks`), `DEFAULT_TEMPLATES` (one per doc type),
  `resolveTemplate(type, stored)` (falls back to default, appends missing
  built-ins hidden), `BUILT_IN_SECTIONS` (system-header/footer, id
  `BUILT_IN_SECTION_IDS`), `collectSectionIds`, `DOCUMENT_CATALOG`,
  `getDocumentLabel`.
- **merge.ts** — `MERGE_FIELDS[docType]` `{{token}}` catalog; `interpolateContent`
  / `interpolateString` fill header/footer/richText/keyValue at render.

## Per-doc PDF architecture (`packages/documents/src/pdf/`)

Each supported doc is a **thin driver** + a **per-doc block registry**:

- `<Doc>PDF.tsx` — resolves the template, builds a `<Doc>Data` bag + merge
  `vars`, computes header/footer section content, then renders
  `<Template …chrome>{visibleBlocks.map(registry[block.type])}</Template>`.
  Pattern reference: `StockTransferPDF.tsx`.
- `pdf/blocks/<doc>/` — `types.ts` (`<Doc>Data` + `BlockRenderer`), `vars.ts`
  (`build<Doc>Vars`), one component per block, `registry.tsx`
  (`Record<DocumentBlockType, BlockRenderer>` — **must have a key for every
  block type**; unused → `() => null`), `index.ts`. Extension-block renderers
  reuse the generic `pdf/blocks/{RichText,KeyValue,Spacer,Shared,CustomField}Block`.
- `pdf/components/Template.tsx` — `<Document><Page>` chrome: fixed header-section
  banner, body, `Footer` (page numbers + registration line + footer-section).
- `preview-documents.tsx` — `DOCUMENT_PDFS[type] = { Component, sample }` dispatch
  for the generic preview route. `pdf/index.ts` re-exports PDFs + `SAMPLE_*`.
- `pdf/<doc>.samples.ts` — `SAMPLE_*` fixture (cast `as any`) for preview.

**Adding a block type** to the union breaks every existing registry (they are
`Record<DocumentBlockType,…>`) → add the new key (usually `() => null`) to all
registries + a `BLOCK_META` entry.

## Job Traveler specifics

Multi-make-method: the route
`apps/erp/app/routes/file+/job+/$jobId.traveler[.]pdf.tsx` renders **multiple
`<Page>`** (one per make method), each with `JobTravelerPageContent` (the
block-driven body, exported from `JobTravelerPDF.tsx`) + its own `Footer`. The
single-page `JobTravelerPDF` default export wraps the same body in `Template`
and is what the editor **preview** uses.

## Tracking Label specifics

`trackingLabel` is `ProductLabelPDF` (used by the entity/receipt/shipment/
operation `*.labels.pdf.tsx` routes). It's block-driven via
`pdf/blocks/trackingLabel/` (per-field blocks: labelHeading, labelRevision,
labelQuantity, labelTracking, labelQrCode, labelEntityId — stacked vertically
in each tile). Label **size/grid** is NOT in the template — it stays a print-
time `?labelSize=` choice (Avery presets in `@carbon/utils` labelSizes; ZPL
sizes redirect). Default template: `headerSectionId: null` (no header block at
all → editor's HeaderRow auto-hides), `footerSectionId: system-footer` (keeps
page numbers, toggleable). Routes load the template via
`getDocumentTemplateConfig(client, companyId, "trackingLabel")`
(`settings.service.ts`) — a helper that returns `DocumentTemplate | null`.

Label blocks beyond the built-in fields: a single-line `field` (label+value), a
`labelBarcode` (pdf417/code128/datamatrix/qrcode; PDF via `bwip-js`
`qr/barcode.ts`, ZPL via `^B7/^BC/^BX/^BQ`), and a `labelLogo` (company logo;
color URL in PDF, monochrome toggle). Layout slots: fields top-left (two-column
aligned), logo+QR top-right, barcode full-width bottom, entity id bottom.

**Logo monochrome / ZPL `^GF`:** the `logo-resizer` Supabase edge function
(`supabase/functions/logo-resizer/`, magick-wasm; mirror of `image-resizer`)
flattens→grays→thresholds→resizes the logo and returns `{ monoPng, gfa }` — the
mono PNG drives the PDF B&W logo, `gfa` is a self-rolled `^GFA` (no `zpl-image`
dep). `resolveLabelLogo(company, template, labelSize)` (ERP
`modules/settings/labelLogo.server.ts` + MES `services/labelLogo.server.ts`)
calls it when a visible `labelLogo` block exists and threads `{color, mono, gfa,
widthDots}` into `ProductLabelPDF` (`company`/`logo` props) +
`generateProductLabelZPL` (`logo` arg). All 12 ERP/MES label routes pass it.

**ZPL output** honors the same template: `generateProductLabelZPL(item,
labelSize, template?, logo?)` (`packages/documents/src/zpl/ProductLabelZPL.tsx`)
resolves `trackingLabel` and emits only visible fields in block order (text
stacked, QR top-right, entity id bottom; extension/custom blocks skipped — no
ZPL equivalent). Both ERP and MES label routes (`file+/{entity,receipt,
shipment,operation}+/$id.labels[.]{pdf,zpl}.tsx`) pass the template. MES has its
own `getDocumentTemplateConfig` in `apps/mes/app/services/inventory.service.ts`
(mirrors the ERP helper). Label size/ZPL-vs-PDF is still the print-time
`?labelSize=` choice (ZPL sizes have a `zpl` config + DPI; others render PDF).

## Editor (`apps/erp/app/components/DocumentTemplateEditor/`)

`context.tsx` (state/actions provider), `index.tsx` (rails + toolbar; toolbar has
a centered `Combobox` to preview against a live record), `BlockList`/`BlockConfig`
/`FontConfig`/`ThemeConfig`/`SectionFormModal`/`TemplatePreview`/`NumberRow`.
`NumberRow` wraps react-aria `NumberField` with the required composed
`NumberInputGroup` child (a bare `label` prop renders no input).

## Terms & Conditions (per-document)

The built-in `terms` block carries its own optional rich-text `content` (schema
`termsBlock`). Renderers (`blocks/**/TermsBlock.tsx`) use `resolveTerms(block,
data.terms, vars)` from `blocks/resolveTerms.ts`: the block's authored content
(interpolated with merge fields) when present, else `data.terms` — the company
`terms` table setting (`salesTerms`/`purchasingTerms`), still passed by the PDF
file routes as the fallback. The editor `TermsConfig` (BlockConfig.tsx) seeds the
field from that setting via `termsSeed` (threaded loader→context→config). The
global Terms editors were removed from `settings+/sales.tsx` +
`settings+/purchasing.tsx`; the `terms` table remains as the seed + fallback.

## Routes / persistence

- `x+/templates+/$type.tsx` — loader resolves template + sections + customFields +
  `listPreviewEntities`; action upserts via `upsertDocumentTemplate`.
- `x+/templates+/$type.preview.tsx` — POST renders draft layout via
  `DOCUMENT_PDFS`; with a `previewId`, `buildPreviewProps`
  (`modules/settings/documentPreview.server.ts`) renders against real record data
  (supported: salesInvoice/salesOrder/purchaseOrder/quote/stockTransfer; others
  fall back to sample).
- File routes (`file+/<doc>+/…pdf.tsx`) — load `getDocumentTemplate`, build a
  `DocumentTemplate | null`, `resolveTemplate`, `resolveSections`,
  `ensureFont(settings.fontFamily)`, pass `template` + `sections` to the PDF.
- `modules/settings/settings.service.ts` — `getDocumentTemplate`,
  `upsertDocumentTemplate`, `getDocumentSections`, `resolveSections`,
  `upsertDocumentSection` (forks built-in sections on edit). DB tables:
  `documentTemplate`, `documentSection`.

> Note: `documentTemplate` rows are typed loosely until the generated DB types
> are regenerated — PDF routes cast `data.blocks/theme/settings` (`.blocks does
> not exist on ResultOne` tsgo errors are expected until regen).
