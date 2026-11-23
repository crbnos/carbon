# Product Lines and Agent Members (Phase 1) — implementation plan

**Spec:** .ai/specs/2026-10-31-product-lines-and-agents.md
**Research:** N/A. The spec cites the code it rests on. The Managed Agents facts come from the `claude-api` skill.
**Closest sibling:** planning group (product line); the Linear integration (GitHub integration). An agent run has no sibling.
**Branch:** projects-port-main-v1

Scope: Phase 1 of the spec only. Phases 2 to 5 get their own plans.

## Progress
- [ ] Task 1: Write the Phase 1 migration
- [ ] Task 2: Add the authz rules and ship them
- [ ] Task 3: Generate the types
- [ ] Task 4: Add the `AGENTS` feature
- [ ] Task 5: Let an API key act as its `userId`
- [ ] Task 6: Product line service functions
- [ ] Task 7: Product line settings pages
- [ ] Task 8: Product line select on projects and parts
- [ ] Task 9: Agent users
- [ ] Task 10: The agent run engine in `packages/ee`
- [ ] Task 11: The `agents` ERP module
- [ ] Task 12: Queue a run when an element gets an agent owner
- [ ] Task 13: Add `@anthropic-ai/sdk` (approval gate)
- [ ] Task 14: The `anthropic` integration
- [ ] Task 15: One vault for each agent key
- [ ] Task 16: The `github` integration and its webhook
- [ ] Task 17: The agent Inngest functions
- [ ] Task 18: Settings → Agents page and the element Runs panel
- [ ] Task 19: Cross-company RLS test
- [ ] Task 20: Browser verification

## Dependencies
- Task 2 and Task 3 need Task 1.
- Tasks 4 to 9 need Task 3. Tasks 4, 5, 6 and 9 are independent of each other.
- Task 7 and Task 8 need Task 6.
- Task 10 needs Task 3 and Task 4.
- Task 11 needs Task 10. Task 12 needs Task 11 and Task 9.
- Task 13 needs a yes from the user. Task 14, Task 15 and Task 17 need Task 13.
- Task 15 needs Task 11 and Task 14. Task 16 needs Task 11.
- Task 17 needs Task 14, Task 15 and Task 16.
- Task 18 needs Task 11 and Task 14. Task 19 needs Task 2. Task 20 needs all tasks.

## Read first

Read these before Task 1. Every task assumes them.

- `.ai/lessons.md` (search it for `apiKey`, `authz`, `integration`, `inngest`, `migration`)
- `.claude/rules/workflow-database-migration.md`, `.claude/rules/conventions-database.md`, `.claude/rules/authz-manifest.md`
- `.claude/rules/conventions-services.md`, `.claude/rules/module-files.md`, `.claude/rules/commercial-licensing.md`
- `.claude/rules/conventions-forms.md`, `packages/form/AGENTS.md`
- `apps/erp/app/modules/projects/AGENTS.md`, `apps/erp/app/modules/settings/AGENTS.md`

---

## Task 1: Write the Phase 1 migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_product-lines-and-agents.sql` (from `pnpm db:migrate:new`)
- Copy from (precedent): `packages/database/supabase/migrations/20261021000300_projects-workspace.sql` (table shape, composite FKs, indexes)

**Steps:**
1. Run `pnpm db:migrate:new product-lines-and-agents`.
2. Write the `productLine` table exactly as the spec "Data Model Changes → Phase 1" shows it.
3. Add the indexes `productLine_companyId_idx` and one index on each FK column (`ownerId`, `createdBy`, `updatedBy`).
4. Add `"productLineId" TEXT` to `project` and to `item`.
5. Add the composite FK `("productLineId", "companyId") REFERENCES "productLine"("id", "companyId") ON DELETE SET NULL ("productLineId")` to each one.
6. Add an index on `"productLineId"` to each one.
7. Add `"isAgent" BOOLEAN NOT NULL DEFAULT false`, `"agentOwnerId" TEXT REFERENCES "user"("id")` and `"agentVaultId" TEXT` to `user`.
8. Write the trigger function `refuse_second_company_for_agent()`. It raises `'An agent user belongs to exactly one company'` when a `userToCompany` insert names a user with `"isAgent" = true` that already has a `userToCompany` row.
9. Attach it as `BEFORE INSERT ON "userToCompany" FOR EACH ROW`.
10. Add `"userId" TEXT REFERENCES "user"("id") ON DELETE CASCADE` to `apiKey`, with an index.
11. Create the enums `agentRunStatus` and `agentRunMode` as the spec shows them.
12. Create `agentRun` as the spec shows it, with `projectElementId` nullable and the `kind` and `prompt` columns.
13. Add `CHECK ("kind" IN ('Task', 'Orchestrator'))` and `CHECK ("kind" = 'Orchestrator' OR "projectElementId" IS NOT NULL)`.
14. Add the composite FKs to `projectElement` (ON DELETE CASCADE) and to `productLine` (ON DELETE SET NULL).
15. Add indexes on `companyId`, `status`, `agentUserId`, `projectElementId`, `productLineId` and `createdBy`.
16. Create `agentSettings` as the spec shows it.
17. Guard every statement with `IF NOT EXISTS` or `DROP ... IF EXISTS`.
18. Write no `CREATE POLICY`. Task 2 owns the policies.

**Verify:**
```bash
pnpm db:migrate
# Expected: the migration applies with no error; authz sync then fails on the three new tables with no rule (Task 2 fixes this).
grep -c "CREATE POLICY" packages/database/supabase/migrations/*_product-lines-and-agents.sql
# Expected: 0
```

If `pnpm db:migrate` cannot reach the local database, STOP and report. Do not rebuild the database.

**Out of scope:** `fact`, `observation`, `outboundMessage`, `factConsumer` (Phases 2 and 3).

---

## Task 2: Add the authz rules and ship them

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/authz/manifest.ts` — three new rules
- Create: the generated authz migration
- Copy from (precedent): the `planningGroup: company("projects")` and `apiKey: company("settings", { read: "settings_view" })` rules in `manifest.ts`

**Steps:**
1. Add `productLine: company("settings")` beside the other rules, in alphabetical order.
2. Add `agentRun: company("projects")`.
3. Add `agentSettings: company("settings", { read: "settings_view" })`.
4. Run `pnpm db:migrate` so authz sync applies the rules.
5. Run `pnpm --filter @carbon/database authz migration product-lines-and-agents-rls`.
6. Run `pnpm db:check:backups`. If it names a table, add the entry it asks for in `packages/jobs/src/backups/`.

**Verify:**
```bash
pnpm --filter @carbon/database test -- migration
# Expected: migration.test.ts passes (no unshipped rules)
```

**Out of scope:** changes to the bespoke `user` rule.

---

## Task 3: Generate the types

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/src/types.ts` (generated)

**Steps:**
1. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -c '"agentRun"\|"productLine"\|"agentSettings"' packages/database/src/types.ts
# Expected: a number greater than 0
```

---

## Task 4: Add the `AGENTS` feature

**Depends on:** Task 3
**Files:**
- Modify: `packages/ee/src/plan.ts` — add `AGENTS: [Plan.Business, Plan.Partner]` to `FEATURE_PLANS`, beside `WORKFLOWS`

**Steps:**
1. Add the entry.
2. Add `AGENTS` to every exhaustive map that the type checker names.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: no errors
```

---

## Task 5: Let an API key act as its `userId`

**Depends on:** Task 3
**Files:**
- Modify: `packages/auth/src/services/api-key.server.ts` — select `userId` beside `createdBy` (line 67); add `userId: string | null` to the record type (line 31)
- Modify: `packages/auth/src/services/auth.server.ts` — set `const userId = apiKeyData.userId ?? apiKeyData.createdBy;` (the `carbon-key` branch of `requirePermissions`)
- Modify: `packages/auth/src/services/api-key-cache.test.ts` — add `userId` to the fixtures
- Modify: `packages/ee/src/api-keys.server.ts` — accept an optional `userId` on create in `upsertApiKey` and insert it

**Steps:**
1. Make the four edits.
2. Add a test in `api-key-cache.test.ts`: a record with `userId: "agent1"` and `createdBy: "u1"` resolves to `agent1`.
3. Keep `createdBy` as the person who made the key.

**Verify:**
```bash
pnpm --filter @carbon/auth test
# Expected: all tests pass, including the new one
pnpm exec turbo run typecheck --filter=@carbon/auth --filter=@carbon/ee
# Expected: no errors
```

**Out of scope:** the OAuth path (`oauthContext`). An agent never holds an OAuth token.

---

## Task 6: Product line service functions

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `productLineValidator`
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — `getProductLines`, `getProductLine`, `getProductLinesList`, `upsertProductLine`, `deactivateProductLine`
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — one `defineServiceFn` for each
- Copy from (precedent): `getPlanningGroups`, `getPlanningGroup`, `getPlanningGroupsList` in `apps/erp/app/modules/projects/projects.server.ts` (line 4978) and their building blocks in `projects.service.ts`

**Steps:**
1. Write `productLineValidator`: `id` optional, `name` required, `code` required (uppercase, 2 to 10 letters), `itemPrefix` optional (1 to 4 letters), `ownerId`, `repositoryUrl` (an `https://github.com/` URL) and `repositoryPath`, all optional.
2. Write the building blocks. Each one takes `client` first, scopes by `companyId`, and returns `{ data, error }`.
3. Write the operations. Reads use `permission: { view: "settings" }`. Writes use `{ create: "settings" }` or `{ update: "settings" }`.
4. Tag the reads `@mcp read`. Tag `deactivateProductLine` as the module tags its other state changes.
5. Return a `validation` error when `code` is already in use in the company.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm generate:mcp && grep -c "settings_getProductLines" apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json
# Expected: 1
```

---

## Task 7: Product line settings pages

**Depends on:** Task 6
**Files:**
- Create: `apps/erp/app/routes/x+/settings+/product-lines.tsx`, `product-lines.new.tsx`, `product-lines.$id.tsx`, `product-lines.deactivate.$id.tsx`
- Create: `apps/erp/app/modules/settings/ui/ProductLines/ProductLinesTable.tsx`, `ProductLineForm.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `productLines`, `newProductLine`, `productLine(id)`, `deactivateProductLine(id)`
- Modify: `apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx` — a "Product Lines" entry beside "API Keys"
- Copy from (precedent): `apps/erp/app/routes/x+/projects+/planning-groups.tsx`, `planning-groups.new.tsx`, `planning-groups.$id.tsx`, `planning-groups.delete.$id.tsx`, and `apps/erp/app/modules/projects/ui/PlanningGroups/PlanningGroupsTable.tsx`, `PlanningGroupForm.tsx`

**Steps:**
1. Copy each precedent file to its new path.
2. Rename every planning-group identifier to its product-line name.
3. Use the fields of `productLineValidator`. The owner field is an employee select.
4. Replace delete with deactivate. A product line that projects or items use must stay readable.
5. Use `requirePermissions` with `view: "settings"` in loaders and `create` or `update: "settings"` in actions.
6. Wrap every user-facing string in the locale macro the precedent uses.
7. Run the license-header fixer on the new files.

**Verify:**
```bash
pnpm --filter @carbon/checks license-headers && pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** a plan gate. Product lines are open core.

---

## Task 8: Product line select on projects and parts

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — `productLineId` optional in `projectValidator` (line 184)
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx` — a Product Line select
- Modify: `apps/erp/app/modules/items/items.models.ts` — `productLineId` optional in `itemValidator` (line 178)
- Modify: `apps/erp/app/modules/items/ui/Parts/PartForm.tsx` — a Product Line select
- Modify: the `createProject`, `upsertProject` and `updateProject` operations (`projects.server.ts` lines 239, 295, 332) and the part upsert — pass `productLineId` through
- Copy from (precedent): the planning group select in `ProjectForm.tsx`

**Steps:**
1. Add the field to each validator.
2. Load the options from `settings_getProductLinesList`.
3. Add the select to each form, after the field the precedent select follows.
4. Pass the value through each operation.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm --filter erp test -- projects
# Expected: no errors; the project tests pass
```

**Out of scope:** tools, materials and consumables forms. Phase 1 covers parts only.

---

## Task 9: Agent users

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/users/users.models.ts` — `agentUserValidator`
- Modify: `apps/erp/app/modules/users/users.service.ts` — `createAgentAccount`, `getAgentUsers`
- Modify: `apps/erp/app/modules/users/users.server.ts` — `createAgentUser`, `getAgentUsers`
- Modify: `apps/erp/app/modules/users/ui/Employees/EmployeesTable.tsx` — an "Agent" badge
- Copy from (precedent): `inviteEmployee` (`users.server.ts` line 70) and `createEmployeeAccount` (`users.service.ts` line 1138)

**Steps:**
1. Write `agentUserValidator`: `code` (lowercase letters and hyphens, e.g. `sourcing`), `name`, `employeeType`, `ownerId`.
2. Write `createAgentAccount(client, db, input)`. It makes no auth account and sends no invite.
3. Make the user id with `id('user')`. Set `email` to `<code>@agents.invalid`, `firstName` to `Agent`, `lastName` to `name`, `isAgent` to true, `agentOwnerId` to `ownerId`.
4. Insert the `user`, `userToCompany` (`role: 'employee'`) and `employee` rows in one Kysely transaction.
5. Refuse an `employeeType` from another company, as `createEmployeeAccount` does.
6. Write the operation `createAgentUser` with `permission: { create: "users" }`.
7. Write `getAgentUsers` with `permission: { view: "users" }`, tagged `@mcp read`.
8. Show the badge in `EmployeesTable.tsx` when `isAgent` is true. Hide the resend-invite and reset-password actions for those rows.
9. Add tests in `apps/erp/app/modules/users/users.server.test.ts`. A second company for an agent user fails with the trigger message. An agent user has no `auth.users` row.

If the `employee` view or a picker query filters on an auth column, STOP and report. Do not improvise.

**Verify:**
```bash
pnpm --filter erp test -- users.server
# Expected: all tests pass, including the two new ones
```

**Out of scope:** timesheets and notifications for agents (a later plan).

---

## Task 10: The agent run engine in `packages/ee`

**Depends on:** Task 3, Task 4
**Files:**
- Create: `packages/ee/src/agents/runs.server.ts`, `packages/ee/src/agents/runs.server.test.ts`, `packages/ee/src/agents/types.ts`
- Modify: `packages/ee/package.json` — export `"./agents.server": "./src/agents/runs.server.ts"`
- Copy from (precedent): `packages/ee/src/pegging/server.ts` (a commercial building block with `requireEntitlement`)

**Steps:**
1. Write `queueAgentRun(client, { companyId, projectElementId, agentUserId, kind, productLineId, createdBy })`.
2. In it, call `requireEntitlement(client, companyId, "AGENTS")` first.
3. Refuse an `agentUserId` whose `user."isAgent"` is false.
4. Set `mode` to `Push` when `agentSettings.pushEnabled` is true, else `Pull`.
5. Refuse a second open run (`Queued`, `Claimed` or `Running`) for the same element and agent.
6. Write `claimAgentRun(db, { companyId, claimedBy })` in Kysely. Select one `Pull` run in `Queued`, oldest first, `FOR UPDATE SKIP LOCKED`.
7. Set `status = 'Claimed'`, `claimedBy`, and `claimExpiresAt` to now plus 30 minutes. Return the run and its `prompt`.
8. Write `reportAgentRun(client, { companyId, id, status, branch, pullRequestUrl, summary, error, costCents, inputTokens, outputTokens })`.
9. In it, add a `projectElementComment` with the summary and the PR link.
10. Write `cancelAgentRun`, `expireAgentRunClaims(db)` and `buildAgentPrompt({ readableId, workId, repositoryPath })`.
11. Make `buildAgentPrompt` return the first message from the spec Design Decisions ("What a push session is told").
12. Read the work id from `projectElement.customFields.work.id`. If it is missing, use the element `readableId`.
13. Write vitest tests for each function with a mocked client.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- agents
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: no errors
```

---

## Task 11: The `agents` ERP module

**Depends on:** Task 10
**Files:**
- Create: `apps/erp/app/modules/agents/agents.server.ts`, `agents.service.ts`, `agents.models.ts`, `types.ts`, `AGENTS.md`
- Modify: `apps/erp/app/modules/router.server.ts` — register the module
- Copy from (precedent): `apps/erp/app/modules/workflows/` (an AGPL module whose body lives in `packages/ee`)

**Steps:**
1. Write validators for each operation in `agents.models.ts`.
2. Write the operations in `agents.server.ts`. Each calls a function from `@carbon/ee/agents.server`.

| Operation | Permission | MCP tag |
|-----------|-----------|---------|
| `getAgentRuns` (filter by element, status, agent) | `view: "projects"` | `@mcp read` |
| `getAgentRun` | `view: "projects"` | `@mcp read` |
| `queueAgentRun` | `create: "projects"` | write |
| `claimAgentRun` | `update: "projects"` | write |
| `reportAgentRun` | `update: "projects"` | write |
| `cancelAgentRun` | `update: "projects"` | write |
| `getAgentSettings` | `view: "settings"` | `@mcp read` |
| `updateAgentSettings` | `update: "settings"` | write |
| `createAgentApiKey` | `create: "settings"` | none (not on MCP) |

3. Make `createAgentApiKey` create a key with `userId` = the agent user and `createdBy` = the caller. Return the raw key once.
4. Make `reportAgentRun` refuse a caller who is not the run agent user and not its `claimedBy` person.
5. Write `AGENTS.md`: the run lifecycle, the two modes, and the rule that the body lives in `packages/ee`.
6. Run the license-header fixer.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm generate:mcp && grep -o '"agents_[a-zA-Z]*"' apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json | sort -u
# Expected: agents_cancelAgentRun, agents_claimAgentRun, agents_getAgentRun, agents_getAgentRuns, agents_getAgentSettings, agents_queueAgentRun, agents_reportAgentRun, agents_updateAgentSettings
```

---

## Task 12: Queue a run when an element gets an agent owner

**Depends on:** Task 9, Task 11
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — `createProjectElement` (line 2179) and `updateProjectElementField` (line 2236)
- Modify: `apps/erp/app/modules/projects/projects.server.test.ts` or the nearest projects test file

**Steps:**
1. After a successful write that sets `ownerId`, read `user."isAgent"` for the new owner.
2. If it is true and `companyHasFeature(client, companyId, { feature: "AGENTS" })` is true, call `queueAgentRun`.
3. Do not fail the element write if queueing fails. Log the error with `logger.error`.
4. Add a test: an element assigned to an agent user gets one `Queued` run. Assigning it again does not add a second run.

**Verify:**
```bash
pnpm --filter erp test -- projects
# Expected: all tests pass, including the new one
```

**Out of scope:** bulk element imports (WBS CSV, MS Project XML).

---

## Task 13: Add `@anthropic-ai/sdk` (approval gate)

**Depends on:** a yes from the user

🛑 Root `AGENTS.md` puts a new production dependency in Ask First. If the user has not said yes in this conversation, STOP and ask.

**Files:**
- Modify: `pnpm-workspace.yaml` — add `'@anthropic-ai/sdk'` to `catalog:` at the newest version that is at least two weeks old
- Modify: `packages/ee/package.json` — `"@anthropic-ai/sdk": "catalog:"`

**Steps:**
1. Add the catalog entry.
2. Add the dependency.
3. Run `pnpm install`.

**Verify:**
```bash
pnpm --filter @carbon/ee exec node -e "require.resolve('@anthropic-ai/sdk')" && echo ok
# Expected: ok
```

---

## Task 14: The `anthropic` integration

**Depends on:** Task 13
**Files:**
- Create: `packages/ee/src/anthropic/config.tsx`, `packages/ee/src/anthropic/hooks.server.ts`, `packages/ee/src/anthropic/client.server.ts`
- Modify: `packages/ee/src/index.ts` — add `Anthropic` to the `integrations` array (line 58)
- Modify: `packages/ee/src/hooks.server.ts` — add `anthropic` to `serverHooks`
- Modify: `packages/ee/src/integrations/secrets.ts` — add `anthropic: ["apiKey"]` to `SECRET_KEYS`
- Copy from (precedent): `packages/ee/src/linear/config.tsx` and `packages/ee/src/linear/hooks.server.ts`

**Steps:**
1. Write `config.tsx` with `defineIntegration`: id `anthropic`, one `secret` setting `apiKey`, and setup text that says the company pays for all agent use.
2. Write `client.server.ts`: `getAnthropicClient(serviceClient, companyId)`. It reads the key with `resolveIntegrationSecrets`.
3. Write `anthropicOnInstall`. It calls `client.beta.environments.create` with `type: "cloud"` and `networking: { type: "limited", allow_package_managers: true, allow_mcp_servers: true }`.
4. Then it calls `client.beta.agents.create` with model `claude-opus-5-5`, the agent toolset with web fetch and web search off, and a system prompt that names the Carbon working rules.
5. It stores `environmentId`, `agentId` and `agentVersion` in `companyIntegration.metadata`.
6. Write `anthropicHealthcheck`. It calls `client.models.list()` and returns true on success.
7. Make `anthropicOnUninstall` set `agentSettings.pushEnabled` to false. It archives nothing.

Read the `claude-api` skill (TypeScript Managed Agents README and `shared/managed-agents-environments.md`) before Steps 3 and 4. Do not guess SDK names.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee && pnpm --filter @carbon/ee test -- integrations
# Expected: no errors; the secrets tests pass with the new key
```

---

## Task 15: One vault for each agent key

**Depends on:** Task 11, Task 14
**Files:**
- Create: `packages/ee/src/agents/vault.server.ts`
- Modify: `apps/erp/app/modules/agents/agents.server.ts` — `createAgentApiKey` calls it
- Modify: `apps/erp/app/modules/agents/agents.service.ts` — store the vault id

**Steps:**
1. Write `provisionAgentVault(serviceClient, { companyId, agentUserId, rawKey })`.
2. In it, create a vault with `client.beta.vaults.create`.
3. Add a `static_bearer` credential for the Carbon MCP URL (`${ERP_URL}/api/mcp`) with the raw key.
4. Add a `static_bearer` credential for the GitHub MCP URL with the token of the company `github` integration.
5. Store the vault id in `user."agentVaultId"`.
6. Skip all of this when the `anthropic` integration is not active. Pull mode needs no vault.

If the GitHub MCP URL is not in the `claude-api` skill or the GitHub docs, STOP and report. Do not guess it.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- agents && pnpm exec turbo run typecheck --filter=erp
# Expected: all tests pass; no errors
```

---

## Task 16: The `github` integration and its webhook

**Depends on:** Task 11
**Files:**
- Create: `packages/ee/src/github/config.tsx`, `packages/ee/src/github/hooks.server.ts`, `packages/ee/src/github/webhook.ts`, `packages/ee/src/github/webhook.test.ts`
- Create: `apps/erp/app/routes/api+/webhook.github.$companyId.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/github.ts`
- Modify: `packages/ee/src/index.ts`, `packages/ee/src/hooks.server.ts`, `packages/ee/src/integrations/secrets.ts` (`github: ["token", "webhookSigningSecret"]`)
- Modify: `packages/lib/src/trigger.ts` — `"sync-pull-request-from-github": "carbon/github-sync"` in `taskToEvent`
- Modify: `packages/jobs/src/inngest/functions/integrations/index.ts` — export the function
- Copy from (precedent): `packages/ee/src/linear/config.tsx`, `packages/ee/src/linear/lib/webhook.ts`, `apps/erp/app/routes/api+/webhook.linear.$companyId.ts`, `packages/jobs/src/inngest/functions/integrations/linear.ts`

**Steps:**
1. Write `config.tsx`: id `github`, a `secret` setting `token` (a fine-grained personal access token), and a generated `webhookSigningSecret`.
2. Write the setup text. It gives the webhook URL and asks for the `pull_request` and `check_run` events.
3. Write `githubHealthcheck`. It calls `GET https://api.github.com/user` with the token through `fetch`.
4. Write `verifyGithubWebhook(body, signatureHeader, secret)`. It checks `X-Hub-Signature-256` (HMAC SHA-256) with a constant-time compare.
5. Write tests for a good signature, a bad signature and a missing header.
6. Write the route. It reads the secret with `getWebhookSigningSecret` and verifies the body.
7. The route then calls `trigger("sync-pull-request-from-github", { companyId, payload })` and returns 200.
8. Write `githubSyncFunction` (`id: "sync-pull-request-from-github"`, event `carbon/github-sync`).
9. In it, find the element by the first `readableId` match in the branch name, then in the PR body.
10. Map the repository path of the changed files to a product line through `productLine.repositoryPath`.
11. Upsert `externalIntegrationMapping` with the service role: `entityType: "projectElement"`, `integration: "github"`, `externalId` = the PR URL.
12. Apply the spec table "GitHub event → Element change". Move the element to the company state named In Review, Done or Todo.
13. Update the open `agentRun` of that element the same way.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- github && pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs
# Expected: all tests pass; no errors
```

**Out of scope:** a GitHub App. Outbound writes to GitHub from Carbon.

---

## Task 17: The agent Inngest functions

**Depends on:** Task 14, Task 15, Task 16
**Files:**
- Create: `packages/jobs/src/inngest/functions/agents/dispatch.ts`, `poll.ts`, `expire-claims.ts`, `orchestrator.ts`, `index.ts`
- Modify: `packages/jobs/src/inngest/index.ts` — add the group to `functions` (line 128)
- Modify: `packages/lib/src/trigger.ts` — `"agent-run-dispatch": "carbon/agent-run.queued"` in `taskToEvent`
- Modify: `packages/ee/src/agents/runs.server.ts` — `queueAgentRun` calls `trigger("agent-run-dispatch", { companyId, id })` for push runs
- Copy from (precedent): `packages/jobs/src/inngest/functions/scheduled/cleanup.ts` (cron) and `packages/jobs/src/inngest/functions/events/issue-sync.ts` (event, company concurrency)

**Steps:**
1. Write `agentRunDispatchFunction` (`id: "agent-run-dispatch"`, event `carbon/agent-run.queued`, concurrency keyed on `event.data.companyId` with `limit` from `agentSettings.maxConcurrentRuns`).
2. In it, refuse the run when this month's `costCents` sum reaches `monthlyBudgetCents`. Set `Needs Review` with the reason.
3. Build the prompt with `buildAgentPrompt`. Store it on the run.
4. Call `client.beta.sessions.create` with the stored agent and environment ids, the vault id of the agent user, and a `github_repository` resource for `productLine.repositoryUrl`.
5. Pass `budget: { type: "limit", max_list_cost: { amount: String(budgetCents), currency: "USD" } }` and the prompt as the first event.
6. Set `externalSessionId`, `startedAt` and `status = 'Running'`.
7. Write `agentRunPollFunction` (cron `*/2 * * * *`). For each `Running` push run, call `client.beta.sessions.retrieve`.
8. Copy `usage.list_cost.amount` to `costCents`. When the session is idle with `stop_reason` of budget reached, set `Needs Review` and put the reason in `error`.
9. When the session ends without a `reportAgentRun` call, set `Failed`.
10. Write `agentRunExpireClaimsFunction` (cron `*/5 * * * *`). It calls `expireAgentRunClaims`.
11. Write `agentOrchestratorFunction` (cron `0 * * * *`). For each company with `pushEnabled` and an `orchestratorUserId`, check `orchestratorCron` against the current hour.
12. When it is due, queue one `Orchestrator` run for each active product line that has a `repositoryUrl`.

Read the `claude-api` skill (`shared/managed-agents-core.md`, `shared/managed-agents-client-patterns.md`) before Steps 4 to 9. Do not guess SDK names or status values.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- agents && pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: all tests pass; no errors
```

---

## Task 18: Settings → Agents page and the element Runs panel

**Depends on:** Task 11, Task 14
**Files:**
- Create: `apps/erp/app/routes/x+/settings+/agents.tsx`, `agents.new-user.tsx`, `agents.new-key.$userId.tsx`
- Create: `apps/erp/app/modules/agents/ui/AgentSettingsForm.ee.tsx`, `AgentUsersTable.ee.tsx`, `AgentUserForm.ee.tsx`, `AgentsUpgradeOverlay.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/ElementRuns.ee.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementView.tsx` — render `ElementRuns` and a "Run agent" button when the owner is an agent user
- Modify: `apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx` — an "Agents" entry
- Modify: `apps/erp/app/utils/path.ts` — the new paths
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/projects.tsx` (settings form page), `apps/erp/app/routes/x+/settings+/api-keys.new.tsx` (show a raw key once), `apps/erp/app/modules/projects/ui/PlanningGroups/PlanningGroupsUpgradeOverlay.tsx` (upgrade overlay), `apps/erp/app/modules/projects/ui/Element/ElementJobs.tsx` (an element panel list)

**Steps:**
1. Build the settings page. It shows the push switch, the concurrency limit, the run budget, the monthly budget, the orchestrator agent and its cron.
2. Show a link to install the `anthropic` integration when it is not active. Turn the push switch off until it is active.
3. List the agent users with a "New agent" action and a "New key" action for each one.
4. Show the raw key once, as `api-keys.new.tsx` does.
5. Gate the page with `usePlanGate({ feature: "AGENTS" })`. Show the upgrade overlay; never hide the nav entry.
6. Build `ElementRuns`: status, mode, cost in dollars, PR link, summary and time for each run of the element.
7. Show the "Run agent" button when the owner is an agent user. It calls `queueAgentRun`.
8. Run the license-header fixer.

**Verify:**
```bash
pnpm --filter @carbon/checks license-headers && pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

---

## Task 19: Cross-company RLS test

**Depends on:** Task 2
**Files:**
- Create: `packages/database/supabase/tests/agents-authz.test.sql`
- Copy from (precedent): `packages/database/supabase/tests/event-subscription-authz.test.sql`

**Steps:**
1. Make two companies, A and B, in the rolled-back transaction.
2. Make one agent user in company A with an API key.
3. Add one `productLine`, one `projectElement` and one `agentRun` to each company.
4. Act as the API key of the agent in company A.
5. Assert that the key reads one row of each table from company A and zero rows from company B.
6. Assert that an insert of `userToCompany` for the agent into company B raises the trigger message.

**Verify:**
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/agents-authz.test.sql
# Expected: exits 0 with no ERROR line
```

---

## Task 20: Browser verification

**Depends on:** all tasks
**Files:** none

**Steps:**
1. Run `/test` against the local ERP.
2. Create the product lines "Trailers" and "Racks". Give a project and a part one of them.
3. Create the agent user `sourcing`. Create a key for it and copy the raw key.
4. Assign a task element to `Agent sourcing`. Check that the Runs panel shows one Queued run.
5. With push off, call `agents_claimAgentRun` through MCP with a person's connector. Check the run moves to Claimed with its prompt.
6. Call `agents_reportAgentRun` with a PR URL and a summary. Check the element shows the comment.
7. Send a signed test `pull_request` webhook for a branch named with the element `readableId`. Check that the element moves to In Review.
8. Check the Agents settings page shows the upgrade overlay for a Starter company.

**Verify:**
```text
/test reports every step as passed, with a screenshot for steps 4, 6 and 7.
```

**Out of scope:** a live push session. It needs a real Anthropic key and a real repository. Test it by hand with the owner after merge.
