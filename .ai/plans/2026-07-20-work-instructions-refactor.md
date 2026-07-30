# Work Instructions Refactor — Implementation Plan

**Date:** 2026-07-20
**Branch:** `feat/mes-assembly`
**Author:** planning session with Brad

## Execution status (2026-07-20)

Both workstreams **implemented in the working tree (uncommitted, per no-auto-commit)**.

- **Workstream A** — migration `20260721014248_assembly-select-employee-role.sql` authored. Verified via rolled-back psql txn: before = `production_view`, after = `get_companies_with_employee_role()` on all 8 tables; clean apply, rolled back (not persisted — awaits `pnpm db:migrate`/deploy). Writes untouched; no type delta.
- **Workstream B** — full relocation done (`git mv` preserves history). Gates: `turbo typecheck --filter=erp` clean, Biome clean, relocated `inspectionDocumentSave.test.ts` 2/2 pass, grep sweep for stale quality inspection imports empty. Two move-induced fixes applied beyond the plan: list-route breadcrumb `Quality`→`Inspection Documents`, and stale `/api/quality/...` doc-comments → `/api/production/...`.
- **Remaining:** browser verification (Brad is handling) + commit (awaiting explicit go).

## Goal

Consolidate Carbon's three "work instruction" features under **Production → Work Instructions**:

1. **Assembly Instructions** — already in Production + already in the Work Instructions group. Only change: normalize their RLS `SELECT` policy.
2. **Procedures** — already in Production + already in the Work Instructions group. **No change.**
3. **Inspection Documents** — currently in the `quality` module. **Relocate the code + list/create routes into the `production` module** and surface it in the Work Instructions group, while keeping its `quality_*` permissions and RLS.

## Decisions (locked)

- **Assembly RLS:** writes are already `production_*` (no change). The 8 older `assembly*` tables gate `SELECT` on the `production_view` **permission**, while the feature's newer MES step/slide tables and the sibling `procedure` table gate `SELECT` on `get_companies_with_employee_role()`. **Normalize the 8 `assembly*` tables' `SELECT` to `get_companies_with_employee_role()`** (any employee can read) via a fix-forward migration. This is a deliberate *loosening* of read for consistency.
- **Inspection Documents:** **move everything** (service fns, validators, server/db helpers, UI, types) into `modules/production/`. Keep `requirePermissions(..., "quality")` and the `quality_*` RLS unchanged. Menu entry gated on `quality_view`.

## Non-goals / stays put

- **Inbound Inspections** and the AQL sampling plan (`itemSamplingPlan`, `inboundInspection*`, `samplingStandards.ts`) — stay in `quality`.
- Inspection **table RLS / permission strings** — unchanged (`quality_*`).
- Assembly **write** policies (`production_create/update/delete`) — unchanged.
- The neutral full-screen editor URL namespace `/x/inspection/$id` — unchanged (mirrors `/x/assembly/$id`, `/x/procedure/$id`).
- `PLAN_VERSION` / planner heuristics — untouched.

---

## Workstream A — Assembly `SELECT` policy normalization

All 8 target tables are already on `origin/main` (applied) → **new fix-forward migration**, not an in-place edit. `DROP POLICY IF EXISTS` + `CREATE POLICY` (idempotent). Recreate in the canonical style (schema-qualified, `(SELECT …)`-wrapped, `::text[]`). **Leave INSERT/UPDATE/DELETE untouched.**

Target tables (SELECT only):
`assemblyPlanJob`, `assemblyInstruction`, `assemblyInstructionStep`, `assemblyInstructionStepRequirement`, `assemblyStandardNote`, `assemblyInstructionStepMaterial`, `assemblyUnit`, `assemblyComponentMapping`.

### A1. Create the migration

```bash
pnpm db:migrate:new assembly-select-employee-role
```
(generates a properly-timestamped file — do **not** hand-pick `HHMMSS`; the generator randomizes.)

Body (repeat the block for each of the 8 tables):

```sql
-- Normalize assembly* SELECT policies from the production_view permission to
-- get_companies_with_employee_role(), matching the procedure table and the
-- feature's own newer MES step/slide tables. Writes stay production_*.

DROP POLICY IF EXISTS "SELECT" ON "public"."assemblyInstruction";
CREATE POLICY "SELECT" ON "public"."assemblyInstruction"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

-- … assemblyPlanJob, assemblyInstructionStep, assemblyInstructionStepRequirement,
--    assemblyStandardNote, assemblyInstructionStepMaterial, assemblyUnit,
--    assemblyComponentMapping — same DROP/CREATE, same USING clause.
```

**Verify:** `pnpm run generate:types` (no type delta expected — RLS-only), then the DB `SELECT` policy set for `assemblyInstruction` shows `get_companies_with_employee_role()` in its `qual`. Optional: validate via rolled-back psql txn (`supabase_admin` + `BEGIN … \i … ROLLBACK`) per the migration-rollback-validation approach — do **not** rebuild the DB.

**Expected:** every `assembly*` table's `SELECT` now uses `employee_role`; a shop-floor employee without `production_view` can read assembly instructions + steps + slides consistently.

---

## Workstream B — Relocate Inspection Documents to `production`

`~/modules/quality/*` → `~/modules/production/*`. Do it in this order so the compiler guides you.

### B1. Move the standalone feature files (git mv, verbatim)

```
apps/erp/app/modules/quality/inspectionDocumentDb.ts            → apps/erp/app/modules/production/inspectionDocumentDb.ts
apps/erp/app/modules/quality/inspectionDocumentSave.server.ts   → apps/erp/app/modules/production/inspectionDocumentSave.server.ts
apps/erp/app/modules/quality/inspectionDocumentSave.test.ts     → apps/erp/app/modules/production/inspectionDocumentSave.test.ts
apps/erp/app/modules/quality/inspectionBalloonAnalyze.ts        → apps/erp/app/modules/production/inspectionBalloonAnalyze.ts
apps/erp/app/modules/quality/inspectionBalloonAnalyze.server.ts → apps/erp/app/modules/production/inspectionBalloonAnalyze.server.ts
apps/erp/app/modules/quality/ui/InspectionDocument/            → apps/erp/app/modules/production/ui/InspectionDocument/   (all 6 files)
```

Internal relative imports (`./inspectionDocumentDb`, `./inspectionBalloonAnalyze`, `./cropInspectionAnchorToPng`, `./exportInspectionDocumentPdfWithOverlays`) stay valid after the move. What breaks and must be repointed to `~/modules/production/...`:
- `inspectionDocumentSave.server.ts` → imports the `inspectionSave*PayloadValidator`s from `./quality.models` → change to `./production.models` (after B3).
- `ui/InspectionDocument/InspectionDocumentForm.tsx:14` → `inspectionDocumentValidator` from `~/modules/quality/quality.models` → `~/modules/production/production.models`.
- `ui/InspectionDocument/InspectionDocumentEditor.tsx:47` → `BalloonRegionAnalysis` from `~/modules/quality/inspectionBalloonAnalyze` → `~/modules/production/inspectionBalloonAnalyze`.

### B2. Move service functions `quality.service.ts` → `production.service.ts`

Move these functions (they carry the whole inspection-document read/write surface):
`getInspectionDocuments`, `getInspectionDocument`, `getBalloons`, `getInspectionFeatures`, `getInspectionPlan`, `upsertInspectionDocument`, `deleteInspectionDocument`, `saveInspectionDocumentAtomic`.

Also move the supporting line from `quality.service.ts`:
```ts
import { listBalloons, listInspectionFeatures, mapBalloonIdsToFeatureIdsForDocument } from "./inspectionDocumentDb";
export { mapBalloonIdsToFeatureIdsForDocument };
```
→ into `production.service.ts` (relative path still `./inspectionDocumentDb` since that file also moved to production).

**Watch:** confirm no other quality-internal helper is referenced by the moved functions; if one is, either it's a shared util (leave the import path as `~/...`) or it must move too. `getInboundInspections` and everything below it in `quality.service.ts` **stays**.

### B3. Move validators `quality.models.ts` → `production.models.ts`

Cut `quality.models.ts` lines **106–371** (from `inspectionDocumentValidator` through `inspectionSaveAnchorsPayloadValidator`, incl. the non-exported `normalizedCoordinateValidator`/`normalizedSizeValidator`/`pageNumberValidator` helpers at 164–166) into `production.models.ts`. `gaugeValidator` (line 373) onward **stays** in quality.

These validators use `procedureStepType`. `production.models.ts` **already imports `procedureStepType`** (procedures use it) — reuse it; do **not** add a duplicate import. After cutting, `quality.models.ts` may no longer need `import { procedureStepType } from "../shared/shared.models"` — remove it there only if nothing else in the file uses it.

### B4. Split the types `quality/types.ts` → `production/types.ts`

Move the inspection-document type block (`InspectionDocument`, `InspectionDocumentDetail`, `Balloon`, `InspectionFeature`, `BalloonFeature`, `InspectionDocumentContent` — the `Awaited<ReturnType<…>>` derivations of the moved service fns, ~lines 31–60) into `production/types.ts`, repointing the `getBalloons/getInspectionDocument/getInspectionDocuments/getInspectionFeatures` imports to `./production.service`. Inbound-inspection types (~172–198) **stay** in `quality/types.ts`.

### B5. Barrels

- `apps/erp/app/modules/quality/index.ts` — **delete** line 1 `export * from "./inspectionBalloonAnalyze";`.
- `apps/erp/app/modules/production/index.ts` — **add** `export * from "./inspectionBalloonAnalyze";`.
- Create `apps/erp/app/modules/production/ui/InspectionDocument/index.ts` (copy of the quality one):
  ```ts
  export { default as InspectionDocumentForm } from "./InspectionDocumentForm";
  export { default as InspectionDocumentTable } from "./InspectionDocumentTable";
  ```
  (Editor is intentionally **not** barrel-exported — SSR/`canvas` issue; keep the deep lazy import.)
- Delete the old `apps/erp/app/modules/quality/ui/InspectionDocument/index.ts`.

### B6. Move + repoint the list/create routes (URL changes to `/x/production/…`)

```
apps/erp/app/routes/x+/quality+/inspection.tsx     → apps/erp/app/routes/x+/production+/inspection.tsx
apps/erp/app/routes/x+/quality+/inspection.new.tsx → apps/erp/app/routes/x+/production+/inspection.new.tsx
```
In both: repoint `~/modules/quality*` imports → `~/modules/production*`. **Keep** `requirePermissions(request, { view: "quality", role: "employee" })` unchanged (verified safe — `production+/_layout.tsx` has no loader/permission gate, so the leaf's quality gate is the only check; a quality-only user passes and sees the Production sidebar).

### B7. Repoint the editor + delete/save/update-name routes (URLs unchanged)

These stay at `/x/inspection/$id…` (neutral namespace) — only fix imports:
- `x+/inspection+/$id.tsx` — `getBalloons/getInspectionDocument/getInspectionFeatures` + `InspectionDocumentContent` type + the `lazy(() => import("~/modules/quality/ui/InspectionDocument/InspectionDocumentEditor"))` deep path → `~/modules/production/...`.
- `x+/inspection+/$id.save.tsx` — `saveInspectionDocumentAtomic`, the `inspectionDocumentSave.server` helpers, and the `inspectionSave*Validator`s → `~/modules/production/...`.
- `x+/inspection+/$id.delete.tsx` — `deleteInspectionDocument` → `~/modules/production`.
- `x+/inspection+/$id.update-name.tsx` — no module import (inline table write); no change beyond confirming it still gates `update: "quality"`.

### B8. API routes

- `api+/quality.inspection-document.$inspectionDocumentId.balloon-analyze.ts` → rename to `api+/production.inspection-document.$inspectionDocumentId.balloon-analyze.ts` (internal POST, single caller). Repoint its 3 imports to `~/modules/production/...`. URL becomes `/api/production/inspection-document/:id/balloon-analyze`.
- `api+/quality.inspection-plan.$id.ts` — **keep the URL** `/api/quality/inspection-plan/:id` (decided — leave as-is). It has no in-app caller and no `path.to` key, i.e. it is a raw-URL API likely consumed by an external/MES/assembler client; renaming would be a breaking change. **Do NOT rename the file** — only repoint its `getInspectionDocument, getInspectionPlan` imports to `~/modules/production`.

### B9. `apps/erp/app/utils/path.ts`

| Key | Change |
|---|---|
| `inspectionDocuments` (L1127) | `/x/quality/inspection` → `/x/production/inspection` |
| `newInspectionDocument` (L1422) | `/x/quality/inspection/new` → `/x/production/inspection/new` |
| `api.inspectionDocumentBalloonAnalyze` (L87–90) | `/api/quality/inspection-document/${id}/balloon-analyze` → `/api/production/inspection-document/${id}/balloon-analyze` |
| `inspectionDocument` (L1126), `saveInspectionDocument` (L1902), `updateInspectionDocumentName` (L2087), `deleteInspectionDocument` (L628) | **unchanged** (`/x/inspection/${id}…`) |

Then update the single caller of the balloon-analyze helper if the helper name/shape changed — `InspectionDocumentEditor.tsx:1185` `path.to.api.inspectionDocumentBalloonAnalyze(diagramId)` (name unchanged, only the produced URL changes → no code edit needed there).

### B10. Hard cutover — no redirect (decided)

**Hard cutover.** The old `/x/quality/inspection` (and `/x/quality/inspection/new`) URLs are retired outright — do **not** leave a redirect stub. After B6 removes those route files from `x+/quality+/`, the old paths 404; the Production → Work Instructions menu is the only entry point. Nothing in-app links to the old URLs (only `path.to.inspectionDocuments`/`newInspectionDocument`, both repointed in B9).

### B11. Menus

**`apps/erp/app/modules/quality/ui/useQualitySubmodules.tsx`:**
- Remove the "Inspection Documents" route object from the "Inspection" group (leaves only "Inbound Inspections").
- Remove now-unused `import { IoBalloonOutline } from "react-icons/io5";`.
- Keep the group named "Inspection" (single item). (Optional rename deferred.)

**`apps/erp/app/modules/production/ui/useProductionSubmodules.tsx`:**
- Add the permission gate to `isRouteVisible`:
  ```tsx
  if (route.permission && !permissions.can("view", route.permission)) return false;
  ```
- Add to the **Work Instructions** group's `routes` (alongside Assemblies + Procedures):
  ```tsx
  {
    name: t`Inspection Documents`,
    to: path.to.inspectionDocuments,
    icon: <IoBalloonOutline />,
    permission: "quality"
  }
  ```
- Add `import { IoBalloonOutline } from "react-icons/io5";`.

---

## Verification (run after each workstream; final full pass at the end)

1. `pnpm run generate:types` — after Workstream A's migration. Regenerate + commit `types.ts` (types regen is normal).
2. `pnpm exec turbo run typecheck --filter=@carbon/erp` — scoped typecheck (confirm the exact filter name from `apps/erp/package.json`; **never** whole-repo typecheck — OOM). Expect zero errors; the compiler surfaces any missed import repoint.
3. `pnpm run lint` — Biome.
4. `pnpm run test` — must pick up the moved `inspectionDocumentSave.test.ts` at its new path and pass.
5. Grep sweep — confirm **zero** remaining `~/modules/quality/inspection`, `~/modules/quality/inspectionBalloonAnalyze`, `~/modules/quality/inspectionDocument`, or quality-module inspection-symbol imports anywhere in `apps/erp`.
6. `/translate` — if any UI/locale strings changed (new `t\`Inspection Documents\`` in production submodules — the msgid already exists, so likely nothing to fill).
7. **Browser e2e (mandatory for the UI change)** — `crbn up`, `/auth`, `/test`: (a) Production sidebar shows **Work Instructions → Inspection Documents**; (b) it opens `/x/production/inspection` rendering the **Production** sidebar; (c) create/edit/save/delete an inspection document still works end-to-end; (d) the item is **hidden** for a user without `quality_view`; (e) Quality's "Inspection" group now shows only Inbound Inspections. Capture screenshots for the PR (net-new/surface change).

## Risks & flags

- **`inspection-plan.$id` external consumer** — **decided: leave URL-stable** (B8). Not renamed to `production.*`; only its imports move.
- **Hard cutover on old inspection URLs** — **decided** (B10): no redirect; `/x/quality/inspection` retires. Acceptable because nav is menu-driven and no in-app link targets the literal old path.
- **Permission/folder mismatch (intentional)** — moved production-module files call `requirePermissions(… "quality")`. Consistent with the `quality_*` table RLS; documented here so it's not mistaken for a bug.
- **`production.service.ts` / `production.models.ts` growth** — these already-large files gain the inspection surface. Acceptable per "move everything"; keep the moved blocks contiguous and clearly sectioned.
- **Redirect vs hard cutover** (B10) — decide whether stale `/x/quality/inspection` bookmarks must keep working.
- **Docs/glossary** — check `packages/glossary/src/terms.ts` (already modified on this branch) + curated docs for any "Inspection Document" module association that should now read "Production"; update to keep docs in sync.

## Commit / PR

- Two logical commits (Workstream A migration; Workstream B relocation) on `feat/mes-assembly`, or split into a follow-up PR — Brad's call. No auto-commit; commit only on explicit ask via the check-and-commit gate.
- PR surfaces the design change (feature moved modules) + browser screenshots.
