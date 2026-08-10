# Workflows — Phase 4: the engine

> Status: draft
> Author: aashu
> Date: 2026-07-30

## TLDR

Replace the phase-3 stub consumer with the graph walker: it takes a matched
`workflowRun` row, loads the pinned version, and walks it forward one durable
Inngest step per node execution — every database read and write made through a
connection minted as the workflow's **owner**, with their permissions and
nothing more. It ships the runtime value model, structured variable resolution
(including properties reached through a related record), the two idempotency
keys that make "a node never runs twice" true, full run and step logging as
execution happens, the **Condition** and **Filter** executors, and the bounded
batch loop. Lookup, Entity and Action executors are phase 5; this phase defines
the executor seam they plug into.

## Problem Statement

Phase 3 lands the matcher: an announcement or a moment becomes a
`workflowRun` row in status `Queued` plus one `carbon/workflow-run.queued`
event. Nothing consumes it.
`packages/jobs/src/inngest/functions/workflows/run.ts` is a stub that logs and
returns, so every matched run sits at `Queued` forever.

Three things do not exist anywhere in the codebase yet:

1. **A graph walker.** No code reads `workflowVersion.nodes` / `.edges` and
   executes them.
2. **Acting as a user from a background job.** All 41 `getCarbonServiceRole`
   call sites in `packages/jobs/src` run privileged; `getUserScopedClient`
   appears zero times there. This is a security requirement, not an
   optimisation — a workflow must never do something its owner could not do by
   hand.
3. **A runtime for the definition contract.** `@carbon/workflows` can *validate*
   a graph but cannot *evaluate* one: there is no value model, no variable
   resolver and no clause evaluator.

There is also a gap in the phase-1 contract that this phase has to close: the
Filter node is specified to keep the items in a list whose own properties pass
its clauses, but a clause can only name a fixed value or a variable — and
`walkPath` (`packages/workflows/src/definition/validate.ts:364`) refuses to walk
into a list. So "keep the jobs whose due date has passed" is currently
inexpressible; the only legal filter clause is `<whole list> contains <item>`.

## Proposed Solution

### A. Where the code lives

| Layer | Location | Why |
|---|---|---|
| Pure runtime — values, resolution, comparison, Condition + Filter executors, batch planning | `packages/workflows/src/runtime/` | No I/O, so it is unit-testable and a future "test this workflow" preview in the builder reuses it. Keeps the builder and the engine agreeing about semantics the same way they already agree about validation |
| The walker and its I/O adapters | `packages/jobs/src/workflows/engine/` | Follows the phase-3 shape: pure logic in `src/workflows/`, tested directly (`matcher.test.ts` is the model) |
| Inngest wrapper | `packages/jobs/src/inngest/functions/workflows/run.ts` | Already registered in `src/inngest/index.ts` under id `workflow-run`; the export name and id do not change, so registration is untouched |

`packages/workflows` keeps its rule of never importing `@carbon/database` as a
value — the runtime depends on an injected `EntityLoader` interface, never on a
client.

### B. The runtime value model

```ts
// packages/workflows/src/runtime/values.ts
export type RuntimeValue =
  | { kind: "primitive"; of: PrimitiveKind; value: string | number | boolean | null }
  | { kind: "entity"; of: string; id: string }
  | { kind: "list"; of: ScalarType; items: RuntimeValue[] };
```

- Dates are carried as ISO strings and compared as instants.
- An **entity value is a type plus an id** — never a row snapshot. That is what
  keeps a 100-item list cheap enough to write into the run log in full, and it
  matches the retention decision in `technical-decisions.md` §6.
- Fetched rows live in the run's `EntityLoader` cache, beside the value model,
  never inside it.
- Lists are capped at `MAX_LIST_ITEMS` (100, already exported); anything longer
  is sliced and the step row records that it was.

Every `RuntimeValue` is JSON-safe, because it becomes an Inngest step result and
a `workflowStepRun.output` payload.

**Missing is not null.** `null` is a legitimate value with its own
`PrimitiveKind` — a nullable column that is empty compares normally
(`is equal to nothing` is true). *Unresolvable* is different: the upstream node
never ran, or a referenced record could not be read. That is what the PRD's
"missing data" means, and it stops the node.

```ts
export type Resolution =
  | { ok: true; value: RuntimeValue }
  | { ok: false; reason: string };   // customer-facing, names the variable
```

### C. Contract change: the "current item" value

`valueOrRefSchema` gains a third variant so a clause can talk about the item a
loop is currently on:

```ts
// packages/workflows/src/definition/types.ts
export const itemRefSchema = z.object({
  kind: z.literal("item"),
  path: z.array(z.string()).default([])
});

export const valueOrRefSchema = z.discriminatedUnion("kind", [
  literalSchema, variableRefSchema, itemRefSchema
]);   // the existing literal superRefine is preserved
```

- **Item scope.** A node has one if it loops: a `filter` node (scope = the item
  type of `data.source`), and an `action` node with `data.batch === true`
  (scope = the item type of its single list-typed input). An `item` value used
  in a node with no item scope is a new fatal issue code,
  `ITEM_OUTSIDE_LOOP`.
- **Typing.** `NodeContext.typeOf` resolves an `item` value by walking `path`
  from the node's item type through `walkPath`, exactly as it does for a
  variable — so `item.dueDate` on a `list<job>` types as `date`, and
  `item.customerId.name` works through the same entity-crossing rule as §D.
- **Phase 1's invariant is untouched.** A reference to another node still has to
  resolve to a strict ancestor; the regression test that rejects a filter
  reading its own `result` output stays green, because an `item` value is not a
  node reference at all.
- **Batch needs exactly one list.** When `batch` is true, validation requires
  precisely one list-typed input, so "which list are we looping over" is never
  ambiguous. The check is written now; it only bites once action catalogue
  entries exist in phase 5.

This is the one change to a shared public surface in this phase. It is additive:
every existing stored definition still parses.

### D. Variable resolution

Resolving `{kind:"ref", nodeId, output, path}`:

1. Look up `nodeId` in the run's value store (populated by each node's step
   result). Absent → `{ok:false}` — "the step that produces this did not run".
2. Take `output`; absent → `{ok:false}`.
3. Walk `path` one segment at a time. On an **entity** value, the segment is a
   column: if it is not already cached, load the record (§E) and read it. A
   column whose catalog type is an entity yields
   `{kind:"entity", of, id}` from the id it holds, or a `null` primitive when
   the id is empty.
4. A path may not walk into a list — validation already guarantees it never
   does.

An `item` value resolves identically, starting from the loop's bound item
instead of a node output.

**The entity loader**

```ts
// packages/workflows/src/runtime/resolve.ts
export interface EntityLoader {
  load(entity: string, id: string): Promise<Record<string, unknown> | null>;
}
```

The job-side implementation reads `REGISTRY_ENTRIES[entity].table`, then
`client.from(table).select("*").eq("id", id).eq("companyId", companyId).maybeSingle()`
**through the owner's connection**, so a record the owner may not see comes back
as `null` and the node stops with a reason rather than leaking it. Results are
cached per run, negatives included, keyed `${entity}:${id}`.

A record trigger pre-seeds that cache: `trigger.record` / `before` / `after`
carry whole rows already, so the common case costs no query at all. A moment
carries only ids, so its first property read costs one.

The cache is in-memory and is rebuilt on an Inngest replay. That is deliberate:
re-reading is cheap and re-reading through the owner's connection means access
is re-checked rather than trusted from a memoised result.

### E. Acting as the owner

The mechanism exists and needs no stored session:
`getUserScopedClient(userId, { workflowRunId })`
(`packages/auth/src/lib/supabase/client.server.ts:14`) mints a **5-minute**
HS256 JWT and returns an anon-key client, so RLS applies in full.
`packages/jobs` already depends on `@carbon/auth`, so there is no packaging work.

Rules this phase establishes:

- **Mint per step, never per run.** The token lives five minutes; a run can
  outlive that across retries. Every `step.run` that touches business data mints
  its own client, inside the step.
- **Always pass `workflowRunId`.** That claim is what
  `dispatch_event_batch()` reads to tag the write
  (`20260730135206_workflows-run-tag.sql:38-40`). An untagged write makes the
  next hop's origin filter and both loop guards go blind, so a workflow chain
  would become invisible to the cycle and depth checks.
- **Explicit permission check as well as RLS.** One durable step at the top of
  the run calls `get_claims(ownerId, companyId)` through the owner's client and
  returns the permission map; because it is a step, it is read exactly once per
  run even across retries. Each node then checks its declared permission
  against that snapshot before executing. A missing permission ends the run
  `Failed` with a customer-facing message naming the module — "The owner of this
  workflow no longer has access to Purchasing." — instead of the zero rows RLS
  alone would produce. RLS stays as the enforcement backstop.
- **Phase 4 checks the trigger event's declared permission** (`CatalogEvent.permission`)
  at the top of the run. Condition and Filter declare none. The per-node hook is
  part of the executor seam so phase 5's actions and lookups drop into it.
- **The only privileged client is for the engine's own bookkeeping.** RLS on
  `workflowRun` and `workflowStepRun` is SELECT-only by design ("Run logs are
  written by the engine as service-role"), so status transitions and step rows
  go through `getJobDatabaseClient()` (Kysely), always scoped by `companyId`.
  No business read or write ever uses it.

### F. The walk

```
step "load"        → guards, pin the version, mark the run Running
step "permissions" → get_claims snapshot
step "node:<id>"   → one per node execution (see G)
   … repeated, frontier-driven …
step "finish"      → settle interrupted steps, set the run's terminal status
```

**`load` guards**, in order, each ending the run cleanly rather than throwing:

| Situation | Outcome |
|---|---|
| `workflowRun` row absent | `NonRetriableError` — the matcher is the only writer, so this cannot self-heal |
| run status is not `Queued` | return immediately; a double delivery must not restart a run |
| `workflow.active` is false | run `Skipped`, reason "This workflow was switched off before the run started." |
| the pinned `workflowVersion` is missing or `readWorkflowVersion` fails | run `Failed`, reason from the read failure |

The version is loaded **by the `workflowVersionId` on the event**, never by
following `workflow.activeVersionId` — the run was matched against that version
and must execute that version even if a new one was promoted meanwhile.

**Traversal.** Breadth-first from the trigger node, following each executed
node's returned handle, taking outgoing edges in stored order. Deterministic, so
Inngest step ids are stable across replays.

**One execution per node per run.** A node reached a second time (two branches
converging) records a `Skipped` step row with reason "This step already ran in
this run." and nothing flows on from it. That is the `workflowStepRun` unique
key restated as behaviour, and it is visible in the run history rather than
silent.

**Caps.** `MAX_NODE_EXECUTIONS = 500` per run — comfortably above a real graph
even with a 100-item batch, comfortably below Inngest's per-run step ceiling.
Exceeding it ends the run `Failed` with "This workflow ran too many steps."

**Function config** on `workflowRunFunction`:

```ts
{ id: "workflow-run",
  retries: 3,
  idempotency: "event.data.runId",
  concurrency: [
    { limit: 10, key: "event.data.companyId" },   // matches the house per-company limit
    { limit: 5,  key: "event.data.workflowId" }   // one hot workflow cannot eat the pool
  ] }
```

`onFailure` flips the run to `Failed` once retries are exhausted, guarded by
`status in ('Queued','Running')` so a run that already settled is never
clobbered (the `tasks/assembly-plan.ts:32-53` pattern).

### G. Idempotency — the step ledger

Inside every node step, **claim before doing anything**:

```sql
INSERT INTO "workflowStepRun"
  ("runId","companyId","nodeId","itemKey","sequence","nodeType","status","startedAt")
VALUES (…, 'Running', now())
ON CONFLICT ON CONSTRAINT "workflowStepRun_idempotency_key" DO NOTHING
RETURNING "id";
```

- **Zero rows back means someone already executed this node for this item.** If
  that row is terminal, its recorded output is reused so the walk continues
  correctly; if it is still `Running`, this execution is recorded as skipped and
  does not repeat the work.
- The work then runs, and the row is settled to `Succeeded` / `Failed` /
  `Skipped` with `input`, `output`, `branchTaken`, `durationMs`, `error`.
- **Chosen trade-off: at most once.** A crash between claiming and acting loses
  that action rather than repeating it. In an ERP a duplicated posting is worse
  than a missing one, and the loss is *visible*: the `finish` step marks every
  row still `Running` as `Failed` with "This step was interrupted.", so a lost
  action appears in the run history instead of vanishing.
- `itemKey` is `''` for a non-batch node (the column is `NOT NULL DEFAULT ''`
  precisely so a single row still collides with its own retry). In batch mode it
  is the item's entity id, or the first 16 hex characters of a SHA-256 of the
  resolved item when it has no id. **Never the position in the list** — a retry
  can re-read a list in a different order.
- `sequence` is a per-run counter assigned by the walker; deterministic because
  the walk order is.

Run-level dedupe already exists: `workflowRun_dedupe_key` on
`(workflowId, companyId, workflowVersionId, sourceEventId)`, enforced by the
matcher, plus the Inngest `idempotency` key above.

### H. The Condition executor

- Paths are evaluated in stored order. The first `if` / `else-if` whose clauses
  pass wins; an `else` path always passes.
- A path's clauses are combined with its single `combinator` (`and` / `or`),
  left to right. The schema allows only one combinator per path, so there is no
  precedence to define.
- **Any operand that cannot be resolved stops the node**: status `Skipped`,
  reason naming the variable. It does not fall through to `else` — a comparison
  we could not make is not a comparison that came out false.
- **No path matched and no `else`**: status `Succeeded`, `branchTaken` recorded
  as `none`, nothing flows on. The condition genuinely ran; the run history
  shows why nothing followed.
- `branchTaken` is the winning path's id, which is also the handle the walk
  follows.

**Comparison semantics** (operand types already agree — validation guarantees
it):

| Type | Operators | Notes |
|---|---|---|
| number | `eq neq gt gte lt lte` | plain numeric |
| date | `eq neq gt gte lt lte` | parsed to an instant; an unparseable string resolves as `null` |
| string | `eq neq` **case-sensitive**; `contains startsWith endsWith` **case-insensitive** | matches what people expect from no-code tools: searching text is forgiving, `is equal to` is exact because it is usually an id, code or status |
| boolean, null | `eq neq` | |
| entity | `eq neq` | compares type **and** id |
| list | `contains` | membership, using the same equality as `eq` for the item type |

`null` on either side never throws: `null eq null` is true, every ordering
comparison against `null` is false.

### I. The Filter executor

- Reads the `source` list. Unresolvable source → node `Skipped` with a reason.
- Evaluates its clauses against each item with the item bound as the `item`
  scope from §C, keeping the ones that pass. Never mutates an item.
- An item whose clause operands cannot be resolved is **dropped**, and the step
  row records how many were dropped for that reason. (A filter's job is to
  narrow; stopping the whole node because one of eighty jobs has an empty field
  would be the wrong failure.)
- Output is a list of the same type, always the same length or shorter.
- A filter is one step, not one per item — it has no side effects, so there is
  nothing per-item to make idempotent.

### J. Batch mode

Batch belongs to nodes that can act, so the machinery lands here and its only
consumer arrives in phase 5.

- A node with `batch: true` resolves its single list input, slices to
  `MAX_LIST_ITEMS` (100), and runs **one Inngest step per item**, each claiming
  its own `workflowStepRun` row keyed by that item.
- Item order is the list's order; `itemKey` is per §G, so re-reading the list in
  a different order still lands on the same rows.
- A failing item does not stop the others by default; the node's overall result
  is `Succeeded` when at least one item succeeded and `Failed` when all did,
  with per-item detail in the step rows.
- The node's outputs are a `list` of the per-item outputs, in item order.
- Batch stays unavailable on Lookup (a list of lists is out of scope).

### K. What the run log records

Written as execution happens, never batched at the end:

- `workflowRun`: `Running` + `startedAt` up front; terminal status,
  `completedAt`, `durationMs`, and `error` / `statusReason` at the end.
- `workflowStepRun`: one row per node execution with `sequence`, `nodeId`,
  `nodeType`, `itemKey`, resolved `input`, `output`, `branchTaken`, timing, and
  `error`.
- **Skipped steps are recorded with their reason, always.** "Why did my workflow
  do nothing" is the single most common support question for this kind of
  feature, and this is the answer to it.
- Values are stored in full (an entity is a type plus an id, so this is cheap).
  Only genuinely large free text is capped on write. Compaction and purge are
  phase 9 and must filter on a terminal status, never age alone — while a run is
  in flight its step rows *are* the idempotency ledger.
- Never stored: secrets, request headers, response bodies beyond a short
  excerpt.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Retry safety | Claim the step row before acting; at most once | A duplicated posting is worse than a missing one in an ERP. The loss is made visible by settling interrupted rows as `Failed` at the end of the run |
| Properties through a related record | Resolve now, loading on demand with a per-run cache | Validation already permits these paths, and a moment trigger hands over only ids — without it the most ordinary conditions silently skip |
| Two branches meeting at one node | Runs once, on first arrival; the second is a `Skipped` row | Restates the `workflowStepRun` unique key as behaviour, and stays visible |
| Workflow switched off between match and run | Re-check `active`; end the run `Skipped` with a reason | One read the engine already makes. Somebody switching off a misbehaving workflow must not still see it act |
| Run status when a branch stops early | `Succeeded`, with the skipped step and its reason in the log | Keeps `Failed` meaning something went wrong; the step list is where "why nothing happened" is answered |
| Text comparison | `contains` / `startsWith` / `endsWith` ignore case; `eq` / `neq` respect it | Searching text is forgiving; `is equal to` is usually an id, code or status where case is meaningful |
| Naming the current item in a loop | A third value form, `{kind:"item", path}` | Explicit, reads naturally in the builder, reusable by batch, and it leaves phase 1's "a node never reads itself" invariant and its regression test intact |
| Which version executes | The `workflowVersionId` pinned on the event | The run was matched against that version; promoting a new one mid-flight must not change what this run does |
| Where the owner's connection is minted | Inside every step | The token lives five minutes and a run can outlive that across retries |
| Where the owner's permissions are read | One durable step at the top of the run | Memoised by Inngest, so exactly one read per run; permissions do not change inside a run that normally lasts under a second |
| Privileged access | Only for `workflowRun` / `workflowStepRun` writes | Their RLS is SELECT-only by design. No business read or write ever uses it |
| Where the semantics live | Pure runtime in `@carbon/workflows`, I/O in `packages/jobs` | The builder and the engine must not disagree about what a clause means, the same reason validation is already shared |
| Batch with several list inputs | Validation requires exactly one | Otherwise "which list are we looping over" is undefined |
| Total work per run | 500 node executions | Above any real graph including a 100-item batch, below Inngest's per-run step ceiling |

### What this phase deliberately does not build

- **Lookup, Entity and Action executors** — phase 5, which also brings the
  action and operation catalogues. Until then a graph using them fails
  validation with `UNKNOWN_ACTION` / `UNKNOWN_OPERATION`, so none can be
  activated and none can reach the engine.
- **The scheduler** — phase 6. `RunTrigger` has no `schedule` variant yet.
- **Compaction, purge and the run-history screen** — phase 9.
- **Webhook signing, notification payload kinds** — phase 5.
- **Failure handles.** They exist only on Lookup and Action, so wiring them is
  phase 5; the executor seam returns the handle to follow, so it needs no
  change then.

## Data Model Changes

**None.** The foundation migration
(`20260730142317_workflows-foundation.sql`) already provides every column this
phase writes: `workflowRun.status` / `startedAt` / `completedAt` / `durationMs`
/ `error` / `statusReason`, and `workflowStepRun` with `sequence`, `nodeId`,
`nodeType`, `itemKey`, `input`, `output`, `branchTaken`, timing, `error`, plus
both unique constraints. Realtime is already enabled on both tables.

The only contract change is in TypeScript: the additive `item` variant on
`valueOrRefSchema` (§C), which every stored definition parses unchanged.

## API / Service Changes

### New files

```
packages/workflows/src/runtime/types.ts        RuntimeValue, Resolution, NodeResult,
                                               NodeExecutor, ExecutionContext, EntityLoader
packages/workflows/src/runtime/values.ts       constructors, JSON codec, list capping
packages/workflows/src/runtime/resolve.ts      resolveValue / resolveRef / item scope
packages/workflows/src/runtime/compare.ts      operator semantics, clause + path evaluation
packages/workflows/src/runtime/condition.ts    the Condition executor
packages/workflows/src/runtime/filter.ts       the Filter executor
packages/workflows/src/runtime/batch.ts        item slicing and itemKey derivation
packages/workflows/src/runtime/index.ts        barrel, re-exported from src/index.ts

packages/jobs/src/workflows/engine/walk.ts     pure frontier walk: next nodes for a handle,
                                               seen-set, sequence, caps
packages/jobs/src/workflows/engine/owner.ts    per-step owner client, claims, permission check
packages/jobs/src/workflows/engine/loader.ts   EntityLoader over the owner's client, per-run cache
packages/jobs/src/workflows/engine/ledger.ts   claim / settle workflowStepRun
packages/jobs/src/workflows/engine/log.ts      workflowRun status transitions
packages/jobs/src/workflows/engine/execute.ts  orchestration: load, permissions, walk, finish
```

### Modified files

- `packages/jobs/src/inngest/functions/workflows/run.ts` — the stub body is
  replaced by a call into `execute.ts`, and the concurrency / idempotency config
  is added. Export name and function id are unchanged, so
  `packages/jobs/src/inngest/index.ts` needs no edit.
- `packages/workflows/src/definition/types.ts` — the `item` value variant.
- `packages/workflows/src/definition/nodes.ts` — item-scope typing in
  `checkClauses` / `checkInputs`; the single-list rule for batch.
- `packages/workflows/src/definition/issues.ts` — `ITEM_OUTSIDE_LOOP`.
- `packages/workflows/src/index.ts` — export the runtime barrel.

## UI Changes

**N/A.** The builder is phases 7 and 8. Run history is phase 9. The only
customer-visible surface this phase produces is the text of the reasons written
into `workflowRun.statusReason` / `error` and `workflowStepRun.error`, which
those screens later render — so they are written as customer-facing sentences,
not developer strings.

## Acceptance Criteria

- [ ] A workflow whose trigger is `purchaseOrder.orderTotal.changed`, wired to a
      condition `record.orderTotal > 10000` with an `else` path, produces on a
      5,000 → 20,000 change: a `workflowRun` in `Succeeded`, exactly one
      `workflowStepRun` for the condition, `branchTaken` equal to the `if`
      path's id, and non-null `startedAt` / `completedAt` / `durationMs`.
- [ ] The same workflow on a 20,000 → 21,000 change where the clause is
      `record.orderTotal > 10000 AND before.orderTotal <= 10000` records
      `branchTaken` = the `else` path's id — the PRD's crossing case.
- [ ] Re-delivering the identical `carbon/workflow-run.queued` event creates no
      second `workflowStepRun` row and does not change the run's
      `completedAt`.
- [ ] A condition comparing `record.supplierId.name` succeeds; the supplier row
      is read exactly once even when two clauses reference it; the read is
      issued through a client minted by `getUserScopedClient` and not through
      `getJobDatabaseClient`.
- [ ] With the owner stripped of `purchasing_view`, the same run ends `Failed`
      with an `error` naming Purchasing, and no business read reaches the
      database.
- [ ] A condition referencing an output of a node that never ran records a
      `Skipped` step row whose reason names the variable, and the run still ends
      `Succeeded`.
- [ ] A condition on a column that is genuinely `NULL` evaluates rather than
      skipping: `is equal to nothing` is true.
- [ ] A graph where two condition branches converge on one node produces one
      executed step row and one `Skipped` row with reason "This step already ran
      in this run."
- [ ] Deactivating the workflow after the run is queued but before it executes
      ends the run `Skipped` with a reason, and zero step rows.
- [ ] A filter over a 5-item `list<job>` with `item.dueDate < <date>` outputs a
      list of exactly the 2 matching jobs, in the source order, and records the
      count kept and dropped.
- [ ] A batch node over a 150-item list executes exactly 100 times, writes 100
      step rows whose `itemKey`s are the items' entity ids, and returns a
      100-item list output.
- [ ] Killing the worker after a step row is claimed but before it settles
      leaves that row `Failed` with "This step was interrupted." once the run
      reaches `finish`, and the node is not executed a second time.
- [ ] `grep -rn "getCarbonServiceRole\|getJobDatabaseClient" packages/jobs/src/workflows/engine`
      returns hits only in `ledger.ts` and `log.ts`.
- [ ] Every write the engine makes carries the run tag: a workflow whose action
      edits a watched record produces a downstream announcement whose
      `workflowRunId` is this run's id (verified once phase 5 lands an action;
      until then, asserted on the minted token's claims).
- [ ] `pnpm --filter @carbon/workflows test`, `pnpm --filter @carbon/jobs test`,
      `pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/jobs --filter=erp`
      and `pnpm exec biome check` all pass.

## Risks

- **Losing an action on a crash.** The accepted cost of claim-first. Mitigated
  by settling interrupted rows as `Failed` so it is never silent; a re-run is a
  deliberate human act, which is the right default for an ERP.
- **Token expiry inside a long step.** Five minutes is generous for one node,
  but a phase-5 action calling a slow service could exceed it. Minting per step
  bounds the exposure to one node; if it becomes real, the fix is minting per
  database call, not lengthening the token.
- **TS2589 in `apps/erp`.** The repo is chronically near TypeScript's
  instantiation budget and this phase widens `valueOrRefSchema` into a
  three-way union used inside `clauseSchema`. The union stays flat and
  non-recursive, and `--filter=erp` typecheck is an acceptance criterion rather
  than an afterthought.
- **An import fanning out to hundreds of runs.** 500 changed rows × N matching
  workflows is 500N runs. The per-company concurrency key is the only
  protection, so it must be on the function from the first commit.
- **`get_claims` shape drift.** The permission snapshot is read once per run
  from an RPC written for the request path. If its result shape differs from
  what `makePermissionsFromClaims` expects, the failure must be a clear run
  error, not a silent allow — so an unreadable claims result ends the run
  `Failed`, never "no permissions found, continue".

## Open Questions

- [x] When a node has acted but the engine crashes before recording it, should
      the retry repeat the work? — **Answer:** No. Claim the step row as
      `Running` before acting, so the retry stops; at most once. A duplicated
      posting is worse than a missing one, and the `finish` step settles
      interrupted rows as `Failed` so the loss is visible in the run history.
- [x] Should phase 4 resolve properties reached through a related record
      (`record.supplierId.name`), which means loading that record? —
      **Answer:** Yes, with a per-run cache, read through the owner's
      connection. Validation already permits these paths and a moment trigger
      hands over only ids, so deferring would let the builder draw conditions
      the engine cannot evaluate.
- [x] What happens when two branches converge on one node? — **Answer:** It runs
      once, on first arrival; the second arrival is a `Skipped` step row reading
      "This step already ran in this run." That is the `workflowStepRun` unique
      key restated as behaviour, and it stays visible rather than silent.
- [x] Should the engine re-check that the workflow is still switched on before
      walking? — **Answer:** Yes; if it was switched off, end the run `Skipped`
      with a reason. It costs one read the engine already makes, and someone
      switching off a misbehaving workflow must not still see it act.
- [x] What status should a run show when a node stops early and most of the
      workflow never happens? — **Answer:** `Succeeded`, with the skipped step
      and its reason in the log. `Failed` should keep meaning something actually
      went wrong; the step list is where "why did nothing happen" is answered.
- [x] Should capital letters matter in text tests? — **Answer:** No for
      `contains` / `startsWith` / `endsWith`, yes for `eq` / `neq`. Searching
      text should be forgiving; `is equal to` is usually applied to an id, code
      or status where case is meaningful.
- [x] The Filter node cannot currently name the item it is testing — the saved
      format has no "current item" and `walkPath` refuses to walk into a list.
      How is that closed? — **Answer:** Add a third value form,
      `{kind:"item", path}`, alongside a fixed value and a variable. It is
      explicit, reads naturally in the builder, is reusable by batch mode, and
      leaves phase 1's "a node never reads itself" invariant — and its
      regression test — intact.

## Cross-phase dependencies this phase creates

- **Phase 5** implements `NodeExecutor` for Lookup, Entity and Action against
  the seam defined here, declares each node's permission through it, and must
  perform every read and write on the `ExecutionContext`'s owner-scoped client
  — a service-role, Kysely or edge-function write is untagged and invisible to
  the loop guards. Its batch-capable actions must honour the single-list rule
  from §C.
- **Phase 6** adds a `schedule` variant to `runTriggerSchema` and supplies
  `sourceEventId = schedule:<workflowId>:<dueAtIso>`; the engine needs no change
  beyond a trigger whose outputs are empty.
- **Phase 7 / 8** render the `item` value form in the clause editor and enforce
  the single-list rule for batch in the builder, and must not re-implement
  comparison semantics — `packages/workflows/src/runtime/compare.ts` is the one
  definition.
- **Phase 9** reads `workflowRun` / `workflowStepRun` as written here, and its
  compaction and purge passes must filter on a terminal status, never age
  alone, because a live run's step rows are the idempotency ledger.

## Research

- `.ai/research/phase4-act-as-owner.md` — `getUserScopedClient`, `get_claims`,
  the MCP act-as-user path, the dispatcher, and why service role defeats the
  phase-3 loop guards.
- `.ai/research/phase4-jobs-conventions.md` — Inngest v3 conventions in
  `packages/jobs`, step patterns, `onFailure`, testing and local dev.

## Changelog

- **2026-07-30** — Initial spec. Seven open questions raised and answered before
  writing: retry safety, cross-record property resolution, converging branches,
  deactivation between match and run, run status on early stop, text-comparison
  case sensitivity, and the missing "current item" in the phase-1 contract.
