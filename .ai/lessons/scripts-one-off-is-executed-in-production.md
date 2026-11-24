---
paths: ["scripts/one-off/**"]
triggers: ["scriptRun"]
promoted: null
---
# `scripts/one-off/` is executed in production

**Context:** A codemod that added `@mcp` tags to service files was saved as
`scripts/one-off/tag-mcp-exposure.ts` — "a script run once".

**Problem:** That folder is a registry, not a scratch area. `ci/src/migrations.ts` runs
every `.ts` file in it against every workspace database on the next deploy and records it
in `scriptRun`. A source-rewriting codemod there would have been executed by the deploy
workflow.

**Rule:** `scripts/one-off/` is only for one-time DATA migrations (see its README). A
codemod is run locally and deleted, or lives in `scripts/` if it is worth keeping.

**Applies to:** anything added under `scripts/one-off/`.
