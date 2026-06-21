---
paths:
  - "packages/documents/src/pdf/**"
  - "packages/documents/src/qr/**"
  - "apps/*/app/routes/file+/**/*[.]pdf.tsx"
---

# PDF Generation Patterns

How to author and serve a PDF in `@carbon/documents`. PDFs are
[`@react-pdf/renderer`](https://react-pdf.org) (v3.4.5) React component trees,
styled with `react-pdf-tailwind`. This rule is the **authoring** view; the block
template engine that drives the customizable docs lives in
[document-template-customizer.md](document-template-customizer.md), and the
print-queue/ZPL side in [printing-system.md](printing-system.md).

## Two authoring styles

1. **Block-registry driven** (customizable docs + tracking label): the PDF file is
   a thin driver that resolves a `documentTemplate` and renders an ordered list of
   block components. Files: `SalesInvoicePDF`, `SalesOrderPDF`, `PurchaseOrderPDF`,
   `QuotePDF`, `PackingSlipPDF`, `StockTransferPDF`, `JobTravelerPDF`, `IssuePDF`,
   `ProductLabelPDF` (trackingLabel). Add new ones via the template engine — see
   document-template-customizer.md. Every one is registered in
   `pdf/preview-documents.tsx` `DOCUMENT_PDFS[type] = { Component, sample }`.
2. **Hand-built React-PDF tree** (no template): a fixed `<Document>/<Page>` layout.
   Files: `KanbanLabelPDF.tsx`, `StorageUnitLabelPDF.tsx`. Use this only for simple,
   non-customizable labels.

All PDF components are barrel-exported from `pdf/index.ts`.

## Shared chrome & components (`pdf/components/`)

- **`Template.tsx`** — the page shell every full-page doc wraps. Renders
  `<Document><Page size="A4">` with body padding, registers **Inter** statically,
  picks a safe `fontFamily` (falls back to Helvetica if unregistered), and mounts
  the fixed `<Footer>` + repeating `headerContent`. Props include `title`, `meta`,
  `theme`, `showFooter`, `showPageNumbers`, `pageNumberFormat`, `fontFamily`. It
  wraps children in `DocStyleProvider` so blocks read the themed `tw`.
- Other shared parts (barrel `pdf/components/index.ts`): `Header`, `Footer`,
  `AddressBlock`, `LogoImage`, `Note`, `Summary`, `Watermark`. Labels use
  `components/labelGeometry.ts` `getLabelPdfGeometry(labelSize)` to size fonts/QR
  to a 203-dpi thermal baseline (geometric parity with the ZPL output).

## Styling — themed Tailwind, not StyleSheet (`pdf/blocks/tw.ts`)

Blocks style via `react-pdf-tailwind`, NOT raw `StyleSheet`. Inside a block:

```tsx
import { useTw } from "../tw";           // themed instance from context
const tw = useTw();
<View style={tw("border border-gray-200 mb-4")}>
  <Text style={tw("text-[9px] font-bold text-gray-600 uppercase")}>Ship To</Text>
```

`makeDocTw(theme)` remaps semantic grays to the document theme: `gray-600` =
`theme.heading`, `gray-800` = `theme.text`. Use those grays for headings/body so a
theme change recolors every block from one place. `useDocTheme()` reads the raw
theme for inline `theme.accent` styling. The standalone `tw` export is the unthemed
fallback (also the context default).

## Block component shape (block-driven docs)

A block is a pure component `({ block, data }) => JSX.Element | null` keyed in the
per-doc registry `pdf/blocks/<doc>/registry.tsx`. The driver builds **one** data
bag (`pdf/blocks/<doc>/types.ts`) plus merge vars (`vars.ts`) and hands the same
object to every block — no per-section prop drilling. The driver loop:

```tsx
{visibleBlocks.map((block) => {
  const render = registry[block.type];
  return render ? <Fragment key={block.id}>{render({ block, data })}</Fragment> : null;
})}
```

Registries are `Partial<Record<DocumentBlockType, BlockRenderer>>` and spread
`extensionBlocks` (richText/keyValue/spacer/shared/field/customField/watermark).
See document-template-customizer.md before adding a block **type**.

## QR codes & barcodes (`packages/documents/src/qr/`)

Generated **async, before render**, into base64 PNG data URLs (react-pdf renders an
`<Image src={dataUrl} />`). Both use `@bwip-js/node` (v4.9.0) — there is no `qrcode`
dependency.

- `src/qr/qr-code.ts` — `generateQRCode(text, size, color?): Promise<string>`
  (returns `data:image/png;base64,...`); also `generateQRCodeBuffer`. There is a
  `generateQRCodeSync` that **throws "not supported"** — never call it.
- `src/qr/barcode.ts` — `generateBarcode(text, symbology, opts?)` where
  `symbology` is `"pdf417" | "code128" | "datamatrix" | "qrcode"`. 2D codes use
  `scale`, linear codes use `height` to avoid distortion.

Hand-built labels call these directly in JSX setup (e.g. `KanbanLabelPDF` color-codes
the QR by action). Block-driven labels generate inside the trackingLabel blocks.

## Fonts (`pdf/fonts.ts`)

`Template` registers **Inter** statically. Helvetica / Times-Roman / Courier are PDF
built-ins (no registration). Any Google font picked in the editor must be registered
**before render** via `await ensureFont(family)` in the route — it fetches the CSS2
stylesheet with a legacy User-Agent (Google serves TTF, since react-pdf can't do
WOFF2), parses one TTF per weight, and is idempotent + best-effort (failure leaves
the font unregistered and `Template` falls back to a safe face).

## Serving — the file route (`apps/*/app/routes/file+/<doc>+/$id[.]pdf.tsx`)

PDF routes return a `Response` of `application/pdf`. Canonical shape (verified against
`file+/sales-invoice+/$id[.]pdf.tsx`):

```tsx
const { client, companyId } = await requirePermissions(request, { view: "sales" });
const [company, ...data, documentTemplate] = await Promise.all([ /* parallel fetches */ ]);

const templateConfig = toDocumentTemplate(documentTemplate.data, "salesInvoice");
const resolved = resolveTemplate("salesInvoice", templateConfig);
const sections = await resolveSections(client, companyId, collectSectionIds(resolved));
await ensureFont(resolved.settings.fontFamily);                  // before render

const stream = await renderToStream(<SalesInvoicePDF template={templateConfig} sections={sections} ... />);
const body: Buffer = await new Promise((resolve, reject) => {
  const buffers: Uint8Array[] = [];
  stream.on("data", (d) => buffers.push(d));
  stream.on("end", () => resolve(Buffer.concat(buffers)));
  stream.on("error", reject);
});
return new Response(new Uint8Array(body), {
  status: 200,
  headers: new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${company.data.name} - ${id}.pdf"`,
  }),
});
```

Thumbnails are pre-fetched in the route as base64 (`getBase64ImageFromSupabase` from
`~/modules/shared` / `shared.service.ts`) via `Promise.all`, then passed as a
`thumbnails` map prop. `getRegistrationFooter` (+ other display helpers) come from
`packages/documents/src/utils/shared.ts`, used inside the PDF components.

## Gotchas

- **`@react-pdf/renderer` is v3.x** (pinned in the pnpm catalog), not v4 — its API
  differs; don't copy v4 examples.
- **Async work happens before render.** QR/barcodes/images/fonts are all resolved to
  data URLs / registered up front; the component tree itself is synchronous.
- **No `qrcode` package** — codes are `@bwip-js/node`.
- **`renderToStream`, not `renderToBuffer`.** Routes drain the Node stream into a
  Buffer manually, then wrap in `new Uint8Array(body)` for the `Response`.
- Style with `useTw()` semantic grays, not raw `StyleSheet` — that's what keeps
  themes consistent across every block.
- The template-preview route renders draft layouts via `DOCUMENT_PDFS`; a new
  block-driven doc must be added there too.

<!-- UNVERIFIED: per-doc data-fetch service fns vary by document; only the sales-invoice route was read in full -->

