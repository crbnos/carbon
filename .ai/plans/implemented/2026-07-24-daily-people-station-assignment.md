# Daily People / Station Assignment (People Board) — implementation plan

**Spec:** `.ai/specs/2026-07-24-daily-people-station-assignment.md`
**Research:** `.ai/research/daily-people-station-assignment.md`
**Branch:** `naveen/capacity-planning`

## Progress

- [x] Task 1: Create the `people-assignments` migration
- [x] Task 2: Apply migration + regenerate types
- [x] Task 3: Add people validators to `production.models.ts`
- [x] Task 4: Add `kind: "people"` to the schedule-inputs-changed event pipeline
- [x] Task 5: Add people service functions to `production.service.ts`
- [x] Task 6: Register the People view (paths + navigation)
- [x] Task 7: Build the People board route + UI
- [x] Task 8: MES assigned-station default + chip
- [x] Task 9: Engine — MasterDataProvider people reads
- [x] Task 10: Engine — pure `people-utils.ts` + deno tests
- [x] Task 11: Engine — buildFiniteContext + context extension
- [x] Task 12: Engine — selector two-pass, manned assigned stations, placement note
- [x] Task 13: i18n extract + translate — extract done; `pnpm run translate` FAILED (linguito can't reach its LLM endpoint: "Failed to parse URL from /tags"); non-en msgstr for the new strings are empty
- [x] Task 14: Docs sync (AGENTS.md, scheduling rule, spec changelog)
- [ ] Task 15: Browser verification (`/test` — requires user permission; not yet run)

## Dependencies

- Task 2 needs 1. Task 3 needs 2. Task 5 needs 3 + 4. Task 7 needs 5 + 6.
- Task 8 needs 2 (generated types) only — independent of Tasks 5–7.
- Task 9 needs 2. Task 11 needs 9 + 10. Task 12 needs 11.
- Tasks 4, 6, 10 are independent of everything except each other and can run early/parallel.
- Parallel lanes after Task 3: {4→5→7 ERP}, {8 MES}, {9/10→11→12 engine}.
- Task 13 needs 7 + 8. Task 14 needs 12. Task 15 last.

---

## Task 1: Create the `people-assignments` migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_people-assignments.sql` (via `pnpm db:migrate:new people-assignments` — never hand-pick the timestamp; HHMMSS must not be `000000`)
- Copy from (precedent): the newest migration touching production tables — `packages/database/supabase/migrations/20260720121629_capacity-planning.sql` (copy its exact RLS policy syntax and helper-cast form)

**Steps:**
1. Run `pnpm db:migrate:new people-assignments`.
2. Write this SQL (adjust only RLS policy syntax to byte-match the precedent file's form):

```sql
-- Planned person→station per date (the manning-board row)
CREATE TABLE IF NOT EXISTS "peopleAssignment" (
    "id" TEXT NOT NULL DEFAULT id('people'),
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL REFERENCES "location"("id") ON DELETE CASCADE,
    "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
    "date" DATE NOT NULL,
    -- null = whole day (single-shift shops never set it)
    "shiftId" TEXT REFERENCES "shift"("id") ON DELETE SET NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
-- One magnet per person per day/shift (drag = move)
CREATE UNIQUE INDEX IF NOT EXISTS "peopleAssignment_person_day_key"
    ON "peopleAssignment" ("companyId", "employeeId", "date", COALESCE("shiftId", ''));
CREATE INDEX IF NOT EXISTS "peopleAssignment_board_idx"
    ON "peopleAssignment" ("companyId", "locationId", "date");
CREATE INDEX IF NOT EXISTS "peopleAssignment_workCenter_idx"
    ON "peopleAssignment" ("workCenterId", "date");
CREATE INDEX IF NOT EXISTS "peopleAssignment_locationId_idx" ON "peopleAssignment" ("locationId");
CREATE INDEX IF NOT EXISTS "peopleAssignment_employeeId_idx" ON "peopleAssignment" ("employeeId");
CREATE INDEX IF NOT EXISTS "peopleAssignment_shiftId_idx" ON "peopleAssignment" ("shiftId");
CREATE INDEX IF NOT EXISTS "peopleAssignment_createdBy_idx" ON "peopleAssignment" ("createdBy");

-- Person is out for the date (person-level, not station-bound)
CREATE TABLE IF NOT EXISTS "peopleAbsence" (
    "id" TEXT NOT NULL DEFAULT id('crab'),
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
    "date" DATE NOT NULL,
    "shiftId" TEXT REFERENCES "shift"("id") ON DELETE SET NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "peopleAbsence_person_day_key"
    ON "peopleAbsence" ("companyId", "employeeId", "date", COALESCE("shiftId", ''));
CREATE INDEX IF NOT EXISTS "peopleAbsence_companyId_date_idx" ON "peopleAbsence" ("companyId", "date");
CREATE INDEX IF NOT EXISTS "peopleAbsence_employeeId_idx" ON "peopleAbsence" ("employeeId");
CREATE INDEX IF NOT EXISTS "peopleAbsence_shiftId_idx" ON "peopleAbsence" ("shiftId");
CREATE INDEX IF NOT EXISTS "peopleAbsence_createdBy_idx" ON "peopleAbsence" ("createdBy");
```

3. Enable RLS on both tables and create exactly four policies each, named `SELECT` / `INSERT` / `UPDATE` / `DELETE`, schema-qualified (`"public"."peopleAssignment"`), copying the exact `USING`/`WITH CHECK` expression syntax (including the `::text[]` cast) from the precedent migration:
   - `SELECT` → `get_companies_with_employee_role()` (operators must read their own assignment).
   - `INSERT` → `get_companies_with_employee_permission('production_create')`.
   - `UPDATE` → `get_companies_with_employee_permission('production_update')`.
   - `DELETE` → `get_companies_with_employee_permission('production_delete')`.

**Verify:**
```bash
ls packages/database/supabase/migrations/ | tail -3
# Expected: the new <timestamp>_people-assignments.sql is the NEWEST file (timestamp greater than every existing migration)
grep -c "CREATE POLICY" packages/database/supabase/migrations/*_people-assignments.sql
# Expected: 8
```

**Out of scope:** no changes to `capacityReservation`, `employeeJob`, or any existing table; no seed data; no data inserts of any kind.

---

## Task 2: Apply migration + regenerate types

**Depends on:** Task 1
**Files:**
- Modify (generated): `packages/database/src/types.ts` — via tooling only, never by hand

**Steps:**
1. Run `pnpm db:migrate` (applies pending migrations to the local DB and regenerates types + swagger). If it reports DB unreachable, STOP and report — do not rebuild the database.
2. If types did not regenerate (no diff), run `pnpm run generate:types`.

**Verify:**
```bash
grep -c "peopleAssignment\|peopleAbsence" packages/database/src/types.ts
# Expected: > 0 (both table types present)
git diff --stat packages/database/src/types.ts
# Expected: non-empty diff containing peopleAssignment/peopleAbsence additions only
```

**Out of scope:** hand-editing `types.ts`; rebuilding/reseeding the DB.

---

## Task 3: Add people validators to `production.models.ts`

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/production/production.models.ts` — append validators
- Copy from (precedent): existing validators in the same file (zod + `zfd` style per `.claude/rules/conventions-forms.md`)

**Steps:**
1. Add:

```typescript
export const peopleAssignmentValidator = z.object({
  id: zfd.text(z.string().optional()),
  workCenterId: z.string().min(1, { message: "Work center is required" }),
  employeeId: z.string().min(1, { message: "Employee is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  date: z.string().min(1, { message: "Date is required" }), // YYYY-MM-DD
  shiftId: zfd.text(z.string().optional()),
  note: zfd.text(z.string().optional())
});

export const peopleAbsenceValidator = z.object({
  id: zfd.text(z.string().optional()),
  employeeId: z.string().min(1, { message: "Employee is required" }),
  date: z.string().min(1, { message: "Date is required" }),
  shiftId: zfd.text(z.string().optional()),
  note: zfd.text(z.string().optional())
});

export const copyPeopleBoardValidator = z.object({
  locationId: z.string().min(1),
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  shiftId: zfd.text(z.string().optional())
});
```

2. Confirm the module barrel `apps/erp/app/modules/production/index.ts` re-exports `production.models.ts` (it already does via `export *`; only touch it if the models file is not covered).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 (no new errors)
```

**Out of scope:** service functions (Task 5); any UI.

---

## Task 4: Add `kind: "people"` to the schedule-inputs-changed event pipeline

**Depends on:** none (can run in parallel with Tasks 1–3)
**Files:**
- Modify: `packages/lib/src/events.ts` — lines ~259–279, add `"people"` to the `kind` union of `carbon/schedule.inputs.changed`
- Modify: `packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts` — zod enum at lines ~28–35 + scoping branch in the `compute-affected-jobs` step (~96–155)
- Modify: `apps/erp/app/modules/production/production.service.ts` — `notifyScheduleInputsChanged` kind union at lines ~3894–3900

**Steps:**
1. `packages/lib/src/events.ts`: extend the union to `"ability" | "shift" | "employee-shift" | "work-center" | "location" | "reorder" | "people"`. For `"people"`, `entityId` is the `workCenterId` (same semantics as `"work-center"`).
2. `schedule-inputs-changed.ts`:
   - Add `"people"` to the zod enum in `scheduleInputsChangedData`.
   - In `compute-affected-jobs`: when `kind === "people" && entityId`, scope exactly like the existing `work-center` branch (filter `jobOperation` by `.eq("workCenterId", entityId)`) — extend the existing condition at line ~117 to `(kind === "work-center" || kind === "people") && entityId` rather than duplicating the branch.
   - When `kind === "people"` WITHOUT `entityId` (an absence for an unassigned person), scope like the gated kinds: add `"people"` to the `["ability", "shift", "employee-shift"]` no-entityId fallback list (~lines 108–115) so affected jobs = jobs with unfinished ops on `requiresAbility` processes. Do NOT let it fall through to the company-wide `work-center`-without-id warning path.
3. `production.service.ts`: add `"people"` to `notifyScheduleInputsChanged`'s `kind` parameter union. No body change.
4. The wave function (`scheduleReplanWaveFunction`) is kind-agnostic — do not touch it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib --filter=@carbon/jobs --filter=erp
# Expected: exit 0
grep -n '"people"' packages/lib/src/events.ts packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts
# Expected: at least one hit in each file
```

**Out of scope:** `nightly-replan.ts`; the wave/debounce logic; any new event name (this extends the existing event only).

---

## Task 5: Add people service functions to `production.service.ts`

**Depends on:** Tasks 3, 4
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — append functions
- Copy from (precedent): service shape per `.claude/rules/conventions-services.md`; Kysely-transaction precedent `updateEmployeeJob` in `apps/erp/app/modules/people/people.service.ts` (takes `db: Kysely<KyselyDatabase>`); employees-at-location read precedent `getScheduledEmployeesToday` in `people.service.ts:783`

**Steps:**
1. Reads (supabase client-first, return raw `{data, error}`, always `.eq("companyId", companyId)`):

```typescript
export async function getPeopleAssignments(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { locationId: string; date: string; shiftId?: string | null }
) {
  let query = client
    .from("peopleAssignment")
    .select("id, workCenterId, employeeId, shiftId, note, date")
    .eq("companyId", companyId)
    .eq("locationId", args.locationId)
    .eq("date", args.date);
  if (args.shiftId) query = query.eq("shiftId", args.shiftId);
  return query;
}

export async function getPeopleAbsences(
  client: SupabaseClient<Database>,
  companyId: string,
  date: string
) {
  return client
    .from("peopleAbsence")
    .select("id, employeeId, shiftId, note, date")
    .eq("companyId", companyId)
    .eq("date", date);
}

// Employees assignable at a location: employees view filtered by locationId
export async function getPeopleEmployees(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  return client
    .from("employees")
    .select("id, name, avatarUrl")
    .eq("companyId", companyId)
    .eq("locationId", locationId);
}

// Gated abilities per work center at a location (for the advisory badge):
// workCenterProcess ⋈ process (requiresAbility) ⋈ ability (ability.processId)
export async function getWorkCenterRequiredAbilities(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) { /* select workCenterProcess joined to process + ability; filter process.requiresAbility = true, workCenter.locationId = locationId, companyId scope */ }

// Active employee qualifications (for the advisory badge)
export async function getActiveEmployeeAbilities(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("employeeAbility")
    .select("employeeId, abilityId, trainingCompleted, active")
    .eq("companyId", companyId)
    .eq("active", true);
}
```

   For `getWorkCenterRequiredAbilities`, check the generated types for the exact FK/embed shape first; if the PostgREST embed trips the composite-FK issue (PGRST200), embed by target table name (`process(...)`, not `alias:processId(...)`) per `.ai/lessons.md`. If no clean embed exists, do two queries (workCenterProcess rows, then process+ability rows) and join in TS. If `employees` view lacks `locationId` or `avatarUrl`, STOP and report — do not invent a different view.

2. Mutations:

```typescript
// Move-semantics: replaces the person's existing magnet for that date/shift
export async function upsertPeopleAssignment(
  db: Kysely<KyselyDatabase>,
  assignment: {
    companyId: string; locationId: string; workCenterId: string;
    employeeId: string; date: string; shiftId: string | null;
    note?: string; createdBy: string;
  }
) {
  return db.transaction().execute(async (trx) => {
    let del = trx
      .deleteFrom("peopleAssignment")
      .where("companyId", "=", assignment.companyId)
      .where("employeeId", "=", assignment.employeeId)
      .where("date", "=", assignment.date);
    del = assignment.shiftId
      ? del.where("shiftId", "=", assignment.shiftId)
      : del.where("shiftId", "is", null);
    await del.execute();
    return trx
      .insertInto("peopleAssignment")
      .values({ ...assignment, note: assignment.note ?? null })
      .returning(["id", "workCenterId"])
      .executeTakeFirstOrThrow();
  });
}

export async function deletePeopleAssignment(client, id: string, companyId: string) // .delete().eq("id").eq("companyId")

export async function setPeopleAbsence(client, absence: { companyId; employeeId; date; shiftId: string | null; note?; createdBy })
// plain insert; on unique violation (already absent) return the error untouched

export async function clearPeopleAbsence(client, id: string, companyId: string)

export async function copyPeopleBoard(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; locationId: string; fromDate: string; toDate: string; shiftId: string | null; createdBy: string }
) {
  // one transaction: read fromDate assignments; read toDate absences + toDate existing
  // assignments; insert source rows whose employeeId is in neither set, with date = toDate.
  // Return { copied: n, skipped: n }.
}
```

3. Export nothing new from the barrel manually unless `index.ts` isn't `export *` (it is — verify only).
4. Do NOT call `notifyScheduleInputsChanged` inside services — route actions fire it (Task 7), matching the existing call sites (`x+/people+/shifts.$shiftId.tsx:65` etc.).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** MES services (Task 8); routes/UI (Task 7); firing events (Task 7).

---

## Task 6: Register the People view (paths + navigation)

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — near lines 1895–1901 (the `scheduleDates`/`scheduleOperation` block): add `schedulePeople: `${x}/schedule/people``, `schedulePeopleUpdate: `${x}/schedule/people/update``
- Modify: `apps/erp/app/modules/production/ui/Schedule/Kanban/ScheuleNavigation.tsx` — add a "People" `DropdownMenuRadioItem`: extend `getCurrentView()`, `getViewLabel()`, `getViewIcon()` (use `LuUsers` from `react-icons/lu`), and `navigateToView("people")` → `path.to.schedulePeople` (preserve the `?location=` search param exactly like the existing cases)

**Steps:**
1. Add both path helpers.
2. Add the People case to all three helper functions plus the radio item, copying the exact shape of the existing "dates"/"operations" cases.
3. Do NOT add a separate entry to `useProductionSubmodules.tsx` — the existing single "Schedule" nav entry covers all schedule views.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -n "schedulePeople" apps/erp/app/utils/path.ts
# Expected: 2 hits
```

**Out of scope:** the route files themselves (Task 7).

---

## Task 7: Build the People board route + UI

**Depends on:** Tasks 5, 6
**Files:**
- Create: `apps/erp/app/routes/x+/schedule+/people.tsx` — loader + page
- Create: `apps/erp/app/routes/x+/schedule+/people.update.tsx` — action-only, intent-multiplexed
- Create: `apps/erp/app/modules/production/ui/Schedule/People/PeopleBoard.tsx` (+ `PeopleCard.tsx` if cleaner)
- Copy from (precedent):
  - Board/DnD: `apps/erp/app/modules/production/ui/Schedule/Kanban/DateKanban.tsx` (DndContext at :133–138, drop→`submit(..., { navigate: false, fetcherKey })` at :155–269, optimistic `usePendingItems()` at :33–55, failure toast at :62–90) and `Kanban/components/ColumnCard.tsx` (pluggable `CardComponent` prop)
  - Header with prev/next-day arrows: `apps/erp/app/routes/x+/schedule+/dates.tsx:765–876` (`navigateDate` at :748–757 — use `add({ days: 1 })`), location ladder at :121–150
  - Person card: `apps/erp/app/components/EmployeeAvatar.tsx` (+ `usePeople()` store)
  - Intent action: `apps/erp/app/routes/x+/maintenance+/$dispatchId.events.tsx:27`
  - Handle: `apps/erp/app/routes/x+/schedule+/dates.tsx:66–70`

**Steps:**
1. **Loader** (`people.tsx`): `requirePermissions(request, {})` (view is employee-role); resolve `locationId` via the `?location=` → `getUserDefaults` → first-of-`getLocationsList` ladder; `date` from `?date=` else today in the location timezone (`toCalendarDate(now(tz))` as in `dates.tsx:85–90`); `shiftId` from `?shift=`. `Promise.all`: `getPeopleAssignments`, `getPeopleAbsences`, `getPeopleEmployees`, `getWorkCentersByLocation` (from `~/modules/resources`, `resources.service.ts:992`), `getWorkCenterRequiredAbilities`, `getActiveEmployeeAbilities`, `getShiftsList(client, locationId)` (from `~/modules/people`). Return them plus `locations` for the switcher.
2. **Handle**: `export const handle: Handle = { breadcrumb: msg`People`, to: path.to.schedulePeople, module: "production" }`.
3. **Page** (`PeopleBoard.tsx`):
   - Header: `ScheduleNavigation`, Today button + `LuChevronLeft`/`LuChevronRight` day arrows + a `DatePicker`-style popover showing the date, location `Combobox` (copy `dates.tsx:826–839`), **Copy previous day** button (fetcher POST to `people.update.tsx` with `intent: "copy"`), and shift `Tabs` ONLY when `shifts.length > 1` (tab per shift + an "All day" tab = `shiftId` null; sets `?shift=`).
   - Board: `DndContext` grid — first column **Unassigned** (employees with no assignment for the date; absent people at the bottom, `opacity-50` + "Absent" badge), then one column per active work center with a headcount in the column header. Reuse `ColumnCard` with a custom `CardComponent` (`PeopleCard`: `EmployeeAvatar` + name); if `ColumnCard`'s job-shape props don't fit cleanly, build a sibling column component in `People/` copying its `useSortable`/`SortableContext` wiring rather than forcing the type.
   - Card: amber badge (`LuTriangleAlert`, `text-amber-500`) when the target column's work center has a gated ability (from `getWorkCenterRequiredAbilities`) the person lacks (from `getActiveEmployeeAbilities`, qualification = active ∧ trainingCompleted ∧ not expired); `Tooltip` lists missing ability names. Card `DropdownMenu`: *Mark absent today* / *Clear absence*, *Remove from station*, *Note* (small popover input, submits `intent: "note"`).
   - Drop on a column → `submit({ intent: "assign", employeeId, workCenterId, date, shiftId }, { method: "post", action: path.to.schedulePeopleUpdate, navigate: false, fetcherKey: `people:${employeeId}` })`; drop on Unassigned → `intent: "unassign"`. Optimistic move via the `usePendingItems` pattern filtered on `path.to.schedulePeopleUpdate`.
   - An absent person who still has an assignment renders in the Unassigned column (grayed) — absence does NOT delete the `peopleAssignment` row; clearing absence restores them to their station.
   - All strings via `useLingui()` `t\`...\`` / `<Trans>`.
4. **Action** (`people.update.tsx`): `assertIsPost` → `requirePermissions(request, { update: "production" })` → branch on `formData.get("intent")`:
   - `assign` → validate with `validator(peopleAssignmentValidator)`, call `upsertPeopleAssignment(db, ...)` (get the Kysely `db` exactly the way `x+/person+/$personId.job.tsx` does for `updateEmployeeJob` — copy that import/wiring), then `notifyScheduleInputsChanged(companyId, "people", "People assignment changed", workCenterId)`.
   - `unassign` → `deletePeopleAssignment`; notify with the removed row's `workCenterId`.
   - `absent` → `setPeopleAbsence`; look up the person's assignments for that date first (`getPeopleAssignments` filtered client-side by employeeId) and notify once per assigned `workCenterId`; if none, notify once with `entityId` undefined.
   - `clear-absence` → `clearPeopleAbsence`; same notify pattern as `absent`.
   - `note` → update the assignment's `note` (+ `updatedBy`/`updatedAt`, `sanitize(...)`); no notify.
   - `copy` → validate with `copyPeopleBoardValidator`, call `copyPeopleBoard(db, ...)`, flash `success(\`Copied N assignments\`)`; notify once with `entityId` undefined.
   - Errors: `return data({}, await flash(request, error(...)))`; successes for fetcher intents return plain `data({ success: true })` (board revalidates via the loader).
5. Kysely transactions throw on failure — wrap `upsertPeopleAssignment`/`copyPeopleBoard` calls in try/catch in the action and flash the error.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm run lint
# Expected: no new errors in the created files
```

**Out of scope:** MES (Task 8); engine consumption (Tasks 9–12); locking the board by permission beyond `production_update` on writes; kiosk/print view.

---

## Task 8: MES assigned-station default + chip

**Depends on:** Task 2
**Files:**
- Modify: `apps/mes/app/services/operations.service.ts` — add `getMyPeopleAssignment`
- Create: `apps/mes/app/services/people.server.ts` — session cookie for the "dismissed today" override
- Modify: `apps/mes/app/routes/x+/operations.tsx` — loader (~lines 55–145) + `KanbanSchedule` header (~lines 438–512)
- Create: `apps/mes/app/routes/x+/people-override.tsx` — action-only cookie setter
- Copy from (precedent): service shape `getOpenJobs` (`operations.service.ts:28–41`); cookie storage `apps/mes/app/services/operation.server.ts` (whole file, 37 lines); chip UI `apps/mes/app/components/Filter/ActiveFilters.tsx:199–209` (X button); user context `apps/mes/app/middleware/user.ts` (`effectiveUserId`)

**Steps:**
1. `getMyPeopleAssignment(client, { companyId, employeeId, date })` → `client.from("peopleAssignment").select("id, workCenterId, shiftId, workCenter(name)").eq("companyId", companyId).eq("employeeId", employeeId).eq("date", date)` — returns rows (a person can have per-shift rows); if the `workCenter(name)` embed errors on the composite FK, select the name via a second lookup against the loader's existing `workCenters` list instead.
2. `people.server.ts`: copy `operation.server.ts`'s `createCookieSessionStorage` shape with cookie name `"mes-people-override"`; `getPeopleOverride(request): Promise<string | null>` (returns the dismissed date), `setPeopleOverride(request, date: string)`.
3. Loader changes in `operations.tsx`: after parsing filters (~line 111), when `selectedWorkCenterIds.length === 0` (no explicit URL filter):
   - Compute today's date string in the location's timezone (the loader already has `locationId`; fetch the location row's `timezone` — if the location row has no timezone column, STOP and report rather than guessing server time).
   - If `getPeopleOverride(request) === today` → skip defaulting.
   - Else call `getMyPeopleAssignment(serviceRole, { companyId, employeeId: effectiveUserId, date: today })` using `effectiveUserId` from `context.get(userContext)` (NOT the raw `userId` — pinned-in operators on shared terminals). If a row exists, set `selectedWorkCenterIds = [row.workCenterId]` and return `peopleStation: { workCenterId, name }` in loader data (else `peopleStation: null`).
   - Do not write the people default into the saved-filters cookie (`setFilters`) — it is a server-side default, not a user choice.
4. Chip UI in `KanbanSchedule`: when `peopleStation` is set and the URL still has no `workCenterId` filter, render a pill next to the `Filter` dropdown (~line 438): station icon + `t\`Your station: ${peopleStation.name}\`` + X button (copy `ActiveFilters.tsx:199–209` styling). X submits a fetcher POST to `path` `/x/people-override` with `{ date: today }`; that action calls `setPeopleOverride` and returns a redirect back to the operations URL with the `Set-Cookie` header — after which the loader stops defaulting for the session.
5. No change to the Start gate (`x+/event.tsx` eligibility check stays untouched).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
grep -n "effectiveUserId" apps/mes/app/routes/x+/operations.tsx
# Expected: at least 1 hit (the people lookup uses effectiveUserId)
```

**Out of scope:** locking the operator to the station; ERP board; qualification gate changes.

---

## Task 9: Engine — MasterDataProvider people reads

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/master-data-provider.ts` — interface (lines ~111–152) + `KyselyMasterDataProvider` (~159–598)
- Copy from (precedent): `getQualifiedEmployees` (lines 498–534) for the `cached()` + row-type pattern

**Steps:**
1. Add row types near the existing ones (~lines 64–102):

```typescript
export interface PeopleAssignmentRow {
  workCenterId: string;
  employeeId: string;
  date: string;      // YYYY-MM-DD (Kysely returns DATE as string — verify; if it returns Date, normalize to string here)
  shiftId: string | null;
}
export interface PeopleAbsenceRow {
  employeeId: string;
  date: string;
  shiftId: string | null;
}
```

2. Add to the `MasterDataProvider` interface and implement on `KyselyMasterDataProvider`:

```typescript
getPeopleAssignments(rangeStart: Date, rangeEnd: Date): Promise<PeopleAssignmentRow[]>;
getPeopleAbsences(rangeStart: Date, rangeEnd: Date): Promise<PeopleAbsenceRow[]>;
```

   Both: `.where("companyId", "=", this.companyId)`, date `>= rangeStart` date-string and `<= rangeEnd` date-string. Wrap in `this.cached(\`people-assignments:${rangeStart.toISOString()}:${rangeEnd.toISOString()}\`, ...)` (per-run instance cache; date range is in the key so batch reuse is safe).
3. If any other implementation of the `MasterDataProvider` interface exists (grep for `implements MasterDataProvider`), add the methods there too; if a test double exists, give it empty-array defaults.

**Verify:**
```bash
cd packages/database/supabase/functions && git show HEAD:supabase/functions/lib/scheduling/master-data-provider.ts > /tmp/mdp.orig.ts 2>/dev/null; deno check lib/scheduling/master-data-provider.ts 2>&1 | grep -c "master-data-provider.ts:" 
# Expected: own-file error count ≤ the pre-existing baseline (per .ai/lessons.md "gate on own-file error deltas"); new code contributes zero new errors
```

**Out of scope:** consuming the reads (Task 11); any caching-policy change to existing methods.

---

## Task 10: Engine — pure `people-utils.ts` + deno tests

**Depends on:** none (pure module; only imports scheduling lib types)
**Files:**
- Create: `packages/database/supabase/functions/lib/scheduling/people-utils.ts`
- Create: `packages/database/supabase/functions/lib/scheduling/people-utils.test.ts`
- Copy from (precedent): `calendar-utils.ts` (`CalendarWindow` type, tz handling) and `slot-allocator.test.ts:1–60` (factory-helper test style, std assertions from `https://deno.land/std@0.175.0/testing/asserts.ts`)

**Steps:**
1. Implement pure functions (no DB imports — must be `deno test`-clean):

```typescript
// YYYY-MM-DD of an instant in a timezone (Intl.DateTimeFormat "en-CA" trick)
export function dateKeyInTimeZone(instant: Date, timeZone: string): string;

// people rows → Map<workCenterId, Map<dateKey, employeeId[]>>  (absent employees excluded by caller)
export function buildPeopleByWorkCenter(rows: PeopleAssignmentRow[]): Map<string, Map<string, string[]>>;

// absence rows → Map<employeeId, Set<dateKey>>  (v1: a shift-scoped absence counts as the whole day)
export function buildAbsencesByEmployee(rows: PeopleAbsenceRow[]): Map<string, Set<string>>;

// Remove the parts of an employee's availability windows that fall on absent dates.
// Split windows at local-midnight boundaries in timeZone; drop sub-intervals whose dateKey is absent.
export function subtractAbsences(
  windows: CalendarWindow[], absentDates: Set<string>, timeZone: string
): CalendarWindow[];

// Two-pass gated eligibility, pass-1 window clipping:
// keep window parts on dates where the WC has NO people (default behavior),
// plus parts on dates where THIS member is assigned at the WC.
export function clipWindowsForPeoplePass(
  windows: CalendarWindow[],
  wcPeopleDates: Set<string>,        // all dates the WC has any people
  memberPeopleDates: Set<string>,    // dates this member is assigned at this WC
  timeZone: string
): CalendarWindow[];
```

2. Tests (each a `Deno.test`):
   - `dateKeyInTimeZone` across a midnight boundary in a non-UTC zone (e.g. `America/Chicago`).
   - `subtractAbsences`: absence removes exactly that local day; empty set returns windows **reference-unchanged or value-equal** (the empty-board regression guarantee); multi-day window split correctly.
   - `clipWindowsForPeoplePass`: (a) WC has no people on any date → windows unchanged (empty board ⇒ byte-identical); (b) WC assigned on day 1 with this member → day-1 parts kept; (c) WC assigned on day 1 WITHOUT this member → day-1 parts removed, day-2 (unassigned) parts kept.
   - `buildPeopleByWorkCenter` / `buildAbsencesByEmployee` shape tests.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/people-utils.test.ts
# Expected: all tests pass, 0 failures
```

**Out of scope:** selector integration (Task 12); DB reads.

---

## Task 11: Engine — buildFiniteContext + context extension

**Depends on:** Tasks 9, 10
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/work-center-selector.ts` — `FiniteSchedulingContext` type (lines ~52–84)
- Modify: `packages/database/supabase/functions/lib/scheduling/scheduling-engine.ts` — `buildFiniteContext()` (lines ~438–583)

**Steps:**
1. Extend `FiniteSchedulingContext`:

```typescript
peopleByWorkCenter: Map<string, Map<string, string[]>>; // wcId → dateKey → employeeIds (absentees already removed)
windowsByEmployee: Map<string, CalendarWindow[]>;      // availability for ALL people + qualified employees, post-absence
```

2. In `buildFiniteContext()`:
   - Alongside the existing parallel reads (~460–472), call `provider.getPeopleAssignments(rangeStart, rangeEnd)` and `provider.getPeopleAbsences(rangeStart, rangeEnd)` (`rangeStart`/`rangeEnd` already exist at ~474–477).
   - Union the people rows' `employeeId`s into the id list passed to `getEmployeeShiftWindows` (~468–472) so people members at ungated stations get real windows (no shift assignment still ⇒ always-available default at ~542–544).
   - Build `absent = buildAbsencesByEmployee(absenceRows)`; build `peopleByWorkCenter = buildPeopleByWorkCenter(assignmentRows.filter(r => !absent.get(r.employeeId)?.has(r.date)))` — absent people never appear as people.
   - After `windowsByEmployee` is computed (~505–544), apply `subtractAbsences(windows, absent.get(employeeId) ?? empty, timeZone)` for every employee with absences — this covers BOTH the people paths and the existing qualified-fallback path (Q5→B: absence subtracts availability everywhere). `employeesByAbility` members must reference the post-subtraction windows.
   - Set the two new context fields. With zero people rows and zero absences both maps are empty and every window array is identical to today's — the empty-board guarantee.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/
# Expected: all existing tests still pass (slot-allocator, operator-eligibility, calendar-utils, conflict-messages, etc.) + people-utils tests
# Then own-file deno check delta (lesson: gate on delta, not exit code):
deno check lib/scheduling/scheduling-engine.ts 2>&1 | grep -c "scheduling-engine.ts:"
# Expected: ≤ pre-existing baseline (measure HEAD baseline first via git show)
```

**Out of scope:** selector allocation changes (Task 12); the `schedule` edge function's request/response shape.

---

## Task 12: Engine — selector two-pass, manned assigned stations, placement note

**Depends on:** Task 11
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/work-center-selector.ts` — the `requiresAbility` branch (lines ~371–459) + `buildEligibleMembers` (~557–566)
- Modify: `packages/database/supabase/functions/lib/scheduling/conflict-messages.ts` — add a `LatePlacementCause` variant
- Modify: `packages/database/supabase/functions/lib/scheduling/conflict-messages.test.ts` — cover the new cause

**Steps:**
1. Helper in the selector (or `people-utils.ts` if pure): for a candidate work center `wc` and members list, compute `wcPeopleDates = keys of ctx.peopleByWorkCenter.get(wc.id)` and per-member `memberPeopleDates`.
2. **Gated ops** (`requirement` truthy, ~403–420): when `wcPeopleDates` is non-empty within `[earliestStart, horizonEnd]`:
   - Pass 1: members with windows `clipWindowsForPeoplePass(m.windows, wcPeopleDates, memberPeopleDates(m), timeZone)`, dropping members whose clipped windows are empty; call `allocateAttendedOperation` with those.
   - If pass 1 returns no feasible slot → Pass 2: re-run with the ORIGINAL members/windows (today's behavior, the soft fallback). No new conflict from pass-1 failure.
   - When `wcPeopleDates` is empty → exactly today's single-pass behavior (do not touch the code path).
3. **Ungated ops** (`else` branch, ~421–443): when the WC has people within the placement range:
   - Build `peopleMembers: EligibleMember[]` from `ctx.peopleByWorkCenter.get(wc.id)`'s employees — windows = `clipWindowsForPeoplePass(ctx.windowsByEmployee.get(id) ?? alwaysAvailable, wcPeopleDates, memberPeopleDates, timeZone)` (an ungated-assigned station is only manned on its assigned dates; unassigned dates keep machine-only semantics, so here clip to memberPeopleDates ONLY — pass `wcPeopleDates = allDates` equivalent; add a thin wrapper `clipWindowsToDates(windows, dates, timeZone)` in people-utils for this).
   - Compute `attendedHours = Math.min(calculateAttendedHours(op), durationHours)` (same as line ~382) and call `allocateAttendedOperation({ attendedHours, totalHours, ..., members: peopleMembers, busyByEmployee: ctx.reservationsByEmployee })` — machine holds the full span exactly as the gated path does.
   - If it returns no feasible slot → fall back to the existing machine-only `allocateOperation` (soft; schedule stays complete, no new conflict class).
   - When the WC has no people → the existing machine-only path, untouched (empty board ⇒ byte-identical).
4. Employee segments from either new path flow into the existing persistence unchanged (`resourceKind: "Employee"` planned reservations at ~491–506; `persistChanges` needs NO edits).
5. Placement note: add `{ kind: "people-wait" }` to the `LatePlacementCause` union (`conflict-messages.ts:29–47`) with `composePlacementNote` output `"Waited {duration} for the assigned people"`; use it in the ungated-assigned path when the allocated start is later than `earliestStart` (reuse the existing waitedMs plumbing at ~486). Add a `conflict-messages.test.ts` case asserting the message.
6. Escape hatch: if `allocateAttendedOperation`'s signature cannot express the ungated case without modification (e.g. it asserts a `requirement`), STOP and report before changing `slot-allocator.ts` — do not refactor the allocator on the fly.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/
# Expected: ALL tests pass (empty-board behavior guaranteed by people-utils tests + untouched code paths)
deno check lib/scheduling/work-center-selector.ts 2>&1 | grep -c "work-center-selector.ts:"
# Expected: ≤ pre-existing HEAD baseline (own-file delta = 0 new)
```

**Out of scope:** hard-obey mode; per-shift hour clipping of people (v1 treats a shift-scoped assignment as day-scoped for the engine — the person's own shift windows already bound their hours); dispatch-rule changes; `slot-allocator.ts` internals.

---

## Task 13: i18n extract + translate

**Depends on:** Tasks 7, 8
**Files:**
- Modify (generated): `packages/locale/locales/*/erp.po`, `packages/locale/locales/*/mes.po`

**Steps:**
1. `pnpm lingui:extract` — new msgids for the People board + MES chip land in the `en` catalogs.
2. `pnpm run translate` (LLM fill for the other 12 locales). If it fails on a missing API key, STOP and report — leave the extracted `.po`s in place.

**Verify:**
```bash
grep -rc "Your station" packages/locale/locales/en/mes.po
# Expected: ≥ 1
grep -c "msgstr \"\"" packages/locale/locales/es/erp.po
# Expected: no INCREASE vs before the task (translate filled the new strings) — skip this check if translate was skipped
```

**Out of scope:** hand-writing translations; touching `.mjs` compiled catalogs.

---

## Task 14: Docs sync + spec changelog

**Depends on:** Task 12
**Files:**
- Modify: `apps/erp/app/modules/production/AGENTS.md` — add `peopleAssignment`/`peopleAbsence` to the data-model table, the new service functions to the service list, and one line in the Scheduling bullet ("people assignments soft-prefer people at their station; a assigned station is manned via attended-window allocation; absences subtract availability"). Also fix the stale `OperatorPool` reservation-kinds mention (code writes `WorkCenter`/`Employee`; `OperatorPool` is read-tolerated legacy).
- Modify: `.claude/rules/scheduling-data-structures.md` — add the people inputs to the engine description (only describe COMMITTED code).
- Modify: `.ai/specs/2026-07-24-daily-people-station-assignment.md` — changelog entry "implemented", check off acceptance criteria that are verified, note any divergences.

**Steps:** as listed per file; keep edits to what the code actually does.

**Verify:**
```bash
grep -n "peopleAssignment" apps/erp/app/modules/production/AGENTS.md .claude/rules/scheduling-data-structures.md
# Expected: ≥ 1 hit in each file
```

**Out of scope:** moving the spec to `implemented/` (ask the user first — requires verification evidence); product docs under `docs/` (follow-up).

---

## Task 15: Browser verification

**Depends on:** all previous
**Steps:**
1. **Ask the user for permission first** (standing rule: no browser tools unprompted). If declined, verify what's verifiable without a browser and report.
2. With permission, use `/auth` + `/test` against the local dev stack to walk the spec's acceptance criteria: drag-assign (move semantics), amber badge + tooltip, copy-previous-day skipping absentees, MES default filter + chip clear, absent → stale badge on affected jobs (watch the mark function + `job.scheduleOutdatedReason` stamps — the local Inngest dev server cannot execute the debounced wave, per `.ai/lessons.md`).
3. Engine acceptance (Employee reservations at a assigned ungated station, 12h-spill behavior) requires a scheduled job. Propose the trigger to the user (re-schedule an existing job via the UI) — never seed DB rows to fabricate the scenario (standing rule: propose SQL, the user runs it).

**Verify:** each acceptance criterion in the spec checked off with observed evidence in the run log (`.ai/runs/`).

**Out of scope:** production/remote environments.
