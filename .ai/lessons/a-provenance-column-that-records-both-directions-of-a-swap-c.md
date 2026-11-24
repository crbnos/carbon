---
paths: ["apps/erp/app/modules/inventory/supersession-pick.ts"]
triggers: ["substitutedFromItemId", "redirectedFromItemId", "resolvePickRule", "get_picking_schedule"]
promoted: null
---
# A provenance column that records both directions of a swap cannot be trusted first

**Context:** `jobMaterial.substitutedFromItemId` holds the predecessor on a line swapped forward at creation, and the SUCCESSOR on a line pulled back onto a stocked predecessor. Picking looked the rule up on that column first — correct for the forward case, and when the successor had a rule of its own (NEW → NEWER) the pulled-back line resolved NEW's rule, the roles inverted, and the pick went back to NEW.

**Problem:** "Column set ⇒ rule lives there" was true until the second writer appeared. The only thing that distinguishes the two shapes is the relation between the row's own item and the column: on a pulled-back line, the row's own rule NAMES the column as its successor.

**Rule:** When a provenance column can be written by more than one direction of a swap, resolve by relation, not by presence: prefer the row's own rule when it points at the column; only then fall back to the column's rule. Mirror the precedence in every SQL twin (`ORDER BY (own AND successor = column) IS TRUE DESC, …`). Or give the two directions distinct columns.

**Applies to:** `apps/erp/app/modules/inventory/supersession-pick.ts` (`resolvePickRule`), `get_picking_schedule`, any reader of `substitutedFromItemId` / `redirectedFromItemId`.
