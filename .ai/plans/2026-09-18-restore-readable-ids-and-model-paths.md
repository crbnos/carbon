# Cross-company restore fixes — implementation plan

**Spec / source:** `.ai/specs/2026-09-18-restore-readable-ids-and-model-paths.md`
**Branch:** `feat/supabase-bucket-migration` (user's explicit choice)
**Do NOT commit** — the user must grant permission for each commit.

## Progress
- [x] Task 1: Add `READABLE_ID_TABLES` and extend `STORAGE_PATH_COLUMNS`
- [x] Task 2: Skip readable-id tables in `buildIdMaps`
- [x] Task 3: Add regression guards to the closure test suite
- [x] Task 4: Update `.claude/rules/company-backup-restore.md` and `.ai/lessons.md`
- [x] Task 5: Verify (typecheck + tests)

## Dependencies
- Task 2 needs Task 1 (imports the new constant)
- Task 3 needs Tasks 1–2
- Task 4 independent of 2–3 (may run in parallel with Task 3)
- Task 5 last

---

## Task 1: Add `READABLE_ID_TABLES` and extend `STORAGE_PATH_COLUMNS`

**Depends on:** none
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-backup.ts` — extend
  `STORAGE_PATH_COLUMNS` (currently line ~65) and add `READABLE_ID_TABLES` beside it.

**Steps:**

1. Replace the `STORAGE_PATH_COLUMNS` declaration AND its preceding doc comment.
   The current comment claims `modelPath` is excluded because raw models live in
   `temp-staging` and are never backed up. That is stale: `company-export.ts`
   (~line 246) builds the asset list by LISTING the private bucket recursively
   under `{companyId}/`, so everything under `{companyId}/models/` is carried.

   New text:

```ts
/**
 * TEXT columns that hold a storage path (`{companyId}/…/{id}.ext`) in the
 * company's private bucket. On reseed the companyId and the embedded ids both
 * change, so these must be rewritten in lock-step with the files they point at
 * (see `rewriteStoragePath`).
 *
 * Every `modelUpload` artifact column belongs here. A backup enumerates assets by
 * LISTING the bucket under `{companyId}/` (`company-export.ts`), not by reading
 * these columns — so raw CAD under `{companyId}/models/` IS carried, and a column
 * left out of this set survives a cross-company restore still pointing at the
 * SOURCE company's prefix. `modelPath` was dropped from this set in #1148 on the
 * rationale that raw models had moved to the transient `temp-staging` bucket; the
 * listing-based backup contradicts that, and the same commit added `glbPath` /
 * `graphPath` without adding them here, which is what broke the assembly viewer
 * on every restored company.
 *
 * Adding a new path column to `modelUpload` REQUIRES adding it here — the
 * `STORAGE_PATH_COLUMNS covers every modelUpload artifact column` test fails
 * otherwise.
 */
export const STORAGE_PATH_COLUMNS = new Set([
  "thumbnailPath",
  "modelPath",
  "glbPath",
  "graphPath"
]);

/**
 * Tables whose `id` is NOT an identifier but a human-authored readable key that
 * other rows match BY VALUE: `part.id` / `material.id` / `consumable.id` /
 * `service.id` / `tool.id` hold the part number (`ADCS-001`) and are joined
 * against `item."readableId"` — by the `parts` / `materials` / … views among
 * others. There is no FK constraint expressing that, so it cannot be derived.
 *
 * `buildIdMaps` must NOT mint a fresh id for these: doing so orphans every row
 * from its `item` and every list view renders empty while the rows sit there.
 *
 * Safe to keep verbatim because these five carry ONLY the composite PK
 * `("id","companyId")` — no global `UNIQUE (id)`. That is what separates them
 * from the composite-PK tables the id-remap exists for (`balloon`,
 * `inspectionDocument`, `inspectionFeature`, `changeOrderRequiredAction`,
 * `demandProjection`), which DO carry a global `UNIQUE (id)` and would collide
 * with the source company's live rows if their ids were preserved. The two sets
 * are disjoint and must stay that way — see the disjointness test.
 *
 * Deliberately an explicit list, not a derived rule: `composite PK + text id +
 * no global UNIQUE(id)` matches ~65 tables (`workflow`, `kanban`,
 * `inventoryCount`, `stockTransfer`, …) that all legitimately need remapping.
 */
export const READABLE_ID_TABLES = new Set([
  "part",
  "material",
  "consumable",
  "service",
  "tool"
]);
```

2. Do not change `STORAGE_BUCKET` or anything else in the file.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: "Tasks: 2 successful" (or 1 successful), no "error TS" lines
```

**Out of scope:** `rewriteStoragePath` itself (its logic is correct);
`rewriteToTemplateAssetPath`; the asset copy/restore functions.

---

## Task 2: Skip readable-id tables in `buildIdMaps`

**Depends on:** Task 1
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-backup.transforms.ts` —
  import `READABLE_ID_TABLES` and add one guard in `buildIdMaps`.

**Steps:**

1. Add `READABLE_ID_TABLES` to the existing import from `./company-backup`
   (the file already imports `newIdForTable` and others from there — extend that
   import list, keep it alphabetical if it already is).

2. In `buildIdMaps`, add the skip as the FIRST check inside the `for (const table
   of tables)` loop, before the `idType` lookup:

```ts
  for (const table of tables) {
    // A readable-id table's `id` is a part number other rows match by value
    // (`item."readableId"`), not an identifier — minting a fresh one orphans
    // every row from its item. Skipped in BOTH the restore and the reseed/import
    // path: the restore wipes the target first so the original values are free,
    // and on an additive reseed a genuine duplicate hits the composite PK and
    // fails loudly rather than silently corrupting the readable key.
    if (READABLE_ID_TABLES.has(table.name)) continue;
    const idType = table.columns.find((c) => c.name === "id")?.udtName;
```

3. Leave the rest of the function unchanged. A table with no entry in `idMaps`
   already keeps its `id` verbatim in `buildRowTransforms` — this is the same
   path the int/serial-id tables (`journal`) take, pinned by the existing test
   "does NOT crash on an int/serial-id table absent from idMaps".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no "error TS" lines
```

**Out of scope:** the `idFk` parent-sharing branch; `newIdForTable`;
`buildRowTransforms`; `mapCollidingRows`. If `buildRowTransforms` turns out NOT to
keep ids verbatim for tables absent from `idMaps`, STOP and report — do not
improvise a second code path.

---

## Task 3: Add regression guards to the closure test suite

**Depends on:** Tasks 1, 2
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-backup.closure.test.ts`
- Copy from (precedent): the existing `describe("buildRowTransforms", …)` block in
  the same file — reuse its `col()`, `table()`, `ctx()` and `apply()` helpers.

**Steps:**

1. Extend the existing import from `./company-backup` to include
   `READABLE_ID_TABLES` and `STORAGE_PATH_COLUMNS`.

2. Append a new `describe` block at the end of the file:

```ts
// ── Cross-company restore: readable ids and storage paths ────────────────────
// Both guards pin a hardcoded list that a future schema change can silently
// invalidate. Each list went stale exactly once already and produced a restore
// that looked successful and was not: the Items pages rendered empty
// (readable ids rewritten) and assemblies would not load (path columns left
// pointing at the source company).
describe("cross-company restore invariants", () => {
  // Composite-PK tables backed by a global UNIQUE (id). Their ids MUST be
  // remapped or a cross-company restore collides with the source company's
  // still-live rows. Verified against pg_index on 2026-09-18.
  const GLOBAL_UNIQUE_ID_TABLES = [
    "balloon",
    "changeOrderRequiredAction",
    "demandProjection",
    "inspectionDocument",
    "inspectionFeature"
  ];

  // Every path column on `modelUpload`, verified against the live schema on
  // 2026-09-18. Adding one to the table means adding it here AND to
  // STORAGE_PATH_COLUMNS.
  const MODEL_UPLOAD_PATH_COLUMNS = [
    "modelPath",
    "thumbnailPath",
    "glbPath",
    "graphPath"
  ];

  it("keeps a readable-id table out of the id maps, but maps a normal table", () => {
    const part = table(
      "part",
      [col("id"), col("companyId"), col("name")],
      [],
      { pkColumns: ["id", "companyId"] }
    );
    const workflow = table(
      "workflow",
      [col("id"), col("companyId")],
      [],
      { pkColumns: ["id", "companyId"] }
    );
    const idMaps = buildIdMaps(
      [part, workflow],
      {
        part: [{ id: "ADCS-001", companyId: "src-co", name: "Widget" }],
        workflow: [{ id: "wf_1", companyId: "src-co" }]
      }
    );
    expect(idMaps.has("part")).toBe(false);
    expect(idMaps.get("workflow")?.get("wf_1")).toBeTypeOf("string");
    expect(idMaps.get("workflow")?.get("wf_1")).not.toBe("wf_1");
  });

  it("preserves a part number verbatim through a cross-company restamp", () => {
    // The `parts` view inner-joins part.id = item."readableId"; a rewritten id
    // matches nothing and the Parts page renders empty against a full table.
    const part = table(
      "part",
      [col("id"), col("companyId"), col("name")],
      [],
      { pkColumns: ["id", "companyId"] }
    );
    const idMaps = buildIdMaps(
      [part],
      { part: [{ id: "ADCS-001", companyId: "src-co", name: "Widget" }] }
    );
    const transforms = buildRowTransforms(part, part.columns, {
      remap: true,
      companyId: "target-co",
      userId: "importer",
      targetGroupId: "target-grp",
      sourceCompanyId: "src-co",
      idMaps,
      idRewrite: new Map<string, string>()
    });
    const row: Record<string, unknown> = {
      id: "ADCS-001",
      companyId: "src-co",
      name: "Widget"
    };
    const out: Record<string, unknown> = {};
    part.columns.forEach((c, i) => {
      out[c.name] = transforms[i]!(row[c.name]);
    });
    expect(out).toEqual({
      id: "ADCS-001",
      companyId: "target-co",
      name: "Widget"
    });
  });

  it("never exempts a table that needs a fresh id to avoid a unique collision", () => {
    const overlap = GLOBAL_UNIQUE_ID_TABLES.filter((t) =>
      READABLE_ID_TABLES.has(t)
    );
    expect(overlap).toEqual([]);
  });

  it("covers every modelUpload artifact column in STORAGE_PATH_COLUMNS", () => {
    const missing = MODEL_UPLOAD_PATH_COLUMNS.filter(
      (c) => !STORAGE_PATH_COLUMNS.has(c)
    );
    expect(missing).toEqual([]);
  });
});
```

3. If `buildRowTransforms`' ctx type requires fields beyond those listed, read the
   existing `RestampCtx` helper at the top of the `buildRowTransforms` describe
   block and match it exactly.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- company-backup.closure
# Expected: all tests pass, including the 4 new ones under
# "cross-company restore invariants"
```

**Out of scope:** rewriting existing tests; adding DB-backed tests (the suite is
pure by design).

---

## Task 4: Update the rule doc and lessons

**Depends on:** Task 1
**Files:**
- Modify: `.claude/rules/company-backup-restore.md` — the "Id minting" bullet
  (~line 115) and the "Storage path rewriting" bullet (~line 129).
- Modify: `.ai/lessons.md` — append one lesson.

**Steps:**

1. In the "Id minting" bullet, after the sentence explaining the `UNIQUE (id)`
   five, add:

   > Five OTHER composite-PK tables are excluded by name (`READABLE_ID_TABLES`:
   > `part`, `material`, `consumable`, `service`, `tool`) because their `id` is a
   > human-authored part number matched by value against `item."readableId"`, not
   > an identifier. They carry only the composite PK — no global `UNIQUE (id)` —
   > so preserving their ids cannot collide. The two sets are disjoint by
   > construction and a test enforces it.

2. Replace the "`STORAGE_PATH_COLUMNS` = `thumbnailPath` ONLY. `modelPath` (raw
   CAD) is deliberately excluded …" text (through the end of that sentence) with:

   > `STORAGE_PATH_COLUMNS` = `thumbnailPath`, `modelPath`, `glbPath`,
   > `graphPath` — every `modelUpload` artifact column. A backup enumerates assets
   > by LISTING the bucket under `{companyId}/`, not by reading these columns, so
   > raw CAD IS carried; a column missing from this set survives a cross-company
   > restore still pointing at the SOURCE company's prefix.

3. Append to `.ai/lessons.md`, matching the file's existing
   `Context → Problem → Rule → Applies to` format:

```markdown
## A hardcoded list that mirrors the schema goes stale silently, and a restore still reports success

**Context:** Two independent cross-company restore defects, found together while
tracing one broken restored company. (1) #1148 (2026-07-20) added `glbPath` /
`graphPath` to `modelUpload` and removed `modelPath` from `STORAGE_PATH_COLUMNS`
without adding the two new columns, so restored assemblies pointed at the SOURCE
company's storage prefix. (2) `2a19048def` (2026-08-31) correctly widened
id-remapping to composite-PK tables, which swept in `part`/`material`/
`consumable`/`service`/`tool` — whose `id` is a human-authored part number
(`ADCS-001`) that the `parts` view joins against `item."readableId"`, not an
identifier. Every Items page rendered empty against 860 intact rows.

**Problem:** Both lists mirror a schema property no constraint expresses, so
neither compiler nor DB catches drift. Worse, the restore job reports SUCCESS in
both cases — the rows load and the files copy; only a join or a URL silently
resolves to nothing. And both are invisible on a same-company restore, where the
remap is a no-op, so the usual manual test passes.

**Rule:** When a list in code enumerates schema facts (path columns, tables
exempt from a transform), pin it with a test that fails when the schema outgrows
it, and state in the list's own doc comment what must be added alongside a new
column/table. When widening a rule that mints or rewrites ids, ask which of the
newly-swept tables use that column as a VALUE others match on rather than as an
identifier — `part.id` is a part number. Verify a restore by querying the view
the UI reads (`parts`), not the table (`part`); the table was always full.

**Applies to:** `packages/jobs/src/inngest/functions/tasks/company-backup.ts`
(`STORAGE_PATH_COLUMNS`, `READABLE_ID_TABLES`), `buildIdMaps` in
`company-backup.transforms.ts`, and any future cross-company restore work — test
cross-company, never same-company.
```

**Verify:**
```bash
grep -c "READABLE_ID_TABLES" .claude/rules/company-backup-restore.md
# Expected: 1 (or more)
grep -c "goes stale silently" .ai/lessons.md
# Expected: 1
```

**Out of scope:** restructuring either document; other lessons.

---

## Task 5: Verify

**Depends on:** Tasks 1–4
**Files:** none (verification only)

**Steps:**

1. Run the scoped typecheck and the full jobs test suite.
2. Confirm no conflict markers or stray edits: `git status --short`.
3. Report actual output. If anything fails, report the failure verbatim — do not
   declare success.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: "Tasks: ... successful", no "error TS"

pnpm --filter @carbon/jobs test
# Expected: all test files pass; the 4 new "cross-company restore invariants"
# tests are among them
```

**Out of scope:** committing (the user must grant permission); running the whole
repo's build; re-restoring the user's company (that is the user's manual check).
