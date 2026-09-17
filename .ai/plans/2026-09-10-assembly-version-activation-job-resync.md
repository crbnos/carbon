# Assembly version activation — keep MES playback working on live jobs

**Spec / source:** `.ai/specs/2026-09-10-assembly-version-activation-job-resync.md`
**Branch:** `fix/mes-animations-in-assembly-view`

## Background for the executor

Activating a new assembly-instruction version repoints
`jobOperation.assemblyInstructionId` (v1 → v2) but never migrates
`jobOperationStep.assemblyInstructionStepId`. Each version's steps get **new
ids**, so job step markers still hold v1 ids. MES matches the animation frame by
exact id (`AssemblyView.tsx:1087`), gets `-1`, and falls back to a static model
slide on every step — the reported "animations are broken".

This plan: persist step lineage (`rootStepId`), remap markers on activation,
let re-sync reclaim orphaned steps, and backfill already-broken jobs.

## Progress
- [x] Task 1: Add `rootStepId` column + backfill migration
- [x] Task 2: Persist `rootStepId` in `copyAssemblyInstructionAsVersion`
- [x] Task 3: Add `planAssemblyStepMarkerRemap` pure helper + unit tests
- [x] Task 4: Let re-sync reclaim orphaned (null-marker) steps + unit tests
- [x] Task 5: Remap markers and re-sync in `activateAssemblyInstructionVersion`
- [x] Task 6: Typecheck, lint, and end-to-end verification

## Dependencies

- Task 2 needs Task 1 (column must exist before types regen).
- Task 3 is independent of Tasks 1–2 (pure function + tests) but its consumer is Task 5.
- Task 4 is independent of Tasks 1–3.
- Task 5 needs Tasks 1, 2, 3, 4.
- Task 6 needs all previous tasks.
- **Tasks 3 and 4 may run in parallel** once Task 1 is applied.

---

## Task 1: Add `rootStepId` column + backfill migration

**Depends on:** none

**Files:**
- Create: `packages/database/supabase/migrations/{generated}_assembly-step-lineage.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260720025847_assembly-bop-sync.sql`

**Steps:**

1. Create the migration file:
   ```bash
   pnpm db:migrate:new assembly-step-lineage
   ```
   This prints the created path. **Do not** hand-write the timestamp; never use
   `000000` for HHMMSS (per `packages/database/AGENTS.md`).

2. Write exactly this SQL into the created file:

```sql
-- Assembly step lineage: links a step to the step it was copied from when a new
-- instruction version is created. Mirrors the instruction-level
-- "rootInstructionId" idiom — NULL means "I am the root", so a step's lineage
-- group is COALESCE("rootStepId", "id") (same shape as
-- 20260730153412_assembly-instructions-view.sql).
--
-- ON DELETE SET NULL: deleting an OLD version must never delete the CURRENT
-- version's steps; an orphaned step simply becomes its own root.

ALTER TABLE "assemblyInstructionStep"
  ADD COLUMN IF NOT EXISTS "rootStepId" TEXT
    REFERENCES "assemblyInstructionStep"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "assemblyInstructionStep_rootStepId_idx"
  ON "assemblyInstructionStep" ("rootStepId");

-- Backfill: repair job step markers stranded on a NON-CURRENT instruction
-- version by an activation that repointed the operation but not its steps.
-- rootStepId cannot exist retroactively, so match within the version group by
-- title first, then by sortOrder. Idempotent: the WHERE clause only selects
-- markers that disagree with their operation's instruction, so a second run
-- matches nothing.
WITH stranded AS (
  SELECT
    s."id"           AS "jobStepId",
    s."companyId"    AS "companyId",
    jo."assemblyInstructionId" AS "currentInstructionId",
    old."title"      AS "title",
    old."sortOrder"  AS "sortOrder"
  FROM "jobOperationStep" s
  JOIN "assemblyInstructionStep" old
    ON old."id" = s."assemblyInstructionStepId"
  JOIN "jobOperation" jo
    ON jo."id" = s."operationId"
  WHERE jo."assemblyInstructionId" IS NOT NULL
    AND old."assemblyInstructionId" <> jo."assemblyInstructionId"
),
matched AS (
  SELECT
    st."jobStepId",
    (
      SELECT nw."id"
      FROM "assemblyInstructionStep" nw
      WHERE nw."assemblyInstructionId" = st."currentInstructionId"
        AND nw."companyId" = st."companyId"
      ORDER BY
        (nw."title" IS NOT DISTINCT FROM st."title") DESC,
        (nw."sortOrder" IS NOT DISTINCT FROM st."sortOrder") DESC,
        nw."sortOrder" ASC
      LIMIT 1
    ) AS "newStepId"
  FROM stranded st
)
UPDATE "jobOperationStep" s
SET "assemblyInstructionStepId" = m."newStepId"
FROM matched m
WHERE s."id" = m."jobStepId"
  AND m."newStepId" IS NOT NULL;
```

3. Apply it (this also regenerates `packages/database/src/types.ts`):
   ```bash
   pnpm db:migrate
   ```

**Verify:**
```bash
docker exec -e PGPASSWORD="$(grep '^SUPABASE_DB_URL' .env.local | sed -E 's|.*://postgres:([^@]*)@.*|\1|')" \
  carbon-carbon-fix-mes-animations-in-assembly-view-postgres-1 \
  psql -U postgres -d postgres -c \
  'select column_name from information_schema.columns where table_name = '"'"'assemblyInstructionStep'"'"' and column_name = '"'"'rootStepId'"'"';'
# Expected: one row, "rootStepId"

grep -c 'rootStepId' packages/database/src/types.ts
# Expected: a number >= 1 (types regenerated by pnpm db:migrate)
```

Then confirm the backfill repaired the known-broken operation:
```bash
docker exec -e PGPASSWORD="$(grep '^SUPABASE_DB_URL' .env.local | sed -E 's|.*://postgres:([^@]*)@.*|\1|')" \
  carbon-carbon-fix-mes-animations-in-assembly-view-postgres-1 \
  psql -U postgres -d postgres -c \
  'select count(*) as still_stranded from "jobOperationStep" s join "assemblyInstructionStep" ais on ais.id = s."assemblyInstructionStepId" join "jobOperation" jo on jo.id = s."operationId" where jo."assemblyInstructionId" is not null and ais."assemblyInstructionId" <> jo."assemblyInstructionId";'
# Expected: still_stranded = 0
```

**Out of scope:** Do NOT change the `ON DELETE SET NULL` on the existing
`assemblyInstructionStepId` FK (`20260720025847_assembly-bop-sync.sql:18`) — the
spec keeps that semantics deliberately. Do NOT add RLS policies (no new table).
Do NOT backfill `NULL` markers (explicitly out of scope per spec §4).

**If** `pnpm db:migrate` fails because the local DB is unreachable, STOP and
report — do not hand-apply SQL to work around it.

---

## Task 2: Persist `rootStepId` in `copyAssemblyInstructionAsVersion`

**Depends on:** Task 1

**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — set `rootStepId` on copied steps

**Steps:**

1. In `copyAssemblyInstructionAsVersion` (starts line ~6358), find the step-copy
   block that currently reads:

```ts
    const stepRows = sourceSteps.data.map((step) => {
      // Strip identity/audit columns; keep every authored field verbatim.
      // biome-ignore lint/correctness/noUnusedVariables: destructure omits identity/audit columns before re-insert
      const { id, createdAt, updatedAt, updatedBy, ...rest } = step;
      return {
        ...rest,
        id: stepIdMap.get(step.id)!,
        assemblyInstructionId: newInstructionId,
        parentStepId: step.parentStepId
          ? (stepIdMap.get(step.parentStepId) ?? null)
          : null,
        companyId,
        createdBy: userId
      };
    });
```

2. Add `rootStepId` to the returned object, immediately after the
   `parentStepId` property:

```ts
        // Lineage across versions: a step copied from v1 roots at v1's step, and
        // a v3 copied from v2 still roots at v1 — the chain stays flat so
        // COALESCE("rootStepId", "id") identifies the group at any depth.
        rootStepId: step.rootStepId ?? step.id,
```

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: no errors (exit 0). rootStepId must be a known column — if TS says it
# is not, Task 1's type regen did not run.
```

**Out of scope:** Do NOT change how `parentStepId` is remapped, the version
numbering, or the `status: "Draft"` of the new version.

**If** `step.rootStepId` is a TypeScript error, STOP and report — it means
Task 1's `pnpm db:migrate` did not regenerate types.

---

## Task 3: Add `planAssemblyStepMarkerRemap` pure helper + unit tests

**Depends on:** none (may run in parallel with Task 4)

**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — add exported pure function
- Modify: `apps/erp/app/modules/production/production.service.test.ts` — add tests
- Copy from (precedent): `planAssemblyStepMarkerSync` (`production.service.ts:8022`) and its tests (`production.service.test.ts:38`)

**Steps:**

1. Add this exported pure function directly **above**
   `planAssemblyStepMarkerSync` (line ~8022), matching that function's
   doc-comment style:

```ts
/**
 * Maps a job step's marker from an OLD instruction version's step id to the
 * equivalent step id in the NEWLY-ACTIVATED version, by lineage group
 * (COALESCE(rootStepId, id) — the same idiom as rootInstructionId).
 *
 * A step that survives across versions keeps its identity even when reordered
 * or retitled, so the caller can UPDATE it in place and preserve the operator's
 * completion records. Steps with no counterpart in the new version are left
 * unmapped — the caller's re-sync then treats them as stale. Pure so the
 * remapping is unit-testable.
 */
export function planAssemblyStepMarkerRemap(
  oldSteps: { id: string; rootStepId: string | null }[],
  newSteps: { id: string; rootStepId: string | null }[]
): Map<string, string> {
  const newIdByRoot = new Map<string, string>();
  for (const step of newSteps) {
    const root = step.rootStepId ?? step.id;
    // First writer wins: a well-formed version has one step per lineage group.
    if (!newIdByRoot.has(root)) newIdByRoot.set(root, step.id);
  }

  const remap = new Map<string, string>();
  for (const step of oldSteps) {
    const root = step.rootStepId ?? step.id;
    const newId = newIdByRoot.get(root);
    if (newId && newId !== step.id) remap.set(step.id, newId);
  }
  return remap;
}
```

2. Export it from the module barrel if `planAssemblyStepMarkerSync` is exported
   there. Check first:
   ```bash
   grep -n "planAssemblyStepMarkerSync" apps/erp/app/modules/production/index.ts
   ```
   If it appears, add `planAssemblyStepMarkerRemap` alongside it in the same
   style. If it does not appear, skip this step (the function is imported
   directly from the service file by the test).

3. Add tests to `production.service.test.ts`. Import
   `planAssemblyStepMarkerRemap` alongside the existing
   `planAssemblyStepMarkerSync` import (line ~31), then add this `describe`
   block immediately after the existing `planAssemblyStepMarkerSync` block
   (which ends around line 71):

```ts
describe("planAssemblyStepMarkerRemap", () => {
  it("maps a v1 step id to the v2 step copied from it", () => {
    const remap = planAssemblyStepMarkerRemap(
      [{ id: "v1a", rootStepId: null }],
      [{ id: "v2a", rootStepId: "v1a" }]
    );
    expect(remap.get("v1a")).toBe("v2a");
  });

  it("maps across three versions via the flat root chain", () => {
    // v3 copied from v2 still roots at v1.
    const remap = planAssemblyStepMarkerRemap(
      [{ id: "v2a", rootStepId: "v1a" }],
      [{ id: "v3a", rootStepId: "v1a" }]
    );
    expect(remap.get("v2a")).toBe("v3a");
  });

  it("maps regardless of reordering", () => {
    const remap = planAssemblyStepMarkerRemap(
      [
        { id: "v1a", rootStepId: null },
        { id: "v1b", rootStepId: null }
      ],
      [
        { id: "v2b", rootStepId: "v1b" },
        { id: "v2a", rootStepId: "v1a" }
      ]
    );
    expect(remap.get("v1a")).toBe("v2a");
    expect(remap.get("v1b")).toBe("v2b");
  });

  it("leaves a deleted step unmapped", () => {
    const remap = planAssemblyStepMarkerRemap(
      [
        { id: "v1a", rootStepId: null },
        { id: "v1gone", rootStepId: null }
      ],
      [{ id: "v2a", rootStepId: "v1a" }]
    );
    expect(remap.get("v1a")).toBe("v2a");
    expect(remap.has("v1gone")).toBe(false);
  });

  it("ignores a step added in the new version", () => {
    const remap = planAssemblyStepMarkerRemap(
      [{ id: "v1a", rootStepId: null }],
      [
        { id: "v2a", rootStepId: "v1a" },
        { id: "v2new", rootStepId: null }
      ]
    );
    expect(remap.size).toBe(1);
  });

  it("does not map a step to itself", () => {
    const remap = planAssemblyStepMarkerRemap(
      [{ id: "same", rootStepId: null }],
      [{ id: "same", rootStepId: null }]
    );
    expect(remap.size).toBe(0);
  });
});
```

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/production/production.service.test.ts -t "planAssemblyStepMarkerRemap"
# Expected: 6 passed, 0 failed
```

**Out of scope:** Do NOT modify `planAssemblyStepMarkerSync` or its existing
tests in this task (Task 4 handles the sync change).

---

## Task 4: Let re-sync reclaim orphaned (null-marker) steps

**Depends on:** none (may run in parallel with Task 3)

**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — `syncAssemblyInstructionToOperation` (line ~8088)
- Modify: `apps/erp/app/modules/production/production.service.test.ts` — add tests

**Context:** the query at line ~8215 currently loads only marked steps:

```ts
    const existingSynced = await trx
      .selectFrom(stepTable)
      .select(["id", "assemblyInstructionStepId"])
      .where("operationId", "=", operationId)
      .where("companyId", "=", companyId)
      .where("assemblyInstructionStepId", "is not", null)
      .execute();
```

Steps orphaned by the `ON DELETE SET NULL` cascade have a NULL marker, look
"hand-authored", and are never reclaimed — so a re-sync inserts duplicates
beside them (observed: 10 broken + 10 new = 20 steps).

**Steps:**

1. Add this exported pure helper directly **above**
   `planAssemblyStepMarkerSync`:

```ts
/**
 * Re-adopts job steps orphaned by the assemblyInstructionStepId ON DELETE SET
 * NULL cascade (deleting an instruction step nulls the marker on every live
 * job synced from it). Without this a re-sync treats them as hand-authored and
 * inserts duplicates beside them.
 *
 * Deliberately conservative: an orphan is claimed only when it matches a source
 * step on BOTH sortOrder and name AND no already-marked step claims that source
 * step. Genuinely hand-authored steps match no source step and are untouched;
 * ambiguous cases are left alone rather than guessed at.
 */
export function planOrphanStepAdoption(
  sourceSteps: { id: string; title: string | null; sortOrder: number | null }[],
  orphanSteps: { id: string; name: string | null; sortOrder: number | null }[],
  claimedSourceIds: Set<string>
): Map<string, string> {
  const adoption = new Map<string, string>();
  const takenOrphans = new Set<string>();

  for (const source of sourceSteps) {
    if (claimedSourceIds.has(source.id)) continue;
    const match = orphanSteps.find(
      (orphan) =>
        !takenOrphans.has(orphan.id) &&
        orphan.sortOrder === source.sortOrder &&
        orphan.name === source.title
    );
    if (match) {
      adoption.set(match.id, source.id);
      takenOrphans.add(match.id);
    }
  }
  return adoption;
}
```

2. In `syncAssemblyInstructionToOperation`, replace the `existingSynced` query
   above with a version that also loads orphans, then adopts them **before**
   `planAssemblyStepMarkerSync` runs:

```ts
    const existingSteps = await trx
      .selectFrom(stepTable)
      .select(["id", "assemblyInstructionStepId", "name", "sortOrder"])
      .where("operationId", "=", operationId)
      .where("companyId", "=", companyId)
      .execute();

    const existingSynced = existingSteps.filter(
      (step) => step.assemblyInstructionStepId !== null
    );

    // Re-adopt steps orphaned by the ON DELETE SET NULL cascade so a re-sync
    // heals them instead of inserting duplicates beside them.
    const adoption = planOrphanStepAdoption(
      sourceSteps.map((step) => ({
        id: step.id,
        title: step.title,
        sortOrder: step.sortOrder
      })),
      existingSteps
        .filter((step) => step.assemblyInstructionStepId === null)
        .map((step) => ({
          id: step.id,
          name: step.name,
          sortOrder: step.sortOrder
        })),
      new Set(
        existingSynced
          .map((step) => step.assemblyInstructionStepId)
          .filter((id): id is string => id !== null)
      )
    );

    for (const [orphanId, sourceStepId] of adoption) {
      await trx
        .updateTable(stepTable)
        .set({ assemblyInstructionStepId: sourceStepId })
        .where("id", "=", orphanId)
        .where("companyId", "=", companyId)
        .execute();
      existingSynced.push({
        id: orphanId,
        assemblyInstructionStepId: sourceStepId,
        name: null,
        sortOrder: null
      });
    }
```

   Keep the immediately-following `planAssemblyStepMarkerSync(...)` call
   unchanged — it now receives the adopted steps in `existingSynced`.

3. Add tests to `production.service.test.ts`, after the
   `planAssemblyStepMarkerRemap` block:

```ts
describe("planOrphanStepAdoption", () => {
  it("adopts an orphan matching a source step on sortOrder and name", () => {
    const adoption = planOrphanStepAdoption(
      [{ id: "src1", title: "Fit cover", sortOrder: 1 }],
      [{ id: "orphan1", name: "Fit cover", sortOrder: 1 }],
      new Set()
    );
    expect(adoption.get("orphan1")).toBe("src1");
  });

  it("ignores an orphan whose name differs", () => {
    const adoption = planOrphanStepAdoption(
      [{ id: "src1", title: "Fit cover", sortOrder: 1 }],
      [{ id: "handmade", name: "Operator note", sortOrder: 1 }],
      new Set()
    );
    expect(adoption.size).toBe(0);
  });

  it("does not claim a source step an existing marked step already owns", () => {
    const adoption = planOrphanStepAdoption(
      [{ id: "src1", title: "Fit cover", sortOrder: 1 }],
      [{ id: "orphan1", name: "Fit cover", sortOrder: 1 }],
      new Set(["src1"])
    );
    expect(adoption.size).toBe(0);
  });

  it("adopts each orphan at most once", () => {
    const adoption = planOrphanStepAdoption(
      [
        { id: "src1", title: "Same", sortOrder: 1 },
        { id: "src2", title: "Same", sortOrder: 1 }
      ],
      [{ id: "orphan1", name: "Same", sortOrder: 1 }],
      new Set()
    );
    expect(adoption.size).toBe(1);
  });
});
```

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/production/production.service.test.ts
# Expected: all tests pass, including the pre-existing planAssemblyStepMarkerSync,
# maxToolQuantityByItem, buildAssemblyToolStepLinks and duplicateJobOperationStep suites
```

**Out of scope:** Do NOT change `planAssemblyStepMarkerSync`'s own logic, the
stale-step deletion, or the material/tool link rebuild.

---

## Task 5: Remap markers and re-sync in `activateAssemblyInstructionVersion`

**Depends on:** Tasks 1, 2, 3, 4

**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — `activateAssemblyInstructionVersion` (line ~6488)

**Context:** the function currently ends its repoint block like this (line ~6563):

```ts
    const staleOpIds = (staleOps.data ?? []).map((o) => o.id);
    if (staleOpIds.length > 0) {
      const repoint = await client
        .from("jobOperation")
        .update({ assemblyInstructionId: id })
        .in("id", staleOpIds);
      if (repoint.error) return repoint;
    }
  }

  return publish;
}
```

**Steps:**

1. Immediately **after** the `repoint` block and before the closing `}` of the
   `if (otherVersionIds.length > 0)` block, add the marker remap. Load both
   versions' steps once (bounded by the sibling-version set, not by job count —
   preserving the existing 1000-row-cap reasoning documented at line ~6548):

```ts
      // Migrate step markers v(old) -> v(new) by lineage group before syncing.
      // Without this the job's steps still point at the old version's step ids,
      // MES cannot match them (AssemblyView findIndex -> -1), and playback
      // silently degrades to a static model on every step.
      const [oldStepRows, newStepRows] = await Promise.all([
        client
          .from("assemblyInstructionStep")
          .select("id, rootStepId")
          .in("assemblyInstructionId", otherVersionIds)
          .eq("companyId", companyId),
        client
          .from("assemblyInstructionStep")
          .select("id, rootStepId")
          .eq("assemblyInstructionId", id)
          .eq("companyId", companyId)
      ]);
      if (oldStepRows.error) return oldStepRows;
      if (newStepRows.error) return newStepRows;

      const remap = planAssemblyStepMarkerRemap(
        oldStepRows.data ?? [],
        newStepRows.data ?? []
      );

      for (const [oldStepId, newStepId] of remap) {
        const remapped = await client
          .from("jobOperationStep")
          .update({ assemblyInstructionStepId: newStepId })
          .eq("assemblyInstructionStepId", oldStepId)
          .eq("companyId", companyId)
          .in("operationId", staleOpIds);
        if (remapped.error) return remapped;
      }
```

2. After the remap loop (still inside the same block), re-sync each repointed
   operation so added steps appear and deleted steps are removed. One failure
   must not abort activation or leave other operations half-migrated:

```ts
      // Re-sync each repointed operation: marker-matched steps UPDATE in place
      // (so jobOperationStepRecord survives), steps added in the new version
      // INSERT, and steps deleted in it are removed. Isolated per operation so
      // one failure cannot abort the activation.
      for (const operationId of staleOpIds) {
        try {
          await syncAssemblyInstructionToOperation(getDatabaseClient(), {
            assemblyInstructionId: id,
            operationId,
            companyId,
            userId
          });
        } catch {
          // The marker remap above already restored playback for surviving
          // steps; a failed re-sync only leaves added/deleted steps unreconciled
          // on this one operation, and the user can re-sync it from the job.
        }
      }
```

3. **CORRECTED (escape hatch triggered during execution).** Do NOT import
   `getDatabaseClient` into `production.service.ts`. That is forbidden by
   `AGENTS.md:33` and enforced by the `no-db-client-in-service` conformance
   check (`@carbon/checks`): this service file is re-exported through the module
   barrel that client components import, so it is bundled for the browser and
   must not pull in `pg`/`kysely`. See the comment at
   `production.service.ts:991`.

   Instead follow the established pattern — the route action builds the client
   and passes it in:

   a. Add a `db: Kysely<KyselyDatabase>` parameter to
      `activateAssemblyInstructionVersion`'s args object (both types are already
      imported at the top of the service file).

   b. In the re-sync loop, call
      `syncAssemblyInstructionToOperation(db, { ... })` using that parameter.

   c. Update the only caller,
      `apps/erp/app/routes/x+/assembly+/$id.activate.tsx`, to pass
      `db: getDatabaseClient()`, importing it the same way
      `apps/erp/app/routes/x+/assembly+/$id.sync-bop.tsx` does.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: no errors (exit 0)

pnpm --filter erp exec vitest run app/modules/production/production.service.test.ts
# Expected: all tests pass
```

**Out of scope:** Do NOT change the `staleOps` query's filters — it already
excludes `Done`/`Canceled` operations and locked jobs, and its bounded shape is
deliberate. Do NOT change the archive/publish ordering above it.

**If** `syncAssemblyInstructionToOperation` cannot be called with
`getDatabaseClient()` from this file (e.g. an import cycle), STOP and report —
do not duplicate the sync logic inline.

---

## Task 6: Typecheck, lint, and end-to-end verification

**Depends on:** Tasks 1–5

**Files:** none (verification only)

**Steps:**

1. Run the scoped typechecks and lint:

```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/database
pnpm run lint
```

2. Reset the local test fixture to a known-good synced state, then verify the
   activation path end to end in the UI. Current fixture (from the diagnosis):
   instruction v1 `dah6hsp0o0gg43i9reg0` (Archived), v2 `dah77qp0o0ghngq9reug`
   (Published), operation `jo_WrkvKZyRGCq3D79aBAWvjj` on job `J000009`.

   a. In the ERP, open the job's Bill of Process → the Assembly operation →
      **Sync Assembly Steps**. Confirm the step count does **not** double
      (acceptance criterion 6).

   b. Open MES at `/x/assembly/jo_WrkvKZyRGCq3D79aBAWvjj`. Confirm the `▶ 3D`
      playback slot and the transport bar are present and stepping advances the
      animation (acceptance criterion 1).

   c. In MES, mark one middle step done. Note which step.

   d. In the ERP, create a new version of the instruction, **reorder** steps and
      **delete** one (not the one marked done), then activate it.

   e. Reload MES. Confirm: playback still works (criterion 1); the step marked
      done in (c) is still marked done (criterion 2); the deleted step is gone
      (criterion 3); any added step appears in `sortOrder` position (criterion 4).

3. Confirm no operation is left stranded:

```bash
docker exec -e PGPASSWORD="$(grep '^SUPABASE_DB_URL' .env.local | sed -E 's|.*://postgres:([^@]*)@.*|\1|')" \
  carbon-carbon-fix-mes-animations-in-assembly-view-postgres-1 \
  psql -U postgres -d postgres -c \
  'select count(*) as stranded from "jobOperationStep" s join "assemblyInstructionStep" ais on ais.id = s."assemblyInstructionStepId" join "jobOperation" jo on jo.id = s."operationId" where jo."assemblyInstructionId" is not null and ais."assemblyInstructionId" <> jo."assemblyInstructionId";'
# Expected: stranded = 0
```

**Verify:** all commands above exit 0, and steps 2(a)–2(e) match the stated
expectations.

**Out of scope:** Do NOT commit. The user's standing rule is that nothing is
committed without explicit permission — report completion and wait.

**If** any acceptance criterion fails, STOP and report which one with the
observed behaviour — do not patch around it.
