# OEE provider — review follow-ups — implementation plan

**Spec:** .ai/specs/2026-10-12-oee-provider-integration.md
**Rule:** .claude/rules/oee-provider.md
**Source of the work:** the nuclear self-review of PR #1909. Its six Must-fix items are done in `5bb79d0b1a`. This plan covers every remaining Risk and Suggestion.
**Closest sibling:** none. No new record type.
**Branch:** find-oee-job-operation-transcript

## Progress
- [x] Task 1: Make the OEE work center foreign keys company-scoped and fix the indexes
- [x] Task 2: Unload an operation when it moves to another work center
- [x] Task 3: Ignore load-pointer changes in the event and broadcast filters
- [x] Task 4: Tidy the engine slots, always close a slot, and merge repeated states
- [x] Task 5: Stop a sync run when the provider is unavailable
- [x] Task 6: Fix the sync cursor, log late events, and close Canceled operations
- [x] Task 7: Test `syncOeeDevice` against the local database
- [x] Task 8: Resolve an OEE provider in one place
- [x] Task 9: Make machine time one stream per work center
- [x] Task 10: End the MES event on its own work center
- [x] Task 11: Hide a stale device state on the work center display
- [x] Task 12: Fix the machine time service reads
- [x] Task 13: Add filters to the Unattributed Time list
- [x] Task 14: Make the review queue match the filtered list and skip running rows
- [x] Task 15: Polish the review drawer
- [x] Task 16: Move the Devices tab server code out of the route and fix its gaps
- [x] Task 17: Update the rule, AGENTS.md files and the guide
- [x] Task 18: Verify in the browser

## Decisions taken

The human approves these with the plan. Each one closes a review item.

| Review item | Decision | Why |
|---|---|---|
| A Pause ends every Machine event on the work center | Keep it, and make it true on every work center. A machine has one machine time. A Machine press ends every open Machine event on its work center, from any operator or the sensor. | The human's rule: separate operators share a single machine time. Without a device, two operators' Machine timers can overlap today. |
| The MES press and the event write are not atomic | Keep the press before the event write. No task. | If the start fails, the operator sees the error and retries, and the retry repairs it. The reverse order risks double-counted time that nothing repairs. |
| Late events before `appliedThrough` are dropped | Do not replan history. Fix the cursor and log each late event. | Replanning means rewriting closed events, maybe already posted to the GL. |
| The queue ignores the list's search and sort | The queue honors the list's search and filters. The list allows no column sort. | One order for the list and the queue: newest start first, then `id`. |
| The list has no filters | Add 5 filters: work center, location, start date, end date, and state (Running / Stopped) | The human asked for date and column filters. |
| Date filters on a timestamp column | The route turns each date range into instants at the company's day boundaries. The generic `between` filter is not used for them. | The generic filter compares a timestamp with a bare date: it drops the last day and uses UTC days. |
| Review opens a running row | The queue holds stopped rows only. A running row opens but is outside the queue. | A running row cannot be answered. |
| A sync run piles up during a Sense outage | Stop the run at the first "provider unavailable" error. Add `singleton` skip per company and integration. | The sweep sends a new run every 2 minutes anyway. |
| Device state goes stale on the display | Hide the state when `lastSyncError` is set or `lastSyncedAt` is more than 10 minutes old | 10 minutes is 5 sync periods. |
| The Devices tab calls Sense after each pick | Cache the provider's device list in Redis for 60 seconds | A mapping change does not change the provider's device list. |

## Not doing

| Review item | Why not |
|---|---|
| Fold the create-then-drop migrations into the first two | Three of the branch's migrations are generated authz migrations, and those are never hand-edited. Local databases have also applied them. |
| Stop webhook and workflow events for load-pointer changes | `dispatch_event_batch` sends every UPDATE to WEBHOOK, WORKFLOW and SYNC subscriptions by design: their payload is a contract. Task 3 stops the audit, search and broadcast noise. |
| Clean up state changes stored before a remap guard returns | The daily `util.purge_machine_state_changes()` already deletes rows of a device that no longer exists. |
| Extract one shared `DetailRow` component | Six other modules have their own copy. Changing them is outside this plan. Task 15 fixes the comment only. |

## Dependencies
- Task 1 runs first. It changes the schema, so `pnpm run generate:types` follows it.
- Tasks 2 and 3 each generate an authz migration. Run them one after the other, not in parallel.
- Task 4 is independent.
- Task 5 is independent.
- Task 6 needs Task 4 (engine types).
- Task 7 needs Tasks 4, 6 and 9 (it seeds Machine events).
- Task 8 needs Task 5 (both edit `packages/ee/src/sense/`).
- Tasks 9, 10 and 11 are independent of each other.
- Task 13 needs Task 12. Task 14 needs Task 13. Task 15 needs Task 14.
- Task 16 is independent.
- Task 17 needs Tasks 1 to 16.
- Task 18 needs Task 17.

## Shared commands

Run these from the worktree root, `/Users/barbinbrad/conductor/workspaces/carbon/albany`.

```bash
# The shell exports a stale SUPABASE_DB_URL. Use the worktree's value first.
export SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL' .env.local | cut -d= -f2- | tr -d '"')
# Postgres container for this worktree (psql is not installed on the host):
PG=carbon-carbon-find-oee-job-operation-transcript-postgres-1
```

🛑 Never stop or restart a `crbn up` process. It tears down the whole stack for this worktree, including the human's.

---

## Task 1: Make the OEE work center foreign keys company-scoped and fix the indexes

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_oee-company-scoped-work-center.sql` (from `pnpm db:migrate:new`)
- Copy from (precedent): `packages/database/supabase/migrations/20261013191915_oee-tenancy-and-retention.sql`

**Steps:**
1. Run `pnpm db:migrate:new oee-company-scoped-work-center < /dev/null`.
2. Write this SQL into the new file:

```sql
-- machineStateChange and unattributedMachineTime carry the work center the
-- sync read from the device. Their FKs carry the company too, like
-- workCenterDevice's (20261013191915). Each REPLACES the single-column FK:
-- two FKs to workCenter would make PostgREST embeds ambiguous (PGRST201).
ALTER TABLE "machineStateChange"
  DROP CONSTRAINT IF EXISTS "machineStateChange_workCenterId_fkey";
ALTER TABLE "machineStateChange"
  ADD CONSTRAINT "machineStateChange_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter" ("id", "companyId") ON DELETE CASCADE;

ALTER TABLE "unattributedMachineTime"
  DROP CONSTRAINT IF EXISTS "unattributedMachineTime_workCenterId_fkey";
ALTER TABLE "unattributedMachineTime"
  ADD CONSTRAINT "unattributedMachineTime_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter" ("id", "companyId") ON DELETE CASCADE;

-- Every FK has an index.
CREATE INDEX IF NOT EXISTS "workCenterDevice_updatedBy_idx"
  ON "workCenterDevice" ("updatedBy");
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_updatedBy_idx"
  ON "unattributedMachineTime" ("updatedBy");

-- ("companyId", "startTime" DESC) from 20261013170425 covers it.
DROP INDEX IF EXISTS "unattributedMachineTime_companyId_idx";
```

3. Run `pnpm db:migrate < /dev/null`. It applies the migration and runs `pnpm run generate:types`.

**Verify:**
```bash
docker exec -i $PG psql -U postgres -At -c "select conname, pg_get_constraintdef(oid) from pg_constraint where conname in ('machineStateChange_workCenterId_fkey','unattributedMachineTime_workCenterId_fkey')"
# Expected: both rows show FOREIGN KEY ("workCenterId", "companyId") REFERENCES "workCenter"(id, "companyId")
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs
# Expected: "Tasks: N successful, N total", no "error TS"
```

**Out of scope:** `workCenterDevice`'s FK (already composite).

---

## Task 2: Unload an operation when it moves to another work center

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/event-system/handlers/sync_unload_work_center_operation.sql` — add a work center change case.
- Modify: `packages/database/supabase/tests/work-center-loaded-operation.test.sql` — add a test case.
- Create: a generated authz migration (from the `authz migration` command).

**Steps:**
1. In `sync_unload_work_center_operation.sql`, after the `DELETE` branch, add this branch before `IF p_operation != 'UPDATE' THEN RETURN; END IF;`:

```sql
  -- An operation moved to another work center leaves the old one: its sensor
  -- time there is no longer this operation's.
  IF p_operation = 'UPDATE'
     AND (p_old->>'workCenterId') IS DISTINCT FROM (p_new->>'workCenterId') THEN
    UPDATE "workCenter"
    SET "loadedJobOperationId" = NULL,
        "loadedAt" = NULL
    WHERE "id" = p_old->>'workCenterId'
      AND "companyId" = p_old->>'companyId'
      AND "loadedJobOperationId" = p_new->>'id';
  END IF;
```

2. Keep the existing Done / Canceled branch after it unchanged.
3. In the SQL test, after the "Deleting the loaded operation" case, add a case:
   1. Create operation `v_e` on `v_work_center` with `pg_temp.add_operation(v_job, v_company_id, v_process, v_work_center, 5)`.
   2. Load it with `pg_temp.add_event(v_e, v_work_center, 'Setup', v_day + time '12:30', NULL)`.
   3. Create a second work center `v_work_center_2` in the same company (copy the `INSERT INTO "workCenter"` line, name `'Haas 3'`).
   4. Run `UPDATE "jobOperation" SET "workCenterId" = v_work_center_2, "updatedBy" = 'system' WHERE id = v_e`.
   5. Assert `pg_temp.loaded(v_work_center) = 'none@none'` with message `'moving E unloads the old work center'`.
4. Declare `v_e text; v_work_center_2 text;` in the `DECLARE` block.
5. Run `pnpm db:migrate < /dev/null`. It syncs the handler to the local database.
6. Run `pnpm --filter @carbon/database authz migration unload-on-work-center-move < /dev/null`.

**Verify:**
```bash
docker exec -i $PG psql -U postgres -X < packages/database/supabase/tests/work-center-loaded-operation.test.sql 2>&1 | grep -E "NOTICE|ERROR"
# Expected: NOTICE:  ALL work-center-loaded-operation TESTS PASSED
ls packages/database/supabase/migrations | grep unload-on-work-center-move
# Expected: one file
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all tests pass (the shipping test sees the new migration)
```

**Out of scope:** the load interceptor `sync_load_work_center_operation.sql`.

---

## Task 3: Ignore load-pointer changes in the event and broadcast filters

**Depends on:** Task 2 (both generate authz migrations)
**Files:**
- Modify: `packages/database/src/audit.config.ts` — `skipFields`.
- Modify: the `ignored_columns` constant in these 6 files under `packages/database/src/event-system/functions/`: `dispatch_event_batch.sql`, `broadcast_table_changes.sql`, `broadcast_reference_changes.sql`, `broadcast_user_changes.sql`, `log_table_changes.sql`, `log_user_changes.sql`.
- Create: a generated authz migration.

**Steps:**
1. In `audit.config.ts`, set `skipFields` to `["updatedAt", "updatedBy", "embedding", "loadedJobOperationId", "loadedAt"]`.
2. In each of the 6 SQL files, set `ignored_columns CONSTANT TEXT[] := ARRAY['updatedAt', 'updatedBy', 'embedding', 'loadedJobOperationId', 'loadedAt'];`.
3. Add this comment above `skipFields`: `// loadedJobOperationId / loadedAt change on every timer start (workCenter); they are machine state, not an edit.`
4. Run `pnpm db:migrate < /dev/null`.
5. Run `pnpm --filter @carbon/database authz migration skip-load-pointer-changes < /dev/null`.

If the `authz migration` command reports more functions than the 6 named above, STOP and report. Do not improvise.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/event-dispatch.test.ts src/authz
# Expected: all tests pass ("ignores exactly the columns the audit diff skips" for all 6 files)
```

**Out of scope:** WEBHOOK, WORKFLOW and SYNC subscriptions. They still receive every UPDATE (see "Not doing").

---

## Task 4: Tidy the engine slots, always close a slot, and merge repeated states

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/oee/engine.ts`
- Modify: `packages/ee/src/oee/engine.test.ts`

**Steps:**
1. Add 3 failing tests to `engine.test.ts` first:
   1. "drops a new slot that would close at or before its start". Use `minimumStateSeconds: 0`. Add 2 changes: Running and Idle, both at `t("10:00:00")`. Expect `writes` to equal `[]` and `currentState` to be `"Idle"`.
   2. "closes an existing slot at its start when the end is earlier": `currentState: "Running"`, `openMachineEvent: { id: "pe1", startTime: t("10:30:00") }`, changes Idle at `t("10:20:00")`. Expect `[{ kind: "closeMachineEvent", productionEventId: "pe1", endTime: t("10:30:00") }]`.
   3. "treats repeated same-state changes as one run for the debounce". Add 3 Running changes: `t("10:00:00")`, `t("10:00:30")`, `t("10:00:50")`. Use `now: t("10:05:00")`. Expect one `insertMachineEvent` with `startTime: t("10:00:00")`.
2. Run the tests. Confirm the 3 new tests fail.
3. Replace `type Slot` and `type EventSlot` with a union, and remove the `jobOperationId: ""` placeholder and both `as` casts:

```ts
/** An open interval this run found (`existing`, closed by id) or opened (`new`). */
type EventSlot =
  | { kind: "existing"; id: string; startTime: string }
  | { kind: "new"; jobOperationId: string; startTime: string };
type UnattributedSlot =
  | { kind: "existing"; id: string; startTime: string }
  | { kind: "new"; startTime: string };
```

4. In `closeEvent` and `closeUnattributed`, always clear the slot:
   1. If the slot is `new` and `end <= startTime`, drop it with no write.
   2. If the slot is `existing` and `end <= startTime`, close it at its own `startTime`.
   3. Else write the close or insert as before.
5. Before the debounce loop, merge consecutive changes with the same `state`. Keep the first of each run.
6. Run the tests again.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/oee/engine.test.ts
# Expected: all tests pass, including the 3 new ones
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: no "error TS"
```

**Out of scope:** the `blockedSince` logic. Keep its behavior and its 4 tests unchanged.

---

## Task 5: Stop a sync run when the provider is unavailable

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/oee/types.ts` — add the error class.
- Modify: `packages/ee/src/oee/index.ts` — no change needed if it already does `export * from "./types"`.
- Modify: `packages/ee/src/sense/provider.ts` — throw the error.
- Modify: `packages/ee/src/sense/provider.test.ts` — test it.
- Modify: `packages/jobs/src/inngest/functions/integrations/oee-sync.ts` — stop the loop, add `singleton`.

**Steps:**
1. In `oee/types.ts`, add:

```ts
/**
 * The provider cannot be reached (network failure, timeout, 5xx). The sync
 * stops the run: every other device would fail the same way.
 */
export class OeeProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OeeProviderUnavailableError";
  }
}
```

2. In `SenseProvider.get`, wrap the `fetch` call in `try`/`catch`. On a thrown error, throw `new OeeProviderUnavailableError(\`Sense ${path} failed: ${message}\`)`.
3. In `SenseProvider.get`, if `response.status >= 500`, throw `OeeProviderUnavailableError` instead of `SenseApiError`.
4. In `provider.test.ts`, add 2 tests with a stubbed global `fetch` (copy the stubbing in that file):
   1. A rejected `fetch` makes `listDevices()` throw `OeeProviderUnavailableError`.
   2. A 503 response makes `listDevices()` throw `OeeProviderUnavailableError`.
5. In `oee-sync.ts`, in the device loop `catch`: if `error instanceof OeeProviderUnavailableError`, record the error on this device, then `break`.
6. Return `stopped: error.message` in the step result when the loop broke.
7. Add `singleton: { key: "event.data.companyId + '-' + event.data.integrationId", mode: "skip" }` to the function options.

If Inngest rejects the `singleton` key expression at registration, STOP and report. Read `.claude/skills/inngest/SKILL.md` before you change the syntax.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/sense
# Expected: all tests pass, including the 2 new ones
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: no "error TS"
```

**Out of scope:** retries of one device. `SenseApiError` for 4xx and data errors stays per device.

---

## Task 6: Fix the sync cursor, log late events, and close Canceled operations

**Depends on:** Task 4
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/oee-sync-device.ts`

**Steps:**
1. In `toInstant`, parse a string with `parseAbsolute(value, "UTC").toAbsoluteString()`. Keep `value.toISOString()` for a `Date`. Remove `new Date(value)`.
2. Type the `max("endTime")` select with `sql<Date | null>` and remove the `as Date | string | null | undefined` cast.
3. Set `lastEventAt` to the newest `changedAt` this sync stored, not to `now`. If the sync stored no change, keep the previous `lastEventAt`.
4. After the insert into `machineStateChange`, count the inserted rows with `changedAt <= appliedThrough`. Use `.returning("changedAt")` on the insert to get them.
5. If that count is more than 0, call `console.warn` with the device id, the count and `appliedThrough`. Do not replan them.
6. In the open-event read, also select `createdBy` and the operation's `status` and `updatedAt` (join `jobOperation` on `id` and `companyId`).
7. If the open event has `createdBy = 'system'` and its operation `status = 'Canceled'`:
   1. Close the event at the operation's `updatedAt`, under the same device lock.
   2. Pass `openMachineEvent: null` to `planMachineTime`.
   3. Pass that `updatedAt` as `lastMachineEventEndTime`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no "error TS"
pnpm --filter @carbon/checks no-local-timezone < /dev/null 2>&1 | tail -3
# Expected: no finding for oee-sync-device.ts
```
If `pnpm --filter @carbon/checks no-local-timezone` is not a script, run `pnpm --filter @carbon/checks conformance < /dev/null` instead and check the same file.

**Out of scope:** replanning history (see "Decisions taken").

---

## Task 7: Test `syncOeeDevice` against the local database

**Depends on:** Tasks 4, 6, 9
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/oee-sync-device.database.test.ts`
- Copy from (precedent): `packages/database/src/machine-time.test.ts` (the `SavepointDriver` harness, `session_replication_role = replica`, rollback per test) and `packages/jobs/src/invoicing/lease-reminders.database.test.ts` (naming, skip without `SUPABASE_DB_URL`).

**Steps:**
1. Build a fake provider object that implements `OeeProvider`. It returns a fixed `listStateChanges` array and records each `window` it receives. It is the external boundary, so `.claude/rules/testing-no-mock-theater.md` allows a fake.
2. Seed per test: a `workCenter` id, a `jobOperation` row, and a `workCenterDevice` row. FKs are off under `replica`.
3. Write 6 tests:
   1. A first sync reads from `createdAt` minus 24 hours.
   2. A later sync reads from `lastEventAt` minus 10 minutes.
   3. A Running change opens a `system` Machine event on the loaded operation.
   4. The engine does not plan a change stored at or before `appliedThrough`. The sync calls `console.warn` once.
   5. A device removed during the read (delete its row before the lock) writes no events.
   6. The sync closes an open `system` event on a Canceled operation at the operation's `updatedAt`.
4. Add the license header with `git add -N <file>` and `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/inngest/functions/integrations/oee-sync-device.database.test.ts
# Expected: "Tests 6 passed (6)"
```

**Out of scope:** the Sense HTTP adapter (`provider.test.ts` covers it).

---

## Task 8: Resolve an OEE provider in one place

**Depends on:** Task 5
**Files:**
- Modify: `packages/ee/src/oee/types.ts` — add `DEFAULT_MINIMUM_STATE_SECONDS = 60`.
- Modify: `packages/ee/src/oee/registry.ts` — typed registry and `createOeeProvider`.
- Modify: `packages/ee/src/oee/service.server.ts` — use it in `getOeeProvider` and `upsertWorkCenterDevice`.
- Modify: `packages/ee/src/sense/hooks.server.ts` — use it.
- Modify: `packages/ee/src/sense/config.tsx` — use the default constant.

**Steps:**
1. In `registry.ts`, type the registry as `Record<OeeProviderId, OeeProviderFactory>`.
2. Add `isOeeProviderId(id: string): id is OeeProviderId`.
3. Add `createOeeProvider(integrationId: string, metadata: Record<string, unknown>): { provider: OeeProvider; minimumStateSeconds: number }`. It throws in 3 cases:
   1. The id is not an OEE provider.
   2. `apiKey` is empty ("No API key").
   3. The factory throws.
4. Make `createOeeProvider` read `minimumStateSeconds` with `DEFAULT_MINIMUM_STATE_SECONDS` as the default.
5. In `getOeeProvider`, call `createOeeProvider` inside the existing `try`. Remove the factory lookup, the API key check and the minimum parsing.
6. In `senseHealthcheck`, call `createOeeProvider("sense", metadata)` in a `try`. On a throw, return `{ healthy: false, reason: error.message }`.
7. In `upsertWorkCenterDevice`, replace `OEE_PROVIDERS[args.integration]` with `isOeeProviderId(args.integration)`.
8. In `config.tsx`, use `.default(DEFAULT_MINIMUM_STATE_SECONDS)` from `../oee/types`.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/oee src/sense
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp
# Expected: no "error TS"
grep -n "OEE_PROVIDERS\[" packages/ee/src/oee/service.server.ts packages/ee/src/sense/hooks.server.ts
# Expected: no output
```

**Out of scope:** the Sense staging refusal. Keep `SENSE_STAGING_REFUSED` and its check in the factory.

---

## Task 9: Make machine time one stream per work center

**Depends on:** none
**Files:**
- Modify: `packages/database/src/machine-time.ts` — `recordManualMachinePress`.
- Modify: `packages/database/src/machine-time.test.ts` — tests.
- Modify: `apps/mes/app/routes/x+/event.tsx` — the press helper comment.
- Modify: `apps/mes/app/routes/x+/start.$operationId.tsx` — the press comment.

A machine has one machine time. A Machine press (Start or Pause) ends every open Machine event on the work center, from any operator or the sensor. Then a Start opens the new one.

**Steps:**
1. Add 3 tests in the `recordManualMachinePress` block. Run them. Confirm that tests 2 and 3 fail:
   1. "ends another operator's Machine event": seed an open Machine event with `createdBy: operator` on a mapped work center. After the press, assert `endedAt` is `true`.
   2. "does not end an event that starts after the press": seed a Machine event with `startTime: after`. After the press, assert `endedAt` is `null`.
   3. "ends Machine events on a work center with no device": seed an open Machine event and no `workCenterDevice`. After the press, assert `endedAt` is `true`. Assert `result.mapped` is `false`.
2. Change the existing test "does nothing on a work center with no device". Keep its assertion that the unattributed row stays open.
3. In `recordManualMachinePress`, end the open Machine events before the device lookup:
   1. Run the `productionEvent` update with `.where("startTime", "<=", args.pressedAt)` added.
   2. Then call `lockWorkCenterDevice`.
   3. If there is no device, return `{ mapped: false, endedEventIds }`.
   4. Else end the running unattributed time and set `lastManualChangeAt`, as today.
4. Start the function's doc comment with "A machine has one machine time."
5. In the same comment, name what the press ends on any work center. Then name what it adds on a mapped one.
6. Update the press comments in `event.tsx` and `start.$operationId.tsx` to match.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/machine-time.test.ts
# Expected: all tests pass, including the 3 new ones
pnpm exec turbo run typecheck --filter=mes --filter=@carbon/database
# Expected: no "error TS"
```

**Out of scope:** `endSensorMachineTime`. A device that leaves a work center ends only the sensor's events.

---

## Task 10: End the MES event on its own work center

**Depends on:** none
**Files:**
- Modify: `apps/mes/app/routes/x+/event.tsx` — the End branch.

**Steps:**
1. In the End branch, before `recordMachinePress()`, read the event: `client.from("productionEvent").select("workCenterId, type").eq("id", id).eq("companyId", companyId).maybeSingle()`.
2. If the read fails or returns no row, return the existing "Failed to end event" flash.
3. Change `recordMachinePress` to take `{ type, workCenterId }` as arguments.
4. In the End branch, pass the event's own `type` and `workCenterId`.
5. In the Start branch, pass `d.type` and `d.workCenterId`, as today.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no "error TS"
grep -n "d.workCenterId" apps/mes/app/routes/x+/event.tsx
# Expected: only the Start branch uses it
```

**Out of scope:** `start.$operationId.tsx`. It reads the work center from the operation already.

---

## Task 11: Hide a stale device state on the work center display

**Depends on:** none
**Files:**
- Modify: `apps/mes/app/services/display.service.ts` — add `getDisplayDeviceState`.
- Modify: `apps/mes/app/services/operations.service.ts` — remove `getWorkCenterDevice` and the `WorkCenterDevice` type.
- Modify: `apps/mes/app/routes/display+/$workCenterId.work.tsx` — use the new function.

**Steps:**
1. In `display.service.ts`, add `getDisplayDeviceState(client, { workCenterId, companyId, now })`.
2. Make it select `currentState, lastSyncedAt, lastSyncError` from `workCenterDevice` for the work center and company, with `maybeSingle()`.
3. Make it return `null` when there is no row, when `lastSyncError` is set, or when `lastSyncedAt` is null.
4. Make it return `null` when `Date.parse(now) - Date.parse(lastSyncedAt)` is more than `10 * 60 * 1000`. Comparing absolute instants is the date rule's narrow exception.
5. Else make it return `currentState`.
6. In the route loader, call it with `now: datetime.timestamp()` (from `@carbon/utils`). Return `deviceState` from it.
7. Delete `getWorkCenterDevice` and `WorkCenterDevice` from `operations.service.ts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no "error TS"
grep -rn "getWorkCenterDevice\|WorkCenterDevice\b" apps/mes/app
# Expected: no output
```

**Out of scope:** the `isBlocked` view the display uses.

---

## Task 12: Fix the machine time service reads

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts`

**Steps:**
1. In `getUnattributedMachineTimes`, add the default sort `{ column: "id", ascending: false }` after `{ column: "startTime", ascending: false }`.
2. In `getUnattributedMachineTime`, replace `.single()` with `.maybeSingle()`.
3. In `getMachineTimeOperationCandidates`, read this work center's operations in their own query: `.eq("workCenterId", args.workCenterId)`, `.limit(1000)`.
4. Keep the location query. Add `.neq("workCenterId", args.workCenterId)` and `.order("updatedAt", { ascending: false })` to it.
5. Merge the 2 results, this work center's first. Keep the existing ranking after the merge.
6. Replace `"(Completed,Closed,Cancelled)"` with `` `(${JOB_LOCKED_STATUSES.join(",")})` ``.
7. If `events.error` is set, return `{ data: null, error: events.error }`.
8. Remove the cast in `helper: operation.workCenter?.name ?? (operation.status as string)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no "error TS"
```

**Out of scope:** the list filters (Task 13) and the drawer (Task 14).

---

## Task 13: Add filters to the Unattributed Time list

**Depends on:** Task 12
**Files:**
- Create: `apps/erp/app/modules/production/ui/MachineTime/machine-time-filters.ee.ts` — pure filter parser.
- Create: `apps/erp/test/machine-time-filters.ee.test.ts`
- Modify: `apps/erp/app/modules/production/production.service.ts` — `getUnattributedMachineTimes` applies the parsed filters.
- Modify: `apps/erp/app/routes/x+/production+/machine-time.tsx` — loader.
- Modify: `apps/erp/app/modules/production/ui/MachineTime/MachineTimeTable.ee.tsx` — columns and filters.
- Copy from (precedent): `apps/erp/app/modules/production/ui/Jobs/ProductionEventsTable.tsx` (work center filter, `type: "static"`), `apps/erp/app/modules/inventory/ui/StockMovements/StockMovementsTable.tsx` (`type: "dateRange"`), `apps/erp/app/routes/x+/job+/$jobId.events.tsx` (`getWorkCentersList` in the loader).

The list gets 5 filters:

| Column | Filter key | Filter type | Rows kept |
|---|---|---|---|
| Work Center | `workCenterId` | `static`, options from `getWorkCentersList` | `workCenterId` in the chosen ids |
| Location | `locationId` | `static`, options from `getLocationsList` | the work center's `locationId` in the chosen ids |
| Start | `startTime` | `dateRange` | `startTime` inside the chosen company days |
| End | `endTime` | `dateRange` | `endTime` inside the chosen company days |
| State | `state` | `static`, options Running and Stopped | Running: `endTime` is null. Stopped: `endTime` is not null. |

**Steps:**
1. Create `machine-time-filters.ee.ts` with this contract:

```ts
export type MachineTimeListFilters = {
  search: string | null;
  workCenterIds: string[];
  locationIds: string[];
  /** Instants: inclusive start, exclusive end, at the company's day bounds. */
  start: { from: string | null; until: string | null };
  end: { from: string | null; until: string | null };
  state: "Running" | "Stopped" | null;
};

export function parseMachineTimeListFilters(
  searchParams: URLSearchParams,
  timeZone: string
): MachineTimeListFilters;
```

2. In `parseMachineTimeListFilters`, read the `search` param and every `filter` param (`column:operator:value`).
3. For `workCenterId` and `locationId`, split the value on `,` into ids.
4. For `startTime` and `endTime` with operator `between`, read `from,to` with `parseRangeFilter` from `~/utils/query`.
5. Turn `from` into `toZoned(parseDate(from), timeZone).toAbsoluteString()`.
6. Turn `to` into `toZoned(parseDate(to).add({ days: 1 }), timeZone).toAbsoluteString()`. The bound is exclusive.
7. For `state`, keep `Running` or `Stopped`. Ignore any other value.
8. Ignore unknown columns.
9. Write `apps/erp/test/machine-time-filters.ee.test.ts` with 4 tests:
   1. A `startTime` range in `America/Chicago` gives `from` at 05:00Z and an exclusive `until` at 05:00Z the day after `to`.
   2. An open-ended range (`2026-10-01,`) gives `until: null`.
   3. `filter=workCenterId:in:a,b` gives `workCenterIds: ["a", "b"]`.
   4. `filter=state:eq:Paused` gives `state: null`.
10. Change `getUnattributedMachineTimes(client, companyId, args)` to take `args: { filters: MachineTimeListFilters; limit; offset }`.
11. Select `*, workCenter!inner(name, locationId, location(name, timezone))`.
12. Add one exported helper in the same service file, `applyMachineTimeListFilters(query, filters)`. It applies:
    1. `search`: `.ilike("workCenter.name", \`%${search}%\`)`.
    2. `workCenterIds`: `.in("workCenterId", ids)` when not empty.
    3. `locationIds`: `.in("workCenter.locationId", ids)` when not empty.
    4. `start.from` / `start.until`: `.gte("startTime", from)` / `.lt("startTime", until)`.
    5. `end.from` / `end.until`: `.gte("endTime", from)` / `.lt("endTime", until)`.
    6. `state`: `.is("endTime", null)` for Running, `.not("endTime", "is", null)` for Stopped.
13. In `getUnattributedMachineTimes`, call `applyMachineTimeListFilters`. Then call `setGenericQueryFilters` with the limit, offset and the default sorts only, and with no `filters`.
14. In `machine-time.tsx`, read the company timezone with `getCompanyTimeZone` from `~/modules/shared/timezone.server`.
15. In `machine-time.tsx`, call `parseMachineTimeListFilters(searchParams, timeZone)`.
16. In `machine-time.tsx`, load `getWorkCentersList(client, companyId)` and `getLocationsList(client, companyId)` in the same `Promise.all`. Return both as filter options.
17. In `MachineTimeTable.ee.tsx`, take `workCenters` and `locations` props. Copy the `ProductionEventsTable` work center column:
    1. Use `accessorKey: "workCenterId"`.
    2. Show the name with `Enumerable`.
    3. Keep `meta.exportValue` returning the name.
18. Add a Location column with `id: "locationId"`, the location name as `Enumerable`, and a static filter.
19. Add `meta.filter: { type: "dateRange" }` to the Start and End columns.
20. Add a State column with `id: "state"`. Show `<Status color="green">Running</Status>` or `<Status color="blue">Stopped</Status>`. Green matches the MES dot for a running machine.
21. Give the State column a static filter with those 2 options and `isExclusive: true`. Render each option label with the same `Status`.
22. Give the Location and State columns `meta.exportValue`. The export reads a flat row field, and neither field is on the row.
23. In `MachineTimeUpgradeOverlay.ee.tsx`, pass `workCenters={[]}` and `locations={[]}`.

If the Table sends a static filter with an operator other than `in` or `eq`, STOP and report the operator. Do not guess.

**Verify:**
```bash
(cd apps/erp && pnpm exec vitest run test/machine-time-filters.ee.test.ts)
# Expected: "Tests 4 passed (4)"
pnpm exec turbo run typecheck --filter=erp
# Expected: no "error TS"
```

**Out of scope:** a duration filter. The review asked for date and column filters only.

---

## Task 14: Make the review queue match the filtered list and skip running rows

**Depends on:** Task 13
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — `getUnattributedMachineTimeNeighbors`.
- Modify: `apps/erp/app/routes/x+/production+/machine-time.$id.tsx` — loader and action.
- Modify: `apps/erp/app/modules/production/ui/MachineTime/MachineTimeTable.ee.tsx` — sorting and Review.
- Modify: `apps/erp/app/modules/production/ui/MachineTime/MachineTimeDrawer.ee.tsx` — header for a running row.
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRatesTable.tsx` (`enableSorting: false`).

**Steps:**
1. Add a `filters: MachineTimeListFilters` argument to `getUnattributedMachineTimeNeighbors`.
2. In all 4 of its queries, select `id, workCenter!inner(name, locationId)` and call `applyMachineTimeListFilters(query, filters)`.
3. In all 4 of its queries, add `.not("endTime", "is", null)`. The queue holds stopped rows only, whatever the State filter says.
4. Make it return `position: null` when the current row has no `endTime`.
5. In the drawer route's loader and action, read the company timezone. Call `parseMachineTimeListFilters` on the request URL. Pass the result.
6. In `MachineTimeTable.ee.tsx`, add `enableSorting: false` to every column.
7. In `MachineTimeTable.ee.tsx`, set `firstId` to the first row of `data` with an `endTime`.
8. In `MachineTimeDrawer.ee.tsx`, show "Running" in place of "N of M" when `queue.position` is `null`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no "error TS"
grep -c "enableSorting: false" apps/erp/app/modules/production/ui/MachineTime/MachineTimeTable.ee.tsx
# Expected: 7 or more (one per column)
```

**Out of scope:** the filters themselves (Task 13).

---

## Task 15: Polish the review drawer

**Depends on:** Task 14
**Files:**
- Modify: `apps/erp/app/modules/production/ui/MachineTime/machine-time-suggestions.ee.ts`
- Modify: `apps/erp/app/modules/production/ui/MachineTime/MachineTimeDrawer.ee.tsx`
- Modify: `apps/erp/app/modules/production/ui/MachineTime/MachineTimeTable.ee.tsx` — the duration hook.
- Modify: `apps/erp/app/shortcuts.ts`
- Modify: `apps/erp/app/routes/x+/production+/machine-time.$id.tsx` — loader error.

**Steps:**
1. In `machine-time-suggestions.ee.ts`, export `MACHINE_TIME_SUGGESTION_LIMIT = 6` and use it as the default `limit`.
2. In `shortcuts.ts`, set `choose` to `["1", "2", "3", "4", "5", "6"]`. Add a comment that it matches `MACHINE_TIME_SUGGESTION_LIMIT`.
3. In `machine-time-suggestions.ee.ts`, import `JOB_LOCKED_STATUSES` from `../../production.models` and remove `LOCKED_JOB_STATUSES`.
4. Run `apps/erp/test/machine-time-suggestions.ee.test.ts`. If it fails to import because of Lingui macros, revert step 3. Then keep the local constant with a comment that names `JOB_LOCKED_STATUSES` as the source.
5. In `MachineTimeTable.ee.tsx`, give `useMachineTimeDuration` a second formatter for a length in milliseconds: `formatPreciseDuration("1970-01-01T00:00:00.000Z", locale, ms).text`.
6. In the drawer cards, use that formatter in place of `formatDurationMilliseconds`. Remove the `formatDurationMilliseconds` import.
7. In the drawer, change the `DetailRow` comment to "Same row as the fixed asset page's DetailRow: label left, value right."
8. In the route loader, split the failure path:
   1. If `machineTime.error` is set, log it with `logger.error` and throw a redirect with the flash "Failed to load machine time".
   2. If `machineTime.data` is null, keep the flash "That machine time is no longer open".

**Verify:**
```bash
(cd apps/erp && pnpm exec vitest run test/machine-time-suggestions.ee.test.ts)
# Expected: "Tests 7 passed (7)"
pnpm exec turbo run typecheck --filter=erp
# Expected: no "error TS"
```

**Out of scope:** the `DetailRow` copies in other modules.

---

## Task 16: Move the Devices tab server code out of the route and fix its gaps

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/settings/oee-devices.server.ts` (name it `oee-devices.server.ee.ts` if `pnpm --filter @carbon/checks license-headers` requires a commercial file. It calls `@carbon/ee/oee.server`).
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — call the new module.
- Modify: `apps/erp/app/modules/settings/ui/Integrations/OeeDevices.ee.tsx` — status dot.
- Copy from (precedent): `apps/erp/app/modules/shared/timezone.server.ts` (Redis cache with `redis` from `@carbon/kv`).

**Steps:**
1. Move `getOeeDevicesTabData` into the new module unchanged. Export it.
2. Move the `upsert-work-center-device` action branch body into an exported `saveWorkCenterDeviceMapping(request, …)` in the same module. The route keeps the `if (intent === …)` line and calls it.
3. In `getOeeDevicesTabData`, cache `provider.listDevices()` in Redis for 60 seconds, keyed `oee-devices:${companyId}:${integrationId}`.
4. Do not cache a provider error.
5. In the `workCenters` query, replace `.eq("active", true)` with `.or(\`active.eq.true,id.in.(${mappedIds.join(",")})\`)`. `mappedIds` is the `workCenterId` list from `mappings`. If `mappedIds` is empty, keep `.eq("active", true)`.
6. Read `mappings` before `workCenters`, because step 5 needs it.
7. In `DeviceStatusDot`, add `tabIndex={0}` and `aria-label={labelText}` to the trigger `span`. `labelText` is a plain string version of the tooltip text.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no "error TS"
wc -l apps/erp/app/routes/x+/settings+/integrations.\$id.tsx
# Expected: fewer lines than 2472
pnpm --filter @carbon/checks license-headers < /dev/null 2>&1 | grep fixed
# Expected: "0 fixed." after a second run
```

**Out of scope:** the accounting tabs of the same route.

---

## Task 17: Update the rule, AGENTS.md files and the guide

**Depends on:** Tasks 1–16
**Files:**
- Modify: `.claude/rules/oee-provider.md`
- Modify: `apps/erp/app/modules/production/AGENTS.md`
- Modify: `packages/ee/AGENTS.md` — the `./oee` and `./oee.server` rows.
- Modify: `docs/content/docs/integrations/oee.mdx`

**Steps:**
1. In the rule, rename "The MES Machine button on a mapped work center" to "The MES Machine button". State 4 facts:
   1. A machine has one machine time.
   2. On every work center, a press ends each open Machine event from any operator or the sensor.
   3. It skips an event that starts after the press.
   4. On a mapped work center, the press also ends running unattributed time and sets `lastManualChangeAt`.
2. In the rule, under "The sync", state 4 facts:
   1. `lastEventAt` is the newest stored `changedAt`.
   2. The sync logs a late event at or before `appliedThrough`. It does not replan it.
   3. A `system` event on a Canceled operation closes at the operation's `updatedAt`.
   4. `OeeProviderUnavailableError` stops the run, and `singleton` skips an overlapping run.
3. In the rule, under "The loaded operation", add the unload on a work center move.
4. In the rule, add the composite FKs of Task 1 next to the `workCenterDevice` FK paragraph.
5. In the rule, add the ignored load-pointer columns of Task 3.
6. In the rule, under "Unattributed machine time", state 4 facts about the list and the queue:
   1. The list has 5 filters: work center, location, start date, end date and state. Name `parseMachineTimeListFilters` and `applyMachineTimeListFilters`.
   2. The route turns each date range into company day bounds. The service does not pass them to the generic `between` filter.
   3. The queue holds stopped rows only. It honors the list's search and filters.
   4. The list has no column sort.
7. In the rule's Files table, name `createOeeProvider` (registry), `oee-sync-device.database.test.ts` and `machine-time-filters.ee.ts`.
8. In `packages/ee/AGENTS.md`, add `OeeProviderUnavailableError`, `DEFAULT_MINIMUM_STATE_SECONDS` and `createOeeProvider`.
9. In the guide, state that the work center display hides the device state after 10 minutes with no sync.
10. In the guide, state that a running row is outside the review queue until the machine stops.
11. In the guide, list the 5 filters of Production → Unattributed Time.
12. In the guide's MES section, state that a machine has one machine time.
13. In the guide's MES section, state that a Machine press ends every open Machine timer on that work center.
14. In `apps/erp/app/modules/production/AGENTS.md`, add the 5 filters and the 2 filter functions to the unattributed machine time paragraph.

**Verify:**
```bash
grep -n "OeeProviderUnavailableError\|createOeeProvider" .claude/rules/oee-provider.md packages/ee/AGENTS.md
# Expected: at least one hit in each file
pnpm --filter docs typecheck
# Expected: exit 0
```

**Out of scope:** the spec. Its divergence list already points to the rule.

---

## Task 18: Verify in the browser

**Depends on:** Task 17
**Files:** none

**Steps:**
1. Ask the human to restart their `crbn up` if the ERP returns 502. Do not restart it yourself.
2. Run the `/test` skill on this branch with these checks:
   1. Production → Unattributed Time: the columns have no sort control.
   2. Production → Unattributed Time: Review opens the newest stopped row.
   3. Search "CNC" in the list, then open Review: `j` / `k` move only through rows whose work center matches.
   4. In the review drawer, a running row shows "Running" in place of "N of M".
   5. Settings → Integrations → Sense → Devices: a station mapped to an inactive work center shows that work center's name.
   6. On the Devices tab, two picks in a row make one Sense call, not two. Check the ERP log.
   7. MES work center display: set `lastSyncedAt` more than 10 minutes back with `UPDATE "workCenterDevice"` in the container. Expect the device state to hide.
   8. Unattributed Time filters: filter by work center, by location, by a start date range, and by State = Stopped. Expect the rows and the count to match each filter.
   9. Set a start date range of one day. Expect every row that started on that day in the company's timezone, its last hour too.
   10. With a filter set, open Review. Expect `j` / `k` and "N of M" to cover only the filtered, stopped rows.
   11. MES: two operators start Machine on the same work center one after the other. Expect the first operator's Machine timer to end when the second starts.
3. Take a screenshot at 1440 px of the drawer and the Devices tab.

**Verify:**
```bash
ls .ai/playbooks/ | grep -i oee
# Expected: the /test skill updated or wrote an OEE playbook
```

**Out of scope:** the Must-fix items. `5bb79d0b1a` already verified them.
