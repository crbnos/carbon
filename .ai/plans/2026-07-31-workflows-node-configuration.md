# Workflows — Node Configuration, Variables and Type Safety — implementation plan

**Spec / source:** `.ai/specs/2026-07-31-workflows-node-configuration.md`
**Branch:** `feat/automation`
**Predecessor:** phase 7 canvas, commit `7d132cd8b`

Read before starting: `packages/workflows/AGENTS.md`,
`apps/erp/app/modules/workflows/AGENTS.md`, `.ai/lessons.md` (lines 580–744),
`.claude/rules/workflow-event-catalog.md`, `.claude/rules/keep-sources-in-sync.md`.

## Corrections to the spec, discovered while planning

These are measured facts that contradict the spec text. Follow the plan, not the spec,
where they disagree; Task 22 amends the spec.

1. **`job.priority` is not an enum.** In `packages/database/src/swagger-docs-schema.ts`
   it is `{ format: "double precision", type: "number" }`. The only enum among *writable*
   job columns is `job.deadlineType`
   (`["No Deadline","ASAP","Soft Deadline","Hard Deadline"]`). Every acceptance criterion
   that said "job priority dropdown" uses `job.deadlineType` here.
2. **Label volume is 470 new descriptors, not ~600.** Measured: 16 entity labels + 373
   entity properties (`WORKFLOW_ENTITIES` in `events.generated.ts`) + 81 action/operation
   inputs. `WORKFLOW_LABELS` goes from 137 to ~607 entries.
3. **`ancestorsOf` is not a top-level function.** It is a closure inside `createContext`
   (`packages/workflows/src/definition/validate.ts:312-320`) and is not on `NodeContext`.
   Task 4 has to lift it out, not just move it.
4. **`apps/erp` does not depend on `@carbon/tiptap`** — only `@carbon/react` does. The
   spec's "erp uses `createMentionExtension`" is not buildable. Task 13 adds a small
   `@carbon/react/VariableText` component instead and erp consumes that.
5. **The builder store has no way to change node data.** `store.ts` exposes only
   `onNodesChange` / `onEdgesChange` / `onConnect` / `addNode` / `setSelected` /
   `setIssues` / `setSaveState` / `rebaseline`. Task 8 adds the patch actions.
6. **`shouldRevalidate` lives on the parent route** `x+/workflow+/$id.tsx:39-43`, not on
   `$id.save.tsx`. Nothing in this plan touches either.

## Progress

- [ ] Task 1: Add `choices`, `template` and `getEnum` to the catalog contract
- [ ] Task 2: Emit choices, template flags and the new label families from `buildCatalog`
- [ ] Task 3: Regenerate the committed catalogs and extract the new strings
- [ ] Task 4: Extract `availableVariables` into `definition/variables.ts`
- [ ] Task 5: Add an optional `title` to the node base
- [ ] Task 6: Validate a literal against its input's `choices`
- [ ] Task 7: Extend `check-workflow-catalog` to the new label families
- [ ] Task 8: Add node-patch actions to the builder store
- [ ] Task 9: Three-panel builder layout and the config panel shell
- [ ] Task 10: Catalog + label lookup helpers for the browser
- [ ] Task 11: `ValueField` — literal controls per type, and the variable chip
- [ ] Task 12: `VariablePicker` — grouped, typed, soft-filtered, two-hop drill
- [ ] Task 13: `@carbon/react/VariableText` — the chip-based template editor
- [ ] Task 14: `TemplateField` — wire VariableText to `{kind:"template"}` parts
- [ ] Task 15: `RECORD_PICKERS` — Carbon's own selectors as entity literals
- [ ] Task 16: `ClauseRow` — operator self-healing over the three-column grid
- [ ] Task 17: Trigger form, including the schedule editor
- [ ] Task 18: Condition form and Filter form
- [ ] Task 19: Lookup form and Entity form
- [ ] Task 20: Action form — ranking, `requireOneOf`, batch mode, Notify `about`
- [ ] Task 21: Node-card summaries, failure-path warning, issue anchoring, safe delete
- [ ] Task 22: Sync AGENTS.md, the phase-7 spec and this spec
- [ ] Task 23: End-to-end verification

## Dependencies

```
1 → 2 → 3 → 6, 7
1 → 4, 5                    (4 and 5 are independent of each other and of 2/3)
3 → 10
5, 8 → 9
9, 10 → 11 → 12 → 16
11 → 15
13 → 14
16 → 18, 19
11, 12, 14, 15 → 20
9 → 17
all → 21 → 22 → 23
```

Parallelisable groups (safe to run as concurrent subagents):
- Tasks 4 and 5 after Task 1.
- Tasks 13 and 15 after Task 11.
- Tasks 17, 18, 19 after Task 16.

---

## Task 1: Add `choices`, `template` and `getEnum` to the catalog contract

**Depends on:** none
**Files:**
- Modify: `packages/workflows/src/definition/catalog.ts` — extend `CatalogInput`, extend
  `WorkflowCatalog`, implement `getEnum` in `createFixtureCatalog`
- Modify: `packages/workflows/src/catalog/catalog.ts` — implement `getEnum` in
  `createWorkflowCatalog`
- Modify: `packages/workflows/src/catalog/actions.ts` — add `template: true` to three inputs
- Modify: `packages/workflows/src/catalog/build.ts` — carry the two new fields through
  `BuiltActionInput`

**Steps:**

1. In `packages/workflows/src/definition/catalog.ts`, replace `CatalogInput` (lines 25–28):
   ```ts
   export interface CatalogInput {
     type: ValueType;
     required: boolean;
     /** Allowed literal values, where the underlying column is an enum. */
     choices?: readonly string[];
     /** Prose that may interleave text and variables; the builder renders a chip editor. */
     template?: boolean;
   }
   ```
2. In the same file extend `WorkflowCatalog` (lines 55–61) with one method, keeping the
   existing four unchanged:
   ```ts
     /** Allowed values for an entity's column, or undefined when it is not an enum. */
     getEnum(entity: string, property: string): readonly string[] | undefined;
   ```
3. In `createFixtureCatalog` (same file, lines 183–208) add `getEnum` to the returned
   object. Back it with a new module-level const beside `FIXTURE_ENTITIES`:
   ```ts
   const FIXTURE_ENUMS: Record<string, Record<string, readonly string[]>> = {
     purchaseOrder: { status: ["Draft", "Planned", "To Receive"] }
   };
   ```
   and return `(entity, property) => FIXTURE_ENUMS[entity]?.[property]`. Add
   `omitEnums?: boolean` to `FixtureCatalogOptions` returning `undefined` throughout when
   set, matching how the other `omit*` options prove the catalog is injected.
4. In `packages/workflows/src/catalog/catalog.ts`, add a fifth Map built at module load
   next to `EVENTS` / `ENTITIES` / `ACTIONS` / `OPERATIONS` (lines 15–45), sourced from a
   new `WORKFLOW_ENTITY_ENUMS` export that Task 2 adds to `events.generated.ts`:
   ```ts
   const ENUMS = new Map<string, Record<string, readonly string[]>>(
     Object.entries(WORKFLOW_ENTITY_ENUMS)
   );
   ```
   and add to the object returned by `createWorkflowCatalog` (lines 47–54):
   ```ts
     getEnum: (entity, property) => ENUMS.get(entity)?.[property]
   ```
   Import `WORKFLOW_ENTITY_ENUMS` from `./events.generated`. **This import will not compile
   until Task 2 and Task 3 have run** — that is expected; Task 1's Verify block accounts
   for it by deferring the typecheck.
5. In `packages/workflows/src/catalog/actions.ts`, add `template: true` to exactly three
   input declarations and no others:
   - `notify.subject` (line ~108)
   - `notify.message` (line ~109)
   - `webhook.body` (line ~124)

   Also widen `ActionInputLike` (lines 4–8) to accept them:
   ```ts
   export interface ActionInputLike {
     type: ValueType;
     required: boolean;
     label: string;
     template?: boolean;
   }
   ```
6. In `packages/workflows/src/catalog/build.ts`, extend `BuiltActionInput` (line 62) with
   the same two optional fields:
   ```ts
   export interface BuiltActionInput {
     type: ValueType;
     required: boolean;
     choices?: readonly string[];
     template?: boolean;
   }
   ```
   Do not populate them yet — Task 2 does that.
7. Grep for every other place that constructs a `WorkflowCatalog` object literal and add
   `getEnum` there too:
   ```bash
   rg -n "WorkflowCatalog" --glob '!node_modules' packages apps
   ```
   Consumers that only *accept* a `WorkflowCatalog` need no change. If this grep turns up
   an object literal outside `catalog.ts` and `definition/catalog.ts`, add
   `getEnum: () => undefined` to it.

**Verify:**
```bash
pnpm exec biome check packages/workflows/src/definition/catalog.ts packages/workflows/src/catalog/
# Expected: no error-severity diagnostics for these files
rg -n "getEnum" packages/workflows/src
# Expected: at least 3 hits — the interface, createFixtureCatalog, createWorkflowCatalog
```
Typecheck is deferred to Task 3 because step 4 forward-references a generated export.

**Out of scope:** do not touch `definition/nodes.ts`, `definition/validate.ts`, or any
`*.generated.ts` file in this task.

---

## Task 2: Emit choices, template flags and the new label families from `buildCatalog`

**Depends on:** Task 1
**Files:**
- Modify: `packages/workflows/src/catalog/build.ts` — `buildCatalog` (line 336) and
  `BuiltCatalog` (line 84)
- Modify: `packages/workflows/src/catalog/build.test.ts` — add coverage
- Copy from (precedent): the existing label assignments at `build.ts:389-390, 404, 411,
  421, 431, 454, 468`

**Steps:**

1. Add a `enums` member to `BuiltCatalog` (line 84):
   ```ts
   /** Per entity, per column, the allowed values — only for columns the schema enumerates. */
   enums: Record<string, Record<string, readonly string[]>>;
   ```
2. Add a private helper next to `entityProperties` (line 319):
   ```ts
   /** The enum a column declares, or undefined. `SwaggerProperty.enum` already exists. */
   function enumFor(
     schema: SwaggerSchema,
     table: string,
     column: string
   ): readonly string[] | undefined {
     return schema.definitions[table]?.properties?.[column]?.enum;
   }
   ```
3. In `buildCatalog`, while walking the registry to build `WORKFLOW_ENTITIES`, populate
   `enums[entityName][column]` for every property whose `enumFor(schema, entry.table,
   column)` is defined. Skip entities with no enum columns rather than storing `{}`.
4. Populate `choices` on every built action and operation input. The rule, stated exactly:

   > An input's choices come from `enumFor(schema, table, inputName)` where `table` is
   > resolved in this order — (a) `declaration.update.entity`'s registry table, (b) the
   > registry table of the id prefix when the id has the form `<entity>.<verb>` and
   > `<entity>` is a key of the registry, (c) for operations, `declaration.entity`'s
   > registry table. An input whose action resolves to no table gets no choices.

   Under this rule `notify` and `webhook` get none (correct — neither has an enum input),
   and `job.update.deadlineType`, `nonConformance.create.status`,
   `nonConformance.create.priority`, `nonConformance.create.source` do.
5. Copy `template` straight through from the hand-written declaration onto the built input.
   Emit the key only when true, so the generated diff stays minimal.
6. Emit three new label families into `built.labels`, alongside the existing assignments:

   | Key | Source |
   |---|---|
   | `entity.<name>` | `entry.label` from the registry |
   | `entity.<name>.<column>` | the hand-written `label` in the entity's `watch` or `write` map, sentence-cased; otherwise `humanizeColumn(column)` |
   | `action.<id>.input.<name>` | the hand-written `label` on the input, sentence-cased; otherwise `humanizeColumn(name)` |
   | `operation.<id>.input.<name>` | same rule as actions |

   The `entity.<name>.<column>` family covers **every** property in `WORKFLOW_ENTITIES`
   (373 of them), not only the curated `watch`/`write` columns.

7. Add the derivation helper to `build.ts`, beside `lowerFirst` (line 119):
   ```ts
   /** `nonConformanceTypeId` -> `Non conformance type`. */
   function humanizeColumn(column: string): string {
     const withoutId = column.replace(/Id$/, "");
     const spaced = withoutId.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
     return spaced.charAt(0).toUpperCase() + spaced.slice(1);
   }
   ```
   Sentence-casing a hand-written label uses the same final two lines (the registry writes
   `"supplier reference"`, the picker needs `"Supplier reference"`).
8. A label string must never contain a backtick or a `${`, because the generator emits it
   inside a `` msg`...` `` template. Add a guard in `buildCatalog` that pushes a plain-English
   error rather than emitting a broken file, and cover it in the test.
9. Extend `validateCatalogInputs` (line 172) with one rule: a hand-written input declaring
   `template: true` must have `type` `{kind:"primitive", of:"string"}`. Return the error
   `` `${id}.${name} is a template but is not a string.` ``.
10. In `build.test.ts`, add cases to the existing `describe`s:
    - labels (currently at line 167): a property label is derived when the registry has none
      (`purchaseOrder.supplierReference` → `Supplier reference` from the hand-written label;
      an uncurated column such as `purchaseOrder.currencyCode` → `Currency code` derived);
      every key of `WORKFLOW_ENTITIES[name]` has an `entity.<name>.<column>` label; a label
      containing a backtick is an error.
    - entity properties (line 283): `enums.job.deadlineType` equals the four schema values,
      and `enums.job.priority` is `undefined`.
    - the hand-written inputs (line 532): `notify.subject.template === true`,
      `webhook.url.template` is undefined, and a template input typed as a number is an
      error from `validateCatalogInputs`.

**Verify:**
```bash
pnpm --filter @carbon/workflows run test
# Expected: all suites pass, including the new build.test.ts cases
```

**Out of scope:** do not run the generator here (Task 3), do not edit any `*.generated.ts`
by hand, do not touch `scripts/generate-workflow-catalog.ts` — it already emits
`built.labels` verbatim and needs no change for the new families.

---

## Task 3: Regenerate the committed catalogs and extract the new strings

**Depends on:** Task 2
**Files:**
- Modify: `packages/workflows/src/catalog/events.generated.ts` (generated)
- Modify: `packages/workflows/src/catalog/actions.generated.ts` (generated)
- Modify: `packages/workflows/src/catalog/labels.generated.ts` (generated)
- Modify: `scripts/generate-workflow-catalog.ts` — emit `WORKFLOW_ENTITY_ENUMS`
- Modify: `packages/locale/locales/*/erp.po` (generated)

**Steps:**

1. In `scripts/generate-workflow-catalog.ts`, extend the `events` emission block (lines
   42–54) with a third export, so `catalog/catalog.ts` can import it:
   ```ts
   `export const WORKFLOW_ENTITY_ENUMS: Record<string, Record<string, readonly string[]>> = ${JSON.stringify(sorted(built.enums))};`
   ```
   Keep it in `events.generated.ts` — it is runtime data and must not import `@lingui/*`.
2. Run the generator from the repo root (it is `process.cwd()`-relative):
   ```bash
   pnpm run generate:workflow-catalog
   ```
3. Inspect the diff before going further. `git diff --stat packages/workflows/src/catalog/`
   should show exactly the three generated files. `labels.generated.ts` should gain roughly
   470 entries, reaching ~607.
4. Extract and clean the translation catalogs:
   ```bash
   pnpm run lingui:extract
   pnpm run lingui:clean
   ```
   `packages/workflows/src` is in the `erp` catalog's `include`, so the new `msg`
   descriptors land in `packages/locale/locales/{locale}/erp.po` across all 13 locales.
   Do **not** run `pnpm run translate` here — filling the other 12 locales is a separate,
   optional pass.
5. `.ai/lessons.md` line 511: a turbo run regenerates `@carbon/database` artifacts as a
   side effect. Check and revert them if they appear:
   ```bash
   git status --short packages/database/
   git checkout -- packages/database/src/types.ts packages/database/supabase/functions/lib/types.ts
   ```

**Verify:**
```bash
pnpm run check:workflow-catalog
# Expected: no output and exit 0. Any "run pnpm run generate:workflow-catalog" means step 2 was skipped.
pnpm --filter @carbon/workflows run typecheck
# Expected: no errors — this is where Task 1 step 4's forward reference finally resolves
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors. The binding constraint: erp targets ES2019 and compiles package source.
```

**Out of scope:** do not hand-edit a `*.generated.ts` for any reason. If the generated
output looks wrong, fix `build.ts` and regenerate. If `check:workflow-catalog` fails on the
label-family set comparison, that is Task 7's work arriving early — STOP and do Task 7
first rather than loosening the check.

---

## Task 4: Extract `availableVariables` into `definition/variables.ts`

**Depends on:** Task 1
**Files:**
- Create: `packages/workflows/src/definition/variables.ts`
- Create: `packages/workflows/src/definition/variables.test.ts`
- Modify: `packages/workflows/src/definition/validate.ts` — import what moved out
- Modify: `packages/workflows/src/index.ts` — export at line 115
- Copy from (precedent): `packages/workflows/src/definition/validate.ts:266-389`

**Steps:**

1. Move these four out of `validate.ts` into the new `variables.ts`, unchanged in
   behaviour: `buildAdjacency` (line 266), `reachableFrom` (line 282), `createContext`
   (line 301), and the `ancestorsOf` closure (lines 312–320).
2. `ancestorsOf` must survive the move as something callable from outside. Change
   `createContext` to return both:
   ```ts
   export interface DefinitionContext {
     context: NodeContext;
     ancestorsOf: (nodeId: string) => Set<string>;
   }
   export function createContext(
     definition: WorkflowDefinition,
     catalog: WorkflowCatalog
   ): DefinitionContext;
   ```
   Update the single call site, `validate.ts:61`, to destructure `context`. Do **not** add
   `ancestorsOf` to `NodeContext` in `nodes.ts` — nothing in the node kinds needs it and
   widening that interface touches all six kinds.
3. Add the new export:
   ```ts
   export interface AvailableVariable {
     nodeId: string;
     /** The node's name, for grouping in the picker. */
     nodeTitle: string;
     nodeType: WorkflowNodeType;
     /** The output name on that node, e.g. "record", "before", "result". */
     output: string;
     type: ValueType;
     /** False when the node sits on a branch that need not have run. */
     guaranteed: boolean;
   }

   export function availableVariables(
     definition: WorkflowDefinition,
     nodeId: string,
     catalog: WorkflowCatalog
   ): AvailableVariable[];
   ```
   Implementation: build the context, take `ancestorsOf(nodeId)`, and for each ancestor in
   topological order call `context.outputsOf(ancestorId)`; emit one `AvailableVariable` per
   `[output, type]` pair. `nodeTitle` is `node.title` when set, else the node's `type`
   string — the *display* fallback is the ERP's job, not this package's.
4. `guaranteed` is graph dominance: an ancestor `a` is guaranteed for target `t` when
   removing `a` disconnects `t` from the trigger. Implement it directly — for each
   ancestor, run `reachableFrom(triggerId, forwardAdjacency)` with `a` excluded and test
   whether `t` is still reached. With `MAX_NODE_EXECUTIONS` at 500 the graphs are small
   enough that the naive O(V·E) version is correct and fast; do not build a dominator tree.
   If a definition has no trigger node, return every variable with `guaranteed: false`
   rather than throwing.
5. Sort the result: guaranteed first, then by the ancestor's distance from the trigger
   (nearest last, so the most recently produced values appear at the top of the picker),
   then by output name. Stable ordering matters — the picker must not reshuffle on
   re-render.
6. Add `export { availableVariables } from "./definition/variables";` and the
   `AvailableVariable` type export to `packages/workflows/src/index.ts`, inserted at line
   115 (after `./definition/validate`, before `./run-trigger`, keeping alphabetical order).
7. Write `variables.test.ts` covering:
   - a linear trigger → lookup → action graph: at the action, both the trigger's outputs
     and the lookup's `result` are available, all `guaranteed: true`
   - a condition with two paths that reconverge: a node on one path is `guaranteed: false`
     at the join, and the trigger is still `guaranteed: true`
   - a node is never offered its own outputs, and never a downstream node's
   - the set returned always matches what the validator accepts: build a `ref` to each
     returned variable and assert `validateDefinition` reports no `REF_NOT_UPSTREAM`
   - an unknown catalog event yields no trigger outputs rather than throwing (use
     `createFixtureCatalog({ omitEvents: [...] })`)

**Verify:**
```bash
pnpm --filter @carbon/workflows run test
# Expected: all suites pass, including variables.test.ts; validate.test.ts unchanged and green
pnpm --filter @carbon/workflows run typecheck
# Expected: no errors
```

**Out of scope:** do not change any validator rule or issue code; this task is a pure
extraction plus one new read-only function. If moving `createContext` forces a change to a
validator check's behaviour, STOP and report — do not improvise.

---

## Task 5: Add an optional `title` to the node base

**Depends on:** Task 1
**Files:**
- Modify: `packages/workflows/src/definition/schema.ts` — `nodeBase`, lines 22–25
- Modify: `packages/workflows/src/definition/schema.test.ts`

**Steps:**

1. Add one line to `nodeBase`:
   ```ts
   const nodeBase = {
     id: z.string().min(1),
     /** Customer-given name. Optional, so every stored definition still parses. */
     title: z.string().optional(),
     position: z.object({ x: z.number(), y: z.number() })
   };
   ```
2. Leave `CURRENT_DEFINITION_FORMAT_VERSION` at **2**. The field is optional and additive,
   so `migrateDefinition` in `definition/normalize.ts` needs no new step. Do not bump the
   constant and do not touch `normalize.ts`.
3. In `schema.test.ts`, extend the existing node-defaults `describe` (line 48): a node
   without `title` parses and `title` is `undefined`; a node with `title: "Open POs"`
   round-trips; `title: ""` is accepted (the ERP treats empty as unset rather than the
   schema rejecting it).

**Verify:**
```bash
pnpm --filter @carbon/workflows run test
# Expected: all suites pass
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors — the erp builder constructs nodes and must still compile
```

**Out of scope:** `normalize.ts`, `CURRENT_DEFINITION_FORMAT_VERSION`, and the `title`
*input name* that already appears in action fixtures — they are unrelated.

---

## Task 6: Validate a literal against its input's `choices`

**Depends on:** Task 3
**Files:**
- Modify: `packages/workflows/src/definition/nodes.ts` — `checkInputs`, after line 206
- Modify: `packages/workflows/src/definition/validate.test.ts`
- Copy from (precedent): the `typesEqual` mismatch check at `nodes.ts:199-206`

**Steps:**

1. Inside the `for (const [name, declaration] of Object.entries(declared))` loop in
   `checkInputs` (starts line 155), immediately after the existing `typesEqual` mismatch
   emission (line 206), add:
   ```ts
   if (
     declaration.choices !== undefined &&
     supplied.kind === "literal" &&
     typeof supplied.value === "string" &&
     !declaration.choices.includes(supplied.value)
   ) {
     issues.push({
       code: "INCOMPLETE_CONFIG",
       message: `"${supplied.value}" is not a valid ${name}.`,
       nodeId: node.id,
       field: `inputs.${name}`
     });
   }
   ```
   Only `kind: "literal"` is checked — a `ref` resolves at run time and
   `packages/jobs/src/workflows/actions/update.ts:108-113` is the backstop for it.
2. Do the same for lookup match values. In the lookup kind's `checkConfig`, for each entry
   of `node.data.match`, when `catalog.getEnum(node.data.entity, entry.field)` is defined
   and `entry.value` is a string literal outside it, emit the same code with
   `field: \`match.${index}.value\``.
3. `validate.ts` itself needs no change — it delegates through `checkNodeTypes` (line 472)
   and `checkNodeConfig` (line 482).
4. In `validate.test.ts`, extend the configuration `describe` (line 446): an action input
   with `choices` rejects an out-of-list literal with `INCOMPLETE_CONFIG` and the field path
   `inputs.<name>`; accepts an in-list one; accepts a `ref` without checking it; and
   `createFixtureCatalog({ omitEnums: true })` produces no such issue, proving the check
   reads the injected catalog rather than baking one in.

**Verify:**
```bash
pnpm --filter @carbon/workflows run test
# Expected: all suites pass, including the new validate.test.ts cases
```

**Out of scope:** do not add a new `WorkflowIssueCode`. `INCOMPLETE_CONFIG` already exists
(`issues.ts:24`) and the spec's Non-Goals forbid touching `issues.ts`.

---

## Task 7: Extend `check-workflow-catalog` to the new label families

**Depends on:** Task 3
**Files:**
- Modify: `scripts/check-workflow-catalog.ts` — the label block, lines 162–176

**Steps:**

1. The existing block already reads the file as text and set-compares both directions
   against `Object.keys(rebuilt.labels)`. Because Task 2 puts the new families into
   `built.labels`, that comparison covers them **already**. Confirm this by running the
   check with one label deleted (step 3) before writing any code.
2. The only real change needed is the regex. It is currently anchored on exactly two
   leading spaces and an identifier-or-quoted key:
   ```ts
   [...labelSource.matchAll(/^ {2}"?([^":\s]+)"?:\s*msg`/gm)]
   ```
   Keys like `entity.purchaseOrder.supplierReference` contain dots, so Biome will keep them
   quoted and the existing pattern matches. Verify with a one-liner rather than assuming:
   ```bash
   node -e 'const s=require("fs").readFileSync("packages/workflows/src/catalog/labels.generated.ts","utf8");console.log([...s.matchAll(/^ {2}"?([^":\s]+)"?:\s*msg`/gm)].length)'
   # Expected: the same number as `Object.keys(built.labels).length` (~607)
   ```
   If the count is short, widen the pattern — do not loosen the set comparison.
3. Add a positive assertion the current script lacks, in the same block: every key of
   `rebuilt.entities` must have an `entity.<name>` label, and every property of every entity
   must have an `entity.<name>.<column>` label. This is the check that catches a migration
   renaming a column and orphaning its label. Report failures as, verbatim:
   ```
   `${entity}.${column} has no label. Run pnpm run generate:workflow-catalog.`
   ```
4. Prove the check fails when it should: delete one line from `labels.generated.ts`, run
   the check, confirm a non-zero exit and a message naming that key, then restore the file
   with `git checkout -- packages/workflows/src/catalog/labels.generated.ts`.

**Verify:**
```bash
pnpm run check:workflow-catalog
# Expected: exit 0, no output
```
Plus the deliberate-failure evidence from step 4 — record the message it printed.

**Out of scope:** the moment-raise-site check, the MCP tool-route check and the
deep-equality staleness check are all working; do not restructure them.

---

## Task 8: Add node-patch actions to the builder store

**Depends on:** none (but land it after Task 5 so `title` exists)
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/store.ts` — `BuilderState` (lines
  19–38) and the store body
- Copy from (precedent):
  `apps/erp/app/components/DocumentTemplateEditor/context.tsx:261-266` (`updateBlock`)

**Steps:**

1. Add three actions to the `BuilderState` type and implement them:
   ```ts
   /** Merge a patch into one node's `data`. The only way node configuration changes. */
   updateNodeData: (id: string, patch: Record<string, unknown>) => void;
   /** Set or clear a node's customer-given name. */
   renameNode: (id: string, title: string) => void;
   /** Delete a node and its edges. Refuses the trigger, as `onNodesChange` already does. */
   removeNode: (id: string) => void;
   ```
2. `updateNodeData` follows `updateBlock` exactly — map over `nodes`, and for the matching
   id return `{ ...n, data: { ...n.data, ...patch } }`. It must **not** touch
   `selectedNodeId`, `position` or `type`.
3. `renameNode` writes `title` wherever `graph.ts`'s `toBuilderNode` keeps the workflow
   node's own fields. Read `graph.ts` first and follow whichever it already does —
   `fromReactFlow` must round-trip the title into `workflowDefinitionSchema` unchanged. Add
   a `graph.test.ts` case asserting that round-trip.
4. `removeNode` filters `nodes` by id and `edges` by `source`/`target`, and clears
   `selectedNodeId` when it pointed at the removed node. It is a no-op for a node whose
   `type === "trigger"`, mirroring the existing `onNodesChange` guard.
5. None of the three may touch `baseline` — `Autosave.tsx` compares against it, and
   short-circuiting it would suppress the save.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/workflows/ui/Builder/graph.test.ts
# Expected: all tests pass, including the new title round-trip case
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** `onNodesChange`, `onConnect`, `addNode`, `Autosave.tsx`. Do not add undo
— its absence is a recorded phase-7 decision (`apps/erp/app/modules/workflows/AGENTS.md:74`).

---

## Task 9: Three-panel builder layout and the config panel shell

**Depends on:** Tasks 5, 8
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/WorkflowBuilder.tsx` — lines 81–121
- Create: `apps/erp/app/modules/workflows/ui/Builder/panel/ConfigPanel.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/panel/NodeNameField.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/panel/forms/index.ts`
- Create: six stubs under `apps/erp/app/modules/workflows/ui/Builder/panel/forms/` —
  `TriggerForm.tsx`, `ConditionForm.tsx`, `EntityForm.tsx`, `LookupForm.tsx`,
  `FilterForm.tsx`, `ActionForm.tsx`
- Copy from (precedent): `apps/erp/app/components/DocumentTemplateEditor/index.tsx:92-141`
  for the layout; `apps/erp/app/components/DocumentTemplateEditor/BlockConfig.tsx` for the
  panel-reads-store shape; `apps/erp/app/modules/workflows/ui/Builder/nodes/index.ts` for
  the exhaustive-record idiom

**Steps:**

1. Replace the flexbox root of `WorkflowBuilder.tsx` with a `ResizablePanelGroup`, keeping
   the `NodePalette` and the ReactFlow wrapper exactly as they are today:
   ```tsx
   <ResizablePanelGroup
     direction="horizontal"
     autoSaveId="workflow-builder"
     className="flex flex-1 overflow-hidden"
   >
   ```
   with three children — the palette (only when `!isReadOnly`, `id="palette"`, `order={1}`,
   `defaultSize={14}`, `minSize={10}`, `maxSize={22}`), a `ResizableHandle withHandle`, the
   canvas (`id="canvas"`, `order={2}`, `defaultSize={62}`, `minSize={30}`), a second handle,
   and the config panel (`id="config"`, `order={3}`, `defaultSize={24}`, `minSize={18}`,
   `maxSize={40}`). Import `ResizableHandle`, `ResizablePanel`, `ResizablePanelGroup` and
   `ScrollArea` from `@carbon/react`.
2. Keep `onKeyDownCapture`, `onDrop` and `onDragOver` on the **canvas wrapper div**, not on
   the panel group. The config panel then sits outside the ReactFlow key scope and needs no
   guard of its own.
3. Render the config panel only when `!isReadOnly`. On a live version the whole
   `ResizablePanel` and its preceding handle are omitted — a read-only version must not
   show editable controls at all.
4. `ConfigPanel.tsx` reads `selectedNodeId` and `nodes` via `useBuilderStore`, wraps its
   body in `<ScrollArea className="h-full bg-card">`, and renders in this order: the node's
   kind name and icon from `NODE_KIND_META`, the `NodeNameField`, then the per-kind form.
   With nothing selected it renders an empty state reading `Select a step to configure it`.
   Reuse the heading class from the precedent:
   ```ts
   const RAIL_HEADING = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
   ```
5. `forms/index.ts` is the exhaustive registry — this is how the module's
   "never add a per-kind lookup" rule is honoured in shape:
   ```ts
   export type NodeFormProps = { node: WorkflowNode };

   /** Spelled out, like `nodeTypes`: a missing kind is a TS2741, not a blank panel. */
   export const NODE_FORMS: Record<WorkflowNodeType, ComponentType<NodeFormProps>> = {
     trigger: TriggerForm,
     condition: ConditionForm,
     entity: EntityForm,
     lookup: LookupForm,
     filter: FilterForm,
     action: ActionForm
   };
   ```
   `ConfigPanel` does `const Form = NODE_FORMS[node.type]` and nothing else per-kind.
6. Each of the six stubs is a component taking `NodeFormProps` and rendering a single
   `<p>` placeholder. Tasks 17–20 fill them. The stubs exist now so the registry compiles
   and the layout can be verified in isolation.
7. `NodeNameField.tsx` is an `Input` from `@carbon/react` (not `~/components/Form` — there
   is no form context here) seeded from `node.title`, falling back to the derived summary as
   its `placeholder`, calling `renameNode(node.id, value)` on change. An empty value clears
   the title rather than storing `""`.
8. All six forms and the panel are **controlled by the store, not by a form library**. There
   is no `ValidatedForm`, no fetcher, no submit — `Autosave.tsx` already posts the whole
   definition on a 1s debounce. Anything from `~/components/Form` needs `useField` and will
   throw here; use `@carbon/react` primitives or the `*Controlled` variants.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors. Delete one key from NODE_FORMS and re-run — expect TS2741, then restore it.
pnpm exec biome check apps/erp/app/modules/workflows
# Expected: no error-severity diagnostics
```
Manual: open a workflow builder, select each node kind in turn, confirm the panel appears
with the right heading, that the split is draggable and survives a reload (`autoSaveId`),
and that a live version shows no panel.

**Out of scope:** the palette's own markup, `BuilderHeader.tsx`, `VersionMenu.tsx`,
`Autosave.tsx`.

---

## Task 10: Catalog + label lookup helpers for the browser

**Depends on:** Task 3
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/catalog.ts`
- Copy from (precedent): `packages/workflows/src/catalog/catalog.ts:47-54` for the factory
  shape; any `useLingui()` call site in `apps/erp` for the translation idiom

**Steps:**

1. Build the catalog once at module scope and export it — it is pure committed data
   (~73 KB across the three generated files) and rebuilding it per render would be waste:
   ```ts
   import { createWorkflowCatalog } from "@carbon/workflows";

   /** One instance for the whole builder; the catalog is immutable committed data. */
   export const catalog = createWorkflowCatalog();
   ```
2. Add the label lookup. `WORKFLOW_LABELS` must be imported from the **subpath**, never the
   barrel — `msg` is a build-time macro and only Vite-built app code may touch it
   (`packages/workflows/AGENTS.md:65-68`):
   ```ts
   import { WORKFLOW_LABELS } from "@carbon/workflows/labels";
   ```
   Export a hook that resolves a key to a translated string with a readable fallback:
   ```ts
   /** Translates a catalog label key; falls back to the key's last segment when absent. */
   export function useWorkflowLabel(): (key: string, fallback?: string) => string;
   ```
   backed by `useLingui()`'s `i18n._` over `WORKFLOW_LABELS[key]`. The fallback exists so an
   out-of-date client renders something readable rather than blank.
3. Export the four key builders so no call site formats a key by hand:
   ```ts
   export const entityLabelKey = (entity: string) => `entity.${entity}`;
   export const propertyLabelKey = (entity: string, column: string) => `entity.${entity}.${column}`;
   export const actionInputLabelKey = (action: string, input: string) => `action.${action}.input.${input}`;
   export const operationInputLabelKey = (operation: string, input: string) => `operation.${operation}.input.${input}`;
   ```
4. Export `describeValueType(type, entityLabel?): string` for the picker and the chips —
   `"one purchase order"`, `"a list of jobs"`, `"text"`, `"a number"`, `"a date"`,
   `"yes or no"`. Take the resolved entity label as an argument rather than calling the hook
   inside, so it stays callable from sorting comparators.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
rg -n "@carbon/workflows/labels" apps/erp packages
# Expected: exactly one hit — this new file. Anything else violates AGENTS.md:65-68.
```

**Out of scope:** do not re-export `WORKFLOW_LABELS` from anywhere; do not add it to the
`@carbon/workflows` barrel.

---

## Task 11: `ValueField` — literal controls per type, and the variable chip

**Depends on:** Tasks 9, 10
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/fields/types.ts`
- Create: `apps/erp/app/modules/workflows/ui/Builder/fields/ValueField.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/fields/LiteralControl.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/fields/VariableChip.tsx`
- Copy from (precedent): `apps/erp/app/modules/storage-rules/ui/ValueInput.tsx` for the
  per-type control dispatch; `apps/erp/app/components/DocumentTemplateEditor/NumberRow.tsx`
  for the `NumberField` composition boilerplate

**Steps:**

1. `fields/types.ts` declares the one prop shape every field control shares:
   ```ts
   export type FieldContext = {
     /** The node being configured — the picker needs it to know what is upstream. */
     nodeId: string;
     /** True inside a filter node's clauses or a batch-mode action, where `item` is offered. */
     inLoop: boolean;
   };

   export type ValueFieldProps = {
     label: string;
     type: ValueType;
     required?: boolean;
     choices?: readonly string[];
     value: ValueOrRef | undefined;
     onChange: (next: ValueOrRef | undefined) => void;
     context: FieldContext;
     /** Message from a publish issue whose `field` path resolves here. */
     issue?: string;
   };
   ```
2. `ValueField` renders exactly one of two states, never both:
   - **variable state** when `value?.kind` is `"ref"` or `"item"` → a full-width
     `VariableChip` with an `×` that calls `onChange(undefined)`. Clicking the chip body
     reopens the picker positioned at that variable.
   - **literal state** otherwise → `LiteralControl`, plus a small trailing button that
     opens the `VariablePicker` (Task 12).
   `kind: "template"` never reaches `ValueField` — that is `TemplateField` (Task 14).
3. `LiteralControl` dispatches on `type`, in this exact order:

   | Condition | Control | Import |
   |---|---|---|
   | `choices` is present | `Select` + `SelectTrigger`/`SelectContent`/`SelectItem` | `@carbon/react` |
   | `{kind:"primitive", of:"string"}` | `Input` | `@carbon/react` |
   | `{kind:"primitive", of:"number"}` | `NumberField` + `NumberInputGroup` + `NumberInput` + `NumberInputStepper` | `@carbon/react` |
   | `{kind:"primitive", of:"boolean"}` | `Switch variant="small"` | `@carbon/react` |
   | `{kind:"primitive", of:"date"}` | `DatePicker` | `@carbon/react` |
   | `{kind:"entity", of}` | `RecordPicker` (Task 15) | local |
   | `{kind:"list", of}` | no literal control — render the disabled prompt `Pick a list from an earlier step` | — |
   | `{kind:"primitive", of:"null"}` | never offered as a literal | — |

   There is no standalone `NumberInput` *field* in `@carbon/react`; `NumberField` is a
   react-aria container and needs the composed children. Follow `NumberRow.tsx`.
4. Every literal writes `{kind: "literal", type, value}` with `type` copied from the field's
   declared type — never inferred from the value. `literalValueMatchesType`
   (`definition/types.ts:135`) is what the validator checks it against.
5. Clearing a control writes `undefined`, not a literal holding `""`. A required input left
   empty is `MISSING_INPUT` at publish, which is the intended behaviour.
6. `VariableChip` renders `Node name › property path › type` on one line using `Badge` and a
   `Tooltip` carrying the full path when it truncates. When the referenced node no longer
   exists it renders in the destructive variant reading `Step removed — pick a new value`,
   which is what Task 21's delete flow leaves behind.
7. When `issue` is set, outline the control and render the message beneath it. Do not
   compute issues here — they arrive from the store's `issues` array, written at publish.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm exec biome check apps/erp/app/modules/workflows
# Expected: no error-severity diagnostics
```
Manual: temporarily render a `ValueField` for each of the six types in the Entity form stub
and confirm each control appears and writes the right literal shape.

**Out of scope:** the picker itself (Task 12), record pickers (Task 15), templates (Task 14).

---

## Task 12: `VariablePicker` — grouped, typed, soft-filtered, two-hop drill

**Depends on:** Task 11
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/fields/VariablePicker.tsx`
- Copy from (precedent):
  `apps/erp/app/modules/storage-rules/ui/OperatorCombobox.tsx` for the
  `Popover` + `Command` structure and the `onWheel`/`onTouchMove` stop-propagation that
  keeps a scrolling list from panning the canvas

**Steps:**

1. Props:
   ```ts
   type VariablePickerProps = {
     /** The type the target field accepts; drives compatibility, never visibility. */
     accepts: ValueType;
     /** Prose fields take anything, because every value renders to a string. */
     acceptsAny?: boolean;
     nodeId: string;
     inLoop: boolean;
     value: VariableRef | ItemRef | undefined;
     onChange: (next: VariableRef | ItemRef) => void;
   };
   ```
2. Source the list from `availableVariables(definition, nodeId, catalog)` (Task 4), reading
   the definition out of the store via `fromReactFlow`. Group `CommandGroup`s by
   `nodeTitle`, in the order the function returns — it is already sorted and must not be
   re-sorted here. Fall back to `NODE_KIND_META[nodeType].defaultTitle` when `nodeTitle` is
   the bare kind string.
3. Each row shows the output or property name, its type rendered through
   `describeValueType`, and — when `guaranteed` is false — the note
   `may be empty on this path`.
4. **Soft-filter, never hard-filter.** A row whose type is not compatible with `accepts`
   stays visible, is `disabled`, and carries a one-line reason. The three reasons, verbatim:
   - `This is a list of <X>; this field takes one <X>.`
   - `This is <X>; this field takes <Y>.`
   - `This is a <X>; this field takes a <Y>.` (entity-to-entity mismatch)
   Hiding rows is what produces the "where did my option go" complaint; the greyed list-row
   is also how batch mode gets discovered (Task 20).
5. Compatibility is `typesEqual(candidate, accepts)`, plus one allowance: a
   `{kind:"primitive", of:"null"}` candidate is compatible with anything, since a nullable
   column resolves to null at run time. With `acceptsAny` everything is compatible.
6. **Drilling.** A row whose type is `{kind:"entity"}` is expandable: selecting it opens the
   entity's properties from `catalog.getEntity(of).properties`, each labelled through
   `propertyLabelKey`. Cap the walk at **two entity hops** — `record` → `record.supplierId`
   → `record.supplierId.name`, and offer no further expansion. Resolve each candidate type
   with `walkPath(rootType, path, catalog)` (`definition/catalog.ts:64`) rather than
   re-implementing the walk.
7. Emit `{kind:"ref", nodeId, output, path}` — `path` is the drill segments, `[]` at the
   root. Never emit a string; there is no expression language.
8. **Pseudo-variables**, rendered in their own groups at the bottom:
   - `The current item` — only when `inLoop`; emits `{kind:"item", path}`. The validator
     rejects it elsewhere as `ITEM_OUTSIDE_LOOP`, so gating it here keeps the two agreeing.
   - `Now` and `The workflow's owner` — per the PRD's "a few values are always available".
   Before shipping these two, confirm the runtime actually resolves them. **If it does not,
   render them disabled with the reason `Not available yet` and report it — do not invent a
   resolver and do not emit a ref the engine cannot resolve.**
9. The popover uses `PopoverContent className="w-[var(--radix-popover-trigger-width)]
   min-w-[320px] p-0"` and stops wheel/touch propagation, exactly as `OperatorCombobox`
   does. Radix popper content already matches `OVERLAY_SELECTOR` in
   `WorkflowBuilder.tsx:23-25`, so the canvas will not steal its keys.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```
Manual, on a trigger → lookup → action graph: the picker on an action input lists the
trigger's outputs and the lookup's result grouped by node name; a `list<job>` row is greyed
with the list reason when the field takes one job; drilling `record` shows properties and
stops after two hops; the `item` group is absent outside a loop.

**Out of scope:** batch mode (Task 20), operators (Task 16).

---

## Task 13: `@carbon/react/VariableText` — the chip-based template editor

**Depends on:** none
**Files:**
- Create: `packages/react/src/VariableText/VariableText.tsx`
- Create: `packages/react/src/VariableText/index.ts`
- Modify: `packages/react/package.json` — add `"./VariableText": "./src/VariableText/index.ts"`
  to `exports`, beside `"./Editor"` (line 113) and `"./RichText"` (line 117)
- Copy from (precedent): `packages/react/src/Editor/Editor.tsx` for mounting
  `EditorRoot`/`EditorContent` from `@carbon/tiptap`

**Steps:**

1. **Why this lives in `@carbon/react` and not in erp:** `apps/erp/package.json` has no
   `@carbon/tiptap` dependency — only `@carbon/react` does, and it re-exports tiptap solely
   through the `./Editor` and `./RichText` subpaths. Adding a tiptap import to erp would mean
   adding a production dependency, which needs asking first.
2. Keep it **generic** — this component must not import `@carbon/workflows`. Its value type
   is its own:
   ```ts
   export type VariableTextToken = { id: string; label: string };
   export type VariableTextPart =
     | { kind: "text"; text: string }
     | { kind: "token"; id: string; label: string };

   export type VariableTextProps = {
     value: VariableTextPart[];
     onChange: (parts: VariableTextPart[]) => void;
     placeholder?: string;
     className?: string;
     multiline?: boolean;
   };

   export type VariableTextHandle = {
     /** Inserts a chip at the caret, or at the end when the field is not focused. */
     insertToken: (token: VariableTextToken) => void;
   };
   ```
   Export it as a `forwardRef` exposing `VariableTextHandle`.
3. Build the editor on `EditorRoot` + `EditorContent` from `@carbon/tiptap` with a minimal
   extension set: `StarterKit` (document/paragraph/text/history only — disable headings,
   lists and code blocks), `Placeholder`, and one mention extension created with
   `createMentionExtension({ name: "variable", char: "\u0000", items: [] })`. The trigger
   character is deliberately unreachable: chips are inserted **programmatically** via
   `insertToken`, never by typing a trigger, because the caller's picker is the only
   legitimate source of a token.
4. Chips are **atomic** nodes (`Mention` already is), so one backspace deletes a whole
   variable. Do not reimplement this over `contenteditable`.
5. Convert both ways:
   - parts → tiptap doc: one paragraph (or one per `\n` when `multiline`) whose content is
     text nodes and mention nodes carrying `{ id, label }` in their attributes.
   - tiptap doc → parts on every update: walk the doc, coalescing adjacent text.
   Round-tripping must be lossless for text and tokens; anything else in the doc (a stray
   mark, a pasted heading) is flattened to plain text.
6. `multiline: false` maps Enter to a no-op so a subject line stays one line.
7. Export `VariableText`, `VariableTextHandle`, `VariableTextPart` and `VariableTextToken`
   from `packages/react/src/VariableText/index.ts`. Do **not** add them to the
   `@carbon/react` barrel — follow the `./Editor` precedent and keep tiptap behind a subpath
   so it stays out of the main bundle.

**Verify:**
```bash
pnpm --filter @carbon/react run typecheck
# Expected: no errors
pnpm exec biome check packages/react/src/VariableText
# Expected: no error-severity diagnostics
node -e 'console.log(require("./packages/react/package.json").exports["./VariableText"])'
# Expected: ./src/VariableText/index.ts
```

**Out of scope:** do not modify `packages/react/src/Editor/`, `extensions.ts`, or
`packages/tiptap`. `createMentionExtension` is currently dead code with zero callers; this
task is its first consumer and it must be used as-is.

---

## Task 14: `TemplateField` — wire VariableText to `{kind:"template"}` parts

**Depends on:** Tasks 12, 13
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/fields/TemplateField.tsx`

**Steps:**

1. `TemplateField` takes the same props as `ValueField` and is chosen by the form when the
   catalog input declares `template: true` — exactly `notify.subject`, `notify.message` and
   `webhook.body` today. The catalog decides the widget; the customer never toggles it.
2. Map `{kind:"template", parts}` (`definition/types.ts:104-116`) to
   `VariableTextPart[]` and back:
   - `{kind:"text", text}` ↔ `{kind:"text", text}`
   - `{kind:"ref", nodeId, output, path}` and `{kind:"item", path}` ↔
     `{kind:"token", id, label}` where `id` is a stable serialisation of the ref and `label`
     is the human string the chip shows.
3. Serialise the token id as JSON of the ref itself and parse it back — do not invent a
   delimiter-joined string, because `output` and path segments are arbitrary column names.
   Round-tripping must be exact: a chip written and re-read produces an identical
   `VariableRef`.
4. Wire the trailing picker button to `VariablePicker` with `acceptsAny` set, calling
   `handle.insertToken(...)` on select. Every type is insertable into prose —
   `renderValue` (`runtime/resolve.ts:21`) stringifies entities, lists and dates — so the
   picker soft-filters nothing here.
5. A field whose parts are only text still stores `{kind:"template", parts}` — do not
   collapse it to a literal. `renderTemplate` handles the all-text case, and collapsing
   would make the widget flip on the next render.
6. An empty field writes `undefined`, matching `ValueField`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```
Manual, on a Notify action: type text, insert a variable, confirm one backspace removes the
whole chip; reload the page and confirm the chip returns with the same label and target.

**Out of scope:** rich text of any kind — no bold, no lists, no links. This is prose with
chips.

---

## Task 15: `RECORD_PICKERS` — Carbon's own selectors as entity literals

**Depends on:** Task 11
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/fields/recordPickers.tsx`
- Copy from (precedent): `apps/erp/app/components/Form/Customer.tsx` and
  `apps/erp/app/components/Form/Users.tsx` for the underlying selector props

**Steps:**

1. **Read this before writing code:** everything exported from `~/components/Form` is a
   `@carbon/form` field wrapper driven by `useField(name)` and will throw outside a
   `ValidatedForm`. The config panel has no form context. So each entry in this map is a
   thin wrapper around the *underlying* controlled selector, not a re-export of the
   `~/components/Form` component. Check each one: where a `*Controlled` variant exists, use
   it; where only the field wrapper exists, drop to the `Selectors/` component it wraps.
   **If a needed selector has no controlled form, STOP and report rather than mounting a
   fake form context.**
2. Declare the map `Partial` on purpose, so an unmapped registry entity degrades instead of
   crashing:
   ```ts
   export type RecordPickerProps = {
     value: string | undefined;
     onChange: (id: string | undefined) => void;
     isDisabled?: boolean;
   };

   /** Registry entity name -> Carbon's own selector. Partial: an unmapped entity falls back. */
   export const RECORD_PICKERS: Partial<Record<string, ComponentType<RecordPickerProps>>> = {
     customer: CustomerPicker,
     supplier: SupplierPicker,
     item: ItemPicker,
     user: EmployeePicker,
     group: RolePicker,
     location: LocationPicker
   };
   ```
3. The 16 registry entities are `purchaseOrder, salesOrder, job, item, receipt, shipment,
   quote, supplier, customer, nonConformance, user, group, jobOperation, salesInvoice,
   purchaseInvoice, location`. There is **no** `SalesOrder`, `PurchaseOrder`, `Job`, `Role`
   or `Group` selector in `~/components/Form` — map only what exists and let the rest fall
   back. Notes on the tricky ones:
   - `user` → `Employee` (`type?: "assignee"`).
   - `group` → `Users` with `verbose`, which prefixes values `user_` / `group_`. Strip the
     prefix before storing, and **if that prefix cannot be cleanly removed, STOP and report**
     — a stored `group_abc` id would not match what the engine looks up.
   - `item` → `Item` requires a `type` prop; pass `"Item"`.
4. The fallback for an unmapped entity is a plain `Input` labelled with the entity's label
   and the helper text `Enter the record's id`, plus the note that a variable is usually the
   better choice here. It must not be a fake dropdown.
5. Every selector is already company-scoped and runs as the person editing, who is also the
   workflow's owner — that is the PRD's "the builder can't be used to discover data" with no
   extra work. Do not add a company filter and do not add a service-role fetch.
6. Store the choice as `{kind:"literal", type: {kind:"entity", of}, value: id}`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```
Manual: an `assignee` input renders Carbon's employee picker and the chosen person persists
across a reload.

**Out of scope:** creating any new selector component; adding a new API route.

---

## Task 16: `ClauseRow` — operator self-healing over the three-column grid

**Depends on:** Task 12
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/panel/ClauseRow.tsx`
- Copy from (precedent): `apps/erp/app/modules/storage-rules/ui/ConditionRow.tsx` — the
  grid class at line 40, the self-heal effect at lines 124–131, the reset-on-change patch
  at lines 142–172, and the outside-the-card remove button at lines 203–214

**Steps:**

1. One component serves condition clauses, filter clauses and lookup match rows. Props:
   ```ts
   type ClauseRowProps = {
     clause: Clause;
     index: number;
     canRemove: boolean;
     onChange: (index: number, patch: Partial<Clause>) => void;
     onRemove: (index: number) => void;
     context: FieldContext;
     /** Lookup match rows pick a column, not a value expression. */
     leftMode?: "value" | "column";
     /** Present in column mode: the entity whose columns the left side may name. */
     entity?: string;
   };
   ```
2. Layout copies the precedent verbatim:
   ```ts
   const CLAUSE_GRID_CLASS =
     "grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)]";
   ```
3. **Operators are derived, never listed.** Call `operatorsForType(leftType)`
   (`definition/types.ts:75`) — the same function the runtime uses. The operator control is
   `disabled` until a left operand exists. Never hard-code an operator list; reuse
   `OPERATOR_META` from `apps/erp/app/modules/storage-rules/ui/OperatorCombobox.tsx` for the
   symbols and descriptions if it is exported, otherwise render the raw operator names —
   do not duplicate that table.
4. **Changing the left operand resets the row**, in one patch, exactly as the precedent
   does: `onChange(index, { left, operator: pickDefaultOp(nextOps), right: undefined })`
   with `pickDefaultOp = (ops) => ops.includes("eq") ? "eq" : (ops[0] ?? "eq")`. Changing
   the operator clears only `right`.
5. Keep the precedent's self-heal effect for stored rows whose operator is no longer legal
   (an older definition, or a column whose type changed):
   ```tsx
   useEffect(() => {
     if (!leftType) return;
     if (availableOps.includes(clause.operator)) return;
     onChange(index, { operator: pickDefaultOp(availableOps), right: undefined });
   }, [leftType, availableOps, clause.operator, index, onChange]);
   ```
6. The right-hand side is a `ValueField` typed by the **left** operand's type, so
   `record.status` offers that column's `choices` through `catalog.getEnum` and
   `record.orderTotal` offers a number control. When the left type is
   `{kind:"entity", of}`, the right side accepts only the same entity type — `typesEqual`
   already says so and the picker enforces it up front.
7. In `leftMode: "column"` (lookup match rows), the left control is a `Combobox` over
   `catalog.getEntity(entity).properties`, labelled through `propertyLabelKey`, and the
   stored field is the column name. In `leftMode: "value"` it is a `ValueField` accepting
   any type, which in practice means the variable picker.
8. Nothing here re-runs `validateDefinition`. Prevention is the whole mechanism: the
   operator list cannot contain an illegal operator, so an illegal clause is unrepresentable.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```
Manual: choosing `record.orderTotal` offers exactly `=, ≠, >, ≥, <, ≤` and no `contains`;
switching to `record.status` replaces the operator with a legal one and clears the value.

**Out of scope:** nested clause groups. The stored shape is one combinator per path over a
flat clause list and stays that way (spec Non-Goals).

---

## Task 17: Trigger form, including the schedule editor

**Depends on:** Task 9
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/panel/forms/TriggerForm.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/panel/ScheduleEditor.tsx`
- Copy from (precedent): `apps/erp/app/modules/storage-rules/ui/OperatorCombobox.tsx` for
  the grouped `Command` list; `packages/react/src/Date` (`TimePicker`) and
  `~/components/Form/Timezone` for the time and time-zone controls

**Steps:**

1. The trigger node's data is `{ events: string[], origin: "People"|"Workflows"|"Both",
   schedule?: Schedule }` (`definition/schema.ts:27-35`). Events and schedule are
   **mutually exclusive** — the validator already emits `CONFLICTING_TRIGGER` — so the form
   opens with a two-way choice: `When something happens` or `On a schedule`. Switching
   clears the other side in the same `updateNodeData` patch, so a conflicting pair is never
   stored.
2. **Event selection** is a multi-select `Command` list over `WORKFLOW_EVENTS`, every label
   resolved through `useWorkflowLabel(id)`. Group into two sections:
   - by record type, using the id prefix before the first `.` and `entityLabelKey` for the
     heading (`A purchase order's status changes`, `A purchase order is created`, …)
   - `Business moments` for every event id that is not `<registryEntity>.…`
   Do not hard-code the 106 ids anywhere — derive the grouping from the catalog, so a
   107th event needs no front-end change.
3. **Multi-event intersection.** When more than one event is selected, show a line beneath
   the list naming which outputs survive: run the same intersection the validator uses by
   calling `getNodeOutputs(node, context)` and listing its keys against the union of the
   selected events' outputs. Word the loss plainly — `Only "record" is available to later
   steps, because the other events do not all provide the rest.` This is otherwise
   invisible and is why a two-event trigger silently loses `before`/`after`.
4. **Origin** is three radio choices mapped to the stored values: `People only` →
   `"People"`, `Workflows only` → `"Workflows"`, `Both` → `"Both"`. Default stays `Both`.
5. `ScheduleEditor` edits `scheduleSchema` (`definition/types.ts:189-196`) — read that
   schema first and render exactly its fields, nothing more:
   - frequency
   - time of day (`TimePicker`)
   - weekdays, or day-of-month including a `Last day` choice, shown per frequency
   - time zone, defaulting to `Intl.DateTimeFormat().resolvedOptions().timeZone`
   Validate nothing locally beyond what the controls make representable; `INVALID_SCHEDULE`
   at publish is the backstop. **If `scheduleSchema`'s fields do not match this list, follow
   the schema and report the difference — do not extend the schema.**
6. Show the next fire time under the editor using `nextOccurrenceAfter` from
   `definition/schedule.ts` if it is exported from the barrel. If it is not, skip the
   preview rather than exporting new surface from the package for a nicety.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```
Manual: set the trigger to `A purchase order's status changes` with origin `People only`;
switch to a schedule and confirm the event ids clear; set `the last day of the month at
09:00, Asia/Kolkata` and confirm it survives a reload.

**Out of scope:** the scheduler itself, `syncWorkflowTriggers`, `workflow.nextRunAt`. Never
write those — `syncWorkflowTriggers` is their sole writer.

---

## Task 18: Condition form and Filter form

**Depends on:** Task 16
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/panel/forms/ConditionForm.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/panel/forms/FilterForm.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/panel/PathEditor.tsx`
- Copy from (precedent): `apps/erp/app/modules/storage-rules/ui/RuleBuilder.tsx` for the
  add/change/remove-by-index list shape

**Steps:**

1. **Condition.** The data is `{ paths: ConditionPath[] }` where each path is
   `{ id, kind: "if"|"elseIf"|"else", combinator, clauses }`
   (`definition/schema.ts:37-51`). The form renders the paths in order with these rules:
   - exactly one `if`, first
   - any number of `elseIf`
   - at most one `else`, always last and not reorderable
   - each non-`else` path shows a combinator toggle (`and` / `or`) and its `ClauseRow`s,
     plus `Add rule`
   - `Add path` appends an `elseIf` before the `else`; `Add otherwise` appends the `else`
2. Each path is one output handle on the node (`nodes.ts:280` —
   `handles: node.data.paths.map(p => p.id)`). Removing a path removes its handle, which
   means removing any edge drawn from it. Do that in the same store patch, or the validator
   reports `DANGLING_EDGE` at publish. Show the count in the confirm when edges are lost.
3. Generate path ids with the same id helper `graph.ts` uses for nodes — never an index,
   never a timestamp. The id is the handle id and must be stable across reorders.
4. **Filter.** The data is `{ source?: VariableRef, combinator, clauses }`
   (`definition/schema.ts:72-80`). The form is:
   - a source picker restricted to `list<T>` variables. Use `VariablePicker` with
     `accepts` set to a list type; every non-list variable is greyed with the reason
     `This is one <X>; this field takes a list.`
   - clauses over the **current item**, so `ClauseRow` gets `context.inLoop = true` and the
     picker offers `The current item` as the left operand
   - the item's type comes from the source list's `of`; show it in the heading
     (`Keep only the jobs where…`)
5. Both forms write through `updateNodeData` on every change. Neither computes issues;
   neither calls `validateDefinition`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm --filter erp exec vitest run app/modules/workflows/ui/Builder/graph.test.ts
# Expected: still passing — path-handle removal must not break the handle derivation
```
Manual, the PRD's crossing case: a condition with two clauses,
`record.orderTotal > 10000` AND `before.orderTotal <= 10000`, publishes cleanly.

**Out of scope:** nested groups, drag-to-reorder clauses, `else if` chaining beyond a flat
list.

---

## Task 19: Lookup form and Entity form

**Depends on:** Task 16
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/panel/forms/LookupForm.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/panel/forms/EntityForm.tsx`

**Steps:**

1. **Lookup.** The data is `{ entity, returns: "one"|"list", match: LookupMatch[] }`
   (`definition/schema.ts:62-70`). The form is:
   - a record-type `Combobox` over the registry entities that declare a `permission`
     (`catalog.getEntity(name).permission`), labelled through `entityLabelKey`
   - a two-way `returns` choice: `Just one` / `Every match`
   - match rows rendered by `ClauseRow` with `leftMode: "column"` and `entity` set, so the
     left side is a column picker labelled through `propertyLabelKey` and typed from the
     property map, and the right side's `choices` come from `catalog.getEnum(entity, column)`
   - changing the entity clears every match row, because the columns no longer exist
2. Show the output type under the form — `one <entity>` or `a list of <entity>` — so the
   customer knows what later steps will be offered.
3. **Entity.** The data is `{ operation, inputs }` (`definition/schema.ts:53-60`). The form
   is:
   - an operation `Combobox` over `WORKFLOW_OPERATION_CATALOG`, grouped by
     `operation.entity` with `entityLabelKey` headings and each entry labelled by its own
     catalog label key
   - then one field per declared input of `catalog.getOperation(id).inputs`, in declaration
     order with required ones first, each labelled through `operationInputLabelKey` and
     rendered by `ValueField` (or `TemplateField` when the input declares `template`)
   - the operation's `output` type shown beneath, same as the lookup
   - changing the operation clears `inputs` entirely — the old input names are meaningless
     under a new operation
4. Neither form hard-codes an operation or an entity. Both read the catalog.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```
Manual: a lookup on `Job` matching `status` offers that column's allowed values as a
dropdown, not a text box; an entity operation shows its inputs with human labels.

**Out of scope:** adding an operation or an entity to the catalog.

---

## Task 20: Action form — ranking, `requireOneOf`, batch mode, Notify `about`

**Depends on:** Tasks 11, 12, 14, 15
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/panel/forms/ActionForm.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/panel/NotifyAboutField.tsx`

**Steps:**

1. The data is `{ action, inputs, batch }` (`definition/schema.ts:82-90`).
2. **Action selection ranks, it does not filter.** List every entry of
   `WORKFLOW_ACTION_CATALOG` labelled through `useWorkflowLabel(id)`. An action whose
   required record type is not available upstream sorts below the rest and carries the
   one-line reason `No <record type> is available from an earlier step.` It stays
   selectable. Filtering "what a purchase order can become" is the mistake n8n's own source
   carries a TODO admitting; filtering "what accepts a purchase order" is the safe
   direction, and that is what the field-level pickers already do.
3. **Inputs** come from `catalog.getAction(id).inputs`, required first, each labelled
   through `actionInputLabelKey`. An input declaring `template: true` renders `TemplateField`;
   everything else renders `ValueField`. Changing the action clears `inputs`.
4. **`requireOneOf` renders as one either/or block, not two independently-optional fields.**
   `notify` declares `requireOneOf: [["user", "role"]]` (`catalog/actions.ts:117`). Render a
   two-way selector — `Notify a person` / `Notify a role` — with one field beneath, and
   clear the other input when the selector changes so only one is ever stored. Derive the
   groups from `requireOneOf`; do not special-case `notify` here.
5. **Batch mode is offered, never applied.**
   - Wiring a `list<T>` into an input that takes a single `T` puts an inline message on that
     field — `"<variable name>" is a list of <T>; this field takes one <T>.` — with a button
     reading `Run once per item`. Pressing it sets `batch: true` and nothing else.
   - The toggle also lives plainly on the form, labelled `Run once for each item in the
     list`.
   - The validator's existing rule is unchanged: exactly one input may resolve to a list in
     batch mode. Once one is chosen, the other list-typed fields carry the reason
     `Only one field can be the list this step loops over.`
   - **Nothing enables batch mode on its own.** Power Automate's silent auto-loop is that
     product's single most-complained-about behaviour, and the complaint is that it is silent,
     not that it is wrong.
   - Only offer the toggle when `catalog.getAction(id).batchable` is true.
6. **The Notify `about` special case.** `notify` stores its subject record as two loose
   strings, `aboutId` and `aboutType`, because the value model has no "any record" type
   (`catalog/actions.ts:110`). Rendered literally that is two text boxes over a database id.
   `NotifyAboutField` instead shows one *About* field — pick a record type from the registry,
   then pick or wire the record — and writes both inputs behind it. Comment it at the call
   site as the one hand-written deviation from catalog-driven rendering, so it does not read
   as a pattern to copy:
   ```tsx
   {/* The only hand-written field in the builder: `notify` names its subject in two
       loose strings because the value model has no "any record" type. Not a pattern. */}
   ```
   Both written values stay plain strings — do not change the catalog to model this.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm exec biome check apps/erp/app/modules/workflows
# Expected: no error-severity diagnostics
```
Manual: wiring a `list<job>` into an action input that takes one `job` shows the reason and
the button; pressing it turns on batch mode and the field becomes valid; a Notify action
shows one About field, one either/or person-or-role block, and a message body where a
variable inserts as a chip that backspace deletes whole.

**Out of scope:** adding an action to the catalog; changing `notify`'s stored shape.

---

## Task 21: Node-card summaries, failure-path warning, issue anchoring, safe delete

**Depends on:** Tasks 17, 18, 19, 20
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/meta.ts` — the `summary` hooks
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/WorkflowNodeCard.tsx` — lines
  71–73
- Modify: `apps/erp/app/modules/workflows/ui/Builder/IssuesPanel.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/panel/ConfigPanel.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/DeleteNodeDialog.tsx`

**Steps:**

1. **Summaries.** `NODE_KIND_META.summary` already exists as a hook (`nodes/meta.ts:26`) and
   today returns counts like `2 paths`. Rewrite one per kind to produce a sentence:
   - trigger — `When a purchase order's status changes`, or `Every weekday at 09:00`
   - condition — `If total is over 10,000`, from the first clause of the first path
   - action — `Notify the buyer's manager`
   - entity — the operation's label
   - lookup — `Find open jobs for this supplier`
   - filter — `Keep only the jobs where…`
   Falling back to the existing count when the node is not configured enough to describe.
   **`summary` is a plain function in a data table and cannot call hooks**, so it cannot
   translate. Either pass a resolved label lookup in as an argument, or have the card
   resolve the label keys the summary returns. Pick one and apply it to all six; do not mix.
2. Replace the `Not configured yet` placeholder (`WorkflowNodeCard.tsx:71-73`) with the
   summary. Keep an italic muted `Not configured yet` as the fallback when the summary is
   undefined — that state still exists for a brand-new node.
3. **Failure-path warning.** For a node whose handles include `failure`
   (`SUCCESS_HANDLE`/`FAILURE_HANDLE`, action and lookup — `nodes.ts:346, 467`), show a
   small warning affordance on the card when no edge has `sourceHandle === "failure"`,
   reading `Nothing happens if this fails`. Derive the handle list with `getNodeHandles(node)`
   — never a hand-written list, or the card can draw a handle the validator calls
   `UNKNOWN_HANDLE`. This is a card affordance, **not** a `WorkflowIssue`; it must not block
   publish and must not appear in `IssuesPanel`.
4. **Issue anchoring.** `WorkflowIssue.field` is already a dotted path (`issues.ts:32`) that
   nothing resolves; `IssuesPanel.tsx` currently only does `setCenter` on the node. Extend it
   to also `setSelected(issue.nodeId)` so the panel opens, and have `ConfigPanel` pass the
   matching `field` down to the control that owns it. Every field control already takes an
   `issue` prop (Task 11). Scroll the panel to that control. Remove the stale comment in
   `IssuesPanel.tsx` that says fields cannot resolve to a control — that is what this task
   changes.
5. **Deleting a referenced node.** Before removing a node, count the downstream fields that
   hold a `{kind:"ref", nodeId}` pointing at it — walk `getNodeValues(node)` over every
   later node, including inside template parts. If the count is zero, delete straight away.
   Otherwise open `DeleteNodeDialog` reading `3 later steps use this step` and, on confirm,
   delete it and leave the references in place so `VariableChip` renders them as
   `Step removed — pick a new value` (Task 11 step 6). Nothing is silently rewritten and the
   customer is never trapped by a refusal. Publish already catches the dangling reference as
   `UNKNOWN_VARIABLE`; this only makes it visible immediately.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm --filter erp exec vitest run app/modules/workflows/ui/Builder/graph.test.ts
# Expected: all tests pass
```
Manual: a configured workflow reads as sentences at a glance; an action with no failure edge
shows the warning and still publishes; clicking a publish issue opens the owning node's
panel scrolled to the offending control; deleting a node two later nodes read from warns with
the count and leaves two broken chips.

**Out of scope:** run history, step detail, live run streaming — all phase 9. Nothing here
reads `workflowRun` or `workflowStepRun`.

---

## Task 22: Sync AGENTS.md, the phase-7 spec and this spec

**Depends on:** Task 21
**Files:**
- Modify: `apps/erp/app/modules/workflows/AGENTS.md` — lines 32, 71–80
- Modify: `packages/workflows/AGENTS.md` — the catalog and validator sections, plus the
  stale `{kind:"variable"}` line
- Modify: `.ai/specs/2026-07-31-workflows-builder-canvas.md` — the "no inspector" decision
- Modify: `.ai/specs/2026-07-31-workflows-node-configuration.md` — the corrections above
- Modify: `.claude/rules/workflow-event-catalog.md` — the new label families
- Modify: `.ai/lessons.md` — anything learned in Tasks 1–21

**Steps:**

1. `apps/erp/app/modules/workflows/AGENTS.md` line 32 currently says *"Never add a per-kind
   component or a second per-kind lookup."* Amend it to record what actually shipped: node
   **cards** still all render through one `WorkflowNodeCard`; node **forms** are per-kind but
   live in one exhaustive `Record<WorkflowNodeType, ComponentType<NodeFormProps>>` beside
   `nodeTypes`, so a missing kind is still a compile error. Name both records.
2. Update the same file's Builder Notes: line 80 says *"Node bodies render a `Not configured
   yet` placeholder. The fields are phase 8."* — replace with the panel, the store's new
   patch actions, and the fact that the config panel is hidden on a read-only version. Add
   the new `panel/` and `fields/` directories to the Layout block.
3. `packages/workflows/AGENTS.md`: document `availableVariables`, `getEnum`, `CatalogInput`'s
   `choices`/`template`, and the `title` on the node base (explicitly noting that
   `CURRENT_DEFINITION_FORMAT_VERSION` stayed 2 because the field is optional). Fix line 211,
   which describes the variable ref as `{kind:"variable"}` — the code has used
   `kind: z.literal("ref")` since `types.ts:83`.
4. `.ai/specs/2026-07-31-workflows-builder-canvas.md`: the "There is no right-hand inspector
   — a node's fields live on the node" decision is now reversed. Amend it in place with a
   dated note pointing at this spec, rather than deleting it — `keep-sources-in-sync.md`
   wants the disagreement resolved, and the reasoning is worth keeping.
5. `.ai/specs/2026-07-31-workflows-node-configuration.md`: apply the six corrections from the
   top of this plan, change the `job.priority` acceptance criterion to `job.deadlineType`,
   correct the label counts to 470 new / ~607 total, and add a changelog line.
6. `.claude/rules/workflow-event-catalog.md`: document the three new label key families and
   `WORKFLOW_ENTITY_ENUMS`, and note that the check script now requires a label for every
   entity property.
7. `.ai/lessons.md`: add anything durable, in `Context → Problem → Rule → Applies to` format.
   Likely candidates: erp cannot import `@carbon/tiptap`; `~/components/Form` selectors need
   form context and are unusable in a store-driven panel; `ancestorsOf` was a closure and had
   to be lifted before it could be shared.

**Verify:**
```bash
rg -n "Not configured yet" apps/erp/app/modules/workflows
# Expected: at most the fallback in WorkflowNodeCard.tsx — no stale AGENTS.md reference
rg -n 'kind:"variable"|kind: "variable"' packages/workflows
# Expected: no hits
```

**Out of scope:** `docs/content/` — customer-facing documentation for Workflows is not part
of this phase. If the feature is user-visible enough to need it, raise that rather than
writing it here.

---

## Task 23: End-to-end verification

**Depends on:** Task 22
**Files:** none

**Steps:**

1. Run the full command set, in this order:
   ```bash
   pnpm run generate:workflow-catalog
   git status --short packages/workflows/src/catalog/
   # Expected: clean. A diff here means a generator input changed without a regen.
   pnpm run check:workflow-catalog
   pnpm --filter @carbon/workflows run test
   pnpm --filter @carbon/workflows run typecheck
   pnpm --filter @carbon/react run typecheck
   pnpm exec turbo run typecheck --filter=erp
   pnpm --filter erp exec vitest run app/modules/workflows/ui/Builder/graph.test.ts
   pnpm exec biome check apps/erp/app/modules/workflows apps/erp/app/routes/x+/workflow+ apps/erp/app/routes/x+/workflows+ packages/workflows packages/react/src/VariableText
   pnpm --filter @carbon/checks workflow-events
   ```
   `pnpm exec turbo run typecheck --filter=erp` is the binding one: erp targets **ES2019**
   and compiles package *source*, so `packages/workflows` and `packages/react` can pass their
   own typecheck while breaking the app. If a TS2589 appears in an unrelated file, that is
   the recorded instantiation-budget lesson — use `@ts-ignore`, not `@ts-expect-error`, and
   verify with a direct `tsgo` run rather than a cached turbo run.
2. Check for turbo's ride-along regeneration before committing anything:
   ```bash
   git status --short packages/database/
   # Expected: clean. If not: git checkout -- packages/database/src/types.ts packages/database/supabase/functions/lib/types.ts
   ```
3. Walk every acceptance criterion in the spec against the running app. All fifteen, in
   order, with `job.priority` read as `job.deadlineType` per correction 1. Record the result
   of each — do not mark the plan complete on a subset.
4. The single most important manual check, from the PRD: build the crossing case end to end —
   a purchase-order trigger, a condition with `record.orderTotal > 10000` AND
   `before.orderTotal <= 10000`, and a Notify action naming the record in its message — then
   publish it and confirm it validates cleanly and the trigger rows sync.
5. Do **not** rebuild the database to test anything. Do **not** commit — implement, verify,
   and stop. Report what passed and what did not, with the command output.

**Verify:** the command block in step 1, all green, plus the acceptance-criteria walkthrough
from step 3 recorded in the reply.

**Out of scope:** committing, opening a PR, filling the other 12 translation locales
(`pnpm run translate` is a separate optional pass).
