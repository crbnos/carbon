---
paths: ["packages/database/supabase/functions/**"]
triggers: ["deno check"]
promoted: null
---
# Deno edge functions are not deno-check-clean — gate on own-file error deltas, not exit code

**Context:** Verifying new/edited Supabase edge functions (`post-inventory-adjustment`, `post-inventory-count`) with `deno check`.

**Problem:** `deno check` on ANY edge function fails with ~10–20 pre-existing errors from the shared dependency graph (TS2589 in `shared/get-next-sequence.ts`, kysely pool-config type skew, supabase-js generic inference collapsing to implicit-any callbacks). CI never runs `deno check`, so committed, working functions fail it — a red exit code proves nothing about the change, and chasing those errors means rewriting shared files out of scope.

**Rule:** Obsolete: the two remaining edge functions (`embedding`, `thumbnail`) are self-contained and `deno check`-clean, and CI's `edge-functions` job runs `deno check` on both — keep them clean; a red exit code is now a real failure.

**Applies to:** `packages/database/supabase/functions/**` verification; `.claude/skills/check-and-commit` runs touching edge functions.
