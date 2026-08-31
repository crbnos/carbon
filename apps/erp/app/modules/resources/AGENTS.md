# Resources Module

Locations, work centers, processes, abilities (skills), partners, contractors, equipment maintenance (dispatches and schedules), failure modes, training management, and employee suggestions. Manages the physical and capability infrastructure that production depends on.

## Key Domain Concepts

- **Location** — physical site/facility. Every inventory record, job, and employee is scoped to a location. Has address, timezone, and GPS coordinates. Company-scoped. `requiresStaffing` (BOOLEAN, default false; `20260820151847_location-requires-staffing.sql`) is a per-location scheduling policy edited on the Production settings page (Settings → Production → Scheduling): when true the finite scheduler only places work where an operator is manned (lights-out work centers exempt) — see `.claude/rules/scheduling-data-structures.md`.
- **Work Center** — production station within a location. Operations schedule onto work centers. Have rates and active/inactive status. MUST soft-delete via `active: false`. Scheduling is always finite (one operation at a time), and a work center now has **operating hours**: assign it one or more of the location's shifts via `workCenterShift` (empty = all shifts at the location), or set `alwaysOn` for genuine lights-out 24×7. The scheduler resolves hours through a ladder — `alwaysOn` → explicit `workCenterShift` rows → the location's `shift` rows → a stock Mon–Fri 8h week — so even a zero-config shop is bounded by real hours (it is no longer "always open 24×7"). An open maintenance dispatch flagged `takesWorkCenterOffline` subtracts its window(s) from the schedule until closed. The work center form edits both (an "Operating shifts" multiselect + a "Runs 24×7 (lights-out)" toggle), and work-center create/edit/deactivate/reactivate emit the `work-center` schedule input event.
- **Process** — type of work (e.g., "CNC Milling", "Welding"). Operations reference a process. Linked to work centers via `workCenterProcess`. MUST soft-delete via `active: false`. `process.requiresAbility` gates scheduling and MES start: toggling it ON auto-creates an ability linked 1:1 to the process (`ability.processId`, named after the process) via `ensureProcessAbility`.
- **Ability** — an employee qualification, usually linked 1:1 to a process (`ability.processId`). `employeeAbility` is effectively a map of the processes each person can do. Qualification is **presence-based**: an `employeeAbility` row means the person is qualified, subject only to expiry — `qualified = row exists ∧ (expiresAt IS NULL OR expiresAt ≥ today)` where `expiresAt` derives from `ability.recertifyEveryDays`. There is no `active` / `trainingCompleted` gate (dropped `20260812153418_simplify-employee-ability.sql`); "Remove Employee" is a **hard delete**. Admin UI at `x/resources/abilities`; each ability's detail page carries the roster of its qualified employees, and the person page's abilities panel is editable. Training is one path to a row: `training.grantsAbilityId` + the `grant_ability_on_training_completion` trigger upsert `employeeAbility` (sets `lastTrainingDate`, `expiresAt` from `recertifyEveryDays`) on completion — but manually adding the employee qualifies them just as well. **Every path that changes qualification notifies the scheduler** (`notifyScheduleInputsChanged(companyId, "ability", …, abilityId)`): the employee-grant/revoke routes, `abilities.delete` (deactivating an ability un-gates its process), and both training-completion routes (`assignments.complete`, `share/training.$id` — scoped to `grantsAbilityId` when the training grants one).
- **Partner** — external supplier location with ability mappings for outsourced work.
- **Contractor** — supplier contact working as contract labor, with hours-per-week and ability assignments via `contractorAbility`.
- **Maintenance Dispatch** — reactive or scheduled work order for equipment. Statuses: Open → Assigned → In Progress → Completed / Cancelled. Tracks time events, consumed parts, and affected work centers.
- **Maintenance Schedule** — preventive maintenance plan with frequency, priority, estimated duration, and required spare parts. `takesWorkCenterOffline` marks the PM as blocking the machine; the nightly generator (`packages/jobs/.../scheduled/dispatch.ts`) copies it onto each generated dispatch and sets `plannedEndTime = plannedStartTime + estimatedDuration` (so the offline window is bounded — the validator requires a duration when offline is on).
- **Failure Mode** — categorized failure type used by maintenance dispatches and quality NCRs.
- **Training** — training programs with assignments, quiz questions, and frequency-based recertification. Completion tracked via `trainingCompletion`.

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
| `workCenter` / `workCenters` (view) / `workCentersWithBlockingStatus` (view) | Production stations with blocking info; `alwaysOn` = lights-out 24×7 (exposed by the `workCenters` view since the capacity-planning migration recreated it) |
| `workCenterShift` | Which shifts a work center operates (scheduling availability-ladder rung 1); empty = all shifts at the location. Unique `(workCenterId, shiftId, companyId)` |
| `process` / `processes` (view) | Work types with active flag and `requiresAbility` |
| `workCenterProcess` | Many-to-many link between work centers and processes |
| `ability` / `employeeAbility` | Skills with learning curves and per-employee tracking |
| `partner` / `partners` (view) | External supplier partners |
| `contractor` / `contractors` (view) / `contractorAbility` | Contract labor with ability assignments |
| `maintenanceDispatch` | Equipment work orders: status, priority, severity, OEE impact; `takesWorkCenterOffline` subtracts the work center's scheduling hours while the dispatch is open |
| `maintenanceDispatchEvent` / `maintenanceDispatchComment` / `maintenanceDispatchItem` | Dispatch time, comments, and consumed parts |
| `maintenanceDispatchWorkCenter` / `maintenanceDispatchItemTrackedEntity` | Affected work centers and tracked items |
| `maintenanceSchedule` / `maintenanceScheduleItem` | Preventive maintenance plans with spare parts; `takesWorkCenterOffline` + `estimatedDuration` flow into generated dispatches (offline flag + `plannedEndTime = plannedStartTime + estimatedDuration`) |
| `maintenanceFailureMode` | Failure categories shared with quality module |
| `training` / `trainingAssignment` / `trainingQuestion` / `trainingCompletion` | Training programs with quizzes and completion tracking |
| `suggestion` / `suggestions` (view) | Employee suggestions |

## Key Service Functions

- `getLocations` / `getLocationsList` / `upsertLocation` — site management
- `getWorkCenters` / `getWorkCentersByLocation` / `activateWorkCenter` / `deleteWorkCenter` (soft) — work center management
- `getProcesses` / `getProcessesList` / `activateProcess` / `processDeactivate` — process management
- `getAbilities` / `getAbility` / `getEmployeeAbilities` / `insertAbility` — skill tracking
- `getEmployeeAbility` / `upsertEmployeeAbilityCell` / `deleteEmployeeAbility` (hard delete) / `resolveEmployeeAbilityExpiresAt` — per-employee qualification reads/writes (ability roster + person panel drawers)
- `ensureProcessAbility` — find-or-create the ability linked 1:1 to a process (called when `requiresAbility` is toggled on)
- `getPartners` / `getContractors` / `upsertContractor` — external resources
- `insertMaintenanceDispatch` / `updateMaintenanceDispatch` / `getMaintenanceDispatch(es)` — dispatch lifecycle
- `getMaintenanceDispatchEvents` / `getMaintenanceDispatchComments` / `getMaintenanceDispatchItems` — dispatch details
- `getMaintenanceSchedule(s)` / `upsertMaintenanceSchedule` — PM plans
- `getFailureModes` / `upsertFailureMode` — failure categorization
- `getTraining(s)` / `getTrainingAssignment(s)` / `getTrainingAssignmentStatus` / `getOutstandingTrainingsForUser` / `getTrainingGrantedAbilityId` — training management (`getTrainingGrantedAbilityId` returns the ability a completion grants, so the completion routes can `notifyScheduleInputsChanged` for that operator pool)
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
