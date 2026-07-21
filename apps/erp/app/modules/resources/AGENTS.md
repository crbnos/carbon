# Resources Module

Locations, work centers, processes, abilities (skills), partners, contractors, equipment maintenance (dispatches and schedules), failure modes, training management, and employee suggestions. Manages the physical and capability infrastructure that production depends on.

## Key Domain Concepts

- **Location** — physical site/facility. Every inventory record, job, and employee is scoped to a location. Has address, timezone, and GPS coordinates. Company-scoped.
- **Work Center** — production station within a location. Operations schedule onto work centers. Have capacity, rates, and active/inactive status. MUST soft-delete via `active: false`.
- **Process** — type of work (e.g., "CNC Milling", "Welding"). Operations reference a process. Linked to work centers via `workCenterProcess`. MUST soft-delete via `active: false`.
- **Ability** — employee skill/certification with a learning curve. Tracked per employee via `employeeAbility` with training status, shadow weeks, and completion tracking.
- **Partner** — external supplier location with ability mappings for outsourced work.
- **Contractor** — supplier contact working as contract labor, with hours-per-week and ability assignments via `contractorAbility`.
- **Maintenance Dispatch** — reactive or scheduled work order for equipment. Statuses: Open → Assigned → In Progress → Completed / Cancelled. Tracks time events, consumed parts, and affected work centers.
- **Maintenance Schedule** — preventive maintenance plan with frequency, priority, and required spare parts.
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
| `workCenter` / `workCenters` (view) / `workCentersWithBlockingStatus` (view) | Production stations with capacity and blocking info |
| `process` / `processes` (view) | Work types with active flag |
| `workCenterProcess` | Many-to-many link between work centers and processes |
| `ability` / `employeeAbility` | Skills with learning curves and per-employee tracking |
| `partner` / `partners` (view) | External supplier partners |
| `contractor` / `contractors` (view) / `contractorAbility` | Contract labor with ability assignments |
| `maintenanceDispatch` | Equipment work orders: status, priority, severity, OEE impact |
| `maintenanceDispatchEvent` / `maintenanceDispatchComment` / `maintenanceDispatchItem` | Dispatch time, comments, and consumed parts |
| `maintenanceDispatchWorkCenter` / `maintenanceDispatchItemTrackedEntity` | Affected work centers and tracked items |
| `maintenanceSchedule` / `maintenanceScheduleItem` | Preventive maintenance plans with spare parts |
| `maintenanceFailureMode` | Failure categories shared with quality module |
| `training` / `trainingAssignment` / `trainingQuestion` / `trainingCompletion` | Training programs with quizzes and completion tracking |
| `suggestion` / `suggestions` (view) | Employee suggestions |

## Key Service Functions

- `getLocations` / `getLocationsList` / `upsertLocation` — site management
- `getWorkCenters` / `getWorkCentersByLocation` / `activateWorkCenter` / `deleteWorkCenter` (soft) — work center management
- `getProcesses` / `getProcessesList` / `activateProcess` / `processDeactivate` — process management
- `getAbilities` / `getAbility` / `getEmployeeAbilities` / `insertAbility` — skill tracking
- `getPartners` / `getContractors` / `upsertContractor` — external resources
- `insertMaintenanceDispatch` / `updateMaintenanceDispatch` / `getMaintenanceDispatch(es)` — dispatch lifecycle
- `getMaintenanceDispatchEvents` / `getMaintenanceDispatchComments` / `getMaintenanceDispatchItems` — dispatch details
- `getMaintenanceSchedule(s)` / `upsertMaintenanceSchedule` — PM plans
- `getFailureModes` / `upsertFailureMode` — failure categorization
- `getTraining(s)` / `getTrainingAssignment(s)` / `getTrainingAssignmentStatus` / `getOutstandingTrainingsForUser` — training management
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
