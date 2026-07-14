# Job Operation Batching — implementation plan

**Spec:** `.ai/specs/2026-07-03-job-operation-batching.md` (all open questions resolved 2026-07-03)
**Research:** `.ai/research/job-operation-batching.md`
**Branch:** `feature/job-operation-batching`
**Supersedes:** the never-merged prior plan (commit `d6c7ad3de`)

Every grounded fact below marked **[VERIFIED]** was re-checked against the working
tree on 2026-07-03. Line numbers are anchors, not gospel — re-locate by the quoted
code if they drifted. The superseded feature's terminology (case-insensitive grep
pattern `st[i]tch`) must not appear in any code, SQL, or docs this plan produces.

## Executor ground rules

1. **Never rebuild the database.** `pnpm db:migrate` applies pending migrations; if the local DB is unreachable, STOP and tell the user.
2. **Commits:** conventional format, matching the style of recent commits on `main`. Commit per task via the `/check-and-commit` gate; never auto-push.
3. **Typecheck filters:** `pnpm exec turbo run typecheck --filter=erp` and `--filter=mes` (package names are `erp` / `mes` — **[VERIFIED]** in the prior plan; if turbo reports "no package found", retry with `@carbon/erp` / `@carbon/mes` and report which name worked). Never run a whole-repo typecheck (OOMs).
4. **Generated DB types reality:** `pnpm db:migrate` regenerates `packages/database/src/types.ts` + swagger from the LOCAL database, but the committed types are generated from the cloud DB and include cloud-only per-company tables. After migrating, run `git diff --stat packages/database/src/types.ts`. If the diff is dominated by deletions of tables unrelated to this feature, run `git restore packages/database/src/types.ts` (and the swagger file if also mass-changed) and write app code using the cast idiom instead: `client.from("jobOperationBatch" as any)`, `client.rpc("get_batchable_operations" as any, {...})`, and `(row as any).batchable` for new columns — with a `// TODO: remove casts after types regenerate post-deploy` comment at each site. If the diff is clean/additive, commit it and use full types. **If unsure which case you're in, STOP and ask Brad.**
5. Verification commands close each task. Run them; never assert green without output.
6. Spec wins over plan; code wins over both — surface conflicts, don't improvise silently.
7. Do not directly write `jobOperation.startDate`/`dueDate`, and never delete operations with production events (module AGENTS.md). This plan never requires either.

## Verified facts the design rests on (do not re-litigate)

- **[VERIFIED]** `trg_event_sync_"jobOperation"` is a `BEFORE INSERT OR UPDATE OR DELETE ... FOR EACH ROW` trigger (created by `attach_event_trigger`, `20260410030406_event-system-after-interceptors.sql:119-123`). A multi-row Kysely `UPDATE ... SET status='Done'` fires it once per row. The `sync_finish_job_operation` interceptor (`20260410031809_production-interceptors.sql:109-150`) closes that row's open `productionEvent`s and flips `Waiting` dependents to `Ready` via `jobOperationDependency`. **Each member job's downstream op releases independently; no cross-job edges needed.** No newer migration redefines either.
- **[VERIFIED]** `process` has a **bare PK `("id")`** with `companyId` column; current columns include `completeAllOnScan BOOLEAN NOT NULL DEFAULT FALSE` (`20251001001426_kanban-jobs.sql:29`) — the precedent flag. Created in `20240819115702_work-centers.sql:1-17`.
- **[VERIFIED]** `jobOperation.processId` is `TEXT NOT NULL`; `workCenterId` nullable; PK bare `("id")`; `companyId NOT NULL` (`20240915192542_job-methods.sql:125-151`). Status enum: `'Canceled','Done','In Progress','Paused','Ready','Todo','Waiting'` (`20240927033740`). No grouping/batch column exists yet.
- **[VERIFIED]** `productionQuantity` (`20241002012019:7-28`): `id` DEFAULT `xid()`, `quantity` INTEGER NOT NULL, type enum `'Rework'|'Scrap'|'Production'` DEFAULT 'Production', `setupProductionEventId` TEXT nullable.
- **[VERIFIED]** `getNextSequence(trx, tableName, companyId)` — `packages/database/supabase/functions/shared/get-next-sequence.ts:5-9`.
- **[VERIFIED]** Sequence seeding pattern for existing companies: `20260601143527_picking-lists.sql:134-145` (`INSERT INTO "sequence" ... SELECT ... FROM "company" ON CONFLICT DO NOTHING`). New companies: the sequences array imported by `packages/database/supabase/functions/seed-company/index.ts` (rows like `{ table: 'pickingList', name: 'Picking List', prefix: 'PL', next: 0, size: 6, step: 1 }`).
- **[VERIFIED]** Newest `get_active_job_operations_by_location` definition: `20260531084723_rework-serial-flow.sql`. It feeds BOTH the ERP schedule board (`apps/erp/app/modules/production/production.service.ts` → `getActiveJobOperationsByLocation`) and the MES kanban (`apps/mes/app/services/operations.service.ts`). Returns `processId`, `workCenterId`, `operationQuantity`, `targetQuantity`, etc. — no batch/material columns yet.
- **[VERIFIED]** Material property chain: `jobMaterial.jobOperationId` (nullable TEXT, added `20260120132502` with backfill) → `jobMaterial.itemId` → `item.id`; `material.id = item.readableId AND material.companyId = item.companyId`; property FKs on `material`: `materialFormId`, `materialSubstanceId`, `gradeId`, `dimensionId`, `finishId`, `materialTypeId`; lookups `materialForm`/`materialSubstance`/`materialGrade`/`materialDimension`/`materialFinish` display column `name`.
- **[VERIFIED]** `issue` edge function (`packages/database/supabase/functions/issue/index.ts`) has a `type: "jobOperation"` case `{ id, quantity, companyId, userId }` that issues all eligible untracked materials for ONE operation per that job's own BOM (`jobMaterial` where `jobOperationId = id`, itemType Material/Part/Consumable, methodType ≠ Make to Order, no batch/serial tracking). The MES completion route `apps/mes/app/routes/x+/complete.tsx` invokes it. (Its `jobOperationBatchComplete` case is **lot**-tracking completion — unrelated; do not touch it.)
- **[VERIFIED]** MES `finishJobOperation` (`apps/mes/app/services/operations.service.ts:148-189`): sets status `Done`, then for each ended `productionEvent` with `postedToGL = false` invokes `post-production-event`. Batch completion must replicate this GL step.
- **[VERIFIED]** ERP schedule board: route `apps/erp/app/routes/x+/schedule+/operations.tsx` (loader ~69-311, URL-param filters `?filter=key:operator:value` parsed in the loader, `SearchFilter` + `Filter`/`ActiveFilters` from `~/components/Table/components/Filter` with `useFilters()`); drag-and-drop via `@dnd-kit` in `apps/erp/app/modules/production/ui/Schedule/Kanban/Kanban.tsx` (onDragEnd ~291-447 submits `{id, columnId, priority}` to `path.to.scheduleOperationUpdate` with `useSubmit`, `navigate:false`, per-item `fetcherKey`); item type = `operationItemValidator` in `.../Kanban/types.ts:97`; card = `.../Kanban/components/ItemCard.tsx` (menu ~181-220, badges ~299-311). Path entries at `apps/erp/app/utils/path.ts:1718-1719`.
- **[VERIFIED]** Material lookup pickers exist: `apps/erp/app/components/Form/{Shape,Substance,MaterialGrade,MaterialDimension,MaterialFinish,MaterialType}.tsx`; list services `getMaterialFormList`/`getMaterialSubstanceList`/etc. in `items.service.ts`.
- **[VERIFIED]** MES kanban: `apps/mes/app/routes/x+/operations.tsx` (loader maps RPC rows ~52-236), card `apps/mes/app/components/Kanban/components/ItemCard.tsx` (~76+, Card/CardHeader/CardContent/CardFooter). MES modal-drawer precedent: `ModalDrawer*` primitives (see `apps/erp/app/modules/production/ui/Procedures/ProcedureForm.tsx` imports).
- **[VERIFIED]** Edge functions: config entries are `[functions.<name>]` + `enabled` + `verify_jwt` in `packages/database/supabase/config.toml`; deno std `0.175.0` in the newest functions; no function named `batch*` exists.

## Dependency graph

```
Task 0 (branch)
  → Task 1 (migration) → Task 2 (types/casts decision) 
      → Task 3 (seed sequences) ∥ Task 4 (resources UI) ∥ Task 5 (validators) 
          → Task 6 (edge function) → Task 7 (ERP services + paths + action route)
              → Task 8 (batch planning board UI) ∥ Task 9 (schedule board integration)
              → Task 10 (MES board collapse) → Task 11 (MES batch view + complete)
                  → Task 12 (docs sync) → Task 13 (verification gate) → Task 14 (PR)
Tasks 3, 4, 5 are independent of each other. Tasks 8 and 9 are independent. 
```

## Progress

- [ ] Task 0: Create the branch
- [ ] Task 1: Database migration (flag, batch table, FKs, sequence, RPCs)
- [ ] Task 2: Types regeneration decision
- [ ] Task 3: Seed new-company sequence
- [ ] Task 4: Process form + table (resources module)
- [ ] Task 5: Production validators
- [ ] Task 6: `batch-operations` edge function
- [ ] Task 7: ERP services, paths, batching action route
- [ ] Task 8: Batch planning board UI
- [ ] Task 9: Schedule board badge + menu
- [ ] Task 10: MES kanban batch collapse
- [ ] Task 11: MES batch view + complete flow
- [ ] Task 12: Docs/AGENTS sync
- [ ] Task 13: Full verification gate (typecheck, lint, test, browser e2e)
- [ ] Task 14: PR

---

## Task 0: Create the branch

**Depends on:** none
**Files:** none

**Steps:**
1. ```bash
   git checkout main && git pull
   git checkout -b feature/job-operation-batching
   ```

**Verify:**
```bash
git branch --show-current
# Expected: feature/job-operation-batching
```

**Out of scope:** nothing else.

---

## Task 1: Database migration (flag, batch table, FKs, sequence, RPCs)

**Depends on:** Task 0
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_job-operation-batching.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260601143527_picking-lists.sql` (sequence seeding), `20260531084723_rework-serial-flow.sql` (RPC to fork)

**Steps:**

1. ```bash
   pnpm db:migrate:new job-operation-batching
   ```
   If the generated HHMMSS is `000000`, rename the file with random digits (e.g. `142817`). The timestamp must be NEWER than every migration on `main`.

2. Before writing SQL, capture the two definitions you must fork:
   ```bash
   grep -rln 'VIEW "processes"' packages/database/supabase/migrations/ | sort | tail -2
   grep -rln 'get_active_job_operations_by_location' packages/database/supabase/migrations/ | sort | tail -2
   ```
   Open the NEWEST file from each result and copy the full `CREATE VIEW "processes"` and `CREATE OR REPLACE FUNCTION get_active_job_operations_by_location` definitions verbatim into a scratch buffer. **If a newer definition than `20260531084723` exists for the RPC, fork that one.** Also eyeball the RLS idiom in the single newest `CREATE POLICY` migration; if it differs from `= ANY (SELECT unnest(...::text[]))` below, copy the current idiom.

3. Write the migration. Every statement idempotent (the deploy runner retries failed files over committed partial state). Full contents, in this order:

   ```sql
   -- Job Operation Batching (spec: .ai/specs/2026-07-03-job-operation-batching.md)
   -- Batchability is a property of the process. Batches group real jobOperations;
   -- jobs are never merged and the BOM is never modified.
   -- NOTE: an operation batch is unrelated to lot/batch tracking (batchNumber/trackedEntity).

   -- 1. Process capability flag
   ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchable" BOOLEAN NOT NULL DEFAULT false;

   -- 2. Recreate the "processes" view from its NEWEST definition (Postgres expands
   -- SELECT * at creation time, so the view must be re-declared to pick up the column).
   DROP VIEW IF EXISTS "processes";
   -- >>> paste the NEWEST "processes" view definition here, adding p."batchable"
   -- >>> to the select list (keep WITH(SECURITY_INVOKER=true) if present in the original)

   -- 3. Batch status enum
   DO $$ BEGIN
     CREATE TYPE "jobOperationBatchStatus" AS ENUM ('Active', 'Completed', 'Cancelled');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;

   -- 4. The operation batch
   CREATE TABLE IF NOT EXISTS "jobOperationBatch" (
     "id" TEXT NOT NULL DEFAULT id(),
     "readableId" TEXT NOT NULL,
     "companyId" TEXT NOT NULL,
     "processId" TEXT NOT NULL,
     "workCenterId" TEXT,
     "locationId" TEXT NOT NULL,
     "status" "jobOperationBatchStatus" NOT NULL DEFAULT 'Active',
     "notes" TEXT,
     "customFields" JSONB,
     "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
     "updatedBy" TEXT REFERENCES "user"("id"),
     "updatedAt" TIMESTAMP WITH TIME ZONE,
     CONSTRAINT "jobOperationBatch_pkey" PRIMARY KEY ("id", "companyId"),
     CONSTRAINT "jobOperationBatch_companyId_fkey" FOREIGN KEY ("companyId")
       REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
     CONSTRAINT "jobOperationBatch_processId_fkey" FOREIGN KEY ("processId")
       REFERENCES "process"("id"),
     CONSTRAINT "jobOperationBatch_workCenterId_fkey" FOREIGN KEY ("workCenterId")
       REFERENCES "workCenter"("id") ON DELETE SET NULL,
     CONSTRAINT "jobOperationBatch_locationId_fkey" FOREIGN KEY ("locationId")
       REFERENCES "location"("id"),
     CONSTRAINT "jobOperationBatch_readableId_unique" UNIQUE ("readableId", "companyId")
   );

   CREATE INDEX IF NOT EXISTS "jobOperationBatch_companyId_idx" ON "jobOperationBatch" ("companyId");
   CREATE INDEX IF NOT EXISTS "jobOperationBatch_processId_idx" ON "jobOperationBatch" ("processId");
   CREATE INDEX IF NOT EXISTS "jobOperationBatch_workCenterId_idx" ON "jobOperationBatch" ("workCenterId");
   CREATE INDEX IF NOT EXISTS "jobOperationBatch_locationId_idx" ON "jobOperationBatch" ("locationId");
   CREATE INDEX IF NOT EXISTS "jobOperationBatch_createdBy_idx" ON "jobOperationBatch" ("createdBy");

   ALTER TABLE "jobOperationBatch" ENABLE ROW LEVEL SECURITY;

   DROP POLICY IF EXISTS "SELECT" ON "public"."jobOperationBatch";
   CREATE POLICY "SELECT" ON "public"."jobOperationBatch"
     FOR SELECT USING (
       "companyId" = ANY (SELECT unnest(get_companies_with_employee_role()::text[]))
     );
   DROP POLICY IF EXISTS "INSERT" ON "public"."jobOperationBatch";
   CREATE POLICY "INSERT" ON "public"."jobOperationBatch"
     FOR INSERT WITH CHECK (
       "companyId" = ANY (SELECT unnest(get_companies_with_employee_permission('production_create')::text[]))
     );
   DROP POLICY IF EXISTS "UPDATE" ON "public"."jobOperationBatch";
   CREATE POLICY "UPDATE" ON "public"."jobOperationBatch"
     FOR UPDATE USING (
       "companyId" = ANY (SELECT unnest(get_companies_with_employee_permission('production_update')::text[]))
     );
   DROP POLICY IF EXISTS "DELETE" ON "public"."jobOperationBatch";
   CREATE POLICY "DELETE" ON "public"."jobOperationBatch"
     FOR DELETE USING (
       "companyId" = ANY (SELECT unnest(get_companies_with_employee_permission('production_delete')::text[]))
     );

   -- 5. Membership FK on jobOperation
   ALTER TABLE "jobOperation" ADD COLUMN IF NOT EXISTS "jobOperationBatchId" TEXT;
   DO $$ BEGIN
     ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"
       FOREIGN KEY ("jobOperationBatchId", "companyId")
       REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   CREATE INDEX IF NOT EXISTS "jobOperation_jobOperationBatchId_idx"
     ON "jobOperation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

   -- 6. Batch tag on productionEvent (timers while running; slices keep it)
   ALTER TABLE "productionEvent" ADD COLUMN IF NOT EXISTS "jobOperationBatchId" TEXT;
   DO $$ BEGIN
     ALTER TABLE "productionEvent" ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey"
       FOREIGN KEY ("jobOperationBatchId", "companyId")
       REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   CREATE INDEX IF NOT EXISTS "productionEvent_jobOperationBatchId_idx"
     ON "productionEvent" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

   -- 7. Sequence for readable ids (existing companies)
   INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
   SELECT 'jobOperationBatch', 'Operation Batch', 'BAT', NULL, 0, 6, 1, "id"
   FROM "company"
   ON CONFLICT DO NOTHING;

   -- 8. Re-declare get_active_job_operations_by_location from the NEWEST definition
   -- (feeds ERP schedule board AND MES kanban). DROP first, preserving the exact
   -- signature of the newest version.
   -- >>> paste DROP FUNCTION IF EXISTS get_active_job_operations_by_location(<newest arg types>);
   -- >>> paste the NEWEST definition verbatim, then make exactly these additions:
   --     * to RETURNS TABLE:  "processBatchable" BOOLEAN, "jobOperationBatchId" TEXT, "batchReadableId" TEXT
   --     * to the SELECT list: p."batchable" AS "processBatchable", jo."jobOperationBatchId", b."readableId" AS "batchReadableId"
   --     * add joins (if p is not already joined, add it):
   --         LEFT JOIN "process" p ON p."id" = jo."processId"
   --         LEFT JOIN "jobOperationBatch" b ON b."id" = jo."jobOperationBatchId" AND b."companyId" = jo."companyId"

   -- 9. Batch planning candidates RPC
   DROP FUNCTION IF EXISTS get_batchable_operations(TEXT, TEXT);
   CREATE OR REPLACE FUNCTION get_batchable_operations(location_id TEXT, process_id TEXT)
   RETURNS TABLE (
     "id" TEXT,
     "jobId" TEXT,
     "jobReadableId" TEXT,
     "jobDueDate" DATE,
     "jobStatus" "jobStatus",
     "itemReadableId" TEXT,
     "itemDescription" TEXT,
     "description" TEXT,
     "operationQuantity" NUMERIC,
     "status" "jobOperationStatus",
     "workCenterId" TEXT,
     "jobOperationBatchId" TEXT,
     "batchReadableId" TEXT,
     "batchStatus" "jobOperationBatchStatus",
     "batchWorkCenterId" TEXT,
     "companyId" TEXT,
     "materials" JSONB
   ) LANGUAGE sql STABLE AS $$
     SELECT
       jo."id",
       j."id" AS "jobId",
       j."jobId" AS "jobReadableId",
       j."dueDate" AS "jobDueDate",
       j."status" AS "jobStatus",
       i."readableId" AS "itemReadableId",
       i."name" AS "itemDescription",
       jo."description",
       jo."operationQuantity",
       jo."status",
       jo."workCenterId",
       jo."jobOperationBatchId",
       b."readableId" AS "batchReadableId",
       b."status" AS "batchStatus",
       b."workCenterId" AS "batchWorkCenterId",
       jo."companyId",
       COALESCE(mats."materials", '[]'::jsonb) AS "materials"
     FROM "jobOperation" jo
       JOIN "job" j ON j."id" = jo."jobId"
       JOIN "item" i ON i."id" = j."itemId"
       LEFT JOIN "jobOperationBatch" b
         ON b."id" = jo."jobOperationBatchId" AND b."companyId" = jo."companyId"
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'itemReadableId', mi."readableId",
           'description', jm."description",
           'quantity', jm."quantity",
           'formId', m."materialFormId",       'formName', mf."name",
           'substanceId', m."materialSubstanceId", 'substanceName', ms."name",
           'gradeId', m."gradeId",             'gradeName', mg."name",
           'dimensionId', m."dimensionId",     'dimensionName', md."name",
           'finishId', m."finishId",           'finishName', mfin."name"
         )) AS "materials"
         FROM "jobMaterial" jm
           JOIN "item" mi ON mi."id" = jm."itemId"
           LEFT JOIN "material" m ON m."id" = mi."readableId" AND m."companyId" = mi."companyId"
           LEFT JOIN "materialForm" mf ON mf."id" = m."materialFormId"
           LEFT JOIN "materialSubstance" ms ON ms."id" = m."materialSubstanceId"
           LEFT JOIN "materialGrade" mg ON mg."id" = m."gradeId"
           LEFT JOIN "materialDimension" md ON md."id" = m."dimensionId"
           LEFT JOIN "materialFinish" mfin ON mfin."id" = m."finishId"
         WHERE jm."jobOperationId" = jo."id"
       ) mats ON TRUE
     WHERE j."locationId" = location_id
       AND jo."processId" = process_id
       AND (
         (jo."jobOperationBatchId" IS NULL
           AND jo."status" IN ('Todo', 'Ready', 'Waiting'))
         OR b."status" = 'Active'
       );
   $$;
   ```
   Adjustments while writing:
   - Mirror the **job-status filter** and the exact item/job column expressions from the newest `get_active_job_operations_by_location` (e.g. if it uses `i."name"` vs another display expression for item description, and if it restricts `j."status"` to active jobs — copy that restriction into the candidates branch of the WHERE clause). If `job` has no `"jobStatus"` enum type name, use the type the newest RPC uses.
   - Mirror the newest RPC's `SECURITY` posture and any `GRANT EXECUTE` statements for `get_batchable_operations`.
   - If `jobOperation."operationQuantity"` does not exist as a column (check the newest RPC's select list for where `operationQuantity` comes from), source it exactly as that RPC does. **If it is computed rather than a column, STOP and report before improvising.**

4. Apply:
   ```bash
   pnpm db:migrate
   ```

**Verify:**
```bash
pnpm db:migrate
# Expected: applies cleanly, no ERROR lines

psql "$SUPABASE_DB_URL" -c 'SELECT "table","prefix","size" FROM "sequence" WHERE "table"=$$jobOperationBatch$$ LIMIT 3;'
# Expected: one row per company, prefix BAT, size 6

psql "$SUPABASE_DB_URL" -c '\d "jobOperationBatch"' | head -20
# Expected: columns id, readableId, companyId, processId, workCenterId, locationId, status...

psql "$SUPABASE_DB_URL" -c 'SELECT proname FROM pg_proc WHERE proname IN ($$get_batchable_operations$$,$$get_active_job_operations_by_location$$);'
# Expected: both names present
```

**Out of scope:** any change to `jobMaterial`, `jobMakeMethod`, `methodOperation`, `quoteOperation`, `itemReplenishment`, or the `issue` function's SQL. No `batchable` column anywhere except `process`.

---

## Task 2: Types regeneration decision

**Depends on:** Task 1
**Files:**
- Modify (maybe): `packages/database/src/types.ts` (+ swagger artifact) — commit or restore per ground rule 4

**Steps:**
1. ```bash
   git diff --stat packages/database/src/types.ts
   ```
2. Apply ground rule 4: additive/clean diff → keep and commit with the migration; mass deletions of unrelated cloud tables → `git restore` the generated artifacts and adopt the cast idiom in all app code for: table `jobOperationBatch`, RPC `get_batchable_operations`, and new columns `process.batchable`, `jobOperation.jobOperationBatchId`, `productionEvent.jobOperationBatchId`, plus the three new RPC output columns.
3. Record which path was taken in the commit message body.

**Verify:**
```bash
git status --short packages/database/src/
# Expected: either staged intentional changes, or clean (restored)
```

**Out of scope:** hand-editing generated types (never allowed).

---

## Task 3: Seed new-company sequence

**Depends on:** Task 1
**Files:**
- Modify: the sequences seed module imported by `packages/database/supabase/functions/seed-company/index.ts` (follow the `import` at the top of that file — **[VERIFIED]** the sequences array lives in a `seed`-named module; open `seed-company/index.ts:1-30` and jump to the definition)

**Steps:**
1. Confirm the `BAT` prefix is unused:
   ```bash
   grep -rn "'BAT'\|\"BAT\"" packages/database/supabase/functions/ packages/database/supabase/migrations/ | grep -iv batch
   ```
   If any OTHER sequence already uses prefix `BAT`, STOP and report — propose `BTH` and update the Task 1 migration + spec before continuing.
2. Add to the sequences array, matching the neighbors' exact literal shape:
   ```typescript
   { table: "jobOperationBatch", name: "Operation Batch", prefix: "BAT", next: 0, size: 6, step: 1 }
   ```
   (Include `suffix: null` only if neighbor entries carry it.)

**Verify:**
```bash
grep -n "jobOperationBatch" packages/database/supabase/functions/**/*.ts | head
# Expected: one hit in the sequences seed module
deno check packages/database/supabase/functions/seed-company/index.ts 2>&1 | tail -3
# Expected: no errors (or only pre-existing lib warnings shared by sibling functions)
```

**Out of scope:** other seed data.

---

## Task 4: Process form + table (resources module)

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/resources/resources.models.ts` — `processValidator` (~line 288-316)
- Modify: `apps/erp/app/modules/resources/ui/Processes/ProcessForm.tsx` — add Boolean field
- Modify: the processes list table component under `apps/erp/app/modules/resources/ui/Processes/` — add a Batchable column
- Copy from (precedent): the `completeAllOnScan` handling in the SAME three files (**[VERIFIED]** validator has `completeAllOnScan: zfd.checkbox()`; form renders it as a `Boolean` at ProcessForm.tsx:155-159)

**Steps:**
1. `processValidator`: add `batchable: zfd.checkbox()` directly after `completeAllOnScan`.
2. `upsertProcess` (`resources.service.ts:1633-1681`): its parameter type derives from the validator and the body passes the object through — read it; if it enumerates columns, add `batchable`; if it spreads, no change. State the finding in the commit message.
3. `ProcessForm.tsx`: clone the `completeAllOnScan` `<Boolean>` block; new field:
   - `name="batchable"`
   - label: `Batchable`
   - description: `Multiple jobs can run on this process at the same time — e.g. a laser table, furnace, or plating bath`
   - Match the file's existing Lingui convention (wrap with `t`/`<Trans>` only if the sibling fields are wrapped).
   - Also add `batchable` to the form's `initialValues`/`defaultValues` object exactly where `completeAllOnScan` appears (use the cast idiom for the row read if Task 2 chose casts).
4. Processes table: find the column definitions (grep `completeAllOnScan\|columnHelper\|accessorKey` in `ui/Processes/`); add a `Batchable` boolean column rendering the same way an existing boolean column in that table renders (checkbox icon / badge). If the table has NO boolean column precedent, copy the boolean-cell rendering from any table that shows `active` flags (grep `Enumerable\|LuCheck` in a sibling table) and note the file used.
5. Check the create/edit routes `apps/erp/app/routes/x+/resources+/processes.new.tsx` and `processes.$processId.tsx`: if the action enumerates fields from the validated payload, add `batchable`; if it spreads, no change.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 (or the same pre-existing errors as on main — diff against a main run if unsure)
```

**Out of scope:** `defaultStandardFactor`, `processType`, work-center assignment logic.

---

## Task 5: Production validators

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/production/production.models.ts`
- Modify: `apps/mes/app/services/models.ts`
- Copy from (precedent): existing status consts + validators in the same files (e.g. `productionEventValidator` in MES models.ts ~137-155)

**Steps:**
1. In `production.models.ts`, near the other status consts, add exactly:
   ```typescript
   export const jobOperationBatchStatus = [
     "Active",
     "Completed",
     "Cancelled"
   ] as const;

   export const createJobOperationBatchValidator = z.object({
     locationId: z.string().min(1, { message: "Location is required" }),
     workCenterId: zfd.text(z.string().optional()),
     jobOperationIds: z
       .array(z.string().min(1))
       .min(1, { message: "Select at least one operation" })
   });

   export const updateJobOperationBatchValidator = z.object({
     batchId: z.string().min(1, { message: "Batch is required" }),
     intent: z.enum(["add", "remove", "dissolve", "update"]),
     jobOperationIds: z.array(z.string().min(1)).optional(),
     workCenterId: zfd.text(z.string().optional())
   });
   ```
   **No maximum size anywhere** (user directive).
2. In `apps/mes/app/services/models.ts`, add:
   ```typescript
   export const completeJobOperationBatchValidator = z.object({
     batchId: z.string().min(1, { message: "Batch is required" }),
     members: z
       .array(
         z.object({
           jobOperationId: z.string().min(1),
           quantity: zfd.numeric(z.number().int().min(0)),
           scrapQuantity: zfd.numeric(z.number().int().min(0).optional())
         })
       )
       .min(1)
   });
   ```
   (`quantity` is `.int()` — `productionQuantity.quantity` is INTEGER **[VERIFIED]**.) If MES models.ts lacks a `zfd` import, add it matching the file's import style.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0 for both
```

**Out of scope:** touching `methodOperationValidator`, `quoteOperationValidator`, or `itemManufacturingValidator` — the old design's flags are GONE, nothing propagates.

---

## Task 6: `batch-operations` edge function

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/functions/batch-operations/index.ts` (via `pnpm db:function:new batch-operations`)
- Modify: `packages/database/supabase/config.toml` — register the function
- Copy from (precedent): `packages/database/supabase/functions/trigger-rework/index.ts` (imports/skeleton), `.ai/rules/workflow-edge-function.md`

**Steps:**
1. ```bash
   pnpm db:function:new batch-operations
   ```
2. `config.toml` — add, matching neighbor formatting:
   ```toml
   [functions.batch-operations]
   enabled = true
   verify_jwt = true
   ```
3. Write `index.ts` — complete contents (adjust only the std version if neighbors use a different one):

   ```typescript
   import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
   import z from "npm:zod@^3.24.1";
   import { getConnectionPool, getDatabaseClient } from "../lib/database.ts";
   import { corsHeaders } from "../lib/headers.ts";
   import { requirePermissions } from "../lib/supabase.ts";
   import type { DB } from "../lib/types.ts";
   import { getNextSequence } from "../shared/get-next-sequence.ts";

   const pool = getConnectionPool(1);
   const db = getDatabaseClient<DB>(pool);

   const NOT_STARTED = ["Todo", "Ready", "Waiting"];

   const payloadValidator = z.discriminatedUnion("type", [
     z.object({
       type: z.literal("create"),
       jobOperationIds: z.array(z.string()).min(1),
       locationId: z.string(),
       workCenterId: z.string().optional().nullable(),
       companyId: z.string(),
       userId: z.string()
     }),
     z.object({
       type: z.literal("add"),
       batchId: z.string(),
       jobOperationIds: z.array(z.string()).min(1),
       companyId: z.string(),
       userId: z.string()
     }),
     z.object({
       type: z.literal("remove"),
       batchId: z.string(),
       jobOperationIds: z.array(z.string()).min(1),
       companyId: z.string(),
       userId: z.string()
     }),
     z.object({
       type: z.literal("update"),
       batchId: z.string(),
       workCenterId: z.string().nullable(),
       companyId: z.string(),
       userId: z.string()
     }),
     z.object({
       type: z.literal("dissolve"),
       batchId: z.string(),
       companyId: z.string(),
       userId: z.string()
     }),
     z.object({
       type: z.literal("complete"),
       batchId: z.string(),
       members: z
         .array(
           z.object({
             jobOperationId: z.string(),
             quantity: z.number().int().min(0),
             scrapQuantity: z.number().int().min(0).optional()
           })
         )
         .min(1),
       companyId: z.string(),
       userId: z.string()
     })
   ]);

   /** Integer shares proportional to weights, summing exactly to total (largest remainder). */
   function proportionalShares(total: number, weights: number[]): number[] {
     const sum = weights.reduce((a, b) => a + b, 0);
     const effective = sum > 0 ? weights : weights.map(() => 1);
     const effectiveSum = sum > 0 ? sum : weights.length;
     const raw = effective.map((w) => (total * w) / effectiveSum);
     const floors = raw.map(Math.floor);
     let remainder = total - floors.reduce((a, b) => a + b, 0);
     const order = raw
       .map((r, i) => ({ frac: r - Math.floor(r), i }))
       .sort((a, b) => b.frac - a.frac);
     const result = [...floors];
     for (const { i } of order) {
       if (remainder <= 0) break;
       result[i] += 1;
       remainder -= 1;
     }
     return result;
   }

   // deno-lint-ignore no-explicit-any
   async function assertEligible(trx: any, companyId: string, jobOperationIds: string[], expectedProcessId?: string) {
     const operations = await trx
       .selectFrom("jobOperation")
       .selectAll()
       .where("id", "in", jobOperationIds)
       .where("companyId", "=", companyId)
       .execute();
     if (operations.length !== jobOperationIds.length) {
       throw new Error("One or more operations not found");
     }
     const processId = expectedProcessId ?? operations[0].processId;
     const process = await trx
       .selectFrom("process")
       .select(["id", "batchable"])
       .where("id", "=", processId)
       .executeTakeFirst();
     if (!process?.batchable) {
       throw new Error("The process is not batchable");
     }
     for (const op of operations) {
       if (op.processId !== processId) {
         throw new Error(`Operation ${op.id} is not on the batch's process`);
       }
       if (op.jobOperationBatchId) {
         throw new Error(`Operation ${op.id} is already in a batch`);
       }
       if (!NOT_STARTED.includes(op.status)) {
         throw new Error(`Operation ${op.id} has already started`);
       }
     }
     const events = await trx
       .selectFrom("productionEvent")
       .select("id")
       .where("jobOperationId", "in", jobOperationIds)
       .limit(1)
       .execute();
     if (events.length > 0) {
       throw new Error("Operations with recorded production events cannot be batched");
     }
     return { operations, processId };
   }

   serve(async (req: Request) => {
     if (req.method === "OPTIONS") {
       return new Response("ok", { headers: corsHeaders });
     }

     try {
       const payload = payloadValidator.parse(await req.json());
       const { companyId, userId } = payload;

       await requirePermissions(req, companyId, userId, {
         update: "production"
       });

       let result: Record<string, unknown> = {};

       switch (payload.type) {
         case "create": {
           result = await db.transaction().execute(async (trx) => {
             const { processId } = await assertEligible(trx, companyId, payload.jobOperationIds);
             const readableId = await getNextSequence(trx, "jobOperationBatch", companyId);
             const batch = await trx
               .insertInto("jobOperationBatch")
               .values({
                 readableId,
                 companyId,
                 processId,
                 workCenterId: payload.workCenterId ?? null,
                 locationId: payload.locationId,
                 status: "Active",
                 createdBy: userId
               })
               .returning(["id", "readableId"])
               .executeTakeFirstOrThrow();

             const memberUpdate: Record<string, unknown> = {
               jobOperationBatchId: batch.id,
               updatedBy: userId
             };
             if (payload.workCenterId) memberUpdate.workCenterId = payload.workCenterId;
             await trx
               .updateTable("jobOperation")
               .set(memberUpdate)
               .where("id", "in", payload.jobOperationIds)
               .execute();
             return batch;
           });
           break;
         }

         case "add": {
           result = await db.transaction().execute(async (trx) => {
             const batch = await trx
               .selectFrom("jobOperationBatch")
               .selectAll()
               .where("id", "=", payload.batchId)
               .where("companyId", "=", companyId)
               .executeTakeFirst();
             if (!batch) throw new Error("Batch not found");
             if (batch.status !== "Active") throw new Error("Batch is not active");

             const batchEvents = await trx
               .selectFrom("productionEvent")
               .select("id")
               .where("jobOperationBatchId", "=", payload.batchId)
               .limit(1)
               .execute();
             if (batchEvents.length > 0) {
               throw new Error("The batch has already started — complete it instead");
             }

             await assertEligible(trx, companyId, payload.jobOperationIds, batch.processId);

             const memberUpdate: Record<string, unknown> = {
               jobOperationBatchId: batch.id,
               updatedBy: userId
             };
             if (batch.workCenterId) memberUpdate.workCenterId = batch.workCenterId;
             await trx
               .updateTable("jobOperation")
               .set(memberUpdate)
               .where("id", "in", payload.jobOperationIds)
               .execute();
             return { added: payload.jobOperationIds.length };
           });
           break;
         }

         case "remove": {
           result = await db.transaction().execute(async (trx) => {
             const batchEvents = await trx
               .selectFrom("productionEvent")
               .select("id")
               .where("jobOperationBatchId", "=", payload.batchId)
               .limit(1)
               .execute();
             if (batchEvents.length > 0) {
               throw new Error(
                 "Cannot remove operations: production has been recorded. Complete the batch instead."
               );
             }
             await trx
               .updateTable("jobOperation")
               .set({ jobOperationBatchId: null, updatedBy: userId })
               .where("id", "in", payload.jobOperationIds)
               .where("jobOperationBatchId", "=", payload.batchId)
               .execute();

             const remaining = await trx
               .selectFrom("jobOperation")
               .select("id")
               .where("jobOperationBatchId", "=", payload.batchId)
               .limit(1)
               .execute();
             if (remaining.length === 0) {
               await trx
                 .deleteFrom("jobOperationBatch")
                 .where("id", "=", payload.batchId)
                 .where("companyId", "=", companyId)
                 .execute();
               return { removed: payload.jobOperationIds.length, dissolved: true };
             }
             return { removed: payload.jobOperationIds.length, dissolved: false };
           });
           break;
         }

         case "update": {
           result = await db.transaction().execute(async (trx) => {
             await trx
               .updateTable("jobOperationBatch")
               .set({
                 workCenterId: payload.workCenterId,
                 updatedBy: userId,
                 updatedAt: new Date().toISOString()
               })
               .where("id", "=", payload.batchId)
               .where("companyId", "=", companyId)
               .execute();
             if (payload.workCenterId) {
               await trx
                 .updateTable("jobOperation")
                 .set({ workCenterId: payload.workCenterId, updatedBy: userId })
                 .where("jobOperationBatchId", "=", payload.batchId)
                 .execute();
             }
             return { updated: true };
           });
           break;
         }

         case "dissolve": {
           result = await db.transaction().execute(async (trx) => {
             const batchEvents = await trx
               .selectFrom("productionEvent")
               .select("id")
               .where("jobOperationBatchId", "=", payload.batchId)
               .limit(1)
               .execute();
             if (batchEvents.length > 0) {
               throw new Error(
                 "Cannot dissolve: production has been recorded. Complete the batch instead — member jobs then proceed independently."
               );
             }
             const members = await trx
               .updateTable("jobOperation")
               .set({ jobOperationBatchId: null, updatedBy: userId })
               .where("jobOperationBatchId", "=", payload.batchId)
               .returning("id")
               .execute();
             await trx
               .deleteFrom("jobOperationBatch")
               .where("id", "=", payload.batchId)
               .where("companyId", "=", companyId)
               .execute();
             return { dissolved: members.length };
           });
           break;
         }

         case "complete": {
           result = await db.transaction().execute(async (trx) => {
             const members = await trx
               .selectFrom("jobOperation")
               .selectAll()
               .where("jobOperationBatchId", "=", payload.batchId)
               .where("companyId", "=", companyId)
               .execute();
             if (members.length === 0) throw new Error("Batch not found or empty");
             if (members.some((m) => m.status === "Done")) {
               throw new Error("Batch already completed");
             }
             const inputById = new Map(
               payload.members.map((m) => [m.jobOperationId, m])
             );
             for (const m of members) {
               if (!inputById.has(m.id)) {
                 throw new Error(`Missing completion quantity for operation ${m.id}`);
               }
             }

             // 1. Close open batch timers
             await trx
               .updateTable("productionEvent")
               .set({ endTime: new Date().toISOString() })
               .where("jobOperationBatchId", "=", payload.batchId)
               .where("endTime", "is", null)
               .execute();

             // 2. Slice each batch event into per-member events, durations ∝ operationQuantity
             const weights = members.map((m) => Number(m.operationQuantity ?? 0));
             const events = await trx
               .selectFrom("productionEvent")
               .selectAll()
               .where("jobOperationBatchId", "=", payload.batchId)
               .execute();
             const eventIds: string[] = events.map((e) => e.id);

             for (const event of events) {
               const start = new Date(event.startTime).getTime();
               const end = new Date(event.endTime!).getTime();
               const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
               if (totalSeconds === 0 || members.length === 1) continue;

               const shares = proportionalShares(totalSeconds, weights);
               let cursor = start;
               for (let i = 0; i < members.length; i++) {
                 const sliceStart = new Date(cursor).toISOString();
                 cursor += shares[i] * 1000;
                 const sliceEnd = new Date(cursor).toISOString();
                 if (i === 0) {
                   await trx
                     .updateTable("productionEvent")
                     .set({
                       jobOperationId: members[0].id,
                       startTime: sliceStart,
                       endTime: sliceEnd
                     })
                     .where("id", "=", event.id)
                     .execute();
                 } else {
                   const inserted = await trx
                     .insertInto("productionEvent")
                     .values({
                       ...structuredClone({
                         type: event.type,
                         employeeId: event.employeeId,
                         workCenterId: event.workCenterId,
                         companyId: event.companyId,
                         createdBy: event.createdBy ?? userId,
                         jobOperationBatchId: event.jobOperationBatchId
                       }),
                       jobOperationId: members[i].id,
                       startTime: sliceStart,
                       endTime: sliceEnd
                     })
                     .returning("id")
                     .executeTakeFirstOrThrow();
                   eventIds.push(inserted.id);
                 }
               }
             }

             // 3. Per-member produced + scrap quantities
             const quantityRows = members.flatMap((m) => {
               const input = inputById.get(m.id)!;
               const rows: Record<string, unknown>[] = [];
               if (input.quantity > 0) {
                 rows.push({
                   jobOperationId: m.id,
                   type: "Production",
                   quantity: input.quantity,
                   companyId,
                   createdBy: userId
                 });
               }
               if ((input.scrapQuantity ?? 0) > 0) {
                 rows.push({
                   jobOperationId: m.id,
                   type: "Scrap",
                   quantity: input.scrapQuantity,
                   companyId,
                   createdBy: userId
                 });
               }
               return rows;
             });
             if (quantityRows.length > 0) {
               await trx.insertInto("productionQuantity").values(quantityRows).execute();
             }

             // 4. Multi-row Done. [VERIFIED] trg_event_sync_jobOperation is a
             // BEFORE/FOR EACH ROW trigger: each member's own downstream operation
             // is released independently. No cross-job edges exist or are needed.
             await trx
               .updateTable("jobOperation")
               .set({ status: "Done", updatedBy: userId })
               .where("jobOperationBatchId", "=", payload.batchId)
               .execute();

             await trx
               .updateTable("jobOperationBatch")
               .set({
                 status: "Completed",
                 updatedBy: userId,
                 updatedAt: new Date().toISOString()
               })
               .where("id", "=", payload.batchId)
               .where("companyId", "=", companyId)
               .execute();

             return {
               completed: members.length,
               memberIds: members.map((m) => m.id),
               eventIds
             };
           });
           break;
         }
       }

       return new Response(JSON.stringify({ success: true, ...result }), {
         headers: { ...corsHeaders, "Content-Type": "application/json" },
         status: 200
       });
     } catch (err) {
       console.error("Error in batch-operations:", err);
       return new Response(JSON.stringify({ error: (err as Error).message }), {
         headers: { ...corsHeaders, "Content-Type": "application/json" },
         status: 500
       });
     }
   });
   ```
4. Before `deno check`, open the created file and reconcile with reality:
   - If `productionEvent` has more NOT NULL columns than `{jobOperationId, type, startTime, companyId, createdBy}` (check `psql "$SUPABASE_DB_URL" -c '\d "productionEvent"'`), copy those columns from the source event in the slice insert. **If a NOT NULL column cannot be sensibly copied, STOP and report.**
   - Confirm `jobOperation.operationQuantity` exists (Task 1 step 3 already checked); if the column is named differently, use that name in the weights line.

> **GL posting note:** `complete` intentionally does NOT invoke `post-production-event`
> or `issue`. The MES caller (Task 11) replicates `finishJobOperation`'s pattern
> per member/event after this call succeeds — exactly as
> `apps/mes/app/services/operations.service.ts:148-189` does today.

**Verify:**
```bash
deno check packages/database/supabase/functions/batch-operations/index.ts 2>&1 | tail -5
# Expected: clean (or only lib warnings shared by sibling functions)
grep -n "batch-operations" packages/database/supabase/config.toml
# Expected: [functions.batch-operations] with enabled = true, verify_jwt = true
grep -rn "max\|MAX_" packages/database/supabase/functions/batch-operations/index.ts | grep -iv "Math.max"
# Expected: no group-size cap constants
```

**Out of scope:** modifying the `issue` or `post-production-event` functions; any Inngest event.

---

## Task 7: ERP services, paths, batching action route

**Depends on:** Tasks 5, 6
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — new functions near `triggerJobSchedule`
- Modify: `apps/erp/app/utils/path.ts` — new entries next to `scheduleOperation*` (~1718)
- Create: `apps/erp/app/routes/x+/schedule+/batching.update.tsx` — action-only route
- Copy from (precedent): `apps/erp/app/routes/x+/schedule+/operations.update.tsx` (action shape), existing `client.functions.invoke` wrappers in `production.service.ts`

**Steps:**
1. `path.ts`, after `scheduleOperationUpdate`:
   ```typescript
   scheduleBatching: `${x}/schedule/batching`,
   scheduleBatchingUpdate: `${x}/schedule/batching/update`,
   ```
2. `production.service.ts` additions (use the Task 2 cast idiom if types were restored):
   ```typescript
   export async function getJobOperationBatch(
     client: SupabaseClient<Database>,
     batchId: string,
     companyId: string
   ) {
     const batch = await client
       .from("jobOperationBatch")
       .select("*")
       .eq("id", batchId)
       .eq("companyId", companyId)
       .single();
     if (batch.error) return batch;
     const operations = await client
       .from("jobOperation")
       .select("*, job(id, jobId, itemId, quantity, dueDate, status)")
       .eq("jobOperationBatchId", batchId);
     return {
       data: { ...batch.data, operations: operations.data ?? [] },
       error: operations.error
     };
   }

   export async function getBatchableOperations(
     client: SupabaseClient<Database>,
     args: { locationId: string; processId: string }
   ) {
     return client.rpc("get_batchable_operations", {
       location_id: args.locationId,
       process_id: args.processId
     });
   }

   export async function getBatchableProcesses(
     client: SupabaseClient<Database>,
     companyId: string
   ) {
     return client
       .from("process")
       .select("id, name")
       .eq("companyId", companyId)
       .eq("batchable", true)
       .order("name");
   }

   export async function createJobOperationBatch(
     client: SupabaseClient<Database>,
     args: {
       jobOperationIds: string[];
       locationId: string;
       workCenterId?: string | null;
       companyId: string;
       userId: string;
     }
   ) {
     return client.functions.invoke("batch-operations", {
       body: { type: "create", ...args }
     });
   }

   export async function updateJobOperationBatch(
     client: SupabaseClient<Database>,
     args: {
       type: "add" | "remove" | "update" | "dissolve";
       batchId: string;
       jobOperationIds?: string[];
       workCenterId?: string | null;
       companyId: string;
       userId: string;
     }
   ) {
     const { type, ...rest } = args;
     return client.functions.invoke("batch-operations", {
       body: { type, ...rest }
     });
   }
   ```
3. `batching.update.tsx` — action-only route, standard pattern (`assertIsPost` → `requirePermissions(request, { update: "production" })` → branch on `formData.get("intent")`):
   - `intent === "create"`: validate `createJobOperationBatchValidator` (repeated `jobOperationIds` fields) → `createJobOperationBatch` → on error `return data({}, await flash(request, error(result.error, "Failed to create batch")))`; on success `return data(result.data, await flash(request, success("Batch created")))`.
   - `intent === "add" | "remove" | "update" | "dissolve"`: validate `updateJobOperationBatchValidator` → `updateJobOperationBatch` → same flash pattern with per-intent messages ("Added to batch" / "Removed from batch" / "Batch updated" / "Batch dissolved").
   - Return plain objects via `data(...)` — never `Response.json`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -n "scheduleBatching" apps/erp/app/utils/path.ts
# Expected: two entries
```

**Out of scope:** the board UI itself (Task 8); MES paths (Task 10).

---

## Task 8: Batch planning board UI

**Depends on:** Task 7
**Files:**
- Create: `apps/erp/app/routes/x+/schedule+/batching.tsx` — loader + page
- Create: `apps/erp/app/modules/production/ui/Schedule/Batching/BatchingBoard.tsx` (+ small `CandidateCard.tsx`, `BatchLane.tsx` in the same folder if the board file grows past ~400 lines)
- Copy from (precedent): `apps/erp/app/routes/x+/schedule+/operations.tsx` (loader: location handling, `?filter=key:operator:value` parsing, `SearchFilter`/`Filter`/`ActiveFilters` usage), `apps/erp/app/modules/production/ui/Schedule/Kanban/Kanban.tsx` (@dnd-kit DndContext/DragOverlay/sensors + fetcher submit with `navigate:false`), `.../Kanban/components/ItemCard.tsx` (card layout)

**Steps:**
1. **Loader** (`batching.tsx`):
   - `requirePermissions(request, { view: "production" })`.
   - Resolve `locationId` exactly as `operations.tsx` does (same search param + user-preference fallback).
   - `processId` from `?process=` search param; load the picker list via `getBatchableProcesses`. If no `processId` selected, render the page with only the process picker and an empty state ("Pick a batchable process to plan batches").
   - With a process selected: `getBatchableOperations(client, { locationId, processId })`. Partition rows: `candidates` (`jobOperationBatchId === null`) and `batches` (group the rest by `jobOperationBatchId`, carrying `batchReadableId`/`batchWorkCenterId`).
   - Parse material facet filters from URL params using the SAME `?filter=` grammar as `operations.tsx` (keys: `formId`, `substanceId`, `gradeId`, `dimensionId`, `finishId`, plus `search`). A candidate matches if ANY element of its `materials` array satisfies ALL active facets; `search` matches job/item readable ids and descriptions case-insensitively. Filter in the loader, after the RPC.
   - Facet options: derive each facet's options from the DISTINCT values present in the unfiltered candidates' `materials` arrays (id + name), so the planner only sees applicable choices.
   - Also load work centers for the process (mirror how `operations.tsx` loads work centers for its columns) for the lane work-center picker.
2. **Board** (`BatchingBoard.tsx`):
   - Two-pane layout: left = filter bar (`SearchFilter` + `Filter` + `ActiveFilters`, same components as `operations.tsx`) above a scrollable list of candidate cards; right = vertical stack of Active batch lanes + a dashed "New batch" drop zone.
   - Candidate card: job readableId, item readableId + description, operation quantity, due date, and material chips (`substanceName gradeName dimensionName formName` per material, deduped; show `No material properties` chip when the array is empty). Clone the visual structure of `Kanban/components/ItemCard.tsx` — do not design a new card from scratch.
   - Batch lane: header row with `readableId`, member count and summed quantity (plain numbers — never parenthesized counts), a work-center `Combobox` (options from the loader; on change POST `intent=update` with `workCenterId`), and a dissolve menu item; body lists member cards (same card component, draggable out).
   - DnD: one `DndContext` wrapping both panes, sensors/overlay cloned from `Kanban.tsx`. On drop: candidate → "New batch" posts `intent=create` (with `locationId`, the dragged op id); candidate → existing lane posts `intent=add`; member → candidate pane posts `intent=remove`. Submit with `useSubmit`/fetchers with `navigate: false` targeting `path.to.scheduleBatchingUpdate`, mirroring `Kanban.tsx`'s optimistic-update pattern (per-item `fetcherKey`); rely on default revalidation to refresh the loader.
   - Wire the route page: render pickers (Location + Process, matching `operations.tsx`'s selector components) above the board.
   - Match the file's surroundings for Lingui: `operations.tsx`-family components use unwrapped literals in places — match whichever convention the cloned files use; do not introduce a mixed style.
3. Add a navigation entry so the board is reachable: grep for where `path.to.scheduleOperation`/"Schedule" is registered in the production nav/menu config (`grep -rn "scheduleOperation" apps/erp/app/modules/production/ apps/erp/app/components/Layout/ --include="*.ts*" -l`) and add a sibling "Batching" entry pointing to `path.to.scheduleBatching`, cloning the existing entry's shape. **If no obvious nav registry exists, STOP and note it in the PR description instead of inventing one.**

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```
Browser check happens in Task 13.

**Out of scope:** capacity indicators, auto-suggested batches, nesting imports, editing operation quantities/dates from this board.

---

## Task 9: Schedule board badge + menu

**Depends on:** Task 7 (independent of Task 8)
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Schedule/Kanban/types.ts` — extend `operationItemValidator` (~line 97)
- Modify: `apps/erp/app/routes/x+/schedule+/operations.tsx` — thread new RPC fields in the loader mapping
- Modify: `apps/erp/app/modules/production/ui/Schedule/Kanban/components/ItemCard.tsx` — badge + menu items
- Copy from (precedent): the existing badge/menu rendering in the SAME ItemCard (menu ~181-220, badges ~299-311)

**Steps:**
1. `types.ts`: add to `operationItemValidator`: `processBatchable: z.boolean().optional()`, `jobOperationBatchId: z.string().nullable().optional()`, `batchReadableId: z.string().nullable().optional()`.
2. `operations.tsx` loader: where RPC rows map into items (`makeDurations(op)` region ~241), thread the three new RPC columns onto each item.
3. `ItemCard.tsx`:
   - Badge, next to the existing status/priority badges: when `item.jobOperationBatchId` is set, render `<Badge variant="secondary">{item.batchReadableId ?? "Batched"}</Badge>` (import `Badge` from `@carbon/react` if not present; match neighbors).
   - Menu, after the existing items: for `item.processBatchable && !item.jobOperationBatchId`, a "Batch planning" item that navigates to `` `${path.to.scheduleBatching}?process=${item.processId}` `` (use the file's existing navigation idiom); for `item.jobOperationBatchId`, a destructive "Remove from batch" item that posts `intent=remove` + `batchId` + `jobOperationIds[]=[item.id]` to `path.to.scheduleBatchingUpdate` via a fetcher (clone the prop-threading used by the existing menu callbacks ~198-212).
   - Icons: pick existing `react-icons/lu` icons — verify `LuLayers` and `LuUngroup` exist in the installed version (`grep -rn "LuLayers\|LuUngroup" apps/erp/app --include="*.tsx" | head`); fall back to icons already imported in this file.
4. MES reads the same RPC but its card changes are Task 10 — do not touch MES here.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** collapsing ERP board cards into one (ERP keeps one card per operation; only MES collapses — the ERP badge communicates membership).

---

## Task 10: MES kanban batch collapse

**Depends on:** Task 7
**Files:**
- Modify: `apps/mes/app/utils/path.ts` — batch paths
- Modify: `apps/mes/app/routes/x+/operations.tsx` — loader collapse (~52-236 mapping region)
- Modify: `apps/mes/app/components/Kanban/components/ItemCard.tsx` — batch card rendering
- Copy from (precedent): the SAME files' existing item mapping and card structure

**Steps:**
1. `apps/mes/app/utils/path.ts` (pattern near the operation paths):
   ```typescript
   batch: (id: string) => generatePath(`${x}/batch/${id}`),
   batchComplete: (id: string) => generatePath(`${x}/batch/${id}/complete`),
   ```
   (Match the file's actual `x`/generatePath idiom.)
2. `operations.tsx` loader: after mapping RPC rows, collapse rows sharing a non-null `jobOperationBatchId`: keep the first row per batch as the card item; attach `batchId`, `batchReadableId`, `batchSize` (member count), `batchTargetQuantity` (sum of member `targetQuantity`), and `batchMembers: [{ jobReadableId, itemReadableId, targetQuantity }]`. Non-batched rows pass through unchanged.
3. `ItemCard.tsx`: when `item.batchSize > 1`:
   - render the batch readableId and a `×{batchSize}` indicator next to the quantity heading (MES components are `size="lg"`),
   - show summed quantity,
   - link the card to `path.to.batch(item.batchId)` instead of the per-operation route (find where the card link/`Link` target is built and branch there).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
```

**Out of scope:** the batch view itself (Task 11); ERP board.

---

## Task 11: MES batch view + complete flow

**Depends on:** Tasks 6, 10
**Files:**
- Create: `apps/mes/app/routes/x+/batch.$batchId.tsx` — batch view (loader + page)
- Create: `apps/mes/app/routes/x+/batch.$batchId.complete.tsx` — action route
- Modify: `apps/mes/app/services/operations.service.ts` — `getJobOperationBatch` + optional batch tag on event creation
- Copy from (precedent): `apps/mes/app/routes/x+/start.$operationId.tsx` + `end.$operationId.tsx` (timer actions + `requirePermissions(request, {})` idiom), `apps/mes/app/routes/x+/complete.tsx` (per-op completion: `issue` invoke), `finishJobOperation` (`operations.service.ts:148-189`, GL loop)

**Steps:**
1. `operations.service.ts`: add `getJobOperationBatch(client, batchId, companyId)` — same two-query shape as the ERP version (Task 7 step 2), MES idiom (`getOpenJobs` at :24-37 is the style reference).
2. **Timer tagging:** read how `start.$operationId.tsx` creates a `productionEvent` (which service function inserts it). Extend that service function with an OPTIONAL `jobOperationBatchId` param (additive; default undefined → column null) and pass it only from the new batch routes. **If event creation happens inside an edge function rather than the MES service, STOP and report with the file/line you found — do not fork the flow.**
3. **Batch view route** `batch.$batchId.tsx`:
   - Loader: same `requirePermissions` idiom as `start.$operationId.tsx:20`; `getJobOperationBatch`; plus open/ended batch events (`productionEvent` where `jobOperationBatchId = batchId`) for timer display.
   - Page (MES sizing `size="lg"`): batch header (readableId, process name, work center, member count, summed quantity); member table: job readableId, item, operation quantity, due date, link to `path.to.operation(memberOpId)` for per-op flows (materials, scrap before completion); Start/Stop buttons posting to new nested actions that call the SAME start/end service functions as the per-op routes but with the first member's operation id + `jobOperationBatchId` (clone the action bodies of `start.$operationId.tsx` / `end.$operationId.tsx` into `batch.$batchId.tsx`'s action with intents, or as tiny sibling action routes — pick whichever mirrors the existing file layout most closely);
   - **Complete Batch** section: `ValidatedForm` with `completeJobOperationBatchValidator`; one row per member with a `Number` input pre-filled with the member's remaining quantity (operation quantity minus prior `quantityComplete` if the loader has it, else operation quantity) and an optional scrap `Number`; copy text: "Time and cost split across jobs proportionally to quantity."
4. **Complete action** `batch.$batchId.complete.tsx`:
   - `assertIsPost` → `requirePermissions` → validate → `serviceRole.functions.invoke("batch-operations", { body: { type: "complete", batchId, members, companyId, userId } })`; on error, flash + return.
   - Then replicate `complete.tsx`'s material issue per member: for each member with `quantity > 0`, `serviceRole.functions.invoke("issue", { body: { type: "jobOperation", id: member.jobOperationId, quantity: member.quantity, companyId, userId } })` — read `complete.tsx` first and mirror its EXACT body shape for the `jobOperation` case (field names may include extras); collect per-member errors and flash a combined warning if any fail (operations are already Done — same failure surface as today's per-op flow).
   - Then replicate the GL loop from `finishJobOperation:148-189`: select `productionEvent` rows where `id IN (returned eventIds)` (or `jobOperationBatchId = batchId`) with `endTime NOT NULL AND postedToGL = false`, and invoke `post-production-event` per event with the same body shape that file uses.
   - `throw redirect(path.to.operations)` with success flash (mirror `end.$operationId.tsx`'s redirect+flash shape).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
deno check packages/database/supabase/functions/batch-operations/index.ts 2>&1 | tail -3
# Expected: still clean
```

**Out of scope:** aggregate one-tap material issue beyond the per-member `issue` calls above; NCR/quality workflow changes; rework flows on batches (per-member ops remain real rows — existing flows apply).

---

## Task 12: Docs/AGENTS sync

**Depends on:** Tasks 1-11
**Files:**
- Modify: `apps/erp/app/modules/production/AGENTS.md` — data model row + service functions + concept line
- Modify: `apps/erp/app/modules/resources/AGENTS.md` (if it exists; check) — `process.batchable` mention
- Modify: `.ai/specs/2026-07-03-job-operation-batching.md` — changelog entry on implementation
- Copy from (precedent): existing table rows / concept lines in the same AGENTS.md files

**Steps:**
1. Production AGENTS.md: add `jobOperationBatch` to the data-model table ("Operation batch: N job operations on one batchable process run together; proportional time/cost split at completion; jobs never merged; BOM untouched"); add the new service functions to Key Service Functions; add a Key Domain Concepts bullet: "**Operation Batch** — jobs sharing one run on a batchable process (laser, furnace). Distinct from lot/batch tracking (`trackedEntity`/`batchNumber`)."
2. Resources AGENTS.md (if present): note `process.batchable` next to wherever `completeAllOnScan` is documented; skip silently if the file doesn't document process columns.
3. Spec changelog: add implementation entry; **ask Brad** before moving the spec to `implemented/`.
4. Comment on issue #1010 linking the PR and suggesting the title change to "Job Operation Batching" (do this in Task 14 alongside the PR).

**Verify:**
```bash
grep -n "jobOperationBatch" apps/erp/app/modules/production/AGENTS.md
# Expected: at least 2 hits (table + concept)
grep -rni "st[i]tch" apps/erp/app apps/mes/app packages/database/supabase --include="*.ts" --include="*.tsx" --include="*.sql" | grep -v node_modules
# Expected: no output (the superseded feature's terminology does not exist in shipped code)
```

**Out of scope:** reader-facing docs site pages (`docs/`) — flag in the PR body that a `carbon-docs` follow-up should document batching + add the glossary entry once the feature ships; do not block this PR on it.

---

## Task 13: Full verification gate

**Depends on:** Tasks 1-12
**Files:** none (verification only)

**Steps:**
1. ```bash
   pnpm exec turbo run typecheck --filter=erp && pnpm exec turbo run typecheck --filter=mes
   pnpm run lint
   pnpm run test
   ```
2. Browser e2e (mandatory for UI work). Boot with plain `crbn up` (portless `*.dev`), never `--no-portless`. If accounting-enabled behavior is checked (GL posting), first enable accounting at `/x/settings/accounting` (fresh resets seed it off). Then use the `/test` skill to drive:
   1. Resources → Processes → edit "Laser Cutting" (or any process) → check **Batchable** → save → reload → persisted; processes table shows the column.
   2. Create/verify 3 jobs whose routing uses that process (release them so operations exist and are Todo/Ready).
   3. Schedule → Batching → pick location + process → all 3 operations listed with material chips; apply a substance/grade/dimension filter and confirm narrowing (jobs with A36-steel BOM lines stay; others drop).
   4. Drag one op to "New batch" → `BAT000001` lane appears; drag the other two in; assign a work center → member ops' work centers update on the schedule board (badge `BAT000001` on each card).
   5. Drag one member out → it returns to candidates; drag it back in. Dissolve+recreate once to prove dissolve works.
   6. MES → one collapsed card ×3 → open batch view → Start → wait ~1 min → Stop → Complete with per-member quantities (e.g. 5/20/10, scrap 0/1/0) → success.
   7. Verify in DB or UI: per-member `productionEvent` slices whose durations are ~1/7, 4/7, 2/7 of the recorded minute (weights 5/20/10); `productionQuantity` rows 5/20/10 + one Scrap 1; all member ops Done; each job's next operation Ready; batch Completed; `itemLedger` rows from `issue` per member; GL entries per event if accounting enabled.
   8. Ungrouped operations elsewhere behave exactly as before (spot-check one normal op start/complete).
   9. Attempt to dissolve the completed batch's twin scenario: create a fresh 2-op batch, start it, then try dissolve → blocked with the "complete the batch instead" error.
   Screenshot the batching board (filters visible + a populated lane) and the MES batch view for the PR.

**Verify:** the commands above; all green, screenshots saved.

**Out of scope:** performance/load testing.

---

## Task 14: PR

**Depends on:** Task 13
**Files:** none

**Steps:**
1. **Ask Brad before pushing.** Then:
   ```bash
   git push -u origin feature/job-operation-batching
   gh pr create --title "feat(production): job operation batching — batchable processes, batch planning board, proportional completion" --body "$(cat <<'EOF'
   Tracking spec: .ai/specs/2026-07-03-job-operation-batching.md
   Research: .ai/research/job-operation-batching.md
   Closes #1010 (suggest retitling the issue to "Job Operation Batching")

   ## What
   - `process.batchable` flag — batchability is a property of the process (laser table: yes; brake press: no); job operations derive it via processId. No item/routing-step flags, no propagation.
   - `jobOperationBatch` (+ `jobOperation.jobOperationBatchId`, `productionEvent.jobOperationBatchId`, `BAT` sequence); RPC additions for both boards; new `get_batchable_operations` RPC with per-operation material properties from the BOM chain.
   - Batch planning board (`/x/schedule/batching`): filter unstarted operations by material form/substance/grade/dimension/finish, drag into batches, assign work centers. No batch size limit.
   - `batch-operations` edge function: create/add/remove/update/dissolve/complete with server-side eligibility (batchable process, same process, unstarted, unbatched).
   - Completion: per-member quantities + optional scrap; shared timers sliced into per-member productionEvents proportional to operation quantity (largest remainder), so job costing, estimates-vs-actuals, and GL post per job with zero special-casing; material issued per member job's own BOM via the existing issue function.
   - MES: collapsed batch card, batch view with timers, complete-batch flow with GL posting.
   - Operation batches are distinct from lot/batch tracking — documented in AGENTS.md.

   ## Verification
   - typecheck (erp, mes), lint, tests green
   - Browser e2e: flag → plan (filters + drag) → run → complete (5/20/10 split) → downstream release → guards
   - Screenshots: batching board, MES batch view

   ## Follow-ups (not in this PR)
   - carbon-docs page + glossary entry once shipped
   - v2: area/cut-time weights via nesting import; solver-suggested batches; capacity modeling
   EOF
   )"
   ```
2. Comment on issue #1010 linking the PR and the retitle suggestion.

**Out of scope:** merging; moving the spec to `implemented/` (ask first).

---

## Out of scope for the whole plan (do not build)

- Batch capacity semantics (table area, furnace volume) — separate future spec.
- Nesting-software import (per-part cut time/area weights) — v2.
- Auto-suggested batches in planning/MRP — v2.
- Batch-level NCR (per-operation NCR flow is unchanged and sufficient).
- ANY flag on items, method operations, or quote operations. Nothing propagates through `get-method`.
- Group size limits of any kind.

## Residual risks

| Watch for | Mitigation |
|-----------|------------|
| Generated-types divergence (cloud vs local) | Ground rule 4: inspect diff, restore + cast if wrong; note in commits |
| `get_active_job_operations_by_location` fork drift | Task 1 step 2 forces re-locating the NEWEST definition before forking; both boards smoke-tested in Task 13 |
| `productionEvent` NOT NULL columns beyond those cloned in slices | Task 6 step 5 checks `\d "productionEvent"` before deno check; STOP hatch |
| Event-creation flow living somewhere unexpected (edge fn vs MES service) | Task 11 step 2 STOP hatch |
| `issue`/`post-production-event` body shapes | Task 11 mirrors `complete.tsx` / `finishJobOperation` verbatim rather than trusting this plan's sketch |
| Filter grammar mismatch with `useFilters` | Task 8 parses with the same helpers `operations.tsx` uses — clone, don't reimplement |
