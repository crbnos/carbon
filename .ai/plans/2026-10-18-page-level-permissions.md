# Page-Level Permissions — implementation plan

**Spec:** .ai/specs/2026-10-18-page-level-permissions.md
**Research:** .ai/research/page-level-permissions.md
**Closest sibling:** the permission editors today (`EmployeeTypeForm.ee.tsx`, `EmployeePermissionsForm.ee.tsx`, `BulkEditPermissionsForm.ee.tsx`, `ApiKeysForm.tsx`)
**Branch:** `claude/service-function-wrapping-13f04f`, every phase. Do not cut another branch.

## Progress

Phase 0 — fix this branch
- [x] Task 1: Replace the `"member"` permission with `"employee"`
- [x] Task 2: Restore `view` on lookups whose tables restrict reads

Phases 1 and 2 — grants, resolver, editors (one release)
- [x] Task 3: Add the access registry, levels and the TS resolver
- [x] Task 4: Create the `permission` table
- [x] Task 5: Add RLS rules for `permission`
- [x] Task 6: Resolve access from grants in the SQL helpers
- [x] Task 7: Convert today's permissions to grants
- [x] Task 8: Read claims and key scopes from grants in TS
- [x] Task 9: Write grants from every authoring path
- [x] Task 10: Build `AccessGrid` and the role editor
- [x] Task 11: Build the person Access tab and bulk overrides
- [x] Task 12: Build the API key grid
- [x] Task 13: Build the access view
- [x] Task 14: Update dev bootstrap, company seed and demo datasets
- [x] Task 14a: Replace the ERP auth entry points with `authorize`
- [x] Task 15: Rewrite the permissions docs and glossary
- [x] Task 16: Verify phases 1 and 2 in the browser

Phase 3 — every module to page keys (one deploy)
- [x] Task 17: Define the pages of all 14 modules in the registry
- [x] Task 18: Render RLS rules with page keys from the registry
- [x] Task 19: Move service function permissions to pages and levels
- [x] Task 20: Move ERP and MES route gates to pages and levels
- [x] Task 21: Move client permission checks to pages and levels
- [x] Task 22: Drive the sidebar and the nav from page views
- [x] Task 23: Move workflow event permissions and the MCP manifest to page keys
- [x] Task 24: Add the module-key conformance check
- [ ] Task 25: Verify every page in the browser

Phase 4 — cleanup
- [ ] Task 26: Drop the old permission storage

## Dependencies

- Task 2 needs Task 1.
- Phase 1 needs Phase 0 committed.
- Task 4 needs Task 3 (the `module` values). Tasks 5 and 6 need Task 4 and generated types.
- Task 7 needs Task 6. Task 8 needs Tasks 3 and 6.
- Task 9 needs Task 8. Tasks 10 to 13 need Task 9. Tasks 10 to 13 are independent of each other after Task 10 creates `AccessGrid`.
- Tasks 14 and 15 need Task 9. Task 14a needs no other task, but run it alone: it touches about 1,190 files. Task 16 needs Tasks 7 to 15 and 14a.
- Phase 3 needs Phases 1 and 2 committed and verified (Task 16). Task 17 comes first. Tasks 18 to 23 need Task 17 and are independent of each other, but Tasks 19 to 21 each touch many files: run them one at a time in one worktree. Task 24 needs Tasks 18 to 23. Task 25 needs Task 24.
- Task 26 needs Phase 3 released.

## Rules for every task

- Read `.ai/lessons.md`, `.claude/rules/module-files.md`, `.claude/rules/authz-manifest.md` and `.claude/rules/authentication-system.md` before the first task.
- Typecheck one package at a time: `pnpm exec turbo run typecheck --filter=<pkg> --concurrency=1`. The ERP package name is `erp`.
- If this worktree lacks `packages/documents/src/pdf/fonts.data.ts`, run `node packages/documents/scripts/generate-fonts.mjs` first.
- 🛑 Apply a migration with `pnpm db:migrate` only after the user says so in this session. Otherwise stop and ask.
- Commit each task through `/check-and-commit`. Never push without the user's approval.

---

## Task 1: Replace the `"member"` permission with `"employee"`

**Depends on:** none
**Files:**
- Modify: `packages/api/src/permissions.ts` — `Permissions` loses `"member"`, gains `"employee"`
- Modify: `packages/api/src/service-fn.server.ts` — the user actor carries `role`; `allows` handles `"employee"`
- Modify: `packages/api/src/service-fn.server.test.ts` — cases for `"employee"`
- Modify: `packages/api/src/carbon.server.ts` — `CallerAuth` includes `role`
- Modify: `packages/auth/src/services/auth.server.ts` — `requirePermissions` returns `role`
- Modify: `apps/erp/app/modules/service-context.server.ts` — `Caller` and `serviceContext` pass `role`
- Modify: `apps/erp/app/routes/api+/v1+/lib/authenticate.server.ts` — the OAuth and key contexts pass `role`
- Modify: `apps/erp/app/routes/api+/v1+/lib/service-fn.server.ts` — `contextFromAuthed` passes `role`
- Modify: `packages/jobs/src/workflows/engine/owner.ts` and its test — `readOwnerPermissions` refuses an owner who is not an employee
- Modify: every `apps/erp/app/modules/*/*.server.ts` with `permission: "member"`
- Modify: `scripts/lib/service-fn-metadata.ts`, `packages/checks/src/conformance/service-fn-file.ts` and its test, `apps/erp/test/mcp-tool-permissions.test.ts`, `apps/erp/test/database/service-fn-transaction.test.ts`
- Modify: `.claude/rules/module-files.md`, `.claude/rules/conventions-services.md`, `.claude/rules/mcp-tools-reference.md`, `packages/api/AGENTS.md`

**Steps:**
1. In `permissions.ts`, change `Permissions` to `RequiredPermissions | "system" | "employee"`.
2. Rewrite its doc comment: `"employee"` admits an employee of the company or an API key of the company.
3. In `service-fn.server.ts`, add `role: "employee" | "customer" | "supplier" | null` to the `user` actor type.
4. In `allows`, return `actor.type === "apiKey" || actor.role === "employee"` when `required === "employee"`.
5. Keep the company check: for `"employee"`, also require `hasPermissions(claims, companyId, {})`.
6. Add `role` to the object `requirePermissions` returns. Read it from the claims it already loads.
7. Add `role` to `CallerAuth`, `Caller` and `contextFor`, and pass it to the user actor.
8. In `contextFromAuthed`, pass `role: null` for an API key and `"employee"` for OAuth and workflow calls.
9. OAuth already refuses a non-employee (`oauthContext`). Make `readOwnerPermissions` return null when the owner's role is not `employee`.
10. Replace `permission: "member"` with `permission: "employee"` in every module server file (`sed`).
11. In `service-fn-metadata.ts`, read the string literal `"employee"` where it reads `"member"` today.
12. Update the `service-fn-file` message and test: `permission: {}` must be written `"employee"`.
13. Update the four docs files: replace `"member"` with `"employee"` and its new meaning.
14. Add a test: a user actor with `role: "customer"` gets `forbidden` from an `"employee"` function.
15. Run `pnpm run generate:mcp`.
16. If a route with `allowPortalAccounts: true` calls an `"employee"` service function, STOP and report. Do not improvise.

**Verify:**
```bash
grep -rn 'permission: "member"' apps/erp/app/modules | wc -l
# Expected: 0
pnpm --filter @carbon/api test
# Expected: all tests pass, including the new customer-role case
pnpm --filter @carbon/checks test
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
git diff --stat apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json
# Expected: no change (the published permission shape stays "membership")
```

**Out of scope:** the RLS `"member"` actor in `packages/database/src/authz/rules.ts`. It is a different thing and stays.

## Task 2: Restore `view` on lookups whose tables restrict reads

**Depends on:** Task 1
**Files:**
- Create: `scripts/.tmp/lookup-read-class.ts` (delete after the task)
- Modify: the module server files whose lookups go back to `view`
- Modify: the loaders that call those lookups
- Modify: `packages/checks/src/conformance/baseline.json`

**Steps:**
1. List the 138 lookups that commit `aa251d5c92` moved to `"member"`: `git show aa251d5c92 -- 'apps/erp/app/modules/*/*.server.ts'`.
2. Record each lookup's old permission from the `-` lines of that diff.
3. Write `lookup-read-class.ts` with ts-morph. For each lookup, follow `service.<fn>` into `<module>.service.ts`.
4. Collect the tables the building block reads: `.from("x")`, `.selectFrom("x")` and `.rpc("x")`.
5. For each table, read its rule in `packages/database/src/authz/manifest.ts`.
6. Class "employee": `company(m)` with no `read:` key, or a `select` built with `"employee"`.
7. Class "restricted": any other rule, any view, and any `.rpc` call.
8. Print one line per lookup: name, tables, class.
9. If every table is "employee", keep `permission: "employee"`.
10. Otherwise restore the old `{ view: "<module>" }` permission.
11. For each restored lookup, find loaders that call `api.<module>.<fn>` with no `view: "<module>"` in `requirePermissions`.
12. Move those loader calls back to the direct building block call, as before commit `8506748bdc`.
13. Run `pnpm run generate:mcp`.
14. Add the direct calls to the `loader-reads-through-api` baseline with a reason in the commit message.

**Verify:**
```bash
pnpm exec tsx scripts/.tmp/lookup-read-class.ts | awk '{print $NF}' | sort | uniq -c
# Expected: two lines, "employee" and "restricted", with counts that add up to 138
pnpm --filter @carbon/checks test
# Expected: all tests pass (no new loader-reads-through-api finding)
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
```

**Out of scope:** the 43 functions that were `{}` before this branch. They keep `"employee"`.

## Task 3: Add the access registry, levels and the TS resolver

**Depends on:** Phase 0 committed
**Files:**
- Create: `packages/database/src/access/levels.ts`
- Create: `packages/database/src/access/registry.ts`
- Create: `packages/database/src/access/resolve.ts`
- Create: `packages/database/src/access/cases.json`
- Create: `packages/database/src/access/resolve.test.ts`
- Modify: `packages/database/package.json` — export `"./access"`

**Steps:**
1. In `levels.ts`, export `LEVELS = ["None", "View", "Create", "Edit", "Full"] as const` and type `Level`.
2. Export `ACTION_LEVEL = { view: "View", create: "Create", update: "Edit", delete: "Full" }`.
3. Export `levelHolds(level, action)`: true when `LEVELS.indexOf(level) >= LEVELS.indexOf(ACTION_LEVEL[action])`.
4. Export `roundUp(flags)`: the lowest level whose actions include every flag.
5. In `registry.ts`, export `type Page = { id; label; maxLevel; tables; where?; children?; readers?; paths }`.
6. Export `PAGES`: one page per permission module, `id` = the module key, `maxLevel: "Full"`.
7. Use these ids: accounting, documents, inventory, invoicing, parts, people, production, purchasing, quality, resources, sales, settings, users, workflows, printing.
8. Export `type PageId = (typeof PAGES)[number]["id"]` and `type PermissionKey = \`${PageId}_${Action}\``.
9. Export `REGISTRY_HASH`: an FNV-1a hash of `JSON.stringify(PAGES)` in hex. No `node:crypto`: the file runs in the browser.
10. Export `moduleOf(pageId)`: the text before the first `.`, or the whole id.
11. Export `clampLevel(pageId, level)`: at most the page's `maxLevel`. Grant writers call it; the resolver does not.
12. In `resolve.ts`, export `type Grant = { subject: "person" | "role" | "key"; module: string; page: string | null; level: Level }`.
13. Export `resolveLevel(grants, pageId, { admin })`. Admin returns `"Full"`.
14. Otherwise take the first match: person page, person module, role page, role module, key page, key module. Else `"None"`.
15. Export `type RawClaims = { role; admin; grants: Grant[]; portal: Record<string, string[]> }`.
16. Export `expandClaims(raw, companyId)`: for every page in `PAGES`, resolve its level.
17. Return `{ [pageId]: { view, create, update, delete } }`, each a `[companyId]` array or `[]`.
18. Merge `raw.portal` keys into the result with the existing `<feature>_<action>` parsing.
19. Export `holds(expanded, key, companyId)`: the key's page holds the action for the company.
20. Export `holdsAny(expanded, module, action, companyId)`: any page of the module holds it.
21. In `cases.json`, write at least 20 cases: `{ grants, admin, pageId, expected }`.
22. Cover every precedence step, Admin, None overrides and a key's own grants.
23. In `resolve.test.ts`, run every case against `resolveLevel` and test `roundUp`, `clampLevel`, `holds` and `holdsAny`.

**Verify:**
```bash
pnpm --filter @carbon/database test -- access
# Expected: every resolve.test.ts case passes
pnpm exec turbo run typecheck --filter=@carbon/database --concurrency=1
# Expected: no "error TS" lines outside docs/content
```

**Out of scope:** any page below module grain. Task 17 adds them.

## Task 4: Create the `permission` table

**Depends on:** Task 3
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_permission.sql` (via `pnpm db:migrate:new permission`)

**Steps:**
1. Run `pnpm db:migrate:new permission`.
2. Copy the `permissionLevel` and `permission` SQL from the spec's Data Model section.
3. Add foreign keys: `employeeTypeId` → `employeeType("id")`, `userId` → `user("id")`, `apiKeyId` → `apiKey("id")`, all `ON DELETE CASCADE`.
4. Check the primary keys of `employeeType` and `apiKey` in the newest migration that touches each.
5. If a parent's key is composite, make the foreign key composite with `companyId`.
6. Add indexes on `companyId` and on `createdBy` for `permission`.
7. Guard every statement: `CREATE TYPE` inside a `DO` block that checks `pg_type`, `CREATE TABLE IF NOT EXISTS`.
8. Do not write RLS policies in the migration.
9. STOP and ask the user to run `pnpm db:migrate`.
10. Run `pnpm run generate:types` if `db:migrate` did not regenerate them.

**Verify:**
```bash
grep -n "      permission: {" packages/database/src/types.ts
# Expected: one match
pnpm db:check:backups
# Expected: success (a new table needs no TABLE_RENAMES entry)
```

**Out of scope:** dropping `employeeTypePermission`. Task 26 does that.

## Task 5: Add RLS rules for `permission`

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/src/authz/manifest.ts`
- Create: the generated migration from `pnpm --filter @carbon/database authz migration permission-rules`

**Steps:**
1. Add `permission` with `policies({...})`. Copy the shape of the `employeeTypePermission` and `apiKey` rules.
2. SELECT, INSERT, UPDATE and DELETE: `or(and(isNull("apiKeyId"), <users rule>), and(isNotNull("apiKeyId"), <settings rule>))`.
3. `<users rule>` is `inCompany("companyId", "users_update")`.
4. `<settings rule>` for SELECT is `inCompany("companyId", "settings_view")`; for writes, `settings_create`, `settings_update` and `settings_delete`.
5. Add an UPDATE `check` that pins `companyId`, as `authz-manifest.md` requires.
6. Run `pnpm --filter @carbon/database authz migration permission-rules`.
7. STOP and ask the user to run `pnpm db:migrate`.

**Verify:**
```bash
pnpm --filter @carbon/database test -- migration
# Expected: migration.test.ts passes
```

**Out of scope:** page keys in these rules. Task 18 changes them.

## Task 6: Resolve access from grants in the SQL helpers

**Depends on:** Task 4
**Files:**
- Create: `packages/database/src/authz/helpers/util.access_level.sql`
- Modify: `packages/database/src/authz/helpers/get_companies_with_employee_permission.sql`
- Modify: `packages/database/src/authz/helpers/get_claims.sql`
- Modify: `packages/database/src/authz/helpers/get_api_key_scopes.sql`
- Create: `packages/database/supabase/tests/access-resolver.test.sql`
- Create: the generated migration from `pnpm --filter @carbon/database authz migration access-resolver`
- Modify: the nine tests in `packages/database/supabase/tests/` that seed `userPermission` — seed `permission` rows

**Steps:**
1. Write `util.access_level(p_user text, p_api_key text, p_company text, p_page text) RETURNS "permissionLevel"`, `STABLE SECURITY DEFINER`. Put it in `util`: the API has no `USAGE` there, so no caller can read another user's level.
2. Return `'Full'` when the user's employee type in the company has `systemType = 'Admin'`.
3. Otherwise return the first grant in the spec's precedence order, else `'None'`.
4. Derive the module with `split_part(p_page, '.', 1)` and compare to `lower("module"::text)`.
5. Rewrite `get_companies_with_employee_permission(permission)`. Keep its signature.
6. Split `permission` into page and action with `regexp_match(permission, '^(.*)_(view|create|update|delete)$')`.
7. For a key: read the key's id from the `carbon-key` header, as `get_api_key_scopes` does.
8. Return the key's company when `access_level(NULL, key, company, page)` reaches the action's level.
9. For a user: return every company where the user is an employee and `access_level` reaches the action's level.
10. Rewrite `get_claims(uid, company)`. Keep the caller check at its top.
11. Return `{ role, admin, grants: [{ subject, module, page, level }], portal }`. `portal` holds the `userPermission` keys that name the company, for a customer or supplier account only. An employee's old keys would undo a None override.
12. Rewrite `get_api_key_scopes()` to return the key's grants in the same `grants` shape.
13. Write no hand-written migration. The function is new, and `no-authz-ddl-in-migrations` refuses a `DROP FUNCTION` of a managed helper.
14. Run `pnpm --filter @carbon/database authz migration access-resolver`.
15. Write `access-resolver.test.sql` in the style of `authz-fixes.test.sql`, inside `BEGIN … ROLLBACK`.
16. Load every case of `packages/database/src/access/cases.json` as fixtures and assert `access_level` matches.
17. Assert `get_companies_with_employee_permission` for one role grant, one override and one key.
17a. In the nine tests that insert `userPermission` rows, insert person grants instead. Use the round-up level of each module's keys.
18. STOP and ask the user to run `pnpm db:migrate`.

**Verify:**
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/access-resolver.test.sql
# Expected: exits 0 and prints no ERROR
pnpm --filter @carbon/database test -- migration
# Expected: migration.test.ts passes
```

**Out of scope:** the portal helpers `get_customer_ids_with_customer_permission` and `get_supplier_ids_with_supplier_permission`. They keep reading `userPermission`.

## Task 7: Convert today's permissions to grants

**Depends on:** Task 6
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_convert-permissions-to-grants.sql`
- Create: `packages/database/supabase/tests/access-migration.test.sql`

**Steps:**
1. Run `pnpm db:migrate:new convert-permissions-to-grants`.
2. Write a temporary SQL function `pg_temp.round_up(v bool, c bool, u bool, d bool) RETURNS "permissionLevel"`.
3. It returns the lowest level whose actions include every true flag, or `'None'`.
4. For each `employeeTypePermission` row of a non-Admin type, insert one module grant on the role.
5. A flag is set when its column names the role's company: `"companyId" = ANY(view)`. RLS never honored the retired `"0"`, so the conversion does not either.
6. For each employee (`userToCompany` role `employee`), compute the module flags from `userPermission`.
7. Compare them to the role's flags. For each module that differs, insert a person module grant.
8. For each `apiKey`, read `scopes` per module and insert a key module grant.
9. Set each inserted row's `convertedFrom` to its old flags, for example `{view,update}`.
10. Use `createdBy` = `COALESCE("companyGroup"."ownerId", 'system')` for the grant's company.
11. Make the migration idempotent: skip a subject and module that already has a grant.
12. Write `access-migration.test.sql`: fixtures for view+update, delete only, all four, none, and a key.
13. Assert the levels Edit, Full, Full, no row, and the key's level, and each `convertedFrom`.
14. STOP and ask the user to run `pnpm db:migrate`.

**Verify:**
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/access-migration.test.sql
# Expected: exits 0 and prints no ERROR
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -c 'SELECT count(*) FROM "permission" WHERE "convertedFrom" IS NOT NULL'
# Expected: one number; report it to the user
```

**Out of scope:** dropping the old columns and tables. Task 26 does that.

## Task 8: Read claims and key scopes from grants in TS

**Depends on:** Tasks 3 and 6
**Files:**
- Modify: `packages/auth/src/services/users.ts` — `getPermissionCacheKey` includes `REGISTRY_HASH`; `makePermissionsFromClaims` calls `expandClaims`; `hasPermission` calls `holds`
- Modify: `packages/auth/src/services/users.server.ts` — `getUserClaims` reads the new `get_claims` shape
- Modify: `packages/auth/src/services/auth.server.ts` — the permission and scope loops call `holds`
- Modify: `packages/auth/src/services/api-key.server.ts` — `getApiKeyRecord` reads grants and expands them
- Modify: `packages/api/src/permissions.ts` — `permissionsFromClaims` calls `expandClaims`; `hasPermissions` calls `holds`
- Modify: `packages/ee/src/onshape/panel/session.server.ts` — calls `holds`
- Modify: `apps/erp/app/modules/shared/shared.service.ts` — `authorizePostingCaller` and `authorizeApiKey` read grants
- Modify: `apps/erp/app/routes/api+/v1+/lib/authenticate.server.ts` — scopes from the expanded record
- Modify: the tests next to each file

**Steps:**
1. Change `getPermissionCacheKey(userId)` to return `` `permissions:${REGISTRY_HASH}:${userId}` ``.
2. In `getUserClaims`, call `get_claims` and pass the result to `expandClaims` for the company.
3. Keep the output shape `{ role, permissions }` that `requirePermissions` and the root loader read.
4. In `getApiKeyRecord`, select the key's rows from `permission` and expand them into `scopes`.
5. Keep the 30-second key cache.
6. Replace the hand-written loops in `requirePermissions`, `hasPermission`, `hasPermissions` and the Onshape check with `holds`.
7. In `authorizePostingCaller`, expand the `get_claims` result before `holds`.
8. In `authorizeApiKey`, read the key's grants, expand them, then `holds`.
9. Delete the code each replaced loop leaves unused.
10. If a caller reads raw `<module>_<action>` keys from claims in a way `expandClaims` cannot serve, STOP and report.

**Verify:**
```bash
pnpm --filter @carbon/auth test && pnpm --filter @carbon/api test && pnpm --filter @carbon/database test
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/auth --concurrency=1
# Expected: no "error TS" lines outside docs/content
pnpm exec turbo run typecheck --filter=@carbon/ee --concurrency=1
# Expected: no "error TS" lines outside docs/content
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
```

**Out of scope:** the portal key typo `documents_udpate`. The planned portal-roles spec fixes it.

## Task 9: Write grants from every authoring path

**Depends on:** Task 8
**Files:**
- Modify: `packages/ee/src/permissions.server.ts` — `upsertEmployeeTypePermissions`, `updatePermissions`, `updateEmployee` write `permission`
- Modify: `packages/jobs/src/inngest/functions/tasks/update-permissions.ts` — bulk overrides
- Modify: `apps/erp/app/modules/users/users.service.ts` — `createEmployeeAccount`, `convertConsoleOperatorToUser` and the invite stop copying permissions
- Modify: `apps/erp/app/modules/users/users.server.ts` — new `upsertAccessGrants`, `deleteAccessGrant`
- Modify: `apps/erp/app/modules/users/users.models.ts` — `permissionsValidator`
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — `createApiKey`, `updateApiKey` write key grants
- Modify: `packages/auth/src/services/auth-events.server.ts` — new `logRoleAccessChange`

**Steps:**
1. Add `permissionsValidator`: `{ subjectType: "role" | "person" | "key", subjectId, grants: [{ module, page, level }] }`. A top-level `subjectType` lets the permission be a keyed rule.
2. Validate `page` against `PAGES` and clamp `level` to the page's `maxLevel`.
3. Add `upsertAccessGrants` in `users.server.ts`. Permission: `{ update: "users" }` for roles and people.
4. The writer is `replaceGrants` in `@carbon/database/access-write` (Kysely, one transaction): `@carbon/ee` cannot import the ERP. `users.service.ts` `saveAccessGrants` routes to `@carbon/ee`'s `replaceAccessGrants` (roles, people) or `replaceApiKeyGrants` (keys).
5. A `level` of `null` in the input means "no grant" (inherit). `"None"` is a stored grant.
6. The save writes `convertedFrom = NULL` on every row of the subject.
7. Rewrite the three `@carbon/ee` writers to call the new building block. Keep `requireEntitlement("PERMISSIONS")` first.
8. After a role edit, read every employee with that role and delete each one's claims cache key.
9. After an override edit, delete that person's claims cache key.
10. Add `logRoleAccessChange({ actor, employeeTypeId, companyId, changes: [{ module, page, from, to }], affected })`.
11. Call it from the role writer with the count of employees with that role.
12. Keep `logPermissionChange` for overrides, with the person's expanded claims before and after.
13. Make the bulk job write person overrides for each selected person, in one transaction per person.
14. Remove the permission copy from `createEmployeeAccount`, `convertConsoleOperatorToUser` and `insertInvite`.
15. Keep the employee type assignment: access now comes from the role.
16. In `createApiKey` and `updateApiKey`, write the key's grants through `replaceApiKeyGrants`. Refuse unless the caller holds `settings_create` / `settings_update`: the grant write skips the RLS that guards `apiKey`.
17. Keep `accounting_delete` opt-in: round-up makes Accounting Full only when `accounting_delete` was checked. The grid in Task 12 keeps it out of select-all.

**Verify:**
```bash
pnpm --filter erp test -- users
# Expected: all users tests pass
pnpm --filter @carbon/ee test
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
```

**Out of scope:** the editor UI. Tasks 10 to 12 build it.

## Task 10: Build `AccessGrid` and the role editor

**Depends on:** Task 9
**Files:**
- Create: `apps/erp/app/modules/users/ui/components/AccessGrid.ee.tsx`
- Modify: `apps/erp/app/modules/users/ui/EmployeeTypes/EmployeeTypeForm.ee.tsx` — uses `AccessGrid`
- Modify: `apps/erp/app/routes/x+/users+/employee-types.$employeeTypeId.tsx` — loader reads role grants; action calls `upsertAccessGrants`
- Modify: `apps/erp/app/routes/x+/users+/employee-types.new.tsx`
- Copy from (precedent): `apps/erp/app/modules/users/ui/EmployeeTypes/EmployeeTypeForm.ee.tsx` and `apps/erp/app/modules/users/ui/Employees/EmployeePermissionsForm.ee.tsx`

**Steps:**
1. Read the two precedent forms. Keep their layout, card and `ValidatedForm` usage.
2. `AccessGrid` props: `pages` (from `PAGES`), `value` (grants), `inherited` (levels to show in grey), `onChange`.
3. Render one row per module: label, a level `Select` with "Inherit", and an "N of M pages" count.
4. Make each module row expandable. Each page row has a level `Select` capped at its `maxLevel`.
5. A page row with no grant shows the module level in grey.
6. Use `Select` and `Table` from `@carbon/react`. Grep `packages/react/src/` before writing anything new.
7. Serialize the grid into one hidden `grants` field as JSON for the validator.
8. In the route loader, read the role's grants through `api.users.getAccessGrants`.
9. In the action, call `api.users.updateEmployeeType` (or `createEmployeeType`) with `grants`: one call saves the name and the grants, through `saveAccessGrants`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
```
Browser: open Users → Employee Types → a type. Set Inventory to View and Sales to Full. Save and reload. Expected: both levels show. Page rows (Receipts) need Task 17.

**Out of scope:** pages below module grain; Task 17 adds them and the grid shows them with no change.

**As built:** access is set per module: each module row has a four-step level meter (View, Create, Update, Delete); a module with pages expands to them. The person and role dialogs were redesigned around it (header, From column, Reset all overrides, Admin notice, conversion marks).

## Task 11: Build the person Access tab and bulk overrides

**Depends on:** Task 10
**Files:**
- Modify: `apps/erp/app/modules/users/ui/Employees/EmployeePermissionsForm.ee.tsx` — uses `AccessGrid` with the role's levels as `inherited`
- Modify: `apps/erp/app/routes/x+/users+/employees.$employeeId.tsx`
- Modify: `apps/erp/app/modules/users/ui/Employees/BulkEditPermissionsForm.ee.tsx`
- Modify: `apps/erp/app/routes/x+/users+/bulk-edit-permissions.tsx`
- Copy from (precedent): the same two files, and `AccessGrid` from Task 10

**Steps:**
1. Replace the checkbox matrix with `AccessGrid`. Pass the role's resolved levels as `inherited`.
2. Label the select's empty choice "Role default".
3. Keep the employee type picker. Changing the type changes `inherited` only; overrides stay.
4. Remove the "replace or preserve" prompt; the role is no longer copied.
5. In the bulk form, apply the chosen overrides to every selected person. Its empty choice is "No change"; Add only raises a level, Update sets it. The job's payload carries `grants`; a replayed checkbox payload is rounded up.
6. Read every role's grants in one query (`getRoleGrants`) for the type picker, not one per type.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
```
Browser: give one person an Inventory override of None. Expected: that person loses Inventory on the next request; the role's other people keep it. A page override (Receipts) needs Task 17.

**Out of scope:** the access view. Task 13 builds it.

## Task 12: Build the API key grid

**Depends on:** Task 10
**Files:**
- Modify: `apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysForm.tsx`
- Modify: `apps/erp/app/routes/x+/settings+/api-keys.new.tsx`, `apps/erp/app/routes/x+/settings+/api-keys.$id.tsx`
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `apiKeyValidator` takes `grants`; remove `apiKeyPermissionModules` use from the form
- Copy from (precedent): `ApiKeysForm.tsx` and `AccessGrid.ee.tsx`

**Steps:**
1. Replace the scope checkbox table with `AccessGrid`.
2. Make "Select all" set Edit on Accounting pages and Full elsewhere.
3. Allow Full on an Accounting page only by choosing it on that row.
4. Send the grants to `createApiKey` and `updateApiKey`. The key list embeds each key's grants (`permission(module, page, level)`), which the edit form and the table's count read; `apiKey.scopes` is no longer written.
5. Delete `PermissionMatrix` and `usePermissionMatrix`: nothing else uses them.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
```
Browser: create a key with Inventory View. Call `POST /api/v1/inventory/getReceipts` with it. Expected: 200. Call a receipt create. Expected: 403. A page grant (Receipts) needs Task 17.

**Out of scope:** API keys that take a role (a planned extension).

## Task 13: Build the access view

**Depends on:** Task 10
**Files:**
- Modify: `apps/erp/app/modules/users/users.server.ts` — `getEffectiveAccess`, `getPageAccessHolders`
- Modify: `apps/erp/app/modules/users/users.service.ts` — their building blocks
- Create: `apps/erp/app/modules/users/ui/Employees/EffectiveAccess.ee.tsx`
- Modify: `apps/erp/app/routes/x+/users+/employees.$employeeId.tsx`, `apps/erp/app/routes/x+/users+/employee-types.$employeeTypeId.tsx`
- Copy from (precedent): `AccessGrid.ee.tsx` in read-only mode

**Steps:**
1. `getEffectiveAccess({ userId })`: for each page, `resolveLevel` and the source of the winning grant.
2. Permission: `{ view: "users" }`.
3. `getPageAccessHolders({ page, level })`: every employee and key whose level reaches `level`.
4. Compute both in one query of the company's grants and employees, then resolve in TS. No query per person.
5. Show `EffectiveAccess` on the person page: page, level, source.
6. Show a "Who has access" panel on the role page: a page and a level, the people and keys that reach it (`api+/users.access-holders`, cached). API keys need the settings view.
7. Show "Converted access that grew": every row whose `level` holds an action missing from `convertedFrom`.
8. Compute that list in TS with `actionsGained(level, convertedFrom)`. Show it on the role page for the role's rows and as a badge on the person page.
9. The pure core (`winningGrant`, `accessHolders`, `actionsGained`) lives in `@carbon/database/access` and is tested there; the building blocks only read and map.

**Verify:**
```bash
pnpm --filter erp test -- users
# Expected: all users tests pass
pnpm --filter @carbon/database test -- access
# Expected: the winningGrant, accessHolders and actionsGained cases pass
```

**Out of scope:** exports of the access review.

## Task 14: Update dev bootstrap, company seed and demo datasets

**Depends on:** Task 9
**Files:**
- Modify: `packages/database/src/datasets/bootstrap.ts` — stop writing `employeeTypePermission` for Admin; stop writing employee keys into `userPermission`
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — `seedCompany` stops writing `employeeTypePermission` for Admin
- Modify: `packages/database/src/datasets/tiers/01-foundation.ts` and each `data/<key>/foundation.ts` — one "Buyer" role with grants
- Modify: `packages/database/src/datasets/coverage.ts` — a floor for `permission`

**Steps:**
1. Remove the Admin `employeeTypePermission` inserts. The Admin type resolves to Full without rows.
2. Remove the employee key writes to `userPermission` in `bootstrap.ts`.
3. In each dataset, add a "Buyer" role: Purchasing Edit, Inventory View (Receipts Edit needs Task 17). Tier 1 adopts it by name; its grants are inserted only where none exists.
4. Add `permission: 2` to the coverage floors.
5. Add `permission` to the dataset wipe's `PRESERVED_TABLES`: a demo apply keeps employees, roles and API keys, so it must keep their grants.
6. Stop `seedCompany` writing the creator's module keys into `userPermission`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets apply and meet their floors
```

**Out of scope:** dropping the old tables (Task 26).

## Task 14a: Replace the ERP auth entry points with `authorize`

**Depends on:** none. Run it alone in this worktree.
**Files:**
- Modify: `packages/api/src/carbon.server.ts` — add `authorize`; delete `carbon` and `carbonFor`
- Modify: `packages/ee/src/onshape/panel/session.server.ts` — rename `requireOnshapePanelPermissions` to `authorizePanel`
- Modify: every non-test file under `apps/erp/app` that calls `requirePermissions`, `carbon` or `carbonFor`
- Modify: `apps/erp/app/modules/service-context.server.ts` — type its argument as `CallerAuth`
- Create: `scripts/.tmp/authorize-codemod.ts` (delete after the task)
- Create: `packages/checks/src/conformance/erp-authorize-only.ts` and its test
- Modify: `packages/checks/src/run.ts`, `packages/checks/AGENTS.md`
- Modify: `packages/checks/src/conformance/route-action-shape.ts` and `loader-reads-through-api.ts` — their messages name `authorize`
- Modify: the rules and AGENTS files that name `carbon(request)`, `carbonFor` or `requirePermissions` as the route entry
- Copy from (precedent): `packages/checks/src/conformance/no-raw-redirect.ts`

**Steps:**
1. In `carbon.server.ts`, add `authorize(request, gate?)`. It calls `requirePermissions(request, gate ?? {})` and returns the result plus `api`.
2. Add the overload `authorize(caller)` for a `CallerAuth` that another gate made. It returns the caller plus `api`.
3. Rename the panel gate to `authorizePanel`. Its body ends with `return authorize(caller)`.
4. Write a ts-morph codemod over `apps/erp/app`. Skip `*.test.*` files.
5. In the codemod, rewrite each `requirePermissions(` call to `authorize(`.
6. Rewrite `const api = await carbon(x)` to `const { api } = await authorize(x)`.
7. Rewrite `const api = carbonFor(e)` to `const { api } = e`. Rewrite any other `carbonFor(e)` to `e.api`.
8. Merge `const auth = await authorize(…)` and its `const { … } = auth` lines into one destructuring when `auth` has no other use.
9. Fix the imports: drop the old names, add `authorize` or `authorizePanel`.
10. Delete `carbon` and `carbonFor` from `carbon.server.ts`.
11. Run Biome on the changed files.
12. Add `erp-authorize-only`: fail an import of `requirePermissions`, `carbon` or `carbonFor` in non-test ERP code. Register it with an empty baseline.
13. Update each rule and AGENTS file that shows the old entry points.

**Verify:**
```bash
grep -rlE "carbonFor\(|await carbon\(|requirePermissions\(" apps/erp/app --include="*.ts" --include="*.tsx" | grep -v "\.test\." | wc -l
# Expected: 0
pnpm exec turbo run typecheck --filter=@carbon/api --filter=@carbon/ee --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
pnpm --filter erp test
# Expected: the same passed and skipped counts as before the task
pnpm --filter @carbon/checks test
# Expected: all tests pass, including run.test.ts "no new violations"
```

**Out of scope:** the gate shape (Tasks 19 to 21). MES, academy and starter keep `requirePermissions`.

**As built:**
1. `authorize` binds `api` on first read. A loader with no service-function call needs no registered router.
2. `no-server-code-in-client` skips JSX text. The OAuth consent copy "Only authorize it" read as a use of `authorize`.
3. Two Onshape install routes had a local `authorize` helper. It is now `beginAuthorization`.
4. Seven route tests mocked `requirePermissions`. Two now mock `authorize`; the lazy `api` fixed the other five.
5. A follow-up moved `authorize` to `@carbon/auth/auth.server`, beside `requirePermissions`, which is no longer exported. `registerCarbon` hands the `api` binding to `registerApi`, and the ERP states `api`'s type on `Register` there.
6. MES, academy and starter call `authorize` too. The compiler now refuses the old names, so `erp-authorize-only` was removed. Route tests mock `authorize` and build `api` with `withTestApi` (`apps/erp/test/register-carbon.ts`).

## Task 15: Rewrite the permissions docs and glossary

**Depends on:** Task 9
**Files:**
- Modify: `docs/content/docs/reference/permissions.mdx`
- Modify: `docs/content/src/glossary/terms.ts` — `employee-type-default-permissions` and the `employee-permissions-*` entries

**Steps:**
1. Load the `carbon-docs` skill.
2. Rewrite "The module-action model" as levels on modules and pages.
3. Rewrite "Employee types": a role holds levels; an edit reaches everyone with the role.
4. Rewrite "Per-person overrides and bulk edits": an override wins and can add or remove.
5. Rewrite the troubleshooting entry that names `<module>_view`.
6. Rewrite the glossary definitions to match. Do not keep "future hires only".

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: no errors
grep -n "future hires only" docs/content/src/glossary/terms.ts
# Expected: no output
```

**Out of scope:** the changelog entry. Write it only when the user asks.

## Task 16: Verify phases 1 and 2 in the browser

**Depends on:** Tasks 7 to 15
**Files:** none

**Steps:**
1. Load the `test` skill. Log in with the `auth` skill.
2. Run the spec's acceptance criteria that need no page keys:
   - a role edit reaches every person with the role;
   - an override of None removes access;
   - the Admin type has Full everywhere;
   - a key with View reads and cannot create;
   - "Select all" leaves Accounting below Full;
   - a portal account gets `forbidden` from an `"employee"` function;
   - the access view and the role audit event.
3. Record each result with a screenshot or network response.

**Verify:** every listed criterion passes. Expected: no "Access Denied" for a user whose old permissions allowed the page.

**Out of scope:** page-level criteria. Task 25 runs them.

## Task 17: Define the pages of all 14 modules in the registry

**Depends on:** Task 16
**Files:**
- Create: `packages/database/src/access/pages/<module>.ts` for the 14 modules in the spec's page table
- Modify: `packages/database/src/access/registry.ts` — `PAGES` collects the module files
- Create: `packages/database/src/access/registry.test.ts`

**Steps:**
1. For each module, list its sidebar entries from `apps/erp/app/modules/<module>/ui/use<Module>Submodules.tsx`.
2. Create one page per distinct `to` path. Key: `<permission module>.<camelCase label>`. Items use `parts.`.
3. Set `paths` from the `to` path and the detail route prefix of the same record (for example `/x/receipt/`).
4. List `tables`: every table in `manifest.ts` whose rule names the module and whose data the page manages.
5. Mark `maxLevel: "View"` on pages whose routes have no action.
6. For `item`: one shared entry, `where: { column: "type" }`, one page per item type value.
7. List as its `children` every table of the Items module with an `itemId` column.
8. Do the same for `memo` with `where: { column: "direction" }`.
9. Add `readers` for each restricted table another page lists or looks up.
10. In `registry.test.ts`, assert: every `manifest.ts` table that names a module belongs to exactly one page or one shared entry.
11. Assert: every shared table gives `where`; every page key is unique; the 158 pages exist.
12. Assert: every route under `apps/erp/app/routes/x+` matches one page's `paths`.
13. List a route that matches none in `UNPAGED_ROUTES`, with a reason.
14. If a table fits no page, STOP and report it. Do not create a page that is not in the spec.

**Verify:**
```bash
pnpm --filter @carbon/database test -- registry
# Expected: all registry tests pass
```

**Out of scope:** changing any check. Tasks 18 to 23 do that.

**As built (2026-10-19):**
1. `memo` has no `direction` split: both pages hold both directions. Supplier Credits owns the rows with `supplierId` set, Credit Memos the rows with `customerId` set. `SharedTable.value` is optional; no value means "the column is set". Task 18 renders it as `IS NOT NULL`.
2. Four more shared tables: `revenueRecognitionRun` (`type`), `enforcementRule` (`family`), `contact` (`isCustomer`) and `permission` (`userId`, `employeeTypeId`, `apiKeyId`).
3. `PENDING_TABLES` in `registry.test.ts` lists 5 tables with no page: `warehouse`, `tag`, `implementationHub`, `implementationCheckState`, `implementationFieldValue`. Task 18 decides their rules.
4. 27 tables sit on a page of another module than their rule names (for example `storageUnit`, rule `parts`, on Inventory). Task 18 converts these too.
5. Reporting is capped at Full, Payables and Receivables at Create, Audit Logs at Edit: their routes have actions. Ten other pages without actions cap at View.
6. `MODULES` lists the 14 modules with their labels. `expandClaims` keeps the 15 module keys (`MODULE_KEYS`, `resolve.ts`) from module grants until Task 24 deletes them.

## Task 18: Render RLS rules with page keys from the registry

**Depends on:** Task 17
**Files:**
- Modify: `packages/database/src/authz/rules.ts`
- Modify: `packages/database/src/authz/manifest.ts` — rules that name a `<module>_<action>` key explicitly
- Create: the generated migration from `pnpm --filter @carbon/database authz migration page-keys`
- Modify: `packages/database/supabase/tests/authz-pieces.test.sql` — page cases

**Steps:**
1. In `render()`, look up the page that owns the rule's table.
2. Replace `<module>_<action>` with `<page>_<action>` when the rule names the page's module.
3. Render a restricted read as `anyOf(<page>_view, <reader>_view …)`.
4. Render a shared table's rules with one branch per page: `<column> = <value> AND <page key check>`.
5. Render a child table's rules through its parent: `EXISTS (SELECT 1 FROM item WHERE item.id = itemId AND <branch>)`.
6. Leave reads that are "employee" unchanged.
7. Edit every explicit key in `manifest.ts` (for example `memo`'s `invoicing_update`) to the page it guards.
8. Run `pnpm --filter @carbon/database authz migration page-keys`.
9. STOP and ask the user to run `pnpm db:migrate`.
10. Add authz test cases: Tools Edit with Parts View, and Credit Memos Edit with Supplier Credits View.

**Verify:**
```bash
pnpm --filter @carbon/database test -- authz
# Expected: all authz tests pass
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/authz-pieces.test.sql
# Expected: exits 0 and prints no ERROR
```

**Out of scope:** the `"employee"` and portal actors. They do not change.

**As built (Tasks 18 to 22, 2026-10-19):**
1. Task 18 converts every rule, not only rules that name the page's module. The page that owns the table decides. The 5 pending tables went to `settings.company` (`tag` and the 3 Implementation Hub tables) or to the service role (`warehouse`).
2. Printing grants move to the Settings page Printing (`20261018205305_printing-grants-to-settings-page.sql`).
3. Bank Accounts is a 159th page with no sidebar entry. It owns `supplierBankAccount` and `customerBankAccount` (`20261019042439_bank-accounts-permission.sql`). The user chose it, so bank details keep needing Accounting.
4. A gate on a shared table can read the row: `{ row }` picks the page from the item's type, the memo's party or the run's type, and `{ anyOf }` admits any of the pages for a list. Built by `rowRule` and `anyOfRule` (`@carbon/api/permissions`).
5. `authorize(request, gate, options)` takes a page gate or a list of gates (any one passes). `role`, `bypassRls` and `allowPortalAccounts` moved to `options`.
6. MES batches gate on `production.batches`, not `production.jobs`: the `batch-operations` posting requires Batches.

## Task 19: Move service function permissions to pages and levels

**Depends on:** Task 17
**Files:**
- Create: `scripts/.tmp/permission-pages.ts` (delete after the task)
- Modify: every `apps/erp/app/modules/*/*.server.ts`
- Modify: `packages/api/src/permissions.ts` — a `RequiredPermissions` is `Partial<Record<PageId, Level>>`
- Modify: `packages/api/src/service-fn.server.ts` — `ctx.can` takes the same shape
- Modify: `apps/erp/app/modules/shared/shared.service.ts` — `authorizePostingCaller` and the posting permission constants
- Modify: `scripts/lib/service-fn-metadata.ts` — derive `actions` from the level

**Steps:**
1. Write a ts-morph script. For each `defineServiceFn`, read `permission`.
2. Follow `service.<fn>` calls in `run` into the module's `.service.ts`.
3. Collect the tables each building block writes and reads.
4. Map the written tables, else the read tables, to pages with the registry.
5. If exactly one page results, rewrite `{ <action>: "<module>" }` to `{ "<page>": "<level>" }`.
   Take the level from `ACTION_LEVEL`. If the rule names two actions on one page, keep the higher level.
6. For a shared table, pick the page from the function's input when the input names the type.
7. If the input does not name the type, list the function.
8. Print every function with zero or several pages.
9. Resolve each listed function by hand: read its route callers and pick the page they render.
10. Rewrite each `ctx.can({ <action>: … })` call the same way.
11. Change `hasPermissions` to check each entry with `levelHolds` on the resolved level.
12. Run `pnpm run generate:mcp`. The digest changes only where a page replaces a module.

**Verify:**
```bash
grep -rnE '(view|create|update|delete): "' apps/erp/app/modules/*/*.server.ts | wc -l
# Expected: 0
pnpm --filter erp test -- posting-permissions
# Expected: passes
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
```

**Out of scope:** `"employee"` and `"system"` permissions.

## Task 20: Move ERP and MES route gates to pages and levels

**Depends on:** Task 17
**Files:**
- Create: `scripts/.tmp/route-pages.ts` (delete after the task)
- Modify: every route under `apps/erp/app/routes` that passes a module to `authorize`
- Modify: every route under `apps/mes/app/routes` that passes a module to `authorize`
- Modify: `packages/auth/src/services/auth.server.ts` — `authorize(request, gate?, options?)` and the internal `requirePermissions`

**Steps:**
1. Map each route file to a URL path. A `+` folder adds its name as a segment.
2. In a file name, `.` separates segments, `$name` is a parameter, and `_index` and `_layout` add nothing.
3. Example: `x+/inventory+/receipts.tsx` is `/x/inventory/receipts`.
4. Find the page whose `paths` match. Rewrite `{ <action>: "<module>" }` to `{ "<page>": "<level>" }`, with the level from `ACTION_LEVEL`.
5. Move `bypassRls`, `role` and `allowPortalAccounts` into the third argument.
6. For `api+` routes, use the page of the service function the route calls (Task 19).
7. Print every route with no page or several pages.
8. Resolve each listed route by hand from what it reads and writes.
9. Do the 14 MES routes by hand: job operations, events and batches → `production.jobs`.
10. MES inspection lots and issues → `quality.inspections` and `quality.issues`.

**Verify:**
```bash
grep -rlE '(view|create|update|delete): "' apps/erp/app/routes apps/mes/app | wc -l
# Expected: 0
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
pnpm exec turbo run typecheck --filter=mes --concurrency=1
# Expected: no "error TS" lines outside docs/content
```

**Out of scope:** `role` and `allowPortalAccounts` options.

## Task 21: Move client permission checks to pages and levels

**Depends on:** Task 17
**Files:**
- Create: `scripts/.tmp/can-pages.ts` (delete after the task)
- Modify: every file under `apps/erp/app` and `apps/mes/app` that calls `permissions.can` with a module
- Modify: `apps/erp/app/hooks/usePermissions.tsx` — add `has(gate)` and `hasAny(module, level)`; delete `can`

**Steps:**
1. Add `has(gate)`, with the gate type of Task 19. Add `hasAny(module, level)`, which calls `holdsAny`.
2. In a route file, rewrite `can(action, "<module>")` to `has({ "<page>": "<level>" })`, with the route's page from Task 20.
3. In `modules/<module>/ui/<Folder>/`, map the folder to a page by name; write the map in the script.
4. Print every call the script cannot map.
5. Resolve each listed call by hand: pick the page whose records the button or field acts on.
6. Use `hasAny` where a component asks "anything in this module" (for example a module dashboard).
7. Delete `can` from `usePermissions.tsx`.

**Verify:**
```bash
grep -rnE 'permissions\.can\(' apps/erp/app apps/mes/app | wc -l
# Expected: 0
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
```

**Out of scope:** `permissions.is(role)` calls.

## Task 22: Drive the sidebar and the nav from page views

**Depends on:** Task 21
**Files:**
- Modify: the 14 `apps/erp/app/modules/*/ui/use*Submodules.tsx` hooks
- Modify: `apps/erp/app/hooks/useModules.tsx`

**Steps:**
1. Give every sidebar route entry a `page` field with its page id.
2. Show an entry only when `permissions.has({ [entry.page]: "View" })`.
3. Keep the existing `role` and integration filters.
4. In `useModules.tsx`, show a module when `permissions.hasAny(item.permission, "View")`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
```
Browser: a person with only Receipts View sees Inventory in the nav and only Receipts in its sidebar.

**Out of scope:** the Shop Floor nav entry (`role: "employee"`).

## Task 23: Move workflow event permissions and the MCP manifest to page keys

**Depends on:** Task 17
**Files:**
- Modify: `scripts/generate-workflow-catalog.ts` — an event's `permission` is the page that owns its table
- Regenerate: `packages/ee/src/workflows/catalog/events.generated.ts`
- Modify: `packages/ee/src/workflows/definition/catalog.ts` — the `permission` type is `PageId`
- Modify: `packages/api/src/manifest-types.ts` — `ToolPermission` gains optional `page`
- Modify: `scripts/lib/service-fn-metadata.ts` — publishes `{ module, page, actions }`
- Modify: `apps/erp/test/mcp-tool-permissions.test.ts`

**Steps:**
1. In the generator, map each event's table to its page with the registry.
2. For a posted moment (for example `inventory.receiptPosted`), use the page of its source table.
3. Run the generator, then `pnpm exec tsx scripts/check-workflow-catalog.ts`.
4. In `leafPermission`, read a page key: `module` = `moduleOf(page)`, `page` = the key.
5. Update the MCP permission tests to expect `page` on page-gated tools.
6. Run `pnpm run generate:mcp`.

**Verify:**
```bash
pnpm exec tsx scripts/check-workflow-catalog.ts
# Expected: passes
pnpm --filter erp test -- mcp
# Expected: all MCP tests pass
```

**Out of scope:** the changelog lines for the contract change. Write them only when the user asks.

**As built (2026-10-19):**
1. A moment names its source `table` in place of a module. `buildCatalog` takes the page from the registry (`tablePages`).
2. An `item` event lists the five item pages. The owner needs View on any one of them.
3. Actions, operations and entity reads still name a module (`RequiredPermission`). Task 24 decides them.
4. The digest prints `<page>:<actions>` for a gate of one page.

## Task 24: Add the module-key conformance check

**Depends on:** Tasks 18 to 23
**Files:**
- Create: `packages/checks/src/conformance/no-module-permission-key.ts` and its test
- Modify: `packages/checks/src/run.ts`
- Modify: `packages/checks/AGENTS.md`
- Copy from (precedent): `packages/checks/src/conformance/route-action-shape.ts`

**Steps:**
1. Fail a gate entry whose key is a module (`{ inventory: "Edit" }`), a `"<module>_<action>"` string and a `has` call that names a module.
2. Scan ERP modules and routes, MES, `packages/database/src/authz/manifest.ts` and the workflow catalog.
3. Read the module list from `PAGES` ids without a `.`; there are none after Task 17.
4. Register it in `run.ts` with an empty baseline.
5. Document it in `packages/checks/AGENTS.md`.

**Verify:**
```bash
pnpm --filter @carbon/checks test
# Expected: all tests pass, including run.test.ts "no new violations"
```

**Out of scope:** portal keys in `userPermission`.

**As built (2026-10-19):**
1. The workflow catalog names pages. `RequiredPermission` is `{ page, action }`; `page` is a page or a list, and any one passes.
2. The five create actions take the page of the record they create. Notify takes Accounts or Groups. Webhook takes Workflows.
3. The generator gives each `<entity>.update` action, each operation and each lookup the page of the entity's table (`tablePages`). Entity pages ship as `WORKFLOW_ENTITY_PAGES`, and `check-workflow-catalog.ts` compares them.
4. `RegistryEntry.permission` and the module argument of `operation()` are gone. The engine (`execute.ts`) checks a node as it checks an event.
5. The managed functions name pages: `get_claims` (Accounts), the five audit log functions (Audit Logs) and `util.can_manage_event_subscription` (Webhooks). They ship in `20261019053151_page-keys-in-functions.sql`, which `authz migration` wrote.
6. `20261019053223_module-keys-to-pages.sql` redefines `is_claims_admin` (Accounts) and the two storage requirement functions (Stock Transfers) from their live definitions. It also moves six storage policies to pages, and writes the read policy of every audit log table again.
7. The storage policies are new scope: the public bucket now needs Logos, and staged models need any item page. Their old names held a module key, so they are renamed.
8. `hasPermission` (`@carbon/auth`) takes a page gate. Its five callers name Service Contracts, Rental Agreements, Leases, Accounts with Employees, and Integrations.
9. `expandClaims` emits page keys only; `MODULE_KEYS` is gone. Three tests changed: `resolve.test.ts`, `api-key-cache.test.ts` and `users.server.test.ts`.
10. The check is `no-module-permission-key`, with an empty baseline. It reads TS under `MODULE_KEY_ROOTS`, the managed function files, and migrations after `20261019053223`.
11. The check skips `manifest.ts`, portal keys, `hasAny`, `holdsAny`, `pagesOf("<module>")` and `documents`, whose one page has the module's id.
12. About 128 lines in `AGENTS.md` files and rules still name module keys in prose. Code comments were fixed; the prose is a follow-up. The portal keys in `makeCustomerPermissions` stay (out of scope).

## Task 25: Verify every page in the browser

**Depends on:** Task 24
**Files:**
- Create: `scripts/.tmp/one-page-roles.ts` (delete after the task)

**Steps:**
1. Write a script that creates, in a seeded local company, one role per page with Edit on that page only.
2. Log in as the `auth` skill's bypass user. Make sure that user is not an Admin type.
3. Load the `test` skill. For each page, assign its role to the bypass user, then open the page and one record.
4. Record any "Access Denied", empty list or failed action.
5. Run every spec acceptance criterion, including the two `EXPLAIN ANALYZE` timings.
6. Fix each failure at its source (registry, rule, gate or check). Re-run that page.

**Verify:** every page opens for its own role, and every acceptance criterion passes. Expected: a written list of pages tested, with no open failure.

**Out of scope:** the staging soak. The user runs it before release.

## Task 26: Drop the old permission storage

**Depends on:** Phase 3 released
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_drop-old-permissions.sql`
- Modify: `packages/jobs/src/backups/renames.ts` — `employeeTypePermission: null`
- Modify: every remaining reader of `employeeTypePermission`, `apiKey.scopes` and employee keys in `userPermission`

**Steps:**
1. Find readers: `grep -rn "employeeTypePermission\|\.scopes\b" apps packages --include=*.ts --include=*.tsx`.
2. Remove each reader. If one still needs the data, STOP and report.
3. Run `pnpm db:migrate:new drop-old-permissions`.
4. Drop `employeeTypePermission` and `apiKey.scopes`.
5. Delete every non-portal key from `userPermission.permissions`.
6. Add `employeeTypePermission: null` to `TABLE_RENAMES`.
7. STOP and ask the user to run `pnpm db:migrate`, then run `pnpm run generate:types`.

**Verify:**
```bash
pnpm db:check:backups
# Expected: success
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no "error TS" lines outside docs/content
```

**Out of scope:** `userPermission` itself. It stays for portal accounts.
