---
paths: []
triggers: []
promoted: null
---
# A shared executor acquires callers nobody planned for — grep every importer before deleting one

**Context:** The oRPC migration plan said MCP `call_tool` and the in-app agent were the two consumers of the MCP `direct-executor.ts`, so once both moved to `callOperation` the file could be deleted. A pre-deletion grep found a THIRD caller: `apps/erp/app/routes/api+/inngest.ts` registered `executeFunction` as the workflow engine's `setWorkflowDispatch` seam — every customer workflow `*.create` action ran through it.

**Problem:** A convenient shared function gets wired into new seams (dependency-injection slots, dispatchers, adapters) without its own file ever changing, so the mental list of "who uses this" goes stale. Deleting it on the strength of the plan's caller list would have broken customer workflow create actions in production while every named caller kept working.

**Rule:** Before deleting or changing the contract of any shared executor/service entry point, grep the WHOLE repo for its name (not just imports of its file — injection sites pass it by value: `setX(fn)`, `register(fn)`, config objects), and treat each hit as a caller to migrate in the same change. A DI/seam registration is a caller even though the dependency arrow points away from the file.

**Applies to:** `apps/erp/app/routes/api+/v1+/lib/call.server.ts` (the shared entry point now), `packages/jobs/src/workflows/actions/dispatcher.ts`, any `set*`/`register*` seam.
