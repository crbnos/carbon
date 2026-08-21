# Workflows feature — context map (2026-08-14)

Branch `fix/workflow-improvements`. Gathered before starting improvement/UX work.
Sources: 3 parallel explore passes over code, rules, specs, migrations, git history.

---

## 0. Orientation

Two unrelated things are called "workflow" in this repo. This doc is about the
**customer-facing automation feature** (`workflow*` tables, `packages/workflows`,
`apps/erp/app/modules/workflows`). Not `issue-workflow+` (quality/NCR) and not
`approvals-workflow` (document approvals).

Ships as **"Workflows"**, not "Automations" — PRD wording is stale.
Currently gated to the **Partner plan** for internal testing (`4716b694a`,
superseding the earlier Business-plan gate).

**Branch state:** `HEAD == origin/main == 87a19b325`. No commits of our own yet.
`git diff main...HEAD` is misleading (local `main` is stale at `e51dfa383`) —
use `origin/main...HEAD`. Working tree has 5 uncommitted files, none
workflow-related (seed-dev tiers + generated DB types).

---

## 1. Architecture in one pass

```
ERP event / moment / schedule / test-run
        ↓
matcher (packages/jobs/src/workflows/matcher.ts)
        ↓  inserts workflowRun rows (Queued), emits carbon/workflow-run.queued
Inngest workflow-run fn (packages/jobs/src/inngest/functions/workflows/run.ts)
        ↓
engine (packages/jobs/src/workflows/engine/execute.ts) walks the graph
        ↓  per node → EXECUTORS (packages/workflows/src/runtime/)
ledger writes workflowStepRun rows → Runs UI
```

`packages/workflows` = **pure contract package**. Zero I/O, zero DB client.
`@carbon/database` is types-only. Compiled for browser at **ES2019** — no
`node:*`, **no BigInt literals**.

---

## 2. Definition format

`CURRENT_DEFINITION_FORMAT_VERSION = 3` — `packages/workflows/src/definition/schema.ts:11`

```ts
{ formatVersion: number, nodes: WorkflowNode[], edges: WorkflowEdge[] }
```

**6 node types** (discriminated union on `type`, `schema.ts:106`):

| Type | data | handles |
|---|---|---|
| `trigger` | `{ events: string[], origin, schedule? }` | `["out"]` |
| `condition` | `{ paths: ConditionPath[] }` (if/elseIf/else) | one per `path.id` |
| `entity` | `{ operation, inputs }` | `["out"]` |
| `lookup` | `{ entity, returns: "one"\|"list", match }` | `["success","failure"]` |
| `filter` | `{ source?, combinator, clauses }` | `["out"]` |
| `action` | `{ action, inputs }` — no stored batch flag | `["success","failure"]` |

Node base: `id`, `name` (`/^[a-z0-9_]+$/`, unique, refs bind to **id** not name),
`position`, `expanded?`. Note `node.data.title` no longer exists (dropped in v3).

**Value union** (`valueOrRefSchema`, `definition/types.ts`): `literal` | `ref`
(nodeId+output+path) | `item` | `template` (interleaved text/var parts) |
`pairs` (webhook headers only).

**Migration**: only `migrateDefinition` in `definition/normalize.ts`, applied to
raw JSON *before* the current-schema parse. One upgrade today (v1→v2 resets
lookup `match` to `[]`). Missing `formatVersion` ⇒ 1. `from > 3` ⇒ `future-format`.
**Rule:** always parse a row against the row's own `formatVersion`.

**Constants**: `DEFAULT_OUTPUT="result"`, `DEFAULT_HANDLE="out"`,
`MAX_LIST_ITEMS=100`, `MAX_CHAIN_DEPTH=10`, `MAX_NODE_EXECUTIONS=500`
(`engine/walk.ts:7`), `BATCH_CONCURRENCY=5`, `MAX_RUN_STEPS=200` (service).

---

## 3. Package layout — `packages/workflows/src`

| Path | Owns |
|---|---|
| `definition/schema.ts` | node/edge/definition zod, format version, handle constants |
| `definition/types.ts` | `ValueType`, `OPERATORS_BY_TYPE`, value union, clauses, schedule |
| `definition/nodes.ts` (769L) | `NODE_KINDS` registry — 7 mandatory members per node type; mapped type makes a missing entry a compile error |
| `definition/validate.ts` (528L) | `validateDefinition` → `WorkflowIssue[]`, 7 layers. Never switches on node type |
| `definition/normalize.ts` | `readWorkflowVersion` — the one raw-JSON boundary |
| `definition/batch.ts` | `batchCandidates`/`batchPlan` — the rule for "does this action step repeat" (actions only) |
| `definition/catalog.ts` | `WorkflowCatalog` interface, `walkPath`, `createFixtureCatalog` |
| `definition/variables.ts` | builder-side available-variable computation |
| `definition/schedule.ts` | `nextOccurrenceAfter`/`nextRunAfter` — tz-aware, only copy |
| `catalog/` | 4 hand-written inputs (`entities/moments/actions/operations.ts`) → **4 committed generated files** (`events`, `actions`, `labels`, `help` `.generated.ts`) |
| `runtime/` | 5 executors + `EXECUTORS`, `values`/`resolve`/`compare`, `batch.ts`, `fixtures.ts` |
| `run-trigger.ts` | `runTriggerSchema` — 3-variant wire contract shared with `@carbon/lib` + `@carbon/jobs` |
| `sync.ts` | trigger-event + `eventSystemSubscription` reconciler (4 exports) |

**Catalog counts (verified):** 106 events, 16 entities, 16 actions, 15 operations,
plus `WORKFLOW_ENTITY_ENUMS`. Actions = `notify`, `webhook`, 4 creates
(`job/nonConformance/purchaseOrder/salesOrder.create`), 10 generated
`<entity>.update`.

Generated files are drift-checked by `scripts/check-workflow-catalog.ts`
(produced by `scripts/generate-workflow-catalog.ts`). Never verify by importing
the generator — re-run it.

---

## 4. Runtime

`EXECUTORS` — `runtime/executors.ts:11`. **5 entries**; `trigger` has none
(recorded, never executed).

| Kind | File | Permission | Outcome |
|---|---|---|---|
| `action` | `runtime/action.ts` | `catalog.getAction(id).permission` | `services.runAction` → success/failure |
| `condition` | `runtime/condition.ts` | — | first passing path id as handle; no match ⇒ `handle: null`, `branchTaken:"none"` |
| `entity` | `runtime/entity.ts` | `catalog.getOperation(id).permission` | `services.runOperation` |
| `filter` | `runtime/filter.ts` | — | pure clause loop |
| `lookup` | `runtime/lookup.ts` | `catalog.getEntity(id).permission` | `services.search` |

**Run walk** — `packages/jobs/src/workflows/engine/execute.ts`:
1. `step.run("load")` — inactive ⇒ `Skipped`; unreadable version ⇒ `Failed`;
   `claimRun` (`UPDATE … WHERE status='Queued'`) ⇒ `Duplicate` if lost.
2. `step.run("permissions")` — owner client, `hasPermission(module,"view")` from
   `catalog.getEvent(eventId).permission`.
3. Trigger step row written at `sequence: 0` with `triggerOutputs`.
4. Loop `nextNode(state)` → `step.run("node:<id>")` or `runBatchedNode`.
5. `step.run("finish")` — `failInterruptedSteps()`, then `Failed` if
   failed/capped/interrupted.

**Graph state** (`engine/walk.ts`, pure): per **edge**, `live`/`dead`/pending.
`promoteReady` queues a node when all incoming edges settled and ≥1 is live;
all-dead ⇒ skipped, and a skip settles its outgoing edges dead (cascades).
Only one trigger fires; other triggers' edges dead at `createWalkState`.

**Condition eval** — `runtime/compare.ts` `evaluateClauses`.
`contains`/`startsWith`/`endsWith` case-insensitive; `eq`/`neq` not.
Unresolvable operand ⇒ **Skipped with a reason, never falls through to else**.

**Batching**: action batching derived from wiring, never stored; items in groups
of 5, step ids `node:<id>:<itemKeyFor(item)>`, then one aggregate row with
`itemKey: ""`. `itemKeyFor` = record id, else `h:${fnv1a64(...)}` — never a
list position. Entity batching is a **separate, weaker inline mechanism**
(`runtime/entity.ts:30-67`) — one step, no per-item rows, silently drops failures.

**Ledger** — `engine/ledger.ts`: `claimStep` = INSERT `Running`
`ON CONFLICT DO NOTHING` (at-most-once). `redactForLog` redacts by key regex
and by `pairs` shape, truncates >4096.
Deliberately NOT redacted: `itemKey`, `authorizedBy`, `keyword`, `sessionId`.

---

## 5. Matcher

`packages/jobs/src/workflows/matcher.ts` — 4 pure planning fns + 1 DB orchestrator.

| Source | Function | `sourceEventId` |
|---|---|---|
| Record change (pgmq → `carbon/event-workflow`) | `inngest/functions/events/workflow.ts` | `pgmq:<msgId>` |
| Moment (`raiseMoment`) | `inngest/functions/workflows/moment.ts` | `moment:<momentId>` |
| Schedule wake | `workflows/scheduler.ts` `dispatchDue` | `schedule:<workflowId>:<dueAtIso>` |
| Builder test run | `engine/manual.ts` (bypasses matcher) | `manual:<nanoid>` |

`matchAndQueue`: indexed read on `(companyId, eventId IN …)` → `filterByOrigin`
(`workflowRunId` present ⇒ Automation, absent ⇒ Person, Both always survives) →
`planRuns` + loop guard (cycle via `path.includes`, then depth ≥ 10; blocked ⇒
`Blocked` row, no event) → single INSERT `ON CONFLICT ON CONSTRAINT
workflowRun_dedupe_key DO NOTHING`; only genuinely-inserted rows emit
`carbon/workflow-run.queued`.

`computeEventIds` (`workflows/event-ids.ts`): INSERT/DELETE → direct id;
UPDATE → one `.changed` id per genuinely-moved watched column.

---

## 6. Inngest wiring

| Function | id | Trigger | retries | Notes |
|---|---|---|---|---|
| `workflowRunFunction` | `workflow-run` | `carbon/workflow-run.queued` | 3 | idempotency `runId`; `onFailure` → `failCrashedRun`; **no concurrency block** |
| `workflowMomentFunction` | `workflow-moment` | `carbon/workflow-moment.raised` | 3 | idempotency `momentId` |
| `workflowSchedulerFunction` | `workflows-scheduler` | `carbon/workflow-scheduler.wake` | 3 | `singleton` skip; Redis chain token; wake ceiling 10min, `MAX_DUE_PER_WAKE=200` |
| `workflowSchedulerBackstopFunction` | `workflows-scheduler-backstop` | cron `0 * * * *` | 2 | revives stale chain (>15 min) |
| `workflowFunction` | `event-handler-workflow` | `carbon/event-workflow` | 3 | idempotency `msgId` |
| `workflowRunRetentionFunction` | `workflow-run-retention` | cron `0 4 * * *` | 2 | 4 passes (below) |

Registered `packages/jobs/src/inngest/index.ts:84-138`.

**Retention, nightly 04:00** — every pass filters TERMINAL status; age is always
`COALESCE("completedAt","createdAt")`:
1. `reap-stale-runs` — close Queued/Running > 24h (`STALE_RUN_HOURS=24`)
2. `purge-run-headers` — delete terminal runs > 90d (`RUN_HEADER_DAYS=90`)
3. `compact-step-payloads` — `compactForLog`, set `compactedAt` (`FULL_DETAIL_DAYS=7`, 200/night)
4. `drop-step-detail` — delete step rows, header survives (`COMPACT_DETAIL_DAYS=30`, 500/night)

Pass 3 before pass 4 so `compactedAt` is always set first — the UI reads it to
tell "steps purged" from "run has no steps yet".

---

## 7. Database

**Three migrations, all landed together 2026-08-10** (squashed; timestamps synthetic):

1. `20260810100000_workflows-run-tag.sql` — `dispatch_event_batch()` stamps
   `workflowRunId` from the `workflow_run_id` JWT claim
2. `20260810100100_workflows-foundation.sql` (311L) — the whole data model
3. `20260810100200_workflow-run-history.sql` — `workflowStepRun.detail`,
   retention indexes, `workflowLastRun` view

⚠️ `.ai/lessons.md:573` and `.ai/plans/automation/pending-changes.md` cite
migration filenames that **no longer exist** (renamed on squash).

**Tables** (all composite PK `("id","companyId")`):

- **`workflow`** (`wf`) — `name` (unique/company), `ownerId`, `active` (default
  FALSE), `activeVersionId` (nullable), `nextRunAt`, `canvasState` JSONB
  (per-workflow, **not** per-user). `activeVersionId` FK uses column-scoped
  `ON DELETE SET NULL ("activeVersionId")` — a bare SET NULL on a composite FK
  nulls `companyId` and makes the parent undeletable.
- **`workflowVersion`** (`wfv`) — immutable snapshot: `versionNumber`,
  `formatVersion`, `nodes`/`edges` JSONB
- **`workflowTriggerEvent`** (`wfe`) — derived dispatch index, rewritten on
  promote/toggle. `origin` CHECK `Person|Automation|Both`. No UPDATE RLS by
  design (delete-then-insert)
- **`workflowRun`** (`wfr`) — status CHECK `Queued|Running|Succeeded|Failed|Blocked|Skipped`,
  `isTest`, lineage `rootRunId`/`causedByRunId`/`depth`/`path TEXT[]`
  (**deliberately not FKs** so retention purges don't cascade), `compactedAt`.
  UNIQUE `(workflowId, companyId, workflowVersionId, sourceEventId)`
- **`workflowStepRun`** (`wfs`) — `sequence`, `nodeId`, `nodeType`, `itemKey`
  (default `''`), `input`/`output`/`detail` JSONB, `branchTaken`.
  UNIQUE `(runId, companyId, nodeId, itemKey)`.
  `detail` = diagnostics only, never node data; shape `NodeDetail`

No new PG enums (TEXT + CHECK). One enum change: `ALTER TYPE "module" ADD VALUE
'Workflows'` + `COMMIT;` + `modules` view recreate.

**View `workflowLastRun`** — `DISTINCT ON (companyId, workflowId)`, exists
because PostgREST can't express latest-per-group. Filters `isTest = false`.

**RLS**: `workflows_view|create|update|delete`, seeded to Admin + Management
employee types and copied from `settings_*` in existing `userPermission` blobs.
`workflowRun`/`workflowStepRun` are **SELECT-only** — no user can forge a run log.
Both are in the `supabase_realtime` publication.

---

## 8. ERP UI surface

**Two route trees** — the builder is in the SINGULAR one, easy to miss:

`apps/erp/app/routes/x+/workflows+/` (sidebar shell)
- `_layout.tsx`, `_index.tsx` (list), `runs.tsx`, `runs.$runId.tsx` (xl Drawer),
  `new.tsx` (POST, seeds v1 with a lone trigger node), `$id.rename.tsx`,
  `delete.$id.tsx`

`apps/erp/app/routes/x+/workflow+/` (full-screen builder, no sidebar)
- `$id.tsx:148` — the builder. `ReactFlowProvider` → `WorkflowBuilderProvider` →
  `BuilderHeader` + `WorkflowBuilder` + `IssuesPanel` + `Autosave` +
  `LiveValidation` + `TestRunDialog`. `isReadOnly = isLiveVersion || !can("update")`
- `$id.save.tsx` (autosave, 409 on lock), `$id.canvas.tsx` (viewport),
  `$id.publish.tsx`, `$id.toggle.tsx`, `$id.version.new.tsx`, `$id.test-run.tsx`

**No settings route.** No owner transfer, no version delete, no per-workflow
run-history page.

**Builder** — `@xyflow/react` (React Flow v12), CSS via route-level `links`.
- `ui/Builder/WorkflowBuilder.tsx` — `ResizablePanelGroup` palette 14 / canvas 62
  / test-results 24. `deleteKeyCode={["Delete"]}` only (no Backspace, no undo)
- `ui/Builder/BuilderHeader.tsx` — inline title, `SaveMarker`, `VersionMenu`,
  "Live" badge, Publish + replace-live confirm
- `ui/Builder/BuilderControls.tsx` — zoom, fit, auto-arrange, collapse-all,
  pan/select toggle, MiniMap. Good a11y here
- `ui/Builder/NodePalette.tsx` — 6 draggable buttons, drag *or* click-to-add
- `ui/Builder/nodes/WorkflowNodeCard.tsx` → generic `NodeCard.tsx`; per-kind data
  only in `nodes/meta.ts` + `nodes/kinds.ts`
- **Config panels are inline in the card body**, not a side drawer.
  `config/forms/`: `TriggerForm` (EventPicker, origin toggle, ScheduleEditor),
  `ActionForm` (553L — the biggest), `ConditionForm` + `ClauseRow` +
  `CombinatorToggle`, `FilterForm`, `LookupForm`, `EntityForm`, `InlineNodeName`
- `ui/Builder/fields/*` (25 files) — `control.ts pickControl` is the single
  dispatch; `VariableTreeMenu` via `InlineVariableMenu` (ProseMirror) and
  `VariableMenuPopover` (Radix); `menuNav.ts` the one keyboard impl
- State: `store.ts` (vanilla zustand behind `context.tsx`), `selectors.ts`,
  `graph.ts` (`toReactFlow`/`fromReactFlow`/`createNode`/`canConnect`/`wouldCreateCycle`)
- Validation: `LiveValidation.tsx` (250ms debounce) → `liveIssues`; publish →
  `issues`; `selectAllIssues` merges (live wins); `IssuesPanel` + `IssueList`

**Module files** — `workflows.models.ts` (69L), `workflows.service.ts` (422L),
`workflows.server.ts` (not in barrel: `checkWorkflowVersionLock`,
`publishWorkflowVersion`, `setWorkflowActive`, `syncAfterWorkflowDelete`;
`syncWorkflowTriggers` under `pg_advisory_xact_lock(hashtext(companyId))`),
`types.ts` (11L).

**Runs UI** — `ui/Runs/`: `WorkflowRunsTable`, `WorkflowRunDetail`,
`WorkflowRunSteps` (420L — topological order via `topologicalNodeOrder`,
"Not reached" ghost rows, compacted banners), `ConditionDetail`,
`RuntimeValueView`, `RunStatus`, `EntityRecordLink`, `runOutcome.ts`,
`useNodeLabel.ts` (single naming authority), `RunLiveUpdates.tsx`
(`useDebouncedRealtime`, 1.5s quiet, mounts only while non-terminal rows exist).

**Test run**: play icon on trigger card → `TestRun/TestRunDialog.tsx` (page-level)
→ `TestRun/TestRunPanel.tsx`. **No dry-run** — it runs for real and writes a real
`workflowRun` row with `isTest = true`.

**Autosave**: 1s debounce, baseline snapshot compare, toast on failure. **No undo**
(deliberate, documented).

---

## 9. Known rough edges — candidate improvement backlog

### Stale UI copy (highest-confidence bug)
Test runs DO write real rows visible on the Runs page (`isTest=true` +
`TestRunBadge`), but four strings say the opposite:
- `ui/TestRun/TestRunPanel.tsx:108` — "Test runs are not saved. Close this panel and the result is gone."
- `ui/TestRun/TestRunPanel.tsx:19` (comment) — "Nothing was written…"
- `ui/TestRun/TestRunDialog.tsx:195` — "The result will not appear on the Runs page."
- `ui/Builder/nodes/WorkflowNodeCard.tsx:169` — tooltip "results are not saved to the Runs page"

### UX
- **Native `window.confirm`** at `config/forms/ConditionForm.tsx:167` — the only
  browser-native dialog in the feature; unstyled, untranslatable
- **Trigger form is single-event, the data model is multi-event.**
  `TriggerForm.tsx:413` writes `{ events: [id] }` and reads `events[0]`, but
  `meta.ts:61` renders "N events" and `TestRunDialog.tsx:198` shows an event
  chooser when `events.length > 1`. Opening the picker silently truncates
- **No empty states.** Neither `WorkflowsTable` nor `WorkflowRunsTable` passes
  the `emptyState` prop `Table` supports — new tenants see "No results found"
- **Dead-end navigation.** No link from builder → that workflow's runs;
  `path.to.workflowRuns` takes no workflow filter (you hand-build
  `?filter=workflowId:eq:<id>`). No "see all runs" from the list either
- **No on/off switch in the builder.** `WorkflowActiveSwitch` is only in
  `WorkflowsTable.tsx:93` (its own docstring claims otherwise) — you must go back
  to the list to arm a workflow you just published
- `workflows+/_index.tsx` runs all three loader queries then throws them away
  behind a client-side `usePlanGate`; every other route gates server-side
- `WorkflowsTable` "Last Run" is `id:"lastRun"` with no accessor → can't sort or
  filter despite `filterHeader` being set
- Pagination inconsistency: runs table passes `withPagination`, workflows table
  relies on the default

### i18n
- `runOutcome.ts` builds English sentences by concatenation, no `t`/`Trans` —
  the most-read sentence on the run page is untranslatable
- `WorkflowRunSteps.tsx:324` "Skipped — the check above didn't match" — same
- `IssuesPanel.tsx:24` bare English `aria-label="Dismiss"`

### a11y
- `WorkflowRunSteps.tsx:169` disclosure button has no `aria-expanded`/`aria-controls`
  (same for both Show-raw toggles)
- `NodeCard.tsx:172` — collapsed cards drop port labels, handles stack on the
  midline; **no keyboard path to create an edge at all** (React Flow drag only)
- `NodePalette.tsx` draggable buttons, no keyboard drag (click-to-add mitigates)
- `ConditionForm.tsx:300` — dnd-kit sortable ids are array indices
  (`sortId={String(i)}`, `key={i}`), so reordering re-keys every row

### Duplication
- Inline rename implemented twice with the same `settled`-ref pattern:
  `BuilderHeader.tsx:56` (`WorkflowTitle`) and `config/InlineNodeName.tsx:14`
- Step-title rule exists twice: `Runs/useNodeLabel.ts:20` (hook) and
  `Runs/runOutcome.ts:18` `stepTitle` (pure) — kept in sync by comment only
- `ActionForm.tsx:454` hard-codes `<Trans>Notify</Trans>` as the label for
  *every* `requireOneOf` group, keyed by index

### Engine / correctness
- **Entity-node batching silently drops failures** (`runtime/entity.ts:44-67`) —
  one step, no per-item rows, no failed count, never marks the run Failed.
  Actions do this properly; entity is a second weaker mechanism
- **Scheduled runs skip the trigger-level permission check** —
  `SCHEDULE_EVENT_ID = "schedule"` isn't a catalog event, so the gate at
  `execute.ts:472` is a no-op. Per-node checks still apply
- **A lost step claim always returns `Skipped`**, even when the existing row is
  terminal — self-declared known divergence from the phase-4 spec
- **Depth guard is best-effort across the 90-day retention boundary** — a chain
  outliving its purged root restarts at depth 0
- **No `concurrency` block on any workflow function** (removed deliberately in
  `13f524c1d` because `limit: 0` means *zero capacity*, not unlimited —
  `.ai/lessons.md:901`). Bounded only by account/plan concurrency
- `packages/jobs/src/workflows/retention.ts:1` shadows the name `MAX_LIST_ITEMS`
  with a local `5`, unrelated to the workflow cap of 100

### Doc drift (rules/AGENTS files lying about the code)
- `syncWorkflowSubscriptions` **does not exist** — named in
  `packages/workflows/AGENTS.md:135,149` and `.claude/rules/workflow-matcher.md:132`
- `src/runtime/template.ts` **does not exist** — listed in `AGENTS.md:115`;
  `renderTemplate`/`renderValue` come from `resolve.ts`
- "Three generated files" is now **four** (`help.generated.ts` undocumented, as is
  `WORKFLOW_ENTITY_ENUMS`)
- `AGENTS.md:146` omits the required 4th arg `lockCompany` on `syncWorkflowTriggers`
- `packages/jobs/AGENTS.md:96` understates the real `SECRET_KEY` redaction regex
- The workflows module `AGENTS.md` documents `updateWorkflowOwner`,
  `deleteWorkflowVersion`, `$id.owner.tsx`, `ui/WorkflowLockAlert.tsx` — **none exist**
- `.claude/rules/workflow-event-catalog.md:175` notes
  `packages/jobs/.../tasks/post-transaction.ts` is dead code

---

## 10. Explicitly deferred (from the specs — don't "fix" these by accident)

- **Replay / retry of a run** — blocked on what `sourceEventId` a replay carries
  (everything keys on it). Zapier/Make precedent already analyzed
- **Canvas overlay of a past run** — planned as a later addition on the same loader
- **Per-company retention settings** — tiers are hardcoded constants
- **Run quotas / plan gates** — out of scope per `technical-decisions.md`
- **Nested condition groups** — the stored shape is permanently one combinator
  per path over a flat clause list
- **An expression language** — structured references only, by decision
- **Undo** — a recorded phase-7 decision
- **All-or-nothing action groups** — PRD defers to v2
- **A general action surface over all ~1,400 service functions** — the catalog is
  hand-curated and editorial, by decision
- **Fixing the two pre-existing webhook systems** (no signing, no URL
  restriction) — recorded as debt
- No new node kinds; no "Duplicate node" action (considered, cut)

---

## 11. Specs, plans, history

**11 specs, all in `.ai/specs/implemented/`** — 9 phases + 2 UX rounds:
foundation, event-catalog, matcher, engine, catalogs, scheduling,
builder-canvas, node-configuration, run-history, builder-ux-overhaul,
workflow-variable-ux. Matching plans 1:1 in `.ai/plans/`, plus
`2026-08-03-workflow-builder-round-6.md`, `2026-08-04-workflow-field-help.md`,
`2026-08-07-variable-picker-descriptions.md`.

⚠️ **The original PRD and technical-decisions doc live OUTSIDE this repo** at
`/Users/aashu/work/carbon/plans/automations-engine/`.

⚠️ `.ai/plans/automation/pending-changes.md` is a 7-item list that reads like a
TODO but **every item appears already shipped**. Historical, not a backlog.

**Git**: built on `feat/automation` over ~10 days (2026-08-02 → 08-10), squashed
into **`58e2de238` "feat: automation workflows (#1294)"** — 424 files,
+95,805/−2,638. Followed same-day by **`13f524c1d` "Fix/workflow fixes (#1367)"**
(drops the broken concurrency caps). **Nothing workflow-related has landed since.**

One stray commit off this line: `faba64b6c` (test: validate every dataset's seed
workflows) lives only on `feat/onboarding-templates` — will conflict if we touch
`packages/workflows/src/seed-workflows.test.ts`.

**`.ai/lessons.md` lines ~573-790 and ~901** are the densest lesson cluster in
the file — 12+ workflow-derived lessons. Read before non-trivial changes.

---

## 12. Tests — 60 files (one of the best-tested subsystems here)

- `packages/workflows/` (28) — `definition/` (10), `runtime/` (12),
  `catalog/` (2), `seed-workflows.test.ts`, `sync.test.ts`
- `packages/jobs/src/workflows/` (23) — `matcher`, `event-ids`, `scheduler`,
  `retention`; `engine/` (7, incl. `end-to-end.test.ts`); `actions/` (9, incl.
  `url-guard.test.ts` for SSRF/DNS-rebinding); + the retention cron test
- `apps/erp/app/modules/workflows/ui/` (14) — deliberately tests **pure extracted
  logic**, not components: `Builder/{store,graph,layout,ports,labelKeys}`,
  `nodes/meta`, `fields/{variableMenu,menuNav,menuBridge,tokenId,valueParts,pairsRows}`,
  `Runs/{runOutcome,entityRefs}`

**Gap: no Playwright/e2e.** The matcher spec still reads "pending e2e sign-off";
the variable-UX spec says "browser pass still outstanding".

---

## 13. Where things live — quick index

```
packages/workflows/src/                     pure contract: definition, catalog, runtime
packages/jobs/src/workflows/                matcher, scheduler, retention, engine/, actions/
packages/jobs/src/inngest/functions/workflows/   run, moment, scheduler
packages/jobs/src/inngest/functions/events/workflow.ts
packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts
apps/erp/app/modules/workflows/             models, service, server, ui/{Builder,Runs,TestRun}
apps/erp/app/routes/x+/workflows+/          list + runs (sidebar)
apps/erp/app/routes/x+/workflow+/           builder (full screen)
packages/database/supabase/migrations/20260810100*.sql
scripts/generate-workflow-catalog.ts, scripts/check-workflow-catalog.ts
docs/content/docs/reference/{workflows,workflow-runs}.mdx
.claude/rules/workflow-{engine,matcher,actions,event-catalog,run-history,event-system}.md
.ai/specs/implemented/2026-07-30..2026-08-03-workflow*.md
```

**Validation for this area:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/jobs --filter=erp
pnpm exec biome check
npx vitest run   # from the relevant package
npx tsx scripts/check-workflow-catalog.ts   # after touching catalog inputs
```
