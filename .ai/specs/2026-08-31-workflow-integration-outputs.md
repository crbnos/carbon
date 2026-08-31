# Workflow integration outputs, the data node, and form control

> Status: draft
> Author: Aashu
> Date: 2026-08-31

## TLDR

An integration step can call a vendor but nobody can use the answer: its output is
`{ result: t.string }`, one opaque JSON string. This spec adds a **`record` value type**
(Carbon's missing object type), makes the catalog generator derive real output types from a
piece's own `outputSchema`, widens the **filter node** into a data node that can count /
pick / project over those values, and gives the integration form **three tiers of field
control** so a person sees a form worth filling in. Research:
`.ai/research/activepieces-decisions.md` (decisions) and
`.ai/research/activepieces-integration-findings.md` (evidence, incl. a four-platform survey).

## Problem Statement

v1 shipped integrations as their own node kind with a documented non-goal — mapping a piece's
output schema (`.claude/rules/workflow-integrations.md`). Three consequences, all now blocking:

1. **The answer is unusable.** "Get all Events" returns
   `{"body":{"items":[…]}}` as a single string. `walkPath` descends only through `entity`
   types, so there is no way to reach `items[0].summary`. `availableVariables` offers exactly
   one variable, of type text. It fails *silently*: the author sees a `result` variable and
   only discovers at run time that it is a blob.
2. **Nothing can operate on it.** Even given a list, there is no way to count it, take the
   first, or project a field. `compare` supports only `contains` on lists and `eq`/`neq` on
   entities, so even "did anything come back?" is inexpressible.
3. **The form shows vendor API trivia.** `buildPieceActionDeclarations` emits every
   `action.props` entry. For `google_calendar_get_events` that includes `singleEvents`
   ("Expand Recurring Event?", required, default `false`) — which is not merely clutter: left
   at its default, a workflow filtering "events tomorrow" silently misses every recurring
   meeting, because unexpanded recurring events carry the *series* start date.

Two traced bugs compound it (see Design §5).

## Goals

1. An author can see, at build time, what an integration step returns — real named fields in
   the variable picker, without running the step, without touching the customer's account,
   and without us hand-writing a shape per action.
2. An author can operate on returned data — count, filter, first/last, project a field,
   join — using one node rather than a new node per operation.
3. An author sees a form worth filling in: vendor trivia hidden by default, business
   decisions surfaced, nothing permanently out of reach.
4. **No per-action maintenance burden.** Adding a piece stays "a few lines and a package" —
   the entire reason to build on Activepieces. No decision here may erode it.
5. Nothing already saved breaks. Every change is additive.

## Non-Goals

- **Nested (2D+) arrays kept grouped.** Needs `list<list<T>>`; `flatten` on `pluck` covers the
  real cases. No platform surveyed solves this either.
- **A publish-time guarantee that a vendor's response matches its declared schema.** Nobody in
  the market does this. Run-time resolution is tolerant; see Design §1.4.
- **Pieces with no `outputSchema`** (HubSpot, Salesforce, Shopify, Xero, Jira, Excel — all at
  0%). Refused at build time, not designed around. Revisit if a customer needs one.
- **`record` as a catalog input type, a stored literal, or inside templates/conditions.**
  Scoped to outputs and the data node only.
- Triggers and non-OAuth2 auth — unchanged from v1's non-goals.

## Proposed Solution

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Object representation | New `record` `ValueType` kind | An `entity` means table + id + permission + loader + `lookup` support. Vendor data has none of those; reusing it would force a lie or a special case at every one of those points. |
| Record shape | **Structural** — fields inline | No registry, no names to resolve, nesting is just a field whose type is a record, and a saved workflow can never dangle against a definition that vanished. Cost: deep equality, bigger types. |
| Record scope | Outputs + data node only | Keeps every existing form, template, condition and literal path untouched. An author reaches down to a primitive before feeding any existing node. |
| Output source | The piece's own `outputSchema` | Zero per-action authoring (goal 4). Coverage is **binary per piece**, so it is knowable with one check at allowlist time. |
| Action with no `outputSchema` | **Refuse — fail the generator** | Same posture as the existing `UnmappablePropertyError`: a half-described action must never reach a customer's canvas. Caught when adding a piece, never by a customer. |
| Schema trust | Authoring-time only; tolerant at run time | `outputSchema` is presentational by upstream's own docs, `run()` returns `Promise<unknown \| void>`, and nothing validates it anywhere. A declared path that is absent or mistyped yields `null`. |
| Data node | **Widen `filter` in place** + `operation` field | The filter node already owns `loopList` and `ItemRef`. A second looping node would mean two loop primitives kept in sync. Existing nodes stay valid with `operation` defaulting to `"filter"` — no migration, `formatVersion` stays 4. |
| Nested arrays | `flatten` flag on `pluck` | A 2D array cannot exist as a value (`list.of` admits only scalars/records), so flatten cannot be a standalone operation taking one — it collapses at the moment of creation. |
| Data node permission | `() => undefined` (unchanged) | It reads values already in the run, fetched by an upstream node that did its own check. Records carry no `permission`, so `lookup` can never target them. |
| Field visibility | Three tiers | Generic rules cost nothing; a reviewed hide list handles the few wrong-for-us defaults; Advanced means a hidden field is **demoted, never lost**. |
| Pinned prop values | Applied at run time, not stored on the node | Changing our mind fixes every existing workflow instead of leaving stale literals behind. |

---

### 1. The `record` value type

**1.1 The type.** `packages/workflows/src/definition/types.ts`:

```ts
// A bag of named fields. No table, no id, no row to load — unlike `entity`.
// Structural: the type carries its own fields, so nothing has to be registered.
const recordTypeSchema = z.object({
  kind: z.literal("record"),
  fields: z.record(z.string(), valueTypeSchema)   // lazy: recursive
});
```

`valueTypeSchema` gains `record`. `scalarTypeSchema` — what a `list` may contain — widens to
admit `record`, so `list<record>` is legal. **`list<list<T>>` stays unrepresentable**, which is
the constraint that makes `flatten` a flag rather than an operation.

`t.record(fields)` joins the `t` constructors.

**Widening `ScalarType` has three known call sites that break silently and must be fixed
together** (each currently assumes `list.of` has a `.of` string):

- `types.ts:43` `typesEqual` — `a.of.kind === b.of.kind && a.of.of === b.of.of`. On a record
  `.of.of` is `undefined`, so **two different record lists would compare equal**. Must delegate
  to a recursive type comparison instead.
- `types.ts:91` `describeType` — `` `a list of ${type.of.of}` `` would render "a list of
  undefined" in a customer-facing issue message. Needs a record case ("a list of objects").
- `types.ts:181` `scalarValueMatches` — reached only for literals; records are never literals
  (§1.3), so it must **return `false`** for a record rather than fall through.

Three further sites were checked and are **already safe**: `catalog/build.ts:432` and
`definition/catalog.ts:83` guard on `of.kind === "entity"` / `"primitive"` first, and
`runtime/compare.ts` `equals` returns `false` for anything that is not a primitive or entity —
so a record is not comparable, which is exactly §1.2's intent, with no edit needed.

**1.2 Type functions.** All in `types.ts`:
- `typesEqual` — records compare **structurally**: same field names, each field type equal.
- `canAssign` — unchanged semantics; structural equality does the work.
- `describeType` — `"an object"`, or `"a list of objects"`.
- `rendersAsText` — **`false`** for `record` and `list<record>`. An object has no reading in a
  sentence, so it can never land in a template. This is the existing guard that keeps
  `renderPart` honest, extended one kind further.
- `operatorsForType` — `record` returns **`[]`**. Records are not comparable; you reach into
  one first. (`list<record>` keeps `contains`? **No** — `equals` cannot compare records, so
  `list<record>` also returns `[]`.)
- `literalValueMatchesType` — records are never literals (§1.3), so this returns `false` for
  `record`, which is what makes a stored record literal impossible by construction.

**1.3 Where a record may appear.** Enforced, not merely documented:
- **Allowed:** a node's `outputs`; the data node's source and result; a `VariableRef` path
  walking into fields.
- **Refused:** `CatalogInput.type` — `catalog/build.ts` `validateCatalogInputs` gains a check
  rejecting a record-typed input, with the same "fails the build" posture as the table check.
  A `literal` whose `type.kind === "record"` fails `valueOrRefSchema`'s refinement.
  `template` parts and clause operands reject records via `rendersAsText` / `operatorsForType`
  returning nothing usable.

**1.4 Walking into a record.**

Definition side — `definition/catalog.ts` `walkPath` gains a record branch **before** the
entity branch:

```ts
if (current.kind === "record") {
  const next = current.fields[segment];
  if (next === undefined) return undefined;
  current = next;
  continue;
}
```

Run time — `runtime/resolve.ts` `walk` gains the mirror branch. **It never touches the
loader**: a record value carries its data inline, so there is nothing to fetch.

```ts
if (current.kind === "record") {
  const declared = /* field type from the value's own type */;
  current = fromColumn(declared, current.fields[segment]);   // absent -> nullValue()
  continue;
}
```

**A missing or mistyped field yields `null`, never an error.** This is the tolerance the
Design Decisions table calls for, and it matches `walk`'s existing "a null anywhere along the
path ends the walk as null" rule.

**1.5 The runtime value.** `runtime/types.ts` `RuntimeValue` gains:

```ts
| { kind: "record"; of: RecordType; fields: Record<string, RuntimeValue> }
```

Carrying `of` (its own type) is what lets `walk` know each field's declared type without a
catalog lookup. Note the precedent: `entity` already has an optional `row` for values the
loader cannot produce (the `before` snapshot) — records are the same idea, made a first-class
kind rather than an escape hatch.

`values.ts` gains `recordValue(type, fields)` and `fromColumn` gains a record branch that
shapes a plain JSON object into a record value, **applying `MAX_LIST_ITEMS` to nested lists**
exactly as the existing list branch does.

---

### 2. Typed integration outputs

**2.1 Reading `outputSchema`.** `packages/jobs/src/workflows/integrations/types.ts` gains the
structural shape (measured against 12 pieces / 496 actions — see the findings doc):

```ts
export interface PieceOutputField {
  key: string;
  label: string;
  value?: string;        // dotted remap path, e.g. "body.items", "start.dateTime"
  format?: string;       // datetime | number | boolean | url | email | image | filesize
  children?: readonly PieceOutputField[];   // nested object
  listItems?: readonly PieceOutputField[];  // array element shape
  labelKey?: string;
  dynamicKey?: boolean;  // keys here vary per account and cannot be enumerated
}
export interface PieceOutputSchema { fields: readonly PieceOutputField[]; itemLabel?: string }
```

**2.2 Mapping to `ValueType`.** New `integrations/outputs.ts`, sibling to `properties.ts` and
symmetrical with it:

| `outputSchema` | Carbon |
|---|---|
| `listItems` present | `list<record>` of the element's fields |
| `children` present | nested `record` |
| `format: "datetime"` | `t.date` |
| `format: "number"` | `t.number` |
| `format: "boolean"` | `t.boolean` |
| `format: url \| email \| image \| filesize`, or absent | `t.string` |
| `dynamicKey: true` | `t.string`, and the field is **omitted** from the record type |

`dynamicKey` fields are omitted deliberately: the vendor is declaring the keys are unknowable,
so inventing a field name would be the exact lie this design refuses. The raw `result` string
remains the way to reach them.

**2.3 The step's outputs.** `integrations/catalog.ts` replaces
`outputs: { result: {…string} }` with:

```ts
outputs: {
  ...toOutputTypes(action.outputSchema),   // e.g. { items: list<record>, status: number }
  count: t.number,      // number of items when the payload is a list; else 0/1
  result: t.string      // the raw JSON, unchanged — the escape hatch
}
```

`count` exists because `compare` has no "is empty" operator on lists, so "did anything come
back?" is otherwise inexpressible. `result` staying is what makes this **purely additive**:
every saved workflow referencing `result` keeps working untouched.

**2.4 Refusing an action with no schema.** `integrations/catalog.ts`:

```ts
if (action.outputSchema === undefined) {
  throw new UnmappableOutputError(pieceName, actionName);
}
```

Fails `generate:workflow-catalog`, which writes no files — identical posture to
`UnmappablePropertyError`. Documented in the "Adding a piece" checklist so it is understood as
a gate, not a bug.

**2.5 Projecting at run time.** `actions/integration.ts` `runIntegrationAction`, after
`action.run(...)`, walks each declared field's `value` path against the real response and
shapes a record value. Absent or mistyped → `null`. The vendor's raw JSON still fills
`result`. **No validation, no throwing** — a wrong schema degrades one field, it never fails a
run.

**2.6 Labels.** Record fields carry their labels **inside the type** (from `outputSchema.label`),
not through `WORKFLOW_LABELS`. This is deliberate: the check-script's per-property label gate
(`check-workflow-catalog.ts:259-267`) iterates `rebuilt.entities`, and records are not
entities, so it does not apply. The generator still emits `integration.<piece>` and step
labels as today. Vendor field names are vendor data — the same reasoning that makes custom
field names deliberately untranslated (`catalog.ts:118-121`).

---

### 3. The data node (widened `filter`)

**3.1 Schema.** `definition/schema.ts` — additive only, `formatVersion` stays **4**:

```ts
const filterNode = z.object({
  ...nodeBase,
  type: z.literal("filter"),
  data: z.object({
    source: variableRefSchema.optional(),
    combinator: combinatorSchema.default("and"),
    clauses: z.array(clauseSchema).default([]),
    operation: dataOperationSchema.default("filter"),  // NEW
    field: z.string().optional(),                      // NEW: pluck
    flatten: z.boolean().default(false)                // NEW: pluck
  })
});
```

`operation` = `filter | count | first | last | pluck | join`. **An existing saved node has no
`operation`, so it defaults to `"filter"` and behaves exactly as before** — no migration, no
format bump, no legacy alias.

**3.2 Output types** (`definition/nodes.ts`, replacing `filterLoopList`-as-outputs):

| operation | source | output `result` |
|---|---|---|
| `filter` | `list<T>` | `list<T>` (unchanged) |
| `count` | `list<T>` | `number` |
| `first` / `last` | `list<T>` | `T` |
| `pluck` | `list<record>` | `list<F>` where `F` = the field's type; **if `F` is `list<S>` and `flatten`, then `list<S>`** |
| `join` | `list<primitive>` | `string` |

`loopList` returns the source list for `filter` only — the other operations do not expose a
loop item, because clauses only apply to `filter`. This keeps `ItemRef` meaning exactly one
thing.

**Why `flatten` is a flag:** `pluck("attendees")` over `list<event>` would logically produce
`list<list<attendee>>`, which is unrepresentable. With `flatten` it yields `list<attendee>`
directly — the 2D value is never materialised. Default **true** in the builder for a
list-typed field, since the flat result is nearly always what is wanted.

**3.3 Validation.** `checkTypes` becomes per-operation: `filter` requires a list source and
checks clauses; `pluck` requires `list<record>` and a `field` naming a real field on it;
`join` requires a list of primitives. `checkConfig` reports a missing `field` for `pluck`.
`configured` stays `true` (a filter has no catalog entry to be missing).

**3.4 Runtime.** `runtime/filter.ts` gains a switch on `operation`, defaulting to today's
path. `permission` stays `() => undefined`.

**3.5 UI.** `FilterForm.tsx` gains an operation selector; clause rows render only for
`filter`; a field selector renders for `pluck` (populated from the source record's fields, so
it is a dropdown, not free text). The source picker widens from list-typed variables only to
also accept `record` and `list<record>`. `meta.ts` label becomes "Data" with the summary
reflecting the operation; the node type id stays `filter`.

---

### 4. Form control — three tiers

**Tier 1 — generic rules, no per-action data**, in `integrations/catalog.ts`:
- required **and** has a `defaultValue` → not emitted; the piece's default applies.
- exactly one possible value → not emitted.
- `connectionId` when the company has exactly one connection → auto-selected and hidden by the
  form. It is **still stored on the node and still a required input the validator checks** — a
  second connection added later must never silently repoint existing workflows. Zero
  connections keeps today's "Connect …" panel; two or more shows the field.

**Tier 2 — a reviewed hide list**, one entry per allowlisted piece, written when the piece is
allowlisted (already a human-gated step):

```ts
"google-calendar": {
  …,
  props: {
    google_calendar_get_events: {
      singleEvents: { hidden: true, value: true },   // vendor default is wrong for us
      event_types:  { hidden: true }                 // use the piece's own default
    }
  }
}
```

`value` is applied in `toPropsValue` **at run time**, never stored on the node. A hidden
required prop with **no** `value` and no piece default **fails the generator**.

**Tier 3 — Advanced properties**, a collapsed section on the integration node form showing
every hidden field, **editable**. This is what makes tiers 1–2 safe: a hidden field is
demoted, never lost, so being wrong about a hide decision costs a click rather than a release.
An override stored on the node wins over a tier-2 pinned value for that node only.

**`calendar_id` stays visible**, defaulting to the primary calendar. It is a genuine business
choice on a shared workshop account. "All calendars" is deliberately not offered:
`get_events` hits `/calendars/{id}/events` for exactly one id, so "all" means N fanned-out
calls plus every subscribed holiday calendar.

---

### 5. Two traced bugs

Auth shape is **not** the problem — invoking the real options function reached Google and
returned a genuine 401 on a fake token, so the call path is correct end to end.

**5.1 A vendor error renders as "no options."** The piece's `options()` throws on any non-2xx;
`api+/workflows.options.ts` flattens that to `{ options: [], error }`; `OptionsField` then
renders an empty `Combobox` (the `emptyHref` branch does not apply to the property provider),
which reads as "this account has no calendars." `issue ?? error` also lets a field issue mask
the error entirely.
**Fix:** render a distinct error state, and never let `issue` suppress `error`.

**5.2 The fetch never retries.** `useWorkflowOptions` loads only when
`fetcher.state === "idle" && fetcher.data === undefined`, so it fires **once**. A failed first
load leaves `fetcher.data` set, so the field is **permanently stuck empty** for the rest of
the editing session. This is almost certainly the reported regression.
**Fix:** key the guard on the query rather than on `data` being undefined, and allow a retry
after a failure.

## Data Model Changes

**None.** No tables, no columns, no migrations. Every change is to committed catalog files and
in-memory types. `integrationConnection` and the vault RPCs are untouched.

## API / Service Changes

| File | Change |
|---|---|
| `packages/workflows/src/definition/types.ts` | Add `record` kind, `t.record`, and record cases in `typesEqual`/`canAssign`/`describeType`/`rendersAsText`/`operatorsForType`/`literalValueMatchesType` |
| `packages/workflows/src/definition/catalog.ts` | `walkPath` record branch |
| `packages/workflows/src/definition/schema.ts` | `filterNode.data` gains `operation`/`field`/`flatten` |
| `packages/workflows/src/definition/nodes.ts` | Per-operation `outputs`/`loopList`/`checkTypes`/`checkConfig` for filter |
| `packages/workflows/src/runtime/types.ts` | `RuntimeValue` gains `record` |
| `packages/workflows/src/runtime/values.ts` | `recordValue`, `fromColumn` record branch (with `MAX_LIST_ITEMS`) |
| `packages/workflows/src/runtime/resolve.ts` | `walk` record branch (no loader) |
| `packages/workflows/src/runtime/filter.ts` | Switch on `operation` |
| `packages/workflows/src/catalog/build.ts` | Reject a record-typed `CatalogInput` |
| `packages/jobs/src/workflows/integrations/types.ts` | `PieceOutputSchema` shapes |
| `packages/jobs/src/workflows/integrations/outputs.ts` | **New** — `outputSchema` → `ValueType` |
| `packages/jobs/src/workflows/integrations/catalog.ts` | Typed outputs, `count`, `UnmappableOutputError`, tier-1/2 prop filtering |
| `packages/jobs/src/workflows/integrations/allowlist.ts` | `props` hide-list per action |
| `packages/jobs/src/workflows/integrations/properties.ts` | `toPropsValue` applies pinned values |
| `packages/jobs/src/workflows/actions/integration.ts` | Project the response into record outputs |

## UI Changes

| File | Change |
|---|---|
| `.../Builder/config/forms/FilterForm.tsx` | Operation selector; clauses only for `filter`; field selector for `pluck`; source accepts records |
| `.../Builder/config/forms/IntegrationNodeForm.tsx` | Auto-hide single connection; **Advanced properties** section |
| `.../Builder/fields/OptionsField.tsx` | Distinct error state (bug 5.1) |
| `.../Builder/fields/useWorkflowOptions.ts` | Refetch on query change, retry after failure (bug 5.2) |
| `.../Builder/fields/variableMenu.ts` | Walk into record fields, using labels carried on the type |
| `.../Builder/labelKeys.ts` | `describeValueType` renders records; `outputLabel` handles `count`/`items` |
| `.../Builder/nodes/meta.ts` | Filter node renamed to "Data" in the palette (type id unchanged) |

## Acceptance Criteria

- [ ] Dropping a Google Calendar "Get all Events" step and opening the variable picker shows
      named fields (Title, Start, Organizer → Email), not a single `result` text variable.
- [x] `pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog` both pass, and
      the committed catalog contains `list<record>` outputs for both allowlisted actions.
- [x] Allowlisting an action whose piece ships no `outputSchema` fails the generator with a
      message naming the piece and action, and writes no files.
- [x] A data node with `operation: "count"` on the events list outputs a number, and a
      condition can branch on `count > 0`.
- [x] A data node with `operation: "pluck"`, `field: "organizer.email"` outputs
      `list<string>`; with a list-typed field and `flatten`, it outputs a flat list, not a
      list of lists.
- [x] An existing saved workflow containing a filter node loads, validates and runs unchanged,
      with `operation` absent from its stored data.
- [x] A workflow referencing `result` on an integration step still publishes and runs.
- [x] `singleEvents` and `event_types` do not appear on the Get-all-Events form; the step still
      sends `singleEvents: true`, verified by the recorded step inputs.
- [ ] Opening **Advanced properties** reveals `singleEvents`, editable; setting it to `false`
      on one node affects only that node.
- [ ] With exactly one Google connection, the Connection field is not rendered but the node
      still stores its `connectionId`; adding a second connection makes the field appear with
      the original still selected.
- [ ] When the calendar options call fails, the field shows an error state distinct from
      "nothing to choose", and a retry succeeds without reloading the page.
- [x] A record-typed value cannot be selected into an action input, a template, or a condition
      operand anywhere in the builder.
- [x] A declared field missing from a vendor response resolves to null at run time; the step
      succeeds and the run log shows the null rather than an error.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `record` touches the core type model used by every node | High | Scoped to outputs + data node; refused as input/literal/template/condition by construction. Existing paths never see a record. |
| Widening a shipped node type breaks saved workflows | Med | `operation` defaults to `"filter"`; absent field = today's behaviour. No format bump, no migration. Covered by an acceptance criterion. |
| `outputSchema` is unvalidated and may not match reality | Med | Authoring-time only; tolerant run-time resolution (null, never throw); raw `result` retained as escape hatch. No platform surveyed does better. |
| Losing pieces with no `outputSchema` (HubSpot, Salesforce, …) | Med | Accepted: OAuth verification already gates us to few vendors. Failing loudly at build beats a silent blob. Upstreaming schemas is a cheap future option. |
| A hidden field turns out to be needed | Low | Tier 3 Advanced shows every hidden field, editable — a click, not a release. |
| Pinned values drifting from vendor behaviour | Low | Applied at run time, never stored, so one edit fixes every existing workflow. |
| `record` in run history renders as a blob | Low | Verify during implementation; falls back to the raw JSON view we already show. |

## Open Questions

> All resolved before this spec was written.

- [x] Should an integration's returned object reuse `entity`? — **Answer:** No. Entity means
      table + id + permission + loader + `lookup` support, none of which is true of vendor
      data; reusing it would force a lie or a special case at each. Add a `record` kind
      instead. (User correction — an earlier draft of this design proposed "synthetic
      entities" and was wrong.)
- [x] Structural or named records? — **Answer:** Structural, fields inline. No registry, no
      names to resolve, nesting is free, and a saved workflow can never dangle against a
      vanished definition. Accepts deeper equality and larger types.
- [x] Where may a record appear? — **Answer:** Outputs and the data node only; never a catalog
      input, stored literal, template part or condition operand. Keeps every existing form and
      the template renderer untouched.
- [x] Widen `filter`, add a new node, or rename with a migration? — **Answer:** Widen in place
      with an `operation` field defaulting to `"filter"`. One loop primitive, one `ItemRef`
      meaning, zero migration risk on published workflows.
- [x] What happens to an action with no `outputSchema`? — **Answer:** Refuse it and fail the
      generator, matching `UnmappablePropertyError`. Caught when adding a piece, never by a
      customer.
- [x] What permission should the data node carry? — **Answer:** None, as today. It reads
      values already fetched by an upstream node that did its own check; records carry no
      `permission`, so `lookup` can never target them.

## Changelog

- 2026-08-31: Created. Design decisions carried from `.ai/research/activepieces-decisions.md`;
  evidence from `.ai/research/activepieces-integration-findings.md` (four-platform survey plus
  measurements across 12 pieces / 496 actions).
