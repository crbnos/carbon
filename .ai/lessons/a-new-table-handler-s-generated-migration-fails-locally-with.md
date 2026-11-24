---
paths: []
triggers: []
promoted: null
---
# A new table handler's generated migration fails locally with "must be owner"

**Context:** A new statement handler (`queue_pmi_inspection_plans`) was added to `event-system/handlers/` and `attachments.ts`. `pnpm db:migrate` synced it, then `authz migration` wrote the generated migration that ships it (2026-10-27).

**Problem:** The next `pnpm db:migrate` failed on that migration with `must be owner of function queue_pmi_inspection_plans`. The sync had created the function as `supabase_admin`. Every older handler is owned by `postgres`, the role the migration runs its `CREATE OR REPLACE` as. Production never syncs, so only a local database that synced first is affected.

**Rule:** If the generated migration of a new managed function fails locally with "must be owner", run `ALTER FUNCTION public.<name>() OWNER TO postgres;` as `supabase_admin`, then run `pnpm db:migrate` again. Do not edit the generated migration.

**Applies to:** `packages/database/src/event-system/handlers/*.sql`, `packages/database/src/event-system/functions/*.sql`, `pnpm --filter @carbon/database authz migration`.
