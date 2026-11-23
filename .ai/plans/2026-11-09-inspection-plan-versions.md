# Inspection plan versions

Date: 2026-11-09. Branch: `barbinbrad/batch-properties-serial-traceability`.

## Goal

An inspection plan (`inspectionDocument`) has versions, as procedures and quality
documents do: Draft / Active / Archived, only a Draft is editable, New Version
copies the plan into a Draft numbered one higher, Publish makes it Active and
archives the version that was Active.

Siblings: **procedures** and **quality documents** (status, `VersionMenu`, the
`V{n}` badge, the New Version flow) and **assembly instructions** (row-per-version
grouped by a root id, Kysely copy, activation that repoints references).

## Decisions (from the user, 2026-11-09)

1. Publishing a version repoints the item Receipt assignments
   (`itemInspectionDocumentAssignment`) and method operations
   (`methodOperation.inspectionDocumentId`) from the other versions to it. Job
   operations, quote operations and existing lots keep their version.
2. New plans start Draft (made by hand and by the PMI job). Existing plans become
   Active so receipts and jobs keep working.
3. No approval gate.
4. Same branch.

Lineage: `inspectionDocument.name` is nullable and renamable, so versions are
grouped by `rootInspectionDocumentId` (NULL = the root), as assembly instructions
are, not by name as procedures are.

## Tasks

- [x] Migration `inspection-plan-versions`: enum `inspectionDocumentStatus`
      (Draft, Active, Archived); `status` (default Draft), backfill Active;
      `rootInspectionDocumentId` self FK (ON DELETE SET NULL) + index; the PMI
      unique index covers roots only; recreate `inspectionDocuments` and
      `inspectionPlanParts` (one plan per version group, latest version, with
      `version`, `status`, `versions`). Regenerate types.
- [x] `@carbon/database/quality` `createPmiInspectionPlan`: ON CONFLICT matches
      the new index predicate.
- [x] `quality.service.ts`: `getInspectionDocumentVersions`,
      `copyInspectionDocumentAsVersion(db, …)` (one transaction: plan row,
      features, balloons, parameters), `activateInspectionDocumentVersion(db, …)`
      (one transaction: lock the group, archive the Active sibling, activate,
      repoint assignments and method operations), delete re-roots the siblings
      of a deleted root and keeps a PDF another version uses.
- [x] `quality.server.ts`: `createInspectionDocumentVersion`,
      `activateInspectionDocumentVersion`; every plan write refuses a version
      that is not Draft (`saveInspectionDocument`, `setInspectionDocumentName`,
      `attachInspectionDocumentModel`, `updateInspectionDocumentSampling`,
      `saveInspectionDocumentAtomic`, `upsertInspectionDocument` update).
- [x] Routes `x+/inspection-document+/$id.version.tsx` and `$id.activate.tsx`;
      path helpers.
- [x] Editor: `V{n}` badge, status, Publish / Reactivate, `VersionMenu` with New
      Version; a non-Draft version is read-only.
- [x] List: the expanded part row shows each plan's latest version with its
      version and status. Picker shows version and status.
- [x] Datasets: seeded plans Active (no coverage floor added).
- [x] Docs: `inspection-system.md`, quality `AGENTS.md`.
- [x] Verify: scoped typecheck (erp, mes, database, jobs), biome, tests,
      `db:check:datasets`, `db:check:backups`.
- [x] Translate the new strings and commit (at commit time).
