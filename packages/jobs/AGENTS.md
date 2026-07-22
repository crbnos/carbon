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
| WORKFLOW | `carbon/event-workflow` | Workflow dispatch (stub) |

## Cross-References

- `.claude/rules/event-system.md` — full event architecture, PGMQ, triggers, handler details
- `packages/database/src/event.ts` — event Zod schemas, subscription CRUD helpers
- `packages/database/src/audit.config.ts` — audit entity definitions
- `packages/lib/` — Inngest client, event types, trigger helpers (source of truth)
