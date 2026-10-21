# OEE: fixes from the strict self-review

Source: the nuclear self-review of PR #1909 on 2026-10-14. Each task names the
finding it fixes.

## Decisions

| # | Decision |
|---|---|
| 1 | The open `workCenterLoad` row is the load. The migration drops `workCenter.loadedJobOperationId` and `loadedAt`. Readers use the open row. |
| 2 | A load is refused when its start is earlier than the newest boundary in the work center's history (a `loadedAt` or an `unloadedAt`). (A starting event reopens a Done operation first, so status needs no rule.) |
| 3 | An unload ends the open row at `GREATEST(NOW(), "loadedAt")`. A CHECK refuses `unloadedAt < loadedAt`. A partial unique index allows one open row per work center. |
| 4 | A press records the earliest press since the last sync in `workCenterDevice.unplannedPressAt`. The sync clears it. |
| 5 | Time after a press, in the same run, goes to the queue. Time in a run with no press before it goes to the operation loaded at that moment. The engine applies one owner rule to every piece. |
| 6 | An open system slot follows its owner: it closes where the owner changes (a load change, a block start or end, an unassignable operation) and the next owner opens. This replaces the Canceled special case. |
| 7 | A late stop before a press trims the closed unattributed rows it overlaps. The engine never trims a Machine event. |
| 8 | A press takes its time under the lock, and it serializes on a transaction advisory lock for each work center. |
| 9 | The routes post every event a press ends, except batch events. |
| 10 | The migrations are not squashed: squashing needs a database rebuild, which the user must run. |
| 11 | Load rows stay 7 days after the unload (the user's decision). The purge keeps a row that a device has not planned past yet. |

## Tasks

### Database
- [x] 1. Migration: drop the pointer columns. Add the CHECK, the one-open index and the index for the sync's Machine-event reads. Add `unplannedPressAt`. Change the retention guard.
- [x] 2. Interceptors: write only `workCenterLoad`, with the boundary rule. (The status rule was dropped: see decision 2.)
- [x] 3. Event functions and `auditConfig.skipFields`: remove the pointer columns.
- [x] 4. The MES display view and service: read the open row.
- [x] 5. `packages/jobs/src/backups/id-refs.ts`: add `workCenterLoad.jobOperationId` and `machineStateChange.workCenterDeviceId`.
- [x] 6. SQL test: an older event after an unload, a reload, the CHECK, the index, the purge.

### Engine and sync
- [x] 7. Engine: the owner rule, slots that follow their owner, the trim of late idle time, `firstUnplannedPressAt`.
- [x] 8. Engine tests that run the same facts in different orders and compare the result.
- [x] 9. Sync: bounded reads, `recordedIntervals` with ids, `unplannedPressAt`, the trims, `lastEventAt` from stored changes, guarded close, no Canceled block.
- [x] 10. One pure `machineTimeRefusal` in `@carbon/ee/oee`, used by the sync, the ee service and the ERP.
- [x] 11. The `companyId` join in `service.server.ts`.

### Press (MES)
- [x] 12. `recordManualMachinePress`: advisory lock, press time taken under the lock, `GREATEST` on `lastManualChangeAt`, `unplannedPressAt`. Test that a press records itself.
- [x] 13. `startMachineProductionEvent` runs a Machine start (press, event, tracked activity) in one transaction. Remove the hook.
- [x] 14. `endMachineProductionEvent` in the service. The End route uses it and checks `endedEventIds`.
- [x] 15. Routes: check permission before any write (both routes), post the ended events, scope `endProductionEvent` by `companyId`, give a clear message for a refused End.

### ERP (subagent)
- [x] 16. Row link and close keep the list filters. Queue moves replace history.
- [x] 17. Drawer: log and show load errors. Suggestions span the interval's days.
- [x] 18. Search candidates include operations with no work center.
- [x] 19. Timezone: treat `''` as missing.
- [x] 20. Devices tab: store the matched device's fields. The picker hides work centers mapped to another device. A light module holds the cache key. The provider read runs in parallel.
- [x] 21. Lingui named placeholders, one casing. CSV duration and times.
- [x] 22. Tests: the queue keyset, more filter cases.

### Deactivation
- [x] 23. Uninstalling or deactivating an OEE integration ends the sensor time of its devices.

### Docs
- [x] 24. The OEE rule, the production `AGENTS.md`, the database and jobs `AGENTS.md`, `oee.mdx`, `work-centers.mdx`, the spec, and one lesson.

### Verify
- [x] 25. Typecheck, tests, Biome, Lingui, dataset and backup checks. Commit and push.
