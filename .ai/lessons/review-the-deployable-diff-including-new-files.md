---
paths: []
triggers: []
promoted: null
---
# Review the deployable diff, including new files

**Context:** Adding MES bin loaders backed by new database RPCs.

**Problem:** The service and UI changes were visible in the diff, but the new route and migration were untracked, so deploying the reviewed patch would leave the requests returning 404 and the RPCs missing. A follow-up picker change also called the single-item stock RPC once for every material revision.

**Rule:** Before requesting review, check `git status --short` and `git diff --cached --stat` for every new route and migration that a changed call site needs. For stock shared across item revisions, collect the revision IDs and use one set-based, company-scoped read.

**Applies to:** MES routes and inventory services, ERP inventory RPC callers, and `packages/database/supabase/migrations/`.
