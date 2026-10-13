# OEE Provider integration (Sense) — implementation plan

**Spec:** .ai/specs/2026-10-12-oee-provider-integration.md
**Research:** .ai/research/oee-provider-integration.md
**Closest sibling:** accounting providers (provider class), Rillet (API-key descriptor), Ramp (role-targeted polling), Account Mapping (Devices tab), Production → Batches (list page), job events (assign drawer)
**Branch:** find-oee-job-operation-transcript

## Progress

- [x] Task 1: Write the schema migration
- [x] Task 2: Add the interceptors, attachments and authz rules
- [x] Task 3: Apply, ship the generated migration, regenerate types
- [x] Task 4: Test the load and unload interceptors in SQL
- [x] Task 5: Add the shared device lock in `@carbon/database`
- [x] Task 6: Widen the provider role to `oee`
- [x] Task 7: Write the OEE types and the attribution engine with tests
- [x] Task 8: Write the Sense adapter with tests
- [x] Task 9: Register Sense and write the OEE server functions
- [x] Task 10: Write the sweep and sync Inngest functions
- [x] Task 11: Add the Devices tab to the integration drawer
- [x] Task 12: Add the Unattributed Machine Time list and drawer
- [x] Task 13: Apply the manual-press rules in MES
- [x] Task 14: Show the device state and the loaded operation in MES
- [x] Task 15: Write the docs, the rule and the AGENTS.md updates
- [x] Task 16: Run the gates and verify in the browser

## Dependencies

- Task 2 needs Task 1. Task 3 needs Tasks 1 and 2. Task 4 needs Task 3.
- Task 5 needs Task 3 (types).
- Tasks 6, 7 and 8 need nothing and can run in parallel with Tasks 1–5.
- Task 8 needs Task 7 (the `OeeProvider` type).
- Task 9 needs Tasks 3, 6, 7 and 8.
- Task 10 needs Tasks 5 and 9.
- Tasks 11 and 12 need Task 9. They are independent of each other.
- Task 13 needs Task 5. Task 14 needs Task 3. Tasks 13 and 14 are independent of Tasks 10–12.
- Task 15 can run after Task 9. Task 16 runs last.

## Conventions for every task

- Start every new source file with its SPDX header. Run `pnpm license:headers -- <paths>` after you create files.
- Files under `packages/ee/` and files named `*.ee.tsx` get the commercial header. All others get AGPL.
- Never use JS `Date` for parsing or arithmetic. One exception: `Date.parse` to compare two UTC instants (`.claude/rules/date-handling.md` → "Narrow exception").
- Kysely returns `timestamptz` as a JS `Date`. Normalize it to an ISO string before you compare it or pass it on.
- Mark every user-facing string with Lingui (`t` / `<Trans>` from `@lingui/react/macro`, `msg` for breadcrumbs).

---

## Task 1: Write the schema migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_oee-provider.sql` (from the command below)
- Copy from (precedent): `packages/database/supabase/migrations/20260924133915_integration-provider-role.sql` (role CHECK and trigger), `packages/database/supabase/migrations/20260905132037_job-operation-batching.sql` lines 74–127 (the two views)

**Steps:**
1. Run `pnpm db:migrate:new oee-provider`.
2. Paste the SQL below into the new file.
3. Replace the view placeholder with lines 74–127 of `20260905132037_job-operation-batching.sql`, copied verbatim.

```sql
-- OEE provider integration (spec: .ai/specs/2026-10-12-oee-provider-integration.md)

-- 1. Provider role 'oee'
ALTER TABLE "integration" DROP CONSTRAINT IF EXISTS "integration_providerRole_check";
ALTER TABLE "integration" ADD CONSTRAINT "integration_providerRole_check"
  CHECK ("providerRole" IS NULL OR "providerRole" IN ('accounting', 'spend', 'oee'));

-- Forked from 20260924133915_integration-provider-role.sql. One change: the
-- 'oee' role may have several active integrations per company.
CREATE OR REPLACE FUNCTION public.check_single_active_provider_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_conflict TEXT;
BEGIN
  IF NEW."active" IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."active" IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT "providerRole" INTO v_role FROM "integration" WHERE id = NEW."id";
  IF v_role IS NULL THEN
    RETURN NEW;
  END IF;

  -- Several OEE providers may be active at once. The one-device-per-work-center
  -- rule lives on "workCenterDevice" instead.
  IF v_role = 'oee' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      NEW."companyId" || E'\x1f' || 'providerRole' || E'\x1f' || v_role, 0
    )
  );

  SELECT ci."id" INTO v_conflict
  FROM "companyIntegration" ci
  JOIN "integration" i ON i.id = ci."id"
  WHERE ci."companyId" = NEW."companyId"
    AND ci."active" IS TRUE
    AND ci."id" <> NEW."id"
    AND i."providerRole" = v_role
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION
      'Only one active % integration is allowed per company; % is already active',
      v_role, v_conflict
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

INSERT INTO "integration" ("id", "jsonschema")
VALUES ('sense', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;

UPDATE "integration" SET "providerRole" = 'oee'
  WHERE "id" = 'sense' AND "providerRole" IS DISTINCT FROM 'oee';

-- 2. Loaded operation (community)
ALTER TABLE "workCenter"
  ADD COLUMN IF NOT EXISTS "loadedJobOperationId" TEXT REFERENCES "jobOperation"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "loadedAt" TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS "workCenter_loadedJobOperationId_idx"
  ON "workCenter" ("loadedJobOperationId");

-- 3. Machine state
DO $$ BEGIN
  CREATE TYPE "machineState" AS ENUM ('Running', 'Idle', 'Down', 'Offline');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "unattributedMachineTimeStatus" AS ENUM ('Open', 'Assigned', 'Dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "workCenterDevice" (
  "id" TEXT NOT NULL DEFAULT id('wcd'),
  "companyId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "integration" TEXT NOT NULL REFERENCES "integration"("id"),
  "externalDeviceId" TEXT NOT NULL,
  "externalSiteId" TEXT,
  "siteTimezone" TEXT,
  "deviceName" TEXT NOT NULL,
  "currentState" "machineState",
  "currentStateAt" TIMESTAMP WITH TIME ZONE,
  "appliedThrough" TIMESTAMP WITH TIME ZONE,
  "lastEventAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "lastManualChangeAt" TIMESTAMP WITH TIME ZONE,
  "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
  "lastSyncError" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "workCenterDevice_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "workCenterDevice_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCenterDevice_workCenter_key" UNIQUE ("workCenterId", "companyId"),
  CONSTRAINT "workCenterDevice_device_key" UNIQUE ("integration", "externalDeviceId", "companyId")
);

CREATE INDEX IF NOT EXISTS "workCenterDevice_companyId_idx" ON "workCenterDevice" ("companyId");
CREATE INDEX IF NOT EXISTS "workCenterDevice_integration_idx" ON "workCenterDevice" ("integration");
CREATE INDEX IF NOT EXISTS "workCenterDevice_createdBy_idx" ON "workCenterDevice" ("createdBy");

CREATE TABLE IF NOT EXISTS "machineStateChange" (
  "id" TEXT NOT NULL DEFAULT id('msc'),
  "companyId" TEXT NOT NULL,
  "workCenterDeviceId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "externalEventId" TEXT NOT NULL,
  "state" "machineState" NOT NULL,
  "changedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "machineStateChange_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "machineStateChange_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "machineStateChange_event_key"
    UNIQUE ("workCenterDeviceId", "externalEventId", "companyId")
);

CREATE INDEX IF NOT EXISTS "machineStateChange_companyId_idx" ON "machineStateChange" ("companyId");
CREATE INDEX IF NOT EXISTS "machineStateChange_workCenter_changedAt_idx"
  ON "machineStateChange" ("workCenterId", "changedAt");
CREATE INDEX IF NOT EXISTS "machineStateChange_device_changedAt_idx"
  ON "machineStateChange" ("workCenterDeviceId", "changedAt");

CREATE TABLE IF NOT EXISTS "unattributedMachineTime" (
  "id" TEXT NOT NULL DEFAULT id('umt'),
  "companyId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "startTime" TIMESTAMP WITH TIME ZONE NOT NULL,
  "endTime" TIMESTAMP WITH TIME ZONE,
  "status" "unattributedMachineTimeStatus" NOT NULL DEFAULT 'Open',
  "productionEventId" TEXT REFERENCES "productionEvent"("id") ON DELETE SET NULL,
  "dismissReason" TEXT,
  "resolvedBy" TEXT REFERENCES "user"("id"),
  "resolvedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "unattributedMachineTime_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "unattributedMachineTime_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "unattributedMachineTime_dismiss_check"
    CHECK ("status" <> 'Dismissed' OR "dismissReason" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "unattributedMachineTime_companyId_idx" ON "unattributedMachineTime" ("companyId");
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_workCenterId_idx" ON "unattributedMachineTime" ("workCenterId");
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_productionEventId_idx" ON "unattributedMachineTime" ("productionEventId");
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_createdBy_idx" ON "unattributedMachineTime" ("createdBy");
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_open_idx"
  ON "unattributedMachineTime" ("companyId", "workCenterId") WHERE "status" = 'Open';

-- 4. The engine reads the open events of one work center
CREATE INDEX IF NOT EXISTS "productionEvent_workCenterId_open_idx"
  ON "productionEvent" ("workCenterId") WHERE "endTime" IS NULL;

-- 5. Re-declare the work-center views so wc.* includes the new columns.
-- DROP first, not CREATE OR REPLACE: the new wc.* columns expand before
-- "locationName". Forked verbatim from 20260905132037_job-operation-batching.sql.
-- <paste lines 74-127 of 20260905132037_job-operation-batching.sql here>
```

4. Do not write any `CREATE POLICY`, `attach_event_trigger` or handler function. Task 2 owns those.

**Verify:**
```bash
grep -c "CREATE POLICY\|attach_event_trigger" packages/database/supabase/migrations/*_oee-provider.sql
# Expected: 0
grep -c 'DROP VIEW IF EXISTS "workCenters' packages/database/supabase/migrations/*_oee-provider.sql
# Expected: 2
```

**Out of scope:** the `integration` view, any other work-center view, data backfills.

---

## Task 2: Add the interceptors, attachments and authz rules

**Depends on:** Task 1
**Files:**
- Create: `packages/database/src/event-system/handlers/sync_load_work_center_operation.sql`
- Create: `packages/database/src/event-system/handlers/sync_unload_work_center_operation.sql`
- Modify: `packages/database/src/event-system/attachments.ts` — `productionEvent`, `jobOperation`, two new entries
- Modify: `packages/database/src/authz/manifest.ts` — three new entries
- Copy from (precedent): `packages/database/src/event-system/handlers/sync_set_job_operation_in_progress.sql`

**Steps:**
1. Create `sync_load_work_center_operation.sql` with this body:

```sql
CREATE OR REPLACE FUNCTION public.sync_load_work_center_operation(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- Only a starting event loads: an event inserted with an endTime (an ERP
  -- entry, an assigned interval, a closed sensor run) never does.
  IF (p_new->>'endTime') IS NOT NULL OR (p_new->>'workCenterId') IS NULL THEN
    RETURN;
  END IF;

  UPDATE "workCenter"
  SET "loadedJobOperationId" = p_new->>'jobOperationId',
      "loadedAt" = (p_new->>'startTime')::timestamptz
  WHERE "id" = p_new->>'workCenterId'
    AND ("loadedAt" IS NULL OR "loadedAt" <= (p_new->>'startTime')::timestamptz)
    AND "loadedJobOperationId" IS DISTINCT FROM p_new->>'jobOperationId';
END;
$function$;
```

2. Create `sync_unload_work_center_operation.sql` with this body:

```sql
CREATE OR REPLACE FUNCTION public.sync_unload_work_center_operation(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'status') NOT IN ('Done', 'Canceled') THEN RETURN; END IF;
  IF (p_old->>'status') = (p_new->>'status') THEN RETURN; END IF;

  UPDATE "workCenter"
  SET "loadedJobOperationId" = NULL,
      "loadedAt" = NULL
  WHERE "loadedJobOperationId" = p_new->>'id';
END;
$function$;
```

3. In `attachments.ts`, add `after: ["sync_load_work_center_operation"]` to the `productionEvent` entry. Keep its `before`.
4. In `attachments.ts`, append `"sync_unload_work_center_operation"` to the `after` array of the `jobOperation` entry.
5. In `attachments.ts`, add these two entries in alphabetical order:

```ts
unattributedMachineTime: { statement: ["broadcast_table_changes"] },
workCenterDevice: { statement: ["broadcast_table_changes"] },
```

6. In `manifest.ts`, add these three entries in alphabetical order:

```ts
machineStateChange: company("production"),
unattributedMachineTime: company("production"),
workCenterDevice: company("resources"),
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: Tasks: 1 successful
```

**Out of scope:** `sync_finish_job_operation`, `sync_set_job_operation_in_progress`. Do not edit either handler.

---

## Task 3: Apply, ship the generated migration, regenerate types

**Depends on:** Tasks 1, 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_oee-provider-rls.sql` (generated — never edit)
- Modify: `packages/database/src/types.ts` (generated)
- Modify: `packages/database/src/swagger-docs-schema.ts` (generated)

**Steps:**
1. Run `pnpm db:migrate`. It applies Task 1 and syncs the authz rules and handlers locally.
2. Run `pnpm --filter @carbon/database authz migration oee-provider-rls`.
3. Run `pnpm run generate:types`.
4. If `pnpm db:migrate` fails on the role CHECK, STOP and report. Do not edit migration `20260924133915`.

**Verify:**
```bash
grep -c '"workCenterDevice"\|"machineStateChange"\|"unattributedMachineTime"' packages/database/src/types.ts
# Expected: a number greater than 6
grep -c "loadedJobOperationId" packages/database/src/types.ts
# Expected: a number greater than 2 (table plus the two views)
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all tests pass
```

**Out of scope:** `pnpm db:check:backups` and `pnpm db:check:datasets` run in Task 16.

---

## Task 4: Test the load and unload interceptors in SQL

**Depends on:** Task 3
**Files:**
- Create: `packages/database/supabase/tests/work-center-loaded-operation.test.sql`
- Copy from (precedent): `packages/database/supabase/tests/job-completion-terminal-operations.test.sql` (its `pg_temp.make_job` and `pg_temp.add_operation` fixtures, the header and the `ROLLBACK`)

**Steps:**
1. Copy the header, the `BEGIN;` and the fixture functions from the precedent.
2. Create one work center for the fixture company.
3. Create one job with two operations, A and B, on that work center.
4. Assert each case below inside one `DO $cases$` block with `ASSERT`:
   1. Insert an open Setup event on A at 10:00. `loadedJobOperationId` is A and `loadedAt` is 10:00.
   2. Insert a Machine event on B with `startTime` 09:00 and `endTime` 09:30. The work center still loads A.
   3. Insert an open Labor event on B at 09:50. The work center still loads A (older start).
   4. Insert an open Labor event on B at 10:10. The work center loads B.
   5. Set B to `Done`. `loadedJobOperationId` and `loadedAt` are NULL.
   6. Insert a temporary `integration` row `oee-test` with `providerRole = 'oee'`. Activate `sense` and `oee-test` for the company. Both activations succeed.
   7. Activate two integrations with `providerRole = 'accounting'` for the company. The second one raises SQLSTATE `23505`.
5. End with `RAISE NOTICE 'ALL work-center-loaded-operation TESTS PASSED';` and `ROLLBACK;`.

**Verify:**
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/work-center-loaded-operation.test.sql
# Expected: NOTICE:  ALL work-center-loaded-operation TESTS PASSED
```

If the precedent fixtures need columns that changed since they were written, STOP and report — do not improvise.

**Out of scope:** tests for the sync job. Task 7 covers its rules.

---

## Task 5: Add the shared device lock in `@carbon/database`

**Depends on:** Task 3
**Files:**
- Create: `packages/database/src/machine-time.ts` (AGPL)
- Modify: `packages/database/package.json` — add `"./machine-time": "./src/machine-time.ts"` next to `"./quality"`
- Copy from (precedent): `lockIssueDispositions` in `packages/database/src/quality.ts:1481`

**Steps:**
1. Create `machine-time.ts` with these two exports:

```ts
import type { KyselyTx } from "./client";

export async function lockWorkCenterDevice(
  trx: KyselyTx,
  args: { workCenterId: string; companyId: string }
) {
  return trx
    .selectFrom("workCenterDevice")
    .selectAll()
    .where("workCenterId", "=", args.workCenterId)
    .where("companyId", "=", args.companyId)
    .forUpdate()
    .executeTakeFirst();
}

/**
 * An operator pressed Machine Start or Stop on a work center. If the work
 * center has a device, end its open Machine events at the press time and
 * record the press, so an older sensor change never undoes it.
 */
export async function recordManualMachinePress(
  trx: KyselyTx,
  args: { workCenterId: string; companyId: string; userId: string; pressedAt: string }
): Promise<{ mapped: boolean; endedEventIds: string[] }> {
  const device = await lockWorkCenterDevice(trx, args);
  if (!device) return { mapped: false, endedEventIds: [] };

  const ended = await trx
    .updateTable("productionEvent")
    .set({ endTime: args.pressedAt, updatedBy: args.userId, updatedAt: args.pressedAt })
    .where("workCenterId", "=", args.workCenterId)
    .where("companyId", "=", args.companyId)
    .where("type", "=", "Machine")
    .where("endTime", "is", null)
    .returning("id")
    .execute();

  await trx
    .updateTable("workCenterDevice")
    .set({ lastManualChangeAt: args.pressedAt, updatedBy: args.userId, updatedAt: args.pressedAt })
    .where("id", "=", device.id)
    .where("companyId", "=", args.companyId)
    .execute();

  return { mapped: true, endedEventIds: ended.map((row) => row.id) };
}
```

2. If `KyselyTx` is not exported from `./client`, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: Tasks: 1 successful
```

**Out of scope:** any MES change. Task 13 calls these functions.

---

## Task 6: Widen the provider role to `oee`

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/types.ts:220` — `providerRole?: "accounting" | "spend" | "oee";`
- Modify: `packages/ee/src/index.ts:118` — `export type ProviderRole = "accounting" | "spend" | "oee";`
- Modify: `packages/ee/src/sync/topology.ts:26` — `export type ProviderRole = "accounting" | "spend" | "oee";`
- Modify: `packages/ee/src/integrations/secrets.ts` — add `sense: ["apiKey"],` to `SECRET_KEYS`
- Modify: `packages/checks/src/conformance/no-integration-id-branching.ts` — add `"sense"` to `INTEGRATION_IDS` and to the provider-directory regex in `EXCLUDED`
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx:695` and `:1893`, `apps/erp/app/modules/settings/ui/Integrations/IntegrationCard.tsx:87`, `apps/erp/app/routes/api+/integrations.$id.connect.ts:56` — add `| "oee"` to each inline role cast

**Steps:**
1. Make the six edits above.
2. In `integrations.$id.tsx` (about line 706), change `producesSyncOperations` to `providerRole !== undefined && providerRole !== "oee" && integrationData.data.active`.
3. In `IntegrationCard.tsx` (lines 86–90), skip the `roleIncumbent` lookup when `providerRole === "oee"`.
4. In `integrations.$id.tsx` (lines 1908–1915), add `"sense"` on its own line to `FORM_SECRET_INTEGRATIONS`.
5. Do not change `packages/ee/src/__tests__/provider-role.test.ts`. Its regex ignores `oee`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: Tasks: 1 successful
pnpm --filter @carbon/checks exec vitest run src/conformance/no-integration-id-branching
# Expected: all tests pass
```

**Out of scope:** `buildIntegrationTopology`. It picks only `accounting` and `spend`, so leave it.

---

## Task 7: Write the OEE types and the attribution engine with tests

**Depends on:** none
**Files:**
- Create: `packages/ee/src/oee/types.ts`
- Create: `packages/ee/src/oee/engine.ts`
- Create: `packages/ee/src/oee/engine.test.ts`
- Create: `packages/ee/src/oee/index.ts` — `export * from "./types"; export * from "./engine";`
- Modify: `packages/ee/package.json` — add `"./oee": "./src/oee/index.ts"`
- Copy from (precedent): `packages/ee/src/ramp/config.test.ts` (test file shape)

**Steps:**
1. Write `types.ts` with the types from spec section 1: `MachineState`, `OeeDevice`, `OeeStateChange`, `OeeProvider`. Add `export type OeeProviderId = "sense";`.
2. Write `engine.ts` with no imports outside `./types`. Export these types and `planMachineTime`:

```ts
export type StoredStateChange = { changedAt: string; state: MachineState };

export type PlanMachineTimeInput = {
  now: string;
  minimumStateSeconds: number;
  mappedAt: string;
  currentState: MachineState | null;
  currentStateAt: string | null;
  lastManualChangeAt: string | null;
  loadedJobOperationId: string | null;
  loadedAt: string | null;
  isBlocked: boolean;
  openMachineEvent: { id: string; startTime: string } | null;
  openUnattributed: { id: string; startTime: string } | null;
  lastMachineEventEndTime: string | null;
  /** Stored changes after appliedThrough, ascending by changedAt. */
  changes: StoredStateChange[];
};

export type MachineTimeWrite =
  | { kind: "insertMachineEvent"; jobOperationId: string; startTime: string; endTime: string | null }
  | { kind: "closeMachineEvent"; productionEventId: string; endTime: string }
  | { kind: "insertUnattributed"; startTime: string; endTime: string | null }
  | { kind: "closeUnattributed"; unattributedId: string; endTime: string };

export type PlanMachineTimeResult = {
  writes: MachineTimeWrite[];
  currentState: MachineState | null;
  currentStateAt: string | null;
  /** changedAt of the last consumed change; null when nothing was consumed. */
  appliedThrough: string | null;
};
```

3. Implement `planMachineTime` with these rules, in this order. Compare instants with `Date.parse`.
   1. Keep two local slots: `openEvent` and `openUnattr`. Each holds `{ id?: string; startTime: string; jobOperationId?: string }`. Seed them from the input.
   2. **First sync.** If `currentState` is null, split `changes` at `mappedAt`. Take the last change at or before `mappedAt` as the seed. Apply it at `mappedAt` with rule 4. Keep only the changes after `mappedAt`.
   3. **Debounce.** For each change, its duration ends at the next change, or at `now` for the last one. If the duration is under `minimumStateSeconds` and a next change exists, drop it and consume it. If it is the last change, stop and leave it pending.
   4. **Apply** `(state, at)`: set the local state and `stateAt = at`, unless the state equals the current state. If `lastManualChangeAt` is set and `at <= lastManualChangeAt`, change no slot.
      - `Running`: if `openEvent` or `openUnattr` is set, do nothing. If not blocked, an operation is loaded and `loadedAt <= at`, open `openEvent` on it. Otherwise open `openUnattr`.
      - `Idle`, `Down`, `Offline`: close `openEvent` and `openUnattr` at `at`. Skip a close where `at <= startTime`.
   5. **Close** a slot: if it has an `id`, push `closeMachineEvent` or `closeUnattributed`. If it has no `id`, push an insert with `endTime = at`.
   6. **Steady state.** After the loop: the state is `Running`, `stateAt > lastManualChangeAt` (or no press), and both slots are empty. Open time at `max(stateAt, lastMachineEventEndTime)` with the `Running` branch of rule 4.
   7. Push an insert with `endTime: null` for each new slot still open.
   8. Return the writes, the state, `stateAt` and the `changedAt` of the last consumed change.
4. Write `engine.test.ts` with one `it` per case. Use fixed ISO strings and `minimumStateSeconds: 60`.
   1. Running with A loaded since before → one open `insertMachineEvent` on A.
   2. Running at 10:00, Idle at 10:30 → one `insertMachineEvent` 10:00–10:30.
   3. Idle with an existing open event → `closeMachineEvent`.
   4. Running with nothing loaded → open `insertUnattributed`.
   5. Running while blocked → open `insertUnattributed`.
   6. Running at 10:00, `loadedAt` 10:05 → open `insertUnattributed`.
   7. Override example: event open since 10:00, press Stop 10:03 (event closed, `lastManualChangeAt` 10:03), changes Idle 11:00 and Running 11:05 → one open `insertMachineEvent` from 11:05.
   8. A change at 10:02 with `lastManualChangeAt` 10:03 → no writes.
   9. Running 10:00, Idle 10:20:00, Running 10:20:30, Idle 11:00 → one event 10:00–11:00.
   10. Last change 30 s before `now` → no writes and `appliedThrough` before it.
   11. First sync: Running at 09:00, mapping at 10:00 → open event from 10:00.
   12. Steady state: Running since 09:00, nothing loaded, no slots, last event end 10:00 → open unattributed from 10:00.
   13. Steady state with `lastManualChangeAt` 10:03 after `stateAt` 09:00 → no writes.
   14. Down and Offline each close an open event.
   15. Running with an open manual event → no writes.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/oee/engine.test.ts
# Expected: 15 passed
```

**Out of scope:** database reads and writes. Task 10 applies the writes.

---

## Task 8: Write the Sense adapter with tests

**Depends on:** Task 7
**Files:**
- Create: `packages/ee/src/sense/provider.ts`
- Create: `packages/ee/src/sense/provider.test.ts`
- Copy from (precedent): `packages/ee/src/accounting/providers/rillet/provider.ts:421-503` (host by environment, bearer header)

**Steps:**
1. Before writing code, run this request once to confirm the date format. Expect HTTP 200.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -G "http://bifrost-staging.sensemfg.com/v1/public/companies/sites/87c419ff-42b5-4429-b54d-72a50a7dac99/stations/e1c19226-06ed-4073-8c78-373e9a4816f9/events" \
  -H "Authorization: Bearer $SENSE_API_KEY" \
  --data-urlencode "start_datetime=2026-10-12T00:00:00.000Z" --data-urlencode "end_datetime=2026-10-12T12:00:00.000Z" \
  --data-urlencode "order=asc" --data-urlencode "limit=500" --data-urlencode "offset=0"
```

2. If the request does not return 200, STOP and report. (Verified 2026-10-13: Sense ignores `offset`, and `offset=0` returns 400. Steps 11–13 page by time for that reason.) Ask the user for `SENSE_API_KEY`; never commit it.
3. Write `class SenseProvider implements OeeProvider` with `id = "sense" as const`.
4. Use the constructor args `{ apiKey: string; environment: "production" | "staging" }`. Production is `https://bifrost.sensemfg.com`. Staging is `http://bifrost-staging.sensemfg.com`.
5. Write a private `get<T>(path, query)`. It calls `fetch` with `Authorization: Bearer <apiKey>` and `signal: AbortSignal.timeout(15_000)`.
6. If the response is not OK, throw `SenseApiError(status, body text)`. Export that class.
7. `validate()` calls `GET /v1/public/companies/sites`. It returns `{ valid: true }`, or `{ valid: false, error }` on any throw.
8. `listDevices()` calls `GET /v1/public/companies/stations` and `GET /v1/public/companies/sites` in parallel. It joins each station to its site by `site_id`.
9. Map each station: `id`→`externalDeviceId`, `machine_name`→`name`, `site_id`→`externalSiteId`, the site's `name`→`siteName` and `timezone`→`siteTimezone`, `machine_manufacturer`→`manufacturer`, `machine_model`→`model`, `machine_type`→`machineType`.
10. Map `last_calibration_attempt_status` to `calibrated`: `"CALIBRATED"` → true, null → null, any other value → false.
11. `listStateChanges(device, window)` calls `GET /v1/public/companies/sites/{site}/stations/{station}/events` with `start_datetime`, `end_datetime`, `order=asc` and `limit=500`. Never send `offset`.
12. Page by time. If a page has 500 events, request again from the last event's `created_at`.
13. Drop events whose `id` was already returned. Stop when a page has fewer than 500 events or adds no new event.
14. If `externalSiteId` is null, throw `SenseApiError(0, "Station has no site")`.
15. Map `status` with this allowlist: `Active`→`Running`, `Idle`→`Idle`, `Alert`→`Down`, `Offline`→`Offline`. Throw `SenseApiError(0, "Unknown Sense status: <value>")` for any other value.
16. Return `{ externalEventId: event.id, state, changedAt: event.created_at }`.
17. Write `provider.test.ts` with `vi.stubGlobal("fetch", …)`. Cover four cases:
    1. The status allowlist maps all four values.
    2. An unknown status throws `SenseApiError`.
    3. A full page of 500 events, then a page that repeats the last event plus 3 new ones, make exactly 2 calls and return 503 changes. The second call starts at the last event's `created_at` and sends no `offset`.
    4. `listDevices` joins the site name and timezone.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/sense/provider.test.ts
# Expected: 4 passed
```

**Out of scope:** telemetry, calibration and partner endpoints.

---

## Task 9: Register Sense and write the OEE server functions

**Depends on:** Tasks 3, 6, 7, 8
**Files:**
- Create: `packages/ee/src/sense/config.tsx`
- Create: `packages/ee/src/sense/hooks.server.ts`
- Create: `packages/ee/src/oee/registry.ts`
- Create: `packages/ee/src/oee/service.server.ts`
- Modify: `packages/ee/src/index.ts` — import and add `Sense` to `integrations`; `export { Sense } from "./sense/config";`
- Modify: `packages/ee/src/hooks.server.ts` — add `sense: { onHealthcheck: senseHealthcheck },`
- Modify: `packages/ee/package.json` — add `"./oee.server": "./src/oee/service.server.ts"` and `"./sense/hooks.server": "./src/sense/hooks.server.ts"`
- Copy from (precedent): `packages/ee/src/rillet/config.tsx`, `packages/ee/src/rillet/hooks.server.ts`, `packages/ee/src/rules/service.server.ts:90` (`requireEntitlement` call)

**Steps:**
1. Write `config.tsx` from the Rillet descriptor. Use `id: "sense"`, `name: "Sense"`, `category: "Machine Monitoring"` and `providerRole: "oee" as const`.
2. Give it 3 settings in one group, "Connection":
   - `apiKey`: `type: "secret"`, required.
   - `environment`: `type: "options"`. Production (`bifrost.sensemfg.com`) and Staging (`bifrost-staging.sensemfg.com — testing only, plain HTTP`). Default `production`.
   - `minimumStateSeconds`: `type: "number"`, default `60`.
3. Use this schema: `z.object({ apiKey: z.string(), environment: z.enum(["production", "staging"]).default("production"), minimumStateSeconds: z.coerce.number().int().min(0).default(60) })`.
4. Write `SetupInstructions`: "Create a company API key in Sense, paste it below, then map each station on the Devices tab."
5. Write `registry.ts`:

```ts
import { SenseProvider } from "../sense/provider";
import type { OeeProvider } from "./types";

type OeeProviderFactory = (args: { apiKey: string; environment: string }) => OeeProvider;

export const OEE_PROVIDERS: Record<string, OeeProviderFactory> = {
  sense: (args) =>
    new SenseProvider({
      apiKey: args.apiKey,
      environment: args.environment === "staging" ? "staging" : "production"
    })
};
```

6. Write `service.server.ts` with these exports. Every write takes `client` first and `db: Kysely<KyselyDatabase>` second, and returns `{ data, error }`.
   - `getOeeProvider(serviceClient, companyId, integrationId)` → `{ data: { provider: OeeProvider; minimumStateSeconds: number } | null; error: string | null }`.
     1. If `companyHasFeature(serviceClient, companyId, { feature: "INTEGRATIONS" })` is false, return the error `"Not entitled"`.
     2. Read `companyIntegration` (`metadata`, `secretRef`, `active`) for the company and integration.
     3. Run `resolveIntegrationSecrets(serviceClient, companyId, integrationId, metadata, secretRef)`.
     4. Look up `OEE_PROVIDERS[integrationId]`. If it is missing, or `metadata.apiKey` is empty, return an error.
     5. Build the provider. Read `minimumStateSeconds` from metadata (default 60).
   - `upsertWorkCenterDevice(client, db, { companyId, userId, integration, externalDeviceId, externalSiteId, siteTimezone, deviceName, workCenterId })`.
     1. Call `requireEntitlement(client, companyId, "INTEGRATIONS")`.
     2. In one transaction, read the row for `(integration, externalDeviceId, companyId)`.
     3. If its `workCenterId` already equals the input, return it unchanged.
     4. Read the row of the target work center. If it belongs to another device, return the error `"<work center> already has <deviceName> from <integration>"`.
     5. Delete the old row of this device, then insert a new one with `createdBy = userId`. A remap starts fresh: new `createdAt`, null state.
   - `deleteWorkCenterDevice(client, db, { companyId, integration, externalDeviceId })` calls `requireEntitlement`, then deletes the row.
   - `assignUnattributedMachineTime(client, db, { companyId, userId, unattributedMachineTimeId, jobOperationId })`.
     1. Call `requireEntitlement`.
     2. In one transaction, lock the row with `forUpdate()`. Require `status = 'Open'` and a non-null `endTime`.
     3. Read the operation. Require the same `companyId` and a status that is not `Done` or `Canceled`.
     4. Insert a `productionEvent` with `type: "Machine"`, the row's `workCenterId`, `startTime` and `endTime`, `employeeId: null` and `createdBy: userId`. Return its `id`.
     5. Set the row to `Assigned` with `productionEventId`, `resolvedBy`, `resolvedAt`, `updatedBy` and `updatedAt`. Use `datetime.timestamp()` for the times.
   - `dismissUnattributedMachineTime(client, db, { companyId, userId, unattributedMachineTimeId, dismissReason })` calls `requireEntitlement`. It requires `status = 'Open'`, then sets `Dismissed`, the reason, `resolvedBy` and `resolvedAt`.
   - Wrap each body in `try/catch`. Return `{ data: null, error: message }` on failure, and let `EntitlementError` propagate.
7. Write `hooks.server.ts`. `senseHealthcheck(companyId, metadata)` builds the provider from `metadata.apiKey` and `metadata.environment` through `OEE_PROVIDERS.sense`. It returns `{ healthy: valid, reason: error }`.
8. Run `pnpm license:headers -- packages/ee/src/oee packages/ee/src/sense`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: Tasks: 1 successful
pnpm --filter @carbon/ee test
# Expected: all tests pass
```

**Out of scope:** any route. `config.tsx` must not import a `.server` module (`packages/ee/AGENTS.md`).

---

## Task 10: Write the sweep and sync Inngest functions

**Depends on:** Tasks 5, 9
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/oee-sweep.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/oee-sync.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/oee-sync-device.ts`
- Modify: `packages/jobs/src/inngest/functions/integrations/index.ts` — export both functions
- Modify: `packages/jobs/src/inngest/index.ts` — import both and add them to `functions` under `// Integrations`
- Modify: `packages/lib/src/events.ts` — add the `carbon/oee-sync` event type
- Copy from (precedent): `packages/jobs/src/inngest/functions/integrations/ramp-sweep.ts`, `ramp-sync.ts:48-57`, `ramp-sync-bill-stage.ts:63-82` (Kysely transaction with `forUpdate`)

**Steps:**
1. Add the event type to `events.ts`, next to `"carbon/ramp-sync"`:

```ts
  "carbon/oee-sync": {
    data: {
      companyId: string;
      integrationId: string;
    };
  };
```

2. Write `oee-sweep.ts` from `ramp-sweep.ts`. Use id `"oee-sweep"` and cron `"*/2 * * * *"`.
3. In one `step.run("find-oee-sync-targets")`, select distinct `(companyId, integration)` pairs with Kysely (`getJobDatabaseClient()`).
4. Join `workCenterDevice` to `companyIntegration` on `id = integration` and `companyId`. Filter on `active = true` and `integration IN getIntegrationIdsByRole("oee")`.
5. Send one `carbon/oee-sync` event per pair with `step.sendEvent("dispatch-oee-sync", …)`.
6. Write `oee-sync.ts` from `ramp-sync.ts`: id `"oee-sync"`, `retries: 2`, `concurrency: { key: "event.data.companyId", limit: 1 }`.
7. In one `step.run("sync-devices")`:
   1. Call `getOeeProvider(getCarbonServiceRole(), companyId, integrationId)`. If it errors, return `{ skipped: error }`.
   2. Read every `workCenterDevice` row of the company and integration.
   3. For each device, `await syncOeeDevice(...)` inside `try/catch`.
   4. On a throw, set `lastSyncError` (the message, at most 500 characters) on that device only.
8. Write `oee-sync-device.ts` with `export async function syncOeeDevice({ db, provider, device, minimumStateSeconds })`:
   1. Set `now = datetime.timestamp()`.
   2. Set `since`: if `device.currentState` is null, use `mappedAt − 24 h`. Otherwise use `device.lastEventAt − 10 min`. Compute both with `parseAbsolute(iso, "UTC").subtract(...).toAbsoluteString()` from `@internationalized/date`.
   3. Call `provider.listStateChanges({ externalDeviceId, externalSiteId }, { since, until: now })`.
   4. Insert each change into `machineStateChange` with `onConflict((oc) => oc.columns(["workCenterDeviceId", "externalEventId", "companyId"]).doNothing())`. Do not set `createdBy`.
   5. Open `db.transaction().execute(async (trx) => …)`.
   6. Call `lockWorkCenterDevice(trx, …)` from `@carbon/database/machine-time`. If it returns nothing, a user removed the mapping. Return.
   7. Read the `planMachineTime` inputs:
      - `workCenter.loadedJobOperationId` and `loadedAt`.
      - `workCentersWithBlockingStatus.isBlocked`.
      - The open Machine `productionEvent` of the work center (`endTime IS NULL`, any creator).
      - The open `unattributedMachineTime` row (`status = 'Open'`, `endTime IS NULL`).
      - The latest `endTime` of a Machine event on the work center.
      - The `machineStateChange` rows with `changedAt > appliedThrough` (or `> since` when null), ascending.
   8. Normalize every `Date` from Kysely to an ISO string with a local `toInstant(value)` helper.
   9. Call `planMachineTime`.
   10. Apply each write in order:
       - `insertMachineEvent` → insert into `productionEvent` with `type: "Machine"`, `workCenterId`, `employeeId: null`, `companyId` and `createdBy: "system"`.
       - `closeMachineEvent` → update `endTime`, `updatedBy: "system"` and `updatedAt: now`, where `endTime IS NULL`.
       - `insertUnattributed` → insert with `createdBy: "system"`.
       - `closeUnattributed` → update `endTime`, `updatedBy: "system"` and `updatedAt: now`.
   11. Update the device: `currentState`, `currentStateAt`, `appliedThrough` (only when not null), `lastEventAt = now`, `lastSyncedAt = now` and `lastSyncError = null`.
9. Export both functions from `integrations/index.ts` and register them in `inngest/index.ts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: Tasks: 1 successful
pnpm --filter @carbon/jobs test
# Expected: all tests pass
```

If Kysely has no type for the view `workCentersWithBlockingStatus`, read `maintenanceDispatch` directly with the view's predicate (`status = 'In Progress'`, `oeeImpact IN ('Down', 'Planned')`).

**Out of scope:** GL posting. The existing operation-finish sweep posts these events.

---

## Task 11: Add the Devices tab to the integration drawer

**Depends on:** Task 9
**Files:**
- Create: `apps/erp/app/modules/settings/ui/Integrations/OeeDevices.ee.tsx`
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — add `workCenterDeviceUpsertValidator`
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — loader data, tab, action intent
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Integrations/AccountMapping.tsx` (`AccountMappingRowForm`, lines 418–560; props and `tabs` slot, lines 94–110, 299–301)

**Steps:**
1. Add the validator to `settings.models.ts`:

```ts
export const workCenterDeviceUpsertValidator = z.object({
  intent: z.literal("upsert-work-center-device"),
  externalDeviceId: z.string().min(1, { message: "Device is required" }),
  deviceName: z.string().min(1, { message: "Device name is required" }),
  externalSiteId: zfd.text(z.string().optional()),
  siteTimezone: zfd.text(z.string().optional()),
  workCenterId: zfd.text(z.string().optional())
});
```

2. In the route file, add a module-level `async function getOeeDevicesTabData(client, companyId, integrationId)`. Model it on `getAccountMappingTabData` (lines 280–324). It returns `{ devices, mappings, takenWorkCenters, workCenters, error }`:
   1. `getOeeProvider(getCarbonServiceRole(), companyId, integrationId)`, then `provider.listDevices()`. On a throw, set `devices: []` and `error` to the message.
   2. `mappings`: `workCenterDevice` rows (`externalDeviceId, workCenterId, currentState, lastSyncedAt, lastSyncError`) for this company and integration.
   3. `takenWorkCenters`: `workCenterDevice` rows (`workCenterId, deviceName, integration`) for this company with another integration.
   4. `workCenters`: `workCenter` rows `id, name, location(timezone)`, filtered on `companyId` and `active = true`.
3. In the loader, compute `devices = providerRole === "oee" && integrationData.data.active ? await getOeeDevicesTabData(...) : null`. Add `devices` to the return at lines 1141–1150. Add `devices: null` to the early return at lines 679–690.
4. Add the action branch, before the install fall-through:
   1. Validate with `workCenterDeviceUpsertValidator`.
   2. If `workCenterId` is empty, call `deleteWorkCenterDevice(client, getDatabaseClient(), …)`.
   3. Otherwise call `upsertWorkCenterDevice(client, getDatabaseClient(), …)`.
   4. On error, return `data({}, await flash(request, error(result.error, "Failed to save device mapping")))`.
   5. On success, return `data({}, await flash(request, success("Saved device mapping")))`.
5. Write `OeeDevices.ee.tsx` from `AccountMapping.tsx`. Use local structural row types; do not import them from `@carbon/ee` (TS2589). Show `tabs` first inside `DrawerBody`.
6. Give each device one row form, keyed `` `${device.externalDeviceId}:${mapping?.workCenterId ?? ""}` ``.
   - Left: the device name, then manufacturer, model and machine type as muted text, then the site name.
   - Show a "Calibrated" or "Not calibrated" badge.
   - Show `currentState`, `lastSyncedAt` (`formatTimeAgo`) and `lastSyncError` in red when set.
   - Right: a `Combobox name="workCenterId"` of `workCenters`, a `Submit` and the hidden fields of the validator.
7. Leave the work centers in `takenWorkCenters` out of the options.
8. If the device's `siteTimezone` differs from the selected work center's `location.timezone`, show `LuTriangleAlert` with a `Tooltip`. The tooltip text is "Sense site is in <siteTimezone>; Carbon uses <locationTimezone>".
9. If `error` is set, show it above the list.
10. If `usePlanGate({ feature: "INTEGRATIONS" }).isGated`, render `RulesUpgradeOverlay` (`~/components/RulesUpgradeOverlay`) in place of the list.
11. Push the tab first in the `tabs` array (lines 2172–2189): `{ value: "devices", label: <Trans>Devices</Trans>, content: (tabBar) => <OeeDevices tabs={tabBar} {...devices} /> }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 1 successful
```

**Out of scope:** Sync Activity for `oee` (Task 6 hides it). Matching by name and AI suggestions are out of scope.

---

## Task 12: Add the Unattributed Machine Time list and drawer

**Depends on:** Task 9
**Files:**
- Create: `apps/erp/app/routes/x+/production+/machine-time.tsx`
- Create: `apps/erp/app/routes/x+/production+/machine-time.$id.tsx`
- Create: `apps/erp/app/modules/production/ui/MachineTime/MachineTimeTable.ee.tsx`
- Create: `apps/erp/app/modules/production/ui/MachineTime/MachineTimeDrawer.ee.tsx`
- Create: `apps/erp/app/modules/production/ui/MachineTime/MachineTimeUpgradeOverlay.ee.tsx`
- Modify: `apps/erp/app/modules/production/production.service.ts` — 3 reads
- Modify: `apps/erp/app/modules/production/production.models.ts` — 2 validators and `unattributedMachineTimeStatuses`
- Modify: `apps/erp/app/utils/path.ts` — 2 paths
- Modify: `apps/erp/app/modules/production/ui/useProductionSubmodules.tsx` — 1 nav item
- Copy from (precedent): `apps/erp/app/routes/x+/production+/batches.tsx` and `batches.$batchId.tsx` (list and drawer routes); `apps/erp/app/modules/production/ui/ScrapReasons/ScrapReasonsTable.tsx` (table skeleton); the status column of `BatchesTable.tsx`; `apps/erp/app/modules/production/ui/Jobs/ProductionEventForm.tsx` (Drawer and ValidatedForm); `apps/erp/app/modules/settings/ui/Webhooks/WebhooksUpgradeOverlay.tsx` (overlay); `apps/erp/app/routes/x+/production+/scrap-reasons.$scrapReasonId.tsx` (action shape)

**Steps:**
1. Add to `path.ts`, in alphabetical order:
   - `` unattributedMachineTime: (id: string) => generatePath(`${x}/production/machine-time/${id}`), ``
   - `` unattributedMachineTimes: `${x}/production/machine-time`, ``
2. Add to `production.models.ts`:

```ts
export const unattributedMachineTimeStatuses = ["Open", "Assigned", "Dismissed"] as const;

export const assignMachineTimeValidator = z.object({
  intent: z.literal("assign"),
  jobOperationId: z.string().min(1, { message: "Operation is required" })
});

export const dismissMachineTimeValidator = z.object({
  intent: z.literal("dismiss"),
  dismissReason: z.string().min(1, { message: "Reason is required" })
});
```

3. Add three reads to `production.service.ts`:
   - `getUnattributedMachineTimes(client, companyId, args: GenericQueryFilters & { search: string | null })`: select `*, workCenter(name, location(timezone))` with `{ count: LIST_COUNT }`. If `search` is set, filter `workCenter.name` with `ilike`. Use the default sort `startTime` descending (copy `getJobOperationBatches`).
   - `getUnattributedMachineTime(client, id, companyId)`: the same select, `.single()`.
   - `getMachineTimeOperationCandidates(client, { workCenterId, companyId })`. Run two queries in `Promise.all`, then rank in memory:
     1. `jobOperation` rows `id, description, status, job(jobId)` on the work center, status not `Done` or `Canceled`, `limit(500)`.
     2. `productionEvent` rows `jobOperationId, startTime` on the work center, latest first, `limit(200)`.
     3. Put `In Progress` first, then the latest event start, then the description.
     4. Return `{ value, label: "<jobId> · <description>", helper: status }[]`.
4. Write `machine-time.tsx` from `batches.tsx`:
   - `handle.breadcrumb: msg\`Unattributed Machine Time\``.
   - `requirePermissions({ view: "production", role: "employee" })`.
   - Render `<MachineTimeTable>` and `<RecordOutlet />`.
   - If `usePlanGate({ feature: "INTEGRATIONS" }).isGated`, render `<MachineTimeUpgradeOverlay />`.
5. Write `MachineTimeTable.ee.tsx` from `ScrapReasonsTable.tsx`. Use 5 columns:
   - Work center: a `Hyperlink` to the row id.
   - Start and End: `formatDateTimeInZone(value, timeZone, locale)` inside `DateTime` with `locationTimeZone`, as `TimelineDetail.tsx:152-159` does.
   - Duration: `formatPreciseDuration`, or "Running" while `endTime` is null.
   - Status: a static filter over `unattributedMachineTimeStatuses`.
   - No `primaryAction`.
6. Write `machine-time.$id.tsx` from `scrap-reasons.$scrapReasonId.tsx`:
   1. The loader calls `requirePermissions({ view: "production", role: "employee" })`, `getUnattributedMachineTime` and `getMachineTimeOperationCandidates`.
   2. The action calls `assertIsPost` and `requirePermissions({ update: "production" })`, then branches on `intent`.
   3. `assign`: validate, then read the operation's `jobId`.
   4. Apply the job-lock check copied from `$jobId.events.new.tsx` (`requireUnlocked` / `isJobLocked`).
   5. Call `assignUnattributedMachineTime(client, getDatabaseClient(), …)`. Do not post to the GL.
   6. `dismiss`: validate, then call `dismissUnattributedMachineTime(client, getDatabaseClient(), …)`.
   7. On success, `throw redirect(path.to.unattributedMachineTimes, await flash(request, success(...)))`. On error, return `data({}, await flash(request, error(...)))`.
7. Write `MachineTimeDrawer.ee.tsx` from `ProductionEventForm.tsx`: `Drawer open onOpenChange`, `DrawerHeader` "Unattributed machine time".
   - Show the work center, start, end and duration as read-only text.
   - If `status` is not `Open`, show the status and the resolution only.
   - If `endTime` is null, show "The machine is still running" and no forms.
   - Otherwise show two `ValidatedForm`s: Assign (`Combobox name="jobOperationId"` with the candidates, `Submit` "Assign") and Dismiss (`TextArea name="dismissReason"`, `Submit` "Dismiss").
   - Each form has a hidden `intent`.
8. Write `MachineTimeUpgradeOverlay.ee.tsx` from `WebhooksUpgradeOverlay.tsx`. Show 3 mock rows and the title "Unattributed machine time".
9. Add the nav item after Batches: `{ name: t\`Unattributed Machine Time\`, to: \`${path.to.unattributedMachineTimes}?filter=status:eq:Open\`, icon: <LuTimerOff />, role: "employee" }`.
10. If the nav item does not show as active with the query string, use `path.to.unattributedMachineTimes` alone.
11. In that case, add no default filter.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 1 successful
```

**Out of scope:** splitting one row across operations, bulk assign, and an MES prompt.

---

## Task 13: Apply the manual-press rules in MES

**Depends on:** Task 5
**Files:**
- Modify: `apps/mes/app/routes/x+/event.tsx` — Start and End branches
- Modify: `apps/mes/app/routes/x+/start.$operationId.tsx` — Machine branch (lines 242–281)
- Copy from (precedent): `apps/mes/app/services/quality.server.ts:885-930` (MES Kysely transaction)

**Steps:**
1. In `event.tsx`, import `recordManualMachinePress` from `@carbon/database/machine-time`.
2. Set `const pressedAt = datetime.timestamp();` once, after validation.
3. **Start branch.** If `d.type === "Machine"` and `d.workCenterId` is set, run this before `startProductionEvent`:
   `await getDatabaseClient().transaction().execute((trx) => recordManualMachinePress(trx, { workCenterId: d.workCenterId!, companyId, userId, pressedAt }))`.
4. Pass `startTime: pressedAt` to `startProductionEvent`.
5. **End branch.** If `d.type === "Machine"` and `d.workCenterId` is set, run the same call before `endProductionEvent`.
6. Pass `endTime: pressedAt` to `endProductionEvent`. Keep the existing GL posting step unchanged.
7. In `start.$operationId.tsx`, inside `if (type === "Machine")`, set `pressedAt = datetime.timestamp()`.
8. If `jobOperation.data.workCenterId` is set, call `recordManualMachinePress` with it first.
9. Pass `startTime: pressedAt` to `startProductionEvent` for every type.
10. Leave the Setup and Labor paths unchanged.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: Tasks: 1 successful
pnpm --filter mes test
# Expected: all tests pass
```

**Out of scope:** End Shift and maintenance Down. They keep their current behavior; the steady-state rule reopens time after them.

---

## Task 14: Show the device state and the loaded operation in MES

**Depends on:** Task 3
**Files:**
- Modify: `apps/mes/app/services/operations.service.ts` — add `getWorkCenterDevice` after `getWorkCenter` (line 2114)
- Modify: `apps/mes/app/routes/x+/operation.$operationId.tsx` — load the device
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` — prop, realtime, pass-through
- Modify: `apps/mes/app/components/JobOperation/components/Controls.tsx` — badge in `WorkTypeToggle` (lines 240–254)
- Modify: `apps/mes/app/services/display.service.ts` — loaded operation and device state
- Modify: `apps/mes/app/routes/display+/$workCenterId.work.tsx` — render them
- Copy from (precedent): `useChangedRows` on `productionEvent` in `apps/mes/app/components/JobOperation/hooks/useOperation.tsx:135-165`; `Badge` usage in `JobOperation.tsx:943`

**Steps:**
1. Add `getWorkCenterDevice(client, { workCenterId, companyId })`. It selects `id, deviceName, currentState, currentStateAt` from `workCenterDevice` and calls `.maybeSingle()`.
2. In the operation loader, await it with `serviceRole` when the operation has a `workCenterId`. Return it as `workCenterDevice`.
3. In `JobOperation.tsx`, keep the device in state.
4. Subscribe with `useChangedRows({ companyId, table: "workCenterDevice", filter: \`workCenterId=eq.${operation.workCenterId}\`, onChange })` and update the state.
5. Pass `deviceState={device?.currentState ?? null}` to `WorkTypeToggle`.
6. In `WorkTypeToggle`, under the Machine label, render `<Badge>` when `deviceState` is set:
   - `Running` → variant `green`, text "Running".
   - `Idle` → `outline`, "Idle".
   - `Down` → `red`, "Down".
   - `Offline` → `outline`, "Offline".
   - Translate each text with `t`.
7. In `display.service.ts`, add `loadedJobOperationId` to the `DisplayWorkCenter` type and to the select in `getDisplayWorkCenter`. The view now carries the column.
8. Add `getDisplayLoadedOperation(client, { jobOperationId, companyId })`. It selects `id, description, job:jobId(jobId)` from `jobOperation`.
9. In `$workCenterId.work.tsx`, load the loaded operation and `getWorkCenterDevice`. Render one line above the active work: "Loaded: <jobId> · <description>", plus the device badge from step 6.
10. Hide each part that has no data.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: Tasks: 1 successful
```

**Out of scope:** an MES prompt for unattributed time.

---

## Task 15: Write the docs, the rule and the AGENTS.md updates

**Depends on:** Task 9
**Files:**
- Create: `docs/content/docs/integrations/oee.mdx`
- Modify: `docs/content/docs/integrations/meta.json` — add `"oee"`
- Modify: `docs/content/docs/reference/work-centers.mdx` — add a "Loaded operation" section
- Create: `.claude/rules/oee-provider.md` (with `paths:` frontmatter for `packages/ee/src/oee/**`, `packages/ee/src/sense/**`, `packages/jobs/src/inngest/functions/integrations/oee-*.ts`, `packages/database/src/machine-time.ts`)
- Modify: `AGENTS.md` — add a Task Router row "OEE providers / machine monitoring" → `.claude/rules/oee-provider.md`
- Modify: `packages/jobs/AGENTS.md` — add `oee-sweep` and `oee-sync` to "Durable Entry Points"
- Modify: `apps/erp/app/modules/production/AGENTS.md` — add the loaded operation and unattributed machine time
- Copy from (precedent): `docs/content/docs/integrations/accounting.mdx` (guide shape), `.claude/rules/ramp-integration.md` (rule shape)

**Steps:**
1. Load the `carbon-docs` skill before you write the docs page.
2. Write the guide in four sections:
   1. What an OEE provider is.
   2. Install Sense: Settings → Integrations → Sense.
   3. Map devices on the Devices tab.
   4. How machine time reaches a job: the loaded operation, the Machine button override, unattributed time.
3. Ground each claim in the code from Tasks 9–14.
4. Write the rule file. Summarize the attribution rules from spec section 5 and the sync from section 7, and name the files.
5. Write all prose in STE-80.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: no errors
```

**Out of scope:** a changelog entry. Write it when the feature ships.

---

## Task 16: Run the gates and verify in the browser

**Depends on:** all tasks
**Files:** generated artifacts only

**Steps:**
1. Run `pnpm lingui:extract`. Then run `/translate` for the new strings.
2. Run `pnpm generate:mcp`, because new reads in `production.service.ts` become MCP tools.
3. Run the gates below in order. Fix each failure before the next one.
4. Run `/test` with this playbook. Get the staging key from the user; never commit it.
   1. Install Sense with the staging key. The connection is healthy, and the Devices tab lists 55 stations.
   2. Map Station 0002 to work center W1. Try a second station on W1; the message names Station 0002.
   3. Map a `Reston - 2` station to a work center in `America/New_York`. The timezone warning shows.
   4. In MES, start and stop Setup on operation A at W1. W1 loads A (the work-center display shows it).
   5. Wait for 2 sweep runs (4 minutes) with the station Active. A shows a Machine event with no employee.
   6. Press Machine Stop in MES. The event ends at the press. The next sync does not reopen it.
   7. Complete A while the station is Active. Production → Machine Time shows an Open row.
   8. Wait until the station is Idle. Assign the row to operation B. B's Events tab shows the Machine event.
   9. Dismiss another row without a reason. Validation fails. With a reason, the row is Dismissed.
   10. Finish operation A in MES. Run `select "postedToGL" from "productionEvent" where "jobOperationId" = '<A>' and "type" = 'Machine'`. Every row is `true`.
   11. On a work center with no device, start and stop the Machine timer. It behaves as before: no badge, and the event posts on Stop.
   12. If the dev company has no `INTEGRATIONS` feature, check that the Devices tab and the list show the upgrade overlay. Otherwise report this step as skipped.

**Verify:**
```bash
pnpm run lint
# Expected: no errors
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/ee --filter=@carbon/jobs --filter=erp --filter=mes
# Expected: Tasks: 5 successful
pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test && pnpm --filter mes test
# Expected: all tests pass
pnpm --filter @carbon/checks clobbers
# Expected: no clobbered definitions
pnpm db:check:backups
# Expected: success; packages/jobs/manifests/schema.json updated
pnpm db:check:datasets
# Expected: success
```

**Out of scope:** demo-dataset rows for the new tables, a changelog entry and a production Sense key.
