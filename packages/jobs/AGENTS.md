# @carbon/jobs

Server-only Inngest jobs for event draining, integrations, notifications, workflows, scheduled maintenance, and long-running tasks.

## Always

- MUST define functions under `src/inngest/functions/{events,extraction,integrations,notifications,scheduled,tasks,workflows}` and register every entry in `src/inngest/index.ts`.
- MUST dispatch from app code with `trigger()`/`batchTrigger()` from `@carbon/jobs`; event names and payloads come from `Events` in `@carbon/lib/events`.
- MUST keep event handlers idempotent (`event.data.msgId`) and preserve their per-record/company concurrency keys.
- MUST use `getJobDatabaseClient()` from `src/db.ts` in runtime jobs; the import-light backup compatibility CLI is the deliberate standalone exception.
- MUST use `patchRampCursor()` for `cursors.*`; never read and replace the whole Ramp metadata object. Only `repaymentsRepaidAt` remains — Ramp's outbound push is ledger-driven, not cursor-driven.
- MUST keep `ramp-sync.ts` as the durable coordinator only. Family logic belongs in `ramp-sync-{card,bill,reimbursement-family,repayment}.ts` (the outbound PO/bill WIRE left this package for `@carbon/ee/ramp/entities` syncers on the event engine; the outbound candidate walk behind the `ramp-outbound-reconcile` step is `ramp-sync-outbound.ts`); shared tenant/currency helpers belong in `ramp-sync-shared.ts`; transactional staging belongs in `ramp-sync-{card-stage,bill-stage,payment,reimbursement}.ts`.
- MUST keep workflow business reads/writes on the owner-scoped client from `getOwnerClient()`. The privileged DB is limited to the workflow run/step ledger.

## Ask First

- Adding an Inngest registration or changing event-queue concurrency/wake cadence.
- Adding a handler type; the database `handlerType` constraint and queue dispatcher must change together.
- Adding a workflow action/operation; declare its id, input, output, and permission in `packages/workflows/src/catalog/` before implementing it in `src/workflows/actions/`.
- Changing Ramp family confirmation, cursor, payment, or reimbursement semantics; these are replay/idempotency contracts.

## Never

- Never import `@carbon/jobs/inngest` into browser bundles. App code normally imports only `@carbon/jobs`.
- Never use the async event system for data-integrity or real-time guarantees; use database constraints/interceptors.
- Never write handler tables directly; database triggers route changes through `dispatch_event_batch()` and PGMQ.
- Never give workflow actions a service-role/untagged business client; it bypasses the owner's permissions and workflow loop guards.
- Never close the shared pool from a job function. A Node process has one pool (`getProcessPool()`, 16 connections) shared with the app's requests; `getJobDatabaseClient()` takes no size.

## Validation Commands

```bash
pnpm --filter @carbon/jobs test
pnpm --filter @carbon/jobs typecheck
pnpm --filter @carbon/jobs dev:jobs
pnpm db:check:backups
pnpm --filter @carbon/jobs plan:company -- --company <id> --user <id>   # MRP + schedule one company
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` | `trigger`, `batchTrigger`, `Events`, Jira/Linear webhook schemas |
| `./events` | `Events` type |
| `./inngest` | Inngest client plus workflow dispatch/manual-run server seams |
| `./backups` | Import-light backup catalog, scope, and compatibility helpers |

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
| `recurring-billing` | `0 5 * * *` | The one daily job for every recurring-invoice source: rental agreements and AR contracts. One query finds every company with an Active rental agreement or Active `customerContract`. Per company, as of the company's today, `userId "system"`: a `rental-billing-<id>` step (the `create-rental-invoices` server function), then a `contract-billing-<id>` step (`create-contract-invoices`, same `asOf`); a failed source never skips the other. Then an `automation-candidates-<id>` step (`findInvoicesToAutomate`) reads back every Draft — or Pending, a crashed claim — invoice the job created (`createdBy "system"`) with no hold whose source mode is not Draft Only, so drafts from a failed or retried drafting step are still automated; the drafting steps' results only report this run's planner holds. Per candidate a `post-<id>` step (`postSalesInvoiceUnattended`), a `pdf-<id>` step once it is posted (`attachPostedInvoicePdf` — every posting mode files the invoice PDF under its opportunity, as a manual Post does; the email step reuses that file rather than recording a second), and, by the source's effective mode, an `email-<id>` step (`emailPostedInvoice`, `Post and Email`) or a `stripe-<id>` step (`sendPostedInvoiceViaStripe`, `Post and Send via Stripe`; counts as sent in the digest), all in `src/invoicing/automate-invoice.ts`. Then one "Recurring invoicing" digest per owner (agreement or contract `salesPersonId ?? createdBy`) plus the company's `invoiceNotificationGroup` (`buildRecurringInvoicingDigests`, `src/invoicing/digest.ts`) |
| `invoice-automate` | `carbon/invoice.automate` | Posts one drafted recurring invoice (rental or contract), then emails it under `Post and Email` or sends it through Stripe Connect under `Post and Send via Stripe`; mode from the event or the source's effective mode (`resolveInvoiceAutomation`: `customerContracts.effectiveInvoiceAutomation` when the invoice has a `customerContractId`, else the rental agreement's). Fired by the **Invoice** action of a rental agreement or contract, by Sell to Customer, and by the invoice's Send action (`resend: true` — Stripe when that is the resolved mode, else `Post and Email`). One run per invoice (`concurrency` on `invoiceId`, not shared with the cron's steps). Every step is safe to retry: posting claims only a Draft (a Pending claim is reported as held, never re-claimed), and a send is skipped once `sentAt` is set or a Stripe invoice is linked — but an email that went out before its `sentAt` write failed is recorded as a `sendError`, and a Send then emails it again. `sendPostedInvoiceViaStripe` stamps `sentTo: "Stripe"`, or `sendError` "Stripe is not connected" / "No Stripe customer is linked", and never sends an invoice twice (it checks `sentAt` and the existing Stripe invoice link) |
| `revenue-recognition-proposal` | `0 12 1 * *` | One query (`companiesToPropose`: `company` joined to `companySettings`, `accountingCutoverDate` set) finds every company with an accounting cutover. Per company, one step: proposes a Draft revenue recognition run for the month that just ended on the company's calendar (the `propose-revenue-recognition-run` server function, `userId "system"`). Only an existing Draft run for that period skips it; a Posted run does not, because rows can fall due after it posted. Posting stays human |
| `notification-digest` | `carbon/notification-digest.process` (sent by the `notification-digest-sweeper` pg_cron job every 15 min, only when `util.notification_digest_has_work()`) | Roll unread notifications into one digest per user, company and topic |
| `workflow-run-retention` | `carbon/workflow-run-retention.process` (sent by the `workflow-run-retention-sweeper` pg_cron job at 04:00 UTC, only when `util.workflow_run_retention_has_work()`) | Reap stale runs, compact and drop step detail, purge old run headers |
| `embedding-queue` | `carbon/embedding-queue.process` (sent by the 10 s `process-embeddings` pg_cron doorbell while visible messages wait) | Drain the pgmq `embedding_jobs` queue and write embeddings |
| `mrp` | `*/15 * * * *` | Scheduled MRP. Each tick plans only the companies that are DUE — every 3 hours (UTC) by default, or once a day at `companySettings.mrpRunTime` on the company's clock (`isMrpDue` / `mrpTick`) — and have planning work (`companiesWithPlanningWork`), both in `scheduled/mrp-companies.ts`; one `step.run` per company |

## Safety Notes

- `src/inngest/functions/events/queue.ts` archives unknown handler types to `pgmq.a_event_system`; a poison message must not wedge the drain.
- `src/inngest/functions/events/embedding.ts` (`embedding-queue`) deletes embedded messages and archives (`pgmq.archive`) permanent failures (unknown table, no text) and any message read `MAX_READS` (5) times; other failures become visible again after the 300 s visibility timeout.
- Jobs that post or recalculate (`tasks/post-transaction.ts`, `tasks/recalculate.ts`, the Ramp families, the invoice automation in `src/invoicing/automate-invoice.ts`) call `@carbon/server-functions` directly, in-process — not over HTTP.
- `src/inngest/functions/events/sync-tables.ts` is the import-light table→accounting-entity map. `subscriptions-mapping.test.ts` pins it to provider subscriptions/syncers.
- `src/inngest/functions/integrations/ramp-sync.ts` owns step ids, ordering, result aggregation, and notification only; changing a family module must preserve that durable public shape.
- `src/workflows/actions/dispatcher.ts` is filled by `apps/erp/app/routes/api+/inngest.ts` with the canonical `callOperation` seam. Missing registration fails cleanly.
- `src/workflows/engine/log.ts` redacts secret/token/password/header values before persisting step input.
- Bare `tsx` scripts cannot rely on Vite's CJS/ESM interop. Keep runtime imports from packages without `"type":"module"` out of script dependency chains; type-only imports are safe.
- `src/demo-planning.ts` `planDemoCompany` runs MRP + `runLocationSchedule` over a company after a demo template commits; it never throws. Called by the `company-template` job's non-fatal `plan-template` step and by the `plan:company` script (`src/scripts/plan-company.ts`, spawned by `db:seed:dev`), which loads it through `createRequire` for the reason above. See `.claude/rules/onboarding-company-templates.md`.
- `db:check:backups` is read-only when run directly. The pre-commit hook passes `--stage` and regenerates/stages `packages/jobs/manifests/schema.json` after a successful live-schema comparison.

## Cross-References

- `.claude/rules/event-system.md` — PGMQ wake/drain architecture.
- `.claude/rules/accounting-sync-handlers.md` — accounting ledger, sweeps, and reconciliation.
- `.claude/rules/ramp-integration.md` — Ramp families and correctness contracts.
- `.claude/rules/workflow-actions.md` — action implementations and dispatch seam.
- `.claude/rules/workflow-engine.md` — owner-scoped execution and run ledger.
- `.claude/rules/workflow-matcher.md` — event matching and queued runs.
- `.claude/rules/company-backup-restore.md` — backup compatibility and manifests.
