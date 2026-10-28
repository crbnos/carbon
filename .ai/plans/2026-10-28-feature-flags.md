# Feature flags — implementation plan

**Spec:** .ai/specs/2026-10-28-feature-flags.md
**Research:** .ai/research/2026-10-28-feature-flags.md
**Closest sibling:** the OTEL exporter config (`packages/logger/src/tracing.server.ts`); for the hook, `apps/erp/app/hooks/useFlags.tsx`
**Branch:** `feat/feature-flags` (worktree `../carbon-feature-flags`)

## Progress
- [x] Task 1: Create the branch worktree
- [x] Task 2: Add the OpenFeature dependencies and exports
- [x] Task 3: Add the two environment variables
- [x] Task 4: Add the flag registry
- [x] Task 5: Build the provider and its tests
- [x] Task 6: Build the Redis flags store and its test
- [x] Task 7: Start the provider in the ERP and MES entries
- [x] Task 8: Send browser flags and extend `useFlags`
- [x] Task 9: Put Settings → Companies behind `multi-company-management`
- [x] Task 10: Put integration early access behind `integration-early-access`
- [x] Task 11: Add the `flags-through-env` check
- [x] Task 12: Pass the variables in deploy config and `ci/src/deploy.ts`
- [x] Task 13: Update the docs and AGENTS files
- [x] Task 14: Run every gate and verify in the browser

## Changes during the build
- Task 6: the Redis store has no unit test. `test-mocks-own-module` refuses `vi.mock("./client")`, and `.claude/rules/testing.md` treats glue as covered by typecheck.
- Task 8: `no-duplicated-app-file` refuses a `useFlags.tsx` in both apps. The hook is `useFeatureFlags()` in `@carbon/react`. The ERP `useFlags` returns its `feature`; the MES has no hook of its own.
- Task 12: `ci/src/deploy.ts` caps the document at 32 KiB, because an ECS task definition is at most 64 KiB. `ci` has no tsconfig, so esbuild only checks that the file parses.
- Task 14: no dev stack runs for this worktree, so no browser test ran. The MES production build loads, and its flags provider starts from a `data:` endpoint.

## Dependencies
Task 1 first. Task 2 before Tasks 4–6. Task 3 before Task 5. Tasks 5 and 6
before Task 7. Task 7 before Tasks 8–10. Tasks 11, 12 and 13 are independent
of Tasks 8–10. Task 14 is last.

---

## Task 1: Create the branch worktree

**Depends on:** none
**Files:**
- Create: `../carbon-feature-flags` (git worktree)

**Steps:**
1. Run `git worktree add ../carbon-feature-flags -b feat/feature-flags main` from the main checkout.
2. Copy the spec, research and plan files into the same paths in the worktree.
3. Run `pnpm install` in the worktree.

**Verify:**
```bash
git -C ../carbon-feature-flags branch --show-current
# Expected: feat/feature-flags
```

**Out of scope:** the main checkout. Commit nothing there.

## Task 2: Add the OpenFeature dependencies and exports

**Depends on:** 1
**Files:**
- Modify: `pnpm-workspace.yaml` — add to `catalog:`: `"@openfeature/core": 1.12.0`, `"@openfeature/server-sdk": 1.23.0`, `"@openfeature/flagd-core": 5.0.0`.
- Modify: `packages/env/package.json` — add the 3 packages as `"catalog:"` dependencies. Add the exports `"./flags": "./src/flags.ts"` and `"./flags.server": "./src/flags.server.ts"`.
- Copy from (precedent): the `"./push.server"` export in the same file.

**Steps:**
1. Edit the two files.
2. Run a bare `pnpm install`. Never use `--filter`, because it prunes the lockfile.
3. Check `git diff --stat pnpm-lock.yaml`. It must show added lines only for the 3 packages and their dependencies.

**Verify:**
```bash
pnpm --filter @carbon/env exec node -e "require.resolve('@openfeature/flagd-core')" && echo ok
# Expected: ok
```

**Out of scope:** any other package's dependencies.

## Task 3: Add the two environment variables

**Depends on:** 1
**Files:**
- Modify: `packages/env/src/schema.ts` — add after `SYSTEM_STATUS_URL`:
  - `CARBON_FLAGS_ENDPOINT`: `{ group: "core", description: "URL of the feature flags document: https:, data: or file:", type: url }`
  - `CARBON_FLAGS_HEADERS`: `{ group: "core", description: "Headers for CARBON_FLAGS_ENDPOINT, as k=v pairs separated by commas (OTEL format)", secret: true }`
- Modify: `packages/env/src/index.ts` — add `export const CARBON_FLAGS_ENDPOINT = getEnv("CARBON_FLAGS_ENDPOINT");` and the same for `CARBON_FLAGS_HEADERS`, after `SYSTEM_STATUS_URL`.

**Verify:**
```bash
pnpm --filter @carbon/env test
# Expected: all tests pass
```

**Out of scope:** `getBrowserEnv()`. Neither variable goes to the browser.

## Task 4: Add the flag registry

**Depends on:** 2
**Files:**
- Create: `packages/env/src/flags.ts`

**Steps:**
1. Write the SPDX header with `pnpm --filter @carbon/checks license-headers` after the file exists.
2. Export `FLAGS` with the 2 v1 entries (spec section 10), `as const`.
3. Export the types `FlagKey`, `FlagValue<K>` (boolean, string or number from `type`), `BrowserFlagKey` (keys with `browser: true`) and `BrowserFlags` (`Partial<Record<BrowserFlagKey, …>>`).
4. Export `flagDefault(key)`, which returns `FLAGS[key].default`.
5. Import nothing from `.server` files and nothing from `node:*`. This file reaches the browser.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/env --concurrency=1
# Expected: Tasks: 1 successful
```

## Task 5: Build the provider and its tests

**Depends on:** 2, 3, 4
**Files:**
- Create: `packages/env/src/flags.server.ts`
- Create: `packages/env/src/flags.server.test.ts`
- Copy from (precedent): the tested scratch provider `nodeflags/provider.ts` in the session scratchpad. Rewrite it for the three layers below.

**Steps:**
1. Export `parseHeaders(raw)`. Skip a pair with no `=` or a bad `%` sequence, log it, and never throw.
2. Export the type `FlagsStore`:
   ```ts
   export type StoredFlags = { body: string; etag: string; fetchedAt: number };
   export type FlagsStore = {
     readMeta(scope: string): Promise<Pick<StoredFlags, "etag" | "fetchedAt"> | null>;
     readBody(scope: string): Promise<string | null>;
     write(scope: string, value: Partial<StoredFlags> & { fetchedAt: number }): Promise<void>;
     tryLease(scope: string): Promise<{ status: "acquired"; release: () => Promise<void> } | { status: "held" } | { status: "unavailable" }>;
   };
   ```
3. Export `CarbonFlagsProvider`, an OpenFeature `Provider` (`runsOn = "server"`). Implement the behavior list in spec section 3, steps 1–11, exactly.
4. Compute `scope` as the first 16 hex characters of `sha256(endpoint + "\n" + headers)`.
5. Use these constants: sync 10 s, source 60 s, jitter ± 20%, fetch timeout 5 s, boot wait 2 s, lease 10 s, body cap 1 MB.
6. Add `tenancy` (`SINGLE_TENANT ? "single" : "multi"`) and `edition` (`CarbonEdition`) to every evaluation context.
7. Export `initFlags({ store, waitUntil })`. It reads `CARBON_FLAGS_ENDPOINT` and `CARBON_FLAGS_HEADERS` from `./index`, builds the provider and calls `OpenFeature.setProviderAndWait`. A second call does nothing.
8. Export `flags.bool`, `flags.string`, `flags.number`. Each takes `(key, { companyId, userId? })`, takes the default from `FLAGS`, and never throws.
9. Export `evaluateBrowserFlags({ companyId, userId })`. It returns `BrowserFlags` for every key with `browser: true`.
10. Export `flagStatus()`, which returns `{ confirmedAt, lastError }`.
11. Write one test per acceptance criterion of the provider in the spec. Use a local `node:http` server and an in-memory `FlagsStore`. Cover these cases:
    - unset endpoint
    - company targeting, user targeting, `tenancy` and `edition`
    - ETag and `304`
    - the header parse
    - the 1 MB cap
    - boot that waits at most 2 s with an empty store and does not wait with a filled store
    - 5 providers on one store, with at most 1 source request
    - a store write that reaches a second provider
    - an unavailable store
    - a `data:` endpoint that never fetches again
    - one archived-flag warning per key
12. Run the license-header fixer.

If `vi.useFakeTimers` blocks the local server, STOP and report — do not improvise.

**Verify:**
```bash
pnpm --filter @carbon/env test -- flags.server
# Expected: every flags.server test passes
```

**Out of scope:** Redis. This package must not import `@carbon/kv`.

## Task 6: Build the Redis flags store and its test

**Depends on:** 5
**Files:**
- Create: `packages/kv/src/flags-store.ts`
- Create: `packages/kv/src/flags-store.test.ts`
- Modify: `packages/kv/src/index.ts` — export `redisFlagsStore`.
- Copy from (precedent): `packages/kv/src/lease.ts` and `lease.test.ts`.

**Steps:**
1. Import the type `FlagsStore` from `@carbon/env/flags.server`.
2. Implement it on the hash `flags:<scope>`: `readMeta` is `HMGET etag fetchedAt`, `readBody` is `HGET body`, and `write` is one `HSET`.
3. Implement `tryLease` with `acquireLease("flags:<scope>:refresh", 10_000)` and `releaseLease`.
4. Test it with `ioredis-mock`, the way `lease.test.ts` does.

**Verify:**
```bash
pnpm --filter @carbon/kv test -- flags-store
# Expected: every flags-store test passes
```

## Task 7: Start the provider in the ERP and MES entries

**Depends on:** 5, 6
**Files:**
- Modify: `apps/erp/app/entry.server.tsx`, `apps/mes/app/entry.server.tsx`

**Steps:**
1. Import `initFlags` from `@carbon/env/flags.server` and `redisFlagsStore` from `@carbon/kv`.
2. At module level, after the tracing setup, call `void initFlags({ store: redisFlagsStore, waitUntil })`. `waitUntil` is already imported from `@vercel/functions`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1 && pnpm exec turbo run typecheck --filter=mes --concurrency=1
# Expected: both successful
```

## Task 8: Send browser flags and extend `useFlags`

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/routes/x+/_layout.tsx`, `apps/mes/app/routes/x+/_layout.tsx` — add `flags: await evaluateBrowserFlags({ companyId, userId })` to the `data({ … })` return.
- Modify: `apps/erp/app/hooks/useFlags.tsx` — add `feature(key: BrowserFlagKey)`. It reads `flags` with `useRouteData(path.to.authenticatedRoot)` and falls back to `flagDefault(key)`.
- Create: `apps/mes/app/hooks/useFlags.tsx` — the same `feature(key)`. Read the MES layout data the way `apps/mes/app/hooks/useUser.tsx` does.
- Copy from (precedent): `apps/erp/app/hooks/useFlags.tsx`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1 && pnpm exec turbo run typecheck --filter=mes --concurrency=1
# Expected: both successful
```

**Out of scope:** `shouldRevalidate`. Do not change it.

## Task 9: Put Settings → Companies behind `multi-company-management`

**Depends on:** 8
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/companies.tsx`, `companies.$id.tsx`, `companies.delete.$id.tsx`
- Modify: `apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx`

**Steps:**
1. In each loader and action, replace `if (!isInternalEmail(email))` with `if (!isInternalEmail(email) && !(await flags.bool("multi-company-management", { companyId, userId })))`.
2. Get `companyId` and `userId` from the `requirePermissions` result that each route already has.
3. In `useSettingsSubmodules`, hide `path.to.companies` only when `!isInternal && !feature("multi-company-management")`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: successful
```

## Task 10: Put integration early access behind `integration-early-access`

**Depends on:** 7
**Files:**
- Modify: `packages/ee/src/plan.server.ts` — `hasIntegrationEarlyAccess({ companyId, userId })` returns `flags.bool("integration-early-access", { companyId, userId })`. Delete `isListedUserId` if nothing else calls it.
- Modify: `apps/erp/app/modules/settings/settings.service.ts` (`isIntegrationInstallWithheld`) and `apps/erp/app/routes/x+/settings+/integrations.tsx` — pass `{ companyId, userId }` and `await` the result.
- Modify: `packages/env/src/schema.ts`, `packages/env/src/index.ts` — remove `INTEGRATION_EARLY_ACCESS_USER_IDS`.

**Steps:**
1. Run `grep -rn "INTEGRATION_EARLY_ACCESS_USER_IDS\|hasIntegrationEarlyAccess\|isListedUserId" apps packages` first. Change every hit.
2. Keep `isIntegrationComingSoon` and `plan.test.ts` unchanged.

**Verify:**
```bash
pnpm --filter @carbon/ee test && pnpm exec turbo run typecheck --filter=@carbon/ee --concurrency=1
# Expected: tests pass, typecheck successful
```

## Task 11: Add the `flags-through-env` check

**Depends on:** 1
**Files:**
- Create: `packages/checks/src/conformance/flags-through-env.ts`, `flags-through-env.test.ts`
- Modify: `packages/checks/src/index.ts`, `packages/checks/src/run.ts` — register the check.
- Copy from (precedent): `packages/checks/src/conformance/no-integration-id-branching.ts` and its test.

**Steps:**
1. Flag any import of `@openfeature/` in a TypeScript file outside `packages/env/`.
2. Name the fix in the message: "Read flags with `flags.*` from `@carbon/env/flags.server`."

**Verify:**
```bash
pnpm --filter @carbon/checks test -- flags-through-env
# Expected: the test passes
```

## Task 12: Pass the variables in deploy config and `ci/src/deploy.ts`

**Depends on:** 3
**Files:**
- Modify: `.env.example` — 2 commented lines after `SYSTEM_STATUS_URL`.
- Modify: `contrib/deploying/simple-docker-caddy/docker-compose.prod.yml` — `CARBON_FLAGS_ENDPOINT: ${CARBON_FLAGS_ENDPOINT:-}` and the same for the headers, in both services.
- Modify: `sst.config.ts` — forward `CARBON_FLAGS_ENDPOINT` in both environment blocks, next to `SYSTEM_STATUS_URL`.
- Modify: `ci/src/deploy.ts` — add `flags_endpoint` and `flags_token` (both `string | null`) to `Workspace`.

**Steps:**
1. In `ci/src/deploy.ts`, before the `$$` env object, fetch `flags_endpoint` with `Authorization: Bearer <flags_token>` when `flags_endpoint` is set.
2. Use a 10 s timeout and a 1 MB cap. On any failure, throw, so this workspace's deploy fails.
3. Pass `CARBON_FLAGS_ENDPOINT: "data:application/json;base64," + base64(body)` in the env object.

If the `workspaces` table has no `flags_endpoint` column, add the field to the type anyway. STOP and report that the CI database needs the 2 columns — do not create them.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=ci --concurrency=1
# Expected: successful
```

## Task 13: Update the docs and AGENTS files

**Depends on:** 10
**Files:**
- Modify: `.claude/rules/environment-configuration.md` — a "Feature flags" paragraph after "Maintenance and status". Remove `INTEGRATION_EARLY_ACCESS_USER_IDS`.
- Modify: `packages/env/AGENTS.md` — the flags exports, the registry and the lifecycle.
- Modify: `packages/kv/AGENTS.md` if it exists — `redisFlagsStore`.
- Modify: `.claude/rules/onshape-panel.md`, `packages/ee/AGENTS.md` — replace `INTEGRATION_EARLY_ACCESS_USER_IDS` with the `integration-early-access` flag.

**Verify:**
```bash
grep -rn "INTEGRATION_EARLY_ACCESS_USER_IDS" apps packages .claude --include=*.ts --include=*.tsx --include=*.md
# Expected: no output
```

## Task 14: Run every gate and verify in the browser

**Depends on:** all
**Steps:**
1. Run `pnpm --filter @carbon/checks license-headers`.
2. Run the typechecks one at a time: `@carbon/env`, `@carbon/kv`, `@carbon/ee`, `@carbon/checks`, `erp`, `mes`, `ci`.
3. Run the tests: `@carbon/env`, `@carbon/kv`, `@carbon/ee`, `@carbon/checks`.
4. Run `pnpm run lint`.
5. Run `pnpm --filter @carbon/checks start` and confirm the new check reports no violation.
6. If a dev stack runs, use `/test` with no `CARBON_FLAGS_ENDPOINT`. A user with a Carbon email opens Settings → Companies. Then set a `data:` endpoint that turns `multi-company-management` on for the company, and confirm the page for a user without a Carbon email.

**Verify:**
```bash
pnpm run lint
# Expected: no errors
```

**Out of scope:** the console, the CSA dashboard and the byoc repo.
