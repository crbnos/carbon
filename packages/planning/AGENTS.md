# @carbon/planning

Community-licensed (AGPLv3) Material Planning engines: **MRP** (Material
Requirements Planning) and **finite scheduling** (the job scheduler). Both run
**in-process in Node**, inside the ERP or the Inngest worker that calls them. This package
was carved out of `@carbon/ee` so that Material Planning (Purchasing + Production
planning screens) and the scheduler are free — no free user runs Enterprise code
to plan materials.

## Always

- MUST be **dependency-injected**: every entry point takes a caller-created
  `Kysely` handle (and, for MRP, a service-role Supabase client). The caller
  authenticates first; this package never constructs a DB client.
- MUST be imported only from server contexts — route actions, `*.service.ts`,
  `*.server.ts`, or `@carbon/jobs` handlers. **Server-only**: it pulls in
  `pg`/Kysely, so it must never reach a browser bundle.
- MUST reach shared DB logic through `@carbon/database` subpath barrels
  (types → `@carbon/database`, postgres → `@carbon/database/client`,
  `explodeBom` → `@carbon/database/mrp-engine`, plus `./methods`,
  `./fetch-all`, `./supersession-pick`). Date/time math comes from
  `@carbon/utils` (`datetime`); logging from `@carbon/logger`
  (`getLogger("planning", "mrp" | "schedule")`).

## Never

- Never add an entitlement/plan gate here. This is CE — Material Planning is
  ungated. (Gating lives at call sites if a feature ever needs it.)
- Never construct a connection/pool inside this package.

## Validation Commands

```bash
pnpm --filter @carbon/planning test
pnpm --filter @carbon/planning typecheck
```

## Key Exports

Single subpath `@carbon/planning` (`./src/index.ts`):

| Export | Provides |
|--------|----------|
| `runMrp(client, db, payload)` | Material Requirements Planning (`src/mrp/mrp.ts`) |
| `generatePlanningActions(client, db, { companyId, userId })` / `PlanningActionCandidate` / `PlanningActionType` | Planning action messages (Order / Make / Expedite / Defer / Increase / Decrease / Cancel), diff-written to `planningAction` in one transaction; `runMrp` calls it after its Phase-7 commit (`src/mrp/planning-actions.ts`) |
| `loadResponsibleEmployeeResolver(db, companyId)` / `resolveResponsibleEmployee(rungs)` | Who owns an item + location's actions: item → location item group → location → company default, first non-null wins (`src/mrp/responsible-employee.ts`) |
| `runLocationSchedule` / `runExpediteWhatIf` | Finite scheduling — regenerate a whole location, or a simulate-only expedite what-if (`src/scheduling/run-schedule.ts`) |
| `runQuoteLeadTimeWhatIf(params)` | Capable-to-promise for a quote line — drives the pure `WorkCenterSelector` with synthetic ops (queued vs front-of-queue contexts) per quantity, returns `QuoteLeadTimeForecast`; persists nothing (`src/scheduling/quote-lead-time.ts`) |
| `resolveLocationWindows` / `resolveWorkCenterWindows` / `subtractIntervals` | Machine/work-center availability window resolvers (`src/scheduling/`) |
| types (`LadderShiftRow`, `MrpPayload`, `MrpResult`, `LocationScheduleResult`, `ExpediteWhatIfResult`, `NewlyLateJob`, …) | Engine type surface |

Internal to `runMrp`, not exported: `consumeForecast` (`src/mrp/forecast-consumption.ts` —
actual demand consumes the demand projection in its own week, then backward, then forward,
per the company's consumption window; the consumed amount is persisted on
`demandProjection.consumedQuantity`) and `purchaseOrderLineArrivalDate`
(`src/mrp/supply-date.ts` — when an open PO line arrives: promised date, else required
date, else order date + lead time).

## Consumers

- `@carbon/jobs` — `scheduled/mrp.ts` (`runMrp`), `tasks/recalculate.ts` &
  `scheduled/schedule-inputs-changed.ts` (`runLocationSchedule`).
- `apps/erp` — `production.service.ts` (dynamic imports of `runMrp` /
  `runLocationSchedule` / `runExpediteWhatIf`), `forecast.server.ts`,
  `routes/api+/schedule.ts`, `routes/api+/kanban.$id.tsx`,
  `routes/x+/job+/$jobId.status.tsx`.

## Cross-References

- `.claude/rules/mrp-system.md` — MRP run flow and engine internals.
- `.claude/rules/scheduling-data-structures.md` — finite scheduling data model.
- `.claude/rules/supersession-system.md` — supersession redirects MRP consumes.
- `packages/database/AGENTS.md` — the `@carbon/database` subpath barrels this
  engine depends on (`./mrp-engine`, `./client`, `./methods`, …).
