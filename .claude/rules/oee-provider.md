---
paths:
  - packages/ee/src/oee/**
  - packages/ee/src/sense/**
  - packages/jobs/src/inngest/functions/integrations/oee-*.ts
  - packages/database/src/machine-time.ts
---

# OEE Providers (machine monitoring)

An OEE provider reports when each machine runs. Carbon records that run time
as Machine `productionEvent` rows on the operation loaded on the work center.
Sense is the only provider today. Spec:
`.ai/specs/2026-10-12-oee-provider-integration.md`. Where the spec and the
code differ, the code wins.

The descriptor `Sense` (`packages/ee/src/sense/config.tsx`) declares
`providerRole: "oee"` and category "Machine Monitoring". The sweep finds OEE
integrations through `getIntegrationIdsByRole("oee")`. Several OEE
integrations may be active at once:
`check_single_active_provider_role()` returns early for the `oee` role
(migration `20261013030022_oee-provider.sql`). The real rule is on
`workCenterDevice`: `UNIQUE(workCenterId, companyId)`, so a work center has at
most one device across every OEE provider.
Its `workCenterId` FK is composite, `(workCenterId, companyId)` →
`workCenter (id, companyId)` (migration `20261013191915`), so a device can
only map to its own company's work center; `upsertWorkCenterDevice` also
checks it first ("Work center not found").

## Files

| File | Role |
|---|---|
| `packages/ee/src/oee/types.ts` | `OeeProvider` contract (`validate`, `listDevices`, `listStateChanges`), `MachineState`, `OeeDevice`, `OeeStateChange` |
| `packages/ee/src/oee/engine.ts` | `planMachineTime`: the pure attribution engine. No database, no env. Pinned by `engine.test.ts` |
| `packages/ee/src/oee/registry.ts` | `OEE_PROVIDERS`: integration id → provider factory. The one place a provider is named |
| `packages/ee/src/oee/service.server.ts` | `getOeeProvider` (runtime, degrades through `companyHasFeature("INTEGRATIONS")`), and 4 authoring writes that embed `requireEntitlement("INTEGRATIONS")`: `upsertWorkCenterDevice`, `deleteWorkCenterDevice`, `assignUnattributedMachineTime`, `dismissUnattributedMachineTime` |
| `packages/ee/src/sense/provider.ts` | `SenseProvider`, the Sense HTTP adapter. Pinned by `provider.test.ts` |
| `packages/ee/src/sense/config.tsx` | The descriptor: `apiKey` (secret), `environment`, `minimumStateSeconds` (default 60) |
| `packages/ee/src/sense/hooks.server.ts` | `senseHealthcheck`: calls `provider.validate()` |
| `packages/jobs/src/inngest/functions/integrations/oee-sweep.ts` | Cron `*/2 * * * *`. Sends one `carbon/oee-sync` per (company, OEE integration) that is active and has at least 1 mapped device |
| `packages/jobs/src/inngest/functions/integrations/oee-sync.ts` | `carbon/oee-sync`, concurrency 1 per company. Syncs every device of the integration in ONE `step.run` |
| `packages/jobs/src/inngest/functions/integrations/oee-sync-device.ts` | `syncOeeDevice`: read, store, then plan and apply under the device lock |
| `packages/database/src/machine-time.ts` | `lockWorkCenterDevice` (`FOR UPDATE` on the device row), `recordManualMachinePress` and `endSensorMachineTime`. Shared by the sync, the MES and the device mapping writes. Pinned by `machine-time.test.ts` (needs `SUPABASE_DB_URL`) |
| `packages/database/src/event-system/handlers/sync_load_work_center_operation.sql` | `productionEvent` AFTER INSERT: loads the operation onto the work center |
| `packages/database/src/event-system/handlers/sync_unload_work_center_operation.sql` | `jobOperation` AFTER UPDATE: unloads the operation when it becomes Done or Canceled |

UI:

- **Devices tab** — `apps/erp/app/modules/settings/ui/Integrations/OeeDevices.ee.tsx`,
  rendered by `x+/settings+/integrations.$id.tsx` only for an active `oee`
  integration.
- **Production → "Unattributed Time"** — `x+/production+/machine-time*.tsx`
  and `modules/production/ui/MachineTime/`. The nav item appears only while an
  `oee` integration is active (`useProductionSubmodules`, through
  `getIntegrationIdsByRole("oee")` and `useIntegrations`).
- **MES press rules** — `apps/mes/app/routes/x+/event.tsx` and
  `x+/start.$operationId.tsx`.
- **MES machine state** — the work center display
  (`display+/$workCenterId.work.tsx`) shows `DeviceStateBadge`
  (`components/Display/`) and "Loaded: …". The operation page shows no
  device badge: its Machine toggle's green dot already marks running time.

## The loaded operation (community)

`workCenter.loadedJobOperationId` and `workCenter.loadedAt` record which
operation runs on a work center. They exist on every work center, with or
without a device.

- **Load.** Any `productionEvent` INSERT with `endTime` null and a
  `workCenterId` loads its operation: Setup, Labor, Machine and the QR start.
  An event inserted with an `endTime` never loads. An older `startTime` never
  replaces a newer load.
- **Unload.** A `jobOperation` status change to `Done` or `Canceled` clears
  the load, and so does deleting the operation. A Pause does not unload.
- **No foreign key.** `loadedJobOperationId` has none (migration
  `20261013172620`): a second `jobOperation`↔`workCenter` relationship made
  PostgREST refuse every existing embed of one from the other (PGRST201), so
  the unload interceptor also handles DELETE instead.

Carbon never infers a job from the schedule. Only the load attributes time.

## Attribution rules (`planMachineTime`)

The engine reads the stored changes after `appliedThrough`, in time order.

1. If the state does not change, skip it.
2. If `changedAt <= lastManualChangeAt`, update the state only. The engine
   writes no machine time for it ("latest change wins").
3. If the state is `Running` and an open Machine event or an open
   unattributed row exists, do nothing.
4. If the state is `Running`, check the work center. If it is not blocked
   and its operation loaded at or before `changedAt`, open a Machine event on
   that operation. Set `employeeId` to null and `createdBy` to `system`.
5. Else, if the state is `Running`, open an `unattributedMachineTime` row.
6. If the state is `Idle`, `Down` or `Offline`, end the open Machine event
   and the open unattributed row at `changedAt`.

"Blocked" is the predicate of `workCentersWithBlockingStatus`: an
`In Progress` maintenance dispatch with `oeeImpact` `Down` or `Planned`.

**Debounce.** The engine drops a state shorter than `minimumStateSeconds`.
The last change stays pending until it has lasted the minimum. The next sync
reads it again.

**First sync.** A new device has no `currentState`. The sync reads from 24
hours before `createdAt` (the mapping time). The engine takes the last change
before the mapping as the start state, at the mapping time. The engine never
charges time before the mapping. A remap deletes the row and inserts a new one, so
the mapping time and the applied state start again.

**Unmap and remap.** No later sync closes time on a work center the device
has left. So `deleteWorkCenterDevice` and the remap path of
`upsertWorkCenterDevice` first call `endSensorMachineTime` on the OLD work
center, under the device row lock: it ends, at now, the open Machine events
created by `system` and the `Open` unattributed rows with no `endTime`. An
operator's own open Machine event stays open.

**Steady state.** After the changes, if the device is `Running`,
`currentStateAt > lastManualChangeAt`, and nothing is open, the engine opens
time again. The start is the latest Machine `endTime` on the work center, or
`currentStateAt` when that is later. This covers 2 cases: an operation that
went Done mid-run, and a Machine event that a maintenance dispatch or End
Shift closed.

**A load change mid-run.** The open event stays on the old operation. The
next `Running` change goes to the new one.

## The MES Machine button on a mapped work center

A "Start" or "Pause" press with "Machine" selected calls
`recordManualMachinePress` inside a Kysely transaction. The function takes the
same device lock as the sync. It does 3 things:

1. It ends every open Machine event on the work center at the press time.
2. It ends the work center's open unattributed time at the press time. Without
   this, a Start on a running machine with no loaded operation counted the
   same minutes on the operator's event and in the supervisor queue.
3. It sets `workCenterDevice.lastManualChangeAt` to the press time.

A Start then inserts the operator's Machine event, which loads the operation.
If the work center has no device, the function does nothing, and the MES
behaves as before. After a Pause on a running machine, no sensor time opens
until the device reports its next change to `Running`.

## The sync

1. `oee-sweep` (every 2 minutes) sends `carbon/oee-sync` per (company,
   integration). An installed integration with no mapped device costs nothing.
2. `oee-sync` resolves the provider with `getOeeProvider`. If the company is
   not entitled, the integration is inactive, or the key is empty, the run
   returns `skipped`.
3. For each device, `syncOeeDevice` reads changes from
   `lastEventAt − 10 minutes` to now. The overlap catches events that the
   provider stores late. The first sync reads from the mapping time minus 24
   hours.
4. It inserts the changes into `machineStateChange` with
   `ON CONFLICT DO NOTHING` on (`workCenterDeviceId`, `externalEventId`,
   `companyId`), in chunks of 500.
5. It opens one transaction, locks the device, runs `planMachineTime` and
   applies the writes.
6. In the same transaction it sets `currentState`, `currentStateAt`,
   `appliedThrough`, `lastEventAt`, `lastSyncedAt`, and clears
   `lastSyncError`.
7. If a device fails, the job writes `lastSyncError` (500 characters at most)
   on that device. Its cursor does not move. The other devices continue.

Kysely returns `timestamptz` as a JS `Date`. `syncOeeDevice` normalizes every
instant with `toInstant` before the engine compares it.

**GL posting.** The sync never posts. A sensor event is an ordinary Machine
event with no employee. It posts when its operation finishes, through the
existing sweep, or when the job completes. An assigned unattributed row also
does not post at assign time.

## Unattributed machine time

`unattributedMachineTime` is a review queue, not a record: it has no status
(migration `20261013170425_unattributed-time-queue.sql`).
`assignUnattributedMachineTime` inserts a Machine event for the row's
interval and deletes the row; the event is the record.
`dismissUnattributedMachineTime` deletes the row. Both refuse a row with no
`endTime` ("The machine is still running"). Assign also refuses a `Done` or
`Canceled` operation, and the route refuses a locked job. pg_cron
`unattributed-machine-time-retention` (04:23 UTC) runs
`util.purge_unattributed_machine_time()`, which deletes rows whose `endTime`
is more than 30 days old. A running row is never purged.

The drawer (`x+/production+/machine-time.$id.tsx`, `MachineTimeDrawer.ee.tsx`)
walks the queue in the list's order (`startTime` desc, then `id`):
`getUnattributedMachineTimeNeighbors` gives the position and the rows above
and below, and every answer redirects to the row below, else the row above,
else the list. The suggestion cards come from `getWorkCenterDayEvents` (every
production event on the work center overlapping the row's day, in the
location's timezone) ranked by the pure `suggestMachineTimeOperations`
(`machine-time-suggestions.ee.ts`, pinned by
`apps/erp/test/machine-time-suggestions.ee.test.ts`): operations that can take
the time first, then by the gap to the row's interval (0 when they overlap),
then by time run that day; Done/Canceled operations and locked jobs show
disabled. The search card reads `getMachineTimeOperationCandidates` (open
operations on open jobs at the work center's location, this work center's
first). Keys (`MACHINE_TIME_REVIEW_SHORTCUTS`): 1–9 assign a card, j/k move
(the table behind binds the arrows); a repeated keydown is ignored and one
answer per row is posted.

**State change retention.** pg_cron `machine-state-change-retention` (04:29
UTC) runs `util.purge_machine_state_changes()`: it deletes `machineStateChange`
rows older than 30 days, and rows whose device was unmapped or remapped. The
engine only reads rows after `appliedThrough`, so neither is ever read again.

## Sense adapter

- Base URL: `https://bifrost.sensemfg.com` (production) or
  `http://bifrost-staging.sensemfg.com` (staging). Auth is
  `Authorization: Bearer <apiKey>`. The key is company-scoped.
- Status allowlist: `Active` → `Running`, `Idle` → `Idle`, `Alert` → `Down`,
  `Offline` → `Offline`. An unknown status throws, and the device records
  the error. Never guess a state.
- Events need the station's site. A station with no `site_id` throws
  "Station has no site".
- **Sense ignores `offset`, and returns 400 for `offset=0`.** So
  `listStateChanges` pages by time. After a full page (500 events), it asks
  again from the last event's `created_at` and drops the event ids it has
  already seen. It stops on a short page or a page with no new event.

## Local tooling

`crbn migrate`'s authz sync can create new handler functions owned by
`supabase_admin`. Then a later migration that replaces the function fails
with "must be owner". Fix it locally:

```sql
ALTER FUNCTION public.sync_load_work_center_operation(text, text, jsonb, jsonb) OWNER TO postgres;
ALTER FUNCTION public.sync_unload_work_center_operation(text, text, jsonb, jsonb) OWNER TO postgres;
```
