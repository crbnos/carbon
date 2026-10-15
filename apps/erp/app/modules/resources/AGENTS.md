# Resources Module

Locations, work centers, processes, abilities (skills), partners, contractors, equipment maintenance (dispatches and schedules), failure modes, training management, and employee suggestions. Manages the physical and capability infrastructure that production depends on.

## Key Domain Concepts

- **Location** — physical site/facility. Every inventory record, job, and employee is scoped to a location. Has address, timezone, and GPS coordinates. Company-scoped. `requiresStaffing` (BOOLEAN, default false; `20260820151847_location-requires-staffing.sql`) is a per-location scheduling policy edited on the Production settings page (Settings → Production → Scheduling): when true the finite scheduler only places work where an operator is manned (lights-out work centers exempt) — see `.claude/rules/scheduling-data-structures.md`.
- **Work Center** — production station within a location. Operations schedule onto work centers. Have rates and active/inactive status. MUST soft-delete via `active: false`. Scheduling is always finite (one operation at a time), and a work center now has **operating hours**: assign it one or more of the location's shifts via `workCenterShift` (empty = all shifts at the location), or set `alwaysOn` for genuine lights-out 24×7. The scheduler resolves hours through a ladder — `alwaysOn` → explicit `workCenterShift` rows → the location's `shift` rows → a stock Mon–Fri 8h week — so even a zero-config shop is bounded by real hours (it is no longer "always open 24×7"). An open maintenance dispatch flagged `takesWorkCenterOffline` subtracts its window(s) from the schedule until closed. The work center form edits both (an "Operating shifts" multiselect + a "Runs 24×7 (lights-out)" toggle), and work-center create/edit/deactivate/reactivate emit the `work-center` schedule input event.
- **Process** — type of work (e.g., "CNC Milling", "Welding"). Operations reference a process. Linked to work centers via `workCenterProcess`. MUST soft-delete via `active: false`. `process.requiresAbility` gates scheduling and MES start: toggling it ON auto-creates an ability linked 1:1 to the process (`ability.processId`) via `ensureProcessAbility`. The ability stores no name of its own — its name IS the process's name. The `batchable` flag marks a process where multiple jobs can run at once (laser table, furnace, plating) — job operations derive batchability from it (see the production module's Operation Batch concept). `process.batchRules` (JSONB, nullable) holds per-BOM-dimension batch compatibility levels (`{ item?, substance?, grade?, dimension?, form?, finish?: "must"|"guide"|"ignore" }`), edited on the batchable process form (a "Compatibility rules" card, visible only when Batchable is on). It is SPARSE — keys equal to their resolved default are omitted, and an all-default config writes NULL. NULL reproduces the pre-rules behavior exactly (`resolveBatchRules(null)` → substance/grade/dimension = guide, form/finish/item = ignore). "Must" is the only level that BLOCKS (server-enforced in the `batch-operations` server function); "guide" warns and splits the builder's suggestion groups; "ignore" is invisible to batching. Resolution/compaction/enforcement all go through the shared pure module `@carbon/utils` `batch-compatibility` (`resolveBatchRules`, `compactBatchRules`, `mustViolations`). `upsertProcess` folds the six `batchRule*` form fields into `batchRules` and back via `batchRuleInitialValues`.
- **Ability** — an employee qualification, **always** linked 1:1 to a process (`ability.processId`, NOT NULL, `ON DELETE CASCADE`). An ability stores **no name of its own** — the name derives from the linked process (renaming the process renames the ability), read through the `abilities` view (`ability` INNER JOIN `process`). Abilities are created **only from a process**: the New Ability modal (`x/resources/abilities` → new) is a picker of processes that don't already have an ability (`getProcessesWithoutAbility`); creating one turns that process's `requiresAbility` on and calls `ensureProcessAbility` (idempotent, so no duplicates). Legacy free-form abilities (no `processId`) were **deleted** by `20260917161742_abilities-from-process.sql` (cascading their `employeeAbility`/`contractorAbility` rows, nulling `training.grantsAbilityId`, and first detaching `workCenter.requiredAbilityId` / removing `partner` rows that referenced them). `employeeAbility` is effectively a map of the processes each person can do. Qualification is **presence-based**: an `employeeAbility` row means the person is qualified, subject only to expiry — `qualified = row exists ∧ (expiresAt IS NULL OR expiresAt ≥ today)` where `expiresAt` derives from `ability.recertifyEveryDays`. There is no `active` / `trainingCompleted` gate (dropped `20260812153418_simplify-employee-ability.sql`); "Remove Employee" is a **hard delete**. Admin UI at `x/resources/abilities`; each ability's detail page carries the roster of its qualified employees, and the person page's abilities panel is editable. Training is one path to a row: `training.grantsAbilityId` + the `grant_ability_on_training_completion` trigger upsert `employeeAbility` (sets `lastTrainingDate`, `expiresAt` from `recertifyEveryDays`) on completion — but manually adding the employee qualifies them just as well. **Every path that changes qualification notifies the scheduler** (`notifyScheduleInputsChanged(companyId, "ability", …, abilityId)`): the employee-grant/revoke routes, `abilities.delete` (deactivating an ability un-gates its process), and both training-completion routes (`assignments.complete`, `share/training.$id` — scoped to `grantsAbilityId` when the training grants one).
- **Partner** — external supplier location with ability mappings for outsourced work.
- **Contractor** — supplier contact working as contract labor, with hours-per-week and ability assignments via `contractorAbility`.
- **Maintenance Dispatch** — reactive or scheduled work order for equipment. Statuses: Open → Assigned → In Progress → Completed / Cancelled. Tracks time events, consumed parts, and affected work centers.
- **Maintenance Schedule** — preventive maintenance plan with frequency, priority, estimated duration, and required spare parts. `takesWorkCenterOffline` marks the PM as blocking the machine; the nightly generator (`packages/jobs/.../scheduled/dispatch.ts`) copies it onto each generated dispatch and sets `plannedEndTime = plannedStartTime + estimatedDuration` (so the offline window is bounded — the validator requires a duration when offline is on).
- **Failure Mode** — categorized failure type used by maintenance dispatches and quality NCRs.
- **Training** — training programs with assignments, quiz questions, and frequency-based recertification. Completion tracked via `trainingCompletion`. **Status changes only from the header** (`TrainingHeader`): Draft shows Publish, Active shows Archive, and Reopen (back to Draft) is in the ⋯ menu — each through a `Confirm` posting `field=status` to `x+/training+/update.tsx`; Properties has no Status field. The name is edited in Properties (the content editor has no title block). The **Content** card holds a **Write | Upload PDF** toggle: a training's content is written (`content`) OR one PDF (`training.guidePath`, key `{companyId}/training/{trainingId}/{uploadId}/{file name}`, checked by `isValidTrainingGuideKey`), never both — a training with a `guidePath` is a PDF training, and the employee page shows the PDF instead of the written content. Switching back to Write clears `guidePath`. `guidePath` changes only while Draft (`update.tsx` filters its update on `status = 'Draft'` and refuses when no row changed). **External training is an assignment, not a training**: `trainingAssignment.trainingId` is nullable and an external assignment carries only `name` (CHECK `num_nonnulls("trainingId", "name") = 1`, `20261014164752_external-training-assignments.sql`). It is one-time (the status RPCs report frequency `Once`), sends no notifications or weekly reminders, and has no employee page (`share/training.$id` 404s it). The status and summary RPCs LEFT JOIN `training`, return `isExternal`, and the summary is one row per assignment; the assignments list and roster drawer (`assignments.$assignmentId.tsx`, `path.to.trainingAssignmentDetail(assignmentId)`) are keyed by assignment. Every completion — the employee's quiz (`share/training.$id`) and an admin's Mark Complete (`assignments.complete`) — goes through `recordTrainingCompletion` (`resources.server.ts`): it refuses an internal training that is not Active, uploads the OPTIONAL certificate of an external assignment (`validateTrainingCertificate`, async: PDF/PNG/JPG by extension AND file signature, 10 MB; key `{companyId}/training-certificates/{assignmentId}/{employeeId}/…` built on the server), works out the period on the server, removes the uploaded file when the insert fails, treats a duplicate completion as already recorded, and restamps the scheduler for a granted ability. `assignments.complete` refuses an employee outside the assignment's groups (`users_for_groups`). The edit route reads internal/external from the stored assignment, never the form. `assignments.uncomplete` (`delete: resources`) removes a wrong completion and its certificate file; the granted ability stays (the grant trigger only adds). The status RPC returns each completion's `certificatePath`. The assignment drawer (`assignments.$assignmentId.tsx`) is the only per-employee roster; the edit form has no Status tab.

## Safety

### Always
- MUST soft-delete work centers via `deleteWorkCenter` (`active: false`) — they are referenced by job operations and schedules.
- MUST soft-delete processes via `processDeactivate` (`active: false`) — referenced by operations and procedures.
- MUST scope all queries by `companyId` — locations, work centers, and all sub-entities are company-scoped.
- MUST use `insertMaintenanceDispatch` for new dispatches and `updateMaintenanceDispatch` for existing ones — `upsertMaintenanceDispatch` is deprecated.

### Ask First
- Deleting locations — cascading impact on inventory, jobs, employees, and storage units.
- Deactivating work centers with active job operations scheduled against them.
- Modifying process definitions referenced by active methods or procedures.

### Never
- Hard-delete work centers or processes — always soft-delete via `active: false`.
- Delete locations that have inventory or active jobs — referential integrity will break.
- Remove abilities that have `employeeAbility` training records.

## Validation Commands

```bash
pnpm --filter @carbon/erp typecheck
pnpm --filter @carbon/erp test -- --testPathPattern=resources
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `location` | Physical sites: address, timezone, coordinates |
| `workCenter` / `workCenters` (view) / `workCentersWithBlockingStatus` (view) | Production stations with blocking info; `alwaysOn` = lights-out 24×7 (exposed by the `workCenters` view since the capacity-planning migration recreated it). `batchCapacity` / `minimumBatchQuantity` (NUMERIC, nullable) are ADVISORY batch load limits (pieces per run / smallest worth batching) surfaced as a fill bar in the batch builder — never a hard block; NULL = no capacity model. Both views were re-declared (DROP + CREATE, since the new `wc.*` columns land before `locationName`) to expose them |
| `workCenterShift` | Which shifts a work center operates (scheduling availability-ladder rung 1); empty = all shifts at the location. Unique `(workCenterId, shiftId, companyId)` |
| `process` / `processes` (view) | Work types with active flag, `requiresAbility`, `batchable`, and `batchRules` (per-dimension batch compatibility JSONB; view re-declared to expose it) |
| `workCenterProcess` | Many-to-many link between work centers and processes |
| `ability` / `abilities` (view) / `employeeAbility` | Skills with learning curves and per-employee tracking. `ability.processId` is NOT NULL (1:1 with `process`, `ON DELETE CASCADE`); there is no `ability.name` column — the `abilities` view exposes `name` from the linked process |
| `partner` / `partners` (view) | External supplier partners |
| `contractor` / `contractors` (view) / `contractorAbility` | Contract labor with ability assignments |
| `maintenanceDispatch` | Equipment work orders: status, priority, severity, OEE impact; `takesWorkCenterOffline` subtracts the work center's scheduling hours while the dispatch is open |
| `maintenanceDispatchEvent` / `maintenanceDispatchComment` / `maintenanceDispatchItem` | Dispatch time, comments, and consumed parts |
| `maintenanceDispatchWorkCenter` / `maintenanceDispatchItemTrackedEntity` | Affected work centers and tracked items |
| `maintenanceSchedule` / `maintenanceScheduleItem` | Preventive maintenance plans with spare parts; `takesWorkCenterOffline` + `estimatedDuration` flow into generated dispatches (offline flag + `plannedEndTime = plannedStartTime + estimatedDuration`) |
| `maintenanceFailureMode` | Failure categories shared with quality module |
| `training` / `trainingAssignment` / `trainingQuestion` / `trainingCompletion` | Training programs with quizzes and completion tracking; an external `trainingAssignment` has `name` and no `trainingId` |
| `suggestion` / `suggestions` (view) | Employee suggestions |

## Key Service Functions

- `getLocations` / `getLocationsList` / `upsertLocation` — site management
- `getWorkCenters` / `getWorkCentersByLocation` / `activateWorkCenter` / `deleteWorkCenter` (soft) — work center management
- `getProcesses` / `getProcessesList` / `activateProcess` / `processDeactivate` — process management
- `getAbilities` / `getAbility` (both read the `abilities` view for the process-derived name, stitching `employeeAbility` in one `.in()` query) / `getAbilitiesList` / `getEmployeeAbilities` / `getProcessesWithoutAbility` (feeds the New Ability picker) — skill tracking
- `getEmployeeAbility` / `upsertEmployeeAbilityCell` / `deleteEmployeeAbility` (hard delete) / `resolveEmployeeAbilityExpiresAt` — per-employee qualification reads/writes (ability roster + person panel drawers)
- `ensureProcessAbility` — find-or-create the ability linked 1:1 to a process (called when `requiresAbility` is toggled on, and from the New Ability modal). Takes no name (the process is the name); accepts an optional `recertifyEveryDays`.
- `getPartners` / `getContractors` / `upsertContractor` — external resources
- `insertMaintenanceDispatch` / `updateMaintenanceDispatch` / `getMaintenanceDispatch(es)` — dispatch lifecycle
- `getMaintenanceDispatchEvents` / `getMaintenanceDispatchComments` / `getMaintenanceDispatchItems` — dispatch details
- `getMaintenanceSchedule(s)` / `upsertMaintenanceSchedule` — PM plans
- `getFailureModes` / `upsertFailureMode` — failure categorization
- `getTraining(s)` / `getTrainingAssignment(s)` / `getTrainingAssignmentStatus` / `getOutstandingTrainingsForUser` / `getTrainingGrantedAbilityId` / `deleteTrainingCompletion` — training management (`getTrainingGrantedAbilityId` returns the ability a completion grants, so the completion routes can `notifyScheduleInputsChanged` for that operator pool)
- `getSuggestion(s)` — suggestion management

## Key Exports

```typescript
import { getLocationsList, getWorkCentersList, getProcessesList } from "~/modules/resources";
```

## Related Modules

- **production** — job operations run on work centers; scheduling assigns to work centers; processes link operations to capabilities
- **inventory** — storage units exist within locations; inventory is location-scoped
- **people** — employees have abilities; shifts are location-scoped; contractors are supplier contacts
- **quality** — failure modes shared between maintenance and quality NCRs
- **items** — maintenance dispatches consume items (spare parts)
- **purchasing** — contractors reference supplier contacts; partners reference supplier locations

## Rules References

- `.claude/rules/mes-job-operation-ui.md` — work center and process usage in MES context
- `.claude/rules/scheduling-data-structures.md` — work center capacity and scheduling structures
