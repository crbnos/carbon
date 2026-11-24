---
paths: []
triggers: []
promoted: null
---
# Consume First is one rule for bought and made parts (2026-09-16)

- **Context:** the Consume First stock-netting was written for bought parts
  only. A made predecessor always swapped to its successor — at job creation
  (`loadSupersessionRedirect`'s Make exclusion) and in MRP (full BOM swap) —
  because the post-explosion pass that moved the bought shortfall could not
  explode a made successor's BOM.
- **Problem:** stocked old sub-assemblies were never used: a job named the new
  bracket while old brackets sat on the shelf, and planning bought the new
  bracket's ingredients for the whole quantity. The two "made" special cases
  were a workaround for where the netting lived, not a product decision.
- **Rule:** put the netting where the successor can still be planned as
  itself. In MRP that is INSIDE `explodeBom` (`consumeFirstRedirect`): the old
  part nets its running balance and moves the shortfall to the successor,
  which then explodes or buys at a deeper level (a synthetic leveling edge
  keeps it below the predecessor). In job creation the per-line settle pass is
  the authority for every Pull from Inventory line, and the item-level filter
  is provisional. When a rule has a replenishment-specific exception, ask
  whether the exception is a product decision or an artefact of where the
  code sits.
- **Applies to:** `lib/mrp-engine.ts`, `packages/ee/src/planning/mrp/mrp.ts`,
  `get-method` `settleConsumeFirstLines` / `loadSupersessionRedirect`.
