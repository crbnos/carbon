---
paths: []
triggers: []
promoted: null
---
# A migration from main can fail on a local database that already ran a newer branch migration

**Context:** Merging `origin/main` into `projects-wbs-research-spec` (2026-10-11). The branch's `20261021004800_planning-rpcs-segment.sql` drops and creates `get_purchasing_planning` with an extra output column, `planningSegmentId`. Main's `20261009181437_supplier-part-currency.sql` has an OLDER timestamp. It renames `supplierPart.unitPrice` to `supplierUnitPrice` and then does `CREATE OR REPLACE` on the same function with main's return type.

**Problem:** Local databases on the branch had run 135634 already. `pnpm db:migrate` then applied 181437 out of order, and statement 8 failed with `cannot change return type of existing function`. The migration rolled back, so nothing was half-applied. On a NEW database the order reverses: 181437 runs first and renames the column, and then 135634 failed too, because a `LANGUAGE sql` body is checked at creation (`check_function_bodies` is on) and it read `ps."unitPrice"`. The clobbers check saw neither problem: the branch DROPs and CREATEs, and the check compares names, not bodies.

**Rule:** After you merge main, compare the function names that main's new migrations define with the names that the branch's migrations define (DROP + CREATE included). For each match, do these things:

1. Write one NEW migration, dated after both, that carries both changes (here `20261021010900_merge-main-job-costing-and-planning.sql`).
2. If the branch migration has not shipped, also fix the branch migration so that it applies AFTER main's migration on a new database (here `20261021004800` now reads `supplierUnitPrice` and `currencyCode`).
3. For a local database that ran the branch migration first, do this one-off step before `pnpm db:migrate`. It is safe because nothing depends on the function in `pg_depend`, and the new migration creates the function again:

```bash
docker exec -i <worktree>-postgres-1 psql -U postgres \
  -c 'DROP FUNCTION public.get_purchasing_planning(text, text, text[]);'
pnpm db:migrate
```

Never edit main's migration to make it apply.

**Applies to:** every local database of this branch that applied `20261021004800` before it merged main; any merge where both sides redefine one function and the return type differs.
