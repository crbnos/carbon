# Workflows foundation (phase 1) — implementation plan

**Spec / source:** `.ai/specs/2026-07-30-workflows-foundation.md` (approved 2026-07-30)
**Branch:** `feat/automation`
**Phase doc:** `/Users/aashu/work/carbon/plans/automations-engine/phases/phase-1-foundation.md`

The spec contains the full SQL and the full TypeScript contract. Where a task says "copy from spec
§X", copy the fenced code block in that section of the spec **verbatim** — the spec is the single
source of truth; this plan only sequences and verifies it.

Verified against this repo before planning: `pnpm db:migrate` / `pnpm run generate:types` exist as
root scripts; package test script convention is `"test": "vitest run"`, typecheck is `"tsgo
--noEmit"`, vitest config is a one-line re-export of `@carbon/config/vitest` (which sets
`include: ["src/**/*.test.ts"]`); `pnpm-workspace.yaml` already globs `packages/*` so no workspace
file edit is needed; catalog pins `zod: 3.25.76`; newest migration on this branch is
`20260727183030_model-original-path.sql`; local Postgres is `postgresql://postgres:postgres@localhost:54322/postgres`.

## Progress

- [x] Task 1: Write the migration file
- [x] Task 2: Apply the migration and regenerate DB types
- [x] Task 3: Verify schema behavior with psql
- [x] Task 4: Scaffold `packages/workflows`
- [x] Task 5: Value/schedule types and node/edge/definition schemas + tests
- [x] Task 6: Normaliser and catalog interface + tests
- [x] Task 7: Validator — structural checks + tests
- [x] Task 8: Validator — reference, type and catalog checks + tests
- [x] Task 9: Barrel, AGENTS.md, and consumer dependency wiring
- [x] Task 10: Full verification sweep

## Execution notes (2026-07-30)

Deviations and findings, recorded because later phases inherit them:

1. **This worktree had never been provisioned.** No `node_modules`, and `@carbon/config` had no
   `dist/`, so `supabase` could not spawn (`exit undefined`, no SQL error) and vitest could not
   resolve its config. Fixed with `pnpm install` plus `pnpm --filter @carbon/config build`. Nothing
   to do with the migration.
2. **Real bug found by Task 3's verification.** The spec's
   `FOREIGN KEY ("activeVersionId", "companyId") ... ON DELETE SET NULL` nulls *both* referencing
   columns, so deleting the active version failed with
   `null value in column "companyId" ... violates not-null constraint` instead of clearing the
   pointer. Fixed in the migration with the Postgres 15 column-list form,
   `ON DELETE SET NULL ("activeVersionId")`, verified against the live database. The migration file
   was edited in place (it is new, uncommitted, and had only ever reached this local database) and
   the constraint was replaced on the local database so file and schema agree. **The spec's SQL in
   §3 should be corrected to match.**
3. **Layers 5 and 6 of the validator skip a node whose catalog entry is missing.** Required to
   satisfy the acceptance criterion "returns exactly one `UNKNOWN_ACTION`" — otherwise an unknown
   action also produces `MISSING_INPUT` for each of its inputs. Documented in
   `packages/workflows/AGENTS.md`.
4. **Time zones are validated with `new Intl.DateTimeFormat(...)` in a try/catch**, not
   `Intl.supportedValuesOf("timeZone")` — same check, no dependency on that newer API.
5. **Issue messages are plain English, not wrapped in the Lingui macro.** `@carbon/workflows`
   deliberately depends only on `zod`; phase 8 translates at the render site.
6. **`EMPTY_DEFINITION` is accompanied by an `emptyDefinition()` factory**, and
   `toWorkflowDefinition` returns a fresh object, so no caller can mutate shared state.
7. Two extras beyond the spec, both small and used by later phases: a duplicate-node-id check
   (reported as `MALFORMED_DEFINITION`) and an exported `OPERATORS_BY_TYPE` / `operatorsForType`
   table so phase 8's clause editor offers only operators that fit the left-hand type.
8. Not verified: authenticated-role RLS behaviour (no JWT-scoped psql harness in this repo).
   Evidence at this layer is the policy matrix — 13 policies, exactly as intended — plus RLS
   enabled on all five tables.

## Dependencies

- Tasks 1 → 2 → 3 strictly sequential (DB track).
- Tasks 4 → 5 → 6 → 7 → 8 → 9 sequential (package track).
- The two tracks are fully independent of each other — the package never imports generated DB types
  (rows enter as `unknown`). They may run as parallel subagents.
- Task 10 needs everything.

---

## Task 1: Write the migration file

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/20260730142317_workflows-foundation.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260326000000_print-manager.sql`
  (lines 1–31, the module/permission block; also the run-log CHECK-constraint style)

**Steps:**
1. Create the file with Write (do not use `pnpm db:migrate:new` — the spec fixes the exact
   filename). If any migration newer than `20260730142317` exists in
   `packages/database/supabase/migrations/` at execution time, STOP and report — the timestamp must
   stay newest.
2. Assemble the file from the spec's fenced SQL blocks, in this exact order:
   - §Data Model Changes 1 — `Workflows` module enum + `COMMIT` + `modules` view rebuild +
     `employeeTypePermission` / `userPermission` seeding.
   - §2 — `CREATE TABLE "workflow"`.
   - §3 — `CREATE TABLE "workflowVersion"` + the `ALTER TABLE "workflow" ... "workflow_activeVersionId_fkey"` block.
   - §4 — `CREATE TABLE "workflowTriggerEvent"` + its dispatch index.
   - §5 — `CREATE TABLE "workflowRun"`.
   - §6 — `CREATE TABLE "workflowStepRun"`.
   - §7 — all indexes.
   - §8 — RLS: enable + four policies (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) on `workflow` and the
     same four on `workflowVersion`; on `workflowTriggerEvent` only SELECT (`workflows_view`),
     INSERT and DELETE (both `workflows_update`); on `workflowRun` and `workflowStepRun` only
     SELECT (`workflows_view`). Use the exact policy form from the spec's §8 block —
     `get_companies_with_employee_permission('<key>')` cast `::text[]`. Never use `has_role` /
     `has_company_permission`.
   - §9 — the idempotent `DO $$` realtime-publication block for `workflowRun`, and the same block
     again with `workflowStepRun`.
3. Mid-file `COMMIT` after the enum `ALTER TYPE` is required and intentional (new enum values are
   unusable in the transaction that adds them) — do not "fix" it.

**Verify:**
```bash
ls packages/database/supabase/migrations/ | tail -1
# Expected: 20260730142317_workflows-foundation.sql
grep -c "CREATE TABLE" packages/database/supabase/migrations/20260730142317_workflows-foundation.sql
# Expected: 5
grep -c "CREATE POLICY" packages/database/supabase/migrations/20260730142317_workflows-foundation.sql
# Expected: 13
```

**Out of scope:** no writes to `eventSystemSubscription`, no seed data, no service layer, no edge
functions, no changes to any existing migration.

## Task 2: Apply the migration and regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`,
  `packages/database/supabase/functions/lib/types.ts` — regenerated, never hand-edited

**Steps:**
1. Run `pnpm db:migrate`. If the local Supabase stack is not running or the command errors for
   environment reasons, STOP and ask the user — never rebuild the database.
2. Run `pnpm run generate:types` (required before any typecheck; the generator, not `turbo`, owns
   these files).

**Verify:**
```bash
grep -c '"workflowVersion"\|"workflowTriggerEvent"\|"workflowStepRun"' packages/database/src/types.ts
# Expected: a number ≥ 3 (all three table names present; workflow/workflowRun also appear)
grep -n "Workflows" packages/database/src/types.ts | head -2
# Expected: 'Workflows' listed in the module enum union
```

**Out of scope:** do not edit the generated files by hand; do not run whole-repo typecheck here.

## Task 3: Verify schema behavior with psql

**Depends on:** Task 2

**Steps:**
1. `export PSQL='psql postgresql://postgres:postgres@localhost:54322/postgres -v ON_ERROR_STOP=0 -c'`
2. Run each check below and read the output. Use an existing `companyId` and `user` id from the dev
   seed (`SELECT id FROM company LIMIT 1;` / `SELECT id FROM "user" LIMIT 1;`). Wrap all inserts in
   a transaction you `ROLLBACK` at the end so no test rows persist.
   - Enum + seeding: `SELECT name FROM modules WHERE name = 'Workflows';` → one row.
     `SELECT count(*) FROM "employeeTypePermission" WHERE module = 'Workflows';` → > 0.
   - Version uniqueness: insert two `workflowVersion` rows with the same
     `(workflowId, companyId, versionNumber)` → second fails `23505`.
   - Run dedupe: two `workflowRun` rows with identical
     `(workflowId, companyId, workflowVersionId, sourceEventId)` (use
     `sourceEventId = 'schedule:wf_test:2026-07-30T09:00:00Z'` to prove the scheduled-key case) →
     second fails `23505`.
   - Step idempotency: two `workflowStepRun` rows with same `(runId, companyId, nodeId)` and
     `itemKey` omitted (defaults to `''`) → second fails `23505`.
   - Defaults: insert a `workflowVersion` without `nodes`/`edges`, select them back → both `[]`.
   - Cascade: delete the test `workflow` → its versions/trigger events/runs/step runs are gone.
   - SET NULL: point `workflow.activeVersionId` at a version, delete that version row →
     `activeVersionId IS NULL`, workflow row still present.
   - RLS presence: `SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename LIKE 'workflow%' ORDER BY 1,3;`
     → 13 rows matching Task 1's policy matrix; plus
     `SELECT relrowsecurity FROM pg_class WHERE relname IN ('workflow','workflowVersion','workflowTriggerEvent','workflowRun','workflowStepRun');`
     → all `t`.
   - Realtime: `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('workflowRun','workflowStepRun');`
     → both rows.

**Verify:** the psql outputs above, pasted into the run log. Expected results are inline per check.

**Out of scope:** authenticated-role RLS simulation (no test harness for JWT-scoped psql exists in
this repo; policy presence + the shared helper pattern is the accepted evidence at this layer).

## Task 4: Scaffold `packages/workflows`

**Depends on:** none (parallel with Tasks 1–3)
**Files:**
- Create: `packages/workflows/package.json`, `packages/workflows/tsconfig.json`,
  `packages/workflows/vitest.config.ts`, `packages/workflows/src/index.ts`
- Copy from (precedent): `packages/utils/package.json` (minimal no-build package),
  `packages/documents/vitest.config.ts` (one-line vitest re-export)

**Steps:**
1. `packages/workflows/package.json`:
   ```json
   {
     "name": "@carbon/workflows",
     "private": true,
     "version": "0.0.0",
     "sideEffects": false,
     "exports": {
       ".": "./src/index.ts"
     },
     "scripts": {
       "clean": "rimraf .turbo node_modules",
       "lint": "biome lint --write ",
       "test": "vitest run",
       "typecheck": "tsgo --noEmit"
     },
     "dependencies": {
       "zod": "catalog:"
     },
     "devDependencies": {
       "@carbon/config": "workspace:*",
       "typescript": "catalog:",
       "vitest": "catalog:"
     }
   }
   ```
2. `packages/workflows/tsconfig.json`:
   ```json
   {
     "extends": "@carbon/config/tsconfig/base.json",
     "include": ["src"],
     "exclude": ["dist", "build", "node_modules"]
   }
   ```
3. `packages/workflows/vitest.config.ts`: exactly
   `export { default } from "@carbon/config/vitest";`
4. `packages/workflows/src/index.ts`: temporary `export {};` (replaced in Task 9).
5. Run `pnpm install` at the repo root to link the workspace package.

**Verify:**
```bash
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: exit 0, no output
pnpm --filter @carbon/workflows test
# Expected: "No test files found" is acceptable at this task only (passWithNoTests is set)
```

**Out of scope:** no `tsup`/build step, no `apps/erp/vite.config.ts` alias, no react/db deps.

## Task 5: Value/schedule types and node/edge/definition schemas + tests

**Depends on:** Task 4
**Files:**
- Create: `packages/workflows/src/definition/types.ts`, `packages/workflows/src/definition/schema.ts`,
  `packages/workflows/src/definition/schema.test.ts`
- Copy from (precedent): `packages/documents/src/template/schema.ts` (versioned-JSON zod schema +
  `Extract<>` narrowers per kind)

**Steps:**
1. `types.ts` — copy the spec's §`src/definition/types.ts` block: `primitiveKindSchema`,
   `valueTypeSchema` (discriminated union whose `list` arm nests only primitive/entity, so
   `list<list<T>>` is unrepresentable), `variableRefSchema`, `literalSchema`, `valueOrRefSchema`,
   `scheduleSchema`. Export inferred types (`ValueType`, `VariableRef`, `ValueOrRef`, `Schedule`,
   `Clause` = `{ left: ValueOrRef; operator: string; right: ValueOrRef }` with a `clauseSchema`).
2. `schema.ts` — copy the spec's §`src/definition/schema.ts` block: constants
   `CURRENT_DEFINITION_FORMAT_VERSION = 1`, `MAX_LIST_ITEMS = 100`, `MAX_CHAIN_DEPTH = 10`;
   `originSchema`; the six node schemas with `data` shapes exactly per the spec's node-kind table
   (`trigger` events/origin/schedule?; `condition` paths with id/kind/combinator/clauses; `entity`
   operation+inputs; `lookup` entity/returns/match; `filter` source/combinator/clauses; `action`
   action/inputs/batch boolean defaulting false); `nodeSchema` as a **flat** discriminated union;
   `edgeSchema`; `workflowDefinitionSchema`; type exports `WorkflowNode`, `WorkflowNodeType`,
   `TriggerNode` … one `Extract<>` per kind. Keep unions flat and annotate any self-referential
   schema `z.ZodType<T>` explicitly (TS2589 guard, spec §Risks).
3. `schema.test.ts` — assert: a minimal valid definition parses; an unknown node `type` fails; a
   `list` of `list` is rejected by `valueTypeSchema`; `schedule` bounds enforced (hour 24 fails,
   `day: "last"` passes); an edge missing `sourceHandle` fails; defaults land (`origin` → `"Both"`,
   `formatVersion` → 1, `path` → `[]`).

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: schema.test.ts green, > 0 tests
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: exit 0
```

**Out of scope:** no validator logic here; no i18n on schema messages.

## Task 6: Normaliser and catalog interface + tests

**Depends on:** Task 5
**Files:**
- Create: `packages/workflows/src/definition/normalize.ts`,
  `packages/workflows/src/definition/catalog.ts`, `packages/workflows/src/definition/normalize.test.ts`
- Copy from (precedent): `packages/documents/src/template/defaults.ts` (`migrateBlocks` /
  `resolveTemplate` read-time seam)

**Steps:**
1. `normalize.ts` — per spec §`src/definition/normalize.ts`: `StoredWorkflowVersionRow`
   (`formatVersion?: number | null; nodes?: unknown; edges?: unknown`), private
   `migrateDefinition(d, from)` pass-through at v1 (the only place upgrades will ever happen),
   `EMPTY_DEFINITION` (formatVersion 1, empty arrays), `parseWorkflowDefinition(value)` returning
   zod safe-parse, and `toWorkflowDefinition(row)` which: treats `null`/`undefined`/non-object rows
   as `EMPTY_DEFINITION`, assembles `{ formatVersion: row.formatVersion ?? 1, nodes, edges }`,
   safe-parses, returns `EMPTY_DEFINITION` on parse failure, then runs `migrateDefinition`.
2. `catalog.ts` — copy the spec's §`src/definition/catalog.ts` interfaces verbatim
   (`CatalogEvent`, `CatalogInput`, `CatalogAction`, `CatalogOperation`, `CatalogEntity`,
   `WorkflowCatalog`) plus `createFixtureCatalog(): WorkflowCatalog` — a small in-memory fixture
   with at least: event `purchaseOrder.status.changed` (outputs `purchaseOrder` entity + `before`),
   entity `purchaseOrder` (properties incl. `amount` number, `assignee` entity `user`), entity
   `user` (property `manager` entity `user`), action `notify` (required `recipient` entity user,
   `message` string; batchable true), action `createRecord`, one operation, and a `list<part>`
   -producing lookup entity `part` — enough to express every Task 7/8 test.
3. `normalize.test.ts` — assert: `toWorkflowDefinition(null)` and `({})` → `EMPTY_DEFINITION`
   without throwing; a row with `nodes: []`/`edges: []`/`formatVersion: 1` → empty canvas; a row
   with garbage `nodes: "oops"` → `EMPTY_DEFINITION`; a `formatVersion: 1` row carrying only known
   fields round-trips unchanged (migrate is pass-through).

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: normalize.test.ts green alongside schema tests
```

**Out of scope:** no real event/action catalogs (phases 2/5); fixture stays inside the package.

## Task 7: Validator — structural checks + tests

**Depends on:** Task 6
**Files:**
- Create: `packages/workflows/src/definition/validate.ts`, `packages/workflows/src/definition/validate.test.ts`

**Steps:**
1. `validate.ts` — per spec §`src/definition/validate.ts`: the full `WorkflowIssueCode` union (all
   19 codes, even those raised only in Task 8), `WorkflowIssue`, and
   `validateDefinition(definition, catalog): WorkflowIssue[]`. Implement check layers 1–4 (each
   layer runs only if the previous produced no issues):
   - Shape: `workflowDefinitionSchema.safeParse` → `MALFORMED_DEFINITION` with zod path in `field`.
   - Trigger: exactly one trigger node (`NO_TRIGGER` / `MULTIPLE_TRIGGERS`); it has events XOR a
     schedule (`EMPTY_TRIGGER` if neither or both); schedule shape rules — `weekdays` only when
     `weekly` and required then, `day` only when `monthly` and required then, `tz` resolvable via
     `Intl.supportedValuesOf("timeZone")` (else `INVALID_SCHEDULE`).
   - Edges: endpoints exist (`DANGLING_EDGE`); source handle exists on the source node
     (`UNKNOWN_HANDLE`) — condition handles are its path ids; action and lookup expose
     `success`/`failure`; trigger, entity and filter expose one default handle.
   - Graph: DFS from trigger — `CYCLE` on a back edge; `UNREACHABLE_NODE` for any non-trigger node
     not reached.
2. `validate.test.ts` — one focused test per acceptance criterion: `NO_TRIGGER`,
   `MULTIPLE_TRIGGERS`, `EMPTY_TRIGGER` (neither), `INVALID_SCHEDULE` (weekly w/o weekdays; daily
   carrying `day`), `DANGLING_EDGE`, `UNKNOWN_HANDLE` (edge off a condition path id the node lacks),
   `CYCLE` (three-node loop), `UNREACHABLE_NODE` (island action node). Build definitions with small
   local helpers (`makeTrigger()`, `makeAction()`, `edge(a, handle, b)`).

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all structural-check tests green
```

**Out of scope:** layers 5–7 (Task 8). Do not export helper internals from the barrel.

## Task 8: Validator — reference, type and catalog checks + tests

**Depends on:** Task 7
**Files:**
- Modify: `packages/workflows/src/definition/validate.ts` — add layers 5–7
- Modify: `packages/workflows/src/definition/validate.test.ts` — add the corresponding tests

**Steps:**
1. Layer 5 (references): walk every `VariableRef` in node configs. `UNKNOWN_VARIABLE` if `nodeId`
   doesn't exist or the named `output` isn't declared by that node's kind/catalog entry;
   `REF_NOT_UPSTREAM` if the referenced node is not an ancestor along the edges leading into the
   referencing node (a node on the `if` branch is not upstream of one on the `else` branch);
   property `path` must resolve step-by-step through the catalog's entity properties
   (`UNKNOWN_VARIABLE` on a missing property).
2. Layer 6 (types): compute each node's output types (trigger from `catalog.getEvent`, entity from
   operation output, lookup from `entity` + `returns`, filter passes its source list type through,
   action from `catalog.getAction(...).outputs`). Then for every input: `MISSING_INPUT` when a
   required catalog input is absent; `TYPE_MISMATCH` when the supplied literal/ref type differs
   from the declared type; `LIST_INTO_SINGLE` when a `list<T>` feeds a single-`T` input — except an
   action node with `batch: true` and a batchable catalog action, where each item's type `T` is
   what's checked. Clause `operator` legality is per left-side type ("compare like with like");
   unknown operator for that type → `TYPE_MISMATCH` with the operator in `field`.
3. Layer 7 (config completeness): `UNKNOWN_EVENT` / `UNKNOWN_ACTION` / `UNKNOWN_OPERATION` /
   `UNKNOWN_ENTITY` for ids the injected catalog can't resolve; `INCOMPLETE_CONFIG` for an unset
   required setting (empty `action` id, condition path with zero clauses other than `else`, filter
   without a `source`).
4. Tests — per acceptance criteria: `REF_NOT_UPSTREAM` (else-branch node referencing if-branch
   output), `LIST_INTO_SINGLE` (list<part> → single-part input; same wiring passes with
   `batch: true`), `TYPE_MISMATCH` (string literal into number input), `MISSING_INPUT`,
   `UNKNOWN_EVENT`/`UNKNOWN_ACTION`/`UNKNOWN_OPERATION` against a thin catalog, and the two
   end-to-end fixtures: the PRD's "PO over $10,000 → notify buyer's manager" definition returns
   `[]` against `createFixtureCatalog()`, and the same definition against a fixture with the
   notify action removed returns exactly one issue, `UNKNOWN_ACTION` — proving catalog injection.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all tests green; the two end-to-end fixture tests present and passing
```

**Out of scope:** no cross-node value evaluation at runtime; no operator execution — legality
tables only.

## Task 9: Barrel, AGENTS.md, and consumer dependency wiring

**Depends on:** Task 8 (barrel), Task 2 (consumers must typecheck against regenerated types)
**Files:**
- Modify: `packages/workflows/src/index.ts` — real barrel
- Create: `packages/workflows/AGENTS.md`
- Modify: `apps/erp/package.json`, `packages/jobs/package.json` — add `"@carbon/workflows": "workspace:*"` to `dependencies`
- Copy from (precedent): `packages/documents/AGENTS.md` (structure), any sibling for tone

**Steps:**
1. `src/index.ts`: re-export the public surface — everything in `schema.ts` (schemas, constants,
   types), `toWorkflowDefinition` / `parseWorkflowDefinition` / `EMPTY_DEFINITION` /
   `StoredWorkflowVersionRow` from `normalize.ts`, all catalog interfaces +
   `createFixtureCatalog`, and `validateDefinition` / `WorkflowIssue` / `WorkflowIssueCode`.
   `migrateDefinition` stays private.
2. `AGENTS.md`: what the package is (the shared workflow-definition contract — schema, normaliser,
   validator), the vocabulary note ("workflow" here means the customer-built feature, not the
   `.claude/rules/workflow-*.md` dev-procedure files), the `workflowTriggerEvent` invariant phase 7
   must uphold (rows ⇔ active workflow's promoted version's trigger events, rewritten in the same
   transaction), the rule that `migrateDefinition` is the only upgrade seam, and the validation
   commands (`pnpm --filter @carbon/workflows test`, `... exec tsgo --noEmit`,
   `pnpm exec biome check packages/workflows`).
3. Add the dependency line to both consumers' `dependencies` (alphabetical position), then
   `pnpm install`.

**Verify:**
```bash
pnpm install
# Expected: resolves clean, lockfile updates only for the new package links
grep '"@carbon/workflows"' apps/erp/package.json packages/jobs/package.json
# Expected: one workspace:* line in each
```

**Out of scope:** no imports of `@carbon/workflows` added to any erp/jobs source file yet (phases
3, 4, 7 do that); no `useModules.tsx` nav entry; no route.

## Task 10: Full verification sweep

**Depends on:** all previous

**Steps & Verify (this task is the verification):**
```bash
pnpm --filter @carbon/workflows test
# Expected: all suites green, real assertions
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: exit 0
(cd apps/erp && pnpm exec tsgo --noEmit)
# Expected: exit 0 — direct tsgo, NOT turbo (stale-cache false positives; erp filter name is `erp`)
pnpm exec turbo run typecheck --filter=@carbon/jobs --force
# Expected: exit 0
pnpm exec biome check packages/workflows
# Expected: "Checked N files" with zero errors (repo-wide pre-existing warnings don't count)
git status --porcelain
# Expected: only intended files. If packages/database/src/types.ts, swagger-docs-schema.ts or
# supabase/functions/lib/types.ts changed beyond Task 2's deliberate regeneration, restore them.
```
If erp typecheck surfaces TS2589 in unrelated files, apply the spec's mitigation (`@ts-ignore`,
keep unions flat) — if that doesn't clear it, STOP and report rather than restructuring the schema.

Then check off every spec acceptance criterion in `.ai/specs/2026-07-30-workflows-foundation.md`
against evidence, update this file's Progress list, and report. **Do not commit** — the user
commits on explicit ask only.

**Out of scope:** no whole-repo `pnpm run typecheck` (OOMs); no `pnpm run build`; no db rebuild.

## Post-review fixes (2026-07-30)

A thermo-nuclear review found four blockers; all twelve findings are resolved. See
`.ai/reviews/2026-07-30-workflows-foundation-thermo-nuclear.md` for the findings and
their resolutions. Structural changes worth knowing when reading the plan above:

- `src/definition/nodes.ts` is new and holds `NODE_KINDS` — everything one node type
  declares about itself. `validate.ts` no longer switches on node type (828 → 397
  lines). `src/definition/issues.ts` is new (the issue types).
- `toWorkflowDefinition` is now `readWorkflowVersion`, returning a discriminated
  result rather than falling back to an empty canvas. `EMPTY_DEFINITION` is gone.
- Operator names come from `Operator` in `@carbon/utils`, extended there. The
  package now depends on `@carbon/utils`.
- `scheduleSchema.freq` is PascalCase; `CONFLICTING_TRIGGER` is a new issue code.
- Migration: five FK indexes added and `workflow_due_idx` now also requires
  `"activeVersionId" IS NOT NULL`. Applied to the local DB by hand so the file and
  the schema agree; **no** regeneration needed (indexes are not in generated types).

Tests: 64 → 73. Two confirmed bugs (self-referential filter validating clean; the
format-migration seam silently discarding data) have regression tests.
