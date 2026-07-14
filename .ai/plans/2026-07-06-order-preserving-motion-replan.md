# Plan: order-preserving "Re-run Motion Planning" (forward-collision re-motion)

Status: **APPROVED — executing (2026-07-07).** Open questions resolved by the
user: (1) preserve **Done** steps only — recompute manual ones; (2) ordering is
derived **only** when generating steps from scratch (Re-run never reorders;
Regenerate triggers its own fresh reordering plan); (3) modal copy approved
(trimmed to mention Done only).

## Context

"Re-run Motion Planning" (the button in the Assembly editor, both tabs' footers)
today triggers a **fresh** plan: the geometry service re-derives the assembly
**order** from scratch (`_greedy_disassembly` → `_preference_topo_sort`) and
recomputes every part's motion. Two problems the user hit:

1. It's a heavy, destructive-feeling operation with **no confirmation**.
2. It **ignores the step order the user has already authored** — the planner
   invents its own order, so re-running can reshuffle everything.

The user wants re-run to instead:

- **Take the order of parts "as evident"** — use the *existing steps* (ordered by
  `sortOrder`, each with its `partNodeIds`) as the fixed assembly sequence.
- **Plan motion so each step's parts avoid collision with parts from *previous*
  steps** — forward-collision only, against the accumulated placed geometry.
- Sit behind a **confirmation modal**.

Good news from code archaeology: the planner **already** does forward-only
collision verification. `_verify_sequence()` (`services/geometry/app/plan.py`
:1441–1488) walks the sequence, building a `CollisionManager` incrementally, and
re-checks each part's motion against **only the parts already placed** (sets
`verified=True` or demotes to `flagged` + `blockedBy`). The new mode reuses this
almost verbatim — it just **fixes the sequence to the given step order** and skips
the ordering phases.

## Goal

Three deliverables, in order of size:

1. **Confirm modal** on "Re-run Motion Planning" (small, ERP-only).
2. **Order-preserving re-motion**: re-run uses the current step order as the fixed
   sequence and recomputes each step's motion with forward-collision avoidance
   (geometry service + jobs + ERP service).
3. **Map results back in place**: update each step's `motion`/`warnings` without
   regenerating steps (preserve titles, typed fields, requirements, materials,
   status, camera, and manual edits).

`PLAN_VERSION` stays **3** — the new input (`options.sequence`) is additive and
the plan.json output shape is unchanged (per the standing frozen-version rule,
[[project — no plan version bumps]]).

## Current flow (grounded)

- Button → `apps/erp/app/routes/x+/assembly+/$id.plan.rerun.tsx` →
  `trigger("assembly-plan", { modelUploadId, companyId, userId })`.
- Worker `packages/jobs/src/inngest/functions/tasks/assembly-plan.ts`:
  - `loadPlanUnits(...)` (`plan-units.ts`) → `options.units` (`{id,name,nodeIds}[]`).
  - `POST {geometryUrl}/plan` with `{ jobId, source:{url,format:"step"}, options:{units} }`
    (lines ~125–134), polls `GET /plan/{jobId}`, persists `plan.json` + `stats` on
    `assemblyPlanJob`.
  - If `event.data.generateStepsFor` is set, calls `generateAssemblyStepsFromPlan`.
- Geometry `services/geometry/app/`:
  - Endpoint `main.py:236–290` (`POST /plan`, `GET /plan/{job_id}`), schema
    `schemas.py:66–74` (`PlanOptions`, `PlanUnit`).
  - `plan_step()` (`plan.py:242–356`): `_merge_units()` (427–467) merges each unit
    into one body, `_plan_parts()` (483–712) does classify → **greedy order** →
    precedence → **topo order** → **forward-verify**, then expands units back to
    members + emits `groups`.
  - Per-part motion search: `_plan_removal()` (2594), `_plan_escape()` (2770),
    `_path_is_clear()` (3249), `_path_blockers()` (813). Forward verify:
    `_verify_sequence()` (1441).
- Plan → steps: `generateAssemblyStepsFromPlan` (`generate-assembly-steps.ts` +
  `production.service.ts`), `buildAssemblyStepGroups` (`packages/viewer/src/plan.ts`).
- Step motion patch: `updateAssemblyStepMotion` (`production.service.ts:4158`),
  route `$id.steps.motion.$stepId.tsx`.

## Design

### The new geometry mode: `options.sequence`

Add an optional `sequence` to the `/plan` request:

```
options.sequence?: string[][]   // ordered groups of leaf nodeIds; group i = step i's parts
```

When `sequence` is present, the planner **bypasses ordering** and treats each
group as one rigid body installed in the given order:

1. Merge each group into one body (reuse `_merge_units` — every group is a "unit"
   for motion purposes; a single-part group is just that part).
2. **Sequence = the given group order** (skip `_greedy_disassembly` and
   `_preference_topo_sort` entirely).
3. Walk the sequence forward, incrementally registering placed bodies in a
   `CollisionManager`; for each group compute an insertion motion against **only
   the already-placed groups** — reuse `_plan_removal` / `_plan_escape`, then the
   existing `_verify_sequence` acceptance logic. A group with no collision-free
   path → `motion:"none"` + `blockedBy` (`flagged`), exactly like today (the
   viewer fades it in — no fabricated path).
4. Emit the same plan.json shape: `sequence` (member leaves), `parts` (each member
   carries the group motion + `groupId` + `verified`/`blockedBy`), and `groups`
   (partNodeIds + motion). No `name` needed here (titles are owned by the steps).

This is deliberately the **units mechanism with a fixed order** — maximal reuse,
minimal new surface. `linearDeflection`/`clearance`/`pathSamples` still apply.

### Mapping results back to steps (in place)

Re-run must **not** regenerate steps. New ERP service fn
`updateAssemblyStepMotionsFromPlan(client, { assemblyInstructionId, plan, companyId, userId })`:

- For each step, take its `partNodeIds` as a set, find the plan `group` whose
  `partNodeIds` set-equals it (same match rule as `describeStep`'s unit match —
  reuse a shared helper), and update the step's `motion` + `warnings`
  (`flagged`/`blockedBy`) via a Kysely transaction (multi-row).
- Recompute `planConfidence` from the plan (`high`/`low`), **except** preserved
  steps (below).
- Leave `title`, typed fields, `camera`, `sortOrder`, requirements, materials,
  and `status` untouched.

### Trigger path

Reuse the async `assembly-plan` job. Add an optional event field
`reMotionFor?: assemblyInstructionId` (mirrors the existing `generateStepsFor`):

- Rerun route reads the instruction's steps (ordered by `sortOrder`) and passes
  `reMotionFor` (the worker reads the steps to build `sequence`, keeping the event
  payload small).
- Worker, when `reMotionFor` is set: build `options.sequence` from the steps'
  `partNodeIds` (skip `loadPlanUnits` — the steps already encode grouping), submit,
  poll, persist the plan.json as today, then call
  `updateAssemblyStepMotionsFromPlan` instead of `generateAssemblyStepsFromPlan`.

## Decisions (recommended — flag for veto)

- **D1 — Re-run = order-preserving re-motion.** The "Re-run Motion Planning"
  button always preserves the current step order/grouping and only recomputes
  motions. Fresh reordering stays the job of the initial **Generate Steps** and
  **Regenerate from Plan** paths. *(This is the user's explicit ask.)*
- **D2 — Update motions in place**, never delete/re-insert steps. Preserves all
  authored step content.
- **D3 — Preserve DONE steps only (resolved).** Steps with `status:"Done"` keep
  their existing motion (not overwritten); their parts are still **placed
  obstacles** for later steps' collision checks. Steps with
  `planConfidence:"manual"` (hand-adjusted but not Done) **are recomputed** — only
  Done is treated as locked.
- **D4 — Per-step (group) motion.** Each step's parts move together as one rigid
  body (matches how a step animates today); forward-collision is checked for the
  whole group against the union of all prior steps' parts.
- **D5 — No `PLAN_VERSION` bump.** Additive input, unchanged output shape.
- **D6 — Flagged steps** (no collision-free motion found) store `motion:"none"` +
  `warnings:{flagged,blockedBy}` as today; the viewer fades them in.
- **D7 — Regenerate owns ordering (resolved).** Ordering (`_greedy_disassembly`
  → `_preference_topo_sort`) is derived **only** when generating steps from
  scratch: initial **Generate Steps** and **Regenerate from Plan**. Both trigger a
  fresh *reordering* plan. **Re-run Motion Planning never reorders** — it always
  uses the existing step order (`options.sequence`). This means Regenerate must
  trigger its OWN fresh plan (it can no longer rely on Re-run having produced one)
  — folded into scope (Task C4 below).

## Open questions — RESOLVED

- **OQ1 (resolved).** Confirm-modal copy: *"Recomputes how each step's parts move
  into place, using the current step order and avoiding collisions with parts from
  earlier steps. Steps you've marked Done are left as-is."* (trimmed "manually
  adjusted" per D3).
- **OQ2 (resolved).** Preserve **Done** steps only; recompute manual (D3).
- **OQ3 (resolved).** Regenerate triggers its own fresh reordering plan; Re-run
  never reorders (D7, Task C4).
- **OQ4 (resolved — recommendation accepted).** A step whose parts don't
  set-equal any plan group is left untouched; surface a per-run count of unchanged
  steps.
- **OQ5 (resolved — recommendation accepted).** Force `motion:"none"` for the base
  step (`sortOrder === 1`), matching `buildAssemblyStepGroups`' base exemption.

## Tasks

### Phase A — Geometry service (`services/geometry/`)

- [ ] **A1. Schema.** `app/schemas.py` — add `sequence: list[list[str]] | None = None`
      to `PlanOptions` (66–74). Validation: non-empty groups, nodeIds are strings.
- [ ] **A2. Fixed-order planning.** `app/plan.py` — in `plan_step()` (242–356),
      when `options.sequence` is set, branch to a new `_plan_fixed_sequence(parts,
      groups_in_order, trimesh, clearance, path_samples, ...)` that:
      merges each group (reuse `_merge_units` per group), sets the sequence to the
      given order, and runs the existing forward-verify acceptance
      (`_verify_sequence` logic) computing each group's motion via `_plan_removal`
      / `_plan_escape` against the incrementally-built manager. Emit the same
      `_PlanOutcome`/plan.json shape (sequence, parts, groups). Reuse the base
      exemption (OQ5). **No new tiers, no version bump.**
      - Keep `_greedy_disassembly` / `_preference_topo_sort` for the no-sequence
        path unchanged.
- [ ] **A3. Tests.** `services/geometry/tests/test_plan.py` — add cases:
      (a) a 3-body stack with a **given** order returns forward-collision-clear
      motions; (b) a given order that forces a collision flags the offending group
      (`motion:"none"` + `blockedBy`); (c) reversing the given order changes which
      group flags (proves order is respected, not re-derived); (d) a single group
      == whole model behaves like the base.
      - Verify: `cd services/geometry && <pytest cmd from repo>` → new tests pass.

### Phase B — Jobs (`packages/jobs/`)

- [ ] **B1. Event field.** Add optional `reMotionFor?: string` to the
      `assembly-plan` event payload (event types in `@carbon/lib/events`; mirror
      `generateStepsFor`).
- [ ] **B2. Worker branch.** `src/inngest/functions/tasks/assembly-plan.ts` —
      when `reMotionFor` is set: load the instruction's steps ordered by
      `sortOrder`, build `sequence = steps.map(s => s.partNodeIds)` (skip preserved
      steps per D3? — see below), send `options:{ sequence }` (omit `units`), poll,
      persist plan.json as today, then call the new
      `updateAssemblyStepMotionsFromPlan` instead of generating steps.
      - Preserved (manual/Done) steps: still include their parts in `sequence`
        (they're obstacles) but tell the mapping fn not to overwrite them.
- [ ] **B3.** `plan-units.ts` unchanged (still used by the fresh path).

### Phase C — ERP service (`apps/erp/app/modules/production/`)

- [ ] **C1. Read steps for order.** Reuse `getAssemblyInstructionSteps` (ordered by
      `sortOrder`).
- [ ] **C2. Mapping fn.** `production.service.ts` — add
      `updateAssemblyStepMotionsFromPlan(client, { assemblyInstructionId, plan,
      companyId, userId })`: Kysely transaction; for each non-preserved step, match
      its `partNodeIds` to a plan group (shared set-equality helper) and update
      `motion` + `warnings` + `planConfidence`. Count unmatched (OQ4) and
      preserved. Force base step `motion:"none"` (OQ5).
      - Extract the set-equality match into a shared util reused by
        `describeStep`'s unit match ([[feedback — module service pattern]] — keep it
        in the module/service files, not scattered).
- [ ] **C3. Rerun route.** `$id.plan.rerun.tsx` — pass `reMotionFor: id` in the
      `trigger("assembly-plan", ...)` payload when the instruction already has
      steps; keep the fresh (reordering) path when it has none.
- [ ] **C4. Regenerate owns ordering (D7).** `$id.steps.generate.tsx` +
      `generateAssemblyStepsFromPlan` — the `mode:"regenerate"` path must run on a
      **fresh reordering plan**, not a stale one. Trigger a fresh `assembly-plan`
      (no `reMotionFor`) and rebuild steps from it. Confirm the "Regenerate from
      Plan" affordance in `AssemblyInstructionExplorer.tsx` still surfaces
      correctly now that Re-run no longer produces newer reordered plans (it may
      need to always offer Regenerate, gated on a fresh plan run rather than on
      `planJob.createdAt > newestStepAt`).

### Phase D — ERP UI (`apps/erp/app/modules/production/ui/Assemblies/`)

- [ ] **D1. Confirm modal.** `AssemblyInstructionExplorer.tsx` — add
      `showRerunConfirm` state + a `Modal` (mirror the existing `showRegenerate`
      modal), copy per OQ1. Change the "Re-run Motion Planning" button `onClick` to
      open it; the modal's confirm fires the existing `rerunPlanFetcher.submit(...)`
      to `path.to.assemblyPlanRerun(id)`. (The button already lives in the Steps
      footer; Parts-tab re-run is out of scope unless requested.)
- [ ] **D2.** No change to the sticky Add Step buttons (already shipped).

### Phase E — Verification

- [ ] **E1.** `pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp`.
- [ ] **E2.** `pnpm --filter @carbon/viewer test` (if the shared match helper moves
      into viewer) + `pnpm --filter @carbon/jobs test`.
- [ ] **E3.** Geometry: run `test_plan.py`.
- [ ] **E4.** Browser (in an Electric-X-accessible session): author 3–4 steps, hit
      Re-run → confirm modal → after the job, each step's motion updates, order is
      unchanged, a deliberately-blocked step flags, and a manually-edited step's
      motion is preserved.

## Risks

- **R1 — nodeId compatibility.** `options.sequence` uses graph leaf nodeIds; the
  planner must map them to its `_Part`s. The existing `options.units` path already
  does this (`_merge_units` looks up `by_id[member]`), so it's proven — but the
  new mode must handle nodeIds present in a step but **absent** from the planner's
  parts (stale after a model re-upload): drop them from the group, and if a group
  becomes empty, skip it and count it as unmatched (OQ4).
- **R2 — Planner sensitivity.** plan.py is under active tuning
  (`2026-07-06-planner-regression-fix`, `-secured-last-and-gaskets`). Keep the new
  mode a **separate branch** in `plan_step` so it can't perturb the fresh path;
  add tests that pin the order-respecting behavior.
- **R3 — Job cost.** Re-motion is roughly one motion search per step (no ordering
  search), so it should be **cheaper** than a fresh plan — good.
- **R4 — Partial overwrite consistency.** Use a Kysely transaction for C2 so step
  motion updates are all-or-nothing.

## Not in scope (unless requested)

- Fresh-plan trigger for "Regenerate from Plan" independence (OQ3/D7).
- A Parts-tab re-run affordance.
- Re-motion for a subset of selected steps.
