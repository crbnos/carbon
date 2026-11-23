---
paths:
  - "apps/mes/app/components/JobOperation/**"
  - "apps/mes/app/routes/x+/operation.$operationId.tsx"
  - "apps/mes/app/routes/x+/batch.$batchId.tsx"
  - "packages/react/src/hooks/useKeyboardWedge.ts"
  - "apps/mes/app/routes/x+/traveler.*"
  - "apps/mes/app/routes/x+/line-feed*"
  - "apps/mes/app/utils/traveler.ts"
  - "apps/mes/app/utils/trackedMaterials.ts"
  - "apps/mes/app/utils/workUnit.ts"
  - "apps/mes/app/services/work-unit.server.ts"
  - "apps/mes/app/services/kanban-scan.server.ts"
---

# MES Job Operation UI

The operator-facing screen for working a single job operation: timers, materials,
steps/parameters, files, serials, and scrap/rework/finish actions.

## Route & data flow

Execution views are routed by `jobOperation.operationType` via
`resolveOperationView` (`apps/mes/app/utils/operationView.ts`): `Assembly` →
`/x/assembly/:id` (`AssemblyView`), `Inspection` → `/x/inspection/:id`
(`components/Inspection/InspectionView`, see `inspection-system.md`), everything
else → this operation view. Each route opens with a redirect guard that only
redirects kinds it does not serve (no loops).

- **Route:** `apps/mes/app/routes/x+/operation.$operationId.tsx` — `/x/operation/:operationId`.
- **Loader** (uses `getCarbonServiceRole()`, not the user client) first runs the
  company check `getJobOperationForCompany`, which also returns the operation's
  `jobId`, `jobMakeMethodId` and `jobOperationBatchId`. Every other read starts
  right after it in ONE `Promise.all`, before the redirect checks:
  `getJobOperationById`, `getJob`, `getProductionEventsForJobOperation`,
  `getProductionQuantitiesForJobOperation`, `getTrackedEntitiesByMakeMethodId`,
  `getJobMakeMethod`, `getKanbanByJobId`, `isFirstOperationOfMakeMethod`, the
  batch reads when the op is in a batch, and the thumbnail (chained on the
  operation read). A redirect throws those reads away; the ids are the
  company's, so nothing leaks. Keep new reads in that wave rather than adding
  a step after it. Deferred promises: `files`, `materials`, `procedure`,
  `workCenter`, `nonConformanceActions`. `operation` is wrapped with
  `makeDurations(...)` → `OperationWithDetails`. Quantities are reduced into
  `{ scrap, production, rework }`.
- On a serial part's **first** operation with no `?trackedEntityId`, the loader
  redirects to the same URL with the first unit still open there. A later
  operation gets no redirect, and with no unit in the URL its `materials`
  carry no unit's scanned inputs (a batch part reads its lot's). See Serial
  unit selection.
- The default export passes everything to `<JobOperation key={...} .../>`.
- **Mutations are separate routes**, not actions on this route. `Controls` posts to
  `path.to.startOperation(id)` (`/x/start/:operationId`) and
  `path.to.endOperation(id)` (`/x/end/:operationId`); rework targets at
  `path.to.reworkTargets(id)`. Start/end routes write `productionEvent` /
  `productionQuantity` (end calls `finishJobOperation`). Their bodies are
  `startOperationByScan` / `endOperationByScan` (`services/kanban-scan.server.ts`);
  `complete.tsx` and `record.tsx` run `completeOperationQuantity`
  (`services/complete.server.ts`) and `recordStep` (`services/step-record.server.ts`).
  Each route authenticates and passes its clients in, so the tests drive them
  over an in-memory client.
- **Rework** (`ReworkModal` → `x+/trigger-rework.tsx`): the target list is the
  earlier operations plus the part's corrections (`rework-targets` returns
  both). A correction is sent as `correction:<jobCorrectionId>`
  (`CORRECTION_TARGET_PREFIX`) in `targetJobOperationId`; the route then calls
  the `trigger-correction` posting instead of `trigger-rework`, with the
  selected serials. This is how an operator sends a unit to a generic rework
  station: a correction whose one operation sits at the rework work center.
- **Scrap** (`.ai/specs/2026-08-06-scrap-unscrap-flow.md`): `x+/scrap.tsx` makes
  ONE `issue` `jobOperationScrap` invoke (replacing the old
  `insertScrapQuantity` + backflush pair) — it records the Scrap
  `productionQuantity`, backflushes the unit's BOM, flips the selected serial to
  `Scrapped`, **spawns the replacement serial** (returned as `newTrackedEntityId`
  for client advancement), reopens the make method's Done ops, and posts
  Dr `scrapAccount` / Cr WIP for the consumed-material cost. Scrapping a
  **subcomponent** (serial/batch BOM part) goes through
  `x+/entity+/$materialId.$trackedEntityId.scrap.tsx` → `issue`
  `scrapTrackedEntity`, reached from a dedicated **Scrap tab** in the
  `IssueMaterialModal` (`ScrapTab` lists the material's Available + Consumed
  entities; each opens `ScrapEntityModal`). With a scrap rule enabled the route
  sends the valued entity quantity as `expectedQuantity`; the posting re-reads
  the entity `FOR UPDATE` and refuses a changed one (409), which discards the
  approval. That case branches on entity
  **state**, not `methodType`: an `Available` (picked/in-stock) part scraps from
  stock (`Negative Adjmt`, Dr scrap / Cr inventory, `quantityIssued` untouched);
  a `Consumed` part relieves WIP (Dr scrap / Cr WIP at the item's unit cost) and
  **decrements `jobMaterial.quantityIssued`** so the requirement reopens for a
  replacement. MTO make-replacement (reopen routing + spawn serial + rework row)
  runs for either state. **The auto-Done predicate no longer counts
  `quantityScrapped`** (`sync_update_job_operation_quantities`, `20260807090629`) —
  scrap doesn't consume the good `targetQuantity`, so app-side remaining/Done
  mirrors (`complete.tsx` `willBeFinished`, `InspectionView`/`quality.server`
  `opRemaining`) also dropped the scrap term.
- **Scrap approval** (`.ai/specs/2026-10-24-scrap-approval.md`): the operation
  scrap route, the component scrap route, `batch.$batchId.complete.tsx`
  (when a member scraps) and `inspection-lot.$id.disposition.tsx` (when the
  disposition scraps; `DispositionModal` holds the step) wrap their posting in
  `postScrapWithApproval`
  (`services/scrap-approval.server.ts`). With an enabled `scrap` approval rule
  whose tier the estimated value meets, the first submit answers
  `{ scrapApproval: prompt }` (value, currency, the approvers with a console
  PIN) and posts nothing; the modal (`ScrapApprovalStep` / `useScrapApproval`,
  `components/JobOperation/components/ScrapApproval.tsx`) stays open and sends
  the same form again with `approverId` + `approverPin` + `approvedValue` (the
  value shown; a changed scrap quantity clears the prompt). The route refuses
  the recorder as approver, checks authority (`authorizeScrapApprover`), refuses
  an approver the prompt did not offer (inactive, no PIN) and a value that
  differs from `approvedValue`, checks the PIN under the console pin-in budgets
  (`services/pin-limits.server.ts`, shared with `console.pin-in.tsx`), records
  the approval, posts, and marks it posted. A failed authority or PIN check asks
  again with a retryable message and records nothing. Only a 4xx refusal deletes
  the record; any other failure keeps it unconfirmed. A batch whose phase 2 failed
  resumes without a second approval (`alreadyApproved`, which names the
  unconfirmed record a successful resume marks posted); a failed completion marks
  its approval posted only when this attempt moved the batch past phase 1
  (`postedDespiteError`). No rule: the posting runs as before.
- **`finishJobOperation`** (`operations.service.ts`) flips the op to `Done` (firing
  the `sync_finish_job_operation` trigger that completes the job to inventory when
  it's the last op). It then runs `returnPickedRemainders`: one `post-picking`
  `returnOperationRemainders` sweep — the posting sweeps the whole job when
  `job.status='Completed'`, else no-ops unless
  `companySettings.returnPickedMaterialTiming = 'operation'`. The sweep
  returns un-consumed lineside remainders (tracked AND untracked) to their
  warehouse source, booking `pickingListLine.quantityReturned`. The SQL trigger
  can't call postings, so this is orchestrated in TS. See
  `.ai/specs/2026-08-04-picked-material-return-timing.md`.

## Ability gate

When the operation's process has `requiresAbility` on and the operator has no
current `employeeAbility` row, `getAbilityShortfall` (`operations.service.ts`)
returns what is missing: the process's `abilityPolicy`, the process name, the
expiry date and an Active training whose `grantsAbilityId` is the ability. It
fails open on any read error. The operation, assembly and inspection loaders
pass it to the view as `abilityWarning`, which `AbilityWarning` renders as a
banner.

- `Warn`: banner only.
- `Block`: the view disables production work (start, complete, scrap, rework,
  finish, step records, material issue, inspection verdicts) and skips timer
  auto-start; pausing a running timer stays enabled. Every write route calls
  `abilityBlockRefusal` before it writes: `event` (Start only), `start.$operationId`,
  `end.$operationId` (the kanban complete scan), `batch.$batchId.complete`,
  `batch.$batchId.record` (one member checked: every member runs the batch's one
  process), `complete`, `finish`, `scrap`, `rework`, `record`, `record.$id.delete`, `issue`,
  `issue-tracked-entity` (single operation), `unconsume`, `entity+/…scrap`, and the
  inspection `sample`, `measurement`, `disposition` and `complete-passed` routes.
  Not gated: `steps.complete-all` (a manager override), `steps.inspection` (an
  automatic sync) and a batch pick.

`event.tsx` also redirects a full-page POST (`Sec-Fetch-Mode: navigate`, a press
before the page hydrates) back to the referrer with the flash, so the operator never
lands on the bare resource route.

## Batch mode (operation batching)

**Floor gate (membership handoff), enforced server-side.** An operation is
floor-visible iff — in a batch → the batch is Released (`Active`/`Completing`),
even when its job is Draft/Planned; in no batch → its job is in
`activeJobStatuses` (the pre-batching rule). The operation loader
(`operation.$operationId.tsx`) redirects with a flash for a `Planned`-batch
member ("part of a batch that has not been released") and for an unbatched op
on an unreleased job; `start.$operationId.tsx` runs the same two checks BEFORE
its timer-reopen update. `end.$operationId.tsx` is deliberately ungated —
closing a timer is never blocked. `getOpenJobs` widens with Released-batch
member jobs via a two-step `.or(status.in…, id.in…)` (quoted statuses — "In
Progress" has a space). List visibility alone was the leak: nothing else gated
a direct operation URL.

**Outside Processing never runs on the floor.** Subcontracted work runs at the
supplier: `get_active_job_operations_by_location` filters it by type (not by a
null `workCenterId`, which a stale value defeats), and the operation loader, the
`start.$operationId.tsx` loader (before its timer re-open) and `event.tsx`'s
Start branch all refuse it with `OUTSIDE_PROCESSING_REFUSAL`
(`utils/operationView.ts`). `resolveOperationView` still maps it to the Operation
view so the resolver stays total; the refusal is the routes' job.


There is **no separate batch page** — the operation view IS the batch UI. In
batch mode the job heading is replaced by ONE scope switcher — an outlined
`rounded-full` pill `(BAT… N jobs | Jobs ⌄)` whose selected segment gets a soft
`bg-accent` fill; the second segment IS the member-job picker (it reads the
open job's id in the job scope) — which sets
`?scope=` between **Batch**
(default; `BatchOverview`: completed/issued/scrap/output-lot stat cards, one
materials table from `getBatchMaterialTotals` with the per-job split and a
batch-wide "Pick N", the steps/parameters/files of every member, and the
member jobs table — each list in a bordered panel with the DS `Table`) and the member's own job
details (`?scope=job`, which member links use). The `IssueMaterialModal` is
mounted in both scopes via `renderIssueModal`. The batch scope shows no member's
values anywhere: the context bar reads batch status (Released/Completing),
customers, the batch plan and the earliest member due date; the dock's Item is
the batch's item (or "N items"); the ⋮ menu offers only the batch list (plus
Item Master when every member makes the same item). The tabs stay as on a
single job: Details (`BatchOverview view="details"`: stats, a load list only when parts must be
kept apart (the jobs make different items, or each job gets its own output lot)
— each job's quantity to run with due date/customer and a total — materials grouped "To pick" / "Used automatically at completion",
and files) and Instructions
(`view="instructions"`: the batch's steps and process parameters); Chat is
disabled on the batch because notes (`jobOperationNote`) belong to one job
operation. The job scope
opens with a banner saying the job runs in the batch — timer and completion are
shared — with "Back to batch". Work-instruction steps are recorded
for the whole batch from `BatchRecordModal` — a per-job grid with an "All
jobs" row that fills every cell (typed cells for Measurement/Value/List/Person,
ticks for Task/Checkbox/Timestamp, one upload copied into each job's own step
folder for File/Inspection) posting to `batch.$batchId.record.tsx`
(`insertBatchStepRecords`: steps re-read under the batch + company, upsert at
record set 0, then the per-step backflush). Only new or changed rows are sent,
since a re-record re-runs the step's backflush. When an
operation belongs to a batch that is still `Active`/`Completing`, the loader
(`operation.$operationId.tsx`) reads `jobOperationBatch` (via
`getJobOperationBatch`; the RPC `get_job_operation_by_id` omits
`jobOperationBatchId`, so a direct one-column read detects membership), swaps the
per-op events for the batch's events (`getProductionEventsForBatch`), and passes
`batch` to `<JobOperation>`. A `Completed` batch was already re-sliced per member,
so the loader passes `batch: null` and the page is a plain operation view.

`batch.$batchId.tsx` is now a **loader-only redirect** to the first member's
operation (`path.to.operation`). Legacy links keep working: the ERP board's "Open
in MES" (`path.to.external.mesBatch`) and the MES kanban batch card
(`path.to.batch`). Completion still POSTs to `batch.$batchId.complete.tsx`
(unchanged) → `batch-operations` posting.

In batch mode `JobOperation` derives `isBatched = !!batch`,
`isCompleting = batch.status === "Completing"`, and:
- **Shared timer** — `useOperation({ batchId })` subscribes the `productionEvent`
  realtime filter to `jobOperationBatchId=eq.<id>` (all members' timers), and
  `StartStopButton` renders `<Hidden name="jobOperationBatchId">` so the event is
  tagged. `event.tsx`'s End branch **skips `post-production-event`** for a
  batch-tagged event — cost posts once at batch completion when the aggregate
  events are sliced per member. A timer started on any member is the same shared
  timer on every member's page.
- **Batch-total planned durations** — `displayOperation` converts each member's
  times with `makeDurations`, then delegates to `@carbon/utils`
  `batchPlanBreakdown(durations, batch.process?.batchType ?? "Sequential")` (the
  same helper the scheduler's `batchDuration` shares its run-combining rule with,
  and the ERP builder/drawer use). It yields ONE shared setup (the max — that is
  the point of batching) and per-type labor/machine buckets (Σ Sequential | max
  Simultaneous) as the `WorkTypeToggle` / `Times` denominators, and carries
  `plan.total` as `duration` — setup + each member's run `max(labor, machine)`
  combined by batch type, NOT setup + labor + machine (which double-counts a
  member that has both). With a `machineDuration = 1` / `duration = 1` fallback
  when the batch has no planned time anywhere, so the info-bar duration and
  denominators read against the batch's total plan, not one member's.
  The info-bar duration hides entirely when the plan is ≤1ms (no
  "0 milliseconds"), and the per-piece header divides the shared elapsed time by
  the members' summed `quantityComplete` — a quantity-weighted per-piece rate
  consistent with the completion split's `operationQuantity` weights.
- **Scope switcher** — the batch segment carries the yellow `Completing`
  badge; the chevron menu lists members as `Link`s to their `?scope=job` view.
  "Print batch list" lives in the job's ⋮ menu.
- **Completion** — the "Log Completed" button becomes "Complete Batch" and opens
  `BatchCompleteModal`, a **spreadsheet-style grid** (bare `<input inputMode="numeric">`
  cells in a bordered `border-separate` table — no react-aria stepper arrows, no
  close-X via `withCloseButton={false}`, Job / Quantity / Scrap columns —
  the per-member Operation is redundant in a batch). **The operator never
  enters a lot number** — lot identity is planned at batch creation
  (`jobOperationBatch.mergeOutput` / `outputLotNumber`, or each member's WIP
  `trackedEntity.readableId`). A merged batch shows a success `Alert` naming
  the lot; otherwise a read-only **Lot** column lists each member's planned
  lot, and a tracked member with no planned lot blocks submit with a warning
  naming the jobs (legacy batches — fix via the job's properties sidebar).
  Each row still submits a hidden `trackedEntityId`. Rows are pre-filled
  `operationQuantity − quantityComplete`, controlled as strings in local state.
  Completing a batch **auto-stops** any still-running shared timer: the Phase-1
  txn closes open `jobOperationBatchId`-tagged `productionEvent`s with
  `endTime = NOW()` before slicing (mirroring `sync_finish_job_operation` on a
  single op's `Done`), so submit is NOT gated on the timer and there is no "stop
  the timer" note. **"Not in this run" is now implicit: leave a member at 0
  quantity AND 0 scrap** — the modal derives `excluded` from that, submits
  `excluded="true"` (string flag, the `exclusive` idiom), and `batch-operations`
  detaches it back to the schedule un-run inside the Phase-1 txn — no time slice,
  no quantities, not Done. There is no explicit exclude toggle/X and no amber
  "completed with 0" warning: 0 simply means not-in-this-run. All-excluded (every
  row 0/0) disables submit. Scrap / Rework /
  Finish are hidden in the actions sheet (per-op writes would double-count a
  member); Maintenance + Quality Issue stay.
- **Planned merge** — when `batch.mergeOutput`, the completion route passes
  `outputLotNumber` as every member's batch number, then (after completion
  succeeds) `getPlannedMergeLots` reads the members' Available output lots and
  invokes `issue` `mergeTrackedEntities` with that readableId. The merge
  carries **no entity ids from the form** — the route derives them server-side
  from batch membership before calling `issue`. A merge failure leaves the batch completed with
  per-member lots; the ERP batch drawer's "Merge output lots" is the recovery
  path. The route returns `data({ completed: true })` + flash, NOT a
  redirect: the completion's own writes fire `useOperation`'s realtime
  `revalidate()` mid-action, and React Router drops a fetcher redirect when a
  newer navigation started after the submit — `JobOperation` navigates to
  `path.to.operations` when the fetcher settles with `completed`. The job's ⋮
  menu also offers
  "Print batch list" (`path.to.file.batchLoadList` → the ERP
  `/file/batch/:id.pdf` route, `BatchListPDF`). The kanban keyboard wedge is
  disabled (`active: !!kanban?.id && !isBatched`) — it completes a single op,
  never a batched member.

## Barcode scans (keyboard wedge)

`useKeyboardWedge` (`@carbon/react`) registers a handler with ONE capture-phase
`keydown` listener on `window`, shared by every wedge on the page, so a
component that stops a key (Combobox, Dock) cannot hide a scan from it.
`ScanReader` splits the keys into bursts at any gap over 80 ms. A stray key is
therefore dropped rather than kept in front of the next scan, and two
scanner-speed bursts are joined (a Bluetooth pause). From the fourth
scanner-speed key on, the keys are kept from the page, so a scan never hits
Space (Start/Pause) or clicks the focused button with its Enter. A scan with no
Enter or Tab ends after 700 ms of quiet. Ending sooner acted on the first half
of a paused URL, which is itself a valid link.

- The MES layout opens MES/ERP links. A kanban Create, Start or Link label
  (`kanbanScanPath`, `~/utils/kanban`) opens its path on this deployment's
  `ERP_URL`, whatever origin it was printed from; matching the whole origin
  sent a label printed from another address to the traveler lookup ("Nothing on
  this page uses that barcode"). On an operation or assembly page
  (`/x/operation/`, `/x/assembly/`) it leaves a traveler link to the page's own
  `useTravelerScan` (see Traveler scan below). `JobOperation` and `AssemblyView`
  complete the kanban (`isKanbanCompleteScan`, `~/utils/kanban`). That check
  compares the label's PATH, because a label holds the origin it was printed
  from. It accepts the completed barcode override and the printed label.
- An ERP item link (`/x/part/<id>`, also material, tool, consumable;
  `parseItemCode`, `~/utils/itemScan`) scanned on the operation page is issued
  to the job, and the operator stays on the page (`useItemScan` →
  `x+/issue-scan.tsx` → `issueScannedItem`, `services/issue.server.ts`). The
  server decides (`planItemScanIssue`, tested). A part or tool is counted: ONE
  scan is ONE piece (the rest, when less than one is short), so the operator
  scans once for each piece taken off the shelf. A material or consumable
  (`jobMaterial.itemType`) is issued by measure: one scan issues all the job
  still needs. An untracked material takes it as a `Negative Adjmt.` with
  `refuseOverIssue`: the ERP `partToOperation` posting refuses, under the
  material's lock, an issue above the requirement ("This job already has all
  its X", "This job needs only N more X"), so a second device or the
  completion backflush cannot push it over. The Issue dialog does not send the
  flag. A batch part takes the lots `getSuggestedAllocationForMaterial`
  suggests at the job's location. The action returns numbers (`quantity`,
  `issued`, `required` over every line of the item a scan can fill,
  `itemScanTotals`), and the hook words the toast with `formatQuantity`.
- **The scan queue** (`useItemScan`, `~/utils/itemScanQueue`, tested). No scan
  may be lost, so a scan made while an issue is in flight waits; scans of one
  item for one unit are sent together as `pieces`, into that unit. A loading toast shows how many wait.
  The wedge callback returns no promise and sets `whilePending`
  (`useKeyboardWedge`): a pending scan otherwise makes the wedge drop every
  other scan. A refusal drops the waiting scans of that item only; one the
  Issue dialog must settle (`materialId`) empties the queue. Only a scan made
  with the dialog open closes it. Leaving the screen with scans waiting shows
  how many pieces were not issued. A
  serial part, a part the job makes, a short lot or a work-center rule opens
  the Issue dialog on the material. The scan also issues while the Issue
  dialog is open, and the dialog then closes. On the assembly page an item
  scan opens the Issue dialog on the part (each unit takes its own scan). On
  a serial operation with no unit held, neither view issues: it asks for the
  unit (see Serial unit selection). The layout never opens an item link on
  either page.
- The layout sends a raw-id scan to the scan endpoint with a POST
  (`postTravelerScan`), not a fetcher load. A fetcher load is loaded again
  after EVERY action on the page, and acting on each reload reopened the last
  scanned unit's traveler page after each issue.
- A kanban Complete scan on a serial part completes the unit the operator
  holds: `kanbanCompleteTarget` (`~/utils/kanban`, tested) sends the held unit
  (`useWorkUnit`) to `end.$operationId` when it is still open here. With none,
  the first operation lets the route take the next unit in order; a later
  operation asks for the unit instead. The route decides the same way with
  `resolveWorkUnit` (mode `advance`), so a scan from outside the MES (the ERP
  kanban card, a printed traveler QR) on a later operation with more than one
  open unit and no unit named completes nothing: it redirects to the
  operation with "Select a unit first". It takes the one unit left, and it
  refuses a named unit already complete there. At a later operation it
  redirects back onto the completed unit, so the screen asks for the next.
  The kanban Start scan (`start.$operationId`) resolves in mode `start`
  before it touches a timer: as `advance`, except that a later operation with
  several open units and none named starts with no unit, as the in-app Start
  does.
- A completion is recorded once per unit. The ERP refuses a serial unit
  already complete on the operation (its `Operation <id>` marker, which also
  hides the unit here). No production row names its unit, so deleting one
  does not reopen a unit. The `AssemblyView` auto-complete of an untracked parent
  sends `expectedQuantityComplete` (the count its page showed); `complete.tsx`
  records nothing and returns `{ alreadyRecorded: true }` when the operation's
  `quantityComplete` has moved on, since an untracked unit is addressed by
  that count. A manual completion sends no count.
- All three wedges (layout, `JobOperation`, `AssemblyView`) set `inTextFields`: a matching scan is taken even while a field
  has focus, and the field is set back to its value from before the scan.
  A scan no handler takes stays in the field.
- A scan outside a field that no handler takes is kept from the page, and
  the layout's `onUnrecognized` handles it. A traveler link
  (`parseTravelerCode`, `~/utils/traveler`) opens `path.to.traveler(id)`. Any
  other code goes to `x+/traveler.resolve.tsx`. It finds a unit by id, then by
  `readableId` (`findTrackedEntityByCode`). So the raw id on an old label still
  opens its traveler. A code that matches 2 units, or none, shows a toast.
- A callback that returns a promise (`navigate`, `fetcher.load`, or the
  cross-origin `location.assign` that the default callback waits on) keeps
  the scan pending. `useScanPending` drives `ScanPendingOverlay` in the
  layout, and every other scan is ignored until the promise settles (at most
  20 s). A kanban start label loads the ERP and then the MES, so without
  this state operators scanned it twice.

## Serial unit selection

The rule: on a later operation of a serial part, every write names a unit
the operator picked or scanned. It has two owners, one on each side.

**The server: `resolveWorkUnit`** (`services/work-unit.server.ts`, tested by
value and over an in-memory client). It reads, company-scoped and in one
query with embeds, whether the operation's make method is serial and whether
the operation is the first of its make method (no dependency on an operation
of the same make method; a failed read refuses). It reads the units with their
operation scope (`getOperationUnitAxis`: `id, status, attributes`, paged past
PostgREST's 1000-row cap; skipped for `member` with none named and for
`optional` with none named on a later operation),
then answers `unit` (with its place in the unit axis),
`none` (not serial) or `refuse` ("Select a unit first", `SELECT_UNIT_FIRST`,
with `pickUnit`). A named unit must be one of this make method's, in the
operation's scope and (except `member`) open here. In `optional` (a timer) a
named unit that is done here or outside the operation is dropped: the first
operation then takes the next open unit, a later one names none. With none
named, the first operation in `advance` mode (the kanban scans) and in
`optional` takes the next open unit (never a done one: every unit done
refuses in `advance` and names none in `optional`), and any mode but
`optional` and `member` takes the one unit left. "Next" and "the one left" read the screens' list
(`operationUnits`: scope, then quantity); a named unit is checked against the
whole axis.

| Write | Mode |
|---|---|
| `complete.tsx` (`completeOperationQuantity`), `scrap.tsx` (`scrapOperationQuantity`), `rework.tsx`, `issue-tracked-entity.tsx`, `issueScannedItem` (item scan) | `require` |
| `record.tsx` (`recordStep`): the server keys the record by the unit's axis index, not the client's `index`. A request with no `trackedEntityId` (an older page) names the unit at its `index` on a first operation only (`legacyUnitIndex`) | `require` |
| `start.$operationId`, `end.$operationId` (kanban scans) | `advance` |
| `event.tsx` Start (`productionEventAction`, `services/production-event.server.ts`): a timer names a unit only when one is held open; when the server drops the named unit, the toast says the timer runs on the next open unit or on none. Not serial, the id passes through as `lotId` | `optional` |
| `steps.complete-all.tsx` (`completeAllSteps`, `step-record.server.ts`): the manager override (Production delete permission) records every step left for the held unit, keyed by its axis index like `record.tsx` | `require` |
| `quality-issue.new.tsx`, `trigger-correction.tsx`, `entity+/…scrap.tsx` (with `?operationId`) | `member` |
| `unconsume.tsx` (`unconsumeFromUnit`, `issue.server.ts`): the parent, at the material's operation; then `childrenConsumedInto` (one read) refuses parts whose newest Consume did not output that parent | `member` |
| a traveler claim (`issueTravelerUnit`) | `claim`: on a later operation only the unit on screen or the one left |

Not routed through it, each for a reason (`UNIT_WRITE_ALLOW_LIST`):
`trigger-rework.tsx`
(the units are ticked in the dialog), and the inspection lot's disposition and `quality.server.ts` (the
lot's samples are the units). The `mes-unit-write-resolves-unit` check
(`@carbon/checks`) fails an MES route or service that writes a unit without
calling the resolver or being listed; its test lists every unit writer, so a
new one has to be reviewed.

**The screen: `useWorkUnit`** (`JobOperation/hooks/useWorkUnit.ts`) over the
pure `serialUnitSelection` and `workUnitReducer` (`~/utils/workUnit`, tested),
the same for `JobOperation` and `AssemblyView`.

- **The units** are `operationUnits`: those in the operation's scope, capped to
  its quantity. Both views use the same list, and so does the server for
  "next" and "the one left". The loaders read it with
  `getTrackedEntitiesForOperation`, which pages through the same reader as
  `getOperationUnitAxis` (same order), so the screens and the server agree
  past 1000 units.
- **First operation**: units flow in order. The unit is the URL's while it is
  open, else the next open one. The operation loader redirects to the first
  open unit; after a completion the next one follows from the reloaded units.
  A finished unit the operator picks to look back at stays on screen, and no
  write that needs an open unit names it (`writesBlocked`). A timer started
  there sends no unit, so it runs on the next open unit.
- **Later operations**: a unit is held only when the operator picked it (the
  picker, the unit list, the assembly pager) or scanned its label in this
  session, or when it is the one unit left. The pick is React state, set in
  the click or scan handler, so it holds in that render. The URL only mirrors
  it (history replace), so the loader reads that unit and a refresh lands on
  it, but a URL unit alone is never held: a refresh, a link, Back or a server
  redirect asks again. `?scanned` (`TRAVELER_PARAM`, added only to a scan of
  the unit's own label on another page) is read once when the screen opens,
  then dropped from the URL.
- The picker opens while no open unit is held and one is left to pick, until
  the operator closes it on that state; it opens again when the held unit is
  done here. "Select a unit" and a scan that needs a unit open it.
- While no open unit is on screen (`writesBlocked`: none held, or a finished
  unit looked back at): Complete / Log completed, Scrap, Rework, step
  records, Complete all steps and issuing are disabled, and no write that
  needs an open unit names one (`workUnitId` is open units only). Complete
  stays disabled while the held unit is done here. Paging to a unit in
  `AssemblyView` picks it.
- On a later serial operation with no unit on screen, neither view shows any
  unit's records (`shownRecordIndex`, `~/utils/workUnit`): steps read "not
  recorded", the steps bar shows none, and the unit counter reads "No unit
  selected".
- A finished unit looked back at still takes the `member` writes, which name
  it (`reviewUnitId`): a quality issue, and Unconsume. The Issue dialog opens
  on it with `issueBlocked`: Unconsume works, Issue stays disabled with a
  note.
- `AssemblyView` shows the unit `useWorkUnit` holds (picked or looked back
  at), so the steps on screen, their done state, the auto-complete check and
  the complete-all index are the held unit's. The assembly loader still reads
  materials for a default unit; the view ignores them while no unit is shown.
- Scans while no unit is held: an item sticker issues nothing, and the
  server refuses a part's traveler with `pickUnit`. Both say "Select a unit
  first" and open the picker. A traveler scan of a unit of this operation
  picks it and closes the picker (`useTravelerScan`'s `onUnitOpened`). A pick
  of a unit the screen does not list (`pickEvent` returns null) holds nothing
  and says "This unit is not part of this operation".
- Item scans already queued go into the unit held when they were scanned
  (each queue entry keeps it). When the held unit changes, the scans waiting
  for the old one are dropped with the "not issued" toast. The Issue dialog
  opens only on the unit the scan was made for, never while no unit is held
  (`keepScansForUnit`, `canChooseInDialog`, `~/utils/itemScanQueue`, tested).
- **Inspection view.** A lot decides its units through Reject / Partial, which
  name each one. Its action-sheet Scrap and Quality Issue name a serial unit
  only when one is left open; Scrap is disabled for a serial lot with more.
- What the server cannot know: whether the operator held the unit a request
  names. A client that echoes a unit gets past the rule. Tablets on an older
  bundle still send their old default until they reload.
- The picker's field takes a unit id, a serial number or a traveler link
  (Enter or paste).
- Single-option fields: `Select` and `Combobox` (`@carbon/form`) take
  `autoSelectSingleOption`, which fills an empty field that has exactly one
  option. On here: scrap reason, rework target (also the inspection one),
  rework batch, quality issue type.

## Traveler scan

A unit's label QR holds its traveler link, `<MES_URL>/x/traveler/<trackedEntityId>`.
`parseTravelerCode` compares only the path, because a label holds the origin it
was printed from.

- **`x+/traveler.$trackedEntityId.tsx`** resolves the scanned unit with
  `getTravelerTarget` (`get_traveler_target`, see `traceability-model.md`): a
  unit consumed into a parent travels with that parent. Then it acts on the
  target's status:

  | Target status | What the route does |
  |---|---|
  | `Reserved` (a unit in work) | `pickTravelerOperation` picks from the unit's open operations on the active list. An operation at the operator's work center (today's people assignment) wins, else the lowest `operationOrder`. One candidate redirects to `path.to.operation(id)?trackedEntityId=…`; 2 or more show a chooser (`chooseOperation`); none shows the unit's details |
  | `Available` (a part to fit) | `travelerIssueCandidates` lists the open operations whose material of that item is still short. A material with no operation belongs to the first open operation of its make method (lowest `order`, then id), where the picking list stages it. A serial make method (`perUnitMakeMethodIds`) skips the job-level check: once each candidate's next incomplete unit is known, the loader keeps it only when `pickTravelerMaterial` finds a material that unit still needs (`getUnitConsumption`, one read for every unit). Operations at the operator's work center come first, then the earliest job due date; the list is capped at 10 after that check. The `IssueChooser` issues the unit into the selected operation's next incomplete unit, then opens that operation. With no candidate, it shows the unit's details and storage unit |
  | Any other status | The unit's status |

- **`useTravelerScan`** (`JobOperation/hooks/useTravelerScan.ts`) is the
  traveler wedge on `JobOperation` and `AssemblyView`. It is off while the Issue
  dialog is open and under an ability Block. On `JobOperation` it is also off in
  batch mode. It posts the code, the operation and the unit on screen
  (`postTravelerScan`) to `x+/traveler.scan.tsx`, which calls `scanTraveler`
  (`services/traveler.server.ts`). The server decides:
  1. A unit of this operation's job opens here, with no issue: the screen
     picks it (`onUnitOpened`).
  2. A free part is issued into this operation: into the unit on screen when it
     needs it, else, on a first operation or a non-serial part, the next unit
     that does. On a later serial operation only the unit on screen takes it;
     with none on screen the scan is refused with `pickUnit` and the screen
     asks for the unit.
  3. Anything else navigates to the traveler route.
- **Later operations of a serial part** (`decideTravelerClaim`,
  `~/utils/traveler`, tested). Each claim option carries `laterSerial`: its
  make method is serial and it is not the first operation of it
  (`readOperationUnitFacts`, `services/work-unit.server.ts`: the rule
  `resolveWorkUnit` uses, read once for all candidates in `getClaimOptions`;
  a failed read refuses the scan). Such a claim goes only into a unit the
  request names. Off the operation page (the layout wedge, a phone camera) no
  unit is named, so it is never taken without asking: the traveler page shows
  it with no unit, and its button opens the operation, where the operator
  picks the unit and scans the part again. A claim's redirect never adds
  `?scanned`. The issue itself (`issueTravelerUnit`) asks `resolveWorkUnit`
  (mode `claim`) first, so a later operation's claim goes in only for the
  unit on screen or the one left, whatever chose it.
- **Rework scope.** An open operation tells you that a unit is still in
  production only if the operation applies to that unit. An operation with
  `jobOperationTrackedEntity` rows applies only to the units in those rows.
  An operation with no rows applies to every unit. `getOperationScopes`
  (`services/traveler.server.ts`) reads the rows of a set of operations in
  one paged read. `isUnitInOperationScope` (`~/utils/traveler`) does the
  check. The traveler route reads the rows once for all of its active
  operations. It uses them for the open operations of the unit and for the
  next unit of each issue candidate. `isUnitInProduction` reads them for the
  open operations of the unit's make method. If that read fails, it returns
  an error, not `false`. `x+/traveler.resolve.tsx` then returns
  `status: "error"`, and the scan does not issue the unit.
- **The issue.** Both the chooser and the hook post `travelerScan: true` to
  `x+/issue-tracked-entity.tsx`. The route sends `travelerScan` on to the
  `trackedEntitiesToOperation` posting. The route then needs `jobOperationId`,
  `parentTrackedEntityId` and exactly one child. `resolveTravelerMaterial`
  (`services/traveler.server.ts`) sets the material and quantity from the
  scanned unit. It refuses a unit that is not `Available`, an item the make
  method does not use ("This job does not use …") and an item no material still
  needs. A scanned batch lot issues what the material still needs
  (`pickTravelerMaterial`'s `needed`: the job's shortfall, or what a serial
  unit does not hold yet), up to what the lot holds where the job can draw it
  (`batchScanQuantity`, tested, over `get_issue_tracked_entity_stock`: the
  job's location, nettable bins, its stripes), so one scan of a received lot's
  label issues it. A quarantined lot, or one at another location, is refused.
  It is the gate; the chooser's filter only mirrors it.
- **The Issue dialog's Scan tab starts empty.** Only the Select tab is filled
  in (the picked or suggested lots, or a sole lot); switching to Scan clears
  the rows, and switching back fills Select again. A scanned lot takes the
  quantity needed, up to what it holds, and the scanner's Enter submits it.
  The header shows the part's photo and number.
- **What still needs the item** (`pickTravelerMaterial`, `~/utils/traveler`,
  tested). Only a material on this operation, then one with no operation, can
  take the unit (each group in id order). A serial parent
  (`jobMakeMethod.requiresSerialTracking`) takes a material while its
  `quantity` (per unit) is more than what is consumed into that unit for it.
  `getUnitConsumption` reads that per job material from the `Consume`
  activities that output the unit (their `Job Material` attribute and input
  quantities), less the `Unconsume` outputs, and leaves out a component that is
  now `Scrapped`. It gives one entry for each material and component item. It
  reads every page of both histories (`fetchAllByIds`). Consumption of the
  scanned item that is booked to another material fills the materials of this
  operation first. (The Issue dialog's issue by item makes a 0-quantity
  material.) Consumption of a different item never fills them. A fitted bolt
  does not count as a chamber. Any other parent takes a material while
  `jobMaterialShortfall` (`estimatedQuantity ?? quantity` less
  `quantityIssued`) is above 0. With none left the refusal is "This unit
  already has its <item>" (serial) or "This job already has all its <item>",
  shown by `useTravelerScan` and the `IssueChooser` as a toast. A failed read
  refuses with "Could not check this unit. Try again.".
- **A failed lookup.** `findTrackedEntityByCode` logs and returns
  `{ kind: "error" }` when either read fails, and `x+/traveler.resolve.tsx`
  passes it as `status: "error"`. `useTravelerScan` shows "Could not look up
  this label. Try again."; the layout wedge still shows its generic toast.
- The Issue dialog's serial and batch fields also accept a traveler link and
  keep only its id.

## Required scans before completion

`companySettings.requireTrackedMaterialsIssued` refuses to complete a unit
while its serial or batch materials are not scanned in.

- **The rule.** `unissuedTrackedMaterials` (`~/utils/trackedMaterials`, tested)
  lists the tracked materials of the make method that the operation consumes:
  its own materials, plus the materials with no operation when it is the
  first open operation of its make method (lowest `order`, then id: where
  `generatePickingList` stages them and `get_line_feed_shortages` counts
  them; the screens read it with `isFirstOpenOperationOfMakeMethod`, the
  server with `getFirstOpenOperationsOfMakeMethods`). A material is short while
  `quantityIssued` is less than `quantity` × the units after completion. Both
  sides are rounded to the internal quantity scale first (`round`,
  `@carbon/utils`), so 0.3 issued covers 0.1 × 3 units.
- **The server check.** `getRequiredScanShortfall` (`services/operations.service.ts`)
  returns the refusal message ("Scan in these parts first: …",
  `requiredScanMessage`). A serial unit counts only what was scanned into that
  unit; a batch or untracked parent counts the operation's `quantityIssued`.
  Several serial units (an inspection lot) pass `trackedEntityIds`: each unit
  must hold its parts, and the message sums them ("issued of required" over
  the units). One set of reads covers every operation and unit: the
  operations, their tracked materials (paged with `fetchAllByIds`, so a
  batch past the row cap is never checked on a partial list), the first-open-operation read
  (`getFirstOpenOperationsOfMakeMethods`, one `jobOperation` query; the
  decision is `firstOpenOperationIds`) and the units' inputs through the batch
  lineage RPCs (`netTrackedInputs`, `issuedByJobMaterial`; `getTrackedInputs`
  nets the same way). A failed read of any of them, the first-open-operation read
  included, refuses ("Could not check the scanned parts") and is logged.
  `isFirstOpenOperationOfMakeMethod` still reads a failed lookup as "not
  first"; it is for the screens, never the gate.
- **Where it runs**, before anything is recorded, beside `checkStrictBackflush`:
  `x+/complete.tsx`, `x+/end.$operationId.tsx` (every branch), `x+/finish.tsx`,
  `x+/inspection-lot.$id.complete-passed.tsx` and
  `x+/inspection-lot.$id.disposition.tsx` (through `checkRequiredScans`,
  `services/quality.server.ts`; the disposition checks the units it completes
  before it closes the lot; a decision that completes no unit is not checked), and
  `x+/batch.$batchId.complete.tsx` (`getBatchRequiredScanShortfall`).
- **Batch completion.** Every member that is not excluded is checked in one
  set of reads, and the whole batch is refused with the members that are
  short, by job ("Scan in these parts first: J1: PART (0 of 2); …",
  `batchRequiredScanMessage`). A batch pick (`trackedEntitiesToBatch`) adds to
  each member's `jobMaterial.quantityIssued` and books into one WIP unit, not
  per unit, so every member counts `quantityIssued`, a serial member too. A
  `Completing` batch (phase 1 recorded its quantities) adds no units, and a
  `Completed` one (a duplicate submit) is not checked.
- **The modal.** The operation and assembly loaders pass `isLastOperation` and
  `requireTrackedMaterialsIssued` to `QuantityModal`. With the setting on, the
  Complete alert lists each short part ("issued of required") and Complete stays
  disabled. With it off, the old warning and its "I understand" checkbox stay.

## Need material and the line feed

- **Need material.** The More Actions sheet of `JobOperation` and `AssemblyView`
  opens `NeedMaterialModal`, which posts an optional item and note to
  `x+/material-request.new.tsx`. The route calls `createMaterialRequest`
  (`@carbon/database/material-request`) with the user's client, so the
  `materialRequest` RLS decides who may ask: any employee of the company, as
  the author (the insert requires `createdBy` to be the caller). The request sits at the operation's
  work center and that work center's location, else the operator's location.
- **The line feed.** `x+/line-feed.tsx` (`path.to.lineFeed`, a sidebar queue,
  `alt+0`, `view: inventory`) is a station board: one card per active work
  center at the operator's location, built by `buildStationBoard`
  (`services/line-feed.ts`, tested). Green (`wet`) has no shortage; yellow
  (`low`) holds some of a short part, has an open material request, or has its
  shortage covered by a transfer on its way; orange (`out`) holds none of a
  part it needs; gray (`unknown`) has no lineside storage unit. The stations
  that need stock come first. Each card lists its rows: parts out, parts low,
  requests, then transfers on their way (with their storage unit). "Bring N"
  is the shortage less the transfer lines already going to that station for
  the item; a shortage they cover is not listed. Rows for a work center that
  is not on the board (none, inactive, another location) get their own card,
  ranked by the same status. The page also reloads on `workCenter` and
  `storageUnit` changes, through the shared reference topic (`useTopic`).
  `getLineFeed` (`services/inventory.service.ts`) reads 3 sources for the
  rows, and `buildLineFeedRows` builds them:
  1. Open material requests, oldest first.
  2. Lineside shortages (`get_line_feed_shortages`, newest definition
     `20261113014205_line-feed-first-operation-stripes.sql`), largest first.
     Required is the unissued Pull from Inventory material of open operations
     at a work center; a material with no operation counts at the FIRST open
     operation of its make method, where `generatePickingList` stages it. On
     hand is the station bins' ledger without Rejected or Scrapped tracked
     units, netted by stock stripe: a job of a project with project stock uses
     its project's stock, then unassigned stock; every other job uses
     unassigned stock only. `onHand` is the stock that can cover the demand.
  3. Outstanding stock transfer lines to a work center's storage unit, oldest first.
- **Flow map.** The page is a map of the process, not a row of lanes
  (`FlowMap`, `buildFlow`, tested). `get_line_feed_lanes` returns `flow`/`step`
  rows (a work center on a made item's routing: the newest make method's
  operations, plus the other work centers of an operation's process) and
  `flow`/`feed` rows (a made item another routing consumes). A row of the map
  is one routing with an open job, its stations in operation order, parallel
  stations stacked; a row comes before the row it feeds ("goes to STATION").
  A station on several routings shows once: on the one with an open job, then
  the one with the most stations. One-step routings (kit benches) share the
  "Kitting and preparation" row; stations on no running routing fold into
  "Other stations". A tile shows the station's name, colour and need, and
  opens the lane below in a drawer (local state, no read). Work that names no
  work center (a request, a transfer) is on no routing: it gets a "No station"
  tile under the map.
- **Need.** A station works from its lineside stock, and one water spider
  brings it. A station's colour is its `Lane.need` (`laneNeed`).
  `claimStock` gives the warehouse's stock out in process order and sets each
  shortage's `cover`: `site` (the warehouse holds enough: bring it), `fed` (a
  Transfer kanban's source bin holds some: bring it), `upstream` (made at this location, not built yet), `none` (this location does not hold enough; stock at the company's other locations is never counted or shown). Red `short`: a `none` part. Amber `bring`: a
  `site` or `fed` part or a rack kit to bring, or an open request. Amber
  `waiting`: `upstream` or kit work. Green `ready`: open work
  and lineside covers it. Gray `idle`: no open operation. `Lane.toBring`
  counts the parts and kits to bring; a tile reads "Short N · Bring N", the
  summary strip has "to bring lineside", and the drawer lists what to bring
  first, each with its bin and Move button.
- **Lanes.** The drawer shows the station card as the bottom tier of a lane
  (`buildLaneBoard`, tested; spec `.ai/specs/2026-11-16-line-feed-lanes.md`):
  raw shelf, kit rack, station. A kit is a Make item whose default storage
  unit (`pickMethod`) is a `storageUnit."kitRack"` unit, its slot on the rack;
  a kit job builds it, so an incomplete kit is an open kit job with unissued
  parts. `get_line_feed_lanes` (`20261116150000_line-feed-lanes.sql`) returns
  one row per fact (its header lists the `tier`/`state` pairs). `buildLane`
  counts the lane's work (`LaneWork`): `deliver` (the station is out of a kit,
  none on its way, and the rack has one), `finish` (an incomplete kit whose
  missing parts are on the shelf), `build` (the rack is below its Make kanban
  quantity and the shelf covers a kit), `rawShort` (a needed bin is empty or
  short). `laneVerdict` is the first non-zero count in that order; severity is
  red when the station is `out`, amber when it is `low` or the verdict is not
  ok, `unknown` (gray) when it has no lineside storage. The shelf and station tiers split kit parts from loose parts
  (`RawBin.kitItemIds`, `Lane.looseRows`); a kit's own shortage shows on its
  kit line (`LaneKit.stationStatus`), not as a part to bring. A lane with no kit reads "Fed directly" and lists the source bins of the
  Transfer kanbans into its station. The selected summary count
  (`?show=`, which shows only its stations) and the station name search
  (`?search=`) live in the URL; the page filters the map. `kanban` does
  not broadcast, so a new card shows on the next stock, job or PO change.
- **Grab and move.** A short loose part shows its picture and where to grab
  it (`LineFeedRow.source`): the source bin of the station's Transfer kanban
  while it holds stock, else the function's `raw`/`source` row (the item's
  default bin when it holds stock, else the fullest bin of unassigned,
  nettable stock off the line). The function returns that row for every part
  a station consumes (`20261117183412_line-feed-stock-anywhere.sql`): with no
  storage unit, its quantity is the stock in no bin, and the row reads "N in
  stock, in no bin" (`LineFeedRow.supply`); with none, "None in stock" and
  whether a purchase order line or job is open, and the part counts as raw
  short. A shelf bin that is empty or short names the part's stock in another
  bin or in no bin (`RawBin.elsewhere`), and is raw short only when that
  stock does not cover its need either. `claimStock` gives each bin's stock
  and each rack kit to one station, in line order whatever the board's sort:
  a later station is offered what the earlier ones leave ("0 of 6 left for
  this station", no Move button), and a kit the rack no longer has for it
  reads "No kit". "Move N from BIN" posts to
  `x+/line-feed.transfer.tsx`, which calls `transferToStation`
  (`services/line-feed.server.ts`). It reads the station's shortage again,
  less the transfer lines already on their way, for the destination bin and
  whether the station still needs the part, and checks that a named serial is
  still in the source bin, so a resend of a move that covered the need creates
  nothing. The button has a quantity field for a loose part: it starts at what
  the station is short of, and the feeder may type more (a whole box), up to
  what the bin holds; a serial kit moves one at a time. `transferToStation`
  reads the source bin's stock again (the board's own `raw` row) and refuses
  more than it holds, because the ERP's transfer pick takes a bin below zero
  without refusing. A short part with some stock keeps its Move button. Then it calls the ERP's
  `api+/inventory.stock-transfer.move.ts` (`createStockTransfer` with
  `moveNow`). "Bring kit" is the same move for the rack kit's serial. The
  action answers with a flash, because a move that lands unmounts its button.
  The loader's `canTransfer` (create inventory) hides the buttons from a
  user the action would turn away.
- **Resolve.** A request card posts to `x+/line-feed.$materialRequestId.resolve.tsx`,
  which calls `resolveMaterialRequest` with the user's client. Only the
  requester or an inventory editor can resolve it; the RLS refusal comes back
  as "Only the requester or an inventory editor can resolve this request".
- **Picking queue.** `getAssignedPickingLists` (`services/picking.service.ts`)
  shows the lists assigned to the operator and the unassigned lists at the
  operator's location.

## Components

- **`JobOperation/JobOperation.tsx`** — large root component (~3300 lines). Holds the
  `Tabs`, header/job-info bar, and all detail sections.
- **`JobOperation/components/Controls.tsx`** — exports `Controls`, `Times`,
  `WorkTypeToggle`, `StartStopButton`, `IconButtonWithTooltip`, `FloatingActionMenu`,
  `PlayButton`/`PauseButton`. The dock / bottom action bar (see Layout): work center, work-type
  toggle (Setup/Labor/Machine), big start-stop button, "Log Completed", and a "More
  Actions" sheet (Scrap, Rework, Finish, Maintenance, Quality Issue).
- **`components/Step.tsx`** — exports `StepsListItem`, **`RecordModal`**, and
  **`DeleteStepRecordModal`** (these are NOT separate files). File/Inspection step
  uploads go to the private bucket at
  `{companyId}/job/{operationId}/{stepId}/{nanoid}/{sanitized filename}` — this
  shape is a contract with `parseJobFilePath`
  (`apps/erp/app/utils/supabase.ts`), which gates the customer-portal file route.
- **`components/Parameter.tsx`** — exports `ParametersListItem`.
- **Material source and unissue.** `MaterialSource` (`components/Materials.tsx`) shows a
  material's method and where its stock is now: `liveStorageUnits` from
  `getJobMaterialsByOperationId` (RPC `get_job_issue_bins`, one read per job), "WIP" for a
  made part, "Location not known" when no bin holds stock. A failed bin read is logged and the
  material shows the bin it names. For an untracked material with a quantity issued,
  `IssueMaterialModal` has an Issue / Unissue toggle: Unissue posts `Positive Adjmt.` up to
  the issued quantity, and the ERP returns the stock to the bins it was drawn from. In Issue
  mode the modal lists the bins with stock ("Stock at:", `api+/issue-inventory-bins.ts`). The
  serial and batch lists (`getIssueLotsForItem`) offer only the lots in stock at the job's own
  location, with each lot's bin (`get_issue_tracked_entity_stock`). The location and stripes are
  read from the operation's job on the server (`getJobOperationIssueScope`), never taken from
  the browser; the suggested allocation reads the same scope.
- **Short stock.** `getJobMaterialsByOperationId` sets `stockShortage`
  (`{ available, needed }`) on a Pull from Inventory material when the stock in
  its `liveStorageUnits` is less than what the job's materials of that item still
  need (`materialStockShortages`, `~/utils/materialStock`, tested; job-wide, set
  before `quantityIssued` is narrowed to one unit). `ShortStockBadge` shows it in
  the materials table and list, the assembly parts list and the Issue dialog
  header. No shortage is shown when the bin read failed.
- Modals/sections: `IssueMaterialModal`, `QuantityModal` (type `scrap`/`finish`),
  `ReworkModal`, `SerialSelectorModal`, `QualityIssueModal`, `MaintenanceDispatch`,
  `ScrapReason`, `Chat.tsx` (`OperationChat`), `TableSkeleton`.
- `NeedMaterialModal` (Need material, see above).
- **Hooks:** `hooks/useTravelerScan.ts` (see Traveler scan), `hooks/useWorkUnit.ts` (see Serial unit selection), `hooks/useOperation.tsx` (modal disclosures, live progress via
  `useInterval` + realtime (`@carbon/query`, see `realtime-system.md`), active-event detection),
  `hooks/useFiles.tsx` (`downloadFile`/`downloadModel` via `path.to.file.previewFile`).

## Tabs

`useOperation`'s `activeTab` drives a `Tabs`; exact values: `"details"`, `"model"`,
`"procedure"`, `"chat"`. The Procedure tab has nested tabs `"attributes"` (Steps) and
`"parameters"`. Details renders Steps, Process Parameters, Materials, Files, and (only
when `parentIsSerial`) Serial Numbers.

## Realtime

`useOperation` subscribes on topic `job-operations:${operation.id}` to postgres changes
on `job`, `productionEvent` (filtered by `jobOperationId`), and `jobOperation`. Event
inserts/updates/deletes patch local state; a job update revalidates through
`useRealtimeRevalidator` (`~/hooks`), which skips while any fetcher is
submitting — a submission's own writes echo back mid-action, and a revalidation
started then makes React Router drop the action's redirect. `AssemblyView`'s
live sync uses the same hook. A
deleted operation toasts and redirects to `path.to.operations`.

## Key tables (newest migrations)

- **`productionEvent`** (`20240927033740_job-operations-for-mes.sql`): `type`
  (`productionEventType` enum = `Setup` | `Labor` | `Machine`), `startTime`/`endTime`,
  `duration` (generated, seconds), `employeeId`, `workCenterId`, `jobOperationId`.
- **`productionQuantity`** (`20241002012019_production-quantities.sql`): `type`
  (`productionQuantityType` enum = `Rework` | `Scrap` | `Production`), `quantity`,
  `scrapReason`, and `setup/labor/machineProductionEventId` links.
- `jobOperation` itself originates in `20240909194622_jobs.sql`; step/parameter data in
  `20250215102137_process-parameters.sql` (`jobOperationStep`, `jobOperationParameter`).

## Printing (serials)

Serial Numbers section uses shared `~/components` `PrintButton` with
`context="workCenter"` and `workCenterId={operation.workCenterId}`: per-operation
(`sourceDocument="Operation"`, routes `operationLabelsPdf`/`operationLabelsZpl`) and
per-entity (`sourceDocument="Entity"`, `trackedEntityLabel*`). See
`.claude/rules/` printing notes / cache for fallback-to-download behavior.

## Layout (application shell)

The `Tabs` root in `JobOperation.tsx` IS the shell: a CSS grid of named areas,
each pane scrolling on its own — nothing is absolutely positioned and no height
is computed in JS (the old `--controls-height` / `--controls-gutter` /
`calc(100dvh - …)` scheme is gone).

- **Areas.** Below `lg`: one column — `header`, `context`, `sep`, `main`,
  `status`, `dock`. From `lg`: `main`/`status` on the left, `dock` spanning both
  on the right (`minmax(0,1fr) auto`). Every TabsContent sits in `main`
  (inactive ones are `display:none`, so they take no track); `Times` is
  `status`; `Controls` is `dock`.
- **Height.** The MES outlet frame (`x+/_layout.tsx`) is only `min-h-svh`
  bounded because other screens page-scroll, so the shell sizes itself:
  `h-svh md:h-[calc(100svh-1rem)]` (the frame's `md:my-2` inset). Never
  `h-screen`/`h-full` here — the first overflowed the inset frame (clipped the
  status bar), the second resolves to content height.
- **Dock (`Controls`).** ONE mounted instance — it owns the start/stop form and
  the modal triggers, so it is re-laid-out by CSS, never rendered twice: a
  `--controls-width` column from `lg` (collapsible to a 76px rail via
  `data-collapsed` + `group/dock` variants, persisted per device in
  localStorage `mes:operation-dock-collapsed`, read after mount), a pinned
  bottom action bar below `lg` (toggle · start/stop · complete · more). Play/Pause
  and `IconButtonWithTooltip` size by context (`size-14`/`size-12` in the bar
  and rail, full size in the dock).
- **Status bar (`Times`).** A footer row, not a floating card: one meter per
  planned work type plus quantity. A plan of ≤1ms is the batch no-plan
  placeholder — it shows elapsed time alone over an empty track (never
  "0ms/1ms").
- **Context bar.** Wraps below `lg`; its metadata row (customer, description,
  status, duration, deadline) scrolls sideways (`scrollbar-hide`, items
  `shrink-0`) instead of hiding, so there is no mobile-only duplicate in the
  dock. Header tabs scroll sideways too (`ml-auto` on the list, never
  `justify-end` on an overflow container — it strands the start).
- Materials "Source" column stays `hidden lg:table-cell`; Procedure steps list
  `hidden lg:block`.
