# Remove the `"0"` Global-Company Permission Wildcard — implementation plan

Status: IMPLEMENTED 2026-08-18 (commit `0cbaf1390`, verified `ba340f2d9`).

**Spec:** .ai/specs/implemented/2026-08-16-remove-global-permission-wildcard.md
**Branch:** port-louis (or a dedicated `remove-permission-wildcard`)

## Progress
- [x] Task 1: Migration — expand residual `"0"` grants, then de-wildcard the 2 functions + re-sign `is_claims_admin` (applied `20260817030612`; all 6 verify checks pass; local seed had 0 residual `"0"`)
- [x] Task 2: Regenerate DB types (crbn regenerated on migrate; `is_claims_admin: { Args: { company: string } }`)
- [x] Task 3: Strip the 10 app-layer `"0"` reads + pass `companyId` to `is_claims_admin` + defensive strip on write (grep clean; both rpc calls pass company; typecheck auth/erp/jobs green)
- [x] Task 4: Verify — scoped typecheck (auth/erp/jobs/react) ✓; `@carbon/auth` tests 17 passed ✓; browser smoke ✓ (login + all modules render = no lockout; permission matrix renders; edited a permission → "Permissions updated" + persisted to DB as `[]`; defensive strip confirmed — no `"0"` reintroduced). Note found (OUT OF SCOPE, pre-existing): `is_claims_admin` checks the reversed key `update_users` instead of `users_update`; behavior-neutral to this change (empty array either way), passes in local dev via the non-authenticator ELSE branch.

## Dependencies
- Task 2 needs Task 1 (types regenerate from the new `is_claims_admin(text)` signature).
- Task 3 needs Task 2 (the `client.rpc("is_claims_admin", { company })` call must typecheck against the regenerated `Database` type).
- Task 4 is last.

> Whole change is authorization-core. If any assumption below turns out false
> (e.g. a residual `"0"` row whose expansion is ambiguous, or an unexpected SQL
> caller of `is_claims_admin`), **STOP and report — do not improvise.**

---

## Task 1: Migration — expand residual `"0"` grants, then de-wildcard the functions

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{ts}_remove-global-permission-wildcard.sql` (via the command below — never hand-pick the timestamp)
- Copy from (precedent): `packages/database/supabase/migrations/20241210140215_rls-performance.sql` (current `has_company_permission`), `packages/database/supabase/migrations/20260219162954_api-key-scopes-rate-limits.sql` (current `get_companies_with_employee_permission`), `packages/database/supabase/migrations/20230123004206_claims.sql` (current `is_claims_admin`)

**Steps:**
1. Create the file:
   ```bash
   pnpm db:migrate:new remove-global-permission-wildcard
   ```
2. Paste EXACTLY this SQL (order matters: data-expand first, then redefine, then reload — one transaction, atomic):
   ```sql
   -- NIST 800-171 3.1.5: remove the "0" global-company permission wildcard.
   -- Expand-then-drop: rewrite any residual "0" grant to explicit companies
   -- BEFORE the functions stop interpreting "0", so no one is locked out.

   -- 1a. userPermission.permissions (JSONB: "<module>_<action>" -> [companyId,...])
   --     Replace "0" in any array with the user's userToCompany companies (any role).
   DO $$
   DECLARE
     r RECORD;
     new_perms jsonb;
     k text;
     arr jsonb;
     companies text[];
   BEGIN
     FOR r IN
       SELECT id, permissions FROM public."userPermission"
       WHERE permissions::text LIKE '%"0"%'
     LOOP
       SELECT COALESCE(array_agg("companyId"::text), '{}')
       INTO companies
       FROM public."userToCompany" WHERE "userId" = r.id;

       new_perms := r.permissions;
       FOR k IN SELECT jsonb_object_keys(r.permissions) LOOP
         arr := r.permissions -> k;
         IF jsonb_typeof(arr) = 'array' AND (arr ? '0') THEN
           new_perms := jsonb_set(
             new_perms,
             ARRAY[k],
             (
               SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
               FROM (
                 SELECT e AS elem FROM jsonb_array_elements_text(arr) e WHERE e <> '0'
                 UNION
                 SELECT unnest(companies) AS elem
               ) s
             )
           );
         END IF;
       END LOOP;

       UPDATE public."userPermission" SET permissions = new_perms WHERE id = r.id;
     END LOOP;
   END $$;

   -- 1b. employeeTypePermission (TEXT[] columns): "0" -> the employee type's company.
   UPDATE public."employeeTypePermission" etp
   SET
     "create" = (SELECT array_agg(DISTINCT c) FROM unnest(array_replace(etp."create", '0', et."companyId")) c),
     "update" = (SELECT array_agg(DISTINCT c) FROM unnest(array_replace(etp."update", '0', et."companyId")) c),
     "view"   = (SELECT array_agg(DISTINCT c) FROM unnest(array_replace(etp."view",   '0', et."companyId")) c),
     "delete" = (SELECT array_agg(DISTINCT c) FROM unnest(array_replace(etp."delete", '0', et."companyId")) c)
   FROM public."employeeType" et
   WHERE et.id = etp."employeeTypeId"
     AND ('0' = ANY(etp."create") OR '0' = ANY(etp."update") OR '0' = ANY(etp."view") OR '0' = ANY(etp."delete"));

   -- 2. Redefine has_company_permission WITHOUT the "0" wildcard branch.
   --    (fork of 20241210140215; attributes preserved exactly.)
   CREATE OR REPLACE FUNCTION has_company_permission(claim text, company text) RETURNS "bool"
       LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
       AS $$
       DECLARE
         permission_value text[];
       BEGIN
         SELECT jsonb_to_text_array(coalesce(permissions->claim, '[]'))
         INTO permission_value
         FROM public."userPermission" WHERE id = (SELECT auth.uid()::text);
         IF permission_value IS NULL THEN
           return false;
         ELSIF company = ANY(permission_value::text[]) THEN
           return true;
         ELSE
           return false;
         END IF;
       END;
   $$;

   -- 3. Redefine get_companies_with_employee_permission WITHOUT the "0" expand block.
   --    (fork of 20260219162954; attributes preserved exactly.)
   CREATE OR REPLACE FUNCTION get_companies_with_employee_permission (permission text) RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
   SET search_path = public AS $$
   DECLARE
     permission_companies text[];
     api_key_company text;
     employee_companies text[];
     api_key_scopes JSONB;
   BEGIN
     api_key_company := get_company_id_from_api_key();

     IF api_key_company IS NOT NULL THEN
       api_key_scopes := get_api_key_scopes();
       IF api_key_scopes IS NULL OR api_key_scopes = '{}'::jsonb THEN
         RETURN '{}';
       END IF;
       IF (api_key_scopes ? permission)
          AND api_key_company = ANY(jsonb_to_text_array(api_key_scopes->permission)) THEN
         RETURN ARRAY[api_key_company];
       ELSE
         RETURN '{}';
       END IF;
     END IF;

     SELECT array_agg("companyId"::text)
     INTO employee_companies
     FROM "userToCompany"
     WHERE "userId" = auth.uid()::text AND "role" = 'employee';

     SELECT jsonb_to_text_array(COALESCE(permissions->permission, '[]'))
     INTO permission_companies
     FROM public."userPermission"
     WHERE id::text = auth.uid()::text;

     IF permission_companies IS NOT NULL AND employee_companies IS NOT NULL THEN
       SELECT array_agg(company)
       INTO permission_companies
       FROM unnest(permission_companies) company
       WHERE company = ANY(employee_companies);
     ELSE
       permission_companies := '{}';
     END IF;

     RETURN permission_companies;
   END;
   $$;

   -- 4. Re-sign is_claims_admin per-company (drop the no-arg global-admin version).
   DROP FUNCTION IF EXISTS is_claims_admin();
   CREATE OR REPLACE FUNCTION is_claims_admin(company text) RETURNS "bool"
     LANGUAGE "plpgsql"
     AS $$
     BEGIN
       IF session_user = 'authenticator' THEN
         IF extract(epoch from now()) > coalesce((current_setting('request.jwt.claims', true)::jsonb)->>'exp', '0')::numeric THEN
           return false; -- jwt expired
         END IF;
         IF has_company_permission('update_users', company) THEN
           return true;
         ELSE
           return false;
         END IF;
       ELSE -- not a user session (trigger etc.)
         return true;
       END IF;
     END;
   $$;

   -- 5. Reload PostgREST so the new is_claims_admin(text) signature is exposed.
   NOTIFY pgrst, 'reload schema';
   ```
3. Apply and confirm zero residual `"0"`:
   ```bash
   pnpm db:migrate
   ```

**Verify:**
```bash
# Requires the local stack up (crbn up). Both counts MUST be 0.
psql "$SUPABASE_DB_URL" -At -c "SELECT count(*) FROM \"userPermission\" WHERE permissions::text LIKE '%\"0\"%';"
# Expected: 0
psql "$SUPABASE_DB_URL" -At -c "SELECT count(*) FROM \"employeeTypePermission\" WHERE '0'=ANY(\"create\") OR '0'=ANY(\"update\") OR '0'=ANY(\"view\") OR '0'=ANY(\"delete\");"
# Expected: 0
# is_claims_admin now takes one arg; the no-arg form is gone.
psql "$SUPABASE_DB_URL" -At -c "SELECT count(*) FROM pg_proc WHERE proname='is_claims_admin' AND pronargs=1;"
# Expected: 1
psql "$SUPABASE_DB_URL" -At -c "SELECT count(*) FROM pg_proc WHERE proname='is_claims_admin' AND pronargs=0;"
# Expected: 0
```
If the stack is down, this task cannot be verified — do NOT mark it done; report "blocked on stack".

**Out of scope:** `get_claims`, `get_companies_with_employee_role` (no `"0"` — leave untouched); removing `has_company_permission` (keep it, only its wildcard branch is dropped).

---

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:** Modify (generated): `packages/database/src/types.ts`, `packages/database/supabase/functions/lib/types.ts`

**Steps:**
1. `pnpm run generate:types`
2. Confirm the `is_claims_admin` RPC type changed from `Args: never` to a `{ company: string }` arg.

**Verify:**
```bash
grep -n "is_claims_admin" packages/database/src/types.ts
# Expected: an entry whose Args include `company: string` (no longer `Args: never`)
```

**Out of scope:** hand-editing the generated types (never).

---

## Task 3: Strip the 10 app-layer `"0"` reads, pass `companyId` to `is_claims_admin`, reject `"0"` on write

**Depends on:** Task 2
**Files:**
- Modify: `packages/auth/src/services/auth.server.ts` — line ~364: delete the `permissionForCompany?.includes("0") ||` disjunct so only `?.includes(companyId)` remains.
- Modify: `apps/erp/app/modules/users/users.server.ts` —
  - `makeCompanyPermissionsFromClaims` (lines 1164,1169,1174,1179) and `makeCompanyPermissionsFromEmployeeType` (1279,1282,1285,1288): drop the `...includes("0") ||` disjunct at each of the 8 sites (keep `...includes(companyId)`).
  - `updatePermissions` (~1441): `client.rpc("is_claims_admin")` → `client.rpc("is_claims_admin", { company: companyId })` (companyId is in scope, ~1432).
  - Defensive strip: where `updatePermissions` builds the permission arrays before the service-role write (~1473–1556), filter `"0"` out of every array so it can never persist.
- Modify: `packages/jobs/src/inngest/functions/tasks/update-permissions.ts` — line 53: `client.rpc("is_claims_admin")` → `client.rpc("is_claims_admin", { company: companyId })` (companyId is a fn param, line 41/50); apply the same defensive `"0"` strip before its write.
- Modify: `apps/erp/app/hooks/usePermissions.tsx` — line ~29: drop the `...includes("0") ||` disjunct.
- Modify: `apps/erp/app/routes/api+/search.tsx` — line ~63: same.
- Modify: `apps/erp/app/routes/x+/workflow+/$id.test-run.tsx` — line ~192: `if (!granted.includes("0") && !granted.includes(gate.companyId))` → `if (!granted.includes(gate.companyId))`.
- Modify: `packages/jobs/src/workflows/engine/owner.ts` — line ~83: `return granted.includes("0") || granted.includes(companyId);` → `return granted.includes(companyId);`.

**Steps:**
1. Make each edit above. The pattern is uniform: remove the `.includes("0")` disjunct; the `companyId` match already exists beside it in every case. Do NOT alter the array-form branch in `auth.server.ts` (it already ignores `"0"`).
2. Update both `is_claims_admin` call sites to pass `{ company: companyId }`.
3. Add the defensive `"0"` filter in both `updatePermissions` writers (ERP + job) so the authoritative table can never hold `"0"` again.
4. If any of the 10 sites no longer matches the quoted code (line drift), grep for the pattern first:
   ```bash
   grep -rn 'includes("0")' packages apps --include="*.ts" --include="*.tsx"
   ```
   Every hit here must be removed. If a hit exists that is NOT in the list above, STOP and report (a new reader was added since recon).

**Verify:**
```bash
# No permission-wildcard reads remain anywhere.
grep -rn 'includes("0")' packages apps --include="*.ts" --include="*.tsx"
# Expected: no output
# Both is_claims_admin calls pass a company.
grep -rn 'rpc("is_claims_admin"' packages apps --include="*.ts" --include="*.tsx"
# Expected: both hits include `{ company: companyId }`
pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp --filter=@carbon/jobs
# Expected: PASS (no type errors)
```

**Out of scope:** the JWT-expiry `'0'` default (`claims.sql:14`), `lpad(...,'0')`, and the `"1"/"0"` MFA Redis flag (`mfa.server.ts:94`) — none are company sentinels; leave them.

---

## Task 4: Verify — scoped typecheck + permission smoke test

**Depends on:** Tasks 1–3
**Files:** none (verification only)

**Steps:**
1. Scoped typecheck (never whole-repo — it OOMs):
   ```bash
   pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp --filter=@carbon/jobs --filter=@carbon/react
   ```
2. Run the auth/users unit tests if present:
   ```bash
   pnpm --filter @carbon/auth test
   ```
3. Browser smoke (requires `crbn up`): via `/test` — log in as an admin, open **Settings → People → an employee → Permissions**, toggle a module permission for the active company, save, and confirm the change persists and the user's access reflects it (still scoped to the active company). Confirm a second company's data is NOT reachable by that user. This exercises `updatePermissions` → `is_claims_admin(company)` → `has_company_permission` end-to-end.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp --filter=@carbon/jobs --filter=@carbon/react
# Expected: all PASS
```
Plus the `/test` playbook passing (permission edit saves; cross-company access denied).

**Out of scope:** rewriting portal RLS off the deprecated `has_company_permission` (separate cleanup, noted in the spec).
