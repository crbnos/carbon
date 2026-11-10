# MES calls ERP postings; `@carbon/server-functions` is deleted

Phase 6 of `.ai/plans/2026-10-15-service-function-migration.md`, narrowed by two
decisions the user made on 2026-10-17. Built in commit `d956b0be11`.

## Decisions

| Topic | Decision |
|---|---|
| Scope | The 10 functions still in the package move into ERP modules as building blocks. MES stops importing the package. The package is deleted. |
| Transport | MES calls one internal ERP endpoint per posting over HTTP. MES route logic stays in MES. |
| Trust | MES signs each call with an HMAC key derived from `SESSION_SECRET`. Both apps get the same secret in every deployment, because they share the session cookie. The ERP verifies the signature and trusts the company, user and mode that MES signed. A browser has no key, so it cannot make such a call. |
| Caller mode | A call that MES made as the user sends the user's `Authorization` header. The signature covers it. The ERP builds the caller's client from it, and the posting's permission rule checks that user. |
| System mode | A call that MES made as the system runs as the system for the signed company and user. |
| Replay | Each call carries a nonce. The ERP stores it in Redis and refuses it a second time. |
| Allowlist | The endpoint serves only the postings MES calls, and only the `type` values MES sends (`MES_POSTINGS`). `ErpPostingInput` narrows each MES call to those values, so a new value fails the MES typecheck instead of a refusal at run time. The check found `trackedEntitiesToOperation`, which the first list had missed. |
| Types | The input schemas of the MES postings move to `@carbon/api/postings`. They are plain zod with no app imports. MES types its calls with them, and the ERP validates with the same schemas. This replaced the first idea, types generated with the TypeScript checker: a move is less code and cannot go stale. |
| ERP URL | MES calls `ERP_URL` (`getAppUrl()`). Local dev needs no second URL: the MES dev process already trusts the portless CA (`NODE_EXTRA_CA_CERTS`). |

## Where things are

| Part | File |
|---|---|
| Signing | `packages/api/src/internal-call.ts` (`signInternalCall`, `verifyInternalCall`). It has no `.server` suffix: MES services that client components import load it lazily, and React Router refuses any `.server` import in the client graph, even a dynamic one. |
| Schemas, allowlist | `packages/api/src/postings.ts` |
| Contract | `packages/api/src/postings.server.ts` (`PostingContract` gains the 9 MES postings) |
| Registration | `apps/erp/app/modules/postings.server.ts` |
| ERP endpoint | `apps/erp/app/routes/api+/internal.postings.$name.ts` |
| MES client | `apps/mes/app/services/erp.ts` (`erpPosting`) |
| Caller check | `postingCaller` / `authorizePostingCaller` in `shared.service.ts` (replaced `ServerFnContext`) |
| Former `lib/` | `shared.service.ts` |
| Fixtures | `apps/erp/test/database/fixtures/` |

## What MES calls (2026-10-17)

| Posting | `type` values | Mode |
|---|---|---|
| `issue` | convertEntity, jobOperation, jobOperationBatchComplete, jobOperationScrap, jobOperationSerialComplete, maintenanceDispatchInventory, maintenanceDispatchTrackedEntities, maintenanceDispatchUnissue, mergeTrackedEntities, partToOperation, scrapTrackedEntity, trackedEntitiesToBatch, trackedEntitiesToOperation, unconsumeTrackedEntities | system; partToOperation also caller |
| `post-picking` | inventory, unpickInventory, serial, batch, unpickSerial, unpickBatch, returnOperationRemainders | caller |
| `post-production-event` | – | system |
| `post-maintenance-event` | – | caller |
| `post-inventory-adjustment` | – | caller |
| `create` | nonConformanceTasks | system |
| `batch-operations` | complete | system |
| `recalculate` | jobRequirements | system |
| `trigger-rework` | – | system |

## Steps

- [x] 1. Signing helpers and tests (`internal-call.test.ts`, 8 tests).
- [x] 2. Contract, schemas and allowlist in `@carbon/api`.
- [x] 3. ERP endpoint: verify, refuse a seen nonce, allowlist, build the handles, run `posting()`. It never reads cookies.
- [x] 4. MES client `erpPosting`.
- [x] 5. Switch the 34 MES call sites.
- [x] 6. Port the 10 functions and `lib/` into ERP modules. Repoint the ERP, jobs and ee callers. Move the fixtures and tests to `apps/erp/test`.
- [x] 7. Delete `packages/server-functions`, the `server-fn-authorizes-caller` check and `loadServerFunctions`.
- [x] 8. Docs: rules, AGENTS.md files and product docs (`ff9f6d8edb`).
- [x] 9. Verify against the local stack:
  - [x] Run the database tests (results below).
  - [x] Run the MES flows in a browser (`agent-browser`; the browser pane blocks every script of `*.service-functions.dev`). Six flows pass; `.ai/playbooks/mes-postings-through-erp.md`.
  - [x] Run the MCP smoke test (results below).
  - [x] Measure the round trip (results below).
- [x] 10. Decide `scripts/one-off/journal-legacy-documents.ts` (see Open items): deleted on 2026-10-17. It had run on every workspace, and the repair stays in Settings → Accounting.

## Verified (2026-10-17, without the database stack)

| Check | Result |
|---|---|
| Typecheck: erp, mes, @carbon/api, @carbon/checks, @carbon/jobs, @carbon/ee | pass |
| Tests: erp (2556), mes (69), jobs (970), ee (2048), database (504), api (63), checks (334) | pass; database tests skip |
| Production build: MES and ERP | pass. The ERP server bundle calls `registerPostings` with the 9 new postings. |
| MCP manifest | 1610 tools, digest current, workflow catalog ok |

## Verified against the local stack (2026-10-17)

| Check | Result |
|---|---|
| ERP database tests | 640 pass. `post-charge-transaction` once deadlocked in its own `DROP TRIGGER` cleanup while other files ran in parallel. Alone it passed twice. |
| `@carbon/database` and `@carbon/jobs` tests with the database | 544 and 984 pass |
| Signed calls to the live ERP dev server, signed as `erpPosting` signs them | `recalculate` 200. A real `issue` of one unit on an operation wrote 3 ledger rows. A bad input is 400, an unsigned call 401, a posting off the list 404, a repeated call 409. |
| Round trip, `recalculate`, local dev over portless HTTPS | 36 to 45 ms |
| MES `erpPosting` (`apps/mes/app/services/erp.test.ts`, `fetch` stubbed) | The ERP verifies what MES signs. A service-role client runs as the system. A user's client forwards its token in caller mode. A refusal keeps its status and body. An unreachable ERP is a 502. |
| MES in the browser: pick and unpick (`post-picking`, as the user) | `quantityPicked` 0 → 4 → 0 with Transfer pairs. ERP call 50 ms and 37 ms; the MES action 150 ms and 84 ms. |
| MES: issue material (`issue` partToOperation) | `quantityIssued` 1 → 2, a Consumption row. ERP call 86 ms; MES 208 ms. |
| MES: log 1 completed (`issue` jobOperation) | `quantityComplete` 0 → 1, a Production row, a backflush of each material. ERP call 111 ms; MES 202 ms. |
| MES: mark the operation done | `post-picking` returnOperationRemainders (36 ms) and `post-production-event` (28 ms, in the background). The labor event is posted to the GL. |
| MES: complete a maintenance dispatch (`post-maintenance-event`) | Dispatch Completed. Labor lines of 939.13 and −939.13. ERP call 41 ms. |
| ERP: pick and unpick on its own picking page (in process, as the user) | `quantityPicked` 0 → 1 → 0 |
| MCP, with two local API keys deleted afterwards | `initialize`: 1610 tools across 14 modules. `tools/list`, `search_tools`, `describe_tool` answer. `call_tool production_getJobs` returns jobs in 46 ms. A key with no scopes, and a write with view-only scopes, are refused. A missing argument is a validation error. An unknown key is a 401. |

## Open items

1. **The one-off script.** `scripts/one-off/journal-legacy-documents.ts` loads `journalLegacyDocumentsForAllCompanies` from the deleted package path. The deploy runner runs it for every workspace that has not recorded it. A failure does not stop the deploy, but the runner marks the run errored and retries the script on each deploy. The function now lives in `accounting.service.ts`, whose imports need the ERP's `~` paths and `REDIS_URL` at import. Options:
   1. Remove the script. Its header says it is safe to remove once every deployment has run it, and main has had 108 deploys since it shipped.
   2. Keep it and load the ERP module with the ERP tsconfig and the full environment.
2. **MCP descriptions.** 1081 of the 1610 tools have a description that only repeats the title. An agent that picks a tool learns nothing from it. Writing them is content work per module.
3. **Logger names.** The ported bodies still log under the `server-functions` namespace. A log monitor can filter on that name, so the rename waits for a check of the monitors.
