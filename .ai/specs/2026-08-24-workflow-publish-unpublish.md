# Workflows: one switch — Publish / Unpublish

- **Status:** Approved (pending user sign-off)
- **Date:** 2026-08-24
- **Author:** aashu (with Claude)
- **Research:** [.ai/research/2026-08-24-workflow-version-terminology.md](../research/2026-08-24-workflow-version-terminology.md)

## Problem

A workflow today has three user-facing words for what a customer experiences as two
ideas, and one of them is a lie:

| Surface | Word | Backing data |
|---|---|---|
| `WorkflowsTable` status column | **Published** / Draft | `workflow.activeVersionId != null` |
| Version menu, in the builder | **Live** | version id `== workflow.activeVersionId` |
| List column + builder switch | **Active** | `workflow.active` (a separate boolean) |

"Published" and "Live" are the *same fact* seen from two levels. "Active" is a genuinely
separate kill switch, and it stole the word "active" from the pointer column
(`activeVersionId`) that means something else entirely. Our own documentation has a warning
callout about it — `docs/content/docs/reference/workflows.mdx:113`, *"'Published' and
'Active' are different switches"* — which is the tell that the model is too complicated to
explain. A workflow only runs when it is active **and** has a live version, and nothing on
screen says so.

## Goals

- One concept, one word. **Publishing is the on switch. Unpublishing is the off switch.**
- The word for the running state is **Published**, everywhere: badge, version tag, docs, code.
- "Active" and "Live" disappear from every user-facing string and from the workflow schema.
- No customer's workflow silently starts or stops running because of this change.

## Non-goals

- No change to how workflows are authored, validated, executed, scheduled, retried, or logged.
- No change to the version-locking model (publishing still freezes a version; editing still
  means creating a new one).
- No approval/review step before publishing. Not asked for.
- No rename of `eventSystemSubscription.active` — a different table, a different concept,
  correctly named. Leave it alone.

## Design

### 1. Data model

One migration, in this order:

```sql
-- A workflow that was published but switched OFF is deliberately paused. Collapsing the
-- two flags into one would silently resume it, so unpublish it first, before the column
-- that records the user's intent is gone.
UPDATE "workflow" SET "activeVersionId" = NULL WHERE "active" = FALSE;

-- ...and its trigger rows with it, to stay consistent with syncWorkflowTriggers, the only
-- other writer of that table. Must run BEFORE the column is dropped.
DELETE FROM "workflowTriggerEvent" te
 USING "workflow" w
 WHERE te."workflowId" = w."id" AND te."companyId" = w."companyId"
   AND w."active" = FALSE;

-- Postgres SILENTLY DROPS any index whose predicate names a dropped column, so
-- "workflow_due_idx" (partial on "active" = TRUE) has to be rebuilt, not just left alone.
DROP INDEX IF EXISTS "workflow_due_idx";

ALTER TABLE "workflow" DROP COLUMN "active";
ALTER TABLE "workflow" RENAME COLUMN "activeVersionId" TO "publishedVersionId";
ALTER TABLE "workflow"
    RENAME CONSTRAINT "workflow_activeVersionId_fkey" TO "workflow_publishedVersionId_fkey";

CREATE INDEX "workflow_due_idx" ON "workflow" ("nextRunAt")
    WHERE "nextRunAt" IS NOT NULL AND "publishedVersionId" IS NOT NULL;
```

Three details that are easy to get wrong here:

- **`workflow_due_idx` is a partial index on `"active" = TRUE`** — this is the scheduler's
  due-workflow index. Dropping the column takes the index with it *without an error*, so the
  scheduler would quietly fall back to a sequential scan. Rebuilding it is not optional. Its
  predicate loses the `active` half and keeps the other two, which is exactly the collapse
  this change is about.
- **A column rename does not rename its constraint.** `workflow_activeVersionId_fkey` has to
  be renamed explicitly or the schema keeps the old word in the place people read it from.
- The FK's `ON DELETE SET NULL ("activeVersionId")` names its column explicitly on purpose
  (see `.ai/lessons.md` — a bare `SET NULL` would null `companyId` too and make the parent
  row undeletable). `RENAME COLUMN` carries that clause across intact; do **not** drop and
  re-add the constraint.

After this, `workflow.publishedVersionId` is the single source of truth:

- `NULL` → the workflow is a **Draft**. Nothing fires. No `workflowTriggerEvent` rows exist.
- set → the workflow is **Published**. That version is the one that runs.

In practice the trigger rows the `DELETE` targets should already be absent (turning a
workflow off syncs them away), so it is belt-and-braces against historical drift — but it is
exactly what the `workflow-trigger-event-drift` invariant checks, so a stale row would
otherwise fail CI right after the migration lands.

`nextRunAt`, `canvasState`, and every `workflowVersion` column are untouched.

Then `pnpm run generate:types`. Note that `packages/database/src/types.ts`,
`swagger-docs-schema.ts` and `supabase/functions/lib/types.ts` already carry uncommitted
regeneration drift on this branch — regenerating will absorb it, which is correct, but the
diff will be wider than this feature.

**No new column to remember the last published version.** Resuming means opening the
builder, picking a version and pressing Publish — the version menu is already the place
you choose a version, and every version now carries a Publish button when nothing is
published. Adding a `lastPublishedVersionId` would put a second version pointer on the same
row, which is the duplication this whole change exists to remove.

### 2. Runtime — three gates, all narrowing to one condition

Every place that reads `workflow.active` today is reading "is this workflow on". After the
change that question is `publishedVersionId IS NOT NULL`.

**`packages/workflows/src/sync.ts`** — `syncWorkflowTriggers` selects
`["active", "activeVersionId"]` and gates on `workflow?.active && workflow.activeVersionId`.
It becomes a select of `["publishedVersionId"]` gated on `workflow?.publishedVersionId`.
Everything downstream (trigger-row rewrite, `eventSystemSubscription` reconciliation,
`nextRunAt`) is unchanged, including the required `lockCompany` first statement. This one
edit is what makes unpublish actually stop a workflow: no trigger rows, no dispatch.

**`packages/jobs/src/workflows/scheduler.ts`** — drop the two `.where("w.active", "=", true)`
predicates; the existing `.where("w.publishedVersionId", "is not", null)` beside each of them
already expresses the whole condition.

**`packages/jobs/src/workflows/engine/execute.ts`** — the last-moment guard
(`if (!context.workflowActive) → Skipped`) becomes `if (!context.workflowPublished)`, fed by
`log.ts` selecting `w."publishedVersionId" IS NOT NULL` instead of `w.active`. This
deliberately tests *"is the workflow published at all"*, not *"is this run's version still
the published one"* — a run already in flight keeps using the version it started with even
if a newer one is promoted mid-run, which is documented behaviour we are not changing. The
`SWITCHED_OFF` reason string becomes:

> `"This workflow was unpublished before the run started."`

That string is written into `workflowRun.statusReason` and shown in run history, so it is
user-facing copy, not a comment.

### 3. Server + service layer

- `publishWorkflowVersion` (`workflows.server.ts`) drops `active: true` from its update and
  sets `publishedVersionId`. Validation, the `syncAndWake` call, and the issue-return shape
  are unchanged.
- `setWorkflowActive` becomes **`unpublishWorkflow(client, { workflowId, companyId, userId })`**
  — sets `publishedVersionId: null` and calls the same `syncAndWake`. It takes no boolean:
  there is only one direction, because publishing needs a version id and validation.
- `getWorkflows` / `getWorkflow` (`workflows.service.ts`) swap the column in their `select`
  lists, and the `Published`/`Draft` static filter switches to
  `.not("publishedVersionId", "is", null)` / `.is("publishedVersionId", null)`. The
  translation comment there stays accurate and gets the new column name.
- `workflowToggleValidator` is deleted from `workflows.models.ts` — unpublish carries no
  fields.

### 4. Routes

| Before | After |
|---|---|
| `x+/workflow+/$id.toggle.tsx` (reads `active` checkbox) | `x+/workflow+/$id.unpublish.tsx` (no body) |
| `path.to.workflowToggle(id)` | `path.to.workflowUnpublish(id)` |

`$id.publish.tsx` keeps its path, validator and permission gate (`update: "workflows"`).
The unpublish route gates on the same permission. Both remain the only authorization gate
in front of `syncWorkflowTriggers`, which bypasses RLS via Kysely.

### 5. UI

**List page (`WorkflowsTable.tsx`)**

- The `active` column and `WorkflowActiveCheckbox` are removed; `WorkflowActiveCheckbox.tsx`
  and the unused `WorkflowActiveSwitch.tsx` are deleted.
- The Status column keeps its `Published` / `Draft` badges and its static filter exactly as
  they read today — the copy customers already see does not change.
- The row context menu gains **Unpublish** between *Rename Workflow* and *Delete Workflow*,
  disabled unless `permissions.can("update", "workflows")` **and** the row is published. It
  posts to `path.to.workflowUnpublish(row.id)` and shows a confirm modal
  (*"Unpublish {name}? It will stop running until you publish a version again."*) because it
  stops production automation. Publishing is not offered from the list: it needs a version
  choice and can fail validation with issues only the canvas can show.

**Builder (`BuilderHeader.tsx`)**

- `live` / `isLiveVersion` become `published` / `isPublishedVersion`.
- The primary button is **Publish** when the open version is not the published one, and
  **Unpublish** when it is — replacing today's dead disabled-Publish state on the published
  version. So: nothing published → every version offers Publish; something published → the
  published version offers Unpublish. Unpublish gets the same confirm modal as the list.
- The replace-confirm modal copy: *"Version N is published now and will be replaced."*
- The lock tooltip: *"This version is published. Create a new version to edit."*

**Version menu (`WorkflowVersionStatus.tsx`)** — prop `isLive` → `isPublished`, badge text
`Live` → `Published`. Still renders nothing for every other version, so exactly one version
in the menu ever carries a tag.

**Also** `WorkflowLockModal.tsx` (*"…change and publish"* — already correct, verify),
`WorkflowsUpgradeOverlay.tsx` (its fake sample rows carry an `active` field that must match
the real table's new shape), and `IssuesPanel.tsx` (*"N problems — not published"* — already
correct).

Unrelated `active` identifiers in `TriggerForm.tsx` (weekday toggles), `catalog.ts` /
`recordPickers.tsx` / `NodePalette.tsx` (custom-field `active`) are **not** touched.

New and changed strings are marked with Lingui macros as the surrounding code does, then
`pnpm lingui:extract` and the `/translate` skill fill the catalogs.

### 6. Demo datasets

`packages/database/src/datasets/tiers/11-workflows.ts` sets `activeVersionId` for every
seeded workflow and then skips trigger rows for the off ones. That two-step exists only
because the two flags were separate. It collapses:

- `SeedWorkflow.active` → `SeedWorkflow.published` (type + the four
  `data/{satellite,robotics,precision,motor}/workflows.ts` files, one `active: true` and six
  `active: false` each).
- Set `publishedVersionId` **only** when `published`; keep the `continue` that skips trigger
  rows for the rest. The log line becomes `(draft)` instead of `(off)`.
- `reconcileSubscriptions`'s `active: true` is an `eventSystemSubscription` column — untouched.

Row counts per table are unchanged (same workflows, same versions, same one published
workflow with trigger rows), so the `.ai/runs/*-baseline.txt` files stay valid.
`pnpm db:check:datasets` is the gate.

### 7. Conformance + docs

- `packages/checks/src/invariants/workflow-trigger-event-drift.sql` — the `active` CTE drops
  its `WHERE w."active" = TRUE` and filters `w."publishedVersionId" IS NOT NULL` instead;
  three violation strings mentioning "active" are reworded to "published". Rename the CTE to
  `published` so the SQL reads honestly.
- `apps/erp/app/modules/workflows/AGENTS.md` — the Vocabulary entry that explains *why* the
  boolean and the pointer are separate columns is now wrong and must be replaced with the
  single-pointer model; the Publish bullet loses its "set `active`" step.
- `packages/workflows/AGENTS.md` (~line 302) — the if-and-only-if rule loses "is active".
- `.claude/rules/workflow-matcher.md` — `syncWorkflowTriggers` is called "on publish, on
  trigger edit, and on unpublish"; the `active`/pointer wording in the sync section.
- `.claude/rules/workflow-engine.md` — the skipped-run reason string.
- `docs/content/docs/reference/workflows.mdx` — **delete** the *"'Published' and 'Active' are
  different switches"* callout, rewrite the publish paragraph as one switch, change *"This
  version is live"* to *"…is published"*, and drop "toggle active" from the Update-permission
  row.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Model | Publish/Unpublish is the only on-off switch; published version = the running version | n8n 2.0 removed its active/inactive toggle for exactly this reason; Zapier, Retool and HubSpot all ship a single publish switch |
| State word | **Published** everywhere (badge, version tag, docs) | Shares a root word with the Publish button, which is the easiest pairing to learn; also leaves today's list badge copy unchanged |
| "Live" | Removed from all copy | It was a second word for the same fact as the Published badge — the original confusion |
| Column | `activeVersionId` → `publishedVersionId`, in the same migration | "Active" leaked from this column into the UI in the first place; leaving it keeps the trap set. Mechanical and typechecker-enforced |
| Re-arm after unpublish | Nothing stored; publish a version from the version menu | A second version pointer would reintroduce the duplication being removed |
| Paused workflows at migration time | `UPDATE … SET activeVersionId = NULL WHERE active = FALSE` before the drop | A deliberately-paused workflow must not silently resume. This is the one irreversible-feeling step and it fails safe (stopped, not started) |
| `workflow_due_idx` | Dropped and recreated without the `active` half of its predicate | Postgres drops a partial index whose predicate names a dropped column, silently — the scheduler would lose its index with no error anywhere |
| Engine guard | `publishedVersionId IS NOT NULL`, not "is this run's version still published" | Faithful translation of the old `active` guard; in-flight runs keep their version, which is documented behaviour |
| List page | Status badge + **Unpublish** in the row context menu; no toggle column | Keeps a one-click stop reachable from the list. A toggle would lie: publishing can fail validation and needs a version choice |
| Unpublish confirmation | Confirm modal on both list and builder | It stops live automation; a misclick has production consequences |
| `eventSystemSubscription.active` | Untouched | Different table, different concept, correctly named |

## Acceptance criteria

1. **Schema** — `workflow` has no `active` column and has `publishedVersionId`;
   `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/workflows`
   passes with no reference to `workflow.active` anywhere outside generated types.
2. **Index survived** — after `pnpm db:migrate`,
   `SELECT indexdef FROM pg_indexes WHERE indexname = 'workflow_due_idx'` returns one row and
   its predicate names `publishedVersionId` and `nextRunAt` only.
3. **Migration safety** — on a database seeded with the `satellite` dataset plus a workflow
   manually set to `active = false, activeVersionId = <v>`, after `pnpm db:migrate` that
   workflow has `publishedVersionId IS NULL`, has zero `workflowTriggerEvent` rows, and shows
   **Draft** in the list.
4. **Publish** — in the builder on an unpublished workflow, every version's primary button
   reads **Publish**; no version carries a tag. Pressing Publish on a valid version writes
   `publishedVersionId`, tags that version **Published**, creates its `workflowTriggerEvent`
   rows, and the list row flips to **Published**.
5. **Unpublish from the builder** — on the published version the button reads **Unpublish**;
   confirming clears `publishedVersionId`, removes every `workflowTriggerEvent` row for that
   workflow, drops the **Published** tag, and the list row reads **Draft**. Triggering the
   workflow's event afterwards creates no `workflowRun`.
6. **Unpublish from the list** — the row menu's Unpublish is disabled on a Draft row and on a
   user without `workflows_update`; on a Published row it produces the same end state as (4).
7. **Republish** — after (4), publishing the same version again restores the trigger rows and
   the Published tag. A schedule-triggered workflow gets a non-null `workflow.nextRunAt`; an
   event-triggered one gets `NULL`.
8. **In-flight run** — a run queued for version 1 and then unpublished before it executes
   settles `Skipped` with reason *"This workflow was unpublished before the run started."*
9. **No "Active"/"Live"** — `grep -rn "Live\|Active" apps/erp/app/modules/workflows/ui` returns
   no user-facing workflow-state string, and `docs/content/docs/reference/workflows.mdx` has no
   "Active switch" callout.
10. **Gates green** — `pnpm exec biome check`, the workflow unit tests
   (`packages/jobs/src/workflows/*.test.ts`, `packages/workflows/src/seed-workflows.test.ts`),
   `pnpm db:check:datasets`, and `pnpm --filter @carbon/checks workflow-events` all pass.

## Open questions (resolved before writing)

- [x] **How do we remember which version to re-publish after an unpublish?** — **Answer:**
  Don't. When nothing is published, every version in the menu offers Publish and no version
  carries a tag; when something is published, that version carries the tag and offers
  Unpublish. No new column. (User, 2026-08-24.)
- [x] **Which single word means "this is the version that runs"?** — **Answer:** **Published**,
  everywhere — badge, version tag, code, docs. The button stays Publish/Unpublish, so the verb
  and the state share a root word. "Live" is removed. (User, 2026-08-24.)
- [x] **Rename `workflow.activeVersionId` → `publishedVersionId`?** — **Answer:** Yes, in the
  same migration. The word "active" leaked from that column into the UI, so leaving it keeps
  the trap set for the next engineer. (User, 2026-08-24.)
- [x] **What replaces the Active checkbox column on the list page?** — **Answer:** Nothing in
  the grid; the Published/Draft badge is the indicator, and **Unpublish** joins the row context
  menu so an emergency stop stays one click from the list. Publishing stays in the builder.
  (User, 2026-08-24.)

## Changelog

- **2026-08-24** — Written after the four questions above were resolved with the user.
  Grounded in `20260810100100_workflows-foundation.sql`, `packages/workflows/src/sync.ts`,
  `packages/jobs/src/workflows/{scheduler,matcher}.ts`,
  `packages/jobs/src/workflows/engine/{execute,log}.ts`, the ERP workflows module, and
  `docs/content/docs/reference/workflows.mdx`. Terminology grounded in the competitor scan at
  `.ai/research/2026-08-24-workflow-version-terminology.md`.
