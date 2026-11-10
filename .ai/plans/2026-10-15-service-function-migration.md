# Service function migration — the whole plan

## Progress

- [x] Phase 0 — Foundation (`refactor/service-functions`)
- [x] Phase 1 — One gate for every caller (`fix/gate-every-caller`, merged into this branch)
- [x] Phase 2 — Pipeline: the manifest from service functions
- [x] Phase 3 — Pilot: the production job lifecycle (review gate before Phase 4)
- [x] Phase 4 — Module waves
  - [x] Wave 1: production, purchasing, inventory, sales (agents, merged)
  - [x] Wave 2: items, quality, invoicing, accounting (agents, merged)
  - [x] Wave 3: resources, settings, users/account/people, shared/documents/workflows/integrations (merged)
  - [x] Publish only what routes use: 201 legacy tools that no route calls are unpublished
  - [x] Single-function tools: a codemod turns each route-called legacy tool into a leaf (below)
- [x] Phase 5 — Dissolve `packages/server-functions` (package deleted in `d956b0be11`)
  - [x] The pattern: a function's body becomes a building block in `<module>.service.ts`; `settle` or `invokePosting` runs it with the function's own error rules (`.claude/rules/module-files.md`)
  - [x] 39 functions ported: `close-job`, `assign-serial-numbers`, `preview-serial-unit-costs`, `recost-serial-unit`, `post-asset-transfer`, `preview-asset-capitalization`, `seed-company`, `finalize-supplier-quote`, `finalize-purchasing-rfq`, `post-inventory-count`, `post-nonconformance`, `apply-account-import`, `post-stock-transfer`, `import-csv`, `correct-stock-movement`, `sync`, `get-method`, `convert`, `kanban-replenish`, `update-purchased-prices`, `create-rental-invoices`, and in one batch the posting cluster: `post-sales-invoice`, `post-purchase-invoice`, `post-memo`, `post-payment`, `post-receipt`, `post-shipment`, `post-charge`, `post-reimbursement`, `post-rental-agreement`, `post-customer-contract`, `create-contract-invoices`, `post-lease`, `create-lease-invoices`, `activate-accounting`, `journal-legacy-documents` and the three revenue-run functions
  - [x] Their live tests run from `apps/erp/test/database/`
  - [x] Every function only the ERP, jobs and ee call is ported; the postings registry runs only ported bodies
  - [x] The seam for jobs and ee (steps 2 and 3): `@carbon/api/postings.server`. The ERP registers 12 postings at start; jobs and ee call `posting(name, handles, input)`
  - [x] The 10 functions of the MES closure are ported with Phase 6: `batch-operations`, `create`, `issue`, `post-inventory-adjustment`, `post-maintenance-event`, `post-picking`, `post-production-event`, `recalculate`, `reschedule`, `trigger-rework`
  - [x] `route-action-shape` flags `invokePosting` and `invokeCreate` in a route. The `server-fn-authorizes-caller` check and the `serverFns` pattern are deleted with the package
  - [x] The shared `lib` helpers are in `shared.service.ts`
- [x] Phase 6 — MES calls the ERP's postings over signed HTTP calls (design approved 2026-10-17; `.ai/plans/2026-10-17-mes-calls-erp-postings.md`). Verification against the local stack is still open there
- [ ] Phase 7 — Clean up
  - [x] Module layout: `<module>.server.ts` operations, `<module>.service.ts` building blocks, no barrels; flat names `<module>_<function>`; `account` merged into `users`
  - [x] Legacy pipeline deleted (dispatcher, registry, service-file parser, validator registry, `sql-effects`, blocked/exposure lists, aliases)
  - [x] Docs and rules rewritten; lessons added
  - [x] #1842 fixes: paged lists, flat inputs (`args` and single-object wrappers), stamped columns (`stamp-matches-columns` check)
  - [ ] `serviceContext` still built directly by two routes (kanban scan, agent chat) and `carbon.server.ts`; `assertIsPost` / `flash` / `bypassRls` sweep not done
  - [ ] Changelog entry: draft kept, not written until the user asks

Deviations from the approved plan, with the reason:

- Phase 0 step 1: `module-shape.ts` needs no change. `loadModules` reads module folders only, so loose files in `apps/erp/app/modules/` pass.
- Phase 0 step 12: `route-action-shape` matches only patterns that are certainly writes (a `.from(...)` write, Kysely writes, `serverFns`). A route that calls two write functions is not detected: the check cannot tell a write function from a read by its name. It baselines 237 hits in 161 route files.
- `replanAfterItemChange` permission: `"system"` → `{ update: "parts" }`. Six item routes call it as the user, so the gate would have refused every replan.
- Phase 5 steps 2 and 3: jobs and ee get the postings, not the router. They call a posting's body (post an invoice, draft the recurring invoices), never the operation a route calls, which does more (sales rules, emails). The contract in `@carbon/api/postings.server` types each input and the result its callers read, because neither package can see the ERP's types.
- The gate checks the entry call only. A call from inside another service function's `run` is not checked again, so `"system"` functions can be steps of user operations.
- `useAction` shows a default toast only for a service function's error (`{ error: { category, message } }`). Older `{ success: false }` results still flash from the action, and a second toast would double them.
- Phase 1: the in-app agent calls no operations (docs and navigation tools only), so only the workflow dispatch changed. The changelog line waits for the release's entry.
- Phase 2: a refusal uses oRPC's own error body with `data.category`, not a new `{ error }` envelope, so every v1 error has one shape. Input schemas come from the leaf's TypeScript type, like the legacy tools, not from `z.toJSONSchema`. The generator does not drop legacy tools by itself: a module's migration removes `@mcp` from the primitives it replaces.
- Phase 3: release is one operation for the job page, bulk release, planning and the API (`production.job.release`), with every check inside; batch release likewise (`production.batch.release`). The Make to Asset and "nothing to make" rules moved into `getJobReleaseReadiness`, so batch release now applies them too. The status route lost its release branch and a dead plan-and-schedule branch. `planDraftJob` stays unpublished: its checks depend on the planning drawer's location.
- Phase 4: the waves moved the composed route actions (two or more writes) only. A route that makes one service call keeps it; its function stays a legacy tool until the codemod converts it.
- Phase 4: the codemod (`legacy-to-leaves.mjs`, scratchpad) writes `<module>.tools.server.ts`. Each leaf has a zod input from the published schema, the same permission, a typed positional call, the auth stamping (`stamp`) and the result reader (`envelope`, `paged`, `plain`, `envelopes`, `flag`) in `service-tools.server.ts`. An upsert with an id rule splits into `create` and `update`. Names are mechanical: `getCustomers` becomes `sales_getCustomers`.
- Phase 4: the dispatcher's sales-rule gate is deleted. Every tool it checked is unpublished; `sales.quote.setStatus` and `sales.order.setStatus` hold the gate for every caller now.
- Phase 4: an operation called through the API, MCP or a workflow gets the company-scoped client the dispatcher used (`scopedToCompany`).

## Context

MCP tools and the v1 API are generated from `*.service.ts` exports. The real logic of most operations lives in route actions. So a tool such as `production_updateJobStatus` does less than the Release button does. Callers cannot trust a tool to match the UI.

The fix: every operation is one `defineServiceFn` const. Routes, the HTTP API, MCP, workflows, jobs and MES call that same const. One permission gate runs for every caller. The API and MCP manifest comes from the consts and their TSDoc.

Scale, from `.ai/research/2026-10-09-service-function-inventory.md` (the work list for this plan):

| | Count |
|---|---|
| Service functions (ERP 1915, MES 145, ee 173) | 2233 |
| Route actions | 1062 |
| Actions that already make one service call | 676 |
| Actions with logic in the route (need a new function) | 334 (439 functions) |
| Server functions in `packages/server-functions` | about 50 |

Already built on `refactor/service-functions` (worktree `.claude/worktrees/service-functions`, merged with main at `aaf1b4fa50`): `defineServiceFn`, `CarbonError`, `ctx.transaction`, `serviceContext`, and 6 production functions with 12 routes that call them.

## Decisions (locked by the user)

| Topic | Decision |
|---|---|
| Helper | `defineServiceFn`; oRPC is the transport |
| Context | `actor`, `company`, `asCaller.supabase`, `asSystem.supabase`, `asSystem.pg`, `kv`, `auditUserId`, `error()`, `transaction()` |
| Errors | `return ctx.error(category, message, cause)`; the type system derives the error union; a returned error rolls back `ctx.transaction` |
| Schemas | `z.compile`; the output schema is optional |
| Docs | TSDoc summary = title, `@remarks` = description, `@mcp` / `@mcp destructive` = published |
| Gate | One permission check for every caller. Workflows are enforced from day one |
| Route action | Validator first (method, params, form), then auth, then one call, then return the result |
| Names | Rename outright to `{module}_{entity}_{verb}`; no aliases |
| Files | Drain gradually into `{module}.server.ts`, `{module}.helpers.ts`, `{module}.models.ts`; discard `wip/production-merge-trial` |
| Primitives | Unpublish each primitive that is unsafe alone |
| Home | Module code stays in `apps/erp/app/modules`. The shared helper lives in the modules folder. `packages/server-functions` dissolves into the modules |
| MES | MES calls ERP's API for operations it does not own |
| Idempotency | Spec only, no build |
| Legacy tools | Publish only what routes use. An operation, or a legacy function a route calls directly, is published. A function only an operation calls is not. Exceptions: the file-upload pair, and tools the workflow catalog names |

## End state

```ts
// apps/erp/app/modules/production/production.server.ts
/**
 * Cancel a job.
 *
 * @remarks
 * Returns picked material, closes picking lists, then sets the job Cancelled.
 *
 * @mcp destructive
 */
export const cancelJob = defineServiceFn({
  input: z.object({ jobId: z.string() }),
  permission: { update: "production" },
  async run(ctx, { jobId }) { /* ... */ }
});

// apps/erp/app/modules/production/index.server.ts — the module's public surface
export const production = { job: { cancel: cancelJob, release: releaseJobs } };

// route action
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["jobId"] });
  const api = await carbon(args.request);
  return api.production.job.cancel({ jobId: input.params.jobId });
}
```

- MCP tool `production_cancelJob`, API path `POST /api/v1/production/job/cancel`.
- The component uses `useAction`; an error shows a toast by default.
- Side effect of validator-first: an unauthenticated caller with a bad request gets 400 or 405, not a login redirect.

## Phases

Each phase is its own PR from main, except where a phase says otherwise. Never push without approval.

### Phase 0 — Foundation (on `refactor/service-functions`)

1. Move `service-fn.server.ts` and `service-context.server.ts` from `apps/erp/app/services/` to `apps/erp/app/modules/`. Update `packages/checks` `module-shape.ts` to allow these shared files.
2. Add `access` to the context: the caller's claims (session, OAuth, workflow owner) or key scopes (API key). Resolve it once per request.
3. Run the gate inside `defineServiceFn`'s `call`, before `run`. Reuse `hasPermissions` from `packages/server-functions/src/permissions.ts`.
4. Give `{}` one meaning everywhere: company membership. `"system"` allows only the `system` actor.
5. Support an input-keyed permission (`{ by, rules }`), copied from `defineServerFn` (`define-server-fn.ts:24-41`).
6. Make the transaction context a full `ServiceContext`, so service functions compose inside `ctx.transaction`. Its `asCaller.supabase` throws on use, because that client is outside the transaction.
7. Add `toResult(result)`: it turns a `CarbonError` into `{ category, message, status }`. A returned `Error` instance otherwise loses its fields to turbo-stream sanitising.
8. Add `validator(schema?).request(args, { method?, params? })` to `packages/form/src/server.ts`:
   1. Check the method first (default POST; throw 405).
   2. Check the required params (throw 400).
   3. Validate the form. Return `{ data, params, formData }` or `{ invalid }` (from `validationError`).
9. Add `carbon(request)` in `apps/erp/app/modules/carbon.server.ts`:
   1. Call `requirePermissions(request, {})`. Extend it to return the claims it already reads (`auth.server.ts:348`).
   2. Build the context.
   3. Return a lazy proxy over the router. Each leaf returns `toResult(...)`.
10. Add `apps/erp/app/modules/router.server.ts`. It combines each module's `index.server.ts`.
11. Give `useAction` (`packages/query/src/useAction.ts`) a default `onError` that shows `error.message` as a toast.
12. Add the conformance check `route-action-shape` (`packages/checks`). An ERP route action fails it if it writes through a client, calls `serverFns`, or calls more than one write function. Baseline every current hit. A PR may only remove baseline entries.
13. Write the idempotency spec (`.ai/specs/2026-10-15-service-fn-idempotency.md`, unlogged Postgres table). No code.
14. Copy this plan to `.ai/plans/2026-10-15-service-function-migration.md`.

### Phase 1 — One gate for every caller (own PR from main, ships first)

This is a security fix that does not wait for the refactor.

1. In `apps/erp/app/routes/api+/v1+/lib/base.server.ts` (`gate`, around line 94), check `session` callers against their claims too.
2. Pass the workflow owner's claims into the dispatch context (`api+/inngest.ts:44-46`). The engine already reads them in `engine/owner.ts:58-76`.
3. Do the same for the in-app agent.
4. Remove the hand-written re-checks in `production.mcp.server.ts`.
5. Add a changelog entry: workflows now fail at a step the owner has no permission for.

### Phase 2 — Pipeline: the manifest from service functions (on `refactor/service-functions`)

1. Add `scripts/lib/router-docs.ts`. It uses the generator's ts-morph `Project` (`response-schema.ts`) to walk `router.server.ts` → each `index.server.ts` object → each leaf const. For each leaf it reads:
   - the summary line (title; the generator fails without one),
   - `@remarks` (description),
   - `@mcp` / `@mcp destructive` (published, destructive).
2. Build the runtime manifest entry from the live const: input JSON schema from `z.toJSONSchema(fn.input)`, permission from `fn.permission`.
3. Classify each entry: `view` = READ, `create`/`update` = WRITE, `delete` or `destructive` = DESTRUCTIVE.
4. Merge both sources into `tool-metadata.json`. The generator drops a legacy entry when its module's router publishes the replacement.
5. In `router.server.ts` (v1), build one procedure per router leaf. Path is `/{module}/{entity}/{verb}`. Reuse `jsonSchemaInput`, `traced` and `gate`.
6. Map a returned `CarbonError` to an `ORPCError` with its `ERROR_STATUS` status and the body `{ error: { category, message } }`. Fold the same shape in `callOperation` (`call.server.ts`) for MCP.
7. Extend the pre-commit trigger (`scripts/git-hooks/pre-commit:27`) to `*.server.ts` and `index.server.ts`.
8. Regenerate the docs (`pnpm --filter docs generate:api`) and the digest (`pnpm check:manifest`).

### Phase 3 — Pilot: the production job lifecycle (on `refactor/service-functions`)

1. Add the 6 existing production functions to `production/index.server.ts`, with `@mcp` tags.
2. Convert their 12 routes to the end-state action. Move their components to `useAction`.
3. Unpublish the primitives they replace. Remove `@mcp` from functions such as the bare job status update.
4. Rename the 4 tool names in `packages/ee/src/workflows/catalog/actions.ts`. Run `scripts/check-workflow-catalog.ts`.
5. Measure the result: lines per action, test count, sweep result, and a browser smoke test of release and cancel.
6. Stop for review. The user approves the pilot before Phase 4 starts.

### Phase 4 — Module waves (one PR per slice)

Use the per-module recipe below. Split a module into slices of about 30 routes, by entity, so each PR stays reviewable.

| Wave | Modules | Note |
|---|---|---|
| 1 | production (rest), purchasing, sales | most published tools, most logic in routes |
| 2 | inventory, items, quality, invoicing | |
| 3 | accounting, resources, people | |
| 4 | users, account, shared, documents, workflows | |
| 5 | settings | one `settings.{page}.update(partial)` per settings page, not one function per toggle (101 → about 15) |
| 6 | `api+`, `auth`, agent routes | |

Rules that apply to every wave:

- **`packages/ee` code** keeps its body and its `requireEntitlement` in `packages/ee` (license boundary). The ERP service function wraps it. Files with `.ee.` in the name keep the infix.
- **Loaders:** reads become service functions too (`list`, `get`), because the API must cover what the app uses. Convert the 1:1 reads with a ts-morph codemod, written in the scratchpad: rewrite `fn(client, …)` into a `defineServiceFn` with `ctx.asCaller.supabase`.
- **Client-safe functions:** the 7 functions that client code imports stay in `{module}.service.ts`. Every other function leaves it.

### Phase 5 — Dissolve `packages/server-functions`

1. Move each server function into its owning module's `.server.ts` as a `defineServiceFn`. Map `ServerFnContext.db` to `ctx.asSystem.pg`.
2. Give the jobs package the router through an injection seam, like `setWorkflowDispatch` (`api+/inngest.ts`). Jobs build a `system` context.
3. Give `packages/ee` its callers (`post-payment`, `post-production-event`) through its existing `deps` injection.
4. Move the helpers the functions share (`assertCompanyRecords`, `toJson`, `fetchAll` use) into `modules/shared`.
5. Keep the 9 functions MES uses in the package until Phase 6 is done. Then move them and delete the package.

### Phase 6 — MES calls ERP's API

1. Design the MES→ERP auth branch on `/api/v1`:
   - MES sends the user's Supabase access token as a Bearer token.
   - MES forwards the signed console pin-in. ERP re-validates it with `resolveConsolePinIn` (`auth.server.ts`).
   - ERP never accepts cookies on `/api/v1` (CSRF).
   - This is an auth change: get user approval on the design before building.
2. Generate a typed client in `packages/api`. Print input and output types from the ERP consts with the generator's TypeChecker. MES cannot import ERP code.
3. Move the writes of the 57 MES route actions into ERP service functions under the owning module (`production.operation.issue`, …). MES actions call them through the client.
4. Measure the issue round trip before and after.
5. MES reads stay in `apps/mes/app/services`. Shop-floor screens keep their direct reads.

### Phase 7 — Clean up

1. Delete the legacy pipeline:
   - the textual parsing in `scripts/lib/service-metadata.ts`
   - `registry.server.ts` and the positional dispatch in `dispatch.server.ts`
   - the `{mod}.mcp.server.ts` companions
   - `OPERATION_ALIASES` and the emptied entries in `mcp-blocked-tools.ts`
2. Delete `serviceContext`, then `assertIsPost` and `flash` from migrated actions. Delete `bypassRls` if nothing uses it.
3. Rewrite the docs:
   - `.claude/rules/conventions-services.md`
   - `.claude/rules/mcp-tools-reference.md`
   - each module `AGENTS.md`
   - the root `AGENTS.md` (the module layout and the "one `{module}.service.ts`" rule)
   - `.ai/docs/module-conventions.md`
4. Add the lessons to `.ai/lessons.md`.

## The per-module recipe

1. Read the module's rows in the inventory (sections 3 and 4). Review the proposed names, because the naming rules have known flaws.
2. For each route action, write the service function in `{module}.server.ts`:
   - input: the existing `.models.ts` validator
   - permission: copied from the route's `requirePermissions`
   - TSDoc with a summary line, plus `@remarks` and `@mcp` where it is safe to publish
3. Move the action's logic into `run`. Keep the behavior the same. List each deliberate difference in the PR.
4. Rewrite the action to the end-state shape: validator, `carbon`, one call, return.
5. Move the component to `useAction`. Put the success toast in the component.
6. Move each building block the function calls from `.service.ts` to `.server.ts`. Move pure helpers to `.helpers.ts`.
7. Add the leaves to `index.server.ts`.
8. Remove `@mcp` from each primitive that is unsafe alone.
9. Update the tests:
   - Test service functions with `createServiceContext` and stub handles (`production.server.test.ts` shows the pattern).
   - Route tests mock `carbon`.
10. Remove the module's entries from the `route-action-shape` baseline.
11. Regenerate the manifest and the docs. Update the module `AGENTS.md`. Add a changelog line that lists the renamed tools.

## Critical files

- `apps/erp/app/services/service-fn.server.ts`, `service-context.server.ts` → `apps/erp/app/modules/`
- `packages/form/src/server.ts`, `packages/form/src/zod.ts` (validator)
- `packages/query/src/useAction.ts`
- `packages/auth/src/services/auth.server.ts` (`requirePermissions` returns the claims)
- `apps/erp/app/routes/api+/v1+/lib/{base,router,call,dispatch,registry,operations}.server.ts`
- `apps/erp/app/routes/api+/inngest.ts`, `packages/jobs/src/workflows/engine/owner.ts`
- `scripts/generate-mcp.ts`, `scripts/lib/{service-metadata,service-ast,response-schema}.ts`
- `packages/checks/src/run.ts`, `src/conformance/module-shape.ts`
- `packages/ee/src/workflows/catalog/actions.ts`
- `packages/server-functions/src/*` (moved in Phase 5)

## Verification (every PR)

1. Run `pnpm exec turbo run typecheck --filter=erp --concurrency=1`, and the same for each other package the PR touches.
2. Run `pnpm --filter erp test` and `pnpm --filter @carbon/checks test`.
3. Run Biome on the changed files with `--vcs-use-ignore-file=false` (worktree).
4. Run `npx tsx scripts/generate-mcp.ts`, then `pnpm check:manifest`.
5. Run `pnpm sweep:tools` for the module against a seeded stack.
6. Run `pnpm --filter docs generate:api` and the docs typecheck.
7. Smoke-test the module's main flows in the browser, with the user's permission (`/test`).
8. Live MCP smoke tests (Phases 1–3):
   - Call a renamed tool through `call_tool` with an API key and with OAuth.
   - Confirm a 403 when the caller lacks the permission.
   - Confirm a workflow fails at a step its owner lacks the permission for.

## Risks

- **Repeated renames:** tools change name each time a module ships. External clients must update per wave. Each wave's changelog lists the renames.
- **Workflows:** enforcing workflows from day one can stop a running customer automation. The Phase 1 changelog says so.
- **Behavior drift:** moving logic out of an action can change it. Known cases: a throw now returns `internal`, and database messages become "Something went wrong". Each PR lists its differences.
- **MES:** issue goes from in-process to HTTP, so it gains a network hop and depends on ERP. Phase 6 measures the issue round trip before and after.
- **Merge conflicts on a long branch:** keep slices small and merge each one fast.
