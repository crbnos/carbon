# Unify inspection execution UI (grid+drawing as the only flow)

Date: 2026-07-25
Status: Implemented (Option B). Typecheck/lint/tests green; browser verification
pending.

## Problem

`/x/inspection/{id}` has two divergent execution screens, chosen purely by
document presence (`InspectionView.tsx:148`):

```ts
const hasDocument = pdfUrl != null && liveFeatures.length > 0;
```

- **Grid + drawing** (`hasDocument`): ballooned PDF over a features × samples
  grid (`InspectionMeasurementGrid.tsx`). Cells record measured values /
  attribute pass-fail per feature. Sample status is derived.
- **Fallback samples table** (no document): "Inspect Next Item" → scan modal in
  `mode="record"` → one Passed/Failed `inspectionSample` per scanned entity. No
  drawing, no per-feature values (`InspectionView.tsx:645-748`).

The two screens differ in **both** axes at once (the observed serial lot had no
document; the observed non-serial lot had one), which is why they look unrelated.

## Key facts established from the code

1. **The grid already scans tracked entities.** For serial lots it renders a
   `+ Sample` column whose button calls `onAddSample` → `ScanInspectionSample`
   in `mode="identify"`, creating a **Pending** sample with a `trackedEntityId`
   (`InspectionMeasurementGrid.tsx:464-479`, `InspectionView.tsx:617`,
   `ScanInspectionSample.tsx:155-158`).
2. **The grid already labels serial columns with the entity, not `1,2,3`.**
   Header = `sample?.trackedEntity?.readableId ?? \`${i+1}\`` for serial,
   plain index for non-serial (`InspectionMeasurementGrid.tsx:369-374`).
3. **The schema already supports "scanned entity + per-feature
   measurements on the same sample."** A measurement attaches to a sample by
   `inspectionSampleId`; the sample's `trackedEntityId` is orthogonal.
   `upsertInspectionMeasurement` derives the sample's status from its
   measurements and, when `sample.trackedEntityId` is set, flips that entity
   `On Hold → Available/Rejected` (`quality.server.ts:678-750`). So a serial
   part **with** a document already behaves exactly as requested.
4. Both scan modes POST the same `inspectionSampleValidator` to `$id.sample.tsx`;
   only the `status` differs (`identify` → `Pending`, `record` → `Passed/Failed`).
5. `dispositionInspection` gates per-feature when the lot has
   `inspectionSamplingPlan` rows, else lot-level on sample pass/fail counts
   (`quality.server.ts:329-379`).

**Conclusion:** the only thing making the flows feel exclusive is UI routing +
the fact that a lot with no document has no feature rows to fill a grid with.
Unification = make the grid+drawing shell the sole UI and give it a "no
features" mode; retire the fallback table and `mode="record"`.

## Target design

One component (`InspectionView` + `InspectionMeasurementGrid`) for every lot:

- **Drawing pane**: shown when `pdfUrl != null`; hidden otherwise (grid takes the
  full height). No fallback screen.
- **Rows**:
  - Document lots → the real `inspectionFeature` rows (unchanged).
  - No-document lots → a single synthetic **"Overall result"** attribute row
    (pass/fail), so there is always something to record.
- **Columns** (unchanged from today's grid):
  - Serial → one column per scanned entity, header = `readableId`; new columns
    added only via the scan step (`+ Sample`, identify mode). This is the "scan
    the part we're observing" step the user wants, applied everywhere.
  - Non-serial → anonymous numbered columns up to `sampleSize` (accepted for
    non-tracked parts).
- **Cells**:
  - Numeric feature → measured value; attribute feature → P/F toggle
    (unchanged).
  - "Overall result" row → P/F toggle that sets the **sample's** status
    directly (see D1).

Net UX: identical grid+drawing everywhere; serial parts always scan the entity
per column; non-document lots collapse to a one-row pass/fail grid instead of a
separate screen.

## D1 — How the "Overall result" row persists (DECISION NEEDED)

A no-document lot has no `inspectionFeature` / `inspectionSamplingPlan` rows, so
there is nothing for `upsertInspectionMeasurement` to attach to.

- **Option A — synthetic feature at receipt.** Materialize one implicit
  "Overall" `inspectionFeature` + `inspectionSamplingPlan` per no-document lot so
  every path (grid, measurement save, derived status, per-feature disposition
  gating) works with zero special-casing. *Downside:* `inspectionFeature` rows
  belong to an `inspectionDocument`; creating them without one is a schema smell
  and touches `post-receipt`.
- **Option B — recommended — grid renders a client-only "Overall result" row;
  its P/F cells write via the sample route** (`$id.sample.tsx`, setting the
  column's sample `Passed`/`Failed`) rather than the measurement route. Server
  stays as-is except: allow `upsertInspectionSample` to **update an existing
  sample by id** (so toggling a non-serial anonymous column is idempotent, using
  the grid's existing `sampleIdByColumn` binding). No phantom features; reuses
  the lot-level disposition path that already exists for document-less lots.

Recommendation: **Option B.** It keeps `inspectionFeature` semantically tied to
documents, adds one small server capability (sample upsert-by-id), and leans on
the derived-vs-direct status split the schema already has.

## Tasks (assuming D1 = Option B)

1. **Grid: "no features" mode.** In `InspectionMeasurementGrid.tsx`, when the lot
   has no live features, render a single "Overall result" attribute row. Its P/F
   buttons POST to `$id.sample.tsx` for the column's sample (create-on-demand for
   non-serial via the same lazy `sampleIdByColumn` pattern used for
   measurements). Mirror status locally like measurement saves.
   - Verify: no-document serial lot — scan entity, toggle Pass, column shows
     Passed, entity → Available; no-document non-serial lot — toggle Pass on
     column 1 creates one Passed sample (toggling again updates, not duplicates).

2. **Server: sample upsert-by-id.** Extend `upsertInspectionSample`
   (`quality.server.ts:108-223`) / `inspectionSampleValidator` to accept an
   optional `sampleId` and update that row's status in place (non-serial
   anonymous case). Keep serial upsert-by-`trackedEntityId` behavior.
   - Verify: `pnpm --filter erp test` for any sample tests; manual toggle twice
     yields one row.

3. **InspectionView: always render the grid shell.** Delete the fallback branch
   (`InspectionView.tsx:645-748`) and always render the drawing (if `pdfUrl`) +
   grid. Compute `hasDocument` only to decide drawing visibility and the
   feature-vs-overall row set. Drop `mode="record"`; scanning always uses
   `mode="identify"`.
   - Verify: typecheck `erp`; both lot kinds render the grid.

4. **Retire fallback-only code.** Remove `mode="record"` from
   `ScanInspectionSample.tsx` (identify-only) and the now-unused fallback samples
   table markup + `BarProgress`/manual pass-fail imports in `InspectionView`.
   - Verify: `pnpm run lint`; no dead imports.

5. **Disposition parity check.** Confirm `dispositionInspection` still gates
   correctly for no-document lots now that status comes from the "Overall result"
   row (lot-level path at `quality.server.ts:329-379` already keys off sample
   pass/fail counts when there are no plan rows — should need no change; verify).

6. **Docs.** Update `.claude/rules/inspection-system.md` (the "two execution
   flows" section) to describe the single grid UI with an optional drawing and a
   synthetic overall-result row; note `mode="record"` removed.

## Out of scope / not changing

- Sampling-plan resolution, AQL engine, receipt-time lot creation (except the
  optional Option-A path, which we are not taking).
- The already-correct document-driven serial behavior.
- MES reuse (the component stays data-prop reusable for later).

## Verification (end state)

- Serial + no document: scan entity → grid column labeled with `readableId` →
  Overall result P/F → entity releases. (Replaces screenshot-1 screen.)
- Non-serial + document: unchanged rich grid. (Screenshot 2.)
- Serial + document: unchanged rich grid, scanned columns.
- Non-serial + no document: one-row pass/fail grid, anonymous columns.
- `pnpm exec turbo run typecheck --filter=erp`, `pnpm run lint`, and browser
  e2e per `/test` on each of the four quadrants.
