# Tracked-entity quantity integrity — four fixes (C → A → B → D)

Source spec: pasted brief (ZeroFarms prod tracked-entity defects). Audited against
`origin/main` on 2026-09-22 — **almost nothing had landed**; only pre-existing building
blocks (`getEdgeFunctionErrorMessage`, serial-unscrap refusal, `correct-stock-movement`
non-negative guard, MES validator already dropped `.int()`, `inputMode="decimal"`).

Order: **C → A → B → D** (A's pick-guards compare at scale from C; D's fractions flow
through C's split path). One branch, sequential conventional commits (no AI attribution).

Spec corrections found in audit:
- `equals()` does NOT exist in `shared/precision.ts` — PR C must add it.
- `greedyFillAllocation` lives in `apps/mes/app/services/allocation.ts`, not `shared/`.
- No `@carbon/database/allocation` export — the MES test extends `inventory.greedy.test.ts`.
- `issue/index.ts` gate sites are `:1463` and `:4673` (not 1201/4411).

---

## PR C — round at the persist boundary  `fix(production): round tracked-entity quantities at the persist boundary`

- [x] `shared/precision.ts`: add `equals(a, b, tolerance = EPSILON)`.
- [x] `shared/batch-split.ts`: import `round`; update header note; round `draw`/`parentQty`/`remaining` in `buildBatchSplitRecords` (child insert, parentUpdate, both ledger rows, both activity edges, Original/Drawn/Remaining blob); guards `draw <= 0`/`draw >= parentQty`. `buildMergeRecords`: round `mergeQuantity`/`childRemaining`; exact `=== 0` Consumed.
- [x] `shared/batch-merge.ts`: import `round`; sum parents then round once; round `receivedByBin` outputs + negative rows.
- [x] `apps/mes/app/services/allocation.ts`: `greedyFillAllocation` — `remaining = round(quantity)` then `remaining = round(remaining - take)`.
- [x] Gate `!==` → `!equals(...)`: `post-stock-transfer/index.ts:463`; `issue/index.ts` two sites (import `equals`).
- [x] Tests: `batch-split.test.ts` (draw 0.98 ⇒ parentUpdate {quantity:0.02}; 0.3000…4 merge; drain→Consumed); `batch-merge.test.ts` (0.1+0.2⇒0.3); `inventory.greedy.test.ts` (pool [0.98,5], need 1 ⇒ [0.98,0.02]).
- [x] Verify: `deno task test` (functions), `turbo typecheck --filter=@carbon/database --filter=mes`, `vitest` (mes), lint.

## PR A — stock-transfer pick correctness  `fix(erp): make stock-transfer picks idempotent and lot-aware`

- [x] `inventory.models.ts` `stockTransferLineScanValidator`: `quantity` positive, `storageUnitId` nullable optional.
- [x] Route `$id.scan.$lineId.tsx`: forward picker `quantity`+`storageUnitId`; action posts `validated.data.quantity` (serial 1) + `storageUnitId ?? currentStorageUnitId`; fully-picked pre-check; `getEdgeFunctionErrorMessage`.
- [x] `post-stock-transfer/`: new `pick-guards.ts` (`resolvePick`, `PickError`); batch case `.forUpdate()` + entity over-draw 400 + accumulate pickedQuantity; serial case lock + resolvePick + repeat-scan 400.
- [x] Tests: `pick-guards.test.ts` (Deno); `$id.scan.$lineId.test.ts` (vitest).

## PR B — zero/negative hygiene  `fix(production): stop adjustments leaving zero/negative Available lots`

- [x] `shared/entity-drain.ts`: `statusAfterQuantityChange`.
- [x] `post-inventory-adjustment/index.ts`: Consumed-on-0 on negative/set paths; `signedQuantity===0` new-entity no-op.
- [x] `post-inventory-count/index.ts`: `.forUpdate()` + THROW on `qty+delta<0` + Consumed on 0.
- [x] `create/index.ts` receipt split + `correct-stock-movement/index.ts`: conditional Consumed.
- [x] Migration: `trackedEntity_quantity_nonnegative` CHECK ... NOT VALID.
- [x] Tests: `entity-drain.test.ts`; count-guard pure fn + test.

## PR D — MES Complete Batch decimals  `fix(mes): accept decimal quantities and surface errors in Complete Batch`

- [x] `apps/mes/app/utils/display.ts`: `decimalInput` (SCALE truncate).
- [x] `BatchCompleteModal.tsx`: use `decimalInput`; field-level validation (`useField`/aria-invalid + message).
- [x] `models.ts`: delete stale INTEGER comment; `round()` at parse.
- [x] `batch-operations/index.ts`: drop `.int()`, `round()` members.
- [x] Tests: `display.test.ts` decimal cases; `models.batch.test.ts` decimal/round cases.
