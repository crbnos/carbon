# Plan 002: Tie `pickingListLineTrackedEntity` writes to create/update/delete permission

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `llm/plans/improve/README.md` — unless a reviewer dispatched you and told
> you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4ff79e2ed..HEAD -- packages/database/supabase/migrations/20260601143527_picking-lists.sql`
> If the original migration changed since this plan was written, re-read its
> `pickingListLineTrackedEntity` policy block before proceeding; on a mismatch
> with the "Current state" excerpt, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security / migration
- **Planned at**: commit `4ff79e2ed`, 2026-06-13

## Why this matters

The four Row-Level-Security policies on `pickingListLineTrackedEntity` (created
in `20260601143527_picking-lists.sql`) all use the **same** predicate — they
only check that the parent `pickingListLine` row *exists/visible*:

```sql
EXISTS (SELECT 1 FROM "pickingListLine" WHERE "id" = "pickingListLineId")
```

Because `pickingListLine`'s own SELECT policy grants visibility to anyone with
`inventory_view`, this means a user with **only view permission** can INSERT,
UPDATE, or DELETE tracked-entity allocation rows — the write policies never
require `inventory_create` / `inventory_update` / `inventory_delete`. Every
other picking table (`pickingList`, `pickingListLine`) correctly distinguishes
the four permission levels. This is a privilege-level conflation: read-only
inventory users can mutate FIFO allocations. (Cross-company isolation itself is
preserved transitively — the parent line's RLS scopes the subquery to the
caller's company — so this is a *within-company privilege* bug, not a
cross-tenant one. The fix also makes the company scope explicit rather than
implicit.)

`pickingListLineTrackedEntity` has **no `companyId` column** of its own (its PK
is `("pickingListLineId", "trackedEntityId")`), so the policy must reach the
company through the parent line. The fix is to make each write policy's EXISTS
predicate also require the matching permission on the parent line's company.

## Current state

The original migration is **forward-only and already applied** to the local dev
DB — do NOT edit it. You will write a NEW migration that drops and recreates the
four policies.

Current policy block, `packages/database/supabase/migrations/20260601143527_picking-lists.sql:467-503`:

```sql
-- pickingListLineTrackedEntity policies (no companyId - uses FK lookup)

DROP POLICY IF EXISTS "SELECT" ON "pickingListLineTrackedEntity";
CREATE POLICY "SELECT" ON "pickingListLineTrackedEntity"
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);

DROP POLICY IF EXISTS "INSERT" ON "pickingListLineTrackedEntity";
CREATE POLICY "INSERT" ON "pickingListLineTrackedEntity"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);

DROP POLICY IF EXISTS "UPDATE" ON "pickingListLineTrackedEntity";
CREATE POLICY "UPDATE" ON "pickingListLineTrackedEntity"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);

DROP POLICY IF EXISTS "DELETE" ON "pickingListLineTrackedEntity";
CREATE POLICY "DELETE" ON "pickingListLineTrackedEntity"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);
```

For reference, the parent `pickingListLine` policies (same file, `:423-465`)
use the standard Carbon pattern this plan mirrors:

```sql
CREATE POLICY "INSERT" ON "pickingListLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);
-- ...UPDATE → 'inventory_update', DELETE → 'inventory_delete',
--    SELECT → 'inventory_view'
```

### Carbon migration conventions (quoted inline)

From `llm/conventions/database.md` and `llm/tasks/lessons.md`:

- **New RLS pattern only**: `"companyId" = ANY ((SELECT
  get_companies_with_employee_permission('<perm>'))::text[])`. Standardized
  policy names `"SELECT"`/`"INSERT"`/`"UPDATE"`/`"DELETE"`. NEVER the deprecated
  `has_role(...) AND has_company_permission(...)` form.
- **Filename**: `packages/database/supabase/migrations/<UTC timestamp>_<slug>.sql`.
  The HHMMSS portion must be **randomized** (never `000000`) to avoid
  cross-branch primary-key collisions. Forward-only — do not rewrite history.
- This migration only `DROP`/`CREATE`s policies; it adds no tables/columns, so
  no audit columns / composite PK rules apply here.

## Commands you will need

| Purpose      | Command                                         | Expected on success   |
|--------------|-------------------------------------------------|-----------------------|
| Inspect refs | `grep -rn "get_companies_with_employee_permission('inventory_" packages/database/supabase/migrations/20260601143527_picking-lists.sql` | shows the 6 inventory_* uses on the parent tables |

There is **no executor-run verification command for SQL** in this plan: per
`AGENTS.md` and the Carbon command rules, the executor does **NOT** run
`npm run db:migrate`, `db:build`, `db:seed`, or any DB reset/rebuild. You write
the `.sql` file; the **user applies and verifies it**. Do NOT run a whole-repo
typecheck.

## Suggested executor toolkit

- Read `llm/workflows/database-migration.md` before writing the file (RLS
  section and the filename-timestamp warning).

## Scope

**In scope** (create exactly one new file):
- `packages/database/supabase/migrations/<new-timestamp>_picking-tracked-entity-rls.sql`

**Out of scope** (do NOT touch):
- The original `20260601143527_picking-lists.sql` (forward-only; already
  applied).
- Any other migration, any application code, generated types.
- Running migrations / rebuilding / reseeding the database — the **user** does
  that.

## Git workflow

- Branch: `improve/002-tracked-entity-rls-permissions`.
- Conventional commit: `fix: require inventory write perms for picking tracked-entity RLS`.
- Do NOT push/merge unless instructed.

## Steps

### Step 1: Choose the migration filename

Use a UTC timestamp **strictly greater** than the latest existing migration so
it sorts last. The picking-lists migration is `20260601143527`. Pick a later
date with a **randomized HHMMSS** (do not use `000000`). Example shape:
`20260613094217_picking-tracked-entity-rls.sql` — substitute today's date and
random HHMMSS. Confirm no existing file shares the timestamp:
`ls packages/database/supabase/migrations/ | grep <your-timestamp>` → empty.

### Step 2: Write the migration SQL

Create the file with exactly this content (the four policies, each predicate now
requiring the correct permission on the parent line's company):

```sql
-- Tighten pickingListLineTrackedEntity RLS so writes require the matching
-- inventory permission on the parent line's company, not merely line
-- visibility. The table has no companyId column; it reaches the company
-- through pickingListLine.

DROP POLICY IF EXISTS "SELECT" ON "pickingListLineTrackedEntity";
CREATE POLICY "SELECT" ON "pickingListLineTrackedEntity"
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine" pll
    WHERE pll."id" = "pickingListLineId"
      AND pll."companyId" = ANY (
        (SELECT get_companies_with_employee_permission('inventory_view'))::text[]
      )
  )
);

DROP POLICY IF EXISTS "INSERT" ON "pickingListLineTrackedEntity";
CREATE POLICY "INSERT" ON "pickingListLineTrackedEntity"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "pickingListLine" pll
    WHERE pll."id" = "pickingListLineId"
      AND pll."companyId" = ANY (
        (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
      )
  )
);

DROP POLICY IF EXISTS "UPDATE" ON "pickingListLineTrackedEntity";
CREATE POLICY "UPDATE" ON "pickingListLineTrackedEntity"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine" pll
    WHERE pll."id" = "pickingListLineId"
      AND pll."companyId" = ANY (
        (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
      )
  )
);

DROP POLICY IF EXISTS "DELETE" ON "pickingListLineTrackedEntity";
CREATE POLICY "DELETE" ON "pickingListLineTrackedEntity"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine" pll
    WHERE pll."id" = "pickingListLineId"
      AND pll."companyId" = ANY (
        (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
      )
  )
);
```

Note: the unqualified `"pickingListLineId"` in each predicate refers to the row
being checked on `pickingListLineTrackedEntity`; `pll."companyId"` is the parent
line's company. This matches how the original migration referenced
`"pickingListLineId"` unqualified.

**Verify**: `cat` the new file and confirm all four policies are present, names
are exactly `"SELECT"/"INSERT"/"UPDATE"/"DELETE"`, and the permission strings
are `inventory_view` (SELECT), `inventory_create` (INSERT), `inventory_update`
(UPDATE), `inventory_delete` (DELETE).

### Step 3: Hand off for application

Do NOT apply the migration. Report to the user that a new migration is ready and
needs `npm run db:migrate`/`db:build` (whichever the user uses) to apply, and
that they should verify a view-only inventory user can no longer insert/update/
delete `pickingListLineTrackedEntity` rows while a user with inventory_create/
update/delete can.

## Test plan

No automated tests (this is a SQL policy migration; the repo has no DB
integration-test harness the executor can run). Verification is the user's
manual RLS check described in Step 3:

- A user with `inventory_view` only: INSERT/UPDATE/DELETE on
  `pickingListLineTrackedEntity` is denied by RLS.
- A user with `inventory_create`: INSERT succeeds for their company's lines;
  cross-company lines remain invisible/denied.

## Done criteria

ALL must hold:

- [ ] Exactly one new migration file exists under
      `packages/database/supabase/migrations/`, timestamp later than
      `20260601143527`, HHMMSS not `000000`, unique.
- [ ] It DROPs and re-CREATEs all four `pickingListLineTrackedEntity` policies
      with `inventory_view/create/update/delete` respectively.
- [ ] The original `20260601143527_picking-lists.sql` is unchanged
      (`git diff 4ff79e2ed -- packages/database/supabase/migrations/20260601143527_picking-lists.sql` is empty).
- [ ] No application code or other migration changed (`git status`).
- [ ] The migration was NOT applied by the executor (no DB commands run).
- [ ] `llm/plans/improve/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows the original policy block differs from the "Current
  state" excerpt.
- `pickingListLineTrackedEntity` turns out to have a `companyId` column after
  all (re-check the CREATE TABLE around `20260601143527_picking-lists.sql:113`)
  — the predicate would then change and the plan needs revisiting.
- `get_companies_with_employee_permission` is not the helper used by the sibling
  `pickingListLine` policies in the same file (it should be) — do not invent a
  different helper.
- Applying the migration appears necessary to verify the change — it is not; the
  user applies it.

## Maintenance notes

- A reviewer should confirm the `issue` edge function / any server code that
  writes `pickingListLineTrackedEntity` runs with a client that holds the
  appropriate inventory permission (or a service-role client, which bypasses
  RLS and is unaffected). Tracked-entity *picking execution* is currently
  stubbed (`apps/mes/app/services/picking.service.ts:148` returns
  "Tracked-entity picking is not yet supported"), so the only current writer is
  ERP `generatePickingList` running as the RLS user who created the list — that
  user has `inventory_create`, so this tightening should not break the existing
  generation flow. Confirm during review.
- After commit, the migration becomes the new "latest" definition of these
  policies; any future change must fork from it.
