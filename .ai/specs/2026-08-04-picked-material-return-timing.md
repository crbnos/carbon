# Picked-Material Return Timing (job vs operation)

> Status: in-progress
> Author: Sid (design interview) + Claude
> Date: 2026-08-04

## TLDR

A pick in Carbon is a Transfer (warehouse bin → work center lineside bin), not a
consumption; the unconsumed remainder currently flushes back to the warehouse only when
the entire job completes — and only for batch/serial allocations, only when completion
runs through MES. This spec adds an opt-in company policy
`returnPickedMaterialTiming: 'job' (default) | 'operation'` that flushes each
operation's unconsumed remainder back when that operation completes, extends automatic
returns to untracked material (both timings), and fixes the ERP-side completion paths
that today never trigger any return. Consumed material never returns automatically.

Research: `.ai/research/material-staging-return-timing.md` — no competitor auto-returns
at operation completion (Katana auto-returns at MO completion only; Epicor blocks
post-op returns entirely), so the per-operation option is novel surface and is guarded:
an "owed backflush" hold-back keeps enough staged stock for completion-time backflush,
and the backflush itself gains a lineside on-hand clamp.

## Problem Statement

1. Operator picks 100 to lineside, operation consumes 50 → the leftover 50 sits at the
   lineside bin until the whole job completes. Shops that stage per-operation want the
   surplus back in the warehouse as soon as the operation is done.
2. Pre-existing gap: the job-complete sweep (`returnAllocatedRemaindersAtJobComplete`,
   MES) covers tracked allocations only — plain untracked inventory leftovers never
   return automatically at all.
3. Pre-existing gap: the sweep is wired only into MES `finishJobOperation`. Jobs
   completed from the ERP "Complete" button, ops set Done from ERP dropdowns/kanban,
   and the MES complete-passed (inspection) path complete jobs with no sweep.
4. Pre-existing bug (found during design): the sweep decrements
   `pickingListLine.quantityPicked`, which fires `update_picking_list_status` and
   demotes Completed/Partial picking-list headers back to In Progress.

## Proposed Solution

One shared sweep implemented as two new cases in the `post-picking` edge function —
`returnOperationRemainders { jobOperationId }` and `returnJobRemainders { jobId }` —
each performing the full tracked + untracked return in one Kysely transaction, invoked
from every completion call site (MES + ERP). Returns book `quantityReturned` on the
picking-list line instead of decrementing `quantityPicked`, so the status trigger never
fires for returns.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Policy scope | Company-wide `companySettings.returnPickedMaterialTiming` `'job'` (default) \| `'operation'` | User-resolved. Precedent: `incompletePickingListPolicy`. Default preserves current behavior (Katana pattern; only proven auto-return timing). |
| Untracked material | Auto-returns under BOTH timings | User-resolved. Closes the tracked-only gap; the motivating scenario is quantity-based. |
| Return amount at op-Done | Full unconsumed remainder; op completed qty is final | User-resolved. Owed hold-back protects completion-time backflush. |
| Owed formula | `owed = (estimatedQuantity ÷ job.quantity) × op.quantityComplete` — includes scrap allowance | User-resolved (follow-up question). Per-unit-only would let the scrap allowance return early → clamped backflush → understated COGS. |
| ERP gap | Fixed in same feature; one choke point | User-resolved. |
| Choke point | Two new `post-picking` cases, not a new edge fn, not event-system | post-picking owns transferPair/lineage-walk/pool; event system is async (~3–5s, unseeded-config = never) — unacceptable for inventory correctness. |
| Policy read | `returnOperationRemainders` reads the setting itself, no-ops on `'job'`; op-Done sites invoke unconditionally | Guard lives in one place. `returnJobRemainders` ignores policy (catch-all both timings) but requires `job.status = 'Completed'`. |
| Trigger-flip fix | New `pickingListLine.quantityReturned NUMERIC NOT NULL DEFAULT 0`; returns stop touching `quantityPicked`/status | Trigger only reacts to `quantityPicked`/`status` → returns become invisible to it. `quantityPicked` = gross picked; net at lineside = picked − returned. Unpick keeps its decrement (work regression → demotion is correct). |
| Tracked allocations | `pickingListLineTrackedEntity` keeps existing decrement/delete-at-0 | Availability RPCs net allocations out; freezing rows would make returned lots un-re-allocatable. No trigger watches that table. |
| Untracked remainder math | Per jobMaterial: `returnable = max(0, Σ(line.picked − line.returned) − max(quantityIssued, owed))`; allocated newest-first across that material's lines; per-line cap = picked − returned | No per-line consumption attribution exists (single `quantityIssued` counter, N lines per material). Never bin-swept — lineside bin is shared per work center. |
| Return target bin (untracked) | `line.storageUnitId` → `pickMethod.defaultStorageUnitId` → NULL (location-level) | Mirrors pick-from-unassigned; never strands stock. |
| Backflush clamp | Fork `backflush_job_materials` verbatim; clamp issue qty to net untracked on-hand at the resolved bin, only when the bin is lineside (`storageUnit.workCenterId IS NOT NULL`) | Safety net for races/manual transfers; warehouse-bin behavior unchanged for legacy costing. |
| `jobMaterial.storageUnitId` repoint | Sweep repoints conditionally: job scope always; op scope only when net lineside ≤ 0 | Held-back (owed) stock must stay consumable at lineside by completion backflush. Fixes the latent unconditional-repoint bug inside the sweep path; unpick cases untouched. |
| Op-scope line selection | `pickingListLine.jobOperationId = op` AND line status ≠ Cancelled AND list not Draft/Cancelled; NULL-op lines wait for job completion | Line linkage = where stock was staged. Owed computed from the material's own op. |
| Multi-tenancy | Every new query scoped by `companyId`; edge fn keeps post-picking's existing auth model (verify_jwt; routes authorize) | Heuristics 1/4. No new tables → no new RLS. |

## Data Model Changes

One migration (`pnpm db:migrate:new picked-material-return-timing`):

```sql
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "returnPickedMaterialTiming" TEXT NOT NULL DEFAULT 'job'
  CHECK ("returnPickedMaterialTiming" IN ('job', 'operation'));

ALTER TABLE "pickingListLine"
  ADD COLUMN IF NOT EXISTS "quantityReturned" NUMERIC NOT NULL DEFAULT 0;

-- backflush_job_materials: verbatim fork of 20260713190909 body + lineside on-hand
-- clamp (untracked rows only, bins with workCenterId set), floor 0, CONTINUE at <= 0.
```

No trigger change, no view change (`update_picking_list_status` untouched;
`outstandingQuantity` has no consumers; `pickingLists` view counts statuses only).

## API / Service Changes

- `post-picking` edge fn: extract tracked-return core (no `quantityPicked` decrement, no
  unconditional repoint), add `returnUntrackedMaterialRemainder`, add
  `returnOperationRemainders` / `returnJobRemainders` cases; keep legacy
  `returnPickedRemainder` case as thin wrapper for mid-deploy compatibility.
- MES `operations.service.ts`: `returnAllocatedRemaindersAtJobComplete` →
  `returnPickedRemainders` (single invoke; job scope when `job.status === 'Completed'`,
  else op scope).
- MES `inspection-lot.$id.complete-passed.tsx`: invoke sweep when the SQL auto-flip set
  the op Done.
- ERP `production.service.ts`: `returnPickedRemainders` / `returnPickedJobRemainders`
  helpers; wired in `operation.status.tsx` (on Done) and `$jobId.complete.tsx` (after
  RPC).
- ERP settings: `updateReturnPickedMaterialTimingSetting` + validator consts.
- MES `getPickedQuantitiesByJobMaterial`: expose `quantityReturned`; staged-at-lineside
  consumers use picked − returned.

## UI Changes

- ERP Inventory settings page: "Material return timing" ChoiceSelect card
  ("At job completion" / "At operation completion"), `incompletePickingListPolicy`
  pattern.
- Optional: "Returned" column in ERP PickingListLines.

## Acceptance Criteria

- [x] Policy `'operation'`: pick 100 untracked to lineside, op consumes 50, op → Done ⇒
      ledger shows Transfer lineside→source for the unconsumed remainder minus owed
      hold-back; picking-list header stays Completed/Partial.
- [x] Policy `'job'` (default): behavior unchanged at op-Done; at job completion BOTH
      tracked and untracked remainders return (untracked is new).
- [x] Job completed from ERP "Complete" button returns remainders (was: stranded).
- [ ] Op set Done from ERP dropdown/kanban triggers the op-scope sweep under
      `'operation'` policy.
- [ ] MES complete-passed (inspection) path job completion triggers the sweep.
- [x] Job-complete sweep no longer demotes Completed picking lists to In Progress.
- [x] Completion-time backflush never drives a lineside bin negative (clamp), and with
      scrap% > 0 the owed hold-back keeps backflush fully suppliable at job completion.
- [ ] Re-invoking any sweep is a no-op (idempotent).
- [x] Sweeps scoped by companyId throughout.

## Open Questions

- [x] Policy scope — **Answer:** company-wide `companySettings` column, default `'job'`
      (mirrors `incompletePickingListPolicy`).
- [x] Untracked material in scope — **Answer:** yes, auto-return under both timings;
      per-line/material quantity attribution, never bin sweep.
- [x] Return amount at op completion — **Answer:** full unconsumed remainder; op
      completed qty is final; backflush clamps.
- [x] ERP completion gap — **Answer:** fix in same feature via one shared choke point.
- [x] Owed formula scrap allowance (surfaced during design) — **Answer:** include it:
      `owed = (estimatedQuantity ÷ job.quantity) × op.quantityComplete`.

## Changelog

- 2026-08-04 — Spec written after research + grill (5 questions user-resolved).
  Implementation plan: `.ai/plans/2026-08-04-picked-material-return-timing.md`.
- 2026-08-04 — Implemented + migration applied + partially browser-verified
  (playbook `.ai/playbooks/picked-material-return-timing.md`): op-scope return
  with owed hold-back (job In Progress), job-scope return via MES finish AND the
  ERP Complete button, policy='job' no-op at op-Done, header non-demotion,
  "Returned N" badge, ledger closure (lineside nets to 0). Not yet exercised in
  browser: tracked (batch/serial) sweep path, ERP op-status-dropdown trigger,
  MES complete-passed trigger.
