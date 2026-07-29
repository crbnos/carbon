# Plan: Issue additional (non-BOM) parts from the Assembly view

**Date:** 2026-07-25
**Branch:** feat/mes-assembly
**Files:** `apps/mes/app/components/AssemblyView.tsx`, `apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx`, `apps/mes/app/routes/x+/issue.tsx`, `apps/mes/app/services/models.ts`, `packages/database/supabase/functions/issue/index.ts`

## Goal

In the MES **Assembly view** (`AssemblyView.tsx`), give the operator the same ability the
standard Job Operation view has: **issue an additional part that isn't on the bill of
material**. The added part must then appear in the **Parts** section of the *step/unit it
was added on*, rendered as **X/0** (issued / required, where required is 0 because it's
unplanned).

## What already exists (no work needed)

- `IssueMaterialModal` is **already wired** into `AssemblyView` (line ~1982). Opening it
  with `selectedMaterial = null` → `material={undefined}` puts the modal into
  "pick any item" mode (the same mode `JobOperation`'s "Issue Material" button uses).
  The `issue` edge function already **creates a new `jobMaterial` on the fly** when
  `materialId` is absent, for both the untracked (`partToOperation`) and tracked
  (`trackedEntitiesToOperation`) paths. So the item-picker + create-material flow is done.
- The `jobMaterialStep` join table (material ↔ step) already exists
  (`20260705143722_mes-assembly-view.sql`). **No migration needed.**

## The two gaps to close

1. **No button** in the Assembly Parts section to open the modal in "add" mode.
2. An unplanned part currently becomes an **unscoped "General" material** (it renders on
   step 1 only, not the step it was added on) and its **X/0 renders wrong** (shows `×0`
   with issued=0) because:
   - The `issue` function never inserts a `jobMaterialStep` link when it creates a
     material on the fly, so `jobOperationStepIds` comes back empty → "General".
   - `getIssuedForUnit` caps issued at `Math.min(required, …)`; with `required === 0`
     that forces `issued = 0`. And the loose-part backflush override sets it to `0`.

## Design decisions (flag for veto)

- **Scope the added part to the current step.** Plumb `jobOperationStepId` through the
  untracked issue path and have the `issue` function insert a `jobMaterialStep` row
  whenever it creates a material on the fly *and* a step id is present. This is what makes
  it show "for that step" and (as a side effect) removes the loose-part override so X/0
  renders correctly. Opt-in: `JobOperation`'s untracked flow sends no step id, so its
  behavior is unchanged.
- **Render an unplanned part (`required === 0`, `issued > 0`) as emerald `X/0 ✓`** plus a
  subtle outline **"Added"** badge to distinguish it from BOM lines. (Alternative: neutral
  muted `X/0`. Amber "partially issued" would be misleading — there's nothing outstanding.)
- **An unplanned (required 0) tracked part must never gate step completion.** Exclude
  `required === 0` from `pendingScanMaterials`.
- **Button style:** compact `IconButton` (`LuPlus`, `variant="ghost"`, `size="sm"`,
  `aria-label="Issue material"`) in the Parts section header — fits the 280–320px sidebar
  better than `JobOperation`'s full-width `size="lg"` button.
- **Per-unit for untracked extras:** untracked `quantityIssued` is job-wide, so a
  multi-unit build shows the same total on step N of every unit. Acceptable for ad-hoc
  parts; noted, not solved.

---

## Tasks

### Task 1 — Add the "Add part" button to the Assembly Parts section

`apps/mes/app/components/AssemblyView.tsx`

- Add an optional `action?: React.ReactNode` prop to `SidebarSection` (~line 2387) and
  render it right-aligned in the header (`flex items-center justify-between`).
- Restructure the Parts block (~lines 1821-1852) so the `SidebarSection title="Parts"`
  **always renders with the action**, showing the rows when present and the
  "No materials assigned" text otherwise (so the button exists even on a step with no
  parts).
- Action = `IconButton` with `LuPlus`; onClick: `setSelectedMaterial(null); issueModal.onOpen();`
  (no `flushSync` needed — the modal is conditionally mounted and reads the null value on
  the next render; `onClose` already resets `selectedMaterial` to null).
- Import `LuPlus` from `react-icons/lu`.

**Verify:** `pnpm exec turbo run typecheck --filter=@carbon/mes` passes. Browser: an
"add" (+) control appears in the Parts header on every step.

### Task 2 — Fix the issued/required derivation & display for unplanned parts

`apps/mes/app/components/AssemblyView.tsx`

- `getIssuedForUnit` (~line 2429): when `required === 0`, return `issued = totalIssued`
  (skip the `Math.min(required, …)` cap that otherwise forces 0). Keep
  `fullyIssued = required > 0 && issued >= required` (extras are never "fully issued").
- `MaterialRow` (~line 2453): add an `isExtra = required === 0` branch. When
  `isExtra && issued > 0`, render emerald `{issued}/{required}` with `LuCheck` and an
  emerald status dot; add an outline **"Added"** badge. When `isExtra && issued === 0`,
  fall back to neutral `×0`.
- `pendingScanMaterials` (~line 817): add `v.state.required > 0` to the filter so a
  required-0 tracked extra never blocks step completion.

**Verify:** typecheck passes. (Full visual proof in Task 6.)

### Task 3 — Plumb `jobOperationStepId` through the untracked issue path

- `IssueMaterialModal.tsx` untracked `ValidatedForm` (~lines 1165-1291): add
  `<Hidden name="jobOperationStepId" value={jobOperationStepId ?? ""} />` (the prop is
  already received by the modal).
- `apps/mes/app/services/models.ts` `issueValidator` (~line 111): add
  `jobOperationStepId: zfd.text(z.string().optional())`.
- `apps/mes/app/routes/x+/issue.tsx` action: read `jobOperationStepId` from the validated
  data and add it to the `functions.invoke("issue", { body: { … } })` body (~lines 80-91).

**Verify:** `pnpm exec turbo run typecheck --filter=@carbon/mes` passes.

### Task 4 — Insert the `jobMaterialStep` link when the `issue` function creates a material

`packages/database/supabase/functions/issue/index.ts`

- Add `jobOperationStepId?: string` to the `partToOperation` payload validator (~line 826).
- **Untracked** (`partToOperation`, new-material insert ~lines 1528-1546): after inserting
  the `jobMaterial` (capture its `id`), if `jobOperationStepId` is present, insert into
  `jobMaterialStep` `{ jobMaterialId, jobOperationStepId }` with
  `.onConflict((oc) => oc.doNothing())`.
- **Tracked** (`trackedEntitiesToOperation`, new-material insert ~lines 2012-2032):
  `jobOperationStepId` already reaches this case; after creating the material (it already
  `.returning("id")`), insert the same `jobMaterialStep` link (guarded on
  `jobOperationStepId` present, `onConflict doNothing`).
- Both inserts run inside the existing Kysely transaction. `jobMaterialStep` has no
  `companyId` (RLS reaches company via the parent `jobMaterial`) — only the two FK columns.

**Verify:** the function is exercised via the app in Task 6 (edge functions run in the
local `edge-runtime` container, live-mounted — no deploy step). Sanity: `pnpm run lint`.

### Task 5 — Ensure the view refreshes after an add

`apps/mes/app/components/AssemblyView.tsx`

- The untracked path submits via navigation `ValidatedForm` and the tracked path via
  `fetcher.submit`; both trigger a React Router revalidation of the Assembly loader, which
  re-runs `getJobMaterialsByOperationId` and returns the new material with its
  `jobOperationStepIds`. Confirm this in Task 6.
- If (and only if) revalidation proves flaky, add a `jobMaterial` subscription to the
  existing `useRealtimeChannel` (~line 532). Do **not** add it speculatively.

### Task 6 — Browser verification (mandatory)

Use `/auth` + agent-browser against the running dev stack (`crbn up`).

- Open an Assembly operation. On a middle step (e.g. step 3), click the new **+** in Parts.
- **Untracked item:** pick a non-tracked part, issue qty 2. Confirm it appears in Parts on
  step 3 (not step 1) as **`2/0`** (emerald, "Added" badge) and that step 3 can still be
  completed.
- **Tracked item:** pick a serial/batch part, scan/select, confirm it shows scoped to the
  step and does **not** block completion.
- Navigate to another step and confirm the added part is **not** shown there.
- Screenshot both states for the PR (net-new UI).

**Verify:** all of the above; capture screenshots to `.ai/scratch/e2e/` for the PR body.

---

## Out of scope / notes

- No DB migration (`jobMaterialStep` already exists).
- Per-unit attribution for untracked extras on multi-unit builds is job-wide (noted above).
- `JobOperation`'s behavior is unchanged: it never passes `jobOperationStepId` on the
  untracked path, so no link is created there.

## Risk

- Editing the shared `issue` edge function: change is guarded by `jobOperationStepId`
  presence **and** the new-material branch, so BOM issuing and `JobOperation` are untouched.
- `onConflict doNothing` keeps the link insert idempotent under the deploy runner's retry.
