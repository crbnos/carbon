# Scheduled Maintenance: Expected Duration + Takes-Work-Center-Offline — implementation plan

**Spec:** .ai/specs/2026-08-17-scheduled-maintenance-duration-downtime.md
**Research:** .ai/research/scheduled-maintenance-duration-downtime.md
**Branch:** naveen/capacity-planning

## Summary

Add `takesWorkCenterOffline BOOLEAN NOT NULL DEFAULT false` to `maintenanceSchedule`,
recreate the `maintenanceSchedules` view and `get_maintenance_schedules_by_location`
RPC to expose it, couple it to `estimatedDuration` in the zod validator (duration
required iff offline), wire both fields into dispatch generation (set the generated
dispatch's `takesWorkCenterOffline` and compute `plannedEndTime = plannedStartTime +
estimatedDuration`), and surface the toggle on the schedule form + a badge in the
schedules table.

## Progress
- [x] Task 1: Migration — add column, recreate view + RPC, regenerate types
- [x] Task 2: Validator — add field + duration-required-iff-offline refinement
- [x] Task 3: Dispatch generator — copy flag + compute plannedEndTime
- [x] Task 4: Schedule form — offline toggle + route initialValues
- [x] Task 5: Schedules table — offline indicator column
- [x] Task 6: Verification — typecheck, tests, browser+DB e2e (all criteria proven)

## Dependencies
- Task 1 must run first (schema + types). Tasks 2–5 depend on Task 1's regenerated types.
- Task 2 must land before Task 4 (the form relies on the refined validator).
- Tasks 3, 4, 5 are otherwise independent of each other (different files) and may run in parallel after Tasks 1–2.
- Task 6 runs last.

## Constraints for the executor (autonomous run — user is asleep)
- **Do NOT reset or rebuild the database.** Applying ONE pending migration via `pnpm db:migrate` is allowed (it targets the local worktree DB). If the local DB is unreachable or `pnpm db:migrate` / `pnpm run generate:types` fails, **do not fake the type**: leave the migration file in place, record the failure in the run log, and continue with the code changes; the typecheck/e2e gates in Task 6 then become "blocked, pending user DB" rather than "passing". Never hand-edit `packages/database/src/types.ts`.
- **No merges.** Commit per task on the existing branch; the final artifact is a **draft** PR.

---

## Task 1: Migration — add column, recreate view + RPC, regenerate types

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_scheduled-maintenance-offline.sql` (via `pnpm db:migrate:new scheduled-maintenance-offline`)
- Modify (generated, via command): `packages/database/src/types.ts`
- Copy from (precedent): the `takesWorkCenterOffline` column add in `packages/database/supabase/migrations/20260720121629_capacity-planning.sql:152-155`; the view in `20260101163359_maintenance-security-definer-views.sql`; the RPC in `20251231003301_scheduled-maintenance-fix.sql`.

**Steps:**
1. Create the migration file:
   ```bash
   pnpm db:migrate:new scheduled-maintenance-offline
   ```
   (Randomized HHMMSS from the tool — never `000000`. Confirm the generated timestamp is newer than the latest file already in the migrations dir; if not, STOP and report.)
2. Write this SQL into the new file (idempotent guards; recreate view + RPC forked verbatim from their newest definitions, adding the new column):
   ```sql
   -- Add the production-impact / offline flag to the PM plan, mirroring
   -- maintenanceDispatch."takesWorkCenterOffline".
   ALTER TABLE "maintenanceSchedule"
     ADD COLUMN IF NOT EXISTS "takesWorkCenterOffline" BOOLEAN NOT NULL DEFAULT false;

   COMMENT ON COLUMN "maintenanceSchedule"."takesWorkCenterOffline" IS
     'When true, PM dispatches generated from this schedule are created with takesWorkCenterOffline = true and a bounded plannedEndTime (plannedStartTime + estimatedDuration), so the finite scheduler subtracts that window from the work center''s capacity. Requires estimatedDuration to be set.';

   -- Recreate the view so its expanded column list picks up the new column.
   -- (A view's "ms.*" is frozen to an explicit list at CREATE time.)
   -- Forked verbatim from 20260101163359_maintenance-security-definer-views.sql.
   DROP VIEW IF EXISTS "maintenanceSchedules";
   CREATE OR REPLACE VIEW "maintenanceSchedules"
   WITH (security_invoker = true) AS
   SELECT
     ms.*,
     wc."locationId",
     wc."name" AS "workCenterName",
     l."name" AS "locationName"
   FROM "maintenanceSchedule" ms
   LEFT JOIN "workCenter" wc ON ms."workCenterId" = wc."id"
   LEFT JOIN "location" l ON wc."locationId" = l."id";

   -- Recreate the by-location RPC, adding "takesWorkCenterOffline" to both the
   -- RETURNS TABLE and the SELECT. Forked verbatim from
   -- 20251231003301_scheduled-maintenance-fix.sql (only the new column added;
   -- pre-existing omissions of skipHolidays/procedureId left as-is — out of scope).
   DROP FUNCTION IF EXISTS get_maintenance_schedules_by_location(TEXT, TEXT);
   CREATE OR REPLACE FUNCTION get_maintenance_schedules_by_location(
     p_company_id TEXT,
     p_location_id TEXT
   )
   RETURNS TABLE (
     "id" TEXT,
     "name" TEXT,
     "description" TEXT,
     "workCenterId" TEXT,
     "frequency" "maintenanceFrequency",
     "priority" "maintenanceDispatchPriority",
     "estimatedDuration" INTEGER,
     "takesWorkCenterOffline" BOOLEAN,
     "active" BOOLEAN,
     "lastGeneratedAt" TIMESTAMP WITH TIME ZONE,
     "nextDueAt" TIMESTAMP WITH TIME ZONE,
     "companyId" TEXT,
     "createdBy" TEXT,
     "createdAt" TIMESTAMP WITH TIME ZONE,
     "updatedBy" TEXT,
     "updatedAt" TIMESTAMP WITH TIME ZONE,
     "monday" BOOLEAN,
     "tuesday" BOOLEAN,
     "wednesday" BOOLEAN,
     "thursday" BOOLEAN,
     "friday" BOOLEAN,
     "saturday" BOOLEAN,
     "sunday" BOOLEAN,
     "locationId" TEXT,
     "workCenterName" TEXT,
     "locationName" TEXT
   ) AS $$
   BEGIN
     RETURN QUERY
     SELECT
       ms."id",
       ms."name",
       ms."description",
       ms."workCenterId",
       ms."frequency",
       ms."priority",
       ms."estimatedDuration",
       ms."takesWorkCenterOffline",
       ms."active",
       ms."lastGeneratedAt",
       ms."nextDueAt",
       ms."companyId",
       ms."createdBy",
       ms."createdAt",
       ms."updatedBy",
       ms."updatedAt",
       ms."monday",
       ms."tuesday",
       ms."wednesday",
       ms."thursday",
       ms."friday",
       ms."saturday",
       ms."sunday",
       wc."locationId",
       wc."name" AS "workCenterName",
       l."name" AS "locationName"
     FROM "maintenanceSchedule" ms
     INNER JOIN "workCenter" wc ON ms."workCenterId" = wc."id"
     INNER JOIN "location" l ON wc."locationId" = l."id"
     WHERE ms."companyId" = p_company_id
       AND wc."locationId" = p_location_id;
   END;
   $$ LANGUAGE plpgsql SECURITY INVOKER;
   ```
   - If the live newest definition of either the view or the RPC differs from the fork above (a migration landed between planning and execution), STOP and report — re-fork from the actual newest definition rather than improvising.
3. Apply + regenerate types:
   ```bash
   pnpm db:migrate
   ```
   If that regen didn't run or you only want types: `pnpm run generate:types`. If the DB is unreachable, see the autonomous-run constraint (record blocked, continue with code tasks; do NOT edit types.ts by hand).

**Verify:**
```bash
grep -n "takesWorkCenterOffline" packages/database/src/types.ts | head
# Expected: at least one hit under the maintenanceSchedule Row/Insert/Update types
#           AND one under the maintenanceSchedules view + get_maintenance_schedules_by_location Returns.
# If the DB was unreachable and types could not regenerate: no hits — record BLOCKED (pending user DB), do not proceed to claim Task 1 done.
```

**Out of scope:** Do not add `oeeImpact` to the schedule. Do not backfill/fix the RPC's pre-existing missing `skipHolidays`/`procedureId` columns. Do not touch the dispatch table.

---

## Task 2: Validator — add field + duration-required-iff-offline refinement

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/resources/resources.models.ts` — extend `maintenanceScheduleValidator` (currently ~L232-255) with the new field and a refinement.

**Steps:**
1. Add `takesWorkCenterOffline: zfd.checkbox(),` to the `maintenanceScheduleValidator` object (place it next to `estimatedDuration` at ~L240).
2. Convert the schema to enforce the coupling. Change the export so it reads:
   ```typescript
   export const maintenanceScheduleValidator = z
     .object({
       // ...existing fields, now including:
       // estimatedDuration: zfd.numeric(z.number().optional()),
       // takesWorkCenterOffline: zfd.checkbox(),
       // ...
     })
     .superRefine((data, ctx) => {
       if (
         data.takesWorkCenterOffline &&
         (data.estimatedDuration === undefined ||
           data.estimatedDuration === null ||
           data.estimatedDuration <= 0)
       ) {
         ctx.addIssue({
           code: z.ZodIssueCode.custom,
           path: ["estimatedDuration"],
           message:
             "Estimated duration is required when the PM takes the work center offline"
         });
       }
     });
   ```
   Keep every existing field exactly as-is inside the `.object({...})`; only append the new field and chain `.superRefine`.
3. Confirm the module barrel already re-exports `maintenanceScheduleValidator` (it does via `resources.models` → `index.ts`); no barrel change needed.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: passes. (z.infer<typeof maintenanceScheduleValidator> now includes
#           takesWorkCenterOffline: boolean.)
# If Task 1 types are BLOCKED, expect a known error only on the missing column —
#   record it and move on; do not work around by casting.
```

**Out of scope:** `maintenanceDispatchValidator` (the dispatch already has the field). No service-function edit — `upsertMaintenanceSchedule` inserts/updates the whole validated object, so the new field flows automatically.

---

## Task 3: Dispatch generator — copy flag + compute plannedEndTime

**Depends on:** Task 1
**Files:**
- Modify: `packages/jobs/src/inngest/functions/scheduled/dispatch.ts` — extend the `MaintenanceSchedule` interface (L26-43) and the dispatch `insert` (L204-230).

**Steps:**
1. Add two fields to the `MaintenanceSchedule` interface (both schedule fetch sites already `select("*")` and cast `as MaintenanceSchedule`, so runtime data already carries them — this only widens the type):
   ```typescript
   interface MaintenanceSchedule {
     // ...existing fields...
     estimatedDuration: number | null;
     takesWorkCenterOffline: boolean;
   }
   ```
2. In `generateDispatchesForSchedule`, the dispatch start is computed from `targetDate` at noon UTC (L223-225). Refactor so the start `ZonedDateTime` is captured once and the end derived from it. Replace the current `plannedStartTime` line in the `.insert({...})` with:
   ```typescript
   // A scheduled PM is a due *date*, not a time. Anchor to noon UTC so it renders
   // as the intended day in every timezone.
   const plannedStart = targetDate.set({
     hour: 12,
     minute: 0,
     second: 0,
     millisecond: 0
   });
   // Give the dispatch a bounded expected window whenever the schedule declares a
   // duration (minutes). For an offline PM the scheduler subtracts this window;
   // for a non-offline PM it is just a self-describing "~N min" window.
   const plannedEnd =
     schedule.estimatedDuration && schedule.estimatedDuration > 0
       ? plannedStart.add({ minutes: schedule.estimatedDuration })
       : null;
   ```
   Then in the `.insert({...})` object set:
   ```typescript
   plannedStartTime: plannedStart.toAbsoluteString(),
   plannedEndTime: plannedEnd ? plannedEnd.toAbsoluteString() : null,
   takesWorkCenterOffline: schedule.takesWorkCenterOffline,
   ```
   Leave `oeeImpact: "Planned"`, `severity: "Preventive"`, `source: "Scheduled"`, and everything else unchanged. Use only `@internationalized/date` arithmetic (`.add({ minutes })`) — never a JS `Date` (`.claude/rules/date-handling.md`).
3. Do not change the two `.select("*")` fetch sites (they already return the new columns) or the nightly-cron fan-out.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: passes.
pnpm --filter @carbon/jobs test
# Expected: existing dispatch tests pass; if a test asserts the generated dispatch
#   insert shape, update it to include plannedEndTime/takesWorkCenterOffline.
```

**Out of scope:** the schedule's `nextDueAt` advancement logic, holiday/day-of-week gating, notifications.

---

## Task 4: Schedule form — offline toggle + route initialValues

**Depends on:** Tasks 1, 2
**Files:**
- Modify: `apps/erp/app/modules/resources/ui/MaintenanceSchedule/MaintenanceScheduleForm.tsx` — add the toggle.
- Modify: the new + edit route `initialValues` (find with the grep in step 3).
- Copy from (precedent): the existing `<Boolean name="active" ... bordered />` at `MaintenanceScheduleForm.tsx:212`; the dispatch form's offline field label in `apps/erp/app/modules/resources/ui/Maintenance/MaintenanceDispatchForm.tsx:227`.

**Steps:**
1. In `MaintenanceScheduleForm.tsx`, immediately after the `estimatedDuration` `<Number>` block (L197-202), add:
   ```tsx
   <Boolean
     name="takesWorkCenterOffline"
     label={t`Takes Work Center Offline`}
     description={t`Reserve the work center's capacity for this PM. Requires an estimated duration.`}
     bordered
   />
   ```
   (`Boolean` is already imported from `@carbon/form` at the top of the file.)
2. Find every place `initialValues` for this form is constructed:
   ```bash
   grep -rn "maintenanceScheduleValidator\|MaintenanceScheduleForm\|initialValues" apps/erp/app/routes/x+/resources+/scheduled-maintenance*.tsx
   ```
   In the **new** route, add `takesWorkCenterOffline: false` to the initialValues object. In the **edit** route (`scheduled-maintenance.$scheduleId.tsx`), add `takesWorkCenterOffline: schedule.takesWorkCenterOffline ?? false`. Match the surrounding field style (the object is typed by `z.infer<typeof maintenanceScheduleValidator>`).
3. If either route builds initialValues from a spread of the loaded schedule row (e.g. `...schedule`), the field flows automatically — in that case only the **new** route needs the explicit `false`. Confirm by reading the routes; do not add a duplicate key.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: passes; initialValues satisfies z.infer<typeof maintenanceScheduleValidator>
#   (which now requires takesWorkCenterOffline: boolean).
```

**Out of scope:** the daily day-of-week options block, procedure selector, MES (schedules are ERP-only).

---

## Task 5: Schedules table — offline indicator column

**Depends on:** Tasks 1
**Files:**
- Modify: `apps/erp/app/modules/resources/ui/MaintenanceSchedule/MaintenanceSchedulesTable.tsx` — add a column for the flag next to `estimatedDuration` (~L176-181).
- Copy from (precedent): the boolean/badge cell pattern already used in nearby resources tables (grep for `row.original` boolean cells in `apps/erp/app/modules/resources/ui`); the existing `estimatedDuration` column at `MaintenanceSchedulesTable.tsx:176`.

**Steps:**
1. Add a column definition after the `estimatedDuration` column:
   ```tsx
   {
     accessorKey: "takesWorkCenterOffline",
     header: t`Blocks Machine`,
     cell: ({ row }) =>
       row.original.takesWorkCenterOffline ? (
         <Badge variant="red">{t`Offline`}</Badge>
       ) : (
         <Badge variant="secondary">{t`No`}</Badge>
       )
   }
   ```
   Use whatever `Badge` (from `@carbon/react`) or `Checkbox`/`Enumerable` cell the neighboring resources tables already use — match precedent rather than inventing a style. If a simple boolean cell is the local convention, use that instead.
2. Ensure the row type for the table includes `takesWorkCenterOffline` (it derives from the `maintenanceSchedules` view / `getMaintenanceSchedules` return via `Awaited<ReturnType<...>>`; after Task 1's regen it is present).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: passes; the new accessorKey resolves on the row type.
```

**Out of scope:** CSV export tuning, sorting/filtering on the new column (default behavior is fine).

---

## Task 6: Verification — typecheck, tests, browser e2e

**Depends on:** Tasks 1-5
**Files:** none (verification only)

**Steps:**
1. Scoped typechecks + tests:
   ```bash
   pnpm exec turbo run typecheck --filter=@carbon/erp
   pnpm exec turbo run typecheck --filter=@carbon/jobs
   pnpm --filter @carbon/erp test -- --testPathPattern=resources
   pnpm --filter @carbon/jobs test
   ```
   All must pass. If Task 1 was BLOCKED (DB unreachable), the erp/jobs typechecks will fail only on the missing generated column — record this precisely as "blocked pending `pnpm db:migrate` + `generate:types` on the user's stack", not as a code defect.
2. Browser e2e via `/test` (per `feedback_ui_e2e_verification`): boot the stack (`crbn up`) if not running, `/auth`, then:
   - Create a scheduled maintenance with **Takes Work Center Offline ON and Estimated Duration blank** → expect a validation error on the duration field; set a duration → saves.
   - Create one with the flag **OFF** and no duration → saves.
   - Confirm the schedules table shows the "Blocks Machine" indicator.
   - If a generated dispatch can be triggered/observed (fire `carbon/generate-maintenance` for the schedule, or inspect the created dispatch), confirm `plannedEndTime = plannedStartTime + duration` and `takesWorkCenterOffline = true` on the dispatch.
   - If the stack cannot boot, the e2e is **blocked, not done** — capture the blocker; do not claim the UI verified.
3. Update the spec: set Status to `in-progress` (or `implemented` only once e2e passes), add a changelog line noting what was verified vs blocked.

**Verify:** all commands above green; e2e screenshots captured, OR blockers recorded explicitly in the run log.

**Out of scope:** deploying, merging, moving the spec to `implemented/` (leave that for the user after review).
