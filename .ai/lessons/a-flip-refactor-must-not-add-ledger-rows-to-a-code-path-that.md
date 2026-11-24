---
paths: ["apps/erp/app/modules/inventory/inventory.service.ts"]
triggers: ["buildBatchSplitRecords", "Batch Split"]
promoted: null
---
# A flip/refactor must not add ledger rows to a code path that deliberately posted none

**Context:** Implementing the batch-split identity flip (spec `2026-08-04-batch-split-identity-flip.md`) via a shared `buildBatchSplitRecords` builder that emits a 2-row net-zero `Batch Split` `itemLedger` pair. Wired it into all five split writers uniformly, including `post-shipment`'s Purchase-Order-sourced block.

**Problem:** The pre-flip `post-shipment` PO block (subcontract / outside-processing shipments against a PO) wrote split **genealogy only** — `trackedEntity` + `trackedActivity` + output rows — and posted **zero** `itemLedger` rows, unlike the SO block which posts a `Sales Shipment` negative-adjustment the split pair complements. Mechanically wiring the builder's ledger inserts into the PO block introduced a −q on the parent that nothing in that path offsets, changing inventory behavior for subcontract shipments with unclear valuation consequences. Own-file `deno check` and typecheck stay green (it compiles fine), so only reading the ORIGINAL of each branch caught it. Self-review found it; the browser e2e never would have (no shippable PO fixture).

**Rule:** When applying a uniform transformation across N sibling branches, diff each branch against its own pre-change body — don't assume they were symmetric. A branch that posted no ledger, sent no email, fired no event before your change must still post/send/fire nothing after, unless the spec explicitly says otherwise. "It typechecks and the other four branches do it" is not evidence the fifth should. Preserve per-branch behavior; the flip's mandate was which id departs, not to newly introduce inventory movements.

**Applies to:** `apps/erp/app/modules/inventory/inventory.service.ts` (PO vs SO split blocks); any refactor threading a shared record-builder through multiple writers (`post-*`, `issue`, sync handlers).
