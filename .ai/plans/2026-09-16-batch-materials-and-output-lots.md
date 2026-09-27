# Batch Materials & Output Lots — implementation plan

**Spec:** .ai/specs/2026-09-16-batch-materials-and-output-lots.md
**Research:** .ai/research/batch-aggregated-material-consumption.md (+ .ai/research/batch-output-lot-identity.md)
**Branch:** feat/batch-materials-and-output-lots (cut from `main`)

## Progress
- [x] Task 1: Migration — `Batch Merge` ledger enum values + generate types
- [x] Task 2: `producedItem` compatibility dimension
- [x] Task 3: Pro-rata pick splitter (shared pure util + test)
- [x] Task 4: `issue` case `trackedEntitiesToBatch`
- [x] Task 5: `issue` case `mergeTrackedEntities` (+ shared/batch-merge.ts)
- [x] Task 6: `issue` case `jobOperationBatchOutput` (extraction)
- [x] Task 7: `batch-operations` complete — batch numbers in, output step, entity ids out
- [x] Task 8: MES batch materials panel + shared pick
- [x] Task 9: BatchCompleteModal — batch-number fields + merge prompt
- [x] Task 10: ERP batch detail drawer merge action + service wrappers
- [x] Task 11: i18n + full scoped validation
- [x] Task 12: Browser verification (/test)

## Dependencies
- Task 1 first (enum + types) — Tasks 5/10 reference `Batch Merge`.
- Task 2 independent of everything else (can run in parallel with 3–7).
- Tasks 4, 5, 6 all edit `packages/database/supabase/functions/issue/index.ts` — run **sequentially** (4 → 5 → 6), never as parallel subagents.
- Task 7 needs 6. Task 8 needs 3+4. Task 9 needs 7 (+5 for the prompt). Task 10 needs 5.
- Tasks 11–12 last.

---

## Task 1: Migration — `Batch Merge` ledger enum values + generate types

**Depends on:** none
**Files:**
- Create: migration via `pnpm db:migrate:new batch-merge-ledger-enum` (never hand-pick the timestamp)
- Copy from (precedent): `packages/database/supabase/migrations/20250225145619_tracked-entities.sql:21` and `packages/database/supabase/migrations/20260504000000_cost-layers.sql:16`

**Steps:**
1. `pnpm db:migrate:new batch-merge-ledger-enum`
2. Migration body (idempotent, additive only):
   ```sql
   ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Batch Merge';
   ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Batch Merge';
   ```
3. `pnpm db:migrate`
4. `pnpm run generate:types`

**Verify:**
```bash
grep -rn "'Batch Merge'" packages/database/src/types.ts | head -2
# Expected: 'Batch Merge' appears in both itemLedgerDocumentType and journalLineDocumentType unions
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** any other enum, any table change.

## Task 2: `producedItem` compatibility dimension

**Depends on:** none
**Files:**
- Modify: `packages/database/supabase/functions/shared/batch-compatibility.ts` — add `"producedItem"` to `BATCH_RULE_DIMENSIONS`, `DEFAULT_BATCH_RULES.producedItem = "ignore"`, extend the value-set fold (`MemberValueSets`) with the member's produced item readable id
- Modify: `apps/erp/app/modules/production/ui/Batches/batch-builder-logic.ts` — candidates already carry `itemReadableId` (the produced item, used as `groupingKey` fallback at line ~70); when `rules.producedItem !== "ignore"`, include it in `materialSignature`/value sets exactly like the other dimensions
- Modify: `packages/database/supabase/functions/batch-operations/index.ts` — `assertMaterialCompatible`'s value-set build gains the produced item per member op (`jobOperation → item.readableId`)
- Modify: the process form's "Compatibility rules" card (grep `Compatibility rules` under `apps/erp/app/modules/resources/ui/Processes/`) — add the "Produced item" row, same Require Match / Suggest Match / Ignore control as existing rows
- Modify: `packages/utils/src/batch-compatibility.test.ts` and `apps/erp/test/batch-suggestions.test.ts` — new cases: `producedItem: "must"` refuses mixed produced items; `"guide"` splits groups; DEFAULT rules reproduce current signatures byte-for-byte (existing snapshot tests must NOT change)

**Steps:**
1. Extend the shared module first (it is the single source: `packages/utils/src/batch-compatibility.ts` re-exports it).
2. Wire client fold + edge fn fold; copy the exact pattern of the existing `item` dimension (`batch-compatibility.ts:42` uses `line.itemReadableId` — the CONSUMED line item; `producedItem` reads the candidate/member's own `itemReadableId`, NOT a BOM line).
3. Add the form row; stored values stay `must`/`guide`/`ignore` (labels "Require Match"/"Suggest Match" — see spec 2026-08-21 changelog 2026-09-01).

**Verify:**
```bash
pnpm --filter @carbon/utils test -- batch-compatibility
pnpm --filter erp test -- batch-suggestions
# Expected: all pass, including untouched pre-existing snapshot/signature cases
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** any change to DEFAULT behavior of existing dimensions; suggestions due-window logic.

## Task 3: Pro-rata pick splitter (shared pure util + test)

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/functions/shared/batch-pick-split.ts`
- Create: `packages/database/supabase/functions/shared/batch-pick-split.test.ts`
- Create: `packages/utils/src/batch-pick-split.ts` — one-line re-export (`export * from "../../database/supabase/functions/shared/batch-pick-split.ts";`)
- Copy from (precedent): `packages/database/supabase/functions/shared/batch-time-split.ts` (+ its `.test.ts`) for the shared-module shape; `packages/utils/src/precision.ts` re-export pattern

**Steps:**
1. Export `splitPickAcrossMembers(members: { jobOperationId: string; remaining: number }[], pickedQuantity: number): { jobOperationId: string; quantity: number }[]`.
2. Weights = each member's `remaining` (skip members with remaining ≤ 0); shares computed via `distributeRoundingResidual` from `../shared/precision.ts` at internal scale so shares sum EXACTLY to `pickedQuantity` (numeric-precision rule: never round parts independently).
3. Reject (throw) `pickedQuantity` > Σ remaining and Σ remaining === 0 — callers surface the message verbatim.
4. Tests: exact-sum at 5-decimal quantities; the customer sequence (remaining 4,000/2,500, pick 4,000 then 2,500 → totals land exactly 4,000/2,500 with both picks pro-rata); single-member; over-pick rejection.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- batch-pick-split
# Expected: all cases pass, including the two-pick exact-total sequence
```

**Out of scope:** any DB access — this module stays pure.

## Task 4: `issue` case `trackedEntitiesToBatch`

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/supabase/functions/issue/index.ts` — new discriminated-union member + case
- Copy from (precedent): the `trackedEntitiesToOperation` validator (`issue/index.ts:910`) and its case body

**Steps:**
1. Validator: `{ type: "trackedEntitiesToBatch", batchId, parentTrackedEntityId, children: [{trackedEntityId, quantity}], overrideExpired?, overrideReason?, companyId, userId }`.
2. `requirePermissions(req, companyId, userId, { update: "production" })`.
3. One Kysely transaction: load the batch under `companyId` (reject missing or `Completed`); load member ops + their `jobMaterial` rows matching the parent entity's item, `FOR UPDATE`; remaining = estimated − already-consumed per member; split the total picked quantity with `splitPickAcrossMembers`; per member, perform the same writes `trackedEntitiesToOperation` performs for that member's share — extract the per-operation write sequence from the existing case into a helper function both cases call (no copy-paste; if extraction proves unsafe because the existing case's writes are interleaved with case-specific reads, STOP and report rather than duplicating the logic).
4. Expired-entity policy check runs once against the parent, same helper the existing case uses.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
grep -n "trackedEntitiesToBatch" packages/database/supabase/functions/issue/index.ts | head -3
# Expected: validator + case + helper call sites present
```
Runtime check happens in Task 12 (the local edge runtime live-mounts `functions/`).

**Out of scope:** any change to `trackedEntitiesToOperation`'s external behavior; untracked materials (they stay backflush-only).

## Task 5: `issue` case `mergeTrackedEntities` (+ shared/batch-merge.ts)

**Depends on:** Tasks 1, 4 (same-file sequencing)
**Files:**
- Create: `packages/database/supabase/functions/shared/batch-merge.ts`
- Create: `packages/database/supabase/functions/shared/batch-merge.test.ts`
- Modify: `packages/database/supabase/functions/issue/index.ts` — new validator + case calling the helper
- Copy from (precedent): `packages/database/supabase/functions/shared/batch-split.ts` (+ test) — mirror its plan-builder shape, its `"Merge"` activity write (line ~252), its net-zero `Batch Split` ledger rows (lines ~190–203), and its bin resolution (`resolveTrackedEntityBin` — lessons.md "actual bin")

**Steps:**
1. Helper builds a merge plan from parent rows: validate ≥2 parents, all same `itemId`, same `companyId`, all `Available`; merged entity = fresh `nanoid`, quantity = Σ parents, `expirationDate` = earliest non-null parent expiry, attributes kept only where every parent has the identical value, plus provenance attribute `"Merged From Entity IDs": [...]` (add the key to `TrackedEntityAttributes` in `packages/utils/src/types.ts` AND `functions/lib/utils.ts`, both — see split spec's pointer-attribute decision).
2. New batch readable number: use the same sequence/generation path the existing entity-creation flow uses (grep `batch-numbers` / how `trackedEntity` readable ids are assigned in `assign-serial-numbers/index.ts`; if there is no reusable generator, STOP and report — do not invent a numbering scheme).
3. `issue` case: `{ type: "mergeTrackedEntities", trackedEntityIds (min 2), companyId, userId }`, permission `update: "inventory"`; one transaction: insert merged entity, `Merge` activity (inputs = each parent @ its quantity, output = merged @ Σ), net-zero `Batch Merge` itemLedger rows at each parent's resolved bin (−q per parent) and +Σq for the merged entity, parents → `Consumed`. Returns `{ trackedEntityId }`.
4. Tests (pure plan builder): conflict policy (earliest expiry; disagreeing attribute dropped; equal attribute kept), mixed-item rejection, <2 rejection, quantity sum.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- batch-merge 2>/dev/null || (cd packages/database/supabase/functions && deno test shared/batch-merge.test.ts)
# Expected: plan-builder tests pass (run under the same runner batch-split.test.ts uses — check how it is invoked in CI/package.json first)
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** merging entities of different items under any flag; a generic inventory-wide merge UI.

## Task 6: `issue` case `jobOperationBatchOutput` (extraction)

**Depends on:** Tasks 4, 5 (same-file sequencing)
**Files:**
- Modify: `packages/database/supabase/functions/issue/index.ts` — extract the `Produce`-activity + entity-flip block from `jobOperationBatchComplete` (lines ~1125–1180: `trackedActivity` "Produce", `trackedActivityOutput`, entity → `Available` with summed quantity) into a helper; new case `jobOperationBatchOutput` `{ jobOperationId, trackedEntityId, quantity, companyId, userId }` that calls ONLY that helper — no `productionQuantity` insert, no `issueJobOperationMaterials`

**Steps:**
1. Extract; `jobOperationBatchComplete` keeps calling the helper plus its existing quantity insert + backflush — its external behavior must not change.
2. New case: permission `update: "production"`; idempotency: if the entity is already `Available`, return success without writing (this is the resume path).
3. For the entity flip's quantity, sum the member's `Production` `productionQuantity` rows (they exist — batch Phase 1 wrote them) exactly as the existing case does.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
grep -c "issueJobOperationMaterials" packages/database/supabase/functions/issue/index.ts
# Expected: same count of CALL SITES as before the task in jobOperationBatchComplete/jobOperation paths; zero calls inside the new case
```

**Out of scope:** `jobOperationSerialComplete`; any behavior change to the single-op completion flow.

## Task 7: `batch-operations` complete — batch numbers in, output step, entity ids out

**Depends on:** Task 6
**Files:**
- Modify: `packages/database/supabase/functions/batch-operations/index.ts` — `complete` payload member rows gain optional `batchNumber`/`trackedEntityId`; Phase 2 gains the output step; result gains `outputTrackedEntityIds`
- Modify: `apps/mes/app/services/models.ts` (completion validator — find with `grep -rn "completeJobOperationBatch" apps/mes/app/services/`) and its test `apps/mes/app/services/models.batch.test.ts`

**Steps:**
1. Phase 2 order becomes: material issue per member → **output per member** (`issue` `jobOperationBatchOutput` for members whose produced item `requiresBatchTracking` and whose payload row carries `trackedEntityId`) → Done flip → GL → finalize. Fail-fast semantics identical to neighbors (first error verbatim, batch stays `Completing`).
2. Resume contract: like quantities, a resume must carry the same `trackedEntityId`s Phase 1 recorded the run against — the output step's idempotency (entity already `Available`) makes re-runs no-ops; do NOT add new Phase-1 writes.
3. If a member's produced item requires batch tracking but the payload row lacks `trackedEntityId`, reject with an error naming the member — never silently skip a tracked output.
4. Return `outputTrackedEntityIds: string[]` (created/available entities of this completion) so the MES route can offer the merge prompt without a refetch.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=mes
# Expected: exit 0
pnpm --filter mes test -- models.batch
# Expected: validator tests pass incl. new batchNumber/trackedEntityId rows
```

**Out of scope:** Phase 1 slicing/quantities; the resume quantity-mismatch contract (unchanged).

## Task 8: MES batch materials panel + shared pick

**Depends on:** Tasks 3, 4
**Files:**
- Modify: `apps/mes/app/services/operations.service.ts` (or the service file exporting `getJobMaterialsByOperationId` — locate with `grep -rn "getJobMaterialsByOperationId" apps/mes/app/services/`) — add `getJobMaterialsByBatchId(client, { batchId, companyId })`: member ops' materials, same row shape, plus `jobOperationId`
- Modify: `apps/mes/app/routes/x+/operation.$operationId.tsx:242` — in batch mode (loader already resolves `batch`), load materials by batch instead of by operation
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` (materials block, ~line 1244) — in batch mode group rows by item with summed required/issued, member rows expandable beneath; untracked items: display only (no issue button); tracked items: pick action opens the existing modal
- Modify: `apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx` — batch mode submits `{ type: "trackedEntitiesToBatch", batchId, … }` through the existing issue route
- Modify: the MES issue action route (`apps/mes/app/routes/x+/issue.tsx` — confirm it forwards to the `issue` edge fn; if the modal posts elsewhere, follow the modal's existing action) — accept and forward the new payload type
- Copy from (precedent): the existing materials block + `IssueMaterialModal` in the same files; grouping UI follows the kit-materials grouping already in `JobOperation.tsx` (~line 1271 `kitMaterialsByParentId`)

**Steps:**
1. Service + loader swap (batch mode only — single-op mode byte-for-byte unchanged).
2. Grouped rendering with summed quantities; per-member issued progress from the same rows.
3. Pick modal: title shows the summed remaining; on submit in batch mode, pass `batchId`; surface the edge fn's error message verbatim on failure (flash pattern — `.claude/rules/flash-system.md`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
pnpm run lint
# Expected: exit 0
```
Behavioral proof in Task 12.

**Out of scope:** ERP materials surfaces; single-operation (non-batch) picking; picking-list flows.

## Task 9: BatchCompleteModal — batch-number fields + merge prompt

**Depends on:** Tasks 5, 7
**Files:**
- Modify: `apps/mes/app/components/JobOperation/components/BatchCompleteModal.tsx` — per-member `batchNumber` field (only for members whose produced item `requiresBatchTracking`; pre-filled from the member's WIP tracked entity, editable) + hidden `trackedEntityId`; after a successful completion whose result carries ≥2 `outputTrackedEntityIds` of the same item, render the merge prompt ("N lots of the same item — merge into one?") whose confirm posts `mergeTrackedEntities` and then shows the merged lot number
- Modify: `apps/mes/app/routes/x+/batch.$batchId.complete.tsx` — pass the new member fields through to the edge fn; add the merge intent (invoke `issue` `mergeTrackedEntities`)
- Copy from (precedent): `BatchCompleteModal.tsx` itself (member-row array pattern); use `NumberControlled`-style controlled inputs per the batching memory (react-aria + RVF nested-array defaults are unreliable — see `.ai/lessons.md` and project memory); batch-number lookups precedent: `apps/mes/app/routes/api+/batch-numbers.ts`

**Steps:**
1. Loader/route supplies each member's WIP `trackedEntityId` + current batch number (the operation page already resolves `trackedEntityId` for the single-op flow — reuse that resolution per member; if a member has NO WIP entity, show the field empty and let the edge fn's Task-7 rejection surface — do not create entities client-side).
2. "Retry Completion" (Completing state) re-sends the same `trackedEntityId`s.
3. Merge prompt: one button, no form fields; on success show the merged readable batch number; all strings `<Trans>`/`t`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
```
Behavioral proof in Task 12.

**Out of scope:** serial members (no field, unchanged); auto-merge; scrap fields.

## Task 10: ERP batch detail drawer merge action + service wrappers

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `mergeTrackedEntities(client, { trackedEntityIds, companyId, userId })` invoke wrapper (`{data, error}` shape)
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts` — `mergeTrackedEntitiesValidator` (`trackedEntityIds: min 2`)
- Modify: `apps/erp/app/modules/production/ui/Batches/BatchDetailDrawer.tsx` — for a `Completed` batch whose members' output entities are ≥2 same-item and un-merged (none carries `"Merged From Entity IDs"` pointing at them / none `Consumed` by a Merge), show "Merge output lots"; posts to a new action route under the batches route folder (follow the drawer's existing action-route pattern — grep its current fetcher targets)
- Copy from (precedent): `BatchDetailDrawer.tsx`'s existing actions; route action shape from the batching routes (`grep -rn "batch-operations" apps/erp/app/routes/x+/ | head` to find the invoke-forwarding precedent)

**Steps:**
1. Wrapper + validator + action route with `requirePermissions` `{ update: "inventory" }`.
2. Drawer button gated to the un-merged state; after success, revalidate and show the merged lot's readable id linking to the traceability page (existing path helper — grep `path.to.` traceability usages in the drawer's module).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** a standalone inventory-wide merge screen; BatchesTable columns.

## Task 11: i18n + full scoped validation

**Depends on:** Tasks 2, 7, 8, 9, 10
**Files:**
- Modify: `packages/locale/locales/*/{erp,mes}.po` via the translate pipeline

**Steps:**
1. Lingui extract per the i18n rule (`.claude/rules/i18n-lingui-system.md`), then `/translate` to fill missing strings.
2. Full gate: lint, scoped typechecks, unit tests.

**Verify:**
```bash
pnpm run lint
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/database --filter=@carbon/utils
pnpm --filter @carbon/utils test && pnpm --filter erp test -- batch && pnpm --filter mes test -- models.batch
# Expected: all exit 0; no missing msgstr for new ids
```

**Out of scope:** committing — that goes through /check-and-commit with the user.

## Task 12: Browser verification (/test)

**Depends on:** Task 11
**Files:** none (verification only; playbook may be cached to `.ai/playbooks/`)

**Steps:**
1. With the user's dev stack up (never restart it), run `/test` against this branch's diff. Scenario, end to end:
   a. Flag a process batchable with `producedItem: must`; verify the builder refuses mixed produced items and the edge fn rejects a forced create.
   b. Seed 2 jobs (batch-tracked output item, shared batch-tracked input item, BOM 4,000/2,500) — reuse the seeding technique in `.ai/playbooks/job-operation-batching.md`.
   c. Batch them; in MES verify the materials panel shows one 6,500 group; pick 6,500 from one lot → verify per-member consumption rows 4,000/2,500 against the same lot (DB check), then a second scenario picking from two lots → pro-rata links to both.
   d. Complete with batch numbers → verify per-member entities `Available`, quantities correct; kill the edge fn mid-Phase-2 once (or force an issue failure) → verify `Completing` + retry resumes without duplicate entities.
   e. Accept the merge prompt → verify ONE merged entity (Σ quantity, earliest expiry), `Merge` activity with both parents, net-zero `Batch Merge` ledger rows, parents `Consumed`, traceability graph walks merged → both jobs.
   f. Regression: an unbatched op's materials panel and completion are unchanged; a serial-tracked member batches and completes exactly as today.

**Verify:** the /test run report; every acceptance criterion in the spec checked off with evidence (DB queries or screenshots).

**Out of scope:** performance testing; MRP interaction.
