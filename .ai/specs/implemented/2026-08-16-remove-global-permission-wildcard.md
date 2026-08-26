# Remove the `"0"` Global-Company Permission Wildcard

Status: IMPLEMENTED 2026-08-18 (2.8 — commit `0cbaf1390`, verified in browser `ba340f2d9`)

Removes the `"0"` sentinel that grants a permission across ALL companies (present
and future) from Carbon's authorization layer. NIST 800-171 **3.1.5 (least
privilege)** hardening; item **2.8** of `.ai/plans/2026-08-15-nist-800-171-app-remediation.md`.
Decision confirmed by the user: "we don't use it."

## Problem

A permission array in `userPermission.permissions` (or an `employeeTypePermission`
column) containing `"0"` is interpreted as "granted for every company." It is a
broad-grant primitive the audit flagged under AC-6, and it auto-covers
future-created companies — exactly the over-broad grant an assessor dislikes.

## What actually interprets `"0"` (grounded recon 2026-08-16)

- **DB (2 functions):** `has_company_permission(claim, company)` (latest def
  `20241210140215_rls-performance.sql:12`, the `ELSIF '0' = ANY(...)` branch) and
  `get_companies_with_employee_permission(permission)` (latest def
  `20260219162954_api-key-scopes-rate-limits.sql:280`, the `IF ... '0'::text = ANY`
  expand-to-all-employee-companies block at ~line 328).
- **`get_claims(uid, company)` is transport, not interpreter** — returns the raw
  `userPermission.permissions` JSONB; no `"0"` logic. **No change.** Same for
  `get_companies_with_employee_role()`.
- **`is_claims_admin()`** (`20230123004206_claims.sql:3`, only def) gates
  `updatePermissions` via `has_company_permission('update_users','0')` = "must be a
  global user-admin." It takes **no company arg**.
- **App (10 sites):** `auth.server.ts:364`; six in `users.server.ts`
  (`makeCompanyPermissionsFromClaims` 1164/1169/1174/1179,
  `makeCompanyPermissionsFromEmployeeType` 1279/1282/1285/1288);
  `usePermissions.tsx:29`; `search.tsx:63`; workflow `$id.test-run.tsx:192`;
  `owner.ts:83`.
- **`is_claims_admin` callers (2, both with `companyId` in scope, none in SQL):**
  `apps/erp/app/modules/users/users.server.ts:1441` and
  `packages/jobs/src/inngest/functions/tasks/update-permissions.ts:53`.
- **No seed grants `"0"`.** After removal a residual `"0"` **fails closed** (grants
  nothing; no cross-tenant leak) — so the only risk is a lockout, prevented below.

## Resolved decisions

- [x] **D1 — Expand-then-drop (safe-by-construction).** One atomic migration:
  FIRST rewrite any residual `"0"` grant to explicit company IDs, THEN redefine the
  functions to stop interpreting `"0"`. No-op if truly unused; no lockout if not.
  (Live data unverifiable this session — stack down, MCP needs auth — so correctness
  must not depend on the "we don't use it" claim.)
- [x] **D2 — `is_claims_admin(company text)` (per-company, option B).**
  `DROP FUNCTION is_claims_admin()`; create `is_claims_admin(company text)` →
  `has_company_permission('update_users', company)`. Both call sites pass the
  `companyId` already in scope. It is the sole authZ before a service-role write, so
  tighten (per-company) rather than loosen (any-company). Rejected: `has_any_company_permission`.
- [x] **D3 — Expansion targets (behavior-preserving).**
  `userPermission.permissions`: each array containing `"0"` → the user's
  `userToCompany` company IDs (**any role** — covers both the employee-RLS path,
  which re-filters to employees, and the portal path). Empty membership → `"0"`
  simply removed (fails closed; the user had no real access anyway, since RLS
  requires a `userToCompany` row). `employeeTypePermission.{create,update,view,delete}`:
  `array_replace('0' → employeeType."companyId")` (each type belongs to one company).
- [x] **D4 — Reject `"0"` going forward.** The two `updatePermissions` writers strip
  `"0"` from every array before persisting, so the authoritative `userPermission`
  table can never hold `"0"` again (the UI never produces it; the only source is a
  hand-authored `employeeTypePermission` passed through `makePermissionsFromEmployeeType`).
- [x] **D5 — One migration, ordered, `NOTIFY pgrst`.** data-expand → redefine
  functions → `NOTIFY pgrst, 'reload schema'` (the new `is_claims_admin` signature
  must be reloaded, per the migrate-append lesson).

## Out of scope

- `get_claims`, `get_companies_with_employee_role` — no `"0"`; untouched.
- Removing the deprecated `has_company_permission` helper — still used by
  supplier/customer-portal RLS; only its `"0"` branch is dropped.
- Migrating portal RLS off the deprecated helper (separate cleanup).
