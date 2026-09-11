# @carbon/jobs

Server-only Inngest jobs for event draining, integrations, notifications, workflows, scheduled maintenance, and long-running tasks.

## Always

- MUST define functions under `src/inngest/functions/{events,extraction,integrations,notifications,scheduled,tasks,workflows}` and register every entry in `src/inngest/index.ts`.
- MUST dispatch from app code with `trigger()`/`batchTrigger()` from `@carbon/jobs`; event names and payloads come from `Events` in `@carbon/lib/events`.
- MUST keep event handlers idempotent (`event.data.msgId`) and preserve their per-record/company concurrency keys.
- MUST use `getJobDatabaseClient()` from `src/db.ts` in runtime jobs; the import-light backup compatibility CLI is the deliberate standalone exception.
- MUST use `patchRampCursor()` for `cursors.*`; never read and replace the whole Ramp metadata object.
- MUST keep `ramp-sync.ts` as the durable coordinator only. Family logic belongs in `ramp-sync-{card,bill,reimbursement-family,repayment,outbound}.ts`; shared tenant/currency helpers belong in `ramp-sync-shared.ts`; transactional staging remains in `ramp-sync-{payment,reimbursement}.ts`.
- MUST keep workflow business reads/writes on the owner-scoped client from `getOwnerClient()`. The privileged DB is limited to the workflow run/step ledger.

## Ask First

- Adding an Inngest registration or changing event-queue concurrency/wake cadence.
- Adding a handler type; the database `handlerType` constraint and queue dispatcher must change together.
- Adding a workflow action/operation; declare its id, input, output, and permission in `packages/workflows/src/catalog/` before implementing it in `src/workflows/actions/`.
- Changing Ramp family confirmation, cursor, payment, or reimbursement semantics; these are replay/idempotency contracts.

## Never

- Never import `@carbon/jobs/inngest` or worker modules into browser bundles. App code normally imports only `@carbon/jobs`.
- Never use the async event system for data-integrity or real-time guarantees; use database constraints/interceptors.
- Never write handler tables directly; database triggers route changes through `dispatch_event_batch()` and PGMQ.
- Never give workflow actions a service-role/untagged business client; it bypasses the owner's permissions and workflow loop guards.
- Never close the shared pool from a job function.

## Validation Commands

```bash
pnpm --filter @carbon/jobs test
pnpm --filter @carbon/jobs typecheck
pnpm --filter @carbon/jobs dev:jobs
pnpm db:check:backups
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` | `trigger`, `batchTrigger`, `Events`, Jira/Linear webhook schemas |
| `./events` | `Events` type |
| `./inngest` | Inngest client plus workflow dispatch/manual-run server seams |
| `./backups` | Import-light backup catalog, scope, and compatibility helpers |
| `./worker` | Inngest worker entry point |

## Durable Entry Points

| Function | Trigger | Responsibility |
|----------|---------|----------------|
| `event-queue` | `carbon/event-queue.process` | Serial PGMQ drain and fan-out to WEBHOOK/WORKFLOW/SYNC/SEARCH/AUDIT/EMBEDDING |
| `sync-external-accounting` | `carbon/sync-external-accounting` | Enqueue/drain accounting operations |
| `accounting-pull-sweep` | `*/30 * * * *` | Incremental inbound correctness sweep |
| `accounting-outbound-sweep` | `15,45 * * * *` | Subscription convergence and outbound reconciliation |
| `accounting-reconciliation` | `0 3 * * 1` | Remote presence/tie-out checks |
| `ramp-sync` | `carbon/ramp-sync` | Company-serialized Ramp family sync |
| `ramp-sweep` | `0 * * * *` | Dispatch Ramp sync for every active install |
| `workflow-run` | `carbon/workflow-run.queued` | Execute one owner-scoped workflow graph |
| `workflows-scheduler` | `carbon/workflow-scheduler.wake` | Self-chaining scheduled-workflow dispatcher |

## Safety Notes

- `src/inngest/functions/events/queue.ts` archives unknown handler types to `pgmq.a_event_system`; a poison message must not wedge the drain.
- `src/inngest/functions/events/sync-tables.ts` is the import-light table→accounting-entity map. `subscriptions-mapping.test.ts` pins it to provider subscriptions/syncers.
- `src/inngest/functions/integrations/ramp-sync.ts` owns step ids, ordering, result aggregation, and notification only; changing a family module must preserve that durable public shape.
- `src/workflows/actions/dispatcher.ts` is filled by `apps/erp/app/routes/api+/inngest.ts` with the canonical `callOperation` seam. Missing registration fails cleanly.
- `src/workflows/engine/log.ts` redacts secret/token/password/header values before persisting step input.
- Bare `tsx` scripts cannot rely on Vite's CJS/ESM interop. Keep runtime imports from packages without `"type":"module"` out of script dependency chains; type-only imports are safe.
- `db:check:backups` is read-only when run directly. The pre-commit hook passes `--stage` and regenerates/stages `packages/jobs/manifests/schema.json` after a successful live-schema comparison.

## Cross-References

- `.claude/rules/event-system.md` — PGMQ wake/drain architecture.
- `.claude/rules/accounting-sync-handlers.md` — accounting ledger, sweeps, and reconciliation.
- `.claude/rules/ramp-integration.md` — Ramp families and correctness contracts.
- `.claude/rules/workflow-actions.md` — action implementations and dispatch seam.
- `.claude/rules/workflow-engine.md` — owner-scoped execution and run ledger.
- `.claude/rules/workflow-matcher.md` — event matching and queued runs.
- `.claude/rules/company-backup-restore.md` — backup compatibility and manifests.
