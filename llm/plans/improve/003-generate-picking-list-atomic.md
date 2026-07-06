# Plan 003: Make `generatePickingList` atomic and stop swallowing insert errors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `llm/plans/improve/README.md` — unless a reviewer dispatched you and told
> you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4ff79e2ed..HEAD -- apps/erp/app/modules/inventory/inventory.service.ts`
> If `generatePickingList` changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: correctness / tech-debt
- **Planned at**: commit `4ff79e2ed`, 2026-06-13

## Why this matters

`generatePickingList` (in `apps/erp/app/modules/inventory/inventory.service.ts`)
builds a picking list out of many individual Supabase writes inside a loop, with
no atomicity and silent error-swallowing:

- `if (lineInsert.error) continue;` — a failed line insert is silently dropped;
  the picking list is created **missing that line** with no signal to the user.
- The `pickingListLineTrackedEntity` insert (`:2467`) has its **error ignored
  entirely** — a line can claim a FIFO allocation that never persisted.
- The three write phases (header, lines, tracked entities) are separate
  statements. A mid-loop failure leaves a **half-built picking list** that looks
  complete.

The result is a data-integrity hazard: silently incomplete picking lists drive
incorrect shop-floor picking. Carbon convention (`llm/conventions/database.md`)
is that multi-row writes must be all-or-nothing. This plan makes generation
atomic via **batched array inserts plus a compensating delete on failure**,
which is safe to do on the existing RLS client (a full Kysely-transaction
rewrite is deliberately avoided — see "Approach" — because Kysely bypasses RLS
and would mix awkwardly with the in-loop `get_effective_work_center_id` RPC).

## Approach (read before editing)

The function already deletes the header on the "no lines" and "materials error"
paths, and `pickingListLine` / `pickingListLineTrackedEntity` both have
`ON DELETE CASCADE` from their parents (verified:
`20260601143527_picking-lists.sql:86` and `:120`). So deleting the header
cleanly removes any lines/allocations already written. We exploit that:

1. Keep header insert first (we need its id).
2. Build **all** line rows in memory, then insert them in **one** array call
   (`.insert([...]).select("id, jobMaterialId")`). One statement → atomic for
   all lines.
3. Build **all** tracked-entity rows in memory (mapping each material's
   allocations to the corresponding new line id via `jobMaterialId`), then
   insert them in **one** array call.
4. On **any** insert error in steps 2–3, delete the header (cascade cleans up)
   and return the error — no partial list survives.

This removes both the `continue`-swallowing and the ignored tracked-entity
error, and collapses N+M individual writes into 2 statements.

## Current state

`generatePickingList`, `apps/erp/app/modules/inventory/inventory.service.ts:2344-2498`.
The loop body to replace (`:2406-2479`):

```ts
  let linesCreated = 0;

  for (const mat of materials.data ?? []) {
    const quantityToIssue = Number(mat.quantityToIssue ?? 0);
    if (quantityToIssue <= 0) continue;

    // 4. Check if source storage unit is lineside — skip if lineside
    if (mat.storageUnitId) {
      const effectiveWc = await client.rpc("get_effective_work_center_id", {
        p_storage_unit_id: mat.storageUnitId
      });
      // If the storage unit resolves to a work center, it's lineside — skip
      if (effectiveWc.data) continue;
    }

    // 5. Determine source storage unit
    const sourceStorageUnitId = mat.storageUnitId ?? null;

    // Create the picking list line
    const lineInsert = await client
      .from("pickingListLine")
      .insert([
        {
          pickingListId: plId,
          jobId: mat.jobId,
          jobMaterialId: mat.id,
          jobOperationId: mat.jobOperationId,
          itemId: mat.itemId,
          quantityToPick: quantityToIssue,
          storageUnitId: sourceStorageUnitId,
          companyId: args.companyId,
          createdBy: args.createdBy
        }
      ])
      .select("id")
      .single();

    if (lineInsert.error) continue;

    linesCreated++;

    // 6. For batch/serial tracked items, allocate tracked entities (FIFO)
    if (mat.requiresBatchTracking || mat.requiresSerialTracking) {
      const trackedEntities = await client
        .from("trackedEntity")
        .select("id, quantity")
        .eq("sourceDocument", "Item")
        .eq("sourceDocumentId", mat.itemId)
        .eq("companyId", args.companyId)
        .gt("quantity", 0)
        .in("status", ["Available"])
        .order("createdAt", { ascending: true });

      if (!trackedEntities.error && trackedEntities.data) {
        let remaining = quantityToIssue;
        for (const te of trackedEntities.data) {
          if (remaining <= 0) break;
          const teQty = Number(te.quantity ?? 0);
          const allocateQty = Math.min(remaining, teQty);
          if (allocateQty <= 0) continue;

          await client.from("pickingListLineTrackedEntity").insert([
            {
              pickingListLineId: lineInsert.data.id,
              trackedEntityId: te.id,
              quantity: allocateQty
            }
          ]);

          remaining -= allocateQty;
        }
      }
    }
  }

  // 7. If no lines created, delete the empty picking list and return error
  if (linesCreated === 0) {
    await client.from("pickingList").delete().eq("id", plId);
    return {
      data: null,
      error: "No materials require picking for the selected operations"
    };
  }
```

Note: `jobMaterialId` is unique per generated line (one line per material), so it
is a safe key to map a material's tracked allocations back to its inserted line
id. `pickingListLine.id` defaults to `xid()` server-side, so we must read it back
from the insert's `.select(...)`.

### Conventions (quoted inline)

From `llm/conventions/services.md` / `database.md`: service functions return
`{ data, error }` (don't throw); **multi-row writes should be atomic** — "Supabase
`Promise.all` can leave data half-applied." Supabase array `.insert([...])` is a
single statement and is atomic across its rows. The function runs on the
RLS-enforced `client` passed from the route (`new.tsx` action calls
`requirePermissions(request, { create: "inventory" })`), so tenant scoping and
permission are already enforced upstream — do NOT switch to a service-role or
Kysely client.

## Commands you will need

| Purpose     | Command                              | Expected on success    |
|-------------|--------------------------------------|------------------------|
| Install     | `pnpm install`                       | exit 0                 |
| Typecheck   | `turbo run typecheck --filter=erp`   | exit 0, no errors      |
| Lint        | `pnpm exec biome lint apps/erp/app/modules/inventory/inventory.service.ts` | no diagnostics |

NEVER run a whole-repo typecheck (OOMs). NEVER run any DB command. If
`--filter=erp` reports "no package found", read `apps/erp/package.json` and use
its `name`.

## Scope

**In scope**:
- `apps/erp/app/modules/inventory/inventory.service.ts` — **only** the body of
  `generatePickingList` (roughly `:2406-2488`). Do not alter its signature or
  return shape.

**Out of scope** (do NOT touch):
- The header insert (`:2370-2390`) and the `materials` fetch (`:2392-2404`) —
  keep them as-is (header still first; materials error path unchanged).
- The `get_effective_work_center_id` RPC call — keep the per-material lineside
  check exactly as-is (batching it is a separate plan, 004; do NOT do it here).
- Any other function in the file. Generated types. The database.

## Git workflow

- Branch: `improve/003-generate-picking-list-atomic`.
- Conventional commit: `fix: make generatePickingList atomic and surface insert errors`.
- Do NOT push/merge unless instructed.

## Steps

### Step 1: Accumulate line rows instead of inserting per-iteration

Replace the loop so that, instead of inserting each line and its allocations
immediately, it **collects** the line rows to insert and remembers each
material's FIFO allocations keyed by `jobMaterialId`. Keep the
`quantityToIssue <= 0` skip and the lineside `get_effective_work_center_id` skip
unchanged. Target shape:

```ts
  // Collect line rows and per-material tracked-entity allocations first, then
  // write them in atomic batch inserts (compensating-delete the header on any
  // failure — pickingListLine/…TrackedEntity cascade on header delete).
  const lineRows: Array<{
    pickingListId: string;
    jobId: string;
    jobMaterialId: string;
    jobOperationId: string | null;
    itemId: string;
    quantityToPick: number;
    storageUnitId: string | null;
    companyId: string;
    createdBy: string;
  }> = [];
  // jobMaterialId -> [{ trackedEntityId, quantity }]
  const allocationsByMaterial = new Map<
    string,
    Array<{ trackedEntityId: string; quantity: number }>
  >();

  for (const mat of materials.data ?? []) {
    const quantityToIssue = Number(mat.quantityToIssue ?? 0);
    if (quantityToIssue <= 0) continue;

    if (mat.storageUnitId) {
      const effectiveWc = await client.rpc("get_effective_work_center_id", {
        p_storage_unit_id: mat.storageUnitId
      });
      if (effectiveWc.data) continue; // lineside → skip
    }

    lineRows.push({
      pickingListId: plId,
      jobId: mat.jobId,
      jobMaterialId: mat.id,
      jobOperationId: mat.jobOperationId,
      itemId: mat.itemId,
      quantityToPick: quantityToIssue,
      storageUnitId: mat.storageUnitId ?? null,
      companyId: args.companyId,
      createdBy: args.createdBy
    });

    if (mat.requiresBatchTracking || mat.requiresSerialTracking) {
      const trackedEntities = await client
        .from("trackedEntity")
        .select("id, quantity")
        .eq("sourceDocument", "Item")
        .eq("sourceDocumentId", mat.itemId)
        .eq("companyId", args.companyId)
        .gt("quantity", 0)
        .in("status", ["Available"])
        .order("createdAt", { ascending: true });

      if (!trackedEntities.error && trackedEntities.data) {
        let remaining = quantityToIssue;
        const allocations: Array<{ trackedEntityId: string; quantity: number }> = [];
        for (const te of trackedEntities.data) {
          if (remaining <= 0) break;
          const teQty = Number(te.quantity ?? 0);
          const allocateQty = Math.min(remaining, teQty);
          if (allocateQty <= 0) continue;
          allocations.push({ trackedEntityId: te.id, quantity: allocateQty });
          remaining -= allocateQty;
        }
        if (allocations.length > 0) {
          allocationsByMaterial.set(mat.id, allocations);
        }
      }
    }
  }
```

**Verify**: `turbo run typecheck --filter=erp` → exit 0 (the function still
returns nothing new yet; the old insert/return code below is replaced in Step
2). If you have not yet removed the old `linesCreated === 0` block this may
error on undefined `linesCreated` — proceed to Step 2 before re-verifying.

### Step 2: Batch-insert lines, then allocations, with compensating rollback

After the loop, replace the old `if (linesCreated === 0) { ... }` block (and the
now-removed per-iteration inserts) with:

```ts
  // No lines to pick → remove the empty header and report.
  if (lineRows.length === 0) {
    await client.from("pickingList").delete().eq("id", plId);
    return {
      data: null,
      error: "No materials require picking for the selected operations"
    };
  }

  // Atomic batch insert of all lines; read back ids to map allocations.
  const linesInsert = await client
    .from("pickingListLine")
    .insert(lineRows)
    .select("id, jobMaterialId");

  if (linesInsert.error || !linesInsert.data) {
    await client.from("pickingList").delete().eq("id", plId); // cascade cleanup
    return { data: null, error: linesInsert.error ?? "Failed to create lines" };
  }

  // Build tracked-entity rows using the returned line ids.
  const lineIdByMaterial = new Map(
    linesInsert.data.map((l) => [l.jobMaterialId, l.id])
  );
  const trackedRows: Array<{
    pickingListLineId: string;
    trackedEntityId: string;
    quantity: number;
  }> = [];
  for (const [jobMaterialId, allocations] of allocationsByMaterial) {
    const lineId = lineIdByMaterial.get(jobMaterialId);
    if (!lineId) continue;
    for (const a of allocations) {
      trackedRows.push({
        pickingListLineId: lineId,
        trackedEntityId: a.trackedEntityId,
        quantity: a.quantity
      });
    }
  }

  if (trackedRows.length > 0) {
    const trackedInsert = await client
      .from("pickingListLineTrackedEntity")
      .insert(trackedRows);
    if (trackedInsert.error) {
      await client.from("pickingList").delete().eq("id", plId); // cascade cleanup
      return { data: null, error: trackedInsert.error };
    }
  }

  return {
    data: {
      id: plId,
      pickingListId
    },
    error: null
  };
```

Ensure the old `return { data: { id: plId, pickingListId }, error: null }` at the
very end of the original function is removed (this block replaces it) so the
function has a single success return.

**Verify**: `turbo run typecheck --filter=erp` → exit 0, no errors. Confirm
there is no remaining reference to `linesCreated` or `lineInsert`
(`grep -n "linesCreated\|lineInsert" apps/erp/app/modules/inventory/inventory.service.ts`
→ no matches inside `generatePickingList`).

### Step 3: Lint

**Verify**: `pnpm exec biome lint apps/erp/app/modules/inventory/inventory.service.ts`
→ no diagnostics.

## Test plan

`apps/erp` has no real vitest suite (per `llm/tasks/lessons.md`), and
`generatePickingList` is tightly coupled to the Supabase client and RPCs;
unit-testing it here would mean mocking the whole client — disproportionate.
**No new automated tests.** Verification is typecheck + lint + the operator's
manual check below.

Manual verification (operator, against local dev server — executor does not run
this): generate a picking list from job operations that include (a) normal
materials, (b) a lineside material (should be skipped), and (c) a
batch/serial-tracked material with available tracked entities. Confirm the list
is created with exactly the expected lines and the tracked line has its FIFO
allocations. Then confirm that generating with only lineside/zero-quantity
materials returns the "No materials require picking…" error and leaves **no**
orphan `pickingList` row.

## Done criteria

ALL must hold:

- [ ] `turbo run typecheck --filter=erp` exits 0
- [ ] `pnpm exec biome lint apps/erp/app/modules/inventory/inventory.service.ts`
      reports no diagnostics
- [ ] `generatePickingList` performs at most ONE `pickingListLine` insert and at
      most ONE `pickingListLineTrackedEntity` insert (array inserts), and deletes
      the header on any insert error
- [ ] No `if (lineInsert.error) continue;` and no ignored
      `pickingListLineTrackedEntity` insert error remain
      (`grep -n "continue" ` within the function shows only the
      `quantityToIssue <= 0` and lineside skips)
- [ ] The function signature and `{ data: { id, pickingListId }, error }` return
      shape are unchanged
- [ ] No files outside `inventory.service.ts` modified (`git status`)
- [ ] `llm/plans/improve/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows `generatePickingList` differs from the "Current state"
  excerpt.
- `pickingListLine` does **not** have `ON DELETE CASCADE` from `pickingList`, or
  `pickingListLineTrackedEntity` does not cascade from `pickingListLine`
  (re-check `20260601143527_picking-lists.sql:86` and `:120`). The
  compensating-delete rollback depends on both cascades; if either is absent,
  STOP.
- The Supabase array `.insert([...]).select("id, jobMaterialId")` does not
  type-check (e.g. the generated row type requires fields not supplied) — STOP
  and report the type error rather than casting with `as any`.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- A reviewer should scrutinize the `jobMaterialId → lineId` mapping: it assumes
  one line per `jobMaterialId` in a single generation, which holds because the
  loop pushes at most one line per material. If a future change emits multiple
  lines per material, the map must become `jobMaterialId → lineId[]`.
- The lineside `get_effective_work_center_id` RPC is still called once per
  material (N+1). That is intentionally left for plan 004 to avoid coupling two
  changes; note it here so the reviewer doesn't expect it fixed.
- The "atomic" guarantee here is batch-insert + compensating delete, not a true
  DB transaction. If stronger guarantees are ever needed, the principled move is
  a single Postgres function (`generate_picking_list(...)`) doing it all in one
  transaction server-side; that is a larger, separate effort.
- After commit, consider noting the generation flow in the `inventory-system`
  cache doc. Do NOT update `llm/cache/` as part of this plan.
