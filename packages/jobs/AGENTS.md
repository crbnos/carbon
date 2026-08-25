# @carbon/jobs

Background job system built on Inngest. Handles event system processing (webhooks, sync, search, audit, embeddings), integrations (Jira, Linear, accounting sync — Xero/QBO/Rillet, Slack, Onshape), notifications, scheduled tasks, and async workflows.

## Always

- Define new Inngest functions in the appropriate subdirectory under `src/inngest/functions/` (events, integrations, notifications, scheduled, tasks).
- Use `trigger()` or `batchTrigger()` from `@carbon/jobs` to dispatch events from app code — these re-export from `@carbon/lib/trigger`.
- Define event types in the shared `Events` type (re-exported from `@carbon/lib/events`) so Inngest has full type safety.
- Event system handlers use idempotency keys (`event.data.msgId`) and per-record concurrency — maintain this pattern.

## Ask First

- Adding new handler types to the event system — requires DB migration to widen the `handlerType` CHECK constraint.
- Changing the event queue's flow control (`concurrency: 1`) or the pg_cron sweeper cadence — affects latency and coalescing for all async event processing. The drainer is push-woken by `carbon/event-queue.process` (see `.claude/rules/event-system.md`), not cron-polled. Note: `debounce` is intentionally NOT used — the local Inngest dev server can't unmarshal debounce items; bursts are coalesced by the per-transaction wake instead.
- Adding new Inngest function registrations — they must be exported and registered in the functions index.
- Adding a workflow action or operation — the declaration and its permission belong in
  `packages/workflows/src/catalog/`, and only then does an implementation go in
  `src/workflows/actions/`. An implementation with no catalog entry can never be reached; a catalog
  entry with no implementation fails at run time in front of a customer.

## Never

- Import Inngest internals or server-only job code in app bundles — use only the public exports from `@carbon/jobs` (`.` subpath: `trigger`, `batchTrigger`, schemas).
- Use the event system for real-time / data-integrity needs — it is async (typically ~3–5s, up to ~1 min if a push wake is lost). Use sync interceptors instead.
- Bypass the PGMQ queue by writing directly to handler tables — always go through `dispatch_event_batch()` triggers.
- Give a workflow action anything but the owner-scoped client it was handed. A privileged or
  untagged write escapes the owner's permissions and goes invisible to the matcher's origin filter
  and loop guards.

## Validation Commands

```bash
pnpm --filter @carbon/jobs test
pnpm --filter @carbon/jobs typecheck
pnpm --filter @carbon/jobs dev:jobs   # Start local Inngest dev server
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` (index) | `trigger()`, `batchTrigger()`, `Events` type, Jira/Linear webhook schemas |
| `./events` | `Events` type (re-export from `@carbon/lib`) |
| `./inngest` | Inngest client + function registrations, plus `setWorkflowDispatch` and its `WorkflowDispatch` / `DispatchContext` / `DispatchResult` types (server-only) |
| `./worker` | Worker entry point for Inngest serve |

## Event System Handlers

| Handler | Event | Purpose |
|---------|-------|---------|
| WEBHOOK | `carbon/event-webhook` | POST to configured URL. Backs the user-facing Settings → Webhooks feature; its body `{type, record, old?, companyId, table}` is a public contract — change `toWebhookBody` only with the docs and `webhook.test.ts` |
| SYNC | `carbon/event-sync` | Accounting sync for all three providers (Xero, QBO, Rillet) — v5: events are hints; refs go to the shared `reconcileEntities` executor (`integrations/reconcile.ts` decides from state), then the `accountingSyncOperation` ledger drains; table→entity map in `events/sync-tables.ts` (see `.claude/rules/accounting-sync-handlers.md`) |
| SEARCH | `carbon/event-search` | Upsert/delete search index |
| AUDIT | `carbon/event-audit` | Per-company audit log |
| EMBEDDING | `carbon/event-embedding` | AI embeddings for items/customers/suppliers |
| WORKFLOW | `carbon/event-workflow` | Customer-workflow matcher: announcement → catalog event ids → subscribed workflows → one `workflowRun` each |

The queue drainer (`events/queue.ts`) archives messages with an unknown `handlerType` to pgmq's
dead-letter table (`pgmq.a_event_system`) instead of crash-looping — a poison message can no
longer wedge all event processing.

## Accounting sync functions (`src/inngest/functions/integrations/`)

Full architecture in `.claude/rules/accounting-sync-handlers.md`; the ones to know:

| Function | Trigger | Purpose |
|----------|---------|---------|
| `sync-external-accounting` | `carbon/sync-external-accounting` | Webhook-fired entry point; enqueues + drains the `accountingSyncOperation` ledger |
| `accounting-pull-sweep` | cron `*/30 * * * *` | INBOUND correctness: incremental pull (`listChanges`) for every active integration |
| `accounting-outbound-sweep` | cron `15,45 * * * *` | OUTBOUND correctness backstop (v4/v5): subscription convergence, then pages the window's candidate refs into the shared `reconcileEntities` executor (same brain as the event path), then a drain (Xero's only periodic drain). Fires `NotificationEvent.IntegrationSync` (in-app) to the integration's configurer when the drain leaves failed ops |
| `accounting-reconciliation` | cron `0 3 * * 1` | Provider-agnostic (all three) presence drift check + `accountingSyncTieOut` writer — one cell per (integration × period × account) |
| `accounting-consolidation` | cron `0 2 * * *` | Daily-consolidation journal push (one aggregated provider journal per posting date) |
| `accounting-backfill` | `carbon/accounting-backfill` | Explicit history backfill |

## Workflow functions (`src/inngest/functions/workflows/`)

| Function | Event | Purpose |
|----------|-------|---------|
| `workflow-moment` | `carbon/workflow-moment.raised` | Moment entry point of the same matcher (a moment already IS a catalog event id) |
| `workflow-run` | `carbon/workflow-run.queued` | Walks one matched run's graph — one durable step per node, acting as the workflow's owner. Thin wrapper over `src/workflows/engine/` |
| `workflows-scheduler` | `carbon/workflow-scheduler.wake` | Self-chaining scheduler wake: scans due workflows, claims and books the next wake, dispatches Queued/Skipped runs |
| `workflows-scheduler-backstop` | cron `0 * * * *` | Hourly: sends a wake if the chain has gone quiet (Redis TTL expired or never set) |
| `workflow-run-retention` | cron `0 4 * * *` | Nightly: reap stale runs, purge 90-day headers, drop 30-day step detail, compact 7-day payloads via `compactForLog` |

The scheduler's Inngest-free core lives in `src/workflows/scheduler.ts` — same pattern as
`matcher.ts`. The chain is kick-started by `trigger("workflow-scheduler-wake", { bookedFor: null })`
inside `syncAndWake` (`apps/erp/app/modules/workflows/workflows.server.ts`), so activating a
scheduled workflow starts it within minutes; the hourly backstop revives it if it goes quiet.

All entry points call one shared core in `src/workflows/` (`event-ids.ts`, `matcher.ts`,
`scheduler.ts`, `types.ts`), which imports no Inngest and is unit-tested directly. See
`.claude/rules/workflow-matcher.md`.

The engine lives in `src/workflows/engine/` (`walk.ts`, `owner.ts`, `loader.ts`,
`ledger.ts`, `log.ts`, `execute.ts`, `manual.ts`) and imports no Inngest either.
`manual.ts` is the builder's test run: the same walk and the same real side effects, so
it writes the same run history with `workflowRun.isTest = true`. **A running workflow
acts as its owner**: every business read goes through `getOwnerClient(ownerId, runId)`,
minted per step and always carrying the run tag. `getJobDatabaseClient()` is allowed in
the engine only for the two run-log tables — a business read through it bypasses the
owner's permissions. See `.claude/rules/workflow-engine.md`.

Step ids are deterministic. An ordinary node is `` `node:${nodeId}` ``; an action node fed a list
where the catalog declares a single value (`batchPlan` in `@carbon/workflows` — there is no stored
flag) resolves that list outside the durable steps, then runs one step per item as
`` `node:${nodeId}:${itemKey}` ``, followed by **one aggregate row** under `` `node:${nodeId}` ``
(`itemKey: ""`) whose handle is what the walk follows and whose `statusReason` is where a dropped
or failed item becomes visible. The aggregate succeeds if at least one item did; a failed item
does not stop the graph but does mark the run `Failed`.

`ledger.ts` also writes the step's `input` column through `redactForLog`, which drops any key
matching `/secret|token|password|signature|authorization|apikey|api_key/i`, masks every value of a
`pairs` (the webhook's request headers) by shape while keeping its names, and truncates strings
over 4 KB. Anything new that lands in that column goes through it.

## Workflow actions (`src/workflows/actions/`)

The `WorkflowServices` implementation — everything the pure `@carbon/workflows` runtime cannot do
for itself. `createWorkflowServices()` in `services.ts` is the one port the runtime calls
(`runAction` / `runOperation` / `search`); `execute.ts` builds one per step from the owner's
freshly-minted client, so every call here carries the owner's identity and RLS still applies.
Routing is off the catalog's `getActionRoute(id)`, never off the shape of an id.

| File | What it does |
|------|--------------|
| `services.ts` | `createWorkflowServices` — routes an action id to `notify`, `webhook`, the update path or the create path; the only export the engine uses |
| `dispatcher.ts` | The `setWorkflowDispatch` seam (below) |
| `create.ts` | `runCreateAction` — creates through the ERP's own `upsert*` service function via the dispatcher, so sequence numbers, defaults and required-field logic are the app's; digs the new row's id out of the returned envelope |
| `update.ts` | `runUpdateAction` — writes the catalog's allowlisted columns on one record. Checks the target and **every entity-typed value** exists in this company before writing, and rejects a value outside a column's enum. A custom field is written separately, through the `workflow_merge_custom_fields` RPC, so setting one cannot erase the others |
| `notify.ts` | `runNotifyAction` — one `trigger("notify", …)` with `NotificationEvent.Workflow`. A role IS a group and every user has an identity group whose id is their user id, so both recipient inputs collapse to `groupIds` |
| `search.ts` | `runSearch` — one Lookup node's search, translated to PostgREST filters that mean exactly what `runtime/compare.ts` says (`contains`/`startsWith`/`endsWith` → `ilike`). Reads `MAX_LIST_ITEMS + 1` so an over-cap list is detectable |
| `operations.ts` | `runOperation` — the 15 read-only computations, one `COMPUTATIONS` entry per catalog operation id. An id with no implementation refuses rather than falls through; a throw becomes a failed node, never a thrown walk |
| `webhook.ts` | `runWebhookAction` — the chosen method (POST when unset) to the configured URL with the customer's headers, SSRF-guarded, `redirect: "manual"`, 10s timeout, 2 KB response excerpt for the step summary. Only POST/PUT/PATCH carry a body; eight framing header names are refused |
| `url-guard.ts` | `checkOutboundUrl` — https only, DNS-resolves the host and rejects if **any** returned address is private/loopback/link-local (169.254.0.0/16 covers cloud metadata). Plus `outboundDispatcher`, an undici `Agent` running the same check as the socket's own `connect.lookup` — that, not the pre-check, is what closes DNS rebinding |
| `index.ts` | Barrel; `engine/execute.ts` imports `createWorkflowServices` from here |

### The dispatch seam

`packages/jobs` cannot import `~/modules/*` — the dependency only runs app → package. So
`dispatcher.ts` holds a module-level `WorkflowDispatch` slot, and the ERP app fills it at boot:
`apps/erp/app/routes/api+/inngest.ts` calls `setWorkflowDispatch(executeFunction)` with the MCP
direct executor from `./mcp+/lib/direct-executor`. The type is structural, so the app satisfies it
without importing anything from here beyond the setter (re-exported from `@carbon/jobs/inngest`).
With no dispatcher registered, create actions fail cleanly with "This step is not available in this
environment" — they do not throw.

See `.claude/rules/workflow-actions.md`.

## Database client

`getJobDatabaseClient(size = 1)` from `src/db.ts` is the package's only Kysely
constructor — used by the event-queue drainer, the workflow matcher, the workflow engine's
two run-log tables, and the company backup/export/import/restore tasks. Don't build a new
pool inline.

## Cross-References

- `.claude/rules/workflow-actions.md` — the actions/operations implementations, the dispatch seam,
  the tenancy and SSRF guards
- `.claude/rules/workflow-engine.md` — the run walk, step ledger, batching, acting as the owner
- `.claude/rules/workflow-matcher.md` — announcement → catalog event ids → queued runs
- `.claude/rules/event-system.md` — full event architecture, PGMQ, triggers, handler details
- `packages/database/src/event.ts` — event Zod schemas, subscription CRUD helpers
- `packages/database/src/audit.config.ts` — audit entity definitions
- `packages/lib/` — Inngest client, event types, trigger helpers (source of truth)
