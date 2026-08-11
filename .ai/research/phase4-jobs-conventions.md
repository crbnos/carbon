# Phase 4 — `packages/jobs` conventions for the workflow engine

Research report. Everything below is quoted from committed code on `feat/automation`
(HEAD `f94dce158`). Paths are repo-relative to
`/Users/aashu/work/carbon/carbon-feat-automation`.

---

## 1. The rules that govern a new Inngest function

### 1a. `packages/jobs/AGENTS.md`

The binding constraints for this work, verbatim:

**Always**

> - Define new Inngest functions in the appropriate subdirectory under `src/inngest/functions/` (events, integrations, notifications, scheduled, tasks).
> - Use `trigger()` or `batchTrigger()` from `@carbon/jobs` to dispatch events from app code — these re-export from `@carbon/lib/trigger`.
> - Define event types in the shared `Events` type (re-exported from `@carbon/lib/events`) so Inngest has full type safety.
> - Event system handlers use idempotency keys (`event.data.msgId`) and per-record concurrency — maintain this pattern.

**Ask First**

> - Adding new handler types to the event system — requires DB migration to widen the `handlerType` CHECK constraint.
> - Changing the event queue's flow control (`concurrency: 1`) or the pg_cron sweeper cadence — affects latency and coalescing for all async event processing. The drainer is push-woken by `carbon/event-queue.process` (see `.claude/rules/event-system.md`), not cron-polled. Note: `debounce` is intentionally NOT used — the local Inngest dev server can't unmarshal debounce items; bursts are coalesced by the per-transaction wake instead.
> - Adding new Inngest function registrations — they must be exported and registered in the functions index.

**Never**

> - Import Inngest internals or server-only job code in app bundles — use only the public exports from `@carbon/jobs` (`.` subpath: `trigger`, `batchTrigger`, schemas).
> - Use the event system for real-time / data-integrity needs — it is async (typically ~3–5s, up to ~1 min if a push wake is lost). Use sync interceptors instead.
> - Bypass the PGMQ queue by writing directly to handler tables — always go through `dispatch_event_batch()` triggers.

**Validation commands** (verbatim from the same file):

```bash
pnpm --filter @carbon/jobs test
pnpm --filter @carbon/jobs typecheck
pnpm --filter @carbon/jobs dev:jobs   # Start local Inngest dev server
```

It also already documents `workflow-run` as the thing you are replacing:

> | `workflow-run` | `carbon/workflow-run.queued` | **Stub** consumer for a matched run — logs and returns; phase 4 replaces the body and adds the real concurrency keys |

and the DB rule:

> `getJobDatabaseClient(size = 1)` from `src/db.ts` is the package's only Kysely
> constructor — used by the event-queue drainer, the workflow matcher, and the company
> backup/export/import/restore tasks. Don't build a new pool inline.

### 1b. `.claude/rules/event-system.md`

Mostly architecture (PGMQ → wake → drainer → handler). The parts that bear on a new function:

- The Inngest client comes from `@carbon/lib/inngest`: *"All handlers (incl. `eventQueueFunction`) are exported from `events/index.ts` and registered in `packages/jobs/src/inngest/functions/index.ts`. Inngest client comes from `@carbon/lib/inngest`."* (**Note the stale path** — see §2 gotcha below; the real registry is `packages/jobs/src/inngest/index.ts`, and `workflow-event-system.md` explicitly corrects this.)
- *"Webhook/workflow handlers use `idempotency: event.data.msgId` and per-record concurrency keys."*
- `QueueMessage.workflowRunId` is *"stamped by `dispatch_event_batch()` from the `workflow_run_id` claim on the caller's JWT (`20260730135206_workflows-run-tag.sql`) — set only when a running customer workflow made the write, and the basis of the matcher's origin filter and loop guards."* **This is phase 4's job to mint** — nothing sets it today.

### 1c. `.claude/rules/workflow-event-system.md`

The procedural rule. Relevant to a new function:

> ### 6. Register the function so it's served
>
> Two edits:
>
> 1. Export it from the barrel `packages/jobs/src/inngest/functions/events/index.ts`.
> 2. Add it to the `functions` array in **`packages/jobs/src/inngest/index.ts`** (under the "Event handlers" group). That array is what `serve()` / `connect()` serves.
>
> There is **no** `packages/jobs/src/inngest/functions/index.ts` — older docs referenced that path; it does not exist.

Pitfalls it names that apply here:

> 4. **Forgot to register** — a new handler must be in BOTH the `events/index.ts` barrel AND the `functions` array in `packages/jobs/src/inngest/index.ts`, or it is never served.
> 5. **Event size** — always `chunk(..., CHUNK_SIZE)`; Inngest caps events at 256KB.

Also, on handler naming/idempotency (from step 4):

> Use `id: "event-handler-<name>"`. Only the **per-row** handlers use
> `idempotency: "event.data.msgId"` + a per-record concurrency key (see `webhook.ts`);
> batched handlers like `embedding.ts` do not — don't copy idempotency onto a batched one.

`workflow-run` is not an event-system *handler* (it consumes `carbon/workflow-run.queued`,
not `carbon/event-*`), so it lives in `functions/workflows/`, uses the id `workflow-run`,
and does **not** need a `queue.ts` dispatch branch. Only the `inngest/index.ts` registration
and the `workflows/index.ts` barrel apply — both already exist.

### 1d. The `/inngest` skill (`.claude/skills/inngest/SKILL.md`)

The platform semantics reference, already corrected to Carbon's **v3** API. The single most
important rule for a graph walker:

> Each `step.run` is a separate HTTP invocation. The handler **re-runs from the
> top on every step**; completed steps return memoized results instead of
> re-executing. Therefore ALL non-determinism — API/DB calls, `Date.now()`,
> `Math.random()`, UUIDs, logging you don't want duplicated — must live **inside**
> a step. Code outside steps executes again on every invocation.

Limits that will bite a node-per-step walker:

> - **Limits:** 1000 steps/run, 4MB per step output, 32MB total run state.
>   Approaching them → split with `step.invoke` / `step.sendEvent`.

Flow-control cheat sheet (verbatim table header + the row you'll want):

| Mechanism | Limits | Excess events are… | Shape |
|---|---|---|---|
| `concurrency` | active step execution (waiting/sleeping runs don't count) | queued | `5` or `[{ key: "event.data.companyId", limit: 2 }]` |
| `throttle` | run starts over time | **delayed** | `{ limit, period: "60s", burst?, key? }` |
| `rateLimit` | run starts, hard cap | **dropped** | `{ limit, period: "4h", key? }` |
| `debounce` | one run after events stop | superseded — **last wins** | `{ period: "5m", key?, timeout? }` |
| `singleton` | one run per key | `mode:"skip"` drops new / `mode:"cancel"` kills old | `{ key, mode }` |
| `priority` | queue order | — | `{ run: "event.data.tier=='vip' ? 120 : 0" }` (seconds ahead) |
| `batchEvents` | groups events into one run | batched; handler gets `{ events }` | `{ maxSize: 100, timeout: "30s", key? }` |

> Memorize: **throttle delays, rateLimit drops, debounce keeps-last;
> concurrency caps execution, throttle caps starts.**

And the v3-vs-v4 warning — do NOT copy `triggers: [...]` or `@inngest/test` from the internet:

> | Function shape | `createFunction({ id, ... }, { event: "x" }, handler)` — trigger is the 2nd positional arg | `triggers: [...]` inside the first arg |
> | Testing | no `@inngest/test` (needs v4) — test handlers as plain functions with mocked services | `InngestTestEngine` |

---

## 2. `packages/jobs/src` structure

### Directory layout

```
packages/jobs/
├── AGENTS.md, CLAUDE.md (-> @AGENTS.md)
├── package.json, tsconfig.json, vitest.config.ts, sst-env.d.ts
└── src/
    ├── db.ts                  # getJobDatabaseClient — the ONLY Kysely constructor
    ├── events.ts              # re-export of @carbon/lib/events `Events`
    ├── index.ts               # public entry: trigger/batchTrigger/schemas
    ├── schemas.ts             # Jira/Linear webhook zod schemas
    ├── trigger.ts             # re-export of @carbon/lib/trigger
    ├── workflows/             # Inngest-free core (unit-tested directly)
    │   ├── event-ids.ts + event-ids.test.ts
    │   ├── matcher.ts   + matcher.test.ts
    │   └── types.ts
    └── inngest/
        ├── client.ts          # `export { type InngestClient, inngest } from "@carbon/lib/inngest";`
        ├── index.ts           # the served `functions` array  ← REGISTRATION LIVES HERE
        └── functions/
            ├── events/        # audit, embedding, queue, search, sync, webhook, workflow
            │                  #   + diff.ts/.test.ts, fk-snapshots.ts/.test.ts, index.ts
            ├── extraction/    # extract-document, schemas, index
            ├── integrations/  # accounting-backfill, jira, linear, paperless-parts,
            │                  #   slack-document-sync, sync-external-accounting,
            │                  #   timecard-auto-close, index
            ├── notifications/ # content, notify, send-email, send-slack, index
            ├── scheduled/     # audit-archive, cleanup, dispatch, mrp, notification-digest,
            │                  #   notification-purge, update-exchange-rates, weekly, index
            ├── tasks/         # 20 files incl. company-backup*, print-job/, assembly-*,
            │                  #   model-*, onboard, post-transaction, recalculate, …
            └── workflows/     # index.ts, moment.ts, run.ts   ← YOUR TARGET
```

**Gotcha:** `package.json` declares `"./worker": "./src/inngest/worker.ts"` but
**`packages/jobs/src/inngest/worker.ts` does not exist** (verified with `ls`). That export
subpath is dead. Don't rely on it; `AGENTS.md`'s "Key Exports" table listing `./worker` is
also stale.

### Registration — `packages/jobs/src/inngest/index.ts`

Full file (126 lines) has three parts: a client re-export, per-directory imports, and the
`functions` array. The workflow-relevant lines verbatim:

```typescript
// Re-export the inngest client and helpers
export { inngest } from "./client.ts";
```

```typescript
import {
  workflowMomentFunction,
  workflowRunFunction
} from "./functions/workflows";

// Export all functions for serving via serve() or connect()
export const functions = [
  // Notifications
  notifyFunction,
  sendEmailFunction,
  sendSlackFunction,
  // Event handlers
  auditFunction,
  eventQueueFunction,
  searchFunction,
  syncFunction,
  webhookFunction,
  workflowFunction,
  embeddingFunction,
  // Workflows (matcher + stub consumer)
  workflowMomentFunction,
  workflowRunFunction,
  // Tasks
  ...
```

Because `workflowRunFunction` is already imported, barrelled, and in the array, **replacing
`run.ts`'s body requires no registration change** — as long as you keep the export name
`workflowRunFunction`. If you split the engine into more functions (e.g. a per-node child
function invoked via `step.invoke`), each new one needs a line in `workflows/index.ts` AND
a line in this array.

The array is consumed by the ERP route `apps/erp/app/routes/api+/inngest.ts`:

```typescript
import { functions, inngest } from "@carbon/jobs/inngest";
import { serve } from "inngest/remix";

const handler = serve({
  client: inngest,
  functions,
  // Enable streaming for long-running functions on Vercel
  streaming: "allow",
  serveHost: process.env.INNGEST_SERVE_HOST || process.env.ERP_URL
});

export const loader = handler;
export const action = handler;
```

### The Inngest client

`packages/jobs/src/inngest/client.ts` is one line:

```typescript
export { type InngestClient, inngest } from "@carbon/lib/inngest";
```

The real client, `packages/lib/src/inngest/client.ts`:

```typescript
import { createInngestLogger } from "@carbon/logger/inngest";
import { Inngest } from "inngest";

/**
 * The Inngest client for Carbon jobs.
 * This client is used to define functions and send events.
 * `ctx.logger` in every function flows into LogTape under ["carbon","jobs"].
 */
export const inngest = new Inngest({
  id: "carbon",
  logger: createInngestLogger()
});

// Re-export the typed client for use in functions
export type InngestClient = typeof inngest;
```

Note it does **not** pass `EventSchemas` — typing comes from the `Events` type in
`packages/lib/src/events.ts` applied at the call site (e.g. notify.ts does
`event.data as Events["carbon/notify"]["data"]`), plus per-function zod re-parsing.
Versions: `inngest: "^3.52.7"` in `packages/jobs`, `3.54.0` in `packages/lib` (v3, not v4).

### Retries / concurrency / idempotency conventions (survey of all 40+ functions)

Observed house style:

- **`retries`** — `3` is the default for anything idempotent (`onboard`, `notify`,
  `recalculate`, `user-admin`, `update-permissions`, `post-transactions`, all six
  `event-handler-*`, `workflow-moment`, `workflow-run`). `2` for expensive/external work
  (`event-queue`, `mrp`, `assembly-*`, `model-*`, `extract-document`, `notification-digest`,
  `timecard-auto-close`). `1` for destructive/one-shot work (`company-import`,
  `company-export`, `company-restore*`, all `slack-document-*`, `jira`, `linear`,
  `paperless-parts`, `sync-external-accounting`). `0` for print jobs.
- **`concurrency`** — object form `{ limit, key }` where `key` is a CEL string over the
  event. Real examples:
  - `{ limit: 10, key: "event.data.companyId" }` — `event-handler-workflow`, `workflow-moment`
  - `{ key: "event.data.companyId", limit: 1 }` — `company-import`, `company-export`
  - `{ limit: 0, key: "event.data.companyId" }` — `schedule-job` (limit 0 = unlimited, key only)
  - `{ limit: 0, key: "event.data.data.table + '-' + event.data.data.recordId" }` — `event-handler-webhook` (string-concat CEL key)
  - `key: "'company-restore-' + event.data.companyId"` — `company-restore*` (literal prefix in CEL needs single quotes)
  - `concurrency: 1` — `event-queue` (bare number = global)
  - env-scoped array — `packages/jobs/src/inngest/functions/tasks/assembler-client.ts:48`:
    ```typescript
    export const ASSEMBLER_CONCURRENCY: [
      { scope: "env"; key: string; limit: number }
    ] = [{ scope: "env", key: '"assembler"', limit: 6 }];
    ```
- **`idempotency`** — only two functions use it, both workflow-adjacent:
  `idempotency: "event.data.msgId"` (`event-handler-workflow`, `event-handler-webhook`) and
  `idempotency: "event.data.momentId"` (`workflow-moment`). One run per key per 24h.
- **`singleton`** — `{ key: "event.data.modelUploadId", mode: "skip" }` (`model-compact`),
  `{ key: "event.data.modelId", mode: "skip" }` (`model-thumbnail`),
  `{ mode: "skip" }` keyless (`event-queue`).
- **`onFailure`** — used by the three assembler/model functions to flip a DB row to
  `Failed` after retries are exhausted. This is almost certainly the pattern you want for
  `workflowRun.status = 'Failed'`. Verbatim from `tasks/assembly-plan.ts:32-53`:

  ```typescript
  export const assemblyPlanFunction = inngest.createFunction(
    {
      id: "assembly-plan",
      retries: 2,
      concurrency: ASSEMBLER_CONCURRENCY,
      onFailure: async ({ event }) => {
        const { modelUploadId } = event.data.event.data;
        const client = getCarbonServiceRole();

        // Queued included: a pre-created row (planJobId) stays Queued when the
        // function fails before its "queue" step promotes it to Processing.
        await client
          .from("assemblyPlanJob")
          .update({
            status: "Failed",
            error: event.data.error.message,
            updatedAt: new Date().toISOString()
          })
          .eq("modelUploadId", modelUploadId)
          .eq("kind", "plan")
          .in("status", ["Queued", "Processing"]);
      }
    },
    { event: "carbon/assembly-plan" },
    async ({ event, step, logger }) => { /* … */ }
  );
  ```
  Note the nested shape inside `onFailure`: `event.data.event.data` for the original payload
  and `event.data.error.message` for the failure.
- **`throttle` / `rateLimit` / `debounce` / `batchEvents` / `priority` / `cancelOn`** — used
  by **nothing** in the package today. `debounce` is explicitly forbidden (AGENTS.md: the
  local dev server can't unmarshal debounce items).

### The most step-heavy existing function

By step count: `tasks/onboard.ts` (11 step calls), `notifications/notify.ts` (10),
`events/queue.ts` (9). By line count: `notifications/content.ts` (1302, but it's helpers),
`tasks/company-backup.ts` (1285).

**`events/queue.ts` is the one to copy for a loop-shaped walker** — it is the only function
that runs steps inside a `for` loop, which is exactly the shape a graph walker needs. Head
of the file verbatim (`packages/jobs/src/inngest/functions/events/queue.ts:1-120`):

```typescript
import type { HandlerType, QueueMessage } from "@carbon/database/event";
import { sql } from "kysely";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

const QUEUE_NAME = "event_system"; // Name of the PGMQ queue
const BATCH_SIZE = 100; // Number of messages to process per pass
const VISIBILITY_TIMEOUT = 30; // Seconds a message is hidden after being read
const CHUNK_SIZE = 10; // Max events per sendEvent call (keeps under 256KB limit)
const MAX_PASSES = 10; // Max read/dispatch/delete passes per run (~1000 msgs)

function chunk<T>(arr: T[], size: number): T[][] { /* … */ }

type QueueJob = {
  msg_id: number;
  message: QueueMessage;
};

export const eventQueueFunction = inngest.createFunction(
  {
    id: "event-queue",
    retries: 2,
    concurrency: 1,
    singleton: { mode: "skip" }
  },
  { event: "carbon/event-queue.process" },
  async ({ step }) => {
    let routed = 0;
    let lastPassFull = false;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      // 1. Read batch from PGMQ (checkpointed so replays don't re-read)
      type ReadQueueResult = {
        grouped: Record<HandlerType, QueueJob[]>;
        allIds: number[];
      };

      const { grouped, allIds } = (await step.run(
        `read-queue-${pass}`,
        async () => {
          const pg = getJobDatabaseClient();
          const { rows: jobs } =
            await sql<QueueJob>`SELECT * FROM pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT}, ${BATCH_SIZE})`.execute(
              pg
            );

          const grouped: Record<HandlerType, QueueJob[]> = {
            WEBHOOK: [], WORKFLOW: [], SYNC: [], SEARCH: [], AUDIT: [], EMBEDDING: []
          };

          for (const job of jobs) {
            grouped[job.message.handlerType].push(job);
          }

          return { grouped, allIds: jobs.map((j) => j.msg_id) };
        }
      )) as ReadQueueResult;

      if (allIds.length === 0) {
        lastPassFull = false;
        break;
      }

      // 3. Dispatch webhooks
      if (grouped.WEBHOOK.length > 0) {
        const events = grouped.WEBHOOK.map((job) => ({ /* … */ }));
        const chunks = chunk(events, CHUNK_SIZE);
        for (let i = 0; i < chunks.length; i++) {
          await step.sendEvent(`dispatch-webhooks-${pass}-${i}`, chunks[i]!);
        }
      }
      // … one block per handler type …
    }
  }
);
```

Four transferable lessons:

1. **Step ids carry the loop index** — `read-queue-${pass}`, `dispatch-webhooks-${pass}-${i}`.
   A walker must do the same per node (`node-${nodeId}` or `node-${index}`), or replays break.
2. **The step return value is cast** — `(await step.run(...)) as ReadQueueResult`. Inngest's
   v3 step return typing loses structure through JSON serialization; the codebase casts.
3. **The Kysely client is constructed *inside* the step** (`const pg = getJobDatabaseClient();`)
   — never at module scope, never outside a step.
4. **A bounded loop with an explicit max** (`MAX_PASSES = 10`) plus a re-wake at the end,
   rather than an unbounded walk. The 1000-step budget is real.

The other model — `tasks/onboard.ts` — shows the **linear pipeline** shape: one `step.run`
per side effect, `step.sleep("wait-5m", "5m")` between phases, plain `switch`/`if` control
flow *outside* the steps (branching is deterministic, so it needn't be wrapped), and results
threaded between steps as plain values:

```typescript
export const onboardFunction = inngest.createFunction(
  { id: "onboard", retries: 3 },
  { event: "carbon/onboard" },
  async ({ event, step, logger }) => {
    const { type, companyId, userId, plan } = event.data;

    const carbon = getCarbonServiceRole();
    // …
    const { company, user } = await step.run("load-company-and-user", async () => {
      const [company, user] = await Promise.all([
        carbon.from("company").select("*").eq("id", companyId).single(),
        carbon.from("user").select("*").eq("id", userId).single()
      ]);
      if (company.error) {
        logger.error("Could not find company", company.error);
        throw new Error(company.error.message);
      }
      // …
      return { company: company.data, user: user.data };
    });

    switch (type) {
      case "lead":
        await step.run("create-resend-contact", async () => { /* … */ });
        const leadType = await step.run("classify-lead", async () => { /* … */ });
        await step.run("send-slack-lead-notification", async () => { /* … */ });
        await step.run("add-lead-to-crm", async () => { /* … */ });
        break;
      case "customer":
        // …
        await step.sleep("wait-5m", "5m");
        if (sendOnboardingEmail) {
          await step.run("send-welcome-email", async () => { /* … */ });
        }
        await step.sleep("wait-3d", "3d");
        // …
    }
  }
);
```

One important comment from `notify.ts:220-222` about **renaming step ids**:

> ```typescript
> // Step id intentionally differs from the old "get-description": the result
> // shape changed, so in-flight runs must re-execute this idempotent read
> // rather than resume a stale memoized string. Don't rename back.
> ```

Since you are replacing `run.ts`'s body wholesale, the existing `"stub"` step id must NOT be
reused for anything with a different meaning — pick fresh ids.

---

## 3. Database access in jobs

Two clients coexist, chosen by what you're doing.

### Kysely — `getJobDatabaseClient` (the whole of `packages/jobs/src/db.ts`)

```typescript
import {
  getPostgresClient,
  getPostgresConnectionPool,
  type KyselyDatabase
} from "@carbon/database/client";
import { type Kysely, PostgresDriver } from "kysely";

/**
 * The Kysely client for background jobs. `getPostgresClient` is typed against
 * the edge runtime's vendored kysely, so the structurally-identical instance
 * needs a cast to satisfy this package's copy.
 */
export function getJobDatabaseClient(size = 1) {
  const pool = getPostgresConnectionPool(size);
  return getPostgresClient(
    pool,
    PostgresDriver
  ) as unknown as Kysely<KyselyDatabase>;
}

export type JobDatabase = ReturnType<typeof getJobDatabaseClient>;
```

- `@carbon/database/client` (`packages/database/src/client.ts`) is a one-line barrel:
  `export * from "../supabase/functions/lib/postgres/index.ts";` — i.e. the pool/client
  implementation is shared with the Deno edge functions.
- **Kysely bypasses RLS.** The caller authorizes. Every query must carry `companyId`
  explicitly — see the matcher's `.where("te.companyId", "=", input.companyId)`.
- **Construct it inside a `step.run`**, not at module scope (contrast the edge-function
  convention, which does the opposite). Both `queue.ts` and `workflow.ts` do
  `const db = getJobDatabaseClient();` inside the step body.
- Raw SQL uses the `sql` tag from `kysely`: `` await sql<QueueJob>`SELECT * FROM pgmq.read(${QUEUE_NAME}, …)`.execute(pg) ``.

Real usage in the matcher (`packages/jobs/src/workflows/matcher.ts:126-211`) — this is the
exact style the engine's DB layer should follow (typed selects, composite-key joins,
`ON CONFLICT` on a named constraint, `.returning()` to learn what actually happened):

```typescript
export async function matchAndQueue(
  db: Kysely<KyselyDatabase>,
  input: MatchInput
): Promise<MatchResult> {
  const rows = await db
    .selectFrom("workflowTriggerEvent as te")
    .innerJoin("workflow as w", (join) =>
      join
        .onRef("w.id", "=", "te.workflowId")
        .onRef("w.companyId", "=", "te.companyId")
    )
    .select([
      "te.workflowId", "te.workflowVersionId", "te.eventId", "te.origin", "w.ownerId"
    ])
    .where("te.companyId", "=", input.companyId)
    .where("te.eventId", "in", input.eventIds)
    .execute();
  // …
  // One statement, so the whole firing lands or none of it does. ON CONFLICT
  // returns only the genuinely new rows, which is also the dedupe count.
  const inserted = await db
    .insertInto("workflowRun")
    .values(planned.map((plan) => ({ /* … */ })))
    .onConflict((oc) => oc.constraint("workflowRun_dedupe_key").doNothing())
    .returning(["id", "workflowId"])
    .execute();
```

Note the module signature: `matchAndQueue(db, input)` takes the client as a parameter and
lives in `src/workflows/` with **no Inngest import**, so it is unit-testable. Phase 4's
engine core should keep that split (`src/workflows/engine.ts` taking `db`, with
`inngest/functions/workflows/run.ts` as a thin Inngest shell).

### supabase-js — `getCarbonServiceRole`

`packages/auth/src/lib/supabase/client.server.ts:10`, imported everywhere as
`import { getCarbonServiceRole } from "@carbon/auth/client.server";`:

```typescript
export const getCarbonServiceRole = (): SupabaseClient<Database> => {
  return getCarbonClient(SUPABASE_SERVICE_ROLE_KEY!);
};
```

Used by `onboard.ts`, `notify.ts`, `assembly-*.ts`, `print-job*`, etc. — single-row reads,
`.update()` on one row, storage, and `functions.invoke()`. It returns `{ data, error }`
rather than throwing.

### The one that matters most for phase 4 — `getUserScopedClient`

Same file, immediately below (`packages/auth/src/lib/supabase/client.server.ts:14+`):

```typescript
export async function getUserScopedClient(
  userId: string,
  options?: { workflowRunId?: string }
): Promise<SupabaseClient<Database>> {
  if (!SUPABASE_JWT_SECRET) {
    throw new Error("SUPABASE_JWT_SECRET is required for user-scoped clients");
  }

  const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
  const jwt = await new SignJWT({
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    ...(options?.workflowRunId
      ? { workflow_run_id: options.workflowRunId }
      : {})
  })
```

`.claude/rules/workflow-matcher.md` states the consequence bluntly:

> **A workflow action that writes through anything but the owner-scoped client is untagged**
> — it will look like a person's write, so the origin filter and both loop guards go blind.
> Nothing mints a tagged token until phase 4.

So: **every write an engine action performs must go through
`getUserScopedClient(run.ownerId, { workflowRunId: run.id })`**, not `getCarbonServiceRole()`
and not the Kysely client. Kysely and service-role writes are for the engine's *own*
bookkeeping (updating `workflowRun` status, writing step rows) — those must not be tagged.

### Which to pick

| Need | Client |
|---|---|
| Engine bookkeeping: read the run + version graph, update `workflowRun`/step status, multi-row writes | `getJobDatabaseClient()` (Kysely, inside a step) |
| An action performing a business write on the customer's behalf | `getUserScopedClient(ownerId, { workflowRunId })` — **required** for the run tag |
| A single-row read of config, an edge-function `invoke`, storage | `getCarbonServiceRole()` |

---

## 4. Logging and error handling

### Logging — two channels

**(a) `ctx.logger` from the handler args** — the common case. Destructure it:
`async ({ event, step, logger }) => { … }`. It flows into LogTape automatically because the
client was constructed with `logger: createInngestLogger()`. The adapter,
`packages/logger/src/inngest.ts`:

```typescript
/**
 * Inngest's `Logger` interface: `{ info, warn, error, debug }`, each
 * `(...args: unknown[]) => void`. Passed to `new Inngest({ logger })` so every
 * job's `ctx.logger` flows into LogTape under `["carbon","jobs"]`.
 */
export type InngestLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

export function createInngestLogger(): InngestLogger {
  const logger = getLogger("jobs");
  return {
    debug: emit(logger, "debug"),
    info: emit(logger, "info"),
    warn: emit(logger, "warning"),
    error: emit(logger, "error")
  };
}
```

Call style is printf-ish, first arg a string: `logger.info(\`Workflow run ${id} queued\`)`,
`logger.error("Could not find company", company.error)`,
`logger.warn(\`Unknown workflow moment: ${payload.moment}\`)`. Note `warn` maps to LogTape
`"warning"`.

**(b) `getLogger` from `@carbon/logger`** — for a module-scoped named logger outside the
handler (helpers, pure functions). `packages/logger/src/logger.ts`:

```typescript
export const CARBON_ROOT_CATEGORY = "carbon";

/**
 * Get a logger scoped to a Carbon category.
 *
 * @example
 * getLogger("auth")          // ["carbon","auth"]
 * getLogger("erp", "sales")  // ["carbon","erp","sales"]
 * getLogger("jobs", fnName)  // ["carbon","jobs",fnName]
 */
export function getLogger(...category: string[]): Logger {
  return getLogTapeLogger([CARBON_ROOT_CATEGORY, ...category]);
}
```

House convention is a module-level const named `log`, e.g.
`events/audit.ts:29` → `const log = getLogger("jobs", "audit");`. Other users:
`company-backup.ts`, `slack-document-sync.ts`, `sync-external-accounting.ts`,
`accounting-backfill.ts`, `scheduled/dispatch.ts`, `scheduled/audit-archive.ts`.
For the engine: `const log = getLogger("jobs", "workflow-run");`.

Raw `console.warn` appears once in `notify.ts` — not the convention, don't copy it.

**Because the handler re-runs from the top on every step, any `logger.*` call outside a
`step.run` is emitted once per step invocation.** Put logging you care about inside steps.

### Error handling

- A thrown error inside `step.run` retries **that step** with exponential backoff, up to
  `retries` times (`retries: N` = N+1 attempts). A step that exhausts its retries throws
  into the handler; uncaught, the function fails, `onFailure` runs, and
  `inngest/function.failed` is emitted.
- **`NonRetriableError`** — `import { NonRetriableError } from "inngest";`. Used in 4 files:
  `tasks/assembler-client.ts` (×4), `tasks/print-job-deliver.ts` (×3),
  `notifications/send-email.ts` (×2), `notifications/notify.ts` (×2). The invariant across
  all of them: **permanent, input-shaped failures** — not-found, missing required field,
  cancellation. Verbatim examples:

  ```typescript
  // tasks/print-job-deliver.ts:25,32
  throw new NonRetriableError(`Print job not found: ${printJobId}`);
  throw new NonRetriableError("Print job has no content");

  // notifications/notify.ts:202
  throw new NonRetriableError(
    `carbon/notify event ${payload.event} has neither documentId nor documentIds`
  );

  // notifications/notify.ts:249
  throw new NonRetriableError(
    `No description found for notification type ${payload.event} with documentId ${primaryDocumentId}`
  );

  // tasks/assembler-client.ts:430
  throw new NonRetriableError(`assembler ${action} canceled`);
  ```

  For the engine: a malformed graph, an unknown node type, a missing `workflowVersion`, or a
  zod parse failure on the payload should be `NonRetriableError`. A transient DB/HTTP failure
  should be a plain throw (retriable).
- `RetryAfterError` is documented in the skill (`throw new RetryAfterError("msg", "30s")` for
  upstream 429/503) but **is not used anywhere in the repo yet**.
- `serializeError` from `inngest` is imported by `notifications/send-email.ts` — the way to
  put an error into a payload/DB column.
- `notify.ts` shows the "skip, don't fail" alternative: return early with a warning when the
  work has legitimately become a no-op:
  > ```typescript
  > // Digest events can legitimately resolve to nothing (all documents
  > // completed/deleted in flight) — skip, don't fail.
  > ```
  Both matcher entry points do the same, returning `{ queued: 0, blocked: 0 }` on an unknown
  moment / empty event-id list rather than throwing.
- **`onFailure`** is the only mechanism that reliably flips a DB row to a terminal state
  after all retries are exhausted — see the `assembly-plan.ts` snippet in §2. The `.in("status",
  ["Queued", "Processing"])` guard there (never clobber an already-terminal row) is worth
  copying for `workflowRun`.

---

## 5. Testing conventions

### Setup

`packages/jobs/vitest.config.ts` is one line:

```typescript
export { default } from "@carbon/config/vitest";
```

`packages/config/vitest.mts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    passWithNoTests: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist", "test/__fixtures__", ".turbo"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/index.ts"],
    },
  },
});
```

`globals: false` → **always `import { describe, expect, it } from "vitest";`** explicitly.
Script: `"test": "vitest run"`. Run with `pnpm --filter @carbon/jobs test`.

### Existing tests (4 total)

| File | Tests |
|---|---|
| `packages/jobs/src/workflows/matcher.test.ts` | `filterByOrigin`, `deriveNextTrace`, `planRuns` |
| `packages/jobs/src/workflows/event-ids.test.ts` | `computeEventIds` |
| `packages/jobs/src/inngest/functions/events/fk-snapshots.test.ts` | `parseFkMapRows`, `fkMapKey`, `resolveSnapshotSpec` |
| `packages/jobs/src/inngest/functions/tasks/company-backup.closure.test.ts` | `assertReferentiallyClosed`, `buildRowTransforms`, `findDanglingReferences` |

### The convention: **no Inngest is mocked, and no DB is mocked — pure functions are extracted and tested directly.**

There is no `@inngest/test`, no `vi.mock`, no fake Supabase client anywhere in the package.
The pattern is: put the decisions in pure functions in a separate module, test those, and
leave the Inngest wrapper as a thin untested shell. `.claude/rules/workflow-matcher.md` names
this explicitly:

> `packages/jobs/src/workflows/` holds the core and imports no Inngest:
> `event-ids.ts` … `matcher.ts` (four pure planning functions + the one DB-touching
> orchestrator) and `types.ts`. That split is what makes the acceptance criteria
> unit-testable — see `event-ids.test.ts` and `matcher.test.ts`.

**Example — `packages/jobs/src/workflows/matcher.test.ts` (the closest model for phase 4):**

```typescript
import { describe, expect, it } from "vitest";
import { deriveNextTrace, filterByOrigin, planRuns } from "./matcher";
import type { Subscriber } from "./types";

function sub(overrides: Partial<Subscriber> = {}): Subscriber {
  return {
    workflowId: "wf_1",
    workflowVersionId: "wfv_1",
    eventId: "purchaseOrder.status.changed",
    origin: "Both",
    ownerId: "usr_1",
    ...overrides
  };
}

describe("filterByOrigin", () => {
  const subscribers = [
    sub({ workflowId: "wf_person", origin: "Person" }),
    sub({ workflowId: "wf_automation", origin: "Automation" }),
    sub({ workflowId: "wf_both", origin: "Both" })
  ];

  it("keeps Person and Both for a person-made write", () => {
    expect(filterByOrigin(subscribers, null).map((s) => s.workflowId)).toEqual([
      "wf_person",
      "wf_both"
    ]);
  });
  // …
});
```

Note the shape: a tiny `sub()` / `col()` / `table()` builder function with
`Partial<T>` overrides at the top of the file, then `describe` per exported function,
`it` per behavior, `expect(...).toEqual(...)`. `company-backup.closure.test.ts` scales the
same idea to a synthetic catalog and documents *why* the test exists in a comment block:

```typescript
// ── Tiny synthetic-catalog builders ─────────────────────────────────────────
// The closure check is a pure function of (catalog, data), so these tests need
// no database — they pin the ONE definition of "referentially closed" that the
// restore preflight relies on, so a schema/data shape that would dangle a
// restore fails here in CI instead of mid-load in production.
```

**Implication for phase 4:** extract the engine's decisions — node ordering / topological
walk, condition evaluation, template/variable resolution, next-node selection, terminal-state
determination — into pure functions in `packages/jobs/src/workflows/` and unit-test those.
The `step.run` orchestration in `run.ts` stays thin and untested, exactly like
`matchAndQueue`'s Inngest shells.

---

## 6. Local dev

- **Whole stack:** `pnpm dev` at the repo root → `crbn up --no-portless`. This brings up
  Supabase/Docker/Redis **and** the Inngest dev server; `INNGEST_BASE_URL` lands in
  `.env.local`.
- **Inngest dev server standalone:** `pnpm --filter @carbon/jobs dev:jobs`, which is
  `pnpm dlx inngest-cli@latest dev --no-discovery -u http://localhost:3000/api/inngest`.
  UI on `:8288`. The `-u` points at the ERP serve route, so **the ERP app must be running**
  for functions to be discovered/executed.
- **Send a test event by hand** (from the `/inngest` skill):
  ```bash
  curl -X POST $INNGEST_BASE_URL/e/dev -H 'content-type: application/json' \
    -d '{"name":"carbon/x","data":{}}'
  ```
  (any event-key segment works locally). For phase 4 that's
  `{"name":"carbon/workflow-run.queued","data":{ runId, companyId, workflowId, workflowVersionId, eventId, ownerId, sourceEventId, trigger }}`.
- **End-to-end** (from `workflow-event-system.md`): do a real DB write, then confirm in the
  Inngest UI that `carbon/event-queue.process` arrives, `event-queue` drains,
  `event-handler-workflow` matches, and `workflow-run` fires. Debug the queue with
  `SELECT * FROM pgmq.metrics('event_system');`.
- **v3 defaults to dev mode locally** — no `INNGEST_DEV=1` needed (that's a v4 thing).
- `debounce` will break the local dev server (v1.19.4 can't unmarshal debounce items) — do
  not add it.

---

## 7. The stub you're replacing

### `packages/jobs/src/inngest/functions/workflows/run.ts` — complete file, verbatim (32 lines)

```typescript
import { runTriggerSchema } from "@carbon/workflows";
import { z } from "zod";
import { inngest } from "../../client";

const runPayloadSchema = z.object({
  runId: z.string(),
  companyId: z.string(),
  workflowId: z.string(),
  workflowVersionId: z.string(),
  eventId: z.string(),
  ownerId: z.string(),
  sourceEventId: z.string(),
  trigger: runTriggerSchema
});

/**
 * Stub consumer for matched runs. Phase 4 replaces this body with the graph
 * walker and adds the per-company / per-workflow concurrency keys.
 */
export const workflowRunFunction = inngest.createFunction(
  { id: "workflow-run", retries: 3 },
  { event: "carbon/workflow-run.queued" },
  async ({ event, step, logger }) => {
    const payload = runPayloadSchema.parse(event.data);
    await step.run("stub", async () => {
      logger.info(
        `Workflow run ${payload.runId} queued for workflow ${payload.workflowId} (stub — the engine is phase 4)`
      );
    });
    return { runId: payload.runId };
  }
);
```

### Its registration — two lines, both already present

`packages/jobs/src/inngest/functions/workflows/index.ts` (complete file):

```typescript
export { workflowMomentFunction } from "./moment";
export { workflowRunFunction } from "./run";
```

`packages/jobs/src/inngest/index.ts` — the import (lines 62-65) and the array entry
(lines 81-83):

```typescript
import {
  workflowMomentFunction,
  workflowRunFunction
} from "./functions/workflows";
```

```typescript
  // Workflows (matcher + stub consumer)
  workflowMomentFunction,
  workflowRunFunction,
```

### Its event type — `packages/lib/src/events.ts:572-585`, verbatim

```typescript
  // A matched workflow firing: one event per created workflowRun row. The
  // phase-4 engine consumes this; until then a stub logs and returns.
  "carbon/workflow-run.queued": {
    data: {
      runId: string;
      companyId: string;
      workflowId: string;
      workflowVersionId: string;
      eventId: string;
      ownerId: string;
      sourceEventId: string;
      trigger: RunTrigger;
    };
  };
```

### Who sends it — `packages/jobs/src/workflows/matcher.ts` (~line 215)

```typescript
    result.events.push({
      name: "carbon/workflow-run.queued",
      id: `${plan.subscriber.workflowId}:${plan.subscriber.workflowVersionId}:${input.sourceEventId}`,
      data: {
        runId,
        companyId: input.companyId,
        workflowId: plan.subscriber.workflowId,
        workflowVersionId: plan.subscriber.workflowVersionId,
        …
```

The `id` is the 24h Inngest dedupe key, so a replayed announcement cannot double-start a run
even before the DB dedupe constraint fires. The `workflowRun` row is **already inserted with
status `Queued`** by the matcher before this event is sent — the engine's first step should
transition `Queued → Running`, not create the row.

### Sibling to mirror — `packages/jobs/src/inngest/functions/workflows/moment.ts`

The house shape for a workflows function: zod schema at module scope, doc comment explaining
the entry point, config with `retries` + `idempotency` + a `{ limit, key }` concurrency
object, `getJobDatabaseClient()` constructed inside the step, `step.sendEvent` guarded by a
non-empty check, a structured return value.

```typescript
export const workflowMomentFunction = inngest.createFunction(
  {
    id: "workflow-moment",
    retries: 3,
    idempotency: "event.data.momentId",
    concurrency: {
      limit: 10,
      key: "event.data.companyId"
    }
  },
  { event: "carbon/workflow-moment.raised" },
  async ({ event, step, logger }) => {
    const payload = momentPayloadSchema.parse(event.data);

    const match = WORKFLOW_EVENTS[payload.moment]?.match;
    if (!match || !("moment" in match)) {
      logger.warn(`Unknown workflow moment: ${payload.moment}`);
      return { queued: 0, blocked: 0 };
    }

    const result = await step.run("match", async () => {
      const db = getJobDatabaseClient();
      return matchAndQueue(db, { /* … */ });
    });

    if (result.events.length > 0) {
      await step.sendEvent("queue-runs", result.events);
    }
    return { queued: result.queued, blocked: result.blocked };
  }
);
```

---

## Checklist for phase 4

- [ ] Keep the export name `workflowRunFunction` and the id `workflow-run` — registration then
      needs no edit. Any *additional* function needs a line in `workflows/index.ts` **and** in
      the `functions` array in `packages/jobs/src/inngest/index.ts`.
- [ ] Add the concurrency keys the stub deliberately omits, object form:
      `concurrency: [{ limit: N, key: "event.data.companyId" }, { limit: M, key: "event.data.workflowId" }]`.
      Keep `retries: 3`.
- [ ] Add `onFailure` to flip `workflowRun` to `Failed` with `event.data.error.message`,
      guarded by `.in("status", ["Queued", "Running"])` so a terminal row is never clobbered.
- [ ] Extract the walker's decisions into pure functions under `packages/jobs/src/workflows/`
      (no Inngest import) and unit-test them with `import { describe, expect, it } from "vitest"`.
- [ ] Every step id must be unique and loop-indexed (`node-${index}-${nodeId}`); don't reuse
      `"stub"`.
- [ ] `getJobDatabaseClient()` inside each step, never at module scope; every query carries
      `companyId`.
- [ ] Business writes performed by actions go through
      `getUserScopedClient(ownerId, { workflowRunId: runId })` — otherwise the origin filter
      and loop guards go blind on the next hop.
- [ ] `NonRetriableError` for malformed graphs / unknown node types / zod failures; plain
      throw for transient failures.
- [ ] Watch the 1000-step / 4MB-per-step / 32MB-per-run budget; bound the walk explicitly like
      `MAX_PASSES` in `queue.ts`, and split with `step.sendEvent`/`step.invoke` if needed.
- [ ] No `debounce` (breaks the local dev server). No v4 syntax (`triggers: [...]`,
      `@inngest/test`, `step.ai`).
- [ ] Verify: `pnpm --filter @carbon/jobs typecheck && pnpm --filter @carbon/jobs test`,
      plus `pnpm exec biome check`. Exercise locally via the Inngest UI at :8288.
- [ ] Update `packages/jobs/AGENTS.md` (the "**Stub**" row) and `.claude/rules/workflow-matcher.md`
      (the "`workflows/run.ts` is a **stub**" gotcha) in the same PR — both explicitly describe
      the stub you're deleting.

## Stale docs found during this research

1. `packages/jobs/package.json` exports `"./worker": "./src/inngest/worker.ts"` — **the file
   does not exist**. `AGENTS.md`'s Key Exports table lists it too.
2. `.claude/rules/event-system.md` says handlers are *"registered in
   `packages/jobs/src/inngest/functions/index.ts`"* — that file does not exist; the registry
   is `packages/jobs/src/inngest/index.ts`. `workflow-event-system.md` already corrects this.
