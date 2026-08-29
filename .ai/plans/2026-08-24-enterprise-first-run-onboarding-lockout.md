# Enterprise first-run onboarding lockout — implementation plan

**Spec:** .ai/specs/2026-08-24-enterprise-first-run-onboarding-lockout.md
**Research:** N/A (internal auth-flow bug, not an ERP-domain feature)
**Branch:** fix/enterprise-first-run-onboarding

## Progress
- [x] Task 1: Migration — `groups_for_user` returns an empty array, never NULL
      (`20260824205409_groups-for-user-empty-array.sql`; COALESCE over the aggregate,
      same signature/attributes. `generate:types` NOT needed — return type stays
      `TEXT[]`. Live psql assertion NOT run: no Carbon crbn dev DB is up in this
      worktree — port 54322 is an unrelated `byoc-console` Supabase, which lacks the
      `membership` table. Re-run the plan's psql check once `crbn up` provisions the
      Carbon dev DB.)
- [x] Task 2: ERP `/x` loader — guard now keys on `groups.error` (not `!groups.data`);
      returned `groups: groups.data ?? []`; `getUserGroups` normalizes `data ?? []`.
      Verified: `grep '!groups.data'` empty; `turbo typecheck --filter=erp` passes.
- [x] Task 3: MES — `throw` added to `destroyAuthSession`; no-company redirect →
      `path.to.setupRequired` (`/setup-required`, new `_public+/setup-required.tsx`
      linking to ERP onboarding). Verified: greps present; `turbo typecheck --filter=mes`
      passes.
- [ ] Task 4: Browser verification (`/test`) — enterprise first-run + regressions
      (BLOCKED: needs a running Carbon dev stack + a company-less confirmed user driven
      through the login door. The crbn stack is not up in this worktree.)

## Dependencies
- Tasks 1, 2, 3 are **independent** of each other (the RPC's TS type is `string[]`
  before and after — `RETURNS TEXT[]` is unchanged — so Task 2/3 don't need Task 1's
  `generate:types`).
- Task 4 depends on Tasks 1–3.

## Follow-ups (not in this plan)
- Spec AC "automated regression test" at the route-loader level needs an e2e /
  DB-integration harness that this repo does not have today (no Playwright config, no
  DB-hitting `*.test.ts`). Task 1 covers the RPC behavior with a SQL assertion and
  Task 4 covers the flow in the browser; a proper loader e2e is a separate infra task.

---

## Task 1: Migration — `groups_for_user` returns an empty array, never NULL

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{generated}_groups-for-user-empty-array.sql`
- Modify: `apps/erp/src/database.d.ts` / generated DB types — via `generate:types` (do not hand-edit)
- Copy from (precedent): `packages/database/supabase/migrations/20230123004632_groups.sql:293` (the current function body)

**Steps:**
1. Generate the migration file (never hand-pick a timestamp):
   ```bash
   pnpm db:migrate:new groups-for-user-empty-array
   ```
2. Put exactly this in the new file (same name / signature / `SECURITY DEFINER` /
   `search_path`; only the aggregate is wrapped in `COALESCE`):
   ```sql
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
3. Regenerate DB types (the always-after-migration step):
   ```bash
   pnpm run generate:types
   ```
4. Before finalizing, confirm no caller depends on the NULL return:
   ```bash
   grep -rn "groups_for_user" packages apps | grep -i "is null"
   # Expected: no matches (callers use `= ANY(groups_for_user(...))`, unaffected by NULL vs '{}')
   ```

**Verify:**
```bash
# Apply just this function to the local Supabase DB and check the empty case.
DBURL="$(grep -m1 '^SUPABASE_DB_URL' .env.local | cut -d= -f2- | tr -d '"')"; DBURL="${DBURL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
psql "$DBURL" -f "$(ls -t packages/database/supabase/migrations/*groups-for-user-empty-array.sql | head -1)"
psql "$DBURL" -At -c "SELECT groups_for_user('00000000-0000-0000-0000-000000000000') = '{}'::text[] AS ok"
# Expected: t
```
If the local DB isn't reachable at that URL, STOP and report — do not skip the check.

**Out of scope:** the `users_for_groups` function directly below it; any other RPC.

---

## Task 2: ERP `/x` loader — stop logging out no-company users; normalize groups

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/routes/x+/_layout.tsx` — the line-200 guard + the returned `groups`
- Modify: `apps/erp/app/modules/users/users.server.ts` (`getUserGroups`, ~line 728) — normalize to `[]`
- Copy from (precedent): the existing `requiresOnboarding` branch already in `x+/_layout.tsx:~252` (no change to it — it becomes reachable)

**Steps:**
1. In `apps/erp/app/routes/x+/_layout.tsx`, change the guard (currently line 200):
   ```ts
   // before
   if (!claims || user.error || !user.data || !groups.data) {
     throw await destroyAuthSession(request);
   }
   // after — empty groups is a valid pre-onboarding state; only a real RPC error logs out
   if (!claims || user.error || !user.data || groups.error) {
     throw await destroyAuthSession(request);
   }
   ```
2. Wherever `groups.data` is read afterward (the returned `data({ session: { groups: ... } })`),
   use `groups.data ?? []` so downstream always gets an array.
3. In `apps/erp/app/modules/users/users.server.ts` `getUserGroups`, normalize the RPC result
   so `data` is `[]` (not `null`) on an empty set — belt-and-suspenders with Task 1
   (e.g. return `{ data: data ?? [], error }`). Do not change the function signature.
4. Leave the `requiresOnboarding` branch (`!company?.name || (CarbonEdition === Edition.Cloud && !stripeCustomer)`) exactly as-is — it now handles company-less users.

**Verify:**
```bash
grep -n "!groups.data" apps/erp/app/routes/x+/_layout.tsx
# Expected: no matches
pnpm exec turbo run typecheck --filter=erp
# Expected: erp typecheck passes (no errors)
```

**Out of scope:** reordering the loader / moving the onboarding redirect before the
company-scoped `Promise.all` (deferred per spec Q2(a)); the multi-company picker and
single-company auto-enter branches (unchanged).

---

## Task 3: MES — fix missing `throw`; "complete setup in ERP" screen for no-company

**Depends on:** none
**Files:**
- Modify: `apps/mes/app/utils/path.ts` — add `setupRequired`
- Create: `apps/mes/app/routes/setup-required.tsx` — the message screen
- Modify: `apps/mes/app/routes/x+/_layout.tsx` — add `throw` (line ~122); redirect no-company to setup screen (line ~127)
- Copy from (precedent): `apps/mes/app/routes/_public+/login.tsx` (full-page VStack/Heading/Button layout with the logo block)

**Steps:**
1. `apps/mes/app/utils/path.ts`: add a `setupRequired: "/setup-required"` entry next to
   the existing `onboarding: \`${ERP_URL}/onboarding\`` (line 167). Keep `onboarding` as-is.
2. Create `apps/mes/app/routes/setup-required.tsx`: a full-page screen copied from the
   layout shape of `_public+/login.tsx` (the centered logo + `VStack` + `Heading` + `Button`).
   Copy: a `Heading` "Finish setting up your account", body text "Your account isn't part
   of a company yet. Complete onboarding in the Carbon ERP to continue.", and a `Button`
   whose `onClick` does `window.location.href = path.to.onboarding` (= `${ERP_URL}/onboarding`).
   No loader company/group requirement — this route must render for an authenticated
   user with no company. If MES's route conventions force this under an authed layout that
   itself requires a company, STOP and report (place it where a company-less authed user
   can see it).
3. `apps/mes/app/routes/x+/_layout.tsx`:
   - Line ~122: `await destroyAuthSession(request);` → `throw await destroyAuthSession(request);`
   - Line ~127: `throw redirect(path.to.accountSettings);` → `throw redirect(path.to.setupRequired);`
   - Leave line ~208 (`if (!companyPlan && CarbonEdition === Edition.Cloud) throw redirect(path.to.onboarding)`) unchanged.

**Verify:**
```bash
grep -n "throw await destroyAuthSession" apps/mes/app/routes/x+/_layout.tsx
# Expected: 1 match (the fixed line)
grep -n "setupRequired" apps/mes/app/utils/path.ts apps/mes/app/routes/x+/_layout.tsx
# Expected: matches in both files
pnpm exec turbo run typecheck --filter=mes
# Expected: mes typecheck passes (no errors)
```

**Out of scope:** hosting the onboarding wizard in MES; any change to ERP onboarding.

---

## Task 4: Browser verification (`/test`) — enterprise first-run + regressions

**Depends on:** Tasks 1, 2, 3
**Files:** none (verification)

**Steps:**
1. Run `/test` with a DB that has **no company** (mimics enterprise first-run — do NOT use a
   `crbn up` DB that ran the dev bootstrap, since it seeds a company and hides the bug).
   Create a confirmed auth user with a `public."user"` row (`active = true`) and no company
   (admin `createUser` + confirm), then drive it through the **login door** — magic-link or
   OAuth `/callback` → `/x` — NOT signup: an unknown-email signup routes to `/verify →
   /onboarding` and would mask the guard entirely (see spec "signup vs login"). Then:
   - Log in as that user → **assert redirect to `/onboarding`**, not `/login`.
   - Complete the onboarding wizard → assert a `company` + `userToCompany` + `employee` +
     `membership` row now exist for the user; assert `/x` loads.
2. Regression checks in the same run:
   - Existing single-company user → `/x` loads directly.
   - Existing multi-company user → company picker.
   - Force a `claims`/`user` failure (or a `groups_for_user` RPC error) → still logged out.
   - Company-less user on **MES** → sees the "complete setup in ERP" screen with a working
     link to `${ERP_URL}/onboarding` (no redirect loop into account settings).

**Verify:** all assertions in Step 1–2 pass (spec Acceptance Criteria #1–#6). AC #1
(`groups_for_user` returns `'{}'`) is already proven by Task 1's SQL check.

**Out of scope:** building a Playwright/e2e harness (see Follow-ups).
