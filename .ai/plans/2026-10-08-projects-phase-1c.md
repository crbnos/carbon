# Projects Phase 1c — implementation plan

**Spec:** .ai/specs/2026-10-03-projects.md (*Baselines and change requests (Phase 1c)*)
**Research:** .ai/research/projects-systems-engineering-ux.md (Flow Engineering branches, change review, baselines)
**Branch:** projects-wbs-research-spec
**Prerequisite:** Phase 1a and Phase 1b plans are done and committed. If a named Phase 1a or 1b artifact does not exist, STOP and report.

## Scope of this plan

1. **Baselines.** A read-only snapshot of the plan layer, taken by a user or when a milestone completes. A compare view diffs any two baselines, or a baseline with the current plan.
2. **Change requests.** A draft set of plan-layer edits, made in the normal Elements UI while a change request is open.
   - Reviewers see per-element diffs, comment on a changed field, and mark each element as viewed.
   - Approval goes through the approvals engine when a rule applies. Otherwise a user with `update: projects` approves directly; approval rules are a paid feature (`APPROVAL_RULES`), and Projects is community.
   - On approval, Carbon applies the edits and writes a baseline.
3. **Plan lock.** A project can lock its plan layer after a chosen milestone. After that milestone, plan-layer fields change only through a change request.

**Plan-layer fields** (the only fields that change requests, baselines and the lock cover):
- element add, delete and move;
- element `name`, `description`, `type`, `isChargeable`, `budget`, `estimatedHours`, `itemId`, the Requirement target fields and the Parameter fields;
- trace links;
- plan lines (materials, labor, other costs).

Progress fields stay editable at all times: state, owner, priority, labels, dates, milestone, verdict, comments.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/conventions-services.md`, `.claude/rules/conventions-forms.md`, `.claude/rules/authz-manifest.md` and `.claude/rules/projects-system.md` before Task 1.
- Use the `carbon-design` skill for every UI task.
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files.
- 🛑 Keep project apply logic out of `packages/ee`. The approvals engine only flips the change request's status.
- Never query in a loop.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Progress

- [x] Task 1: Create the Phase 1c enum migration
- [x] Task 2: Create the baselines and change requests migration
- [x] Task 3: Apply migrations, regenerate types, ship RLS
- [x] Task 4: Move the diff engine to `modules/shared`
- [x] Task 5: Move the diff UI to shared components
- [x] Task 6: Add the plan snapshot and the baseline service
- [x] Task 7: Add the baseline compare page
- [x] Task 8: Add the change request overlay and draft writes
- [x] Task 9: Add submit, approve, reject and apply
- [x] Task 10: Add the approvals engine branch and notifications
- [ ] Task 11: Build the change request pages
- [ ] Task 12: Add the plan lock
- [ ] Task 13: Update the rule file, module AGENTS.md, docs and spec
- [ ] Task 14: Verify in the browser

## Dependencies

- Tasks 1 → 2 → 3 run in order.
- Tasks 4 and 5 are independent of Tasks 1–3 and of each other.
- Task 6 needs Tasks 3 and 4. Task 7 needs Tasks 5 and 6.
- Task 8 needs Task 3. Task 9 needs Tasks 6 and 8. Task 10 needs Task 9.
- Task 11 needs Tasks 5, 9 and 10. Task 12 needs Task 8.
- Task 13 needs Tasks 1–12. Task 14 runs last.

---

## Task 1: Create the Phase 1c enum migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-1c-enums.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260310005407_supplier-approvals.sql` (line 2)

**Steps:**
1. Run `pnpm db:migrate:new projects-1c-enums`.
2. Write only these statements:

```sql
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'projectChangeRequest';
CREATE TYPE "projectChangeRequestStatus" AS ENUM ('Draft', 'In Review', 'Approved', 'Rejected', 'Applied', 'Cancelled');
CREATE TYPE "projectChangeOperation" AS ENUM ('Add', 'Update', 'Delete');
CREATE TYPE "projectPlanTable" AS ENUM ('projectElement', 'projectElementLink', 'projectElementMaterial', 'projectElementLabor', 'projectElementCost');
CREATE TYPE "projectBaselineSource" AS ENUM ('Manual', 'Milestone', 'Change Request');
```

**Verify:**
```bash
grep -c "projectChangeRequest" packages/database/supabase/migrations/*_projects-1c-enums.sql
# Expected: 2
```

**Out of scope:** any table change.

---

## Task 2: Create the baselines and change requests migration

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-baselines.sql`
- Copy from (precedent): `20260810100100_workflows-foundation.sql` lines 55–74 (`workflowVersion`); `20260310005407_supplier-approvals.sql` lines 79–107 (the `approvalRequests` view)

**Steps:**
1. Run `pnpm db:migrate:new projects-baselines`.
2. Write the SQL below. Add an index on `companyId` and on every FK column.

```sql
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "lockPlanAfterMilestoneId" TEXT,
  ADD COLUMN IF NOT EXISTS "nextChangeRequestSequence" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "nextBaselineSequence" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "project" ADD CONSTRAINT "project_lockMilestone_fkey"
  FOREIGN KEY ("lockPlanAfterMilestoneId", "companyId") REFERENCES "projectMilestone"("id", "companyId") ON DELETE SET NULL ("lockPlanAfterMilestoneId");

CREATE TABLE IF NOT EXISTS "projectBaseline" (
  "id" TEXT NOT NULL DEFAULT id('pjbl'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "source" "projectBaselineSource" NOT NULL,
  "milestoneId" TEXT,
  "changeRequestId" TEXT,
  "formatVersion" INTEGER NOT NULL DEFAULT 1,
  "snapshot" JSONB NOT NULL,          -- { elements, links, materials, labor, costs }
  "elementCount" INTEGER NOT NULL,
  "linkCount" INTEGER NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectBaseline_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectBaseline_sequence_key" UNIQUE ("projectId", "sequence", "companyId"),
  CONSTRAINT "projectBaseline_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectBaseline_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "projectChangeRequest" (
  "id" TEXT NOT NULL DEFAULT id('pjcr'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "readableId" TEXT NOT NULL DEFAULT '',     -- '<identifier>-CR-<n>', set by the service
  "title" TEXT NOT NULL,
  "reason" JSONB,
  "status" "projectChangeRequestStatus" NOT NULL DEFAULT 'Draft',
  "baseBaselineId" TEXT,                      -- the baseline the draft started from
  "appliedBaselineId" TEXT,
  "submittedAt" TIMESTAMP WITH TIME ZONE,
  "decidedBy" TEXT REFERENCES "user"("id"),
  "decidedAt" TIMESTAMP WITH TIME ZONE,
  "decisionNotes" TEXT,
  "appliedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectChangeRequest_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectChangeRequest_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectChangeRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
ALTER TABLE "projectBaseline" ADD CONSTRAINT "projectBaseline_changeRequest_fkey"
  FOREIGN KEY ("changeRequestId", "companyId") REFERENCES "projectChangeRequest"("id", "companyId") ON DELETE SET NULL ("changeRequestId");

CREATE TABLE IF NOT EXISTS "projectChangeRequestItem" (
  "id" TEXT NOT NULL DEFAULT id('pjci'),
  "companyId" TEXT NOT NULL,
  "changeRequestId" TEXT NOT NULL,
  "operation" "projectChangeOperation" NOT NULL,
  "targetTable" "projectPlanTable" NOT NULL,
  "targetId" TEXT NOT NULL,           -- the live row id; for Add, a pre-generated id the apply step inserts with
  "payload" JSONB,                    -- the proposed row (Add, Update)
  "baseRow" JSONB,                    -- the live row when the draft first touched it (Update, Delete)
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectChangeRequestItem_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectChangeRequestItem_target_key" UNIQUE ("changeRequestId", "targetTable", "targetId", "companyId"),
  CONSTRAINT "projectChangeRequestItem_cr_fkey" FOREIGN KEY ("changeRequestId", "companyId") REFERENCES "projectChangeRequest"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectChangeRequestItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "projectChangeRequestComment" (
  "id" TEXT NOT NULL DEFAULT id('pjcc'),
  "companyId" TEXT NOT NULL,
  "changeRequestId" TEXT NOT NULL,
  "targetTable" "projectPlanTable",
  "targetId" TEXT,
  "field" TEXT,                       -- null = a comment on the whole change or the whole row
  "comment" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP WITH TIME ZONE,
  "resolvedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectChangeRequestComment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectChangeRequestComment_cr_fkey" FOREIGN KEY ("changeRequestId", "companyId") REFERENCES "projectChangeRequest"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectChangeRequestComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "projectChangeRequestView" (
  "changeRequestId" TEXT NOT NULL,
  "targetTable" "projectPlanTable" NOT NULL,
  "targetId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id"),
  "companyId" TEXT NOT NULL,
  "viewedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectChangeRequestView_pkey" PRIMARY KEY ("changeRequestId", "targetTable", "targetId", "userId", "companyId"),
  CONSTRAINT "projectChangeRequestView_cr_fkey" FOREIGN KEY ("changeRequestId", "companyId") REFERENCES "projectChangeRequest"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectChangeRequestView_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
```

3. Recreate the `approvalRequests` view. Copy the latest definition (`20260310005407_supplier-approvals.sql` lines 79–107, or a later one if `grep -l "approvalRequests" packages/database/supabase/migrations/*.sql | tail -1` finds one).
   - Add a `projectChangeRequest` branch to each CASE: `documentReadableId` = `projectChangeRequest."readableId"`, `documentDescription` = `projectChangeRequest."title"`.
   - Add a `LEFT JOIN "projectChangeRequest"` on `documentId` and `companyId`.
   - Keep `WITH (security_invoker = true)`.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_projects-baselines.sql
# Expected: 5
```

**Out of scope:** branching of facts (time, issues, journals). They never enter a change request.

---

## Task 3: Apply migrations, regenerate types, ship RLS

**Depends on:** 2
**Files:**
- Modify: `packages/database/src/authz/manifest.ts`
- Modify: generated types; create the generated RLS migration

**Steps:**
1. Run `pnpm db:migrate`.
2. Run `pnpm run generate:types`.
3. Add these rules in alphabetical order:

```ts
projectBaseline: company("projects", { update: false, delete: false }),
projectChangeRequest: company("projects"),
projectChangeRequestComment: company("projects", { create: "employee", update: owner("createdBy"), delete: owner("createdBy") }),
projectChangeRequestItem: company("projects"),
projectChangeRequestView: policies({
  select: owner("userId"),
  insert: and(owner("userId"), inCompany("companyId", "employee")),
  update: { using: owner("userId"), check: and(owner("userId"), inCompany("companyId", "employee")) },
  delete: owner("userId")
}),
```

4. If a helper signature differs, read `packages/database/src/authz/rules.ts` and keep the meaning.
5. Run `pnpm db:migrate`, then `pnpm --filter @carbon/database authz migration projects-1c-rls`.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all tests pass
```

**Out of scope:** hand edits to generated files.

---

## Task 4: Move the diff engine to `modules/shared`

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/shared/diff.ts`
- Create: `apps/erp/app/modules/shared/diff.test.ts`
- Modify: `apps/erp/app/modules/items/items.service.ts` (lines 8562–8660 and 9005)
- Modify: `apps/erp/app/modules/items/items.models.ts` (lines 1310–1318)
- Copy from (precedent): `apps/erp/app/modules/shared/sort-order.ts` and `sort-order.test.ts`

**Steps:**
1. In `diff.ts`, export:
   - `DiffStatus` and `DiffEntry<T>` (copies of `MethodDiffStatus` and `MethodDiffEntry`);
   - `BASE_IGNORED_FIELDS` = `id`, `companyId`, `customFields`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`;
   - `valuesEqual`, unchanged;
   - `diffFields(base, target, ignored: Set<string>)`;
   - `diffRows(base, target, { key, ignoredFields })`, which merges `ignoredFields` with `BASE_IGNORED_FIELDS` and matches `target[key]` to `base.id` as today.
2. In `items.models.ts`, keep `MethodDiffStatus` and `MethodDiffEntry` as aliases: `export type MethodDiffEntry<T> = DiffEntry<T>`.
3. In `items.service.ts`:
   1. Keep the items-only fields as `ITEM_IGNORED_FIELDS`.
   2. Replace the private helpers with imports from `../shared/diff`.
   3. Call `diffRows(base, target, { key: sourceKey, ignoredFields: ITEM_IGNORED_FIELDS })` at the 6 call sites (8735–8737, 8754, 8831, 8877).
   4. Keep `DiffMethodInput` and `diffMethod` in `items.service.ts` (`apps/erp/test/mcp-tool-metadata.test.ts:286` reads them).
4. Do not add `@mcp` to anything in `diff.ts`.
5. Write `diff.test.ts` with 4 cases:
   1. An added row (key not in base).
   2. A removed row.
   3. A modified row whose `changedFields` lists only the changed column.
   4. A numeric string "1.50" equal to the number 1.5 (unchanged).

**Verify:**
```bash
pnpm --filter erp test -- diff items.service mcp-tool-metadata
# Expected: all tests pass, including the 5 existing diffMethod describe blocks
```

**Out of scope:** `correlate` (natural-key matching). Projects match by id only.

---

## Task 5: Move the diff UI to shared components

**Depends on:** none
**Files:**
- Move: `apps/erp/app/modules/items/ui/ChangeNotice/diff-ui.tsx` → `apps/erp/app/components/Diff/diff-ui.tsx`
- Create: `apps/erp/app/components/Diff/DiffParts.tsx` — `Pill`, `FieldRow`, `ValueRow`, `TreeNode`, `TreeChildren`, `statusColor`, extracted from `ChangeNoticeDiffViewer.tsx` (lines 182–330)
- Create: `apps/erp/app/components/Diff/index.ts`
- Modify: `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeDiffViewer.tsx` — import the parts; pass `labels={FIELD_LABELS}`
- Modify: every importer of `diff-ui.tsx` (find them with `grep -rn "ChangeNotice/diff-ui\|./diff-ui" apps/erp/app`)

**Steps:**
1. Move `diff-ui.tsx` unchanged, except that its type import comes from `~/modules/shared/diff`.
2. Extract the generic parts. `FieldRow` and `ValueRow` take a `labels: Record<string, string>` prop. `humanizeField` falls back to a title-cased key when a label is missing.
3. Keep the items-only parts (`FIELD_LABELS`, `NOISE_FIELDS`, unit grouping, entry components) in `ChangeNoticeDiffViewer.tsx`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** any visual change to the change notice pages.

---

## Task 6: Add the plan snapshot and the baseline service

**Depends on:** 3, 4
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts`
- Modify: `apps/erp/app/modules/projects/projects.server.ts`
- Modify: `apps/erp/app/modules/projects/projects.service.ts`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.milestones.tsx` — the `complete` intent
- Create: `apps/erp/test/projects-snapshot.test.ts`

**Steps:**
1. In `projects.models.ts`, export `PLAN_LAYER_FIELDS: Record<ProjectPlanTable, string[]>`, the plan-layer columns of each table (see *Scope*).
   - For `projectElement`, also keep `id`, `parentId`, `readableId`, `sortOrder` and `type`.
   - For the other tables, keep every column except the audit columns and `companyId`.
2. Export `ProjectPlanSnapshot = { elements, links, materials, labor, costs }`, each an array of plain rows with only `PLAN_LAYER_FIELDS`.
3. Export a pure function `toPlanSnapshot(rows)`. It picks the plan-layer columns and sorts each array by `id`.
4. Export a pure function `diffPlanSnapshots(base, target)`. It calls `diffRows(base[x], target[x], { key: "id", ignoredFields: [] })` for each table and returns `{ elements, links, materials, labor, costs }` of `DiffEntry` arrays.
5. In `projects.server.ts`, add `loadPlanSnapshot(db, { companyId, projectId })`: 5 queries, one per table, then `toPlanSnapshot`.
6. Add `createProjectBaseline(db, { companyId, userId, projectId, name, source, milestoneId?, changeRequestId? })`. In one transaction:
   1. Load the snapshot.
   2. Read and increment `project.nextBaselineSequence` with `UPDATE … RETURNING`.
   3. Insert the baseline with counts.
7. In `projects.service.ts`, add:
   - `getProjectBaselines(client, projectId, companyId)`: selects every column except `snapshot`;
   - `getProjectBaseline(client, id, companyId)`: with `snapshot`.
8. When the milestones route completes a milestone, call `createProjectBaseline` with `source: "Milestone"` and `name: "<milestone name> (completed)"`.
9. Write `projects-snapshot.test.ts` with 3 cases:
   1. `toPlanSnapshot` drops a progress field (`stateId`) and keeps `budget`.
   2. `diffPlanSnapshots` reports an added element, a removed link and a modified plan-line quantity.
   3. A changed `stateId` alone gives no diff.

**Verify:**
```bash
pnpm --filter erp test -- projects-snapshot
# Expected: 3 passed
```

**Out of scope:** restoring a baseline. Reverting is a change request.

---

## Task 7: Add the baseline compare page

**Depends on:** 5, 6
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.baselines.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.baselines.compare.tsx`
- Create: `apps/erp/app/modules/projects/ui/Baselines/BaselinesList.tsx`
- Create: `apps/erp/app/modules/projects/ui/Baselines/PlanDiffViewer.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Project/useProjectNavigation.tsx` — add a **Baselines** tab
- Copy from (precedent): `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeDiffViewer.tsx` (layout), `apps/erp/app/components/Diff/` (Task 5)

**Steps:**
1. `$projectId.baselines.tsx`:
   - loader: `getProjectBaselines`;
   - UI: `BaselinesList` with sequence, name, source, date, author and element count, plus **Take baseline** (a name input);
   - action: `intent: "create"` runs `requirePermissions(request, { update: "projects" })`, then `createProjectBaseline` with `source: "Manual"`.
2. `$projectId.baselines.compare.tsx` reads `?from=<baselineId>&to=<baselineId|current>`.
   - It loads both snapshots. For `current`, it calls `loadPlanSnapshot`.
   - It renders `PlanDiffViewer`.
3. `PlanDiffViewer` groups the diff by element, in the target tree order. Each element shows a `DiffBadge`, its changed fields (`FieldRow` with element labels) and its changed plan lines and links beneath it. Removed elements come last.
4. Each baseline row has **Compare with current** and **Compare with…** (a select of the other baselines).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** exporting a diff to PDF.

---

## Task 8: Add the change request overlay and draft writes

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts`
- Modify: `apps/erp/app/modules/projects/projects.server.ts`
- Modify: `apps/erp/app/modules/projects/projects.service.ts`
- Modify: every plan-layer route: `$projectId.elements.new.tsx`, `$projectId.elements.update.tsx`, `$projectId.elements.move.tsx`, `$projectId.elements.links.tsx`, `$projectId.elements.$elementId.plan.tsx`, `$projectId.elements.$elementId.delete.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` and the element page loaders
- Create: `apps/erp/test/projects-overlay.test.ts`

**Steps:**
1. Add a pure function `applyChangeRequestItems(live: ProjectPlanSnapshot, items)` in `projects.models.ts`. It returns the snapshot as the change request would leave it:
   - `Add` appends `payload`;
   - `Update` replaces the row's plan-layer fields with `payload`;
   - `Delete` removes the row.

   It also removes links and plan lines of a deleted element.
2. Add `isPlanLayerField(table, field)` from `PLAN_LAYER_FIELDS`.
3. Add `upsertChangeRequestItem(db, { companyId, userId, changeRequestId, operation, targetTable, targetId, payload })` to `projects.server.ts`.
   1. It refuses unless the change request is `Draft`.
   2. On the first touch of a live row (`Update` or `Delete`), it stores the live row's plan-layer fields as `baseRow`.
   3. An `Update` after an `Add` of the same `targetId` merges into the Add's `payload`.
   4. A `Delete` after an `Add` removes the item.
4. In each plan-layer route, read the open change request from the form field `changeRequestId` (sent by the UI while a change request is active).
   - If it is set, call `upsertChangeRequestItem` instead of the live write.
   - For an `Add`, generate the element id with `nanoid()` and keep `readableId` empty; the apply step assigns it.
   - Progress fields (`isPlanLayerField` false) always write live.
5. In the Elements loader and the element page loader, read `?cr=<changeRequestId>`. If it is set:
   1. Load the items.
   2. Show `applyChangeRequestItems(liveSnapshot, items)` instead of the live plan layer.
   3. Mark each changed row with its operation, so the UI can badge it.
6. Write `projects-overlay.test.ts` with 4 cases:
   1. An Add then an Update of the same row gives one Add with the merged payload.
   2. A Delete removes the element and its links and plan lines.
   3. An Update changes only plan-layer fields.
   4. A Delete after an Add leaves nothing.

**Verify:**
```bash
pnpm --filter erp test -- projects-overlay
# Expected: 4 passed
```

**Out of scope:** two open change requests editing the same row. The apply step's conflict check handles that (Task 9).

---

## Task 9: Add submit, approve, reject and apply

**Depends on:** 6, 8
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.server.ts`
- Modify: `apps/erp/app/modules/projects/projects.service.ts`
- Create: `apps/erp/app/routes/x+/project+/$projectId.change-requests.new.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.change-requests.$crId.status.tsx`
- Create: `apps/erp/test/projects-apply.test.ts`
- Copy from (precedent): `applyChangeNotice` in `apps/erp/app/modules/items/items.server.ts` (line 511); `apps/erp/app/routes/x+/purchase-order+/$orderId.finalize.tsx` (lines 161, 197–246); `apps/erp/app/routes/x+/quality-document+/$id.tsx` (lines 116–232)

**Steps:**
1. `createChangeRequest(db, { companyId, userId, projectId, title, reason })`:
   1. Increments `project.nextChangeRequestSequence`.
   2. Sets `readableId` = `"<identifier>-CR-<n>"`.
   3. Takes a baseline (`source: "Change Request"`, name "Before <readableId>") and stores it as `baseBaselineId`.
2. Add a pure function `findConflicts(items, liveSnapshot)` in `projects.models.ts`. An `Update` or `Delete` item conflicts when the live row's plan-layer fields differ from its `baseRow` (`diffFields`), or when the live row no longer exists. It returns the conflicting items with the fields that changed.
3. The status route handles these intents, each with `requirePermissions(request, { update: "projects" })`:
   - **submit** (Draft → In Review):
     1. If the change request has no items, refuse.
     2. If `isApprovalRequired(serviceRole, "projectChangeRequest", companyId)` is true, call `createApprovalRequest` and notify the approvers, as the PO finalize route does.
     3. Set `submittedAt`.
   - **approve**:
     - If an approval request exists, call `canApproveRequest` and `approveRequest` (Task 10 flips the status).
     - Otherwise set `Approved` directly, with `decidedBy` and `decidedAt`.
     - Then call `applyChangeRequest`.
   - **reject**: the same paths with `rejectRequest`, and `decisionNotes` from the form.
   - **cancel** (Draft or In Review → Cancelled): only the author or an `update: projects` holder.
   - **reopen** (Rejected → Draft).
4. `applyChangeRequest(db, { companyId, userId, changeRequestId })`, in one Kysely transaction:
   1. Lock the change request with `FOR UPDATE`. If it is not `Approved`, return.
   2. Load the live snapshot and run `findConflicts`. If any conflict exists, throw a `ProjectChangeConflictError` with the list, and keep the status `Approved`.
   3. Apply the items in this order:
      1. element Adds, parent first, with readable ids from `project.nextElementSequence` (the same logic as `insertProjectElement`);
      2. element Updates;
      3. plan-line and link Adds and Updates;
      4. link and plan-line Deletes;
      5. element Deletes, children first.

      For an element Delete, refuse when the element or a descendant has a charge (the `deleteProjectElement` checks).
   4. Take a baseline (`source: "Change Request"`, name "After <readableId>") and store it as `appliedBaselineId`.
   5. Set `status` to `Applied` with `.where("status", "=", "Approved")`, and set `appliedAt`.
5. On a conflict, the status route flashes the conflict list. The change request page shows the conflicts, and the author can reopen it to fix them.
6. Write `projects-apply.test.ts` with 3 cases for `findConflicts`:
   1. No live change: no conflict.
   2. A live budget change on a row the change request updates: a conflict on `budget`.
   3. A live delete of a row the change request updates: a conflict.

**Verify:**
```bash
pnpm --filter erp test -- projects-apply
# Expected: 3 passed
```

**Out of scope:** partial apply. A change request applies fully or not at all.

---

## Task 10: Add the approvals engine branch and notifications

**Depends on:** 9
**Files:**
- Modify: `packages/ee/src/approvals/models.ts` — add `projectChangeRequest` to `approvalDocumentType` (line 17) and to `approvalDocumentTypeLabel` (line 26) as "Project change request". Do not add it to `approvalDocumentTypesWithAmounts`.
- Modify: `packages/ee/src/approvals/service.ts` — `approveRequest` (line 33) and `rejectRequest` (line 819)
- Modify: `packages/jobs/src/inngest/functions/notifications/content.ts` (line 1235)
- Modify: `apps/erp/app/components/Layout/Topbar/Notifications.tsx` (line 292)
- Modify: `apps/erp/app/routes/api+/link.ts` (lines 105–112)
- Modify: `apps/erp/app/modules/settings/ui/Approvals/ApprovalRules.ee.tsx` (lines 117–180)

**Steps:**
1. In `approveRequest` and `rejectRequest`, add a `projectChangeRequest` branch. It updates `projectChangeRequest.status` from `'In Review'` to `'Approved'` or `'Rejected'`, with `decidedBy`, `decidedAt` and a `companyId` pin, in the same transaction.
2. Do not call any projects code from `packages/ee`. The ERP route runs `applyChangeRequest` after `approveRequest` returns.
3. In `content.ts`, describe the change request as "<readableId>: <title>".
4. In `Notifications.tsx` and `link.ts`, route a `projectChangeRequest` notification to the change request page (`path.to.projectChangeRequest(projectId, crId)`, Task 11). Replace the current two-way ternary in `Notifications.tsx` with a switch on the document type.
5. In `ApprovalRules.ee.tsx`, add a card for project change requests, copying the quality document card.
6. Run `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp
# Expected: exit code 0
pnpm --filter @carbon/ee test -- approvals
# Expected: all tests pass
```

**Out of scope:** amount-based rules for change requests.

---

## Task 11: Build the change request pages

**Depends on:** 5, 9, 10
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.change-requests.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.change-requests.$crId.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.change-requests.$crId.comments.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.change-requests.$crId.viewed.tsx`
- Create: `apps/erp/app/modules/projects/ui/ChangeRequests/ChangeRequestsTable.tsx`
- Create: `apps/erp/app/modules/projects/ui/ChangeRequests/ChangeRequestReview.tsx`
- Create: `apps/erp/app/modules/projects/ui/ChangeRequests/ChangeRequestBanner.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementsHeader.tsx`, `ElementList.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Project/useProjectNavigation.tsx` — add **Change requests**
- Modify: `apps/erp/app/utils/path.ts` — `projectChangeRequests(id)`, `projectChangeRequest(id, crId)`, `newProjectChangeRequest(id)`, `projectChangeRequestStatus(id, crId)`
- Copy from (precedent): `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeDiffViewer.tsx`; `apps/erp/app/routes/x+/maintenance+/$dispatchId.comments.tsx` (comments)

**Steps:**
1. **List page.** Readable id, title, status, author, item count, submitted date. **New change request** (title, reason) posts to the new route, which redirects to the Elements page with `?cr=<id>`.
2. **`ChangeRequestBanner`.** Shown on the Elements page and the element page while `?cr=` is set. It reads "Editing <readableId>: <title>. Changes go to this change request." and has **Review** and **Leave**. While it shows, every plan-layer form adds the hidden field `changeRequestId`.
3. Rows changed by the change request show a `DiffBadge` (Added, Modified, Removed) in the List layout.
4. **Review page (`$crId.tsx`).** The header holds the readable id, title, status, author, and the counts "Items changed N" and "K/N viewed". It also holds **Submit**, **Approve**, **Reject** (with notes), **Cancel** and **Reopen** by status and permission.

   The body has one card per changed element, in tree order. Each card shows:
   - the element's readable id and name, with a `DiffBadge`;
   - a **Viewed** checkbox (posts to `$crId.viewed`);
   - a comment button.

   Inside each card:
   - the changed fields as `FieldRow` before → after, each with a comment action;
   - the changed plan lines and links beneath.
5. A **Viewed** mark resets when the item's `updatedAt` is later than the mark's `viewedAt`.
6. Comments show inline under their field, or under the card when `field` is null. Each has **Resolve**.
7. When an apply conflict was flashed, the page shows the conflict list at the top, with links to the live elements.
8. A change request that is not `Draft` cannot be edited. The banner shows read-only, and the plan-layer routes refuse its items (Task 8 step 3.1).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** suggested edits by reviewers (a reviewer comments; the author edits).

---

## Task 12: Add the plan lock

**Depends on:** 8
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — `isProjectPlanLocked`, `projectPlanLockedMessage`
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — `requireProjectPlanEditable`, `requireEditablePlanRoute`
- Modify: every plan-layer route listed in Task 8
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx` — a **Lock plan after milestone** select
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementsHeader.tsx` — a lock indicator
- Create: `apps/erp/test/projects-lock.test.ts`
- Copy from (precedent): `requireChangeNoticeEditable` and `requireEditableChangeNoticeRoute` in `apps/erp/app/modules/items/items.server.ts` (lines 295, 394); `changeNoticeLockedMessage` in `items.models.ts` (line 1195)

**Steps:**
1. `isProjectPlanLocked({ lockMilestone })` returns true when the project has `lockPlanAfterMilestoneId` and that milestone has `completedAt` set.
2. `projectPlanLockedMessage(milestoneName)` returns "The plan is locked after <milestone>. Open a change request to change it."
3. `requireEditablePlanRoute(request, { client, projectId, companyId, changeRequestId })`:
   - returns null when the plan is not locked;
   - returns null when the write targets an open Draft change request;
   - otherwise returns `data({ success: false }, await flash(request, error(null, message)))`.
4. Call it first in each plan-layer route action, but only for plan-layer fields (`isPlanLayerField`). Progress fields pass.
5. `applyChangeRequest` does not call the guard. It is the one writer allowed to change a locked plan.
6. In the UI, plan-layer controls show disabled with the message as a tooltip when locked and no change request is open. **Open change request** sits beside the lock indicator.
7. Write `projects-lock.test.ts` with 3 cases:
   1. No lock milestone: unlocked.
   2. A lock milestone not completed: unlocked.
   3. A completed lock milestone: locked, and the message names it.

**Verify:**
```bash
pnpm --filter erp test -- projects-lock
# Expected: 3 passed
```

**Out of scope:** locking progress fields.

---

## Task 13: Update the rule file, module AGENTS.md, docs and spec

**Depends on:** 1–12
**Files:**
- Modify: `.claude/rules/projects-system.md`
- Modify: `apps/erp/app/modules/projects/AGENTS.md`
- Modify: `docs/content/docs/reference/projects.mdx`
- Modify: `.ai/specs/2026-10-03-projects.md`

**Steps:**
1. Document only committed code.
2. In the spec, record these decisions:
   1. **Plan-layer fields:** list them; progress fields are never locked or branched.
   2. **Approval fallback:** direct approval by `update: projects` when no approval rule applies (Community and plans without `APPROVAL_RULES`).
   3. **Conflicts:** apply refuses on a conflict with the live plan, and the author reopens the change request.
   4. **Baselines:** one JSONB snapshot per baseline, with `formatVersion`.
3. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
```

**Out of scope:** the changelog entry.

---

## Task 14: Verify in the browser

**Depends on:** 1–13
**Files:**
- Create: `.ai/playbooks/projects-phase-1c.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company.
2. Cover these spec acceptance criteria:
   1. **Baseline (Phase 1c).** Take a baseline, change a Requirement target, then compare with the current plan. `SNS-4` shows as modified with the old and new target.
   2. **Change request:**
      1. Open a change request.
      2. Add an element, change a budget, delete a link.
      3. Check that the live plan does not change.
      4. Submit, approve (directly, as Community has no rules), and check that the edits apply and that an "After" baseline exists.
   3. **Review:** comment on a changed field, mark an element viewed, edit the element, and check that the mark resets.
   4. **Conflict:** change a budget live after the change request changed it, approve, and check that apply refuses with the conflict listed.
   5. **Lock:** set the lock milestone, complete it, and check that a budget edit is refused while a state change still works. An open change request accepts the budget edit.
3. Save the playbook to `.ai/playbooks/projects-phase-1c.md`.

**Verify:**
```bash
ls .ai/playbooks/projects-phase-1c.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** Phase 2 (project stock).

## Execution notes

- Prerequisite check: the Phase 1a and 1b artifacts this plan names exist. Every 1a and 1b task is committed except the two browser checks, which the overnight run defers.
- Task 1: the migration was applied with `pnpm db:migrate`, and its regenerated types were committed with it, as in Phases 1a and 1b.
- Task 1: the new `approvalDocumentType` value broke 2 checks at once, so this commit fixes both. The first is the `@carbon/ee` typecheck: `approvalDocumentTypeLabel` is a `Record` over the enum, and `service.ts` passes the enum to `z.enum(approvalDocumentType)`. So the `models.ts` part of Task 10 step 1 moved here: the value joins `approvalDocumentType` and `approvalDocumentTypeLabel` ("Project change request"), not `approvalDocumentTypesWithAmounts`. The second is the dataset validator, which requires every enum value in the demo data. `validate.ts` now excepts `projectChangeRequest`, because no dataset seeds a change request.
- Task 2: `projectBaseline.milestoneId`, `projectChangeRequest.baseBaselineId` and `projectChangeRequest.appliedBaselineId` have composite FKs (`ON DELETE SET NULL (<col>)`), with indexes. The plan wrote them with no FK. A tenant row id with no FK must go into the backup `ID_REF_COLUMNS`. So an FK is the simpler fix, as in Phase 1b Task 3. `project.lockPlanAfterMilestoneId` is indexed as `("lockPlanAfterMilestoneId", "companyId")`.
- Task 2: the `targetId` of `projectChangeRequestItem`, `projectChangeRequestComment` and `projectChangeRequestView` points at one of 5 tables, so no FK can hold it. All 3 are in `ID_REF_COLUMNS` (`packages/jobs/src/backups/id-refs.ts`). Known gap: the ids inside the JSONB columns (`projectBaseline.snapshot`, `projectChangeRequestItem.payload` and `baseRow`) are not rewritten by a restore into another company.
- Task 2: the `approvalRequests` view joins `projectChangeRequest` on `documentId` and `companyId`; the other branches are unchanged from `20260310005407`.
- Task 2: the migration was applied in this task, as in Phase 1a Tasks 3–7. Its `authz sync` step fails until Task 3 adds the manifest rules. The migration is recorded with 35 statements in `supabase_migrations.schema_migrations`.
- Task 3: the `projectChangeRequestComment` update rule is `and(owner("createdBy"), inCompany("companyId", "employee"))`, not bare `owner("createdBy")`. The reason is the one in Phase 1a Task 8. With no `where`, the WITH CHECK reuses USING, and an owner-only check lets the author move the row to another company. `authz migration projects-1c-rls` wrote `20261009135302_projects-1c-rls.sql` for the 5 tables, and a second `pnpm db:migrate` recorded it. `vitest run src/authz` passes (33).
- Task 4: `diff.ts` also exports `comparedFields(target, ignored)`. `diffAttributes` in `items.service.ts` compares field by field with it, so it needs the full ignored set (`ITEM_COMPARE_IGNORED` = `BASE_IGNORED_FIELDS` + `ITEM_IGNORED_FIELDS`). The 6 call sites go through a local `diffItemRows(base, target, sourceKey)`, which calls `diffRows` with `ignoredFields: ITEM_IGNORED_FIELDS`. `diffRows` takes `ignoredFields` as any iterable of names. The 4 `diff.test.ts` cases, `items.service.test.ts` and `mcp-tool-metadata.test.ts` pass (63), the full `erp` suite passes (2017), and `erp` typechecks green.
- Task 5: `ChangeNoticeDiffViewer.tsx` was the only importer of `diff-ui.tsx`. `DiffParts.tsx` also exports `humanizeField(field, labels)` and `formatValue`, because `FieldRow` and `ValueRow` need both. The markup of every moved part is unchanged, so the change notice pages look the same. `index.ts` re-exports the parts and the `diff-ui` helpers. `erp` typechecks green.
- Task 6 (🛑 scope decision): `PLAN_LAYER_FIELDS.projectElement` holds the plan's identity columns and fields. It also holds 4 Phase 1b plan fields: `trackedEntityId` (the part link's serial), `requirementCategory`, `qualityDocumentId` (the Test Case procedure) and `parameterFormula`. It leaves out what records history or progress: `verdict*`, `completedAt` and `fixedAssetId`. It also leaves out `costTreatment`, `costTreatmentEffectiveFrom`, `costAccountId`, `isBilling`, `estimateAtCompletion` and `isFinalAsset`. The update route creates assets when `isFinalAsset` turns on, which a change request apply would skip. A `feeds` link is a link row, so it is in the snapshot with every other link.
- Task 6 (🛑 scope decision): the plan said to keep every column of the other 4 tables except the audit columns and `companyId`. Five columns stay out, because each records history, not plan (the same columns `planProjectCopy` clears). They are a link's `suspectSince`, `reviewedAt` and `reviewedBy`, and a material's `quantityIssued`, `jobId` and `purchaseOrderLineId`. With them in, a suspect flag or a Create Job stamp would show as a plan change in every compare. It would also make the Task 9 conflict check refuse a change request.
- Task 6: `projects.models.ts` also exports `projectPlanTables`, `planSnapshotKeys`, `pickPlanLayerFields`, `parsePlanSnapshot` (reads a stored snapshot) and `PROJECT_BASELINE_FORMAT_VERSION`. `isPlanLayerField` (Task 8 step 2) is added here, because it reads the same map.
- Task 6: `projects.server.ts` has `insertProjectBaseline(trx, …)`, which writes a baseline inside an open transaction, and `createProjectBaseline(db, …)`, which wraps it in one. Task 9 calls `insertProjectBaseline` inside the apply transaction. The project row UPDATE runs first, so it locks the project before the snapshot loads. The snapshot is written with `toJson`.
- Task 6: `completeProjectMilestone` now returns `id, name, projectId`, so the route can name the baseline without a second read. The milestone update is a Supabase write and the baseline is a Kysely transaction, so the two are not atomic. If the baseline fails, the milestone stays completed, the error is logged, and the flash says "Milestone completed, but its baseline could not be written". Reopening a milestone writes no baseline.
- Task 6: the 3 `projects-snapshot.test.ts` cases pass. A throwaway vitest run against this worktree's database (rolled back) inserted 2 elements and a cost line. It took a baseline, then changed a budget and a state. The diff of the baseline against `loadPlanSnapshot` showed the budget change only. `nextBaselineSequence` was back to its value after the rollback. The script was not committed.
- Task 7: `$projectId.baselines.compare.tsx` is a child of `$projectId.baselines.tsx` under the flat-route rules. The list route renders the child in place of the list (`useOutlet()`), so the compare is a full page with the plan's file names. The compare page reads the list from the parent's loader data (`useRouteData`) for its two selects (From and To, where To also offers **Current plan**).
- Task 7: the compare loader computes the diff on the server (`diffPlanSnapshots`) and returns it. It refuses a missing `from` and a baseline of another project with a flash and a redirect to the list. `path.to.projectBaselineCompare(id, from, to = "current")` builds the URL; `CURRENT_PLAN` (models) names the live plan. `projectBaselineValidator` (models) checks the name of a manual baseline.
- Task 7: the plan named no lookup for labor categories. `getLaborCategoryNames` (`projects.service.ts`, no `@mcp` tag) reads the names of the categories in the diff with one `.in()`, active or not. Parts show their readable id from the items store. Elements show their readable id. A serial or a procedure shows as "Linked" rather than a raw id.
- Task 7: `PlanDiffViewer` hides `id`, `projectId`, `readableId` and `sortOrder` from the field rows. An element whose only change is its position shows "Position changed". Links show under their `from` element; plan lines show under their element. Money, quantity, percent and date fields use the formatter hooks.
- Task 7: the Baselines tab sits after Milestones, with the shortcut ⌘⇧B (`PROJECT_TAB_SHORTCUTS.baselines`). A baseline row opens the compare with the current plan. Its ⋯ menu has **Compare with current** and **Compare with…** (a submenu of the other baselines; the older one becomes the base). **Take Baseline** opens a modal with a name; it needs `update: projects`.
- Task 7: Browser verification of the two pages is deferred with Task 14 (overnight run). `erp` typechecks green and the `@carbon/checks` tests pass (278).
- Task 8: the merge rules of step 3 are the pure `mergeChangeRequestItem` (models), so the tests pin them. An Update that brings a row back to its `baseRow` removes the item. `upsertChangeRequestItems` (server) takes a list of changes. It writes them in one transaction. It locks the change request and reads the live rows it touches for the first time (one query per table). Then it deletes and upserts the items in one statement each.
- Task 8: deleting an element that the change request added also drops the rows it added under that element. A change of a live row that still uses that element refuses the delete.
- Task 8: a new row gets an id in the SQL `id()` format, as `copyProject` makes them, not a bare `nanoid()`. The prefixes are `pje_`, `pjk_`, `pjp_`, `pjr_` and `pjo_`.
- Task 8: the routes read the change request with `readChangeRequestId`: the form field `changeRequestId`, else `?cr=` on the action URL. Each plan-layer route has a server helper (`addElementToChangeRequest`, `updateElementFieldInChangeRequest`, `moveElementInChangeRequest`, `orderElementsInChangeRequest`, `deleteElementInChangeRequest`, `addLinkToChangeRequest`, `deleteLinkInChangeRequest`, `upsertPlanLineInChangeRequest`, `deletePlanLineInChangeRequest`). Each helper checks the parent, the Parameter rule, a move cycle and `canLink` against the overlaid plan.
- Task 8: labels, `isFinalAsset` and a suspect link review always write live, because they are not plan-layer fields. A formula save is refused in a change request. A formula rewrites its `feeds` links, and a change request does not carry that rewrite.
- Task 8: a delete in a change request does not run the charge checks. The apply step runs them (Task 9). The delete route then redirects to the Elements page with `?cr=`.
- Task 8: the Elements loader keeps `cr` when it redirects a URL without `layout`. In the list, a row the change request removes stays, marked `Delete`, so the UI can badge it. Verification is still computed on the live plan.
- Task 8: the element page loaders call `getProjectElementPageInChangeRequest`. It lays the change request over the element, the element list, the plan lines and the links. The page of an element that the change request adds is built from its payload; it has no comments, ledger rows or time.
- Task 9: `findConflicts` also flags an Add whose live element is gone. That element is the parent of an element, or the element of a link or a plan line. The apply would otherwise fail on the FK.
- Task 9 (not in the plan): reopening an Approved change request must let the author fix a conflict. Without help, its stale `baseRow` would conflict forever. So `reopenChangeRequest` runs the pure `rebaseChangeRequestItems`. An Update keeps only the fields it changed, laid over the live row, and takes the live row as its new `baseRow`. An item whose live row is gone is dropped, and so is an Update left with no change. The flash names the number dropped.
- Task 9: `applyChangeRequest` locks the change request and then the project row before the conflict check. The Updates of each table run as one `UPDATE … FROM jsonb_populate_recordset(…)`, which casts each value to its column type. The Adds of each table run as one insert. The element Adds take readable ids from one `nextElementSequence` update. A refused element Delete names the element and the charge (costs, time, a job or a purchase order line).
- Task 9: `createChangeRequest` sets a missing project identifier with `derive_project_identifier`, as `insertProjectElement` does. The reason is stored as a tiptap document (`optionalTiptapDoc`).
- Task 9: the status route's intents start from the statuses in `projectChangeRequestIntentFrom`. Reopen also starts from Approved. Cancel of a pending approval request goes through `cancelApprovalRequest`, which only the requester may do. The approval notifications carry `<projectId>:<crId>` as their document id, so their links can open the page without a lookup (Task 10).
- Task 9: the 5 change request paths of Task 11 were added to `path.ts` here, because the status route redirects to the change request page. `getProjectChangeRequests` and `getProjectChangeRequest` (`@mcp read`) were added here too, so the MCP digest changed.
- Task 9: a throwaway vitest run against this worktree's database ran the whole flow on a scratch project. It opened `CRTX-CR-1`, added a child element with a cost line, changed a budget and deleted an element; the live plan stayed as it was. The apply numbered the new element `CRTX-3`, wrote the budget and the cost line and set Applied with a baseline. A second change request then hit a live budget change and was refused with `ProjectChangeConflictError`. The reopen rebased its item onto the live budget. The project was then deleted; the script was not committed.
- Task 10: step 1's `models.ts` part was done in Task 1. `approveRequest` and `rejectRequest` move the change request from In Review only, pinned to the request's company, in the same transaction. No projects code runs in `packages/ee`.
- Task 10: a change request notification carries `<projectId>:<crId>` as its document id. `content.ts` reads the last part, so a bare change request id still resolves. `link.ts` and `Notifications.tsx` split it to build `path.to.projectChangeRequest`. In `Notifications.tsx` the new switch also sends a supplier approval to `path.to.supplierApproval`, as `link.ts` already does. The old ternary sent it to a purchase order page.
- Task 10: the approval rules page loader passes `changeRequestRules` to `ApprovalRules`. The card offers **New Rule** only while no rule exists, as the quality document and supplier cards do (no amount tiers).
- Task 10: `@carbon/ee` has no approvals test file, so `pnpm --filter @carbon/ee test -- approvals` finds none. The full `@carbon/ee` suite passes (1928). A throwaway vitest run against this worktree's database inserted an approval request for an In Review change request. `approveRequest` moved it to Approved and `rejectRequest` moved another to Rejected, each with `decidedBy` and the notes. The rows were deleted.

