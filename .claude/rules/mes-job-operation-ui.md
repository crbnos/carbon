---
paths:
  - "apps/mes/app/components/JobOperation/**"
  - "apps/mes/app/routes/x+/operation.$operationId.tsx"
  - "apps/mes/app/routes/x+/batch.$batchId.tsx"
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
- **Loader** (uses `getCarbonServiceRole()`, not the user client) fetches via
  `~/services/operations.service`: `getJobOperationById`, `getJobByOperationId`,
  `getProductionEventsForJobOperation`, `getProductionQuantitiesForJobOperation`,
  `getTrackedEntitiesByMakeMethodId`, `getJobMakeMethod`, `getKanbanByJobId`,
  plus deferred promises for `files`, `materials`, `procedure`, `workCenter`,
  `nonConformanceActions`. `operation` is wrapped with `makeDurations(...)` →
  `OperationWithDetails`. Quantities are reduced into `{ scrap, production, rework }`.
- If serial-tracked and no `?trackedEntityId` is set, the loader **redirects** to the
  same URL with the last tracked entity appended.
- The default export passes everything to `<JobOperation key={...} .../>`.
- **Mutations are separate routes**, not actions on this route. `Controls` posts to
  `path.to.startOperation(id)` (`/x/start/:operationId`) and
  `path.to.endOperation(id)` (`/x/end/:operationId`); rework targets at
  `path.to.reworkTargets(id)`. Start/end routes write `productionEvent` /
  `productionQuantity` (end calls `finishJobOperation`).
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
  entities; each opens `ScrapEntityModal`). That case branches on entity
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
- **`finishJobOperation`** (`operations.service.ts`) flips the op to `Done` (firing
  the `sync_finish_job_operation` trigger that completes the job to inventory when
  it's the last op). It then runs `returnPickedRemainders`: one `post-picking`
  sweep invoke (via the service-role client) — `returnJobRemainders` when
  `job.status='Completed'`, else `returnOperationRemainders` (which itself no-ops
  unless `companySettings.returnPickedMaterialTiming = 'operation'`). The sweep
  returns un-consumed lineside remainders (tracked AND untracked) to their
  warehouse source, booking `pickingListLine.quantityReturned`. The SQL trigger
  can't call edge functions, so this is orchestrated in TS. See
  `.ai/specs/2026-08-04-picked-material-return-timing.md`.

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
(unchanged) → `batch-operations` edge fn.

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
  `excluded="true"` (string flag, the `exclusive` idiom), and the edge fn
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
  carries **no entity ids from the form** — the route invokes `issue` with the
  SERVICE ROLE, so a posted id list would let a production-only user merge any
  two same-item lots. A merge failure leaves the batch completed with
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

## Components

- **`JobOperation/JobOperation.tsx`** — large root component (~1700 lines). Holds the
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
- Modals/sections: `IssueMaterialModal`, `QuantityModal` (type `scrap`/`finish`),
  `ReworkModal`, `SerialSelectorModal`, `QualityIssueModal`, `MaintenanceDispatch`,
  `ScrapReason`, `Chat.tsx` (`OperationChat`), `TableSkeleton`.
- **Hooks:** `hooks/useOperation.tsx` (modal disclosures, live progress via
  `useInterval` + `useRealtimeChannel`, active-event detection, serial selection),
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
