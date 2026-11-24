# Production and MES lessons

Jobs, operations, work centers, the MES shop-floor app, OEE, maintenance.

## A correction's rows live in the routing and BOM tables

```scope
id: a-correction-s-rows-live-in-the-routing-and-bom-tables
paths: []
triggers: ["methodCorrectionId","get_method_tree","methodOperation","methodMaterial"]
```

**Context:** A make method's corrections store their operations and materials in
`methodOperation` and `methodMaterial`, marked by `methodCorrectionId`. Their Op
Nos start at 1, like the routing's.

**Problem:** The CSV method import read the routing and BOM by `makeMethodId`
alone. Op No 1 then matched two operations and the row failed; a step for an Op
No only a correction had attached to the correction; and a BOM line was skipped
as "already on the BOM" when only a correction used the item.

**Rule:** A read of a make method's routing or bill of materials filters
`methodCorrectionId IS NULL`. Read correction rows only through their
`methodCorrectionId`. A write by row id or by item (a part merge, a method type
change) needs no filter.

**Applies to:** every query on `methodOperation` / `methodMaterial` by
`makeMethodId`, in TypeScript and in SQL (`get_method_tree`).

## A post-success prompt must not live in the component the success unmounts

```scope
id: a-post-success-prompt-must-not-live-in-the-component-the-suc
paths: ["apps/mes/app/components/JobOperation/**"]
triggers: ["BatchCompleteModal"]
```

**Context:** MES batch completion. `BatchCompleteModal` submitted the completion and was meant to swap itself for a "merge these lots?" prompt when the action returned one.

**Problem:** The modal is rendered `{batch && batchCompleteModal.isOpen && …}`, and `batch` is only passed by the loader while the batch is `Active`/`Completing`. Completing it — the very thing that produces the prompt — revalidates the loader, `batch` becomes null, and the modal unmounts with its `useFetcher` still holding the response. The prompt could never render, and the symptom was indistinguishable from the server never sending it (the page just sat there, because a `data()` reply does not navigate).

**Rule:** When an action's response drives UI that appears AFTER success, own the fetcher in a component that outlives the state change — here `JobOperation`, passing the fetcher down into the modal and rendering the prompt itself, ungated by `batch`. Before wiring a post-success view, ask which component the success unmounts.

**Applies to:** MES `JobOperation` + `BatchCompleteModal`/`BatchMergePrompt`; any modal gated on loader data that its own submit invalidates.

## A row stayed off a screen only because a column happened to be null

```scope
id: a-row-stayed-off-a-screen-only-because-a-column-happened-to
paths: []
triggers: ["get_active_job_operations_by_location","get_batchable_operations","normalizeOperationSourceIds","assertEligible"]
```

**Context:** The MES Work Centers board, the ERP Priority board and the API read `get_active_job_operations_by_location`. Both boards group operations into work-center columns.

**Problem:** An Outside Processing operation showed up on the MES board for an operator to start (2026-10-05). The function never filtered on `operationType`; subcontracted operations stayed off the boards only because they usually have no work center, so they had no column. The work center came back two ways. The operation forms hide the Work Center field for Outside Processing, and a hidden field is omitted from the submit, not cleared, so an update left the work center from the operation's earlier in-house type. Batching was the second way: `get_batchable_operations` offered outside operations, and releasing a batch writes the batch's work center onto every member.

**Rule:** Filter on the fact that decides whether a row belongs, never on a column that only usually agrees with it. When a type makes a field meaningless, clear the field in the one function every writer goes through (`normalizeOperationSourceIds`), because hiding the input does not clear it. Hiding a row from a list is not a gate: refuse it in the routes that open and start it too.

**Applies to:** `get_active_job_operations_by_location`; `get_batchable_operations` and the `batch-operations` `assertEligible`; the MES operation, start and event routes; any form that hides a field by type; any list whose visibility rests on a NULL.

## Guard a state by listing everything that writes it, not by who calls the check

```scope
id: guard-a-state-by-listing-everything-that-writes-it-not-by-wh
paths: []
triggers: ["status: \"Ready\"","SET status = 'Ready'","updateJobStatus"]
```

**Context:** Strict backflush (2026-10-17). Release had to refuse a job with a line that had no storage unit. The check was added where the release check already ran: the Release dialog, bulk release, batch release.

**Problem:** Two more paths set a job to Ready without any check. The kanban scan with auto-release wrote `status: "Ready"` straight to the job with the service role. The MCP / API tool `production_updateJobStatus` wrote any status. A search for callers of the release function cannot find a direct write. A self-review on a fixed file list did not look outside it, and the docs then claimed "every release path".

**Rule:** To guard a state change, first list every writer of that state: grep for the value being written (`status: "Ready"`, `SET status = 'Ready'` in SQL) and for every caller of the write function, including MCP tools. Put the check where all writers meet, or give each writer the check. Keep the unchecked write out of the API (no `@mcp` tag). Do not claim "every path" without that list.

**Applies to:** release, completion, posting, cancellation — any status a check must gate.

## Loader-computed "current unit" must match the component's, or per-unit attribution credits the wrong unit

```scope
id: loader-computed-current-unit-must-match-the-component-s-or-p
paths: ["apps/mes/app/routes/x+/assembly.$operationId.tsx","apps/mes/app/components/AssemblyView.tsx"]
triggers: ["currentUnitIndex","unitIndex"]
```

**Context:** The MES assembly view resolves the unit on screen twice: the loader (`apps/mes/app/routes/x+/assembly.$operationId.tsx`) computes `unitIndex` from `?unit`/`?trackedEntityId`, and `AssemblyView.currentUnitIndex` computes it again client-side. Per-unit material issue attribution (batch parents) was moved into the loader, keyed off the loader's `unitIndex`.

**Problem:** The two defaults diverged. When there's no `?unit` param, `AssemblyView` lands on the NEXT unit still to build (`min(quantityComplete, units.length-1)`) — and the auto-complete effect DELETES `?unit` after finishing a unit — but the loader defaulted `unitIndex` to `0`. So on unit 2 (default landing) the loader attributed unit 1's stamped consumes (`Unit=1`) to the unit-2 view: parts showed `1/1`/`2/1` though nothing was issued to unit 2, and the scan gate (which reads the same values) let the operator Mark done. Serial parents were unaffected (attribution is per-entity, and both default to 0).

**Rule:** When a loader and its component both compute the same "current X" and one feeds data the other renders, their resolution logic — including the no-param default — must be identical. For the assembly loader, mirror `AssemblyView.currentUnitIndex`: index-paged (batch/untracked) parents default to `min(quantityComplete, opQty-1)`, serial parents to `0`. If you make a loader-computed index load-bearing for attribution, re-derive it the exact same way the UI does.

**Applies to:** `apps/mes/app/routes/x+/assembly.$operationId.tsx` (`unitIndex`) ↔ `apps/mes/app/components/AssemblyView.tsx` (`currentUnitIndex`); any loader/component pair where one computes an index the other renders.

## A gate on the buttons is not a gate: a rule needs one owner and a list of its writers

```scope
id: a-gate-on-the-buttons-is-not-a-gate-a-rule-needs-one-owner-a
paths: ["apps/mes/app/services/work-unit.server.ts","apps/mes/app/utils/workUnit.ts","apps/mes/app/components/JobOperation/**","apps/mes/app/components/AssemblyView.tsx","packages/checks/src/conformance/mes-unit-write-resolves-unit.ts"]
triggers: ["resolveWorkUnit","useWorkUnit","serialUnitSelection"]
```

- **Context:** On a later operation of a serial part, every write names a unit the operator picked or scanned.
- **Problem:** The rule was copied into each entry point: buttons, scan hooks, the scan queue, a few routes. Nobody listed the writers, so three review rounds each found another one: a scan hook, the off-page traveler scan, then the kanban end route (and the start route still picked its own unit). The held unit lived only in the URL, which redirects, links, refresh and Back also write, so every fix filtered the URL after the fact and opened a new window. The two screens ran two different copies of the selection logic, and the tests checked helpers, not the routes.
- **Rule:** Give a rule one owner per side and make a missed writer fail a check. On the server one function decides from the database and every writer calls it before it writes; a conformance check lists the writers and fails one that does not call it (or is not on an allow-list with its reason). On the client one pure decision is computed during render; the operator's pick is state set in the click or scan handler, and the URL only mirrors it. Test the write paths themselves over an in-memory client, and revert each call to see the test go red (not every route has such a test yet). An allow-list reason must be checked by code, not just written down (`unconsume` now checks the parts were consumed into the parent; "a manager override" did not cover writing a unit nobody picked, so complete-all now resolves its unit too). Gate a write by what the server accepts for it: a finished unit blocks `require` writes only, not `member` ones (unconsume, quality issue). The owner's reads, and the screens' reads of the same list, must not depend on PostgREST's 1000-row cap (one paged reader). A new gate must keep an older page's safe requests working: tablets keep the old bundle for hours, so a first-operation step with no unit still uses its index, and a timer naming a finished unit is not refused. When the server changes what a request named, it says so in the toast.
- **Applies to:** MES `resolveWorkUnit` (`services/work-unit.server.ts`) and its `mes-unit-write-resolves-unit` check, `useWorkUnit` / `serialUnitSelection` (`~/utils/workUnit`) in `JobOperation` and `AssemblyView`, and any future rule on per-unit work.

## A Make to Order line is never picked, and never split for Consume First (2026-09-16)

```scope
id: a-make-to-order-line-is-never-picked-and-never-split-for-con
paths: ["packages/database/src/job-quantities-engine.ts"]
triggers: ["get_picking_schedule","generatePickingList","itemToJobMakeMethod","itemToJob","settleConsumeFirstLines"]
```

- **Context:** a Consume First sub-assembly on a Make to Order BOM line, three
  old on the shelf, five needed. The job swapped the line to the successor and
  built five (Plate B 5), and the picking list ALSO staged three old and two
  new from the shelf for the parent operation.
- **Problem:** two bugs stacked. `get_picking_schedule` never excluded Make to
  Order lines, and since unassigned materials are attributed to the first
  operation every Make to Order sub-assembly got a phantom pick that nothing
  consumes (`issue`'s backflush skips Make to Order). And the made-line rule
  "always swap" meant stocked old sub-assemblies were never used. The obvious
  fix — split the line into "pick 3 old" + "build 2 new" — dies at the next
  `recalculate`, which rebuilds every line as per-assembly × parent quantity.
- **Rule:** a Make to Order line follows the bought Consume First rule by
  CHANGING METHOD TYPE, not by splitting: when the predecessor covers one whole
  assembly it becomes a Pull from Inventory line on the predecessor (decided in
  the row builder, before insert, so no sub-method row is ever created), and
  picking splits per unit as for any picked line; otherwise it swaps and is
  built. Picking excludes Make to Order lines everywhere (SQL + TS). When a
  fix needs two rows where the BOM has one, check what `recalculate` will do
  to them before writing it.
- **Applies to:** `get-method` row builders (`itemToJob`,
  `itemToJobMakeMethod`), `generatePickingList`, `get_picking_schedule`,
  `lib/job-quantities-engine.ts`.

## A save that reconciles a whole set must be shown the whole set, whatever the page filters

```scope
id: a-save-that-reconciles-a-whole-set-must-be-shown-the-whole-s
paths: ["apps/erp/app/modules/production/ui/Schedule/People/*"]
triggers: ["setPeopleDay","editorDayRows"]
```

**Context:** The People board's day editor (`PeopleHoursModal` → `setPeopleDay`) saves a person's day: it updates the rows it is sent and DELETES the rows of the save's shift it is not sent (2026-10-28).

**Problem:** The editor opened with the rows the page showed. The department filter hid rows at other stations, and the shift filter hid rows of other shifts, while the save was scoped to the person's own shift (or every shift, for a person with none). Saving deleted rows the user never saw, or inserted a second row for a station the person already held in another shift.

**Rule:** A save that reconciles a set (deletes what it is not sent) gets that set from the same scope the server deletes by, never from what the page filtered. Pass the unfiltered rows next to the filtered ones and select the save's scope in one pure helper (`editorDayRows`, `peopleShared.ts`), with a test.

**Applies to:** `apps/erp/app/modules/production/ui/Schedule/People/*` (Board and Matrix editors), `setPeopleDay` and any other "make these rows the whole day/week" write in `production.service.ts`.

## Job-completion side effects must live in complete_job_to_inventory, not in route actions

```scope
id: job-completion-side-effects-must-live-in-complete-job-to-inv
paths: ["apps/erp/app/routes/x+/job+/$jobId.complete.tsx"]
triggers: ["complete_job_to_inventory","sync_finish_job_operation","sync_update_job_operation_quantities"]
```

**Context:** Service-job fulfillment (advance the linked salesOrderLine on completion) was first implemented in the ERP `$jobId.complete.tsx` action after the RPC call. In e2e it never ran: the operator finished the last operation, and `sync_update_job_operation_quantities` → `sync_finish_job_operation` (DB interceptors) called `complete_job_to_inventory` directly — the ERP route was never involved.

**Problem:** Job completion has multiple entry points — the ERP Complete button AND the interceptor cascade that auto-completes when the last operation flips to Done (fired from MES quantity recording or ERP production quantities). Any completion side effect hooked at the app layer silently misses the interceptor path.

**Rule:** Side effects that must accompany job completion (fulfillment, status propagation, posting) go INSIDE `complete_job_to_inventory` — the single choke point every path crosses. Place them before the `accountingEnabled` / zero-WIP early returns if they must run unconditionally. App-layer completion hooks are only valid for effects the SQL function cannot perform (edge-function invocation — cf. `returnAllocatedRemaindersAtJobComplete`, orchestrated in TS for exactly that reason).

**Applies to:** `complete_job_to_inventory`; `apps/erp/app/routes/x+/job+/$jobId.complete.tsx`; `sync_finish_job_operation`; any future completion-triggered behavior (rev-rec POC recognition events).

## One fact, one source: a pointer beside its own history lost the order of loads

```scope
id: one-fact-one-source-a-pointer-beside-its-own-history-lost-th
paths: ["packages/database/src/event-system/handlers/sync_load_work_center_operation.sql","packages/database/src/event-system/handlers/sync_unload_work_center_operation.sql"]
triggers: ["workCenterLoad","loadedJobOperationId"]
```

**Context:** The OEE work (2026-10-13) kept the loaded operation twice: the pointer `workCenter."loadedJobOperationId"` + `"loadedAt"`, and the history table `workCenterLoad` that the same interceptors wrote.

**Problem:** The unload cleared `loadedAt` with the pointer. That timestamp was the only watermark that ordered loads: the rule "an older start never replaces a newer load" compared against it. After an unload there was nothing to compare, so a late event (a start older than the unload) loaded the operation that had been replaced, and opened a history row that overlapped its neighbours. The pointer and the history then disagreed, and the sync gave run time to the wrong operation.

**Rule:** Keep one source for a fact. When a history exists, the current value is a row of it (here the open `workCenterLoad` row), not a second column to keep in step. Order writes against the history itself: refuse a write that is older than the newest boundary (any `loadedAt` or `unloadedAt`), and back it with constraints (a CHECK that an interval does not end before it starts, a partial unique index for one open row).

**Applies to:** `workCenterLoad` and its interceptors (`sync_load_work_center_operation`, `sync_unload_work_center_operation`), and any "current pointer + history" pair (statuses with a status log, assignments with an assignment history).

## A mutually-exclusive primary/fallback branch breaks when the primary source can be legitimately empty

```scope
id: a-mutually-exclusive-primary-fallback-branch-breaks-when-the
paths: ["apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx"]
triggers: ["pickedAllocation","suggestedAllocation","pickingListLineTrackedEntity"]
```

**Context:** The MES Issue dialog (`IssueMaterialModal`) pre-selects tracked lots from two sources: `pickedAllocation` (lots a picking list already picked) and `suggestedAllocation` (the FEFO/pickMethod suggestion of what to pick). It gated the suggestion off whenever a picking allocation merely existed (`shouldSuggestAllocation = … && !hasPickingAllocation`) and chose `seedAllocation = hasPickingAllocation ? pickedAllocation : suggestedAllocation`.

**Problem:** `hasPickingAllocation` was true when `quantityToPick > 0` — i.e. the material is ON a picking list — but `pickedAllocation` is only non-empty once something is physically PICKED (pickingListLineTrackedEntity rows are written at pick time, never at allocation). For a material on an In-Progress list that hasn't been picked yet (common in a multi-line list where other lines were picked first), the primary branch was selected but resolved empty, the suggestion was gated off, and the seed effect bailed → operator got the default first lot instead of the recommendation. The two conditions "should we prefer picked lots" and "do picked lots exist" were conflated.

**Rule:** When one data source is the preferred seed and another is the fallback, branch on whether the preferred source actually HAS data (`primary.length ? primary : fallback`), and load the fallback unconditionally — do not gate the fallback off on a proxy signal (here `hasPickingAllocation`) that can be true while the primary is still empty. Verify the "primary exists but is empty" state explicitly, since it's the one static reading and happy-path testing both miss.

**Applies to:** `apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx` (picked vs suggested allocation seeding); any picking-list-aware UI that distinguishes allocated-but-not-picked from picked (`pickingListLineTrackedEntity.quantityPicked > 0`).

## A post-insert fix-up pass must be scoped to the rows the flow inserted, not to the parent entity

```scope
id: a-post-insert-fix-up-pass-must-be-scoped-to-the-rows-the-flo
paths: ["apps/erp/app/modules/production/production.service.ts"]
triggers: ["itemToJobMakeMethod","buildConsumeFirstHops","settleConsumeFirstLine"]
```

**Context:** `pullConsumeFirstPredecessors` in `get-method` ran after every jobMaterial insert and read `WHERE jobId = …`. Three of the four flows rebuild the whole job, so that read was equivalent — but `itemToJobMakeMethod` rebuilds ONE sub-method, and the pass rewrote lines on every other sub-method too, including rows that already had issued quantity in the successor's units.

**Problem:** A pass keyed on the parent id is correct for the flow it was written next to and silently over-broad for any flow that rebuilds a subset. Nothing fails: the rewritten row has plausible numbers and a plausible provenance column, and only the units disagree with what was already issued.

**Rule:** A fix-up pass that runs after inserts takes the inserted row ids (collect them at every insert site of every flow) and filters on them, plus a guard on any state that means "this row's units are already committed" (`quantityIssued > 0`). Never derive the candidate set from the parent entity when some caller rebuilds only part of it.

**Applies to:** `getMethod` (`apps/erp/app/modules/production/production.service.ts`) post-insert passes, any future "after all rows are in, patch some" step in the four job flows.

## Type a cross-app call by what the receiver accepts

```scope
id: type-a-cross-app-call-by-what-the-receiver-accepts
paths: ["apps/mes/app/services/erp.ts","packages/api/src/postings.ts"]
triggers: ["MES_POSTINGS","ErpPostingInput"]
```

**Context:** MES calls ERP postings over HTTP, and the ERP refuses any posting or `type` value that is not in `MES_POSTINGS`.

**Problem:** The first allowlist came from a hand inventory of the MES call sites and missed `issue`/`trackedEntitiesToOperation`. Every check passed. The miss would have shown only in production, as a 404 when a user issued tracked entities to an operation.

**Rule:** Derive the caller's input type from the receiver's allowlist (`ErpPostingInput`, `apps/mes/app/services/erp.ts`). Then a value that the receiver refuses fails the caller's typecheck. Keep casts out of those call sites, or check the values behind each cast by hand.

**Applies to:** `apps/mes/app/services/erp.ts`, `packages/api/src/postings.ts`, any other server-to-server contract.
