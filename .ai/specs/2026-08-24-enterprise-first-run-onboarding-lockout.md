# Enterprise first-run onboarding lockout

> Status: draft
> Author: Brad Barbin
> Date: 2026-08-24

## TLDR

On a fresh **enterprise / self-hosted** deployment the first user authenticates
successfully but is immediately bounced back to `/login` instead of reaching
onboarding, so they can never create the first company through the UI. The cause
is the `/x` shell loader: `groups_for_user()` returns `NULL` (not an empty array)
for a user with zero `membership` rows, and the loader treats `!groups.data` as an
auth failure and destroys the session — before the onboarding redirect a few lines
later can run. Fix: make `groups_for_user` return `'{}'`, drop `!groups.data` from
the ERP logout guard so the existing `requiresOnboarding` redirect fires, and give
MES a "finish setup in ERP" screen (plus a missing `throw`).

## Problem Statement

**Symptom.** Enterprise/self-hosted first user (a confirmed `auth.users` row + a
`public."user"` row, e.g. seeded or invited, with **no** `company` / `employee` /
`userToCompany` / `membership` rows) logs in via magic link, lands briefly, then is
redirected to `/login?redirectTo=/x`. Onboarding is never reached; the deployment is
unusable.

Observed chain: `/magic-link → /callback → POST /callback.data 202 (session set) →
GET /x.data 202 → /login.data?redirectTo=/x`.

**Root cause.** `apps/erp/app/routes/x+/_layout.tsx:200`:

```ts
if (!claims || user.error || !user.data || !groups.data) {
  throw await destroyAuthSession(request);
}
```

`groups.data` comes from `getUserGroups` → the `groups_for_user(uid)` RPC
(`packages/database/supabase/migrations/20230123004632_groups.sql:293`), which does
`SELECT array_agg("groupId") INTO retval FROM "groupsForUser"`. `array_agg` over an
**empty** set returns **`NULL`**, so a user with no memberships gets
`groups.data === null` → `!groups.data` is true → the loader destroys the session.
This guard runs **before** the onboarding branch (`x+/_layout.tsx:~252`):

```ts
const requiresOnboarding = !company?.name || (CarbonEdition === Edition.Cloud && !stripeCustomer);
if (requiresOnboarding) { throw redirect(path.to.onboarding.root); }
```

`membership` rows are only created by the trigger on `employee` insert, which only
runs during company provisioning (`seed-company`). No company ⇒ no membership ⇒
`groups_for_user` = NULL ⇒ logout, and onboarding is unreachable.

**Why onboarding is reachable at all — signup vs login.** The wizard lives at
`/onboarding` (`onboarding+/_layout.tsx`), a route whose loader calls
`requirePermissions(request, {})`. With an empty permission set that helper
**early-exits with no role/groups check** (`auth.server.ts:351`), so a
company-less authenticated user *can* load `/onboarding` — but only by landing
there directly. Nothing sends them there from `/x`: the sole `/x → /onboarding`
redirect is the `requiresOnboarding` branch above, which sits **after** the
line-200 logout guard and is therefore dead code for a zero-company user.
Onboarding is reached exactly once, through the **signup** path — `login.tsx`
routes an unknown email (non-Enterprise) to `sendVerificationCode` → `/verify`,
and `verify.tsx` redirects the freshly-created user to `path.to.onboarding.root`
(`verify.tsx:127`). **Login** — magic-link or OAuth `/callback` — always lands on
`/x` (`authenticatedRoot`) instead. So whether a new user sees the wizard or a
logout depends entirely on which door they came through, and the guard makes the
login door a dead end.

**Why it never reproduces in local dev.** Two reasons compound. First, `crbn up`
runs the dev bootstrap `packages/database/src/datasets/bootstrap.ts` ("Creates the
auth user, the company, and every piece of reference data…"), which calls
`seedCompanyReferenceData` to insert a company + `userToCompany` + `employee` (→
`membership` rows), so the *bootstrapped* dev user always has a company and passes
the guard. Second — and this is what makes a genuinely *fresh* local user reach
onboarding — local runs the **community** edition, where an unknown email is
allowed to sign up: it flows `login → /verify → /onboarding`, never touching `/x`.
So locally onboarding is reached through the signup door, which has no groups
guard.

Enterprise closes both doors. Signups are disabled — `login.tsx` rejects an
unknown email with "User record not found" (the `else if (Edition.Enterprise)`
arm), so the signup → onboarding path does not exist. The first user must be
**DB-seeded**, which makes them a *known, active* account, so login takes the
magic-link branch → `/callback` → `/x` → the groups guard → logout. There is no
login-side path to onboarding for an enterprise first user.

**Confirmed reproduction.** A seeded user with `auth.users.confirmed_at` set,
`public."user".active = true`, and **zero** `company` / `userToCompany` /
`employee` / `membership` rows. Being confirmed + active is a *necessary*
condition for the symptom: it is what lets the session mint and reach `/x`, where
the guard then bounces it. The sole failing clause is `!groups.data` — `!claims`
passes because `get_claims(userId, null)` returns a truthy `{"role": null}` merged
with the `{}` `userPermission` row the `create_public_user` trigger wrote.

Consequence: **the fix is app-side** on the `/x` guard (make the existing
`requiresOnboarding` redirect reachable), not "run the dev bootstrap in prod"
(which would skip the onboarding UX a real customer should see). The **regression
test must create a company-less user and drive it through the login path** — a
signup would route to `/verify` and mask the bug — never via the dev bootstrap.

## Proposed Solution

Two-part, defense-in-depth: correct the RPC (root cause) and stop the ERP loader
from treating "authenticated, no company/groups yet" as an auth failure. MES gets a
clear terminal screen rather than a loop.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where to fix the NULL groups (Q1) | **Fix the `groups_for_user` RPC** to `COALESCE(..., '{}')`, plus normalize `getUserGroups` to `data ?? []` as defense | A valid authenticated user with no memberships should yield `[]`, not NULL — the NULL is a genuine bug affecting every caller. RLS `= ANY(groups_for_user(...))` behaves identically for NULL vs `'{}'` (no match), so no policy changes. |
| ERP loader change shape (Q2) | **Minimal patch**: drop `\|\| !groups.data` from the line-200 logout guard (keep `!claims \|\| user.error \|\| !user.data`); the existing `requiresOnboarding` branch then redirects to `/onboarding` | `x+/_layout.tsx` is a hot, security-sensitive loader; smallest, lowest-risk diff. The extra company-scoped queries that run once with `companyId === undefined` are tolerated for v1 (they already run today; they return `{error}` rather than throw). A larger "resolve companies first, redirect early" restructure is deferred. |
| MES scope (Q3) | **Terminal "complete setup in ERP" screen** for a company-less MES user + fix the missing `throw` on its `destroyAuthSession`; onboarding stays ERP-only | MES doesn't host the onboarding wizard and gets its config from ERP; a company-less MES-first user is an unsupported edge, so a clear message beats a redirect loop into `accountSettings`. |
| Guard semantics for a real RPC failure | Log out on `groups.error` (genuine failure), not on empty `groups.data` | Preserves the "auth is broken → log out" signal without conflating it with the legitimate no-groups state. |
| Backward compatibility (heuristic 7) | `groups_for_user` is a shared `SECURITY DEFINER` RPC (STABLE surface) — change return value NULL→`'{}'` only | Semantically compatible; audited all callers (RLS `ANY`, the auth guard). No signature/behavior change beyond eliminating NULL. |

Heuristics 1–6 (new-table multi-tenancy, service shape, RLS coverage, permission
scoping, form pattern, module layout): **N/A** — this change adds no new tables,
services, forms, or routes.

## Data Model Changes

No schema/tables. One migration that `CREATE OR REPLACE`s the existing RPC so it
never returns NULL (new file — do not edit the historical migration):

```sql
-- packages/database/supabase/migrations/20260824000000_groups-for-user-empty-array.sql
CREATE OR REPLACE FUNCTION groups_for_user(uid text) RETURNS TEXT[]
  LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public AS $$
  DECLARE retval TEXT[];
  BEGIN
    WITH RECURSIVE "groupsForUser" AS (
      SELECT "groupId", "memberGroupId", "memberUserId" FROM "membership"
      WHERE "memberUserId" = uid::text
      UNION
      SELECT g1."groupId", g1."memberGroupId", g1."memberUserId" FROM "membership" g1
      INNER JOIN "groupsForUser" g2 ON g2."groupId" = g1."memberGroupId"
    )
    SELECT COALESCE(array_agg("groupId"), '{}') INTO retval FROM "groupsForUser";
    RETURN retval;
  END;
$$;
```

Compatibility: keep the same name, signature, `SECURITY DEFINER`, and
`search_path`. Grep confirms callers use `= ANY(groups_for_user(...))` (NULL and
`'{}'` both yield no match) — no explicit `IS NULL` checks to migrate.

## API / Service Changes

**ERP — `apps/erp/app/routes/x+/_layout.tsx`**
- Line ~200 guard: change
  `if (!claims || user.error || !user.data || !groups.data)` →
  `if (!claims || user.error || !user.data || groups.error)`.
  (Drops the `!groups.data` clause per Q2(a); switches to `groups.error` so a real
  RPC failure still logs out.)
- Downstream usage of `groups.data` (the returned `data({ session: { groups } })`):
  read `groups.data ?? []` so an empty result is a well-formed array.
- No other reordering; the existing `requiresOnboarding` branch (`!company?.name`)
  now redirects company-less users to `path.to.onboarding.root`.

**Shared — `getUserGroups` (`apps/erp/app/modules/users/users.server.ts`)**
- Normalize the RPC result so `data` is `[]` (not `null`) on an empty set —
  belt-and-suspenders with the migration.

**MES — `apps/mes/app/routes/x+/_layout.tsx`**
- Line ~122: `await destroyAuthSession(request)` → `throw await destroyAuthSession(request)`
  (the destroy is currently computed but never acted on).
- Line ~125: replace the company-less `throw redirect(path.to.accountSettings)` with a
  render of the new "complete setup in ERP" screen (below), so a company-less MES
  user gets a clear terminal state instead of a potential loop.

## UI Changes

- **MES**: a small terminal screen shown to an authenticated user with no company —
  "Your account isn't set up yet. Finish onboarding in the ERP app," with a link to
  the ERP onboarding URL (derived the same way MES derives the ERP URL today). No
  onboarding wizard in MES.
- **ERP**: none — the existing onboarding wizard is simply now reachable.

## Acceptance Criteria

- [ ] Calling `groups_for_user('<user-with-no-memberships>')` returns `'{}'`, not `NULL`.
- [ ] Enterprise deploy, first user (confirmed, `public."user"` row, **no** company):
      magic-link login lands on `/onboarding` (not `/login`), and completing the wizard
      provisions a `company` + `userToCompany` + `employee` + `membership` rows.
- [ ] After onboarding, that user's next login goes straight to `/x` with no logout.
- [ ] A user whose auth genuinely fails (no `claims`, `user` lookup error, or a
      `groups_for_user` RPC error) is still logged out.
- [ ] Existing single-company user still loads `/x`; existing multi-company user still
      hits the company picker.
- [ ] A company-less user on **MES** sees the "complete setup in ERP" screen (with a
      working link to ERP onboarding), never a redirect loop.
- [ ] Automated regression test creates a company-less confirmed user (not via the dev
      bootstrap) and asserts the `/x` loader redirects to `/onboarding`, not `/login`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Changing a shared `SECURITY DEFINER` RPC used in RLS | Med | Return value only (NULL→`'{}'`), semantically identical for `ANY(...)`; audit all callers; covered by acceptance test #1 |
| Loosening the `/x` logout guard could let a broken-auth user through | Med | Keep `!claims / user.error / !user.data / groups.error`; only the "empty groups" (valid pre-onboarding) case is allowed to proceed |
| Company-scoped queries run once with `companyId === undefined` (minimal-patch path) | Low | They already run today and return `{error}` (don't throw); onboarding redirect fires immediately after. Restructure deferred as follow-up |
| MES ERP-URL derivation wrong in some topologies | Low | Reuse the existing MES→ERP URL helper already used elsewhere in MES |

## Open Questions

> Resolved with the user before this spec was written (audit trail of the interview).

- [x] **Where to fix the NULL groups — shared RPC vs app-only?** — **Answer (a):** fix
      the `groups_for_user` RPC (`COALESCE(..., '{}')`), plus normalize `getUserGroups`
      as defense. The NULL is a real bug and RLS is unaffected.
- [x] **ERP loader: minimal patch or restructure?** — **Answer (a):** minimal patch —
      drop `!groups.data` from the guard (use `groups.error`); the existing
      `requiresOnboarding` branch handles the redirect. Restructure deferred.
- [x] **MES scope for a company-less user?** — **Answer (b):** terminal "complete setup
      in ERP" screen + fix the missing `throw`; onboarding stays ERP-only.

## Changelog

- 2026-08-24: Created (open questions resolved via interview before writing).
- 2026-08-24: Root cause validated against a live enterprise-shaped seed (confirmed +
  active user, zero company/membership rows; sole failing clause `!groups.data`).
  Expanded the reproduction analysis with the signup-vs-login routing distinction:
  onboarding is only ever reached via the signup door (`/verify → /onboarding`), which
  Enterprise disables, so a DB-seeded first user can only log in → `/x` → logout.
