---
paths: ["scripts/restore-database.sh"]
triggers: ["schema_migrations", "pg_restore"]
promoted: null
---
# The migration ledger must travel with the schema it describes

**Context:** A `crbn restore` left the people board dead ("Failed to load people assignments"): the dump's schema was weeks older than the branch, yet `supabase migration up` reported "schema already up to date", so ~60 migrations' worth of tables (people, workflows, inspections, the operationType enum consolidation) silently didn't exist.

**Problem:** The restore script dropped every `public` object and loaded the dump — but never touched `supabase_migrations.schema_migrations`. The local ledger (which recorded everything as applied against the PRE-restore database) survived, and the dump's own ledger rows lost their primary-key conflicts under `ON_ERROR_STOP=0`. Result: an older schema paired with a newer ledger, which makes every "apply what's pending" mechanism a no-op. Diagnosing it required probing per-migration artifacts (tables, enum values, functions) because the ledger could no longer be trusted; recovery was deleting the stale ledger rows and replaying, marking the two genuinely-applied ones on their loud "already exists" failures.

**Rule:** Any operation that replaces schema state wholesale (restore, snapshot rollback, volume swap) must replace the migration ledger in the same stroke — truncate it before the load so the source's ledger lands and anything the backup predates genuinely pends. When a ledger and its schema disagree, believe the schema: probe artifacts, don't trust records. `scripts/restore-database.sh` now truncates the ledger before loading the dump; `crbn restore`'s trailing `applyMigrations` step is unchanged and picks up the pending set.

**Applies to:** `scripts/restore-database.sh`, any future backup/restore or snapshot tooling.
