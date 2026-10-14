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
checks it first ("Work center not found"). `machineStateChange` and
`unattributedMachineTime` carry the same composite FK (migration
`20261013201722`).

## Files

| File | Role |
|---|---|
| `packages/ee/src/oee/types.ts` | `OeeProvider` contract (`validate`, `listDevices`, `listStateChanges`), `MachineState`, `OeeDevice`, `OeeStateChange` |
| `packages/ee/src/oee/engine.ts` | `planMachineTime`: the pure attribution engine. No database, no env. Pinned by `engine.test.ts` |
| `packages/ee/src/oee/assignable.ts` | `machineTimeRefusal(operationStatus, jobStatus)`: `"Done"`, `"Canceled"`, `"Locked"` or null. The one rule for "can this operation take machine time", used by the sync (a load's `assignable`), `assignUnattributedMachineTime` and the review's suggestion cards. Built on `isJobLocked` / `JOB_LOCKED_STATUSES` (`packages/utils/src/job-status.ts`, re-exported by the ERP's `production.models.ts`) |
| `packages/ee/src/oee/registry.ts` | `OEE_PROVIDERS` (keyed by `OeeProviderId`): provider id → factory, the one place a provider is named. `isOeeProviderId`, and `createOeeProvider(integrationId, metadata)`: the one resolution (id check, "No API key", the `DEFAULT_MINIMUM_STATE_SECONDS` default, the factory) behind `getOeeProvider` and the Sense healthcheck |
| `packages/ee/src/oee/service.server.ts` | `getOeeProvider` (runtime, degrades through `companyHasFeature("INTEGRATIONS")`), and 4 authoring writes that embed `requireEntitlement("INTEGRATIONS")`: `upsertWorkCenterDevice`, `deleteWorkCenterDevice`, `assignUnattributedMachineTime`, `dismissUnattributedMachineTime` |
| `packages/ee/src/sense/provider.ts` | `SenseProvider`, the Sense HTTP adapter. Pinned by `provider.test.ts` |
| `packages/ee/src/sense/config.tsx` | The descriptor: `apiKey` (secret), `environment`, `minimumStateSeconds` (default 60) |
| `packages/ee/src/sense/hooks.server.ts` | `senseHealthcheck` (calls `provider.validate()`) and `senseOnUninstall` (registered in `packages/ee/src/hooks.server.ts`; see "Uninstalling Sense") |
| `packages/jobs/src/inngest/functions/integrations/oee-sweep.ts` | Cron `*/2 * * * *`. Sends one `carbon/oee-sync` per (company, OEE integration) that is active and has at least 1 mapped device |
| `packages/jobs/src/inngest/functions/integrations/oee-sync.ts` | `carbon/oee-sync`, concurrency 1 per company, `singleton` (skip) per company and integration. Syncs every device of the integration in ONE `step.run` |
| `packages/jobs/src/inngest/functions/integrations/oee-sync-device.ts` | `syncOeeDevice`: read, store, then plan and apply under the device lock. Pinned by `oee-sync-device.database.test.ts` (needs `SUPABASE_DB_URL`) |
| `packages/database/src/machine-time.ts` | `lockWorkCenterDevice` (`FOR UPDATE` on the device row), `lockMachinePress` (the device lock, then a transaction advisory lock per work center), `recordManualMachinePress` and `endSensorMachineTime`. Shared by the sync, the MES, the device mapping writes and the Sense uninstall hook. Pinned by `machine-time.test.ts` (needs `SUPABASE_DB_URL`) |
| `apps/mes/app/services/operations.service.ts` | `startMachineProductionEvent` (press, event and tracked activity in one Kysely transaction), `endMachineProductionEvent` (press locks, then the open event's row lock), `postEndedProductionEvents` (posts the events a press ended), `endProductionEvent` (ends an open event, scoped by `companyId`) |
| `packages/database/src/event-system/handlers/sync_load_work_center_operation.sql` | `productionEvent` AFTER INSERT: writes a load into `workCenterLoad` (see "The loaded operation") |
| `packages/database/src/event-system/handlers/sync_unload_work_center_operation.sql` | `jobOperation` AFTER UPDATE / DELETE: ends the operation's open `workCenterLoad` row when it becomes Done or Canceled, is deleted, or moves to another work center |

UI:

- **Devices tab** — `apps/erp/app/modules/settings/ui/Integrations/OeeDevices.ee.tsx`,
  rendered by `x+/settings+/integrations.$id.tsx` only for an active `oee`
  integration. Its loader and action live in
  `modules/settings/oee-devices.server.ts` (`getOeeDevicesTabData`,
  `saveWorkCenterDeviceMapping`). The loader reads the provider's devices and
  the mappings in parallel. The provider's device list (`listOeeDevices`) is
  cached in Redis for 60 s (`oeeDevicesCacheKey` in
  `modules/settings/oee-devices-cache.ts`: `oee-devices:<companyId>:<integrationId>`,
  never an error); `clearCompanyIntegrationCache` (`settings.server.ts`)
  deletes it on every integration save, so a new API key or environment never
  shows the old stations. A mapping save refuses a station that is not in the
  current list, and it stores that listed device's name, site and site
  timezone, not the form's. The work center picker of a row leaves out the
  work centers another integration maps and the ones another device of this
  integration holds. A mapped work center shows even when inactive. A
  location timezone of `''` counts as none: the timezone warning compares the
  site with the company's timezone then.
- **Production → "Unattributed Time"** — `x+/production+/machine-time*.tsx`
  and `modules/production/ui/MachineTime/`. The nav item appears only while an
  `oee` integration is active (`useProductionSubmodules`, through
  `getIntegrationIdsByRole("oee")` and `useIntegrations`).
- **MES press rules** — `apps/mes/app/routes/x+/event.tsx` and
  `x+/start.$operationId.tsx`.
- **MES machine state** — the work center display
  (`display+/$workCenterId.work.tsx`) shows `DeviceStateBadge`
  (`components/Display/`) and "Loaded: …". `getDisplayWorkCenter`
  (`display.service.ts`) reads `loadedJobOperationId` from the view
  `workCentersWithBlockingStatus`, which takes it from the open
  `workCenterLoad` row. `getDisplayDeviceState` hides the state when the
  device has a sync error or has not synced for 10 minutes. The operation
  page shows no device badge: its Machine toggle's green dot already marks
  running time.

## The loaded operation (community)

`workCenterLoad` records which operation was loaded on a work center, and
when (migration `20261014010130`). The open row (`unloadedAt` null) IS the
load: there is no pointer column (migration `20261014024119` dropped
`workCenter."loadedJobOperationId"` and `"loadedAt"`). It exists on every work
center, with or without a device. The view `workCentersWithBlockingStatus`
exposes the open row's operation as `loadedJobOperationId`.

- **Load.** Any `productionEvent` INSERT with `endTime` null and a
  `workCenterId` loads its operation: Setup, Labor, Machine and the QR start.
  An event inserted with an `endTime` never loads. The interceptor loads only
  when the work center and the operation are the event's own company. It
  takes a transaction advisory lock per work center
  (`workCenterLoad:<workCenterId>`), so loads on one work center run one at a
  time. It ends the open row at the event's `startTime` and opens a new row
  with `loadedAt` = `startTime`.
- **Older starts are refused.** A start earlier than the newest boundary in
  the work center's history (the latest `loadedAt` or `unloadedAt`) writes
  nothing, so a late event never undoes a later load or unload. A reload of
  the operation already loaded writes nothing. There is no status rule: a
  starting event reopens a Done operation first
  (`sync_set_job_operation_in_progress`, a BEFORE interceptor).
- **Unload.** A `jobOperation` status change to `Done` or `Canceled` ends the
  operation's open row, and so does deleting the operation or moving it to
  another work center (the old work center unloads). An unload sets
  `unloadedAt` = `GREATEST(NOW(), "loadedAt")`. A Pause does not unload.
- **Constraints.** A CHECK refuses `unloadedAt < loadedAt`, and a partial
  unique index (`workCenterLoad_one_open_idx`) allows one open row per work
  center.
- **No foreign key.** `workCenterLoad.jobOperationId` has none: a second
  `jobOperation`↔`workCenter` relationship made PostgREST refuse every
  existing embed of one from the other (PGRST201), so the unload interceptor
  also handles DELETE instead. Backups remap it through `ID_REF_COLUMNS`
  (`packages/jobs/src/backups/id-refs.ts`), with
  `machineStateChange.workCenterDeviceId`.
- **Read-only.** `workCenterLoad` is SELECT-only through the API (authz
  manifest); only the two interceptors write it. No event function lists a
  load column in `ignored_columns`, and `auditConfig.skipFields` has none.
- **Retention.** pg_cron `work-center-load-retention` (04:35 UTC) runs
  `util.purge_work_center_loads()`. It deletes a row more than 7 days after
  its `unloadedAt`, unless a device on its work center has not planned past
  that unload yet (`appliedThrough` null or earlier than `unloadedAt`). An
  open row is never deleted. Pinned by
  `supabase/tests/work-center-loaded-operation.test.sql`.

Carbon never infers a job from the schedule. Only the load attributes time,
read from the history at the moment each piece of a run happened: the order
in which reports and presses arrive does not change the operation.

## Attribution rules (`planMachineTime`)

The sensor decides WHETHER the machine ran. The **owner** of each moment of a
run decides WHO gets it:

1. A moment while maintenance blocks the work center → the queue.
2. A moment after an operator press in the same run (a press after the run
   started, at or before the moment) → the queue. The press stopped the
   operator's time, not the machine.
3. Else the operation loaded at that moment (the load whose period holds it),
   if it is `assignable`.
4. Else the queue.

`assignable` is `machineTimeRefusal(...) === null`: false once the operation
is Done or Canceled, its job is locked (Completed, Closed, Cancelled), or the
operation no longer exists. "The queue" is `unattributedMachineTime`.

The owner can change only at an **edge**: a load begins or ends, a block
begins or ends, or a press. The engine never records time that a Machine
event or an unattributed row already holds (`recordedIntervals`).

**Recording a stretch.** The engine takes the parts of the stretch that no
recorded interval holds, splits them at the edges, and gives each piece to its
owner. A closed operation piece becomes a system Machine event
(`employeeId` null, `createdBy` `system`). A closed queue piece shorter than
`minimumStateSeconds` is dropped. A piece that reaches now while the machine
runs opens instead: an operation piece at once, a queue piece only once it
has lasted `minimumStateSeconds`.

**Inputs.** `loads` (`LoadPeriod`: `jobOperationId`, `from`, `to`,
`assignable`), `blocks` (`BlockPeriod`: `from`, `to`), `lastManualChangeAt`
(the latest press), `firstUnplannedPressAt` (the earliest press since the last
sync), `openMachineEvent` (`id`, `jobOperationId`, `startTime`, `system`),
`openUnattributed`, `lastMachineEventEndTime`, `recordedIntervals` (`id`,
`kind` `event` | `unattributed`, `startTime`, `endTime`), the applied state,
and the stored changes after `appliedThrough`.

The engine reads the changes in time order:

1. If the state does not change, skip it.
2. If `changedAt <= lastManualChangeAt`, the provider reported it late. The
   press already decided what came after it, so the change fills only the
   time the press could not see. A late `Running` opens nothing: the run, up
   to the press or to an earlier stop, is recorded closed by owner. That is
   what an earlier report would have recorded.
3. If the state is `Running` and a Machine event or an unattributed row is
   open, do nothing.
4. If the state is `Running`, open time for the owner at `changedAt`: a
   system Machine event on the loaded operation, else an unattributed row.
5. If the state is `Idle`, `Down` or `Offline`, open time follows its owner
   up to the stop. Then the open Machine event (an operator's too) and the
   open unattributed row end at `changedAt`.

**Open time follows its owner.** At each stop and at the end of every plan,
an open system slot (a sensor Machine event or an unattributed row) closes at
the first edge where the owner changes, and the new owner records the rest.
So a load change mid-run moves the sensor's time to the newly loaded
operation, the end of maintenance hands queue time back to the operation, and
an unload ends the operation's event and queues the rest. An operator's open
Machine event follows only a block start: maintenance stops it, a load change
does not. This replaces the old special case that closed a system event on a
Canceled operation.

**Blocked.** The sync passes the work center's `blocks`. A `Down` dispatch
blocks from its `createdAt` (the MES ends every event on the work center when
one is created, `dispatch.new.tsx`) until it is Completed or Cancelled; while
it is `Open`, `Assigned` or `In Progress` the block has no end. A `Planned`
dispatch blocks from `actualStartTime` (else `updatedAt`, else `createdAt`)
while `In Progress`; a Completed or Cancelled one counts only when it has an
`actualStartTime`. A closed block ends at `completedAt`, else
`actualEndTime`, else `updatedAt`, else `createdAt`. This is broader than the
view `workCentersWithBlockingStatus` (In Progress only), which the MES display
and the QR start still use. An operator Machine event started after the block
began stays open. Pinned by `engine.test.ts`.

**Debounce.** Repeated reports of one state are one run: the first starts it,
the last is how far it was read. The engine drops a state shorter than
`minimumStateSeconds`. The last change stays pending until it has lasted the
minimum. The next sync reads it again.

**First sync.** A new device has no `currentState`. The sync reads from 24
hours before `createdAt` (the mapping time). The engine takes the last change
before the mapping as the start state, at the mapping time. The engine never
charges time before the mapping. A remap deletes the row and inserts a new one, so
the mapping time and the applied state start again.

**Unmap and remap.** No later sync closes time on a work center the device
has left. So `deleteWorkCenterDevice` and the remap path of
`upsertWorkCenterDevice` first call `endSensorMachineTime` on the OLD work
center, under the device row lock: it ends, at now, the open Machine events
created by `system` and the unattributed rows with no `endTime`. An
operator's own open Machine event stays open.

**Uninstalling Sense.** The integration card's **Uninstall** posts to
`x+/settings+/integrations.deactivate.$id.tsx`, which deactivates the
integration and runs its `onUninstall` hook.
`senseOnUninstall` ends the sensor time of every Sense device of the company
at one instant: per device, `lockWorkCenterDevice` then
`endSensorMachineTime` (`userId` `system`). The mappings stay, so a
reconnect resumes each device from its cursor.

**Steady state.** After the changes, if the device is `Running`, nothing is
open, and no press came after the run started
(`currentStateAt > lastManualChangeAt`), the engine records the run again by
owner, up to now. The start is the latest Machine `endTime` on the work
center after `currentStateAt` (`lastMachineEventEndTime`), or
`currentStateAt` when that is later. This covers a Machine event that a
maintenance dispatch or End Shift closed, and an operation that went Done
mid-run. Time while the work center is blocked opens as unattributed time.

**A load change mid-run.** The sensor's open event follows its owner: the
next sync ends it on the old operation at the new load's `loadedAt` and opens
an event on the new operation from that instant. An operator's open event
stays on its operation. A Machine Start on the new operation ends every open
Machine event anyway (the press).

**Late reports around a press.** A run reported only after a press goes to
the operation loaded when each piece ran, as a report on time would have. Two
more cases:

- **Two presses between syncs.** The sync passes the earliest press since the
  last sync (`unplannedPressAt`). When the machine ran through it, the time
  from that press to the last press that no event or row holds is recorded,
  by the owner rule (so to the queue: it follows a press in the same run).
- **A late stop trims the queue.** A stop reported only after a press may
  fall inside a queue row that the press closed. The engine cuts every closed
  unattributed row that overlaps the idle stretch (from the stop to the next
  `Running` change, else to the last press): `deleteUnattributed` when
  nothing is left, `updateUnattributed` (plus an `insertUnattributed` for the
  part after the idle stretch) otherwise. Queue rows are not posted, so this
  is safe. The engine never trims a Machine event.

**Running past a press.** A machine that is `Running` at the press
(`currentStateAt <= lastManualChangeAt`) and runs on after it: the press, a
Pause, stopped the operator's time, not the machine. The time after the
press that no event or row holds goes to the queue, never to the loaded
operation. A sync while the machine still runs opens the row once it has run
`minimumStateSeconds` past the press; a stop reported with no sync between
records the same interval closed. A machine that stops sooner, as it winds
down after a Pause, records nothing. After a Start the operator's open event
holds the time, so nothing is recorded.

**Short rows.** Each sync deletes the closed unattributed rows on its work
center shorter than `minimumStateSeconds`, whoever closed them (the sync, a
press or an unmapping).

## The MES Machine button

A machine has one machine time: operators share it. A "Start" or "Pause"
press with "Machine" selected calls `recordManualMachinePress` inside a Kysely
transaction:

1. It takes the press locks (`lockMachinePress`): the device row
   (`FOR UPDATE`, as the sync and the mapping writes take it first), then a
   transaction advisory lock on the work center
   (`machinePress:<workCenterId>`), which exists with or without a device.
   The reverse order deadlocked with a running sync. Presses on one work
   center therefore run one at a time.
2. It reads the press time under the locks (`clock_timestamp()`), unless the
   caller passes `pressedAt`. It returns `pressedAt`.
3. On every work center, with or without a device, it ends each open Machine
   event at the press time, from any operator or the sensor. It skips an event
   that starts after the press, so no duration goes negative. It returns the
   ended ids (`endedEventIds`).
4. On a mapped work center, it also ends the open unattributed time at the
   press time. Without this, a Start on a running machine with no loaded
   operation counted the same minutes on the operator's event and in the
   supervisor queue.
5. On a mapped work center, it sets `lastManualChangeAt` to
   `GREATEST(lastManualChangeAt, pressedAt)`, so the latest press never moves
   backwards, and `unplannedPressAt` to `LEAST(unplannedPressAt, pressedAt)`,
   the earliest press since the last sync. The sync clears `unplannedPressAt`.

**Start.** `startMachineProductionEvent` (MES `operations.service.ts`) runs the
press, inserts the operator's Machine event with `startTime` = `pressedAt`
(the insert loads the operation), and writes the tracked activity and its
output when a tracked entity is given, in ONE transaction. If any part fails,
nothing was ended. `event.tsx` and the QR start `start.$operationId.tsx` use
it for a Machine start on an operation with a work center.

**End.** `event.tsx` reads the event's own work center, type and `endTime`
(scoped by `companyId`), not the form's. An event that has already ended is
refused ("This event has already ended"). For a Machine event,
`endMachineProductionEvent` takes the press locks, then the event row
`FOR UPDATE` while it is still open, then presses. It returns null, and
rolls back, when the event is no longer open or the press could not end it
(it starts after the press). Any other event ends through
`endProductionEvent`, which matches only while `endTime` is null and scoped
by `companyId` ("This event has already ended, or you cannot end it"). A
repeated End therefore never moves an end time or ends a newer event.

**Permissions.** The Machine writes go through Kysely and skip RLS, so the
routes check permission before any write: `create: "production"` for a
Machine start, `update: "production"` for a Machine end. `event.tsx` returns a
flash on refusal ("You do not have permission to start machine time" / "… to
end machine time"); the QR route throws through `requirePermissions`.

**Posting.** The routes post every event a press ended:
`postEndedProductionEvents` invokes `post-production-event` per event and
skips batch events (`jobOperationBatchId` set: batch timers post at batch
completion). A failure is logged, never thrown. `event.tsx` also posts an
operator's own ended non-Machine event, and the events an `exclusive` start
ended. After a successful QR Machine start, the QR route ends the operation's
open Setup and Labor events and posts them with the events the press ended.
The QR route reads the `jobOperation` scoped by `companyId`.

After a Pause on a running machine, the time until it stops goes to the queue
("Running past a press").

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
   `companyId`), in chunks of 500. A stored change at or before
   `appliedThrough` is logged (`console.warn`), not replanned: replanning
   would rewrite closed, maybe posted, events.
5. It opens one transaction and locks the device. If the device was removed
   or remapped meanwhile, it stops. It reads the open Machine event, the open
   unattributed row, the latest Machine `endTime` after `currentStateAt`, and
   the stored changes after `appliedThrough`.
6. It computes `windowFrom`: the earliest of the first stored change,
   `unplannedPressAt`, `lastManualChangeAt`, the run's start (the later of
   `currentStateAt` and the latest Machine end; the mapping time on a first
   sync), and the open event's and row's starts. It then reads, bounded by the
   window: the loads (open, or unloaded after `windowFrom`, joined to the
   operation and job for `assignable`), the block periods ("Blocked"), and the
   recorded intervals (Machine events and unattributed rows that are open or
   end after `windowFrom`).
7. It runs `planMachineTime` and applies the writes. Each close matches only
   while `endTime` is null.
8. It deletes the closed unattributed rows on the work center shorter than
   `minimumStateSeconds`.
9. In the same transaction it sets `currentState`, `currentStateAt`,
   `appliedThrough`, `lastEventAt`, `lastSyncedAt`, clears `unplannedPressAt`
   and `lastSyncError`. `lastEventAt` is the newest stored `changedAt`, never
   earlier than before, not the sync time; it also follows changes stored by
   an earlier attempt whose plan failed (their insert conflicts now and
   returns nothing).
10. If a device fails, the job writes `lastSyncError` (500 characters at most)
    on that device. Its cursor does not move. The other devices continue,
    unless the error is `OeeProviderUnavailableError` (network failure,
    timeout, 5xx): then the run stops, since every device would fail the same
    way. `oee-sync` is a `singleton` (skip) per company and integration.

Kysely returns `timestamptz` as a JS `Date`. `syncOeeDevice` normalizes every
instant with `toInstant` before the engine compares it.

**GL posting.** The sync never posts. There is no scheduled sweep that posts
production events. An event posts at one of three moments:

1. At a press: the MES routes post every event the press ended
   (`postEndedProductionEvents`, skipping batch events).
2. At operation finish: MES `finishJobOperation` and ERP `completeOperation`
   post the operation's ended, unposted events.
3. At job completion: `complete_job_to_inventory` posts every ended,
   unposted event of the job with a duration.

A sensor event that the sync closes is an ordinary Machine event with no
employee: it posts at operation finish or job completion. An assigned
unattributed row also does not post at assign time.

## Unattributed machine time

`unattributedMachineTime` is a review queue, not a record: it has no status
(migration `20261013170425_unattributed-time-queue.sql`).
`assignUnattributedMachineTime` inserts a Machine event for the row's
interval and deletes the row; the event is the record. It refuses a row with
no `endTime` ("The machine is still running"), a `Done` or `Canceled`
operation ("The operation is Done" / "The operation is Canceled") and a locked
job ("Cannot modify a locked job. Reopen it first."), checked with
`machineTimeRefusal` under row locks on the operation and the job inside its
transaction (the route's own check is only the friendly redirect).
`dismissUnattributedMachineTime` deletes the row only when it has an
`endTime`; otherwise it returns "Machine time not found, or the machine is
still running".

The three tables the sync writes (`workCenterDevice`, `machineStateChange`,
`unattributedMachineTime`) are SELECT-only through the API (authz manifest):
every write goes through Kysely: in the sync, the MES press
(`recordManualMachinePress`) and `senseOnUninstall`, all under the device
lock, or in an entitlement-gated `@carbon/ee/oee.server` function (the
mapping writes lock the device row; assign locks the unattributed row;
dismiss deletes only a stopped row).
`upsertWorkCenterDevice` maps devices only for an integration in
`OEE_PROVIDERS` that is active for the company.

pg_cron `unattributed-machine-time-retention` (04:23 UTC) runs
`util.purge_unattributed_machine_time()`, which deletes rows whose `endTime`
is more than 30 days old. A running row is never purged.

The drawer (`x+/production+/machine-time.$id.tsx`, `MachineTimeDrawer.ee.tsx`)
walks the queue in the list's order (`startTime` desc, then `id`; the list
has no sort, `sort={null}`). `machineTimeQueueKeyset`
(`machine-time-filters.ee.ts`) builds the PostgREST filters for the rows above
and below a row. A row link carries the list's query string, so the drawer
walks the filtered list; closing the drawer goes back to the list with its
filters (not history back), and a queue move replaces the history entry. The
list has 5 filters: work center, location, start date, end date, and state
(Running blue / Stopped green: `Status` draws blue as a spinner and green as
a check). The list shows each row in its location's timezone (a `''`
timezone counts as none: the company's), and its CSV export writes the
start, end and duration the same way. The date filters use the same days:
the list and the queue read the view `unattributedMachineTimes` (migration
`20261013233811`), which adds `startDate` and `endDate` in the location's
timezone (else the company's, else UTC). `parseMachineTimeListFilters`
(`machine-time-filters.ee.ts`, pinned by
`apps/erp/test/machine-time-filters.ee.test.ts`) reads each range as two
inclusive `YYYY-MM-DD` days, and `applyMachineTimeListFilters` applies them to
the list and to the queue alike. The queue holds stopped rows only; a running row opens but shows
"Running" in place of N of M:
`getUnattributedMachineTimeNeighbors` gives the position and the rows above
and below, and every answer redirects to the row below, else the row above,
else the list. The suggestion cards come from `getWorkCenterDayEvents` (every
production event on the work center overlapping the row's days: from the
start of the day it started to the end of the day it ended, or of today while
it runs, in the location's timezone) ranked by the pure
`suggestMachineTimeOperations` (`machine-time-suggestions.ee.ts`, its
`window` argument; pinned by
`apps/erp/test/machine-time-suggestions.ee.test.ts`): operations that can take
the time first, then by the gap to the row's interval (0 when they overlap),
then by time run in the window; operations that `machineTimeRefusal` refuses
show disabled. The search card reads `getMachineTimeOperationCandidates` (open
operations on open jobs at the work center's location, this work center's
first, then the rest of the location, including operations with no work
center). If the
queue, the events or the candidates fail to load, the loader logs it and the
drawer says which part did not load (`loadErrors`) rather than showing it
empty. Keys (`MACHINE_TIME_REVIEW_SHORTCUTS`): 1–6 assign a card
(`MACHINE_TIME_SUGGESTION_LIMIT` = 6 cards), j/k move
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
- Staging has no HTTPS endpoint, so the `sense` factory in `OEE_PROVIDERS`
  refuses it when `APP_ENV` is `production` (`SENSE_STAGING_REFUSED`); the
  sync skips with that error and the healthcheck reports it.
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
`supabase_admin`. Then a later migration that replaces the function (a
generated authz migration such as `20261014030025`) fails with "must be
owner". Fix it locally:

```sql
ALTER FUNCTION public.sync_load_work_center_operation(text, text, jsonb, jsonb) OWNER TO postgres;
ALTER FUNCTION public.sync_unload_work_center_operation(text, text, jsonb, jsonb) OWNER TO postgres;
```
