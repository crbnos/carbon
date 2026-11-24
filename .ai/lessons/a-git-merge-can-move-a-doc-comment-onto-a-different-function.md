---
paths: []
triggers: []
promoted: null
---
# A git merge can move a doc comment onto a different function

**Context:** Every API tool is declared by an `@mcp` line in its function's doc comment.
Main inserted a new function directly under an existing doc block.

**Problem:** The merge was clean, but the doc block (and its `@mcp` line) now sat above
the NEW function, and the function it described had none. That function silently stopped
being a tool. Nothing fails: an untagged export is simply not exposed.

**Rule:** After merging into a branch that touches service files, regenerate the manifest
and diff the tool NAMES against the pre-merge list. A name that disappears is a displaced
tag until proven otherwise.

**Applies to:** `apps/erp/app/modules/*/*.service.ts`, `pnpm run generate:mcp`.
