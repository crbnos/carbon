# Workflows: company-owned workflows

- **Status:** In review
- **Date:** 2026-08-28
- **Branch:** `feat/workflow-company-ownership`
- **Prior art:** `.ai/specs/2026-08-24-workflow-publish-unpublish.md`

## 1. Problem

A workflow runs as its owner. `workflow.ownerId` is set once from `createdBy`
(`workflows.service.ts:126`) and there is no route that reassigns it — `$id.rename.tsx:11-12`
says so in a comment: "ownership is taken, never assigned". The engine mints a JWT for that
user on every step and checks their **live** permissions on every node
(`engine/owner.ts:30-72`, `engine/execute.ts:163`).

So a workflow's continued operation depends on one employee's continued employment:

- `deactivateEmployee` strips the company out of the owner's `userPermission` row and deletes
  their `userToCompany` row (`packages/auth/src/services/users.server.ts:199-265`).
- `get_companies_with_employee_permission` then returns nothing for them, every node fails its
  permission check, and the run ends `Failed` with a no-access error.
- Nobody can repair it. Ownership cannot be reassigned, and `$id.test-run.tsx:61` refuses a test
  run to anyone but the owner — so no one else can even reproduce the failure.

The same break has a much smaller trigger than someone leaving: narrowing an employee's
permissions, or moving them between roles, silently stops a workflow they wrote a year ago.

## 2. Goals

- A workflow can be owned by the company rather than by a person, and keeps running when any
  employee leaves.
- The engine, the matcher and the scheduler are unchanged.
- The service identity is invisible everywhere a person is listed, and is never billed.

## 3. Non-goals

- **Nothing becomes company-owned in this PR.** `insertWorkflow` accepts `ownerKind` and no
  caller passes `"company"` yet. This ships the ownership model; the first consumer is the
  approval-policy work.
- **No ownership transfer UI, and no automatic transfer on deactivation.** Both need the service
  identity to hold write permissions (§6, D2), which is a decision this PR deliberately defers.
- Seeded demo workflows stay user-owned, for the same reason — their definitions contain action
  nodes.

## 4. Design

### 4.1 Data model

```sql
ALTER TABLE "user" ADD COLUMN "isServiceAccount" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "workflow" ADD COLUMN "ownerKind" TEXT NOT NULL DEFAULT 'user'
  CHECK ("ownerKind" IN ('user', 'company'));
```

`ownerId` keeps pointing at a real `user` row in both cases. That is the load-bearing choice:
the engine resolves an owner id and mints a client for it, so `ownerKind` changes nothing below
the service layer. It is read by the UI, the test-run gate, and (later) company restore.

`ownerKind` must have a DEFAULT: `assertBackupImportable`
(`packages/jobs/src/inngest/functions/tasks/company-backup.ts:773-800`) rejects a backup missing a
NOT NULL column with no default, which would make every existing backup unimportable.

`isServiceAccount` is a real column rather than an id-prefix convention because seat billing counts
`userToCompany` rows and the filter has to be something other than a string shape (§4.4).

### 4.2 The service identity

Three rows per company and no auth account, minted by
`provision_workflow_service_user(company_id)`:

| Table | Row | Why it is required |
|---|---|---|
| `user` | `wfsvc_<companyId>`, `isServiceAccount = true` | the FK target for `workflow.ownerId` |
| `userPermission` | read-only grants, scoped to the one company | without the row `get_claims` returns `NULL`, which the engine reads as "no permissions" and fails every step |
| `userToCompany` | `role = 'employee'` | `get_companies_with_employee_permission` intersects it with the permission arrays; every workflow-table RLS policy goes through it |

**No `employee` row, on purpose.** The `employees` view inner-joins `employee`, and that view is
the sole hydration source for `usePeople` — the store behind every avatar, picker, assignee
control, table filter and CSV name lookup in ERP and MES. Omitting the row is what keeps the
identity out of all of them at once.

`public.user` has no FK to `auth.users`, and `getUserScopedClient` self-signs an HS256 JWT with
`sub: userId` (`packages/auth/src/lib/supabase/client.server.ts:14-37`), so an identity with no
auth account is still a fully RLS-scoped principal. Precedent: the global `system` user
(`20230123004317_companies-rls.sql:75-76`) and console operators
(`users.server.ts:850-943`), which are synthetic `user` rows already.

Provisioning is a SQL function so the backfill and `seed-company` cannot define the identity two
different ways. It is `SECURITY DEFINER` and execute is revoked from `anon`/`authenticated` —
it mints a principal, so only the service role may call it.

### 4.3 Read-only grants

Every module gets `<module>_view: [companyId]`; create/update/delete are present as empty arrays
(every path that mutates permissions assumes the keys exist). The `"0"` all-companies wildcard is
retired (`20260817030612`), so the company is enumerated.

Read-only is the whole security argument for this design. A gate policy — the first intended
consumer — contains only condition, compute, lookup and filter nodes, none of which write. Granting
writes would create a standing all-module principal in every company in exchange for nothing.
Widening later is additive; narrowing later is a breaking change, so the narrow set is the one that
has to ship first.

### 4.4 Keeping it invisible

Four surfaces are not covered by the missing `employee` row, because they read `userToCompany` or
`user` directly:

| Surface | Fix |
|---|---|
| `updateSubscriptionQuantityForCompany` counts `userToCompany` rows → **a service identity would be billed as a seat** | filter `isServiceAccount` out of the count (`packages/stripe/src/stripe.server.ts:674-695`) |
| Settings → Billing "New Owner" dropdown reads `userToCompany` where `role = 'employee'` | filter it out (`billing.tsx:78-92`) |
| `getUsers` / `getUserEmails` / `resolveUserSelectIds` read `user` with no employee join; `getUsers` is also the MCP tool `users_getUsers` | `.eq("isServiceAccount", false)` on all three |
| Workflow Owner columns render `EmployeeAvatar`, which shows a nameless blank circle for anyone absent from `usePeople` | new `WorkflowOwner` component renders the identity as "Company" |

The `UserSelect` tree needs no change: browse and search go through `groupMembers` scoped by
`companyId`, and company-group membership is created by a trigger on `employee` INSERT — which
never fires here. The auto-created identity group has `companyId = NULL` and `isIdentityGroup =
true`, both of which `get_user_select_groups` already excludes.

### 4.5 Guards

- `deactivateUser` refuses a service account. Deactivating one would strip the permissions every
  workflow it owns runs with — precisely the failure this feature exists to prevent — and nothing
  could restore it. The `deactivateEmployee` call sites inside `createEmployeeAccount` are invite
  rollback paths that can only ever see a real invited employee, so they need no guard.
- `deleteSubsidiary` deletes the identity after the company. The company cascade reaches everything
  scoped by `companyId`, but `user` has no such column, so the row would otherwise be orphaned.
  Order matters: `workflow.ownerId` references it with no `ON DELETE`, so the workflows must go
  first.

### 4.6 Test runs

`$id.test-run.tsx` refused any caller who is not the owner, so a company-owned workflow would have
been untestable by everyone. It now accepts `workflows_update` when `ownerKind = 'company'`. There
is nothing to escalate to: the identity holds no more than read access, which is strictly less than
any caller who can already reach this route.

The run executes as `workflow.ownerId` rather than as the caller. For a user-owned workflow those
are the same value (the gate proves it), so this is not a behaviour change — but it is what makes
the company-owned test exercise the permissions production will use.

## 5. Files

| Area | Change |
|---|---|
| `20260828103412_workflow-company-ownership.sql` | both columns, `workflow_service_user_permissions`, `provision_workflow_service_user`, backfill over existing companies |
| `packages/workflows/src/owner.ts` | `WorkflowOwnerKind`, `getWorkflowServiceUserId`, `isWorkflowServiceUserId` |
| `seed-company/index.ts` | provision the identity for new companies |
| `packages/stripe/src/stripe.server.ts` | exclude service accounts from the seat count |
| `packages/auth/src/services/users.server.ts` | refuse to deactivate a service account |
| `apps/erp/.../users.service.ts` | exclude service accounts from three `user` reads |
| `apps/erp/.../settings.service.ts` | clean up the identity on subsidiary delete |
| `apps/erp/.../workflows.service.ts` | select and accept `ownerKind`, resolve `ownerId` from it |
| `apps/erp/.../billing.tsx`, `$id.tsx`, `$id.test-run.tsx` | owner dropdown, test affordance, test-run gate |
| `apps/erp/.../ui/WorkflowOwner.tsx` + 3 call sites | render a company owner |

## 6. Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| D1 Resolve `ownerId` at write time, or at run time from `ownerKind` | Write time — `ownerId` always holds a real user id | Keeps the engine, matcher and scheduler untouched. Run-time resolution would put a lookup on the hottest path in the module |
| D2 Grant set for the identity | Read-only, all modules | Gate policies contain no writing nodes. Widening is additive; narrowing is breaking |
| D3 Marker for non-human principals | `user.isServiceAccount` column | Seat billing counts `userToCompany`; an id-prefix check in `packages/stripe` would couple billing to a workflows naming convention |
| D4 `employee` row for the identity | No | It is the single predicate that hides it from every people surface at once |
| D5 Where provisioning lives | A SQL function called by both the backfill and `seed-company` | Two definitions of a security principal is one too many |
| D6 Service identity id | Derived, `wfsvc_<companyId>` | Idempotent provisioning, and no lookup needed to resolve it. `user.id` is a bare PK, so a per-company value is globally unique |

## 7. Acceptance criteria

- [ ] Every existing company has exactly one `wfsvc_` identity after the migration; re-running it
      changes nothing.
- [ ] A new company created through onboarding gets one.
- [ ] `get_claims('wfsvc_<c>', '<c>')` returns `role: employee` and `<module>_view: ['<c>']` for
      every module, and empty arrays for create/update/delete.
- [ ] The identity appears in no people picker, employee list, assignee control, avatar, CSV export
      or `users_getUsers` result.
- [ ] The Stripe seat count for a company is unchanged by the migration.
- [ ] Settings → Billing → New Owner does not offer it.
- [ ] Deactivating it is refused.
- [ ] Deleting a subsidiary leaves no `wfsvc_` row behind.
- [ ] A workflow created with `ownerKind: "company"` can be test-run by a `workflows_update` holder
      and renders "Company" as its owner.

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A standing principal with company-wide read access | Medium | Read-only grants; no auth account, so it cannot be logged into; provisioning revoked from `anon`/`authenticated` |
| The identity leaks into a people surface not covered by the sweep | Low | No `employee` row makes the `employees` view the chokepoint; the four direct `user`/`userToCompany` readers are patched individually |
| `GET /rest/v1/user` with a company API key still returns the row | Low | Not fixed here: narrowing the `user` SELECT policy is an RBAC change and out of scope for this PR. The row exposes a synthetic name and a synthetic email and nothing else |
| A company-owned workflow restored into a **different** company points at the source company's identity, and runs with no permissions | Medium | Not reachable yet — nothing creates a company-owned workflow. Company restore must re-point `ownerKind = 'company'` workflows at the target company's identity, and that lands with the first consumer |

## 9. Open questions — resolved before writing

- **Should the identity be an employee?** No — D4.
- **Should it be able to write?** Not yet — D2. Automatic transfer of an orphaned automation to the
  company is the obvious next feature and needs this answered again, because those definitions do
  contain action nodes.
- **Should `system` be reused instead of a per-company identity?** No. `system` has no
  `userToCompany` and no `userPermission` row, so `get_claims` returns `NULL` for it in every
  company; it is a `createdBy` sentinel, not a principal. A per-company identity is also what keeps
  the grants scoped to one tenant.

## 10. Changelog

- 2026-08-28 — first draft, written against `origin/main` `aae45d601`.
