---
paths: []
triggers: []
promoted: null
---
# Never `git checkout` a generated file to undo a local patch — the user may have regenerated it

**Context:** Typechecking a new-column change in a worktree with no local database, the
generated `packages/database/src/types.ts` was patched by hand as a throwaway so `tsc`
could see the columns, then "restored" with `git checkout -- …/types.ts`. Meanwhile the
user had run `pnpm db:migrate`, which regenerated that file with the real columns.

**Problem:** The checkout reverted the user's regeneration to `HEAD`, silently leaving the
repo with types that no longer matched the live schema (the Deno copy,
`functions/lib/types.ts`, was untouched, so the two outputs disagreed). The first symptom
was a wall of `Duplicate identifier` errors from re-applying the throwaway patch on top of
the regenerated file.

**Rule:** Before reverting any generated file, `git diff` it and confirm the only changes
are yours. Prefer regenerating (`pnpm generate:types`, needs the local stack) over a
checkout; if there is no stack, keep the throwaway patch in a scratch copy rather than the
tracked file.

**Applies to:** `packages/database/src/types.ts`,
`packages/database/supabase/functions/lib/types.ts`,
`apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json`, any generated artifact.
