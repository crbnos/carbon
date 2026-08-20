---
paths:
  - "apps/mes/app/components/JobOperation/**"
  - "apps/mes/app/routes/x+/operation.$operationId.tsx"
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

## Components

- **`JobOperation/JobOperation.tsx`** — large root component (~1700 lines). Holds the
  `Tabs`, header/job-info bar, and all detail sections.
- **`JobOperation/components/Controls.tsx`** — exports `Controls`, `Times`,
  `WorkTypeToggle`, `StartStopButton`, `IconButtonWithTooltip`, `FloatingActionMenu`,
  `PlayButton`/`PauseButton`. The right/bottom control panel: work center, work-type
  toggle (Setup/Labor/Machine), big start-stop button, "Log Completed", and a "More
  Actions" sheet (Scrap, Rework, Finish, Maintenance, Quality Issue). Carries
  **mobile-only** job/customer/deadline info in a `md:hidden` block (the header hides
  that info on mobile).
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
inserts/updates/deletes patch local state; job/operation updates `revalidate()`. A
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

## Responsive / CSS gotchas

- CSS vars: **`--controls-width: 220px`** (260px at xl, in `apps/mes/app/styles/tailwind.css`),
  `--controls-height` set inline from a computed `controlsHeight` memo, `--header-height`
  from `@carbon/react`. Details scrollport classes live **inline on the details
  container in `JobOperation.tsx`** (no separate helper):
  - **Below `lg`:** `h-auto` + page scroll — Controls/Times stack inline under content so
    Files / Serial Numbers stay reachable (do **not** put a viewport-filling fixed height
    here; that nested-scroll trap was #959).
  - **`lg+`:** fixed height
    `calc(100dvh - var(--header-height)*2 - var(--controls-height) - 2rem)` with
    `lg:pr-[var(--controls-gutter)]` so absolute Controls/Times dock without overlap.
- Root Tabs is `min-h-screen h-auto lg:h-screen` for the same reason.
- Header detail metadata is `hidden lg:flex` (so `Controls` shows it on mobile instead);
  Materials "Source" column is `hidden lg:table-cell`; Procedure steps list is
  `hidden lg:block`; the `Controls` panel is inline on mobile, `lg:absolute` top-right
  on desktop.

<!-- UNVERIFIED: exact column set of jobOperation (status/duration fields) not fully audited here; check the live schema or 20240909194622_jobs.sql + later alters when relying on specific fields. -->
