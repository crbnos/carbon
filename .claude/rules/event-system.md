---
paths:
  - "packages/database/supabase/migrations/**"
  - "packages/jobs/src/inngest/functions/events/**"
  - "packages/database/src/event.ts"
---

# Event System

Carbon's async event-processing infra: Postgres triggers + PGMQ + **Inngest** (not Trigger.dev — that was the old design). DB writes enqueue events; an Inngest cron drains the queue and fans out to handlers.

## Flow

```
DB write → AFTER STATEMENT trigger → dispatch_event_batch() → pgmq.send_batch('event_system')
                                                                      ↓
            event-queue (Inngest cron, * * * * *) reads pgmq.read('event_system', 30, 100)
                                                                      ↓
            groups by handlerType → step.sendEvent("carbon/event-<handler>") → handler fn
                                                                      ↓
            pgmq.delete() the processed msg_ids
```

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

`queue.ts` is the cron dispatcher (id `event-queue`); it groups the batch and sends one Inngest event per handler type. Each handler is an Inngest function listening on `carbon/event-<name>`:

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
- Latency: up to ~1 min (cron cadence). Use sync interceptors, not subscriptions, for data-integrity / real-time needs.
- Webhook/workflow handlers use `idempotency: event.data.msgId` and per-record concurrency keys.
- Don't hand-edit generated DB types; read the newest migration for schema truth.
