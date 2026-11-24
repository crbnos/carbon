---
paths: []
triggers: []
promoted: null
---
# `ON DELETE SET NULL` on a composite FK nulls every referencing column, not just the pointer

**Context:** A nullable pointer column that references a sibling table on Carbon's composite key, e.g. `workflow.activeVersionId` → `workflowVersion("id", "companyId")` (`20260730142317_workflows-foundation.sql`). Because every Carbon table is keyed `("id", "companyId")`, any such pointer FK is necessarily multi-column and includes `companyId`.

**Problem:** A bare `FOREIGN KEY ("activeVersionId", "companyId") REFERENCES ... ON DELETE SET NULL` sets **all** referencing columns to NULL when the parent row is deleted — including `companyId`, which is `NOT NULL`. The delete then fails with `null value in column "companyId" of relation "workflow" violates not-null constraint`, and the referenced row can never be deleted. It looks correct in review, applies cleanly, and only surfaces the first time something deletes the parent.

**Rule:** On a composite FK whose referencing columns include `companyId` (or any NOT NULL column), name the column in the action: `ON DELETE SET NULL ("activeVersionId")`. The column-list form needs Postgres 15+ (the local stack is 15.14). Same trap applies to `ON UPDATE SET NULL` and to `SET DEFAULT`. Always prove it with a real delete against the live schema — a migration that applies successfully tells you nothing about its referential actions.

**Applies to:** any migration adding a nullable pointer column that references another table's composite `("id", "companyId")` key.
