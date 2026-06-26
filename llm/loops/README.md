# llm/loops — loop bindings + ledgers

Home for the `build` conductor skill's work items.

- **Binding:** `llm/loops/<id>.loop.md` — one work item. YAML-ish frontmatter parsed by `@carbon/harness` `parseBinding` (no YAML lib; scalars + an `acceptance` list).
- **Ledger:** `llm/loops/<id>/ledger.jsonl` — append-only record of each loop iteration (change, gate results, keep/revert, reason). Written by `@carbon/harness` `appendLedger`.

## Binding format

```markdown
---
id: bug-reorder-align
kind: bug            # bug | feature | usability | copy
title: Reorder button misaligns on short rows
risk: low            # low | med | high
acceptance:
- Reorder button vertically centers in the row at <640px
- No new console errors on the line-items page
---

Freeform notes / context for the loop (optional).
```

Each `acceptance` bullet is a definition-of-done the loop must satisfy and prove via a gate.
