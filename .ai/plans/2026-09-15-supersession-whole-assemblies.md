# Consume First: whole assemblies only

Customer feedback on the partial-stock split: a unit that needs 2 of a part must get
two of the SAME part. Old stock is used in whole multiples of the per-assembly
quantity; the odd part stays on the shelf. Units in a batch may differ from one
another; a single unit never mixes old and new.

## Tasks

- [x] 1. Shared helper `consumableInWholeAssemblies(onHand, perAssembly)` in
      `lib/supersession-pick.ts` (+ `RoundingMode.Down` in precision.ts), Deno tests.
- [x] 2. get-method: settle pass after insert handles BOTH directions with the
      per-assembly threshold — pull a successor line back when the predecessor covers
      ≥ 1 assembly; push a predecessor line to the successor when it covers none.
- [x] 3. `generatePickingList`: split at whole assemblies; predecessor "in stock" for
      Consume First means ≥ 1 assembly of the running balance.
- [x] 4. SQL `get_picking_schedule`: Consume First predecessor stock test ≥ per-assembly
      quantity (new migration); `openJobMaterialLines` gains `quantityPerParent`.
- [x] 5. Job materials note + Order Status netting round the same way.
- [x] 6. Item planning list split rounds per line.
- [x] 7. MRP post-explode Consume First pass nets per contributor in whole assemblies.
- [x] 8. Pick line notes (ERP + MES) and the materials note say how many assemblies.
- [x] 9. Rule doc, lessons, types regenerated, tests, typecheck, lint.

## Verification

- `deno test packages/database/supabase/functions/lib/supersession-pick.test.ts`
- `pnpm --filter ./apps/erp exec vitest run app/modules/inventory/supersession-pick.test.ts`
- `pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/ee`
- `pnpm run lint`
