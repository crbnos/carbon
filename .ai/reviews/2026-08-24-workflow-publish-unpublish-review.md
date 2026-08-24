# Thermo-nuclear review — workflow publish/unpublish

Branch `fix/workflow-version-copy-changes`, working tree vs `main`.
34 files, +344 / −266, plus one migration and one new route; three files deleted.

Verified green before reviewing: `pnpm exec turbo run typecheck --filter=erp` (17.8s, clean),
`pnpm exec biome check` on every touched path (3 formatter errors found and fixed — see
finding 7), 490 `@carbon/jobs` tests, 431 `@carbon/workflows` tests, all four demo datasets.

**Verdict: do not merge as-is.** The change itself is the right shape — replacing two switches
with one pointer genuinely deletes concepts rather than rearranging them, and the migration is
careful. But it leaves the version-lock rule implemented four times, ships the same confirm
dialog twice, and strips the cover from a load-bearing WHERE clause with no comment. Findings
1–4 are each a few lines and should land before merge.

---

## 1. The version-lock rule now has four implementations, and its own helper is an identity wrapper

**Structural / single-source-of-truth. High conviction.**

`apps/erp/app/modules/workflows/workflows.server.ts:25`

```typescript
export function getWorkflowLockFlags({
  versionId,
  publishedVersionId
}: {
  versionId: string;
  publishedVersionId: string | null;
}) {
  const isPublished =
    publishedVersionId !== null && versionId === publishedVersionId;
  return { isPublished, isVersionLocked: isPublished };
}
```

Three problems stacked in nine lines:

- It returns **one boolean under two names**, and `isPublished` is never read from it by any
  caller (grep confirms: the only destructure anywhere is `const { isVersionLocked } = ...`).
- Its **only** caller is `checkWorkflowVersionLock`, twenty lines below it in the same file.
- `publishedVersionId !== null &&` is dead. `versionId` is a non-empty `string` at both call
  sites (`params.id` guarded by `if (!id) throw`, and `z.string().min(1)` in
  `workflowPublishValidator`), so `versionId === null` is unreachable and the bare equality
  already yields `false` when the pointer is null.

Meanwhile the same rule is re-derived inline in two other layers:

- `apps/erp/app/routes/x+/workflow+/$id.tsx:149` — `isVersionLocked: versionId === workflow.publishedVersionId`
- `apps/erp/app/modules/workflows/ui/Builder/BuilderHeader.tsx:158` — `const isPublishedVersion = versionId === workflow.publishedVersionId;`

Under the old two-switch model (`active` boolean AND `activeVersionId` pointer) a named helper
earned its keep, because "is this version locked" was a compound question. That is precisely
what this PR deleted. The question is now a single equality, and a helper wrapping `a === b`
in an object literal is indirection with nothing behind it.

**Remedy — delete it.** In `checkWorkflowVersionLock`:

```typescript
  return versionId === workflow.publishedVersionId
    ? { ok: false, message: LOCKED_VERSION_MESSAGE }
    : { ok: true };
```

Drop `getWorkflowLockFlags` and its parameter type entirely; keep `LOCKED_VERSION_MESSAGE`
exported. Net −13 lines, one fewer module export, one fewer name for one idea, and the two
inline call sites stop looking like they are bypassing a canonical helper — because there
isn't one to bypass.

(If you would rather keep a shared predicate, then it must be used by all three call sites and
should be a plain `isVersionPublished(versionId, publishedVersionId): boolean` — not a flags
object. The current shape is the one option that is strictly worse than both alternatives.)

---

## 2. The Unpublish confirm dialog is built twice

**Duplication / SSOT. High conviction.**

`apps/erp/app/modules/workflows/ui/WorkflowsTable.tsx:283`

```tsx
          <Confirm
            action={path.to.workflowUnpublish(selectedWorkflow.id)}
            isOpen
            title={t`Unpublish ${selectedWorkflow.name}?`}
            text={t`It will stop running until you publish a version again. Nothing is deleted.`}
            confirmText={t`Unpublish`}
```

`apps/erp/app/modules/workflows/ui/Builder/BuilderHeader.tsx:253`

```tsx
        <Confirm
          action={path.to.workflowUnpublish(workflow.id)}
          isOpen
          title={t`Unpublish this workflow?`}
          text={t`It will stop running until you publish a version again. Nothing is deleted.`}
          confirmText={t`Unpublish`}
```

Same route builder, same body copy, same button label — and already drifting on the title. Two
call sites appearing in the same PR is the moment to extract, not the moment to copy. The
consequence of leaving it: the next copy edit lands in one of the two and the product says two
different things about the same action, which is the exact class of bug this PR exists to fix.

**Remedy.** `apps/erp/app/modules/workflows/ui/ConfirmUnpublishWorkflow.tsx`:

```tsx
export function ConfirmUnpublishWorkflow({
  workflowId,
  name,
  onClose
}: {
  workflowId: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  return (
    <Confirm
      action={path.to.workflowUnpublish(workflowId)}
      isOpen
      title={t`Unpublish ${name}?`}
      text={t`It will stop running until you publish a version again. Nothing is deleted.`}
      confirmText={t`Unpublish`}
      onCancel={onClose}
      onSubmit={onClose}
    />
  );
}
```

Take the named title in both places — a confirm dialog should name what it is about to change,
and the builder has `workflow.name` right there. That also collapses three Lingui message ids
to two.

---

## 3. `scanDue`'s "redundant" WHERE is load-bearing, and now nothing says so

**Legibility of a non-obvious invariant. High conviction — this one is a future outage.**

`packages/jobs/src/workflows/scheduler.ts:38`

```typescript
    .innerJoin("workflowVersion as v", (join) =>
      join
        .onRef("v.id", "=", "w.publishedVersionId")
        .onRef("v.companyId", "=", "w.companyId")
    )
    ...
    .where("w.publishedVersionId", "is not", null)
```

To any reader this WHERE is obviously dead: an inner join on `v.id = w.publishedVersionId`
cannot match a NULL. It is not dead. The scheduler's index, created by this PR's own migration,
is **partial**:

```sql
CREATE INDEX "workflow_due_idx" ON "workflow" ("nextRunAt")
    WHERE "nextRunAt" IS NOT NULL AND "publishedVersionId" IS NOT NULL;
```

Postgres proves a partial-index predicate from that relation's own restriction clauses, not
from join quals, so deleting the WHERE drops the scan to a seq scan over `workflow` on every
scheduler wake. Before this PR the clause was camouflaged as `.where("w.active", "=", true)`
next to a not-null test and looked purposeful; the rename stripped the camouflage and left an
apparently-pointless line sitting next to the join, one cleanup PR away from deletion.

**Remedy.** A comment naming the index, e.g. above the WHERE:

```typescript
    // Reads as redundant next to the join, but it is what lets the planner match the partial
    // `workflow_due_idx` — a join qual cannot prove that predicate.
```

Related, lower stakes: the narrowing `.filter((r): r is typeof r & { publishedVersionId: string } => r.publishedVersionId !== null)`
at `scheduler.ts:66` is now purely a type device with no runtime effect (the join guarantees
it). Fine to keep as cast-avoidance, but it is the second thing in this function that reads as
a runtime guard and isn't.

Also adjacent, not introduced here: `scanDue` awaits its `due` query and its `futureRow` query
sequentially although they are independent. `Promise.all` would be both faster and no less
readable. Optional.

---

## 4. `log.ts` reaches for raw SQL to compute a boolean the query could just select

**Boundary / type cleanliness. Medium-high conviction.**

`packages/jobs/src/workflows/engine/log.ts:55`

```typescript
      sql<boolean>`w."publishedVersionId" IS NOT NULL`.as("workflowPublished"),
```

and then in the mapper:

```typescript
    workflowPublished: row.workflowPublished === true,
```

Two things worth undoing. The hand-written SQL fragment is the only raw string in an otherwise
fully typed Kysely select, so the compiler stops checking that column name — a future rename of
`publishedVersionId` typechecks clean here and fails at runtime, which is exactly the failure
mode a migration-and-rename PR should be closing. And `=== true` is a defensive coercion for a
nullable boolean column that no longer exists; the expression above it cannot be null.

**Remedy.** Select the column and derive the flag in TypeScript:

```typescript
      "w.publishedVersionId as publishedVersionId",
      ...
    workflowPublished: row.publishedVersionId !== null,
```

Same `RunContext` shape, no raw SQL, no dead coercion, and "the pointer means published" lives
in the language where the field's doc comment already explains it.

---

## 5. Consider lifting the publish/unpublish cluster out of `BuilderHeader`

**Decomposition. Medium conviction — optional, but it is the natural home for finding 2.**

`BuilderHeader.tsx` is 300 lines and now holds: layout, inline rename (own fetcher + a
`settled` ref to defeat blur-after-Enter), the save marker, the version menu, a publish fetcher,
an issues `useEffect` that writes to the builder store, two disclosures, and two dialogs. Well
under the 1k threshold, so this is not a blocker — but the publish/unpublish block is a
self-contained unit with its own state, and extracting `PublishControls.tsx` would leave the
header reading as layout plus title.

One thing to preserve if you do: the asymmetry where **unpublish uses the canonical `Confirm`
while publish hand-rolls a `Modal`** is correct, not sloppy. Publish must post `versionId` in
the body and read `issues` back off its own fetcher to drive the node outlines, and `Confirm`
owns its form and gives the caller no response. That deserves a one-line comment, or a reader
will "unify" the two and silently break the issues panel.

---

## 6. Checked and deliberately not flagged

- `packages/database/src/datasets/tiers/11-workflows.ts` — the new `if (!workflow.published) continue;`
  sits after the version insert and before both the pointer UPDATE and the trigger rows, so a
  draft seed gets a readable version and no dispatch rows. Correct, and the comment earns its place.
- `packages/jobs/src/workflows/engine/execute.ts` — testing workflow-level publication rather
  than "is this run's version still the published one" is the documented decision (in-flight
  runs keep their version). Right call, and the const rename is faithful.
- `variant="gray"` exists in `packages/react/src/Badge.tsx`. `WorkflowsUpgradeOverlay`'s badges
  now match the real table's green/gray Published/Draft instead of outline/secondary
  Active/Inactive — a small consistency win the PR gets for free.
- `packages/workflows/src/sync.ts` — the gate collapsing from `workflow?.active && workflow.activeVersionId`
  to `workflow?.publishedVersionId` is the cleanest edit in the diff. One condition, one comment,
  and unpublish stops the workflow through the existing empty-desired-set path rather than a new branch.
- Comment audit: the new comments are sparse and answer real questions (why sync on unpublish,
  why the tier skips, why the route carries no body, what the pointer means). No narration found.
  The one comment that should go is the *code* it documents — see finding 1.

## 7. Fixed during the review

`pnpm exec biome check` reported three formatter errors on files this PR touched
(`WorkflowsTable.tsx`, `WorkflowsUpgradeOverlay.tsx`, `tiers/11-workflows.ts`). Applied
`biome check --write` on exactly those three; re-check is clean. The remaining `noConsole` /
`noEmptyBlockStatements` hits under `packages/database/src/datasets` are pre-existing warnings
in files this PR did not touch.

## Resolution

Findings 1–4 applied, plus finding 5's comment (the extraction itself deferred):

- `getWorkflowLockFlags` deleted; `checkWorkflowVersionLock` compares directly. `AGENTS.md`
  updated, since it named the helper.
- New `apps/erp/app/modules/workflows/ui/ConfirmUnpublishWorkflow.tsx` is the single copy of
  the dialog; both `WorkflowsTable` and `BuilderHeader` render it, and both now name the workflow.
- Comment added above `scanDue`'s WHERE naming `workflow_due_idx`.
- `log.ts` selects `w.publishedVersionId` and derives the boolean in TypeScript; the raw `sql`
  tag and the `=== true` are gone.
- Comment on the publish modal explaining why it is not a `Confirm`.

Re-verified after the fixes: `pnpm exec turbo run typecheck --filter=erp` clean,
`pnpm exec turbo run test typecheck --filter=@carbon/jobs` 490 tests pass,
`pnpm exec biome check` clean on both trees.

## Still outstanding on the branch (not review findings)

- `pnpm --filter @carbon/checks invariants` and `... workflow-events`
- `pnpm --filter docs build` (the MDX callout removal must still parse)
- `pnpm lingui:extract && pnpm lingui:clean`, then the other locales
- browser pass over acceptance criteria 4–8
