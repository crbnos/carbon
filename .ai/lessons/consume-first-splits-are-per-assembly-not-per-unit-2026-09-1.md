---
paths: ["packages/database/src/supersession-pick.ts"]
triggers: ["consumableInWholeAssemblies", "Consume First", "supersessionMode"]
promoted: null
---
# Consume First splits are per assembly, not per unit (2026-09-15)

- **Context:** the Consume First partial-stock split picked the predecessor for
  every unit the warehouse had and the successor for the rest.
- **Problem:** with 2 per assembly and 3 on the shelf that put one old and one
  new part on the same unit. A customer would rather leave the odd part in
  stock than fit a mismatched pair; units of a batch may differ, one unit never.
- **Rule:** round a predecessor's usable on-hand DOWN to a multiple of the
  line's per-assembly quantity (`consumableInWholeAssemblies`) everywhere the
  split is computed — job creation, picking, the SQL schedule, the job
  materials note, Order Status, the planning list, MRP. A quantity rule that
  lives in seven places needs one helper, or the sites drift.
- **Applies to:** any allocation of a per-unit component across a batch.
