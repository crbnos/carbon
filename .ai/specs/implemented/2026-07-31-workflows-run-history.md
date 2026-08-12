# Workflows — Run History and Observability

> Status: draft
> Author: aashu
> Date: 2026-07-31
> Phase brief: `/Users/aashu/work/carbon/plans/automations-engine/phases/phase-9-run-history.md`
> Research: `.ai/research/2026-07-31-workflows-run-history.md` (2112 lines; Zapier, n8n, Make,
> Temporal, Step Functions, Airflow, Inngest, Trigger.dev, Sentry, Rails, Elastic APM,
> OpenTelemetry, OWASP, Stripe, OMB M-21-31)
> Predecessors: `.ai/specs/2026-07-30-workflows-foundation.md` (tables),
> `.ai/specs/2026-07-30-workflows-matcher.md` (blocked runs),
> `.ai/specs/2026-07-30-workflows-engine.md` (step ledger),
> `.ai/specs/2026-07-31-workflows-node-configuration.md` (phase 8)

## TLDR

Every row this phase reads already exists. `workflowRun` and `workflowStepRun` were created in
phase 1, are written on every firing since phase 4, are already in the `supabase_realtime`
publication, and already have a SELECT-only RLS policy gated on `workflows_view`. Nothing in
the ERP reads them. A customer whose workflow did nothing has no way to find out why.

This phase builds the reading experience and the housekeeping that keeps it affordable:

1. A **Runs list** — company-wide under Workflows, and the same table pre-filtered from inside
   a workflow.
2. A **run detail** drawer — every node of the frozen version in graph order, including the
   ones that never ran, with resolved input, output, branch taken and skip reason.
3. **Per-clause condition detail** — for a condition node, which clause passed, with both
   resolved sides. No competitor does this, and it is the literal answer to "why did my
   workflow do nothing".
4. **Live updates** while a run is in flight, over the realtime channel the tables already sit on.
5. **Blocked runs** shown as blocked, linked to the run that caused them and to the rest of the
   chain.
6. A **nightly retention job** — reap stale runs, compact step payloads after 7 days, drop step
   detail after 30, drop run headers after 90 — plus closing the redaction gap that today lets a
   secret reach the `output` column unfiltered.

## Problem Statement

The engine has been writing a complete, correctly-keyed run log since phase 4, and none of it
is visible:

- `apps/erp/app/modules/workflows/workflows.service.ts` exports 12 functions, none of which
  touch `workflowRun` or `workflowStepRun`. A grep for either table name across
  `apps/erp/` returns zero hits.
- There is no `path.to.workflowRuns`. `apps/erp/app/utils/path.ts:2141-2154` has ten workflow
  paths and none of them is a run.
- The matcher writes a `Blocked` run with a `statusReason` and a `causedByRunId` whenever a
  loop guard fires (`packages/jobs/src/workflows/matcher.ts:94-108`). Nothing renders it, so
  the PRD's "a stopped chain shows in the run history, never silently" is currently false — the
  row exists and is unreachable.
- The scheduler writes `Skipped` runs with reasons `TOO_LATE` and `PREVIOUS_RUN_ACTIVE`
  (`packages/jobs/src/workflows/scheduler.ts:178-204`). Same problem.
- `workflowStepRun.statusReason` carries every skip reason the runtime produces — a condition
  whose operand could not be resolved, a batch that dropped items over the cap. Unreachable.
- `compactedAt` exists on both tables and **nothing reads or writes it anywhere**. There is no
  compaction job, no purge job, and no retention of any kind: run rows accumulate forever.
- `redactForLog` (`packages/jobs/src/workflows/engine/ledger.ts:22-38`) is applied to the
  step's `input` column only. `settleStep` writes `output` straight through `toJson`
  (`ledger.ts:104`) and `error` straight through (`ledger.ts:98`). A webhook action's response
  excerpt and a thrown error string both land unfiltered. Building a UI over that column
  without fixing it means shipping a screen that can display a leaked token.
- A run whose Inngest function dies hard enough that neither the `"finish"` step nor the
  `onFailure` handler runs stays `Running` forever. It renders as permanently in flight and,
  because every retention pass must filter on a terminal status, it can never be purged.

## Goals

- Answer "did it fire, did it work, and how long did it take" from a list, for the whole
  company and for one workflow.
- Answer "why did it do nothing" from a run's detail, without the customer having to reason
  backwards from the builder.
- Make a blocked chain and a skipped scheduled run visible and explicable.
- Watch a run stream as it happens.
- Keep the two tables bounded, and stop the current unfiltered leak of secrets into `output`
  and `error`.

## Non-Goals

- **Replay / retry of a run.** Not asked for by the PRD or the phase brief. Zapier's replay
  creates a separate immutable run, has a 60-day window and deliberately never re-evaluates
  Filter/Path steps; Make's Incomplete Executions queue is a durable resumable work queue that
  ships off by default. Both are phases of their own, and both need an answer to what
  `sourceEventId` a replay carries — Carbon's whole idempotency story is keyed on it.
- **Canvas overlay of a past run.** n8n and Make render history on the canvas; n8n's overlay is
  also why n8n cannot show history for a workflow whose definition has since changed. A later
  addition, on top of the same loader.
- **Per-company retention settings.** Tiers are constants.
- **Run quotas or plan gates.** Already settled as out of scope in `technical-decisions.md`.
- **Changing what the engine writes**, beyond the two additions this spec names (clause detail,
  wider redaction). The run log's shape is phase 4's and stays.

## Design

### 1. Schema — one migration, three additive changes

Nothing is dropped or renamed.

**1a. `workflowStepRun.detail JSONB` (nullable).** Diagnostics, explicitly not data.
`output` keeps meaning exactly "the node's outputs map" (`Record<string, RuntimeValue>`,
written at `execute.ts:187`); `detail` is where a node explains itself. Today only the
condition node writes it. The alternative — an envelope inside `output` under a reserved key —
mixes diagnostics with customer-named outputs and would break the moment a customer names an
output `detail`.

**1b. A partial index for the stale-run reaper.**

```sql
CREATE INDEX "workflowRun_stale_idx" ON "workflowRun" ("createdAt")
  WHERE "status" IN ('Queued', 'Running');
```

The existing `workflowRun_purge_idx ("status", "completedAt")` serves the three retention
passes (all of which filter on a terminal status and a `completedAt` cutoff); the reaper's
predicate is the complement of it and has no index today.

**1c. A `workflowLastRun` view**, for the last-run column on the Workflows list. PostgREST
cannot express latest-per-group, and fetching a page of runs and reducing client-side is wrong
(a workflow that has not run recently would silently show nothing).

```sql
CREATE VIEW "workflowLastRun" WITH (security_invoker = on) AS
SELECT DISTINCT ON ("companyId", "workflowId")
  "companyId", "workflowId",
  "id" AS "runId", "status", "statusReason", "createdAt", "completedAt", "durationMs"
FROM "workflowRun"
ORDER BY "companyId", "workflowId", "createdAt" DESC;
```

`security_invoker = on` so the view is read under the caller's RLS — near-universal in this
repo's migrations (593 `security_invoker` clauses against 619 `CREATE VIEW`
statements). The `DISTINCT ON` key
order matches `workflowRun_companyId_workflowId_idx ("companyId", "workflowId", "createdAt" DESC)`.

Everything else the phase needs is already in place: both tables are in `supabase_realtime`
(`20260730142317_workflows-foundation.sql:283-296`), both have SELECT-only RLS gated on
`get_companies_with_employee_permission('workflows_view')` (:264-277), and
`workflowRun_rootRunId_idx` already indexes the chain lookup.

### 2. Engine changes

Two, both small, both in code that already exists.

**2a. Per-clause condition detail.**

`compare.ts:85` already carries the comment *"No short-circuiting: every operand is resolved so
the run history shows both sides"* — the intent is there and only the plumbing is missing.
`evaluateClauses` (`packages/workflows/src/runtime/compare.ts:86`) already resolves both sides
of every clause at lines 94-98 and then throws the operands away, pushing only a `boolean` into
`results`.

Widen its return type to carry what it already computed:

```ts
// Operator is imported from @carbon/utils, as definition/types.ts:1 already does
export type ClauseEvaluation = {
  left: RuntimeValue | null;      // null when it could not be resolved
  operator: Operator;
  right: RuntimeValue | null;
  passed: boolean | null;         // null when either side was unresolvable
  reason?: string;                // why it could not be resolved
};

export async function evaluateClauses(
  clauses: Clause[], combinator: Combinator, ctx: RuntimeContext
): Promise<
  | { ok: true; passed: boolean; evaluations: ClauseEvaluation[] }
  | { ok: false; reason: string; evaluations: ClauseEvaluation[] }
>;
```

The `ok: false` branch must **accumulate before returning** so a run that stopped on clause
three still shows clauses one and two. Both call sites (`condition.ts:22`, `filter.ts`) update.

`NodeResult` (`packages/workflows/src/runtime/types.ts:77`) gains an optional
`detail?: NodeDetail` on its `Succeeded` and `Skipped` variants, where `NodeDetail` is a
discriminated union with one member for now:

```ts
export type NodeDetail = {
  kind: "condition";
  paths: Array<{ pathId: string; combinator: Combinator;
                 evaluations: ClauseEvaluation[]; taken: boolean }>;
};
```

The condition executor records every path it evaluated up to and including the one it took —
so "took else" is shown alongside the `if` and `else-if` clauses that failed, which is the
whole point. `execute.ts` passes `result.detail` into `settleStep`, which writes it to the new
column through the redactor.

The filter node evaluates its clauses per item and is deliberately left alone: one row per
item over a 100-item list is not a debugging aid, it is a wall. Its existing summary
(`Kept 3 of 40`) stays.

**2b. Redaction, widened and made honest.**

Three changes to `redactForLog` and its call sites in
`packages/jobs/src/workflows/engine/ledger.ts`:

- **Applied to `output`, `detail`, `error` and `statusReason`**, not just `input`. This closes
  a live gap: the webhook action's 2 KB response excerpt and any thrown error string reach the
  log unfiltered today.
- **Keep the key, replace the value with `"[REDACTED]"`** instead of deleting the key. Every
  published scrubber does this (Sentry, Rails, Elastic APM, OpenTelemetry) for one reason: a
  dropped key is indistinguishable from a field that was genuinely absent, and telling those
  two apart is the entire job of a run log.
- **Widen the key pattern, carefully:**

  ```
  /secret|token|password|passwd|credential|signature|authorization|apikey|api_key|
   client_secret|clientsecret|private_key|privatekey|bearer|cookie/i
  ```

  Deliberately **not** included, despite appearing in published denylists: bare `key`
  (`itemKey`, `partKey`, `keyword` are ordinary ERP data and `itemKey` is a column of this very
  table), bare `auth` (`authorizedBy`, `author`), and `session`. Elastic's `*key*` and `*auth*`
  wildcards are tuned for HTTP headers, not for business records; over-redaction in a debugging
  tool is a failure too.

- Truncation gets a **counted marker**: strings over 4 KB become
  `<first 4096 chars>… 12043 more characters`, following `util.inspect`'s convention, rather
  than today's bare `…(truncated)`. OpenTelemetry truncates with no marker at all, which reads
  as a complete value — the anti-pattern.

Order of operations is fixed: **redact → truncate**.

**2c. `packages/workflows/src/definition/order.ts` — `topologicalNodeOrder(definition)`.**

A pure, exported, unit-tested helper returning every node id in graph order (trigger first,
then breadth-first over edges, ties broken by the node's position in the definition's array so
the order is stable across renders). The run detail needs it to place nodes that produced no
step row. It belongs in `@carbon/workflows` next to the definition, not in the ERP app, because
it is graph maths over the definition and the builder will want it too.

### 3. Retention — one nightly Inngest function

`packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts`, declared exactly like
its neighbours:

```ts
inngest.createFunction(
  { id: "workflow-run-retention", retries: 2 },
  { cron: "0 4 * * *" },
  async ({ step, logger }) => { ... }
)
```

`0 4 * * *` sits in the existing nightly slot, after audit-archive (`0 2`) and
notification-purge (`0 3`) and before cleanup (`0 7`). Registered in three places, as every
scheduled function is: the barrel
`packages/jobs/src/inngest/functions/scheduled/index.ts`, the import block at
`packages/jobs/src/inngest/index.ts:42-51`, and the `functions` array's `// Scheduled` section
at `~:118-126`. (`packages/jobs/AGENTS.md` flags a new function registration as an
ask-first — this spec is that ask.)

Constants, at module scope:

```ts
const STALE_RUN_HOURS = 24;
const FULL_DETAIL_DAYS = 7;
const COMPACT_DETAIL_DAYS = 30;
const RUN_HEADER_DAYS = 90;
const TERMINAL = ["Succeeded", "Failed", "Blocked", "Skipped"] as const;
const BATCH = 500;
const MAX_BATCHES = 20;
```

Four `step.run` passes, in this order (each pass shrinks the input of the next):

| # | Step id | What it does |
|---|---------|--------------|
| 1 | `reap-stale-runs` | `status IN ('Queued','Running') AND createdAt < now-24h` → `finishRun(Failed)` with `"This run stopped reporting and was closed automatically after 24 hours."`, then `failInterruptedSteps` for each. Closes the leak that would otherwise make these rows immortal. |
| 2 | `purge-run-headers` | `status IN TERMINAL AND completedAt < now-90d` → delete the run rows. Step rows cascade (`workflowStepRun.runId` FK is `ON DELETE CASCADE`); `rootRunId` / `causedByRunId` are deliberately not FKs, so a purged ancestor leaves a dangling id the UI renders as "no longer available" — the matcher already handles the same case with a synthetic trace. |
| 3 | `drop-step-detail` | `status IN TERMINAL AND completedAt < now-30d` → delete that run's `workflowStepRun` rows. The run header survives to 90 days. |
| 4 | `compact-step-payloads` | `status IN TERMINAL AND completedAt < now-7d AND compactedAt IS NULL` → rewrite each step's `input` / `output` / `detail` to their compacted form, stamp `compactedAt` on the step rows and on the run. |

Every pass filters on a **terminal status**, never on age alone — while a run is in flight its
step rows *are* the idempotency ledger. Pass 1 is what guarantees that filter cannot strand a
row forever.

Each pass is a bounded loop: at most `MAX_BATCHES` iterations of `BATCH` runs. Whatever is left
over is picked up the next night, and the pass **logs the leftover count** — a silent cap reads
as "we covered everything".

The client is `getJobDatabaseClient()` (Kysely), not the Supabase service role
notification-purge uses: compaction rewrites JSONB per row and the delete passes are keyed on a
set of run ids.

**Compaction** is a pure function, `compactForLog(value)`, in
`packages/jobs/src/workflows/retention.ts`, unit-tested alongside `redactForLog`:

- a list keeps its first **5** items, then `{ "…": "95 more items" }`;
- a string keeps its first **256** characters, then `… 3891 more characters`;
- an object keeps its first **20** keys, then `"…": "7 more keys"`;
- recursion is depth-capped at **5**;
- an entity `RuntimeValue` (`{kind:"entity", of, id}`) is already two fields and is left alone —
  which is the reason the 7-day full-fidelity window is affordable at all: a list of 100 parts
  is 100 ids, not 100 row snapshots.

### 4. Service layer

New functions in `apps/erp/app/modules/workflows/workflows.service.ts`, following the module's
existing shape (Supabase client, `companyId` always, `setGenericQueryFilters` for list args):

| Function | Returns |
|---|---|
| `getWorkflowRuns(client, companyId, args)` | The run list page. Selects the run columns plus the workflow's `name` via the FK embed, `{ count: "exact" }`. |
| `getWorkflowRun(client, id, companyId)` | One run header + its workflow name + its version's `versionNumber` and `definition`. |
| `getWorkflowRunSteps(client, runId, companyId)` | The run's step rows ordered by `sequence`, then `itemKey`. |
| `getWorkflowRunChain(client, rootRunId, companyId)` | Every run sharing a `rootRunId`, ordered by `depth` then `createdAt`, capped at 50. Powers both "caused by" and "what this caused". |
| `getWorkflowLastRuns(client, workflowIds, companyId)` | From the `workflowLastRun` view, for the Workflows list column. |

A run whose `rootRunId` is null is its own chain of one and needs no query.

### 5. UI

**5a. Path helpers** (`apps/erp/app/utils/path.ts`, alphabetical among the existing workflow
entries):

```ts
workflowRun: (id: string) => generatePath(`${x}/workflows/runs/${id}`),
workflowRuns: `${x}/workflows/runs`,
```

**5b. Routes**, under the existing `x+/workflows+/` sidebar shell:

- `x+/workflows+/runs.tsx` — the list; renders `<Outlet />` for the detail drawer.
- `x+/workflows+/runs.$runId.tsx` — the detail, a full-size `Drawer` that navigates back to
  `path.to.workflowRuns` on close. Exactly the `audit-logs.details.tsx` pattern.

Both loaders open with
`await requirePermissions(request, { view: "workflows", role: "employee" })`. No new
permission: RLS on both tables is already SELECT-only and already gated on `workflows_view`.

A "Runs" entry is added to the single "Automate" group in
`apps/erp/app/modules/workflows/ui/useWorkflowsSubmodules.tsx`, with `table: "workflowRun"` so
the saved-views/filters machinery keys correctly.

**5c. Two entry points, one route.** From inside a workflow, `BuilderHeader` gets a Runs button
linking to `` `${path.to.workflowRuns}?filter=workflowId:eq:${workflowId}` `` — the standard
generic-filter query param (`getGenericQueryFilters`, `apps/erp/app/utils/query.ts:23`, parses
`filter=column:operator:value`). No nested layout, no second table, no second loader. The
builder route is a leaf today and stays one.

**5d. `WorkflowRunsTable`** (`ui/Runs/WorkflowRunsTable.tsx`), a standard `Table` with
`table="workflowRun"`, `withPagination`, no `withSearch` (there is no free-text column worth
searching; the value is in the filters):

| Column | Content |
|---|---|
| Status | Badge. Six values, matching the DB CHECK exactly. |
| Workflow | `Hyperlink` to `path.to.workflow(workflowId)`, with a `v{n}` version badge. |
| Trigger | The event's human label from `WORKFLOW_LABELS` (`@carbon/workflows/labels`), falling back to the raw `eventId`. |
| Record | The triggering record, linked (see 5f). Empty for a scheduled run. |
| Started | `startedAt`, falling back to `createdAt` — a `Blocked` run never started. |
| Duration | `formatDurationMilliseconds` from `@carbon/utils`. |
| Owner | `EmployeeAvatar` on `ownerId`. |
| Chain | A depth indicator when `depth > 0`, linking to the causing run. |

Filters: workflow, status, owner, event, and a started-at range. The filter set is **exactly**
the stored status set — n8n stores eight execution states and lets you filter on four, and that
divergence is a documented usability wart.

Status colours use the existing `Status` component from `@carbon/react` (`color` prop):
Succeeded green, Failed red, Running blue, Queued gray, **Blocked orange**, **Skipped purple**.
The orange/purple split is Airflow's and it matters: purple means "a decision was made not to
run this", orange means "something stopped it". Rendering both red would erase the distinction
this phase exists to surface.

**5e. Run detail drawer** (`ui/Runs/WorkflowRunDetail.tsx`), top to bottom:

1. **Header** — workflow name, `v{n}`, status badge, owner, started, duration, trigger event
   label, triggering record link, and `sourceEventId` in a copyable monospace line (it is the
   key support will ask for).
2. **Error banner**, when the run failed — the run's `error`, with a link that scrolls to and
   expands the first failed step. Step Functions' run-level banner deep-linking to the failing
   step is the single highest-value affordance in that console.
3. **Blocked callout**, when `status = 'Blocked'` — the `statusReason` verbatim (*"Cycle: this
   workflow already ran in this chain"* / *"Chain depth limit reached (10 hops)"*), the chain as
   a list of workflow names from `path`, and a link to the causing run.
4. **Chain**, when `rootRunId` is set — the sibling runs from `getWorkflowRunChain`, indented by
   `depth`, current run marked. A run id that no longer resolves renders as
   *"This run is no longer available"* rather than a dead link.
5. **Steps** — the substance, below.

**The step list.** One row per node of the **frozen version's** definition — read through
`readWorkflowVersion` and ordered by `topologicalNodeOrder` — joined to its step rows:

- A node with a step row shows: kind icon and title (`NODE_KIND_META` from
  `ui/Builder/nodes/meta.ts`, resolving `node.data.title` → `meta.title(node)` →
  `meta.defaultTitle`), status badge, duration, and its `statusReason` inline. Expanding shows
  **Input**, **Output** and, for a condition, **Why**.
- A node with **no** step row shows greyed, in place, labelled *"Not reached"*. This is the
  design's core move and it is Airflow's: materialising the steps that did not run is what
  turns a two-row detail view into an answer. Zapier's failure to do this is the loudest
  complaint about its history.
- A **batch** action shows one row — its aggregate (`itemKey = ''`, whose `statusReason` is
  where dropped and failed items become visible, e.g. `Ran 100 of 150; 50 were not used.`) —
  expanding to its per-item rows keyed by `itemKey`.
- A node with a list-valued output shows an **item count** on the row (`40 items`). Make's
  bundle-count bubbles on every connector are the single best idea in either no-code product:
  a lookup that returned 40 next to a filter that passed 3 explains itself without a click.
- **Why**, for a condition node, renders `detail` as a small table — one line per clause, per
  path, in evaluation order: the resolved left value, the operator's label from
  `WORKFLOW_OPERATORS`, the resolved right value, and pass/fail; the taken path marked. An
  unresolvable operand shows the reason in place of a value.

Payloads (`input`, `output`) render as a `RuntimeValue` tree, not raw JSON: a primitive as its
value, an entity as its type label and id (linked where 5f can resolve it), a list expandable
with its length. A compacted value shows its `… N more items` / `… N more characters` marker
as a muted chip, so a truncated value never reads as a complete one. There is no generic JSON
viewer in the repo (`CodeBlock` in `packages/react` has no `json` grammar registered), so this
is a new small component — `RuntimeValueView` — and it lives in `ui/Runs/` beside its only
consumer.

**Detail no longer available.** When a run is older than the 30-day window its step rows are
gone; the drawer shows the header, the chain, and a single explanatory line: *"Step detail is
kept for 30 days. This run's steps have been removed."* When a run is compacted (7–30 days) a
muted note says values are summarised.

**5f. The triggering record link.** `workflowRun.triggerTable` and `triggerRecordId` are both
stored. `getEntityPath(entityId)` — which maps an id prefix (`po_`, `job_`, `so_`…) to a
`path.to.*` route — exists today as a file-private function inside
`apps/erp/app/modules/settings/ui/AuditLog/AuditLogTable.tsx:81`. Lift it to
`apps/erp/app/utils/entity.ts` and have both call sites import it; the audit log keeps
behaving identically. The human label comes from `getTableLabel(tableName)`
(`packages/database/src/audit.config.ts:746`), which is missing three of the sixteen workflow
entity tables — `user`, `group`, `location` — so those three labels are added to
`auditConfig.tableLabels`. An unresolvable prefix renders as label + id, unlinked.

**5g. Live view.** Both tables are already published to `supabase_realtime`; the hook already
exists. A `<RunLiveUpdates />` component is rendered **only while the run is non-terminal** and
owns the subscriptions:

- the list route: `useDebouncedRealtime("workflowRun", \`companyId=eq.${companyId}\`)`
- the detail route: `useDebouncedRealtime("workflowStepRun", \`runId=eq.${runId}\`)` plus the
  run row itself.

The hook revalidates the loader after 1.5 s of quiet rather than merging events client-side,
which is the print queue's pattern (`printing.jobs.tsx:201`) and keeps loader data the single
source of truth. Mounting it conditionally is what stops the channel at a terminal state —
every serious engine stops refreshing when a run finishes. Ordering must be stable across a
revalidate (`sequence`, then `itemKey`, then the topological order for unreached nodes):
Airflow #23542 was auto-refresh reordering grid rows under the user's cursor.

The engine already writes a `Running` step row at claim time
(`ledger.ts:55-73`), so per-step live progress costs nothing extra here. In n8n the equivalent
(`EXECUTIONS_DATA_SAVE_ON_PROGRESS`) defaults **off** because it is a write-amplification
decision; Carbon already pays that write for idempotency and gets the live view free.

**5h. Last run on the Workflows list.** `WorkflowsTable` gains a "Last Run" column between
"Live Version" and "Active": the status badge plus a relative time, linking to that run.
Fed by `getWorkflowLastRuns` over the new view, keyed by `workflowId`, exactly as the loader
already does a second call for `versionNumbers`. A workflow that has never run shows an em dash.

### 6. i18n

Every new string goes through Lingui (`<Trans>` in components, `msg` in route handles and
config maps), per `.claude/rules/i18n-lingui-system.md`. Status labels, skip reasons written in
the engine, and the retention explanations are all customer-facing.

Engine-written reasons (`statusReason`, `error`) are stored as English strings today and are
rendered verbatim — translating stored log text is out of scope and would be wrong anyway,
since it is a record of what happened at a point in time.

## Design Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Run detail surface | Ordered step list in a full-size drawer, rendered against the frozen version | Step Functions and Airflow both treat the filterable ordered list as the documented debugging path; the graph is orientation. Works even when the workflow has since changed — which is exactly why n8n cannot show history for an edited workflow |
| 2 | Nodes that never ran | Materialised as greyed "Not reached" rows in topological order | Airflow does this and it is the loudest gap in Zapier. Pure derivation from the frozen definition — no storage |
| 3 | Where the run list lives | One route, two entry points (sidebar + a filtered link from `BuilderHeader`) | One loader, one service function, one table. The per-workflow view is a query param |
| 4 | Retention tiers | Fixed constants: 7 / 30 / 90 days, reaper at 24 h | Inside the industry band (Stripe 30d→13mo, n8n 14d, Zapier ~30d). No settings UI, no migration, trivially changed later |
| 5 | Row-count cap per company | Not in v1 | `technical-decisions.md` already settled "no run quota"; a count cap is a number nobody can justify yet. n8n has one, but n8n also has no per-tenant isolation |
| 6 | Redaction scope | Widen to `output`, `detail`, `error`, `statusReason`; keep the key with `[REDACTED]`; conservative pattern widening | Today `output` and `error` are unfiltered — a real gap being surfaced for the first time by this UI. Keep-the-key is universal in published scrubbers because a dropped key is indistinguishable from an absent one |
| 7 | Bare `key` / `auth` / `session` in the pattern | Excluded | `itemKey` is a column of this table; `authorizedBy` is ordinary ERP data. Elastic's wildcards are tuned for HTTP headers. Over-redaction in a debugging tool is a failure too |
| 8 | Condition explainability | Per-clause evaluation stored in a new `detail` column | No incumbent does this, and it is the literal answer to the phase's motivating question. `compare.ts` already resolves both sides and already carries a comment saying it does so for the run history |
| 9 | Where clause detail is stored | A new `workflowStepRun.detail JSONB`, not inside `output` | `output` means "the node's outputs map". An envelope with a reserved key breaks when a customer names an output `detail` |
| 10 | Filter node clause detail | Not stored | One row per item over a 100-item list is a wall, not a debugging aid. Its `Kept 3 of 40` summary already carries the signal |
| 11 | Replay / retry | Explicit non-goal | Needs an answer to what `sourceEventId` a replay carries, which is the keystone of Carbon's idempotency. A phase of its own |
| 12 | Stale non-terminal runs | Reaped nightly at 24 h | Every retention pass must filter on a terminal status; without the reaper a crashed run is both immortal and permanently "in flight" in the UI |
| 13 | Last-run on the Workflows list | Yes, via a `workflowLastRun` view | "Is this thing working" is what the list page is actually asked; today it can only answer "is it switched on". PostgREST cannot express latest-per-group |
| 14 | Triggering record link | Lift `getEntityPath` out of `AuditLogTable` into a shared helper; add three missing `tableLabels` | The mapping already exists and works; duplicating it is how the two diverge |
| 15 | Live updates | Supabase realtime + debounced revalidate, mounted only while non-terminal | The tables are already published and the hook already exists. Every serious engine polls and every one stops at a terminal state |
| 16 | Status colours | Blocked orange, Skipped purple, Failed red | Airflow's split. "A decision was made not to run this" and "something stopped it" are different answers; rendering both red erases the distinction |
| 17 | Permissions | `workflows_view` only, no new permission | RLS on both tables is already SELECT-only and already gated on it |
| 18 | Payload rendering | A small `RuntimeValue` tree component, not raw JSON | No JSON viewer exists in the repo, `CodeBlock` has no `json` grammar, and a `RuntimeValue` has structure worth using — an entity renders as a link, not as `{"kind":"entity","of":"job","id":"job_x"}` |
| 19 | Compaction markers | `… N more items` / `… N more characters` / `… N more keys` | `util.inspect`'s convention. OpenTelemetry truncates with no marker, which reads as a complete value |
| 20 | `topologicalNodeOrder` location | `packages/workflows/src/definition/order.ts` | Graph maths over the definition, pure and testable once; the builder will want it too |

## Acceptance Criteria

**List**

1. With three workflows that have fired, visiting `/x/workflows/runs` shows one row per run,
   newest first, each with a status badge, the workflow name, the trigger event's human label,
   the triggering record, start time, duration and owner.
2. Filtering the list by `status = Failed` returns only failed runs; the status filter offers
   exactly six values — Queued, Running, Succeeded, Failed, Blocked, Skipped.
3. Opening a workflow in the builder and clicking **Runs** lands on
   `/x/workflows/runs?filter=workflowId:eq:<id>` showing only that workflow's runs.
4. The Workflows list shows a "Last Run" column: a workflow that has run shows its latest
   status and relative time and links to that run; one that has never run shows an em dash.

**Detail**

5. Opening a run of an 8-node workflow that stopped at node 3 shows **all 8 nodes** in graph
   order: three with outcomes, five greyed and labelled "Not reached".
6. A condition node that took its `else` path expands to a table showing each `if` and
   `else-if` clause with both resolved sides, the operator and a fail marker, and the `else`
   path marked as taken.
7. A condition that could not resolve an operand shows status **Skipped** with its reason
   inline, the clauses evaluated before it, and the reason in place of the unresolved value.
8. A batch action over 150 items shows one aggregate row reading `Ran 100 of 150; 50 were not
   used.`, expanding to 100 per-item rows keyed by item.
9. A run blocked by a cycle shows status **Blocked** (orange), the reason *"Cycle: this workflow
   already ran in this chain"*, the chain of workflow names, and a working link to the run that
   caused it.
10. A failed run shows a run-level error banner whose link scrolls to and expands the failing
    step.
11. A run whose triggering record is a purchase order shows "Purchase Order" and a link that
    opens that purchase order.

**Live**

12. Starting a run with the detail drawer open shows steps appear one by one without a manual
    refresh, within ~2 s of each being claimed, with no row reordering.
13. When the run reaches a terminal status the realtime subscription is torn down (no further
    revalidations occur).

**Retention and redaction**

14. A workflow action whose resolved input contains a key matching the secret pattern stores
    that key with the value `[REDACTED]` — the key is present, the value is not.
15. A webhook action whose response excerpt contains `{"access_token": "..."}` stores
    `access_token: "[REDACTED]"` in `output` (this fails today).
16. A string over 4 KB is stored truncated with the marker `… N more characters` where N is the
    number of characters dropped.
17. Running the retention job against a terminal run completed 8 days ago compacts its step
    payloads (lists to 5 items, strings to 256 chars, with markers) and stamps `compactedAt` on
    the run and its steps.
18. Running it against a terminal run completed 31 days ago deletes its `workflowStepRun` rows
    and leaves the run header; the detail drawer for that run shows the "kept for 30 days"
    explanation.
19. Running it against a terminal run completed 91 days ago deletes the run row.
20. Running it against a run in `Running` status completed 91 days ago **changes nothing** in
    passes 2–4 — only the reaper touches it, and only once it is older than 24 h, after which it
    is `Failed` with the automatic-closure reason and its `Running` steps are settled as failed.
21. A run created 2 hours ago and still `Running` is untouched by every pass.

**Tests**

22. `pnpm --filter @carbon/workflows test` passes, including new cases for
    `topologicalNodeOrder` and `evaluateClauses`' per-clause output (both the passing and the
    unresolvable path, the latter asserting clauses evaluated before the failure are retained).
23. `pnpm --filter @carbon/jobs test` passes, including new cases for `redactForLog`
    (keep-the-key, each pattern member, the excluded words `itemKey` / `authorizedBy` surviving
    unredacted) and `compactForLog` (each marker, the depth cap, entity values untouched).
24. `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/workflows`
    and `pnpm exec biome check` are clean.

## Open Questions

All resolved with the user before this document was written (2026-07-31).

- [x] How should a single run's detail be shown? — **Answer:** an ordered step list in a
      full-size drawer, rendered against the frozen version definition. A canvas overlay is a
      later addition, not the v1 surface: the list is what Step Functions and Airflow treat as
      the debugging path, it is far cheaper, and it keeps working when the workflow has since
      been edited.
- [x] Should nodes that never ran appear in the run detail? — **Answer:** yes, derived by
      diffing the frozen definition's node list against the step rows that exist and rendered
      as greyed "Not reached" rows in graph order. No new storage. This is the direct answer to
      the phase's motivating question and is the loudest gap in Zapier.
- [x] Where does the run list live? — **Answer:** both a company-wide page and a per-workflow
      view, implemented as **one** route, loader, service function and table, with the
      per-workflow view being the same list pre-filtered through the standard
      `?filter=workflowId:eq:<id>` query param.
- [x] Are the 7/30/90 retention tiers fixed or configurable? — **Answer:** fixed constants in
      the nightly job, matching how `notification-purge` already works. No per-company setting,
      and no row-count cap in v1.
- [x] Redaction today covers step inputs only — widen it? — **Answer:** yes, widen to `output`,
      `detail` and `error`, switch from deleting a secret key to keeping it with a
      `[REDACTED]` value, and widen the key pattern conservatively toward the published
      denylists while deliberately excluding bare `key`, `auth` and `session` (they collide
      with ordinary ERP data, including this table's own `itemKey` column).
- [x] Should a condition node record why it took the branch it took? — **Answer:** yes,
      per-clause evaluation with both resolved sides, stored in a new `detail` JSONB column and
      rendered as a small table. Requires a change in
      `packages/workflows/src/runtime/compare.ts` and `condition.ts` plus their tests — the
      operands are already resolved there and thrown away.
- [x] Is replaying or retrying a failed run in scope? — **Answer:** no, an explicit non-goal.
      It needs its own answer to what `sourceEventId` a replay carries, which is the keystone
      of Carbon's whole idempotency design.
- [x] Should a run link to the record that triggered it? — **Answer:** yes. Lift
      `getEntityPath` out of `AuditLogTable` into a shared helper both call sites use, and add
      the three workflow entity tables missing from `auditConfig.tableLabels` (`user`, `group`,
      `location`).
- [x] Runs stuck in Queued/Running are never purged — fix that here? — **Answer:** yes, a
      stale-run reaper in the same nightly job closes any run still non-terminal after 24 hours
      and settles its interrupted steps. Without it the "purge only terminal runs" rule strands
      crashed runs forever, both in the table and in the UI.
- [x] Should the Workflows list show each workflow's last run? — **Answer:** yes, a "Last Run"
      column fed by a new `workflowLastRun` view (PostgREST cannot express latest-per-group).

Surfaced while writing, and resolved from the codebase rather than by guess:

- [x] Where does per-clause detail get stored? — **Answer:** a new nullable
      `workflowStepRun.detail JSONB`. `output` is written at `execute.ts:187` as exactly the
      node's outputs map; an envelope with a reserved key inside it would collide with a
      customer-named output.
- [x] Which client does the nightly job use? — **Answer:** `getJobDatabaseClient()` (Kysely),
      not the Supabase service role that `notification-purge` uses, because compaction rewrites
      JSONB per row.
- [x] Does the run detail need a new JSON viewer? — **Answer:** yes, a small `RuntimeValueView`.
      The repo has no JSON viewer; `CodeBlock` (`packages/react/src/CodeBlock.tsx`) registers
      only bash/javascript/tsx grammars, and a `RuntimeValue` has structure worth rendering
      (an entity should be a link).

## Files Touched

**Database** — one migration
- `packages/database/supabase/migrations/<ts>_workflow-run-history.sql` — `workflowStepRun.detail`,
  `workflowRun_stale_idx`, the `workflowLastRun` view
- `packages/database/src/types.ts` — regenerated (`pnpm run generate:types`), never hand-edited
- `packages/database/src/audit.config.ts` — three `tableLabels` additions

**`packages/workflows`**
- `src/runtime/compare.ts` — `evaluateClauses` returns per-clause evaluations
- `src/runtime/condition.ts` — builds `NodeDetail`
- `src/runtime/filter.ts` — updated for the new `evaluateClauses` return
- `src/runtime/types.ts` — `ClauseEvaluation`, `NodeDetail`, `NodeResult.detail`
- `src/definition/order.ts` (new) + `order.test.ts` — `topologicalNodeOrder`
- `src/index.ts` — exports
- tests: `compare.test.ts`, `condition.test.ts`, `filter.test.ts`

**`packages/jobs`**
- `src/workflows/engine/ledger.ts` — widened `redactForLog`, applied to `output`/`detail`/
  `error`/`statusReason`, counted truncation marker
- `src/workflows/engine/execute.ts` — passes `result.detail` to `settleStep`
- `src/workflows/retention.ts` (new) + `retention.test.ts` — `compactForLog`
- `src/inngest/functions/scheduled/workflow-run-retention.ts` (new)
- `src/inngest/functions/scheduled/index.ts`, `src/inngest/index.ts` — registration
- `AGENTS.md` — the new scheduled function and the widened redaction

**`apps/erp`**
- `app/utils/path.ts` — `workflowRun`, `workflowRuns`
- `app/utils/entity.ts` (new) — `getEntityPath`, lifted
- `app/modules/settings/ui/AuditLog/AuditLogTable.tsx` — imports the lifted helper
- `app/modules/workflows/workflows.service.ts` — five new functions
- `app/modules/workflows/types.ts`, `index.ts` — types and barrel
- `app/modules/workflows/ui/Runs/` (new) — `WorkflowRunsTable.tsx`,
  `WorkflowRunDetail.tsx`, `WorkflowRunSteps.tsx`, `RuntimeValueView.tsx`,
  `ConditionDetail.tsx`, `RunStatus.tsx`, `RunLiveUpdates.tsx`
- `app/modules/workflows/ui/WorkflowsTable.tsx` — the Last Run column
- `app/modules/workflows/ui/Builder/BuilderHeader.tsx` — the Runs link
- `app/modules/workflows/ui/useWorkflowsSubmodules.tsx` — the Runs nav entry
- `app/routes/x+/workflows+/runs.tsx`, `runs.$runId.tsx` (new)
- `app/routes/x+/workflows+/_index.tsx` — last-run data

**Docs**
- `.claude/rules/workflow-engine.md` — redaction, `detail`, retention
- `.claude/rules/workflow-run-history.md` (new) — the reading experience and the nightly job
- `AGENTS.md` Task Router — a row for the new rule

## Changelog

- **2026-07-31** — Initial spec. Ten open questions resolved with the user before writing
  (run-detail surface, not-reached nodes, list placement, retention tiers, redaction scope,
  condition explainability, replay, record links, stale runs, last-run column); three more
  surfaced during writing and resolved against the codebase (where `detail` is stored, which
  DB client the nightly job uses, whether a JSON viewer exists). Research in
  `.ai/research/2026-07-31-workflows-run-history.md`.
