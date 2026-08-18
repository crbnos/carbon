# Run: NIST 1A.2 — Permission/role-change audit events (3.3.1/3.3.2)

Branch: `feat/nist-1a2-permission-audit` (base `nist-800-110-audit`)
Mode: fully autonomous — plan → execute → self-review (research/spec/grill skipped; design pre-resolved in plan §1A.2)

## Goal
Emit structured audit events (actor, target user, before/after permission set, companyId)
on permission/role mutations that today emit nothing.

## Design (grounded)
- Extend `packages/auth/src/services/auth-events.server.ts` `AuthEvent` union with
  `permission_changed` + `role_changed`. Add two typed helpers `logPermissionChange` /
  `logRoleChange` and a pure `grantedPermissionKeys(permissions, companyId)` summariser.
- Thread acting `userId` (actor) through the service-role write paths:
  - `deactivate{User,Employee,Customer,Supplier}` in `users.server.ts` gain optional `actorId`;
    each concrete deactivation emits `role_changed` (role → null) with the before/after
    permission summary for the company.
  - `carbon/update-permissions` + `carbon/user-admin` (deactivate) event payloads gain optional
    `actorId` (`packages/lib/src/events.ts`); ERP routes `bulk-edit-permissions.tsx`,
    `deactivate.tsx`, `revoke-invite.tsx` pass the acting `userId`.
  - `updatePermissions` job snapshots the before-set and emits `permission_changed`.
- Export `@carbon/auth/auth-events.server` subpath so the jobs package can import the emitter.

## TDD
- `packages/auth/src/services/auth-events.server.test.ts` — red→green: `grantedPermissionKeys`
  purity + `logPermissionChange`/`logRoleChange` payload shape (mock `@carbon/logger`).

## Gates
- `pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp --filter=@carbon/jobs`
- `pnpm run lint`
- `pnpm --filter @carbon/auth test`

## Additional path covered (analogous, not gold-plating)
- ERP single-user permission edit: `updateEmployee`/`updatePermissions` in
  `apps/erp/app/modules/users/users.server.ts` (route `employees.$employeeId.tsx`) — same
  class of `userPermission` write as the bulk path; emits `permission_changed` with actor.

## Deliberate scope boundaries (NOT emitting)
- Invite self-activation (`setUserPermissions` via invite acceptance): actor == target,
  permissions pre-approved by an admin at invite-creation time; a lifecycle event, not an
  admin permission mutation.
- `employeeTypePermission` role-template writes (employee-types route): role DEFINITION
  config, different shape, not a per-user grant; would need separate modeling.

## Status
- [x] tests written + green (`packages/auth/src/services/auth-events.test.ts`, 7 new)
- [x] implementation (emission wired into all named paths + analogous single-user path)
- [x] gates pass — typecheck (@carbon/auth, @carbon/jobs, erp, @carbon/lib), lint (33/33),
      auth tests (30 passed)
- [x] self-review + PR

## UNVERIFIED (environment cannot prove)
- Runtime/DB/browser emission (no stack booted): the actual CloudWatch/JSONL lines are not
  observed. Proven only by unit tests + typecheck.
