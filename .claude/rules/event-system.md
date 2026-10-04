---
paths:
  - "packages/database/supabase/migrations/**"
  - "packages/jobs/src/inngest/functions/events/**"
  - "packages/database/src/event.ts"
---

# Event System

Carbon's async event-processing infra: Postgres triggers + PGMQ + **Inngest** (not Trigger.dev — that was the old design). DB writes enqueue events; the database **pushes** a wake to Inngest and the `event-queue` function drains the queue (no polling cron since `20260721184852_event-queue-wake.sql`).

## Flow

```text
DB write → AFTER STATEMENT trigger → dispatch_event_batch() → pgmq.send_batch('event_system')
                                          → util.wake_event_queue()  [once per txn]
                                                  ↓
            util.send_inngest_event → pg_net POST to Inngest: "carbon/event-queue.process"
                                                  ↓
            event-queue (Inngest, event-triggered, concurrency 1)
            loops pgmq.read('event_system', 30, 100) until empty (max 10 passes, re-wakes if more)
                                                  ↓
            groups by handlerType → step.sendEvent("carbon/event-<handler>") → handler fn
                                                  ↓
            pgmq.delete() the processed msg_ids

pg_cron 'event-queue-sweeper' (* * * * *, in-DB): if visible messages exist → util.wake_event_queue()
  (safety net for lost pushes; no queue → no HTTP → no Inngest run)
```

The wake path (`20260721184852_event-queue-wake.sql`, rewired by `20261002170250_send-inngest-events-from-postgres.sql` and the managed files in `packages/database/src/event-system/functions/`) — the helpers live in the internal `util` schema, NOT `public`:
- `util.send_inngest_event(name, data)` — SECURITY DEFINER; `net.http_post`s `{ name, data }` to the Vault secret `inngest_event_url` (`<base>/e/<eventKey>`). Error-swallowed and no-ops when the secret is unset — OLTP writes never fail on push failure. pg_net queues the request transactionally, so the event fires only after commit. Postgres calls no edge function.
- `util.wake_event_queue()` — sends `carbon/event-queue.process` through it.
- `public.set_inngest_event_url(url)` writes the secret (refuses `anon`/`authenticated`). The URL carries the event key, so it lives in Vault, not in `config` (which has a SELECT policy). A no-op when the URL is unchanged (`20261003134512`). Both setters take one advisory lock (`20261003191518`), so concurrent writers (app registration, deploy, operator) serialize instead of failing on the Vault's unique name. The ERP keeps the KEY in it current whenever it registers with Inngest: a `PUT /api/inngest` (`apps/erp/app/routes/api+/inngest.ts`) calls `public.set_inngest_event_config(key, base)` before the registration handshake, in production. That PUT happens on every deploy (Vercel's Inngest integration, `ci/src/jobs.ts`) and on every boot of a long-lived host (`inngest-self-sync.server.ts`), inside a request, once per registration rather than once per instance. Not at module load: a serverless host froze those calls mid-connect. (`20261003142107`): it creates the URL from its own `INNGEST_BASE_URL` when none is stored, and otherwise rewrites only the `<eventKey>` segment — a stored address is never changed, since the database may reach Inngest somewhere the app does not. So a deployment needs no separate step. `ci/src/migrations.ts` calls the same function on every deploy for a workspace with an `inngest_event_key` (retried while PostgREST reloads its schema), so a changed `inngest_base_url` there needs `set_inngest_event_url` by hand. Set in full by `packages/database/src/seed.ts` (`resolveInngestEventUrl`), locally by `ensureConfigRow` in `packages/dev/src/services/migrations.ts` (`http://inngest:8288/e/NO_EVENT_KEY_SET`) and by `scripts/restore-database.sh` after it clears Vault on a local restore, and on self-host by `contrib/deploying/simple-docker-caddy/deploy.sh migrate` (`set_inngest_event_url`, reading the key from the erp task). In CI a workspace missing `inngest_event_key` or the service role key logs an error and fails the run, after seeding and scripts, which do not depend on it.
- `dispatch_event_batch()` calls `util.wake_event_queue()` at most **once per transaction** via the txn-local GUC `carbon.event_wake_sent` (`set_config(..., true)`).
- `util.sweep_event_queue()` — pg_cron job `event-queue-sweeper` re-wakes every minute while *visible* messages (`vt <= clock_timestamp()`) sit in `pgmq.q_event_system`.
- **Why `util`, not `public`:** a public function is auto-exposed as a PostgREST RPC, and a non-superuser reference to a function that transitively calls `net.http_post` segfaults the backend (pg_net 0.20 / PG15) — a remote-DoS surface a `REVOKE` can't close because the crash precedes the privilege check. anon/authenticated have no `USAGE` on `util`, so the API can't reach it. The trigger and pg_cron call it as the owner (superuser), where the pg_net path is safe.
- Two scheduled jobs are woken the same way, only when there is work (`20261004183512_scheduled-jobs-from-database.sql`): `util.sweep_notification_digest()` (pg_cron `notification-digest-sweeper`, every 15 min → `carbon/notification-digest.process`) and `util.sweep_workflow_run_retention()` (`workflow-run-retention-sweeper`, 04:00 UTC → `carbon/workflow-run-retention.process`). Each asks a `util.*_has_work()` function that repeats its Inngest function's thresholds. The notification purge needs no Inngest at all: pg_cron `notification-purge` runs `util.purge_notifications()` at 03:00 UTC.
- The same helper sends `carbon/notify` (job-completed) from `sync_job_complete_or_canceled` and `carbon/embedding-queue.process` from `util.sweep_embedding_queue()` (see EMBEDDING below).

## Database (functions are files, not migrations)

Every function named in this document is authored as ONE file in
`packages/database/src/event-system/functions/` (`<name>.sql`, or `util.<name>.sql`), synced
locally by `pnpm db:migrate` and shipped by `pnpm --filter @carbon/database authz migration
<name>`. To change one, edit its file — a migration that redefines one fails
`no-authz-ddl-in-migrations`. The migration timestamps below are history: they say when a
behaviour arrived, not where to read the current definition. Details:
`authz-manifest.md` → Event-system functions.

`eventSystemSubscription` rows decide which table/operation routes to which handler. Final columns (after all migrations): `id`, `name`, `companyId`, `table`, `operations TEXT[]` (subset of `INSERT,UPDATE,DELETE,TRUNCATE`), `filter JSONB`, `handlerType`, `config JSONB`, `active`, `createdAt`. Unique on `(companyId, name, table)`. `batchSize` was removed (`20260204070000`).

`handlerType` CHECK now allows all six: `WEBHOOK, WORKFLOW, SYNC, SEARCH, AUDIT, EMBEDDING` (widened across `20260204080000` → `20260212152709` → `20260326120000`).

### PL/pgSQL functions (in `_event_system_impl` + later)
- `dispatch_event_batch()` — AFTER STATEMENT. Reads transition tables (`batched_new`/`batched_old`), filters by active subscriptions, builds payload, `pgmq.send_batch('event_system', ...)`. Captures `actorId := auth.uid()::TEXT` (added `20260212153753`; NULL for service-role) and `workflowRunId` from the `workflow_run_id` JWT claim (`20260810100000`). UPDATE pairs transition rows on the table's **full** primary key via `get_primary_key_columns()` (`20260717143448`, restored in `20260810100000` after `20260721184852` copied the older single-column pairing forward). Uses `clock_timestamp()` per event so batched events get unique microsecond timestamps (`20260427120000`). An UPDATE that changes nothing but `updatedAt` / `updatedBy` / `embedding` is not queued for `AUDIT`, `SEARCH` or `EMBEDDING` subscriptions (`20261001195204`) — those handlers discard such an event anyway; `WEBHOOK`, `WORKFLOW` and `SYNC` still receive every UPDATE because their payload is a contract. The column list is `ignored_columns` in the function and must equal `auditConfig.skipFields`; `packages/database/src/event-dispatch.test.ts` reads `event-system/functions/dispatch_event_batch.sql` and fails when the two lists diverge.
- `dispatch_event_interceptors()` — BEFORE ROW. Runs named sync interceptor functions inline (data-integrity, not async).
- `dispatch_event_after_interceptors()` — AFTER ROW. Same but post-commit-of-row, safe for FK refs (added `20260410030406`).
- Both dispatchers are SECURITY DEFINER (`20260925121735`), so interceptors run as the owner on every write. Write a new interceptor as **SECURITY INVOKER**: it still runs as the owner from the dispatcher, but a direct `/rpc/<interceptor>` call with a forged payload runs under the caller's RLS. A SECURITY DEFINER interceptor is callable by anyone with the anon key as the owner — `public-definer-function-authorizes-caller` fails on it.
- `attach_event_trigger(table, sync_functions[], after_sync_functions[])` — helper that wires the BEFORE SYNC / AFTER SYNC / ASYNC STATEMENT triggers on a table (3rd arg added `20260410030406`). One signature is live, `(TEXT, TEXT[] DEFAULT, TEXT[] DEFAULT)`. `CREATE OR REPLACE` with an added parameter creates a sibling rather than replacing, and a 2-arg call then matches more than one candidate (`function attach_event_trigger(unknown, text[]) is not unique`, breaking every call site) — so adding an argument means a migration that drops the old signature first; `authz sync` refuses a file that would create an overload.
- `attach_statement_handler(table, handler_functions[])` (`20260812002453`) — the STATEMENT-level counterpart to the row-level interceptors. Attaches each function as `trg_event_statement_<fn>_{ins,upd,del}` with transition tables `batched_new` / `batched_old`; an empty array detaches. Does **not** register the table for PGMQ dispatch. Used by `itemLedger` to maintain the `itemStockQuantities` aggregate.
  - Handlers are attached for all three operations, so each **must branch on `TG_OP`**: only `batched_new` exists on INSERT, only `batched_old` on DELETE. PL/pgSQL plans lazily, so a branch that doesn't run never resolves its missing transition table.
  - **Why handlers can't live inside `dispatch_event_batch()`:** (1) transition tables are visible ONLY to the function the trigger invokes directly — a nested call fails with `relation "batched_new" does not exist`, for static *and* dynamic SQL, so hosting handlers there would force materializing every batch into a temp table per statement; (2) `dispatch_event_batch()` returns early when the table has no active subscription and again when `app.sync_in_progress` is set — both correct for queueing, fatal for an aggregate (`itemLedger` has no subscriptions, so the handler would never run).
  - **Why not just `attach_event_trigger`:** it always attaches `dispatch_event_batch()`, which resolves primary-key columns from the catalog *before* its no-subscription early return — measured ~0.2–0.4 ms per statement on a table nothing subscribes to, vs ~0.05 ms for the bare INSERT.
- `get_primary_key_column(table)` — dynamic PK lookup (`20260212165827`).

### RPC (callable from app)
`create_event_system_subscription(p_name, p_table, p_company_id, p_operations[], p_handler_type, p_config?, p_filter?, p_active?)` → `TABLE(id, name, handlerType, table)` (upserts on `(companyId, name, table)`; the caller must be allowed to manage the NEW handler type and, when a row is replaced, the type it already had — `util.can_manage_event_subscription`: WEBHOOK needs a settings permission, the rest any employee; pinned by `supabase/tests/event-subscription-authz.test.sql`); `delete_event_system_subscription(p_subscription_id)`; `delete_event_system_subscriptions_by_name(p_company_id, p_name)`; plus search helpers `upsert_to_search_index(...)` / `delete_from_search_index(p_company_id, p_entity_type, p_entity_id)`.

### Misc
- Queue: PGMQ queue **`event_system`**.
- View `eventSystemTrigger` lists attached triggers (`pg_trigger` where `tgname LIKE 'trg_event_%'`, classified async/sync/after-sync).
- Tables with triggers attached span sales/purchasing/inventory/production entities (e.g. `customer, supplier, contact, address, item, job, salesOrder(+Line), purchaseOrder(+Line), salesInvoice, purchaseInvoice, employee, quote, salesRfq, supplierQuote, nonConformance, gauge`). Source of truth: the `_register_triggers`, `_async-search-triggers`, and `_attach-contact-location` migrations.

## TypeScript API — `packages/database/src/event.ts`

Zod schemas + helpers. `QueueMessage` = `{ subscriptionId, triggerType: ROW|STATEMENT, handlerType, handlerConfig, companyId, actorId?, workflowRunId?, event }`;
`workflowRunId` is stamped by `dispatch_event_batch()` from the `workflow_run_id` claim on the caller's JWT (`20260810100000_workflows-run-tag.sql`) — set only when a running customer workflow made the write, and the basis of the matcher's origin filter and loop guards. The WORKFLOW dispatch branch forwards `{ msgId, companyId, actorId, workflowRunId, data }` (the old `handlerConfig.workflowId` is gone — a per-table subscription serves many workflows). `event` is a discriminated union on `operation` (INSERT→`old:null`, UPDATE→both, DELETE/TRUNCATE→`new:null`). Helpers: `createEventSystemSubscription`, `deleteEventSystemSubscription`, `deleteEventSystemSubscriptionsByName` (each wraps the matching RPC). Note the param key is `type` (not `handlerType`) on `CreateSubscriptionParams`.

## Handlers — `packages/jobs/src/inngest/functions/events/`

`queue.ts` is the drainer (id `event-queue`), triggered by `carbon/event-queue.process` with `concurrency: 1`; it loops read → dispatch → delete until the queue is empty (max 10 passes of 100, then re-wakes itself). Each `step.sendEvent` is a request to the app, so events are packed by SIZE, not a fixed count: `packBySize` (`events/pack.ts`) fills each event up to `MAX_EVENT_BYTES` (200 KB, under Inngest's 256 KB cap) and at most `MAX_RECORDS` (50) records — 10 for `SYNC` and `EMBEDDING`, which call an external service per record. A record larger than the budget travels alone. Burst coalescing is handled upstream — the trigger wakes at most once per transaction — not by `debounce` (the local Inngest dev server, v1.19.4, fails to unmarshal debounce items). Each handler is an Inngest function listening on `carbon/event-<name>`:

| handlerType | event name | file | purpose |
|---|---|---|---|
| `WEBHOOK` | `carbon/event-webhook` | `webhook.ts` | `axios.post(config.url, toWebhookBody(...), { headers })` — customer-facing webhooks; see below |
| `WORKFLOW` | `carbon/event-workflow` | `workflow.ts` | customer-workflow matcher — announcement → catalog event ids → subscribed workflows → one `workflowRun` each (see `workflow-matcher.md`) |
| `SYNC` | `carbon/event-sync` | `sync.ts` | accounting sync (Xero); maps table→entity, calls `@carbon/ee/accounting` |
| `SEARCH` | `carbon/event-search` | `search.ts` | upsert/delete `search_index` per entity config (`search-config.ts`): last event per record wins, one read per related table for the whole batch, then one delete and one upsert statement over Kysely. A failed read or write throws so the step retries; the one exception is a missing search table whose company no longer exists (deleting a company drops the table while its events may still be queued), which is skipped with a warning |
| `AUDIT` | `carbon/event-audit` | `audit.ts` | writes per-company audit log (uses `actorId`, `audit.config`) |
| `EMBEDDING` | `carbon/event-embedding` | `embedding.ts` | `embedRecords` for `item/customer/supplier` name/description changes (vectors from the `embedding` edge fn, written with one UPDATE per table) |

All handlers (incl. `eventQueueFunction`) are exported from `events/index.ts` and registered in `packages/jobs/src/inngest/index.ts`. Inngest client comes from `@carbon/lib/inngest`.

`embedding.ts` also exports `embeddingQueueFunction` (id `embedding-queue`, `carbon/embedding-queue.process`, concurrency 1, singleton skip). It drains the pgmq `embedding_jobs` queue (filled by `util.queue_embeddings`) through the same `embedRecords`. Embedded messages are deleted. Permanent failures (`embedRecords` flags an unknown table or a record with no text `permanent`) and any message read `MAX_READS` (5) times are archived with `pgmq.archive`, so a poison message cannot keep waking the drain; any other failure becomes visible again after the 300 s visibility timeout. `toEmbeddedText` sanitizes text the way the `embedding` edge function does, and `embedInBatches` (pure, tested) retries a failed batch record by record so one bad record does not fail its batch. The 10 s `process-embeddings` pg_cron calls `util.sweep_embedding_queue()` (no arguments), which sends the event only while visible messages are waiting.

### WEBHOOK — the customer-facing one

Since `20260807234512_webhooks-via-event-system.sql`, user-configured webhooks (Settings → Webhooks) run on this handler. Before that they had their own pg_net path: 39 `webhook_*` triggers → the `webhook` edge function. Both the triggers and that edge function are **deleted** — don't resurrect them.

- **Subscriptions are derived, not app-managed.** The `sync_webhook_subscription` AFTER-ROW interceptor — registered via `attach_event_trigger('webhook', ARRAY[]::TEXT[], ARRAY['sync_webhook_subscription'])`, so it follows the same convention as `sync_create_customer_entries` — maintains a subscription named `webhook-<webhook.id>` with `handlerType 'WEBHOOK'` and `config {url, webhookId}`. The `webhook` table is the single source of truth, so UI/API/MCP writers all work without lifecycle code. It deletes-then-recreates on UPDATE because `table` is editable and uniqueness is `(companyId, name, table)`.
- **The body is a PUBLIC contract**: `{type, record, old?, companyId, table, eventId}` — documented at `docs/content/docs/building/webhooks.mdx` and pinned by `webhook.test.ts`. `toWebhookBody` maps the queue event onto it. Two traps: DELETE takes `record` from the event's `old` (its `new` is null), and `companyId` is **not** on the event — the drainer forwards it from the queue message.
- Delivery moved from at-most-once to **at-least-once** (Inngest `retries: 3`); `increment_webhook_error` fires only on the final attempt so counters stay one-per-event. `eventId` is the pgmq `msgId` — stable across an event's retries (it is also the Inngest idempotency key), distinct per change — and is the documented de-dup key. `type` + `record.id` is NOT usable: two genuine updates to a row share both.

## Notes
- Latency: typically ~3–5s (sub-second wake + the multi-step drain run). Worst case ~1 min if a push is lost (dead pg_net worker, Inngest unreachable) — the pg_cron sweeper re-wakes while messages are pending. Still async: use sync interceptors, not subscriptions, for data-integrity / real-time needs.
- The wake path depends on the Vault secret `inngest_event_url` (see above). **Unset secret = events never process** — both the push and the sweeper wake no-op.
- Webhook/workflow handlers use `idempotency: event.data.msgId` and per-record concurrency keys.
- Don't hand-edit generated DB types; read the newest migration for schema truth, and `event-system/functions/` for the functions.
