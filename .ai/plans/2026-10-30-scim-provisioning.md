# SCIM 2.0 Provisioning — implementation plan

**Spec:** .ai/specs/2026-10-30-scim-provisioning.md
**Research:** .ai/research/scim-provisioning.md
**Closest sibling:** SAML SSO (`packages/ee/src/sso/`, `apps/erp/app/routes/x+/settings+/sso.tsx`, the SSO section of `security.tsx`). Token sibling: API keys (`apiKey.keyHash`, `createApiKey` in `apps/erp/app/modules/settings/settings.server.ts`). Handler sibling: MCP (`serveMcpRequest`, `packages/ee/src/mcp/server.ts`).
**Branch:** naveenkash/b2h29

## Progress
- [x] Task 1: Create the SCIM tables and their RLS rules
- [x] Task 2: Add the `SCIM` feature, the audit metadata fields and the token signer
- [x] Task 3: Write the pure SCIM protocol module and its tests
- [x] Task 4: Write the pure mapping module and its tests
- [x] Task 5: Write the SCIM engine (`scim.server.ts`)
- [x] Task 6: Write the admin functions (`scim-connections.server.ts`) and the package export
- [x] Task 7: Add the ERP routes, validators and path helpers
- [x] Task 8: Build the Provisioning section on Settings → Security
- [x] Task 9: Show the SCIM actor label in the audit log
- [x] Task 10: Write the docs, the rule file and the Task Router row
- [x] Task 11: Run the scoped gates

## Deviations (recorded during execute)
- Task 5: no `scim.server.test.ts`. `.claude/rules/testing.md` forbids mocking first-party modules, so the request edge became two pure helpers (`matchScimRoute`, `readBearerToken`) tested in `scim-protocol.test.ts`. The live flows ran in the test phase against the local stack.
- Task 5: result types use `{ ok, value }` instead of `{ ok, state }` / `{ ok, clauses }`.
- Task 8: the "Not mapped" choice posts `SCIM_NOT_MAPPED` (`"none"`), not `""`, because a Select item cannot hold an empty value. The validator maps it to null.
- Order: Task 10 (docs) ran after the test phase, so the docs describe verified behavior.

## Dependencies
- Task 2 needs nothing. Task 1 needs nothing. Tasks 1 and 2 are independent.
- Tasks 3 and 4 need nothing. They are independent of each other and of Tasks 1–2.
- Task 5 needs Tasks 1, 2, 3, 4 (generated types, feature key, pure modules).
- Task 6 needs Task 5.
- Task 7 needs Task 6.
- Task 8 needs Task 7. Task 9 needs Task 2 only.
- Task 10 needs Tasks 5–9 (it documents committed behavior).
- Task 11 needs every task.

---

## Task 1: Create the SCIM tables and their RLS rules

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_scim-provisioning.sql` (made by the command below)
- Modify: `packages/database/src/authz/manifest.ts` — add 4 rules
- Create: a generated authz migration (made by the authz command)
- Copy from (precedent): `packages/database/supabase/migrations/20260820215433_sso-connection.sql`

**Steps:**
1. Run `pnpm db:migrate:new scim-provisioning`.
2. Write the SQL from the spec's Data Model section into the new file. Add these rules:
   - Guard the enum with `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`.
   - Use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.
   - Give `scimGroup` the 4 audit columns.
   - Index `companyId` and every FK column on each table.
   - Write no `CREATE POLICY`. Write `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for the 4 tables.
3. In `manifest.ts`, add in alphabetical position:
   ```ts
   scimConnection: company("settings", { read: "settings_view" }),
   scimGroup: company("settings", { read: "settings_view" }),
   scimGroupMember: company("settings", { read: "settings_view" }),
   scimUser: company("settings", { read: "settings_view" }),
   ```
4. Run `pnpm db:migrate`. It applies the migration, syncs the authz rules and regenerates the types.
5. Run `pnpm --filter @carbon/database authz migration scim-provisioning-rls`.
6. Run `pnpm run generate:types`.

If `company("settings", { read: "settings_view" })` does not type-check for a table, STOP and report.

**Verify:**
```bash
grep -c '"scimConnection"\|"scimUser"\|"scimGroup"\|"scimGroupMember"' packages/database/src/types.ts
# Expected: a number above 0
pnpm --filter @carbon/database test -- authz
# Expected: all tests pass (migration.test.ts sees the generated block)
```

**Out of scope:** any change to `employee`, `userToCompany`, `apiKey` or `ssoConnection`.

## Task 2: Add the `SCIM` feature, the audit metadata fields and the token signer

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/plan.ts` — add `SCIM: [Plan.Business, Plan.Partner]` with a one-line comment
- Modify: `packages/database/src/audit.types.ts` — `origin` gains `"scim"`; add `actorLabel?: string`
- Modify: `packages/auth/src/lib/supabase/client.server.ts` — extract `signUserAccessToken`
- Copy from (precedent): `getUserScopedClient` in the same file

**Steps:**
1. Add `SCIM` to `FEATURE_PLANS` after `BACKUPS`.
2. In `AuditMetadata`, set `origin?: "web" | "api" | "import" | "system" | "scim"`.
3. Add `actorLabel?: string` with a TSDoc line: "The non-user actor to show when `actorId` is null, e.g. `SCIM (Okta)`."
4. In `client.server.ts`, add `export async function signUserAccessToken(userId: string, claims?: Record<string, string>): Promise<string>`. Move the `SignJWT` body of `getUserScopedClient` into it.
5. Make `getUserScopedClient` call `signUserAccessToken(userId, workflowRunId ? { workflow_run_id } : undefined)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/auth --filter=@carbon/ee --filter=@carbon/database
# Expected: 0 errors
```

**Out of scope:** other `FEATURE_PLANS` keys; the 5-minute token expiry.

## Task 3: Write the pure SCIM protocol module and its tests

**Depends on:** none
**Files:**
- Create: `packages/ee/src/sso/scim-protocol.ts`
- Create: `packages/ee/src/sso/scim-protocol.test.ts`
- Copy from (precedent): `packages/ee/src/sso/verification.server.test.ts` (test style)

**Steps:**
1. Run `pnpm --filter @carbon/checks license-headers` after you create each file.
2. Export these constants: `SCIM_CONTENT_TYPE = "application/scim+json"`, the 5 schema URNs (User, Group, ListResponse, PatchOp, Error), `ENTERPRISE_USER_URN`.
3. Export `scimError(status: number, detail: string, scimType?: string): Response`.
4. Export `scimJson(body: unknown, status = 200): Response`.
5. Export `scimListResponse<T>(resources: T[], { totalResults, startIndex })`.
6. Export `parseScimFilter(filter: string | null): { ok: true; clauses: { attribute: string; value: string }[] } | { ok: false; detail: string }`.
   - Grammar: `<attr> eq "<value>"` clauses joined by `and`, case-insensitive keywords.
   - Unescape `\"` inside the value.
   - An empty or null filter gives `clauses: []`.
   - Any other operator (`co`, `sw`, `or`, `pr`) gives `ok: false`.
7. Export `parsePaging(url: URL): { startIndex: number; count: number }`. Default 1 and 100. Clamp `count` to 0–200. Clamp `startIndex` to at least 1.
8. Export type `ScimUserState = { userName: string; externalId: string | null; email: string; givenName: string | null; familyName: string | null; active: boolean }`.
9. Export `readUserResource(body: unknown): { ok: true; state: ScimUserState } | { ok: false; detail: string }`. It reads a POST or PUT body. Email order: `emails` entry with `primary: true`, else `type: "work"`, else the first entry, else `userName` when it contains `@`. Lowercase the email. Accept `active` as a boolean or the strings `"True"` / `"False"` (any case). A missing `active` is `true`.
10. Export `applyUserPatch(state: ScimUserState, body: unknown): { ok: true; state: ScimUserState } | { ok: false; detail: string }`.
    - Read `Operations` (or `operations`). Read `op` in any case: `add`, `replace`, `remove`.
    - A no-path op with an object value: apply each key. Keys may be dotted (`name.givenName`) or nested objects (`name: { givenName }`).
    - Paths to support: `active`, `userName`, `externalId`, `name.givenName`, `name.familyName`, `displayName` (ignored), `emails`, `emails[type eq "work"].value`, enterprise-URN keys (ignored).
    - Unknown attributes: ignore them. Unknown `op`: `ok: false`.
11. Export type `ScimGroupState = { displayName: string; externalId: string | null; memberIds: string[] }`.
12. Export `readGroupResource(body: unknown)` and `applyGroupPatch(state: ScimGroupState, body: unknown)` with the same result shape.
    - `add` with path `members` and a value array: add the `value` ids.
    - `remove` with path `members[value eq "<id>"]`: remove that id.
    - `remove` with path `members` and a value array: remove those ids. Without a value: remove all.
    - `replace` with path `members`: set the list.
    - `replace` with no path and `{ displayName }` or `{ id, displayName }`: rename.
    - `replace` with path `displayName` or `externalId`: set it.
13. Export `toScimUser(row, baseUrl)` and `toScimGroup(row, members | null, baseUrl)`. Include `schemas`, `id`, `externalId`, `userName`, `name`, `displayName`, `emails: [{ value, type: "work", primary: true }]`, `active`, and `meta { resourceType, created, lastModified, location }`.
14. Export `serviceProviderConfig(baseUrl)`, `resourceTypes(baseUrl)` and `schemas()` as static documents.
15. Write tests for: the filter parser (userName, externalId, `and`, escaped quote, `co` refused), Okta AIW PUT body, Okta PATCH no-path `{"active": false}`, Entra `Replace` + `"False"`, Entra flag shape with dotted keys, `emails[type eq "work"].value`, group add, group remove by filter path, group replace, group rename, and an unknown op.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- scim-protocol
# Expected: all scim-protocol tests pass
```

**Out of scope:** any I/O, any database type import.

## Task 4: Write the pure mapping module and its tests

**Depends on:** none
**Files:**
- Create: `packages/ee/src/sso/scim-mapping.ts`
- Create: `packages/ee/src/sso/scim-mapping.test.ts`
- Copy from (precedent): `mergeInvitePermissions` in `packages/ee/src/sso/provisioning.server.ts`

**Steps:**
1. Export `pickEmployeeType(groups: { employeeTypeId: string | null; priority: number; displayName: string }[], defaultTypeId: string): string`. Use only groups with a type. Sort by `priority`, then `displayName` (`localeCompare`). Return the first type, else `defaultTypeId`.
2. Export `typeGrantsFor(rows: { module: string; view: string[]; create: string[]; update: string[]; delete: string[] }[], companyId: string): string[]`. Return the claim keys (`<module lowercased>_<action>`) whose array holds `companyId`.
3. Export `replaceCompanyGrants(current: Record<string, string[]>, grantedKeys: string[], companyId: string): Record<string, string[]>`.
   1. Copy `current`.
   2. Remove `companyId` from every array.
   3. Add `companyId` to every key in `grantedKeys`. Create a missing key.
   4. Never touch other company ids.
4. Export `stripCompanyGrants(current, companyId)` (step 3.2 alone) for reuse.
5. Write tests: priority order, tie by name, unmapped groups ignored, no groups → default, replace keeps other companies' ids, replace removes a key the type no longer grants, replace adds a new key.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- scim-mapping
# Expected: all scim-mapping tests pass
```

**Out of scope:** reading `employeeTypePermission` (Task 5 does it).

## Task 5: Write the SCIM engine (`scim.server.ts`)

**Depends on:** Tasks 1, 2, 3, 4
**Files:**
- Create: `packages/ee/src/sso/scim.server.ts`
- Create: `packages/ee/src/sso/scim.server.test.ts`
- Copy from (precedent): `migrateUserToSso` in `packages/ee/src/sso/provisioning.server.ts` (the transaction); `serveMcpRequest` in `packages/ee/src/mcp/server.ts` (entitlement → status code); `api+/sso.check.ts` (the `Ratelimit` call)

**Steps:**
1. Export `type ScimDeps = { db: Kysely<KyselyDatabase>; serviceRole: SupabaseClient<Database> }`.
2. Export `async function handleScimRequest(request: Request, deps: ScimDeps): Promise<Response>`. It never throws: wrap the body and answer `scimError(500, "Internal error")` on a throw. Log the real error.
3. Authenticate:
   1. Read `Authorization: Bearer <token>`. A missing or non-`scim_` token → `401`.
   2. Look up `scimConnection` by `tokenHash = hashApiKey(token)` with the service role. No row → `401`.
   3. Run `requireEntitlement(serviceRole, companyId, "SCIM")`. Catch `EntitlementError` → `403` "SCIM provisioning requires the Business plan."
   4. Rate-limit with `Ratelimit.slidingWindow(600, "1 m")` on key `scim:<connectionId>`. Over the limit → `429` with `Retry-After: 60`.
   5. Set `lastRequestAt` at most once a minute: update only when it is null or older than 60 s.
4. Route on the path after `/scim/v2`, case-insensitive on the resource name:
   - `ServiceProviderConfig`, `ResourceTypes`, `Schemas` → static documents (GET only).
   - `Users`, `Users/{id}`, `Groups`, `Groups/{id}` → the handlers below.
   - Anything else → `404`. A wrong method → `405`.
5. Read JSON bodies with `request.json()` in a try. A bad body → `400 invalidSyntax`.
6. Write `listUsers(conn, url)`: map filter attributes `userName` → `lower("userName")`, `externalId`, `emails.value`/`emails` → `email`, `id`. Unknown attribute → `400 invalidFilter`. Order by `createdAt`, then `id`. Return `ListResponse` with `totalResults` from a count query.
7. Write `getUser(conn, id)`: `scimUser` by `id` and `companyId`, else `404`.
8. Write `createUser(conn, state)` exactly as the spec's `POST /Users` lifecycle:
   1. Duplicate `userName` → `409 uniqueness`.
   2. SSO rule: `getSsoConnection(serviceRole, companyId)`; if it has domains, `uncoveredSsoDomainError(domains, email)` → `400`.
   3. Find `user` by email (service role, active-agnostic). If it is inactive → `409`.
   4. If none and `CONTROLLED_ENVIRONMENT` → `403`.
   5. If none: `serviceRole.auth.admin.createUser({ email, password: crypto.randomUUID(), email_confirm: true, user_metadata: { name } })`. On `user_already_exists`, answer `409` with "An account with this email exists. Contact support." Remember `createdAuthUser = true`.
   6. If `isSsoEnabled()` and `getSsoConnectionByDomain` finds a connection: `seedSsoIdentityForUser(db, …)`. Log a failure; do not stop.
   7. Validate that `defaultEmployeeTypeId` and `defaultLocationId` belong to the company. Else `500` and log.
   8. Run one `db.transaction()` with every step of the spec's step 6. Lock `user` with `forNoKeyUpdate` before the permission read-merge-write. Read the type grants with one `employeeTypePermission` select. Every write carries `companyId` where the table has one.
   9. On a transaction error: if `createdAuthUser`, call `serviceRole.auth.admin.deleteUser(userId)`. A unique violation (`23505`) → `409`. Else `500`.
   10. After the commit: `redis.del(getPermissionCacheKey(userId))`, `updateSubscriptionQuantityForCompany(companyId)`, and the audit entry (step 13). Each is best-effort and logged.
9. Write `replaceUser(conn, id, state)` (PUT) and `patchUser(conn, id, body)` (PATCH). Both build the next `ScimUserState`, then call `applyUserState(conn, row, next)`:
   1. Update the `scimUser` row (`userName`, `externalId`, `email`, names, `updatedAt`, `updatedBy: "system"`).
   2. If `active` went true → false: `deactivateScimUser`.
   3. If `active` went false → true: `reactivateScimUser`.
   4. If the name changed and the person has no other `userToCompany` row: update `user.firstName` / `lastName`.
   5. A new `userName` that collides → `409`.
10. Write `deactivateScimUser(conn, row)`:
    1. `deactivateUser(serviceRole, row.userId, companyId)` from `@carbon/auth/users.server`. Log an error; continue.
    2. Select `id, keyHash` from `apiKey` where `createdBy = userId` and `companyId`. Delete them by `id` and `companyId`. Call `bustApiKeyCache` for each hash.
    3. Count the person's remaining `userToCompany` rows. If 0: `serviceRole.auth.admin.signOut(await signUserAccessToken(userId), "global")`. Log an error; continue.
    4. `updateSubscriptionQuantityForCompany(companyId)`. Audit entry.
11. Write `reactivateScimUser(conn, row)` in one transaction: set `employee.active = true`, insert `userToCompany` (`role: "employee"`, on conflict do nothing), compute the type with `pickEmployeeType` over the person's mapped groups, set `employee.employeeTypeId`, write the grants with `replaceCompanyGrants`. Then cache bust, seats, audit.
12. Write `deleteUser(conn, id)`: run `deactivateScimUser` when the row is active, then delete the row. Answer `204`.
13. Write `auditEmployee(conn, entry)`: `insertAuditLogEntries(serviceRole, companyId, [{ tableName: "employee", entityType: "employee", entityId: userId, recordId: userId, operation, actorId: null, diff, metadata: { origin: "scim", actorLabel: \`SCIM (${identityProvider})\` } }])` in a try/catch that logs.
14. Write the group handlers: `listGroups` (filter `displayName`, `externalId`, `id`; honor `excludedAttributes=members`), `getGroup`, `createGroup` (409 on a duplicate name), `replaceGroup`, `patchGroup`, `deleteGroup`.
    - Resolve member ids against `scimUser` of the company in one `.in()`/`where in` query. Drop unknown ids.
    - Write members with one insert and one delete per request.
    - Collect the changed members, then call `reconcileEmployeeTypes(conn, scimUserIds)`.
15. Export `reconcileEmployeeTypes(db, serviceRole, { companyId, connection, scimUserIds?: string[] })` (Task 6 reuses it):
    1. If no `scimGroup` of the company has a type, return.
    2. Read the active people (all, or the given ids) with their groups in one query.
    3. Compute each person's type with `pickEmployeeType`.
    4. Read the current `employee.employeeTypeId` for them in one query. Keep the people whose type differs.
    5. Read the grants of every needed type in one `employeeTypePermission` query.
    6. In one transaction, lock their `userPermission` rows, set `employee.employeeTypeId`, and write the new grants. Write in batches of 500 with `UPDATE … FROM (VALUES …)`.
    7. Bust the caches with one `redis.del(...keys)`. Write one audit entry per changed person.
16. Write `scim.server.test.ts` for the request edge: no token → 401; wrong token → 401 (mock the lookup); entitlement refused → 403; unknown path → 404; `ServiceProviderConfig` → 200 with `application/scim+json`. Mock `@carbon/kv`, `./plan.server` and the service role, as `sso.server.test.ts` does.

If `serviceRole.auth.admin.signOut` refuses a token without `session_id`, STOP and report. The research says GoTrue accepts it.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- scim
# Expected: scim-protocol, scim-mapping and scim.server tests pass
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: 0 errors
```

**Out of scope:** changing `deactivateUser`, `createEmployeeAccount` or the invite flow.

## Task 6: Write the admin functions and the package export

**Depends on:** Task 5
**Files:**
- Create: `packages/ee/src/sso/scim-connections.server.ts`
- Create: `packages/ee/src/sso/scim-index.server.ts`
- Modify: `packages/ee/package.json` — add `"./scim.server": "./src/sso/scim-index.server.ts"`
- Copy from (precedent): `packages/ee/src/sso/connections.server.ts`; `createApiKey` in `apps/erp/app/modules/settings/settings.server.ts`

**Steps:**
1. Export `generateScimToken(): { token: string; tokenHash: string; tokenPreview: string }`. Use `scim_` + `nanoid(32)` (`customAlphabet` with base62). The hash is `hashApiKey(token)`. The preview is the last 4 characters.
2. Export `getScimConnection(client, companyId)`. Return `{ connection, groups, activeCount }` or `null` in `data`. `groups` holds `id, displayName, employeeTypeId, priority, memberCount` (one query with a count embed). `activeCount` counts active `scimUser` rows.
3. Export `createScimConnection(serviceRole, { companyId, userId, identityProvider, defaultEmployeeTypeId, defaultLocationId })`.
   1. `requireEntitlement(serviceRole, companyId, "SCIM")`.
   2. Check that the type and the location belong to the company.
   3. Insert the row with a fresh token. A unique violation on `companyId` → error "SCIM is already set up for this company."
   4. Return `{ data: { token }, error: null }`.
4. Export `updateScimConnection(serviceRole, db, input)`. Gate, check ownership, update, then `reconcileEmployeeTypes(db, serviceRole, { companyId, connection })`.
5. Export `regenerateScimToken(serviceRole, { companyId, userId })`. Gate, update `tokenHash` and `tokenPreview`, return the token.
6. Export `deleteScimConnection(serviceRole, { companyId })`. No gate. Delete by `companyId`.
7. Export `updateScimGroupMapping(serviceRole, db, { companyId, userId, groupId, employeeTypeId | null, priority })`. Gate, check the type belongs to the company, update the group by `id` and `companyId`, then reconcile the group's members.
8. In `scim-index.server.ts`, re-export `handleScimRequest`, `reconcileEmployeeTypes` and the 6 admin functions.
9. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: 0 errors
```

**Out of scope:** UI.

## Task 7: Add the ERP routes, validators and path helpers

**Depends on:** Task 6
**Files:**
- Create: `apps/erp/app/routes/scim+/v2.$.ts`
- Create: `apps/erp/app/routes/x+/settings+/scim.tsx`
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — add 2 validators
- Modify: `apps/erp/app/utils/path.ts` — add `scim: \`${x}/settings/scim\`` beside `sso`
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/sso.tsx`; `apps/erp/app/routes/api+/v1+/$.ts`

**Steps:**
1. In `v2.$.ts`, export `loader` and `action`. Each returns `handleScimRequest(request, { db: getDatabaseClient(), serviceRole: getCarbonServiceRole() })`.
2. Add `scimConnectionValidator`: `identityProvider` (enum of the 6 values), `defaultEmployeeTypeId` (min 1), `defaultLocationId` (min 1).
3. Add `scimGroupMappingValidator`: `groupId` (min 1), `employeeTypeId` (string, `""` means not mapped), `priority` (`zfd.numeric(z.number().int().min(0).max(1000))`).
4. In `scim.tsx`, copy the shape of `sso.tsx`:
   1. `loader` redirects to `path.to.security`.
   2. `action` runs `assertIsPost`, then `requirePermissions(request, { update: "settings" })`.
   3. Switch on `intent`: `create`, `update`, `regenerate`, `delete`, `mapGroup`.
   4. Catch `EntitlementError` and flash "SCIM provisioning requires the Business plan."
   5. `create` and `regenerate` return `data({ token })`, so the component shows it once. The other intents flash success.
5. Add `/scim/v2` to nothing else: the route answers server-to-server calls with no Origin header, which `isCrossOriginRequestAllowed` accepts.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** MES; the `/api/v1` router.

## Task 8: Build the Provisioning section on Settings → Security

**Depends on:** Task 7
**Files:**
- Create: `apps/erp/app/modules/settings/ui/Security/ScimProvisioning.ee.tsx`
- Modify: `apps/erp/app/routes/x+/settings+/security.tsx` — loader data and one render
- Copy from (precedent): the SSO section of `apps/erp/app/routes/x+/settings+/security.tsx` (cards, `CopyableField`, `StatusDot`, confirm `Modal`, `UpgradeOverlaySection`)

**Steps:**
1. Move `StatusDot` and `CopyableField` out of `security.tsx` into `apps/erp/app/modules/settings/ui/Security/SecurityFields.tsx`. Import them in both files.
2. In the loader, add `scim`: `getScimConnection(client, companyId)`, the company's employee types (`id, name` from `employeeType`), and `baseUrl: \`${getAppUrl()}/scim/v2\``.
3. In `ScimProvisioning.ee.tsx`, build the 7 UI parts in the spec's UI Changes section. Use `ValidatedForm` with `fetcher` and `action={path.to.scim}`, as the SSO form does. Use `Select` and `Location` from `~/components/Form`. Use `Number` from `~/components/Form` for priority.
4. Show the token modal when a `create` or `regenerate` fetcher returns `data.token`. Clear it on close.
5. Gate with `usePlanGate({ feature: "SCIM" })`. When gated, wrap the setup card in `UpgradeOverlaySection` with `LuUsers`.
6. Render `<ScimProvisioning … />` in `security.tsx` after the SSO block, outside the `ssoEnabled` condition.
7. Wrap every string in Lingui `Trans` or `t`. Run `pnpm run lingui:extract`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
pnpm exec biome check apps/erp/app/modules/settings/ui/Security apps/erp/app/routes/x+/settings+/security.tsx apps/erp/app/routes/x+/settings+/scim.tsx
# Expected: no errors
```

**Out of scope:** the SSO cards' behavior; the people list.

## Task 9: Show the SCIM actor label in the audit log

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/settings/ui/AuditLog/AuditLogTable.tsx` — both "System" spots
- Modify: `apps/erp/app/components/AuditLog/AuditLogDrawer.tsx` — the "System" spot
- Modify: `apps/erp/app/components/AuditLog/utils.ts` — the CSV actor column
- Modify: `apps/erp/app/components/AuditLog/utils.test.ts` — one case

**Steps:**
1. In each spot, show `entry.metadata?.actorLabel` when `actorId` is null and the label is a non-empty string. Else keep "System".
2. If an entry type lacks `metadata`, read the select that feeds it and add `metadata`. If the select is generated, STOP and report.
3. Add a CSV test: an entry with `actorId: null` and `actorLabel: "SCIM (Okta)"` exports "SCIM (Okta)".

**Verify:**
```bash
pnpm --filter erp exec vitest run app/components/AuditLog/utils.test.ts
# Expected: all tests pass
```

**Out of scope:** the audit filters.

## Task 10: Write the docs, the rule file and the Task Router row

**Depends on:** Tasks 5–9
**Files:**
- Create: `docs/content/docs/reference/scim-provisioning.mdx`
- Modify: `docs/content/docs/reference/meta.json` — add the page after `single-sign-on`
- Create: `.claude/rules/scim-provisioning.md` (with `paths:` for `packages/ee/src/sso/scim*`, `apps/erp/app/routes/scim+/**`, `apps/erp/app/routes/x+/settings+/scim.tsx`, `apps/erp/app/modules/settings/ui/Security/ScimProvisioning.ee.tsx`)
- Modify: `AGENTS.md` — a Task Router row under Server & Services: "SCIM provisioning (IdP user sync)"
- Modify: `.ai/specs/2026-08-21-enterprise-saml-sso.md` — a Changelog line pointing to the SCIM spec
- Copy from (precedent): `docs/content/docs/reference/single-sign-on.mdx`

**Steps:**
1. Write the docs page: what SCIM does, plan, set-up steps for Okta and for Entra, what the IdP owns, what deactivation does, group mapping, and the limits (email never changes, controlled environment).
2. Write the rule from the committed code only.
3. Add the Task Router row.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: 0 errors
```

**Out of scope:** a changelog entry (a separate `/changelog-entry` run).

## Task 11: Run the scoped gates

**Depends on:** every task
**Steps:**
1. Run the commands below.
2. Fix each failure at its root.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/auth --filter=@carbon/database --filter=erp
# Expected: 0 errors
pnpm --filter @carbon/ee test
# Expected: all tests pass
pnpm --filter @carbon/auth test
# Expected: all tests pass
pnpm exec biome check packages/ee/src/sso packages/auth/src/lib/supabase apps/erp/app/routes/scim+ apps/erp/app/routes/x+/settings+ apps/erp/app/modules/settings apps/erp/app/components/AuditLog
# Expected: no errors
pnpm --filter @carbon/checks test
# Expected: all tests pass (the conformance scan and the license-header check run here)
```

Then hand off to `/test`: a scripted IdP run (Okta AIW and Entra request sequences) against the local `/scim/v2`, and a browser check of the Provisioning section.
