---
paths: []
triggers: []
promoted: null
---
# Regenerated DB types carry whatever the local database holds

**Context:** A worktree's local database is shared by every branch checked out in it. `pnpm db:migrate` regenerates `packages/database/src/types.ts` from that database, not from the branch's migrations.

**Problem:** The regenerated types picked up another branch's table and columns on two SQL functions that no migration defines. CI's "Database types" job regenerates from migrations alone, so the committed types failed it. Applying the wanted hunks with `git apply --unidiff-zero` then put new function types inside an unrelated type, because zero-context hunks do not anchor in a 100k-line file.

**Rule:** After regenerating, diff `types.ts` against the base branch and keep only the lines your migration explains; restore the rest. Move them by matching text (the table's `Row` / `Insert` / `Update` blocks, the function's alphabetical neighbour), never by zero-context patches. The typecheck and CI's "Database types" job are the proof.

**Applies to:** Any branch with a migration, in a worktree whose database has run other branches' migrations.
