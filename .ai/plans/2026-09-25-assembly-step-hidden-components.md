# Assembly step hidden components — implementation plan

**Spec / source:** `.ai/specs/2026-09-25-assembly-step-hidden-components.md`
**Branch:** `feat/asembly-view-isolation`
**Worktree root:** `/Users/aashu/work/carbon/carbon-feat-asembly-view-isolation`
(run every command from here)

## Progress
- [x] Task 1: Add the `hiddenComponentNodeIds` column, apply it, regenerate DB types
- [x] Task 2: Viewer — per-step hidden set (type, pure helper + test, scene wiring)
- [x] Task 3: ERP data layer — validator, service, strip-on-add, route, path, `toViewerStep`
- [x] Task 4: MES — read and pass the hidden lists
- [x] Task 5: ERP editor state — draft + autosave in `$id.tsx`, thread through the explorer
- [x] Task 6: ERP Components panel — eye edits the selected step's saved list
- [x] Task 7: ERP step Details — "Hidden on this step" list
- [x] Task 8: Translations, typecheck, lint, tests
- [ ] Task 9: End-to-end verification against the local stack

## Dependencies
Task 2 and Task 3 need Task 1. Task 4 needs Tasks 1–2. Task 5 needs Tasks 2–3.
Tasks 6 and 7 need Task 5 and are independent of each other. Task 8 needs 1–7.
Task 9 needs 8.

---

## Task 1: Add the column, apply it, regenerate DB types

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_assembly-step-hidden-components.sql`
- Modify (generated): database type output files written by `pnpm db:types`
- Copy from (precedent): `packages/database/supabase/migrations/20260910093006_assembly-step-lineage.sql`

**Steps:**
1. `pnpm db:migrate:new assembly-step-hidden-components` (creates the timestamped file).
   If the generated file is not in `packages/database/supabase/migrations/`, STOP and report.
2. File contents:
   ```sql
   -- Per-step hidden components: nodeIds (same id space as "componentNodeIds")
   -- the author hides on THIS step only — tooling, fixtures, or installed parts
   -- blocking the view. Applied by the 3D player in the ERP editor and in MES.
   -- Never contains the step's own "componentNodeIds" (stripped on write).
   ALTER TABLE "assemblyInstructionStep"
     ADD COLUMN IF NOT EXISTS "hiddenComponentNodeIds" TEXT[] NOT NULL DEFAULT '{}';
   ```
3. `pnpm db:migrate`, then `pnpm db:types`.

**Verify:**
```bash
docker exec carbon-carbon-feat-asembly-view-isolation-postgres-1 psql -U postgres -d postgres -At -c "select data_type, column_default from information_schema.columns where table_name='assemblyInstructionStep' and column_name='hiddenComponentNodeIds';"
# Expected: ARRAY|'{}'::text[]
git grep -c "hiddenComponentNodeIds" -- packages/database/src
# Expected: at least one file with a non-zero count
```
**Out of scope:** RLS policies (the table's existing policies cover the new column), `jobOperationStep`.

## Task 2: Viewer — per-step hidden set

**Depends on:** 1
**Files:**
- Modify: `packages/viewer/src/types.ts` — `AssemblyStep` gains `hiddenComponentNodeIds?: string[]` with a doc comment.
- Modify: `packages/viewer/src/visibility.ts` — add `stepHiddenNodeIds`.
- Modify: `packages/viewer/src/visibility.test.ts` — tests for it.
- Modify: `packages/viewer/src/AssemblyPlayer.tsx` — scene `hiddenSet` memo.
- Copy from (precedent): `visualForComponent` in `packages/viewer/src/visibility.ts` and its tests.

**Steps:**
1. In `visibility.ts`:
   ```ts
   /**
    * The nodeIds to hide while `step` is active: the always-hidden set plus the
    * step's own authored hidden list, never including the parts the step itself
    * installs (a step must not animate an invisible part).
    */
   export function stepHiddenNodeIds(
     alwaysHidden: readonly string[] | undefined,
     step: Pick<AssemblyStep, "componentNodeIds" | "hiddenComponentNodeIds"> | null
   ): Set<string> {
     const hidden = new Set(alwaysHidden ?? []);
     for (const nodeId of step?.hiddenComponentNodeIds ?? []) hidden.add(nodeId);
     for (const nodeId of step?.componentNodeIds ?? []) hidden.delete(nodeId);
     return hidden;
   }
   ```
   Import `AssemblyStep` as a type from `./types`.
2. Tests: step list added; own parts removed even when also in `alwaysHidden`; `null` step returns only `alwaysHidden`; undefined inputs return an empty set.
3. In the scene component of `AssemblyPlayer.tsx`, replace the `hiddenSet` memo (currently `new Set(hiddenNodeIds ?? [])`, near line 1020) with
   `useMemo(() => stepHiddenNodeIds(hiddenNodeIds, activeStep), [hiddenNodeIds, activeStep])`.
   `activeStep` is defined earlier in the same component (`steps[activeStepIndex] ?? null`, near line 988). If it is not in scope at that point, STOP and report.

**Verify:**
```bash
pnpm --filter @carbon/viewer test -- visibility
# Expected: all visibility tests pass, including the new stepHiddenNodeIds cases
pnpm --filter @carbon/viewer typecheck
# Expected: exit 0
```
**Out of scope:** the `hiddenNodeIds` prop's contract (kept), isolate/focus logic, ghost modes.

## Task 3: ERP data layer

**Depends on:** 1
**Files:**
- Modify: `apps/erp/app/modules/production/production.models.ts` — add after `assemblyInstructionStepComponentsValidator`:
  `export const assemblyInstructionStepHiddenComponentsValidator = z.object({ hiddenComponentNodeIds: jsonField(z.array(z.string())) });`
- Modify: `apps/erp/app/modules/production/production.service.ts`:
  - New `updateAssemblyStepHiddenComponents(client, { id, hiddenComponentNodeIds, updatedBy })`: select the step's `componentNodeIds`; compute `[...new Set(hidden)].filter(id => !own.has(id))`; update only `hiddenComponentNodeIds`, `updatedBy`, `updatedAt`; `.select("id").single()`. Place it right after `updateAssemblyStepComponents`.
  - `updateAssemblyStepComponents`: also select the step's current `hiddenComponentNodeIds` first, and write `hiddenComponentNodeIds: hidden.filter(id => !newComponents.has(id))` in the same update.
  - `reassignAssemblyStepComponents`: select `hiddenComponentNodeIds` alongside `componentNodeIds`; in the per-step update (the `.set({ componentNodeIds: next, ... })` call), also set `hiddenComponentNodeIds` to the current hidden list minus `next`'s members. Keep the no-op skip, but do not skip when the hidden list would change.
  - `toViewerStep` (near line 9241): add `hiddenComponentNodeIds: step.hiddenComponentNodeIds ?? []`.
  - Export the new function from the module index the same way `updateAssemblyStepComponents` is exported (check `apps/erp/app/modules/production/index.ts`).
- Modify: `apps/erp/app/utils/path.ts` — next to `assemblyInstructionStepComponents`, add
  `assemblyInstructionStepHiddenComponents: (id: string, stepId: string) => generatePath(\`${x}/assembly/${id}/steps/hidden/${stepId}\`)`, matching the neighbour's exact form.
- Create: `apps/erp/app/routes/x+/assembly+/$id.steps.hidden.$stepId.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/assembly+/$id.steps.components.$stepId.tsx`

**Steps:**
1. The route mirrors the precedent: `assertIsPost`, `requirePermissions(request, { update: "production" })`, validate with the new validator, call `updateAssemblyStepHiddenComponents`, flash `error(..., "Failed to update hidden components")` on failure, return `{ success: true }`. No material sync.

**Verify:**
```bash
pnpm --filter erp typegen && pnpm --filter erp typecheck
# Expected: exit 0
```
**Out of scope:** `jobOperationStep` sync, `copyAssemblyInstructionAsVersion` (spreads all columns already), step regenerate.

## Task 4: MES — read and pass the hidden lists

**Depends on:** 1, 2
**Files:**
- Modify: `apps/mes/app/services/operations.service.ts` — add `hiddenComponentNodeIds` to the playback step select (near line 640).
- Modify: `apps/mes/app/components/AssemblyView.tsx` — `AssemblyPlayback` step type gains `hiddenComponentNodeIds: string[] | null`; `toViewerStep` maps `hiddenComponentNodeIds: step.hiddenComponentNodeIds ?? []`.

**Verify:**
```bash
pnpm --filter mes typecheck
# Expected: exit 0
```
**Out of scope:** any MES UI control.

## Task 5: ERP editor state

**Depends on:** 2, 3
**Files:**
- Modify: `apps/erp/app/routes/x+/assembly+/$id.tsx`
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionExplorer.tsx` — thread props to `AssemblyBomTree`.
- Copy from (precedent): the `draftComponentNodeIds` + `componentsFetcher` + `saveComponentNodeIds` pattern in `$id.tsx`.

**Steps:**
1. Remove the `hiddenNodeIds` state and stop passing `hiddenNodeIds` to `AssemblyPlayer`.
2. Add `draftHiddenNodeIds: string[] | null` state, reset to `null` in `onSelectStep` next to `setDraftComponentNodeIds(null)`.
3. Add `hiddenFetcher` + `saveHiddenNodeIds(stepId, nodeIds)` posting `hiddenComponentNodeIds` (JSON) to `path.to.assemblyInstructionStepHiddenComponents(id, stepId)`.
4. `selectedHiddenNodeIds = draftHiddenNodeIds ?? selectedStep?.hiddenComponentNodeIds ?? []` and `selectedOwnNodeIds = draftComponentNodeIds ?? selectedStep?.componentNodeIds ?? []`.
5. `onSetHiddenComponents(nodeIds: string[])`: no-op when `isDisabled` or no `selectedStep`; drops own ids; sets draft; saves.
6. When the components draft changes (in `onSelectComponents` add-mode and in `onRemoveComponents`), if any added node is in `selectedHiddenNodeIds`, also set the hidden draft to exclude it. The server does the same, so no second save is needed.
7. `viewerSteps`: map with `toViewerStep`, then for the selected step override `hiddenComponentNodeIds` with `selectedHiddenNodeIds`, so the viewer updates instantly.
8. Explorer: replace the `onHideComponents` prop with `hiddenNodeIds: string[]`, `ownNodeIds: string[]`, `hasSelectedStep: boolean`, and `onSetHiddenComponents: (nodeIds: string[]) => void`, passed straight to `AssemblyBomTree`.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: errors only in AssemblyBomTree.tsx and AssemblyInstructionProperties.tsx about the new props (fixed in Tasks 6–7), or exit 0 if those were done first
```
**Out of scope:** isolate/focus behaviour (unchanged).

## Task 6: ERP Components panel

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyBomTree.tsx`
- Copy from (precedent): the existing eye `IconButton` + `Tooltip` usage in the same file.

**Steps:**
1. Props: replace `onHideComponents` with `hiddenNodeIds`, `ownNodeIds`, `hasSelectedStep`, and `onSetHiddenComponents`. Replace the local `hiddenNodeIds` state and its push-up effect with `useMemo(() => new Set(hiddenNodeIds))`. Add `ownSet` the same way.
2. `canHide = hasSelectedStep && !isDisabled`.
3. `onToggleHide(nodes)`: `const eligible = nodes.filter(n => !ownSet.has(n))`; if empty or `!canHide`, return. If every eligible node is hidden, remove them, otherwise add them. Then call `onSetHiddenComponents([...next])`.
4. `onHideSelection`: add the selection minus own ids, then clear the selection as today. `onShowAll`: `onSetHiddenComponents([])`.
5. Add a local `HideToggle` component used by all four row types (`UnitListRow`, `UnitChildRow`, `InstanceRow`, `ComponentRow`) in place of their eye `IconButton`. Props: `label`, `hidden` state, `disabledReason?: string`, `onToggle`. When `disabledReason` is set, render the button disabled inside a `Tooltip` with that text.
6. Per row: `disabledReason` =
   - `t\`Select a step to hide parts on it.\`` when `!hasSelectedStep`
   - `undefined`, button disabled with no tooltip, when `isDisabled`
   - `t\`Installed on this step, so it can't be hidden here.\`` when every node of the row is in `ownSet`
7. The toolbar "Hide selected components" button and context-menu item are disabled unless `canHide`. The "Show all hidden components" controls are disabled unless `canHide && hiddenNodeIds.length > 0`. Translate the labels you touch with `t`/`<Trans>` via `useLingui` from `@lingui/react/macro` (precedent: `apps/erp/app/modules/production/ui/Jobs/JobBillOfMaterial.tsx:30`).

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: no errors in AssemblyBomTree.tsx
```
**Out of scope:** unit/mapping features, untouched strings in the file.

## Task 7: ERP step Details — "Hidden on this step"

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionProperties.tsx`
- Modify: `apps/erp/app/routes/x+/assembly+/$id.tsx` — pass the new props.
- Copy from (precedent): `StepComponentsEditor` in the same file (grouped rows via `groupComponentNodeIds`, list styling, row click selects).

**Steps:**
1. New props on `AssemblyInstructionProperties`: `hiddenNodeIds: string[]` and `onSetHiddenComponents: (nodeIds: string[]) => void`. Thread them to wherever `StepComponentsEditor` is rendered (both call sites, near lines 214 and 591).
2. New `StepHiddenComponentsEditor` rendered right below `StepComponentsEditor`:
   - Header label: `<Trans>Hidden on this step</Trans>`, plus a "Show all" button (`<Trans>Show all</Trans>`), shown when the list isn't empty and not `isDisabled`.
   - Rows: `groupComponentNodeIds(hiddenNodeIds, graphIndex)`. Clicking a row calls `onSelectComponents(group.nodeIds)`. An eye `IconButton` with `aria-label={t\`Show ${group.name}\`}` calls `onSetHiddenComponents(hidden minus group.nodeIds)`, hidden when `isDisabled`.
   - Empty text: `<Trans>Nothing hidden. Use the eye in the Components panel to hide parts on this step.</Trans>`.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: exit 0
```
**Out of scope:** changing `StepComponentsEditor`.

## Task 8: Translations, typecheck, lint, tests

**Depends on:** 1–7
**Steps:**
1. `pnpm lingui:extract`, then `pnpm lingui:compile`.
2. `pnpm --filter @carbon/viewer typecheck`, `pnpm --filter erp typecheck`, `pnpm --filter mes typecheck`.
3. `pnpm exec biome check` on the changed files only (list them with `git diff --name-only`, plus untracked files).
4. `pnpm --filter @carbon/viewer test`.

**Verify:**
```bash
git diff --stat -- '*.po' | tail -1
# Expected: the catalogs changed (new msgids present)
grep -rn "Hidden on this step" apps/erp/locales 2>/dev/null | head -1 || git grep -n "Hidden on this step" -- '*.po' | head -1
# Expected: one match
```
**Out of scope:** fixing pre-existing lint warnings in untouched code.

## Task 9: End-to-end verification

**Depends on:** 8
**Steps (local stack; the ERP dev server must be restarted by the user if it doesn't pick up the new route):**
1. Pick the "engine with piston" instruction (`daqc4a80a0gij77qs4sg`). Choose a step S with components and a node N that is not one of S's components.
2. Sign in as the local dev-bypass user (POST `/login` with that user's email; the email must match `DEV_BYPASS_EMAIL`, compared without printing it). Then POST `hiddenComponentNodeIds=["N", <one of S's own ids>]` to `/x/assembly/<id>/steps/hidden/<S>`.
3. The DB row for S has `hiddenComponentNodeIds = {N}`, with the own id stripped (criterion 2).
4. POST S's components plus N to the components route. S's hidden list becomes empty (criterion 6). Restore S's components afterwards.
5. Criterion 7 (version copy keeps the list) is checked by reading code, not by creating a version: confirm `copyAssemblyInstructionAsVersion` still selects `*` from `assemblyInstructionStep` and spreads each row. Record it in the report as verified by code reading.
6. Screenshot the ERP editor with step S selected via Playwright (the headless tooling in the scratchpad), confirming the "Hidden on this step" box lists N and the part is not drawn (criteria 1, 3).
7. Delete the session cookie file afterwards.

**Verify:** the DB queries in steps 3–4 return the expected arrays; the screenshot shows the list.
**Out of scope:** MES screenshot (MES needs a job operation linked to the instruction; covered by the playback query + shared player code and typecheck. Report this as not verified in a browser).
