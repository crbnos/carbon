# Scrap & Unscrap Flow — implementation plan

**Spec:** .ai/specs/2026-08-06-scrap-unscrap-flow.md
**Research:** .ai/research/scrap-unscrap-flow.md
**Branch:** mes-scrap-serial-rework-flow

## Progress
- [x] Task 1: Migration A — scrap enums + itemLedger.scrapReasonId
- [x] Task 2: Migration B — Done-predicate fix (RPC exclusions verified unnecessary — see task note)
- [x] Task 3: Apply migrations and regenerate types
- [x] Task 4: Extend the shared adjustment posting core (dimensions, scrapReasonId, fixed-cost override)
- [x] Task 5: post-inventory-adjustment — Scrap and Unscrap adjustment types
- [x] Task 6: issue — jobOperationScrap case (serial/batch/untracked WIP scrap + spawn + reopen). Deviation: `issueJobOperationMaterials` returns `{ totalMaterialCost }` (additive) — a local COGS recompute would double-relieve layers.
- [x] Task 7: issue — rework scrapTrackedEntity (reason, methodType branches, replacement). Deviations: `rework.trackedEntityId` column no longer exists (`20260531084723`) — omitted from the rework insert; route scraps the WHOLE staged entity (no partial-quantity payload exists on this route), so batch partial scrap lives only in the ERP path.
- [x] Task 8: MES routes + validators for the new scrap paths
- [x] Task 9: MES UI — QuantityModal serial confirmation + entity-scrap modal fields
- [x] Task 10: ERP models/service/route for Scrap + Unscrap
- [x] Task 11: ERP UI — Scrap adjustment type + Scrapped filter + Unscrap action
- [x] Task 12: Sweep app-side predicate mirrors + serial-navigation helpers
- [x] Task 13: Update rules docs (traceability, inventory, MES) 
- [~] Task 14: Browser verification — ERP surfaces render clean (tracked-entities loads, no errors); full behavioral e2e (serial scrap→spawn, MTO replacement, ERP scrap/unscrap with accounting fixtures) PENDING: needs seeded fixtures + MES here uses magic-link auth (no DEV_BYPASS), blocking MES browser drive

## Dependencies
- Task 2 needs Task 1 (enum values must be committed before function bodies reference `'Scrapped'`)
- Task 3 needs Tasks 1–2. Every later task needs Task 3 (generated types)
- Task 5 needs Task 4; Task 6 needs Task 4; Task 7 needs Task 6 (shared replacement helper)
- Task 8 needs Tasks 6–7; Task 9 needs Task 8
- Task 10 needs Task 5; Task 11 needs Task 10
- Task 12 needs only Task 3 — independent of Tasks 4–11 (parallelizable)
- Tasks 13–14 last; Task 14 needs everything

---

## Task 1: Migration A — scrap enums + itemLedger.scrapReasonId

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_scrap-unscrap-enums.sql` (via `pnpm db:migrate:new scrap-unscrap-enums` — never hand-pick the timestamp; HHMMSS must not be `000000`)

**Steps:**
1. Run `pnpm db:migrate:new scrap-unscrap-enums` from the repo root.
2. Write exactly this SQL (idempotent; enum values only — NO function bodies may reference the new values in this file, Postgres forbids using an enum value added in the same transaction):

```sql
-- Terminal scrap status for tracked entities (Epicor SCRAPPED / SAP ME precedent).
-- Recoverable via ERP Unscrap, unlike 'Consumed'.
ALTER TYPE "trackedEntityStatus" ADD VALUE IF NOT EXISTS 'Scrapped';

-- Scrap movement identity on the two document-type enums. These are DIFFERENT
-- enums with overlapping value sets — both need the value.
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Scrap';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Scrap';

-- Scrap reason as a journal dimension (single scrapAccount + dimension slicing;
-- valueId on journalLineDimension is polymorphic → scrapReason.id).
ALTER TYPE "dimensionEntityType" ADD VALUE IF NOT EXISTS 'ScrapReason';

-- Reason lands on stock scrap/unscrap movements (MES production scrap keeps its
-- reason on productionQuantity.scrapReasonId).
ALTER TABLE "itemLedger" ADD COLUMN IF NOT EXISTS "scrapReasonId" TEXT;
ALTER TABLE "itemLedger" DROP CONSTRAINT IF EXISTS "itemLedger_scrapReasonId_fkey";
ALTER TABLE "itemLedger" ADD CONSTRAINT "itemLedger_scrapReasonId_fkey"
  FOREIGN KEY ("scrapReasonId") REFERENCES "scrapReason"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "itemLedger_scrapReasonId_idx"
  ON "itemLedger"("scrapReasonId") WHERE "scrapReasonId" IS NOT NULL;
```

**Verify:**
```bash
ls packages/database/supabase/migrations/ | tail -3
# Expected: the new *_scrap-unscrap-enums.sql file with a timestamp NEWER than
# every existing migration, HHMMSS not 000000
```

**Out of scope:** function redefinitions (Task 2), seed data (no seeded dimension rows — dimensions are user-configured per company group).

## Task 2: Migration B — Done-predicate fix + Scrapped exclusions in status-aware RPCs

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_scrap-unscrap-functions.sql` (via `pnpm db:migrate:new scrap-unscrap-functions`)

**Steps:**
1. Run `pnpm db:migrate:new scrap-unscrap-functions`.
2. For EACH function below, list every migration that touches it and fork the NEWEST body verbatim (sibling-branch lesson — a missed intermediate redefinition silently drops branches):
   ```bash
   grep -l "sync_update_job_operation_quantities" packages/database/supabase/migrations/*.sql | sort
   grep -l "get_inventory_quantities" packages/database/supabase/migrations/*.sql | sort
   grep -l "get_available_tracked_entities" packages/database/supabase/migrations/*.sql | sort
   grep -l "get_picking_list_tracked_available" packages/database/supabase/migrations/*.sql | sort
   ```
   Extract each newest body with `sed -n '<start>,<end>p'` into the new migration, then `diff` your pasted body against the source so the ONLY hunks are the edits below.
3. Edits per function:
   - `sync_update_job_operation_quantities` (newest: `20260706181125_fix-auto-complete-null-user.sql`): change the auto-Done predicate line
     `AND ("quantityComplete" + "quantityReworked" + "quantityScrapped") >= "targetQuantity"`
     to
     `AND ("quantityComplete" + "quantityReworked") >= "targetQuantity"`
     (Brad, 2026-08-07 — `targetQuantity` is the GOOD quantity per `20260119120000`; scrap must not consume it). No other hunk.
   - ~~`get_inventory_quantities`, `get_available_tracked_entities`, `get_picking_list_tracked_available`~~ — **verified unnecessary during execution (2026-08-07):** `itemLedger.trackedEntityStatus` is SYNCED to the entity's current status (`20260420112047` trigger `sync_item_ledger_on_tracked_entity_status_change`), and every scrap path writes a NEGATIVE ledger movement, so a Scrapped entity's rows net to zero in `get_inventory_quantities` with or without a status exclusion (unlike `Rejected`, which keeps positive rows and needs the exclusion). `get_available_tracked_entities` (`20260709125411:104`) and `get_picking_list_tracked_available` (`20260617142853:100`) filter `te."status" = 'Available'` — Scrapped is excluded by construction. No redefinition of the three RPCs.
4. Preserve `SECURITY DEFINER`/language attributes exactly as the newest version has them.

**Verify:**
```bash
pnpm db:migrate
# Expected: both new migrations apply cleanly (no errors)
psql "$(grep -o 'postgresql://[^"]*' .env.local | head -1)" -c "SELECT prosrc FROM pg_proc WHERE proname = 'sync_update_job_operation_quantities';" | grep -c 'quantityScrapped") >= '
# Expected: 0  (the predicate no longer sums quantityScrapped)
```
If `pnpm db:migrate` cannot reach the local DB, STOP and report (never rebuild the DB; wait for the user).

**Out of scope:** `complete_job_to_inventory` (keys on `quantityComplete`, untouched — but confirm by reading its newest body that its serial-entity selection reads `Reserved` status only; if it selects by anything that could match `Scrapped`, STOP and report).

## Task 3: Apply migrations and regenerate types

**Depends on:** Tasks 1–2
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/supabase/functions/lib/types.ts`, `packages/database/src/swagger-docs-schema.ts`

**Steps:**
1. `pnpm run generate:types`
2. Commit the regenerated files together with the migrations (types regen is normal and expected).

**Verify:**
```bash
grep -c '"Scrapped"' packages/database/src/types.ts
# Expected: >= 1 (trackedEntityStatus now includes Scrapped)
grep -c 'scrapReasonId' packages/database/supabase/functions/lib/types.ts
# Expected: >= 2 (productionQuantity existing + new itemLedger column)
```

**Out of scope:** hand-editing any generated file.

## Task 4: Extend the shared adjustment posting core

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/supabase/functions/shared/post-adjustment.ts`

**Steps:**
1. Add to the `accounting` arg type (around line 70): `extraDimensions?: Array<{ entityType: string; valueId: string }>` — documented as "additional journalLineDimension tags beyond Item/ItemPostingGroup/Location (ScrapReason / WorkCenter / Employee for scrap postings); entityType must be the dimension's dimensionEntityType, valueId the referenced entity id".
2. In the dimension-tagging block (currently ~lines 354–378, the `dimensionValues` array of `["Item", ...], ["ItemPostingGroup", ...], ["Location", ...]`): append `...(accounting.extraDimensions ?? []).map(d => [d.entityType, d.valueId] as [string, string])` to `dimensionValues` before the `.filter(...)` that drops entries whose entityType has no active dimension.
3. Add to the ledger arg type: `scrapReasonId?: string | null`; pass it through on the `itemLedger` insert (~line 166–184).
4. Add `fixedUnitCost?: number` to the args: when set AND the movement is an increase, the new `costLedger` layer is booked at `fixedUnitCost × quantity` instead of `computeCurrentUnitCost` (used by Unscrap to reverse at the original scrapped cost). Decreases ignore it (they always go through `calculateCOGS`).
5. `'Scrap'` must be added to `JOURNAL_LINE_SAFE_DOCUMENT_TYPES` (~line 93) so scrap ledger rows map to journal `documentType='Scrap'` instead of falling back to `'Inventory Adjustment'`.

**Verify:**
```bash
cd packages/database/supabase/functions && git show HEAD:./shared/post-adjustment.ts > shared/post-adjustment.orig.ts 2>/dev/null; deno check shared/post-adjustment.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -c "post-adjustment.ts:"; deno check shared/post-adjustment.orig.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -c "post-adjustment.orig.ts:"; rm -f shared/post-adjustment.orig.ts
# Expected: the two counts are equal (own-file error delta = 0; deno check is
# never fully clean on the shared graph — gate on the delta, not exit code)
```

**Out of scope:** changing existing callers' behavior — a call site that passes no new args must produce byte-identical writes (no extraDimensions → same tags; no scrapReasonId → NULL; no fixedUnitCost → current-cost math).

## Task 5: post-inventory-adjustment — Scrap and Unscrap adjustment types

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/supabase/functions/post-inventory-adjustment/index.ts`
- Create: `packages/database/supabase/functions/post-inventory-adjustment/resolve-unscrap-cost.ts` (pure module + test)
- Create: `packages/database/supabase/functions/post-inventory-adjustment/resolve-unscrap-cost.test.ts`
- Modify: `packages/database/supabase/functions/shared/batch-split.ts` — widen `childStatus` union with `"Scrapped"` (discovered during execution; additive type change only, callers unaffected)

**Steps:**
1. Extend the zod payload (~line 28): `adjustmentType` enum adds `"Scrap"` and `"Unscrap"`; add `scrapReasonId: z.string().optional()`, `unscrapOfItemLedgerId: z.string().optional()`; `.superRefine` requiring `scrapReasonId` whenever `adjustmentType` is `Scrap` or `Unscrap`.
2. Extend the active-dimension fetch (~line 161): `.in("entityType", ["Item", "ItemPostingGroup", "Location", "ScrapReason", "WorkCenter", "Employee"])`.
3. **Scrap branch** = the existing Negative-Adjmt. resolution path (serial-by-readableId / single-tracked-entity / untracked, `Set Quantity` excluded) with these deltas:
   - `bookAdjustment` called with `documentType: "Scrap"`, `scrapReasonId`, and `accounting.offsetAccount = accountDefault.scrapAccount ?? accountDefault.inventoryAdjustmentVarianceAccount` (the seed's documented runtime fallback).
   - `accounting.extraDimensions = [{ entityType: "ScrapReason", valueId: scrapReasonId }, { entityType: "Employee", valueId: userId }]` (no WorkCenter — no operation context in ERP).
   - Tracked entity: set `status = 'Scrapped'` and KEEP its `quantity` (the record of what was scrapped — today's negative path decrements it; the Scrap branch must not). Insert a `trackedActivity` `type: 'Scrap'` (`sourceDocument: 'Item'`, `sourceDocumentId: itemId`, attributes `{ "Scrap Reason": scrapReasonId }`) + `trackedActivityInput` (entity, quantity).
   - Batch partial scrap (quantity < entity quantity): use `buildBatchSplitRecords` from `../shared/batch-split.ts` — the departing CHILD becomes the `Scrapped` entity, the parent keeps its id and is decremented (identity-flip convention).
4. **Unscrap branch** (tracked): payload carries `trackedEntityId` of a `Scrapped` entity + `unscrapOfItemLedgerId` (the original scrap `itemLedger` row). Steps: verify the entity is `Scrapped` (else throw); set `status = 'Available'`; positive `itemLedger` via `bookAdjustment` (`documentType: "Scrap"`, `correctionOfItemLedgerId: unscrapOfItemLedgerId`, same `storageUnitId` as the original scrap row, `scrapReasonId`, extraDimensions as above) with `fixedUnitCost` = original scrapped unit cost; `trackedActivity` `type: 'Unscrap'` + `trackedActivityOutput`.
5. **Unscrap branch** (untracked): positive adjustment through `bookAdjustment` with the scrap offset + reason, no `fixedUnitCost` (current cost — v1).
6. `resolve-unscrap-cost.ts`: pure function `resolveUnscrapUnitCost(rows: Array<{ quantity: number; cost: number }>): number | null` — given the original scrap movement's `costLedger` rows, return `Math.abs(total cost / total quantity)` or `null` when rows are empty/zero-quantity (caller then falls back to current cost). `deno test` covers: single row, multi-row, empty, zero-quantity.
7. Wire the cost lookup: `costLedger` rows are found by the scrap ledger row's id — check how `costLedger` links to `itemLedger` in this function's existing decrease path (it inserts both; find the linking column, e.g. `itemLedgerId` or `documentId`). If NO queryable link from an `itemLedger` row to its `costLedger` rows exists, STOP and report — do not guess a join.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test post-inventory-adjustment/resolve-unscrap-cost.test.ts
# Expected: all tests pass
# Own-file deno check delta = 0 for index.ts (same baseline method as Task 4)
```

**Out of scope:** `Set Quantity`, storage-unit transfers, `post-inventory-count` (all byte-identical); the MES `AdjustInventory` form (untouched in v1).

## Task 6: issue — jobOperationScrap case

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/supabase/functions/issue/index.ts` — new case
- Create: `packages/database/supabase/functions/issue/scrap-replacement.ts` — shared reopen/top-up/spawn helper (also used by Task 7)
- Copy from (precedent): `issue/index.ts` case `jobOperationSerialComplete` (lines ~1173–1386 pre-change)

**Steps:**
1. New payload member of the discriminated union: `{ type: "jobOperationScrap", id: jobOperationId, quantity, scrapReasonId, notes?, trackedEntityId?, setup/labor/machineProductionEventId?, companyId, userId }`. (The spec names the serial path `jobOperationSerialScrap`; implementation is ONE case discriminated internally by the make method's tracking flags — serial requires `trackedEntityId` and `quantity === 1`; batch/untracked take `quantity`. Note this naming consolidation in the PR description.)
2. In one Kysely transaction, mirroring `jobOperationSerialComplete`'s structure:
   a. Insert `productionQuantity` `{ type: 'Scrap', quantity, scrapReasonId, notes, jobOperationId, companyId, createdBy: userId }` + the event links (the quantity-sync interceptor aggregates `quantityScrapped`; with Task 2's predicate it no longer flips Done).
   b. Backflush the operation's materials for `quantity` units via `issueJobOperationMaterials` (same call the `jobOperation` case makes), **capturing the returned/computed total material cost** for step (e).
   c. Serial only: `trackedActivity` `type: 'Scrap'`, `sourceDocument: 'Job Operation'`, `sourceDocumentId: jobOperationId`, attributes `{ "Scrap Reason": scrapReasonId, ["Operation " + jobOperationId]: <index> }`; `trackedActivityInput` (entity, qty 1); update entity `status: 'Scrapped'` (keep quantity 1). If the entity's status is `Consumed` or already `Scrapped`, throw ("entity is not in progress").
   d. Serial only — spawn the next serial: same `getNextSerialNumbers(trx, { itemId, companyId, count: 1, locationCode, locationName })` + `Reserved`-entity insert (cloned attributes, `readableId` = spawned) as `jobOperationSerialComplete`, spawned when count of the make method's non-`Scrapped` entities < the good quantity still required (`targetQuantity` of the operation). Return `newTrackedEntityId`.
   e. GL (only when `companySettings.accountingEnabled`): one journal, Dr `accountDefault.scrapAccount ?? inventoryAdjustmentVarianceAccount` / Cr `workInProgressAccount`, amount = (b)'s actual current-op backflush cost + estimated prior-op material cost (Σ over the make method's `jobMaterial` rows attached to operations ordered BEFORE this one: `quantityPerParent-equivalent unit quantity × itemCost.unitCost`) × `quantity`. Use the `debit()`/`credit()` helpers, `sourceType` the same value the existing `createMaterialWipEntries` journals use, `documentType: 'Scrap'`, `documentId: jobId`. Dimension tags per the `post-adjustment.ts` mechanism: fetch active dimensions for entityTypes `["Item","ItemPostingGroup","Location","ScrapReason","WorkCenter","Employee"]` (company → `companyGroupId`, precedent `post-inventory-adjustment/index.ts:146-167`) and insert `journalLineDimension` rows for item, item's posting group, job location, `scrapReasonId`, the operation's `workCenterId`, and `userId`.
   f. `scrap-replacement.ts` helper `applyScrapReplacement(trx, { jobMakeMethodId, jobId, quantity, companyId, userId })`: (i) reopen the make method's operations `status = 'Ready'` where `status = 'Done'` (stamp `updatedBy`/`updatedAt` — null-audit lesson); (ii) compute cumulative allowance: root make method → `job.scrapQuantity`; if the job's cumulative actual scrap (Σ `quantityScrapped` of the make method's ops... use the make method's max op `quantityScrapped` + this quantity) exceeds the allowance, bump each op's `operationQuantity` by the excess and, when the make method is the root (`parentMaterialId IS NULL`), bump `job.scrapQuantity` by the excess; (iii) refresh the make method's `jobMaterial.estimatedQuantity`/`quantity` fields to per-unit quantity × new `operationQuantity` (read how those two columns relate on existing rows first; mirror the ratio). **`targetQuantity` is NEVER written.** (iv) invoke the same reschedule the `trigger-rework` function calls (find its invoke near the end of `trigger-rework/index.ts` and replicate).
   g. Call `applyScrapReplacement` for serial and batch parents (untracked too — the reopen/top-up logic is tracking-agnostic).
3. If `issueJobOperationMaterials` does not return per-call cost totals, compute the backflush cost in the case from the same inputs it uses (jobMaterial rows × `itemCost.unitCost`) — do NOT modify `issueJobOperationMaterials`' return type if other callers would be affected; prefer a local computation.

**Verify:**
```bash
# Own-file deno check delta = 0 for issue/index.ts + scrap-replacement.ts (Task 4 baseline method)
cd packages/database/supabase/functions && deno check issue/scrap-replacement.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -c "scrap-replacement.ts:"
# Expected: 0
```

**Out of scope:** `jobOperationSerialComplete` / `jobOperationBatchComplete` (unchanged); the auto-Done predicate (Task 2); labor/overhead in the scrap valuation (stays in WIP → close-job variance, decision 6).

## Task 7: issue — rework scrapTrackedEntity

**Depends on:** Task 6
**Files:**
- Modify: `packages/database/supabase/functions/issue/index.ts` — case `scrapTrackedEntity` (~lines 1682–1871 pre-change)

**Steps:**
1. Payload additions: `scrapReasonId: z.string()` (required), `makeReplacement: z.boolean().optional()`.
2. Common changes (all branches): entity `status: 'Scrapped'` (was `Consumed`); activity `type: 'Scrap'` (was `'Consume'` + `attributes.Scrapped`), attributes gain `{ "Scrap Reason": scrapReasonId }`; keep the `parentTrackedEntityId` output row behavior exactly as today.
3. **Non-Make-to-Order branch** (was: Consumption ledger + `createMaterialWipEntries` + `quantityIssued` bump) becomes:
   - `bookAdjustment` (import from `../shared/post-adjustment.ts`) with: `entryType 'Negative Adjmt.'`, `documentType 'Scrap'`, `documentId: jobId`, `scrapReasonId`, quantity negative, `storageUnitId` from `resolveTrackedEntityBin` (already imported in this file — never `.find(...)?.storageUnitId`), `trackedEntityId`, `accounting.offsetAccount = scrapAccount` fallback chain, `extraDimensions` = ScrapReason + WorkCenter (`material.jobOperationId` → operation's `workCenterId`) + Employee (`userId`).
   - DELETE the `jobMaterial.quantityIssued` bump (deliberate behavior change, spec decision 10 — the requirement stays open so the operator issues a replacement).
   - Batch partial (quantity < entity.quantity): `buildBatchSplitRecords` — departing child is the `Scrapped` entity.
4. **Make-to-Order branch** (was: genealogy only): keep no stock ledger; add the WIP→scrap journal using Task 6's step-(e) shape valued at the subassembly's accumulated material cost (its make method's `jobMaterial` unit estimates × quantity — resolve the subassembly's `jobMakeMethod` via the material's `jobMaterialWithMakeMethodId`/`jobMakeMethod.parentMaterialId` linkage; read `get_job_method`'s join in `20240915192542_job-methods.sql:217-288` for the exact columns). When `makeReplacement` is true: call `applyScrapReplacement` on the subassembly's `jobMakeMethod` + spawn a replacement `Reserved` serial entity when the subassembly requires serial tracking (same spawn as Task 6 step d); insert a `rework` row `{ jobId, triggeredAtJobOperationId: material.jobOperationId, targetJobOperationId: <first op of the subassembly make method by order>, reason: <scrapReason.name>, quantity, trackedEntityId, requestedById: userId, companyId }`.
5. If the material's `methodType` cannot be read where the branch splits (verify the existing `material.methodType !== "Make to Order"` guard at ~line 1820 still exists), STOP and report.

**Verify:**
```bash
# Own-file deno check delta = 0 for issue/index.ts (Task 4 baseline method)
grep -n "quantityIssued" packages/database/supabase/functions/issue/index.ts | wc -l
# Expected: count DECREASED vs git show HEAD (the scrapTrackedEntity bump is gone;
# other cases' quantityIssued writes remain)
```

**Out of scope:** `trackedEntitiesToOperation` / `unconsumeTrackedEntities` (their `.find` bin patterns and status writes are NOT in scope — scoped-fix lesson); `partToOperation`.

## Task 8: MES routes + validators for the new scrap paths

**Depends on:** Tasks 6–7
**Files:**
- Modify: `apps/mes/app/services/models.ts` — extend `scrapQuantityValidator`; add `scrapTrackedEntityValidator`
- Modify: `apps/mes/app/routes/x+/scrap.tsx` — route through the new edge case
- Modify: `apps/mes/app/routes/x+/entity+/$materialId.$trackedEntityId.scrap.tsx` — formData validation + new payload fields

**Steps:**
1. `models.ts`: `scrapQuantityValidator` already carries `jobOperationId`, `quantity`, `scrapReasonId` (required), `notes`, `trackedEntityId`, `trackingType` — no change needed; confirm and leave as-is. Add:
   ```ts
   export const scrapTrackedEntityValidator = z.object({
     scrapReasonId: zfd.text(z.string()),
     makeReplacement: zfd.checkbox(),
     notes: zfd.text(z.string().optional())
   });
   ```
   (Check `zfd.checkbox` exists in this file's zfd usage; if not, use `zfd.text(z.string().optional()).transform(v => v === "true" || v === "on")`.)
2. `x+/scrap.tsx`: replace the `insertScrapQuantity` + `issue type:"jobOperation"` pair with ONE service-role invoke of `issue` `{ type: "jobOperationScrap", id: jobOperationId, quantity, scrapReasonId, notes, trackedEntityId (when trackingType === "Serial"), setup/labor/machineProductionEventId, companyId, userId }`. Surface `{ error }` through the existing flash pattern; return the edge function's `newTrackedEntityId` in the action data so the client can navigate to the spawned serial (mirror how `x+/complete.tsx` returns its result — read that file first and copy its return shape).
3. Entity scrap route: parse `await request.formData()` through `validator(scrapTrackedEntityValidator)`; pass `scrapReasonId` + `makeReplacement` in the `issue` body. Keep `parentId` query-param handling as-is. Change `requirePermissions(request, {})` to `requirePermissions(request, { update: "production" })` on BOTH routes only if the existing MES mutation routes do so — check `x+/complete.tsx` first and match it exactly (do not invent a stricter gate than the app's convention).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
```

**Out of scope:** `insertScrapQuantity` in `operations.service.ts` — leave the function in place (the ERP `ProductionQuantityForm` writes `productionQuantity` rows through its own route; only the MES route stops calling it).

## Task 9: MES UI — QuantityModal serial confirmation + entity-scrap modal fields

**Depends on:** Task 8
**Files:**
- Modify: `apps/mes/app/components/JobOperation/components/QuantityModal.tsx` — scrap branch (~lines 289–297)
- Modify: the component that triggers the entity-scrap route (find it: `grep -rn "scrap" apps/mes/app/components --include='*.tsx' -l` then locate the caller of the `$materialId.$trackedEntityId.scrap` path helper — likely in `JobOperation.tsx`'s Materials section or `IssueMaterialModal.tsx`)
- Copy from (precedent): `QuantityModal.tsx` scrap branch itself (ScrapReason + notes composition); `apps/mes/app/components/JobOperation/components/ScrapReason.tsx`

**Steps:**
1. `QuantityModal` scrap branch: when the parent is serial-tracked (the modal already receives tracking context — it submits `trackedEntityId`/`trackingType` hidden fields per `baseQuantityValidator`), render the selected serial's `readableId` above the reason select ("Scrapping serial {readableId}" via Lingui `<Trans>`), and lock the quantity input to 1 (serial units are single). Batch/untracked branches unchanged. All MES components `size="lg"`.
2. On successful scrap of a serial with a spawned replacement (`newTrackedEntityId` in the action response), navigate to the new entity the same way the complete flow advances serials — find the `?trackedEntityId` navigation in `useOperation.tsx`/`AssemblyView.tsx` post-complete handling and reuse that exact mechanism.
3. Entity-scrap trigger: replace the current bare confirm (route invoke with no body) with a small modal: `ScrapReason` (required), notes `TextArea`, and — only when the material's `methodType === "Make to Order"` — a `Checkbox` "Make replacement" defaulting checked. Submit as formData to the same route. `size="lg"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes && pnpm run lint
# Expected: exit 0 for typecheck; lint clean on touched files
```

**Out of scope:** `AssemblyView.tsx` layout (it consumes the same shared modal + routes — no view-specific code unless the navigation hook from step 2 lives there, in which case touch only the navigation handler); the ERP `ProductionQuantityForm`.

## Task 10: ERP models/service/route for Scrap + Unscrap

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts` — `inventoryAdjustmentValidator` (~line 153)
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `insertManualInventoryAdjustment` passthrough
- Modify: `apps/erp/app/routes/x+/inventory+/quantities+/$itemId.adjustment.tsx` — no structural change; confirm passthrough

**Steps:**
1. `inventoryAdjustmentValidator`: change `adjustmentType` to `z.enum([...itemLedgerTypes, "Set Quantity", "Scrap", "Unscrap"])`; add `scrapReasonId: zfd.text(z.string().optional())`, `unscrapOfItemLedgerId: zfd.text(z.string().optional())`; extend the existing `.superRefine` to require `scrapReasonId` when `adjustmentType` is `"Scrap"` or `"Unscrap"` (`.refine` must return boolean / use ctx.addIssue — zod refine lesson).
2. `insertManualInventoryAdjustment`: it forwards the validated payload to the `post-inventory-adjustment` invoke — add the two new fields to its body object (keep the `{ data, error }` signature).
3. The adjustment route action already strips `requiresSerialTracking` and forwards the rest — verify the new fields flow through untouched; the storage-rules evaluation block treats Scrap as a negative (`pick`) movement and Unscrap as positive (`place`) — read how `adjustmentType` maps to the surface today and extend the mapping the same way.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** MES `apps/mes/app/services/inventory.service.ts` twin wrapper (the MES AdjustInventory form does not gain Scrap in v1).

## Task 11: ERP UI — Scrap adjustment type + Scrapped filter + Unscrap action

**Depends on:** Task 10
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Inventory/InventoryStorageUnits.tsx` — the adjustment modal
- Modify: `apps/erp/app/modules/inventory/ui/Traceability/TrackedEntitiesTable.tsx` — status filter + row action
- Copy from (precedent): the adjustment modal in `InventoryStorageUnits.tsx` itself (its type select + conditional fields); `apps/erp/app/components/Form/ScrapReason.tsx` for the reason select; existing row-action menus in `TrackedEntitiesTable.tsx`

**Steps:**
1. Adjustment modal: add a "Scrap" option to the adjustment-type select; when selected, render `ScrapReason` (required) and keep the quantity/storage-unit fields of the Negative-Adjmt. branch. Lingui for all new strings. ERP default `size="md"`.
2. `TrackedEntitiesTable`: ensure the status filter options include `Scrapped` (read how the status filter list is built — if it derives from the generated enum type, it may pick up `Scrapped` automatically; verify rather than hardcode). Add a row action "Unscrap" visible only when `row.status === "Scrapped"` and `permissions.can("update", "inventory")`: opens a modal (Drawer/Modal per this table's existing action precedent) with `ScrapReason` + confirm, posting to `path.to.inventoryItemAdjustment(itemId)` with hidden fields `adjustmentType="Unscrap"`, `trackedEntityId`, `quantity` = entity quantity, `locationId`, and `unscrapOfItemLedgerId` = the entity's scrap movement (fetch: the entity's `itemLedger` row with `documentType='Scrap'` and negative quantity, newest — if the table's loader can't provide it cheaply, pass only `trackedEntityId` and resolve the ledger row server-side in the edge function; choose the server-side option if the loader would need a new join).
3. Show scrap reason on Scrapped rows if the table already renders per-row metadata columns (optional — skip if it requires a new join; note the skip in the PR).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: exit 0; lint clean on touched files
```

**Out of scope:** the traceability graph view; `tracked-entity.expiry.tsx`; batch subdivision UI.

## Task 12: Sweep app-side predicate mirrors + serial-navigation helpers

**Depends on:** Task 3 (independent of Tasks 4–11 — parallelizable)
**Files:**
- Modify: `apps/mes/app/components/Inspection/InspectionView.tsx` (~line 385)
- Modify: `apps/mes/app/services/operations.service.ts` — `isSerialEntityIncompleteForOperation` (~line 1185), `getNextIncompleteSerialEntity` (~line 1205)

**Steps:**
1. `InspectionView.tsx` `opRemaining`: remove the `- (operation.quantityScrapped ?? 0)` term (scrap no longer reduces remaining good work; keep the `quantityReworked` term).
2. Run `grep -rn "quantityScrapped" apps/mes/app apps/erp/app --include='*.ts' --include='*.tsx'` and inspect every hit: any expression computing REMAINING work or a DONE condition as `target − complete − scrapped` (or `complete + scrapped >= target`) loses the scrap term; display-only usages stay (JobDag badge, the `operationQuantity + quantityScrapped` step-record navigation in `JobOperation.tsx`, kanban card counts, plain headings). List every changed and every deliberately-kept site in the task commit message.
3. `operations.service.ts`: both serial-navigation helpers currently treat `status !== "Consumed"` as incomplete — extend to `!["Consumed", "Scrapped"].includes(status)` (or the equivalent in the existing code shape).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes --filter=erp
# Expected: exit 0
grep -n "quantityScrapped" apps/mes/app/components/Inspection/InspectionView.tsx
# Expected: no hit inside the opRemaining computation
```

**Out of scope:** the DB predicate (Task 2); ERP production dashboards that merely display scrap totals.

## Task 13: Update rules docs

**Depends on:** Tasks 1–12
**Files:**
- Modify: `.claude/rules/traceability-model.md` — `trackedEntityStatus` enum gains `Scrapped`; Scrap/Unscrap activity types; the scrap→spawn flow
- Modify: `.claude/rules/mes-job-operation-ui.md` — scrap route behavior, auto-Done predicate change
- Modify: `.claude/rules/inventory-system.md` — ERP Scrap/Unscrap adjustment types, scrapAccount posting, ScrapReason dimension

**Steps:**
1. Update each rule's affected sections to describe the COMMITTED post-change behavior (document only what landed; cite the new migration filenames). Keep edits surgical — only sections invalidated by this feature.
2. Spec bookkeeping: check off the spec's acceptance criteria that are code-complete, add a changelog line "implemented — see plan .ai/plans/2026-08-07-scrap-unscrap-flow.md".

**Verify:**
```bash
grep -c "Scrapped" .claude/rules/traceability-model.md
# Expected: >= 1
```

**Out of scope:** the `docs/` Fumadocs site (follow-up via /carbon-docs after browser verification confirms final behavior — note it in the PR body).

## Task 14: Browser verification via /test

**Depends on:** all previous
**Files:** none (verification only)

**Steps:**
1. Boot the stack with plain `crbn up` (portless). If the stack cannot boot, the loop is BLOCKED, not done — report.
2. Invoke the `/test` skill against this feature with these scenarios (they mirror the spec's acceptance criteria):
   - Serial job qty 3: scrap the in-progress serial at op 2 from the **operation view** → verify entity `Scrapped`, replacement serial appears and is navigated to, op 1 reopened, `targetQuantity` still 3, `operationQuantity` 4, `job.scrapQuantity` 1 (psql assertions), and the op does not flip Done until 3 good complete.
   - Repeat the scrap from the **assembly view** on a second job → same DB effects.
   - Scrap a picked batch material entity (qty 2 of 5) from the Materials section → split child `Scrapped`, ledger −2 with reason, requirement still open.
   - MTO subassembly scrap with Make Replacement ON → reopened subassembly ops + `rework` row + spawned serial.
   - ERP: scrap an Available serial with reason → gone from on-hand/pickers, listed under Scrapped filter; then Unscrap → restored at original cost (psql: journal amounts equal the original scrap's).
   - Accounting enabled fixture: verify Dr scrapAccount / Cr WIP (or inventory) journal lines exist with ScrapReason/WorkCenter/Employee `journalLineDimension` rows (activate those dimensions in settings first).
   - Planned-scrap job (10 + 20%): 8 good + 2 scrap does NOT auto-Done.
3. Capture screenshots for the PR (net-new UI: ERP Scrap option, Scrapped filter + Unscrap action, MES scrap modal serial confirmation, entity-scrap modal).

**Verify:**
```bash
# /test playbook completes all scenarios; psql assertions return expected values
# Expected: every scenario green; screenshots saved for the PR
```

**Out of scope:** load/perf testing; Xero/QBO sync of scrap journals (follow-up).
