# Issue tracker sync — implementation plan

**Spec:** .ai/specs/2026-10-17-issue-tracker-sync.md
**Research:** .ai/research/issue-tracker-sync.md
**Closest sibling:** the change notice action task link (`ChangeNoticeActions.tsx`, `components/ActionTasks/*`, `api+/integrations.{linear,jira}.issue.{link,create}.ts`)
**Branch:** `projects-wbs-research-spec` (the current branch). The working tree holds other uncommitted work. Stage only the files that a task names.

## Progress

**Phase 0 — inbound fixes (PR 1)**
- [x] Task 1: Move `isChangeNoticeLocked` to `@carbon/database/change-notice`
- [x] Task 2: Add the pure assignee rule and fix the employee lookup
- [x] Task 3: Fix `getUsers`, add `duplicate`, fetch the team, scope `getWorkflowState`
- [x] Task 4: Fix the inbound jobs (assignee rule, change notice lock)
- [x] Task 5: Scope the quality mapping read by `companyId`
- [x] Task 6: Phase 0 gate and commit

**Phase 1 — sync engine for action tasks (PR 2)**
- [x] Task 7: Migration — add `ISSUE_SYNC` to the handler type CHECK
- [x] Task 8: Event system — suppress `ISSUE_SYNC` during sync, attach `projectElement`
- [x] Task 9: Add `ISSUE_SYNC` to the queue and the event types
- [x] Task 10: Create the pure `issue-sync` core (types, registry, maps, diff, locks)
- [x] Task 11: Extend the Linear and Jira clients
- [x] Task 12: Create `ensureIssueSyncSubscriptions` and the install hooks
- [x] Task 13: Create the server engine (`pushRecords`, `applyIssue`, `writeLink`)
- [x] Task 14: Create the `issue-sync` and `issue-sync-push` Inngest functions
- [x] Task 15: Rewrite the inbound jobs on `applyIssue`; accept remote deletes
- [x] Task 16: Move the link and create routes onto the engine
- [x] Task 17: Remove the old outbound path
- [x] Task 18: Show the refusal in the issue dialogs
- [x] Task 19: Phase 1 docs, gate and commit

**Phase 2 — project elements (PR 3)**
- [x] Task 20: Add the project-plan helpers to `@carbon/database`
- [ ] Task 21: Add `projectElement` to the registry, maps and locks
- [ ] Task 22: Support `projectElement` in the engine, routes and subscriptions
- [ ] Task 23: Add the dialogs to the element page
- [ ] Task 24: Phase 2 docs, gate and commit
- [ ] Task 25: Browser verification (`/test`)

## Dependencies

- Tasks 1–5 are Phase 0. Task 2 and Task 3 are independent. Task 4 needs Tasks 1–3. Task 5 is independent.
- Task 6 needs Tasks 1–5.
- Task 8 needs Task 7. Task 9 is independent of Tasks 7–8.
- Task 10 needs Task 6. Task 11 is independent of Task 10.
- Task 12 needs Task 10. Task 13 needs Tasks 10, 11 and 12.
- Task 14 needs Tasks 9 and 13. Task 15 needs Task 13. Task 16 needs Task 13.
- Task 17 needs Tasks 14, 15 and 16. Task 18 needs Task 10.
- Task 19 needs Tasks 7–18.
- Task 20 needs Task 19. Task 21 needs Task 20. Task 22 needs Task 21. Task 23 needs Task 22.
- Task 24 needs Tasks 20–23. Task 25 needs Task 24.

## Conventions for every task

- Start each new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files. Files under `packages/ee/` get the commercial header.
- Never use JavaScript `Date`. Use `datetime.timestamp()` from `@carbon/utils` for a timestamp string.
- Every query filters by `companyId`.
- Never query inside a loop. Collect ids and make one `.in()` call.
- Format with Biome: `pnpm exec biome check --write <files>`.

---

## Task 1: Move `isChangeNoticeLocked` to `@carbon/database/change-notice`

**Depends on:** none
**Files:**
- Create: `packages/database/src/change-notice.ts`
- Modify: `packages/database/package.json` — add the export `"./change-notice": "./src/change-notice.ts"` beside `"./project-plan"`.
- Modify: `apps/erp/app/modules/items/items.models.ts` — import and re-export the function.
- Copy from (precedent): `packages/database/src/project-plan.ts` (a pure module the app and packages share)

**Steps:**
1. Create `packages/database/src/change-notice.ts` with the AGPL header and this body:
   ```ts
   // Locked once closed — Done (released, part of the audit trail) or Cancelled
   // (abandoned). Reopen a Cancelled CO to Draft to edit it again.
   export function isChangeNoticeLocked(
     status: string | null | undefined
   ): boolean {
     return status === "Done" || status === "Cancelled";
   }
   ```
2. In `items.models.ts`, delete the local `isChangeNoticeLocked` function (line 1196).
3. In `items.models.ts`, add `import { isChangeNoticeLocked } from "@carbon/database/change-notice";`.
4. In `items.models.ts`, add `export { isChangeNoticeLocked };` so current callers do not change.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database
# Expected: both tasks succeed with 0 errors
```

**Out of scope:** `canEditChangeNoticeEngineering`, `canEditChangeNoticeWorkflow` and the other predicates stay in `items.models.ts`.

## Task 2: Add the pure assignee rule and fix the employee lookup

**Depends on:** none
**Files:**
- Create: `packages/ee/src/issue-sync/assignee.ts`
- Create: `packages/ee/src/issue-sync/assignee.test.ts`
- Modify: `packages/ee/src/linear/lib/service.ts` — `getCompanyEmployees` select
- Modify: `packages/ee/src/jira/lib/service.ts` — `getCompanyEmployees` select
- Copy from (precedent): `packages/ee/src/accounting/core/subscriptions.test.ts` (vitest layout in `packages/ee`)

**Steps:**
1. Create `assignee.ts` with this exported function:
   ```ts
   /**
    * The Carbon assignee an inbound issue implies (spec Q8, Q9).
    * - `undefined`: leave the Carbon assignee unchanged.
    * - `null`: clear it (the issue is unassigned).
    * - a user id: set it.
    */
   export function resolveInboundAssignee(args: {
     issueHasAssignee: boolean;
     matchedUserId: string | null | undefined;
   }): string | null | undefined {
     if (!args.issueHasAssignee) return null;
     return args.matchedUserId ?? undefined;
   }
   ```
2. Create `assignee.test.ts` with 3 cases:
   - no assignee → `null`
   - an assignee with a match → the id
   - an assignee with no match → `undefined`
3. In both `getCompanyEmployees`, change `.select("userId,user(email)")` to `.select("userId,user!inner(email)")`. Keep `.in("user.email", emails)`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- issue-sync/assignee
# Expected: 3 passed
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: 0 errors
```

**Out of scope:** the create routes' `members.filter` loop in `integrations.linear.issue.create.ts`; it keeps working with the fixed query.

## Task 3: Fix `getUsers`, add `duplicate`, fetch the team, scope `getWorkflowState`

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/linear/lib/client.ts`
- Modify: `packages/ee/src/linear/lib/types.ts`
- Modify: `packages/ee/src/linear/lib/utils.ts`
- Modify: `packages/ee/src/notifications/services/linear.ts` — pass the team
- Create: `packages/ee/src/linear/lib/utils.test.ts`

**Steps:**
1. In `utils.ts`, add `Duplicate = "duplicate"` to `LinearWorkStateType`.
2. In `mapLinearStatusToCarbonStatus`, map `Duplicate` to `"Skipped"`, beside `Canceled`.
3. In `getUsers`, change the variables to `{ filter: toUserFilter(filter) }`.
4. Add a module-level function in `client.ts`:
   ```ts
   function toUserFilter(filter: { email?: string; id?: string }) {
     return {
       ...(filter.email ? { email: { eqIgnoreCase: filter.email } } : {}),
       ...(filter.id ? { id: { eq: filter.id } } : {})
     };
   }
   ```
5. If `getUsers` receives neither `email` nor `id`, return `[]` before the request.
6. In the three issue queries (`listIssues`, `getIssueById`, `createIssue`), add `team { id }` after `assignee { email }`.
7. In `types.ts`, add `team: z.object({ id: z.string() }).nullish()` to `LinearIssueSchema`.
8. Change `getWorkflowState` to `getWorkflowState(companyId: string, teamId: string, type: LinearWorkStateType)`.
9. Set its filter to `{ team: { id: { eq: teamId } }, type: { eq: type } }`.
10. Request `nodes { id name color type position }`, sort the nodes by `position` ascending, and return the first, or `null`.
11. In `notifications/services/linear.ts` `task.status.changed`: read `issue.team?.id`.
12. If the team id is missing, call `linear.getIssueById(event.companyId, issue.id)` and read its `team?.id`.
13. If there is still no team id, return without a push.
14. Pass the team id to `getWorkflowState`.
15. Create `utils.test.ts`: `duplicate` and `canceled` map to `Skipped`; `started` maps to `In Progress`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- linear/lib/utils
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: 0 errors
```

If Linear's `UserFilter` has no `eqIgnoreCase` on `email`, use `eq`. Check `https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql` (`StringComparator`). If neither exists, STOP and report.

**Out of scope:** the outbound assignee push in `services/linear.ts` (`task.assigned`); Phase 1 deletes it.

## Task 4: Fix the inbound jobs (assignee rule, change notice lock)

**Depends on:** Tasks 1, 2, 3
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/linear.ts`
- Modify: `packages/jobs/src/inngest/functions/integrations/jira.ts`
- Modify: `packages/ee/src/linear/lib/service.ts` — `linkActionToLinearIssue`
- Modify: `packages/ee/src/jira/lib/service.ts` — `linkActionToJiraIssue`

**Steps:**
1. In both `linkAction*` functions, add the `assignee` key to `updateData` only when `input.assignee !== undefined`.
2. In the Linear job, delete the `linear.getUsers(...)` call (lines 93–96).
3. Set `const email = fullIssue.assignee?.email ?? null`.
4. If `email` is set, call `getCompanyEmployees(carbon, payload.companyId, [email])`.
5. Set `assignee` to `resolveInboundAssignee({ issueHasAssignee: !!fullIssue.assignee, matchedUserId: employees[0]?.userId })`.
6. In the Jira job, set `issueHasAssignee` to `!!fullIssue.fields.assignee`.
7. In the Jira job, look up employees only when `fullIssue.fields.assignee?.emailAddress` is set.
8. In the Jira job, pass `resolveInboundAssignee(...)` as `assignee`.
9. Export `resolveInboundAssignee` from `packages/ee/src/linear/lib/index.server.ts` and `packages/ee/src/jira/lib/index.server.ts`: `export { resolveInboundAssignee } from "../../issue-sync/assignee";`.
10. In both jobs, after the `isActionTaskEntityType` check, add the change notice lock:
    ```ts
    if (entityType === "changeOrderActionTask") {
      const task = await carbon
        .from("changeOrderActionTask")
        .select("changeOrder(status)")
        .eq("id", actionId)
        .eq("companyId", payload.companyId)
        .maybeSingle();
      if (isChangeNoticeLocked(task.data?.changeOrder?.status)) {
        return { success: true, message: "Skipped: the change notice is closed" };
      }
    }
    ```
11. Import `isChangeNoticeLocked` from `@carbon/database/change-notice`.
12. In the Linear job, `actionId` is `action.data.id`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/ee
# Expected: 0 errors
```

If the `changeOrder(status)` embed fails to typecheck, make two queries. First read `changeOrderId` from the task. Then read `status` from `changeOrder`.

**Out of scope:** the link routes' own `client.from("user")` assignee lookup; Task 16 replaces it.

## Task 5: Scope the quality mapping read by `companyId`

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/quality/quality.service.ts` — `getIssueActionTasks` (around line 497)

**Steps:**
1. Find the two `externalIntegrationMapping` reads in `getIssueActionTasks`.
2. Add `.eq("companyId", companyId)` to each. The function already takes `companyId` as its third argument.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** `getChangeNoticeActions`; it already filters by `companyId`.

## Task 6: Phase 0 gate and commit

**Depends on:** Tasks 1–5
**Files:**
- Modify: `.claude/rules/linear-integration.md` — note the `!inner` employee lookup, the team-scoped `getWorkflowState` and the assignee rule
- Modify: `.claude/rules/jira-integration.md` — note the assignee rule and the change notice lock

**Steps:**
1. Update the two rules with the facts in **Files**. Keep each change to 1–3 lines.
2. Run `pnpm --filter @carbon/checks license-headers`.
3. Run the `check-and-commit` skill with this commit message: `fix(integrations): correct the inbound Linear and Jira sync`.
4. Stage only the files of Tasks 1–6.

**Verify:**
```bash
pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test
# Expected: all pass
git log -1 --stat
# Expected: only Task 1–6 files
```

**Out of scope:** any file in the unrelated uncommitted work on this branch (service orders, MRP).

---

## Task 7: Migration — add `ISSUE_SYNC` to the handler type CHECK

**Depends on:** Task 6
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_issue-sync-handler-type.sql` (from the command)

**Steps:**
1. Run `pnpm db:migrate:new issue-sync-handler-type`.
2. Find the newest migration that sets the CHECK: `grep -ln "eventSystemSubscription_handlerType_check" packages/database/supabase/migrations/*.sql | tail -1`.
3. Copy its exact value list. Today it is `'WEBHOOK', 'WORKFLOW', 'SYNC', 'SEARCH', 'AUDIT', 'EMBEDDING'`.
4. Write this SQL in the new file, with that list plus `'ISSUE_SYNC'`:
   ```sql
   ALTER TABLE "eventSystemSubscription"
     DROP CONSTRAINT IF EXISTS "eventSystemSubscription_handlerType_check";
   ALTER TABLE "eventSystemSubscription"
     ADD CONSTRAINT "eventSystemSubscription_handlerType_check"
     CHECK ("handlerType" IN (
       'WEBHOOK', 'WORKFLOW', 'SYNC', 'SEARCH', 'AUDIT', 'EMBEDDING', 'ISSUE_SYNC'
     ));
   ```
5. Run `pnpm db:migrate`.
6. Run `pnpm run generate:types`.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'eventSystemSubscription_handlerType_check';"
# Expected: the definition lists 'ISSUE_SYNC'
```

If the local database is unreachable, STOP and report. Never rebuild the database. Load every `SUPABASE_*` variable from `.env.local` first; a shell value can point at another worktree.

**Out of scope:** the `handlerType` column type; it stays `TEXT`.

## Task 8: Event system — suppress `ISSUE_SYNC` during sync, attach `projectElement`

**Depends on:** Task 7
**Files:**
- Modify: `packages/database/src/event-system/functions/dispatch_event_batch.sql` — lines 40 and 80
- Modify: `packages/database/src/event-system/attachments.ts` — add `projectElement`
- Create: the generated authz migration (from the command)

**Steps:**
1. In `dispatch_event_batch.sql`, change both `"handlerType" NOT IN ('SYNC','WEBHOOK','WORKFLOW')` to `"handlerType" NOT IN ('SYNC','WEBHOOK','WORKFLOW','ISSUE_SYNC')`.
2. In `attachments.ts`, add `projectElement: { events: true },` in alphabetical order. If `projectElement` already has an entry, add `events: true` to it.
3. Run `pnpm --filter @carbon/database authz sync`.
4. Run `pnpm --filter @carbon/database authz migration issue-sync-events`.
5. Open the generated migration. It must hold the `dispatch_event_batch` function and one `set_event_triggers('projectElement', …)` call.

**Verify:**
```bash
pnpm --filter @carbon/database test -- event-system
# Expected: all pass
psql "$SUPABASE_DB_URL" -c "SELECT tgname FROM pg_trigger WHERE tgrelid = '\"projectElement\"'::regclass AND tgname LIKE 'trg_event_async%';"
# Expected: at least 1 row
```

**Out of scope:** any other table's attachments.

## Task 9: Add `ISSUE_SYNC` to the queue and the event types

**Depends on:** none
**Files:**
- Modify: `packages/database/src/event.ts` — `HandlerTypeSchema`
- Modify: `packages/jobs/src/inngest/functions/events/queue.ts` — bucket and dispatch
- Modify: `packages/lib/src/events.ts` — two event types
- Copy from (precedent): the `SYNC` dispatch block in `queue.ts` (step "5. Dispatch syncs")

**Steps:**
1. Add `"ISSUE_SYNC"` to `HandlerTypeSchema`.
2. In `queue.ts`, add `ISSUE_SYNC: []` to `grouped`.
3. After the embeddings block, add "Dispatch issue syncs (chunked)". Map each job to `{ event, companyId }`.
4. Pack with `packBySize(records, MAX_EVENT_BYTES, MAX_RECORDS)`.
5. Send each chunk as `{ name: "carbon/event-issue-sync", data: { records } }` with step id `dispatch-issue-syncs-${pass}-${i}`.
6. In `packages/lib/src/events.ts`, add `"carbon/event-issue-sync"` with the same `data.records` shape as `"carbon/event-search"`.
7. Add `"carbon/issue-sync.push"`: `data: { companyId: string; records: Array<{ table: string; recordId: string; operation: "UPDATE" | "DELETE"; old: Record<string, unknown> | null }> }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/database --filter=@carbon/lib
# Expected: 0 errors
pnpm --filter @carbon/jobs test -- events
# Expected: all pass
```

**Out of scope:** the handler function itself (Task 14).

## Task 10: Create the pure `issue-sync` core

**Depends on:** Task 6
**Files:**
- Create: `packages/ee/src/issue-sync/types.ts`
- Create: `packages/ee/src/issue-sync/entities.ts`
- Create: `packages/ee/src/issue-sync/maps.ts`
- Create: `packages/ee/src/issue-sync/diff.ts`
- Create: `packages/ee/src/issue-sync/locks.ts`
- Create: `packages/ee/src/issue-sync/index.ts`
- Create: `packages/ee/src/issue-sync/{maps,diff,locks,entities}.test.ts`
- Modify: `packages/ee/package.json` — exports
- Copy from (precedent): `packages/ee/src/lib/actionTaskEntity.ts` (the registry this replaces)

**Steps:**
1. `types.ts` — write these types and the schema:
   ```ts
   export type IssueTracker = "linear" | "jira";
   export type SyncedEntityType =
     | "nonConformanceActionTask"
     | "changeOrderActionTask";
   export type SyncedField =
     | "title" | "description" | "status" | "assignee" | "priority" | "dueDate";
   export type FieldValues = Partial<Record<SyncedField, string | null>>;
   export const SnapshotValueSchema = z.object({
     carbon: z.string().nullable(),
     remote: z.string().nullable()
   });
   export const LinkSyncSchema = z.object({
     values: z.record(z.string(), SnapshotValueSchema).default({}),
     refused: z
       .object({ at: z.string(), fields: z.array(z.string()), reason: z.string() })
       .nullish()
   });
   export type LinkSync = z.infer<typeof LinkSyncSchema>;
   ```
2. `entities.ts` — write `syncedEntities: Record<SyncedEntityType, SyncedEntity>`:
   ```ts
   type SyncedEntity = {
     table: SyncedEntityType;
     parentColumn: "nonConformanceId" | "changeOrderId";
     parentTable: "nonConformance" | "changeOrder";
     readableColumn: "nonConformanceId" | "changeOrderId";
     textColumn: "notes";
     assigneeColumn: "assignee";
     dueDateColumn: "dueDate";
     fields: SyncedField[];               // ["status", "assignee", "dueDate", "description"]
     permissions: { update: string };     // quality | parts
     detailPath: (parentId: string, id: string) => string;
   };
   ```
   - Read `parentTable` and `readableColumn` from `actionTaskParents` in `apps/erp/app/modules/shared/shared.server.ts:815`. Copy its values.
   - `detailPath` returns `/x/issue/${parentId}/details` and `/x/items/change-notice/${parentId}/details`, as the routes build today.
   - Export `isSyncedEntityType(value)`, `syncedEntityPermissions(type)` and `syncedEntityParentId(rows, type)`. Copy their bodies from `actionTaskEntity.ts`.
3. `maps.ts` — re-export the task status maps from `../linear/lib/utils` and `../jira/lib/utils`. Add `fnv1a(text: string): string` (32-bit FNV-1a, lowercase hex).
4. `maps.ts` — add `hashText(value: unknown): string | null`. Return `null` for `null` or `undefined`. Else return `fnv1a(JSON.stringify(value))`.
5. `diff.ts` — write three pure functions:
   ```ts
   // Fields whose Carbon value differs from the snapshot's `carbon`. No snapshot → all fields.
   export function changedOutbound(fields: SyncedField[], carbon: FieldValues, sync: LinkSync | null): SyncedField[];
   // Fields whose issue value differs from the snapshot's `remote`. No snapshot → all fields.
   export function changedInbound(fields: SyncedField[], remote: FieldValues, sync: LinkSync | null): SyncedField[];
   // Merge field updates into a snapshot; `refused` replaces the old refusal (null clears it).
   export function nextSync(sync: LinkSync | null, updates: Partial<Record<SyncedField, { carbon: string | null; remote: string | null }>>, refused?: LinkSync["refused"]): LinkSync;
   ```
   Treat `undefined` and `null` as equal in the comparisons.
6. `locks.ts` — write the lock rule:
   ```ts
   export type LockContext = { changeNoticeStatus?: string | null };
   export function lockedFields(type: SyncedEntityType, ctx: LockContext): { fields: SyncedField[]; reason: string } | null;
   ```
   - `changeOrderActionTask` with `isChangeNoticeLocked(ctx.changeNoticeStatus)` → all its fields, reason `"the change notice is closed"`.
   - Everything else → `null`.
7. `index.ts` — `export * from` each of the five files.
8. In `packages/ee/package.json`, add `"./issue-sync": "./src/issue-sync/index.ts"` and `"./issue-sync.server": "./src/issue-sync/index.server.ts"`. Task 13 creates `index.server.ts`.
9. Tests:
   - `diff`: no snapshot → all fields; one changed field → only that field; `null` equals `undefined`; `nextSync` keeps untouched fields; `refused: null` clears.
   - `locks`: Done and Cancelled lock all fields; Implementation locks none; a quality task locks none.
   - `maps`: `hashText(null) === null`; the same JSON gives the same hash; different JSON gives a different hash.
   - `entities`: `isSyncedEntityType("projectElement") === false` (Phase 1); `detailPath` paths.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- issue-sync
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: 0 errors
```

**Out of scope:** network calls and database reads; they go in Task 13. Keep this module client-safe: no `.server` imports.

## Task 11: Extend the Linear and Jira clients

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/linear/lib/client.ts`
- Modify: `packages/ee/src/linear/lib/types.ts`
- Modify: `packages/ee/src/jira/lib/client.ts`
- Modify: `packages/ee/src/jira/lib/types.ts`

**Steps:**
1. Linear: add `priority` to the field list of every issue query (after `dueDate`).
2. Linear: add `priority: z.number().nullish()` to `LinearIssueSchema`.
3. Linear: `updateIssue` accepts `priority?: number` and `dueDate?: string | null`.
4. Linear: `updateIssue` returns `null` in its `catch`, so a caller can tell a failure from a success.
5. Linear: add `removeIssueLink(companyId, issueId, url)`. It calls `listAttachments(companyId, url)` and `removeAttachment` on each match.
6. Jira: `UpdateJiraIssueInput` gains `duedate?: string | null`. `updateIssue` sets `fields.duedate` when it is not `undefined`.
7. Jira: `updateIssue` returns `boolean`: `true` after the PUT, `false` in the `catch`.
8. Jira: add `listPriorities(companyId): Promise<Array<{ id: string; name: string }>>`. It reads `GET /priority` through `this.request` and returns `[]` on error.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp --filter=@carbon/jobs
# Expected: 0 errors
```

**Out of scope:** labels, parent issues and projects.

## Task 12: Create `ensureIssueSyncSubscriptions` and the install hooks

**Depends on:** Task 10
**Files:**
- Create: `packages/ee/src/issue-sync/subscriptions.ts`
- Create: `packages/ee/src/issue-sync/subscriptions.test.ts`
- Modify: `packages/ee/src/linear/hooks.server.ts`
- Modify: `packages/ee/src/jira/hooks.server.ts`
- Modify: `packages/ee/src/hooks.server.ts` — register the hooks
- Modify: `apps/erp/app/routes/api+/integrations.jira.oauth.ts` — run the server hook
- Copy from (precedent): `packages/ee/src/accounting/core/subscriptions.ts` (`ensureProviderSubscriptions`) and `packages/ee/src/accounting/core/subscriptions.test.ts`

**Steps:**
1. In `subscriptions.ts`, export `ISSUE_SYNC_TABLES: SyncedEntityType[] = ["nonConformanceActionTask", "changeOrderActionTask"]`.
2. Export `issueSyncSubscriptionName(tracker) = \`${tracker}-issue-sync\``.
3. Export `ensureIssueSyncSubscriptions(client, companyId, tracker)`. Copy the body of `ensureProviderSubscriptions`:
   - operations `["UPDATE", "DELETE"]`
   - `type: "ISSUE_SYNC"`, `config: { tracker }`, `active: true`
   - delete rows of that name whose table is not in `ISSUE_SYNC_TABLES`
4. Write the test with a mocked client, as `subscriptions.test.ts` in accounting does. Assert one upsert per table and the removal of an extra table.
5. In `linear/hooks.server.ts`, add `linearOnInstall(companyId)`. It calls `ensureIssueSyncSubscriptions(getCarbonServiceRole(), companyId, "linear")`.
6. Add `linearOnUninstall(companyId)`. It calls `deleteEventSystemSubscriptionsByName(client, companyId, issueSyncSubscriptionName("linear"))`.
7. Add `jiraOnInstall` and `jiraOnUninstall` the same way in `jira/hooks.server.ts`.
8. In `packages/ee/src/hooks.server.ts`, set `onInstall`, `onUpdate` (= the install hook) and `onUninstall` for `linear` and `jira`.
9. In `integrations.jira.oauth.ts`, call `getIntegrationServerHooks("jira")?.onInstall` before the client `config.onInstall`. Copy the pattern in `x+/settings+/integrations.$id.tsx:2015`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- issue-sync/subscriptions
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: 0 errors
```

**Out of scope:** accounting subscriptions.

## Task 13: Create the server engine

**Depends on:** Tasks 10, 11, 12
**Files:**
- Create: `packages/ee/src/issue-sync/engine.server.ts`
- Create: `packages/ee/src/issue-sync/trackers/linear.server.ts`
- Create: `packages/ee/src/issue-sync/trackers/jira.server.ts`
- Create: `packages/ee/src/issue-sync/index.server.ts`
- Create: `packages/ee/src/issue-sync/canonical.ts` and `canonical.test.ts`

**Steps:**
1. `canonical.ts` (pure). Export `carbonValues(type, row): FieldValues` for a task row:
   - `status: row.status`
   - `assignee: row.assignee`
   - `dueDate: row.dueDate`
   - `description: hashText(row.notes)`
2. `canonical.ts`: export `linearValues(issue: LinearIssue): FieldValues`:
   - `status: issue.state.type`
   - `assignee: issue.assignee?.email?.toLowerCase() ?? null`
   - `dueDate: issue.dueDate ?? null`
   - `description: hashText(issue.description ?? null)`
3. `canonical.ts`: export `jiraValues(issue: JiraIssue): FieldValues`:
   - `status: issue.fields.status.statusCategory.key`
   - `assignee: issue.fields.assignee?.accountId ?? null`
   - `dueDate: issue.fields.duedate ?? null`
   - `description: hashText(issue.fields.description ?? null)`
4. `canonical.test.ts`: the same row gives the same values; `notes` changes change `description` only.
5. `trackers/linear.server.ts`: export `pushToLinear(companyId, link, row, fields)`. It returns `Partial<Record<SyncedField, string | null>>`: the remote value of each field it pushed.
   - `status`: `getWorkflowState(companyId, teamId, mapCarbonStatusToLinearStatus(row.status))`. Read `teamId` from `link.metadata.team.id`, or fetch the issue when it is missing.
   - `assignee`: read the user's email from `user` (one query). `null` → `assigneeId: null`. Else `getUsers({ email })`; no match → skip the field.
   - `dueDate`: `dueDate: row.dueDate`.
   - `description`: `tiptapToMarkdown(row.notes)`; remote value `hashText(markdown)`.
   - Send one `updateIssue` with every field. If it returns `null`, return `{}`.
6. `trackers/jira.server.ts`: export `pushToJira(companyId, link, row, fields)`, with the same return shape.
   - `status`: `transitionIssue(companyId, issueId, mapCarbonStatusToJiraCategory(row.status))`. If it returns `false`, leave `status` out.
   - `assignee`: email → `findUserByEmail`; `null` → `assigneeId: null`. Remote value is the `accountId`.
   - `dueDate`: `duedate`.
   - `description`: `tiptapToAdf(row.notes)`; remote value `hashText(adf)`.
   - One `updateIssue` for the non-status fields.
7. `engine.server.ts`: export `readLinks(serviceRole, companyId, type, ids)`. Make one query on `externalIntegrationMapping` with `.eq("companyId")`, `.eq("entityType", type)` and `.in("entityId", ids)`.
8. `engine.server.ts`: export `writeLink(serviceRole, args)`. It upserts `{ entityType, entityId, integration, externalId, metadata, companyId }` with `onConflict: "entityType,entityId,integration,companyId"`. `metadata` is the issue metadata plus `sync`.
9. `engine.server.ts`: export `pushRecords(serviceRole, companyId, type, ids, opts?: { initial?: boolean })`:
   1. Read the links. Return early if there are none.
   2. Read the rows: `.from(table).select("*").eq("companyId", companyId).in("id", linkedIds)`.
   3. For each link, parse `metadata.sync` with `LinkSyncSchema` (null if absent).
   4. Compute `changedOutbound(entity.fields, carbonValues(type, row), opts?.initial ? null : sync)`.
   5. If no field changed, record `skipped: "unchanged"` and continue.
   6. Call `pushToLinear` or `pushToJira` by `link.integration`.
   7. For each pushed field, set the snapshot `{ carbon: carbonValues[field], remote: pushed[field] }`.
   8. Write the link with `nextSync(sync, updates)`.
   9. Return `{ pushed: n, skipped: [{ id, reason }], failed: [{ id, error }] }`.
10. `engine.server.ts`: export `deleteLinks(serviceRole, companyId, type, ids)`. Read the links. Remove the Carbon back-link from each issue (best-effort). Delete the link rows.
11. `engine.server.ts`: export `applyIssue(serviceRole, args)`. Args: `{ companyId, tracker, issueId, initial?: boolean }`.
    1. Read the link by `(integration, externalId, companyId)` with `.order("createdAt").limit(1)`.
    2. If there is none, return `{ skipped: "no link" }`.
    3. If `!isSyncedEntityType(link.entityType)`, return `{ skipped: "not a synced record" }`.
    4. Fetch the issue (`getIssueById` or `getIssue`). If it is missing, return `{ failed: "issue not found" }`.
    5. Read the row. For `changeOrderActionTask`, also read the change notice `status`.
    6. Compute `remote` (`linearValues` / `jiraValues`) and `changed = changedInbound(fields, remote, initial ? null : sync)`.
    7. Split `changed` with `lockedFields(type, ctx)` into `allowed` and `refusedFields`.
    8. Build the patch for `allowed`:
       - `status`: `mapLinearStatusToCarbonStatus` / `mapJiraStatusToCarbonStatus`.
       - `assignee`: `resolveInboundAssignee`. Look the email up with `getCompanyEmployees`. Jira: no `emailAddress` → `undefined`. Omit the key when it is `undefined`.
       - `dueDate`: the issue's due date.
       - `description`: `markdownToTiptap` / `adfToTiptap` into `notes`.
    9. If the patch is not empty, update the row with `.eq("companyId", companyId).eq("id", row.id)`.
    10. Compute `carbonValues` of `{ ...row, ...patch }`.
    11. Snapshot each allowed field as `{ carbon: after[field], remote: remote[field] }`.
    12. `refused`: `{ at: datetime.timestamp(), fields: refusedFields, reason }` when there are refused fields, else `null`.
    13. Write the link with the new issue metadata (`LinearIssue`, or `issueToMapping` for Jira) and `nextSync(...)`.
    14. Return `{ applied: allowed, refused: refusedFields }`.
12. `index.server.ts`: export everything from `engine.server.ts` and `subscriptions.ts`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- issue-sync
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: 0 errors
```

If `externalIntegrationMapping` has no `createdAt` column, order by `id`. If the upsert's `onConflict` columns do not match the unique constraint `externalIntegrationMapping_entityType_entityId_integration_companyId_key`, STOP and report.

**Out of scope:** `projectElement` (Task 22).

## Task 14: Create the `issue-sync` and `issue-sync-push` Inngest functions

**Depends on:** Tasks 9, 13
**Files:**
- Create: `packages/jobs/src/inngest/functions/events/issue-sync.ts`
- Modify: `packages/jobs/src/inngest/functions/events/index.ts` — export both functions
- Modify: `packages/jobs/src/inngest/index.ts` — register both functions
- Copy from (precedent): `packages/jobs/src/inngest/functions/events/search.ts` (a batched handler) and `tasks/kanban-level-check.ts` (an env-scoped per-company concurrency key)

**Steps:**
1. Export `ISSUE_SYNC_CONCURRENCY = { limit: 1, scope: "env", key: '"issue-sync-" + event.data.companyId' } as const`.
2. Export `issueSyncFunction` (`id: "event-handler-issue-sync"`, event `carbon/event-issue-sync`, `retries: 3`).
3. It parses `records` with `EventSchema` and groups them by `companyId`.
4. It sends one `carbon/issue-sync.push` event per company with `step.sendEvent`.
5. Each pushed record holds `{ table, recordId, operation, old }`.
6. Export `issueSyncPushFunction` (`id: "issue-sync-push"`, event `carbon/issue-sync.push`, `retries: 3`, `concurrency: ISSUE_SYNC_CONCURRENCY`).
7. It groups the records by table and drops tables that fail `isSyncedEntityType`.
8. For each table, collect the `UPDATE` ids and the `DELETE` ids.
9. Run `pushRecords` in `step.run("push-<table>")`.
10. Run `deleteLinks` in `step.run("unlink-<table>")`.
11. Return the summaries as the function output.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: 0 errors
pnpm --filter @carbon/jobs test
# Expected: all pass
```

**Out of scope:** the queue (Task 9).

## Task 15: Rewrite the inbound jobs on `applyIssue`; accept remote deletes

**Depends on:** Task 13
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/linear.ts`
- Modify: `packages/jobs/src/inngest/functions/integrations/jira.ts`
- Modify: `packages/jobs/src/schemas.ts` — the Linear schema
- Modify: `packages/lib/src/events.ts` — `carbon/linear-sync` keeps `action: string`, no change needed unless typecheck fails
- Modify: `packages/ee/src/jira/config.tsx` — setup text lists "Issue deleted"

**Steps:**
1. In `syncIssueFromLinearSchema`, change `action: z.literal("update")` to `action: z.enum(["update", "remove"])`.
2. Linear job: add `concurrency: ISSUE_SYNC_CONCURRENCY` (import from `../events/issue-sync`).
3. Linear job: if `action === "remove"`, delete the link by `(integration "linear", externalId, companyId)` with the service role. Return `{ success: true, message: "Unlinked: the issue was deleted" }`.
4. Linear job: otherwise call `ensureIssueSyncSubscriptions(carbon, companyId, "linear")`.
5. Linear job: then return `applyIssue(carbon, { companyId, tracker: "linear", issueId: payload.event.data.id })`.
6. Jira job: accept `jira:issue_deleted` and `issue_deleted` as a delete. Delete the link the same way.
7. Jira job: for `jira:issue_updated` / `issue_updated`, add the same concurrency, subscription and `applyIssue` calls.
8. Delete the Phase 0 code that `applyIssue` replaces. That is the mapping lookup, the employee lookup, the change notice lock and the `linkAction*` call.
9. In `jira/config.tsx`, add "Issue deleted" to the events that the setup text tells the admin to subscribe.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/ee --filter=erp
# Expected: 0 errors
pnpm --filter erp test -- webhook.linear webhook.jira
# Expected: all pass (the webhook route tests)
```

A webhook route test can expect a 400 for a `remove` body. If so, change that expectation to 200.

**Out of scope:** the webhook signature checks.

## Task 16: Move the link and create routes onto the engine

**Depends on:** Task 13
**Files:**
- Modify: `apps/erp/app/routes/api+/integrations.linear.issue.link.ts`
- Modify: `apps/erp/app/routes/api+/integrations.linear.issue.create.ts`
- Modify: `apps/erp/app/routes/api+/integrations.jira.issue.link.ts`
- Modify: `apps/erp/app/routes/api+/integrations.jira.issue.create.ts`
- Modify: `apps/erp/app/modules/shared/shared.server.ts` — `getActionTaskWithParent` types
- Modify: `apps/erp/app/components/ActionTasks/{Linear,Jira}/{IssueDialog,LinkIssue,CreateIssue}.tsx` — type import
- Modify: `packages/ee/src/linear/lib/service.ts`, `packages/ee/src/jira/lib/service.ts` — import from `issue-sync`
- Delete: `packages/ee/src/lib/actionTaskEntity.ts`, and its `"./action-task-entity"` export in `packages/ee/package.json`

**Steps:**
1. Replace every import of `@carbon/ee/action-task-entity`:

   | Old name | New name |
   |---|---|
   | `ActionTaskEntityType` | `SyncedEntityType` |
   | `actionTaskEntities` | `syncedEntities` |
   | `isActionTaskEntityType` | `isSyncedEntityType` |
   | `actionTaskPermissions` | `syncedEntityPermissions` |
   | `actionTaskParentId` | `syncedEntityParentId` |

   Import them from `@carbon/ee/issue-sync`.
2. In each link POST, before linking: read any link with `(integration, externalId = issueId, companyId)`.
3. If that link belongs to another record, return `{ success: false, message: "This issue is already linked to another record" }`.
4. Link POST: call `writeLink` with the issue metadata and no `sync`.
5. Link POST: then call `applyIssue(serviceRole, { companyId, tracker, issueId, initial: true })`. This replaces `linkAction*Issue` and the route's own `user` lookup.
6. Create POST: after the issue exists, call `writeLink` the same way.
7. Create POST: then call `pushRecords(serviceRole, companyId, entityType, [actionId], { initial: true })`.
8. Link and create POST: call `ensureIssueSyncSubscriptions(serviceRole, companyId, tracker)`.
9. Build the back-link URL with `getAppUrl() + syncedEntities[entityType].detailPath(parentId, actionId)`.
10. Keep the change notice lock check that the routes already make.
11. Keep the DELETE (unlink) branches as they are.
12. Delete `linkActionToLinearIssue` and `linkActionToJiraIssue` when nothing imports them: `grep -rn "linkActionTo" apps packages --include='*.ts'`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/jobs
# Expected: 0 errors
grep -rn "action-task-entity" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules
# Expected: no output
```

**Out of scope:** the dialog UI (Task 18).

## Task 17: Remove the old outbound path

**Depends on:** Tasks 14, 15, 16
**Files:**
- Delete: `packages/ee/src/notifications/services/linear.ts`, `packages/ee/src/notifications/services/jira.ts`
- Modify: `packages/ee/src/notifications/index.ts` — stop registering them
- Modify: `packages/ee/src/notifications/pipeline.ts` — `isNotificationService` = `["slack"]`; delete `notifyTaskNotesChanged`
- Modify: `packages/ee/src/notifications/types.ts` — delete `TaskNotesChangedEvent`
- Delete: `apps/erp/app/routes/api+/integrations.linear.issue.sync-notes.ts`, `apps/erp/app/routes/api+/integrations.jira.issue.sync-notes.ts`
- Delete: `apps/erp/app/components/ActionTasks/syncNotes.ts`
- Modify: `apps/erp/app/modules/quality/ui/Issue/IssueTask.tsx` — delete the `syncActionTaskNotes` calls
- Modify: `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeActions.tsx` — delete the `syncActionTaskNotes` calls
- Modify: `apps/erp/app/utils/path.ts` — delete `linearSyncNotes` and `jiraSyncNotes`

**Steps:**
1. Delete the files in **Files**.
2. In `notifications/index.ts`, remove the two registrations and the `JiraNotificationService` export.
3. In `pipeline.ts`, set the list to `["slack"]`. Delete `notifyTaskNotesChanged`.
4. In `types.ts`, delete `TaskNotesChangedEvent` from the interface list and the union.
5. In `IssueTask.tsx` and `ChangeNoticeActions.tsx`, delete each `syncActionTaskNotes(...)` call and its import. Keep the notes save.
6. Remove `hasLinearLink` / `hasJiraLink` variables that have no other use.
7. Keep `notifyTaskStatusChanged`, `notifyTaskAssigned` and the `notify.ts` hook: Slack uses them.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/jobs
# Expected: 0 errors
grep -rn "syncActionTaskNotes\|SyncNotes\|LinearNotificationService\|JiraNotificationService" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules
# Expected: no output
```

**Out of scope:** `SlackNotificationService`.

## Task 18: Show the refusal in the issue dialogs

**Depends on:** Task 10
**Files:**
- Modify: `apps/erp/app/components/ActionTasks/Linear/IssueDialog.tsx`
- Modify: `apps/erp/app/components/ActionTasks/Jira/IssueDialog.tsx`
- Copy from (precedent): the linked-issue card in `Linear/IssueDialog.tsx` (lines 118–165)

**Steps:**
1. In each dialog, parse the refusal: `const refused = LinkSyncSchema.safeParse((linkedIssue as { sync?: unknown })?.sync).data?.refused ?? null;`.
2. In the linked-issue card, under the assignee line, add a line when `refused` is set:
   ```tsx
   <p className="mt-2 text-sm text-destructive">
     <Trans>Not applied: {refused.reason}</Trans>
   </p>
   ```
3. In the trigger `Button`, when `refused` is set, add `<LuTriangleAlert className="size-3.5 text-destructive" />` after the identifier.
4. Run `pnpm --filter @carbon/locale lingui:extract` if the repo's `/translate` flow requires it; the `check-and-commit` skill runs `/translate`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** any new component. Use the existing `Trans`, icon and class names.

## Task 19: Phase 1 docs, gate and commit

**Depends on:** Tasks 7–18
**Files:**
- Modify: `.claude/rules/linear-integration.md`, `.claude/rules/jira-integration.md` — the engine, the snapshot, the locks, remote delete, the removed services and routes
- Modify: `.claude/rules/event-system.md` — add the `ISSUE_SYNC` row to the handler table and to the `app.sync_in_progress` note
- Modify: `.ai/specs/2026-10-17-issue-tracker-sync.md` — status `in-progress`; changelog line

**Steps:**
1. Update the three rules. Name the files and functions of Tasks 10–17.
2. Update the spec.
3. Run `pnpm --filter @carbon/checks license-headers`.
4. Run `pnpm db:check:datasets` and `pnpm db:check:backups` (the pre-commit hook runs them for `packages/database/` changes).
5. Run the `check-and-commit` skill with the message `feat(integrations): sync action tasks through event subscriptions`.
6. Stage only the files of Tasks 7–19.

**Verify:**
```bash
pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test && pnpm --filter @carbon/database test
# Expected: all pass
git log -1 --stat
# Expected: only Task 7–19 files
```

**Out of scope:** the product docs page; Task 24 updates it once elements ship.

---

## Task 20: Add the project-plan helpers to `@carbon/database`

**Depends on:** Task 19
**Files:**
- Modify: `packages/database/src/project-plan.ts`
- Create: `packages/database/src/project-plan.test.ts` (or add to it if it exists)
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — re-export `isProjectPlanLocked`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — use `completedAtForGroup` (line 1514)

**Steps:**
1. Move `isProjectPlanLocked` from `projects.models.ts:3882` into `project-plan.ts`, unchanged.
2. In `projects.models.ts`, add `export { isProjectPlanLocked } from "@carbon/database/project-plan";`.
3. Add `completedAtForGroup(group: ProjectStateGroup, now: string): string | null`. It returns `now` for `"Completed"`, else `null`.
4. Add `pickStateForGroup(states, group, currentStateId)`. `states` is `Array<{ id: string; group: ProjectStateGroup; isDefault: boolean; sortOrder: number }>`.
   1. If the current state is in `group`, return its id.
   2. Else return the `isDefault` state of `group`.
   3. Else return the first state of `group` by `sortOrder`.
   4. Else return `null`.
5. Type `ProjectStateGroup` as `Database["public"]["Enums"]["projectStateGroup"]`.
6. In `updateProjectElementField` (`case "stateId"`), set `update.completedAt = completedAtForGroup(state.data.group, datetime.timestamp())`.
7. Tests: the 4 branches of `pickStateForGroup`, and `completedAtForGroup` for Completed and Started.

**Verify:**
```bash
pnpm --filter @carbon/database test -- project-plan
# Expected: all pass
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database
# Expected: 0 errors
```

If `projectState` has no `sortOrder` column, read its order column from `packages/database/src/types.ts` and use that. If it has none, sort by `name`.

**Out of scope:** the five inline default-state queries in `projects.server.ts`.

## Task 21: Add `projectElement` to the registry, maps and locks

**Depends on:** Task 20
**Files:**
- Modify: `packages/ee/src/issue-sync/types.ts`, `entities.ts`, `maps.ts`, `locks.ts`, `canonical.ts` and their tests

**Steps:**
1. Add `"projectElement"` to `SyncedEntityType`.
2. Widen the `SyncedEntity` column types. Add the `projectElement` entry:
   - `table: "projectElement"`, `parentColumn: "projectId"`, `parentTable: "project"`, `readableColumn: "readableId"`
   - `textColumn: "description"`, `assigneeColumn: "ownerId"`, `dueDateColumn: "targetDate"`
   - `fields: ["title", "description", "status", "assignee", "priority", "dueDate"]`
   - `permissions: { update: "projects" }`
   - `detailPath: (projectId, id) => \`/x/project/${projectId}/element/${id}\``
3. In `maps.ts`, add the state-group maps from the spec's *State mapping* table:
   - `groupToLinearType(group)`, `linearTypeToGroup(type)`
   - `groupToJiraCategory(group)`, `jiraCategoryToGroup(category, currentGroup)`
   - `jiraCategoryToGroup` keeps Backlog for `new` and Cancelled for `done`.
4. In `maps.ts`, add the priority maps from the spec's *Priority mapping* table:
   - `priorityToLinear(p)`, `linearToPriority(n)`
   - `priorityToJira(p)` returns `null` for None; `jiraToPriority(name)` maps Lowest → Low, unknown → `null`.
5. In `locks.ts`, extend `LockContext` with `projectStatus?: string | null` and `planLocked?: boolean`.
6. `projectElement` with `projectStatus === "Closed"` → all fields, reason `"the project is closed"`.
7. `projectElement` with `planLocked` → `["title", "description"]`, reason `"the project plan is locked"`.
8. In `canonical.ts`, `carbonValues` for `projectElement` needs the state group. Add an argument `ctx: { stateGroupById?: Map<string, ProjectStateGroup> }`.
9. Element values: `title: row.name`, `status: stateGroupById.get(row.stateId)`, `assignee: row.ownerId`, `priority: row.priority`, `dueDate: row.targetDate`, `description: hashText(row.description)`.
10. Linear values add `title: issue.title` and `priority: String(issue.priority ?? 0)`. Jira values add `title: issue.fields.summary` and `priority: issue.fields.priority?.name ?? null`.
11. For task rows, these extra fields are not in `fields`, so the diff ignores them.
12. Tests:
    - every row of both mapping tables
    - both element locks, and the Closed-and-locked case (Closed wins)
    - element canonical values

**Verify:**
```bash
pnpm --filter @carbon/ee test -- issue-sync
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp --filter=@carbon/jobs
# Expected: 0 errors
```

**Out of scope:** start date, labels, milestone and parent.

## Task 22: Support `projectElement` in the engine, routes and subscriptions

**Depends on:** Task 21
**Files:**
- Modify: `packages/ee/src/issue-sync/subscriptions.ts` — add `"projectElement"` to `ISSUE_SYNC_TABLES`
- Modify: `packages/ee/src/issue-sync/engine.server.ts`
- Modify: `packages/ee/src/issue-sync/trackers/linear.server.ts`, `trackers/jira.server.ts`
- Modify: `apps/erp/app/modules/shared/shared.server.ts` — `actionTaskParents` and `getActionTaskWithParent`
- Modify: the four link and create routes — the project lock check

**Steps:**
1. Engine reads for `projectElement`, one query each per batch:
   - the company's states: `projectState` `id, group, isDefault` and the order column
   - the projects: `project` `id, status, lockPlanAfterMilestoneId` by the rows' `projectId`
   - the lock milestones: `projectMilestone` `id, completedAt` by those ids
2. Build `LockContext` per row: `projectStatus`, and `planLocked: isProjectPlanLocked({ lockMilestone })`.
3. Inbound patch for an element:
   - `title` → `name`
   - `description` → `description` (Tiptap)
   - `status` → `stateId: pickStateForGroup(states, group, row.stateId)` and `completedAt: completedAtForGroup(group, datetime.timestamp())`. If `pickStateForGroup` returns `null`, leave `status` out of the patch.
   - `assignee` → `ownerId`
   - `priority` → `priority` (`linearToPriority` / `jiraToPriority`; `null` → leave out)
   - `dueDate` → `targetDate`
4. Outbound push for an element:
   - Linear: `title`, `description` (Markdown), `stateId` (by `groupToLinearType`), `assigneeId`, `priority`, `dueDate`.
   - Jira: `summary`, `description` (ADF), transition (by `groupToJiraCategory`), assignee, `priority` by name, `duedate`.
   - Jira priority: call `listPriorities` once per push. Push the name only when the list holds it.
5. Make the trackers read the row through `syncedEntities[type]` column names (`textColumn`, `assigneeColumn`, `dueDateColumn`), not fixed names.
6. In `shared.server.ts`, add `projectElement: { parentTable: "project", readableColumn: "readableId" }` to `actionTaskParents`.
7. In `getActionTaskWithParent`, select `textColumn` and alias it as `notes`, so the create routes keep reading `notes`.
8. In the four routes, when `entityType === "projectElement"`, read the project `status`. If it is `"Closed"`, return `{ success: false, message: "The project is closed" }`.
9. In the two create routes, the default issue title is the element `name` for `projectElement`. Read it with the row.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp --filter=@carbon/jobs
# Expected: 0 errors
pnpm --filter @carbon/ee test -- issue-sync
# Expected: all pass
```

If `project.lockPlanAfterMilestoneId` or `projectMilestone.completedAt` has another name in `packages/database/src/types.ts`, use the real name. If the lock milestone lives in another table, STOP and report.

**Out of scope:** the five default-state queries in `projects.server.ts`.

## Task 23: Add the dialogs to the element page

**Depends on:** Task 22
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — `getProjectElementPageInChangeRequest` returns the element's links
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementView.tsx` — render the dialogs
- Copy from (precedent): `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeActions.tsx` lines 194–207 (`headerExtras`) and `getChangeNoticeActions` in `items.service.ts` (the mapping read)

**Steps:**
1. In `getProjectElementPageInChangeRequest`, read the element's links in one query:
   ```ts
   client.from("externalIntegrationMapping")
     .select("integration, metadata")
     .eq("companyId", companyId)
     .eq("entityType", "projectElement")
     .eq("entityId", elementId)
   ```
2. Return `linearIssue` and `jiraIssue` (each the `metadata` of that integration's row, or `null`) on the page data.
3. In `ElementView.tsx`, read `const integrations = useIntegrations();`.
4. In the header row, between `<Copy text={element.readableId} />` and `<DropdownMenu>`, add:
   ```tsx
   {integrations.has("linear") && (
     <LinearIssueDialog entityType="projectElement" taskId={element.id} linkedIssue={linearIssue} />
   )}
   {integrations.has("jira") && (
     <JiraIssueDialog entityType="projectElement" taskId={element.id} linkedIssue={jiraIssue} />
   )}
   ```
5. Render them only when `canUpdate` is true. When it is false, render nothing new.
6. Thread `linearIssue` and `jiraIssue` from the route's loader data into `ElementView` the same way the other page data reaches it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

**Out of scope:** the List, the Tree and the sidebar. No other element UI changes.

## Task 24: Phase 2 docs, gate and commit

**Depends on:** Tasks 20–23
**Files:**
- Modify: `docs/content/docs/integrations/project-management.mdx` — the three record types and the fields
- Modify: `.claude/rules/linear-integration.md`, `.claude/rules/jira-integration.md`, `.claude/rules/projects-system.md` — the element sync
- Modify: `apps/erp/app/modules/projects/AGENTS.md` — the element link
- Modify: `.ai/specs/2026-10-17-issue-tracker-sync.md` — status `implemented` only after Task 25 passes

**Steps:**
1. Update the docs page with the `carbon-docs` skill. Ground every claim in the code of Tasks 10–23.
2. Update the rules and `AGENTS.md`.
3. Run `pnpm --filter docs typecheck`.
4. Run the `check-and-commit` skill with the message `feat(projects): link project elements to Linear and Jira issues`.
5. Stage only the files of Tasks 20–24.

**Verify:**
```bash
pnpm --filter @carbon/ee test && pnpm --filter @carbon/database test && pnpm --filter erp test
# Expected: all pass
git log -1 --stat
# Expected: only Task 20–24 files
```

**Out of scope:** a changelog entry; ask the user first.

## Task 25: Browser verification (`/test`)

**Depends on:** Task 24
**Files:** none

**Steps:**
1. Ask the user for permission to run the browser and to use a Linear test workspace. If either is missing, STOP and report which acceptance criteria stay unverified.
2. Run `/auth`, then `/test` against the spec's acceptance criteria:
   - Phase 2: link an element to a Linear issue, change its state, and see the issue follow.
   - Phase 2: lock the plan, rename the issue in Linear, and see "Not applied: the project plan is locked".
   - Phase 1: change a change notice task's status and see the issue follow.
   - Phase 1: delete the Linear issue and see the link disappear.
3. Save screenshots under `.context/`.

**Verify:**
```bash
ls .context/*.png
# Expected: one screenshot per checked criterion
```

**Out of scope:** Jira, unless the user provides a Jira test site.
