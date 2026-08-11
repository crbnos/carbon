\# Workflows — Run History and Observability — implementation plan

**Spec / source:** `.ai/specs/2026-07-31-workflows-run-history.md`
**Research:** `.ai/research/2026-07-31-workflows-run-history.md`
**Phase brief:** `/Users/aashu/work/carbon/plans/automations-engine/phases/phase-9-run-history.md`
**Branch:** `feat/automation`

Read before starting: `AGENTS.md`, `packages/jobs/AGENTS.md`,
`packages/workflows/AGENTS.md`, `.claude/rules/workflow-engine.md`,
`.claude/rules/workflow-matcher.md`, `.claude/rules/conventions-database.md`,
`.claude/rules/workflow-database-migration.md`, `.claude/rules/i18n-lingui-system.md`,
`.ai/lessons.md`.

**Repo-wide rules that apply to every task below:**

- `pnpm` only, never `npm`.
- Never hand-edit `packages/database/src/types.ts` — it is generated.
- Every user-facing string goes through Lingui (`<Trans>` in JSX, `useLingui().t` in
  components, `msg` in route `handle`s). **Do not run `pnpm lingui:extract`** — on this branch
  it rewrites every `.po` file with ~120k lines of unrelated churn. New strings are picked up
  by a later, deliberate extract pass.
- Never use `t` imported from `@lingui/core/macro` in app code — only `useLingui()` from
  `@lingui/react/macro`, or `msg` from `@lingui/core/macro` for route handles.
- Do not commit. Stop after Task 18 and report.

## Progress

- [ ] Task 1: Migration — `workflowStepRun.detail`, two indexes, `workflowLastRun` view
- [ ] Task 2: Regenerate database types
- [ ] Task 3: `topologicalNodeOrder` in `@carbon/workflows`
- [ ] Task 4: Per-clause condition evaluation in the runtime
- [ ] Task 5: Widen redaction, add `compactForLog`, persist `detail`
- [ ] Task 6: Nightly retention Inngest function
- [ ] Task 7: Run-history service functions and types
- [ ] Task 8: Lift `getEntityPath` to a shared helper, add three table labels
- [ ] Task 9: Paths, nav entry, and the two routes
- [ ] Task 10: `WorkflowRunsTable`
- [ ] Task 11: `RuntimeValueView` and `ConditionDetail`
- [ ] Task 12: `WorkflowRunSteps` — the merged step list
- [ ] Task 13: `WorkflowRunDetail` — header, banners, chain
- [ ] Task 14: `RunLiveUpdates` — realtime while in flight
- [ ] Task 15: Last Run column on the Workflows list
- [ ] Task 16: Runs link in `BuilderHeader`
- [ ] Task 17: Documentation sync
- [ ] Task 18: End-to-end verification

## Dependencies

```
Task 1 → Task 2 → Tasks 5, 6, 7
Task 3 (independent)          Task 4 → Task 5 → Task 6
Task 8 (independent)
Task 7 → Task 9 → Task 10 → Task 13
Tasks 3, 7 → Task 11 → Task 12 → Task 13 → Task 14
Task 7 → Task 15          Task 9 → Task 16
Everything → Task 17 → Task 18
```

Independent, safe to run in parallel: **Task 3**, **Task 4**, **Task 8**.
Independent once Task 9 lands: **Task 10**, **Task 11**.

---

## Task 1: Migration — `workflowStepRun.detail`, two indexes, `workflowLastRun` view

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<generated-timestamp>_workflow-run-history.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20251220191340_maintenance-schedules-view.sql`
  (view + `security_invoker` + any `GRANT` lines this repo uses)
- Reference: `packages/database/supabase/migrations/20260730142317_workflows-foundation.sql`
  (the tables being altered; `workflowRun` at L106, `workflowStepRun` at L143, indexes at L190)

**Steps:**

1. Create the migration file:
   ```bash
   pnpm db:migrate:new workflow-run-history
   ```
2. Open `packages/database/supabase/migrations/20251220191340_maintenance-schedules-view.sql`
   and note whether it emits `GRANT SELECT ON "<view>" TO authenticated;` (or similar) after
   `CREATE VIEW`. **Mirror exactly what that file does** — if it grants, grant; if it relies on
   default privileges, do not add grants.
3. Write the migration body:

   ```sql
   -- Run history: per-node diagnostics, retention indexes, and a last-run view.

   -- Diagnostics only. Node data lives in "output"; this is why a node did what it did.
   ALTER TABLE "workflowStepRun" ADD COLUMN "detail" JSONB;

   COMMENT ON COLUMN "workflowStepRun"."detail" IS
     'Diagnostics only (per-clause condition evaluation). Never node data - that is "output".';

   -- The stale-run reaper's predicate is the complement of "workflowRun_purge_idx".
   CREATE INDEX "workflowRun_stale_idx" ON "workflowRun" ("createdAt")
     WHERE "status" IN ('Queued', 'Running');

   -- Blocked and Skipped runs never set "completedAt", so every retention pass ages
   -- terminal runs on COALESCE("completedAt", "createdAt") and needs it indexed.
   CREATE INDEX "workflowRun_retention_idx"
     ON "workflowRun" (COALESCE("completedAt", "createdAt"))
     WHERE "status" IN ('Succeeded', 'Failed', 'Blocked', 'Skipped');

   -- Latest run per workflow. PostgREST cannot express latest-per-group.
   CREATE VIEW "workflowLastRun" WITH (security_invoker = on) AS
   SELECT DISTINCT ON ("companyId", "workflowId")
     "companyId",
     "workflowId",
     "id" AS "runId",
     "status",
     "statusReason",
     "createdAt",
     "startedAt",
     "completedAt",
     "durationMs"
   FROM "workflowRun"
   ORDER BY "companyId", "workflowId", "createdAt" DESC;
   ```
4. Apply it:
   ```bash
   pnpm db:migrate
   ```

**Verify:**
```bash
pnpm db:migrate
# Expected: the migration applies with no error. Then, in the local database:
#   \d "workflowStepRun"   shows a "detail" jsonb column
#   \d "workflowRun"       shows workflowRun_stale_idx and workflowRun_retention_idx
#   SELECT * FROM "workflowLastRun" LIMIT 1;   runs without error
```

**Out of scope:** Do not drop or modify `workflowRun_purge_idx` (it is harmless and other
code may come to rely on it). Do not add RLS policies — the new view inherits the caller's RLS
via `security_invoker`, and the underlying tables are already SELECT-only for `workflows_view`.
Do not add `createdBy`/`updatedBy` columns to either table — their absence is deliberate
(`technical-decisions.md` §6).

---

## Task 2: Regenerate database types

**Depends on:** Task 1
**Files:**
- Modify (generated, do not hand-edit): `packages/database/src/types.ts`

**Steps:**

1. Run the generator:
   ```bash
   pnpm run generate:types
   ```
2. Confirm the diff contains `detail: Json | null` on `workflowStepRun`'s `Row`, `Insert` and
   `Update`, and a new `workflowLastRun` entry under `Views`.

**Verify:**
```bash
grep -n "workflowLastRun" packages/database/src/types.ts | head -3
# Expected: at least one match
grep -c "detail" packages/database/src/types.ts
# Expected: a non-zero count (the workflowStepRun.detail column is present)
```

**Out of scope:** Do not edit `types.ts` by hand for any reason. If the generator fails,
STOP and report — do not patch the file manually.

---

## Task 3: `topologicalNodeOrder` in `@carbon/workflows`

**Depends on:** none (parallel-safe)
**Files:**
- Create: `packages/workflows/src/definition/order.ts`
- Create: `packages/workflows/src/definition/order.test.ts`
- Modify: `packages/workflows/src/index.ts` — export `topologicalNodeOrder`
- Copy from (precedent): `packages/workflows/src/definition/schedule.ts` + `schedule.test.ts`
  (a small pure module in this package with its own vitest file)

**Steps:**

1. Create `order.ts` exporting one function:

   ```ts
   import type { WorkflowDefinition } from "./schema";

   /** Every node id in reading order: the trigger first, then breadth-first over
    * edges, then anything unreachable, ties broken by position in the definition
    * so the order is stable across renders. */
   export function topologicalNodeOrder(definition: WorkflowDefinition): string[] {
     const index = new Map<string, number>();
     definition.nodes.forEach((node, i) => index.set(node.id, i));

     const outgoing = new Map<string, string[]>();
     for (const edge of definition.edges) {
       const list = outgoing.get(edge.source) ?? [];
       list.push(edge.target);
       outgoing.set(edge.source, list);
     }

     const seen = new Set<string>();
     const order: string[] = [];

     const roots = definition.nodes
       .filter((node) => node.type === "trigger")
       .map((node) => node.id);
     const queue = roots.length > 0 ? [...roots] : [];

     while (queue.length > 0) {
       const id = queue.shift() as string;
       if (seen.has(id)) continue;
       seen.add(id);
       order.push(id);
       const next = (outgoing.get(id) ?? [])
         .filter((target) => index.has(target))
         .sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
       queue.push(...next);
     }

     // Anything the edges never reach still has to be listed.
     for (const node of definition.nodes) {
       if (!seen.has(node.id)) order.push(node.id);
     }

     return order;
   }
   ```

   Check the real field names on `WorkflowEdge` in
   `packages/workflows/src/definition/schema.ts` first — if the edge's endpoints are not called
   `source` and `target`, use the real names. If `WorkflowDefinition` does not expose `nodes`
   and `edges` as arrays at the top level, STOP and report — do not improvise a shape.

2. Write `order.test.ts` with at least these cases:
   - a linear trigger → condition → action graph returns the three ids in that order;
   - a condition with two branches returns the branch whose node appears first in
     `definition.nodes` first;
   - a node with no incoming edge still appears, at the end;
   - a definition with no trigger node returns every node id exactly once;
   - the function returns each id exactly once even when two edges converge on one node.

3. Add `export { topologicalNodeOrder } from "./definition/order";` to
   `packages/workflows/src/index.ts`, placed with the other `./definition/*` exports.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all tests pass, including the new order.test.ts cases
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: exit 0, no type errors
```

**Out of scope:** Do not touch `packages/jobs/src/workflows/engine/walk.ts` — that is the
engine's execution frontier and is a different computation. Do not add cycle detection; the
validator already forbids cycles and `seen` makes this terminate regardless.

---

## Task 4: Per-clause condition evaluation in the runtime

**Depends on:** none (parallel-safe)
**Files:**
- Modify: `packages/workflows/src/runtime/types.ts` — add `ClauseEvaluation`, `NodeDetail`,
  and `detail?` on `NodeResult`
- Modify: `packages/workflows/src/runtime/compare.ts` — `evaluateClauses` returns evaluations
- Modify: `packages/workflows/src/runtime/condition.ts` — build and return `detail`
- Modify: `packages/workflows/src/runtime/filter.ts` — adapt to the new return shape
- Modify: `packages/workflows/src/index.ts` — export the two new types
- Modify: `packages/workflows/src/runtime/compare.test.ts`,
  `packages/workflows/src/runtime/condition.test.ts`,
  `packages/workflows/src/runtime/filter.test.ts`

**Steps:**

1. In `packages/workflows/src/runtime/types.ts`, add (importing `Combinator` and `Operator`
   the same way `compare.ts:1-2` already does — `Operator` from `@carbon/utils`, `Combinator`
   from `../definition/types`):

   ```ts
   /** What a single clause resolved to. `null` values mean it could not be read. */
   export type ClauseEvaluation = {
     left: RuntimeValue | null;
     operator: Operator;
     right: RuntimeValue | null;
     passed: boolean | null;
     reason?: string;
   };

   /** Why a node did what it did. Diagnostics, never node data. */
   export type NodeDetail = {
     kind: "condition";
     paths: Array<{
       pathId: string;
       combinator: Combinator;
       evaluations: ClauseEvaluation[];
       taken: boolean;
     }>;
   };
   ```

   and widen `NodeResult` (currently at `types.ts:77`) to:

   ```ts
   export type NodeResult =
     | {
         status: "Succeeded";
         outputs: Record<string, RuntimeValue>;
         handle: string | null;
         branchTaken?: string;
         summary?: string;
         detail?: NodeDetail;
       }
     | { status: "Skipped"; reason: string; detail?: NodeDetail }
     | { status: "Failed"; error: string; handle?: string | null };
   ```

2. Replace `evaluateClauses` in `packages/workflows/src/runtime/compare.ts` (lines 85-106)
   with exactly this, keeping the existing doc comment:

   ```ts
   /** No short-circuiting: every operand is resolved so the run history shows both sides. */
   export async function evaluateClauses(
     clauses: Clause[],
     combinator: Combinator,
     ctx: RuntimeContext
   ): Promise<
     | { ok: true; passed: boolean; evaluations: ClauseEvaluation[] }
     | { ok: false; reason: string; evaluations: ClauseEvaluation[] }
   > {
     const results: boolean[] = [];
     const evaluations: ClauseEvaluation[] = [];

     for (const clause of clauses) {
       const left = await resolveValue(clause.left, ctx);
       if (!left.ok) {
         // Keep what was evaluated before the failure — a run that stopped on
         // clause three still has to show clauses one and two.
         evaluations.push({
           left: null,
           operator: clause.operator,
           right: null,
           passed: null,
           reason: left.reason
         });
         return { ok: false, reason: left.reason, evaluations };
       }

       const right = await resolveValue(clause.right, ctx);
       if (!right.ok) {
         evaluations.push({
           left: left.value,
           operator: clause.operator,
           right: null,
           passed: null,
           reason: right.reason
         });
         return { ok: false, reason: right.reason, evaluations };
       }

       const passed = compare(left.value, clause.operator, right.value);
       evaluations.push({
         left: left.value,
         operator: clause.operator,
         right: right.value,
         passed
       });
       results.push(passed);
     }

     if (results.length === 0) return { ok: true, passed: true, evaluations };
     return {
       ok: true,
       passed:
         combinator === "or" ? results.some(Boolean) : results.every(Boolean),
       evaluations
     };
   }
   ```

   Add `ClauseEvaluation` to the existing `import type { RuntimeContext, RuntimeValue } from "./types";`
   line.

3. Replace the body of `conditionExecutor.execute` in
   `packages/workflows/src/runtime/condition.ts` with:

   ```ts
   execute: async (node, ctx) => {
     const paths: NodeDetail["paths"] = [];

     for (const path of node.data.paths) {
       if (path.kind === "else") {
         paths.push({
           pathId: path.id,
           combinator: path.combinator,
           evaluations: [],
           taken: true
         });
         return {
           status: "Succeeded",
           outputs: {},
           handle: path.id,
           branchTaken: path.id,
           detail: { kind: "condition", paths }
         };
       }

       const result = await evaluateClauses(path.clauses, path.combinator, ctx);
       paths.push({
         pathId: path.id,
         combinator: path.combinator,
         evaluations: result.evaluations,
         taken: result.ok && result.passed
       });

       // Unresolvable data is a skip, not a failed test — never fall through to the else.
       if (!result.ok) {
         return {
           status: "Skipped",
           reason: result.reason,
           detail: { kind: "condition", paths }
         };
       }

       if (result.passed) {
         return {
           status: "Succeeded",
           outputs: {},
           handle: path.id,
           branchTaken: path.id,
           detail: { kind: "condition", paths }
         };
       }
     }

     return {
       status: "Succeeded",
       outputs: {},
       handle: null,
       branchTaken: NO_BRANCH,
       detail: { kind: "condition", paths }
     };
   }
   ```

   Add `import type { NodeDetail, NodeExecutor } from "./types";`.

4. In `packages/workflows/src/runtime/filter.ts` nothing changes semantically — the code at
   lines 41-51 already only reads `result.ok` and `result.passed`, both of which still exist.
   Confirm it typechecks; **do not** add per-item clause detail (one row per item over a
   100-item list is a wall, not a debugging aid).

5. Export the new types from `packages/workflows/src/index.ts` alongside the other runtime
   types: `ClauseEvaluation`, `NodeDetail`.

6. Tests:
   - `compare.test.ts`: a two-clause `and` that passes returns `evaluations.length === 2` with
     both `passed: true` and both sides populated; a clause whose left side is unresolvable
     returns `ok: false` with `evaluations.length === 1`, `passed: null` and a `reason`; a
     three-clause list failing on the second returns `evaluations.length === 2`.
   - `condition.test.ts`: a node whose `if` fails and which falls to `else` returns
     `detail.paths` of length 2, the first `taken: false` with populated evaluations and the
     second `taken: true` with `evaluations: []`; a node that skips returns a `detail` whose
     last path has an evaluation carrying a `reason`.
   - `filter.test.ts`: existing assertions still pass unchanged.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all tests pass, including the new compare/condition assertions
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: exit 0
```

**Out of scope:** Do not change `compare()` itself — operator semantics are frozen and the
builder relies on them. Do not add `detail` to the `Failed` variant of `NodeResult`. Do not
change what `statusReason` carries.

---

## Task 5: Widen redaction, add `compactForLog`, persist `detail`

**Depends on:** Task 2, Task 4
**Files:**
- Modify: `packages/jobs/src/workflows/engine/ledger.ts` — widened `redactForLog`, redaction on
  `output` / `detail` / `error` / `statusReason`, `detail` param on `settleStep`
- Modify: `packages/jobs/src/workflows/engine/execute.ts` — pass `result.detail` through
- Create: `packages/jobs/src/workflows/retention.ts` — `compactForLog`
- Create: `packages/jobs/src/workflows/retention.test.ts`
- Modify (if one exists): `packages/jobs/src/workflows/engine/ledger.test.ts` — otherwise
  create it
- Copy from (precedent): `packages/jobs/src/workflows/matcher.test.ts` (a vitest file in this
  package testing a pure function)

**Steps:**

1. In `ledger.ts`, replace lines 16-38 with:

   ```ts
   // Deliberately excludes bare `key`, `auth` and `session`: `itemKey` is a column of
   // this table and `authorizedBy` is ordinary ERP data. Over-redaction in a debugging
   // tool is a failure too.
   const SECRET_KEY =
     /secret|token|password|passwd|credential|signature|authorization|apikey|api_key|client_secret|clientsecret|private_key|privatekey|bearer|cookie/i;
   const MAX_STRING_LENGTH = 4096;
   const REDACTED = "[REDACTED]";

   /** Replaces anything secret-looking and caps long strings, before it reaches the
    * run log. The key is kept and its value replaced: a dropped key is
    * indistinguishable from a field that was genuinely absent, and telling those two
    * apart is the whole job of a run log. */
   export function redactForLog(value: unknown): unknown {
     if (typeof value === "string") {
       if (value.length <= MAX_STRING_LENGTH) return value;
       const dropped = value.length - MAX_STRING_LENGTH;
       return `${value.slice(0, MAX_STRING_LENGTH)}… ${dropped} more characters`;
     }
     if (Array.isArray(value)) return value.map(redactForLog);
     if (value !== null && typeof value === "object") {
       const kept: Record<string, unknown> = {};
       for (const [key, entry] of Object.entries(value)) {
         kept[key] = SECRET_KEY.test(key) ? REDACTED : redactForLog(entry);
       }
       return kept;
     }
     return value;
   }

   /** For the free-text columns. Only truncation applies to a bare string — key-name
    * redaction needs keys — but an unbounded error message is worth capping. */
   export function redactText(value: string | null | undefined): string | null {
     if (value === null || value === undefined) return null;
     return redactForLog(value) as string;
   }
   ```

2. In the same file, widen `settleStep`'s params with `detail?: unknown;` and rewrite the
   patch construction (lines 93-111) so it reads:

   ```ts
   const patch: Updateable<KyselyDatabase["workflowStepRun"]> = {
     status: params.status,
     statusReason: redactText(params.statusReason),
     error: redactText(params.error),
     branchTaken: params.branchTaken ?? null,
     completedAt: completedAt.toISOString(),
     durationMs: completedAt.getTime() - new Date(params.startedAt).getTime()
   };

   if (params.output !== undefined) {
     patch.output = toJson(redactForLog(params.output));
   }
   if (params.detail !== undefined) {
     patch.detail = toJson(redactForLog(params.detail));
   }
   ```

   If `Updateable<KyselyDatabase["workflowStepRun"]>` does not accept `detail` here, Task 2
   did not run — STOP and report rather than casting it away.

3. In `execute.ts`, add one line to the `settleStep` call (currently lines 176-191), after
   `branchTaken`:

   ```ts
   detail: result.status === "Failed" ? undefined : result.detail,
   ```

4. Create `packages/jobs/src/workflows/retention.ts`:

   ```ts
   const MAX_LIST_ITEMS = 5;
   const MAX_STRING_LENGTH = 256;
   const MAX_OBJECT_KEYS = 20;
   const MAX_DEPTH = 5;

   /** Shrinks a stored payload to a readable summary once it is past the full-detail
    * window. Markers follow util.inspect's convention — a silently-shortened value
    * reads as a complete one, which is the failure mode this exists to avoid. */
   export function compactForLog(value: unknown, depth = 0): unknown {
     if (depth >= MAX_DEPTH) return "… nested value removed";

     if (typeof value === "string") {
       if (value.length <= MAX_STRING_LENGTH) return value;
       const dropped = value.length - MAX_STRING_LENGTH;
       return `${value.slice(0, MAX_STRING_LENGTH)}… ${dropped} more characters`;
     }

     if (Array.isArray(value)) {
       const kept = value
         .slice(0, MAX_LIST_ITEMS)
         .map((item) => compactForLog(item, depth + 1));
       if (value.length <= MAX_LIST_ITEMS) return kept;
       return [...kept, `… ${value.length - MAX_LIST_ITEMS} more items`];
     }

     if (value !== null && typeof value === "object") {
       const record = value as Record<string, unknown>;
       // An entity RuntimeValue is a type plus an id — already minimal. Its optional
       // inline `row` is the only heavy part, and it is not worth keeping.
       if (record.kind === "entity") {
         return { kind: record.kind, of: record.of, id: record.id };
       }
       const entries = Object.entries(record);
       const kept: Record<string, unknown> = {};
       for (const [key, entry] of entries.slice(0, MAX_OBJECT_KEYS)) {
         kept[key] = compactForLog(entry, depth + 1);
       }
       if (entries.length > MAX_OBJECT_KEYS) {
         kept["…"] = `${entries.length - MAX_OBJECT_KEYS} more keys`;
       }
       return kept;
     }

     return value;
   }
   ```

5. Tests. In `retention.test.ts`: a 7-item array keeps 5 plus `"… 2 more items"`; a 300-char
   string is cut to 256 plus `"… 44 more characters"`; a 25-key object keeps 20 plus a
   `"…": "5 more keys"` entry; an entity value `{kind:"entity", of:"job", id:"job_1", row:{...}}`
   comes back as exactly `{kind, of, id}`; nesting 6 deep returns the depth marker; a number,
   a boolean and `null` pass through untouched.

   In `ledger.test.ts` (create if absent — it must only test the pure `redactForLog` /
   `redactText`, never touch a database): `{ apiKey: "x" }` becomes
   `{ apiKey: "[REDACTED]" }` (**key present**); each of `secret`, `token`, `password`,
   `authorization`, `cookie`, `bearer` is redacted case-insensitively; `itemKey`,
   `authorizedBy`, `keyword` and `sessionId` are **not** redacted; nested objects and arrays
   recurse; a 5000-char string returns 4096 chars plus `"… 904 more characters"`;
   `redactText(null)` returns `null`.

**Verify:**
```bash
pnpm --filter @carbon/jobs test
# Expected: all tests pass, including retention.test.ts and the redaction cases
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** Do not add `secret` handling anywhere else in the engine. Do not change
`claimStep` beyond what it already does (it already redacts `input`). Do not change what a
webhook action stores — the 2 KB response excerpt in
`packages/jobs/src/workflows/actions/webhook.ts` stays exactly as it is.

---

## Task 6: Nightly retention Inngest function

**Depends on:** Task 2, Task 5
**Files:**
- Create: `packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts`
- Modify: `packages/jobs/src/inngest/functions/scheduled/index.ts` — one export line
- Modify: `packages/jobs/src/inngest/index.ts` — the import block (lines 42-51) and the
  `// Scheduled` section of the `functions` array (around lines 118-126)
- Modify: `packages/jobs/AGENTS.md` — add the function to the scheduled list
- Copy from (precedent): `packages/jobs/src/inngest/functions/scheduled/notification-purge.ts`
  (function declaration, cron, module-scope constants with a why-comment, one `step.run` per
  pass, `logger.error` then `throw`)

**Steps:**

1. Create the file. Use `getJobDatabaseClient()` from `packages/jobs/src/db.ts`, **not** the
   Supabase service role that `notification-purge` uses — compaction rewrites JSONB per row.

   ```ts
   import { sql } from "kysely";
   import type { JobDatabase } from "../../../db";
   import { getJobDatabaseClient } from "../../../db";
   import { failCrashedRun } from "../../../workflows/engine/log";
   import { failInterruptedSteps } from "../../../workflows/engine/ledger";
   import { compactForLog } from "../../../workflows/retention";
   import { inngest } from "../../client";

   // Three tiers, straight from the design: full step detail for a week, a summary
   // for a month, run headers for a quarter. Every pass filters on a TERMINAL status
   // — while a run is in flight its step rows ARE the idempotency ledger.
   const STALE_RUN_HOURS = 24;
   const FULL_DETAIL_DAYS = 7;
   const COMPACT_DETAIL_DAYS = 30;
   const RUN_HEADER_DAYS = 90;
   const TERMINAL = ["Succeeded", "Failed", "Blocked", "Skipped"];
   const BATCH = 500;
   const COMPACT_BATCH = 200;
   const STALE_REASON =
     "This run stopped reporting and was closed automatically after 24 hours.";

   /** Blocked and Skipped runs never set completedAt, so age is measured on
    * whichever timestamp the run actually has. Matches workflowRun_retention_idx. */
   const runAge = sql<string>`COALESCE("completedAt", "createdAt")`;

   function cutoffDays(days: number): string {
     return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
   }

   function groupByCompany(
     rows: Array<{ id: string; companyId: string }>
   ): Map<string, string[]> {
     const byCompany = new Map<string, string[]>();
     for (const row of rows) {
       const ids = byCompany.get(row.companyId) ?? [];
       ids.push(row.id);
       byCompany.set(row.companyId, ids);
     }
     return byCompany;
   }

   async function selectTerminalRuns(
     db: JobDatabase,
     cutoff: string,
     limit: number,
     onlyUncompacted = false
   ) {
     let query = db
       .selectFrom("workflowRun")
       .select(["id", "companyId"])
       .where("status", "in", TERMINAL)
       .where(runAge, "<", cutoff)
       .limit(limit);
     if (onlyUncompacted) query = query.where("compactedAt", "is", null);
     return query.execute();
   }
   ```

   Then the function itself, four `step.run` passes in this order — each one shrinks the input
   of the next:

   ```ts
   export const workflowRunRetentionFunction = inngest.createFunction(
     { id: "workflow-run-retention", retries: 2 },
     { cron: "0 4 * * *" },
     async ({ step, logger }) => {
       const db = getJobDatabaseClient();

       // 1. A run whose function died without reaching "finish" or onFailure sits in
       // Running forever: permanently in flight in the UI, and invisible to every
       // pass below, which all require a terminal status.
       const reaped = await step.run("reap-stale-runs", async () => {
         const cutoff = new Date(
           Date.now() - STALE_RUN_HOURS * 60 * 60 * 1000
         ).toISOString();
         const stale = await db
           .selectFrom("workflowRun")
           .select(["id", "companyId"])
           .where("status", "in", ["Queued", "Running"])
           .where("createdAt", "<", cutoff)
           .limit(BATCH)
           .execute();

         for (const run of stale) {
           await failInterruptedSteps(db, run.id, run.companyId);
           await failCrashedRun(db, run.id, run.companyId, STALE_REASON);
         }
         if (stale.length === BATCH) {
           logger.info("workflow-run-retention: more stale runs remain", {
             batch: BATCH
           });
         }
         return stale.length;
       });

       // 2. Headers last 90 days. Step rows cascade on the runId FK.
       const purgedRuns = await step.run("purge-run-headers", async () => {
         const rows = await selectTerminalRuns(db, cutoffDays(RUN_HEADER_DAYS), BATCH);
         let deleted = 0;
         for (const [companyId, ids] of groupByCompany(rows)) {
           const result = await db
             .deleteFrom("workflowRun")
             .where("companyId", "=", companyId)
             .where("id", "in", ids)
             .executeTakeFirst();
           deleted += Number(result.numDeletedRows ?? 0);
         }
         if (rows.length === BATCH) {
           logger.info("workflow-run-retention: more run headers remain", {
             batch: BATCH
           });
         }
         return deleted;
       });

       // 3. Step detail lasts 30 days; the header outlives it.
       const droppedSteps = await step.run("drop-step-detail", async () => {
         const rows = await selectTerminalRuns(
           db,
           cutoffDays(COMPACT_DETAIL_DAYS),
           BATCH
         );
         let deleted = 0;
         for (const [companyId, ids] of groupByCompany(rows)) {
           const result = await db
             .deleteFrom("workflowStepRun")
             .where("companyId", "=", companyId)
             .where("runId", "in", ids)
             .executeTakeFirst();
           deleted += Number(result.numDeletedRows ?? 0);
         }
         if (rows.length === BATCH) {
           logger.info("workflow-run-retention: more step detail remains", {
             batch: BATCH
           });
         }
         return deleted;
       });

       // 4. Full fidelity for a week, then a readable summary.
       const compacted = await step.run("compact-step-payloads", async () => {
         const rows = await selectTerminalRuns(
           db,
           cutoffDays(FULL_DETAIL_DAYS),
           COMPACT_BATCH,
           true
         );
         const now = new Date().toISOString();
         let steps = 0;

         for (const [companyId, ids] of groupByCompany(rows)) {
           const stepRows = await db
             .selectFrom("workflowStepRun")
             .select(["id", "input", "output", "detail"])
             .where("companyId", "=", companyId)
             .where("runId", "in", ids)
             .execute();

           for (const stepRow of stepRows) {
             await db
               .updateTable("workflowStepRun")
               .set({
                 input:
                   stepRow.input === null
                     ? null
                     : JSON.stringify(compactForLog(stepRow.input)),
                 output:
                   stepRow.output === null
                     ? null
                     : JSON.stringify(compactForLog(stepRow.output)),
                 detail:
                   stepRow.detail === null
                     ? null
                     : JSON.stringify(compactForLog(stepRow.detail)),
                 compactedAt: now
               })
               .where("companyId", "=", companyId)
               .where("id", "=", stepRow.id)
               .execute();
             steps += 1;
           }

           await db
             .updateTable("workflowRun")
             .set({ compactedAt: now })
             .where("companyId", "=", companyId)
             .where("id", "in", ids)
             .execute();
         }

         if (rows.length === COMPACT_BATCH) {
           logger.info("workflow-run-retention: more runs await compaction", {
             batch: COMPACT_BATCH
           });
         }
         return { runs: rows.length, steps };
       });

       return { reaped, purgedRuns, droppedSteps, compacted };
     }
   );
   ```

   If Kysely rejects `.where(runAge, "<", cutoff)` with a raw `sql` fragment as the left
   operand, use `.where(sql<boolean>\`COALESCE("completedAt", "createdAt") < ${cutoff}\`)`
   instead. Do **not** fall back to filtering on `completedAt` alone — that silently skips
   every `Blocked` and `Skipped` run, which are exactly the rows this feature exists to show.

2. Add `export { workflowRunRetentionFunction } from "./workflow-run-retention";` to
   `packages/jobs/src/inngest/functions/scheduled/index.ts`, keeping the file alphabetical.

3. In `packages/jobs/src/inngest/index.ts`, add `workflowRunRetentionFunction` to the
   `./functions/scheduled` import (keep the named imports alphabetical) and add it to the
   `// Scheduled` group of the exported `functions` array.

4. Add a row for it to the scheduled-functions description in `packages/jobs/AGENTS.md`.

**Verify:**
```bash
pnpm --filter @carbon/jobs test
# Expected: existing tests still pass
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
grep -c "workflowRunRetentionFunction" packages/jobs/src/inngest/index.ts
# Expected: 2  (one import, one array entry)
```

**Out of scope:** Do not change any existing cron time. Do not add a per-company row cap — the
tiers are age-based only. Do not delete rows for a run in a non-terminal status in passes 2-4
under any circumstance.

---

## Task 7: Run-history service functions and types

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/workflows/workflows.service.ts` — five new functions
- Modify: `apps/erp/app/modules/workflows/types.ts` — the derived row types
- Modify: `apps/erp/app/modules/workflows/index.ts` — barrel (verify it re-exports `*`)
- Copy from (precedent): `apps/erp/app/modules/workflows/workflows.service.ts:8-32`
  (`getWorkflows` — `setGenericQueryFilters`, `{ count: "exact" }`, `companyId` scoping)

**Steps:**

1. Add to `workflows.service.ts`:

   ```ts
   export async function getWorkflowRuns(
     client: SupabaseClient<Database>,
     companyId: string,
     args?: GenericQueryFilters
   ) {
     let query = client
       .from("workflowRun")
       .select(
         "id, workflowId, workflowVersionId, eventId, sourceEventId, triggerTable, triggerRecordId, ownerId, status, statusReason, rootRunId, causedByRunId, depth, path, startedAt, completedAt, durationMs, error, createdAt, workflow(name)",
         { count: "exact" }
       )
       .eq("companyId", companyId);

     if (args) {
       query = setGenericQueryFilters(query, args, [
         { column: "createdAt", ascending: false }
       ]);
     }

     return query;
   }

   export async function getWorkflowRun(
     client: SupabaseClient<Database>,
     id: string,
     companyId: string
   ) {
     return client
       .from("workflowRun")
       .select(
         "id, workflowId, workflowVersionId, eventId, sourceEventId, triggerTable, triggerRecordId, ownerId, status, statusReason, rootRunId, causedByRunId, depth, path, startedAt, completedAt, durationMs, error, compactedAt, createdAt, workflow(name), workflowVersion(versionNumber, formatVersion, nodes, edges)"
       )
       .eq("id", id)
       .eq("companyId", companyId)
       .maybeSingle();
   }

   export async function getWorkflowRunSteps(
     client: SupabaseClient<Database>,
     runId: string,
     companyId: string
   ) {
     return client
       .from("workflowStepRun")
       .select(
         "id, runId, sequence, nodeId, nodeType, itemKey, status, statusReason, input, output, detail, branchTaken, startedAt, completedAt, durationMs, error, compactedAt"
       )
       .eq("runId", runId)
       .eq("companyId", companyId)
       .order("sequence", { ascending: true })
       .order("itemKey", { ascending: true });
   }

   export async function getWorkflowRunChain(
     client: SupabaseClient<Database>,
     rootRunId: string,
     companyId: string
   ) {
     return client
       .from("workflowRun")
       .select(
         "id, workflowId, status, statusReason, depth, causedByRunId, createdAt, workflow(name)"
       )
       .eq("rootRunId", rootRunId)
       .eq("companyId", companyId)
       .order("depth", { ascending: true })
       .order("createdAt", { ascending: true })
       .limit(50);
   }

   export async function getWorkflowLastRuns(
     client: SupabaseClient<Database>,
     workflowIds: string[],
     companyId: string
   ) {
     return client
       .from("workflowLastRun")
       .select("workflowId, runId, status, createdAt, completedAt, durationMs")
       .in("workflowId", workflowIds)
       .eq("companyId", companyId);
   }
   ```

   The FK embeds (`workflow(name)`, `workflowVersion(...)`) rely on the foreign keys declared
   in `20260730142317_workflows-foundation.sql`. If PostgREST cannot resolve an embed because
   the FK is composite, replace that embed with a second query keyed on the ids — **do not**
   drop the field silently, and note the change in the task's completion report.

   **Watch for TS2589** ("Type instantiation is excessively deep"). `apps/erp` runs chronically
   close to TypeScript's instantiation budget and composite-key Supabase embeds are the usual
   trigger. If it fires, prefer a flat select plus a second query over adding
   `@ts-expect-error`.

2. Add the derived types to `apps/erp/app/modules/workflows/types.ts`, following whatever
   convention that file already uses for `Workflow`:

   ```ts
   export type WorkflowRun = NonNullable<
     Awaited<ReturnType<typeof getWorkflowRuns>>["data"]
   >[number];

   export type WorkflowRunStep = NonNullable<
     Awaited<ReturnType<typeof getWorkflowRunSteps>>["data"]
   >[number];

   export type WorkflowRunChainEntry = NonNullable<
     Awaited<ReturnType<typeof getWorkflowRunChain>>["data"]
   >[number];

   export type WorkflowLastRun = NonNullable<
     Awaited<ReturnType<typeof getWorkflowLastRuns>>["data"]
   >[number];
   ```

3. Confirm `apps/erp/app/modules/workflows/index.ts` re-exports the service and types with
   `export *`; if it lists names individually, add the new ones.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0. NOTE: the package is named `erp`, not `@carbon/erp` — a wrong
# filter silently succeeds without checking anything.
```

**Out of scope:** Do not add write functions of any kind. Both tables are SELECT-only by RLS
and the engine is the only writer. Do not add a `search` argument — there is no free-text
column worth searching.

---

## Task 8: Lift `getEntityPath` to a shared helper, add three table labels

**Depends on:** none (parallel-safe)
**Files:**
- Create: `apps/erp/app/utils/entity.ts`
- Modify: `apps/erp/app/modules/settings/ui/AuditLog/AuditLogTable.tsx` — delete the local
  `getEntityPath` (currently at line 81) and import the shared one
- Modify: `packages/database/src/audit.config.ts` — three entries in `tableLabels` (the map
  starts at line 498)

**Steps:**

1. Move the body of `getEntityPath` from `AuditLogTable.tsx:81` into
   `apps/erp/app/utils/entity.ts` **unchanged** — same id-prefix map, same `path.to.*` targets,
   same return type. Export it as a named export. Add a one-line doc comment saying it keys off
   the record's id prefix.
2. In `AuditLogTable.tsx`, delete the local definition and add
   `import { getEntityPath } from "~/utils/entity";`. Nothing else in that file changes.
3. In `packages/database/src/audit.config.ts`, add three entries to `tableLabels`, in the
   map's existing style and position (alphabetical if the map is alphabetical):
   ```ts
   group: "Group",
   location: "Location",
   user: "User",
   ```
   These are three of the sixteen workflow entity tables
   (`packages/workflows/src/catalog/entities.ts`) and are the only ones missing; without them
   `getTableLabel` falls through to the raw lowercase table name.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database
# Expected: exit 0
grep -n "getEntityPath" apps/erp/app/modules/settings/ui/AuditLog/AuditLogTable.tsx
# Expected: exactly one line, the import
```

**Out of scope:** Do not change `getEntityPath`'s behaviour, its prefix map, or its return
type — the audit log must keep working identically. Do not touch any other `tableLabels`
entry.

---

## Task 9: Paths, nav entry, and the two routes

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — two entries among the workflow paths (lines 2141-2154,
  which are alphabetical)
- Modify: `apps/erp/app/modules/workflows/ui/useWorkflowsSubmodules.tsx` — a second route in
  the "Automate" group
- Create: `apps/erp/app/routes/x+/workflows+/runs.tsx`
- Create: `apps/erp/app/routes/x+/workflows+/runs.$runId.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/workflows+/_index.tsx` (list loader shape),
  `apps/erp/app/routes/x+/settings+/audit-logs.details.tsx` (the full-size drawer child route)

**Steps:**

1. Add to `path.to` in `apps/erp/app/utils/path.ts`, keeping alphabetical order among the
   `workflow*` keys:
   ```ts
   workflowRun: (id: string) => generatePath(`${x}/workflows/runs/${id}`),
   workflowRuns: `${x}/workflows/runs`,
   ```
2. In `useWorkflowsSubmodules.tsx`, add a second entry to the `routes` array of the "Automate"
   group, after Workflows:
   ```tsx
   {
     name: t`Runs`,
     to: path.to.workflowRuns,
     icon: <LuHistory />,
     table: "workflowRun"
   }
   ```
   Import `LuHistory` from `react-icons/lu` alongside the existing `LuWorkflow`.
3. Create `runs.tsx` — the list route. Loader mirrors `_index.tsx` exactly: `requirePermissions`
   with `{ view: "workflows", role: "employee" }`, `getGenericQueryFilters(searchParams)`,
   `getWorkflowRuns(client, companyId, { limit, offset, sorts, filters })`, returning
   `{ data, count }`. The component renders
   ```tsx
   <VStack spacing={0} className="h-full">
     <WorkflowRunsTable data={data} count={count} />
     <Outlet />
   </VStack>
   ```
   (`Outlet` from `react-router`). Add
   `export const handle: Handle = { breadcrumb: msg\`Runs\`, to: path.to.workflowRuns };` only
   if `_index.tsx`'s siblings in this folder do — match the folder, do not invent.
4. Create `runs.$runId.tsx` — the detail route. Loader:
   - `requirePermissions(request, { view: "workflows", role: "employee" })`;
   - read `params.runId`, `throw notFound()` (or whatever `_index.tsx`'s siblings use for a
     missing param — check `apps/erp/app/routes/x+/workflow+/$id.tsx` for the local idiom) if
     absent;
   - `getWorkflowRun`, then `getWorkflowRunSteps`, then `getWorkflowRunChain` when
     `run.rootRunId` is not null;
   - return `{ run, steps, chain }`.

   The component is the `audit-logs.details.tsx` drawer, verbatim in structure:
   `<Drawer open onOpenChange={(open) => { if (!open) navigate(path.to.workflowRuns); }}>`,
   `<DrawerContent size="full">`, `<DrawerHeader><DrawerTitle>…</DrawerTitle></DrawerHeader>`,
   `<DrawerBody className="p-0"><WorkflowRunDetail … /></DrawerBody>`.

   For this task, `WorkflowRunsTable` and `WorkflowRunDetail` may be one-line placeholder
   components so the routes compile; Tasks 10-13 fill them in.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```
Then, with the dev server running, visit `/x/workflows/runs` — expect the Workflows sidebar
with a "Runs" entry selected and no error boundary.

**Out of scope:** Do not create a nested `$id_+` layout under `x+/workflow+/` — the per-workflow
view is this same route with a filter query param (Task 16). Do not add a `clientLoader` or
`clientAction`; run history is not cached client-side.

---

## Task 10: `WorkflowRunsTable`

**Depends on:** Task 8, Task 9
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Runs/WorkflowRunsTable.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Runs/RunStatus.tsx`
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Printing/PrintJobsTable.tsx`
  (a machine-generated list: `statusConfig` map at line 45, `ColumnDef[]` in a `useMemo`,
  `<Table … />` at line 429) and
  `apps/erp/app/modules/workflows/ui/WorkflowsTable.tsx` (the module's own conventions:
  `Hyperlink`, `EmployeeAvatar`, `useMemo` columns, `memo` export)

**Steps:**

1. `RunStatus.tsx` exports a `<RunStatus status={…} />` component built on `Status` from
   `@carbon/react` (`packages/react/src/Status.tsx`, which takes a `color` prop of
   `green | orange | red | yellow | blue | gray | purple`). The map, exactly:

   | status      | color    |
   | ----------- | -------- |
   | `Succeeded` | `green`  |
   | `Failed`    | `red`    |
   | `Running`   | `blue`   |
   | `Queued`    | `gray`   |
   | `Blocked`   | `orange` |
   | `Skipped`   | `purple` |

   Labels via `useLingui().t`. The orange/purple split is load-bearing: purple means a decision
   was made not to run, orange means something stopped it. Do not collapse either into red.

   Export a second `<StepStatus />` from the same file for the four step statuses
   (`Running`, `Succeeded`, `Failed`, `Skipped`) using the same colours.

2. `WorkflowRunsTable.tsx` takes `{ data: WorkflowRun[]; count: number }` and renders
   `<Table<WorkflowRun> data={data} columns={columns} count={count} title={t\`Runs\`}
   table="workflowRun" withPagination />`. **No `withSearch`** — there is no free-text column.

   Columns, in order:

   | accessorKey       | header   | cell                                                                                                                 |
   | ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
   | `status`          | Status   | `<RunStatus />`                                                                                                      |
   | `workflowId`      | Workflow | `Hyperlink` to `path.to.workflow(row.workflowId)` showing `row.workflow?.name`                                       |
   | `eventId`         | Trigger  | the human label for the event id, see below                                                                          |
   | `triggerRecordId` | Record   | see below                                                                                                            |
   | `startedAt`       | Started  | `formatDateTime(row.startedAt ?? row.createdAt)` — a `Blocked` run never started                                     |
   | `durationMs`      | Duration | `formatDurationMilliseconds(row.durationMs)` from `@carbon/utils`, em dash when null                                 |
   | `ownerId`         | Owner    | `EmployeeAvatar` (copy the usage in `WorkflowsTable.tsx`)                                                            |
   | `depth`           | Chain    | when `row.depth > 0`, a link to `path.to.workflowRun(row.causedByRunId)` reading `Hop {depth}`; otherwise an em dash |

   - **Trigger label:** import `WORKFLOW_LABELS` from `@carbon/workflows/labels` and resolve
     `WORKFLOW_LABELS[row.eventId]`, falling back to the raw `eventId`. Copy how
     `apps/erp/app/modules/workflows/ui/Builder/nodes/meta.ts` reads that map — it uses a local
     `labelText(key)` helper that reads `descriptor.id` to avoid calling a hook.
   - **Record cell:** `getTableLabel(row.triggerTable)` from
     `@carbon/database/audit.config` for the label, and `getEntityPath(row.triggerRecordId)`
     from `~/utils/entity` (Task 8) for the href. When `getEntityPath` returns nothing, render
     the label and id as plain text. Empty for a scheduled run (both columns null).

   Add `meta: { filterHeader: … }` / `meta: { exportValue: … }` only where a column's header is
   JSX or its accessor is an id — see `.claude/rules/table-csv-export.md`. No accessorKey may
   contain an underscore.

   Filters come from the `Table` component's own filter UI keyed on `table="workflowRun"`; do
   not hand-build a filter bar.

3. Replace the placeholder import in `runs.tsx` with the real component.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm exec biome check apps/erp/app/modules/workflows/ui/Runs/
# Expected: no error-severity findings (pre-existing warnings elsewhere are fine)
```
Then visit `/x/workflows/runs` with at least one run in the database — expect a row per run
with a coloured status badge, a clickable workflow name, and a duration.

**Out of scope:** Do not add row actions, a context menu, or a `primaryAction` — run history is
read-only. Do not add a "retry" control of any kind (replay is an explicit non-goal).

---

## Task 11: `RuntimeValueView` and `ConditionDetail`

**Depends on:** Task 4, Task 7
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Runs/RuntimeValueView.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Runs/ConditionDetail.tsx`
- Copy from (precedent): `apps/erp/app/components/AuditLog/AuditLogDrawer.tsx`
  (`formatValue`, `ChangePill`, `ChangeLine` — how this repo renders an arbitrary stored value
  as readable text rather than raw JSON)

**Steps:**

1. `RuntimeValueView.tsx` renders one stored value. A `RuntimeValue`
   (`packages/workflows/src/runtime/types.ts:10`) is one of three shapes:
   - `{ kind: "primitive", of, value }` → the value as text; `null` renders as a muted
     `Nothing`;
   - `{ kind: "entity", of, id }` → `getTableLabel(of)` plus the id, linked via
     `getEntityPath(id)` when that resolves, plain text otherwise;
   - `{ kind: "list", of, items }` → a collapsible row reading `{n} items`, expanding to the
     items rendered recursively.

   Anything that is not one of those three shapes (a plain object or string — `input` is the
   node's raw config, not a `RuntimeValue`) falls back to a `<pre>` of
   `JSON.stringify(value, null, 2)` in a scrollable, monospace, `text-xs` block. Copy the
   `<pre>` styling from `PrintJobsTable.tsx:129`.

   A string ending in `more characters`, an array whose last element ends in `more items`, or an
   object with a `"…"` key is a compaction marker: render it as a muted `Badge`, never as data.
   A truncated value must never read as a complete one.

   Depth-cap the recursion at 5 and render `…` beyond it.

2. `ConditionDetail.tsx` takes the parsed `detail` JSON (shape `NodeDetail` from Task 4) and
   renders, per path, in order:
   - a heading row: the path's position (`If`, `Else if`, `Else` — derive from index and
     whether `evaluations` is empty) and a "taken" marker when `taken` is true;
   - one line per evaluation: `<RuntimeValueView>` for `left`, the operator's human label, then
     `<RuntimeValueView>` for `right`, then a pass/fail marker. When `passed` is `null`, render
     the `reason` in place of the marker.
   - the path's `combinator` (`and` / `or`) shown between lines when there is more than one.

   Operator labels: resolve from `WORKFLOW_OPERATORS` (exported from `@carbon/workflows`). If
   that export turns out not to carry display labels, fall back to the raw operator string —
   do not invent a second label map.

   Guard the whole component: if `detail` is null, not an object, or its `kind` is not
   `"condition"`, render nothing.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm exec biome check apps/erp/app/modules/workflows/ui/Runs/
# Expected: no error-severity findings
```

**Out of scope:** Do not add a copy-to-clipboard or JSON-editing affordance. Do not install a
JSON-viewer dependency — adding a production dependency needs a separate ask.

---

## Task 12: `WorkflowRunSteps` — the merged step list

**Depends on:** Task 3, Task 11
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Runs/WorkflowRunSteps.tsx`
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Printing/PrintJobsTable.tsx:78`
  (`ExpandedRowContent` — an expandable detail block under a row) and
  `apps/erp/app/modules/workflows/ui/Builder/nodes/meta.ts` (`NODE_KIND_META` — a node's icon,
  accent and title)

**Steps:**

1. Props: `{ steps: WorkflowRunStep[]; definition: WorkflowDefinition | null; compacted: boolean;
   stepsPurged: boolean }`.

2. When `stepsPurged` is true (the run has a header but no step rows and is older than the
   30-day window), render only an explanatory block:
   *"Step detail is kept for 30 days. This run's steps have been removed."* and return.

3. Otherwise build the row list:
   - `const order = topologicalNodeOrder(definition)` from `@carbon/workflows` (Task 3); when
     `definition` is null, fall back to the steps' own `sequence` order and skip the
     "not reached" rows entirely.
   - Group `steps` by `nodeId`. Within a node, the row with `itemKey === ""` is the node's own
     row (for a batch action, its aggregate); rows with a non-empty `itemKey` are its items.
   - Walk `order`. For each node id, emit one row: if it has step rows, the node row; if it has
     none, a **greyed "Not reached"** row.
   - Any step row whose `nodeId` is not in `order` (the definition changed, or the fallback
     path) is appended at the end in `sequence` order.

4. A node row shows: the kind icon and accent from `NODE_KIND_META[node.type]`, the title
   (`node.data.title` → `NODE_KIND_META[node.type].title?.(node)` →
   `NODE_KIND_META[node.type].defaultTitle` — copy the exact resolution used by
   `ui/Builder/nodes/WorkflowNodeCard.tsx`), `<StepStatus />`, the duration, and
   `statusReason` inline as muted text when present.

   When the node's `output` contains a `{kind:"list"}` value, also show an item count chip
   (`{n} items`) on the row. Drop-off between a lookup that returned 40 and a filter that
   passed 3 should be visible without expanding anything.

   Expanding a node row shows three labelled sections, each rendered with `RuntimeValueView`:
   **Input** (`step.input`), **Output** (`step.output`), and — only when `step.detail` is a
   condition detail — **Why**, rendered with `ConditionDetail`. Omit a section whose value is
   null. Below them, when the node has item rows, list them: item key, status, duration,
   `statusReason`.

5. When `compacted` is true, show one muted note above the list: *"Values in this run have been
   summarised. Full detail is kept for 7 days."*

6. Ordering must be **stable** — the same input must always produce the same row order, because
   Task 14 revalidates this list live and a row that moves under the cursor is a real bug
   (Airflow #23542). Use the node id as the React `key`, never the array index.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm exec biome check apps/erp/app/modules/workflows/ui/Runs/
# Expected: no error-severity findings
```
Then open a run of a workflow that stopped early — expect every node of the workflow listed,
with the unreached ones greyed and labelled "Not reached".

**Out of scope:** Do not render the canvas or import anything from `reactflow` — the graph
overlay is a non-goal. Do not fetch anything; every value comes from props.

---

## Task 13: `WorkflowRunDetail` — header, banners, chain

**Depends on:** Task 10, Task 12
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Runs/WorkflowRunDetail.tsx`
- Modify: `apps/erp/app/routes/x+/workflows+/runs.$runId.tsx` — use the real component
- Copy from (precedent): `apps/erp/app/components/AuditLog/AuditLogDrawer.tsx` (drawer body
  layout: a header block of label/value pairs above a scrolling list)

**Steps:**

1. Props: `{ run, steps, chain }` straight from the loader.

2. Parse the frozen definition once:
   ```ts
   const read = readWorkflowVersion(run.workflowVersion);
   const definition = read.ok ? read.definition : null;
   ```
   `readWorkflowVersion` is exported from `@carbon/workflows`; it takes the version row and
   returns `{ ok: true, definition }` or `{ ok: false, failure, message }`. When it fails, show
   a muted note (*"This version's definition could not be read."*) and pass `definition: null`
   down — the step list still renders what ran.

3. Render, top to bottom:
   - **Header** — workflow name (linked to `path.to.workflow(run.workflowId)`), a `v{n}` badge
     from `run.workflowVersion?.versionNumber`, `<RunStatus />`, owner (`EmployeeAvatar`),
     started, duration, the trigger event's human label, the triggering record (same cell logic
     as Task 10), and `sourceEventId` in a selectable monospace line — it is the key support
     will ask for.
   - **Error banner** when `run.status === "Failed"` and `run.error` is set: the error text and
     a button that scrolls to the first step with `status === "Failed"` and expands it. Use the
     existing `Alert`/`Callout` component family in `@carbon/react` — grep
     `packages/react/src/` before writing one.
   - **Blocked callout** when `run.status === "Blocked"`: `run.statusReason` verbatim, the
     chain as workflow names resolved from `run.path` (fall back to the raw ids), and a link to
     `path.to.workflowRun(run.causedByRunId)` when set.
   - **Skipped callout** when `run.status === "Skipped"`: `run.statusReason` verbatim.
   - **Chain** when `run.rootRunId` is set and `chain.length > 1`: each entry as a row indented
     by `depth`, showing its workflow name and `<RunStatus />`, linked to
     `path.to.workflowRun(entry.id)`, with the current run marked and not linked. A
     `causedByRunId` that does not appear in `chain` renders as *"This run is no longer
     available"* — ancestors are deliberately not foreign keys, so a purged one leaves a
     dangling id.
   - **`<WorkflowRunSteps />`**, with `compacted={run.compactedAt !== null}` and
     `stepsPurged={steps.length === 0 && run.compactedAt !== null}`.

4. Wire it into `runs.$runId.tsx` in place of the placeholder.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm exec biome check apps/erp/app/modules/workflows/ui/Runs/
# Expected: no error-severity findings
```
Then click a run in the list — expect a full-screen drawer with the header, the step list, and
a working close that returns to `/x/workflows/runs`.

**Out of scope:** Do not add editing, re-running, or deleting a run. Do not query anything from
the component — all data comes from the loader.

---

## Task 14: `RunLiveUpdates` — realtime while in flight

**Depends on:** Task 13
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Runs/RunLiveUpdates.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Runs/WorkflowRunsTable.tsx` — mount it for the list
- Modify: `apps/erp/app/modules/workflows/ui/Runs/WorkflowRunDetail.tsx` — mount it for the run
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/printing.jobs.tsx:201`
  (the print queue's `useRealtime("printJob")` call site) and
  `apps/erp/app/hooks/useDebouncedRealtime.ts:15` (signature and behaviour)

**Steps:**

1. `RunLiveUpdates.tsx` exports two tiny components. Each one does nothing but call the hook and
   `return null`. Mounting them conditionally is what starts and stops the channel — the hook
   itself has no enable flag.

   ```tsx
   export function RunsLiveUpdates({ companyId }: { companyId: string }) {
     useDebouncedRealtime("workflowRun", `companyId=eq.${companyId}`);
     return null;
   }

   export function RunLiveUpdates({ runId }: { runId: string }) {
     useDebouncedRealtime("workflowStepRun", `runId=eq.${runId}`);
     useDebouncedRealtime("workflowRun", `id=eq.${runId}`);
     return null;
   }
   ```

   `useDebouncedRealtime(table, filter, debounceMs = 1500)` revalidates the route loader after
   1.5 s of quiet rather than merging events client-side — the same choice the print queue
   makes, and it keeps loader data the single source of truth. The caller must supply the
   filter; the hook does not add `companyId` itself.

2. In `WorkflowRunsTable`, render `<RunsLiveUpdates companyId={companyId} />` **only when at
   least one row on the page is non-terminal** (`status` is `Queued` or `Running`). Get
   `companyId` from the existing user/company hook the module already uses — check
   `apps/erp/app/hooks/index.ts` and copy how `useDebouncedRealtime`'s own call sites obtain it;
   do not thread it through the loader if a hook already provides it.

3. In `WorkflowRunDetail`, render `<RunLiveUpdates runId={run.id} />` **only when**
   `run.status === "Queued" || run.status === "Running"`.

4. Confirm the step list's ordering is unchanged by a revalidate (Task 12 step 6). If a
   revalidate reorders rows, fix the ordering, not the refresh.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```
Then, with the dev stack running, trigger a workflow while the run detail is open — expect step
rows to appear within ~2 s without a manual refresh, no visible row reordering, and no further
network activity once the run reaches a terminal status.

**Out of scope:** Do not add polling as a fallback. Do not subscribe without a filter — an
unfiltered `workflowStepRun` subscription would revalidate on every company's every step.

---

## Task 15: Last Run column on the Workflows list

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/routes/x+/workflows+/_index.tsx` — a third loader call
- Modify: `apps/erp/app/modules/workflows/ui/WorkflowsTable.tsx` — a new column and a new prop
- Copy from (precedent): the `versionNumbers` lookup already in `_index.tsx:29-44` — same
  shape: collect the ids from the page, one extra query, reduce into a `Record`

**Steps:**

1. In the loader, after the `versionNumbers` block, add:
   ```ts
   const workflowIds = rows.map((row) => row.id);
   const lastRuns: Record<string, WorkflowLastRun> = {};
   if (workflowIds.length) {
     const runs = await getWorkflowLastRuns(client, workflowIds, companyId);
     for (const run of runs.data ?? []) {
       if (run.workflowId) lastRuns[run.workflowId] = run;
     }
   }
   ```
   and return `lastRuns` alongside `data`, `count`, `versionNumbers`.

2. In `WorkflowsTable.tsx`, add `lastRuns: Record<string, WorkflowLastRun>` to the props type
   and a new column between `activeVersionId` ("Live Version") and `active`:
   - `accessorKey: "id"` is already taken by nothing visible — use `id: "lastRun"` with a
     `header` of `t\`Last Run\`` and a `cell` that reads `lastRuns[row.original.id]`;
   - the cell renders `<RunStatus status={…} />` plus a relative time, wrapped in a link to
     `path.to.workflowRun(lastRun.runId)`;
   - a workflow with no entry renders an em dash;
   - add `meta: { filterHeader: t\`Last Run\`, exportValue: (row) => lastRuns[row.id]?.status ?? "" }`
     so the CSV export and sort picker behave (see `.claude/rules/table-csv-export.md`).
3. Pass `lastRuns` from the route into the table.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```
Then visit `/x/workflows` — expect a "Last Run" column showing a status badge for workflows
that have fired and an em dash for those that have not.

**Out of scope:** Do not make the column server-sortable — the view is not part of the
`workflow` table's sort surface and wiring it would need a join. Do not query per row.

---

## Task 16: Runs link in `BuilderHeader`

**Depends on:** Task 9
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/BuilderHeader.tsx`
- Copy from (precedent): the existing buttons in that same file (the issues button and the
  owner picker) — match their size, variant and spacing exactly

**Steps:**

1. Add a Runs button beside the existing header controls, linking to:
   ```ts
   `${path.to.workflowRuns}?filter=workflowId:eq:${workflowId}`
   ```
   `getGenericQueryFilters` (`apps/erp/app/utils/query.ts:23`) parses `filter` as
   `column:operator:value`, and `getGenericFilter` maps `eq` to `.eq(column, value)` — so this
   is the standard mechanism, not a custom param.
2. Label it `t\`Runs\`` with an `LuHistory` icon, matching the neighbouring buttons' variant.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```
Then open a workflow in the builder and click Runs — expect `/x/workflows/runs` showing only
that workflow's runs.

**Out of scope:** Do not add a tab bar or a nested route to the builder. Do not change
`shouldRevalidate` in `apps/erp/app/routes/x+/workflow+/$id.tsx`.

---

## Task 17: Documentation sync

**Depends on:** Tasks 1-16
**Files:**
- Create: `.claude/rules/workflow-run-history.md`
- Modify: `.claude/rules/workflow-engine.md` — the redaction paragraph and the new `detail`
  column
- Modify: `packages/jobs/AGENTS.md` — the scheduled-function table (if Task 6 did not already)
- Modify: `AGENTS.md` — one row in the Task Router pointing at the new rule
- Modify: `.ai/specs/2026-07-31-workflows-run-history.md` — set status, add a changelog line
- Copy from (precedent): `.claude/rules/workflow-engine.md` (frontmatter `paths:`, structure)

**Steps:**

1. Write `.claude/rules/workflow-run-history.md` with `paths:` frontmatter covering
   `apps/erp/app/modules/workflows/ui/Runs/**`,
   `packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts` and
   `packages/jobs/src/workflows/retention.ts`. Cover: the two routes and what each loads; the
   step list's node-order derivation and the "not reached" rule; the `detail` column's contract
   (diagnostics, never data); the four retention passes, their constants, and the rule that
   every pass filters on a terminal status; the redaction pattern and, explicitly, the words
   deliberately excluded from it and why.
2. Update `.claude/rules/workflow-engine.md` — its "Gotchas" section currently states that
   `redactForLog` "drops any key matching …". That is now wrong: it keeps the key and replaces
   the value, and it now also runs over `output`, `detail`, `error` and `statusReason`. Fix the
   sentence and add the `detail` column to the engine's description.
3. Add one Task Router row under **Domain Modules → Workflows** in the root `AGENTS.md`.
4. Set the spec's status line to `implemented` and add a dated changelog entry recording
   anything that had to diverge from the spec during execution.

**Verify:**
```bash
grep -n "drops any key" .claude/rules/workflow-engine.md
# Expected: no matches (the stale sentence is gone)
grep -n "workflow-run-history" AGENTS.md
# Expected: one match, in the Task Router table
```

**Out of scope:** Do not rewrite unrelated sections of any rule file. Do not move the spec into
`.ai/specs/implemented/` — that happens when the whole workflows programme lands.

---

## Task 18: End-to-end verification

**Depends on:** Tasks 1-17
**Files:** none (verification only)

**Steps:**

1. Run the full scoped check set:
   ```bash
   pnpm --filter @carbon/workflows test
   pnpm --filter @carbon/jobs test
   pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/workflows --filter=@carbon/database
   pnpm exec biome check
   ```
   `pnpm exec biome check` is its own CI gate and must be run alongside typecheck and tests.
   Fix only **error**-severity findings; the repo carries roughly 419 pre-existing warnings and
   those are not this change's to fix. Do not run a whole-repo `typecheck` — it OOMs.

2. Exercise the feature in the running app (ask the user before starting the dev stack if it is
   not already up):
   - trigger a workflow that fires and succeeds → it appears in `/x/workflows/runs` with a
     green badge, and its detail lists every node;
   - open the detail of a workflow that stopped at an early node → every later node is present
     and greyed as "Not reached";
   - open a run whose condition took the `else` path → the **Why** section shows each failing
     clause with both resolved sides;
   - build two workflows that trigger each other → the second firing produces a `Blocked` run
     (orange) whose reason and causing-run link both work;
   - open a run detail while a run is in flight → steps stream in and the subscription stops at
     the terminal status.

3. Exercise the retention job without waiting for 4am. In the Inngest dev UI
   (`pnpm --filter @carbon/jobs dev:jobs`), invoke `workflow-run-retention` manually and check
   its return value `{ reaped, purgedRuns, droppedSteps, compacted }`. To prove each pass, hand-
   age rows in the local database only:
   ```sql
   -- compaction (pass 4)
   UPDATE "workflowRun" SET "completedAt" = NOW() - INTERVAL '8 days'
     WHERE "id" = '<a terminal run id>';
   -- step-detail drop (pass 3)
   UPDATE "workflowRun" SET "completedAt" = NOW() - INTERVAL '31 days'
     WHERE "id" = '<another terminal run id>';
   -- header purge (pass 2)
   UPDATE "workflowRun" SET "completedAt" = NOW() - INTERVAL '91 days'
     WHERE "id" = '<a third terminal run id>';
   -- the reaper (pass 1) — and confirm the passes below leave it alone
   UPDATE "workflowRun" SET "status" = 'Running', "completedAt" = NULL,
     "createdAt" = NOW() - INTERVAL '2 days' WHERE "id" = '<a fourth run id>';
   ```
   Expected after one invocation: the 8-day run's steps have `compactedAt` set and shortened
   payloads; the 31-day run has zero `workflowStepRun` rows but still exists; the 91-day run is
   gone; the stale run is `Failed` with the automatic-closure reason and its `Running` steps are
   settled.

4. Report results honestly: the exact commands run, their output, and anything that did not
   pass. Do not claim a criterion is met without having observed it.

**Verify:**
```bash
pnpm --filter @carbon/workflows test && pnpm --filter @carbon/jobs test && pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/workflows && pnpm exec biome check
# Expected: all four exit 0 (biome may print warnings; error count must be 0)
```

**Out of scope:** Do not commit. Do not run `pnpm lingui:extract`. Do not rebuild the database
— hand-age rows as above and, if that is not enough, ask the user.
