---
paths: []
triggers: ["status: \"Ready\"", "SET status = 'Ready'", "updateJobStatus"]
promoted: null
---
# Guard a state by listing everything that writes it, not by who calls the check

**Context:** Strict backflush (2026-10-17). Release had to refuse a job with a line that had no storage unit. The check was added where the release check already ran: the Release dialog, bulk release, batch release.

**Problem:** Two more paths set a job to Ready without any check. The kanban scan with auto-release wrote `status: "Ready"` straight to the job with the service role. The MCP / API tool `production_updateJobStatus` wrote any status. A search for callers of the release function cannot find a direct write. A self-review on a fixed file list did not look outside it, and the docs then claimed "every release path".

**Rule:** To guard a state change, first list every writer of that state: grep for the value being written (`status: "Ready"`, `SET status = 'Ready'` in SQL) and for every caller of the write function, including MCP tools. Put the check where all writers meet, or give each writer the check. Keep the unchecked write out of the API (no `@mcp` tag). Do not claim "every path" without that list.

**Applies to:** release, completion, posting, cancellation — any status a check must gate.
