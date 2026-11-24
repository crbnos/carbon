---
paths: ["packages/database/src/picked-consumption.ts"]
triggers: ["linesideCredit", "get_lineside_credit", "generatePickingList", "get_picking_schedule", "getPickedBudgets"]
promoted: null
---
# Two readers of the same shelf must share one definition (2026-09-16)

- **Context:** the pick-list generator credited lineside material with an
  all-or-nothing on-hand check per item, the schedule SQL did its own version,
  and consumption followed pick lines only. A job whose two assemblies' parts
  were already at the work centre (one pair picked on a since-cancelled list,
  one produced by a sub-job straight into the bin) got a list for four more,
  and would have consumed the wrong part from the wrong bin.
- **Problem:** three code paths each answered "what is at the machine for
  this job?" with a different formula, and none of them was wrong in
  isolation. The trial found it in minutes because real shop floors leave
  material at the machine in every way except a clean pick.
- **Rule:** when picking, scheduling and consumption all read the same bin,
  write the definition ONCE as a pure function (`linesideCredit`), mirror it
  in SQL under the same name (`get_lineside_credit`), and make every reader
  call it. Then enumerate the ways stock reaches a bin — pick, cancelled
  pick, sub-job output, manual transfer, return — and test each against the
  definition before calling the feature done.
- **Applies to:** `generatePickingList`, `get_picking_schedule`,
  `getPickedBudgets` / `issue`, `post-picking`.
