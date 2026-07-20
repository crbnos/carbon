---
paths:
  - "packages/jobs/src/inngest/functions/events/**"
  - "packages/database/src/event.ts"
---

# Workflow: Add an Event Handler / Wire an Event

The step-by-step for registering a new event-system handler type, attaching event
triggers to a table, and managing subscriptions in Carbon. The event system runs
on **Inngest** (NOT Trigger.dev) over a Postgres `pgmq` queue.

For how the system actually works (architecture, flow, the PL/pgSQL functions, the
six handler types, the queue dispatcher) → read **`event-system.md`**. This file is
the procedure, not a re-description — it does not repeat that detail.

## Where things live (verified)

| Concern | File |
| --- | --- |
| Handler functions (one per type) | `packages/jobs/src/inngest/functions/events/<type>.ts` |
| Handler barrel | `packages/jobs/src/inngest/functions/events/index.ts` |
| Cron dispatcher (drains pgmq, fans out) | `packages/jobs/src/inngest/functions/events/queue.ts` |
| Served `functions` array | `packages/jobs/src/inngest/index.ts` |
| Event-name type registry (`Events`) | `packages/lib/src/events.ts` (re-exported, NOT defined, by `packages/jobs/src/events.ts`) |
| Zod schemas + subscription helpers | `packages/database/src/event.ts` |
| `attach_event_trigger`, handler-type CHECK | `packages/database/supabase/migrations/` |

## Use cases → handler type

| Use case | Handler type | Dispatch shape |
| --- | --- | --- |
| Notify external system (Slack, etc.) | `WEBHOOK` | per-row |
| Internal automation | `WORKFLOW` | per-row (handler body is a stub — see below) |
| Sync to accounting (Xero) | `SYNC` | batched `{ records }` |
| Update search index | `SEARCH` | batched `{ records }` |
| Audit log | `AUDIT` | batched `{ records }` |
| Embedding / vector index | `EMBEDDING` | batched `{ records }` |

<!-- UNVERIFIED: the WORKFLOW handler body (workflow.ts) is currently a no-op stub
     that only logs; it does not yet dispatch by workflowId. -->

---

## Workflow A: Attach event triggers to a new table

### 1. Create a migration

Triggers are wired by the SQL helper `attach_event_trigger`. Its current signature
takes **three** args (the 3rd added in `20260410030406_event-system-after-interceptors.sql`):

```sql
-- Async only (statement-level AFTER triggers; no sync interceptors)
SELECT attach_event_trigger('yourNewTable', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);

-- With BEFORE ROW sync interceptors (run inline, data-integrity — not async)
SELECT attach_event_trigger('yourNewTable', ARRAY['validate_before_insert']::TEXT[], ARRAY[]::TEXT[]);

-- With AFTER ROW interceptors (post-row-commit, safe for FK refs)
SELECT attach_event_trigger('yourNewTable', ARRAY[]::TEXT[], ARRAY['sync_create_entries']::TEXT[]);
```

The helper drops/creates `trg_event_sync_*` (BEFORE ROW), `trg_event_async_*`
(AFTER STATEMENT, one per INSERT/UPDATE/DELETE), and the after-sync triggers. The
async statement triggers call `dispatch_event_batch()`, which enqueues to pgmq.

Follow `workflow-database-migration.md` for the migration commands
(`pnpm db:migrate:new <name>`, then `pnpm db:migrate`). Never use `000000` for HHMMSS.

### 2. (If needed) Backfill subscriptions for existing companies

Subscriptions are company-scoped; a fresh trigger does nothing until a row exists
in `eventSystemSubscription`. Insert per-company in the same migration:

```sql
DO $$
DECLARE company_record RECORD;
BEGIN
  FOR company_record IN SELECT id FROM "company" LOOP
    INSERT INTO "eventSystemSubscription"
      ("name", "table", "companyId", "operations", "handlerType", "config", "filter", "active")
    VALUES
      ('search-index-yourNewTable', 'yourNewTable', company_record.id,
       ARRAY['INSERT', 'UPDATE', 'DELETE'], 'SEARCH', '{}'::jsonb, '{}'::jsonb, TRUE)
    ON CONFLICT ON CONSTRAINT "unique_subscription_name_per_company" DO NOTHING;
  END LOOP;
END $$;
```

---

## Workflow B: Create a subscription from app code

```typescript
import { getCarbonServiceRole } from "@carbon/auth";
import { createEventSystemSubscription } from "@carbon/database/event";

const client = getCarbonServiceRole();

const subscription = await createEventSystemSubscription(client, {
  name: "my-webhook-subscription", // unique per (companyId, name, table)
  table: "salesOrder",
  companyId,
  operations: ["INSERT", "UPDATE"], // subset of INSERT/UPDATE/DELETE/TRUNCATE, uppercase
  type: "WEBHOOK",                  // NOTE: the param key is `type`, not `handlerType`
  config: { url: "https://example.com/webhook", headers: { Authorization: "Bearer …" } },
  filter: { status: "confirmed" }, // optional JSONB containment filter
  active: true,
});
```

- `createEventSystemSubscription` wraps the `create_event_system_subscription` RPC.
- Delete with `deleteEventSystemSubscription(client, id)` or
  `deleteEventSystemSubscriptionsByName(client, companyId, name)`.
- The `CreateSubscriptionParams` key is **`type`** (mapped to `p_handler_type`), not
  `handlerType`. (See `packages/database/src/event.ts`.)

---

## Workflow C: Add a brand-new handler type

### 1. Widen the Zod enum

In `packages/database/src/event.ts`, add the value to `HandlerTypeSchema`:

```typescript
const HandlerTypeSchema = z.enum([
  "WEBHOOK", "WORKFLOW", "SYNC", "SEARCH", "AUDIT", "EMBEDDING",
  "YOUR_NEW_TYPE",
]);
```

### 2. Widen the database CHECK constraint

The `handlerType` CHECK has been widened across several migrations (latest list in
`20260326120000_fix-embedding-triggers.sql`). Add a new migration that re-creates it:

```sql
ALTER TABLE "eventSystemSubscription" DROP CONSTRAINT IF EXISTS "eventSystemSubscription_handlerType_check";
ALTER TABLE "eventSystemSubscription" ADD CONSTRAINT "eventSystemSubscription_handlerType_check"
  CHECK ("handlerType" IN ('WEBHOOK','WORKFLOW','SYNC','SEARCH','AUDIT','EMBEDDING','YOUR_NEW_TYPE'));
```

### 3. Declare the event name in the `Events` registry

In **`packages/lib/src/events.ts`** (NOT `packages/jobs/src/events.ts`, which only
re-exports), add an entry keyed `carbon/event-<name>`. Match the dispatch shape you
chose in step 5 — per-row or batched `{ records }`. Batched example (like SEARCH):

```typescript
"carbon/event-your-new-type": {
  data: {
    records: Array<{
      event: { table: string; recordId: string; operation: "INSERT" | "UPDATE" | "DELETE"; [key: string]: unknown };
      companyId: string;
    }>;
  };
};
```

### 4. Create the handler function

Create `packages/jobs/src/inngest/functions/events/your-handler.ts`. Follow the
existing handlers (`search.ts` / `audit.ts` for batched; `webhook.ts` for per-row).
Use `id: "event-handler-<name>"`. Only the **per-row** handlers use
`idempotency: "event.data.msgId"` + a per-record concurrency key (see `webhook.ts`);
batched handlers like `embedding.ts` do not — don't copy idempotency onto a batched one.

```typescript
import { z } from "zod";
import { inngest } from "../../client.ts";

const PayloadSchema = z.object({
  records: z.array(z.object({
    event: z.object({ table: z.string(), recordId: z.string(), /* … */ }),
    companyId: z.string(),
  })),
});

export const yourHandlerFunction = inngest.createFunction(
  { id: "event-handler-your-new-type", retries: 3 },
  { event: "carbon/event-your-new-type" },
  async ({ event, step }) => {
    const payload = PayloadSchema.parse(event.data);
    return await step.run("process", async () => {
      // handler logic
    });
  },
);
```

### 5. Add a dispatch branch in the queue cron

In `packages/jobs/src/inngest/functions/events/queue.ts`:

1. Add the type to the `grouped` record initializer (inside `read-queue`):
   ```typescript
   const grouped: Record<HandlerType, QueueJob[]> = {
     WEBHOOK: [], WORKFLOW: [], SYNC: [], SEARCH: [], AUDIT: [], EMBEDDING: [],
     YOUR_NEW_TYPE: [],
   };
   ```
2. Add a dispatch block. Use `chunk(..., CHUNK_SIZE)` to stay under Inngest's 256KB
   event limit. **Batched** (like SEARCH — one event per chunk, `data.records` is an array):
   ```typescript
   if (grouped.YOUR_NEW_TYPE.length > 0) {
     const records = grouped.YOUR_NEW_TYPE.map((job) => ({
       event: job.message.event,
       companyId: job.message.companyId,
     }));
     const chunks = chunk(records, CHUNK_SIZE);
     for (let i = 0; i < chunks.length; i++) {
       await step.sendEvent(`dispatch-your-new-type-${i}`, {
         name: "carbon/event-your-new-type" as const,
         data: { records: chunks[i] },
       });
     }
   }
   ```
   For **per-row** dispatch instead, follow the `grouped.WEBHOOK` block: map each job
   to `{ name, data: { msgId: job.msg_id, … } }` and `sendEvent` the chunk array directly.

   Note: the queue does NOT delete the chunk-level loop's processed ids individually —
   `delete-processed` removes **all** read ids (`allIds`) at the end of the run.

### 6. Register the function so it's served

Two edits:

1. Export it from the barrel `packages/jobs/src/inngest/functions/events/index.ts`.
2. Add it to the `functions` array in **`packages/jobs/src/inngest/index.ts`** (under
   the "Event handlers" group). That array is what `serve()` / `connect()` serves.

There is **no** `packages/jobs/src/inngest/functions/index.ts` — older docs referenced
that path; it does not exist.

---

## Debugging

- **Inspect the queue (pgmq):**
  ```sql
  SELECT * FROM pgmq.metrics('event_system');
  SELECT * FROM pgmq.read('event_system', 30, 10); -- peek (hides for 30s)
  ```
- **Inspect subscriptions / triggers:**
  ```sql
  SELECT * FROM "eventSystemSubscription" WHERE "companyId" = '…' AND "active";
  SELECT * FROM "eventSystemTrigger" WHERE "table" = 'yourTable'; -- view over pg_trigger
  ```
- **Inngest:** in the dashboard (or local Dev Server), confirm `event-queue` (cron,
  `* * * * *`) is draining, then check the downstream `event-handler-<type>` runs. Local:
  ```bash
  npx inngest-cli@latest dev -u http://localhost:3000/api/inngest   # UI at :8288
  ```

## Pitfalls

1. **Latency** — handlers fire on the 1-minute cron cadence, not instantly. For
   data-integrity / real-time needs use sync interceptors (`attach_event_trigger`'s 2nd/3rd
   arg), not subscriptions.
2. **Missing `companyId`** — events without a `companyId` are skipped; subscriptions are
   company-scoped.
3. **Operation casing** — `["INSERT"]`, not `["insert"]`.
4. **Forgot to register** — a new handler must be in BOTH the `events/index.ts` barrel AND
   the `functions` array in `packages/jobs/src/inngest/index.ts`, or it is never served.
5. **Event size** — always `chunk(..., CHUNK_SIZE)`; Inngest caps events at 256KB.
6. **Wrong dispatch shape** — match the queue branch to the handler: per-row (`msgId` +
   flattened config) vs batched (`{ records: [...] }`). Mixing them breaks Zod parsing.

## Checklist

- [ ] Trigger attached via `attach_event_trigger(table, sync[], after_sync[])` (3-arg)
- [ ] Subscription(s) created with correct `companyId` and uppercase `operations`
- [ ] (new type) `HandlerTypeSchema` widened in `packages/database/src/event.ts`
- [ ] (new type) `handlerType` CHECK widened in a new migration
- [ ] (new type) Event name declared in `packages/lib/src/events.ts`
- [ ] (new type) Handler created with `id: "event-handler-<name>"`
- [ ] (new type) `queue.ts` `grouped` initializer + dispatch branch added
- [ ] (new type) Exported from `events/index.ts` AND added to `functions` in `inngest/index.ts`
- [ ] Verified end-to-end in the Inngest dashboard with a real DB write
