# Label templates per label type and media size

## Context

Today each printer route has one BinderyPress `templateId`
(`printerRoute.templateId`, migration `20260509000000_printer-template-id.sql`).
The print task (`packages/jobs/src/inngest/functions/tasks/print-job/index.tsx`)
sends that one template for **every** label the printer prints, so a printer that
prints serial labels and kanban cards renders both with the same template.

Decisions from the user:

- Templates are **company-wide**, set **per label type and per media size**
  (e.g. a 4x2 kanban card, a 3x2 kanban card, a 2x1 serial label). A company
  can have as many combinations as it wants.
- Serial and batch labels get **separate** label types.
- **Breaking change is OK** (printing is in beta): drop `printerRoute.templateId`,
  no data migration.

## Design

**Label types** (template slots), in `packages/printing/src/registry.ts`:

| Label type | Comes from document type | Rule |
|---|---|---|
| `serialLabel` | `productLabel` | item `trackingType === "Serial"` (also picking-list travelers) |
| `batchLabel` | `productLabel` | any other tracking type |
| `kanbanCard` | `kanbanCard` | — |
| `storageUnitLabel` | `storageUnitLabel` | — |

Add `labelTemplateTypes` (id + display name), `LabelTemplateType`, and
`getLabelTemplateType(doc: PrintableDocumentItem)`. The document-type registry and
built-in renderers do not change.

**Resolution at print time**: the printer gives the media size. For each
rendered doc: template = company `labelTemplate` row with the doc's label type and
the printer's `mediaSizeId`. Found + `BINDERY_PRESS_API_KEY` set → BinderyPress
(printer's format). Else built-in renderer, as today. No printer / no media size →
built-in. One query per print job (load the company's rows for that media size
once, into a `Map<labelType, templateId>`).

**Media sizes**: unchanged. New sizes were dropped from scope (2026-11-16): a `letter` entry in
`labelSizes` collided with the `kanbanLabelSize` letter sheet.

## Tasks

1. **Migration** `pnpm db:migrate:new label-templates`:
   - `CREATE TABLE "labelTemplate"`: `id text DEFAULT id('lt')`, `companyId` (FK
     company, cascade), `labelType text NOT NULL CHECK IN (serialLabel, batchLabel,
     kanbanCard, storageUnitLabel)`, `mediaSizeId text NOT NULL`, `templateId text
     NOT NULL`, `createdBy/createdAt/updatedBy/updatedAt`, `PRIMARY KEY (id, companyId)`,
     `UNIQUE (companyId, labelType, mediaSizeId)`, RLS enabled, no policies.
   - `ALTER TABLE "printerRoute" DROP COLUMN "templateId"`.
   - Policies: `labelTemplate: company("printing", { read: "printing_view" })` in
     `packages/database/src/authz/manifest.ts` (copy `printerRoute`), then the
     authz migration step per `.claude/rules/authz-manifest.md`.
   - `pnpm db:migrate`, `pnpm run generate:types`.
2. **`@carbon/printing`**:
   - `registry.ts`: label types + `getLabelTemplateType`.
   - `service.ts`: `getLabelTemplates`, `upsertLabelTemplate`, `deleteLabelTemplate`,
     `getLabelTemplateMap(client, companyId, mediaSizeId)`; remove `templateId` from
     route select/upsert.
   - `models.ts`: `labelTemplateValidator` (labelType enum, mediaSizeId from
     `labelSizes`, templateId required); drop `templateId` from `printerRouteValidator`.
   - `types.ts` / `cache.server.ts`: drop `templateId` from `PrinterRoute` and
     `CachedPrinterConfig`.
3. **Print task** (`print-job/index.tsx`): drop `templateId` from explicit-route
   select and config; in `create-print-jobs` load `getLabelTemplateMap` once when the
   printer has a media size; in `processDocumentType` pick the template per doc via
   `getLabelTemplateType`. Failure message for no-renderer cases names label type +
   media size.
4. **ERP service fns** (`apps/erp/app/modules/settings/settings.server.ts`):
   `saveLabelTemplate`, `removeLabelTemplate` (permission `settings`, like
   `savePrinterRoute`); drop `templateId` from `savePrinterRoute`.
5. **Settings UI** (sibling: `PrintersCard` + `printing.$id.delete.tsx`):
   - New `ui/Printing/LabelTemplatesCard.tsx`: table (Label type, Media size,
     Template ID), Add/Edit modal (Select label type, Select media size, Input
     template ID), delete via `ConfirmDelete`.
   - `routes/x+/settings+/printing.tsx`: load templates; add `upsertLabelTemplate`
     intent to the discriminated union; render the card after `PrintersCard`.
   - New `routes/x+/settings+/printing.templates.$id.delete.tsx`.
   - Remove the Template ID input from `PrintersCard`.
   - Lingui strings; `/translate` at the end.
6. **Seeds**: `packages/database/src/seed-printing.ts` — drop `templateId` from the
   route insert; insert a `labelTemplate` row (`serialLabel`, `label2x1`,
   `carbon:product-label-2x1`). Check datasets for `templateId` (none found so far).
7. **Docs**: `.claude/rules/printing-system.md`, `packages/printing/AGENTS.md`,
   `docs/content/docs/reference/printing.mdx` (Template section + the
   "requires a BinderyPress template" troubleshooting entry).
8. Save this plan to `.ai/plans/2026-11-16-label-templates.md`; SPDX headers via
   `pnpm --filter @carbon/checks license-headers`.

## Verification

- `pnpm exec turbo run typecheck --filter=@carbon/printing --filter=@carbon/jobs --filter=@carbon/utils`, then the `erp` typecheck once (main agent only).
- `pnpm run lint`; existing tests: `pnpm --filter @carbon/documents test` (label
  sizes), `pnpm --filter @carbon/jobs test` if print-job tests exist; add a unit test
  for `getLabelTemplateType` (serial vs batch vs kanban).
- `pnpm --filter @carbon/checks clobbers`, `pnpm db:check:datasets`,
  `pnpm db:check:backups` (dropped column).
- Browser (`/test`, with your OK): Settings → Printing → add a 4x2 Kanban Card
  template and a 2x1 Serial template; print a kanban card and a serial receipt label
  to a 2x1 printer; in Print Jobs confirm the serial label used the template and the
  kanban card used the built-in renderer.
