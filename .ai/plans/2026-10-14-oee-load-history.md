# OEE: load history and time after a press

## Goal

Every second the sensor reports as Running is recorded exactly once, in
whatever order the reports and the presses arrive. The sensor decides whether
the machine ran. The load at that time decides which operation gets it. A
press decides only what happens after it.

## Decisions

| # | Decision |
|---|---|
| 1 | A new table `workCenterLoad` records each load: work center, operation, `loadedAt`, `unloadedAt` (null while loaded). |
| 2 | The load and unload interceptors write it. The pointer `workCenter.loadedJobOperationId` stays as the current value. |
| 3 | `jobOperationId` has no foreign key: a table with keys to both `workCenter` and `jobOperation` can make PostgREST embeds ambiguous (`.ai/lessons.md`, PGRST201). |
| 4 | pg_cron deletes a load 7 days after its `unloadedAt`. An open load is never deleted. |
| 5 | The engine takes `loads` (periods with `assignable`) in place of `loadedJobOperationId` / `loadedAt`. Time goes to the load at the moment the run starts. |
| 6 | A load is `assignable` while its operation is not Done or Canceled and its job is not locked. Otherwise the time goes to the queue. |
| 7 | A run reported late, before a press, splits by load: a loaded, unblocked part becomes a closed system Machine event; the rest becomes unattributed time. |
| 8 | A run that was already Running at the press and continues after it: the uncovered time after the press is unattributed time, never the loaded operation (the operator said stop charging it). The live row opens only once the machine has run `minimumStateSeconds` past the press. |
| 9 | Each sync deletes the closed unattributed rows on its work center shorter than `minimumStateSeconds`, whoever closed them. |

## Tasks

- [x] 1. Migration: `workCenterLoad`, the backfill of current loads, the retention function and its cron job.
- [x] 2. Authz manifest: SELECT only, for employees of the company.
- [x] 3. Interceptors: the load closes the open period and opens one; the unload closes it.
- [x] 4. Run `pnpm db:migrate`, then `authz migration`, then `pnpm run generate:types`.
- [x] 5. SQL test: history rows on load, reload, Done, delete and move.
- [x] 6. Engine: `loads`, `loadAt`, the split of late gaps, the time after a press.
- [x] 7. Engine tests: both arrival orders for case B and for the Pause case.
- [x] 8. Sync: read the loads with `assignable`, widen `recordedIntervals`, delete short rows.
- [x] 9. Sync database tests for case B with a load and for the Pause case.
- [x] 10. Docs: the OEE rule, the production `AGENTS.md`, the integration guide.
- [x] 11. Verify: typecheck, tests, Biome, dataset and backup checks. Commit and push.
