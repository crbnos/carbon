<!--
Keep it short: no preamble, brief prose. Use Carbon's domain terms (docs/content/src/glossary).
Link the issue if there is one: Closes #1234
-->

## Summary

<!--
The smallest view that makes the change clear. Usually one of:
- pseudocode for logic
- a call tree for control flow
- a component tree for UI structure
- a shallow file tree for a refactor
- a Mermaid diagram for data flow between parts
- a ```diff of any of the above, when the point is what changed
-->

## Evidence

<!-- Show it works. Screenshots are best for UI changes; otherwise a test run or console output. Name the test that failed before and passes now. -->

- **Before:**
  **After:**

## Merge Danger

<!-- Two-way door: cheap to roll back. One-way door: hard to undo (migrations that drop or rewrite data, public API changes, destructive actions). -->

**Door:** <!-- one-way / two-way -->

**Blast Radius:** <!-- one word: e.g. none, local, module, app-wide -->

<!-- Optional: what could break if this is wrong (consumers, layout, mobile, other modules). -->
