---
paths: []
triggers: []
promoted: null
---
# A function redefined by forking its last migration picks up whatever that fork did

**Context:** Database functions were changed by copying the newest definition into a new migration and editing it. `create_audit_log_table` was forked several times; one fork made its existing-table branch re-attach the append-only trigger and re-run `secure_audit_log_table` unconditionally, and `insert_audit_log_batch` calls it on every write.

**Problem:** `CREATE TRIGGER` fires PostgREST's `pgrst_ddl_watch` event trigger, which reloads the schema cache. With one audit table and one search table per company that reload took 10-13 s in production, and every request with an embed waited for it: 480+ reloads a day, each one stalling joins for every company. No test or review could see it, because each fork looked like a small diff against a file nobody reads end to end. `dispatch_event_batch` lost its composite-key pairing the same way once.

**Rule:** A function that changes more than once is authored as a single file, not as a chain of forks. The event system's functions live in `packages/database/src/event-system/functions/<name>.sql`; edit the file and run `pnpm --filter @carbon/database authz migration <name>`. A function on a write path must not run DDL: check the catalog first and only repair what is missing (`audit-log-no-ddl-on-write.test.sql` asserts the trigger and policy oids do not change across writes).

**Applies to:** `packages/database/src/event-system/functions/`, `packages/database/src/authz/helpers/`, `no-authz-ddl-in-migrations` (`@carbon/checks`).
