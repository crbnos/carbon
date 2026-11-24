---
paths: []
triggers: []
promoted: null
---
# A failed COPY in a plain-text dump can swallow the rest of the restore

**Context:** On 2026-10-09 a `crbn restore` of a prod cluster backup ended with ✅. The restored database had no index, constraint, trigger or policy in `public`, and an empty migration ledger. The trailing `migration up --include-all` would then have replayed all 1,159 migrations.

**Problem:** The local stack's auth, storage and realtime tables come from its own service images, and they are older than prod's. Prod's `storage.objects` has a column (`archived_at`) that the local table does not have. A `COPY` that names an unknown column or table fails when psql parses it, so psql never enters copy mode. It then reads the block's data rows as SQL. In that data an unbalanced quote opened a string that never closed, so psql read the rest of the file as part of it. With `ON_ERROR_STOP=0`, nothing failed. The same drift also reaches DDL. The backup's newer `storage.protect_bucket_control_columns` trigger reads columns that the local `storage.buckets` does not have, so every bucket insert failed. Those service-schema objects survive later restores, because a restore drops only `public`. Separately, a Supabase backup is not one consistent snapshot: it contained payments whose journal it did not hold. So 15 foreign keys could not be validated.

**Rule:** Do not trust a restore that ran with `ON_ERROR_STOP=0` until you verify it by name. `scripts/restore-database.sh` now does these things:

1. It fits each non-public `COPY` to the local columns, and drops the block when the local table does not exist.
2. It skips function definitions owned by the auth, storage and realtime admin roles. Those functions belong to the local service images.
3. It checks each `public` index, constraint, trigger and policy from the dump, and the ledger row count. It re-adds a foreign key that cannot be validated as `NOT VALID`.
4. It exits 1 on any shortfall, and `crbn restore` then does not migrate.

A ✓ that a script prints after a step that is allowed to fail is not evidence. Read the state back.

**Applies to:** `scripts/restore-database.sh`, `packages/dev/src/commands/restore.ts`, and any tool that loads a plain-text dump through psql.
