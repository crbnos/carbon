---
paths: ["packages/jobs/manifests/schema.json", "packages/jobs/src/scripts/check-backups.ts", "scripts/git-hooks/pre-commit"]
triggers: ["CARBON_SKIP_BACKUP_CHECK", "TABLE_RENAMES"]
promoted: null
---
# The backups schema baseline on main can carry phantom tables from a dirty local DB

**Context:** `pnpm db:check:backups` blocked the currency-refactor commit on `onshapeSyncRun`/`onshapeItemSyncState` — tables with NO migration anywhere in the repo.

**Problem:** `packages/jobs/manifests/schema.json` regenerates from the committing developer's LIVE schema. If that database has tables applied from an unmerged branch, they enter the committed baseline, and every later committer's check flags them as "dropped without a rename mapping" — a false alarm that invites `--no-verify` reflexes or, worse, bogus `TABLE_RENAMES: null` entries declaring never-shipped tables dropped.

**Rule:** When `db:check:backups` blocks on a missing table, first verify the table exists in ANY migration (`grep -r <table> packages/database/supabase/migrations/`). No migration ⇒ baseline pollution, not your break: regenerate `schema.json` from a clean fully-migrated database (the catalog code in `src/backups/schema.ts` + the manifest shape in `check-backups.ts`), commit it with `CARBON_SKIP_BACKUP_CHECK=1`, and say why in the commit message. Never add a rename entry for a table that never shipped.

**Applies to:** `packages/jobs/manifests/schema.json`, `packages/jobs/src/scripts/check-backups.ts`, `.husky/pre-commit`.
