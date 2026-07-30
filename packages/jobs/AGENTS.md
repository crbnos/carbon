# @carbon/jobs

Background job system built on Inngest. Handles event system processing (webhooks, sync, search, audit, embeddings), integrations (Jira, Linear, Xero, Slack), notifications, scheduled tasks, and async workflows.

## Always

- Define new Inngest functions in the appropriate subdirectory under `src/inngest/functions/` (events, integrations, notifications, scheduled, tasks).
- Use `trigger()` or `batchTrigger()` from `@carbon/jobs` to dispatch events from app code — these re-export from `@carbon/lib/trigger`.
- Define event types in the shared `Events` type (re-exported from `@carbon/lib/events`) so Inngest has full type safety.
- Event system handlers use idempotency keys (`event.data.msgId`) and per-record concurrency — maintain this pattern.

## Ask First

- Adding new handler types to the event system — requires DB migration to widen the `handlerType` CHECK constraint.
- Changing the event queue's flow control (`concurrency: 1`) or the pg_cron sweeper cadence — affects latency and coalescing for all async event processing. The drainer is push-woken by `carbon/event-queue.process` (see `.claude/rules/event-system.md`), not cron-polled. Note: `debounce` is intentionally NOT used — the local Inngest dev server can't unmarshal debounce items; bursts are coalesced by the per-transaction wake instead.
- Adding new Inngest function registrations — they must be exported and registered in the functions index.

## Never

- Import Inngest internals or server-only job code in app bundles — use only the public exports from `@carbon/jobs` (`.` subpath: `trigger`, `batchTrigger`, schemas).
- Use the event system for real-time / data-integrity needs — it is async (typically ~3–5s, up to ~1 min if a push wake is lost). Use sync interceptors instead.
- Bypass the PGMQ queue by writing directly to handler tables — always go through `dispatch_event_batch()` triggers.

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
| `./inngest` | Inngest client + function registrations (server-only) |
| `./worker` | Worker entry point for Inngest serve |

## Event System Handlers

| Handler | Event | Purpose |
|---------|-------|---------|
| WEBHOOK | `carbon/event-webhook` | POST to configured URL |
| SYNC | `carbon/event-sync` | Accounting sync (Xero) |
| SEARCH | `carbon/event-search` | Upsert/delete search index |
| AUDIT | `carbon/event-audit` | Per-company audit log |
| EMBEDDING | `carbon/event-embedding` | AI embeddings for items/customers/suppliers |
| WORKFLOW | `carbon/event-workflow` | Customer-workflow matcher: announcement → catalog event ids → subscribed workflows → one `workflowRun` each |

## Workflow functions (`src/inngest/functions/workflows/`)

| Function | Event | Purpose |
|----------|-------|---------|
| `workflow-moment` | `carbon/workflow-moment.raised` | Moment entry point of the same matcher (a moment already IS a catalog event id) |
| `workflow-run` | `carbon/workflow-run.queued` | Walks one matched run's graph — one durable step per node, acting as the workflow's owner. Thin wrapper over `src/workflows/engine/` |

Both entry points call one shared core in `src/workflows/` (`event-ids.ts`, `matcher.ts`,
`types.ts`), which imports no Inngest and is unit-tested directly. See
`.claude/rules/workflow-matcher.md`.

The engine lives in `src/workflows/engine/` (`walk.ts`, `owner.ts`, `loader.ts`,
`ledger.ts`, `log.ts`, `execute.ts`) and imports no Inngest either. **A running workflow
acts as its owner**: every business read goes through `getOwnerClient(ownerId, runId)`,
minted per step and always carrying the run tag. `getJobDatabaseClient()` is allowed in
the engine only for the two run-log tables — a business read through it bypasses the
owner's permissions. See `.claude/rules/workflow-engine.md`.

## Database client

`getJobDatabaseClient(size = 1)` from `src/db.ts` is the package's only Kysely
constructor — used by the event-queue drainer, the workflow matcher, and the company
backup/export/import/restore tasks. Don't build a new pool inline.

## Cross-References

- `.claude/rules/event-system.md` — full event architecture, PGMQ, triggers, handler details
- `packages/database/src/event.ts` — event Zod schemas, subscription CRUD helpers
- `packages/database/src/audit.config.ts` — audit entity definitions
- `packages/lib/` — Inngest client, event types, trigger helpers (source of truth)
