---
paths: ["packages/database/src/job-quantities-engine.ts"]
triggers: ["get_picking_schedule", "generatePickingList", "itemToJobMakeMethod", "itemToJob", "settleConsumeFirstLines"]
promoted: null
---
# A Make to Order line is never picked, and never split for Consume First (2026-09-16)

- **Context:** a Consume First sub-assembly on a Make to Order BOM line, three
  old on the shelf, five needed. The job swapped the line to the successor and
  built five (Plate B 5), and the picking list ALSO staged three old and two
  new from the shelf for the parent operation.
- **Problem:** two bugs stacked. `get_picking_schedule` never excluded Make to
  Order lines, and since unassigned materials are attributed to the first
  operation every Make to Order sub-assembly got a phantom pick that nothing
  consumes (`issue`'s backflush skips Make to Order). And the made-line rule
  "always swap" meant stocked old sub-assemblies were never used. The obvious
  fix — split the line into "pick 3 old" + "build 2 new" — dies at the next
  `recalculate`, which rebuilds every line as per-assembly × parent quantity.
- **Rule:** a Make to Order line follows the bought Consume First rule by
  CHANGING METHOD TYPE, not by splitting: when the predecessor covers one whole
  assembly it becomes a Pull from Inventory line on the predecessor (decided in
  the row builder, before insert, so no sub-method row is ever created), and
  picking splits per unit as for any picked line; otherwise it swaps and is
  built. Picking excludes Make to Order lines everywhere (SQL + TS). When a
  fix needs two rows where the BOM has one, check what `recalculate` will do
  to them before writing it.
- **Applies to:** `get-method` row builders (`itemToJob`,
  `itemToJobMakeMethod`), `generatePickingList`, `get_picking_schedule`,
  `lib/job-quantities-engine.ts`.
