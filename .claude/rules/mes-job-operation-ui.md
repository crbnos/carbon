---
paths:
  - "apps/mes/app/components/JobOperation/**"
  - "apps/mes/app/routes/x+/operation.$operationId.tsx"
---

# MES Job Operation UI

The operator-facing screen for working a single job operation: timers, materials,
steps/parameters, files, serials, and scrap/rework/finish actions.

## Route & data flow

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
  **`DeleteStepRecordModal`** (these are NOT separate files).
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

- CSS vars: **`--controls-width: 240px`** (fixed, in `apps/mes/app/styles/tailwind.css`),
  `--controls-height` set inline from a computed `controlsHeight` memo, `--header-height`
  from `@carbon/react`. The Details `ScrollArea` reserves right space with
  `md:pr-[calc(var(--controls-width))]` and height
  `calc(100dvh - var(--header-height)*2 - var(--controls-height) - 2rem)`.
- Header detail metadata is `hidden md:flex` (so `Controls` shows it on mobile instead);
  Materials "Source" column is `hidden lg:table-cell`; Procedure tab is `hidden lg:block`;
  the `Controls` panel is inline on mobile, `md:absolute` top-right on desktop.

<!-- UNVERIFIED: exact column set of jobOperation (status/duration fields) not fully audited here; check the live schema or 20240909194622_jobs.sql + later alters when relying on specific fields. -->
