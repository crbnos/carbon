# Supersession trial fixes

Source: customer trial board (`.context/attachments/DqBNfz/Supersession Trial (1).pdf`),
supersession section. Old part = predecessor, new part = successor.

## Tasks

- [x] 1. Picking honours a job-creation swap. Look up the supersession on
      `COALESCE(substitutedFromItemId, itemId)`; Consume First pulls the predecessor while it
      has warehouse stock (qty / substitutionFactor); Prefer New falls back to the predecessor
      only while the successor has none. TS (`resolvePickTarget`, `generatePickingList`) and
      SQL (`get_picking_schedule`, new migration) mirror each other.
- [x] 1b. MRP nets a Consume First BUY component's on-hand before moving the shortfall to
      the successor (post-explosion pass in `mrp.ts`); made components keep the full swap.
- [x] 2. Planning tab shows incoming supersessions ("Supersedes") and offers "Add
      predecessor", which writes the row on the old item with this item as successor.
- [x] 3. Discontinuation Date keeps its label, gets a clearer description, optional for
      Consume First.
- [x] 4. Prefer New description matches the pick-time fallback.
- [x] 5. Stock Only joins `REDIRECTING_MODES` so production demand moves to the successor at
      job creation and in MRP.
- [x] 6. Cycle guard in `upsertItemSupersession` (service) surfaced as a field error.
- [x] 7. Update `.claude/rules/supersession-system.md`; run tests, typecheck, lint,
      `pnpm generate:mcp`.

- [x] 8. Job creation keeps a Consume First material on the predecessor while it has
      on-hand at the job's location (`withoutStockedConsumeFirst`); swaps only once it is out.

- [x] 9. Partial stock: job lines are never split at creation (one line on the predecessor,
      with a live "remaining M will be picked as NEW" note); `pullConsumeFirstPredecessors`
      pulls a successor line onto a stocked predecessor; `generatePickingList` splits pick
      lines; pick-side rule lookup falls back to the row's own item.
- [x] 10. "Picked as X in place of this item" note on the job materials page; clearer
      substitution note on ERP and MES picking lines.

- [x] 11. Cancelling a job returns picked-but-unconsumed material from lineside to the
      warehouse (`$jobId.status.tsx` → `returnJobRemainders`, guard accepts Cancelled).

- [x] 12. Planning sees the redirect: MRP moves the actual-demand share to the successor
      (`demandActual`); the job materials Order Status nets a Consume First shortfall against
      the successor and names it in the badge.

- [x] 13. Item planning tab list: open job material lines follow the rule (predecessor keeps
      what its stock covers, successor shows the rest "via OLD"), matching the chart bars.

- [x] 14. Consumption follows what was picked (`lib/picked-consumption.ts`): completion
      backflush, manual/step issue and the return sweep read the pick lines per item, old
      part first; the material row is untouched.

## Verification
- `deno test packages/database/supabase/functions/lib/picked-consumption.test.ts`

- `deno test packages/database/supabase/functions/lib/supersession-pick.test.ts`
- `pnpm --filter ./apps/erp exec vitest run app/modules/inventory/supersession-pick.test.ts`
- `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee`
- `pnpm run lint`
- `pnpm check:manifest`
