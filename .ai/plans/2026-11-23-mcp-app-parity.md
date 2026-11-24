# MCP app parity: gaps to close

Branch `feat/mcp-app-parity`, worktree `~/Desktop/carbon/carbon-feat-mcp-app-parity`, base main `05bd067c0a`.

## Goal

- Every write that an ERP form can do is also an MCP tool, with the same gate and the same result.
- A load of a complete company over MCP found these gaps: staff, master data and 90 days of history.
- About 11,500 of the load's 18,253 planned calls had no tool.
- The tool mirrors the app form: no more, no less. If the app refuses an input, the tool refuses it.
- Publish an operation only when it is safe with nothing but its input.
- The API runs the gate and `run`. It does not run what the route does around the call (`.claude/rules/conventions-services.md`, Published).
- Guides: `.claude/rules/mcp-tools-reference.md`, `.claude/rules/module-files.md`, `.claude/rules/conventions-services.md`.

Terms in this plan:

| Term | Meaning |
|---|---|
| operation | a `defineServiceFn` const in `<module>.server.ts` |
| tool | the published name of an operation, `<module>_<name>` |
| gate | the operation's `permission` literal |
| key scope | the `<module>_<action>` entries of an API key |

## How to publish one operation

1. Read the route that calls the operation.
2. If the route does work around the call (a feature redirect, an extra write, a check), move that work into `run`.
3. If the work cannot move, keep the operation unpublished. Write the reason in its TSDoc.
4. Add `@mcp` to the TSDoc. Use `@mcp destructive` for a delete.
5. Add `@param name - text` for each input field.
6. Run `pnpm generate:mcp`. Only the main agent runs it, never a subagent.
7. If the run warns "module(s) failed to load", run `pnpm install` and run step 6 again.
8. Run `pnpm check:manifest`. Only the main agent runs it.
9. Commit `apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json`.
10. Update the pins in `apps/erp/test/mcp-tool-permissions.test.ts`.
11. If the generator changes, update `apps/erp/test/mcp-service-fn-metadata.test.ts`.
12. Run `pnpm exec turbo run typecheck --filter=erp`.
13. Run `pnpm run lint`.
14. If the module `AGENTS.md` lists what the API publishes, update it. `apps/erp/app/modules/projects/AGENTS.md` has such a list.

🛑 Groups B, C and D change auth, RBAC or a public contract. Ask before you build them (root `AGENTS.md`, Ask First).

## How to test on the local stack

The user starts the stack with `crbn up` in the worktree. `.env.local` holds `ERP_URL` and `SUPABASE_DB_URL`.

Make an API key:

1. Pick a string `crbn_<random>`.
2. Insert an `apiKey` row in the worktree database.
3. Set `keyHash` to the sha256 hex of the string.
4. Set `createdBy` to the user id of test@carbon.ms.
5. Set `scopes` to a map of `<module>_<action>` to `[companyId]`.
6. After a scope change, wait 30 s. The key cache keeps a key for 30 s.

The app's API key form writes the same `<module>_<action>` map (G-17 was wrong); inserting the row only skips the browser.

Call a tool:

1. Send `POST <ERP_URL>/api/mcp`.
2. Send the headers `Authorization: Bearer crbn_…` and `Accept: application/json, text/event-stream`.
3. Send JSON-RPC `tools/call` of `call_tool` with `{ name, arguments }`. Use `call_destructive_tool` for a DESTRUCTIVE tool.
4. Read the result back with psql on `SUPABASE_DB_URL`.

Each new tool gets 3 checks:

1. A call that succeeds. Read the rows back from the database.
2. A call with a key that lacks the key scope. The tool must refuse it.
3. The same action through the app form. Compare the two sets of rows field by field.

The `/test` skill can do the app side (agent-browser, test@carbon.ms).

## A. Ready to publish: the operation exists and only lacks `@mcp`

- [x] `sales_upsertContractFunding`: `apps/erp/app/modules/sales/sales.server.ts:11397`, gate `update: sales`. Route `x+/contract+/$id.$lineId.funding-actions.tsx`. Needs a Draft or Active contract. Refuses a Fixed line.
- [x] `sales_deleteContractFunding`: `sales.server.ts:11427`, gate `delete: sales` (DESTRUCTIVE). Same route.
- [x] `sales_updateQuoteField`: `sales.server.ts:789`, gate `update: sales`. Route `x+/quote+/update.tsx`. Refuses a locked quote.
- [x] `sales_updateSalesOrderField`: `sales.server.ts:1960`, gate `update: sales`. Route `x+/sales-order+/update.tsx`. Refuses a confirmed order.
- [ ] ~~`sales_configureQuoteLine`~~ withdrawn: no page calls the route (`path.to.quoteLineConfigure` has no caller), and it leaves the line unpriced by the pricing rules. The quote line form configures through `sales_updateQuoteLine`, which reprices; that tool already takes `configuration`. Kept unpublished with the reason in its TSDoc.: `sales.server.ts:1376`, gate `update: production`. Route `x+/quote+/$quoteId.$lineId.configure.tsx`.
- [x] `invoicing_updateSalesInvoiceField`: `apps/erp/app/modules/invoicing/invoicing.server.ts:127`, gate `update: sales`. Route `x+/sales-invoice+/update.tsx`. On a posted invoice it changes only the issue, due and paid dates.
- [x] `invoicing_updatePurchaseInvoiceField`: `invoicing.server.ts:990`, gate `update: sales`. Route `x+/purchase-invoice+/update.tsx`. A purchase invoice has a `sales` gate here. Compare it with the route's gate before you publish.
- [x] `users_createEmployeeType`: `apps/erp/app/modules/users/users.server.ts:568`, gate `create: users`. Route `x+/users+/employee-types.new.tsx`. Needs the PERMISSIONS feature.
- [x] `users_updateEmployeeType`: `users.server.ts:614`, gate `update: users`. Route `x+/users+/employee-types.$employeeTypeId.tsx`.
- [x] `users_createGroup`: `users.server.ts:658`, gate `create: users`. Route `x+/users+/groups.new.tsx`.
- [x] `projects_setIndirectRate`: `apps/erp/app/modules/projects/projects.server.ts:5926`, gate `update: accounting`. Route `x+/accounting+/indirect-rates.tsx`. The ee function holds the entitlement check.
- [x] `projects_upsertIndirectPoolAccount`: `projects.server.ts:5866`, gate `update: accounting`. Route `x+/accounting+/indirect-pools.$poolId.tsx`.
- [x] `projects_deleteIndirectPoolAccount`: `projects.server.ts:5901`, gate `update: accounting`. Same route.
- [x] `projects_deleteIndirectPool`: `projects.server.ts:5835`, gate `delete: accounting` (DESTRUCTIVE). Route `x+/accounting+/indirect-pools.delete.$poolId.tsx`.
- [x] `projects_runIndirectRatePeriod`: `projects.server.ts:5954`, gate `update: accounting`. Route `x+/accounting+/indirect-rates.tsx`.
- [x] `resources_completeTrainingAssignment`: `apps/erp/app/modules/resources/resources.server.ts:1752`, gate `update: resources`. Route `x+/resources+/assignments.complete.tsx`. Only an employee in the assignment's groups can complete it.

Scenario test for group A. Do each step over MCP only, on one company:

1. Create an employee type.
2. Create a group with 2 members.
3. Assign a training to the group (`resources_createTrainingAssignment`).
4. Complete the training for one member.
5. Add a funding action to a Time & Materials contract line.
6. Delete the funding action.
7. Change the order date of a Draft sales order.
8. Configure a Make to Order quote line.

## B. Gated on company membership (`{}`): needs a key scope first

Any key of the company passes a `{}` gate, even a read-only key. The precedent for such a write is `refuseKeyWithout(ctx, { … })` (`apps/erp/app/modules/shared/shared.service.ts`). `projects_saveTimesheetEntry` and `projects_createTimesheetCorrection` use it. Each item names the recommended key scope. The recommended key scopes are approved (2026-11-24). Build them as written.

- [x] `quality_createRisk`: `apps/erp/app/modules/quality/quality.server.ts:2354`. Route `x+/quality+/risks.new.tsx`. RLS lets any employee create a risk. Key scope: `create: quality`. **Done 2026-11-24:** published; a key needs `create: quality`; the assignee must be an active employee and severity and likelihood 1 to 5, as the form allows.
- [x] `inventory_scanKanban`: `apps/erp/app/modules/inventory/inventory.server.ts:4287`. Route `api+/kanban.$id.tsx`. Its comment says: "give it a real rule before it is ever tagged @mcp". A Make kanban creates its job as the system. Key scope: `update: inventory`, and `create: production` for a Make kanban. **Done 2026-11-24:** published; a key needs `update: inventory`, and `create: production` for a Make card.
- [x] `settings_setRecordCustomFields`: `apps/erp/app/modules/settings/settings.server.ts:2583`. Route `x+/settings+/custom-fields.tsx`. RLS decides per record. Key scope: `update` on the module of the record's table. **Done 2026-11-24:** published; a key needs `update` on the table's module (`customFieldTable.module`, Items → parts). The write is now scoped to the company (or its group for shared tables): part ids repeat across companies, so one save could change another company's part.
- [x] `projects_upsertIndirectPool`: `projects.server.ts:5768`. Routes `x+/accounting+/indirect-pools.new.tsx` and `indirect-pools.$poolId.tsx`. It checks `create` or `update: accounting` inside. Key scope: the same pair. **Done 2026-11-24:** published, with `refuseKeyWithout` for the create or update pair.
- [x] `projects_upsertPlanningGroup`: `projects.server.ts:5341`. Routes `x+/projects+/planning-groups.new.tsx` and `planning-groups.$id.tsx`. It checks `create` or `update: projects` inside. Key scope: the same pair. **Done 2026-11-24:** published, with `refuseKeyWithout` for the create or update pair.
- [x] `users_updateGroup`: `users.server.ts:690`. Its gate is `view: users` on a write, because the route has always required only view. Key scope: `update: users`. Keep the route's gate as it is. **Done 2026-11-24:** published as a WRITE (`@mcp write`, new); a key needs `update: users`; a group id that is not the company's is refused.

## C. Needs 2 modules' permissions: the manifest cannot publish it

**Done 2026-11-24:** the API already refused a key without every module the gate names; the manifest published such a gate as membership (`{ module: null, actions: [] }`), so `describe_tool` showed nothing and the digest wrote `none`. It now publishes `scopes` (every `<module>_<action>`, sorted), the digest line names them, and `describe_tool` joins a gate's actions with "and" (it said "or", wrongly, for 56 tools). `getRequestQuoteRows` and `writeMissingJournals` are published too.

The manifest cannot publish a gate that names 2 modules. `getRequestQuoteRows` (purchasing) and `writeMissingJournals` (settings) wait on the same limit. Recommendation: teach the manifest and the API gate to publish a gate over 2 or more modules. Do not split each operation. This recommendation is approved (2026-11-24).

- [x] `projects_createJobFromMaterial`: `projects.server.ts:3509`, gate `{ create: production, view: projects }`. Route `x+/project+/$projectId.elements.$elementId.create-job.tsx`. This is a plan line's Create Job. Today `production_createJob` with `projectId` makes a job that the plan line does not remember. **Done 2026-11-24:** published.
- [x] `projects_createProjectElementJob`: `projects.server.ts:3589`, same gate and route. It makes a job for a part on a task with no plan line. **Done 2026-11-24:** published.
- [x] `projects_updateTimesheetRequired`: `projects.server.ts:4990`, gate `{ view: [projects], update: people }`. Route `x+/projects+/reports.missing-time.tsx`. **Done 2026-11-24:** published.

## D. Takes the request's IP, city or user agent: needs a request-aware context

**Done 2026-11-24:** `ctx.origin` (`RequestOrigin`, `originOf` in `@carbon/api/service-fn.server`) is set by `carbon(request)`, the HTTP API route and the MCP route; 10 users operations read it and no longer take the 3 fields.

`users.server.ts:49` gives the reason: "The writes that send an invite or write an audit record are not published (no `@mcp`): they take the request's IP, city and user agent as input, which an API caller could set to anything, and the permission editors write that IP into the permission audit log. They wait for a context that carries the request."

Recommendation:

1. The MCP route and the HTTP API route read the caller's IP, city and user agent from the request headers.
2. The routes put the 3 values on the service context.
3. The operations read the values from the context, not from their input.
4. The published schema drops the 3 fields.

🛑 This changes the audit log and auth. The 4 steps above are approved (2026-11-24). Ask again before you change anything else in auth.

- [x] `users_inviteEmployee`: `users.server.ts:72`, gate `create: users`. Route `x+/users+/employees.new.tsx`. Without the PERMISSIONS feature, the invite always gets the Admin employee type. Without this tool, a company cannot get staff over MCP. **Done 2026-11-24:** published; a key also needs `create: people`, as RLS needs for a first-time invite.
- [x] `users_resendInvites`: `users.server.ts:220`, gate `create: users`. Route `x+/users+/resend-invite.tsx`. **Done 2026-11-24:** published.
- [x] `users_revokeInvites`: `users.server.ts:323`, gate `create: users`. Route `x+/users+/revoke-invite.tsx`. **Done 2026-11-24:** published as destructive; refuses a user with no pending invite (before, `create: users` could deactivate active accounts).
- [x] `users_bulkUpdatePermissions`: `users.server.ts:514`, gate `update: users`. Route `x+/users+/bulk-edit-permissions.tsx`. It runs as a job. Poll `userPermission` before the next step that depends on it. **Done 2026-11-24:** published.
- [x] `users_updateEmployeePermissions`: `users.server.ts:480`, gate `update: users`. Route `x+/users+/employees.$employeeId.tsx`. **Done 2026-11-24:** published.

The invitee accepts the invite. That step stays outside the API.

Scenario test for group D:

1. Invite 3 employees of 3 employee types over MCP.
2. Accept each invite in a browser as that person.
3. Grant extra permissions to the 3 employees with one bulk call.
4. Revoke the invite of a fourth person before acceptance.

## E. No operation yet: the write is only in a route

Each write needs a `defineServiceFn` that calls the existing building block. Then the route and the tool run the same code. Change the route to call the new operation (`route-action-shape` check).

- [x] Sales rules: create, update, delete, pin an item, unpin an item.
  - Routes: `x+/sales+/sales-rules.new.tsx`, `sales-rules.$id.tsx`, `sales-rules.$id.delete.tsx`, `sales-rules.assign.$itemId.tsx`, `sales-rules.unassign.$itemId.$ruleId.tsx`.
  - Bodies: `upsertEnforcementRule`, `deleteEnforcementRule`, `assignSalesRule` and `unassignSalesRule` in `@carbon/ee/rules.server`. Each holds its entitlement check.
  - The reads are published (`shared_getEnforcementRules`).
  - Storage rules are the sibling family with the same shape.
- [x] Demand projections: create, update, delete.
  - Routes: `x+/production+/demand-forecasts.new.tsx`, `demand-forecasts.$itemId.$locationId.tsx`, `demand-forecasts.delete.$itemId.$locationId.tsx`.
  - Bodies: `upsertDemandProjections` and `deleteDemandProjections` in `@carbon/ee/forecast.server`.
  - The read is published (`production_getDemandProjections`).
- [x] Custom field definitions: create, update, delete.
  - Routes: `x+/settings+/custom-fields.$table.new.tsx`, `custom-fields.$table.$id.tsx`, `custom-fields.$table.delete.$id.tsx`.
  - Body: `upsertCustomField`.
- [x] Contract invoice schedule edits: move, split, set amount, reset.
  - Route: `x+/contract+/$id.schedule.tsx`. It calls `runContractAction` with `edit-schedule` or `reset-schedule`, validated by `customerContractScheduleEditValidator`.
  - `sales_getContractInvoiceSchedule` returns only persisted rows. So an unedited Draft schedule reads empty.
  - The schedule names its planned rows only by position (`planned:<date>:<line>:<start>`). Return the planned rows too, or an edit tool cannot name them.

Scenario test for group E:

1. Create a sales rule that blocks one customer country.
2. Pin 2 items to the rule.
3. Add a pinned item to a quote of that customer over MCP. The tool must refuse it.
4. Do step 3 in the app. Compare the two refusal messages.

## F. Shop floor and an employee's own records: attribution decides

Carbon records these actions against the person who did them. An API key acts as its creator. So a key tool would record the wrong person. These actions need a per-user MCP session (the user's own OAuth grant), not more key tools. Leave them out of this branch. They need a design first.

- MES app (`apps/mes`, outside the ERP manifest):
  - operation start and end: `x+/end.$operationId.tsx`, `x+/event.tsx`, `x+/finish.tsx`, `x+/complete.tsx`;
  - step records: `x+/record.tsx`;
  - material issue: `x+/issue.tsx`, `x+/issue-tracked-entity.tsx`;
  - scrap: `x+/scrap.tsx`;
  - inspection readings and verdicts: `x+/inspection-lot.$id.measurement.tsx`, `.verdict.tsx`, `.disposition.tsx`, `.complete-passed.tsx`.
- `projects_submitTimesheetWeek` (`projects.server.ts:4538`, gate `{}`): the employee's own DCAA certification (`apps/erp/app/modules/projects/AGENTS.md`).
- `projects_acceptTimesheetReview` (`projects.server.ts:4800`, gate `{}`): the employee's own acceptance.
- `projects_postTimesheet` (`projects.server.ts:4588`): unpublished on purpose. It does not check approval routing.
- Person timecards (`apps/erp/app/modules/people/people.server.ts:155`): unpublished on purpose. Its comment says "an API key with view access must not write time".

## G. Bugs in published tools

- [x] G-1 Fixed on main by PR #2344 (merged 2026-11-23). On 2026-11-24, `settings_getCustomFieldsTables` on app.carbon.ms returned 94 rows for an API key. History: (cause found, needs RLS: `customFieldTable` reads only for `auth.role() = 'authenticated'`, which an API key is not; an API key does read its own `company` row, checked 2026-11-23; PR #1958 keeps the policy; PR #2344 fixes it: with its migration an API key reads 94 `customFieldTables` rows, 72 periods and a GBP market rate, against 0, 0 and an error before, checked in a rolled-back transaction 2026-11-23) `settings_getCustomFields` and `settings_getCustomFieldsTables` return no rows for an API key. `settings_getCustomField` by id works.
- [x] G-2 `quality_createIssueWorkflow` types `requiredActionIds` as a string and writes it to a text[] column. A comma list fails ("Malformed array literal"). Only `{a,b}` works. **Done:** takes an array of ids (a JSON, brace or comma string still works); `content` takes Markdown or a Tiptap document, on create and update.
- [x] G-3 The schema of `quality_updateInspectionDocumentSampling` allows null `samplingInspectionLevel` and `samplingSeverity`. The validator refuses null. **Done:** the four non-plan-type fields are optional and the save keeps only what the plan type uses. Second cause in the generator: a nullable enum was published without `null` in `enum`, so the input validator refused null for every such field; the generator now lists it (pinned in `mcp-service-fn-metadata.test.ts`).
- [x] G-4 The published schema of `items_upsertConfigurationParameterGroup` has only `itemId`. The operation needs `name`. It answers null, not the new group. **Done:** the input is the group form's (`id?`, `name`), strict, and it answers `{ id }`; a rename of another item's group is refused.
- [x] G-5 `items_createMaterial` ignores the `id` and `name` it gets. It names the material from the material's properties. **Done:** under generated ids `id` and `name` are optional and a differing one is refused (the form has neither field); typed ids require both. `createMaterial` and `updateMaterial` now return refusals as errors.
- [x] G-6 `items_updatePart` always writes `active: true`. So it activates an item that an unreleased change notice holds inactive. `items_setItemActive` refuses that same change. Fixed on main by PR #2225 (merged 2026-11-23): no details save writes `active`.
- [x] G-7 `quality_saveInspectionDocument` gives all characteristics of one call the same `createdAt`. Carbon orders characteristics by `createdAt`, so the call loses their order. **Done:** one save's characteristics are spaced a microsecond apart in sent order (database test red without the fix). The update runs after the save RPC, in its own transaction; spacing inside the RPC needs a migration. New Version (`copyInspectionDocumentAsVersion`) still copies them with one `createdAt`.
- [x] G-8 `sales_createQuoteLine`, `sales_createSalesOrderLine` and 3 or more other creates answer without the new record's id. A caller tells 2 lines of one item apart only by reading the lines before and after. **Done:** only `projects_createProjectExpense` lacked its id; it answers `{ id }`. `resources_createMaintenanceDispatchItem` now returns its refusals as errors; `quality_insertIssueReviewer` answers `{ id }`.
- [x] G-9 `items_getChangeNoticeAffectedItems` returns 25 rows per page, and its schema has no paging arguments. **Done:** not a bug: a full-set read that `call_tool` pages. Found instead: `call_tool` refused `limit`/`offset` on 43 full-set reads with a strict input; fixed in `packages/ee/src/mcp/server.ts`, tested.
- [x] G-10 In `settings_createItemSerialSequence` and `settings_updateItemSerialSequence`, `next` has no description. It holds the last number issued, not the next one. If a caller sends 1, the first unit gets the second number. **Done:** `next` is described as the last number issued; create refuses an `id`, update refuses moving a sequence to another item (the form shows it read-only).
- [x] G-11 Job creation under the `jobCreation` serial timing gives a number only to the job's own unit. Sub-assembly units get no number until their first touch. `apps/erp/app/modules/production/AGENTS.md` says that every unit gets its number at creation. No tool renames a unit. **Done:** doc bug, not code: the approved serial-sequence plan numbers only the job's own units at creation (decision 6). Docs corrected. `production_updateJobBatchNumber` already renames any unit; it got a clear description and stores a blank number as null, as the route does.
- [x] G-12 Maintenance has 2 sets of tools. `production_createMaintenanceDispatchEvent` and `production_createMaintenanceSchedule` are bare row writes. `resources_createMaintenanceEvent` and `resources_createMaintenanceSchedule` are what the app runs. A search for "maintenance event" returns both sets. **Done:** the 14 duplicate production maintenance writes are deleted, with the production building blocks, validators and enums that only they used. The resources comment tools refuse a Completed or Cancelled dispatch and gate on `update: resources`, as the comment box does.
- [x] G-13 `inventory_adjustInventory` on a Serial or Batch item, with `readableId` and no `trackedEntityId`, books untracked stock on the tracked item. It answers success. It makes a new lot or serial only when the caller invents a `trackedEntityId`. The schema describes that field as an existing id ("See inventory_getTrackedEntities"). **Done:** a Serial or Batch adjustment with only `readableId` starts a lot or serial of that number, as the form does; a `trackedEntityId` on an untracked item, and an existing entity with no stock of the item at the location, are refused. The form's `projectId` (stock owner) now reaches the posting (an app bug: a project-stock row adjusted common stock).
- [x] G-14 `inventory_adjustInventory` takes no unit cost and no posting date. It values opening stock at the item's current cost and dates it today. **Done:** not a gap: the app form takes no cost or date either. The description says how the date and the value are chosen.
- [x] G-15 `inventory_getTrackedEntity` takes `trackedEntityId`, not `id`. Most single-record reads take `id`. **Done:** not changed: 228 single-record reads take `<entity>Id` against 57 that take `id`, and an alias would lose the required field from the schema. The description says it takes `trackedEntityId`.
- [x] G-16 No tool sets a gauge's `lastCalibrationStatus`. So a seeded overdue gauge sends a notification on the first night. **Done:** not a gap: the app sets it only from a passing calibration record or the nightly job. The calibration-record tools now work out `inspectionStatus` from the flags when it is left out, as the form does.
- [x] G-17 Not a bug: the form (`toApiKeyScopes`, `apiKeyPermissionModules`) stores `{ "<module>_<action>": [companyId] }`, the shape the key check reads. Checked in code 2026-11-23, not retested through the form.
- [x] G-18 An API key gets 20 calls a minute, the column default. The form's rate limit field saves only on single-tenant deployments. A company gets 60 calls a minute across its keys. So 10,000 calls take 8 hours on one key. PR #1958 keeps this. **Decided 2026-11-24:** left as is and documented in `.claude/rules/mcp-tools-reference.md` (Rate limits).

- [x] G-19 `sales_createContractLine` failed with a generic error when `billingMethod` was left out (the schema has it optional; the form defaults it to Fixed). The operation now defaults it to Fixed.
- [x] G-20 `production_getDemandProjections` took required `periodIds`, and no tool lists periods. `periodIds` is now optional (left out: the form's 52 weeks from the location's today), and every row carries `weekStart`. Periods are read as the system: `period` reads only for the `authenticated` role, which an API key is not (the same class of policy as G-1, left alone).
- [x] G-21 Published `projects_getIndirectPools`, `projects_getIndirectPool` (with its accounts), `projects_getIndirectRates`, `projects_getIndirectRateRuns` (`view: accounting`) and `projects_runFinalTrueUp`. `projects_setIndirectRate` answers `{ ids }`, not a list.
- [x] G-22 `invoicing_updatePurchaseInvoiceField` (and its route) gated on `update: sales` while its panel enables the fields on `update: invoicing` and the table's RLS needs `invoicing_update`. It now gates on `update: invoicing`. `updateSalesInvoiceField` keeps `update: sales`: its panel and route agree on it.

## Decisions (found while fixing G-2 to G-16; approved 2026-11-24)

- [x] The 13 duplicate production maintenance writes and `production_deleteMaintenanceDispatch` are deleted (nothing called them), with the building blocks and validators only they used. The dispatch delete route gates on `delete: resources` and calls `resources_deleteMaintenanceDispatch`, which refuses a Completed or Cancelled dispatch as the dispatch page does.
- [x] Response shapes: `resources_createMaintenanceDispatchItem`, `items_createConsumable`, `items_createMaterial`, `items_createTool` answer `{ id }`; `accounting_createFiscalYearPeriods` answers `{ ids }` and takes a whole year 2000 to 2200; `resources_issueMaintenancePart` also answers the new part's `id`.
- [x] `quality_updateIssueWorkflow` answers `{ id }` and refuses an id that matches nothing.
- [x] Quality: the calibration record tools refuse an `inspectionStatus` that contradicts the flags; `quality_insertGauge` / `updateGauge` derive the calibration status from the dates and have strict inputs. `quality_updateGaugeCalibrationRecord` answers `{ id }` and refuses an unknown record before it moves the gauge's dates (found in the self-test: before, it answered null and rewrote the gauge).
- [x] `production_updateJobBatchNumber` gates on `update: production` and writes as the system, as the route does; it takes `jobId` and refuses a unit that is not the job's.
- [x] Settings → Production copy corrected for Job creation and Job release, in all 13 locales.
- [ ] `apps/erp/test/database/activate-accounting/legacy/legacy-documents.test.ts` (2 tests), `journal-legacy-documents.test.ts` and `invoice-first.test.ts` (1 each) fail on main too: commit 7c053f2644 (PR #2124) reads PO approval states through PostgREST in `postPurchaseInvoice`, which these database-only tests cannot reach. Not fixed here: it belongs to the PO approvals feature.

## More found and fixed on 2026-11-24

- `settings_setRecordCustomFields` wrote across companies (part ids repeat); it is now scoped to the company, and refuses a key that is not one of the table's custom fields unless the records already hold that value.
- `users_revokeInvites` deactivated active accounts under `create: users`; it now takes only pending invites, answers how many it revoked (it answered 0 for one), and writes the revoke's audit entry with the request origin.
- `users_inviteCustomerContact` / `inviteSupplierContact` refuse a person who already has an account in the company (before, the failed insert's rollback deactivated that account).
- `describe_tool` joined a gate's actions with "or"; the gate requires all of them.
- The resources failure-mode, schedule-delete and dispatch-comment routes call their operations; the comment box saved nothing before (its validator required a field the box never sent). The dispatch comment tools gate on `update: resources`, as the comment box shows, and an update is scoped to its dispatch.
- Two unreachable maintenance routes that added a part without issuing stock are deleted.
- Also published: `projects_createPurchaseOrderLineFromMaterial`, `purchasing_getRequestQuoteRows`, `settings_writeMissingJournals`, `shared_getPlanningPeriods` (the planning tools' period ids), `users_deactivateUsers`, `users_inviteCustomerContact`, `users_inviteSupplierContact`, `users_getEmployeePermissions`.

## Known gaps (not in this branch)

- `projects_createJobFromMaterial` and `createPurchaseOrderLineFromMaterial` check the material has no job or PO line, write it, then stamp the material: two calls at once can each create one. The app has the same race.
- Deactivating one user does not update the Cloud seat count (two or more do, through the job).
- A customer or supplier invite still overwrites a pending employee invite with the same email.
- `period` has no unique key on (startDate, periodType): two first reads of a new week at once can each insert it, as the planning loaders and MRP can.
- Six `customFieldTable` tables cannot take values (four lack audit columns, two lack `customFields`); no panel posts for them.
- `items_deleteItem` leaves the consumable, tool and material subtype rows behind.
- A refusal for a missing permission says "You do not have permission to do this" without naming it (the log names it); only the `refuseKeyWithout` tools name the scope.

## PR #1958 (page-level permissions), reviewed 2026-11-23

- G-1 and the `period` read stay broken: its manifest keeps `select: authenticated` on 12 tables (`customFieldTable`, `period`, `country`, `currencyCode`, `config`, `plan`, `integration`, `attributeDataType`, `industry`, `webhookTable`, `scriptRun`, `ssoReservedDomain`). An API key reads none of their rows today.
- Fix in its terms: a predicate for a valid API key (`util.request_api_key()`) or-ed with `authenticated` on those tables, then regenerate the policies.
- `production_updateJobBatchNumber` is fixed there: gated on `production.jobs` Edit, writes `trackedEntity` as the system, as the route does.
- G-18 unchanged.
- Collision: it replaces module gates with page gates and `carbon(request)` with `authorize()`, and its `no-module-permission-key` check fails a module gate. Every operation and route this branch adds needs converting, whichever merges second.

## After PR #2344 merges (merged 2026-11-23; #2225 merged the same day, closing G-6)

PR #2344 merged on 2026-11-23. Main was checked against this branch on 2026-11-24.

- Closed by it: G-1, and the `period`, `country`, `currencyCode` and `exchangeRate` reads for API keys.
- Optional cleanup: `getDemandProjectionWeeks` can read `period` as the caller instead of the system.
- Still open: this branch (uncommitted, no PR); the decisions above; B (6), C (3), D (5); G-18; `production_updateJobBatchNumber` gate (fixed only in #1958).
- Main now has 1849 tools. The 26 new tools are tax tools (PR #1957) and `settings_getBaseCurrencyChange` (PR #2331). None of them closes a gap in this plan.
- A dry-run merge of this branch with main conflicts in 6 files: `items/AGENTS.md`, `items.server.ts`, `quality.server.ts`, `quality.utils.ts`, `quality.utils.test.ts` and the tool digest. Merge main before you commit.
- New gap it names: no tool lists planning periods, so `items_getItemDemand`, `items_getDemandForecastSources`, `production_getProductionPlanning`, `production_getProductionProjections` and `purchasing_getPurchasingPlanning` still cannot be called usefully.

## Status 2026-11-23

- Groups A (15 of 16) and E (13 tools) built, uncommitted: 28 new tools; with G-21's five, 1856 in total.
- Self-tested over MCP on the local stack with a full key and a view-only key: every tool's success path read back with psql, and its narrow-key refusal. Group A and E scenarios pass (E step 3: the pinned item is refused with the rule's violation and the block is recorded).
- App comparison (browser): sales order date, group, training completion match field for field. The employee type form writes a row for every module (MCP writes the modules sent; an update keeps modules not sent, now documented). Funding actions show in the app only in DCAA mode, which the government contracting rule makes display-only.
- Behaviour added while publishing: `completeTrainingAssignment` is split (the route calls `completeTrainingAssignmentWithCertificate`); a group member must be `user_` or `group_` prefixed; the two indirect deletes and the sales rule and custom field writes refuse an id that matches nothing; the custom field insert returns its id; the demand projection form posts week start dates.
- Checks: erp typecheck, Biome on changed files, `check:manifest`, `mcp-tool-permissions` / `mcp-service-fn-metadata` / `mcp-manifest-cache-inputs`, `@carbon/checks` (436 tests) pass.
- G-2 to G-16 done (G-6 is PR #2225) on 2026-11-23, with the MCP paging fix and the generator's nullable-enum fix; tests and checks green.
- Open: B, C, D (approved 2026-11-24, not built); G-18 (on hold); the decisions above. G-1 and G-6 closed on main on 2026-11-23.

## Status 2026-11-24

- Groups B, C and D built; decisions done; 1890 tools.
- Group D scenario passed on the local stack: 3 invites over MCP (3 employee types), each accepted in a browser and shown its type's modules; one `users_bulkUpdatePermissions` call added Sales view and create to all 3 (read back with `users_getEmployeePermissions` within 5 s, and the Sales module appeared in the app); a fourth and a fifth invite revoked; revoking an accepted user refused; the 3 deactivated with `users_deactivateUsers` (self, unknown id and a view-only key refused).
- Live MCP pass over the other new and changed tools: all pass after the two fixes above (calibration record update, custom field keys).

## Checked: not gaps

- Project stock transfer posting: `projects_updateProjectStockTransferStatus` with `action: "post"` runs `postProjectStockTransfer`.
- Milestone completion: `projects_completeProjectMilestone` completes a milestone now, as the app does.
- Project status: `projects_createProject` makes a Draft project. `projects_updateProjectStatus` changes its status.
- Training assignments: `resources_createTrainingAssignment` is published. An assignment targets groups, so group creation (group A) was the real block.
