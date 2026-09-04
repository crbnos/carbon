# Workflows: one switch — Publish / Unpublish — implementation plan

**Spec / source:** `.ai/specs/2026-08-24-workflow-publish-unpublish.md`
**Research:** `.ai/research/2026-08-24-workflow-version-terminology.md`
**Branch:** `fix/workflow-version-copy-changes`

Goal: delete `workflow.active`, rename `workflow.activeVersionId` →
`workflow.publishedVersionId`, and make Publish/Unpublish the only on-off switch.
"Published"/"Draft" is the only state vocabulary; the words "Active" and "Live" leave the
product entirely.

## Progress
- [x] Task 1: Write and apply the migration
- [x] Task 2: Regenerate database types
- [x] Task 3: Gate `syncWorkflowTriggers` on `publishedVersionId` alone
- [x] Task 4: Drop the `active` predicates from the scheduler
- [x] Task 5: Rename the engine's run-context gate to `workflowPublished`
- [ ] Task 6: Replace `setWorkflowActive` with `unpublishWorkflow`
- [ ] Task 7: Swap the column in the service and list loader
- [ ] Task 8: Turn the toggle route into an unpublish route
- [ ] Task 9: List page — drop the Active column, add Unpublish to the row menu
- [ ] Task 10: Builder — Publish/Unpublish button and Published tag
- [ ] Task 11: Update the trigger-drift SQL invariant
- [x] Task 12: Update the demo datasets
- [ ] Task 13: Update AGENTS.md, rules, and the docs site
- [ ] Task 14: Extract i18n strings
- [ ] Task 15: End-to-end verification

## Dependencies

- Task 2 needs Task 1. Everything else needs Task 2 (the generated types are what make the
  new column name typecheck).
- Tasks 3, 4, 5, 6, 7, 8, 11, 12 are independent of each other — safe to run in parallel.
- Task 9 needs Tasks 7 and 8. Task 10 needs Task 8.
- Task 14 needs Tasks 9 and 10. Task 15 needs everything.

---

## Task 1: Write and apply the migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_workflow-publish-unpublish.sql` (the command below generates the name)
- Read for context: `packages/database/supabase/migrations/20260810100100_workflows-foundation.sql` — lines 32–52 (table), 76–81 (FK), 183–185 (the partial index)

**Steps:**

1. Create the migration file:
   ```bash
   pnpm db:migrate:new workflow-publish-unpublish
   ```
2. Put exactly this in it:
   ```sql
   -- Publishing is now the only on-off switch: workflow."publishedVersionId" set means the
   -- workflow runs that version, NULL means it is a draft and nothing fires.

   -- A workflow that was published but switched OFF is deliberately paused. Collapsing the
   -- two flags would silently resume it, so unpublish it while "active" still records intent.
   UPDATE "workflow" SET "activeVersionId" = NULL WHERE "active" = FALSE;

   -- ...and its dispatch rows with it, matching what syncWorkflowTriggers does on unpublish.
   -- Must run BEFORE the column is dropped.
   DELETE FROM "workflowTriggerEvent" te
    USING "workflow" w
    WHERE te."workflowId" = w."id"
      AND te."companyId" = w."companyId"
      AND w."active" = FALSE;

   -- Postgres silently drops any index whose predicate names a dropped column, and
   -- "workflow_due_idx" is partial on "active" = TRUE. Rebuild it, or the scheduler loses
   -- its index with no error anywhere.
   DROP INDEX IF EXISTS "workflow_due_idx";

   ALTER TABLE "workflow" DROP COLUMN "active";
   ALTER TABLE "workflow" RENAME COLUMN "activeVersionId" TO "publishedVersionId";
   ALTER TABLE "workflow"
       RENAME CONSTRAINT "workflow_activeVersionId_fkey" TO "workflow_publishedVersionId_fkey";

   CREATE INDEX "workflow_due_idx" ON "workflow" ("nextRunAt")
       WHERE "nextRunAt" IS NOT NULL AND "publishedVersionId" IS NOT NULL;
   ```
3. Do NOT drop and re-add the FK. Its `ON DELETE SET NULL ("activeVersionId")` clause names
   its column explicitly on purpose (a bare `SET NULL` would also null `companyId`, which is
   `NOT NULL`, making the parent row undeletable — see `.ai/lessons.md`). `RENAME COLUMN`
   carries that clause across intact.
4. Apply it:
   ```bash
   pnpm db:migrate
   ```
   If the local database is not running, STOP and report — do not rebuild or reset the
   database.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c '\d "workflow"' -c "SELECT indexdef FROM pg_indexes WHERE indexname = 'workflow_due_idx';"
# Expected: the column list shows "publishedVersionId" and NO "active" column;
# the constraint is named workflow_publishedVersionId_fkey;
# indexdef contains: WHERE ((("nextRunAt" IS NOT NULL) AND ("publishedVersionId" IS NOT NULL)))
```

**Out of scope:** `eventSystemSubscription.active` (a different table, correctly named);
`workflowRun_active_idx` (an index on `workflowRun`, unrelated to this column); every
`workflowVersion` column.

---

## Task 2: Regenerate database types

**Depends on:** Task 1
**Files:**
- Modify (generated, never hand-edited): `packages/database/src/types.ts`,
  `packages/database/src/swagger-docs-schema.ts`,
  `packages/database/supabase/functions/lib/types.ts`

**Steps:**
1. Run:
   ```bash
   pnpm run generate:types
   ```
2. These three files already carry uncommitted regeneration drift on this branch. That is
   expected — the regen absorbs it, so the diff is wider than this feature. Do not try to
   revert or narrow it, and do not hand-edit any of them.

**Verify:**
```bash
grep -c 'publishedVersionId' packages/database/src/types.ts
grep -n '"active"' packages/database/src/types.ts | grep -i workflow
# Expected: the first prints a number >= 3 (Row/Insert/Update);
# the second prints nothing for the `workflow` table (eventSystemSubscription hits are fine)
```

**Out of scope:** hand-editing any generated file.

---

## Task 3: Gate `syncWorkflowTriggers` on `publishedVersionId` alone

**Depends on:** Task 2
**Files:**
- Modify: `packages/workflows/src/sync.ts` — the select and gate inside `syncWorkflowTriggers` (around lines 166–188)
- Modify: `packages/workflows/src/seed-workflows.test.ts` — any `active` reference

**Steps:**
1. Change the select from `["active", "activeVersionId"]` to `["publishedVersionId"]`.
2. Change the gate `if (workflow?.active && workflow.activeVersionId) {` to
   `if (workflow?.publishedVersionId) {`, and the `.where("id", "=", workflow.activeVersionId)`
   below it to `workflow.publishedVersionId`.
3. Update the doc comment above `CompanyLock` and the `nextRunAt` comment: "a promote or
   toggle" becomes "a publish or unpublish".
4. Leave everything else in the transaction alone — the `lockCompany` first statement, the
   delete-then-insert of `workflowTriggerEvent`, the `eventSystemSubscription`
   reconciliation, and the `nextRunAt` write are all unchanged.

**Verify:**
```bash
pnpm --filter @carbon/workflows test && pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: all tests pass; no TypeScript errors
```

**Out of scope:** `deriveWorkflowSubscriptions`, `deriveWorkflowTriggerRows`,
`findTriggerSchedule` — none of them read the workflow row.

---

## Task 4: Drop the `active` predicates from the scheduler

**Depends on:** Task 2
**Files:**
- Modify: `packages/jobs/src/workflows/scheduler.ts` — lines ~26, 39, 46, 50–51, 60–61, 70–71, 253
- Modify: `packages/jobs/src/workflows/scheduler.test.ts`

**Steps:**
1. Delete both `.where("w.active", "=", true)` lines. The
   `.where("w.activeVersionId", "is not", null)` beside each one already expresses the whole
   condition once the flag is gone.
2. Rename `activeVersionId` → `publishedVersionId` everywhere in the file: the row type field,
   the `onRef("v.id", "=", "w.activeVersionId")` join, the select list, the remaining
   `is not null` predicates, the type-narrowing predicate function, and
   `workflowVersionId: row.activeVersionId`.
3. Update the test fixtures/inserts to drop `active` and use the new column name.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- scheduler && pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: scheduler tests pass; no TypeScript errors
```

**Out of scope:** `activeRunKeys` / `activeKeys` / `workflowRun_active_idx` — those describe
in-flight RUNS, not the publish state. Do not rename them.

---

## Task 5: Rename the engine's run-context gate to `workflowPublished`

**Depends on:** Task 2
**Files:**
- Modify: `packages/jobs/src/workflows/engine/log.ts` — the context type (line ~15), the select (line ~54), the mapping (line ~76)
- Modify: `packages/jobs/src/workflows/engine/execute.ts` — `SWITCHED_OFF` (line 72) and the guard (line ~378)
- Modify: `packages/jobs/src/workflows/engine/execute.test.ts`, `end-to-end.test.ts`, `batch.test.ts` — the `workflowActive: true` fixtures

**Steps:**
1. In `log.ts`: rename the type field `workflowActive: boolean` → `workflowPublished: boolean`;
   change the select from `"w.active as workflowActive"` to
   ``sql`w."publishedVersionId" IS NOT NULL`.as("workflowPublished")`` (import `sql` from
   `kysely` if it is not already imported in that file); change the mapping to
   `workflowPublished: row.workflowPublished === true`.
2. In `execute.ts`: change the guard to `if (!context.workflowPublished) {` and change the
   constant to:
   ```typescript
   const SWITCHED_OFF = "This workflow was unpublished before the run started.";
   ```
   Rename the constant itself to `UNPUBLISHED` so the name matches the string, and update its
   single other use at the `statusReason` line.
3. Update the three test fixtures to `workflowPublished: true`.
4. The guard deliberately asks "is the workflow published at all", NOT "is this run's version
   still the published one". A run already in flight keeps the version it started with even
   after a newer version is published — that is existing documented behaviour. If you find
   yourself comparing `publishedVersionId` to the run's `workflowVersionId`, STOP and report.

**Verify:**
```bash
pnpm --filter @carbon/jobs test && pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: all @carbon/jobs tests pass; no TypeScript errors
```

**Out of scope:** `matcher.ts` — it never read `workflow.active`; its gate is the presence of
`workflowTriggerEvent` rows, which Task 3 already controls.

---

## Task 6: Replace `setWorkflowActive` with `unpublishWorkflow`

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/workflows/workflows.server.ts` — `publishWorkflowVersion` (~line 136), `setWorkflowActive` (~line 154), and the `syncAfterWorkflowDelete` doc comment (~line 197)
- Modify: `apps/erp/app/modules/workflows/workflows.models.ts` — delete `workflowToggleValidator` (~line 69)

**Steps:**
1. In `publishWorkflowVersion`, change the update payload from
   `{ activeVersionId: versionId, active: true, ... }` to
   `{ publishedVersionId: versionId, ... }`. Keep the `updatedBy` / `updatedAt` fields and the
   `datetime.timestamp()` call exactly as they are.
2. Replace `setWorkflowActive` with:
   ```typescript
   export async function unpublishWorkflow(
     client: SupabaseClient<Database>,
     {
       workflowId,
       companyId,
       userId
     }: {
       workflowId: string;
       companyId: string;
       userId: string;
     }
   ): Promise<WorkflowSyncResult> {
     const updated = await client
       .from("workflow")
       .update({
         publishedVersionId: null,
         updatedBy: userId,
         updatedAt: datetime.timestamp()
       })
       .eq("id", workflowId)
       .eq("companyId", companyId);

     if (updated.error) {
       return { ok: false, issues: [], message: updated.error.message };
     }

     // Unpublishing must still sync — that is what deletes the trigger rows and clears
     // nextRunAt, which is what actually stops the workflow firing.
     return syncAndWake(companyId, workflowId);
   }
   ```
   There is no boolean parameter: publishing needs a version id and runs validation, so it
   cannot share an entry point with unpublishing.
3. Delete `workflowToggleValidator` from `workflows.models.ts`.
4. In the `syncAfterWorkflowDelete` comment, change "the next publish or toggle" to "the next
   publish or unpublish".

**Verify:**
```bash
grep -rn "setWorkflowActive\|workflowToggleValidator" apps/erp/app
# Expected: only the not-yet-updated route hit from Task 8; zero after Task 8 lands
```

**Out of scope:** `validateDefinition`, `readWorkflowVersion`, `syncAndWake` internals.

---

## Task 7: Swap the column in the service and list loader

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/workflows/workflows.service.ts` — `getWorkflows` (~lines 18, 29–42), `getWorkflow` (~line 62), and the embed at ~line 489
- Modify: `apps/erp/app/routes/x+/workflows+/_index.tsx` — lines ~37–46

**Steps:**
1. In `getWorkflows`, change the select string from
   `"id, name, description, ownerId, active, activeVersionId, createdAt, updatedAt"` to
   `"id, name, description, ownerId, publishedVersionId, createdAt, updatedAt"` — `active` is
   dropped entirely, not renamed.
2. Update the derived-status comment to say `publishedVersionId`, and change the two filter
   branches to `.not("publishedVersionId", "is", null)` and
   `.is("publishedVersionId", null)`. The `"Published"` / `"Draft"` filter VALUES are
   unchanged — they are what the UI sends and what saved views already store.
3. In `getWorkflow` (~line 62), drop `active,` and rename `activeVersionId` in the select
   string.
4. At ~line 489, change `"workflowId, workflow(activeVersionId)"` to
   `"workflowId, workflow(publishedVersionId)"` and update whatever reads that field.
5. In `_index.tsx`, rename the local `activeVersionIds` → `publishedVersionIds` and read
   `row.publishedVersionId`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors mentioning `active` or `activeVersionId`.
# NOTE: the filter is `erp`, NOT `@carbon/erp` — a wrong filter silently passes.
# If turbo returns a cached pass, re-run with --force before trusting it.
```

**Out of scope:** the `GenericQueryFilters` pipeline; `getWorkflowVersionNumbers`;
`getWorkflowLastRuns`.

---

## Task 8: Turn the toggle route into an unpublish route

**Depends on:** Tasks 2, 6
**Files:**
- Create: `apps/erp/app/routes/x+/workflow+/$id.unpublish.tsx`
- Delete: `apps/erp/app/routes/x+/workflow+/$id.toggle.tsx`
- Modify: `apps/erp/app/utils/path.ts` — line ~2201
- Copy from (precedent): `apps/erp/app/routes/x+/workflow+/$id.toggle.tsx` (the file being replaced) and `$id.publish.tsx` for the permission + plan gate shape

**Steps:**
1. Create the new route with the same imports, `assertIsPost`, `requirePermissions({ update: "workflows" })` and `requirePlan({ feature: "WORKFLOWS" })` blocks as the toggle route. Drop the
   validator entirely — unpublish carries no fields — and call:
   ```typescript
   const unpublished = await unpublishWorkflow(client, {
     workflowId: id,
     companyId,
     userId
   });

   if (!unpublished.ok) {
     return data(
       { success: false },
       await flash(
         request,
         error(null, unpublished.message ?? "Failed to unpublish")
       )
     );
   }

   return data(
     { success: true },
     await flash(request, success("Workflow unpublished"))
   );
   ```
2. Keep the header comment's intent, updated: this is the one route both the list menu and the
   builder button post to, so there is exactly one place that re-syncs the trigger rows.
3. Delete `$id.toggle.tsx`.
4. In `path.ts`, replace the `workflowToggle` entry with:
   ```typescript
   workflowUnpublish: (id: string) =>
     generatePath(`${x}/workflow/${id}/unpublish`),
   ```
   Keep the alphabetical ordering of the surrounding keys (it sits after `workflowTestRun`).

**Verify:**
```bash
grep -rn "workflowToggle\|toggle.tsx" apps/erp/app | grep -i workflow
# Expected: no output
```

**Out of scope:** `$id.publish.tsx` — its path, validator and gates do not change.

---

## Task 9: List page — drop the Active column, add Unpublish to the row menu

**Depends on:** Tasks 7, 8
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/WorkflowsTable.tsx`
- Delete: `apps/erp/app/modules/workflows/ui/WorkflowActiveCheckbox.tsx`
- Delete: `apps/erp/app/modules/workflows/ui/WorkflowActiveSwitch.tsx` (already unused — nothing imports it)
- Modify: `apps/erp/app/modules/workflows/ui/index.ts` (or whichever barrel re-exports those two, if any)
- Modify: `apps/erp/app/modules/workflows/ui/WorkflowsUpgradeOverlay.tsx` — its fake sample rows carry an `active` field (lines ~20–32)
- Copy from (precedent): the existing `ConfirmDelete` usage at the bottom of `WorkflowsTable.tsx` (~lines 281–297) for the disclosure + selected-row + modal pattern, and `apps/erp/app/components/Modals/Confirm/Confirm.tsx` for the dialog itself

**Steps:**
1. Delete the whole `accessorKey: "active"` column object (~lines 117–130) and the
   `WorkflowActiveCheckbox` import.
2. Leave the `status` column exactly as it is — it already renders
   `Published` / `Draft` badges and the same static filter. Only its `isPublished` derivation
   changes source: `Boolean(row.original.publishedVersionId)`, and `exportValue` likewise.
3. Add an `unpublishDisclosure = useDisclosure()` beside the existing `renameDisclosure` /
   `deleteDisclosure`.
4. In `renderContextMenu`, add between Rename and Delete:
   ```tsx
   <MenuItem
     disabled={
       !permissions.can("update", "workflows") || !row.publishedVersionId
     }
     onClick={() => {
       flushSync(() => setSelectedWorkflow(row));
       unpublishDisclosure.onOpen();
     }}
   >
     <MenuIcon icon={<LuCircleStop />} />
     {t`Unpublish`}
   </MenuItem>
   ```
   Import `LuCircleStop` from `react-icons/lu` alongside the existing `Lu*` imports. Add
   `unpublishDisclosure` to the `renderContextMenu` dependency array.
5. Render the confirm beside the existing modals:
   ```tsx
   {unpublishDisclosure.isOpen && selectedWorkflow && (
     <Confirm
       action={path.to.workflowUnpublish(selectedWorkflow.id)}
       isOpen
       title={t`Unpublish ${selectedWorkflow.name}?`}
       text={t`It will stop running until you publish a version again. Nothing is deleted.`}
       confirmText={t`Unpublish`}
       onCancel={() => {
         setSelectedWorkflow(null);
         unpublishDisclosure.onClose();
       }}
       onSubmit={() => {
         setSelectedWorkflow(null);
         unpublishDisclosure.onClose();
       }}
     />
   )}
   ```
   Import `Confirm` from `~/components/Modals` (it is exported from that barrel alongside
   `ConfirmDelete`).
6. In `WorkflowsUpgradeOverlay.tsx`, remove the `active` field from every sample row and
   whatever renders it, so the marketing preview matches the real table's columns.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/modules/workflows
# Expected: no TypeScript errors; biome reports no NEW errors
# (the repo has ~419 pre-existing warnings — leave those alone)
```

**Out of scope:** the `status` column's badge copy and filter values (unchanged by design);
the `Table` component; saved views.

---

## Task 10: Builder — Publish/Unpublish button and Published tag

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/WorkflowVersionStatus.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/BuilderHeader.tsx` — lines ~139–156, ~196–270
- Modify: `apps/erp/app/modules/workflows/ui/WorkflowLockModal.tsx` — verify the copy at line ~104 still reads correctly
- Copy from (precedent): the existing `confirmPublish` disclosure + `Modal` block in `BuilderHeader.tsx` (~lines 238–270) for the second confirm dialog

**Steps:**
1. `WorkflowVersionStatus.tsx`: rename the prop `isLive` → `isPublished`, the early return
   `if (!isPublished) return null;`, and the badge text from `<Trans>Live</Trans>` to
   `<Trans>Published</Trans>`. Keep `variant="green"`.
2. `BuilderHeader.tsx`:
   - Rename the locals: `live` → `published`, `isLiveVersion` → `isPublishedVersion`, both
     reading `workflow.publishedVersionId`.
   - Update the lock-glyph comment and the tooltip text to
     `<Trans>This version is published. Create a new version to edit.</Trans>`.
   - `renderStatus` passes `isPublished={v.id === workflow.publishedVersionId}`.
   - Replace the single Publish button with a conditional. When `isPublishedVersion` is true,
     render an **Unpublish** button (`variant="secondary"`) that opens a new
     `confirmUnpublish` disclosure; otherwise render the existing **Publish** button. The
     Publish button keeps its `isDisabled` on `!permissions.can("update", "workflows")` and
     the in-flight fetcher state, but DROPS `isLiveVersion` from that condition — the
     published version now shows Unpublish rather than a permanently disabled Publish.
   - The Unpublish confirm posts to `path.to.workflowUnpublish(workflow.id)`. Reuse
     `Confirm` from `~/components/Modals` (same component as Task 9) rather than hand-rolling
     a second inline `Modal`: title `` t`Unpublish this workflow?` ``, text
     `` t`It will stop running until you publish a version again. Nothing is deleted.` ``,
     confirmText `` t`Unpublish` ``.
   - Update the replace-confirm copy: title stays `` t`Publish Version ${current.versionNumber}?` ``,
     body becomes `` t`Version ${published.versionNumber} is published now and will be replaced.` ``.
3. Check `WorkflowLockModal.tsx` line ~104 ("Branch an editable copy of this version that you
   can change and publish.") — already correct, leave it unless it mentions Live or Active.

**Verify:**
```bash
grep -rn "isLive\|Trans>Live<\|is live" apps/erp/app/modules/workflows
# Expected: no output
pnpm exec turbo run typecheck --filter=erp
# Expected: no TypeScript errors
```

**Out of scope:** the builder store's `isVersionLocked` / `canChangeDefinition` /
`canMoveNodes` logic — the locking model does not change; `IssuesPanel.tsx` ("N problems —
not published") is already correct.

---

## Task 11: Update the trigger-drift SQL invariant

**Depends on:** Task 2
**Files:**
- Modify: `packages/checks/src/invariants/workflow-trigger-event-drift.sql`

**Steps:**
1. Rename the `active` CTE to `published`, and update the three `FROM active a` /
   `FROM declared` references accordingly.
2. Replace `WHERE w."active" = TRUE` with `WHERE w."publishedVersionId" IS NOT NULL`, and
   rename `w."activeVersionId"` → `w."publishedVersionId"` in the CTE select and in the final
   `t."workflowVersionId" <> d."activeVersionId"` comparison.
3. Reword the three violation strings and the header comment: "an active workflow's" →
   "a published workflow's"; "an active, promoted version" → "a published version"; "points at
   a version that is no longer the active one" → "…no longer the published one".

**Verify:**
```bash
pnpm --filter @carbon/checks invariants
# Expected: workflow-trigger-event-drift reports zero violating rows
pnpm --filter @carbon/checks workflow-events
# Expected: passes
```
If the local database is unreachable these two cannot run — say so explicitly in the report
rather than marking the task verified.

**Out of scope:** every other file in `packages/checks/src/invariants/`.

---

## Task 12: Update the demo datasets

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/src/datasets/tiers/workflow-definitions.ts` — `SeedWorkflow.active` at lines 63–70
- Modify: `packages/database/src/datasets/tiers/11-workflows.ts` — lines ~83–109
- Modify: `packages/database/src/datasets/data/satellite/workflows.ts`,
  `data/robotics/workflows.ts`, `data/precision/workflows.ts`, `data/motor/workflows.ts` —
  each has one `active: true` and six `active: false`

**Steps:**
1. Rename the `SeedWorkflow` field `active: boolean` → `published: boolean` and update its doc
   comment ("Only the simplest one ships published; the rest are there to read and publish
   deliberately.").
2. Rename `active:` → `published:` in all four data files (7 occurrences each).
3. In `11-workflows.ts`:
   - The log line becomes ``ctx.log(`workflow — ${workflow.name}${workflow.published ? "" : " (draft)"}`)``.
   - Drop `active: workflow.active` from the `insertId(ctx, "workflow", {...})` payload.
   - The `UPDATE "workflow" SET "activeVersionId" = $1` statement becomes
     `SET "publishedVersionId" = $1` and now runs **only when `workflow.published`** — replace
     the old comment (which explained why it was set even when off) with: an unpublished
     seeded workflow is a draft, so it gets no pointer and no trigger rows.
   - Keep the `if (!workflow.published) continue;` guard that skips the trigger rows.
4. Do NOT touch `reconcileSubscriptions`'s `active: true` — that is an
   `eventSystemSubscription` column.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets apply and roll back cleanly, no errors
```
Row counts per table must be unchanged (same workflows, same versions, one published workflow
with trigger rows per dataset), so `.ai/runs/*-baseline.txt` stays valid. If a count moves,
STOP and report — do not update the baselines.

**Out of scope:** the workflow definitions themselves (nodes/edges); every other tier.

---

## Task 13: Update AGENTS.md, rules, and the docs site

**Depends on:** Tasks 3–12
**Files:**
- Modify: `apps/erp/app/modules/workflows/AGENTS.md` — the Vocabulary entry (line ~9), the Publish entry (line ~13), the validation-command comment (line ~42), the file-tree comment (line ~51), the server-function bullet (line ~72)
- Modify: `packages/workflows/AGENTS.md` — the if-and-only-if rule (~line 302)
- Modify: `.claude/rules/workflow-matcher.md` — the `syncWorkflowTriggers` bullet ("Call it on promote, on trigger edit, and on activate/deactivate") and the surrounding `active`/pointer wording
- Modify: `.claude/rules/workflow-engine.md` — the skipped-run reason string, if it quotes it
- Modify: `docs/content/docs/reference/workflows.mdx` — lines ~113–117 and ~129

**Steps:**
1. `apps/erp/app/modules/workflows/AGENTS.md`: the Vocabulary entry currently explains that
   the pointer and the boolean are separate columns *on purpose*. That reasoning is now wrong.
   Replace it: a workflow carries `ownerId` and `publishedVersionId`; the pointer IS the on-off
   switch — set means published and running that version, `NULL` means draft. The Publish
   entry loses its "set `active`" step (validate → set `publishedVersionId` →
   `syncWorkflowTriggers` → wake the scheduler) and gains Unpublish as the inverse. Replace
   `setWorkflowActive` with `unpublishWorkflow` in the server-function bullet, and "publish/toggle"
   with "publish/unpublish" in the command comment.
2. `packages/workflows/AGENTS.md` ~line 302: a `workflowTriggerEvent` row exists if and only if
   the workflow HAS A PUBLISHED VERSION and that version's trigger node lists the event; the
   third rewrite trigger becomes "unpublishing" instead of "toggling `active`".
3. `.claude/rules/workflow-matcher.md`: "Call it on publish, on trigger edit, and on
   unpublish." Fix the `active`/`activeVersionId` wording in the same section.
4. `.claude/rules/workflow-engine.md`: update the skipped reason string if quoted.
5. `docs/content/docs/reference/workflows.mdx`:
   - **Delete** the entire `<Callout type="warn" title="“Published” and “Active” are different switches">` block (lines ~113–115). It documents a distinction that no longer exists.
   - Rewrite the publishing paragraph: publishing a version makes it the one that runs;
     **"Unpublish"** stops the workflow and leaves every version intact, and publishing again
     starts it. There is no separate on/off switch.
   - Change *"This version is live. Create a new version to edit."* to *"This version is
     published…"* (line ~117) and "promote another one mid-run" wording if it says "live".
   - Line ~129: the Update permission row's "toggle active" becomes "unpublish".

**Verify:**
```bash
grep -rn -i "active switch\|activeVersionId\|are different switches" docs/content/docs/reference/workflows.mdx apps/erp/app/modules/workflows/AGENTS.md packages/workflows/AGENTS.md .claude/rules/workflow-matcher.md
# Expected: no output
pnpm --filter docs build
# Expected: build succeeds (MDX must still parse after the callout removal)
```

**Out of scope:** every other docs page; `.claude/rules/workflow-event-system.md` (its
`active` references are `eventSystemSubscription`, correctly named).

---

## Task 14: Extract i18n strings

**Depends on:** Tasks 9, 10
**Files:**
- Modify: `packages/locale/locales/*/erp.po` (generated by the commands below)

**Steps:**
1. Run:
   ```bash
   pnpm lingui:extract && pnpm lingui:clean
   ```
2. Fill the new strings in the other locales with the `/translate` skill (it fans the work out
   to cheap models and merges deterministically). Do not hand-translate.
3. Expect churn: on this branch `lingui:extract` rewrites large parts of the catalogs. Keep the
   commit for this task separate from the code tasks so review stays readable.

**Verify:**
```bash
grep -c 'msgid "Published"' packages/locale/locales/en/erp.po
# Expected: at least 1
```

**Out of scope:** the `mes` catalog (nothing in `apps/mes` touches workflows); adding locales.

---

## Task 15: End-to-end verification

**Depends on:** all previous tasks
**Files:** none (verification only)

**Steps:**
1. Run the full scoped gate set:
   ```bash
   pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/workflows --filter=@carbon/database
   pnpm exec biome check
   pnpm --filter @carbon/jobs test
   pnpm --filter @carbon/workflows test
   pnpm db:check:datasets
   pnpm --filter @carbon/checks workflow-events
   ```
2. Confirm the words are gone:
   ```bash
   grep -rn "workflow.active\|activeVersionId" apps/erp/app packages/workflows/src packages/jobs/src packages/checks/src
   # Expected: no output
   ```
3. Browser pass with the `/auth` then `/test` skills, against `/x/workflows`, covering spec
   acceptance criteria 4–8: publish a version (tag appears, list flips to Published),
   unpublish from the builder (tag gone, list reads Draft), unpublish from the list row menu,
   republish the same version, and confirm the Active checkbox column is gone from the table.
   Ask the user before driving the browser.
4. Report which acceptance criteria are proven by an actual command or browser run and which
   are not. Do not claim a criterion passed without output to back it.

**Verify:** every command above exits zero; every criterion in the spec's Acceptance criteria
list is either demonstrated or explicitly reported as not demonstrated.

**Out of scope:** `pnpm run build` (full repo build) unless something above fails in a way that
suggests a build-only breakage; whole-repo `turbo run typecheck --filter='*'` (it OOMs).
