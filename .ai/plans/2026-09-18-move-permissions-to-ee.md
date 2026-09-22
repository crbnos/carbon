# Move permission management to the commercial (`.ee`) surface

**Branch:** `move-permissions-to-ee`
**Date:** 2026-09-18
**Author:** brad@carbonos.dev

## Goal

Relocate the *authoring* of RBAC — creating/editing employee types, editing an
individual user's permissions, and console (kiosk) mode — behind the commercial
license marker (`.ee`) and the existing plan gate, so the Community/Starter
edition ships an "everyone is an admin" experience: you can **add users** but not
**author roles** or **modify permissions**.

This is a **posture + gating** change, not a mechanical build change. The `.ee`
infix and `packages/ee` are *license* boundaries only — there is no build-time
edition stripping. Restriction is delivered by the plan gate, not by the file move.

## Non-goals (explicitly deferred to the license-server work)

- Collapsing the 4-value `Edition` enum (`Cloud/Enterprise/Community/Test`) to two.
- Unifying the ~8 existing gating mechanisms (inline `CarbonEdition` checks,
  `canAccessBackups`/internal-email, `isCarbonOwnedCompany`, the hand-rolled
  Starter-block in `auth.server.ts:325`, route-flag declarations, ITAR).
- Making the **generic** plan gate enforce off-Cloud for the OTHER 11 features
  (workflows, API keys, …). Those keep `requirePlan`/`companyHasPlan`, which
  no-op off Cloud — a self-hosted community instance still gets them until the
  license server. (UPDATE 2026-09-19: the permission/console features now DO
  enforce on Community via the new `companyHasFeature`/`requireFeature` — see the
  follow-up section. Only the broader "all features off on Community" question is
  deferred.)
- Migrating SSO's edition-gate (`isSsoEnabled`) to plan-based. (Note for later:
  SSO is edition-gated only because cloud Supabase can't run SAML yet — once it
  can, it should become a `FEATURE_PLANS` entry too.)

## Enforcement stays everywhere — do NOT touch

Runtime permission *enforcement* is community functionality and must keep working
unchanged: `requirePermissions` (`@carbon/auth`, ~1,319 call sites), `get_claims`
/ `has_company_permission` (Postgres), all RLS policies, `getUserClaims` / the
Redis permission cache, and the client `usePermissions` hook. We only relocate and
gate the **authoring** layer.

## The product boundary

| Capability | Edition | Community behavior |
|---|---|---|
| Add / invite / deactivate users; user list | Community ✅ | unchanged |
| Enforcement (`requirePermissions`, RLS, claims) | Community ✅ | unchanged |
| Create / edit / delete employee types | Business (`PERMISSIONS`) | hidden + gated |
| Edit an individual user's permissions; bulk-edit; change a user's employee type | Business (`PERMISSIONS`) | hidden + gated |
| Console (kiosk) mode + Console Operator type | Business (`PERMISSIONS`) | hidden + gated |

**"Everyone is an admin" is emergent, not a new permission branch.** `seed-company`
seeds exactly one employee type — `Admin` (`protected: true`, `systemType: 'Admin'`,
full permissions). If Community never exposes employee-type creation *and* never
exposes console mode (the only other type-creating path), `Admin` is the only type
that can ever exist. The one required code change is the invite form: today it
*requires* the inviter to pick a type from a dropdown (`employeeType: z.string().min(1)`
in `users.models.ts`); in the gated case we hide the picker and resolve the
`systemType='Admin'` type in the action so every new Community user is an admin.

## Gate: one `FEATURE_PLANS` entry

`packages/ee/src/plan.ts` — add:

```ts
PERMISSIONS: [Plan.Business, Plan.Partner],
```

Single key covering role authoring + console mode (per decision — not two keys).
`packages/ee/AGENTS.md` lists changing `FEATURE_PLANS` as "Ask First" — approved.

Server: wrap gated route loaders/actions with
`requirePlan({ request, client, companyId, redirectTo, feature: "PERMISSIONS" })`
(from `@carbon/ee/plan.server`). `redirectTo` → the users index / settings page.
Client: hide nav entries + surfaces with `usePlanGate({ feature: "PERMISSIONS" })`
(from `~/hooks/usePlanGate`).

---

## Tasks

### 1. Add the `PERMISSIONS` feature key
- Edit `packages/ee/src/plan.ts`: add `PERMISSIONS: [Plan.Business, Plan.Partner]`.
- Update `.claude/rules/billing-system.md` FEATURE_PLANS list and
  `packages/ee/AGENTS.md` if it enumerates features.
- **Verify:** `pnpm --filter @carbon/ee typecheck`.

### 2. Relocate role/permission *authoring* code to `.ee`
The `moduleShape` check allows exactly one `users.service.ts` and one
`users.models.ts` per module, but **unlimited `*.server.ts`** files. So:

- Create `apps/erp/app/modules/users/users.permissions.ee.server.ts` and move the
  authoring-**exclusive** writes into it (verified by caller-map — see below):
  - Employee-type CRUD: `insertEmployeeType`, `upsertEmployeeType`,
    `deleteEmployeeType`, `upsertEmployeeTypePermissions` (from `users.service.ts`
    L590/608/151/629) — callers are only the employee-type routes.
  - `updateEmployee` (from `users.server.ts` L1483) — sole caller is the gated
    per-user editor `employees.$employeeId.tsx`. It calls `updatePermissions`
    cross-file, which is fine.
- **CORRECTION to the original plan — DO NOT move these; they are shared plumbing
  a community path or a background job depends on:**
  - `updatePermissions` (`users.server.ts` L1511) — also called by the
    `@carbon/jobs` task `update-permissions.ts`.
  - `setUserPermissions` (`users.server.ts` L1449, private) — called by
    `acceptInvite` (community invite acceptance). Moving it into a gated file
    would break invites.
  - The `make*` translators (`makeEmptyPermissionsFromModules`,
    `makeCompanyPermissionsFromClaims`, `makePermissionsFromClaims`,
    `makeCompanyPermissionsFromEmployeeType`) — pure rendering helpers with no
    commercial weight; leaving them avoids a mid-file dependency web. The gate is
    delivered by `requirePlan` on the route + the `.ee` UI, not by relocating
    these. `makeEmptyPermissionsFromModules` is also used by
    `api+/users.empty-permissions.ts` (gate that route too).
- **Leave in community** (invite path depends on them): `createEmployeeAccount`,
  `getPermissionsByEmployeeType`, `makePermissionsFromEmployeeType`, `getModules`,
  `getEmployeeType`/`getEmployeeTypes` reads.
- Rename the UI to `.ee.tsx` (license marker; imports update to the literal path,
  like `ConfigurationEditor.ee`):
  - `modules/users/ui/EmployeeTypes/EmployeeTypeForm.tsx`,
    `EmployeeTypesTable.tsx` → `.ee.tsx`.
  - `modules/users/ui/Employees/EmployeePermissionsForm.tsx`,
    `BulkEditPermissionsForm.tsx` → `.ee.tsx`.
- Validators: `employeeTypeValidator`, `employeeTypePermissionsValidator`,
  `userPermissionsValidator`, `bulkPermissionsValidator` — keep in
  `users.models.ts` (the single models file; do not create a second models file),
  OR move to the `.ee.server.ts` if they are used only by gated routes. Decide by
  grepping their importers.
- Update the `~/modules/users` barrel (`index.ts`) exports accordingly.
- **Verify:** `pnpm exec turbo run typecheck --filter=@carbon/erp` after wiring;
  `node scripts/... module-shape` (via `pnpm run lint` / the checks) passes — no
  `extra-service` / missing-file findings.

### 3. Gate the role/permission routes
- `x+/users+/employee-types.tsx`, `employee-types.$employeeTypeId.tsx`,
  `employee-types.new.tsx`, `employee-types.delete.$employeeTypeId.tsx`,
  `employees.$employeeId.tsx`, `bulk-edit-permissions.tsx`: add `requirePlan({...,
  feature: "PERMISSIONS" })` in loader **and** action, after `requirePermissions`.
- Hide their nav/entry points. The Employee-Types settings nav lives via
  `modules/settings/ui/useSettingsSubmodules.tsx` and/or the users module nav —
  gate the entries with `usePlanGate({ feature: "PERMISSIONS" })`. In
  `EmployeesTable.tsx`, hide the "Edit permissions" / bulk-edit affordances when
  gated.
- **Verify (Cloud path):** with `CARBON_EDITION=cloud` and a non-bypassed Starter
  company, the routes redirect with the upgrade flash; a Business company reaches
  them. Off-Cloud they pass (documented gap).

### 4. Invite path → default to Admin in the gated case
- `x+/users+/employees.new.tsx` + `modules/users/ui/Employees/CreateEmployeeModal.tsx`:
  when `usePlanGate({ feature: "PERMISSIONS" }).isGated`, hide the employee-type
  `<Select>`; the action resolves the `systemType='Admin'` employee type for the
  company and passes its id as `employeeType` so `createEmployeeValidator`
  (`employeeType` required) is satisfied and `createEmployeeAccount` snapshots the
  full Admin permission set.
- Keep the ungated (Business) behavior exactly as today (real picker).
- **Verify:** on a gated company, inviting a user with no picker yields a user with
  full Admin permissions on accept; on Business, the picker still drives the type.

### 5. Console (kiosk) mode → Business
- Locate the console-mode setting route + UI (grep `updateConsoleSetting`,
  `consoleEnabled`/`console` in `apps/erp/app/routes/x+/settings+/` and
  `modules/settings/ui/`). `updateConsoleSetting` is in
  `apps/erp/app/modules/settings/settings.service.ts` (~L1390) and creates the
  `Console Operator` protected type (L1411–1479).
- Gate the console setting action/route with `requirePlan({..., feature:
  "PERMISSIONS" })` and hide the toggle with `usePlanGate`.
- Move the Console-Operator-type-creation block (the commercial part of
  `updateConsoleSetting`) behind the license marker — extract it to
  `users.permissions.ee.server.ts` (or a settings `.ee.server.ts`) and call it
  from the gated action. `settings.service.ts` is the module's single service
  file; do not add a second service file — extract to a `.server.ts`.
- **Verify:** gated company cannot enable console mode / create a Console Operator
  type; Business can.

### 6. Docs / rules sync
- Update `packages/ee/AGENTS.md` (new `PERMISSIONS` gate; note the relocated
  authoring surface), `.claude/rules/billing-system.md` (FEATURE_PLANS list), and
  `.claude/rules/authentication-system.md` if it describes where permission
  authoring lives. Consider a short `.claude/rules/` note or an
  `apps/erp/app/modules/users/AGENTS.md` update documenting the community/enterprise
  cut and the "everyone is admin" emergent behavior.
- If any user-facing docs describe employee types / permissions, note the edition
  gating (carbon-docs skill).

### 7. Full verification
- `pnpm exec turbo run typecheck --filter=@carbon/erp`
- `pnpm exec turbo run typecheck --filter=@carbon/ee`
- `pnpm run lint` (module-shape + conformance checks green)
- `pnpm --filter @carbon/ee test`
- Browser (per UI-e2e-verification rule): boot `crbn up`, verify with
  `CARBON_EDITION=cloud` + a Starter (non-bypass) company that the surfaces hide
  and invite defaults to Admin; with a Business company that everything is present.

## Consolidation follow-up (2026-09-19) — moved the valuable logic to `packages/ee`

After the first pass (which relocated only the thin CRUD to an app-local
`.ee.server.ts`), we moved the actual IP — the flattened-permission-object
builder and translators — into the package, and deduped a hidden second copy:

- New `@carbon/ee/permissions.server` (`packages/ee/src/permissions.server.ts`)
  now holds `updatePermissions`, `updateEmployee`, the employee-type CRUD, and
  the `make*` translators (`makeEmptyPermissionsFromModules`,
  `makeCompanyPermissionsFromClaims`, `makeCompanyPermissionsFromEmployeeType`).
  Local structural `CompanyPermission`/`Permission` types (no `~/` coupling).
- The app-local `users.permissions.ee.server.ts` was **deleted**; all ERP
  routes import from `@carbon/ee/permissions.server`.
- **Dedup:** `@carbon/jobs` `update-permissions.ts` had its OWN full copy of
  `updatePermissions` (drifted). It now imports the one in `@carbon/ee` and is
  just the durable wrapper. `@carbon/jobs` already depends on `@carbon/ee`, and
  `@carbon/ee` does not depend on `@carbon/jobs` — no cycle.
- **Stayed in the app** (`users.server.ts`), community invite plumbing:
  `setUserPermissions` (invite merge) and `makePermissionsFromEmployeeType`
  (invite snapshot). The ERP `makePermissionsFromClaims` was **dead code**
  (only `@carbon/auth` has a used copy) and was deleted.
- **UI stays `.ee.tsx` in the app** — the forms import `~/components/Form`,
  `~/hooks`, `~/utils/path`, which don't exist in the package.
- `@carbon/ee` uses `noUncheckedIndexedAccess`; the ported translator needed a
  `module === undefined` guard and a local-ref rewrite the ERP tsconfig didn't.

Verified: `@carbon/ee`, `@carbon/jobs`, `erp` typecheck clean (only the
pre-existing `root.tsx` typegen artifact); Biome clean; MCP digest unchanged
(users 30, settings 95 — the moved fns were never in `*.service.ts`).

## Execution status (2026-09-19)

Implemented on branch `move-permissions-to-ee`. Verified: `@carbon/ee` + `erp`
typecheck clean (only the pre-existing `root.tsx` `+types/root` typegen artifact,
untouched by this work), Biome clean, MCP digest regenerated. **Not** done:
browser e2e (stack not booted) and the license-server off-Cloud enforcement (out
of scope by design).

What landed:
- `packages/ee/src/plan.ts`: `PERMISSIONS: [Plan.Business, Plan.Partner]`.
- New commercial files: `apps/erp/app/modules/users/users.permissions.ee.server.ts`
  (the 4 employee-type CRUD funcs + `updateEmployee`) and
  `.../settings/settings.console.ee.server.ts` (`updateConsoleSetting`); removed
  from `users.service.ts` / `settings.service.ts`.
- UI renamed to `.ee.tsx`: `EmployeeTypeForm`, `EmployeeTypesTable`,
  `EmployeePermissionsForm`, `BulkEditPermissionsForm` (barrels repointed).
- `requirePlan({ feature: "PERMISSIONS" })` on all 7 authoring routes
  (employee-types list/new/$id/delete, employees.$employeeId, bulk-edit,
  api/users.empty-permissions). Console gated in `people.tsx` via an
  edition/plan predicate (fetcher returns JSON, so no redirect).
- Community "everyone is admin": invite (`employees.new` action) resolves the
  seeded `systemType='Admin'` type when gated; `CreateEmployeeModal` hides the
  picker + submits a Hidden Admin id. Nav ("Employee Types"), the bulk/per-user
  "Edit Permissions" affordances, and the Console Mode card are hidden client-side
  via `usePlanGate`.

**MCP surface change (intentional):** moving the 5 write functions out of
`*.service.ts` removed them as auto-generated MCP tools —
`users_{insert,upsert,delete}EmployeeType`, `users_upsertEmployeeTypePermissions`,
`settings_updateConsoleSetting`. This CLOSES a previously ungated path: the MCP
tools called the service directly, bypassing the route `requirePlan`. Digest
regenerated (`users` 30, `settings` 95).

## Open risks to resolve during execution
1. **Shared reads.** Some employee-type reads (`getEmployeeType(s)`,
   `getPermissionsByEmployeeType`) are used by community paths (invite). Grep every
   importer before moving; keep community-needed reads in `users.service.ts`.
2. **`users.server.ts` duplicates `@carbon/auth`** (`getClaims`,
   `getPermissionCacheKey`). Don't move those to `.ee`; they're enforcement-adjacent.
   Optionally reconcile the duplication, but that's not required for this PR.
3. **Client/server gate divergence** (§ non-goals): accept it; ensure the route
   uses `requirePlan` so the future off-Cloud flip is one edit.
4. **Console Operator uniqueness** — the partial unique index from
   `20260401000000_protect-console-operator-type.sql` still holds; we don't change
   schema, only who can trigger the insert.
