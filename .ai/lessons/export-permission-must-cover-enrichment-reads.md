---
paths: []
triggers: []
promoted: null
---
# Export permission must cover enrichment reads

**Context:** AR/AP aging CSV downloads admit accounting or invoicing viewers, then
look up customer or supplier names to label the rows.

**Problem:** Customer RLS requires sales view and supplier RLS requires purchasing
view. An otherwise authorized export received empty name results and silently
fell back to party IDs.

**Rule:** Trace every enrichment lookup against the route's permission contract.
After authorizing the export, use a company-scoped privileged read when the
related table has a narrower RLS gate than the export itself.

**Applies to:** AR/AP aging CSV routes and other server exports that enrich
authorized rows from tables protected by different module permissions.
