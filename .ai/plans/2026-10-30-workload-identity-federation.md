# Workload Identity Federation — implementation plan

**Spec:** .ai/specs/2026-10-30-workload-identity-federation.md
**Research:** .ai/research/workload-identity-federation.md
**Closest sibling:** API key (`api-keys*.tsx`, `ui/ApiKeys/`, `packages/ee/src/api-keys.server.ts`)
**Branch:** naveenkash/identity-federation

## Progress
- [x] Task 1: Move the SSRF guard to `@carbon/lib`
- [x] Task 2: Add the `FEDERATION_ALLOW_PRIVATE_ISSUERS` env flag
- [x] Task 3: Migration, authz rule, backups and wipe entries, types
- [x] Task 4: ee federation models and pure matcher, with tests
- [x] Task 5: ee federation service (verify, exchange, authoring), with tests
- [x] Task 6: Token-exchange grant on `/token`
- [x] Task 7: Settings operations, list registry, paths, API key filter
- [x] Task 8: Settings UI (routes, table, form, sidebar, chooser modal)
- [x] Task 9: Docs page
- [x] Task 10: End-to-end check of mint and use, then browser verification

## Dependencies
- Task 3 needs a running local database (`pnpm db:migrate`).
- Task 5 needs Tasks 1, 2, 3 and 4.
- Task 6 needs Task 5.
- Task 7 needs Tasks 3 and 5.
- Task 8 needs Task 7.
- Tasks 1, 2 and 4 are independent of each other.
- Task 9 is independent of Tasks 6 to 8.

---

## Task 1: Move the SSRF guard to `@carbon/lib`

**Depends on:** none
**Files:**
- Create: `packages/lib/src/url-guard.server.ts` (the full content of the jobs file)
- Modify: `packages/jobs/src/workflows/actions/url-guard.ts` — replace the body with a re-export
- Modify: `packages/lib/package.json` — add the export and the `undici` dependency

**Steps:**
1. Copy `packages/jobs/src/workflows/actions/url-guard.ts` to `packages/lib/src/url-guard.server.ts`.
2. Replace the jobs file body with `export * from "@carbon/lib/url-guard.server";` under its SPDX header.
3. Add `"./url-guard.server": "./src/url-guard.server.ts"` to `packages/lib/package.json` `exports`.
4. Add `"undici"` to `packages/lib/package.json` `dependencies`, same version string as `packages/jobs/package.json`.
5. Run `pnpm install`.

If the jobs webhook tests fail because `undici` resolves to two instances, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib --filter=@carbon/jobs
pnpm --filter @carbon/jobs exec vitest run src/workflows/actions
# Expected: typecheck passes; url-guard.test.ts and webhook.test.ts pass
```

**Out of scope:** changing any guard behavior.

## Task 2: Add the `FEDERATION_ALLOW_PRIVATE_ISSUERS` env flag

**Depends on:** none
**Files:**
- Modify: `packages/env/src/schema.ts` — add the entry after `CONTROLLED_ENVIRONMENT`
- Modify: `packages/env/src/index.ts` — export the parsed boolean

**Steps:**
1. Add to the schema: `FEDERATION_ALLOW_PRIVATE_ISSUERS: { group: "core", description: "true to let identity federation trust an OIDC issuer on a private network (self-hosted)" }`.
2. In `index.ts`, add `export const FEDERATION_ALLOW_PRIVATE_ISSUERS = parseBoolean(getEnv("FEDERATION_ALLOW_PRIVATE_ISSUERS"), false);`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/env && pnpm --filter @carbon/env test
# Expected: pass
```

**Out of scope:** the deployment env files.

## Task 3: Migration, authz rule, backups and wipe entries, types

**Depends on:** none
**Files:**
- Create: the migration from `pnpm db:migrate:new federation-rule`
- Modify: `packages/database/src/authz/manifest.ts` — `federationRule` rule after `apiKeyRateLimit`
- Create: the generated authz migration
- Modify: `packages/jobs/src/backups/schema.ts` — add `"federationRule"` to `SECRET_TABLES` after `"apiKeyRateLimit"`
- Modify: `packages/database/src/datasets/wipe.ts` — add `"federationRule"` next to `"apiKey"`

**Steps:**
1. Run `pnpm db:migrate:new federation-rule`.
2. Write the SQL from the spec's Data Model section, with these conventions:
   1. `createdBy` and `updatedBy` reference `"user"("id")` inline, with no named constraint.
   2. Add an index on `"createdBy"`.
   3. Wrap `CREATE TYPE` in a `DO $$ … EXCEPTION WHEN duplicate_object` guard.
   4. Guard the `apiKey` FK with a `DO` block that checks `pg_constraint`.
   5. Schedule `federated-api-key-retention` at `41 4 * * *` with the `DO` block shape of `20261013191915_oee-tenancy-and-retention.sql:40-53`.
3. Add `federationRule: company("settings", { read: "settings_view" }),` to the manifest.
4. Run `pnpm db:migrate`.
5. Run `pnpm --filter @carbon/database authz migration federation-rule-rls`.
6. Run `pnpm run generate:types`.
7. Add the backups and wipe entries.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/authz
psql "$(grep -E '^DATABASE_URL' .env.local | cut -d= -f2-)" -c "select jobname from cron.job where jobname='federated-api-key-retention'"
# Expected: authz tests pass; 1 row
```

If `pnpm db:migrate` cannot reach the database, STOP and report. Do not rebuild the database.

**Out of scope:** any other `apiKey` column.

## Task 4: ee federation models and pure matcher, with tests

**Depends on:** none
**Files:**
- Create: `packages/ee/src/federation/models.ts`, `match.ts`, `index.ts`, `match.test.ts`
- Modify: `packages/ee/package.json` — exports `./federation` and `./federation.server`
- Copy from (precedent): `packages/ee/src/approvals/index.ts` (barrel shape)

**Steps:**
1. `models.ts`: `federationProviders` (the 5 enum values), `FEDERATION_PRESETS`, `SHARED_ISSUER_REQUIREMENTS`, `FEDERATION_LIMITS` (10 claim conditions, lifetime 5–60, default 15), and `federationRuleValidator` (zod, form fields as strings: `id?`, `name`, `provider`, `issuer`, `audience`, `subject?`, `claimConditions` as a JSON string, `scopes` as a JSON string, `tokenLifetimeMinutes`).
2. `match.ts`: `matchSubject`, `matchClaims`, `ruleRequirementErrors(rule)` (returns field errors), `FederationFailure` type.
3. `match.test.ts`: subject exact and prefix; bare `*`; claim match by string; numeric claim against a string condition; GitHub rule without `repository_owner_id`; Google rule with a prefix subject; a rule with neither subject nor claims.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/federation
# Expected: all tests pass
```

**Out of scope:** any network call.

## Task 5: ee federation service (verify, exchange, authoring), with tests

**Depends on:** Tasks 1, 2, 3, 4
**Files:**
- Create: `packages/ee/src/federation/service.server.ts`, `verify.server.ts`, `verify.test.ts`
- Copy from (precedent): `packages/ee/src/api-keys.server.ts`

**Steps:**
1. `verify.server.ts`: `verifySubjectToken(jwt, rule, deps)`. `deps.getKeySet(issuer)` returns a `jose` key-set function. The default resolver does discovery and `createRemoteJWKSet`, with `customFetch` through `outboundDispatcher` unless the env flag is on. It checks the header (`kid`, algorithm), `jwtVerify` (issuer, audience, 30 s tolerance), `exp − iat` ≤ 86400, `sub` present.
2. `service.server.ts`:
   1. `upsertFederationRule` and `deleteFederationRule`, each with `requireEntitlement(client, companyId, "API_KEYS")`.
   2. `checkFederationIssuer(issuer)`: `https`, port 443, no IP literal, and `checkOutboundUrl` unless the env flag is on.
   3. `exchangeFederatedToken({ ruleId, subjectToken }, deps?)`: the 8 steps of the spec.
   4. The `jti` check: `redis.set(key, "1", "EX", ttl, "NX")`. If it returns null, `redis.exists(key)` tells `jti_reused` from `replay_check_unavailable`.
   5. The exchange rate limit: `new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, "1 m"), prefix: "federation-exchange" })`, keyed by rule id.
3. `verify.test.ts` with `jose` `generateKeyPair` and `createLocalJWKSet`: valid token; wrong audience; wrong issuer; `HS256`; no `kid`; expired; lifetime over 24 h; no `sub`.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/federation && pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: pass
```

**Out of scope:** pasted key sets.

## Task 6: Token-exchange grant on `/token`

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/routes/_oauth+/token.tsx` — a branch before the `oauthClient` lookup
- Modify: `apps/erp/app/routes/[.]well-known.oauth-authorization-server.ts` — add the grant

**Steps:**
1. Read the form data once. If `grant_type` is the token-exchange URN, validate `client_id`, `subject_token`, `subject_token_type` with a separate zod schema.
2. Call `exchangeFederatedToken`. Map the result to the spec's `200`, `400` and `429` bodies.
3. Keep the existing validator and both existing grants unchanged.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
curl -s -X POST "$ERP_URL/token" -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange -d client_id=fedr_missing -d subject_token=x -d subject_token_type=urn:ietf:params:oauth:token-type:jwt
# Expected: {"error":"invalid_grant"}
```

**Out of scope:** the MCP OAuth grants.

## Task 7: Settings operations, list registry, paths, API key filter

**Depends on:** Tasks 3, 5
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — 3 operations after `revokeApiKey`
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — getters, paging, cache helper, `getApiKeys` filter
- Modify: `apps/erp/app/modules/settings/types.ts` — `FederationRule`
- Modify: `apps/erp/app/utils/list-registry/settings.server.ts` — `federationRulesList`
- Modify: `apps/erp/app/utils/path.ts` — `federationRule`, `federationRules`, `newFederationRule`, `deleteFederationRule`, `identityFederationDocs`
- Copy from (precedent): `createApiKey`, `updateApiKey`, `revokeApiKey`, `apiKeysList`

**Steps:**
1. `getApiKeys` adds `.is("federationRuleId", null)`.
2. `getFederationRule(client, id, companyId)` and `getFederationRules(client, companyId, args)` copy `getApiKey` and `getApiKeys`.
3. `invalidateFederatedKeyCaches(ruleId, companyId)` reads the minted key hashes with the service role and busts each one.
4. `createFederationRule`, `updateFederationRule`, `deleteFederationRule` with `permission: { update: "users" }`. Update and delete bust the minted keys' caches. Delete busts before and after.
5. `federationRulesList` copies `apiKeysList`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: pass
```

**Out of scope:** MCP exposure of the new operations (no `@mcp` tag).

## Task 8: Settings UI

**Depends on:** Task 7
**Files:**
- Create: `apps/erp/app/routes/x+/settings+/federation.tsx`, `federation.new.tsx`, `federation.$id.tsx`, `federation.delete.$id.tsx`
- Create: `apps/erp/app/modules/settings/ui/Federation/FederationRuleForm.tsx`, `FederationRulesTable.tsx`, `index.ts`
- Create: `apps/erp/app/modules/settings/ui/ApiKeys/ApiKeyChooser.tsx`
- Modify: `apps/erp/app/modules/settings/ui/index.ts`, `ui/ApiKeys/ApiKeysTable.tsx`, `ui/useSettingsSubmodules.tsx`
- Copy from (precedent): the 4 `api-keys*.tsx` routes, `ApiKeysForm.tsx`, `ApiKeysTable.tsx`

**Steps:**
1. Copy each API key route to its federation twin. Swap the service calls and paths.
2. Build `FederationRuleForm` from `ApiKeysForm`: provider `Select`, `Input` fields, claim condition rows, `Number` lifetime, `PermissionMatrix`. Hidden `claimConditions` and `scopes` JSON.
3. On edit, show the Usage block and the last exchange and failure.
4. Build `FederationRulesTable` from `ApiKeysTable` with the spec's columns.
5. Add the sidebar entry after API Keys.
6. Change the API Keys **New** button to open `ApiKeyChooser`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: pass
```

**Out of scope:** the API key form itself.

## Task 9: Docs page

**Depends on:** none
**Files:**
- Create: `docs/content/docs/building/identity-federation.mdx`
- Modify: `docs/content/docs/building/meta.json`, `docs/content/docs/building/api-keys.mdx` (one link)

**Steps:**
1. Write the page: what it is, setup, one exchange example per provider, limits, errors.
2. Add `"identity-federation"` after `"api-keys"` in `meta.json`.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: pass
```

**Out of scope:** the changelog.

## Task 10: End-to-end check of mint and use, then browser verification

**Depends on:** Tasks 6, 8
**Steps:**
1. Write a scratch script under `.context/` that calls `exchangeFederatedToken` with an injected key set against the local database. Then call `$ERP_URL/api/v1/…` with the minted key.
2. Check: in-scope call `200`, out-of-scope `403`, replay `invalid_grant`, rule delete makes the key `401`.
3. Run `/test` on the settings UI: create, edit, delete a rule; the chooser modal; the API Keys list hides minted keys.

**Verify:** the script prints each check as PASS, and `/test` passes every flow.

**Out of scope:** a public issuer from CI.
