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
| `packages/ee/src/oee/registry.ts` | `OEE_PROVIDERS` (keyed by `OeeProviderId`): provider id → factory, the one place a provider is named. `isOeeProviderId`, and `createOeeProvider(integrationId, metadata)`: the one resolution (id check, "No API key", the `DEFAULT_MINIMUM_STATE_SECONDS` default, the factory) behind `getOeeProvider` and the Sense healthcheck |
| `packages/ee/src/oee/service.server.ts` | `getOeeProvider` (runtime, degrades through `companyHasFeature("INTEGRATIONS")`), and 4 authoring writes that embed `requireEntitlement("INTEGRATIONS")`: `upsertWorkCenterDevice`, `deleteWorkCenterDevice`, `assignUnattributedMachineTime`, `dismissUnattributedMachineTime` |
| `packages/ee/src/sense/provider.ts` | `SenseProvider`, the Sense HTTP adapter. Pinned by `provider.test.ts` |
| `packages/ee/src/sense/config.tsx` | The descriptor: `apiKey` (secret), `environment`, `minimumStateSeconds` (default 60) |
| `packages/ee/src/sense/hooks.server.ts` | `senseHealthcheck`: calls `provider.validate()` |
| `packages/jobs/src/inngest/functions/integrations/oee-sweep.ts` | Cron `*/2 * * * *`. Sends one `carbon/oee-sync` per (company, OEE integration) that is active and has at least 1 mapped device |
| `packages/jobs/src/inngest/functions/integrations/oee-sync.ts` | `carbon/oee-sync`, concurrency 1 per company. Syncs every device of the integration in ONE `step.run` |
| `packages/jobs/src/inngest/functions/integrations/oee-sync-device.ts` | `syncOeeDevice`: read, store, then plan and apply under the device lock. Pinned by `oee-sync-device.database.test.ts` (needs `SUPABASE_DB_URL`) |
| `packages/database/src/machine-time.ts` | `lockWorkCenterDevice` (`FOR UPDATE` on the device row), `recordManualMachinePress` and `endSensorMachineTime`. Shared by the sync, the MES and the device mapping writes. Pinned by `machine-time.test.ts` (needs `SUPABASE_DB_URL`) |
| `packages/database/src/event-system/handlers/sync_load_work_center_operation.sql` | `productionEvent` AFTER INSERT: loads the operation onto the work center, only when the work center and the operation are the event's own company |
| `packages/database/src/event-system/handlers/sync_unload_work_center_operation.sql` | `jobOperation` AFTER UPDATE / DELETE: unloads the operation when it becomes Done or Canceled, is deleted, or moves to another work center |

UI:

- **Devices tab** — `apps/erp/app/modules/settings/ui/Integrations/OeeDevices.ee.tsx`,
  rendered by `x+/settings+/integrations.$id.tsx` only for an active `oee`
  integration. Its loader and action live in
  `modules/settings/oee-devices.server.ts` (`getOeeDevicesTabData`,
  `saveWorkCenterDeviceMapping`). The provider's device list is cached in
  Redis for 60 s (`oee-devices:<companyId>:<integrationId>`, never an error),
  and a mapped work center shows even when inactive.
- **Production → "Unattributed Time"** — `x+/production+/machine-time*.tsx`
  and `modules/production/ui/MachineTime/`. The nav item appears only while an
  `oee` integration is active (`useProductionSubmodules`, through
  `getIntegrationIdsByRole("oee")` and `useIntegrations`).
- **MES press rules** — `apps/mes/app/routes/x+/event.tsx` and
  `x+/start.$operationId.tsx`.
- **MES machine state** — the work center display
  (`display+/$workCenterId.work.tsx`) shows `DeviceStateBadge`
  (`components/Display/`) and "Loaded: …". `getDisplayDeviceState`
  (`display.service.ts`) hides the state when the device has a sync error or
  has not synced for 10 minutes. The operation page shows no
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
  the load, and so does deleting the operation or moving it to another work
  center (the old work center unloads). A Pause does not unload.
- **Quiet.** `loadedJobOperationId` and `loadedAt` are in
  `auditConfig.skipFields` and every function's `ignored_columns`, so a load
  change writes no audit entry, no search update and no reference broadcast.
  WEBHOOK, WORKFLOW and SYNC subscriptions still receive it.
- **No foreign key.** `loadedJobOperationId` has none (migration
  `20261013172620`): a second `jobOperation`↔`workCenter` relationship made
  PostgREST refuse every existing embed of one from the other (PGRST201), so
  the unload interceptor also handles DELETE instead.

Carbon never infers a job from the schedule. Only the load attributes time.

## Attribution rules (`planMachineTime`)

The engine reads the stored changes after `appliedThrough`, in time order.

1. If the state does not change, skip it.
2. If `changedAt <= lastManualChangeAt`, update the state only. The engine
   opens no event for it ("latest change wins"). One exception: a change to
   `Running` before the press means the machine ran before the press, and
   the provider reported it late, so the press ended nothing. That run, up to
   the press (or up to an earlier stop), becomes a closed unattributed row,
   less the time that a Machine event or an unattributed row already holds
   (`recordedIntervals`, read by the sync). A part shorter than
   `minimumStateSeconds` is dropped.
3. If the state is `Running` and an open Machine event or an open
   unattributed row exists, do nothing.
4. If the state is `Running`, check the work center. If it was not blocked
   at `changedAt` and its operation loaded at or before `changedAt`, open a
   Machine event on that operation. Set `employeeId` to null and `createdBy`
   to `system`.
5. Else, if the state is `Running`, open an `unattributedMachineTime` row.
6. If the state is `Idle`, `Down` or `Offline`, end the open Machine event
   and the open unattributed row at `changedAt`.

**Blocked.** The sync passes `blockedSince`: when maintenance began blocking
the work center. A `Down` dispatch blocks from its `createdAt` while it is
`Open`, `Assigned` or `In Progress` (the MES ends every event on the work
center when one is created, `dispatch.new.tsx`); a `Planned` one blocks once
it is `In Progress`, from `actualStartTime` (else `updatedAt`). The earliest
wins. This is broader than the view `workCentersWithBlockingStatus` (In
Progress only), which the MES display still uses. When the block begins, an
open Machine event that started before it ends at `blockedSince`, and a
running machine continues as unattributed time; an operator press after the
block wins ("latest change wins"). Pinned by `engine.test.ts`.

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
created by `system` and the unattributed rows with no `endTime`. An
operator's own open Machine event stays open.

**Steady state.** After the changes, if the device is `Running`,
`currentStateAt > lastManualChangeAt`, and nothing is open, the engine opens
time again. The start is the latest Machine `endTime` on the work center, or
`currentStateAt` when that is later. This covers 2 cases: an operation that
went Done mid-run, and a Machine event that a maintenance dispatch or End
Shift closed. Time that starts while the work center is blocked opens as
unattributed time, never on the operation.

**A load change mid-run.** The open event stays on the old operation. The
next `Running` change goes to the new one.

## The MES Machine button

A machine has one machine time: operators share it. A "Start" or "Pause"
press with "Machine" selected calls `recordManualMachinePress` inside a Kysely
transaction:

1. On every work center, with or without a device, it ends each open Machine
   event at the press time, from any operator or the sensor. It skips an event
   that starts after the press, so no duration goes negative.
2. On a mapped work center (it takes the same device lock as the sync), it
   also ends the running unattributed time at the press time. Without this, a
   Start on a running machine with no loaded operation counted the same
   minutes on the operator's event and in the supervisor queue.
3. On a mapped work center, it sets `workCenterDevice.lastManualChangeAt` to
   the press time.

A Start then inserts the operator's Machine event, which loads the operation.
An End reads the event's own work center and type (`event.tsx`), not the
form's. After a Pause on a running machine, no sensor time opens until the
device reports its next change to `Running`.

## The sync

1. `oee-sweep` (every 2 minutes) sends `carbon/oee-sync` per (company,
   integration). An installed integration with no mapped device costs nothing.
2. `oee-sync` resolves the provider with `getOeeProvider`. If the company is
   not entitled, the integration is inactive, or the key is empty, the run
   returns `skipped`.
3. For each device, `syncOeeDevice` reads changes from
   `lastEventAt − 10 minutes` to now. `lastEventAt` is the newest stored
   `changedAt` (never earlier than before), not the sync time. The overlap
   catches events that the provider stores late. The first sync reads from
   the mapping time minus 24 hours. A stored change at or before
   `appliedThrough` is logged (`console.warn`), not replanned: replanning
   would rewrite closed, maybe posted, events.
4. It inserts the changes into `machineStateChange` with
   `ON CONFLICT DO NOTHING` on (`workCenterDeviceId`, `externalEventId`,
   `companyId`), in chunks of 500.
5. It opens one transaction, locks the device, runs `planMachineTime` and
   applies the writes. Before planning, an open `system` Machine event on a
   `Canceled` operation closes at the operation's `updatedAt`.
6. In the same transaction it sets `currentState`, `currentStateAt`,
   `appliedThrough`, `lastEventAt`, `lastSyncedAt`, and clears
   `lastSyncError`.
7. If a device fails, the job writes `lastSyncError` (500 characters at most)
   on that device. Its cursor does not move. The other devices continue,
   unless the error is `OeeProviderUnavailableError` (network failure,
   timeout, 5xx): then the run stops, since every device would fail the same
   way. `oee-sync` is a `singleton` (skip) per company and integration.

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
`Canceled` operation and a locked job, checked under row locks on the
operation and the job inside its transaction (the route's own check is only
the friendly redirect).

The three tables the sync writes (`workCenterDevice`, `machineStateChange`,
`unattributedMachineTime`) are SELECT-only through the API (authz manifest):
every write goes through Kysely in the sync or an entitlement-gated
`@carbon/ee/oee.server` function, under the device lock.
`upsertWorkCenterDevice` maps devices only for an integration in
`OEE_PROVIDERS` that is active for the company.

pg_cron `unattributed-machine-time-retention` (04:23 UTC) runs
`util.purge_unattributed_machine_time()`, which deletes rows whose `endTime`
is more than 30 days old. A running row is never purged.

The drawer (`x+/production+/machine-time.$id.tsx`, `MachineTimeDrawer.ee.tsx`)
walks the queue in the list's order (`startTime` desc, then `id`; the list
has no sort, `sort={null}`). The list has 5 filters: work center, location,
start date, end date, and state (Running blue / Stopped green: `Status`
draws blue as a spinner and green as a check). The list shows each row in
its location's timezone, so the date filters use the same days: the list and
the queue read the view `unattributedMachineTimes` (migration
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
production event on the work center overlapping the row's day, in the
location's timezone) ranked by the pure `suggestMachineTimeOperations`
(`machine-time-suggestions.ee.ts`, pinned by
`apps/erp/test/machine-time-suggestions.ee.test.ts`): operations that can take
the time first, then by the gap to the row's interval (0 when they overlap),
then by time run that day; Done/Canceled operations and locked jobs show
disabled. The search card reads `getMachineTimeOperationCandidates` (open
operations on open jobs at the work center's location, this work center's
first). Keys (`MACHINE_TIME_REVIEW_SHORTCUTS`): 1–6 assign a card
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
`supabase_admin`. Then a later migration that replaces the function fails
with "must be owner". Fix it locally:

```sql
ALTER FUNCTION public.sync_load_work_center_operation(text, text, jsonb, jsonb) OWNER TO postgres;
ALTER FUNCTION public.sync_unload_work_center_operation(text, text, jsonb, jsonb) OWNER TO postgres;
```
