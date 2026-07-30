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
                                          → util.wake_event_queue()  [pg_net POST, once per txn]
                                                  ↓
            edge fn event-wake → Inngest event "carbon/event-queue.process"
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

The wake path (`20260721184852_event-queue-wake.sql`) — both helpers live in the internal `util` schema (like `util.process_embeddings`), NOT `public`:
- `util.wake_event_queue()` — SECURITY DEFINER; reads `apiUrl`/`anonKey` from the singleton `config` table (same as the webhook triggers) and `net.http_post`s to `/functions/v1/event-wake`. Error-swallowed and no-ops when `config` is unseeded — OLTP writes never fail on push failure. pg_net queues the request transactionally, so the wake fires only after commit.
- `dispatch_event_batch()` calls it at most **once per transaction** via the txn-local GUC `carbon.event_wake_sent` (`set_config(..., true)`).
- `util.sweep_event_queue()` — pg_cron job `event-queue-sweeper` re-wakes every minute while *visible* messages (`vt <= clock_timestamp()`) sit in `pgmq.q_event_system`.
- **Why `util`, not `public`:** a public function is auto-exposed as a PostgREST RPC, and a non-superuser reference to a function that transitively calls `net.http_post` segfaults the backend (pg_net 0.20 / PG15) — a remote-DoS surface a `REVOKE` can't close because the crash precedes the privilege check. anon/authenticated have no `USAGE` on `util`, so the API can't reach it. The trigger and pg_cron call it as the owner (superuser), where the pg_net path is safe.
- Edge fn `packages/database/supabase/functions/event-wake/index.ts` forwards the doorbell via `sendInngestEvent("carbon/event-queue.process", {})` (`functions/lib/inngest.ts`).

## Database (migrations)

`eventSystemSubscription` rows decide which table/operation routes to which handler. Final columns (after all migrations): `id`, `name`, `companyId`, `table`, `operations TEXT[]` (subset of `INSERT,UPDATE,DELETE,TRUNCATE`), `filter JSONB`, `handlerType`, `config JSONB`, `active`, `createdAt`. Unique on `(companyId, name, table)`. `batchSize` was removed (`20260204070000`).

`handlerType` CHECK now allows all six: `WEBHOOK, WORKFLOW, SYNC, SEARCH, AUDIT, EMBEDDING` (widened across `20260204080000` → `20260212152709` → `20260326120000`).

### PL/pgSQL functions (in `_event_system_impl` + later)
- `dispatch_event_batch()` — AFTER STATEMENT. Reads transition tables (`batched_new`/`batched_old`), filters by active subscriptions, builds payload, `pgmq.send_batch('event_system', ...)`. Captures `actorId := auth.uid()::TEXT` (added `20260212153753`; NULL for service-role). Uses `clock_timestamp()` per event so batched events get unique microsecond timestamps (`20260427120000`).
- `dispatch_event_interceptors()` — BEFORE ROW. Runs named sync interceptor functions inline (data-integrity, not async).
- `dispatch_event_after_interceptors()` — AFTER ROW. Same but post-commit-of-row, safe for FK refs (added `20260410030406`).
- `attach_event_trigger(table, sync_functions[], after_sync_functions[])` — helper that wires the BEFORE SYNC / AFTER SYNC / ASYNC STATEMENT triggers on a table (3rd arg added `20260410030406`).
- `get_primary_key_column(table)` — dynamic PK lookup (`20260212165827`).

### RPC (callable from app)
`create_event_system_subscription(p_name, p_table, p_company_id, p_operations[], p_handler_type, p_config?, p_filter?, p_active?)` → `TABLE(id, name, handlerType, table)`; `delete_event_system_subscription(p_subscription_id)`; `delete_event_system_subscriptions_by_name(p_company_id, p_name)`; plus search helpers `upsert_to_search_index(...)` / `delete_from_search_index(p_company_id, p_entity_type, p_entity_id)`.

### Misc
- Queue: PGMQ queue **`event_system`**.
- View `eventSystemTrigger` lists attached triggers (`pg_trigger` where `tgname LIKE 'trg_event_%'`, classified async/sync/after-sync).
- Tables with triggers attached span sales/purchasing/inventory/production entities (e.g. `customer, supplier, contact, address, item, job, salesOrder(+Line), purchaseOrder(+Line), salesInvoice, purchaseInvoice, employee, quote, salesRfq, supplierQuote, nonConformance, gauge`). Source of truth: the `_register_triggers`, `_async-search-triggers`, and `_attach-contact-location` migrations.

## TypeScript API — `packages/database/src/event.ts`

Zod schemas + helpers. `QueueMessage` = `{ subscriptionId, triggerType: ROW|STATEMENT, handlerType, handlerConfig, companyId, actorId?, event }`; `event` is a discriminated union on `operation` (INSERT→`old:null`, UPDATE→both, DELETE/TRUNCATE→`new:null`). Helpers: `createEventSystemSubscription`, `deleteEventSystemSubscription`, `deleteEventSystemSubscriptionsByName` (each wraps the matching RPC). Note the param key is `type` (not `handlerType`) on `CreateSubscriptionParams`.

## Handlers — `packages/jobs/src/inngest/functions/events/`

`queue.ts` is the drainer (id `event-queue`), triggered by `carbon/event-queue.process` with `concurrency: 1`; it loops read → dispatch → delete until the queue is empty (max 10 passes of 100, then re-wakes itself). Burst coalescing is handled upstream — the trigger wakes at most once per transaction — not by `debounce` (the local Inngest dev server, v1.19.4, fails to unmarshal debounce items). Each handler is an Inngest function listening on `carbon/event-<name>`:

| handlerType | event name | file | purpose |
|---|---|---|---|
| `WEBHOOK` | `carbon/event-webhook` | `webhook.ts` | `axios.post(config.url, data, { headers })` |
| `WORKFLOW` | `carbon/event-workflow` | `workflow.ts` | dispatch by `workflowId` (<!-- UNVERIFIED: body is still a stub/no-op --> ) |
| `SYNC` | `carbon/event-sync` | `sync.ts` | accounting sync (Xero); maps table→entity, calls `@carbon/ee/accounting` |
| `SEARCH` | `carbon/event-search` | `search.ts` | upsert/delete `search_index` via RPC per entity config |
| `AUDIT` | `carbon/event-audit` | `audit.ts` | writes per-company audit log (uses `actorId`, `audit.config`) |
| `EMBEDDING` | `carbon/event-embedding` | `embedding.ts` | invokes `embed` edge fn for `item/customer/supplier` name/description changes |

All handlers (incl. `eventQueueFunction`) are exported from `events/index.ts` and registered in `packages/jobs/src/inngest/functions/index.ts`. Inngest client comes from `@carbon/lib/inngest`.

## Notes
- Latency: typically ~3–5s (sub-second wake + the multi-step drain run). Worst case ~1 min if a push is lost (dead pg_net worker, edge fn down) — the pg_cron sweeper re-wakes while messages are pending. Still async: use sync interceptors, not subscriptions, for data-integrity / real-time needs.
- The wake path depends on a seeded `config` row (`apiUrl`, `anonKey`). Dev seeds it automatically (`ensureConfigRow` in `packages/dev/src/services/migrations.ts`, apiUrl `http://kong:8000`). **Unseeded config (e.g. self-hosted) = events never process** — both the push and the sweeper wake no-op.
- Webhook/workflow handlers use `idempotency: event.data.msgId` and per-record concurrency keys.
- Don't hand-edit generated DB types; read the newest migration for schema truth.
