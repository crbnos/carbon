# Workflows Phase 3 — the matcher and event-system wiring — implementation plan

**Spec / source:** `.ai/specs/2026-07-30-workflows-matcher.md` (approved)
**Branch:** `feat/automation`

One deliberate deviation from the spec, decided at plan time and flagged to the user:
the reconciler (`syncWorkflowTriggers` / `syncWorkflowSubscriptions`) lives in
**`packages/workflows/src/sync.ts`**, not `packages/database/src/workflow.ts`. Reason:
it must read `WORKFLOW_EVENTS` from `@carbon/workflows`, and `@carbon/workflows` already
has `@carbon/database` as a devDependency — adding the reverse dependency creates a
package cycle that Turborepo rejects outright. `@carbon/workflows` satisfies the spec's
placement rationale identically (importable by both the ERP app and background jobs),
keeps the exact approved signatures, needs only type-level imports of Kysely (no runtime
dep), and already has vitest infra. Record this in the spec changelog (Task 10).

## Progress

All tasks complete. One in-execution deviation: `msgId` in `events/workflow.ts` is `z.coerce.number()`, not `z.number()` — pgmq's `msg_id` is BIGINT and node-pg returns it as a string, which failed the first e2e run.

A post-implementation code-quality review then changed five things (behavior preserved; the code blocks below still show the pre-review shape):

1. `packages/jobs/src/workflows/db.ts` **deleted**. It was a 3rd copy of a helper already exported as `getJobDatabaseClient` from `tasks/company-backup.ts`. That helper moved to `packages/jobs/src/db.ts` (its canonical layer) and now serves the matcher, `events/queue.ts` (whose private copy is gone) and the four company backup/restore tasks.
2. The trigger payload is declared once as `runTriggerSchema` / `RunTrigger` in `packages/workflows/src/run-trigger.ts`, replacing three restatements of the same union (`lib/src/events.ts`, `jobs/src/workflows/types.ts`, `workflows/run.ts`'s zod schema).
3. `matcher.ts` no longer force-casts the subscriber query with `as Subscriber[]`; only the CHECK-constrained `origin` column is narrowed.
4. The purged-causing-run fallback used `workflowId: ""`, which wrote a `[""]` element into the run's `path` array. `CausingRun.workflowId` is now `string | null` and `deriveNextTrace` adds no hop for it (regression test added).
5. The per-plan `await` insert loop is one multi-row `INSERT ... ON CONFLICT DO NOTHING RETURNING`, so a firing is atomic and costs one round trip; `deduped` falls out of the row-count difference.
- [x] Task 1: Migration `workflows-run-tag` — rewrite `dispatch_event_batch()`
- [x] Task 2: `getUserScopedClient` gains the `workflowRunId` option
- [x] Task 3: `QueueMessageSchema` gains `workflowRunId`
- [x] Task 4: `@carbon/lib` — Events entries, `trigger` options, `raiseMoment` mints `momentId`
- [x] Task 5: Reconciler in `@carbon/workflows` + unit tests
- [x] Task 6: Matcher core in `@carbon/jobs` (`event-ids.ts`, `matcher.ts`, `types.ts`, `db.ts`)
- [x] Task 7: Matcher unit tests (acceptance criteria 1–7)
- [x] Task 8: Inngest entry points, queue dispatch branch, registration
- [x] Task 9: Full validation sweep
- [x] Task 10: Docs, rules, and spec changelog sync
- [x] Task 11: End-to-end verification against the local stack (criteria 9–14)

## Dependencies
- Tasks 1, 2, 3, 4, 5 are mutually independent (parallelizable).
- Task 6 needs Task 3 (imports `QueueMessage` shape indirectly via `EventSchema` only — actually independent, but keep after 3 to avoid churn).
- Task 7 needs Task 6. Task 8 needs Tasks 3, 4, 6. Task 9 needs 1–8. Task 10 needs 1–8. Task 11 needs 1–9 and a running local stack.

---

## Task 1: Migration `workflows-run-tag` — rewrite `dispatch_event_batch()`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_workflows-run-tag.sql` (via `pnpm db:migrate:new workflows-run-tag`)
- Copy from (precedent): `packages/database/supabase/migrations/20260721184852_event-queue-wake.sql:82-240` (current body) and `20260717143448_fix-event-update-row-pairing.sql:76-91,199-203` (the `pk_join` logic being restored)

**Steps:**
1. `pnpm db:migrate:new workflows-run-tag` (never use `000000` for HHMMSS — the CLI stamps a real time; leave it).
2. Write exactly this content (it is the `20260721184852` body with three edits: `current_workflow_run_id` + `pk_join` declares, the claim read + `pk_join` derivation, `''workflowRunId'', $10` in all three payloads with `current_workflow_run_id` appended to all three `USING` lists, and the composite-key `JOIN ... ON %s`). `get_primary_key_columns()` already exists from `20260717143448` — do NOT recreate it:

```sql
-- Phase 3 (workflows): tag queue messages with the causing workflow run.
--
-- dispatch_event_batch() gains one payload field, `workflowRunId`, read from
-- the `workflow_run_id` claim on the caller's verified JWT
-- (request.jwt.claims). The workflow engine (phase 4) mints its per-step
-- owner token with that claim, so every write a running workflow makes
-- announces which run made it; a normal user or API token carries no such
-- claim and the field is null. This is what makes the origin filter and the
-- loop guards possible.
--
-- Also restores the composite-key UPDATE row pairing (pk_join) from
-- 20260717143448_fix-event-update-row-pairing.sql, which 20260721184852
-- silently reverted by copying its body forward from 20260427120000.
-- get_primary_key_columns() already exists and is not recreated here.

CREATE OR REPLACE FUNCTION public.dispatch_event_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, extensions
AS $$
DECLARE
  sub RECORD;
  msg_batch JSONB[];
  rec_company_id TEXT;
  has_subs BOOLEAN;
  current_actor_id TEXT;
  current_workflow_run_id TEXT;
  pk_column TEXT;
  pk_join TEXT;
  query_text TEXT;
  did_enqueue BOOLEAN := FALSE;
BEGIN
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  current_actor_id := auth.uid()::TEXT;
  current_workflow_run_id :=
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'workflow_run_id';
  pk_column := public.get_primary_key_column(TG_TABLE_NAME);

  -- Pair UPDATE transition rows on the table's full row identity, not just
  -- the first key column — single-column pairing cross-joins rows on tables
  -- with composite identity (see 20260717143448).
  SELECT string_agg(format('n.%I = o.%I', col, col), ' AND ')
    INTO pk_join
  FROM unnest(public.get_primary_key_columns(TG_TABLE_NAME)) AS col;

  IF TG_OP = 'DELETE' THEN
    SELECT t."companyId" INTO rec_company_id FROM batched_old t LIMIT 1;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT t."companyId" INTO rec_company_id FROM batched_new t LIMIT 1;
  ELSE
    SELECT t."companyId" INTO rec_company_id FROM batched_new t LIMIT 1;
  END IF;

  IF rec_company_id IS NULL THEN RETURN NULL; END IF;

  SELECT EXISTS (
    SELECT 1 FROM "eventSystemSubscription"
    WHERE "table" = TG_TABLE_NAME
      AND "companyId" = rec_company_id
      AND "active" = TRUE
      AND TG_OP = ANY("operations")
  ) INTO has_subs;

  IF NOT has_subs THEN RETURN NULL; END IF;

  FOR sub IN
    SELECT * FROM "eventSystemSubscription"
    WHERE "table" = TG_TABLE_NAME
      AND "companyId" = rec_company_id
      AND "active" = TRUE
      AND TG_OP = ANY("operations")
  LOOP

    IF TG_OP = 'INSERT' THEN
        query_text := format('
            SELECT array_agg(
                jsonb_build_object(
                    ''subscriptionId'', $1,
                    ''triggerType'', $2,
                    ''handlerType'', $3,
                    ''handlerConfig'', $4,
                    ''companyId'', $5,
                    ''actorId'', $6,
                    ''workflowRunId'', $10,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', t.%I::TEXT,
                        ''new'', row_to_json(t)::jsonb,
                        ''old'', null,
                        ''timestamp'', clock_timestamp()
                    )
                )
            )
            FROM batched_new t
            WHERE t."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(t)::jsonb @> $9)
        ', pk_column);

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter,
              current_workflow_run_id;

    ELSIF TG_OP = 'DELETE' THEN
        query_text := format('
            SELECT array_agg(
                jsonb_build_object(
                    ''subscriptionId'', $1,
                    ''triggerType'', $2,
                    ''handlerType'', $3,
                    ''handlerConfig'', $4,
                    ''companyId'', $5,
                    ''actorId'', $6,
                    ''workflowRunId'', $10,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', t.%I::TEXT,
                        ''new'', null,
                        ''old'', row_to_json(t)::jsonb,
                        ''timestamp'', clock_timestamp()
                    )
                )
            )
            FROM batched_old t
            WHERE t."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(t)::jsonb @> $9)
        ', pk_column);

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter,
              current_workflow_run_id;

    ELSIF TG_OP = 'UPDATE' THEN
        query_text := format('
            SELECT array_agg(
                jsonb_build_object(
                    ''subscriptionId'', $1,
                    ''triggerType'', $2,
                    ''handlerType'', $3,
                    ''handlerConfig'', $4,
                    ''companyId'', $5,
                    ''actorId'', $6,
                    ''workflowRunId'', $10,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', n.%I::TEXT,
                        ''new'', row_to_json(n)::jsonb,
                        ''old'', row_to_json(o)::jsonb,
                        ''timestamp'', clock_timestamp()
                    )
                )
            )
            FROM batched_new n
            JOIN batched_old o ON %s
            WHERE n."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(n)::jsonb @> $9)
        ', pk_column, pk_join);

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter,
              current_workflow_run_id;
    END IF;

    IF msg_batch IS NOT NULL AND array_length(msg_batch, 1) > 0 THEN
      PERFORM pgmq.send_batch('event_system', msg_batch);
      did_enqueue := TRUE;
    END IF;

  END LOOP;

  -- Wake the Inngest drainer, at most once per transaction. The GUC is
  -- txn-local (set_config(..., true)), so multi-statement transactions and
  -- bulk imports post a single doorbell instead of one per statement.
  IF did_enqueue
     AND current_setting('carbon.event_wake_sent', true) IS DISTINCT FROM 'true' THEN
    PERFORM util.wake_event_queue();
    PERFORM set_config('carbon.event_wake_sent', 'true', true);
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.dispatch_event_batch() IS 'Dispatches database events to PGMQ and wakes the Inngest drainer via wake_event_queue() (once per transaction). Uses clock_timestamp() so each event has a unique microsecond timestamp even when batched. Stamps workflowRunId from the workflow_run_id JWT claim so workflow-made writes are distinguishable.';
```

3. Diff the new file against `20260721184852_event-queue-wake.sql:82-242` line by line and confirm the ONLY differences are: the header comment, the two new DECLARE lines (`current_workflow_run_id TEXT;`, `pk_join TEXT;`), the claim-read statement, the `pk_join` derivation block, three `''workflowRunId'', $10,` lines, three `current_workflow_run_id` additions to `USING`, and `JOIN batched_old o ON %s` + `', pk_column, pk_join);` in the UPDATE branch.
4. Apply: `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate
# Expected: the new migration applies with no error.
git status --short packages/database/src packages/database/supabase/functions/lib
# Expected: NO modified generated files (no table/column changed). If types.ts,
# swagger-docs-schema.ts, or functions/lib/types.ts show as modified, STOP and
# report — that means unexpected drift, not this migration.
```

**Out of scope:** `util.wake_event_queue`, `util.sweep_event_queue`, the pg_cron job, `get_primary_key_columns` (all untouched). No table, column, enum, or CHECK-constraint change.
**Escape hatch:** if `pnpm db:migrate` fails because the local DB is unreachable, STOP and report — do not attempt to start or rebuild the database.

---

## Task 2: `getUserScopedClient` gains the `workflowRunId` option

**Depends on:** none
**Files:**
- Modify: `packages/auth/src/lib/supabase/client.server.ts` — optional second argument

**Steps:**
1. Replace the `getUserScopedClient` function (lines 14–33) with:

```ts
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
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);

  return getCarbon(jwt);
}
```

Nothing calls it with a run id yet — phase 4 does. All existing call sites keep working (the argument is optional).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/auth
# Expected: exit 0
```

**Out of scope:** `getCarbonServiceRole`, `requirePermissions`, any session/claims logic.

---

## Task 3: `QueueMessageSchema` gains `workflowRunId`

**Depends on:** none
**Files:**
- Modify: `packages/database/src/event.ts` — one schema field

**Steps:**
1. In `QueueMessageSchema` (lines 47–55), after the `actorId` line, add:

```ts
  workflowRunId: z.string().nullish(), // Set when the write was made by a running workflow (workflow_run_id JWT claim)
```

`QueueMessage` is `z.infer` of this schema, so the type updates automatically. Older in-flight queue messages lack the key entirely; `.nullish()` accepts that.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** `HandlerTypeSchema` (no new handler type), `EventSchema`, the subscription CRUD helpers.

---

## Task 4: `@carbon/lib` — Events entries, `trigger` options, `raiseMoment` mints `momentId`

**Depends on:** none
**Files:**
- Modify: `packages/lib/src/events.ts` — reshape `carbon/event-workflow`, add `carbon/workflow-run.queued`, add `momentId` to `carbon/workflow-moment.raised`
- Modify: `packages/lib/src/trigger.ts` — `"workflow-run"` mapping + optional `id` on `trigger()`
- Modify: `packages/lib/src/workflows/raise-moment.ts` — mint `momentId` with nanoid
- Modify: `packages/lib/package.json` — add `"nanoid": "catalog:"` to `dependencies` (verified missing; `@carbon/jobs` already uses `"nanoid": "catalog:"` so the catalog entry exists)

**Steps:**
1. In `packages/lib/src/events.ts`, replace the `carbon/event-workflow` entry (lines 359–370) with:

```ts
  "carbon/event-workflow": {
    data: {
      msgId: number;
      companyId: string;
      actorId: string | null;
      workflowRunId: string | null;
      data: {
        table: string;
        recordId: string;
        operation: "INSERT" | "UPDATE" | "DELETE";
        [key: string]: unknown;
      };
    };
  };
```

2. In the same file, extend `carbon/workflow-moment.raised` (lines 570–579) with a `momentId` field as the first data property:

```ts
  // Workflow moments — raised after a business action commits. Phase 3 consumes.
  "carbon/workflow-moment.raised": {
    data: {
      /** Minted by raiseMoment (nanoid); also set as the Inngest event id. */
      momentId: string;
      moment: string;
      companyId: string;
      /** auth.uid() of the actor; null for service-role / background writes. */
      actorId: string | null;
      /** Output name -> entity id, per the moment's declaration. */
      outputs: Record<string, { id: string }>;
    };
  };
```

3. In the same file, immediately before the `carbon/workflow-moment.raised` entry, add the queued-run event:

```ts
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
      trigger:
        | {
            kind: "record";
            table: string;
            recordId: string;
            operation: "INSERT" | "UPDATE" | "DELETE";
            record: Record<string, unknown> | null;
            before: Record<string, unknown> | null;
            after: Record<string, unknown> | null;
          }
        | {
            kind: "moment";
            moment: string;
            outputs: Record<string, { id: string }>;
          };
    };
  };
```

4. In `packages/lib/src/trigger.ts`: add `"workflow-run": "carbon/workflow-run.queued"` to `taskToEvent` (keep it adjacent to the existing `"workflow-moment"` entry), and give `trigger()` an optional third argument:

```ts
export async function trigger<T extends keyof TaskPayloads>(
  taskId: T,
  payload: TaskPayloads[T],
  options?: { id?: string }
) {
  const eventName = taskToEvent[taskId];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return inngest.send({
    data: payload,
    name: eventName,
    ...(options?.id ? { id: options.id } : {})
  } as any);
}
```

`batchTrigger` is unchanged.

5. Rewrite the body of `raiseMoment` in `packages/lib/src/workflows/raise-moment.ts` (signature and doc comment unchanged — raise sites are untouched):

```ts
import { getLogger } from "@carbon/logger";
import type { MomentKey, MomentPayload } from "@carbon/workflows";
import { nanoid } from "nanoid";
import { trigger } from "../trigger";
```

and inside the function:

```ts
  // Sender-set idempotency: the same id is the payload field, the matcher's
  // sourceEventId (`moment:<id>`), and the Inngest event id, so a double send
  // is suppressed upstream and deduped downstream.
  const momentId = nanoid();
  try {
    await trigger(
      "workflow-moment",
      { momentId, moment: key, ...payload },
      { id: momentId }
    );
  } catch (err) {
    log.error("Failed to raise workflow moment", { moment: key, momentId, err });
  }
```

6. Add `"nanoid": "catalog:"` to `packages/lib/package.json` `dependencies` (alphabetical position), then `pnpm install`.

**Verify:**
```bash
pnpm install
pnpm exec turbo run typecheck --filter=@carbon/lib
# Expected: exit 0
```

**Out of scope:** every other `Events` entry; the nine `raiseMoment` call sites in `apps/erp` / `apps/mes` (their signature did not change); `packages/jobs/src/events.ts` (a pure re-export, needs nothing).

---

## Task 5: Reconciler in `@carbon/workflows` + unit tests

**Depends on:** none
**Files:**
- Create: `packages/workflows/src/sync.ts`
- Create: `packages/workflows/src/sync.test.ts`
- Modify: `packages/workflows/src/index.ts` — export the four new symbols
- Modify: `packages/workflows/package.json` — add `"kysely": "catalog:"` to `devDependencies` (type-only imports; no runtime dependency added)
- Copy from (precedent): `packages/database/src/audit.ts:440-478` (`syncAuditSubscriptions`, the reconcile precedent this deliberately departs from — see spec §D), `packages/workflows/src/catalog/build.test.ts` (test style)

**Steps:**
1. Create `packages/workflows/src/sync.ts`. Type-only Kysely imports keep `@carbon/database` a devDependency (types only) exactly as the package already does elsewhere:

```ts
import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely, Transaction } from "kysely";
import { z } from "zod";
import { WORKFLOW_EVENTS } from "./catalog";
import { nodeSchema, type Origin } from "./definition/schema";

/** One desired workflowTriggerEvent row, before ids/defaults. */
export type DesiredTriggerRow = { eventId: string; origin: Origin };

/** One desired company-level WORKFLOW subscription. */
export type DesiredSubscription = {
  table: string;
  operations: ("INSERT" | "UPDATE" | "DELETE")[];
};

const nodesSchema = z.array(nodeSchema);

/**
 * Derive the workflowTriggerEvent rows a promoted version wants: one row per
 * event id on each trigger node, carrying that node's origin. Duplicate event
 * ids across trigger nodes keep the first node's origin (the table is unique
 * on (workflowId, companyId, eventId)).
 */
export function deriveWorkflowTriggerRows(nodes: unknown): DesiredTriggerRow[] {
  const parsed = nodesSchema.safeParse(nodes);
  if (!parsed.success) {
    throw new Error(`workflowVersion nodes failed to parse: ${parsed.error.message}`);
  }
  const rows = new Map<string, DesiredTriggerRow>();
  for (const node of parsed.data) {
    if (node.type !== "trigger") continue;
    for (const eventId of node.data.events) {
      if (!rows.has(eventId)) {
        rows.set(eventId, { eventId, origin: node.data.origin });
      }
    }
  }
  return [...rows.values()];
}

/**
 * Derive the company's WORKFLOW subscriptions from its subscribed event ids,
 * resolved through each event's catalog match block: one `workflow-<table>`
 * subscription per distinct table, operations set to exactly what those
 * events need. Moments resolve to no table and contribute nothing.
 */
export function deriveWorkflowSubscriptions(
  eventIds: string[]
): DesiredSubscription[] {
  const byTable = new Map<string, Set<"INSERT" | "UPDATE" | "DELETE">>();
  for (const eventId of eventIds) {
    const match = WORKFLOW_EVENTS[eventId]?.match;
    if (!match || !("table" in match)) continue;
    const ops = byTable.get(match.table) ?? new Set();
    ops.add(match.operation);
    byTable.set(match.table, ops);
  }
  return [...byTable.entries()]
    .map(([table, ops]) => ({ table, operations: [...ops].sort() }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

function sameOperations(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((op, i) => op === [...b].sort()[i]);
}

/**
 * Reconcile the company's `workflow-<table>` eventSystemSubscription rows to
 * what its workflowTriggerEvent rows require. Runs inside the caller's
 * transaction. Removal is by exact (companyId, name, table); a row with the
 * wrong operations is deleted and re-inserted (the table is written
 * delete-then-insert by design — see the foundation migration's RLS comment).
 */
async function reconcileWorkflowSubscriptions(
  trx: Transaction<KyselyDatabase>,
  companyId: string
): Promise<{ tables: string[] }> {
  const triggerRows = await trx
    .selectFrom("workflowTriggerEvent")
    .select("eventId")
    .where("companyId", "=", companyId)
    .execute();

  const desired = deriveWorkflowSubscriptions(triggerRows.map((r) => r.eventId));
  const desiredByName = new Map(desired.map((d) => [`workflow-${d.table}`, d]));

  const existing = await trx
    .selectFrom("eventSystemSubscription")
    .select(["name", "table", "operations"])
    .where("companyId", "=", companyId)
    .where("handlerType", "=", "WORKFLOW")
    .execute();

  for (const sub of existing) {
    const want = desiredByName.get(sub.name);
    if (
      want &&
      want.table === sub.table &&
      sameOperations(sub.operations ?? [], want.operations)
    ) {
      desiredByName.delete(sub.name);
      continue;
    }
    await trx
      .deleteFrom("eventSystemSubscription")
      .where("companyId", "=", companyId)
      .where("name", "=", sub.name)
      .where("table", "=", sub.table)
      .execute();
  }

  for (const [name, d] of desiredByName) {
    await trx
      .insertInto("eventSystemSubscription")
      .values({
        name,
        table: d.table,
        companyId,
        operations: d.operations,
        handlerType: "WORKFLOW",
        config: {},
        filter: {},
        active: true
      })
      .execute();
  }

  return { tables: desired.map((d) => d.table) };
}

/**
 * Rewrite one workflow's workflowTriggerEvent rows and reconcile the
 * company's WORKFLOW subscriptions, in one transaction. Kysely bypasses RLS:
 * the caller authorizes first (phase 7's activation route gates on
 * workflows_update before calling).
 */
export async function syncWorkflowTriggers(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  workflowId: string
): Promise<{ eventIds: string[]; tables: string[] }> {
  return db.transaction().execute(async (trx) => {
    const workflow = await trx
      .selectFrom("workflow")
      .select(["active", "activeVersionId"])
      .where("id", "=", workflowId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    let versionId: string | null = null;
    let desired: DesiredTriggerRow[] = [];
    if (workflow?.active && workflow.activeVersionId) {
      const version = await trx
        .selectFrom("workflowVersion")
        .select(["id", "nodes"])
        .where("id", "=", workflow.activeVersionId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (version) {
        versionId = version.id;
        desired = deriveWorkflowTriggerRows(version.nodes);
      }
    }

    await trx
      .deleteFrom("workflowTriggerEvent")
      .where("workflowId", "=", workflowId)
      .where("companyId", "=", companyId)
      .execute();

    if (versionId && desired.length > 0) {
      await trx
        .insertInto("workflowTriggerEvent")
        .values(
          desired.map((d) => ({
            companyId,
            workflowId,
            workflowVersionId: versionId as string,
            eventId: d.eventId,
            origin: d.origin
          }))
        )
        .execute();
    }

    const { tables } = await reconcileWorkflowSubscriptions(trx, companyId);
    return { eventIds: desired.map((d) => d.eventId), tables };
  });
}

/**
 * Standalone repair entry: reconcile a company's WORKFLOW subscriptions from
 * its current workflowTriggerEvent rows without touching any workflow.
 */
export async function syncWorkflowSubscriptions(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<{ tables: string[] }> {
  return db.transaction().execute(async (trx) =>
    reconcileWorkflowSubscriptions(trx, companyId)
  );
}
```

If the Kysely column types reject `config: {}` / `filter: {}` (JSONB typing), STOP and report rather than importing the runtime `sql` tag — a runtime kysely import would change the package's dependency story.

2. Add to `packages/workflows/src/index.ts` (alphabetical among the export blocks):

```ts
export type { DesiredSubscription, DesiredTriggerRow } from "./sync";
export {
  deriveWorkflowSubscriptions,
  deriveWorkflowTriggerRows,
  syncWorkflowSubscriptions,
  syncWorkflowTriggers
} from "./sync";
```

3. Add `"kysely": "catalog:"` to `packages/workflows/package.json` `devDependencies`; `pnpm install`.
4. Create `packages/workflows/src/sync.test.ts` covering acceptance criterion 8's pure half (the transactional half is Task 11):
   - One trigger node (`type: "trigger"`, `data: { events: ["purchaseOrder.status.changed", "purchaseOrder.supplierId.changed"], origin: "Person" }`, plus required `id`/`position`) → `deriveWorkflowTriggerRows` returns exactly two rows, both `origin: "Person"`. First check `"purchaseOrder.supplierId.changed" in WORKFLOW_EVENTS` (it should exist; if not, substitute any second `purchaseOrder.*.changed` id from `packages/workflows/src/catalog/events.generated.ts`).
   - `deriveWorkflowSubscriptions(["purchaseOrder.status.changed"])` → `[{ table: "purchaseOrder", operations: ["UPDATE"] }]`.
   - `deriveWorkflowSubscriptions(["purchaseOrder.status.changed", "purchaseOrder.created"])` → operations `["INSERT", "UPDATE"]` for the one table.
   - A moment id (`"production.jobReleased"`) contributes no subscription.
   - Non-trigger nodes are ignored; malformed nodes throw.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: sync.test.ts passes alongside the existing build.test.ts
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: exit 0
```

**Out of scope:** `packages/database/src/workflow.ts` is NOT created and `@carbon/database/package.json` gains NO `./workflow` export (superseded by this task — the one plan-time deviation, see header). The catalog generator, `entities.ts`, `moments.ts`, and both `*.generated.ts` files are untouched.

---

## Task 6: Matcher core in `@carbon/jobs`

**Depends on:** Task 3
**Files:**
- Create: `packages/jobs/src/workflows/db.ts`
- Create: `packages/jobs/src/workflows/types.ts`
- Create: `packages/jobs/src/workflows/event-ids.ts`
- Create: `packages/jobs/src/workflows/matcher.ts`
- Copy from (precedent): `packages/jobs/src/inngest/functions/events/queue.ts:24-30` (the Kysely client helper), `packages/jobs/src/inngest/functions/events/diff.ts` (the "pure, no Inngest/auth imports, unit-testable" pattern)

**Steps:**
1. `db.ts` — the same helper `queue.ts` keeps module-locally:

```ts
import {
  getPostgresClient,
  getPostgresConnectionPool,
  type KyselyDatabase
} from "@carbon/database/client";
import { type Kysely, PostgresDriver } from "kysely";

export const getWorkflowsDatabaseClient = (): Kysely<KyselyDatabase> => {
  const pool = getPostgresConnectionPool(1);
  return getPostgresClient(
    pool,
    PostgresDriver
  ) as unknown as Kysely<KyselyDatabase>;
};
```

2. `types.ts`:

```ts
import type { Origin } from "@carbon/workflows";

/** A workflowTriggerEvent row joined to its workflow's owner. */
export type Subscriber = {
  workflowId: string;
  workflowVersionId: string;
  eventId: string;
  origin: Origin;
  ownerId: string;
};

/** The causing run, read when the announcement carries a workflowRunId. */
export type CausingRun = {
  id: string;
  workflowId: string;
  rootRunId: string | null;
  depth: number;
  path: string[];
};

/** The chain-tracking columns for the run(s) this announcement creates. */
export type RunTrace = {
  rootRunId: string | null;
  causedByRunId: string | null;
  depth: number;
  path: string[];
};

/** The trigger payload carried on carbon/workflow-run.queued. */
export type TriggerPayload =
  | {
      kind: "record";
      table: string;
      recordId: string;
      operation: "INSERT" | "UPDATE" | "DELETE";
      record: Record<string, unknown> | null;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }
  | {
      kind: "moment";
      moment: string;
      outputs: Record<string, { id: string }>;
    };

export type MatchInput = {
  companyId: string;
  workflowRunId: string | null;
  sourceEventId: string;
  eventIds: string[];
  trigger: TriggerPayload;
  triggerTable: string | null;
  triggerRecordId: string | null;
};
```

3. `event-ids.ts` — pure; imports only the catalog and `computeDiff`:

```ts
import { WORKFLOW_EVENTS } from "@carbon/workflows";
import { computeDiff } from "../inngest/functions/events/diff";

type TableIndex = {
  created?: string;
  deleted?: string;
  /** field -> event id, in catalog (insertion) order. */
  changed: Map<string, string>;
};

// Built once from the catalog's match blocks. Moments carry no table and are
// looked up directly by id in the moment entry point.
const INDEX: Map<string, TableIndex> = (() => {
  const index = new Map<string, TableIndex>();
  for (const [id, event] of Object.entries(WORKFLOW_EVENTS)) {
    const match = event.match;
    if (!match || !("table" in match)) continue;
    let entry = index.get(match.table);
    if (!entry) {
      entry = { changed: new Map() };
      index.set(match.table, entry);
    }
    if (match.operation === "INSERT") entry.created = id;
    else if (match.operation === "DELETE") entry.deleted = id;
    else if (match.field) entry.changed.set(match.field, id);
  }
  return index;
})();

/**
 * One announcement -> the catalog event ids it raises. UPDATEs go through
 * computeDiff (skip-fields, empty-to-empty, rich text), so an update touching
 * no watched column produces [] and the matcher writes nothing at all.
 */
export function computeEventIds(input: {
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
}): string[] {
  const entry = INDEX.get(input.table);
  if (!entry) return [];

  if (input.operation === "INSERT") {
    return entry.created ? [entry.created] : [];
  }
  if (input.operation === "DELETE") {
    return entry.deleted ? [entry.deleted] : [];
  }

  if (!input.old || !input.new || entry.changed.size === 0) return [];
  const diff = computeDiff(input.old, input.new);
  if (!diff) return [];

  const ids: string[] = [];
  for (const [field, id] of entry.changed) {
    if (field in diff) ids.push(id);
  }
  return ids;
}
```

4. `matcher.ts` — pure planning functions plus the one orchestrator that touches the database:

```ts
import type { KyselyDatabase } from "@carbon/database/client";
import { MAX_CHAIN_DEPTH } from "@carbon/workflows";
import type { Kysely } from "kysely";
import type {
  CausingRun,
  MatchInput,
  RunTrace,
  Subscriber
} from "./types";

const FRESH_TRACE: RunTrace = {
  rootRunId: null,
  causedByRunId: null,
  depth: 0,
  path: []
};

/** Person / Automation / Both, decided purely by the presence of the run tag. */
export function filterByOrigin(
  subscribers: Subscriber[],
  workflowRunId: string | null
): Subscriber[] {
  const origin = workflowRunId ? "Automation" : "Person";
  return subscribers.filter((s) => s.origin === "Both" || s.origin === origin);
}

/** The next hop's chain-tracking columns, derived from the causing run. */
export function deriveNextTrace(causing: CausingRun): RunTrace {
  return {
    rootRunId: causing.rootRunId ?? causing.id,
    causedByRunId: causing.id,
    depth: causing.depth + 1,
    path: [...causing.path, causing.workflowId]
  };
}

/** Cycle and depth checks, evaluated before any run is created. */
export function evaluateLoopGuard(
  workflowId: string,
  trace: RunTrace
): { blocked: false } | { blocked: true; reason: string } {
  if (trace.path.includes(workflowId)) {
    return {
      blocked: true,
      reason: "Cycle: this workflow already ran in this chain"
    };
  }
  if (trace.depth >= MAX_CHAIN_DEPTH) {
    return {
      blocked: true,
      reason: `Chain depth limit reached (${MAX_CHAIN_DEPTH} hops)`
    };
  }
  return { blocked: false };
}

export type PlannedRun = {
  subscriber: Subscriber;
  status: "Queued" | "Blocked";
  statusReason: string | null;
  trace: RunTrace;
};

/**
 * Pure planning: dedupe to one run per workflow (first matching event id in
 * catalog order wins — the dedupe key would collapse them anyway), apply the
 * origin filter, then the loop guards. A blocked firing is planned as a
 * Blocked run, never dropped.
 */
export function planRuns(input: {
  subscribers: Subscriber[];
  eventIds: string[];
  workflowRunId: string | null;
  causingRun: CausingRun | null;
}): PlannedRun[] {
  const byWorkflow = new Map<string, Subscriber>();
  for (const eventId of input.eventIds) {
    for (const s of input.subscribers) {
      if (s.eventId === eventId && !byWorkflow.has(s.workflowId)) {
        byWorkflow.set(s.workflowId, s);
      }
    }
  }

  const survivors = filterByOrigin(
    [...byWorkflow.values()],
    input.workflowRunId
  );
  const trace = input.causingRun
    ? deriveNextTrace(input.causingRun)
    : FRESH_TRACE;

  return survivors.map((subscriber) => {
    const guard = evaluateLoopGuard(subscriber.workflowId, trace);
    return guard.blocked
      ? { subscriber, status: "Blocked", statusReason: guard.reason, trace }
      : { subscriber, status: "Queued", statusReason: null, trace };
  });
}

export type QueuedRunEvent = {
  name: "carbon/workflow-run.queued";
  id: string;
  data: {
    runId: string;
    companyId: string;
    workflowId: string;
    workflowVersionId: string;
    eventId: string;
    ownerId: string;
    sourceEventId: string;
    trigger: MatchInput["trigger"];
  };
};

export type MatchResult = {
  events: QueuedRunEvent[];
  queued: number;
  blocked: number;
  deduped: number;
};

/**
 * The matcher: subscribers -> origin filter -> loop guards -> one workflowRun
 * row per surviving workflow -> one queued event per row actually inserted.
 * A conflict on workflowRun_dedupe_key means this announcement was already
 * handled; nothing is sent for it.
 */
export async function matchAndQueue(
  db: Kysely<KyselyDatabase>,
  input: MatchInput
): Promise<MatchResult> {
  const subscribers = (await db
    .selectFrom("workflowTriggerEvent as te")
    .innerJoin("workflow as w", (join) =>
      join
        .onRef("w.id", "=", "te.workflowId")
        .onRef("w.companyId", "=", "te.companyId")
    )
    .select([
      "te.workflowId",
      "te.workflowVersionId",
      "te.eventId",
      "te.origin",
      "w.ownerId"
    ])
    .where("te.companyId", "=", input.companyId)
    .where("te.eventId", "in", input.eventIds)
    .execute()) as Subscriber[];

  if (subscribers.length === 0) {
    return { events: [], queued: 0, blocked: 0, deduped: 0 };
  }

  let causingRun: CausingRun | null = null;
  if (input.workflowRunId) {
    const row = await db
      .selectFrom("workflowRun")
      .select(["id", "workflowId", "rootRunId", "depth", "path"])
      .where("id", "=", input.workflowRunId)
      .where("companyId", "=", input.companyId)
      .executeTakeFirst();
    // A purged/missing causing run: keep the chain countable (depth 1) even
    // though its path is unknowable.
    causingRun = row ?? {
      id: input.workflowRunId,
      workflowId: "",
      rootRunId: input.workflowRunId,
      depth: 0,
      path: []
    };
  }

  const planned = planRuns({
    subscribers,
    eventIds: input.eventIds,
    workflowRunId: input.workflowRunId,
    causingRun
  });

  const result: MatchResult = { events: [], queued: 0, blocked: 0, deduped: 0 };

  for (const plan of planned) {
    const inserted = await db
      .insertInto("workflowRun")
      .values({
        companyId: input.companyId,
        workflowId: plan.subscriber.workflowId,
        workflowVersionId: plan.subscriber.workflowVersionId,
        eventId: plan.subscriber.eventId,
        sourceEventId: input.sourceEventId,
        triggerTable: input.triggerTable,
        triggerRecordId: input.triggerRecordId,
        ownerId: plan.subscriber.ownerId,
        status: plan.status,
        statusReason: plan.statusReason,
        rootRunId: plan.trace.rootRunId,
        causedByRunId: plan.trace.causedByRunId,
        depth: plan.trace.depth,
        path: plan.trace.path
      })
      .onConflict((oc) => oc.constraint("workflowRun_dedupe_key").doNothing())
      .returning("id")
      .executeTakeFirst();

    if (!inserted) {
      result.deduped += 1;
      continue;
    }
    if (plan.status === "Blocked") {
      result.blocked += 1;
      continue;
    }
    result.queued += 1;
    result.events.push({
      name: "carbon/workflow-run.queued",
      id: `${plan.subscriber.workflowId}:${plan.subscriber.workflowVersionId}:${input.sourceEventId}`,
      data: {
        runId: inserted.id,
        companyId: input.companyId,
        workflowId: plan.subscriber.workflowId,
        workflowVersionId: plan.subscriber.workflowVersionId,
        eventId: plan.subscriber.eventId,
        ownerId: plan.subscriber.ownerId,
        sourceEventId: input.sourceEventId,
        trigger: input.trigger
      }
    });
  }

  return result;
}
```

If Kysely's generated types make any of these queries fail typecheck (e.g. `path` array typing or the `origin` string narrowing needing a cast), prefer a localized `as` cast with a one-line comment over restructuring; if TS2589 ("excessively deep") appears, STOP and report per the known instantiation-budget lesson.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** no Inngest function changes yet (Task 8); `diff.ts` itself is untouched.

---

## Task 7: Matcher unit tests (acceptance criteria 1–7)

**Depends on:** Task 6
**Files:**
- Create: `packages/jobs/src/workflows/event-ids.test.ts`
- Create: `packages/jobs/src/workflows/matcher.test.ts`
- Copy from (precedent): `packages/jobs/src/inngest/functions/events/diff.test.ts` (import style: `import { describe, expect, it } from "vitest";` + relative import)

**Steps:**
1. `event-ids.test.ts` — before writing assertions, open `packages/workflows/src/catalog/events.generated.ts` and confirm `"purchaseOrder.created"`, `"purchaseOrder.status.changed"`, and `"purchaseOrder.supplierId.changed"` all exist (substitute another watched `purchaseOrder` column if `supplierId` is not watched; if `purchaseOrder` has fewer than two watched columns, STOP and report). Rows in tests must include realistic keys (`id`, `companyId`, plus the changed fields). Cover:
   - INSERT on `purchaseOrder` → exactly `["purchaseOrder.created"]` (criterion 1).
   - UPDATE where only `notes` differs → `[]`; UPDATE where `status` and `supplierId` both differ → exactly the two `.changed` ids in catalog order (criterion 2). Determine catalog order from the generated file and assert that exact array.
   - UPDATE where only `updatedAt` and `updatedBy` differ → `[]` (criterion 3 — `computeDiff` returns null on skip-fields-only).
   - Any operation on table `"notARealTable"` → `[]` (criterion 4).
   - DELETE on `purchaseOrder` → `["purchaseOrder.deleted"]` if that id exists in the catalog (check the file; drop this assertion if it does not).
2. `matcher.test.ts` — pure functions only, no database. Use a helper `sub(overrides)` returning a `Subscriber`. Cover:
   - `filterByOrigin` with subscribers of origin `Person` / `Automation` / `Both`: `workflowRunId: null` keeps `Person` + `Both`; `workflowRunId: "wfr_x"` keeps `Automation` + `Both` (criterion 5).
   - `deriveNextTrace({ id: "wfr_a", workflowId: "wf_1", rootRunId: null, depth: 0, path: [] })` → `{ rootRunId: "wfr_a", causedByRunId: "wfr_a", depth: 1, path: ["wf_1"] }` (criterion 7).
   - `planRuns` with a causing run `path: ["wf_1", "wf_7"]` and a subscriber for `wf_7` (origin `Both`) → one plan with `status: "Blocked"` and `statusReason` containing `"Cycle"` (criterion 6a).
   - `planRuns` with causing run `depth: 9` and an unrelated subscriber → `status: "Blocked"`, trace `depth: 10`, reason containing `"depth limit"`... assert the exact string `"Chain depth limit reached (10 hops)"` (criterion 6b).
   - `planRuns` with causing run `depth: 8` → `status: "Queued"` at `depth: 9` (criterion 6c).
   - `planRuns` with two subscribers for the same `workflowId` on two event ids → one plan, keeping the first event id in `eventIds` order (the dedupe rule).
   - `planRuns` with `causingRun: null` → trace is `{ rootRunId: null, causedByRunId: null, depth: 0, path: [] }` and nothing blocks.

**Verify:**
```bash
pnpm --filter @carbon/jobs test
# Expected: event-ids.test.ts + matcher.test.ts pass alongside the 3 existing test files
```

**Out of scope:** no test touches a database or Inngest; `matchAndQueue` itself is covered by Task 11.

---

## Task 8: Inngest entry points, queue dispatch branch, registration

**Depends on:** Tasks 3, 4, 6
**Files:**
- Modify: `packages/jobs/src/inngest/functions/events/workflow.ts` — stub → record-change entry point
- Create: `packages/jobs/src/inngest/functions/workflows/moment.ts`
- Create: `packages/jobs/src/inngest/functions/workflows/run.ts`
- Create: `packages/jobs/src/inngest/functions/workflows/index.ts`
- Modify: `packages/jobs/src/inngest/functions/events/queue.ts` — the WORKFLOW dispatch branch (lines 124–138)
- Modify: `packages/jobs/src/inngest/index.ts` — register the two new functions
- Copy from (precedent): `packages/jobs/src/inngest/functions/events/webhook.ts` (per-row handler shape)

**Steps:**
1. Replace the whole of `events/workflow.ts` with:

```ts
import { EventSchema } from "@carbon/database/event";
import { z } from "zod";
import { inngest } from "../../client";
import { getWorkflowsDatabaseClient } from "../../../workflows/db";
import { computeEventIds } from "../../../workflows/event-ids";
import { matchAndQueue } from "../../../workflows/matcher";

const workflowPayloadSchema = z.object({
  msgId: z.number(),
  companyId: z.string(),
  actorId: z.string().nullish(),
  workflowRunId: z.string().nullish(),
  data: EventSchema
});

export type WorkflowPayload = z.infer<typeof workflowPayloadSchema>;

/**
 * Record-change entry point of the workflow matcher: one pgmq announcement ->
 * catalog event ids -> subscribed workflows -> one Queued workflowRun (and
 * one carbon/workflow-run.queued event) per workflow. Blocked firings are
 * written as Blocked runs and not queued.
 */
export const workflowFunction = inngest.createFunction(
  {
    id: "event-handler-workflow",
    retries: 3,
    idempotency: "event.data.msgId",
    concurrency: {
      limit: 10,
      key: "event.data.companyId"
    }
  },
  { event: "carbon/event-workflow" },
  async ({ event, step }) => {
    const payload = workflowPayloadSchema.parse(event.data);
    if (payload.data.operation === "TRUNCATE") {
      return { queued: 0, blocked: 0 };
    }

    const eventIds = computeEventIds({
      table: payload.data.table,
      operation: payload.data.operation,
      old: payload.data.old,
      new: payload.data.new
    });
    if (eventIds.length === 0) {
      return { queued: 0, blocked: 0 };
    }

    const { operation } = payload.data;
    const result = await step.run("match", async () => {
      const db = getWorkflowsDatabaseClient();
      return matchAndQueue(db, {
        companyId: payload.companyId,
        workflowRunId: payload.workflowRunId ?? null,
        sourceEventId: `pgmq:${payload.msgId}`,
        eventIds,
        trigger: {
          kind: "record",
          table: payload.data.table,
          recordId: payload.data.recordId,
          operation,
          record: payload.data.new ?? payload.data.old,
          before: operation === "UPDATE" ? payload.data.old : null,
          after: operation === "UPDATE" ? payload.data.new : null
        },
        triggerTable: payload.data.table,
        triggerRecordId: payload.data.recordId
      });
    });

    if (result.events.length > 0) {
      await step.sendEvent("queue-runs", result.events);
    }
    return { queued: result.queued, blocked: result.blocked };
  }
);
```

If TS narrows `payload.data` awkwardly across the union (old/new nullability per operation), destructure inside each branch or add a small local cast — the runtime values are guaranteed by `EventSchema`.

2. Create `workflows/moment.ts`:

```ts
import { WORKFLOW_EVENTS } from "@carbon/workflows";
import { z } from "zod";
import { inngest } from "../../client";
import { getWorkflowsDatabaseClient } from "../../../workflows/db";
import { matchAndQueue } from "../../../workflows/matcher";

const momentPayloadSchema = z.object({
  momentId: z.string(),
  moment: z.string(),
  companyId: z.string(),
  actorId: z.string().nullable(),
  outputs: z.record(z.object({ id: z.string() }).passthrough())
});

/**
 * Moment entry point of the workflow matcher. A moment already IS a catalog
 * event id; a moment is always Person-origin for the filter (no workflow run
 * tag travels with it — a workflow action cannot raise one in this phase).
 */
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
      const db = getWorkflowsDatabaseClient();
      return matchAndQueue(db, {
        companyId: payload.companyId,
        workflowRunId: null,
        sourceEventId: `moment:${payload.momentId}`,
        eventIds: [payload.moment],
        trigger: {
          kind: "moment",
          moment: payload.moment,
          outputs: payload.outputs
        },
        triggerTable: null,
        triggerRecordId: null
      });
    });

    if (result.events.length > 0) {
      await step.sendEvent("queue-runs", result.events);
    }
    return { queued: result.queued, blocked: result.blocked };
  }
);
```

3. Create `workflows/run.ts` — the stub consumer. Deliberately NO concurrency config (phase 4 adds the real per-company and per-workflow keys):

```ts
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
  trigger: z.union([
    z.object({
      kind: z.literal("record"),
      table: z.string(),
      recordId: z.string(),
      operation: z.enum(["INSERT", "UPDATE", "DELETE"]),
      record: z.record(z.unknown()).nullable(),
      before: z.record(z.unknown()).nullable(),
      after: z.record(z.unknown()).nullable()
    }),
    z.object({
      kind: z.literal("moment"),
      moment: z.string(),
      outputs: z.record(z.object({ id: z.string() }).passthrough())
    })
  ])
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

4. Create `workflows/index.ts`:

```ts
export { workflowMomentFunction } from "./moment";
export { workflowRunFunction } from "./run";
```

5. In `queue.ts`, replace the WORKFLOW dispatch branch (the `grouped.WORKFLOW.map` body, lines 125–132) so it forwards what the matcher needs instead of the never-again-set `handlerConfig.workflowId`:

```ts
      // 4. Dispatch workflows
      if (grouped.WORKFLOW.length > 0) {
        const events = grouped.WORKFLOW.map((job) => ({
          name: "carbon/event-workflow" as const,
          data: {
            msgId: job.msg_id,
            companyId: job.message.companyId,
            actorId: job.message.actorId ?? null,
            workflowRunId: job.message.workflowRunId ?? null,
            data: job.message.event
          }
        }));

        const chunks = chunk(events, CHUNK_SIZE);
        for (let i = 0; i < chunks.length; i++) {
          await step.sendEvent(`dispatch-workflows-${pass}-${i}`, chunks[i]!);
        }
      }
```

6. In `packages/jobs/src/inngest/index.ts`: add `import { workflowMomentFunction, workflowRunFunction } from "./functions/workflows";` next to the events import block, and add both to the `functions` array directly after `workflowFunction` under the `// Event handlers` group with a `// Workflows (matcher + stub consumer)` comment line.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
pnpm --filter @carbon/jobs test
# Expected: all tests still pass
```

**Out of scope:** every other dispatch branch in `queue.ts` (WEBHOOK/SYNC/SEARCH/AUDIT/EMBEDDING), `CHUNK_SIZE`, the delete-processed step, `webhook.ts` (its `limit: 0` oddity is pre-existing and NOT fixed here — only `workflow.ts`'s was in scope).

---

## Task 9: Full validation sweep

**Depends on:** Tasks 1–8
**Files:** none (verification only)

**Steps / Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/database --filter=@carbon/auth --filter=@carbon/lib --filter=@carbon/workflows
# Expected: exit 0 for all five
pnpm exec biome check
# Expected: no NEW error-severity findings (the ~419 pre-existing warnings are not yours to fix)
pnpm --filter @carbon/jobs test && pnpm --filter @carbon/workflows test
# Expected: all pass
pnpm run check:workflow-catalog
# Expected: passes (the catalog itself was not regenerated)
```

If a typecheck fails inside turbo, re-run the failing package's typecheck directly (`pnpm --filter <pkg> typecheck`) to rule out stale turbo cache before diagnosing (known lesson).

**Out of scope:** whole-repo typecheck (OOMs), `pnpm run test` at the root (runs every package; the two scoped runs cover this change), `lingui:extract` (no translatable string changed; it dumps ~120k lines of churn on this branch).

---

## Task 10: Docs, rules, and spec changelog sync

**Depends on:** Tasks 1–8
**Files:**
- Create: `.claude/rules/workflow-matcher.md`
- Modify: `.ai/specs/2026-07-30-workflows-matcher.md` — changelog + affected sections
- Modify: `packages/workflows/AGENTS.md`, `packages/jobs/AGENTS.md`, `.claude/rules/event-system.md`, `.claude/rules/workflow-event-system.md`, `.claude/rules/workflow-event-catalog.md`

**Steps:**
1. New rule `.claude/rules/workflow-matcher.md` with frontmatter `paths: ["packages/jobs/src/workflows/**", "packages/jobs/src/inngest/functions/workflows/**", "packages/workflows/src/sync.ts"]`. Content (ground every claim in the committed code): the announcement→event-ids→subscribers→origin→loop-guards→run-row pipeline; the two entry points over one `matchAndQueue` core; `sourceEventId` forms (`pgmq:<msgId>`, `moment:<momentId>`, `schedule:<workflowId>:<dueAtIso>` reserved for phase 6); the dedupe key and the Inngest event id; the reconciler's home in `@carbon/workflows` (and why not `@carbon/database` — the turbo cycle); the act-as-owner constraint (a workflow action writes through the owner-scoped client or it is untagged and invisible to loop protection); the stub consumer being phase 4's replacement point.
2. Spec updates in `.ai/specs/2026-07-30-workflows-matcher.md`: set Status to `Implemented on feat/automation — pending e2e sign-off` (or `Implemented` if Task 11 ran), rewrite §D's file paths to `packages/workflows/src/sync.ts`, drop the `@carbon/database/workflow` export claim, and append a changelog line: reconciler moved to `@carbon/workflows` at plan time because a `@carbon/database → @carbon/workflows` dependency would cycle with the existing devDependency and Turborepo rejects package cycles; signatures unchanged.
3. `packages/workflows/AGENTS.md`: document `sync.ts` (the two sync functions + two derive helpers, the kysely type-only devDependency rule, "callers authorize first — Kysely bypasses RLS").
4. `packages/jobs/AGENTS.md`: in the Event System Handlers table change the WORKFLOW row purpose from "Workflow dispatch (stub)" to the matcher description, and add `carbon/workflow-moment.raised` → `workflow-moment` and `carbon/workflow-run.queued` → `workflow-run` (stub) rows.
5. `.claude/rules/event-system.md`: update the WORKFLOW handler row (remove the `<!-- UNVERIFIED: body is still a stub/no-op -->`), document the new dispatch payload (`msgId`, `companyId`, `actorId`, `workflowRunId`, `data`), the `workflowRunId` field on `QueueMessage` + where it comes from (JWT claim via the new migration), and the restored `pk_join` pairing.
6. `.claude/rules/workflow-event-system.md`: WORKFLOW row in the use-case table is no longer "(handler body is a stub — see below)"; note the per-row WORKFLOW dispatch shape now forwards `companyId`/`actorId`/`workflowRunId`.
7. `.claude/rules/workflow-event-catalog.md`: "**Nothing consumes it yet** — phase 3 adds the listener" is now false — the listener is `workflow-moment`; `raiseMoment` now mints `momentId` (nanoid) used as payload field + Inngest event id.

**Verify:**
```bash
grep -rn "stub" .claude/rules/event-system.md .claude/rules/workflow-event-system.md packages/jobs/AGENTS.md | grep -i workflow
# Expected: no line still claiming the WORKFLOW handler is a stub (the run *consumer* stub may be mentioned, correctly attributed to phase 4)
```

**Out of scope:** `docs/` (customer-facing docs — nothing user-visible shipped), `.ai/lessons.md` unless a genuine new pitfall was hit during execution.

---

## Task 11: End-to-end verification against the local stack (criteria 9–14)

**Depends on:** Tasks 1–9, and a running local stack (`pnpm dev` with the Inngest dev server on :8288)
**Files:** none persisted (a throwaway seed script is created and deleted)

**Escape hatch:** if the app on :3000 or the Inngest dev UI on :8288 is not reachable, STOP and report that e2e verification is pending the user starting the stack — do not start services yourself and do not rebuild the database.

**Steps:**
1. Preflight: `curl -sf http://localhost:8288 > /dev/null && curl -sf http://localhost:3000 > /dev/null` (ports may differ per worktree — read `PORT_DB` and app ports from `.env.local`). Get DB connection info from `.env.local` (`SUPABASE_DB_URL` or `127.0.0.1:$PORT_DB`).
2. **Criterion 9** — pick a real `companyId` and a purchase order id from the local DB. Confirm `SELECT * FROM "eventSystemSubscription" WHERE "companyId" = '<id>' AND "handlerType" = 'WORKFLOW';` returns zero rows. Update the PO's status via SQL as a smoke write; confirm no new pgmq message with `handlerType = 'WORKFLOW'` appears (`SELECT * FROM pgmq.metrics('event_system');` before/after, and the Inngest dashboard shows no `carbon/event-workflow`).
3. **Criterion 10 + criterion 8's transactional half** — write a throwaway `scripts/tmp-seed-workflow.ts` (delete afterwards) that, using the same env as the app: inserts a `workflow` (real `ownerId`/`createdBy` user id from the company), a `workflowVersion` whose `nodes` contain one trigger node `{ id: "t1", position: { x: 0, y: 0 }, type: "trigger", data: { events: ["purchaseOrder.status.changed"], origin: "Both" } }` and `edges: []`, sets `workflow.active = true` + `activeVersionId`, then calls `syncWorkflowTriggers(db, companyId, workflowId)` from `@carbon/workflows`. Run with `pnpm exec tsx scripts/tmp-seed-workflow.ts`. Confirm: one `workflowTriggerEvent` row (`origin 'Both'`, right eventId) and one `eventSystemSubscription` named `workflow-purchaseOrder` with `operations = {UPDATE}` and `handlerType = 'WORKFLOW'`.
4. Change that PO's status (SQL UPDATE). Within ~10s confirm: exactly one `workflowRun` row with `status = 'Queued'`, `eventId = 'purchaseOrder.status.changed'`, `sourceEventId ~ '^pgmq:\d+$'`, `depth = 0`, `path = '{}'`, `rootRunId IS NULL`; and in the Inngest dashboard one `event-handler-workflow` run and one `workflow-run` (stub) run that logged the run id.
5. **Criterion 11** — update only the PO's `notes` (or another unwatched column). Confirm no new `workflowRun` row.
6. **Criterion 12** — in the Inngest dev UI, replay the `carbon/event-workflow` event from step 4. Confirm the `workflowRun` count for that PO is unchanged and no second `workflow-run` run executed the stub for a new run id.
7. **Criterion 13** — seed a second workflow (same script pattern) with trigger events `["production.jobReleased"]`, then release a job through the app UI (or call the service path that funnels `updateJobStatus` to `Ready`). Confirm one `workflowRun` with `sourceEventId ~ '^moment:'`. If no job is conveniently releasable in the seed data, record this criterion as "verified pending user walkthrough" and say so in the final report rather than faking it.
8. Deactivate the first workflow (`UPDATE "workflow" SET "active" = false ...`), re-run `syncWorkflowTriggers`, confirm the trigger-event rows and the `workflow-purchaseOrder` subscription are gone (criterion 8's second half).
9. **Criterion 14** — `pnpm --filter @carbon/checks workflow-events` and run the `workflow-trigger-event-drift` invariant against the local DB. Expected: both pass.
10. Clean up: delete `scripts/tmp-seed-workflow.ts` and the seeded workflows/runs (`DELETE FROM "workflow" WHERE "id" IN (...)` — runs/versions/trigger events cascade; the `workflow-*` subscriptions are removed by the deactivation sync in step 8).

**Verify:** the SQL assertions and dashboard observations above, reported with actual output.

**Out of scope:** load testing the bulk-import fan-out; testing the JWT-claim path end to end (nothing mints a run-tagged token until phase 4 — the claim read is exercised only as "absent → null" here, which criteria 10–12 cover).
