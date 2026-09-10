# Backup durability and transparency — implementation plan

**Spec:** `.ai/specs/2026-08-25-backup-durability.md`
**Reader doc:** `.ai/docs/backups.html`
**Branch:** `feat/backup-durability`

Scope confirmed with the user: all three parts in one plan. The
`companyId`-in-primary-key migration is **out of scope** — separate design pass.

**Restructure, 2026-08-25 (user decision).** Part 2's automated check was planned as a
CI job on migration PRs and got blocked on container cost and schema availability. It
is now a LOCAL command (`pnpm db:check:backups`) run from `.husky/pre-commit`, driven
by committed manifest vintages instead of a migration replay. Tasks 15 and 18 are
rewritten, Tasks 16 and 17 are dropped, and there is no GitHub Actions workflow in
this plan. See Task 15 for why.

**Correction pass, 2026-08-25 (user decision, after reading the feature back
end-to-end).** Tasks 18 and 19 are REVERTED: the automatic weekly backup, the
90-day deletion and the on-screen expiry date all acted on customer data without
being asked, and the dated manifest vintages depended on a person remembering.
Tasks 22–29 remove them and replace the vintages with one self-maintaining
`packages/jobs/manifests/schema.json`. The whole nightly cron is gone.

**Reversal pass, 2026-08-26 (PR review feedback).** Tasks 4, 6 and 20 are REVERTED and
their code deleted. The export refusing an out-of-scope row is a tenant-leak detector,
not a backup defect, so the hard refusal is back and the exclusion path is gone; the
nightly monitor only logged, so it fails this repo's own "no detection without a
consumer" rule; and the SQL migration guarded three functions that only READ the bad
rows, so it tolerated the problem instead of preventing it. The edge-function fixes
(Tasks 2 and 3) SURVIVE — they are the actual write path. Full reasoning:
`.ai/reviews/2026-08-26-tenant-leak-feedback.md`, and the banner atop the spec.

## Progress

- [x] Task 1: Confirm the cross-tenant write path at the `schedule` call sites
- [x] Task 2: Verify job ownership inside the `schedule` edge function
- [x] Task 3: Verify job ownership inside the `trigger-rework` edge function and scope its dependency read
- [~] Task 4: Scheduled cross-tenant reference monitor — **REVERTED 2026-08-26**, deleted: it only logged (spec D10)
- [~] Task 5: Capture evidence and clean up the four bad rows — **SKIPPED by decision (2026-08-25)**
- [~] Task 6: Harden `check_operation_dependencies` and `finish_job_operation` — **REVERTED 2026-08-26**, migration deleted: those functions only READ the bad rows
- [~] Task 7: Export skips unrestorable rows instead of refusing — **REVERTED 2026-08-26**: the refusal is a tenant-leak detector (spec D3)
- [x] Task 8: Rewrite export failure and partial-success copy
- [x] Task 9: Report-mode compatibility API
- [x] Task 10: Shared table → product-area map
- [x] Task 11: Write `compatibility.json` beside the manifest, and badge the Backups list from it
- [x] Task 12: Renamed/dropped table map
- [x] Task 13: Pre-restore disclosure screen
- [x] Task 14: Conformance check — new NOT NULL columns must have a DEFAULT
- [x] Task 15: Local `db:check:backups` command + pre-commit hook — **restructured, unblocked, done**
- [~] Task 16: Export/restore round trip — **DROPPED by decision (2026-08-25)**
- [~] Task 17: Demo-data coverage regression — **DROPPED by decision (2026-08-25)** — backups do not depend on demo data
- [~] Task 18: Committed manifest vintages — **REVERTED 2026-08-25** by Task 24/25, replaced by one self-maintaining `schema.json` (spec D6)
- [~] Task 19: Scheduled exports + expiry — **REVERTED 2026-08-25** by Tasks 22/23 (no scheduled exports, no expiry, no cron at all — spec D7)
- [ ] Task 20: Browser verification of the whole backup flow
- [x] Task 21: Correct `.claude/rules/company-backup-restore.md`
- [x] Task 22: Remove the expiry date from the Backups list
- [x] Task 23: Delete the nightly backup-maintenance job, its registrations, and both constants
- [x] Task 24: Rename the vintage to `schema.json` and rewrite the manifests README
- [x] Task 25: Rewrite `check-backups.ts` around a single fetched baseline
- [x] Task 26: Update the pre-commit hook
- [x] Task 27: Re-sync the rules and docs
- [x] Task 28: End-to-end verification of all four behaviours
- [x] Task 29: Review fixes — single-source the export inclusion rule (see `-review.md`)

## Dependencies

- Task 1 is investigation only and gates nothing, but read its findings before Task 2/3.
- Tasks 2, 3, 4 are independent of each other — may run in parallel.
- ~~Task 5 depends on Tasks 2 and 3~~ — **Task 5 is skipped**, see its section.
- ~~Task 6 depends on Task 5~~ — **dependency removed**. Task 6's guard compares the
  two operations' own companies (`jo."companyId" = self."companyId"`), not the
  dependency row's stamped `companyId`, so a mis-stamped row still counts and the
  ordering hazard does not apply. Task 6 may run at any time.
- Task 7 depends on nothing; Task 8 depends on Task 7.
- Task 9 depends on nothing. Task 10 depends on nothing. Tasks 9 and 10 are independent.
- Task 11 depends on Task 9. Task 12 depends on Task 9. Task 13 depends on Tasks 9, 10, 12.
- **Design change (2026-08-25, user decision):** the verdict is PRECOMPUTED into
  storage by the jobs side and merely READ by the app. `@carbon/jobs` exposes only
  `.`, `./events`, `./inngest`, `./worker`, and its AGENTS.md forbids importing job
  internals into app code, so the app cannot call `reportBackupCompatibility`
  directly. Rejected alternative: adding a `./backups` public subpath — it widens a
  package contract (Ask First) and would run an `information_schema` query on every
  Backups page load. Task 11 therefore also owns the WRITER; Task 19 reuses it.
- Task 14 is independent of everything.
- Task 15 depends on Tasks 9 and 12 only. It no longer touches any workflow file, so
  the old Task 14 coupling is gone.
- Task 18 depends on Task 15 step 4 (`--write`). Task 15 skips cleanly with no
  vintages, so either may land first — but Task 15 is inert until Task 18 does.
- Tasks 16 and 17 are dropped and gate nothing. Task 17's reason for existing was to
  keep Task 16 honest; dropping 16 removed it.
- Task 19 depends on Task 9.
- Task 20 depends on Tasks 7, 8, 11, 13.
- Task 21 is independent.
- **Correction pass (Tasks 22–29), 2026-08-25.** Task 23 needs Task 22 (the UI is the
  last consumer of `BACKUP_RETENTION_DAYS`). Task 25 needs Task 24. Task 26 needs
  Task 25. Task 27 needs 22–26. Task 28 needs everything before it. Task 29 followed
  the thermo-nuclear review and needs Task 25. Tasks 22 and 24 are independent.

---

## Task 1: Confirm the cross-tenant write path at the `schedule` call sites

**Depends on:** none
**Files:**
- Read only: `apps/erp/app/routes/x+/job+/$jobId.status.tsx`
- Read only: `apps/erp/app/routes/api+/kanban.$id.tsx`
- Read only: `apps/erp/app/modules/production/production.service.ts`
- Read only: `packages/jobs/src/inngest/functions/tasks/reschedule-job.ts`
- Read only: `packages/jobs/src/inngest/functions/tasks/recalculate.ts`

Investigation task. Produces findings, changes no code.

**Steps:**
1. For each of the five call sites that invoke the `schedule` edge function, record
   two things: where `jobId` comes from (URL param, request body, database read),
   and where `companyId` comes from (`requirePermissions`, payload, event data).
2. Flag every call site where `jobId` arrives from user input and is passed to
   `functions.invoke("schedule", …)` **without first being read from the database
   under a `companyId`-scoped query**. `apps/erp/app/routes/x+/job+/$jobId.status.tsx:81`
   and `apps/erp/app/routes/api+/kanban.$id.tsx:172` use a service-role client, so
   RLS provides no protection there — check those two first.
   heading `Task 1 — schedule call site audit`, one line per call site, with the
   verdict `scoped` or `UNSCOPED`.
4. If any call site is `UNSCOPED`, note it as a required follow-up fix in that
   file. Fixing the call sites is **not** in this task — Task 2 adds the choke-point
   check that covers all of them.

**Verify:**
```bash
# Expected: a count >= 5, and the file contains the heading "Task 1 — schedule call site audit"
```

**Out of scope:** changing any call site; changing the edge functions.

---

## Task 2: Verify job ownership inside the `schedule` edge function

**Depends on:** none (read Task 1 findings first if available)
**Files:**
- Modify: `packages/database/supabase/functions/schedule/index.ts` — add an ownership check after `requirePermissions`
- Copy from (precedent): `packages/database/supabase/functions/post-nonconformance/index.ts` — for the shape of a post-auth database precondition check inside an edge function

**Steps:**
1. In `packages/database/supabase/functions/schedule/index.ts`, immediately after
   the existing line:
   ```typescript
   const client = await requirePermissions(req, companyId, userId, { update: "production" });
   ```
   add a check that the job belongs to the company in the payload:
   ```typescript
   const job = await db
     .selectFrom("job")
     .select(["id", "companyId"])
     .where("id", "=", jobId)
     .executeTakeFirst();

   if (!job || job.companyId !== companyId) {
     // The caller's permission was verified against `companyId`, but nothing
     // proved `jobId` belongs to it. Without this, a request pairing one
     // company's id with another company's job writes rows attributed to the
     // wrong tenant — see .ai/specs/2026-08-25-backup-durability.md Part 3.
     return errorResponse(req, "Job not found in this company", 404);
   }
   ```
2. Use the existing `errorResponse` helper already imported from
   `../lib/response.ts`. Do not invent a new response shape. If `errorResponse`
   does not accept a status argument, read its signature in
   `packages/database/supabase/functions/lib/response.ts` and match it — do not
   change that helper.
3. Return 404 rather than 403: a job in another company must be indistinguishable
   from a job that does not exist.
4. Do not add the check inside `SchedulingEngine` — the engine is also constructed
   by other callers and the edge function boundary is the single choke point that
   covers all five invoke sites found in Task 1.

**Verify:**
```bash
grep -n "job.companyId !== companyId" packages/database/supabase/functions/schedule/index.ts
# Expected: one match

pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: no TypeScript errors
```

**Out of scope:** `SchedulingEngine` internals; `dependenciesToRecords`; the
scheduler's `onConflict` clause; any change to `jobOperationDependency`'s keys.

If `packages/database/supabase/functions/schedule/index.ts` turns out not to have
a `db` client in scope at that point, STOP and report — do not create a second
connection pool.

---

## Task 3: Verify job ownership inside the `trigger-rework` edge function and scope its dependency read

**Depends on:** none
**Files:**
- Modify: `packages/database/supabase/functions/trigger-rework/index.ts` — add auth + ownership check, and scope the unfiltered read at line 351

**Steps:**
1. This function currently has **no** `requirePermissions` call at all (verified:
   the only `Authorization` reference is an outbound header at line 444). Add the
   standard gate, matching `packages/database/supabase/functions/schedule/index.ts`:
   ```typescript
   import { requirePermissions } from "../lib/supabase.ts";
   ```
   then inside the handler, after the payload is validated and before any write:
   ```typescript
   await requirePermissions(req, companyId, userId, { update: "production" });
   ```
2. Add the same job-ownership check as Task 2 step 1, using the same 404 wording.
3. Fix the unscoped read. Replace this block (currently at
   `packages/database/supabase/functions/trigger-rework/index.ts:351`):
   ```typescript
   const downstreamDeps = await trx
     .selectFrom("jobOperationDependency")
     .select(["operationId"])
     .where("dependsOnId", "=", triggeredAtJobOperationId)
     .where("operationId", "not in", clonedOperationIds)
     .execute();
   ```
   with the same query plus a `jobId` filter:
   ```typescript
   const downstreamDeps = await trx
     .selectFrom("jobOperationDependency")
     .select(["operationId"])
     .where("jobId", "=", jobId)
     .where("dependsOnId", "=", triggeredAtJobOperationId)
     .where("operationId", "not in", clonedOperationIds)
     .execute();
   ```
   Filter on `jobId`, not `companyId`: the rows are per-job, and `jobId` is the
   column the scheduler's own rebuild filters on. Filtering on the row's stamped
   `companyId` would trust exactly the field this whole defect shows is unreliable.
4. Note for the reviewer, in the PR description: `trigger-rework` is absent from
   `packages/database/supabase/config.toml`, but `ci/src/migrations.ts` runs
   `supabase functions deploy` with no function name, which deploys every
   directory under `supabase/functions/`. So this function **is** live in
   production and its missing auth gate is a real exposure, not dead code.

**Verify:**
```bash
grep -n "requirePermissions" packages/database/supabase/functions/trigger-rework/index.ts
# Expected: one import line and one call

grep -n 'where("jobId", "=", jobId)' packages/database/supabase/functions/trigger-rework/index.ts
# Expected: at least two matches (the pre-existing findReworkPath read, and the new downstreamDeps filter)

pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: no TypeScript errors
```

**Out of scope:** the rework cloning logic; `productionQuantity` writes; adding
`trigger-rework` to `config.toml` (a separate decision, since default
`verify_jwt` already applies).

If adding `requirePermissions` breaks the two MES service-role callers
(`apps/mes/app/routes/x+/trigger-rework.tsx:29` and
`apps/mes/app/routes/x+/inspection-lot.$id.disposition.tsx:305`), STOP and report
— `requirePermissions` must handle a service-role caller, and if it does not, that
is a design question, not something to improvise around.

---

## Task 4: Scheduled cross-tenant reference monitor

**Depends on:** none
**Files:**
- Create: `packages/jobs/src/inngest/functions/scheduled/tenant-integrity.ts`
- Create: `packages/jobs/src/inngest/functions/scheduled/tenant-integrity.test.ts`
- Modify: `packages/jobs/src/inngest/functions/scheduled/index.ts` — add the export
- Modify: `packages/jobs/src/inngest/index.ts` — register the function in both the import list (~line 66) and the functions array (~line 149)
- Copy from (precedent): `packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts`

**Steps:**
1. Create `tenantIntegrityFunction` with `inngest.createFunction`, cron
   `0 5 * * *` (daily 05:00, one hour after the workflow retention job at 04:00
   so the two never contend for the pool).
2. Inside one `step.run("scan-cross-tenant-refs")`: get a Kysely client with
   `getJobDatabaseClient(1)` from `../../../db`, build the catalog with
   `getCompanyTableCatalog`, then for every company id in the `company` table call
   `findExportScopeViolations(db, exportable, byName, companyId, companyGroupId)`
   — the same function `company-export.ts` uses. Import all three from
   `../tasks/company-backup`.
3. Build `exportable` and `byName` exactly as `buildCompanyBackup` does in
   `packages/jobs/src/inngest/functions/tasks/company-export.ts` (filter out
   `SECRET_TABLES`, then `new Map(catalog.tables.map((t) => [t.name, t]))`), so the
   monitor and the export can never disagree about what counts as a violation.
4. Log one `logger.error` per company that has violations, with the company id and
   the violation strings. Do **not** write a marker row and do **not** notify the
   customer — this is internal monitoring, and a cross-tenant finding is an
   engineering escalation, not a user-facing message.
5. Return `{ companiesScanned, companiesWithViolations, totalViolations }` so the
   Inngest run history shows the trend.
6. Write the test with two cases: a catalog where every FK resolves in scope
   produces zero findings, and a catalog with one out-of-scope NOT-NULL FK produces
   one finding naming that table and column. Mock the database the way
   `workflow-run-retention.test.ts` does.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- tenant-integrity
# Expected: 2 passing tests

pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no TypeScript errors

grep -n "tenantIntegrityFunction" packages/jobs/src/inngest/index.ts
# Expected: 2 matches (import and registration)
```

**Out of scope:** fixing any violation it finds; notifying customers; adding a UI.

---

## Task 5: Capture evidence and clean up the four bad rows — SKIPPED

**Status:** skipped by user decision, 2026-08-25. Kept below for the record; do not
execute as part of this plan.

Reasons the skip is safe:

- The write path is closed by Tasks 2 and 3, so no new rows are produced.
- The three `jobOperationDependency` rows **self-heal**: the owning job's next
  reschedule deletes by `jobId` with no company filter and re-inserts with the
  correct `companyId`.
- The one `pickMethod` row does not self-heal, but that table's rows are created
  lazily on view, so a stale one is inert.
- The rows are not present in the local development database (verified: 0 rows
  from the detection query, against 2 companies / 8 jobs). They live in whichever
  shared environment produced the original error.

What the skip costs: the affected company's export stays blocked until **Task 7**
(skip-and-disclose) lands. Task 7 is therefore the thing that unblocks that
customer, not a cleanup. Task 4's nightly monitor remains the detector if this was
not a one-off.

**Depends on:** Tasks 2, 3
**Files:**
- Create: `.ai/runs/2026-08-25-cross-tenant-cleanup.md` — the evidence record

This task is run by a human against the real database. It is **not** a migration
and must not be written as one: it is a one-off data correction on specific ids,
not a schema change to replay on every environment.

**Steps:**
1. Confirm Tasks 2 and 3 are deployed first. Cleaning before the write path is
   closed means the rows come back.
2. Capture the evidence into `.ai/runs/2026-08-25-cross-tenant-cleanup.md`: the
   full row contents, before any deletion, for both tables:
   ```sql
   SELECT * FROM "jobOperationDependency"
   WHERE "operationId" IN ('SWzSN625p79kUZhzcuGSM','jo_CZnGXVDFKGRXSqVvXj1Fxw','jo_HvrtNZNwPXCVVE9qhaxrc4');

   SELECT * FROM "pickMethod"
   WHERE "itemId" = '60933834-fdc1-5d02-b9a0-c73fbab73782'
     AND "companyId" = 'CG4Zvt9pMsvfgxLb2ijPPy';
   ```
3. Correct rather than delete the `jobOperationDependency` rows. Their `jobId` and
   operation ids are **right**; only `companyId` is wrong. Re-stamp it from the job
   they actually belong to:
   ```sql
   UPDATE "jobOperationDependency" d
   SET "companyId" = j."companyId"
   FROM "job" j
   WHERE j."id" = d."jobId"
     AND d."companyId" <> j."companyId";
   ```
   This also fixes the second pair (`VL169ZQuC8pK7bZqFofx8F` →
   `d1htultl6debqkn9qn60`) without naming ids, and is idempotent.
4. Delete the `pickMethod` row. Unlike the dependency rows it has no correct home
   — it pairs one company's location with another company's item, and the migration
   comment says these rows are recreated lazily on view:
   ```sql
   DELETE FROM "pickMethod"
   WHERE "itemId" = '60933834-fdc1-5d02-b9a0-c73fbab73782'
     AND "companyId" = 'CG4Zvt9pMsvfgxLb2ijPPy';
   ```
5. Re-run the detection query and confirm it returns zero rows:
   ```sql
   SELECT d."companyId", j."companyId" AS "jobCompanyId", count(*)
   FROM "jobOperationDependency" d
   JOIN "job" j ON j."id" = d."jobId"
   WHERE j."companyId" <> d."companyId"
   GROUP BY 1, 2;
   ```
6. Record in the run file which of the two remedies was applied to which rows, and
   the final verification output.

**Verify:** the query in step 5 returns zero rows, and
`.ai/runs/2026-08-25-cross-tenant-cleanup.md` contains the pre-change row dumps.

**Out of scope:** writing this as a migration; touching any other company's rows;
changing the tables' keys.

If the step 3 `UPDATE` would affect more rows than the four documented in the
spec, STOP and report — the blast radius has grown since the spec was written and
the plan needs revisiting before any write.

---

## Task 6: Harden `check_operation_dependencies` and `finish_job_operation`

**Depends on:** none — the original dependency on Task 5 was removed once the guard
below was written to compare the two operations' companies rather than the
dependency row's stamped `companyId`. Read the hazard note anyway: it explains why
the guard is shaped this way, and a future edit that switches it to a plain
`dep."companyId"` filter reintroduces the danger.
**Files:**
- Create: a new migration via `pnpm db:migrate:new harden-operation-dependency-scope`
- Modify: nothing else
- Copy from (precedent): `packages/database/supabase/migrations/20250429130223_operation-dependencies.sql` — the current definitions of both functions

**Ordering hazard, read before writing any SQL.** Both functions currently count
dependency rows with **no** company filter. Those three bad rows describe company
`EaQrV2e2fKZDDAD69G8cto`'s real dependency chain while stamped with another
company's id. Adding a naive `companyId` filter **before** Task 5's re-stamp would
make those dependencies invisible and flip operations from `Waiting` to `Ready`
prematurely — a worse outcome than the bug. Task 5 first, always.

**Steps:**
1. `pnpm db:migrate:new harden-operation-dependency-scope` — never hand-pick a
   timestamp.
2. In the migration, `CREATE OR REPLACE FUNCTION check_operation_dependencies` with
   the same signature, `RETURNS BOOLEAN`, `SECURITY DEFINER`,
   `SET search_path = public`, and a body that derives the company from the
   **operation**, not from the dependency row's stamped `companyId`:
   ```sql
   CREATE OR REPLACE FUNCTION check_operation_dependencies(operation_id TEXT)
   RETURNS BOOLEAN
   SECURITY DEFINER
   SET search_path = public
   LANGUAGE plpgsql
   AS $$
   DECLARE
     incomplete_deps INTEGER;
   BEGIN
     SELECT COUNT(*)
     INTO incomplete_deps
     FROM "jobOperationDependency" dep
     JOIN "jobOperation" self ON self.id = dep."operationId"
     JOIN "jobOperation" jo ON jo.id = dep."dependsOnId"
     WHERE dep."operationId" = operation_id
       AND jo."companyId" = self."companyId"
       AND jo.status != 'Done';

     RETURN incomplete_deps = 0;
   END;
   $$;
   ```
   The guard is `jo."companyId" = self."companyId"` — the two operations in a
   dependency must belong to the same company. That holds regardless of what the
   dependency row's own `companyId` says, so it cannot be defeated by a mis-stamped
   row.
3. Apply the same `self`/`jo` company-equality guard to the `NOT EXISTS` subquery
   inside `finish_job_operation()`, re-declaring the whole function with
   `CREATE OR REPLACE`. Copy the rest of its body verbatim from
   `20250429130223_operation-dependencies.sql` — do not rewrite logic you are not
   fixing.
4. Make the migration idempotent: `CREATE OR REPLACE FUNCTION` already is. Do not
   add `DROP FUNCTION`.
5. Run `pnpm run generate:types` after applying the migration.

**Verify:**
```bash
pnpm db:migrate
# Expected: the new migration applies with no error

pnpm run generate:types
# Expected: completes; `git diff --stat packages/database/src/types.ts` shows no
# change (these are functions, not tables) — if it does change, inspect why

pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: no TypeScript errors
```

**Out of scope:** adding `companyId` to `jobOperationDependency`'s primary key
(explicitly deferred by the user); changing the scheduler's `onConflict` clause;
any change to `jobOperation` status transitions beyond the company guard.

This touches multi-tenancy logic, which the root `AGENTS.md` says to ask about
first. The user approved the plan containing it; if the diff grows beyond the two
functions above, STOP and report.

---

## Task 7: Export skips unrestorable rows instead of refusing

**Depends on:** none
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-export.ts` — replace the throw with an exclusion pass
- Modify: `packages/jobs/src/inngest/functions/tasks/company-backup.ts` — add `excludedRows` to the `Manifest` type
- Create: `packages/jobs/src/inngest/functions/tasks/company-export.exclusions.test.ts`

**Steps:**
1. In `company-backup.ts`, extend the `Manifest` type with a new field:
   ```typescript
   excludedRows: Array<{ table: string; column: string; refTable: string; rows: number }>;
   ```
   Place it after `excludedTables`. Adding a field is backward compatible —
   `assertBackupImportable` reads `manifest.tables` only, and older manifests
   simply lack the key, so treat `undefined` as `[]` at every read site.
2. In `company-export.ts`, `findExportScopeViolations` currently returns strings
   and the caller throws. Change the guard so that instead of throwing, each
   violation becomes an exclusion: for the offending table, the per-table dump's
   `WHERE` clause gains an additional predicate excluding rows whose NOT-NULL FK
   falls outside the parent's export scope. Reuse `buildScopeFilter(parent, …)` to
   build that predicate so the exclusion and the detection can never disagree.
3. Record each exclusion in `manifest.excludedRows` with the counts
   `findExportScopeViolations` already computes.
4. Keep exactly one hard failure path in this function: a company with no
   `companyGroupId` still throws, with its existing message. Do not soften that —
   it produces a backup with an empty chart of accounts.
5. Return the exclusion list from `buildCompanyBackup` alongside `name`,
   `manifest`, `rows`, `assetSourcePaths` so the job can log it.
6. Log one `logger.warn` per exclusion with table, column and row count.
7. Write the test with three cases: no violations produces an empty
   `excludedRows` and an unchanged row count; one violation excludes exactly those
   rows and records them; and a groupless company still throws.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- company-export.exclusions
# Expected: 3 passing tests

pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no TypeScript errors

grep -n "excludedRows" packages/jobs/src/inngest/functions/tasks/company-backup.ts
# Expected: at least one match in the Manifest type
```

**Out of scope:** the restore side; the UI (Task 8); `assertReferentiallyClosed`.

If excluding a row would orphan another row that IS included — a child of the
excluded row inside the same backup — STOP and report. That case needs a
transitive exclusion pass, which is a design decision, not an implementation
detail.

---

## Task 8: Rewrite export failure and partial-success copy

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/backups.tsx` — replace the failure banner text at line 524 and add the partial-success line
- Modify: `apps/erp/app/modules/settings/backups.service.ts` — surface `excludedRows` from the manifest in the list payload
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Backups/RestoreReviewRow.tsx` — for the row layout, the `text-xs text-muted-foreground` secondary line, and the destructive-text failure variant

**Steps:**
1. In `apps/erp/app/routes/x+/settings+/backups.tsx`, replace this string (currently
   at line 524):
   ```
   The system created an invalid backup — please contact Carbon support.
   ```
   with copy that names the cause and an action. Per spec Part 5 rule 1 and 2, never
   "the system", and no "contact support" when the user can act. Use:
   `This backup could not be completed. {error}` and keep the existing Dismiss
   button. Wrap all new strings with `useLingui()`'s ``t`...` `` per
   `.claude/rules/i18n-lingui-system.md` — never `import { t } from "@lingui/core/macro"`.
2. In `backups.service.ts`, have `listCompanyBackups` read `excludedRows` from each
   folder's `manifest.json` (treating a missing key as `[]`) and include a
   summed `excludedRowCount` per backup in its return value.
3. In the backup row component inside `backups.tsx` (the one rendering
   `Incomplete backup — not restorable` around line 608), add a secondary line when
   `excludedRowCount > 0`: `{count} rows excluded`. Numbers, not adjectives — spec
   Part 5 rule 4.
4. Do not change the `Incomplete backup — not restorable` string. It is correct and
   the comment above it explains why it must not read `Preparing…`.

**Verify:**
```bash
grep -c "The system created an invalid backup" apps/erp/app/routes/x+/settings+/backups.tsx
# Expected: 0

pnpm exec turbo run typecheck --filter=erp
# Expected: no TypeScript errors

pnpm exec biome check apps/erp/app/routes/x+/settings+/backups.tsx apps/erp/app/modules/settings/backups.service.ts
# Expected: no error-severity findings
```

**Out of scope:** the status badge (Task 11); the disclosure screen (Task 13).

---

## Task 9: Report-mode compatibility API

**Depends on:** none
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-backup.ts` — add `reportBackupCompatibility` next to `assertBackupImportable`
- Create: `packages/jobs/src/inngest/functions/tasks/company-backup.compatibility.test.ts`

**Steps:**
1. Add a new exported function beside `assertBackupImportable` (currently at
   `company-backup.ts:742`). Do not change `assertBackupImportable` itself — it
   stays the boolean gate, and Task 15's CI check calls it directly.
   ```typescript
   export type CompatibilityFinding = {
     kind: "defaulted" | "discarded" | "blocked";
     table: string;
     column?: string;
     reason: string;
   };

   export function reportBackupCompatibility(
     catalog: Catalog,
     backup: CompanyBackup
   ): { findings: CompatibilityFinding[]; blocked: boolean };
   ```
2. Produce one finding per difference, using the same rules
   `assertBackupImportable` uses so the two can never disagree:
   - a live column absent from the backup that is NOT NULL with a DEFAULT →
     `defaulted`
   - a live column absent from the backup that is NOT NULL with no DEFAULT →
     `blocked` (until Task 14's rule removes this case going forward)
   - a backup column absent from the live table → `discarded`
   - a backup table absent from the catalog and not in `CATALOG_EXCLUDED_TABLES`
     → `blocked`
   - account defaults with no chart of accounts → `blocked`
3. `blocked` is `findings.some((f) => f.kind === "blocked")`.
4. Skip `CATALOG_EXCLUDED_TABLES` exactly as `assertBackupImportable` does — an
   older backup carrying an excluded table is not drift.
5. Write the test covering all five finding cases above plus one case with an
   identical schema producing zero findings and `blocked: false`.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- company-backup.compatibility
# Expected: 6 passing tests

pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no TypeScript errors
```

**Out of scope:** changing `assertBackupImportable`; the restore flow; the UI.

---

## Task 10: Shared table → product-area map

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/settings/backups.areas.ts`
- Modify: `apps/erp/app/routes/api+/settings.backup-summary.ts` — import the map instead of its local `GROUPS`
- Create: `apps/erp/app/modules/settings/backups.areas.test.ts`

**Steps:**
1. Move the `GROUPS` constant out of `settings.backup-summary.ts` into the new
   `backups.areas.ts`, unchanged, exported as `BACKUP_SUMMARY_GROUPS`. The area
   titles stay exactly as they are today: `Sales`, `Purchasing`, `Items`,
   `Production`, `Accounting`, `Quality`, `People`.
2. Add a second export in the same file, `tableArea(table: string): string`, that
   returns the area title for a table. Build it from a `Record<string, string>`
   covering every table the summary groups already name, plus the tables the
   disclosure screen needs to name. Return `"Other"` for anything unmapped.
3. Do not attempt to cover all ~400 tables by hand. `"Other"` is the honest
   fallback, and spec open question 6 records that this map needs widening over
   time.
4. Update `settings.backup-summary.ts` to import `BACKUP_SUMMARY_GROUPS` and delete
   its local copy. Its behaviour must not change.
5. Test: `tableArea("salesOrder")` returns `"Sales"`, `tableArea("job")` returns
   `"Production"`, `tableArea("jobOperationDependency")` returns `"Production"`,
   and `tableArea("someTableThatDoesNotExist")` returns `"Other"`.

**Verify:**
```bash
pnpm --filter erp test -- backups.areas
# Expected: 4 passing tests. If the erp app has no vitest project wired for this
# path, run `npx vitest run apps/erp/app/modules/settings/backups.areas.test.ts`
# from the repo root instead — see .ai/lessons.md on erp vitest.

pnpm exec turbo run typecheck --filter=erp
# Expected: no TypeScript errors

grep -c "const GROUPS" apps/erp/app/routes/api+/settings.backup-summary.ts
# Expected: 0
```

**Out of scope:** changing what the summary popover displays; widening the map to
every table.

---

## Task 11: Write `compatibility.json` beside the manifest, and badge the Backups list from it

**Depends on:** Task 9
**Files:**
- Create: `packages/jobs/src/inngest/functions/tasks/company-compatibility.ts` — the writer
- Create: `packages/jobs/src/inngest/functions/tasks/company-compatibility.test.ts`
- Modify: `packages/jobs/src/inngest/functions/tasks/company-export.ts` — write the verdict after the manifest
- Modify: `apps/erp/app/modules/settings/ui/Backups/format.ts` — the five-word vocabulary
- Modify: `apps/erp/app/modules/settings/backups.service.ts` — read the verdict file
- Modify: `apps/erp/app/routes/x+/settings+/backups.tsx` — render the badge and expiry
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Backups/RestoreReviewRow.tsx`

**Steps:**
1. In `company-compatibility.ts`, define the stored shape and one writer:
   ```typescript
   export const COMPATIBILITY_FILE = "compatibility.json";
   export type StoredCompatibility = {
     checkedAt: string;
     schemaVersion: string;
     status: "ready" | "restorable-with-changes" | "not-restorable";
     findings: CompatibilityFinding[];
   };
   export function backupCompatibilityPath(name: string): string;
   export async function writeBackupCompatibility(client, companyId, name, catalog, backup): Promise<StoredCompatibility>;
   ```
   It calls `reportBackupCompatibility`, maps `blocked` → `not-restorable`, any other
   findings → `restorable-with-changes`, none → `ready`, and uploads the JSON next to
   `manifest.json` with `upsert: true`.
2. In `company-export.ts`, call it immediately AFTER `writeBackupManifest`. Order
   matters: `manifest.json` remains the completion flag, so the verdict must never
   appear before it. Wrap in try/catch and only warn on failure — a missing verdict
   degrades to "not yet checked", it must not fail a committed backup.
3. In `format.ts`, add `BackupStatus` and `backupStatusLabel` returning exactly the
   five spec labels: `Ready`, `Restorable with changes`, `Not restorable`,
   `Incomplete`, `Failed`. Also export `BACKUP_RETENTION_DAYS` (90) for the expiry
   date; Task 19 imports the same constant.
4. In `backups.service.ts`, download `compatibility.json` alongside the manifest in
   the SAME `Promise.all` that already reads the manifest — no extra round trip per
   backup beyond one object fetch. Absent file → status stays `ready` with a
   `checkedAt: null`, which the UI shows as "not yet checked", never as a problem.
5. Render the badge and the expiry date on each row.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- company-compatibility
# Expected: tests pass, covering all three status mappings

pnpm exec turbo run typecheck --filter=@carbon/jobs
pnpm exec turbo run typecheck --filter=erp
# Expected: no TypeScript errors

grep -n "Restorable with changes" apps/erp/app/modules/settings/ui/Backups/format.ts
# Expected: one match
```

**Out of scope:** importing anything from `@carbon/jobs` into app code — that is the
whole point of this design. If you find yourself adding a subpath to
`packages/jobs/package.json`, STOP and report.

---

## Task 12: Renamed/dropped table map

**Depends on:** Task 9
**Files:**
- Create: `packages/jobs/src/inngest/functions/tasks/company-backup.renames.ts`
- Modify: `packages/jobs/src/inngest/functions/tasks/company-backup.ts` — consult the map in `reportBackupCompatibility`
- Create: `packages/jobs/src/inngest/functions/tasks/company-backup.renames.test.ts`

**Steps:**
1. Create the map file with a single exported constant and a doc comment stating
   the contract: a migration that renames or drops a tenant-scoped table MUST add
   an entry here, and a missing entry is a deliberate hard refusal.
   ```typescript
   /** old table name → new name, or null when the table was dropped with its feature. */
   export const TABLE_RENAMES: Record<string, string | null> = {};
   ```
   Start empty. Do not invent historical entries — a wrong guess loses data.
2. In `reportBackupCompatibility`, when a backup table is absent from the catalog:
   if `TABLE_RENAMES` has the key and the value is a string, treat the backup table
   as that new name and continue; if the value is `null`, emit a `discarded`
   finding; if the key is absent, emit `blocked` with the reason
   `table "<name>" is not in the current schema and has no rename mapping`.
3. Test all three branches plus the unmapped case.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- company-backup.renames
# Expected: 4 passing tests

pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no TypeScript errors
```

**Out of scope:** applying renames during the actual load (that is a follow-up
once a real rename exists); back-filling historical renames.

---

## Task 13: Pre-restore disclosure screen

**Depends on:** Tasks 9, 10, 12
**Files:**
- Create: `apps/erp/app/modules/settings/ui/Backups/RestoreDisclosure.tsx`
- Modify: `apps/erp/app/modules/settings/ui/Backups/index.ts` — export it
- Modify: `apps/erp/app/routes/x+/settings+/backups.tsx` — show it before the `restore` intent submits
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Backups/BackupProgressModal.tsx` — modal structure, and `BackupSourcePicker.tsx` for the pick-then-confirm flow

**Steps:**
1. The component takes `findings: CompatibilityFinding[]` (Task 9) and renders them
   grouped by `tableArea(finding.table)` (Task 10), with the three kinds labelled:
   `Will be filled with a default`, `Will be discarded`, `Cannot be restored`.
2. Exact table and column names go inside a collapsed details element, not the
   body — spec Part 5 rule 3.
3. Always render, in this order, regardless of findings: today's data for this
   company will be deleted and replaced; a snapshot is taken first; Revert restores
   it; Keep drops the snapshot and cannot be undone.
4. Require typed confirmation **only** when at least one finding has kind
   `discarded`. A findings list with only `defaulted` entries gets a plain confirm
   button. Never allow confirm when `blocked` is true — show the reasons and offer
   only Cancel.
5. Wire it into the existing `restore` intent path in `backups.tsx`: picking a
   source now opens this screen, and only its confirm submits the form. Fetch the
   findings from a new loader on the existing
   `apps/erp/app/routes/api+/settings.backup-summary.ts` route or a sibling
   `settings.backup-compatibility.$name.ts` — whichever keeps `companyId` coming
   from `requirePermissions` rather than the query string, matching how
   `settings.backup-restore-status.$restoreRunId.ts` scopes itself.
6. All strings via `useLingui()`'s ``t`...`` `` or `<Trans>`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no TypeScript errors

pnpm exec biome check apps/erp/app/modules/settings/ui/Backups
# Expected: no error-severity findings
```

**Out of scope:** changing `wipeAndLoad`; changing what the restore actually does.
The screen discloses; it does not alter behaviour.

**Deviation as built (2026-08-25):** step 5's new API route was NOT added. The
verdict is already on `CompanyBackupSummary.compatibility` (Task 11's reader), which
the page loader has in hand — a second route would fetch the same file again and give
the badge and the disclosure screen two chances to disagree. `RestoreSubmit` was
deleted from `BackupChoices.tsx` in the same change: the disclosure screen is now the
only path to a restore, and a leftover direct-submit button is an invitation to wire
the friction back out.

---

## Task 14: Conformance check — new NOT NULL columns must have a DEFAULT

**Depends on:** none
**Files:**
- Create: `packages/checks/src/conformance/no-required-column-without-default.ts`
- Create: `packages/checks/src/conformance/no-required-column-without-default.test.ts`
- Modify: `packages/checks/src/index.ts` — export it
- Modify: `packages/checks/src/run.ts` — import it and add it to `CONFORMANCE_CHECKS` (the SQL-migrations list, not `SERVER_CHECKS` or `TS_CHECKS`)
- Copy from (precedent): `packages/checks/src/conformance/no-zero-concurrency.ts` — the `ConformanceCheck` shape, provenance block, and line-number computation

**Steps:**
1. Implement `noRequiredColumnWithoutDefault` with
   `id: "no-required-column-without-default"`. It scans migration SQL for
   `ALTER TABLE … ADD COLUMN … NOT NULL` without a `DEFAULT` in the same column
   definition, and for `NOT NULL` columns with no `DEFAULT` inside a
   `CREATE TABLE` on a table that already exists.
2. Only the `ADD COLUMN` case is reliably detectable by regex, so implement that
   case only and say so in the doc comment. A `CREATE TABLE` for a brand-new table
   is not a backup-compatibility problem — the table is simply absent from older
   manifests, which `reportBackupCompatibility` already handles.
3. Message must explain the consequence, matching the house style of
   `no-zero-concurrency`: a NOT NULL column with no DEFAULT makes every existing
   backup unrestorable, because the backup has no value to supply.
4. Add the check to `CONFORMANCE_CHECKS` in `run.ts`. That list is scanned over
   `loadSqlFiles(migrationsDir)`, which is what this check needs.
5. Run the checks once and add every pre-existing hit to
   `packages/checks/src/conformance/baseline.json` using the repo's existing
   baseline mechanism. Do **not** edit historical migrations to satisfy a new check.
6. Test: an `ADD COLUMN … NOT NULL DEFAULT …` produces no violation; an
   `ADD COLUMN … NOT NULL` with no default produces one with the right line number;
   a nullable `ADD COLUMN` produces none; a `NOT NULL` appearing in an unrelated
   context (a constraint body) produces none.

**Verify:**
```bash
pnpm --filter @carbon/checks test -- no-required-column-without-default
# Expected: 4 passing tests

pnpm --filter @carbon/checks test
# Expected: the full suite passes, including the baseline test

pnpm exec turbo run typecheck --filter=@carbon/checks
# Expected: no TypeScript errors
```

**Out of scope:** changing existing migrations; the `CREATE TABLE` case.

---

## Task 15: Local `db:check:backups` command + pre-commit hook

**Restructured 2026-08-25 (user decision).** The original task was a CI job that
rebuilt last month's schema by replaying migrations against a throwaway Postgres.
That is what got blocked — a bare Postgres has no `auth` or `storage` schemas
(`ERROR: relation "storage.buckets" does not exist`), because the Storage and GoTrue
services build those themselves when their containers boot.

The restructure removes the blocker rather than paying to work around it. A
developer's machine already HAS all three schemas, so the check runs there. And once
it runs there, the migration replay is unnecessary: instead of reconstructing an old
schema, read the **committed manifest vintages** (Task 18) and ask whether each one
still restores against the live schema. Same question, no second database, no
containers, no CI minutes.

This also makes the check STRICTER than the original. The two-phase design only ever
asked "do backups from yesterday survive?". A vintage from six weeks ago asks the
question customers actually have, since `BACKUP_RETENTION_DAYS = 90`.

**Depends on:** Task 9 (`reportBackupCompatibility`), Task 12 (`TABLE_RENAMES`).
Task 18 supplies the vintages — Task 15 must skip cleanly with none, so the two can
land in either order.
**Files:**
- Create: `packages/jobs/src/scripts/check-backups.ts`
- Delete: `packages/jobs/src/scripts/backup-compatibility.ts` (superseded; untracked, so nothing to revert)
- Delete: `.github/workflows/backup-compatibility.yml` (the CI job this replaces)
- Modify: `packages/jobs/package.json` — rename the `backup-compatibility` script to `db:check:backups`; drop `pg`/`@types/pg` if the script no longer opens its own pool
- Modify: `package.json` (root) — add `"db:check:backups": "pnpm --filter @carbon/jobs db:check:backups --"`
- Modify: `.husky/pre-commit` — add the gate
- Copy from (precedent): `packages/database/src/check-datasets.ts` — this is the
  template for the whole task. Copy its `skip()` helper verbatim in spirit, its
  `countPendingMigrations` hint, its `parseArgs` + `--help` shape, its
  console vocabulary (`  ✓ name`, `  ✗ name — reason`), and its closing
  "Re-run on its own with / Commit anyway with" pair.
- Copy from (precedent): `.husky/pre-commit` lines 34–43 — the dataset-check gate,
  including `--silent` and the `CARBON_SKIP_*` guard.

**Steps:**

1. Create `packages/jobs/src/scripts/check-backups.ts`. Keep from the deleted
   script, unchanged: `catalogAsManifest`, `reportBlocking`, `FIX_HINT`, and the
   `connect()`/pool-teardown pattern. Delete from it, as dead code, everything that
   existed only for the migration replay: `migrationsOnMain`, `localMigrations`,
   `applyMigrations`, `sh`, `MIGRATIONS_DIR`, `DATABASE_PKG`, the `execFileSync`
   import, and the `mkdtempSync`/`mkdirSync`/`renameSync`/`rmSync`/`tmpdir` imports.

2. `VINTAGES_DIR` becomes `packages/jobs/manifests` (was
   `packages/database/supabase/backups/manifests` — that directory is documented as
   dormant in `.claude/rules/company-backup-restore.md` and must not gain a live
   reader). Resolve it from `import.meta.dirname`, not from the repo root.

3. Main flow, in this order:
   - load env (see step 5), connect, and on connection failure `skip()` — exit 0 with
     `⚠ Backup compatibility check skipped — no database connection (is your local stack up?)`;
   - **count pending migrations first, and `skip()` if there are any.** This is the
     one place this check diverges from `check-datasets.ts`, which only uses the count
     as a hint on failure. Here an unapplied migration produces a FALSE PASS — the
     live schema does not yet contain the change being committed — so the check must
     refuse to give a verdict rather than give a wrong one. Message:
     `⚠ Backup compatibility check skipped — your database is N migration(s) behind, so it cannot see the change you are committing. Run pnpm db:migrate and try again.`
     Reuse `check-datasets.ts`'s query against
     `supabase_migrations.schema_migrations`;
   - read the catalog ONCE with `getCompanyTableCatalog(db)`;
   - list `*.json` in `VINTAGES_DIR`; if the directory is absent or empty, `skip()`
     with `no committed manifest vintages yet (see packages/jobs/manifests/README.md)`;
   - for each vintage, in filename order, `reportBlocking(file, catalog, manifest)`;
   - print `Checked N vintage(s) against the live schema.` and, on any blocking
     finding, `FIX_HINT` plus the re-run/skip pair, then `process.exitCode = 1`.

4. Add a `--write` mode to the same script: dump the live catalog through
   `catalogAsManifest` and write it to `VINTAGES_DIR/<today>.json`. Derive `<today>`
   and the manifest's `exportedAt` with `@internationalized/date`
   (`today(getLocalTimeZone())` / `now(getLocalTimeZone()).toAbsoluteString()`) —
   `@carbon/jobs` already depends on it, and JavaScript `Date` is banned repo-wide
   (`.claude/rules/date-handling.md`). Refuse to overwrite an existing file: vintages
   are added, never edited (Task 18's contract). `--write` must also refuse when
   migrations are pending, for the same reason step 3 skips.

5. Env: the script needs `SUPABASE_DB_URL`, which lives in the repo-root
   `.env.local`. `packages/database` gets this from its own `loadEnv()`
   (`src/datasets/cli.ts`), which `packages/jobs` cannot import — `@carbon/database`
   has no `"type": "module"`, so a named import of it fails under bare `tsx`, and it
   is not an exported subpath either. Use Node's own loader in the package script
   instead, `.env.local` first so it wins:
   ```json
   "db:check:backups": "tsx --env-file-if-exists=../../.env.local --env-file-if-exists=../../.env src/scripts/check-backups.ts"
   ```
   If `--env-file-if-exists` is unavailable in the pinned Node/tsx, STOP and report —
   the fallback is adding `dotenv` as a `@carbon/jobs` devDependency, which is a new
   dependency and therefore an Ask First call.

6. `.husky/pre-commit`: add a gate after the dataset check, modelled on it exactly.
   Gate on `packages/database/supabase/migrations/` rather than all of
   `packages/database/` — a migration is the only thing that can rot a backup:
   ```sh
   # A migration can make an existing backup unrestorable without the backup
   # changing. This asks the committed manifest vintages whether they still load.
   # Set CARBON_SKIP_BACKUP_CHECK=1 to skip.
   if [ -z "$CARBON_SKIP_BACKUP_CHECK" ] && git diff --cached --name-only | grep -q '^packages/database/supabase/migrations/'; then
       echo "Checking backup compatibility against the schema..."
       if ! pnpm --silent db:check:backups; then
           echo "Commit blocked: this migration breaks existing backups. See above."
           exit 1
       fi
   fi
   ```

7. Delete `.github/workflows/backup-compatibility.yml`. There is no CI half of this
   any more, so the `workflow_dispatch` stub with the blocker in its header is dead
   weight that documents a design we no longer have. The two honest limits of the
   local design go in `.claude/rules/company-backup-restore.md` (Task 21) instead:
   a hook is bypassable with `--no-verify`, so this is a safety net rather than a
   gate; and it reads the LIVE schema, so it is only as good as the developer's
   `pnpm db:migrate` — which step 3's pending-migration skip makes visible rather
   than silent.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no TypeScript errors

pnpm db:check:backups --help
# Expected: the usage block, exit 0

pnpm db:check:backups
# Expected, before Task 18 lands:
#   ⚠ Backup compatibility check skipped — no committed manifest vintages yet
# Expected, after Task 18 lands:
#   Checked 1 vintage(s) against the live schema.
#     ✓ 2026-08-25.json: restorable
# Either way: exit 0

git add packages/database/supabase/migrations && git commit -n --dry-run 2>/dev/null; \
  git diff --cached --name-only | grep -q '^packages/database/supabase/migrations/' && echo "gate would fire"
# Expected: "gate would fire"
```

**Out of scope:** any GitHub Actions workflow; the round trip (Task 16); coverage
(Task 17); reverting `"type": "module"` on `packages/logger/package.json` — that was
a real defect fix (see the blocker note below) and is verified green.

### What was learned while this was blocked — keep

Two findings from the CI attempt survive the restructure and must not be
re-discovered:

**`packages/logger/package.json` was missing `"type": "module"`.** Node therefore
treated its ESM-authored `./src/index.ts` as CJS, and a NAMED import of it from
`@carbon/jobs` (which IS `type: module`) could not resolve:
```
SyntaxError: The requested module '@carbon/logger' does not provide an export named 'getLogger'
```
Vite and vitest paper over this; plain `tsx` does not. The one-line fix is verified —
`pnpm test` 25/25, `pnpm run build` 8/8, typecheck clean on `@carbon/logger`,
`@carbon/jobs`, `erp`, `@carbon/auth`, `@carbon/react`. `@carbon/database` is missing
it too but did NOT need changing: only types are imported from it, and those erase at
run time.

**A backup never reads `auth` or `storage`.** `getCompanyTableCatalog` filters on
`table_schema = 'public'`, and `company-backup.ts` has no reference to `auth.` or
`storage.objects`. That is why the existing backup system never hit the blocker —
it always runs against a live database where all three schemas exist. Building one
from nothing was the new requirement, and this restructure drops that requirement.

---

## Task 16: Export/restore round trip — DROPPED (user decision, 2026-08-25)

The task was to seed a scratch company, export it, restore it back, and compare row
counts.

Dropped because it cannot be a commit-time check and there is nowhere else worth
running it. `buildCompanyBackup` writes the backup folder through supabase-js, over
its own connection, outside any Kysely transaction — the same property that lets
`throttleProgress` write progress from inside an open transaction. So a rolled-back
round trip still leaves storage objects behind, and `wipeAndLoad` deletes real rows.
Slow, destructive, pointed at the developer's own database: not a hook.

What it was protecting is covered. Whether a manifest still loads against a schema is
Task 15. Whether the human flow works end to end is Task 20. The narrow remainder — a
bug in the serialize/deserialize pair itself — is a unit test's job, and Tasks 7 and
11 added that coverage.

---

## Task 17: Demo-data coverage regression — DROPPED (user decision, 2026-08-25)

The task was to fail the build when a tenant-scoped table had no demo rows.

Dropped because **the backup work does not depend on demo data at all**, and tying
the two together was an artifact of the CI design that no longer exists. Task 17 only
ever existed to stop Task 16's round trip going green while silently exercising
nothing: a table with no demo rows was a table the round trip never tested. With
Task 16 dropped, that reason is gone.

The vintage check does not care either way. `catalogAsManifest` is built from
`getCompanyTableCatalog`, which reads `information_schema` — every table in the
schema is compared, with `rows: 0` throughout, whether or not any dataset ever
inserts into it. Coverage at the name level is already total, and no amount of demo
data would add to it.

"Which tables have no demo rows?" remains a fair question about the demo datasets. It
belongs to `pnpm db:check:datasets`, not here, and it is not part of this plan.

---


## Task 18: Committed manifest vintages

**Restructured 2026-08-25.** No longer a Task 15 add-on — the vintages ARE the
check's input, so this is what makes Task 15 do anything. Dependency inverted:
Task 15 skips cleanly without vintages, so either may land first, but Task 15 is
inert until this one does.

**Depends on:** Task 15 step 4 (`--write`).
**Files:**
- Create: `packages/jobs/manifests/README.md`
- Create: `packages/jobs/manifests/2026-08-25.json`

**Steps:**

1. Generate today's vintage against a fully-migrated local database:
   ```bash
   pnpm db:migrate
   pnpm db:check:backups -- --write
   ```
   It writes `packages/jobs/manifests/<today>.json` — a `Manifest` carrying `kind`,
   `version`, `schemaVersion`, `tables` (name + columns, `rows: 0`), and empty
   `storage`/`excludedRows`, with `excludedTables` set to `SECRET_TABLES`. No rows,
   no company data, nothing tenant-specific: compatibility is decided entirely by
   table and column names, so a schema-shaped manifest is exactly as informative as
   a real customer backup and costs nothing to commit.

2. `README.md` states the contract, in these terms:
   - one file per vintage, named by the date it was taken;
   - files are **added, never edited** — editing one makes the check agree with
     whatever broke it;
   - take a new one at each release, so the oldest vintage stays roughly inside
     `BACKUP_RETENTION_DAYS` (90) — that window is what the check is really
     asserting;
   - delete a vintage only when the project decides backups that old need not
     restore, and say so in the commit message;
   - these are not test fixtures. Do not point a unit test at them.

3. Do not backdate a file, and do not synthesise older vintages from git history.
   Today's vintage proves nothing today — its value starts accruing the moment the
   schema moves. Say exactly that in the README so nobody deletes it as useless.

**Verify:**
```bash
pnpm db:check:backups
# Expected:
#   Checked 1 vintage(s) against the live schema.
#     ✓ 2026-08-25.json: restorable
# exit 0

# And that the check actually bites — temporarily hand-edit the committed vintage to
# name a column that no longer exists, re-run, confirm exit 1 and the FIX_HINT, then
# `git checkout` the file. A green check that cannot go red has not been tested.
```

**Out of scope:** synthesising older vintages; committing anything with real rows in
it.

---

## Task 19: ~~Post-deploy revalidation~~, scheduled exports, expiry

**Depends on:** Task 9
**Files:**
- Create: `packages/jobs/src/inngest/functions/scheduled/backup-maintenance.ts`
- Create: `packages/jobs/src/inngest/functions/scheduled/backup-maintenance.test.ts`
- Modify: `packages/jobs/src/inngest/functions/scheduled/index.ts` — add the export
- Modify: `packages/jobs/src/inngest/index.ts` — register it in both places
- Copy from (precedent): `packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts` — multi-pass structure, one `step.run` per pass, named constants for the windows

**Steps:**
1. ~~Three~~ **Two** passes in one function, cron `0 3 * * *` (before the 04:00
   workflow retention and the 05:00 monitor from Task 4):
   - ~~`revalidate-backups`~~ — **REMOVED 2026-08-25 (user decision)**, see below.
   - `expire-backups`: delete backups older than `BACKUP_RETENTION_DAYS = 90`,
     reusing `deleteCompanyBackupExport` so the sibling `assets/` folder goes too.
   - `scheduled-export`: for each company with no backup newer than
     `BACKUP_MAX_AGE_DAYS = 7`, fire `carbon/company-export`.
2. Export the two constants and have Task 11's UI read
   `BACKUP_RETENTION_DAYS` for the expiry date rather than duplicating the number.
3. Write the catalog once per pass, not per backup — the loop rule again.
4. Test the boundary of each window: exactly at the threshold is kept, one day past
   is acted on.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- backup-maintenance
# Expected: at least 4 passing tests (two per surviving pass)

pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no TypeScript errors

grep -n "backupMaintenanceFunction" packages/jobs/src/inngest/index.ts
# Expected: 2 matches
```

**Out of scope:** notifying users that a backup expired; per-company retention
settings.

**Deviations as built (2026-08-25):**
- `BACKUP_RETENTION_DAYS` / `BACKUP_MAX_AGE_DAYS` live in `@carbon/utils`
  (`const.ts`), not in this file. Step 2 wanted one definition shared with the UI,
  and the app may not import `@carbon/jobs` — `@carbon/utils` is the only module
  both sides can reach, so anything else would have been two copies of "90" with
  the UI free to promise a date the job does not honour.
- Age is read from `manifest.exportedAt`, never a storage object's mtime: anything
  that rewrites a file inside the folder would push mtime forward and make the
  backup immortal.
- The scheduled-export pass attributes its export to the `system` user (the id the
  rest of the repo uses for automated writes) and SKIPS itself when there is none.
  `company` has no `createdBy` column, and naming an arbitrary employee would put a
  person on something they did not do.
- The scheduled-export pass passes `includeStorage: "none"` — a weekly cron should
  not silently duplicate a company's whole asset library.

**`revalidate-backups` removed, 2026-08-25 (user decision).** The pass recomputed
every backup's verdict nightly and wrote it back to `compatibility.json`. The user's
objection is correct and decides it: by the time a nightly pass can notice that a
migration broke existing backups, that migration is already in production and the
backups are already dead. Nothing consumed the finding — no alert, no notification,
no repair — so its entire effect was keeping a badge fresh, which is detection
theatre. Prevention is `pnpm db:check:backups` at commit time, and that is the whole
job. What replaces it: nothing. `compatibility.json` is written once at export and
is a DATED fact — `checkedAt` equals the export date, which the Backups row already
displays, so a badge cannot read as a live promise; `RestoreDisclosure` prints that
date at the one moment the answer changes a decision; and `assertBackupImportable`
inside `company-restore.ts` is the hard refusal, run against the LIVE schema, which
cannot go stale. Do not reintroduce the pass without a consumer that ACTS on a
finding.

Removed with it: `revalidateBackups` and its four tests, the `Catalog` /
`getCompanyTableCatalog` / `writeBackupCompatibility` imports in
`backup-maintenance.ts`, and the `upload`/`uploadError` machinery in the test
double. Its snapshot-exclusion coverage was MOVED to `expireBackups` (`never
expires a pre-restore or pre-template snapshot`) rather than dropped — that
property protects the user's undo state and is now asserted on a pass that exists.

---

## Task 20: Browser verification of the whole backup flow

**Depends on:** Tasks 7, 8, 11, 13
**Files:** none — verification only

**Steps:**
1. Start the local stack (`crbn up`) and log in with the `/auth` skill.
2. Use the `/test` skill to drive: Settings → Backups; create a backup; confirm the
   optimistic row appears immediately and the progress modal shows real phase
   counts; confirm the finished row shows a `Ready` badge and an expiry date.
3. Restore that backup. Confirm the disclosure screen appears, that a zero-findings
   restore needs only a plain confirm, and that the Keep/Revert row appears
   afterwards with both buttons.
4. Capture screenshots of the disclosure screen and the badge into
   `.ai/scratch/e2e/` via the `/error` skill conventions.

**Verify:** the run file contains a pass/fail line for each of steps 2–3, with
screenshot paths.

**Out of scope:** testing a cross-schema restore (needs two schema versions, which
is what CI covers).

---

## Task 21: Correct `.claude/rules/company-backup-restore.md`

**Depends on:** none
**Files:**
- Modify: `.claude/rules/company-backup-restore.md`

**Steps:**
1. Replace the single-`.carbon.json.gz` NDJSON description with the current
   per-table folder layout: `exports/<name>/tables/<table>.ndjson.gz`,
   `exports/<name>/assets/`, `exports/<name>/manifest.json` written last, and the
   readers `readBackup` / `deserializeTable` / `writeBackupManifest` /
   `backupTablePath`.
2. Correct the deployment claim. The rule implies a `config.toml` entry is required
   to deploy; `ci/src/migrations.ts` runs `supabase functions deploy` with no
   function name, which deploys every directory under `supabase/functions/`.
   `config.toml` only overrides per-function settings. Note that `schedule` and
   `trigger-rework` are live despite having no entry.
3. Add the `excludedRows` manifest field from Task 7 and the five-state status
   vocabulary from Task 11.
4. Do not document anything from this plan that has not merged. Mark unmerged
   items with `<!-- UNVERIFIED: ... -->` or leave them out.

**Verify:**
```bash
grep -c "carbon.json.gz" .claude/rules/company-backup-restore.md
# Expected: 0, or only inside an explicit "retired format" note
```

**Out of scope:** rewriting the whole rule; the `docs/` site.

---

## Task 22: Remove the expiry date from the Backups list

**Depends on:** none

**Files:**
- Modify: `apps/erp/app/modules/settings/ui/Backups/format.ts` — delete
  `formatBackupExpiry` and the now-unused imports
- Modify: `apps/erp/app/routes/x+/settings+/backups.tsx` — delete the import and
  the `Expires …` fragment

**Steps:**

1. In `apps/erp/app/modules/settings/ui/Backups/format.ts`, delete the whole
   `formatBackupExpiry` function including its doc comment (lines 90–103, the
   block beginning `/**` and `* The day this backup is deleted.`).
2. In the same file, change line 1 from
   `import { BACKUP_RETENTION_DAYS, formatDate } from "@carbon/utils";` to
   nothing — both `BACKUP_RETENTION_DAYS` and `formatDate` were used only by that
   function. Delete line 1 entirely.
3. In the same file, delete line 2,
   `import { parseAbsoluteToLocal } from "@internationalized/date";` — also used
   only by that function.
4. In `apps/erp/app/routes/x+/settings+/backups.tsx`, remove `formatBackupExpiry,`
   from the import list at line 67.
5. In the same file, delete the comment and the JSX fragment that renders the
   expiry — the block starting with the comment
   `{/* A date, not a policy sentence — "expires 12 Nov" is something` and ending
   with the `) : null}` that closes `{file.exportedAt ? (`. Leave the size
   fragment above it and the `excludedRowCount` fragment below it untouched.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon
grep -rn "formatBackupExpiry\|Expires " apps/erp/app/modules/settings apps/erp/app/routes/x+/settings+/backups.tsx
# Expected: no output
pnpm exec turbo run typecheck --filter=erp
# Expected: no TypeScript errors (note: the erp package is named `erp`, not `@carbon/erp`)
```

**Out of scope:** `formatBackupDate`, `formatBackupName`, `formatElapsed`,
`BackupStatus` and the two status helpers in the same file — all still used.

---

## Task 23: Delete the nightly backup-maintenance job, its registrations, and both constants

**Depends on:** Task 22

**Files:**
- Delete: `packages/jobs/src/inngest/functions/scheduled/backup-maintenance.ts`
- Delete: `packages/jobs/src/inngest/functions/scheduled/backup-maintenance.test.ts`
- Modify: `packages/jobs/src/inngest/functions/scheduled/index.ts` — drop the export
- Modify: `packages/jobs/src/inngest/index.ts` — drop the import and the registration
- Modify: `packages/utils/src/const.ts` — drop both constants

**Steps:**

1. Delete both files:
   `packages/jobs/src/inngest/functions/scheduled/backup-maintenance.ts` and
   `packages/jobs/src/inngest/functions/scheduled/backup-maintenance.test.ts`.
2. In `packages/jobs/src/inngest/functions/scheduled/index.ts`, delete line 2:
   `export { backupMaintenanceFunction } from "./backup-maintenance";`
3. In `packages/jobs/src/inngest/index.ts`, delete `backupMaintenanceFunction,`
   from the import block around line 58 and from the registration array around
   line 153.
4. In `packages/utils/src/const.ts`, delete the `BACKUP_RETENTION_DAYS` doc
   comment and its `export const` (lines 3–11), and delete the
   `BACKUP_MAX_AGE_DAYS` comment and `export const` (lines 13–14). Leave
   `SUPPORT_EMAIL` above and `INTERNAL_EMAIL_DOMAINS` below untouched.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon
grep -rn "backupMaintenance\|BACKUP_RETENTION_DAYS\|BACKUP_MAX_AGE_DAYS" --include=*.ts --include=*.tsx apps packages
# Expected: no output
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp --filter=@carbon/utils
# Expected: no TypeScript errors
pnpm --filter @carbon/jobs test
# Expected: all tests pass, and no backup-maintenance test file is collected
```

**Out of scope:** `company-export.ts`, `company-restore.ts`,
`company-compatibility.ts` and `company-backup.ts` — the export/restore engine is
untouched. Do NOT remove `_pre-` snapshot handling anywhere; snapshots are cleaned
up by the keep/revert path, which this job never touched.

**If** `grep` still finds a reference after step 4 — for example another package
imports one of the constants — **STOP and report; do not improvise a replacement.**

---

## Task 24: Rename the vintage to `schema.json` and rewrite the manifests README

**Depends on:** none

**Files:**
- Rename: `packages/jobs/manifests/2026-08-25.json` → `packages/jobs/manifests/schema.json`
- Modify: `packages/jobs/manifests/README.md` — full rewrite

**Steps:**

1. Rename the file, preserving history:
   ```bash
   cd /Users/aashu/work/carbon/carbon
   git mv packages/jobs/manifests/2026-08-25.json packages/jobs/manifests/schema.json
   ```
   The contents are already exactly what the new baseline needs — a
   schema-shaped `Manifest` of today's schema with `rows: 0`. Do not edit them.
2. Replace the entire contents of `packages/jobs/manifests/README.md` with:

   ````markdown
   # The schema baseline

   `schema.json` is a snapshot of the export schema: every table a company backup
   would contain, with its column list and **no rows**. Compatibility is decided
   entirely by table and column names, so a schema-shaped manifest is exactly as
   informative as a real customer backup and costs nothing to commit.

   ## Nobody maintains this by hand

   The pre-commit hook regenerates it from your live database and stages it,
   whenever you commit a change under
   `packages/database/supabase/migrations/`. There is no command to remember and
   no dated files to add. It is generated output, in the same category as a
   lockfile.

   ## What it is compared against

   A file that regenerates itself cannot be its own baseline — it would compare
   today's schema with today's schema and pass every time. So the check fetches the
   version of this file already on `main`, which is the schema real customer
   backups were taken against:

   ```
   https://raw.githubusercontent.com/<owner>/<repo>/main/packages/jobs/manifests/schema.json
   ```

   The owner and repo come from your `origin` remote, so a fork checks itself.

   If that fetch fails — offline, timeout, GitHub down — the check warns and falls
   back to `git show origin/main:packages/jobs/manifests/schema.json`, your local
   copy. A network problem never fails a commit. That copy can be months old if you
   have not pulled; an older baseline is a **stricter** check, never a blinder one,
   but it can flag a column a teammate has already removed on `main`. That is why
   the warning names the staleness and not just the failure.

   If the baseline is in neither place, the check **fails**. A missing baseline
   silently skipped is indistinguishable from a passing check.

   ## The one time you have to think about it

   The very first commit that puts this file on `main` has no baseline to compare
   against. If that commit also touches a migration, bypass the hook once with
   `CARBON_SKIP_BACKUP_CHECK=1 git commit …`. After it merges, the situation cannot
   recur.

   ## Looking further back

   Git holds every past version of this one file, so "would a six-month-old backup
   still restore" is answered with
   `git show <commit>:packages/jobs/manifests/schema.json` rather than by committing
   dated copies.

   ## Not a test fixture

   Do not point a unit test at this file — its contents change with every migration,
   so a test asserting on it would be rewritten constantly and prove nothing.
   ````

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon
ls packages/jobs/manifests/
# Expected: exactly two entries — README.md and schema.json
node -e "const m=require('./packages/jobs/manifests/schema.json'); console.log(m.tables.length, m.tables.every(t=>t.rows===0))"
# Expected: a table count over 300, then `true`
```

**Out of scope:** the contents of `schema.json`. Do not hand-edit it.

---

## Task 25: Rewrite `check-backups.ts` around a single fetched baseline

**Depends on:** Task 24

**Files:**
- Modify: `packages/jobs/src/scripts/check-backups.ts` — replace the vintage
  directory scan and the `--write` mode with the baseline resolution below
- Copy from (precedent): the existing file's `connect`, `skip`,
  `countPendingMigrations`, `catalogAsManifest` and `reportBlocking` — keep all
  five as they are, they are unchanged by this task

**Steps:**

1. Replace the file header comment (lines 1–21) with:

   ```typescript
   /**
    * Checks that the backups customers already hold would still restore against the
    * current schema.
    *
    * A migration can make an existing backup unrestorable without the backup changing
    * at all — add a NOT NULL column with no DEFAULT and every backup taken before today
    * stops loading. Nobody finds out until someone clicks Restore, which is the worst
    * possible moment. So the question gets asked here, at commit time.
    *
    * The baseline is `packages/jobs/manifests/schema.json` AS IT STANDS ON `main` —
    * the schema real customer backups were taken against. The copy in the working
    * tree is not the baseline: it is regenerated from the live database on every
    * successful run, so comparing against it would compare today with today.
    *
    * Runs from the pre-commit hook when `packages/database/supabase/migrations/**` is
    * touched; set CARBON_SKIP_BACKUP_CHECK=1 to skip it there.
    *
    * Usage:
    *   pnpm db:check:backups             # check only — writes nothing
    *   pnpm db:check:backups -- --stage  # ...then update and stage schema.json
    */
   ```

2. Replace the import block (lines 23–36 of the current file) with:

   ```typescript
   import { execFileSync } from "node:child_process";
   import { mkdirSync, writeFileSync } from "node:fs";
   import { dirname, join } from "node:path";
   import process from "node:process";
   import { parseArgs } from "node:util";
   import type { KyselyDatabase } from "@carbon/database/client";
   import { now } from "@internationalized/date";
   import { Kysely, PostgresDialect, sql } from "kysely";
   import pg from "pg";
   ```

   `readdirSync` is still needed by `countPendingMigrations`, so keep it in the
   `node:fs` import: the line becomes
   `import { mkdirSync, readdirSync, writeFileSync } from "node:fs";`.
   `existsSync`, `readFileSync` and `today` are no longer used — they must not
   remain.

3. Replace the `VINTAGES_DIR` constant (line 50) with:

   ```typescript
   /** Repo-relative: the same string works for the fetch URL and for `git show`. */
   const SCHEMA_REPO_PATH = "packages/jobs/manifests/schema.json";
   const SCHEMA_FILE = join(import.meta.dirname, "../../manifests/schema.json");
   const BASELINE_BRANCH = "main";
   /** A hook that hangs is a hook people bypass. */
   const FETCH_TIMEOUT_MS = 3000;
   ```

4. Add these functions after `reportBlocking`:

   ```typescript
   function git(args: string[]): string {
     return execFileSync("git", args, {
       encoding: "utf8",
       stdio: ["ignore", "pipe", "pipe"]
     }).trim();
   }

   /** Environmental problems skip; a missing baseline does NOT — see `resolveBaseline`. */
   function fail(message: string): never {
     console.error(`✗ ${message}`);
     process.exit(1);
   }

   /** `owner/repo` from the origin remote, or null when origin is not GitHub. */
   function githubSlug(): string | null {
     let url: string;
     try {
       url = git(["remote", "get-url", "origin"]);
     } catch {
       return null;
     }
     const match = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
     return match ? `${match[1]}/${match[2]}` : null;
   }

   function localBaseline(): Manifest | null {
     try {
       return JSON.parse(
         git(["show", `origin/${BASELINE_BRANCH}:${SCHEMA_REPO_PATH}`])
       ) as Manifest;
     } catch {
       return null;
     }
   }

   const STALE_NOTE =
     `  Falling back to your local origin/${BASELINE_BRANCH} copy, which can be months old if you have not pulled.\n` +
     "  An older baseline is a STRICTER check, never a blinder one — but it can flag a column a teammate already removed.";

   /**
    * The schema `main` currently ships, which is what a customer's existing backup
    * was taken against. Never the working-tree copy: that is regenerated from the
    * live database below, so it would compare today's schema with itself.
    */
   async function resolveBaseline(): Promise<{
     manifest: Manifest;
     source: string;
   }> {
     const slug = githubSlug();
     if (slug) {
       const url = `https://raw.githubusercontent.com/${slug}/${BASELINE_BRANCH}/${SCHEMA_REPO_PATH}`;
       try {
         const res = await fetch(url, {
           signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
         });
         if (res.ok) {
           return { manifest: JSON.parse(await res.text()) as Manifest, source: url };
         }
         if (res.status === 404) {
           console.warn(
             `⚠ ${SCHEMA_REPO_PATH} is not on ${BASELINE_BRANCH} yet (404).\n${STALE_NOTE}`
           );
         } else {
           console.warn(
             `⚠ Could not fetch the schema baseline (HTTP ${res.status}).\n${STALE_NOTE}`
           );
         }
       } catch (err) {
         console.warn(
           `⚠ Could not fetch the schema baseline from ${BASELINE_BRANCH} — ${
             err instanceof Error ? err.message : String(err)
           }\n${STALE_NOTE}`
         );
       }
     } else {
       console.warn(
         `⚠ origin is not a GitHub remote, so the baseline could not be fetched.\n${STALE_NOTE}`
       );
     }

     const local = localBaseline();
     if (local) {
       return { manifest: local, source: `origin/${BASELINE_BRANCH} (local copy)` };
     }

     fail(
       `The schema baseline could not be found.\n` +
         `  Looked on ${BASELINE_BRANCH} at GitHub and in your local origin/${BASELINE_BRANCH}, for ${SCHEMA_REPO_PATH}.\n` +
         `  A missing baseline cannot be skipped quietly — it would look exactly like a passing check.\n` +
         `  If this is the first commit to introduce the baseline, commit it once with:\n` +
         `    CARBON_SKIP_BACKUP_CHECK=1 git commit ...`
     );
   }

   /** Generated output, like a lockfile — announced, never silent. */
   function writeSchemaFile(catalog: Catalog): void {
     // @internationalized/date, never JS Date (.claude/rules/date-handling.md), and
     // UTC rather than the machine's zone — this stamp labels a schema, not a
     // business day, so who records it must not change what it says.
     const manifest = catalogAsManifest(catalog, now("UTC").toAbsoluteString());
     mkdirSync(dirname(SCHEMA_FILE), { recursive: true });
     writeFileSync(SCHEMA_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
     try {
       git(["add", SCHEMA_FILE]);
       console.log(
         `Updated and staged ${SCHEMA_REPO_PATH} (${manifest.tables.length} tables) — the baseline the next migration is checked against.`
       );
     } catch (err) {
       console.warn(
         `⚠ Wrote ${SCHEMA_REPO_PATH} but could not stage it — ${
           err instanceof Error ? err.message : String(err)
         }\n  Run: git add ${SCHEMA_REPO_PATH}`
       );
     }
   }
   ```

5. Replace `printUsage` with:

   ```typescript
   function printUsage() {
     console.log(`
   Usage: pnpm db:check:backups [-- --stage]

   Asks whether the backups customers already hold would still restore against your
   current schema, comparing packages/jobs/manifests/schema.json AS IT STANDS ON main
   with your live schema. Writes nothing to your database.

   Arguments:
     --stage   On success, regenerate schema.json from your live schema and git-add
               it. The pre-commit hook passes this; a manual run stays read-only.
   `);
   }
   ```

6. In `main`, change the `parseArgs` options from `write` to `stage`:

   ```typescript
     const { values } = parseArgs({
       args: process.argv.slice(2).filter((a) => a !== "--"),
       options: {
         stage: { type: "boolean", default: false },
         help: { type: "boolean", short: "h", default: false }
       },
       strict: true
     });
   ```

7. Replace everything in `main` from `if (values.write) {` (line 228) through the
   end of the function (line 280) with:

   ```typescript
     const baseline = await resolveBaseline();
     console.log(`Checking your schema against ${baseline.source}...`);

     if (reportBlocking(SCHEMA_REPO_PATH, catalog, baseline.manifest)) {
       console.error(
         `\nBackups taken against ${baseline.source} would no longer restore.\n${FIX_HINT}\n\n${RERUN_HINT}`
       );
       // A blocked commit stages nothing: the baseline must keep describing the
       // schema that is actually shipped.
       process.exitCode = 1;
       return;
     }

     if (values.stage) writeSchemaFile(catalog);
   ```

   The `const catalog = await getCompanyTableCatalog(db);` line above it stays
   exactly where it is.

8. Update `RERUN_HINT` (line 57) to keep the manual command accurate — it is
   already `pnpm db:check:backups`, so leave it unchanged. Confirm no string in
   the file still mentions `--write` or "vintage".

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon
grep -n "write\|vintage\|VINTAGE\|existsSync\|readFileSync\|today(" packages/jobs/src/scripts/check-backups.ts
# Expected: no output (readdirSync stays, but `readFileSync` and `existsSync` must be gone)
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no TypeScript errors
pnpm exec biome check packages/jobs/src/scripts/check-backups.ts
# Expected: no error-severity findings
pnpm db:check:backups
# Expected: a "Checking your schema against https://raw.githubusercontent.com/..." line,
# then "  ✓ packages/jobs/manifests/schema.json: restorable", exit 0.
# If your database is behind, it prints the migrate-and-retry skip instead — run
# `pnpm db:migrate` first.
git status --porcelain packages/jobs/manifests/schema.json
# Expected: no output — a run without --stage must not modify the file
```

**Out of scope:** `connect`, `skip`, `countPendingMigrations`,
`catalogAsManifest`, `reportBlocking`, `FIX_HINT` and the bottom
`main(db).catch(...).finally(...)` block — all unchanged.

**If** `import.meta.dirname` is unavailable in this runtime, **STOP and report** —
the existing file already relies on it, so a failure there means something else
changed.

---

## Task 26: Update the pre-commit hook

**Depends on:** Task 25

**Files:**
- Modify: `.husky/pre-commit` — lines 46–55

**Steps:**

1. Replace the block at lines 46–55 with:

   ```sh
   # A migration can make a backup a customer already holds unrestorable, without the
   # backup changing at all. This compares the schema baseline on main with your live
   # schema, then updates and stages the baseline. Set CARBON_SKIP_BACKUP_CHECK=1 to skip.
   if [ -z "$CARBON_SKIP_BACKUP_CHECK" ] && git diff --cached --name-only | grep -q '^packages/database/supabase/migrations/'; then
       echo "Checking backup compatibility against the schema..."
       if ! pnpm --silent db:check:backups -- --stage; then
           echo "Commit blocked: this migration breaks existing backups. See above."
           exit 1
       fi
   fi
   ```

   Note the root `db:check:backups` script already ends in `--`
   (`pnpm --filter @carbon/jobs db:check:backups --`), so the extra `--` here is
   what forwards `--stage` through both pnpm layers.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon
sh -n .husky/pre-commit
# Expected: no output (valid shell syntax)
grep -n '\-\-stage' .husky/pre-commit
# Expected: one match, on the db:check:backups line
```

**Out of scope:** the lingui, MCP and dataset blocks above it.

---

## Task 27: Re-sync the rules and docs

**Depends on:** Tasks 1–5

**Files:**
- Modify: `.claude/rules/company-backup-restore.md`
- Modify: `.ai/docs/backup-durability-simple.md`
- Modify: `.ai/docs/backup-durability-eli5.html`
- Modify: `.ai/plans/2026-08-25-backup-durability.md`
- Modify: `.ai/specs/2026-08-25-backup-durability.md`
- Modify: `packages/jobs/AGENTS.md`
- Modify: `AGENTS.md`

**Steps:**

1. `.claude/rules/company-backup-restore.md`:
   - Delete the whole `## Nightly housekeeping — backup-maintenance.ts` section.
   - In `## The drift check — pnpm db:check:backups`, replace the paragraph
     describing "committed schema vintages in `packages/jobs/manifests/`" and
     "Take a new vintage at each release with `pnpm db:check:backups -- --write`"
     with the single-baseline design: one `schema.json`, regenerated and staged by
     the hook on success, compared against the copy on `main` fetched from
     `raw.githubusercontent.com` (URL from the `origin` remote), warned fallback to
     `git show origin/main:…`, hard failure when found in neither place.
   - In the "Three honest limits" paragraph, replace the third limit (which cites
     `BACKUP_RETENTION_DAYS` is 90 as the window worth covering) with: the check
     asserts against the last shipped schema only, and git history holds every past
     version of the file for looking further back.
   - In the ERP-layer status-vocabulary section, delete the sentence ending
     "Rows also show a concrete expiry date (`BACKUP_RETENTION_DAYS`,
     `formatBackupExpiry`) instead of a stale-backup disclaimer nobody reads."
2. `.ai/docs/backup-durability-simple.md`: in the "Every backup carries a status
   you can read" paragraph, delete "Plus the date it was taken and its expiry
   date." and the sentence "Backups are also created on a schedule (every 7 days)
   and cleaned up after 90 days." Replace with a line stating backups are created
   when a person asks and stay until a person deletes them. Also update the
   "prevented at the door" section, which describes "dated snapshots" — it is now
   one file the hook maintains.
3. `.ai/docs/backup-durability-eli5.html`: in the `<div class="two">` "After" box,
   delete the `<p class="muted">` line about the 90-day deletion date. In the
   "The one clever bit" section, change "We keep dated notes of what the database
   looked like on a given day" to describe the single file the hook maintains and
   the copy on `main` it is compared against. In "What it does not do", the
   sentence "The dated notes record names only" becomes "The saved schema records
   names only". Do not touch the template's `<style>` block or the theme script.
4. `.ai/plans/2026-08-25-backup-durability.md`: mark Task 19 as reverted, with a
   one-line pointer to `.ai/specs/2026-08-25-backup-durability.md`. Mark
   Task 18 the same way.
5. `.ai/specs/2026-08-25-backup-durability.md`: in the "Decisions at a glance"
   table, append " — **superseded**, see `.ai/specs/2026-08-25-backup-durability.md`"
   to the D6 and D7 rows.
6. `packages/jobs/AGENTS.md`: in the Validation Commands block, replace the
   `db:check:backups` paragraph — it currently says the check compares "the
   committed schema vintages in `manifests/`" and tells the reader to "Take a new
   vintage at each release with `pnpm db:check:backups -- --write`". Both are now
   wrong.
7. Root `AGENTS.md`: the `pnpm db:check:backups` line in Validation Commands and
   the paragraph below it mention running `pnpm db:migrate` first — that is still
   true and stays. Check no line mentions vintages or `--write`; correct any that
   does.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon
grep -rn "vintage\|--write\|BACKUP_RETENTION_DAYS\|BACKUP_MAX_AGE_DAYS\|backup-maintenance\|expiry date" .claude/rules/company-backup-restore.md packages/jobs/AGENTS.md AGENTS.md .ai/docs/backup-durability-simple.md .ai/docs/backup-durability-eli5.html
# Expected: no output
```

**Out of scope:** `docs/content/docs/platform/backups.mdx` — the reader-facing
docs page is deliberately implementation-free and says nothing about schedules,
expiry or the drift check. Confirm that with a grep before leaving it alone; if it
does mention them, STOP and report rather than rewriting the customer-facing page
as part of this change.

---

## Task 28: End-to-end verification of all four behaviours

**Depends on:** Tasks 22–27

**Files:** none — verification only. Revert every temporary edit made here.

**Steps:**

1. **Happy path.** With the database migrated and nothing staged:
   ```bash
   cd /Users/aashu/work/carbon/carbon && pnpm db:check:backups
   ```
   Expect the fetched-URL line and `✓ … restorable`, exit 0, and
   `git status --porcelain packages/jobs/manifests/schema.json` still empty.

2. **`--stage` writes and stages.**
   ```bash
   pnpm db:check:backups -- --stage
   git diff --cached --name-only | grep manifests/schema.json
   ```
   Expect the "Updated and staged …" line and the grep to match. Then
   `git restore --staged packages/jobs/manifests/schema.json && git checkout -- packages/jobs/manifests/schema.json`.

3. **Blocked commit stages nothing.** Temporarily edit
   `packages/jobs/manifests/schema.json` is NOT the way to test this — the
   working-tree copy is not the baseline. Instead, temporarily point
   `BASELINE_BRANCH` at a ref you control, or simulate by adding a throwaway
   column-dropping migration and running the hook path. The minimal check:
   ```bash
   pnpm db:check:backups -- --stage
   git status --porcelain packages/jobs/manifests/schema.json
   ```
   after making `resolveBaseline` return a hand-edited manifest with two extra
   invented column names removed from a real table. Expect exit 1, both column
   names printed with their table, and the second command to print nothing.
   **Revert the temporary edit immediately.**

4. **Offline falls back with a staleness warning.** Temporarily set
   `FETCH_TIMEOUT_MS` to `1` (guaranteeing a timeout) and run
   `pnpm db:check:backups`. Expect the `⚠ Could not fetch the schema baseline`
   warning followed by the two-line staleness note, then a verdict from
   `origin/main (local copy)`, exit 0. **Restore `FETCH_TIMEOUT_MS` to `3000`.**

5. **Missing baseline fails.** Temporarily set `SCHEMA_REPO_PATH` to
   `packages/jobs/manifests/does-not-exist.json` and run
   `pnpm db:check:backups`. Expect exit 1 and the message
   `The schema baseline could not be found.` **Restore `SCHEMA_REPO_PATH`.**

6. **Fork URL derivation.** Confirm both remote forms parse:
   ```bash
   node -e "for (const u of ['git@github.com:acme/fork.git','https://github.com/acme/fork.git','https://github.com/acme/fork']) { const m = u.match(/github\.com[:\/]([^\/]+)\/(.+?)(?:\.git)?\$/); console.log(u, '->', m && m[1]+'/'+m[2]); }"
   ```
   Expect `acme/fork` for all three.

7. **Full gates.**
   ```bash
   pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp --filter=@carbon/utils
   pnpm test
   pnpm exec biome check
   ```
   Expect no TypeScript errors, all test packages passing, and no NEW
   error-severity biome findings (this repo carries ~419 pre-existing warnings —
   leave them).

8. Confirm the working tree is clean of every temporary edit from steps 3–5:
   ```bash
   git diff packages/jobs/src/scripts/check-backups.ts
   ```
   Expect only the Task 4 changes, with `FETCH_TIMEOUT_MS = 3000` and the real
   `SCHEMA_REPO_PATH`.

**Verify:** every expectation in steps 1–8 met.

**Out of scope:** browser verification. Task 1 removes one text fragment from a
list row; the surrounding rendering is unchanged and covered by the erp typecheck.

---

## Task 29: Review fixes — single-source the export inclusion rule

**Depends on:** Task 25
**Source:** thermo-nuclear code review, findings 1–4

**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-backup.ts` — add
  `selectExportableTables(catalog)` and `exportableColumns(table)`
- Modify: `packages/jobs/src/inngest/functions/tasks/company-export.ts` — call them
- Modify: `packages/jobs/src/scripts/check-backups.ts` — call them; use the returned
  `blocked` flag; add `parseBaseline`; rename the `"vintage"` identity strings

**Steps:**

1. The rule for which tables and columns a backup contains was written twice — once
   in the exporter, once in the baseline builder. Extract both halves into
   `company-backup.ts`, beside `SECRET_TABLES` and the catalog they read.
2. `reportBlocking` destructures `{ findings, blocked }` and uses the returned flag;
   the filter stays only to print the list.
3. `parseBaseline(text, source)` separates ABSENT from PRESENT-BUT-UNREADABLE. Both
   the fetched and the local path go through it.
4. `sourceCompanyId` / `exportedBy` / `label` become `"schema-baseline"`.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp --filter=@carbon/utils
pnpm test
pnpm exec biome check --diagnostic-level=error packages/jobs/src/scripts/check-backups.ts packages/jobs/src/inngest/functions/tasks/company-backup.ts packages/jobs/src/inngest/functions/tasks/company-export.ts
# Expected: 3/3 typecheck, 25/25 test packages, no biome errors
```
Behaviour-preservation was proven by regenerating the baseline through the new
shared path and diffing: 337 tables, table and column lists identical, same six
excluded tables (catalog order rather than constant order).

**Out of scope:** review findings 5–7 (duplicated `skip`/`countPendingMigrations`
across two packages, three exit conventions, two restating comments) — left open
deliberately.
