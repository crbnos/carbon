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
  (`body|header|footer`, plain TEXT), `content JSONB`, `config JSONB` (header
  layout: logo, visible company fields). Editing a built-in section **forks** it
  into a row (`upsertDocumentSection`).

JSON columns are untyped in generated DB types. `toDocumentTemplate(row, type)`
(`template/schema.ts`) is the **one** cast point — callers use it instead of
re-deriving the shape. Expect tsgo `.blocks does not exist` errors until DB types
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
  and **appends missing built-in blocks hidden** so old rows survive new blocks),
  `BUILT_IN_SECTIONS`, `collectSectionIds`.
- **merge.ts** — `{{token}}` merge-field catalog; `interpolateContent` fills
  header/footer/richText/keyValue at render.

## Editor UI

`apps/erp/app/components/DocumentTemplateEditor/` — `index.tsx` (rails + toolbar
with a live-record preview combobox), `context.tsx` (state/actions), plus
`BlockList`, `BlockConfig`, `FontConfig`, `ThemeConfig`, `SectionFormModal`,
`TemplatePreview`, `MergeFieldMenu`, `NumberRow`, `LogoCropper`, `labelConfigs`,
`useHeaderConfig`, `useTemplateConflict`.

## Routes / services

- `x+/templates+/$type.tsx` — loader resolves template + sections + custom fields
  + preview entities + terms seed; action validates (`documentTemplateValidator`,
  `settings.models.ts`) and calls `upsertDocumentTemplate`.
- `x+/templates+/$type.preview.tsx` — POST renders the draft layout via
  `DOCUMENT_PDFS` (optionally against a real record via `previewId`;
  `documentPreview.server.ts`).
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

<!-- UNVERIFIED: logo-resizer edge function (^GFA mono-PNG) for ZPL label logos — described in the old cache doc but not re-confirmed against current code in this pass -->
