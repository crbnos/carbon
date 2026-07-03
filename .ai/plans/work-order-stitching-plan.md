# Work Order Stitching — Implementation Plan (v2, fully grounded)

> **Executor:** Claude Opus 4.8
> **Design spec:** `.ai/specs/2026-07-02-work-order-stitching.md` (in-progress; all open questions resolved)
> **Research:** `.ai/scratch/research/work-order-stitching.md`
> **Tracking issue:** https://github.com/crbnos/carbon/issues/1010
> **Branch:** `feature/work-order-stitching`
>
> v2 note: every file below was read during planning (2026-07-02). Line numbers are
> anchors, not gospel — re-locate by the quoted code if they drifted. All former
> "ground-then-edit" unknowns are resolved; findings are inlined as **[VERIFIED]** notes.

## Executor ground rules

1. **Never rebuild the database.** `pnpm db:migrate` applies; if the local DB is unreachable, stop and tell the user.
2. **Commits:** conventional format, **no AI attribution** (no Co-Authored-By, no "Generated with").
3. **`pnpm --filter erp`** — the package name is `erp`, NOT `@carbon/erp` (wrong filter silently no-ops). MES is `mes`.
4. Verification commands close each phase. Run them; don't assert green without output.
5. Spec wins over plan; code wins over both — surface conflicts, don't improvise silently.

## Verified facts the design rests on (do not re-litigate)

- **[VERIFIED]** `sync_finish_job_operation` is a **BEFORE, FOR EACH ROW** Postgres trigger (`trg_event_sync_jobOperation` → `dispatch_event_interceptors('sync_finish_job_operation')`, created by `attach_event_trigger` in `20260410030406_event-system-after-interceptors.sql:113-124`). A multi-row Kysely `UPDATE ... SET status='Done'` fires it once per row, and Kysely does NOT bypass it (it's a real DB trigger). Each member job's own downstream op is released independently by the interceptor's dependency query (`20260410031809_production-interceptors.sql:109-148`). **No cross-job dependency edges needed.**
- **[VERIFIED]** `getNextSequence(trx, tableName, companyId)` — exact signature in `packages/database/supabase/functions/shared/get-next-sequence.ts:5-9`; reads/updates the `"sequence"` table by `(table, companyId)`.
- **[VERIFIED]** `process` has a **bare PK `("id")`** (`20240819115702_work-centers.sql:12`) — FK from `jobOperationGroup.processId` references `"process"("id")` only, no composite.
- **[VERIFIED]** `productionQuantity` (`20241002012019:7-27`): bare PK `id` DEFAULT `xid()`, `quantity` is **INTEGER**, `createdAt` defaults NOW(). Minimal insert: `{ jobOperationId, type, quantity, companyId, createdBy }`.
- **[VERIFIED]** Newest `get_active_job_operations_by_location` definition lives in `20260531084723_rework-serial-flow.sql` — the RPC feeds **both** the ERP schedule board and the MES kanban.
- **[VERIFIED]** New companies get their sequences from `packages/database/supabase/functions/seed-company/index.ts` (it writes `"sequence"` rows).
- **[VERIFIED]** `get-method` copies: `itemToJob` builds `jobOperationsInserts.push({...})` with an **enumerated field list** at ~lines 635–663 (loop var `op`); `quoteLineToJob` maps `quoteOperation → jobOperation` with an enumerated list at ~4543–4579; `itemToQuoteLine` pushes `quoteOperationsInserts` at ~1939–1969; `itemToItem` (method→method) uses spread `{...operation}` at ~215–224 so new columns copy automatically.
- **[VERIFIED]** MES `finishJobOperation` (`apps/mes/app/services/operations.service.ts:148-189`) sets status `Done` then invokes `post-production-event` for each ended, un-posted `productionEvent` (`postedToGL = false`). Group completion must replicate this GL-posting step.

## Dependency graph

```
Phase 0 → Phase 1 (schema) → Phase 2 (models) → Phase 3 (edge fn) → Phase 4 (services/propagation)
                                                                        → Phase 5 (ERP UI) ∥ Phase 6 (MES UI)
                                                                              → Phase 7 (verify, docs, PR)
```

---

## Phase 0 — Branch

```bash
git checkout main && git pull
git checkout -b feature/work-order-stitching
```

---

## Phase 1 — Database migration

### Task 1.1 Create + write the migration

```bash
pnpm db:migrate:new work-order-stitching
```

If the generated HHMMSS is `000000`, rename with random digits (timestamp = cross-branch PK).

Complete file contents:

```sql
-- Work Order Stitching (spec: .ai/specs/2026-07-02-work-order-stitching.md)
-- Groups compatible jobOperations across jobs into one virtual operation.
-- Jobs are never merged; the BOM is never touched.

-- 1. Master-data flags
ALTER TABLE "itemReplenishment"
  ADD COLUMN "workOrderStitching" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "methodOperation"
  ADD COLUMN "stitchable" BOOLEAN NOT NULL DEFAULT false;

-- quoteOperation carries the flag so quote-born jobs (quoteLineToJob) keep it
ALTER TABLE "quoteOperation"
  ADD COLUMN "stitchable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "jobOperation"
  ADD COLUMN "stitchable" BOOLEAN NOT NULL DEFAULT false;

-- 2. Operation group ("virtual operation")
CREATE TYPE "jobOperationGroupStatus" AS ENUM ('Active', 'Completed', 'Cancelled');

CREATE TABLE "jobOperationGroup" (
  "id" TEXT NOT NULL DEFAULT id('wos'),
  "readableId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "processId" TEXT NOT NULL,
  "workCenterId" TEXT,
  "status" "jobOperationGroupStatus" NOT NULL DEFAULT 'Active',
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "jobOperationGroup_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "jobOperationGroup_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobOperationGroup_processId_fkey" FOREIGN KEY ("processId")
    REFERENCES "process"("id"),
  CONSTRAINT "jobOperationGroup_workCenterId_fkey" FOREIGN KEY ("workCenterId")
    REFERENCES "workCenter"("id") ON DELETE SET NULL,
  CONSTRAINT "jobOperationGroup_readableId_unique" UNIQUE ("readableId", "companyId")
);

CREATE INDEX "jobOperationGroup_companyId_idx" ON "jobOperationGroup" ("companyId");
CREATE INDEX "jobOperationGroup_processId_idx" ON "jobOperationGroup" ("processId");
CREATE INDEX "jobOperationGroup_workCenterId_idx" ON "jobOperationGroup" ("workCenterId");
CREATE INDEX "jobOperationGroup_createdBy_idx" ON "jobOperationGroup" ("createdBy");

ALTER TABLE "jobOperationGroup" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."jobOperationGroup"
  FOR SELECT USING (
    "companyId" = ANY (
      SELECT unnest(get_companies_with_employee_role()::text[])
    )
  );

CREATE POLICY "INSERT" ON "public"."jobOperationGroup"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      SELECT unnest(get_companies_with_employee_permission('production_create')::text[])
    )
  );

CREATE POLICY "UPDATE" ON "public"."jobOperationGroup"
  FOR UPDATE USING (
    "companyId" = ANY (
      SELECT unnest(get_companies_with_employee_permission('production_update')::text[])
    )
  );

CREATE POLICY "DELETE" ON "public"."jobOperationGroup"
  FOR DELETE USING (
    "companyId" = ANY (
      SELECT unnest(get_companies_with_employee_permission('production_delete')::text[])
    )
  );

-- 3. Membership — one nullable column on jobOperation
ALTER TABLE "jobOperation" ADD COLUMN "operationGroupId" TEXT;

CREATE INDEX "jobOperation_operationGroupId_idx"
  ON "jobOperation" ("operationGroupId")
  WHERE "operationGroupId" IS NOT NULL;

-- 4. Sequence for readable ids (WOS000001) — pattern from 20260601143527_picking-lists.sql:134-145
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT
  'jobOperationGroup',
  'Operation Group',
  'WOS',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company"
ON CONFLICT DO NOTHING;
```

> Before applying, eyeball the RLS idiom in the single newest migration in the
> directory; if it differs from `= ANY (SELECT unnest(...::text[]))`, copy the
> current idiom. Everything else above is verified against live schema.

### Task 1.2 New-company sequence seeding

File: `packages/database/supabase/functions/seed-company/index.ts` **[VERIFIED: this is where new companies get sequence rows]**. Find the array/insert of sequence rows and add an entry matching the existing shape:

```typescript
{ table: "jobOperationGroup", name: "Operation Group", prefix: "WOS", suffix: null, next: 0, size: 6, step: 1 }
```

(Adapt to the exact literal shape used by neighbors in that file.)

### Task 1.3 RPC columns for both boards

The ERP schedule board and MES kanban both read `get_active_job_operations_by_location`. Newest definition: `packages/database/supabase/migrations/20260531084723_rework-serial-flow.sql`. In the **same migration file from Task 1.1**, re-declare the function: copy the newest definition verbatim, and add to its SELECT list + return table:

```sql
  jo."stitchable",
  jo."operationGroupId",
  g."readableId" AS "operationGroupReadableId"
```

with `LEFT JOIN "jobOperationGroup" g ON g."id" = jo."operationGroupId" AND g."companyId" = jo."companyId"`.

### Task 1.4 Apply + verify + commit

```bash
pnpm db:migrate
# Expected: applies cleanly; DB types + swagger regenerate.

grep -n "workOrderStitching\|operationGroupId\|jobOperationGroup" packages/database/src/types.ts | head
# Expected: hits for all three.

psql "$SUPABASE_DB_URL" -c 'SELECT "table","prefix","size" FROM "sequence" WHERE "table"=$$jobOperationGroup$$ LIMIT 3;'
# Expected: one row per company, prefix WOS, size 6.

git add -A && git commit -m "feat(production): work order stitching schema (jobOperationGroup, stitchable flags, sequence, RPC columns)"
```

---

## Phase 2 — Validators / models

### Task 2.1 Items validators

File: `apps/erp/app/modules/items/items.models.ts`.

Edit 1 — `itemManufacturingValidator` (~line 517), full replacement:

```typescript
export const itemManufacturingValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  // manufacturingBlocked: zfd.checkbox(),
  requiresConfiguration: zfd.checkbox().optional(),
  lotSize: zfd.numeric(z.number().min(0)),
  scrapPercentage: zfd.numeric(z.number().min(0)),
  leadTime: zfd.numeric(z.number().min(0)),
  workOrderStitching: zfd.checkbox().optional()
});
```

Edit 2 — `methodOperationValidator` object body (~line 388; the object closes at ~line 430 before the `.refine` chain). Add after `operationLeadTime`:

```typescript
    operationLeadTime: zfd.numeric(z.number().min(0).optional()),
    stitchable: zfd.checkbox().optional()
```

Edit 3 — find the **quote operation validator** (grep `quoteOperationValidator` in `apps/erp/app/modules/sales/sales.models.ts`) and add the same `stitchable: zfd.checkbox().optional()` field so quote-side operation forms round-trip the column.

### Task 2.2 Production models

File: `apps/erp/app/modules/production/production.models.ts` (imports `z` and `zfd` already — verify at top of file). Add near the other status consts:

```typescript
export const jobOperationGroupStatus = [
  "Active",
  "Completed",
  "Cancelled"
] as const;

export const groupJobOperationsValidator = z.object({
  jobOperationIds: z
    .array(z.string().min(1))
    .min(2, { message: "Select at least two operations to group" })
    .max(10, { message: "A group cannot exceed 10 operations" })
});

export const ungroupJobOperationsValidator = z.object({
  operationGroupId: z.string().min(1, { message: "Group is required" })
});

export const completeOperationGroupValidator = z.object({
  operationGroupId: z.string().min(1, { message: "Group is required" }),
  producedQuantity: zfd.numeric(z.number().int().min(0)),
  notes: zfd.text(z.string().optional())
});
```

(`producedQuantity` is `.int()` — `productionQuantity.quantity` is INTEGER **[VERIFIED]**.)

```bash
pnpm --filter erp typecheck
git add -A && git commit -m "feat(production): validators for operation grouping"
```

---

## Phase 3 — `stitch` edge function

### Task 3.1 Scaffold + register

```bash
pnpm db:function:new stitch
```

`packages/database/supabase/config.toml` — add (formatting mirrors `[functions.mrp]` at ~line 161):

```toml
[functions.stitch]
enabled = true
verify_jwt = true
```

### Task 3.2 Function body

File: `packages/database/supabase/functions/stitch/index.ts` — complete contents. Imports mirror `trigger-rework/index.ts` (std `0.168.0` **[VERIFIED]**):

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import z from "npm:zod@^3.24.1";
import { getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { DB } from "../lib/types.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const MAX_GROUP_SIZE = 10;

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("group"),
    jobOperationIds: z.array(z.string()).min(2).max(MAX_GROUP_SIZE),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("ungroup"),
    operationGroupId: z.string(),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("complete"),
    operationGroupId: z.string(),
    producedQuantity: z.number().int().min(0),
    companyId: z.string(),
    userId: z.string()
  })
]);

/** Even split with largest-remainder rounding: integer parts sum exactly to total. */
function evenSplit(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = payloadValidator.parse(await req.json());
    const { companyId, userId } = payload;

    await requirePermissions(req, companyId, userId, {
      update: "production"
    });

    let result: Record<string, unknown> = {};

    switch (payload.type) {
      case "group": {
        result = await db.transaction().execute(async (trx) => {
          const operations = await trx
            .selectFrom("jobOperation")
            .selectAll()
            .where("id", "in", payload.jobOperationIds)
            .where("companyId", "=", companyId)
            .execute();

          if (operations.length !== payload.jobOperationIds.length) {
            throw new Error("One or more operations not found");
          }

          const first = operations[0];
          for (const op of operations) {
            if (!op.stitchable) {
              throw new Error(`Operation ${op.id} is not marked stitchable`);
            }
            if (op.operationGroupId) {
              throw new Error(`Operation ${op.id} is already in a group`);
            }
            if (op.processId !== first.processId) {
              throw new Error("All operations must share the same process");
            }
            if (op.workCenterId !== first.workCenterId) {
              throw new Error("All operations must share the same work center");
            }
            if (!["Todo", "Ready", "Waiting"].includes(op.status)) {
              throw new Error(`Operation ${op.id} has already started`);
            }
          }

          const events = await trx
            .selectFrom("productionEvent")
            .select("id")
            .where("jobOperationId", "in", payload.jobOperationIds)
            .limit(1)
            .execute();
          if (events.length > 0) {
            throw new Error(
              "Operations with recorded production events cannot be grouped"
            );
          }

          const jobs = await trx
            .selectFrom("job")
            .select(["id", "itemId"])
            .where("id", "in", operations.map((o) => o.jobId))
            .execute();
          const replenishments = await trx
            .selectFrom("itemReplenishment")
            .select(["itemId", "workOrderStitching"])
            .where("itemId", "in", jobs.map((j) => j.itemId))
            .where("companyId", "=", companyId)
            .execute();
          const optedIn = new Set(
            replenishments
              .filter((r) => r.workOrderStitching)
              .map((r) => r.itemId)
          );
          for (const job of jobs) {
            if (!optedIn.has(job.itemId)) {
              throw new Error(
                `Item on job ${job.id} does not have Work Order Stitching enabled`
              );
            }
          }

          const readableId = await getNextSequence(
            trx,
            "jobOperationGroup",
            companyId
          );

          const group = await trx
            .insertInto("jobOperationGroup")
            .values({
              readableId,
              companyId,
              processId: first.processId,
              workCenterId: first.workCenterId,
              status: "Active",
              createdBy: userId
            })
            .returning(["id", "readableId"])
            .executeTakeFirstOrThrow();

          await trx
            .updateTable("jobOperation")
            .set({ operationGroupId: group.id, updatedBy: userId })
            .where("id", "in", payload.jobOperationIds)
            .execute();

          return group;
        });
        break;
      }

      case "ungroup": {
        result = await db.transaction().execute(async (trx) => {
          const members = await trx
            .selectFrom("jobOperation")
            .select(["id"])
            .where("operationGroupId", "=", payload.operationGroupId)
            .execute();
          if (members.length === 0) {
            throw new Error("Group not found or empty");
          }

          const events = await trx
            .selectFrom("productionEvent")
            .select("id")
            .where("jobOperationId", "in", members.map((m) => m.id))
            .limit(1)
            .execute();
          if (events.length > 0) {
            throw new Error(
              "Cannot ungroup: production has been recorded. Complete the group instead — member jobs then proceed independently."
            );
          }

          await trx
            .updateTable("jobOperation")
            .set({ operationGroupId: null, updatedBy: userId })
            .where("operationGroupId", "=", payload.operationGroupId)
            .execute();

          await trx
            .deleteFrom("jobOperationGroup")
            .where("id", "=", payload.operationGroupId)
            .where("companyId", "=", companyId)
            .execute();

          return { ungrouped: members.length };
        });
        break;
      }

      case "complete": {
        result = await db.transaction().execute(async (trx) => {
          const members = await trx
            .selectFrom("jobOperation")
            .selectAll()
            .where("operationGroupId", "=", payload.operationGroupId)
            .where("companyId", "=", companyId)
            .execute();
          if (members.length === 0) {
            throw new Error("Group not found or empty");
          }
          if (members.some((m) => m.status === "Done")) {
            throw new Error("Group already completed");
          }

          // productionQuantity minimal insert [VERIFIED cols]: id defaults xid(),
          // createdAt defaults NOW(); quantity is INTEGER.
          const splits = evenSplit(payload.producedQuantity, members.length);
          if (payload.producedQuantity > 0) {
            await trx
              .insertInto("productionQuantity")
              .values(
                members.map((op, i) => ({
                  jobOperationId: op.id,
                  type: "Production" as const,
                  quantity: splits[i],
                  companyId,
                  createdBy: userId
                }))
              )
              .execute();
          }

          // Multi-row Done. [VERIFIED] trg_event_sync_jobOperation is a
          // BEFORE/FOR EACH ROW trigger dispatching sync_finish_job_operation
          // per row: closes each op's open productionEvents and releases each
          // job's own dependent operation. No cross-job edges exist or are needed.
          await trx
            .updateTable("jobOperation")
            .set({ status: "Done", updatedBy: userId })
            .where("operationGroupId", "=", payload.operationGroupId)
            .execute();

          await trx
            .updateTable("jobOperationGroup")
            .set({
              status: "Completed",
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", payload.operationGroupId)
            .where("companyId", "=", companyId)
            .execute();

          return { completed: members.length, splits, memberIds: members.map((m) => m.id) };
        });
        break;
      }
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });
  } catch (err) {
    console.error("Error in stitch:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});
```

> **GL posting note:** `complete` intentionally does NOT invoke `post-production-event`.
> The caller (MES action, Task 6.3) replicates `finishJobOperation`'s pattern:
> after the edge call succeeds, query ended events with `postedToGL = false` for
> the returned `memberIds` and invoke `post-production-event` per event —
> exactly as `apps/mes/app/services/operations.service.ts:148-189` does today.

### Task 3.3 Verify + commit

```bash
deno check packages/database/supabase/functions/stitch/index.ts 2>&1 | head
# Expected: clean (or only lib warnings shared by sibling functions)

git add -A && git commit -m "feat(functions): stitch edge function (group/ungroup/complete)"
```

---

## Phase 4 — ERP services + propagation

### Task 4.1 `production.service.ts` additions

File: `apps/erp/app/modules/production/production.service.ts`. Place near `triggerJobSchedule` (~line 2172), matching its signature idiom:

```typescript
export async function getJobOperationGroup(
  client: SupabaseClient<Database>,
  operationGroupId: string,
  companyId: string
) {
  const group = await client
    .from("jobOperationGroup")
    .select("*")
    .eq("id", operationGroupId)
    .eq("companyId", companyId)
    .single();
  if (group.error) return group;

  const operations = await client
    .from("jobOperation")
    .select("*, job(id, jobId, itemId, quantity, dueDate, status)")
    .eq("operationGroupId", operationGroupId);

  return {
    data: { ...group.data, operations: operations.data ?? [] },
    error: operations.error
  };
}

export async function getStitchableOperations(
  client: SupabaseClient<Database>,
  args: { processId: string; workCenterId: string | null; companyId: string }
) {
  let query = client
    .from("jobOperation")
    .select("*, job(id, jobId, itemId, quantity, dueDate)")
    .eq("companyId", args.companyId)
    .eq("processId", args.processId)
    .eq("stitchable", true)
    .is("operationGroupId", null)
    .in("status", ["Todo", "Ready", "Waiting"]);

  return args.workCenterId
    ? query.eq("workCenterId", args.workCenterId)
    : query.is("workCenterId", null);
}

export async function groupJobOperations(
  client: SupabaseClient<Database>,
  args: { jobOperationIds: string[]; companyId: string; userId: string }
) {
  return client.functions.invoke("stitch", {
    body: { type: "group", ...args }
  });
}

export async function ungroupJobOperations(
  client: SupabaseClient<Database>,
  args: { operationGroupId: string; companyId: string; userId: string }
) {
  return client.functions.invoke("stitch", {
    body: { type: "ungroup", ...args }
  });
}
```

(No ERP-side `complete` wrapper — completion is an MES flow, Task 6.3.)

### Task 4.2 `upsertItemManufacturing` passthrough

File: `apps/erp/app/modules/items/items.service.ts` (~line 3290). Read the function body: if it spreads the validated payload into `.update(...)`, no change; if it enumerates columns, add `workOrderStitching`. Also confirm `getItemManufacturing` (~line 712) uses `select("*")` — it does per prior research; if enumerated, add the column. State the finding in the commit message.

### Task 4.3 `get-method` propagation **[all sites VERIFIED]**

File: `packages/database/supabase/functions/get-method/index.ts`. Source selects are `select("*", ...)` everywhere, so the new columns arrive on `op` automatically. Four edits:

1. **`itemToJob`** (~635–663): add to the `jobOperationsInserts.push({...})` object:
   ```typescript
   stitchable: op.stitchable ?? false,
   ```
2. **`quoteLineToJob`** (~4543–4579): add to the mapped jobOperation object:
   ```typescript
   stitchable: op.stitchable ?? false,
   ```
3. **`itemToQuoteLine`** (~1939–1969): add to `quoteOperationsInserts.push({...})`:
   ```typescript
   stitchable: op.stitchable ?? false,
   ```
4. **`itemToItem`** (~215–224): uses `{...operation}` spread — **no edit needed** (verify the spread is still there).

```bash
deno check packages/database/supabase/functions/get-method/index.ts 2>&1 | head
git add -A && git commit -m "feat(production): operation group services + stitchable propagation through get-method"
```

---

## Phase 5 — ERP UI

### Task 5.1 Manufacturing tab checkbox

File: `apps/erp/app/modules/items/ui/Item/ItemManufacturingForm.tsx`. Insert after the `requiresConfiguration` `<Boolean>` block (ends line ~89), inside the same grid:

```tsx
            <Boolean
              name="workOrderStitching"
              label={t`Work Order Stitching`}
              bordered
              description={t`Allow this item's stitchable operations to be grouped into a shared run across work orders`}
              className="col-span-3"
            />
```

No route change needed: the action at `apps/erp/app/routes/x+/part+/$itemId.details.tsx` (`intent === "manufacturing"`) validates with the updated validator.

### Task 5.2 `BillOfProcess.tsx` stitchable checkbox **[structure VERIFIED]**

File: `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx`.

1. Add `Boolean` to the import from `~/components/Form` (current imports at ~84–96: `Number, NumberControlled, Process, Select, SelectControlled, StandardFactor, Submit, SupplierProcess, Tags, Tool, UnitHint, UnitOfMeasure, WorkCenter` — no Boolean yet).
2. The operation edit defaults object is at ~968–987. Add:
   ```typescript
   stitchable: item.data.stitchable ?? false,
   ```
3. Place the field in the main (always-visible) field grid near `operationType`/`processId` (NOT inside the collapsible time-disclosure grids at ~1546+). The form is `ValidatedForm`-based with plain fields alongside controlled ones, so a plain field works with defaultValues:
   ```tsx
   <Boolean
     name="stitchable"
     label={t`Stitchable`}
     description={t`Can be grouped with matching operations from other work orders`}
   />
   ```
4. The same component serves the job-method editor (routes `x+/items+/methods+/operation.$id.tsx` / `x+/job+/methods+/$jobId.operation.$id.tsx` both submit `methodOperationValidator`-shaped data — verify the job route's validator; if it has its own copy, add the field there too).

### Task 5.3 Schedule-board card: badge + Group/Ungroup menu **[structure VERIFIED]**

Card file: `apps/erp/app/modules/production/ui/Schedule/Kanban/components/ItemCard.tsx`.

1. **Type:** the `OperationItem` type (declared in/near `apps/erp/app/routes/x+/schedule+/operations.tsx`, used by the Kanban) gains `stitchable?: boolean`, `operationGroupId?: string | null`, `operationGroupReadableId?: string | null` — sourced from the RPC columns added in Task 1.3. Find where loader rows map into `OperationItem` and thread the three fields.
2. **Badge:** in the card JSX near the status chip (~299–311), render when grouped:
   ```tsx
   {item.operationGroupId && (
     <Badge variant="secondary">{item.operationGroupReadableId ?? "Stitched"}</Badge>
   )}
   ```
   (Import `Badge` from `@carbon/react`; match how neighboring badges in the file are rendered.)
3. **Menu:** in the `DropdownMenu` (~181–220), after "Open in MES", add:
   ```tsx
   {item.stitchable && !item.operationGroupId && (
     <DropdownMenuItem onClick={() => setGroupSeed?.(item)}>
       <DropdownMenuIcon icon={<LuCombine />} />
       Group with matching operations
     </DropdownMenuItem>
   )}
   {item.operationGroupId && (
     <DropdownMenuItem onClick={() => onUngroup?.(item.operationGroupId!)} destructive>
       <DropdownMenuIcon icon={<LuUngroup />} />
       Ungroup {item.operationGroupReadableId}
     </DropdownMenuItem>
   )}
   ```
   Thread `setGroupSeed` / `onUngroup` props down from the board the same way `setSelectedGroup` already flows (~198–212 shows the prop pattern). Pick real `react-icons/lu` icons that exist (`LuCombine`, `LuUngroup` — verify; fall back to `LuLayers`/`LuSplit`).
4. Wrap new user-visible strings in Lingui (`useLingui`/`t`) if the file already does (the existing menu items at 194/211/216 are unwrapped literals — match the file's current convention; do not introduce a mixed style).

### Task 5.4 Group modal + action route

1. **Paths** — `apps/erp/app/utils/path.ts`, next to `scheduleOperationUpdate` (~1719):
   ```typescript
   scheduleOperationsGroup: `${x}/schedule/operations/group`,
   scheduleOperationsStitchable: (operationId: string) =>
     generatePath(`${x}/schedule/operations/stitchable/${operationId}`),
   ```
2. **Loader route** `apps/erp/app/routes/x+/schedule+/operations.stitchable.$operationId.tsx`:
   - `requirePermissions(request, { view: "production" })`
   - load the seed op (`client.from("jobOperation").select("processId, workCenterId").eq("id", operationId).single()`), then return `getStitchableOperations(client, { processId, workCenterId, companyId })`.
3. **Action route** `apps/erp/app/routes/x+/schedule+/operations.group.tsx` — action-only, standard pattern (`assertIsPost` → `requirePermissions(request, { update: "production" })` → branch on `formData.get("intent")`):
   - `intent === "group"`: validate `groupJobOperationsValidator` (`jobOperationIds` posted via `zfd.repeatableOfType`-compatible repeated fields) → `groupJobOperations` → error: `return data({}, await flash(request, error(result.error, "Failed to group operations")))`; success: `return data(result.data, await flash(request, success("Operations grouped")))`.
   - `intent === "ungroup"`: validate `ungroupJobOperationsValidator` → `ungroupJobOperations` → same flash pattern.
4. **Modal** `apps/erp/app/modules/production/ui/Schedule/OperationGroupModal.tsx`: props `{ seed: OperationItem; onClose: () => void }`. `useFetcher().load(path.to.scheduleOperationsStitchable(seed.id))` for candidates; render checkbox rows (job readableId, item description, quantity, due date), seed preselected + locked, cap 10 with counter; submit via a second fetcher POST to `path.to.scheduleOperationsGroup` with `intent=group` + repeated `jobOperationIds`. Use `Modal`/`ModalContent`/... from `@carbon/react` matching a neighboring modal in `ui/Schedule/`.
5. Wire into `apps/erp/app/routes/x+/schedule+/operations.tsx`: board state `groupSeed`, render the modal when set; `onUngroup` posts `intent=ungroup` via fetcher; `revalidate` after either completes (fetcher completion already revalidates loaders by default — verify board data refreshes; if the board uses client cache, invalidate as neighbors do).

### Task 5.5 Verify + commit

```bash
pnpm --filter erp typecheck
pnpm lingui:extract   # only if new strings were Lingui-wrapped
git add -A && git commit -m "feat(erp): stitching UI — manufacturing flag, stitchable op flag, group modal, board badge"
```

---

## Phase 6 — MES UI

### Task 6.1 Board: collapse grouped ops to one card **[structure VERIFIED]**

Files: `apps/mes/app/routes/x+/operations.tsx` (loader ~52–236) + `apps/mes/app/components/Kanban/components/ItemCard.tsx`.

1. RPC already returns the new columns (Task 1.3) via `getActiveJobOperationsByLocation` (`apps/mes/app/services/operations.service.ts:204-213`). Thread `operationGroupId` / `operationGroupReadableId` into the item type used by the board (where `targetQuantity` etc. are mapped, ~line 226+ region).
2. In the loader's items mapping, **collapse**: group rows by `operationGroupId` (non-null); keep the first row per group as the card, attach `groupMembers: [{ jobReadableId, itemReadableId, targetQuantity }]` and `groupSize`; sum `targetQuantity` for display.
3. `ItemCard.tsx` (~111–136): when `item.groupSize > 1`, render a `×{groupSize}` badge next to the quantity `Heading` and the group readableId under the item description; card link goes to `path.to.operationGroup(item.operationGroupId)` instead of `path.to.operation(item.id)`.

### Task 6.2 MES paths + service reads

1. `apps/mes/app/utils/path.ts` (pattern at ~105–151):
   ```typescript
   operationGroup: (id: string) => generatePath(`${x}/group/${id}`),
   completeOperationGroup: (id: string) => generatePath(`${x}/group/${id}/complete`),
   ```
2. `apps/mes/app/services/operations.service.ts` — add (idiom matches `getOpenJobs` at :24-37):
   ```typescript
   export async function getJobOperationGroup(
     client: SupabaseClient<Database>,
     operationGroupId: string,
     companyId: string
   ) {
     const group = await client
       .from("jobOperationGroup")
       .select("*")
       .eq("id", operationGroupId)
       .eq("companyId", companyId)
       .single();
     if (group.error) return group;

     const operations = await client
       .from("jobOperation")
       .select("*, job(id, jobId, itemId, quantity, dueDate, status)")
       .eq("operationGroupId", operationGroupId);

     return {
       data: { ...group.data, operations: operations.data ?? [] },
       error: operations.error
     };
   }
   ```
3. `apps/mes/app/services/models.ts` — add (idiom matches `productionEventValidator` at :137-155):
   ```typescript
   export const completeOperationGroupValidator = z.object({
     operationGroupId: z.string().min(1, { message: "Group is required" }),
     producedQuantity: zfd.numeric(z.number().int().min(0))
   });
   ```

### Task 6.3 Group view + complete flow

1. **Route** `apps/mes/app/routes/x+/group.$groupId.tsx`:
   - Loader: `requirePermissions(request, {})` (MES idiom **[VERIFIED]** at `start.$operationId.tsx:20`), `getJobOperationGroup(serviceRole, groupId, companyId)`; also `getProductionEventsForJobOperation` for the **first** member op (timers run against it).
   - Render: member-job table (jobId, item, quantity, due date), aggregate quantity header, Start/Stop buttons linking to the existing `path.to.startOperation(firstMemberOpId)` / `path.to.endOperation(firstMemberOpId)` routes (one `productionEvent` on one member op is the design — cost divides by N at reporting), and a **Complete group** form (`ValidatedForm`, `completeOperationGroupValidator`, one `Number` input, copy: "Will be split evenly across {N} work orders").
2. **Action route** `apps/mes/app/routes/x+/group.$groupId.complete.tsx`:
   - `assertIsPost` → `requirePermissions` → validate → `serviceRole.functions.invoke("stitch", { body: { type: "complete", operationGroupId, producedQuantity, companyId, userId } })`.
   - On success, replicate `finishJobOperation`'s GL step **[VERIFIED pattern at operations.service.ts:148-189]**: for the returned `memberIds`, select `productionEvent` rows with `endTime not null` and `postedToGL = false`, and `serviceRole.functions.invoke("post-production-event", { body: { productionEventId, userId, companyId } })` for each.
   - Redirect `path.to.operations` with success flash (mirror `end.$operationId.tsx:286-310`).
3. **Scrap/material on a group (v1 boundary):** per-member scrap and material issue continue through the existing per-operation screens (each member op is real). The group view links each member row to `path.to.operation(memberOpId)` for those flows. **Aggregate one-tap material issue is explicitly deferred** (spec: v2) — do not build it.

### Task 6.4 Verify + commit

```bash
pnpm --filter mes typecheck
git add -A && git commit -m "feat(mes): grouped operation card, group view, complete-group flow"
```

---

## Phase 7 — Costing display, verification, docs, PR

### Task 7.1 Estimates-vs-actuals 1/N share **[structure VERIFIED]**

File: `apps/erp/app/modules/production/ui/Jobs/JobEstimatesVsActuals.tsx`.

- `getActualTime(operation)` at ~150–185 sums `productionEvent` durations per op. For an operation with `operationGroupId`, divide `setup`, `labor`, `machine` (and `total`) by the group's member count before returning.
- Member count: the component's data comes from the `$jobId.details.tsx` loader (`getProductionDataByOperations`, ~line 135). Add a lightweight count: select `jobOperation.id,operationGroupId` for the job's ops, and for grouped ones query member counts (`client.from("jobOperation").select("id", { count: "exact", head: true }).eq("operationGroupId", gid)`) — or extend `getProductionDataByOperations` to return it; pick whichever touches less.
- Label the row: a small badge `1/{n} · {groupReadableId}` next to the operation name, tooltip "Shared operation — time and cost split evenly across {n} work orders".

### Task 7.2 Full verification gate

```bash
pnpm --filter erp typecheck && pnpm --filter mes typecheck
pnpm run lint
pnpm run test
```

Manual smoke against the user's **running** dev stack (never restart it):

1. Item → Manufacturing tab → enable flag → save → reload → persisted.
2. Make method operation → Stitchable on → create 2 jobs → both jobs' op copies have `stitchable = true` (check via the job method editor or DB).
3. Schedule board → card menu → "Group with matching operations" → picker lists the sibling → confirm → both cards collapse/badge `WOS000001`.
4. MES board shows one card ×2 → group view → Start → End → Complete with 10 → `productionQuantity` rows 5/5 on the two member ops; both jobs' next ops flipped to Ready; group `Completed`.
5. Fresh group → Ungroup works; after any event → blocked with recovery message.
6. ERP job details → estimates-vs-actuals shows the 1/N badge and halved actuals.

### Task 7.3 Docs/knowledge sync (same PR)

1. `apps/erp/app/modules/production/AGENTS.md` — data-model table row for `jobOperationGroup`; key-functions entries (`getJobOperationGroup`, `getStitchableOperations`, `groupJobOperations`, `ungroupJobOperations`); domain concept line: "Operation Group — N stitchable jobOperations (same process + work center) grouped into one virtual operation; even time/cost/output split at recording time; jobs never merged; BOM untouched."
2. `apps/erp/app/modules/items/AGENTS.md` — note `workOrderStitching` (itemReplenishment) and `stitchable` (methodOperation).
3. Spec changelog entry; **ask the user** before moving the spec to `implemented/`.
4. Comment on issue #1010 linking the PR.

### Task 7.4 PR

```bash
git push -u origin feature/work-order-stitching   # ask the user before pushing
gh pr create --title "feat(production): work order stitching — group compatible job operations into a shared run" \
  --body "Tracking spec: .ai/specs/2026-07-02-work-order-stitching.md
Closes #1010

## What
- \`jobOperationGroup\` + \`operationGroupId\`/\`stitchable\` columns; \`WOS\` sequence; RPC columns for both boards (jobs never merged; BOM untouched)
- \`stitch\` edge function: group / ungroup / complete — server-side eligibility gate, even split (largest remainder), multi-row Done (verified: sync_finish_job_operation is a per-row BEFORE trigger, so each job's downstream op releases independently)
- \`stitchable\` propagates through get-method (itemToJob, quoteLineToJob, itemToQuoteLine; itemToItem via spread)
- ERP: Manufacturing-tab flag, stitchable routing-step flag, board badge + Group/Ungroup menu, group picker modal
- MES: collapsed group card, group view, complete-group flow with post-production-event GL posting
- Estimates-vs-actuals shows 1/N share for grouped operations

## Verification
- typecheck (erp, mes), lint, tests green
- Manual smoke: flag → stitchable → group → run → complete 10 → 5/5 split → downstream ops released → ungroup guards
"
```

---

## Out of scope (do not build)

- Aggregate one-tap material issue on a group (v2; per-member issue works today).
- Planning-drawer stitch suggestions (v2).
- Work-center batch capacity (separate future spec).
- Group-level NCR (per-operation NCR flow unchanged and sufficient).

## Residual risks (all downgraded after grounding)

| Watch for | Status |
|-----------|--------|
| Interceptor not firing on multi-row UPDATE | **Retired** — verified FOR EACH ROW trigger |
| RPC column list | **Retired** — Task 1.3 re-declares from the newest def (`20260531084723`) |
| Sequence seeding | **Retired** — existing companies in migration; new companies via `seed-company` fn (Task 1.2) |
| Quote-born jobs losing the flag | **Retired** — `quoteOperation.stitchable` + both quote copy paths (Tasks 1.1, 4.3) |
| Line-number drift | Anchors + quoted code given everywhere; re-locate by content |
| `getStitchableOperations` cross-company leak via missing companyId on join | Query filters `companyId` explicitly; RLS backstops |
