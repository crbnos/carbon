---
paths: []
triggers: ["quantityPicked", "quantityReturned", "update_picking_list_status", "returnPickedRemainder"]
promoted: null
---
# Returns must not decrement pickingListLine.quantityPicked — the status trigger demotes terminal headers

**Context:** Building the picked-material return sweep (spec `.ai/specs/2026-08-04-picked-material-return-timing.md`). The original `returnPickedRemainder` case in `post-picking` decremented `pickingListLine.quantityPicked` when flushing un-consumed staged stock back to the warehouse at job complete.

**Problem:** `update_picking_list_status` (AFTER UPDATE ROW on `pickingListLine`, newest body `20260728120100`) fires on any `quantityPicked` change. After the decrement the line satisfies `quantityPicked < quantityToPick`, so the trigger's work-remains branch moves a `Completed`/`Partial` picking-list header back to **In Progress** — the automatic job-complete sweep was silently reopening completed picking lists. The demotion is CORRECT for an operator unpick (work regression); it is wrong for a post-completion return.

**Rule:** Book returns on `pickingListLine.quantityReturned` (added `20260804111631`) and leave `quantityPicked` as gross-picked; net staged at lineside = `quantityPicked − quantityReturned`. Only genuine unpicks (operator reversing work) may decrement `quantityPicked`. Any new writer of `pickingListLine.quantityPicked`/`status` must first check what `update_picking_list_status` will do with the change. `pickingListLineTrackedEntity` allocations are different — returns DO decrement those (availability RPCs net them out; no trigger watches that table).

**Applies to:** `postPicking` (`apps/erp/app/modules/inventory/inventory.service.ts`, all return/unpick cases), `update_picking_list_status` migrations, any code mutating `pickingListLine` quantities.
