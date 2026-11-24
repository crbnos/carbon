---
paths: []
triggers: []
promoted: null
---
# A merged-away table breaks every existing backup unless the rename map and schema manifest move with it

**Context:** The sales-rules PR (#1382) merged `storageRule` / `storageRuleItemAssignment` / `storageRuleWorkCenterAssignment` into the shared `enforcementRule*` tables and dropped the old ones. The branch shipped with no `TABLE_RENAMES` entries and a stale `packages/jobs/manifests/schema.json` still listing the dropped tables.

**Problem:** A restore that meets an unmapped missing table refuses by design (`applyTableRenames` → `assertBackupImportable`), so every customer backup taken before the merge would stop restoring the moment it shipped. The pre-commit `db:check:backups` gate that catches this only runs against a migrated LOCAL database — on a worktree with no dev stack the hook skips with a warning, which is exactly the state a reviewer or merge-fixer is in.

**Rule:** A migration that renames or drops any tenant-scoped table needs, in the same commit: (1) a `TABLE_RENAMES` entry (`packages/jobs/src/backups/renames.ts` — new name, or `null` if the feature died), (2) a default (or nullability) on any NEW NOT-NULL column of the rename target so old backup rows can load, and (3) a regenerated `manifests/schema.json`, which requires running `pnpm db:migrate` + `pnpm db:check:backups` against a live local DB. If the DB isn't running, say so — a skipped hook is not a passed check.

**Applies to:** `packages/database/supabase/migrations/**` table renames/drops, `packages/jobs/src/backups/renames.ts`, `packages/jobs/manifests/schema.json`, `.claude/rules/workflow-database-migration.md` step 3b.
