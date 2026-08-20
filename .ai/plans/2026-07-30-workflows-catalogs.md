# Workflows Phase 5 (actions, entity operations, lookups) — implementation plan

**Spec:** `.ai/specs/2026-07-30-workflows-catalogs.md`
**Research:** `.ai/research/workflows-phase5-catalogs.md`
**Branch:** `feat/automation`

Read the spec before starting. Read `packages/workflows/AGENTS.md`,
`packages/jobs/AGENTS.md`, `.claude/rules/workflow-engine.md`,
`.claude/rules/workflow-event-catalog.md` and `.ai/lessons.md`.

Four rules that apply to every task:

- `packages/workflows/src/runtime/` and `src/definition/` are **pure** — no I/O, no Supabase,
  no `@carbon/database` at runtime (type-only import is fine), no `node:crypto`, no BigInt
  literals. `apps/erp` compiles this package's source at ES2019.
- Every business read and write in `packages/jobs/src/workflows/` goes through
  `getOwnerClient(ownerId, runId)`. `getJobDatabaseClient()` is allowed **only** for
  `workflowRun` / `workflowStepRun`.
- Never hand-edit a `*.generated.ts`. Run `pnpm run generate:workflow-catalog`.
- Keep comments to one line, only where they earn their place.

## Progress

- [ ] Task 1: Add `RequiredPermission`, `UNKNOWN_INPUT` and catalog permission fields
- [ ] Task 2: Add the `template` value form and its renderer
- [ ] Task 3: Give Lookup its own match shape and bump the format version to 2
- [ ] Task 4: Widen `NodeExecutor.permission` to module + action
- [ ] Task 5: Report undeclared inputs and `requireOneOf` groups
- [ ] Task 6: Add the `write` allowlist to the entity registry
- [ ] Task 7: Write the hand-written action and operation declarations
- [ ] Task 8: Build actions and operations in `build.ts`
- [ ] Task 9: Emit `actions.generated.ts` from the generator script
- [ ] Task 10: Back the catalog with real actions and operations
- [ ] Task 11: Extend `check-workflow-catalog.ts`
- [ ] Task 12: Add the `WorkflowServices` port to `RuntimeContext`
- [ ] Task 13: Write the Entity executor
- [ ] Task 14: Write the Lookup executor
- [ ] Task 15: Write the Action executor
- [ ] Task 16: Register the three executors
- [ ] Task 17: Migration — `workflow.webhookSecret`
- [ ] Task 18: Regenerate database types
- [ ] Task 19: Add the dispatcher injection seam and wire it in the ERP app
- [ ] Task 20: Implement the shared update executor
- [ ] Task 21: Implement the create actions
- [ ] Task 22: Add the payload-text notification kind
- [ ] Task 23: Implement the notify action
- [ ] Task 24: Implement the signed webhook action and URL guard
- [ ] Task 25: Implement the entity operations
- [ ] Task 26: Implement the lookup search
- [ ] Task 27: Assemble `WorkflowServices` and inject it into the engine
- [ ] Task 28: Wire batch mode and record step inputs
- [ ] Task 29: Add the ERP notification row and link cases
- [ ] Task 30: End-to-end verification
- [ ] Task 31: Sync AGENTS.md, rules and lessons

## Dependencies

```
1 → 2 → 3 → 4 → 5          contract changes, strictly in order
5 → 6 → 7 → 8 → 9 → 10 → 11   catalog, strictly in order
10 → 12 → {13, 14, 15} → 16   executors; 13/14/15 are independent of each other
17 → 18                        migration then regen, before anything typechecks against it
{18, 16} → 19 → {20, 21, 22, 24, 25, 26}   action implementations, independent of each other
22 → 23
{20, 21, 23, 24, 25, 26} → 27 → 28 → 29 → 30 → 31
```

Tasks 13, 14 and 15 may run as parallel subagents. Tasks 20, 21, 22, 24, 25 and 26 may run
as parallel subagents. Everything else is sequential.

---

## Task 1: Add `RequiredPermission`, `UNKNOWN_INPUT` and catalog permission fields

**Depends on:** none
**Files:**
- Modify: `packages/workflows/src/definition/issues.ts` — one new issue code
- Modify: `packages/workflows/src/definition/catalog.ts` — `RequiredPermission`, `permission`
  on `CatalogAction` and `CatalogOperation`, fixture updates
- Modify: `packages/workflows/src/index.ts` — export the new type

**Steps:**

1. In `issues.ts`, add `| "UNKNOWN_INPUT"` to `WorkflowIssueCode`, after `"MISSING_INPUT"`.

2. In `catalog.ts`, add above `CatalogEvent`:

```ts
export type PermissionAction = "view" | "create" | "update" | "delete";

/** What the owner must hold for a node to run. */
export interface RequiredPermission {
  /** Lowercase permission module, e.g. "purchasing". */
  module: string;
  action: PermissionAction;
}
```

3. Add `permission: RequiredPermission;` to `CatalogAction` and to `CatalogOperation`.
   Both are required, not optional — an entry with no declared permission is a hole in the
   gate. Leave `CatalogEvent.permission` exactly as it is (a bare module string); it is read
   by `execute.ts` at `"view"` and changing it is out of scope.

4. Add `requireOneOf?: string[][];` to `CatalogAction`, documented as
   `/** Each group needs at least one of its input names supplied. */`.

5. Update the three fixtures in `FIXTURE_ACTIONS` and the one in `FIXTURE_OPERATIONS` so they
   compile: `notify` → `{ module: "users", action: "view" }`, `updatePart` →
   `{ module: "parts", action: "update" }`, `createIssue` →
   `{ module: "quality", action: "create" }`, `job.totalScrap` →
   `{ module: "production", action: "view" }`.

6. In `packages/workflows/src/index.ts`, add `PermissionAction` and `RequiredPermission` to
   the existing `export type { ... } from "./definition"` block (keep it alphabetical, as the
   file already is).

**Verify:**
```bash
pnpm --filter @carbon/workflows exec tsgo --noEmit
pnpm --filter @carbon/workflows test
# Expected: tsgo prints nothing and exits 0; vitest reports all files passed.
```

**Out of scope:** `CatalogEvent`, `execute.ts`, the executors. Task 4 consumes these types.

---

## Task 2: Add the `template` value form and its renderer

**Depends on:** Task 1
**Files:**
- Modify: `packages/workflows/src/definition/types.ts` — `templateSchema`, add to
  `valueOrRefSchema`
- Modify: `packages/workflows/src/definition/nodes.ts` — `checkInputs` accepts a template
  where a string is declared
- Create: `packages/workflows/src/runtime/template.ts`
- Create: `packages/workflows/src/runtime/template.test.ts`
- Modify: `packages/workflows/src/runtime/resolve.ts` — resolve a template to a string value
- Modify: `packages/workflows/src/runtime/index.ts` and `packages/workflows/src/index.ts` —
  export `renderTemplate`

**Steps:**

1. In `types.ts`, after `literalSchema`, add:

```ts
export const templatePartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  variableRefSchema,
  itemRefSchema
]);
export type TemplatePart = z.infer<typeof templatePartSchema>;

/** Text with variables in it. Only ever valid where a string is expected. */
export const templateSchema = z.object({
  kind: z.literal("template"),
  parts: z.array(templatePartSchema).default([])
});
export type Template = z.infer<typeof templateSchema>;
```

2. Add `templateSchema` to the `valueOrRefSchema` discriminated union, after `itemRefSchema`.
   The existing `superRefine` only inspects `value.kind === "literal"`, so it needs no change.

3. In `nodes.ts` `checkInputs`, before the existing `ctx.typeOf` call, add:

```ts
if (supplied.kind === "template") {
  if (declaration.type.kind === "primitive" && declaration.type.of === "string") continue;
  issues.push({
    code: "TYPE_MISMATCH",
    nodeId: node.id,
    field: name,
    message: `"${name}" takes ${describeType(declaration.type)}, and a message can only be text.`
  });
  continue;
}
```

   A template's own parts are still walked by layer 5, because `values()` returns the whole
   `ValueOrRef` and the resolver in `validate.ts` sees it — **check this**: open
   `packages/workflows/src/definition/validate.ts`, find where it switches on `value.kind`,
   and add a `template` branch that resolves each part exactly as it resolves a bare ref or
   item, reporting the same codes. If the resolver has no such switch, STOP and report —
   do not improvise a second resolution path; the package guide says there is exactly one.

4. Create `runtime/template.ts`:

```ts
import type { Template } from "../definition/types";
import { resolveItem, resolveRef } from "./resolve";
import type { Resolution, RuntimeContext, RuntimeValue } from "./types";
import { isNull, primitiveValue } from "./values";

/** How one resolved value reads inside a sentence. */
export function renderValue(value: RuntimeValue): string {
  if (isNull(value)) return "";
  if (value.kind === "list") return value.items.map(renderValue).join(", ");
  if (value.kind === "entity") {
    const row = value.row;
    const readable = row?.readableId ?? row?.name ?? row?.id;
    return readable === undefined || readable === null ? value.id : String(readable);
  }
  return value.value === null ? "" : String(value.value);
}

/** An unresolvable part fails the whole template; a blank would be a silent lie. */
export async function renderTemplate(
  template: Template,
  ctx: RuntimeContext
): Promise<Resolution> {
  const pieces: string[] = [];
  for (const part of template.parts) {
    if (part.kind === "text") {
      pieces.push(part.text);
      continue;
    }
    const resolved =
      part.kind === "item" ? await resolveItem(part, ctx) : await resolveRef(part, ctx);
    if (!resolved.ok) return resolved;
    pieces.push(renderValue(resolved.value));
  }
  return { ok: true, value: primitiveValue("string", pieces.join("")) };
}
```

5. In `resolve.ts` `resolveValue`, add before the final `return resolveRef(...)`:

```ts
if (value.kind === "template") return renderTemplate(value, ctx);
```

   Import `renderTemplate` from `./template`. If this creates an import cycle
   (`template.ts` imports `resolve.ts`), move `renderValue` and `renderTemplate` into
   `resolve.ts` instead and keep `template.ts` as a re-export — do not add a lazy require.

6. Write `template.test.ts` covering: text-only renders verbatim; a ref between two text
   parts substitutes; a null value renders as an empty string; an entity with a loaded `row`
   renders its `readableId`; an unresolvable ref returns `{ok: false}` with the resolver's
   own reason.

7. Export `renderTemplate` and `renderValue` from `runtime/index.ts` and the package root,
   and export `Template` / `TemplatePart` types from `definition/index.ts` and the root.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
pnpm --filter @carbon/workflows exec tsgo --noEmit
pnpm exec biome check packages/workflows
# Expected: all tests pass including the new template.test.ts; tsgo silent; biome reports
# no error-severity findings (pre-existing warnings elsewhere in the repo are fine).
```

**Out of scope:** the builder UI for templates (phase 8). No catalog entry uses a template
yet — Task 7 is the first.

---

## Task 3: Give Lookup its own match shape and bump the format version to 2

**Depends on:** Task 2
**Files:**
- Modify: `packages/workflows/src/definition/types.ts` — `lookupMatchSchema`
- Modify: `packages/workflows/src/definition/schema.ts` — lookup `data.match`,
  `CURRENT_DEFINITION_FORMAT_VERSION`
- Modify: `packages/workflows/src/definition/normalize.ts` — the v1 → v2 upgrade
- Modify: `packages/workflows/src/definition/nodes.ts` — the `lookup` entry
- Modify: `packages/workflows/src/definition/normalize.test.ts`,
  `schema.test.ts`, `validate.test.ts`

**Steps:**

1. In `types.ts`, after `clauseSchema`, add:

```ts
/** A lookup names a property of the record it is searching, not a value on both sides. */
export const lookupMatchSchema = z.object({
  field: z.string().min(1),
  operator: operatorSchema,
  value: valueOrRefSchema
});
export type LookupMatch = z.infer<typeof lookupMatchSchema>;
```

2. In `schema.ts`, change `lookupNode.data.match` to
   `z.array(lookupMatchSchema).default([])`, and set
   `export const CURRENT_DEFINITION_FORMAT_VERSION = 2;`.

3. In `normalize.ts`, inside the private `migrateDefinition` (which runs on **raw JSON
   before** the current-schema parse), add the v1 → v2 step: for every node with
   `type === "lookup"`, replace `data.match` with `[]`, then set `formatVersion` to 2.
   Nothing meaningful is discarded — no lookup can be activated today. Keep the existing
   pass-through for documents already at 2.

4. Rewrite the `lookup` entry in `NODE_KINDS`:
   - `values: (node) => node.data.match.map((m, index) => ({ value: m.value, field: `match.${index}.value` }))`
   - `checkTypes`: for each match rule, read the target entity from
     `ctx.catalog.getEntity(node.data.entity)`; if absent return `[]` (`configured` already
     reports it). Look up `entity.properties[rule.field]`; when absent push
     `{code: "UNKNOWN_INPUT", nodeId, field: `match.${i}.field`, message: `A ${entity.name} has no "${rule.field}".`}`.
     Otherwise check `operatorsForType(propertyType).includes(rule.operator)` with the same
     `TYPE_MISMATCH` message shape `checkClauses` uses, then check the resolved type of
     `rule.value` against the property type with `typesEqual`, allowing the same
     `list` + `contains` narrowing `checkClauses` does.
   - Leave `handles`, `outputs`, `loopList`, `configured` and `checkConfig` unchanged.

5. Update the three test files: any fixture building a lookup `match` from `left/right`
   clauses moves to `field/operator/value`. Add a `normalize.test.ts` case asserting a stored
   v1 document containing a lookup with a two-sided clause opens as v2 with `match: []` and
   does not throw.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: all tests pass; the new normalize case is listed.
```

**Out of scope:** the executor (Task 14) and the query builder (Task 26).

---

## Task 4: Widen `NodeExecutor.permission` to module + action

**Depends on:** Task 3
**Files:**
- Modify: `packages/workflows/src/runtime/types.ts` — the `NodeExecutor` contract
- Modify: `packages/workflows/src/runtime/condition.ts`, `filter.ts` — signature only
- Modify: `packages/jobs/src/workflows/engine/execute.ts` — the gate at lines ~86-91
- Modify: `packages/jobs/src/workflows/engine/owner.ts` — reuse the shared type

**Steps:**

1. In `runtime/types.ts`, import `RequiredPermission` from `../definition/catalog` and change
   the contract to:

```ts
export interface NodeExecutor<N extends WorkflowNode> {
  /** What the owner must hold; undefined when the node touches nothing. */
  permission(node: N, catalog: WorkflowCatalog): RequiredPermission | undefined;
  execute(node: N, ctx: RuntimeContext): Promise<NodeResult>;
}
```

2. `condition.ts` and `filter.ts` keep `permission: () => undefined` — no change needed, but
   confirm they still typecheck.

3. In `owner.ts`, delete the local `export type PermissionAction = ...` and re-export the one
   from `@carbon/workflows` instead, so there is a single definition:
   `export type { PermissionAction } from "@carbon/workflows";`. Leave `hasPermission`'s
   signature alone.

4. In `execute.ts` `runExecutor`, replace the module-only gate with:

```ts
const required = executor.permission(node, catalog);
if (
  required !== undefined &&
  !hasPermission(args.permissions, required.module, required.action, payload.companyId)
) {
  return { status: "Failed", error: noAccess(required.module) };
}
```

   Leave the run-start trigger check at `"view"` untouched — `CatalogEvent.permission` is
   still a bare module string.

**Verify:**
```bash
pnpm --filter @carbon/workflows exec tsgo --noEmit
pnpm --filter @carbon/jobs typecheck
pnpm --filter @carbon/jobs test
# Expected: all silent / passing. If `packages/jobs` tests reference `permission()` returning
# a string, update those fixtures in the same task.
```

**Out of scope:** anything that returns a non-undefined permission — that arrives with the
executors in Tasks 13-15.

---

## Task 5: Report undeclared inputs and `requireOneOf` groups

**Depends on:** Task 4
**Files:**
- Modify: `packages/workflows/src/definition/nodes.ts` — `checkInputs`, action `checkConfig`
- Modify: `packages/workflows/src/definition/validate.test.ts`

**Steps:**

1. At the end of `checkInputs`, before `return issues`, add:

```ts
for (const name of Object.keys(inputs)) {
  if (declared[name] !== undefined) continue;
  issues.push({
    code: "UNKNOWN_INPUT",
    nodeId: node.id,
    field: name,
    message: `"${name}" is not something this step can set.`
  });
}
```

   This is what stops a definition quietly carrying a field the update executor would drop.

2. In the `action` entry's `checkConfig`, after the existing batch check, add the
   `requireOneOf` check:

```ts
const action = ctx.catalog.getAction(node.data.action);
for (const group of action?.requireOneOf ?? []) {
  if (group.some((name) => node.data.inputs[name] !== undefined)) continue;
  return [
    incomplete(
      node,
      group[0],
      `This step needs at least one of: ${group.join(", ")}.`
    )
  ];
}
```

3. Add two `validate.test.ts` cases: an action node carrying an input the catalog does not
   declare reports exactly one `UNKNOWN_INPUT`; an action whose catalog entry has
   `requireOneOf: [["user", "role"]]` and neither supplied reports one `INCOMPLETE_CONFIG`.
   Extend `createFixtureCatalog`'s `notify` fixture with
   `requireOneOf: [["recipient", "message"]]` only if a fixture is needed — prefer adding a
   dedicated fixture action so existing tests do not shift.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all pass, including the two new cases. If pre-existing tests now report an extra
# UNKNOWN_INPUT, that is a real finding — fix the fixture, not the check.
```

**Out of scope:** the entity node (its inputs come from an operation and the same
`checkInputs` covers it automatically).

---

## Task 6: Add the `write` allowlist to the entity registry

**Depends on:** Task 5
**Files:**
- Modify: `packages/workflows/src/catalog/build.ts` — `WritableColumnLike`, `RegistryEntry`,
  `validateCatalogInputs`
- Modify: `packages/workflows/src/catalog/entities.ts` — `EntityEntry`, ten `write` blocks
- Modify: `packages/workflows/src/catalog/build.test.ts`

**Steps:**

1. In `build.ts`, add beside `WatchedColumnLike`:

```ts
export interface WritableColumnLike {
  label: string;
  /** Registry entity this column points at; needed only when the schema has no fk note. */
  ref?: string;
}
```

   and add to `RegistryEntry`:

```ts
  /** Inert columns a workflow may set. Unrelated to `watch`; the default is excluded. */
  write?: Record<string, WritableColumnLike | undefined>;
```

2. In `build.ts`, add a module constant beside `DROPPED_COLUMNS`:

```ts
/** Identity and audit columns a workflow may never set. */
const UNWRITABLE_COLUMNS = new Set([
  "id",
  "companyId",
  "createdBy",
  "createdAt",
  "updatedBy",
  "updatedAt"
]);
```

3. Extend `validateCatalogInputs` with a `write` loop mirroring the existing `watch` loop,
   inside the same `for (const [name, entry] of Object.entries(registry))`:
   - column missing from `definition.properties` →
     `Entity "${name}" declares writable column "${column}", which does not exist on table "${entry.table}".`
   - column in `DROPPED_COLUMNS` or `UNWRITABLE_COLUMNS` →
     `Entity "${name}" declares writable column "${column}", which a workflow may never set.`
   - `ref` not a registry entity, and `ref` disagreeing with the schema's `<fk table='...'>`
     note — reuse the two messages the `watch` loop already produces, with "writable" in
     place of "watches".

4. In `entities.ts`, extend the `EntityEntry<T>` helper so `write` keys are bound to the
   table exactly as `watch` keys are:

```ts
interface EntityEntry<T extends TableName>
  extends Omit<RegistryEntry, "table" | "watch" | "write"> {
  table: T;
  watch?: { [C in ColumnOf<T>]?: WatchedColumnLike };
  write?: { [C in ColumnOf<T>]?: WritableColumnLike };
}
```

   Import `WritableColumnLike` alongside the existing type imports.

5. Add a `write` block to each of the ten triggerable entities, exactly as below. Add none to
   the five reference-only entries. **Every column name must be verified against
   `packages/database/src/swagger-docs-schema.ts` before writing it** — the `ColumnOf<T>`
   binding makes a wrong one a compile error, so run the typecheck after each entity rather
   than at the end. If a column below does not exist on its table, STOP and report which one
   — do not substitute a near-miss.

```ts
// purchaseOrder
write: {
  supplierReference: { label: "supplier reference" },
  orderDate: { label: "order date" },
  assignee: { label: "assignee", ref: "user" }
}

// salesOrder
write: {
  customerReference: { label: "customer reference" },
  orderDate: { label: "order date" },
  assignee: { label: "assignee", ref: "user" },
  salesPersonId: { label: "salesperson", ref: "user" }
}

// job
write: {
  dueDate: { label: "due date" },
  startDate: { label: "start date" },
  assignee: { label: "assignee", ref: "user" },
  priority: { label: "priority" },
  deadlineType: { label: "deadline type" }
}

// item
write: { name: { label: "name" }, assignee: { label: "assignee", ref: "user" } }

// receipt
write: { assignee: { label: "assignee", ref: "user" } }

// shipment
write: {
  trackingNumber: { label: "tracking number" },
  assignee: { label: "assignee", ref: "user" },
  shippingMethodId: { label: "shipping method" }
}

// quote
write: {
  expirationDate: { label: "expiration date" },
  dueDate: { label: "due date" },
  assignee: { label: "assignee", ref: "user" },
  estimatorId: { label: "estimator", ref: "user" },
  salesPersonId: { label: "salesperson", ref: "user" },
  customerReference: { label: "customer reference" }
}

// supplier
write: {
  accountManagerId: { label: "account manager", ref: "user" },
  assignee: { label: "assignee", ref: "user" },
  supplierTypeId: { label: "type" }
}

// customer
write: {
  accountManagerId: { label: "account manager", ref: "user" },
  assignee: { label: "assignee", ref: "user" },
  customerTypeId: { label: "type" }
}

// nonConformance
write: {
  assignee: { label: "assignee", ref: "user" },
  priority: { label: "priority" },
  dueDate: { label: "due date" },
  nonConformanceTypeId: { label: "type" }
}
```

6. Add a `build.test.ts` case per new validation branch: a write column that does not exist,
   a write column of `"companyId"`, and a `write` `ref` that disagrees with the schema's
   foreign key — each returns exactly one problem from `validateCatalogInputs`.

**Verify:**
```bash
pnpm --filter @carbon/workflows exec tsgo --noEmit
pnpm --filter @carbon/workflows test
# Expected: tsgo silent — a compile error here names the entity and the column that does not
# exist on its table. All build.test.ts cases pass.
```

**Out of scope:** generating actions from `write` — Task 8. Do not run the generator yet.

---

## Task 7: Write the hand-written action and operation declarations

**Depends on:** Task 6
**Files:**
- Create: `packages/workflows/src/catalog/actions.ts`
- Create: `packages/workflows/src/catalog/operations.ts`
- Modify: `packages/workflows/src/catalog/index.ts` — export both

**Steps:**

1. Create `actions.ts`. Follow the shape of `moments.ts`: a plain exported record, an
   identity helper for inference, labels as plain English strings (the generator wraps them
   in `msg`, per the Lingui rule — **never** import `@lingui/*` here).

```ts
import type { ValueType } from "../definition/types";
import { t } from "../definition/types";
import type { RequiredPermission } from "../definition/catalog";

export interface ActionInputLike {
  type: ValueType;
  required: boolean;
  label: string;
}

export interface ActionDeclarationLike {
  label: string;
  permission: RequiredPermission;
  inputs: Record<string, ActionInputLike>;
  outputs: Record<string, ValueType>;
  batchable: boolean;
  requireOneOf?: string[][];
  /** A tool name in tool-metadata.json, dispatched at run time. */
  call?: string;
  /** Set by the generator for the expanded update family; never hand-written. */
  update?: { entity: string };
}

const action = (entry: ActionDeclarationLike) => entry;

export const WORKFLOW_ACTIONS = {
  "job.create": action({
    label: "Create a job",
    permission: { module: "production", action: "create" },
    inputs: {
      itemId: { type: t.entity("item"), required: true, label: "item" },
      quantity: { type: t.number, required: true, label: "quantity" },
      dueDate: { type: t.date, required: false, label: "due date" },
      salesOrderLineId: { type: t.string, required: false, label: "sales order line" }
    },
    outputs: { record: t.entity("job") },
    batchable: true,
    call: "production_upsertJob"
  }),
  "nonConformance.create": action({
    label: "Create an issue",
    permission: { module: "quality", action: "create" },
    inputs: {
      name: { type: t.string, required: true, label: "title" },
      description: { type: t.string, required: false, label: "description" },
      priority: { type: t.string, required: false, label: "priority" },
      locationId: { type: t.entity("location"), required: false, label: "location" }
    },
    outputs: { record: t.entity("nonConformance") },
    batchable: true,
    call: "quality_upsertIssue"
  }),
  "purchaseOrder.create": action({
    label: "Create a purchase order",
    permission: { module: "purchasing", action: "create" },
    inputs: {
      supplierId: { type: t.entity("supplier"), required: true, label: "supplier" },
      orderDate: { type: t.date, required: false, label: "order date" },
      supplierReference: { type: t.string, required: false, label: "supplier reference" }
    },
    outputs: { record: t.entity("purchaseOrder") },
    batchable: true,
    call: "purchasing_upsertPurchaseOrder"
  }),
  "salesOrder.create": action({
    label: "Create a sales order",
    permission: { module: "sales", action: "create" },
    inputs: {
      customerId: { type: t.entity("customer"), required: true, label: "customer" },
      orderDate: { type: t.date, required: false, label: "order date" },
      customerReference: { type: t.string, required: false, label: "customer reference" }
    },
    outputs: { record: t.entity("salesOrder") },
    batchable: true,
    call: "sales_upsertSalesOrder"
  }),
  notify: action({
    label: "Notify someone",
    permission: { module: "users", action: "view" },
    inputs: {
      user: { type: t.entity("user"), required: false, label: "person" },
      role: { type: t.entity("group"), required: false, label: "role" },
      subject: { type: t.string, required: true, label: "subject" },
      message: { type: t.string, required: false, label: "message" },
      about: { type: t.entity("job"), required: false, label: "about" }
    },
    outputs: {},
    batchable: true,
    requireOneOf: [["user", "role"]]
  }),
  webhook: action({
    label: "Call an outside URL",
    permission: { module: "workflows", action: "update" },
    inputs: {
      url: { type: t.string, required: true, label: "URL" },
      body: { type: t.string, required: false, label: "body" }
    },
    outputs: { status: t.number },
    batchable: true
  })
} satisfies Record<string, ActionDeclarationLike>;
```

   **The `notify.about` type is a placeholder and must not ship as written.** The value
   model has no "any entity" type, and inventing one is out of scope. Instead: drop the
   `about` input entirely from the declaration above, and give notify a plain
   `aboutId: { type: t.string, required: false, label: "about" }` plus
   `aboutType: { type: t.string, required: false, label: "kind of record" }`. Task 23 passes
   these through as `documentId` / `documentType`. If that reads badly once the executor is
   written, STOP and report rather than adding a new value kind.

2. Before writing `role: t.entity("group")`, add a reference-only `group` entry to
   `WORKFLOW_ENTITY_REGISTRY` in `entities.ts`:

```ts
group: entity({
  table: "group",
  label: "Group",
  permission: "users"
}),
```

   Place it beside `user` in the reference-only block. If `"group"` is not a valid
   `TableName`, STOP and report — the notify `role` input depends on it.

3. Create `operations.ts` with the same shape:

```ts
export interface OperationDeclarationLike {
  label: string;
  entity: string;
  permission: RequiredPermission;
  inputs: Record<string, ActionInputLike>;
  output: ValueType;
}
```

   and these fifteen entries. Each takes exactly one input named after its entity, of that
   entity's type, `required: true`.

| id | entity | permission module | output |
|---|---|---|---|
| `purchaseOrder.total` | purchaseOrder | purchasing | number |
| `purchaseOrder.lineCount` | purchaseOrder | purchasing | number |
| `salesOrder.total` | salesOrder | sales | number |
| `salesOrder.lineCount` | salesOrder | sales | number |
| `quote.total` | quote | sales | number |
| `receipt.lineCount` | receipt | inventory | number |
| `shipment.lineCount` | shipment | inventory | number |
| `job.totalScrapQuantity` | job | production | number |
| `job.scrapPercentage` | job | production | number |
| `job.operationCount` | job | production | number |
| `job.openOperationCount` | job | production | number |
| `job.earliestOperationStart` | job | production | date |
| `job.latestOperationEnd` | job | production | date |
| `nonConformance.openTaskCount` | nonConformance | quality | number |
| `item.quantityOnHand` | item | parts | number |

   Every `permission.action` is `"view"`. Labels are sentence-case English:
   `"Total"`, `"Number of lines"`, `"Total scrap quantity"`, `"Scrap percentage"`,
   `"Number of operations"`, `"Number of open operations"`, `"Earliest operation start"`,
   `"Latest operation end"`, `"Number of open tasks"`, `"Quantity on hand"`.

4. Export `WORKFLOW_ACTIONS` and `WORKFLOW_OPERATIONS` (and their types) from
   `catalog/index.ts`. Do **not** export the labels from the package root — same rule as
   events.

**Verify:**
```bash
pnpm --filter @carbon/workflows exec tsgo --noEmit
pnpm exec biome check packages/workflows
# Expected: silent. Nothing consumes these two files yet, so no test change.
```

**Out of scope:** implementations. These are declarations only — no `run` function, no
Supabase, exactly as the event catalog's two inputs carry no behaviour.

---

## Task 8: Build actions and operations in `build.ts`

**Depends on:** Task 7
**Files:**
- Modify: `packages/workflows/src/catalog/build.ts` — `BuiltAction`, `BuiltOperation`,
  expansion, validation
- Modify: `packages/workflows/src/catalog/build.test.ts`

**Steps:**

1. Add to `build.ts`:

```ts
export interface BuiltActionInput {
  type: ValueType;
  required: boolean;
}

export interface BuiltAction {
  inputs: Record<string, BuiltActionInput>;
  outputs: Record<string, ValueType>;
  batchable: boolean;
  permission: RequiredPermission;
  requireOneOf?: string[][];
  call?: string;
  update?: { entity: string };
}

export interface BuiltOperation {
  entity: string;
  inputs: Record<string, BuiltActionInput>;
  output: ValueType;
  permission: RequiredPermission;
}
```

   and widen `BuiltCatalog` with `actions: Record<string, BuiltAction>` and
   `operations: Record<string, BuiltOperation>`. Labels for both go into the existing
   `labels` record, keyed by action / operation id — one flat label map keeps the generator
   and the Lingui rule unchanged.

2. Change `buildCatalog`'s signature to
   `buildCatalog(registry, moments, actions, operations, schema)`. Update the one caller
   (`scripts/generate-workflow-catalog.ts`, Task 9) and every `build.test.ts` call.

3. Expand each registry entry with a non-empty `write` into one action, inside the same loop
   that builds events:

```ts
const writable = Object.entries(entry.write ?? {}).filter(([, c]) => c !== undefined);
if (writable.length > 0) {
  const id = `${name}.update`;
  const inputs: Record<string, BuiltActionInput> = {
    [name]: { type: t.entity(name), required: true }
  };
  for (const [column, column_] of writable) {
    const property = definition.properties[column];
    if (property === undefined) continue;
    inputs[column] = {
      type: propertyType(property, refFor(property, column_?.ref, byTable)),
      required: false
    };
  }
  actions[id] = {
    inputs,
    outputs: { record: t.entity(name) },
    batchable: true,
    permission: { module: entry.permission, action: "update" },
    update: { entity: name }
  };
  labels[id] = `Update ${determiner.toLowerCase()} ${noun}`;
}
```

   Note the input keyed by the entity name is the record to update; the rest are the field
   map. Column types come from the schema, so enum columns arrive as strings and dates as
   dates with no hand-written type.

4. Pass hand-written actions and operations straight through into `actions` / `operations`,
   with their labels into `labels`. A hand-written id that collides with a generated
   `<entity>.update` id is a build error:
   `Action "${id}" is declared by hand and also generated from the entity registry.`

5. Extend `validateCatalogInputs` (widen its signature to take actions and operations) with:
   - an action or operation naming an entity type not in the registry, in any input or
     output;
   - an operation whose `entity` is not a registry entity;
   - an empty label on either;
   - a hand-written action with neither `call` nor an id in the built-in set
     `{"notify", "webhook"}` → `Action "${id}" has no implementation route.`

6. Add `build.test.ts` cases: an entity with three `write` columns produces exactly one
   action with four inputs, the record input required and the three fields optional; the
   generated label reads `Update a purchase order`; a hand-written id colliding with a
   generated one throws; an operation naming an unknown entity is reported.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: build.test.ts passes with the new cases. Do not run the generator yet — Task 9
# updates the script that calls buildCatalog, and the build will fail until it does.
```

**Out of scope:** emitting files.

---

## Task 9: Emit `actions.generated.ts` from the generator script

**Depends on:** Task 8
**Files:**
- Modify: `scripts/generate-workflow-catalog.ts`
- Create (generated): `packages/workflows/src/catalog/actions.generated.ts`
- Modify (generated): `packages/workflows/src/catalog/labels.generated.ts`

**Steps:**

1. Import `WORKFLOW_ACTIONS` and `WORKFLOW_OPERATIONS` and pass them to `buildCatalog` in the
   new argument order.

2. Emit a third file alongside the two existing ones, following the exact same style —
   `HEADER`, type-only imports, `JSON.stringify(sorted(...))`, no Lingui:

```ts
const actions = [
  HEADER,
  `import type { BuiltAction, BuiltOperation } from "./build";`,
  ``,
  `export const WORKFLOW_ACTION_CATALOG: Record<string, BuiltAction> = ${JSON.stringify(sorted(built.actions))};`,
  ``,
  `export const WORKFLOW_OPERATION_CATALOG: Record<string, BuiltOperation> = ${JSON.stringify(sorted(built.operations))};`,
  ``
].join("\n");

fs.writeFileSync(path.join(CATALOG_DIR, "actions.generated.ts"), actions);
```

3. The labels file needs no structural change — `built.labels` now carries action and
   operation ids too. Rename the exported constant from `WORKFLOW_EVENT_LABELS` to
   `WORKFLOW_LABELS` and update every reader (`grep -rn "WORKFLOW_EVENT_LABELS"` across the
   repo, including `scripts/check-workflow-catalog.ts`, which reads the file as **text**).

4. Update the closing `console.log` to report action and operation counts too.

5. Run the generator and commit the three generated files as part of this task's diff.

**Verify:**
```bash
pnpm run generate:workflow-catalog
pnpm --filter @carbon/workflows exec tsgo --noEmit
pnpm --filter @carbon/workflows test
# Expected: the script prints event, entity, action and operation counts. Actions should be
# 16 — ten `<entity>.update` plus the six hand-written. Operations should be 15.
```

**Out of scope:** wiring the generated data into `createEventCatalog` — Task 10.

---

## Task 10: Back the catalog with real actions and operations

**Depends on:** Task 9
**Files:**
- Modify: `packages/workflows/src/catalog/catalog.ts`
- Modify: `packages/workflows/src/catalog/catalog.test.ts`
- Modify: `packages/workflows/src/index.ts`, `packages/jobs/src/workflows/engine/execute.ts`

**Steps:**

1. Rewrite `catalog.ts` so all four lookups are real, indexed once at module load exactly as
   `EVENTS` and `ENTITIES` already are:

```ts
const ACTIONS: Map<string, CatalogAction> = new Map(
  Object.entries(WORKFLOW_ACTION_CATALOG).map(([id, a]) => [id, { id, ...a }])
);

const OPERATIONS: Map<string, CatalogOperation> = new Map(
  Object.entries(WORKFLOW_OPERATION_CATALOG).map(([id, o]) => [id, { id, ...o }])
);

/** The one catalog every consumer reads: events, entities, actions and operations. */
export function createWorkflowCatalog(): WorkflowCatalog {
  return {
    getEvent: (id) => EVENTS.get(id),
    getEntity: (name) => ENTITIES.get(name),
    getAction: (id) => ACTIONS.get(id),
    getOperation: (id) => OPERATIONS.get(id)
  };
}
```

2. Delete `EventCatalogOptions` and the injection seam — it existed only because actions and
   operations did not. Keep `createEventCatalog` as a deprecated one-line alias **only if**
   more than two call sites exist; otherwise rename and update them. Check with
   `grep -rn "createEventCatalog" --include=*.ts .`

3. `BuiltAction.update` and `BuiltAction.call` are not on `CatalogAction`, which is the
   validator's interface and must stay minimal. Add them to a separate job-side type instead:
   `catalog.ts` also exports
   `export function getActionRoute(id: string): { call?: string; update?: { entity: string } } | undefined`
   reading the same generated record. The executors in `packages/workflows` never call it;
   only `packages/jobs` does.

4. Update `catalog.test.ts`: `getAction("purchaseOrder.update")` returns an entry whose
   `inputs.purchaseOrder.required` is true and whose `permission` is
   `{module: "purchasing", action: "update"}`; `getOperation("job.totalScrapQuantity")`
   returns an entry with `entity: "job"`; an unknown id returns `undefined`.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
pnpm --filter @carbon/jobs typecheck
pnpm exec turbo run typecheck --filter=erp
# Expected: all pass. The erp typecheck is the binding constraint for this package — run it
# even though the package's own tsgo is green.
```

**Out of scope:** executors.

---

## Task 11: Extend `check-workflow-catalog.ts`

**Depends on:** Task 10
**Files:**
- Modify: `scripts/check-workflow-catalog.ts`

**Steps:**

1. The script already compares the committed event catalog to a fresh build. Extend that
   comparison to `actions.generated.ts` — compare **data, not file text**, exactly as the
   existing check does, so formatting can never make it flap.

2. Add: every hand-written action's `call`, when present, names a tool in
   `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`. Read that file with
   `fs.readFileSync` + `JSON.parse` and build a `Set` of `tools[].name`. Failure message:
   `Action "${id}" calls "${call}", which is not a tool in tool-metadata.json. Run pnpm run generate:mcp.`

3. Add: every action and operation id appears as a key in `labels.generated.ts`, using the
   same regex-over-text approach the script already uses for event labels (it must not
   **import** that file — `msg` is a build-time macro that throws in plain Node).

4. The existing check 3 (registry tables and watched columns still exist) already covers
   `write` columns via `validateCatalogInputs`, because `buildCatalog` throws on any problem.
   Confirm the script surfaces that throw as a readable failure rather than a stack trace.

**Verify:**
```bash
pnpm run check:workflow-catalog
# Expected: exits 0 with no failures listed. Then deliberately break one thing — change a
# `call` to a name that does not exist — re-run, confirm it exits non-zero naming that action,
# and revert.
```

**Out of scope:** the deploy-time checks in `packages/checks`, which need a live database.

---

## Task 12: Add the `WorkflowServices` port to `RuntimeContext`

**Depends on:** Task 10
**Files:**
- Modify: `packages/workflows/src/runtime/types.ts`
- Modify: `packages/workflows/src/runtime/fixtures.ts`
- Modify: `packages/workflows/src/index.ts` — export the new types

**Steps:**

1. In `runtime/types.ts`, add above `RuntimeContext`:

```ts
export type ActionOutcome =
  | { ok: true; outputs: Record<string, RuntimeValue>; summary?: string }
  | { ok: false; error: string };

export type OperationOutcome =
  | { ok: true; value: RuntimeValue }
  | { ok: false; error: string };

export type SearchOutcome =
  | { ok: true; value: RuntimeValue; matched: number; dropped: number }
  | { ok: false; error: string };

/** One resolved match rule, ready for the query builder. */
export interface SearchCriterion {
  field: string;
  operator: Operator;
  value: RuntimeValue;
}

/** Everything that touches the world. Implemented job-side; this package stays pure. */
export interface WorkflowServices {
  runAction(
    actionId: string,
    inputs: Record<string, RuntimeValue>
  ): Promise<ActionOutcome>;
  runOperation(
    operationId: string,
    inputs: Record<string, RuntimeValue>
  ): Promise<OperationOutcome>;
  search(params: {
    entity: string;
    returns: "one" | "list";
    criteria: SearchCriterion[];
  }): Promise<SearchOutcome>;
}
```

   Import `Operator` type-only from `@carbon/utils` (already a runtime dependency).

2. Add `services: WorkflowServices;` to `RuntimeContext` — **required, not optional**. A
   missing implementation must be a compile error, not a run-time surprise.

3. In `fixtures.ts` (test-only, not exported from the package root), add a
   `createFixtureServices(overrides?: Partial<WorkflowServices>): WorkflowServices` whose
   three defaults return `{ok: false, error: "not stubbed"}`, and include it in whatever
   context factory that file already provides so existing condition/filter tests compile
   unchanged.

4. Export `WorkflowServices`, `ActionOutcome`, `OperationOutcome`, `SearchOutcome` and
   `SearchCriterion` from `runtime/index.ts` and the package root.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
pnpm --filter @carbon/workflows exec tsgo --noEmit
pnpm --filter @carbon/jobs typecheck
# Expected: `packages/jobs` FAILS here — execute.ts builds a RuntimeContext without
# `services`. That is expected and is fixed in Task 27. Note the failure and continue;
# @carbon/workflows itself must be green.
```

**Out of scope:** implementing the port.

---

## Task 13: Write the Entity executor

**Depends on:** Task 12 — independent of Tasks 14 and 15
**Files:**
- Create: `packages/workflows/src/runtime/entity.ts`
- Create: `packages/workflows/src/runtime/entity.test.ts`
- Copy from (precedent): `packages/workflows/src/runtime/filter.ts`

**Steps:**

1. Write `entityExecutor: NodeExecutor<EntityNode>`:
   - `permission: (node, catalog) => catalog.getOperation(node.data.operation)?.permission`
   - `execute`: look up the operation; if absent return
     `{status: "Skipped", reason: "This calculation is no longer available."}`.
     Resolve every entry of `node.data.inputs` with `resolveValue`; the first failure returns
     `{status: "Skipped", reason}` — missing data is a skip with a reason, never an error.
     Call `ctx.services.runOperation(node.data.operation, resolved)`. On `ok: false` return
     `{status: "Failed", error}`. On success return
     `{status: "Succeeded", outputs: {[DEFAULT_OUTPUT]: value}, handle: DEFAULT_HANDLE}`.

2. The Entity node has a single `DEFAULT_HANDLE` and no failure handle — do not add one.

3. Tests: a succeeding operation puts its value on `result` and follows `"out"`; an
   unresolvable input skips with the resolver's reason; a failing service returns `Failed`;
   `permission()` returns the operation's declared permission and `undefined` for an unknown
   operation id.

**Verify:**
```bash
pnpm --filter @carbon/workflows test -- entity
# Expected: entity.test.ts passes; every case above listed.
```

**Out of scope:** the operation implementations (Task 25).

---

## Task 14: Write the Lookup executor

**Depends on:** Task 12 — independent of Tasks 13 and 15
**Files:**
- Create: `packages/workflows/src/runtime/lookup.ts`
- Create: `packages/workflows/src/runtime/lookup.test.ts`
- Copy from (precedent): `packages/workflows/src/runtime/filter.ts`

**Steps:**

1. Write `lookupExecutor: NodeExecutor<LookupNode>`:
   - `permission`: the registry permission of the target entity at `"view"`. `CatalogEntity`
     carries no permission, so read it from the generated catalog — if that means importing
     `src/catalog/` from `src/runtime/`, do **not**: instead add `permission?: RequiredPermission`
     to `CatalogEntity` in `definition/catalog.ts` and populate it in `catalog.ts` from
     `REGISTRY_ENTRIES`. Update `createFixtureCatalog`'s entities accordingly. If that widens
     more than those two files, STOP and report.
   - `execute`: resolve each match rule's `value` with `resolveValue`; a failure returns
     `{status: "Skipped", reason}`. Build `SearchCriterion[]` and call `ctx.services.search`.
     On `ok: false` return `{status: "Failed", error, handle: FAILURE_HANDLE}`.
     On success with `matched === 0` and `returns === "one"` return
     `{status: "Failed", error: "Nothing matched this search.", handle: FAILURE_HANDLE}`.
     Otherwise `{status: "Succeeded", outputs: {[DEFAULT_OUTPUT]: value}, handle: SUCCESS_HANDLE, summary}`,
     where `summary` reads `Found 3 of 3.` or, when `dropped > 0`,
     `Found 100 of 143; 43 were not used.`
   - `returns: "list"` with no match is a success with an empty list, not a failure.

2. Tests: one match with `returns: "one"` yields an entity value on `result` and the success
   handle; no match with `returns: "one"` yields `Failed` on the failure handle; no match with
   `returns: "list"` yields an empty list on the success handle; a capped list reports the
   dropped count in the summary; an unresolvable rule value skips.

**Verify:**
```bash
pnpm --filter @carbon/workflows test -- lookup
# Expected: lookup.test.ts passes; every case above listed.
```

**Out of scope:** the query builder (Task 26).

---

## Task 15: Write the Action executor

**Depends on:** Task 12 — independent of Tasks 13 and 14
**Files:**
- Create: `packages/workflows/src/runtime/action.ts`
- Create: `packages/workflows/src/runtime/action.test.ts`
- Copy from (precedent): `packages/workflows/src/runtime/filter.ts`

**Steps:**

1. Write `actionExecutor: NodeExecutor<ActionNode>`:
   - `permission: (node, catalog) => catalog.getAction(node.data.action)?.permission`
   - `execute`: look up the action; absent →
     `{status: "Skipped", reason: "This step is no longer available."}`.
     Resolve every entry of `node.data.inputs`; a failure returns `{status: "Skipped", reason}`.
     Call `ctx.services.runAction(node.data.action, resolved)`. On `ok: false` return
     `{status: "Failed", error, handle: FAILURE_HANDLE}`; on success
     `{status: "Succeeded", outputs, handle: SUCCESS_HANDLE, summary}`.

2. **The executor handles one item only.** Batch is the engine's job: it resolves the loop
   list, sets `ctx.item`, and calls this executor once per item (Task 28). Do not loop here —
   a loop inside the executor would produce one step row for many effects, which is exactly
   what the idempotency ledger exists to prevent.

3. Tests: a succeeding action returns its outputs on the success handle; a failing action
   returns `Failed` on the **failure** handle so a wired recovery path runs; an unresolvable
   input skips with the resolver's reason; `permission()` returns the action's declared
   module and action.

**Verify:**
```bash
pnpm --filter @carbon/workflows test -- action
# Expected: action.test.ts passes; every case above listed.
```

**Out of scope:** batching, and every action implementation.

---

## Task 16: Register the three executors

**Depends on:** Tasks 13, 14, 15
**Files:**
- Modify: `packages/workflows/src/runtime/executors.ts`
- Modify: `packages/workflows/src/runtime/executors.test.ts`
- Modify: `packages/workflows/src/runtime/index.ts`, `packages/workflows/src/index.ts`

**Steps:**

1. Add three entries to `EXECUTORS`: `entity: entityExecutor`, `lookup: lookupExecutor`,
   `action: actionExecutor`. Nothing else in the engine switches on `node.type`, so this one
   line each is the whole registration.

2. `executors.test.ts` currently asserts those three kinds return `undefined` — invert those
   assertions, and add one asserting every member of `WorkflowNodeType` except `trigger` now
   has an executor.

3. Export the three executors from `runtime/index.ts` and the package root, beside
   `conditionExecutor` and `filterExecutor`.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
pnpm exec biome check packages/workflows
pnpm exec turbo run typecheck --filter=erp
# Expected: all pass.
```

**Out of scope:** `execute.ts` still constructs a `RuntimeContext` without `services`, so
`packages/jobs` does not typecheck until Task 27.

---

## Task 17: Migration — `workflow.webhookSecret`

**Depends on:** none (may run in parallel with Tasks 1-16)
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_workflows-webhook-secret.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260730142317_workflows-foundation.sql`

**Steps:**

1. Create the file with `pnpm db:migrate:new workflows-webhook-secret` — never hand-name a
   migration file.

2. Contents:

```sql
-- A per-workflow signing secret for the "call an outside URL" action

ALTER TABLE "workflow"
  ADD COLUMN "webhookSecret" TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex');
```

   `gen_random_bytes` comes from `pgcrypto`. Confirm the extension is already enabled —
   `grep -rn "pgcrypto" packages/database/supabase/migrations/` — and if it is not, add
   `CREATE EXTENSION IF NOT EXISTS pgcrypto;` above. If `gen_random_bytes` is unavailable,
   STOP and report rather than falling back to a weaker source of randomness.

3. No new RLS policies. The existing `workflow` table policies gate on the `Workflows`
   permission module, and Postgres has no column-level RLS, so the secret is readable by
   anyone who can already read the workflow. That is the accepted design — record it in the
   migration as a one-line comment.

4. Do **not** apply the migration yourself. `pnpm db:migrate` rebuilds against the developer's
   local database; wait for the user to run it.

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -3
# Expected: the new file is present, named {timestamp}_workflows-webhook-secret.sql, and
# nothing else changed.
```

**Out of scope:** surfacing the secret in the UI (phase 7) and rotation.

---

## Task 18: Regenerate database types

**Depends on:** Task 17, and the user having applied the migration
**Files:**
- Modify (generated): `packages/database/src/types.ts`
- Modify (generated): `packages/database/src/swagger-docs-schema.ts`

**Steps:**

1. Ask the user to confirm the migration has been applied to their local database. If it has
   not, STOP — regenerating against an unmigrated database silently produces types without
   the new column, and the failure surfaces much later as a "missing property" error that
   looks like a stale cache.

2. Run `pnpm run generate:types`, then `pnpm run generate:swagger`.

3. Never hand-edit either output.

**Verify:**
```bash
grep -n "webhookSecret" packages/database/src/types.ts | head -3
pnpm exec turbo run typecheck --filter=erp
# Expected: webhookSecret appears in the workflow Row/Insert/Update types; the erp typecheck
# passes. A "missing property" error here usually means a stale turbo cache rather than a
# real bug — rebuild before touching the migration.
```

**Out of scope:** anything that reads the column — Task 24.

---

## Task 19: Add the dispatcher injection seam and wire it in the ERP app

**Depends on:** Tasks 16 and 18
**Files:**
- Create: `packages/jobs/src/workflows/actions/dispatcher.ts`
- Modify: `packages/jobs/src/inngest/index.ts` — re-export the setter
- Modify: `apps/erp/app/routes/api+/inngest.ts` — call it before `serve()`
- Create: `packages/jobs/src/workflows/actions/dispatcher.test.ts`

**Steps:**

1. Create `dispatcher.ts`:

```ts
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DispatchContext {
  client: SupabaseClient<Database>;
  companyId: string;
  companyGroupId: string;
  userId: string;
}

export type DispatchResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

export type WorkflowDispatch = (
  functionName: string,
  context: DispatchContext,
  args: Record<string, unknown>
) => Promise<DispatchResult>;

let dispatch: WorkflowDispatch | undefined;

/** The ERP app supplies this at boot; packages/jobs cannot import ~/modules itself. */
export function setWorkflowDispatch(fn: WorkflowDispatch): void {
  dispatch = fn;
}

export function getWorkflowDispatch(): WorkflowDispatch | undefined {
  return dispatch;
}
```

   The type is declared here and satisfied structurally by `executeFunction`, so the
   dependency points from the app into the package and never the other way.

2. Re-export `setWorkflowDispatch` from `packages/jobs/src/inngest/index.ts` — the
   **server-only** subpath the route already imports. Do not add it to
   `packages/jobs/src/index.ts`, which app bundles import.

3. In `apps/erp/app/routes/api+/inngest.ts`, above `const handler = serve({...})`:

```ts
import { functions, inngest, setWorkflowDispatch } from "@carbon/jobs/inngest";
import { executeFunction } from "./mcp+/lib/direct-executor";

// packages/jobs cannot import ~/modules, so the ERP app hands it the dispatcher.
setWorkflowDispatch(executeFunction);
```

   If `executeFunction`'s signature does not satisfy `WorkflowDispatch` structurally (its
   `args` is `Record<string, any> | string | undefined`), widen `WorkflowDispatch`'s `args`
   to match rather than casting at the call site.

4. Write `dispatcher.test.ts`: `getWorkflowDispatch()` is `undefined` before registration and
   returns the same function after. This is what proves the seam is a real registration
   rather than an import.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- dispatcher
pnpm exec turbo run typecheck --filter=erp
# Expected: the test passes; the erp typecheck passes with the new import in the route.
```

**Out of scope:** using the dispatcher — Task 21.

---

## Task 20: Implement the shared update executor

**Depends on:** Task 19 — independent of Tasks 21, 22, 24, 25, 26
**Files:**
- Create: `packages/jobs/src/workflows/actions/update.ts`
- Create: `packages/jobs/src/workflows/actions/update.test.ts`

**Steps:**

1. Export one function:

```ts
export async function runUpdateAction(params: {
  client: SupabaseClient<Database>;
  companyId: string;
  ownerId: string;
  entity: string;                       // from the catalog's `update.entity`
  inputs: Record<string, RuntimeValue>; // the record plus the field map
  action: CatalogAction;
}): Promise<ActionOutcome>
```

2. In order, and stop at the first failure:

   a. **Find the record.** The input keyed by `entity` must be an entity value; anything else
      returns `{ok: false, error: "This step needs a record to update."}`. Resolve the table
      through `REGISTRY_ENTRIES[entity].table`, then
      `.from(table).select("id").eq("id", id).eq("companyId", companyId).maybeSingle()`.
      A null row returns `{ok: false, error: \`That ${entity} could not be read.\`}` — absent
      and refused-by-RLS are the same answer, and both must refuse rather than write.

   b. **Coerce and check each field.** For each remaining input, read the column's swagger
      property from `schema.definitions[table].properties[column]`. Convert the
      `RuntimeValue` to a raw column value: a null primitive becomes `null`, a date becomes
      its ISO string, an entity becomes its id, a list stays an array. If the property has an
      `enum` and the value is not a member, return
      `{ok: false, error: \`"${value}" is not a valid ${column}.\`}`.

   c. **Check every foreign key.** For each column whose catalog input type is
      `{kind: "entity"}`, read the target through the **owner's** client:
      `.from(targetTable).select("id").eq("id", value).eq("companyId", companyId).maybeSingle()`.
      A null row returns
      `{ok: false, error: \`The ${column} you chose is not in this company.\`}`.
      This is the tenancy guarantee, not a nicety — without it a workflow could point one
      tenant's record at another tenant's data. Do **not** skip it when the value came from a
      trigger variable.

   d. **Write** `{...fields, updatedBy: ownerId, updatedAt: new Date().toISOString()}` scoped
      by `.eq("id", id).eq("companyId", companyId)`. A Supabase error returns
      `{ok: false, error: error.message}`.

3. Return `{ok: true, outputs: {record: entityValue(entity, id)}, summary: \`Updated ${n} field(s).\`}`.

4. Tests with a fake Supabase client (follow whatever fake `packages/jobs` tests already use;
   if none exists, hand-roll a minimal chainable stub in the test file rather than adding a
   dependency): a happy path writes the expected patch; a cross-company foreign key refuses
   and writes nothing; an invalid enum refuses; a missing record refuses.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- update
# Expected: all four cases pass, and the cross-company case asserts `update` was never called.
```

**Out of scope:** deciding which columns are writable — that is the catalog's job (Task 6).

---

## Task 21: Implement the create actions

**Depends on:** Task 19 — independent of Tasks 20, 22, 24, 25, 26
**Files:**
- Create: `packages/jobs/src/workflows/actions/create.ts`
- Create: `packages/jobs/src/workflows/actions/create.test.ts`

**Steps:**

1. Export:

```ts
export async function runCreateAction(params: {
  dispatch: WorkflowDispatch;
  context: DispatchContext;
  call: string;                          // e.g. "production_upsertJob"
  entity: string;                        // e.g. "job"
  inputs: Record<string, RuntimeValue>;
}): Promise<ActionOutcome>
```

2. Convert each `RuntimeValue` to a plain JSON value with one shared helper — reuse the same
   converter Task 20 writes for step (b), exported from `update.ts` so there is one
   definition. Pass the result as the dispatcher's `args`.

3. The dispatcher stamps `companyId`, `createdBy` and `updatedBy` from the context, so the
   created record is owned by the workflow's owner and tagged with the run. Do not stamp them
   here as well.

4. `{success: false}` returns `{ok: false, error}`. On success the dispatcher's `data` is
   usually a Supabase envelope: if `data` is an object with a non-null `error`, return
   `{ok: false, error: data.error.message}`. Otherwise pull the new row's `id` from
   `data.data` and return
   `{ok: true, outputs: {record: entityValue(entity, id)}, summary: \`Created ${id}.\`}`.
   If no id can be found, return
   `{ok: false, error: "The record was created but could not be read back."}` — never a
   success with a dangling output.

5. If `getWorkflowDispatch()` returned `undefined` upstream, the caller (Task 27) returns
   `{ok: false, error: "This step is not available in this environment."}`. Do not handle
   that here.

6. Tests with a stub dispatcher: a successful create returns the record output; a
   `{success: false}` result surfaces the error; a Supabase envelope carrying an error
   surfaces that instead; a success with no id refuses.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- create
# Expected: all four cases pass.
```

**Out of scope:** adding more than the four declared create actions.

---

## Task 22: Add the payload-text notification kind

**Depends on:** Task 19 — independent of Tasks 20, 21, 24, 25, 26
**Files:**
- Modify: `packages/notifications/src/index.ts` — enum member, topic, heading, CTA label
- Modify: `packages/lib/src/events.ts` — the `carbon/notify` payload
- Modify: `packages/jobs/src/inngest/functions/notifications/content.ts` —
  `EventContentOptions`, one new case
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts` —
  `defaultDestinations`, forward the text, relax the document guard
- Modify: `packages/notifications/AGENTS.md`

**Steps:**

1. In `packages/notifications/src/index.ts`:
   - add `Workflow = "workflow"` to `NotificationEvent`, in the enum's existing alphabetical
     position;
   - `getNotificationTopic` — add a case returning `NotificationTopic.General`. Do **not**
     add a new topic: `topicLabels` in `apps/erp/app/routes/x+/account+/notifications.tsx` is
     an exhaustive `Record<NotificationTopic, string>` and a new member breaks it;
   - `getNotificationEmailHeading` — add a case returning `"Workflow"`;
   - `getNotificationEmailCtaLabel` — add a case returning `"View details"`;
   - leave `isRecurringNotificationEvent` alone.

2. In `packages/lib/src/events.ts`, add to the `carbon/notify` data:

```ts
      /** Set by a workflow: the message is authored by the customer, not read from a document. */
      title?: string;
      body?: string;
```

3. In `content.ts`:
   - add `title?: string; body?: string;` to `EventContentOptions`;
   - add a `case NotificationEvent.Workflow:` to `buildEventContent` returning
     `{ description: opts.title ?? "A workflow ran", details: opts.body ? [{ label: "Message", value: opts.body }] : [] }`
     with **no database read** — that is the whole point of the kind;
   - leave `getActorLabel` and `getNotificationEmailComponent` unchanged; the default
     `NotificationEmail` template renders `description` and `details` already.

4. In `notify.ts`:
   - add `[NotificationEvent.Workflow]: [NotificationDestination.InApp, NotificationDestination.Email]`
     to `defaultDestinations`. Without an entry the event silently gets in-app only;
   - forward `payload.title` and `payload.body` into the `getNotificationContent` options;
   - the guard at the top (`documentId ?? documentIds?.[0]`, which throws `NonRetriableError`)
     stays — Task 23 always supplies a `documentId`, using the workflow run id when the
     customer named no record. Add a one-line comment saying so, rather than relaxing the
     guard.

5. Update `packages/notifications/AGENTS.md` with the new event.

**Verify:**
```bash
pnpm --filter @carbon/jobs typecheck
pnpm exec turbo run typecheck --filter=erp
pnpm --filter @carbon/jobs test
# Expected: all pass. The erp typecheck is what catches an exhaustive-Record break in the
# account notifications route.
```

**Out of scope:** the topbar row and the link resolver (Task 29) — without those the row is
written but invisible, which is why Task 29 is not optional.

---

## Task 23: Implement the notify action

**Depends on:** Task 22
**Files:**
- Create: `packages/jobs/src/workflows/actions/notify.ts`
- Create: `packages/jobs/src/workflows/actions/notify.test.ts`

**Steps:**

1. Export:

```ts
export async function runNotifyAction(params: {
  companyId: string;
  ownerId: string;
  runId: string;
  inputs: Record<string, RuntimeValue>;
}): Promise<ActionOutcome>
```

2. Collect recipient ids: the `user` input's entity id and the `role` input's entity id, both
   optional. Send **one** `trigger("notify", ...)` with
   `recipient: { type: "group", groupIds: [...ids] }`. A group works for both, because every
   user has an identity group whose id is the user id — do not branch on which input was
   supplied. If both are absent return
   `{ok: false, error: "This step has nobody to notify."}` (validation should have caught it,
   but the engine must not send to nobody).

3. Payload: `event: NotificationEvent.Workflow`, `companyId`, `from: ownerId`,
   `title` from the `subject` input, `body` from the `message` input,
   `documentId: aboutId ?? runId`, and `documentType` from `aboutType` when both are present.

4. `subject` and `message` arrive already rendered — the Action executor resolved the
   template value before calling the service, so there is no template handling here.

5. Return `{ok: true, outputs: {}, summary: \`Notified ${ids.length} recipient(s).\`}`.
   `trigger` does not report delivery, so success means "queued", and the summary should say
   nothing stronger.

6. Tests with a stubbed `trigger`: a user-only input sends one event with that id; a
   user-and-role input sends one event with both ids; neither returns `ok: false` and sends
   nothing; the payload carries the run id as `documentId` when no `aboutId` is supplied.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- notify
# Expected: all four cases pass.
```

**Out of scope:** per-recipient fan-out, opt-outs and plan gating — the existing pipeline
already does all of it.

---

## Task 24: Implement the signed webhook action and URL guard

**Depends on:** Tasks 18 and 19 — independent of Tasks 20, 21, 22, 25, 26
**Files:**
- Create: `packages/jobs/src/workflows/actions/webhook.ts`
- Create: `packages/jobs/src/workflows/actions/url-guard.ts`
- Create: `packages/jobs/src/workflows/actions/url-guard.test.ts`
- Create: `packages/jobs/src/workflows/actions/webhook.test.ts`
- Copy from (precedent, for the HMAC shape):
  `packages/ee/src/slack/lib/client.ts` (`verifySlackWebhook`, lines 117-150)

**Steps:**

1. `url-guard.ts` exports:

```ts
export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };

/** Resolves the hostname first: a public name can still point inward. */
export async function checkOutboundUrl(raw: string): Promise<UrlVerdict>;
```

   Rules, each with its own reason string:
   - parses as a URL, else `"That is not a valid web address."`
   - protocol is `https:`, else `"Only https addresses are allowed."`
   - `dns.promises.lookup(hostname, { all: true })` returns at least one address, else
     `"That address could not be found."`
   - **every** resolved address is public. Refuse loopback (`127.0.0.0/8`, `::1`), private
     (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), link-local (`169.254/16`, `fe80::/10`)
     and the cloud metadata address `169.254.169.254`, with
     `"That address is inside a private network."` Check every address, not the first — a
     name can resolve to both.
   - This module is in `packages/jobs`, which runs on Node, so `node:dns` is fine. It must
     **not** move into `packages/workflows`, which the browser builder compiles.

2. `webhook.ts` exports:

```ts
export async function runWebhookAction(params: {
  client: SupabaseClient<Database>;
  companyId: string;
  workflowId: string;
  inputs: Record<string, RuntimeValue>;
}): Promise<ActionOutcome>
```

   Steps: read `url` and `body` from the inputs; run `checkOutboundUrl`; read
   `workflow.webhookSecret` through the **owner's** client
   (`.from("workflow").select("webhookSecret").eq("id", workflowId).eq("companyId", companyId).single()`);
   serialize the body to a string once and sign **those exact bytes**:

```ts
const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac("sha256", secret)
  .update(`v1:${timestamp}:${rawBody}`)
  .digest("hex");
```

   POST with `fetch` and:

```ts
{
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Carbon-Timestamp": String(timestamp),
    "Carbon-Signature": `v1=${signature}`
  },
  body: rawBody,
  redirect: "manual",
  signal: AbortSignal.timeout(10_000)
}
```

   `redirect: "manual"` means a 3xx arrives as a response — treat any 3xx as
   `{ok: false, error: "That address redirected, which is not allowed."}`. A non-2xx is
   `{ok: false, error: \`The address answered ${status}.\`}`. A timeout or network error is
   `{ok: false, error: "The address could not be reached."}`.

3. On success return `{ok: true, outputs: {status: primitiveValue("number", status)}, summary: \`Answered ${status}.\`}`.
   Read at most 2 KB of the response and keep only that excerpt for the step summary. **Never**
   return or log the secret, the signature, or the request headers.

4. Tests: `url-guard.test.ts` covers `http://`, a literal `127.0.0.1`, a literal
   `169.254.169.254`, a malformed string, and a public address passing — stub
   `dns.promises.lookup` so the tests do not hit the network. `webhook.test.ts` stubs `fetch`
   and asserts the two headers are present, that recomputing the HMAC over
   `v1:<timestamp>:<body>` matches, that a 302 is refused, and that a 500 is refused.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- webhook
pnpm --filter @carbon/jobs test -- url-guard
# Expected: all cases pass and no test performs real network or DNS I/O.
```

**Out of scope:** the two pre-existing webhook systems. Do not touch
`packages/jobs/src/inngest/functions/events/webhook.ts` or
`packages/database/supabase/functions/webhook/index.ts` — including the known-suspect
`concurrency: { limit: 0 }`.

---

## Task 25: Implement the entity operations

**Depends on:** Task 19 — independent of Tasks 20, 21, 22, 24, 26
**Files:**
- Create: `packages/jobs/src/workflows/actions/operations.ts`
- Create: `packages/jobs/src/workflows/actions/operations.test.ts`

**Steps:**

1. Export one dispatcher plus one implementation per operation id:

```ts
export async function runOperation(params: {
  client: SupabaseClient<Database>;
  companyId: string;
  operationId: string;
  inputs: Record<string, RuntimeValue>;
}): Promise<OperationOutcome>
```

   Keyed by a `Record<string, (client, companyId, recordId) => Promise<OperationOutcome>>`,
   so an unknown id returns `{ok: false, error: "This calculation is no longer available."}`
   rather than falling through.

2. Every implementation reads through the passed client (the owner's) and scopes by
   `companyId`. The reads, by id:

   - `purchaseOrder.total` — `.from("purchaseOrders").select("orderTotal")`. The totals live
     only on the **view**, which is exactly why these are operations and not properties.
     Confirm the view name and column against `packages/database/src/types.ts` before
     writing; if `orderTotal` is not on `purchaseOrders`, STOP and report.
   - `salesOrder.total`, `quote.total` — the same pattern against their own views.
   - `*.lineCount` — `.select("id", { count: "exact", head: true })` on the line table
     (`purchaseOrderLine`, `salesOrderLine`, `receiptLine`, `shipmentLine`) filtered by the
     parent id and `companyId`.
   - `job.totalScrapQuantity` — sum `scrapQuantity` across `jobOperation` for the job.
   - `job.scrapPercentage` — that sum over the job's `quantity`, returning `0` when the
     quantity is zero rather than a division by zero.
   - `job.operationCount` / `job.openOperationCount` — counts over `jobOperation`, the second
     filtered to statuses that are not terminal. Read the real status values from the
     generated enum rather than hard-coding strings.
   - `job.earliestOperationStart` / `job.latestOperationEnd` — min/max of the relevant
     `jobOperation` date columns, returning a null value when there are none.
   - `nonConformance.openTaskCount` — a count over the issue's task table filtered to open.
   - `item.quantityOnHand` — sum across the item's inventory rows for the company.

   Where the exact table or column name is uncertain, verify it in
   `packages/database/src/types.ts` first. If an operation cannot be implemented from a single
   scoped read, STOP and report it rather than inventing a join.

3. Return values through `primitiveValue("number", n)` / `primitiveValue("date", iso)`, and
   `nullValue()` where there is genuinely nothing — an operation must never throw and must
   never return a made-up zero for "no rows" where a date is expected.

4. Tests: a stubbed client per operation asserting the scoping (`companyId` always applied)
   and the shape of the returned `RuntimeValue`; `job.scrapPercentage` with a zero quantity
   returns `0`; an unknown id refuses.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- operations
# Expected: one passing case per implemented operation, plus the two edge cases.
```

**Out of scope:** adding operations beyond the fifteen declared in Task 7.

---

## Task 26: Implement the lookup search

**Depends on:** Task 19 — independent of Tasks 20, 21, 22, 24, 25
**Files:**
- Create: `packages/jobs/src/workflows/actions/search.ts`
- Create: `packages/jobs/src/workflows/actions/search.test.ts`
- Copy from (precedent, for the untyped-table escape hatch):
  `packages/jobs/src/workflows/engine/loader.ts` lines 29-45

**Steps:**

1. Export:

```ts
export async function runSearch(params: {
  client: SupabaseClient<Database>;
  companyId: string;
  entity: string;
  returns: "one" | "list";
  criteria: SearchCriterion[];
}): Promise<SearchOutcome>
```

2. Resolve the table through `REGISTRY_ENTRIES[entity]?.table` — the same map the loader uses,
   which is what keeps a lookup inside the registry. An unknown entity returns
   `{ok: false, error: \`We no longer know what a ${entity} is.\`}`.

3. Build the query: `.from(table).select("*").eq("companyId", companyId)`, then one filter per
   criterion, mapping operators exactly as `runtime/compare.ts` defines them so the builder
   and the engine cannot disagree:

   | operator | filter |
   |---|---|
   | `eq` | `.eq(field, value)` |
   | `neq` | `.neq(field, value)` |
   | `gt` / `gte` / `lt` / `lte` | the matching Supabase method |
   | `contains` | `.ilike(field, \`%${value}%\`)` |
   | `startsWith` | `.ilike(field, \`${value}%\`)` |
   | `endsWith` | `.ilike(field, \`%${value}\`)` |

   The three pattern operators are case-insensitive and `eq`/`neq` are not — that is the
   existing rule, not a new one. A null criterion value maps to `.is(field, null)` for `eq`
   and `.not(field, "is", null)` for `neq`.

4. Order by `createdAt` descending so "the one" is deterministic, and cap at
   `MAX_LIST_ITEMS + 1` so an over-cap list is detectable. Return
   `{ok: true, value, matched, dropped}` where `value` is a single `entityValue` (with the
   loaded row attached, so a later dot-path costs no second read) for `returns: "one"`, or a
   `listValue` for `returns: "list"`. For `returns: "one"` with no rows, return
   `{ok: true, value: nullValue(), matched: 0, dropped: 0}` — the **executor** turns that into
   a failure (Task 14), so the query layer stays honest about what it found.

5. `.eq("companyId", companyId)` is belt-and-braces on top of RLS. Keep both; an RLS
   regression must not become a cross-tenant read.

6. Tests with a chainable stub: each operator produces the expected filter call; a null value
   uses `.is`; over-cap results report `dropped`; an unknown entity refuses; `companyId` is
   always applied.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- search
# Expected: one case per operator plus the four edge cases.
```

**Out of scope:** batch mode on Lookup — the PRD rules it out, and `loopList` already returns
`undefined` for this node kind.

---

## Task 27: Assemble `WorkflowServices` and inject it into the engine

**Depends on:** Tasks 20, 21, 23, 24, 25, 26
**Files:**
- Create: `packages/jobs/src/workflows/actions/services.ts`
- Create: `packages/jobs/src/workflows/actions/index.ts` — barrel
- Modify: `packages/jobs/src/workflows/engine/execute.ts` — `companyGroupId`, services
- Create: `packages/jobs/src/workflows/actions/services.test.ts`

**Steps:**

1. `services.ts` exports one factory:

```ts
export function createWorkflowServices(params: {
  client: SupabaseClient<Database>;
  catalog: WorkflowCatalog;
  companyId: string;
  companyGroupId: string;
  ownerId: string;
  runId: string;
  workflowId: string;
}): WorkflowServices
```

2. `runAction(actionId, inputs)` routes on the catalog entry and the route record from
   `getActionRoute(actionId)` (Task 10), in this order:
   - `actionId === "notify"` → `runNotifyAction`
   - `actionId === "webhook"` → `runWebhookAction`
   - `route.update !== undefined` → `runUpdateAction`
   - `route.call !== undefined` → `runCreateAction`, with the dispatcher from
     `getWorkflowDispatch()`; when it is `undefined`, return
     `{ok: false, error: "This step is not available in this environment."}`
   - otherwise `{ok: false, error: "This step is no longer available."}`

   Route on the catalog, never on a string prefix — an id that looks like `x.update` but
   carries no `update` block must not reach the update executor.

3. `runOperation` delegates to Task 25's `runOperation`; `search` delegates to Task 26's
   `runSearch`. Both pass the same client through.

4. In `execute.ts`:
   - the `"load"` step already reads the run context; extend `loadRunContext` (in `log.ts`)
     to also return the company's `companyGroupId`, falling back to `companyId` when null, and
     carry it through the returned object. This costs no extra query if it can join the
     existing read; if it cannot, add one `.from("company").select("companyGroupId")` in the
     same step so it is memoised per run rather than per node.
   - in `runExecutor`, after minting the client, build the services and pass them:

```ts
const client = await getOwnerClient(payload.ownerId, payload.runId);
return executor.execute(node, {
  catalog,
  loader: createEntityLoader({ client, companyId: payload.companyId, cache }),
  outputs: args.outputs,
  item: args.item,
  services: createWorkflowServices({
    client,
    catalog,
    companyId: payload.companyId,
    companyGroupId: args.companyGroupId,
    ownerId: payload.ownerId,
    runId: payload.runId,
    workflowId: payload.workflowId
  })
});
```

   Add `item?: RuntimeValue` and `companyGroupId: string` to `NodeArgs`. `item` stays
   `undefined` until Task 28.

5. Replace `createEventCatalog()` at `execute.ts:155` with `createWorkflowCatalog()`.

6. Test: `runAction` routes each of the six shapes to the right implementation, using stubs —
   this is the test that catches a routing regression, which is otherwise invisible until a
   customer's update runs a create.

**Verify:**
```bash
pnpm --filter @carbon/jobs typecheck
pnpm --filter @carbon/jobs test
pnpm exec turbo run typecheck --filter=erp
# Expected: `packages/jobs` typechecks for the first time since Task 12. All tests pass.
```

**Out of scope:** batching.

---

## Task 28: Wire batch mode and record step inputs

**Depends on:** Task 27
**Files:**
- Modify: `packages/jobs/src/workflows/engine/execute.ts` — `runOneNode`, the walk loop
- Modify: `packages/jobs/src/workflows/engine/ledger.ts` — `claimStep` records `input`
- Create: `packages/jobs/src/workflows/engine/batch.test.ts`

**Steps:**

1. In `ledger.ts`, add `input?: unknown` to `claimStep`'s params and write it with the same
   `toJson` helper `settleStep` uses for `output`. The column exists and has never been
   written; the resolved input is the only durable record of what the workflow saw.

2. Redact before writing: drop any key matching `/secret|token|password|signature|authorization|apikey/i`,
   and truncate any string over 4 KB with a `…(truncated)` marker. Put this in one exported
   helper so Task 31's rule note and phase 9's compaction can point at it.

3. In `execute.ts`, split the current `runOneNode` into:
   - `resolveBatchItems(node, ctx)` — returns `undefined` for a non-batched node, otherwise
     resolves the node's single list input (the same rule `actionLoopList` enforces at
     validation time), runs `planBatch`, and returns `{items, dropped}`. An input that does
     not resolve to a list returns a skip.
   - `runNode(step, args)` — for a non-batched node, exactly today's behaviour with
     `itemKey: ""` and step id `` `node:${nodeId}` ``. For a batched node, one
     `step.run(\`node:${nodeId}:${itemKeyFor(item)}\`, ...)` per item, each claiming with
     `itemKey: itemKeyFor(item)` and executing with `ctx.item` set to that item.

4. Aggregate a batched node: it **succeeds if at least one item succeeded**; its outputs are a
   `listValue` of the per-item primary output (the action's first declared output), in item
   order; its handle is `SUCCESS_HANDLE` when any succeeded and `FAILURE_HANDLE` when none
   did. The summary reads `Ran 100 of 143; 43 were not used.` when `dropped > 0`, else
   `Ran 12 of 12; 1 failed.` Dropped items are never silently discarded.

5. The step id must stay deterministic — `itemKeyFor` is a record id or a stable hash, never a
   position in the list. A list that comes back in a different order must not re-run work.

6. `advance(state, definition, nodeId, handle)` is still called once for the whole node, with
   the aggregated handle. Do not touch `walk.ts`.

7. Tests: a batch of three runs three steps with three distinct item keys; a batch where one
   item fails still succeeds and reports the failure in the summary; a batch where all fail
   follows the failure handle; a 150-item list runs 100 and reports 50 dropped; re-running the
   same node claims nothing because every item key already has a row.

**Verify:**
```bash
pnpm --filter @carbon/jobs test
pnpm --filter @carbon/jobs typecheck
# Expected: all pass, including the five new batch cases.
```

**Out of scope:** the lost-claim replay divergence at `execute.ts:119-121` (a lost claim
always returns `Skipped` where the phase-4 spec wanted a terminal row's output reused). Leave
it; note it in Task 31.

---

## Task 29: Add the ERP notification row and link cases

**Depends on:** Task 28
**Files:**
- Modify: `apps/erp/app/components/Layout/Topbar/Notifications.tsx` — one case in
  `GenericNotification`
- Modify: `apps/erp/app/routes/api+/link.ts` — one case in `resolve`
- Copy from (precedent): the `NotificationEvent.JobAssignment` case in the same
  `GenericNotification` switch, and the `JobAssignment` case in `link.ts`'s `resolve`

**Steps:**

1. In `Notifications.tsx`, add `case NotificationEvent.Workflow:` to the `GenericNotification`
   switch. **This is not optional** — the switch ends in `default: return null`, so without it
   the row is written to the database and renders as nothing, which reads to a customer as a
   notification that never arrived. Copy the layout of the `JobAssignment` case exactly:
   same icon slot, same title/description placement, same read/unread treatment. Use the
   notification's `description` as the title and its `payload.details` for the secondary line.
   Pick an icon already imported in that file rather than adding a new dependency.

2. In `link.ts`'s `resolve`, add `case NotificationEvent.Workflow:` returning the record's own
   page when `documentType` names one the switch already handles, and `null` otherwise. A
   `null` falls through to `path.to.authenticatedRoot`, which is the right answer for a
   notification about no particular record.

3. Do not add a new `NotificationTopic` — Task 22 deliberately reused `General` because
   `topicLabels` in `apps/erp/app/routes/x+/account+/notifications.tsx` is an exhaustive
   record.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec biome check apps/erp/app/components/Layout/Topbar/Notifications.tsx apps/erp/app/routes/api+/link.ts
# Expected: both silent. Visual confirmation happens in Task 30.
```

**Out of scope:** any other builder UI.

---

## Task 30: End-to-end verification

**Depends on:** Task 29
**Files:**
- Create: `packages/jobs/src/workflows/engine/end-to-end.test.ts`

**Steps:**

1. Write one test per spec acceptance criterion 1-4, driving `executeWorkflowRun` with a
   seeded definition, a fake `EngineStep` that just invokes its handler, and stubbed services.
   These prove the wiring, not the database:
   - trigger → condition on `record.orderTotal > 10000` → notify with a template subject;
     assert the notify payload's `title` reads
     `"Purchase order PO-1042 is over $10,000"`;
   - trigger → `salesOrder.create` → notify referencing the created order's output;
   - trigger → lookup → filter → batched `job.update`; assert one step row per job;
   - trigger → entity operation → condition → `nonConformance.create`; assert exactly one
     create call.

2. Then verify the real thing against the running app, with the user's permission. Ask before
   starting — this needs their local stack. Use the `/test` skill and the `/auth` skill.
   Seed one workflow directly in the database (there is no builder yet), switch it on, make
   the triggering change in the ERP, and confirm: a `workflowRun` row reaching `Succeeded`,
   one `workflowStepRun` per node with `input` populated, and the notification appearing in
   the topbar — the last of which is what proves Task 29.

3. Verify acceptance criteria 5-13 as unit tests in the files that own them (Tasks 20, 14, 24,
   28) rather than duplicating them here. Confirm each is present before calling this task
   done; if any is missing, add it to that task's test file.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
pnpm --filter @carbon/jobs test
pnpm exec turbo run typecheck --filter=erp
pnpm run check:workflow-catalog
pnpm exec biome check packages/workflows packages/jobs
# Expected: every command exits 0. Do not claim this task done on a partial run — run all
# five and read the output.
```

**Out of scope:** load testing, and the run-history screen.

---

## Task 31: Sync AGENTS.md, rules and lessons

**Depends on:** Task 30
**Files:**
- Modify: `packages/workflows/AGENTS.md` — the two new catalogues, the new layout, the
  template value form, the widened permission contract
- Modify: `packages/jobs/AGENTS.md` — the `src/workflows/actions/` directory and the
  dispatcher seam
- Modify: `.claude/rules/workflow-engine.md` — remove the "not available yet" and
  "batch is unwired" notes, add the services port, the module+action gate and batch stepping
- Modify: `.claude/rules/workflow-event-catalog.md` — remove
  "`write` … belongs to phase 5's action catalog", describe the action and operation catalogues
- Create: `.claude/rules/workflow-actions.md` — the new subsystem rule, with
  `paths: ["packages/jobs/src/workflows/actions/**", "packages/workflows/src/catalog/actions.ts", "packages/workflows/src/catalog/operations.ts"]`
- Modify: `.ai/lessons.md` — any pitfall hit during execution, in the
  `Context → Problem → Rule → Applies to` format
- Modify: `.ai/specs/2026-07-30-workflows-catalogs.md` — record any divergence from the spec,
  then move it to `.ai/specs/implemented/`

**Steps:**

1. Document **committed** behaviour only, and delete any line that is now wrong rather than
   softening it — a confidently wrong doc is worse than a missing one.

2. `.claude/rules/workflow-actions.md` must cover: the two catalogue sources and the flat
   generated file; why `write` is restrictive and `watch` is not; the dispatcher injection
   seam and why it exists; the four-step order of the update executor and why the foreign-key
   check is a tenancy guarantee; the signing scheme and the URL guard; and the fact that the
   two older webhook systems are deliberately untouched.

3. Add a lesson for anything that bit during execution. Two candidates already known: the
   lost-claim divergence left in place at `execute.ts:119-121`, and — if it recurs — the
   erp instantiation budget tipping into TS2589 from the new catalogue type surface.

4. Run `pnpm run lingui:extract && pnpm run lingui:clean` once, since the generated label file
   gained action and operation entries. Expect churn only in the new keys; if the diff is
   enormous, that is the known `.po` churn on this branch — confirm before committing.

**Verify:**
```bash
grep -rn "not available yet\|batch is unwired\|belongs to phase 5" .claude/rules/ packages/*/AGENTS.md
# Expected: no matches. Every phase-5 placeholder in the docs is gone.
```

**Out of scope:** the product docs under `docs/content/` — Workflows has no customer-facing
surface until phase 7.
