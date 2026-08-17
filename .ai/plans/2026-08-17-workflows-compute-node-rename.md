# Rename the workflow `entity` node ("Record") → `compute` ("Compute")

Date: 2026-08-17 · Branch: `fix/workflow-improvements`

## What and why

The workflow node type stored as `type: "entity"` is shown in the builder palette as
**"Record"**, described as *"Writes to a record in Carbon"*. Both are wrong: the node is
read-only — it runs one catalog **operation** and returns a computed value (an order
total, a job's scrap percentage, an item's quantity on hand). Everything that *writes*
is an Action step. The docs already carry a warning callout apologising for the name
(`docs/content/docs/reference/workflows.mdx:64`).

So this is a full internal rename, not just a label swap:

- node type discriminant `entity` → `compute`
- palette label `Record` → `Compute`, with an accurate description
- the stale "Despite the name…" docs callout goes away

## Scope boundary — `entity` is overloaded

Rename **only** the node type. Leave every other `entity` alone:

| Not renamed | Where |
|---|---|
| the value-type kind `{ kind: "entity", of }` | `definition/types.ts`, `runtime/values.ts`, `entityValue()` |
| catalog entities (record-type registry) | `catalog/entities.ts`, `CatalogEntity`, `getEntity`, `entity.<name>` label keys |
| the **lookup** node's `data.entity` field | `lookupNode` schema, `NODE_KINDS.lookup` |
| `EntityLoader` (record-reading port) | `runtime/types.ts`, `engine/loader.ts` |
| `MomentEntityRef`, `entityRefs.ts`, `EntityRecordLink.tsx` | catalog / runs UI |
| the trigger output named `"record"` | `run-trigger.ts`, `OUTPUT_LABELS.record` |
| the runs-table "Record" column | `WorkflowRunsTable.tsx`, `workflow-runs.mdx` |

## Stored-data facts (verified)

- `workflowVersion.nodes` is **JSONB** (`20260810100100_workflows-foundation.sql:61`) —
  live definitions hold `{"type":"entity"}`.
- `workflowStepRun.nodeType` is a plain **TEXT** column (same migration, line 155) with
  **no enum and no CHECK**. Historical run rows keep the string `"entity"` forever.
- No migration, view, RPC or constraint references `'entity'` in a workflow context.

→ **No SQL migration.** Stored definitions are upgraded on read by `migrateDefinition`;
historical step rows are handled by a display alias.

## Steps

### 1. `packages/workflows` — the contract

- [ ] `definition/schema.ts`: `entityNode` → `computeNode`, `z.literal("entity")` →
      `z.literal("compute")`, union member, `EntityNode` → `ComputeNode`.
- [ ] `definition/schema.ts`: `CURRENT_DEFINITION_FORMAT_VERSION` **3 → 4**.
- [ ] `definition/normalize.ts`: add the v3 → v4 block **after** the v2 → v3 name
      backfill (so a v2 document still gets the `entity_0` names it already carries),
      rewriting only `type === "entity"` nodes to `type: "compute"`.
- [ ] `definition/nodes.ts`: `NODE_KINDS.entity` → `.compute`, `entityBatchInput` →
      `computeBatchInput`, import + doc comment.
- [ ] `runtime/entity.ts` → `runtime/compute.ts`; `entityExecutor` → `computeExecutor`.
- [ ] `runtime/executors.ts`, `runtime/index.ts`, `src/index.ts`: keys/imports/exports.
- [ ] `definition/validate.ts:480` comment wording.

### 2. `packages/workflows` tests

- [ ] `runtime/entity.test.ts` → `compute.test.ts`; `runtime/executors.test.ts`;
      `definition/validate.test.ts:673`; `seed-workflows.test.ts:29` (sort order).
- [ ] `definition/normalize.test.ts`: every `formatVersion` 3 → 4 and 4 → 5
      (future-format rejection), plus a new "v3 → v4 renames entity to compute" case
      that also pins that the node's `name` is left untouched.

### 3. `packages/database` seeds

- [ ] `seed-dev/tiers/workflow-definitions.ts`: `FORMAT_VERSION` 3 → 4; node
      `entity_total` → `compute_total` (type, id, the `ref(...)` and both `edge(...)`).

### 4. `packages/jobs`

- [ ] `engine/end-to-end.test.ts:161,596` — the two `type: "entity"` nodes.
- [ ] Nothing else: dispatch is `executorFor(node)`, and `nodeType: node.type` follows.

### 5. `apps/erp` builder

- [ ] `nodes/meta.ts`: key `entity` → `compute`; `name: "Compute"`; icon
      `LuPencilRuler` → `LuCalculator`; description → *"Works out a value from a
      record"*; `defaultTitle` → *"Compute a value"*; both `node.type` narrowings;
      `NODE_KIND_ORDER`.
- [ ] `nodes/kinds.ts` (3 maps), `nodes/index.ts` (`nodeTypes`).
- [ ] `graph.ts:178` `case "entity"` (leave line 194 — that's lookup's `data.entity`).
- [ ] `config/forms/EntityForm.tsx` → `ComputeForm.tsx` (`git mv`), component name,
      `NodeFormProps<"compute">`; `config/forms/index.ts` import + `NODE_FORMS` key.
- [ ] `useDefinition.ts`: `useEntityBatchInput` → `useComputeBatchInput`.
- [ ] `Runs/WorkflowRunSteps.tsx:110` narrowing + comment; `Runs/useNodeLabel.ts:11`.

### 6. Back-compat (the two places it actually bites)

- [ ] `labelKeys.ts` `DEFAULT_NODE_NAME`: add `compute`, **keep `entity`**. Saved
      workflows carry node names like `entity_0`; drop it and every existing card,
      step row and outcome sentence starts rendering the literal "Entity 0". Test
      pins both.
- [ ] Historical `workflowStepRun.nodeType === "entity"` rows: add one resolver
      (`metaForNodeType`) in `nodes/meta.ts` mapping the legacy string to the compute
      meta, and use it at `WorkflowRunSteps.tsx:286` and `runOutcome.ts:26`. Without
      it an old run's step renders the raw word "entity" as its title.

### 7. Docs and rules

- [ ] `docs/content/docs/reference/workflows.mdx:60` table row → **Compute**;
      delete the now-moot line-64 callout and rewrite line 65 as a plain sentence.
      Leave `workflow-runs.mdx` alone (its "Record" is the trigger-record column).
- [ ] `.claude/rules/workflow-engine.md:24` and `packages/workflows/AGENTS.md:110`
      (`entity.ts` → `compute.ts`); `AGENTS.md:29` version 3 → **4** and the
      "one upgrade today" line (already stale — there are two, becoming three).
- [ ] `apps/erp/app/modules/workflows/AGENTS.md:3` node-kind list.

### 8. Verify

- [ ] `pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/jobs --filter=@carbon/database --filter=erp`
- [ ] `pnpm run test` (workflows, jobs, erp workflow tests)
- [ ] `pnpm exec biome check` on touched files

## Deliberately not doing

- No SQL migration and no JSONB backfill of `workflowVersion.nodes` — `readWorkflowVersion`
  migrates on read, which is the package's stated seam for exactly this.
- No `.po` changes. `NODE_KIND_META` strings are plain JS literals that Lingui never
  extracted; the existing `msgid "Record"` comes from unrelated `t\`Record\`` call sites.
  Wrapping these in `msg` descriptors is a separate, larger change.
