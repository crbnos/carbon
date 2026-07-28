# Inspections refactor (generic source documents) — implementation plan

**Spec:** .ai/specs/implemented/2026-07-21-inbound-inspection-execution.md (see 2026-07-22 changelog entry)
**Branch:** feat/mes-assembly

User decisions: migrate to a new `inspection` table family; move the document
editor route; seed `INS` prefix for new companies only (existing sequences keep
their prefix/counter, re-keyed to the new table name). Assistant naming calls
(surfaced for veto): `inboundInspectionFeature` → `inspectionSamplingPlan`;
enums → `inspectionStatusType` / `inspectionSampleStatusType` (the clean names
are taken by the document system's `inspectionFeature` and the Pass/Fail step
enum `inspectionStatus`).

## Progress
- [x] Task 1: Migration — rename table family, generic source columns + backfill, sequence re-key
- [x] Task 2: Apply migration + regenerate types (validates rename against live data)
- [x] Task 3: Seed data — `inspection` sequence with INS prefix
- [x] Task 4: post-receipt edge fn — new names + source columns
- [x] Task 5: Quality module app-layer rename (models/service/server/types/barrel)
- [x] Task 6: Routes — editor → x+/inspection-document+, execution → x+/inspection+, list → quality+/inspections, redirects, path.ts
- [x] Task 7: UI — ui/Inspections rename, InspectionView, filterable Source column, nav label
- [x] Task 8: Issue associations — table/key renames ("inspections")
- [x] Task 9: Docs sync + verification (typecheck, tests, browser smoke)

## Task summaries

**Task 1 (migration `inspections-refactor`)** — all DDL guarded/idempotent:
- Table renames (via `to_regclass` DO-blocks): `inboundInspection`→`inspection`,
  `inboundInspectionSample`→`inspectionSample`, `inboundInspectionFeature`→
  `inspectionSamplingPlan`, `inboundInspectionMeasurement`→`inspectionMeasurement`,
  `inboundInspectionHistory`→`inspectionHistory`,
  `nonConformanceInboundInspection`→`nonConformanceInspection`. (RLS policies
  follow the table; old constraint/index NAMES keep their strings — documented.)
- Enum renames (pg_type-guarded): `inboundInspectionStatus`→`inspectionStatusType`,
  `inboundInspectionSampleStatus`→`inspectionSampleStatusType`.
- Column renames (information_schema-guarded): readable
  `inspection.inboundInspectionId`→`inspectionId` (nonConformance precedent:
  readable on parent, FK of same name on children); child FKs
  `inboundInspectionId`→`inspectionId` everywhere;
  `inspectionMeasurement.inboundInspectionSampleId`→`inspectionSampleId`.
- Source columns: enum `inspectionSourceDocument` ('Receipt','Job Operation');
  add `sourceDocument`, `sourceDocumentId`, `sourceDocumentLineId`,
  `sourceDocumentReadableId`; backfill from `receiptId`/`receiptLineId` + receipt
  join inside a DO-block gated on the old columns still existing; then SET NOT
  NULL (sourceDocument, sourceDocumentId), drop the receipt FKs + columns +
  `receiptLineId` unique, add partial unique `(sourceDocument, sourceDocumentLineId)
  WHERE "sourceDocumentLineId" IS NOT NULL` + indexes. No FKs on generic ids
  (matches `receipt.sourceDocument*`).
- Sequence: `UPDATE "sequence" SET "table"='inspection', "name"='Inspection'
  WHERE "table"='inboundInspection'` (existing companies keep II + counters).

**Task 3** — `seed.data.ts` sequence block: table `inspection`, name
`Inspection`, prefix `INS` (new companies only; seed-company iterates this).

**Task 4** — post-receipt: typed inserts into `inspection`/`inspectionSamplingPlan`,
`getNextSequence(trx, "inspection", companyId)` → `row.inspectionId`; payload
gains `sourceDocument:'Receipt'`, `sourceDocumentId: receiptId`,
`sourceDocumentLineId: receiptLine.id`, `sourceDocumentReadableId` (receipt
readable), drops `receiptId`/`receiptLineId`; `.returning(["id","sourceDocumentLineId"])`
joins the sampling-plan child inserts. Deno check must stay at the 71-error baseline.

**Task 5** — mechanical `inboundInspection`→`inspection` / `InboundInspection`→
`Inspection` sweep in quality module (safe: "InspectionDocument" never matches),
plus semantic fixes: `dispositionInspection` branches Receipt-only behavior
(entity lookup via `attributes->>'Receipt Line' = sourceDocumentLineId`, ledger
entry, `receiptLine.locationId`) on `sourceDocument === 'Receipt'`;
`reconcileInspectionSamplingPlans`; service renames (`getInspections` adds
`source` filter arg + `sourceDocumentReadableId` in search); models add
`inspectionSourceDocuments` const; string literals `'Inbound Inspection'` for
`itemLedger.documentType` and `trackedActivity.sourceDocument` are DB data
values and stay. Types `Inspection*` via Awaited chains.

**Task 6** — `git mv` route trees; `path.to.inspectionDocument*` URLs move to
`${x}/inspection-document/...`; execution keys `inboundInspection*`→`inspection*`
(`path.to.inspection(id)` etc.); `quality+/inspections.tsx` list; redirect stubs
at old `/x/quality/inbound-inspections`(+`/$id`) URLs.

**Task 7** — `ui/InboundInspections/`→`ui/Inspections/`; `InspectionsTable` gets
a `Source` column (enum filter options from `inspectionSourceDocuments`, shows
`sourceDocumentReadableId` as the link text where useful); nav entry label
Inspections → `path.to.inspections`, `table: "inspection"`.

**Task 8** — association const value `"inboundInspections"`→`"inspections"`;
`nonConformanceInspection` table strings; switch cases in `IssueAssociations.tsx`,
`x+/issue+/$id.tsx`, `$id.association.new.tsx`, `deleteIssueAssociation` +
`getIssueAssociations` in the service; reject route link inserts.

**Task 9** — rule file (`inbound-inspection-system.md` → renamed content/paths;
consider file rename to `inspection-system.md` with Task Router update), quality
AGENTS.md, spec changelog; verify: `pnpm exec turbo run typecheck --filter=erp`
(only the known pre-existing error), `vitest run` quality/sampling, browser
smoke (list + Source filter, execution view on existing lot, editor at
/x/inspection-document/{id}, quality tab).

Out of scope: renaming DB constraint/index name strings; `itemLedgerDocumentType`
enum value 'Inbound Inspection'; MES; `x+/production+/inspection.tsx` list URL.
