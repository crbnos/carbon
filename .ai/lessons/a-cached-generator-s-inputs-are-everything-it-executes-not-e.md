---
paths: []
triggers: []
promoted: null
---
# A cached generator's inputs are everything it executes, not everything it parses

**Context:** The MCP manifest generator was made a cached Turborepo task with `inputs`
listing the service, models and `types.ts` files it parses.

**Problem:** It also EXECUTES every `*.models.ts` to convert the zod validators, so the
schemas depend on whatever those files import: `sales.utils.ts`, `accounting.utils.ts`,
`samplingStandards`, `@carbon/utils`. A change to one of those was a cache hit; turbo
restored the old manifest (and the old committed digest) over the working tree, and the
build bundled it. Uncached, this could not happen.

**Rule:** Before caching a task, list what it loads and runs, not only what it reads on
purpose, and pin that list with a test against the task's real imports. If the true set
cannot be named, leave the task uncached.

**Applies to:** `//#generate:mcp` in `turbo.json` (pinned by
`apps/erp/test/mcp-manifest-cache-inputs.test.ts`), and any task given `inputs`.
