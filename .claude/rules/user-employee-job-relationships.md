---
description: How user, employee, employeeJob, company membership, and permissions/claims relate in Carbon's auth identity graph
paths:
  - "packages/database/supabase/migrations/**"
  - "packages/auth/src/services/**"
  - "apps/erp/app/modules/users/**"
  - "apps/erp/app/modules/resources/**"
---

# User / Employee / EmployeeJob / Permission identity graph

Carbon's identity is multi-tenant: one `user` can belong to many companies, with a
per-company `role` and per-company `employee` record. "Job" in `employeeJob` means an
employee's job **title/role within a company** — NOT a production/manufacturing job (that
is the separate `job` table from `20240909194622_jobs.sql`).

## Core tables (PK + key columns; newest migrations applied)

- **`user`** — global identity, `id` matches Supabase `auth.users.id`. PK `id`.
  - `email`, `firstName`, `lastName`, `fullName` (GENERATED `firstName || ' ' || lastName`, STORED),
    `about` (default `''`), `avatarUrl`, `active` (default TRUE), `phone`, `admin`, `developer`,
    `isConsoleOperator`, `flags` JSONB, `acknowledgedITAR`, `externalId` JSONB, `createdAt`, `updatedAt`.
  - No FKs to other app tables. `fullName` is generated and never null when names are set;
    prefer it directly.
- **`userToCompany`** — the membership join table. PK `(userId, companyId)`.
  `role "role"` where `CREATE TYPE "role" AS ENUM ('customer','employee','supplier')`.
  This is how a user belongs to multiple companies (one row per company, role can differ per company).
- **`employee`** — per-company employee record. PK `(id, companyId)`; `id → user.id`.
  `employeeTypeId → employeeType.id` (RESTRICT), `companyId → company.id`,
  `active BOOLEAN DEFAULT FALSE`, `pin` (console mode). Added in `20241208004151_invites.sql`.
- **`employeeJob`** — job title / org placement. PK `(id, companyId)`; `id → user.id`.
  `title`, `startDate DATE`, `locationId → location.id`, `departmentId → department.id`,
  `shiftId → shift.id`, `managerId → user.id`, `tags TEXT[]`, `customFields` JSONB,
  `updatedAt`, `updatedBy → user.id`. Created `20230224035103_shifts.sql`; `departmentId`/`tags`
  added later. (`workCellId` existed briefly, then dropped in `20240819115702_work-centers.sql`.)
- **`employeeType`** — per-company role definition. PK `id`. `name`, `companyId → company.id`,
  `protected BOOLEAN`.
- **`employeeTypePermission`** — permissions granted by an employee type. PK `(employeeTypeId, module)`.
  `module "module"` (enum), and `view/create/update/delete TEXT[]` (each is an array of company IDs;
  `"0"` = all companies). `employeeTypeId → employeeType.id`.
- **`userPermission`** — the effective, flattened per-user permission set. PK `id` (`id → user.id`).
  `permissions JSONB DEFAULT '{}'` keyed like `<module>_<action>` → array of company IDs.

## How permissions / claims are derived

1. Membership: `userToCompany` gives the user's `role` in a company.
2. Grants: `employee.employeeTypeId → employeeType → employeeTypePermission` defines what each
   employee type can do per module/action, scoped to company IDs.
3. Flattened: those grants are materialized into `userPermission.permissions` (JSONB,
   `<module>_<action>` → company-ID array).
4. Claims: SQL `get_claims(uid, company)` (`20230123004206_claims.sql`) reads `role` from
   `userToCompany` and `permissions` from `userPermission`, then returns
   `(jsonb_build_object('role', role) || permissions)`. RLS helpers like `has_company_permission`,
   `get_companies_with_employee_role()`, and `get_companies_with_employee_permission('<module>_<action>')`
   enforce this in policies (helpers re-defined in later migrations — read the newest).
5. App layer (`packages/auth/src/services/`): `getUserClaims()` caches claims in Redis at
   `permissions:${userId}` (falls back to the RPC); `makePermissionsFromClaims()` (`users.ts`) parses
   them into `{ permissions, role }`; `requirePermissions(request, { view?, create?, update?, delete?, role? })`
   in `auth.server.ts` is the route gate. Active company comes from a `companyId` cookie via
   `getCompanyId`/`setCompanyId` (`company.server.ts`).

## Views (read-only joins)

- **`employees`** — newest in `20260529160000_employees-view-status.sql`. Joins `user` + `employee`
  (+ `employeeJob`/`location` for `locationId`, `locationName`). Aliases `fullName AS "name"`. Adds a
  computed `status` (`'Active' | 'Invited' | 'Inactive'`) from `employee.active` and the `invite` table.
  Filter is `WHERE u.active = TRUE` (on **user**, not employee), so inactive employees of an active user
  still appear — filter on `active`/`status` when you only want active employees.
- **`employeeSummary`** — `20240103010721_employee-summary.sql`. `user` + `employee` + LEFT JOIN
  `employeeJob`/`location`/`department`/manager `user`. Returns `id, name, avatarUrl, companyId, title,
  startDate, departmentName, locationName, managerName`.
- **`employeesAcrossCompanies`** — `20260526091437_employee-location.sql`. Aggregates `companyId` per user
  (`array_agg`) for users across companies.

## Gotchas

- `employee` and `employeeJob` share composite PK `(id, companyId)` and `id → user.id` — always scope
  queries by **both** id and companyId. A user has one employee/employeeJob row **per company**.
- `userToCompany.role` (membership type) is distinct from `employeeType` (which permission set);
  don't conflate "role" the enum with "role" the job title (`employeeJob.title`).
- Permission company-ID array `"0"` means "all companies" — don't string-match a literal company id only.
- Deactivating an employee (`deactivateEmployee` in `users.server.ts`) removes the company from
  `userPermission.permissions`, deletes the `userToCompany` and `employeeJob` rows, sets
  `employee.active = false`, and invalidates the Redis claims cache.
- Permission/claims helper SQL functions are redefined across many migrations — always read the newest.
