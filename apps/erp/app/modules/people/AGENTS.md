# People Module

Employee management, departments, shifts, holidays, time tracking (clock in/out, timecards), contacts, and employee attributes (custom fields). Manages the HR/organizational side — identity and permissions live in the `users` module.

## Key Domain Concepts

- **People vs Users vs Employees** — `user` is the global auth identity. `employee` is a per-company record with composite PK `(id, companyId)` where `id → user.id`. `employeeJob` holds title, location, department, shift, and manager. See `.claude/rules/user-employee-job-relationships.md`.
- **Departments** — hierarchical organizational units via `parentDepartmentId`. Used for org structure and reporting.
- **Shifts** — work schedules with day-of-week boolean flags (`monday`..`sunday`), start/end times, and location. Assigned to employees via `employeeJob.shiftId`.
- **Holidays** — company-specific non-working days with year grouping.
- **Time Tracking** — `clockIn`/`clockOut` functions manage `timeCardEntry` records. Weekly hours aggregated via `getWeeklyHoursForEmployees`.
- **Contacts** — external contacts (not employees) associated with customers/suppliers via the `contact` table.
- **Employee Attributes** — custom field system: categories → attributes → values. Each attribute has a data type (text, numeric, boolean, date, user, file, list) from `attributeDataType`. Values stored per user in `userAttributeValue`.

## Safety

### Always
- MUST scope `employeeJob` queries by BOTH `id` AND `companyId` — composite PK.
- MUST distinguish `employeeJob.title` (job role string) from `userToCompany.role` (membership type enum: customer/employee/supplier).
- MUST use `getEmployeeJob` for employee job info — it joins the correct tables with proper scoping.
- MUST soft-delete attributes and attribute categories via `active: false` — `deleteAttribute` and `deleteAttributeCategory` both use soft-delete.
- MUST soft-delete shifts via `active: false` — `deleteShift` sets `active: false`, not a hard delete.

### Ask First
- Deleting departments with assigned employees — cascading impact on org structure.
- Modifying shifts actively assigned to employees — affects scheduling.
- Bulk-editing employee attributes — values are per-user and may have downstream effects.

### Never
- Confuse `employeeJob` (HR job placement) with `job` (production work order) — completely different tables.
- Directly modify `userPermission` — permissions flow from `employeeType → employeeTypePermission → userPermission`.
- Hard-delete attribute categories, attributes, or shifts — always soft-delete via `active: false`.

## Validation Commands

```bash
pnpm --filter @carbon/erp typecheck
pnpm --filter @carbon/erp test -- --testPathPattern=people
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `employeeJob` | Job details: title, startDate, locationId, departmentId, shiftId, managerId |
| `employeeSummary` (view) | Denormalized employee info with names |
| `department` | Org units with `parentDepartmentId` hierarchy |
| `shift` / `shifts` (view) | Work schedules: day flags, times, location |
| `holiday` / `holidayYears` (view) | Company non-working days with year grouping |
| `timeCardEntry` / `timeCardEntries` (view) | Clock in/out records with notes |
| `userAttributeCategory` / `userAttribute` / `userAttributeValue` | Custom employee fields |
| `attributeDataType` | Lookup table for attribute data types |
| `contact` | External contacts (customer/supplier contacts) |

## Key Service Functions

- `getEmployeeJob` / `updateEmployeeJob` / `insertEmployeeJob` — employee job management
- `getEmployeeSummary` — denormalized employee data
- `getPeople` — people directory with attributes merged from `userAttributeCategory`
- `getContacts` — external contact search
- `getDepartments` / `getDepartmentsList` / `getDepartmentsTree` — org structure
- `getShifts` / `getShiftsList` / `upsertShift` — work schedule management
- `getHolidays` / `getHolidayYears` / `upsertHoliday` — holiday calendar
- `clockIn` / `clockOut` / `getTimeCardEntries` / `getWeeklyHoursForEmployees` — time tracking
- `getClockedInEmployees` / `getScheduledEmployeesToday` — real-time workforce status
- `getAttribute` / `getAttributeCategories` / `insertAttribute` / `updateAttribute` — custom fields

## Key Exports

```typescript
import { getEmployeeJob, getDepartmentsList, clockIn, clockOut } from "~/modules/people";
```

## Related Modules

- **resources** — locations and shifts are shared; work centers assign employees via abilities
- **production** — job operations have `assignee` (employee); production events track employee time
- **users** — identity, permissions, and claims (separate module)
- **sales** — customer contacts overlap; `getEmployeeJob` used for assignee lookups
- **accounting** — employees used as dimension values in journal entries

## Rules References

- `.claude/rules/user-employee-job-relationships.md` — identity graph: user → employee → employeeJob → permissions
