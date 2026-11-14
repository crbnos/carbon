# Inspection plan parameters

Date: 2026-11-09. Branch: `barbinbrad/batch-properties-serial-traceability`
(built on top of the uncommitted manual-inspection work).

## Goal

An inspection plan carries fixed key/value parameters ("Ambient temp: 20 ±2 °C",
"Fixture: F-12"). The author edits them in the plan editor; the inspector reads
them on every execution screen.

Sibling: **procedure parameters** (`procedureParameter`, `ProcedureExplorer`,
MES `ParametersListItem`). Differences, on purpose:

- A `sortOrder` column: the editor grid keeps the author's order (procedures sort
  by key).
- Saved through the plan editor's autosave (the save route already sends the
  default sampling rule the same way), not through per-row routes: the editor
  has no Save button and must show one Saving… / Saved state.
- Read live from the plan by the lot (as characteristics are) — no snapshot on
  the inspection.

## Decisions (from the user, 2026-11-09)

1. Fixed key/value, read-only on execution.
2. ERP editor: a Parameters tab beside Characteristics, an editable grid.
3. Shown on MES job-operation and manual inspections, and on the ERP inspection view.
4. Same branch.

## Tasks

- [x] Migration `inspection-plan-parameters`: table `inspectionDocumentParameter`
      (`id` `idp`, `inspectionDocumentId`, `key`, `value` default `''`,
      `sortOrder`, `companyId`, audit; composite FK to `inspectionDocument`
      ON DELETE CASCADE; indexes). Authz `company("quality")`, shipped with
      `authz migration`. Regenerate types.
- [x] `quality.service.ts`: `getInspectionDocumentParameters(client, documentId)`
      and `replaceInspectionDocumentParameters(db, …)` (Kysely transaction:
      delete the rows not sent, upsert the sent ones scoped to the document
      and company).
- [x] `quality.server.ts` `saveInspectionDocument`: optional `parameters` (the
      full list); saved before the RPC; returned in the response.
- [x] Save route accepts `parameters`; editor loader returns them.
- [x] Editor: `Characteristics | Parameters` tabs in the bottom pane; parameter
      rows in state, sent when changed, Saving… / Saved shared with the rest.
- [x] Execution reads: ERP `x+/inspection+/$id.tsx`, MES `inspection.$operationId.tsx`
      and `manual-inspection.$id.tsx` load the lot plan's parameters.
- [x] Display: ERP `InspectionView` and MES `InspectionView` / `ManualInspectionView`
      show a Parameters control (hidden when the plan has none).
- [x] Docs: `inspection-system.md`, quality `AGENTS.md`.
- [x] Verify: scoped typecheck (erp, mes, database), biome.
- [x] Run `lingui:extract` and translate the new strings (at commit time).

## Out of scope

- Dataset seed parameters (no coverage floor added).
- Recording a measured value per lot.

## Addendum: cancel and delete a manual inspection (2026-11-09)

The user asked for these during the same session. Decisions: manual lots only;
each held entity returns to the status it had before the lot.

- [x] Migration `manual-inspection-cancel`: enum value `Cancelled`, column
      `inspectionTrackedEntity.previousStatus`.
- [x] Engine: `cancelManualInspection`, `deleteManualInspection`; `Cancelled`
      in `INSPECTION_CLOSED_STATUSES`; `dispositionInspection` refuses it.
- [x] ERP operations, routes `$id.cancel` / `$id.delete`, the list's ⋯ row menu.
- [x] Datasets: one Cancelled manual lot each.
- [x] Database tests in `manual-inspection.test.ts`.
- [x] MES queue card: no source line, assignee in a footer.
