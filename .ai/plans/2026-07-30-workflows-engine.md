# Workflows — Phase 4: the engine — implementation plan

**Spec / source:** `.ai/specs/2026-07-30-workflows-engine.md`
**Branch:** `feat/automation`

## Progress

- [x] Task 1: Add the `item` value form to the definition contract
- [x] Task 2: Runtime value model (`runtime/types.ts`, `runtime/values.ts`)
- [x] Task 3: Variable resolution and the `EntityLoader` seam
- [x] Task 4: Operator comparison and clause evaluation
- [x] Task 5: The Condition executor
- [x] Task 6: The Filter executor
- [x] Task 7: Batch planning and item keys
- [x] Task 8: Export the runtime from `@carbon/workflows`
- [x] Task 9: The pure graph walker
- [x] Task 10: Owner connection, claims and the permission check
- [x] Task 11: The entity loader over the owner's connection
- [x] Task 12: The step ledger
- [x] Task 13: Run status transitions
- [x] Task 14: Engine orchestration
- [x] Task 15: Replace the Inngest stub
- [x] Task 16: Full verification
- [x] Task 17: Document the engine in `.claude/rules/` and AGENTS files

## Dependencies

- Task 2 needs Task 1 only for `ItemRef` being exported; do Task 1 first.
- Task 3 needs Task 2. Task 4 needs Task 2. **Tasks 3 and 4 are independent of each other.**
- Task 5 needs Tasks 3 + 4. Task 6 needs Tasks 1 + 3 + 4. Task 7 needs Task 2.
  **Tasks 5, 6 and 7 are independent of each other.**
- Task 8 needs Tasks 2–7.
- Task 9 needs nothing (pure graph maths) — **can run in parallel with Tasks 2–8.**
- Tasks 10, 12, 13 need nothing from the runtime — **independent of each other and of Tasks 2–9.**
- Task 11 needs Task 3 (the `EntityLoader` interface) and Task 8.
- Task 14 needs Tasks 8–13. Task 15 needs Task 14. Task 16 needs Task 15.
- Task 17 needs Task 15.

## Conventions that apply to every task

- Package manager is **pnpm**, never npm.
- `packages/workflows` must **never** import `@carbon/database` as a value, must
  never import `@carbon/react` or app code, and must never import
  `src/catalog/labels.generated.ts`.
- Keep zod unions **flat and non-recursive** — `apps/erp` is near TypeScript's
  instantiation budget and a recursive union triggers TS2589 in unrelated files.
- Comments: one-liners only (2 lines max), and only where the reason is not
  obvious from the code. No explainer blocks.
- Vitest runs with `globals: false` — every test file must
  `import { describe, expect, it } from "vitest";` explicitly.
- All customer-facing strings (anything written to `statusReason` or `error`)
  are full sentences addressed to the customer, e.g.
  `"The owner of this workflow no longer has access to Purchasing."`

---

## Task 1: Add the `item` value form to the definition contract

**Depends on:** none

**Files:**

- Modify: `packages/workflows/src/definition/types.ts` — add `itemRefSchema` and widen `valueOrRefSchema`
- Modify: `packages/workflows/src/definition/issues.ts` — add the `ITEM_OUTSIDE_LOOP` code
- Modify: `packages/workflows/src/definition/nodes.ts` — item-scope typing, the single-list batch rule
- Modify: `packages/workflows/src/definition/validate.ts` — pass the item scope into `NodeContext`
- Modify: `packages/workflows/src/index.ts` — export `ItemRef` / `itemRefSchema`
- Modify: `packages/workflows/src/definition/validate.test.ts` — new cases
- Copy from (precedent): the existing `variableRefSchema` block in
  `packages/workflows/src/definition/types.ts` (lines ~93-107)

**Steps:**

1. In `types.ts`, after `variableRefSchema`, add:

   ```ts
   /** The item a looping node is currently on: a filter's list, or a batched action's. */
   export const itemRefSchema = z.object({
     kind: z.literal("item"),
     path: z.array(z.string()).default([])
   });
   export type ItemRef = z.infer<typeof itemRefSchema>;
   ```

2. Widen the union, keeping the existing `superRefine` on literals exactly as it is:

   ```ts
   export const valueOrRefSchema = z
     .discriminatedUnion("kind", [literalSchema, variableRefSchema, itemRefSchema])
     .superRefine((value, ctx) => {
       if (value.kind !== "literal") return;
       if (!literalValueMatchesType(value.type, value.value)) {
         ctx.addIssue({
           code: z.ZodIssueCode.custom,
           path: ["value"],
           message: `This value is not ${describeType(value.type)}.`
         });
       }
     });
   ```

3. In `issues.ts`, add `"ITEM_OUTSIDE_LOOP"` to the `WorkflowIssueCode` union.

4. In `nodes.ts`, add to `NodeContext`:

   ```ts
   /** The type of the item a looping node is on, or undefined when the node does not loop. */
   itemTypeOf(nodeId: string): ValueType | undefined;
   ```

   `typeOf` must now handle `kind === "item"`: look up `ctx.itemTypeOf(atNodeId)`;
   if undefined, return `undefined` (the config layer reports
   `ITEM_OUTSIDE_LOOP`); otherwise walk `path` with the same helper `walkPath`
   already uses in `validate.ts` — export `walkPath` from `validate.ts` is NOT
   allowed (it would invert the dependency); instead move `walkPath` into
   `nodes.ts` as an exported helper and have `validate.ts` import it from there.

5. In `nodes.ts`, `getNodeRefs` must **not** return `item` values — they are not
   node references and the upstream-ancestor check does not apply to them.

6. Add a `checkConfig` rule shared by every node kind: for each
   `ValueOrRef` the node holds, if it is `{kind:"item"}` and
   `ctx.itemTypeOf(node.id)` is `undefined`, push
   `{ code: "ITEM_OUTSIDE_LOOP", nodeId, field, message: "This test refers to the current item, but this step does not work through a list." }`.

7. In `nodes.ts`, the `action` kind's `checkConfig` gains: when
   `node.data.batch` is true, count the inputs whose resolved type is a list.
   Not exactly one → `{ code: "INCOMPLETE_CONFIG", field: "batch", message: "A step that repeats needs exactly one list to repeat over." }`.

8. In `validate.ts`, implement `itemTypeOf(nodeId)` in `createContext`:
   - filter node → resolve `data.source`; if it is a list, return `source.of` as
     a `ValueType`; otherwise `undefined`.
   - action node with `data.batch === true` → the item type of its single
     list-typed input, or `undefined`.
   - anything else → `undefined`.

9. Add tests to `validate.test.ts`:
   - a filter whose clause is `{kind:"item", path:["dueDate"]}` compared to a
     date literal validates clean;
   - the same clause on a **condition** node reports `ITEM_OUTSIDE_LOOP`;
   - an `item` path naming a column that does not exist reports `TYPE_MISMATCH`
     with the message `"This property does not exist on the items in that list."`
     — add that case to the step-6 check, since `typeOf` returning `undefined`
     would otherwise make `checkClauses` return early and report nothing;
   - the existing test "rejects a filter whose source is its own output" still
     passes unchanged.

**Verify:**

```bash
pnpm --filter @carbon/workflows test
# Expected: all test files pass, including validate.test.ts with the new cases
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: no output (success)
```

**Out of scope:** the builder UI for the new value form (phase 8); changing
`literalSchema` or `variableRefSchema`; the action catalogue.

---

## Task 2: Runtime value model

**Depends on:** Task 1

**Files:**

- Create: `packages/workflows/src/runtime/types.ts`
- Create: `packages/workflows/src/runtime/values.ts`
- Create: `packages/workflows/src/runtime/values.test.ts`

**Steps:**

1. `runtime/types.ts` — declare, and nothing else (no logic in this file):

   ```ts
   import type { WorkflowCatalog } from "../definition/catalog";
   import type { WorkflowNode } from "../definition/schema";
   import type { PrimitiveKind, ScalarType, ValueType } from "../definition/types";

   export type RuntimeValue =
     | { kind: "primitive"; of: PrimitiveKind; value: string | number | boolean | null }
     | { kind: "entity"; of: string; id: string }
     | { kind: "list"; of: ScalarType; items: RuntimeValue[] };

   export type Resolution =
     | { ok: true; value: RuntimeValue }
     | { ok: false; reason: string };

   /** Loads a record the run does not already hold. Implemented job-side; never here. */
   export interface EntityLoader {
     load(entity: string, id: string): Promise<Record<string, unknown> | null>;
   }

   export interface RuntimeContext {
     catalog: WorkflowCatalog;
     loader: EntityLoader;
     /** nodeId → that node's outputs, filled in as the walk proceeds. */
     outputs: Map<string, Record<string, RuntimeValue>>;
     /** The item a looping node is on; absent outside a loop. */
     item?: RuntimeValue;
   }

   export type NodeResult =
     | {
         status: "Succeeded";
         outputs: Record<string, RuntimeValue>;
         /** The handle to follow, or null to stop this path cleanly. */
         handle: string | null;
         branchTaken?: string;
         /** A one-line note for the step row's statusReason, e.g. what a filter kept. */
         summary?: string;
       }
     | { status: "Skipped"; reason: string }
     | { status: "Failed"; error: string; handle?: string | null };

   export interface NodeExecutor<N extends WorkflowNode> {
     /** The permission module the owner must hold, or undefined when the node reads nothing. */
     permission(node: N, catalog: WorkflowCatalog): string | undefined;
     execute(node: N, ctx: RuntimeContext): Promise<NodeResult>;
   }
   ```

2. `runtime/values.ts` — pure constructors and conversions:

   ```ts
   export function primitiveValue(of: PrimitiveKind, value: string | number | boolean | null): RuntimeValue
   export function entityValue(of: string, id: string): RuntimeValue
   /** Slices to MAX_LIST_ITEMS and reports how many were dropped. */
   export function listValue(of: ScalarType, items: RuntimeValue[]): { value: RuntimeValue; dropped: number }
   /** A raw database column value plus its catalog type → a RuntimeValue. */
   export function fromColumn(type: ValueType, raw: unknown): RuntimeValue
   export function fromLiteral(literal: Literal): RuntimeValue
   export function typeOfValue(value: RuntimeValue): ValueType
   export function isNull(value: RuntimeValue): boolean
   ```

   Rules `fromColumn` must follow:
   - `type.kind === "entity"`: `raw` null/empty string → a `null` primitive;
     otherwise `entityValue(type.of, String(raw))`.
   - `type.kind === "primitive"` and `of === "date"`: `raw` becomes an ISO
     string via `new Date(raw as string).toISOString()`; an unparseable value
     becomes a `null` primitive.
   - `type.kind === "primitive"` and `of === "number"`: non-finite → `null`.
   - `type.kind === "list"`: `raw` must be an array; map each entry with
     `fromColumn(type.of, entry)`; a non-array becomes an empty list.
   - Any `raw` that is `null` or `undefined` → a `null` primitive (for a list
     type, an empty list).

3. Tests in `values.test.ts`: date coercion including an unparseable string;
   `listValue` slicing 150 items to 100 with `dropped === 50`; `fromColumn` on
   an entity column holding `""`; `typeOfValue` round-tripping each shape.

**Verify:**

```bash
pnpm --filter @carbon/workflows test
# Expected: values.test.ts passes
```

**Out of scope:** any I/O; anything importing a Supabase or Kysely client.

---

## Task 3: Variable resolution and the `EntityLoader` seam

**Depends on:** Task 2

**Files:**

- Create: `packages/workflows/src/runtime/resolve.ts`
- Create: `packages/workflows/src/runtime/resolve.test.ts`

**Steps:**

1. Implement:

   ```ts
   export async function resolveValue(value: ValueOrRef, ctx: RuntimeContext): Promise<Resolution>
   export async function resolveRef(ref: VariableRef, ctx: RuntimeContext): Promise<Resolution>
   export async function resolveItem(ref: ItemRef, ctx: RuntimeContext): Promise<Resolution>
   ```

2. `resolveRef`:
   - `ctx.outputs.get(ref.nodeId)` missing → `{ ok: false, reason: "The step that produces this value did not run." }`
   - that node's `ref.output` missing → `{ ok: false, reason: \`This step did not produce "${ref.output}".\` }`
   - then walk `ref.path` (step 4).

3. `resolveItem`: start from `ctx.item`; absent →
   `{ ok: false, reason: "There is no current item here." }`; then walk `ref.path`.

4. Path walking, one segment at a time, starting from a `RuntimeValue`:
   - current value is a `null` primitive → stop, `{ ok: true, value: null primitive }`
     (reading a property of nothing is nothing, per the PRD).
   - current value is not an entity → `{ ok: false, reason: \`"${segment}" is not something this value has.\` }`
   - `ctx.catalog.getEntity(current.of)` missing → `{ ok: false, reason: ... }`
   - the segment is not in that entity's `properties` → `{ ok: false, reason: ... }`
   - otherwise `const row = await ctx.loader.load(current.of, current.id)`;
     `null` row → `{ ok: false, reason: \`The ${current.of} this refers to could not be read.\` }`
   - `fromColumn(properties[segment], row[segment])` becomes the new current value.

5. `resolveValue` dispatches on `value.kind`: `"literal"` → `fromLiteral`,
   `"ref"` → `resolveRef`, `"item"` → `resolveItem`.

6. Tests using a hand-written fake `EntityLoader` (a `Map` of rows) and
   `createFixtureCatalog()`: a one-segment path off a preloaded entity; a
   two-segment path crossing into a second record; a load returning `null`
   producing `ok: false` with a readable reason; a path through a `null` column
   short-circuiting to a `null` primitive rather than failing; a ref to a node
   that never ran.

**Verify:**

```bash
pnpm --filter @carbon/workflows test
# Expected: resolve.test.ts passes
```

**Out of scope:** caching (that lives in the job-side loader, Task 11); loading
by table name (the loader takes an entity name, not a table).

---

## Task 4: Operator comparison and clause evaluation

**Depends on:** Task 2

**Files:**

- Create: `packages/workflows/src/runtime/compare.ts`
- Create: `packages/workflows/src/runtime/compare.test.ts`

**Steps:**

1. Implement:

   ```ts
   export function compare(left: RuntimeValue, operator: Operator, right: RuntimeValue): boolean
   export async function evaluateClauses(
     clauses: Clause[],
     combinator: Combinator,
     ctx: RuntimeContext
   ): Promise<{ ok: true; passed: boolean } | { ok: false; reason: string }>
   ```

2. `compare` semantics — exactly these, no coercion between kinds:
   - `number`: `eq neq gt gte lt lte` numerically.
   - `date`: parse both to epoch milliseconds; compare numerically.
   - `string`: `eq` / `neq` are **case-sensitive**; `contains`, `startsWith`,
     `endsWith` are **case-insensitive** (lowercase both sides first).
   - `boolean` and `null`: `eq` / `neq` only.
   - `entity`: `eq` / `neq` compare `of` **and** `id`.
   - `list` + `contains`: true when any item equals the right side under the
     same `eq` rule for the item's kind.
   - Either side being a `null` primitive: `eq` is true only when both are null;
     `neq` is its negation; every ordering and text operator is **false**. Never
     throw.
   - An operator that does not apply to the left value's kind returns `false`
     (validation prevents this reaching the engine; the engine must not crash if
     it does).

3. `evaluateClauses`: resolve each clause's `left` and `right` with
   `resolveValue`. **Any** unresolved operand aborts immediately with
   `{ ok: false, reason }` carrying that operand's reason — it does not count as
   a failed clause. Otherwise combine with `combinator` (`"and"` → every,
   `"or"` → some), left to right. An empty clause list passes.

4. Tests: one per row of the semantics list above, plus a two-clause `or` where
   the first clause passes, plus an unresolvable operand producing `ok: false`.

**Verify:**

```bash
pnpm --filter @carbon/workflows test
# Expected: compare.test.ts passes
```

**Out of scope:** short-circuit evaluation as an optimisation — resolve operands
in order and stop on the first unresolved one, but do not skip resolving the
right side of an `or` whose left already passed (a customer debugging a run
needs both resolved values recorded).

---

## Task 5: The Condition executor

**Depends on:** Tasks 3, 4

**Files:**

- Create: `packages/workflows/src/runtime/condition.ts`
- Create: `packages/workflows/src/runtime/condition.test.ts`

**Steps:**

1. Implement `export const conditionExecutor: NodeExecutor<ConditionNode>` with
   `permission: () => undefined`.

2. `execute`:
   - Walk `node.data.paths` in stored order.
   - A path of `kind === "else"` passes without evaluating clauses.
   - Otherwise `evaluateClauses(path.clauses, path.combinator, ctx)`.
     `{ ok: false }` → return `{ status: "Skipped", reason }` **immediately**;
     do not fall through to later paths.
   - First passing path wins: return
     `{ status: "Succeeded", outputs: {}, handle: path.id, branchTaken: path.id }`.
   - No path passed: return
     `{ status: "Succeeded", outputs: {}, handle: null, branchTaken: "none" }`.

3. Tests: the `if` branch winning; an `else-if` winning when the `if` fails; the
   `else` winning; no match and no else giving `handle: null` and
   `branchTaken: "none"`; an unresolvable operand in the first path giving
   `Skipped` **and not** reaching the `else`.

**Verify:**

```bash
pnpm --filter @carbon/workflows test
# Expected: condition.test.ts passes
```

**Out of scope:** writing the step row (Task 12) or following the handle (Task 9).

---

## Task 6: The Filter executor

**Depends on:** Tasks 1, 3, 4

**Files:**

- Create: `packages/workflows/src/runtime/filter.ts`
- Create: `packages/workflows/src/runtime/filter.test.ts`

**Steps:**

1. Implement `export const filterExecutor: NodeExecutor<FilterNode>` with
   `permission: () => undefined`.

2. `execute`:
   - `node.data.source` undefined → `{ status: "Skipped", reason: "No list was chosen to filter." }`.
   - `resolveRef(node.data.source, ctx)`; `{ ok: false }` →
     `{ status: "Skipped", reason }`.
   - The resolved value is not a list →
     `{ status: "Skipped", reason: "This step expected a list." }`.
   - For each item, evaluate the clauses with a context whose `item` is that
     item (`{ ...ctx, item }`). `ok: true && passed` → keep. `ok: false` →
     **drop the item** and increment a `dropped` counter; never abort the node.
   - Return
     `{ status: "Succeeded", outputs: { [DEFAULT_OUTPUT]: <the narrowed list> }, handle: DEFAULT_HANDLE }`.
     The narrowed list keeps the source's `of` and the source order.

3. Report the counts through the result's `summary` field (added in Task 2), which
   the orchestrator writes to the step row's `statusReason`. Export
   `export function filterSummary(kept: number, total: number, unresolved: number): string`
   returning e.g. `"Kept 2 of 5; 1 could not be checked."` and set it as
   `summary`. Do not add a column and do not overload `branchTaken`.

4. Tests: 5 jobs narrowed to 2 by `item.dueDate < <date>`, order preserved; an
   item whose clause operand cannot be resolved being dropped while the rest
   survive; a non-list source giving `Skipped`.

**Verify:**

```bash
pnpm --filter @carbon/workflows test
# Expected: filter.test.ts passes
```

**Out of scope:** batch mode (a filter is one step, not one per item).

---

## Task 7: Batch planning and item keys

**Depends on:** Task 2

**Files:**

- Create: `packages/workflows/src/runtime/batch.ts`
- Create: `packages/workflows/src/runtime/batch.test.ts`

**Steps:**

1. Implement:

   ```ts
   /** Slices a list to MAX_LIST_ITEMS and reports what was left out. */
   export function planBatch(list: RuntimeValue): { items: RuntimeValue[]; dropped: number }
   /** The stable key a step row is claimed under. Never the position in the list. */
   export function itemKeyFor(value: RuntimeValue): string
   ```

2. `itemKeyFor`: an entity value → its `id`. Anything else → `"h:"` plus a
   64-bit FNV-1a hash, as 16 lowercase hex characters, of
   `JSON.stringify(value)` with object keys written in sorted order. Implement
   the hash inline with `BigInt` — **do not** import `node:crypto`; this package
   is also built for the browser by the phase-7 builder.

3. Tests: a 150-item list planning to 100 items with `dropped === 50`; two
   entity values with the same id producing the same key; two primitives with
   the same value producing the same key; different values producing different
   keys; the key being independent of position.

**Verify:**

```bash
pnpm --filter @carbon/workflows test
# Expected: batch.test.ts passes
```

**Out of scope:** running the batch (there is no batchable node until phase 5);
parallelism across items.

---

## Task 8: Export the runtime from `@carbon/workflows`

**Depends on:** Tasks 2–7

**Files:**

- Create: `packages/workflows/src/runtime/index.ts`
- Modify: `packages/workflows/src/index.ts` — re-export the runtime barrel

**Steps:**

1. `runtime/index.ts` re-exports every public symbol from `types.ts`,
   `values.ts`, `resolve.ts`, `compare.ts`, `condition.ts`, `filter.ts`,
   `batch.ts`.

2. In `src/index.ts`, follow the file's existing style: explicit named
   re-exports, types in the `export type { ... }` block and values in the
   `export { ... }` block. Do **not** add a bare `export *`.

3. Add a `runtime` entry to the package's `AGENTS.md` file map if that file
   lists directories (check first; if it does not, skip).

**Verify:**

```bash
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: no output (success)
pnpm exec turbo run typecheck --filter=erp
# Expected: passes — this is the TS2589 canary for the widened value union
```

**Out of scope:** exporting anything from `src/catalog/labels.generated.ts`.

---

## Task 9: The pure graph walker

**Depends on:** none

**Files:**

- Create: `packages/jobs/src/workflows/engine/walk.ts`
- Create: `packages/jobs/src/workflows/engine/walk.test.ts`
- Copy from (precedent): `packages/jobs/src/workflows/matcher.test.ts` for the
  test idiom (explicit vitest imports, small fixture builders)

**Steps:**

1. Implement, with no I/O and no imports beyond `@carbon/workflows` types:

   ```ts
   export const MAX_NODE_EXECUTIONS = 500;

   export function findTriggerNode(definition: WorkflowDefinition): TriggerNode | undefined;

   /** Target node ids for one handle, in stored edge order. */
   export function outgoing(
     definition: WorkflowDefinition,
     nodeId: string,
     handle: string | null
   ): string[];

   export interface WalkState {
     frontier: string[];
     executed: Set<string>;
     sequence: number;
   }

   export function createWalkState(definition: WorkflowDefinition): WalkState;

   /** Pops the next node id to execute, or undefined when the walk is done. */
   export function nextNode(state: WalkState): string | undefined;

   /** Records an execution and appends the nodes its handle leads to. */
   export function advance(
     state: WalkState,
     definition: WorkflowDefinition,
     nodeId: string,
     handle: string | null
   ): void;
   ```

2. `createWalkState` seeds the frontier from the trigger node's `DEFAULT_HANDLE`
   targets. No trigger node → an empty frontier.

3. `outgoing` returns `[]` when `handle` is `null`.

4. `advance` adds `nodeId` to `executed` and increments `sequence`.

5. The caller is responsible for the already-executed check; expose
   `export function alreadyExecuted(state: WalkState, nodeId: string): boolean`.

6. Tests: breadth-first order across a fan-out of three; edge order respected;
   a condition handle selecting only its own branch; a node reachable from two
   branches appearing once in the executed set and `alreadyExecuted` returning
   true on the second arrival; `outgoing` with `handle: null` returning `[]`.

**Verify:**

```bash
pnpm --filter @carbon/jobs test
# Expected: walk.test.ts passes
```

**Out of scope:** executing anything; the 500 cap is enforced by the caller in
Task 14, this file only exports the constant.

---

## Task 10: Owner connection, claims and the permission check

**Depends on:** none

**Files:**

- Create: `packages/jobs/src/workflows/engine/owner.ts`
- Create: `packages/jobs/src/workflows/engine/owner.test.ts`
- Copy from (precedent): the permission decision in
  `packages/auth/src/services/auth.server.ts:326-355` (the `"0"` wildcard
  handling is load-bearing)

**Steps:**

1. Implement:

   ```ts
   import { getClaims, makePermissionsFromClaims, type Permission } from "@carbon/auth";
   import { getUserScopedClient } from "@carbon/auth/client.server";

   export type OwnerPermissions = Record<string, Permission>;

   /** A fresh five-minute connection as the owner. Call inside every step, never once per run. */
   export async function getOwnerClient(ownerId: string, runId: string);

   export async function readOwnerPermissions(
     client: SupabaseClient<Database>,
     ownerId: string,
     companyId: string
   ): Promise<OwnerPermissions | null>;

   /** Pure. Exported for tests. */
   export function hasPermission(
     permissions: OwnerPermissions,
     module: string,
     action: "view" | "create" | "update" | "delete",
     companyId: string
   ): boolean;
   ```

2. `getOwnerClient` is exactly
   `getUserScopedClient(ownerId, { workflowRunId: runId })`. The
   `workflowRunId` is **not optional** — without it the write is untagged and
   the phase-3 loop guards go blind.

3. `readOwnerPermissions` calls `getClaims(client, ownerId, companyId)` and
   passes `data` through `makePermissionsFromClaims`. A null or errored result
   returns `null`; the caller turns that into a failed run, never into "no
   permissions, continue".

4. `hasPermission` mirrors the precedent: the module must be present, and the
   action's array must include `"0"` (the all-companies wildcard) **or**
   `companyId`.

5. Tests cover `hasPermission` only (the other two need a live database):
   wildcard grant; exact-company grant; a different company denied; a missing
   module denied; a missing action array denied.

**Verify:**

```bash
pnpm --filter @carbon/jobs test
# Expected: owner.test.ts passes
pnpm --filter @carbon/jobs exec tsc --noEmit
# Expected: no output (success)
```

**Out of scope:** the `permissions:${userId}` Redis cache in
`apps/erp/app/modules/users/users.server.ts` — it is keyed by user only and its
`role` field is cross-company, so it must **not** be used for this check.

---

## Task 11: The entity loader over the owner's connection

**Depends on:** Tasks 3, 8

**Files:**

- Create: `packages/jobs/src/workflows/engine/loader.ts`

**Steps:**

1. Implement:

   ```ts
   export function createEntityLoader(params: {
     client: SupabaseClient<Database>;
     companyId: string;
     cache: Map<string, Record<string, unknown> | null>;
   }): EntityLoader;
   ```

2. `load(entity, id)`:
   - cache hit (including a cached `null`) → return it.
   - `REGISTRY_ENTRIES[entity]` missing → cache and return `null`.
   - otherwise
     `client.from(table).select("*").eq("id", id).eq("companyId", companyId).maybeSingle()`,
     where `table` is `REGISTRY_ENTRIES[entity].table`.
   - an error or no row → cache `null` and return `null`. Access denied by
     row-level security is indistinguishable from absent, and that is correct —
     the node stops with a reason either way.

3. Export a helper that seeds the cache from a record trigger:

   ```ts
   export function seedTriggerRows(
     cache: Map<string, Record<string, unknown> | null>,
     eventId: string,
     trigger: RunTrigger,
     catalog: WorkflowCatalog
   ): void;
   ```

   For a `kind: "record"` trigger, the event's `outputs` name which of
   `record` / `before` / `after` exist and what entity each is; put each whole
   row into the cache under `${entityName}:${row.id}`. `before` and `after` are
   the same record id, so seed `record`/`after` last — the current row must win.

4. The client passed in is **always** an owner-scoped client. If you find
   yourself passing `getJobDatabaseClient()` here, STOP and report — that would
   read past row-level security.

**Verify:**

```bash
pnpm --filter @carbon/jobs exec tsc --noEmit
# Expected: no output (success)
```

**Out of scope:** caching across Inngest steps; batching loads.

---

## Task 12: The step ledger

**Depends on:** none

**Files:**

- Create: `packages/jobs/src/workflows/engine/ledger.ts`
- Copy from (precedent): the Kysely insert with a named constraint in
  `packages/jobs/src/workflows/matcher.ts:191-213`

**Steps:**

1. Implement, all taking a `JobDatabase` from `getJobDatabaseClient()`:

   ```ts
   export type StepClaim =
     | { claimed: true; stepRunId: string }
     | { claimed: false; existing: { status: string; output: unknown; branchTaken: string | null } | null };

   export async function claimStep(db: JobDatabase, params: {
     runId: string; companyId: string; nodeId: string; nodeType: string;
     itemKey: string; sequence: number;
   }): Promise<StepClaim>;

   export async function settleStep(db: JobDatabase, params: {
     stepRunId: string; companyId: string;
     status: "Succeeded" | "Failed" | "Skipped";
     statusReason?: string | null; error?: string | null;
     input?: unknown; output?: unknown; branchTaken?: string | null;
     startedAt: string;
   }): Promise<void>;

   /** Marks rows this run left mid-flight, so a lost action is visible rather than silent. */
   export async function failInterruptedSteps(
     db: JobDatabase, runId: string, companyId: string
   ): Promise<number>;
   ```

2. `claimStep` inserts with `status: "Running"` and `startedAt: new Date().toISOString()`,
   then `.onConflict((oc) => oc.constraint("workflowStepRun_idempotency_key").doNothing())`
   and `.returning(["id"])`. Zero rows back → select the existing row by
   `(runId, companyId, nodeId, itemKey)` and return it as `existing`.

3. `settleStep` sets `completedAt` and computes
   `durationMs` from `startedAt`. Use `statusReason` for a skip reason and
   `error` for a failure message — they are separate columns and must not be
   conflated.

4. `failInterruptedSteps` updates every row for this run whose `status` is
   `'Running'` to `'Failed'` with
   `error: "This step was interrupted and did not finish."`, returning the count.

**Verify:**

```bash
pnpm --filter @carbon/jobs exec tsc --noEmit
# Expected: no output (success). Kysely must accept every column name — if it
# rejects one, the generated types are stale; STOP and report rather than casting.
```

**Out of scope:** compaction and purge (phase 9).

---

## Task 13: Run status transitions

**Depends on:** none

**Files:**

- Create: `packages/jobs/src/workflows/engine/log.ts`

**Steps:**

1. Implement:

   ```ts
   export interface RunContext {
     run: { id: string; companyId: string; ownerId: string; workflowId: string;
            workflowVersionId: string; eventId: string; status: string };
     workflowActive: boolean;
     version: { formatVersion: number | null; nodes: unknown; edges: unknown } | null;
   }

   export async function loadRunContext(
     db: JobDatabase, runId: string, companyId: string
   ): Promise<RunContext | null>;

   /** Flips Queued → Running. Returns false when the row was not Queued (a double delivery). */
   export async function claimRun(db: JobDatabase, runId: string, companyId: string): Promise<boolean>;

   export async function finishRun(db: JobDatabase, params: {
     runId: string; companyId: string;
     status: "Succeeded" | "Failed" | "Skipped";
     statusReason?: string | null; error?: string | null; startedAt: string;
   }): Promise<void>;
   ```

2. `loadRunContext` is one query joining `workflowRun` to `workflow` (for
   `active`) and to `workflowVersion` on the run's **`workflowVersionId`** — never
   on `workflow.activeVersionId`. Scope every join by `companyId`.

3. `claimRun` is
   `UPDATE ... SET status='Running', startedAt=now() WHERE id=? AND companyId=? AND status='Queued' RETURNING id`,
   returning whether a row came back. This is the atomic double-delivery guard.

4. `finishRun` sets `completedAt` and `durationMs` from `startedAt`.

**Verify:**

```bash
pnpm --filter @carbon/jobs exec tsc --noEmit
# Expected: no output (success)
```

**Out of scope:** realtime broadcasting — it is already enabled on the table.

---

## Task 14: Engine orchestration

**Depends on:** Tasks 8, 9, 10, 11, 12, 13

**Files:**

- Create: `packages/jobs/src/workflows/engine/execute.ts`
- Create: `packages/jobs/src/workflows/engine/index.ts` (barrel)
- Copy from (precedent): `packages/jobs/src/inngest/functions/events/queue.ts`
  for the shape of a bounded step loop with suffixed step ids

**Steps:**

1. Export one function taking the Inngest `step` and `logger` plus the parsed
   payload:

   ```ts
   export async function executeWorkflowRun(params: {
     payload: { runId: string; companyId: string; workflowId: string;
                workflowVersionId: string; eventId: string; ownerId: string;
                sourceEventId: string; trigger: RunTrigger };
     step: /* Inngest step tools */;
     logger: /* Inngest logger */;
   }): Promise<{ runId: string; status: string; steps: number }>;
   ```

2. **Step `"load"`** — `getJobDatabaseClient()` inside the step, then:
   - `loadRunContext`; null → throw `NonRetriableError("Workflow run not found")`.
   - `workflowActive === false` → `finishRun` with `Skipped` and
     `"This workflow was switched off before the run started."`; return a
     terminal marker so the handler stops.
   - `readWorkflowVersion(context.version)` → `ok: false` → `finishRun` with
     `Failed` and the read failure's message.
   - `claimRun`; false → return a terminal marker (a double delivery; do not
     touch the run).
   - Return the definition plus `startedAt`, as plain JSON.

3. **Step `"permissions"`** — mint `getOwnerClient(ownerId, runId)` inside the
   step, `readOwnerPermissions`; null → finish the run `Failed` with
   `"The permissions for the owner of this workflow could not be read."`.
   Then check the trigger event's declared permission:
   `catalog.getEvent(eventId)?.permission`, action `"view"`. Missing →
   finish the run `Failed` with
   `` `The owner of this workflow no longer has access to ${title-cased module}.` ``.
   Return the permission map as the step result.

4. **The walk** — build the catalog once with `createEventCatalog()`, a fresh
   `Map` for the entity cache, seed it with `seedTriggerRows`, and populate the
   trigger node's outputs in `ctx.outputs` from `payload.trigger` (a record
   trigger yields `record` / `before` / `after` entity values built from the
   event's declared `outputs`; a moment trigger yields one entity value per
   declared output, taking each id from `trigger.outputs[name].id`).

   Then loop:

   ```
   while ((nodeId = nextNode(state)) !== undefined) {
     if (executions >= MAX_NODE_EXECUTIONS) → finish Failed "This workflow ran too many steps."
     const result = await step.run(`node:${nodeId}`, () => runOneNode(...));
     rebuild ctx.outputs from result.outputs
     advance(state, definition, nodeId, result.handle)
   }
   ```

   `runOneNode` does, in order: mint the owner client; build the loader;
   `claimStep`; if not claimed → settle nothing and return a `Skipped` marker
   with `"This step already ran in this run."` (reusing the existing row's
   handle and output when that row is terminal, so the walk continues
   correctly); otherwise check the node's declared permission, execute via the
   executor registry, `settleStep` (a `Skipped` result's `reason` and a
   `Succeeded` result's `summary` both go to `statusReason`; a `Failed` result's
   message goes to `error`), and return a JSON-safe result.

   An already-executed node (`alreadyExecuted`) is short-circuited **before**
   the step is created, and recorded through `claimStep`/`settleStep` in its own
   step so it appears in the run history.

5. Executor registry: `condition` → `conditionExecutor`, `filter` →
   `filterExecutor`; `lookup`, `entity` and `action` return
   `{ status: "Failed", error: "This kind of step is not available yet." }`.
   They cannot be activated today, so this is a defence, not a feature.

6. **Step `"finish"`** — `failInterruptedSteps`, then `finishRun` with `Failed`
   when any step failed, otherwise `Succeeded`.

7. Every `step.run` id must be deterministic. Never include a timestamp, a
   random value, or a counter that depends on wall-clock ordering.

**Verify:**

```bash
pnpm --filter @carbon/jobs exec tsc --noEmit
# Expected: no output (success)
pnpm --filter @carbon/jobs test
# Expected: existing tests still pass
```

**Out of scope:** running batch items (no batchable node exists until phase 5) —
but the loop must call `planBatch` / `itemKeyFor` for a node whose `data.batch`
is true, so the machinery is exercised by the executor registry rather than
written later.

---

## Task 15: Replace the Inngest stub

**Depends on:** Task 14

**Files:**

- Modify: `packages/jobs/src/inngest/functions/workflows/run.ts` — replace the
  stub body, add concurrency and idempotency, add `onFailure`
- Copy from (precedent): `packages/jobs/src/inngest/functions/tasks/assembly-plan.ts:32-53`
  for the `onFailure` shape and its status guard

**Steps:**

1. Keep the export name `workflowRunFunction`, the id `"workflow-run"` and the
   existing `runPayloadSchema` exactly as they are — `packages/jobs/src/inngest/index.ts`
   already registers this function and must not be edited.

2. Config becomes:

   ```ts
   {
     id: "workflow-run",
     retries: 3,
     idempotency: "event.data.runId",
     concurrency: [
       { limit: 10, key: "event.data.companyId" },
       { limit: 5, key: "event.data.workflowId" }
     ],
     onFailure: async ({ event, logger }) => { /* step 3 */ }
   }
   ```

3. `onFailure` opens `getJobDatabaseClient()` and updates the run to `Failed`
   with the error message, guarded by
   `.where("status", "in", ["Queued", "Running"])` so a settled run is never
   clobbered. Read the ids from `event.data.event.data` (Inngest wraps the
   original event in the failure payload — confirm the shape against
   `assembly-plan.ts`; if it differs, follow that file, not this plan).

4. The handler body is `return executeWorkflowRun({ payload, step, logger })`.

**Verify:**

```bash
pnpm --filter @carbon/jobs exec tsc --noEmit
# Expected: no output (success)
pnpm exec biome check packages/jobs packages/workflows
# Expected: no error-severity findings (pre-existing warnings elsewhere are fine)
```

**Out of scope:** editing `packages/jobs/src/inngest/index.ts`; changing the
event name or the payload schema.

---

## Task 16: Full verification

**Depends on:** Task 15

**Files:** none

**Steps:**

1. Run every command in the Verify block below and paste the real output — do
   not summarise or assert success without it.

2. Confirm the privileged-access boundary by grep:

   ```bash
   grep -rn "getCarbonServiceRole\|getJobDatabaseClient" packages/jobs/src/workflows/engine
   ```

   Hits are allowed **only** in `ledger.ts`, `log.ts`, and the `"load"` /
   `"finish"` steps of `execute.ts`. A hit anywhere else means a business read
   is bypassing the owner's permissions — STOP and report.

3. End-to-end checking needs a running stack and a seeded database. **Do not
   rebuild or reset the database.** Instead, write the manual script into
   `.ai/runs/2026-07-30-workflows-engine.md` for the user to run when they have
   the stack up: activate a workflow whose trigger is
   `purchaseOrder.orderTotal.changed` wired to a condition
   `record.orderTotal > 10000`, edit a purchase order's total, then read back
   the `workflowRun` and `workflowStepRun` rows and check the run reached
   `Succeeded` with `branchTaken` set. Report that this step is pending the
   user rather than claiming it passed.

**Verify:**

```bash
pnpm --filter @carbon/workflows test
# Expected: all suites pass
pnpm --filter @carbon/jobs test
# Expected: all suites pass
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: no output
pnpm --filter @carbon/jobs exec tsc --noEmit
# Expected: no output
pnpm exec turbo run typecheck --filter=erp
# Expected: passes (the TS2589 canary)
pnpm exec biome check packages/jobs packages/workflows
# Expected: no error-severity findings
pnpm run check:workflow-catalog
# Expected: exits 0 — the catalog is untouched but must still validate
```

**Out of scope:** running `pnpm run build` (slow, and nothing here changes the
build graph); a whole-repo typecheck (it OOMs — always scope with `--filter`).

---

## Task 17: Document the engine

**Depends on:** Task 15

**Files:**

- Create: `.claude/rules/workflow-engine.md`
- Modify: `AGENTS.md` — add the engine rule to the Workflows row of the Task Router
- Modify: `packages/workflows/AGENTS.md` — the `src/runtime/` directory and its rules
- Modify: `packages/jobs/AGENTS.md` — the engine's act-as-owner rule
- Copy from (precedent): `.claude/rules/workflow-matcher.md` (front-matter
  `paths:` glob, structure, tone)

**Steps:**

1. `.claude/rules/workflow-engine.md` front-matter targets
   `packages/jobs/src/workflows/engine/**` and
   `packages/workflows/src/runtime/**`.

2. Content it must state, because each is a rule someone will otherwise break:
   the owner-scoped client is minted **per step** and always carries
   `workflowRunId`; the only privileged access is the two run-log tables;
   claim-before-acting is at-most-once on purpose; `itemKey` is never a list
   position; a node runs once per run and a second arrival is a `Skipped` row;
   comparison semantics live in `runtime/compare.ts` and must not be
   re-implemented in the builder.

3. If anything in this phase contradicted a source document, add an entry to
   `.ai/lessons.md` in the `Context → Problem → Rule → Applies to` format.

**Verify:**

```bash
pnpm exec biome check .claude/rules/workflow-engine.md 2>/dev/null || true
ls -la .claude/rules/workflow-engine.md
# Expected: the file exists
grep -n "workflow-engine" AGENTS.md
# Expected: one hit in the Workflows row of the Task Router
```

**Out of scope:** rewriting `.claude/rules/workflow-matcher.md`.
