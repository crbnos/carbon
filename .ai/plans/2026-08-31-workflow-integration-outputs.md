# Workflow integration outputs, data node, and form control — implementation plan

**Spec / source:** `.ai/specs/2026-08-31-workflow-integration-outputs.md`
**Research:** `.ai/research/activepieces-decisions.md`, `.ai/research/activepieces-integration-findings.md`
**Branch:** current worktree branch (`carbon-feat-active-pieces-integration`)

## Progress
- [x] Task 0: Make value-kind dispatch exhaustive (`assertNever`)
- [x] Task 1: Fix the two options-provider bugs
- [x] Task 2: Add the `record` kind to `ValueType` and its type functions
- [x] Task 3: Add `record` to the runtime value model and resolver
- [x] Task 3b: Teach the three record-blind consumers about records
- [x] Task 4: Refuse a record-typed catalog input
- [x] Task 5: Read `outputSchema` off a piece and map it to `ValueType`
- [x] Task 6: Emit typed integration outputs; refuse an action with no schema
- [x] Task 7: Project the vendor response into record outputs at run time
- [x] Task 9: Widen the filter node schema with `operation`
- [x] Task 10a: Extract the data node kind out of `nodes.ts`
- [x] Task 10b: One operation table driving type, runtime and UI
- [x] Task 12: Filter form — operation selector, field picker, record sources
- [x] Task 13: Tier 1+2 prop hiding, and `advancedInputs` on the declaration
- [x] Task 14: Advanced properties section on the integration form
- [x] Task 15: Builder support for walking into record fields
- [x] Task 8: Regenerate and verify the workflow catalog (ONCE, after 6 and 13)
- [x] Task 16: End-to-end verification

## Dependencies

```
Task 0  FIRST — makes every later kind-change fail loudly instead of silently
Task 1  independent (do early; the calendar dropdown is broken now)
Task 0 -> Task 2 -> Task 3 -> Task 3b -> Task 4
Task 5 -> Task 6 -> Task 7                 (Task 6 needs Task 2)
Task 9 -> Task 10a -> Task 10b -> Task 12  (Task 10b needs Task 2)
Task 13 -> Task 14
Task 15 needs Task 2
Task 8  needs BOTH Task 6 and Task 13 — the SINGLE regeneration, do not run it earlier
Task 16 needs everything
```

Tasks 1 and 13 are independent of the record work and may run in parallel with Tasks 2-7.
Task 15 may run in parallel with Tasks 9-12 once Task 2 lands.

**Why Task 0 exists.** There are **43 value-kind branch sites across 12 files** in
`packages/workflows/src`, and **zero exhaustive switches** — every one is an
`if (x.kind === "list") … else if (x.kind === "entity")` chain that **falls through** on
an unrecognised kind. Adding `record` therefore produces no compile error at most of
them; it produces silent wrong behaviour that passes typecheck AND tests. Task 0
converts the value-shaped chains to switches with `assertNever`, so the compiler
enumerates every site needing a record case rather than trusting a grep to have been
complete.

**Baselines confirmed before planning** (all green at time of writing):
`pnpm exec turbo run typecheck --filter=@carbon/workflows` ok;
`cd packages/workflows && pnpm exec vitest run` -> 26 files, 436 tests passed;
`pnpm exec turbo run typecheck --filter=@carbon/jobs` ok;
`pnpm run check:workflow-catalog` -> "ok — 106 events, 9 moments raised, 17 entities, 16 actions, 2 integration steps, 15 operations".
Any task whose Verify block reports fewer passing tests than its predecessor has
regressed something — STOP and report.

---

## Task 0: Make value-kind dispatch exhaustive

**Depends on:** none. **Do this first** — it is the safety net for Tasks 2, 3 and 3b.

**Files:**
- Modify: `packages/workflows/src/definition/types.ts` — add `assertNever`
- Modify: `packages/workflows/src/runtime/resolve.ts` — `walk`'s kind chain -> switch
- Modify: `packages/workflows/src/runtime/values.ts` — `fromColumn`'s kind chain -> switch
- Modify: `packages/workflows/src/runtime/compare.ts` — `equals`' kind chain -> switch

**Steps:**

1. Add to `types.ts`:
   ```ts
   /** Compile-time exhaustiveness. A new ValueType/RuntimeValue kind that any dispatch
    * forgets becomes a type error here rather than a silent fallthrough. */
   export function assertNever(value: never): never {
     throw new Error(`Unhandled kind: ${JSON.stringify(value)}`);
   }
   ```

2. Convert the three **value-shaped** dispatches above from if-chains to
   `switch (value.kind)` with `default: assertNever(value)`. Pure behaviour-preserving
   refactor: every existing branch keeps its exact body, and `default` is unreachable
   today.

3. Do **not** convert type-shaped guards that legitimately test for one kind
   (`catalog/build.ts:432`, `definition/catalog.ts:83`, `definition/batch.ts`) or the
   `isMultiSelect`-style predicates. Those ask "is this specifically a list of strings?"
   and a record correctly fails them; converting would add noise, not safety.

4. This task changes no behaviour. If any test output changes, STOP and report — it
   means a chain was not equivalent to its switch.

**Verify:**
```bash
cd packages/workflows && pnpm exec vitest run
# Expected: 26 files, 436 tests passed — EXACTLY the baseline. A behaviour-preserving
# refactor must not move any count.
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: "Tasks: 1 successful, 1 total"
```

**Out of scope:** adding the `record` kind (Task 2). This task only makes its absence
detectable.

---

## Task 1: Fix the two options-provider bugs

**Depends on:** none

**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/useWorkflowOptions.ts` — refetch when the query changes; allow retry after failure
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/OptionsField.tsx` — render a distinct error state; stop `issue` masking `error`

**Steps:**

1. In `useWorkflowOptions.ts`, the effect currently reads:
   ```ts
   useEffect(() => {
     if (!ready || query === undefined) return;
     if (fetcher.state === "idle" && fetcher.data === undefined) {
       fetcher.load(`${path.to.api.workflowOptions}?${query}`);
     }
   }, [fetcher, query, ready]);
   ```
   `fetcher.data === undefined` is only true before the FIRST response, so the field
   never refetches — and a failed first load leaves `fetcher.data` set to
   `{ options: [], error }`, permanently sticking the field empty for the rest of the
   editing session.

   Replace the guard with one that tracks the query actually loaded. Add
   `const loadedQuery = useRef<string | undefined>(undefined);` (import `useRef`), and:
   ```ts
   useEffect(() => {
     if (!ready || query === undefined) return;
     if (fetcher.state !== "idle") return;
     if (loadedQuery.current === query) return;
     loadedQuery.current = query;
     fetcher.load(`${path.to.api.workflowOptions}?${query}`);
   }, [fetcher, query, ready]);
   ```

2. Add a `retry` function to the hook's return value, so a failed load can be retried
   without a page reload:
   ```ts
   const retry = useCallback(() => {
     loadedQuery.current = undefined;
     if (ready && query !== undefined) {
       loadedQuery.current = query;
       fetcher.load(`${path.to.api.workflowOptions}?${query}`);
     }
   }, [fetcher, query, ready]);
   ```
   Return it alongside the existing fields. Import `useCallback`.

3. In `OptionsField.tsx`, the failure path currently falls through to a `Combobox` with
   an empty list, which reads as "this account has no calendars" rather than "the call
   failed". Add an explicit error branch AFTER the `!ready` branch and BEFORE the
   `loaded && options.length === 0 && emptyHref` branch:
   ```tsx
   if (loaded && error) {
     return (
       <Field label={label} required={required} issue={issue}>
         <div className="flex items-center gap-2">
           <p className="text-sm text-muted-foreground">
             <Trans>Couldn't load the choices for this field.</Trans>
           </p>
           <Button variant="secondary" size="sm" onClick={retry} isDisabled={isReadOnly}>
             <Trans>Try again</Trans>
           </Button>
         </div>
       </Field>
     );
   }
   ```
   Import `Button` from `@carbon/react` and destructure `retry` from `useWorkflowOptions`.

4. In the same file, the final `Field` currently passes `issue={issue ?? error}`, which
   lets a field-level issue mask the error entirely. Since step 3 now handles `error` in
   its own branch, change that prop to just `issue={issue}`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total" and no TypeScript errors
```

**Out of scope:** the options endpoint (`api+/workflows.options.ts`) and
`options-providers.server.ts` — the server already returns `{ options: [], error }`
correctly; this task is entirely client-side. Do NOT change the piece's auth shape:
it was verified correct (a real call reaches Google and returns a genuine 401 on a
bad token).

---

## Task 2: Add the `record` kind to `ValueType` and its type functions

**Depends on:** none (but Tasks 6, 10, 15 depend on this)

**Files:**
- Modify: `packages/workflows/src/definition/types.ts` — add the kind and every type function's record case
- Modify: `packages/workflows/src/definition/catalog.ts` — `walkPath` record branch
- Create: `packages/workflows/src/definition/record.test.ts`

**Steps:**

1. In `types.ts`, add a recursive record schema. `valueTypeSchema` is a
   `z.discriminatedUnion`, which cannot be recursive directly, so declare the record
   member with `z.lazy` and give the union an explicit type annotation:
   ```ts
   /** A bag of named fields. No table, no id, no row to load — unlike `entity`.
    * Structural: the type carries its own fields, so nothing is registered anywhere. */
   export const recordTypeSchema: z.ZodType<{
     kind: "record";
     fields: Record<string, ValueType>;
   }> = z.lazy(() =>
     z.object({
       kind: z.literal("record"),
       fields: z.record(z.string(), valueTypeSchema)
     })
   );
   ```
   **This was verified before planning, so it is a decision rather than a coin flip.**
   A `z.lazy` member cannot go inside `z.discriminatedUnion`, so `scalarTypeSchema` and
   `valueTypeSchema` must both become `z.union` with explicit `z.ZodType<…>` annotations.
   A runnable proof of the exact shape — nested records parse, `list<record>` parses, and
   `list<list<T>>` is still REJECTED — is recorded in the review notes for this plan.

   The one real cost: a plain union degrades zod's parse error from
   "expected `kind` to be one of…" to a nested `invalid_union` dump. That surfaces to a
   user only through `validate.ts`'s `MALFORMED_DEFINITION`, and only for a corrupted
   stored definition (catalog types never round-trip through this schema), so it is
   acceptable. Do NOT weaken the schema to `z.any()` to avoid it.

2. Add `record` to `scalarTypeSchema` (so `list<record>` is legal) and to
   `valueTypeSchema`. **`list.of` must still refuse another `list`** — `list<list<T>>`
   stays unrepresentable, which is what makes `flatten` a flag rather than an operation
   in Task 10.

3. Add the constructor to `t`:
   ```ts
   record: (fields: Record<string, ValueType>): ValueType => ({ kind: "record", fields })
   ```

4. Fix the three call sites that currently assume `list.of` has an `.of` string.
   **These break silently, not loudly** — this is the most important step in the task.

   - `typesEqual` currently does `a.of.kind === b.of.kind && a.of.of === b.of.of`.
     On a record `.of.of` is `undefined`, so **two different record lists would compare
     equal**. Rewrite it to recurse:
     ```ts
     export function typesEqual(a: ValueType, b: ValueType): boolean {
       if (a.kind === "list" && b.kind === "list") return typesEqual(a.of, b.of);
       if (a.kind === "primitive" && b.kind === "primitive") return a.of === b.of;
       if (a.kind === "entity" && b.kind === "entity") return a.of === b.of;
       if (a.kind === "record" && b.kind === "record") {
         const ak = Object.keys(a.fields).sort();
         const bk = Object.keys(b.fields).sort();
         if (ak.length !== bk.length) return false;
         return ak.every((k, i) => {
           const bf = b.fields[k];
           const af = a.fields[k];
           return bk[i] === k && af !== undefined && bf !== undefined && typesEqual(af, bf);
         });
       }
       return false;
     }
     ```
   - `describeType` currently does `` `a list of ${type.of.of}` ``, which would render
     "a list of undefined" in a customer-facing issue message. Add record cases:
     `record` → `"an object"`; `list` of a record → `"a list of objects"`; otherwise
     keep today's wording.
   - `scalarValueMatches` — records are never literals (step 5), so it must
     **return `false`** for `kind === "record"` rather than fall through.

5. Records may never be literals, comparable, or renderable as text:
   - `rendersAsText` — return `false` for `record`, and for a `list` whose `of` is a
     record. This is what keeps a record out of every template.
   - `operatorsForType` — return `[]` for `record`, and `[]` for a `list` whose `of`
     is a record (`equals` cannot compare records, so `contains` would be a lie).
     Note `OPERATORS_BY_TYPE` is `satisfies Record<string, readonly Operator[]>`;
     do not add a `record` key to it — branch in the function instead.
   - `literalValueMatchesType` — via step 4's `scalarValueMatches` change, a record
     literal can never validate. Confirm a `list<record>` literal also fails.

6. In `definition/catalog.ts`, `walkPath` currently descends only through entities.
   Add a record branch BEFORE the entity check:
   ```ts
   if (current.kind === "record") {
     const next = current.fields[segment];
     if (next === undefined) return undefined;
     current = next;
     continue;
   }
   ```
   Change the loop's opening `if (current.kind !== "entity") return undefined;` so it
   only rejects after the record branch has had its turn.

7. Create `record.test.ts` covering: `typesEqual` distinguishes two record types with
   different fields (the silent-equality bug from step 4); `typesEqual` treats field
   order as irrelevant; `describeType` on a record and on `list<record>`;
   `rendersAsText` false for both; `operatorsForType` empty for both;
   `literalValueMatchesType` false for a record; `walkPath` descends
   `record{organizer: record{email: string}}` via `["organizer","email"]` and returns
   `undefined` for a missing field; and that a `list<list<string>>` fails to parse
   through `valueTypeSchema`.

**Verify:**
```bash
cd packages/workflows && pnpm exec vitest run
# Expected: all files pass, total >= 437 tests (436 baseline + the new record tests),
# and zero failures. A DROP below 436 means an existing test broke — STOP and report.
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: "Tasks: 1 successful, 1 total"
```

**Out of scope:** the runtime value model (Task 3), any catalog or integration file,
and the filter node. Do NOT add a `record` case to `runtime/compare.ts` — its `equals`
already returns `false` for anything that is not a primitive or entity, which is the
correct behaviour and needs no edit.

---

## Task 3: Add `record` to the runtime value model and resolver

**Depends on:** Task 2

**Files:**
- Modify: `packages/workflows/src/runtime/types.ts` — `RuntimeValue` gains a record member
- Modify: `packages/workflows/src/runtime/values.ts` — `recordValue`, `fromColumn` record branch
- Modify: `packages/workflows/src/runtime/resolve.ts` — `walk` record branch
- Create: `packages/workflows/src/runtime/record.test.ts`

**Steps:**

1. In `runtime/types.ts`, add to the `RuntimeValue` union:
   ```ts
   // Carries its own type so `walk` knows each field's declared type without a
   // catalog lookup — records are structural and registered nowhere.
   | { kind: "record"; of: Extract<ValueType, { kind: "record" }>; fields: Record<string, RuntimeValue> }
   ```

2. In `runtime/values.ts`, add:
   ```ts
   export function recordValue(
     of: Extract<ValueType, { kind: "record" }>,
     fields: Record<string, RuntimeValue>
   ): RuntimeValue {
     return { kind: "record", of, fields };
   }
   ```

3. In the same file, `fromColumn` shapes a raw value against a declared type. Add a
   record branch that walks the declared fields (NOT the raw object's keys — a vendor
   sending an extra field must not smuggle it into a typed value):
   ```ts
   if (type.kind === "record") {
     const source = (raw !== null && typeof raw === "object" && !Array.isArray(raw))
       ? (raw as Record<string, unknown>)
       : {};
     const fields: Record<string, RuntimeValue> = {};
     for (const [name, fieldType] of Object.entries(type.fields)) {
       fields[name] = fromColumn(fieldType, source[name]);
     }
     return recordValue(type, fields);
   }
   ```
   Place it AFTER the existing `type.kind === "list"` branch and BEFORE the
   `raw === null || raw === undefined` early return, so a null record still yields a
   record of nulls rather than a bare null. The existing list branch already applies
   `MAX_LIST_ITEMS` through `listValue`, so a `list<record>` is capped for free.

4. In `runtime/resolve.ts`, `walk` currently fails on any non-entity segment. Add a
   record branch at the top of the loop, after the `isNull` check:
   ```ts
   if (current.kind === "record") {
     const next = current.fields[segment];
     // A field the vendor did not send resolves to null, never an error.
     current = next ?? nullValue();
     continue;
   }
   ```
   **It must never touch `ctx.loader`** — a record carries its data inline, so there is
   nothing to fetch. Import `nullValue` if not already imported.

5. Create `record.test.ts` covering: `fromColumn` builds a record from a plain object;
   a missing field becomes null; an extra key in the raw object is dropped; a nested
   record is built recursively; `fromColumn` on a `list<record>` builds a list of
   records and caps at `MAX_LIST_ITEMS`; `walk` reaches `["organizer","email"]` on a
   record value; `walk` returns null for a field the record type declares but the value
   lacks; and — critically — that walking a record **never calls the loader** (pass a
   loader stub that throws if called).

**Verify:**
```bash
cd packages/workflows && pnpm exec vitest run
# Expected: all pass, total greater than after Task 2, zero failures
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: "Tasks: 1 successful, 1 total"
```

**Out of scope:** `runtime/compare.ts` (see Task 2's out-of-scope note), the filter
executor (Task 10b), and the integration action (Task 7).

---

## Task 3b: Teach the three record-blind consumers about records

**Depends on:** Task 3

**Files:**
- Modify: `packages/jobs/src/workflows/integrations/properties.ts` — `toPlain` record case
- Modify: `packages/jobs/src/workflows/retention.ts` — `compactForLog` record case
- Modify: `apps/erp/app/modules/workflows/ui/Runs/RuntimeValueView.tsx` — render a record

**Steps:**

These three consume `RuntimeValue` from outside `packages/workflows` and each is blind to
a new kind in a different way. **All three are load-bearing for this feature** — without
the third, an integration step's output renders as nothing in run history, which is the
first place a user looks after a workflow runs.

1. `properties.ts:97` `toPlain` is a real exhaustive `switch (value.kind)`, so Task 3
   **breaks the `@carbon/jobs` typecheck** the moment `record` joins `RuntimeValue`. That
   is the desired behaviour — fix it here by adding:
   ```ts
   case "record":
     return Object.fromEntries(
       Object.entries(value.fields).map(([name, field]) => [name, toPlain(field)])
     );
   ```
   This also makes a record usable as a piece input value, which costs nothing and is the
   obvious reading of "convert a runtime value to plain JSON".

2. `retention.ts` `compactForLog` special-cases `entity` and `pairs` (lines ~30-41) and
   otherwise walks a value as a generic object. A record would have its nested
   `RuntimeValue` fields walked as plain data, corrupting stored run history when pass 3
   compacts it after 7 days. Add a record branch that recurses through `fields` with the
   same depth/size caps the existing branches use.

3. `RuntimeValueView.tsx:32` `isRuntimeValue` is a hand-maintained allowlist:
   ```ts
   return obj.kind === "primitive" || obj.kind === "entity"
       || obj.kind === "list" || obj.kind === "pairs";
   ```
   A record fails it, so the view falls through to raw JSON or nothing. Add
   `|| obj.kind === "record"` and a render branch. **Copy the existing `pairs` branch
   (lines ~199-225) verbatim as the precedent** — a record renders exactly like named
   rows: a `<dl>` of field name -> nested `<RuntimeValueView>`, with the same
   `depth + 1` recursion and the same "Nothing" empty state.

4. Add a test for `toPlain` on a nested record, and one for `compactForLog` preserving a
   record's structure while capping it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp
# Expected: both succeed. Before this task, @carbon/jobs MUST have been failing on
# toPlain's exhaustive switch — if it was not, Task 3 did not add the kind correctly.
cd packages/jobs && pnpm exec vitest run src/workflows/
# Expected: all pass, including the new toPlain and compactForLog cases
```

**Out of scope:** `ConditionDetail.tsx` — records are never condition operands
(Task 2 makes `operatorsForType` return `[]`), so it needs no record case.

---

## Task 4: Refuse a record-typed catalog input

**Depends on:** Task 2

**Files:**
- Modify: `packages/workflows/src/catalog/build.ts` — reject a record-typed input in `validateCatalogInputs`
- Modify: `packages/workflows/src/catalog/build.test.ts` — add the case

**Steps:**

1. The spec scopes records to outputs and the data node only: a record must never be a
   catalog INPUT type, because every existing form, template and condition would then
   have to handle one. Find `validateCatalogInputs` in `build.ts` (it already reports
   problems like `Entity "X" names table "Y", which is not in the database schema.`
   and is thrown on by `buildCatalog`).

2. Add a check over every action, integration and operation input that pushes a problem
   when the input's declared type is a record, or a list whose `of` is a record:
   ```ts
   const isRecordType = (type: ValueType): boolean =>
     type.kind === "record" || (type.kind === "list" && type.of.kind === "record");
   ```
   Message shape, matching the file's existing voice:
   `` `Input "${inputName}" on ${id} is an object, which cannot be filled in by a person.` ``

3. Follow the existing traversal in that function so the check covers the same three
   declaration kinds it already validates. If the function's shape makes a single
   shared helper awkward, add the check at each of the three sites rather than
   restructuring the function.

4. Add a test to `build.test.ts` asserting `buildCatalog` throws when a hand-written
   action declaration carries a record-typed input, and that the message names the
   input and the action. Follow the existing throwing-case tests in that file for
   shape.

**Verify:**
```bash
cd packages/workflows && pnpm exec vitest run
# Expected: all pass, includes the new record-input rejection test
pnpm run check:workflow-catalog
# Expected: "check-workflow-catalog: ok — ..." (no shipped input is a record, so this
# must still pass unchanged)
```

**Out of scope:** the generated catalog files — this task adds a guard only, and
changes no emitted output.

---

## Task 5: Read `outputSchema` off a piece and map it to `ValueType`

**Depends on:** none (pure mapping; Task 6 consumes it)

**Files:**
- Modify: `packages/jobs/src/workflows/integrations/types.ts` — add `PieceOutputField` / `PieceOutputSchema`, and `outputSchema` on `PieceAction`
- Create: `packages/jobs/src/workflows/integrations/outputs.ts`
- Create: `packages/jobs/src/workflows/integrations/outputs.test.ts`
- Copy from (precedent): `packages/jobs/src/workflows/integrations/properties.ts` and its `properties.test.ts` — this file is its mirror image for the output side

**Steps:**

1. In `types.ts`, add the structural shapes (measured against 12 pieces / 496 actions —
   `key` and `label` appear on all 3,987 field descriptors; `format` on 1,728;
   `children` on 339; `listItems` on 175):
   ```ts
   export interface PieceOutputField {
     key: string;
     label: string;
     /** Dotted path to read the value from, relative to its container.
      * Absent means the value is at `key`. e.g. "body.items", "start.dateTime". */
     value?: string;
     format?: string;
     children?: readonly PieceOutputField[];
     listItems?: readonly PieceOutputField[];
     labelKey?: string;
     /** The vendor declaring that keys under here vary per account and cannot be
      * enumerated. We omit such fields rather than invent names for them. */
     dynamicKey?: boolean;
   }
   export interface PieceOutputSchema {
     fields: readonly PieceOutputField[];
     itemLabel?: string;
   }
   ```
   Add `outputSchema?: PieceOutputSchema;` to `PieceAction`.

2. Create `outputs.ts` exporting `UnmappableOutputError` (mirroring
   `UnmappablePropertyError` in `properties.ts`) and `toOutputTypes`:
   ```ts
   export class UnmappableOutputError extends Error {
     constructor(piece: string, action: string) {
       super(`${piece}.${action} declares no outputSchema, so Carbon cannot describe what it returns.`);
       this.name = "UnmappableOutputError";
     }
   }
   ```

3. `toOutputTypes(schema: PieceOutputSchema): Record<string, ValueType>` maps each
   top-level field to a named output. Mapping rules:

   | descriptor | Carbon |
   |---|---|
   | `listItems` present | `t.list(t.record(<element fields>))` |
   | `children` present | `t.record(<child fields>)` |
   | `format: "datetime"` | `t.date` |
   | `format: "number"` | `t.number` |
   | `format: "boolean"` | `t.boolean` |
   | `format` url/email/image/filesize, or absent | `t.string` |
   | `dynamicKey: true` | **omit the field entirely** |

   Recurse for `children` and `listItems`. A container with neither is a leaf.
   Because `list.of` refuses another list (Task 2), a `listItems` entry that itself
   carries `listItems` must map its inner list to `t.string` rather than throwing —
   the raw `result` output remains the way to reach it. Add a comment saying so.

4. Export a companion `outputPaths(schema)` returning, for each emitted output, the
   dotted `value` path (or `key` when `value` is absent) plus the same recursive
   structure — Task 7 needs it to project the real response. Keep it in this file so
   the type mapping and the path extraction can never disagree about which fields exist.

5. Create `outputs.test.ts` using the REAL Google Calendar schema as a fixture (copy the
   literal from the installed piece; do not import the package in a unit test).
   Cover: `google_calendar_get_events` maps `items` to `list<record>` with `summary`,
   `startDateTime` (date, from `start.dateTime`), `organizerEmail` (string, from
   `organizer.email`); `create_google_calendar_event` maps `start`/`end`/`organizer`
   to nested records via `children`; a `dynamicKey: true` field is omitted; each
   `format` maps to the right primitive; and `outputPaths` returns the dotted paths
   matching the type map's keys.

**Verify:**
```bash
cd packages/jobs && pnpm exec vitest run src/workflows/integrations/outputs.test.ts
# Expected: the new test file passes with zero failures
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: "Tasks: 1 successful, 1 total"
```

**Out of scope:** `catalog.ts` (Task 6) and the run-time projection (Task 7). Do not
change `properties.ts` — the input side is unaffected.

---

## Task 6: Emit typed integration outputs; refuse an action with no schema

**Depends on:** Task 2, Task 5

**Files:**
- Modify: `packages/jobs/src/workflows/integrations/catalog.ts` — typed outputs, `count`, refuse a schema-less action
- Modify: `.claude/rules/workflow-integrations.md` — update the "Adding a piece" checklist and the outputs non-goal

**Steps:**

1. In `catalog.ts`, `buildPieceActionDeclarations` currently emits
   `outputs: { result: { kind: "primitive", of: "string" } }` for every action.
   Replace with:
   ```ts
   if (action.outputSchema === undefined) {
     throw new UnmappableOutputError(pieceName, actionName);
   }
   const outputs = {
     ...toOutputTypes(action.outputSchema),
     // `compare` has no "is empty" operator on lists, so "did anything come back?"
     // is otherwise inexpressible.
     count: { kind: "primitive", of: "number" } as const,
     // Retained so every already-saved workflow referencing `result` keeps working.
     result: { kind: "primitive", of: "string" } as const
   };
   ```
   Throwing fails `generate:workflow-catalog`, which then writes no files — the same
   posture `UnmappablePropertyError` already has for inputs.

2. If `toOutputTypes` returns a key named `count` or `result`, the piece's own field
   would be shadowed. Guard it: prefix a colliding vendor key with the piece's own
   naming rather than silently dropping it, or STOP and report if a collision is found
   in the two allowlisted actions. (Checked at planning time: neither
   `google_calendar_get_events` nor `create_google_calendar_event` declares a `count`
   or `result` field, so this is a guard, not an expected case.)

3. Update `.claude/rules/workflow-integrations.md`:
   - The "Non-goals (v1)" line currently reads that mapping a piece's output schema is
     a non-goal and `outputs` is `{ result: t.string }`. Replace it with a short
     statement of the new behaviour: outputs are derived from the piece's own
     `outputSchema`, `result` is retained as the raw escape hatch, and an action
     without an `outputSchema` is refused by the generator.
   - Add a line to the "Adding a piece" checklist: verify every allowlisted action
     ships an `outputSchema` (coverage is binary per piece — ~100% on Google Calendar,
     Sheets, Airtable, Notion, GitHub, Slack; 0% on HubSpot, Salesforce, Jira, Shopify,
     Excel-365, Xero), because the generator will refuse the piece otherwise.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: "Tasks: 1 successful, 1 total"
```
Catalog regeneration is Task 8 — do not run the generator yet.

**Out of scope:** the allowlist's prop hiding (Task 13) and the run-time projection
(Task 7).

---

## Task 7: Project the vendor response into record outputs at run time

**Depends on:** Task 3, Task 6

**Files:**
- Modify: `packages/jobs/src/workflows/actions/integration.ts` — build record outputs from the real response
- Create: `packages/jobs/src/workflows/actions/integration-outputs.test.ts`

**Steps:**

1. In `runIntegrationAction`, the success path currently returns
   `outputs: { result: { kind: "primitive", of: "string", value: JSON.stringify(result) } }`.
   Extend it to also project the declared outputs using `outputPaths` (Task 5) and
   `fromColumn` (Task 3):
   - walk each output's dotted path against the raw `result` object;
   - shape the value with `fromColumn(declaredType, rawAtPath)`, which already yields
     null for anything missing or unusable;
   - set `count` to the length when the projected value is a list, else `result === undefined ? 0 : 1`;
   - keep `result` exactly as today.

2. **Never throw from projection.** A vendor response that does not match its declared
   schema must degrade field-by-field to null, not fail the step — `outputSchema` is
   unvalidated upstream (`run()` returns `Promise<unknown | void>` and nothing checks
   it anywhere), so treating it as a contract at run time would break real workflows.
   Wrap the projection in a try/catch that falls back to `{ count, result }` alone and
   logs at warn level. If you find yourself adding a validation error path, STOP and
   report — that contradicts the spec.

3. Create `integration-outputs.test.ts` covering: a realistic Google Calendar
   `get_events` response projects `items` to a list of records with the right field
   values; a missing `organizer` yields null rather than throwing; `count` matches the
   item count; `count` is 0 for an empty list; `result` still holds the full raw JSON;
   and a response of an entirely unexpected shape still returns `{ count, result }`
   without throwing. Follow the existing test style under
   `packages/jobs/src/workflows/`; stub the piece action rather than making a network
   call.

**Verify:**
```bash
cd packages/jobs && pnpm exec vitest run src/workflows/actions/integration-outputs.test.ts
# Expected: the new test file passes with zero failures
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: "Tasks: 1 successful, 1 total"
```

**Out of scope:** the connection/auth path in the same file — it was verified correct
and must not be touched.

---

## Task 8: Regenerate and verify the workflow catalog

**Depends on:** Task 6 AND Task 13. **Run this ONCE, after both have landed** — the
generator has two inputs changing in this plan (typed outputs from Task 6, hidden props
from Task 13), and running it against a half-changed allowlist just produces a diff you
throw away. Its position in the Progress list reflects that.

**Files:**
- Modify (generated, do not hand-edit): `packages/workflows/src/catalog/actions.generated.ts`, `events.generated.ts`, `labels.generated.ts`, `help.generated.ts`

**Steps:**

1. Run the generator. It reads the allowlist, loads each piece, and writes all four
   generated files:
   ```bash
   pnpm run generate:workflow-catalog
   ```

2. Inspect the diff on `actions.generated.ts` and confirm
   `WORKFLOW_INTEGRATION_CATALOG` now carries record-shaped outputs for both
   allowlisted actions plus `count` and `result`. If either action still shows only
   `{ result }`, Task 6 did not take effect — STOP and report.

3. Run the staleness check, which rebuilds from the same six inputs and compares:
   ```bash
   pnpm run check:workflow-catalog
   ```

4. Regenerating changes label text, so refresh the translation catalogs per
   `.claude/rules/i18n-lingui-system.md`:
   ```bash
   pnpm run lingui:extract && pnpm run lingui:clean
   ```
   If either script does not exist, skip this step and report it rather than inventing
   a command.

**Verify:**
```bash
pnpm run check:workflow-catalog
# Expected: "check-workflow-catalog: ok — ... 17 entities, 16 actions, 2 integration steps, ..."
# The entity count MUST still be 17 — records are not entities, so this number must not move.
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: "Tasks: 1 successful, 1 total"
```

**Out of scope:** hand-editing any `*.generated.ts` file. If the generated output is
wrong, fix the generator input and re-run.

---

## Task 9: Widen the filter node schema with `operation`

**Depends on:** none structurally, but land after Task 2 so Task 10 can follow immediately

**Files:**
- Modify: `packages/workflows/src/definition/schema.ts` — add `operation`, `field`, `flatten` to `filterNode.data`
- Modify: `packages/workflows/src/definition/schema.test.ts` — add the back-compat case

**Steps:**

1. In `schema.ts`, `filterNode.data` is currently
   `{ source, combinator, clauses }`. Add three optional-with-default fields:
   ```ts
   export const dataOperationSchema = z.enum([
     "filter", "count", "first", "last", "pluck", "join"
   ]);
   export type DataOperation = z.infer<typeof dataOperationSchema>;
   ```
   and in `filterNode.data`:
   ```ts
   operation: dataOperationSchema.default("filter"),
   /** Which field `pluck` projects. A dotted path into the source's record type. */
   field: z.string().optional(),
   /** `pluck` only: collapse a list-valued field into one flat list, since
    * list<list<T>> is unrepresentable. Defaults FALSE so stored data never carries a
    * flag that means nothing — the form sets it true when the chosen field is
    * list-valued, which is the only case where it applies. */
   flatten: z.boolean().default(false)
   ```

2. **Do not bump `CURRENT_DEFINITION_FORMAT_VERSION`** (currently 4) and do not add a
   `normalize.ts` migration. An existing saved node has no `operation` key, so the
   default makes it parse as `"filter"` and behave exactly as before. This is the whole
   reason the spec chose to widen in place rather than rename the node type.

3. Add a test asserting a filter node parsed from JSON with **no** `operation`, `field`
   or `flatten` keys yields `operation === "filter"` and `flatten === false`, and that
   its `source`/`combinator`/`clauses` are unchanged.

**Verify:**
```bash
cd packages/workflows && pnpm exec vitest run
# Expected: all pass, including the new back-compat test
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: "Tasks: 1 successful, 1 total" — note this will FAIL to typecheck any
# exhaustive switch that must now handle the new operations; that is Task 10's job.
# If typecheck fails ONLY inside nodes.ts/filter.ts, proceed to Task 10.
```

**Out of scope:** the file extraction (Task 10a), per-operation behaviour and
runtime (Task 10b), UI (Task 12).

---

## Task 10a: Extract the data node kind out of `nodes.ts`

**Depends on:** Task 9

**Files:**
- Create: `packages/workflows/src/definition/kinds/data.ts`
- Modify: `packages/workflows/src/definition/nodes.ts` — import the kind instead of defining it inline
- Copy from (precedent): `packages/workflows/src/runtime/filter.ts` — the runtime layer ALREADY splits one file per node kind (`action.ts`, `lookup.ts`, `compute.ts`, `condition.ts`, `integration.ts`, `filter.ts`); this task brings the definition layer in line with that.

**Steps:**

1. `definition/nodes.ts` is **840 lines** and holds all seven node kinds inline. Task 10b
   adds a six-operation matrix across `outputs` / `loopList` / `checkTypes` /
   `checkConfig`, which would push it toward 1000+ and turn the tidiest kind block (36
   lines today) into the messiest. Extract first, then grow.

2. Move `filterLoopList` and the whole `filter:` entry of `NODE_KINDS` into
   `definition/kinds/data.ts`, exporting it as `dataNodeKind`. Keep the node type id
   `"filter"` — only the file moves.

3. The `NodeKind<N>` interface is not currently exported from `nodes.ts`. Export it (and
   `NodeContext`, `LoopList`, `NodeOutputs` if not already) so the extracted file can type
   its export. Import the shared helpers it needs (`checkClauses`, `clauseConfigIssues`,
   `incomplete`) rather than duplicating them — if that creates an import cycle
   (`nodes.ts` -> `kinds/data.ts` -> `nodes.ts`), move those three helpers into a sibling
   `definition/kinds/shared.ts` instead. Do NOT copy them.

4. `nodes.ts` then reads `filter: dataNodeKind,` in its `NODE_KINDS` map. `NODE_KINDS` is
   a **total** mapped type over `WorkflowNodeType`, so a missing entry is a compile error
   — that safety is unchanged by the move.

5. This task changes no behaviour. It is a pure file move.

**Verify:**
```bash
cd packages/workflows && pnpm exec vitest run
# Expected: EXACTLY the baseline count from Task 9 — a file move must not change any test
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: "Tasks: 1 successful, 1 total"
wc -l src/definition/nodes.ts
# Expected: meaningfully below 840 — the file must SHRINK, never grow, in this task
```

**Out of scope:** any per-operation behaviour (Task 10b). Extract only.

---

## Task 10b: One operation table driving type, runtime and UI

**Depends on:** Task 2, Task 10a

**Files:**
- Modify: `packages/workflows/src/definition/kinds/data.ts` — the operation table plus per-operation `outputs` / `loopList` / `checkTypes` / `checkConfig`
- Modify: `packages/workflows/src/runtime/filter.ts` — execute via the same table
- Modify: `packages/workflows/src/definition/schema.ts` — derive the enum from the table
- Modify: `packages/workflows/src/runtime/filter.test.ts` and the data-kind test file

**Steps:**

1. **The point of this task is that one concept lives in one place.** A naive
   implementation spreads "what each operation does" across four lists — the schema enum,
   the output-type switch, the runtime switch, and the form's dropdown — with nothing
   keeping them in sync. Instead declare a single table in `kinds/data.ts`:

   ```ts
   export interface DataOperationSpec {
     /** Shown in the builder's operation dropdown. */
     label: MessageDescriptor;
     /** The `result` type, or undefined when the source cannot support this operation
      * (which reads as "not configured" and suppresses downstream type errors). */
     resultType(source: ValueType, node: FilterNode, ctx: NodeContext): ValueType | undefined;
     /** Whether this operation exposes a loop item — only `filter` does, which is what
      * keeps `ItemRef` meaning exactly one thing. */
     loops: boolean;
     /** Clause rows apply to this operation. */
     usesClauses: boolean;
   }
   export const DATA_OPERATIONS = { filter: {...}, count: {...}, ... }
     satisfies Record<string, DataOperationSpec>;
   export type DataOperation = keyof typeof DATA_OPERATIONS;
   ```

2. Derive the zod enum from the table so the two can never disagree:
   `z.enum(Object.keys(DATA_OPERATIONS) as [DataOperation, ...DataOperation[]])`.
   If Task 9 hard-coded the enum literal, replace it here.

3. `resultType` per operation, given the source's resolved type `S`:

   | operation | requires | `result` |
   |---|---|---|
   | `filter` | `S` is `list<T>` | `list<T>` (unchanged) |
   | `count` | `S` is `list<T>` | `number` |
   | `first` / `last` | `S` is `list<T>` | `T` |
   | `pluck` | `S` is `list<record>`, `field` names a field of type `F` | `F`; if `F` is `list<X>` and `flatten`, then `list<X>` |
   | `join` | `S` is `list<primitive>` | `string` |

   Resolve `pluck`'s field with `walkPath(elementType, field.split("."), ctx.catalog)` so
   a dotted path into a nested record works. Return `undefined` whenever a requirement is
   unmet — the existing convention in this file.

4. The kind's `outputs`, `loopList`, `checkTypes` and `checkConfig` all read the table
   rather than switching on the operation themselves: `outputs` calls `resultType`,
   `loopList` returns the source list only when `spec.loops`, `checkTypes` reports a
   `TYPE_MISMATCH` when `resultType` returns undefined and only runs `checkClauses` when
   `spec.usesClauses`, and `checkConfig` adds an `incomplete(node, "field", …)` for
   `pluck` with no `field`. Keep `configured: () => true`.

5. In `runtime/filter.ts`, keep the source resolution and `ctx.record?.("source", …)`
   exactly as today, then dispatch on the operation. Put each operation's execution body next to
   its spec (add a `run` member to `DataOperationSpec`) so a reader sees the type rule and
   the behaviour together, and adding an operation is one table entry rather than four
   edits. `permission` stays `() => undefined`.

   Behaviour per operation: `filter` is today's loop verbatim (clause evaluation, the
   `unresolved` counter, `filterSummary`); `count` emits `items.length`; `first`/`last`
   emit the item or a null value when empty; `pluck` walks `field.split(".")` per item and,
   when `flatten`, splices list-valued results instead of nesting; `join` string-joins with
   `", "`. Cap results through `listValue`, which already applies `MAX_LIST_ITEMS`.

6. Give each operation a one-line summary in the existing voice (today's is
   `"Kept N of M."`): `"Counted N."`, `"Took the first of N."`, `"Took N values."`,
   `"Joined N values."`.

7. Tests: each operation's output type; `pluck` with a scalar field; `pluck` with a
   list-valued field and `flatten: true` giving a flat list; the same with `flatten: false`
   returning `undefined` (unrepresentable, so not configured); `loopList` present for
   `filter` and absent otherwise; `pluck` naming a missing field producing a type issue;
   empty-list `first`/`last` yielding null rather than failing. **Every pre-existing filter
   test must still pass unmodified** — that is the back-compat guarantee.

**Verify:**
```bash
cd packages/workflows && pnpm exec vitest run
# Expected: all pass, total greater than after Task 10a, and every pre-existing
# filter test passes UNCHANGED
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: "Tasks: 1 successful, 1 total"
```

**Out of scope:** the engine (`packages/jobs/.../engine/execute.ts`) — integration nodes
stay non-batchable; `node.type !== "action"` at execute.ts:261 is deliberate. Also out of
scope: the form (Task 12), which will read `DATA_OPERATIONS` for its dropdown rather than
listing operations again.

---

## Task 12: Filter form — operation selector, field picker, record sources

**Depends on:** Task 10

**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/FilterForm.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/meta.ts` — palette label/description
- Copy from (precedent): `apps/erp/app/modules/workflows/ui/Builder/config/forms/IntegrationNodeForm.tsx` — its App/Step `Select` blocks (lines ~120–180) are the exact pattern for a labelled dropdown that resets dependent state on change

**Steps:**

1. Add an **Operation** `Select` above the source picker, using the
   `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` imports from
   `@carbon/react` exactly as `IntegrationNodeForm.tsx` does. **Build the options by
   mapping over `DATA_OPERATIONS` from Task 10b** — do not re-list the operations here;
   that table is the single source of truth and its `label` is already a Lingui
   `MessageDescriptor`, resolved the same way `useWorkflowLabel` resolves catalog labels. Changing the operation clears `clauses` and
   `field` (a clause means nothing to `count`), mirroring how `handlePieceChange`
   clears dependent state.

2. Render the clause editor (`ClauseRow`, `CombinatorToggle`) **only when**
   `DATA_OPERATIONS[operation].usesClauses` — again reading the table rather than
   testing for `"filter"` by name. The heading currently reads
   `` t`Keep only the ${entityName} where…` `` — keep it for `filter` and use a neutral
   heading for other operations.

3. When `operation === "pluck"`, render a **Field** `Combobox` listing the fields of
   the source's element record type (read from the resolved source type via the
   builder catalog, not typed free-hand). Use `Combobox` from `@carbon/react` as
   `OptionsField.tsx` does. Show a dotted path for nested record fields.

4. The source list currently filters `vars.filter(v => v.type.kind === "list")`. Widen
   it so record-typed and `list<record>` variables are offered too, since the data node
   now works on them.

5. In `meta.ts`, the filter entry's name is "Filter" with description "Keeps only the
   items that match" and `defaultTitle: "Narrow a list"`. Change the display name to
   "Data" and generalise the description/defaultTitle. **Do not change the node type
   id** — it stays `filter`, which is what keeps saved workflows valid. Leave the
   `LEGACY_RENAMES` map (`{ entity: "compute" }`) untouched.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total" and no TypeScript errors
pnpm run lint
# Expected: no new lint errors in the files touched
```

**Out of scope:** `graph.ts` default node data — a new filter node's data omits
`operation`, which the schema default fills in as `"filter"`; adding it explicitly is
unnecessary and would be the only place the default is written twice.

---

## Task 13: Tier 1+2 prop hiding, and `advancedInputs` on the declaration

**Depends on:** none (independent of the record work)

**Files:**
- Modify: `packages/jobs/src/workflows/integrations/allowlist.ts` — add a `props` hide-list
- Modify: `packages/jobs/src/workflows/integrations/catalog.ts` — apply tier-1 rules and tier-2 overrides
- Modify: `packages/jobs/src/workflows/integrations/properties.ts` — `toPropsValue` applies pinned values
- Modify: `packages/jobs/src/workflows/integrations/properties.test.ts` — pinned-value cases

**Steps:**

1. In `allowlist.ts`, extend `AllowlistEntry` with:
   ```ts
   /** Per-action prop overrides. Written when a piece is allowlisted — the few cases
    * where the vendor's own default is WRONG for us, not merely uninteresting. */
   props?: Record<string, Record<string, { hidden?: boolean; value?: unknown; label?: string }>>;
   ```
   and add to the `google-calendar` entry:
   ```ts
   props: {
     google_calendar_get_events: {
       // "Expand Recurring Event?" defaults to false, which silently drops every
       // recurring meeting from a date-filtered query. Always true for us.
       singleEvents: { hidden: true, value: true },
       // Required with a sensible vendor default; nothing for a person to decide.
       event_types: { hidden: true }
     }
   }
   ```

2. In `catalog.ts`, before emitting an input, apply in order:
   - **Tier 2** — if the allowlist marks the prop `hidden`, do not emit it.
   - **Tier 1** — do not emit a prop that is `required` AND has a `defaultValue`; do not
     emit a prop whose choices contain exactly one value.
   - A hidden REQUIRED prop with **no** allowlist `value` and **no** piece
     `defaultValue` must **throw** and fail the generator — otherwise the piece call
     goes out missing a required field and fails in the customer's face.

   **Emit hidden props as `advancedInputs`, a second map beside `inputs`** on the
   integration declaration (and on `CatalogIntegration` in
   `packages/workflows/src/definition/catalog.ts`). Task 14 renders that map and MUST NOT
   re-derive the hide rules in the browser — one set of rules, evaluated once, at build
   time.

   *Recorded decision, so it does not read as an accident:* the alternative was a
   `hidden: true` flag on `CatalogInput` with the form filtering. Two maps won because
   `validateCatalogInputs` and every `required` check iterate `inputs` — a hidden-but-
   present required input would make the validator demand a field the author was never
   shown. Splitting the maps makes that unrepresentable rather than merely avoided.

3. In `properties.ts`, `toPropsValue` must merge pinned values at RUN time. Give it
   access to the per-action overrides and, for each prop with a `value`, set it when the
   node supplied nothing. **Pinned values are never stored on the node** — that is what
   lets us change our mind and fix every existing workflow at once.

4. Add tests: a pinned `singleEvents: true` reaches `propsValue` when the node has no
   such input; a node-supplied value wins over the pin (Task 14's Advanced override);
   a hidden prop with a piece default is simply absent from `propsValue`, letting the
   piece apply its own default.

**Verify:**
```bash
cd packages/jobs && pnpm exec vitest run src/workflows/integrations/
# Expected: all integration tests pass, including the new pinned-value cases
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: "Tasks: 1 successful, 1 total"
```
Then re-run Task 8's regeneration, since the emitted inputs have changed:
```bash
pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog
# Expected: check passes; the diff shows singleEvents and event_types gone from
# the get_events integration step's inputs
```

**Out of scope:** the connection auto-hide (Task 14 — it depends on how many
connections exist at edit time, so it is UI, not catalog).

---

## Task 14: Advanced properties section on the integration form

**Depends on:** Task 13

**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/IntegrationNodeForm.tsx`
- Copy from (precedent): the same file's existing input loop (`inputNames.map(... renderStepInput ...)`) — Advanced reuses `renderStepInput` verbatim rather than a second renderer

**Steps:**

1. **Auto-hide a lone connection.** The form already calls `useWorkflowOptions` for the
   connection provider and holds the result in `connections`. When
   `connections.length === 1`, do not render the `connectionId` field, and ensure the
   node stores that connection's id (write it via `handleInputChange` on mount if the
   node has no `connectionId` yet). When `connections.length > 1`, render the field as
   today. **The value must still be stored** — a second connection added later must not
   silently repoint existing workflows.

2. **Advanced properties.** Add a collapsed section at the bottom of the form listing
   every input in the step's `advancedInputs` map (emitted by Task 13), rendered with the
   SAME `renderStepInput` helper the visible inputs use. Do not re-derive the hide rules
   here — the catalog already evaluated them.

3. Use an existing disclosure component from `@carbon/react` for the collapse — grep
   `packages/react/src/` for an Accordion/Collapsible before writing one. Label it
   "Advanced properties" via Lingui.

4. A value set in Advanced is stored on the node and must win over the tier-2 pin —
   Task 13 step 3 already implements that precedence (node value beats pin).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
pnpm run lint
# Expected: no new lint errors in the touched files
```

**Out of scope:** changing which props are hidden — that is Task 13's allowlist data.

---

## Task 15: Builder support for walking into record fields

**Depends on:** Task 2

**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/variableMenu.ts` — offer record fields
- Modify: `apps/erp/app/modules/workflows/ui/Builder/labelKeys.ts` — `describeValueType` and `outputLabel`

**Steps:**

1. `variableMenu.ts` builds the variable picker by walking entity properties through the
   catalog. Add a record branch that walks `type.fields` directly — no catalog lookup,
   because a record is structural. Nest recursively for record-valued fields, and for a
   `list<record>` offer the element's fields the same way the code already handles a
   list of entities.

2. Field LABELS come from the record type itself, not from `WORKFLOW_LABELS` — vendor
   field names are vendor data, the same reasoning that makes customer custom-field
   names deliberately untranslated (`catalog.ts` `getPropertyLabel` reads only the
   overlay). Use the field key as the display name, humanised the way the existing
   fallback does.

3. In `labelKeys.ts`, `describeValueType` renders types as "a list of Customer records",
   "text", "a number". Add record cases: "an object", "a list of objects". Also check
   `outputLabel` — it maps `record`/`before`/`after` to display names and falls through
   to the raw name otherwise; add friendly names for the new `count` output (and `items`
   if the generated catalog uses that key).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
pnpm run lint
# Expected: no new lint errors in the touched files
```

**Out of scope:** `ValueField`, `TemplateField` and `ClauseRow` — records are refused in
those positions by construction (Task 2's `rendersAsText`/`operatorsForType` and Task 4's
input guard), so they need no record handling.

---

## Task 16: End-to-end verification

**Depends on:** all previous tasks

**Steps:**

1. Full scoped verification of every touched package:
   ```bash
   pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/jobs --filter=erp
   cd packages/workflows && pnpm exec vitest run
   cd ../jobs && pnpm exec vitest run src/workflows/
   cd ../.. && pnpm run check:workflow-catalog
   pnpm run lint
   ```
   Do NOT run a whole-repo `pnpm run typecheck` — `AGENTS.md` records that it OOMs.

2. Confirm the structural guarantees this plan added, which no single task's Verify
   block covers on its own:
   ```bash
   wc -l packages/workflows/src/definition/nodes.ts
   # Expected: BELOW the 840-line baseline — Task 10a shrank it and Task 10b put the
   # operation matrix in kinds/data.ts, so it must not have grown.
   grep -c "kind === \"record\"" apps/erp/app/modules/workflows/ui/Runs/RuntimeValueView.tsx
   # Expected: at least 1 — a record must render in run history, not fall through.
   ```

3. Walk the spec's Acceptance Criteria list and check each one off in the spec file.
   The ones needing a running app (variable picker contents, Advanced section, the
   calendar dropdown error state, single-connection auto-hide) require the `/run` skill
   or the user's own browser — ask the user before starting the app, and report which
   criteria are verified by tests versus by hand.

4. Update `.claude/rules/workflow-integrations.md` for anything that drifted during
   implementation, per `.claude/rules/keep-sources-in-sync.md`.

5. Report what was done, what passed, and anything deferred. **Do not commit** — the
   user has a standing rule that commits require explicit permission.

**Verify:** every command in step 1 exits zero; test totals are at or above the
recorded baselines (436 in `@carbon/workflows`); `check-workflow-catalog` still reports
17 entities.

**Out of scope:** committing, pushing, opening a PR.
