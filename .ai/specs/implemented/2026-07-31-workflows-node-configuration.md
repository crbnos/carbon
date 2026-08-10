# Workflows — Node Configuration, Variables and Type Safety

> Status: draft
> Author: aashu
> Date: 2026-07-31
> Phase brief: `/Users/aashu/work/carbon/plans/automations-engine/phases/phase-8-node-configuration.md`
> Research: `.ai/research/2026-07-31-workflows-node-configuration.md` (729 lines, 125 cited sources)
> Predecessor: `.ai/specs/2026-07-31-workflows-builder-canvas.md` (phase 7)

## TLDR

Phase 7 shipped a canvas where every node renders `Not configured yet`. This spec fills that
gap: a configuration panel beside the canvas, one form per node kind rendered from the
catalogs rather than hand-built per entry, a variable picker that knows which typed values
exist at that point in the graph, and enough type-awareness in the pickers that a customer
cannot assemble something Publish would later refuse. It also does the catalog groundwork
those forms need — human labels for every action input and record property, and the list of
allowed values for every field that has one — because without it the forms render raw
database column names and free-text boxes over enums.

Whole-workflow checking stays where it is today: at Publish. Safety comes from *prevention at
the point of choosing*, not from re-running the validator on every keystroke.

## Problem Statement

`packages/workflows` already contains the entire back half of this feature — the node schema,
the seven-layer validator, the runtime executors, the type system, the operator sets, batch
planning, and a committed catalog of 106 events, 16 actions, 15 operations and property maps
for 16 record types. `apps/erp/app/modules/workflows/ui/Builder/` already contains a working
canvas: six node kinds, handles derived from the same function the validator uses, cycle
prevention at connection time, versioning, publishing and autosave.

What does not exist is any way to *say what a node should do*. Concretely, today:

- Every node body renders `<Trans>Not configured yet</Trans>`
  (`ui/Builder/nodes/WorkflowNodeCard.tsx:71`). There is no control of any kind.
- There is no way to name a variable. `variableRefSchema` (`definition/types.ts:82`) is the
  storage shape and nothing writes it.
- `availableVariables(definition, nodeId, catalog)` does not exist; the resolver internals are
  private to `validate.ts`. Phase 7 recorded this as phase 8's job.
- The catalog carries no human label for an action input or a record property. A form built
  from it today would show `supplierReference`, `aboutType`, `salesOrderLineId`.
- The catalog carries no list of allowed values. `job.priority` and `job.deadlineType` are
  enums in the database; a form built from the catalog renders a free-text box, and the
  customer discovers the mistake when the run fails inside
  `packages/jobs/src/workflows/actions/update.ts`.
- Several inputs are record references (`assignee`, `supplierId`, `locationId`). Without a
  picker the customer would have to paste a database id.

The result is a builder that can draw a workflow and can never make one do anything.

## Goals

- A working configuration form for all six node kinds, driven by catalog data so that adding a
  seventeenth action or a hundred-and-seventh event needs no front-end change.
- A variable picker that answers "what can I use here", with types, optionality and a
  dot-walk into record properties.
- Enough type-awareness in the pickers that the common mistakes are unrepresentable rather
  than rejected later.
- Batch mode reachable and discoverable, with success and failure handles wired as real paths.
- Publish-time problems anchored to the field that caused them, not just the node.

## Non-Goals

- **Run history, step detail, live run streaming** — phase 9. Nothing here reads
  `workflowRun` or `workflowStepRun`.
- **Re-running the whole-workflow validator on every edit.** Explicitly decided against; see
  Design Decisions.
- **A severity split on `WorkflowIssue`.** Follows from the above — every issue stays fatal,
  and `issues.ts` is unchanged.
- **New node kinds, new actions, new operations, new events.** The catalogs are what they are.
- **Nested condition groups.** The stored shape is one combinator per path over a flat clause
  list and stays that way; see Design Decisions.
- **An expression language.** Structured references only, per the PRD and the technical
  document.
- **Auto-layout, undo, run preview.** Not in this phase; undo's absence is a recorded phase-7
  decision.

## Proposed Solution

Seven pieces, in dependency order. A–B are shared-package and generator work; C–G are the ERP
front end.

### A. Catalog groundwork — labels and allowed values

Two things the forms cannot be built without, both produced by the existing generator
(`scripts/generate-workflow-catalog.ts` → `buildCatalog`) and landing in the existing
committed artifacts.

**A1 — Labels for every input and every property.** `labels.generated.ts` today holds 137
`msg``` descriptors, keyed by event, action and operation id. It gains three more key
families:

```
entity.<name>                        "Purchase order"
entity.<name>.<column>               "Supplier reference"
action.<id>.input.<name>             "Supplier"
operation.<id>.input.<name>          "Job"
```

The string is the hand-written label where one exists — `WORKFLOW_ACTIONS` already declares
`label` on every input (`catalog/actions.ts:31`), and the registry's `watch`/`write` maps
declare one per curated column — and is otherwise **derived from the column name at generation
time**: split camelCase, drop a trailing `Id`, sentence-case. `supplierReference` becomes
`Supplier reference`; `nonConformanceTypeId` becomes `Non conformance type`.

Derivation happens in the generator, not the browser, so every label is still a committed
`msg` descriptor and therefore translatable. That is the point: a label invented at render
time can never be translated, and this product ships in 13 languages.

Scale: roughly 600 new descriptors. `WORKFLOW_LABELS` grows from ~137 to ~740 entries and the
`.po` files grow correspondingly. `pnpm run lingui:extract && pnpm run lingui:clean` after
regenerating, per `workflow-event-catalog.md`.

**A2 — Allowed values.** `CatalogInput` gains an optional `choices?: string[]`, and
`WorkflowCatalog` gains `getEnum(entity: string, property: string): string[] | undefined`.
Both are populated by `buildCatalog` from the `enum` already present on the injected
`packages/database/src/swagger-docs-schema.ts` — the same source
`packages/jobs/src/workflows/actions/update.ts:2,108` validates against at run time, so the
builder and the executor cannot disagree about what is allowed.

`createFixtureCatalog` gains the same method so the validator's tests keep compiling, and
`validateDefinition` gains one check: a `literal` string value bound to an input or a lookup
match field that declares choices must be one of them (`INCOMPLETE_CONFIG`). The builder
prevents it; the validator is the backstop for anything saved by an older client.

**A3 — Build checks.** `scripts/check-workflow-catalog.ts` already compares committed data to
a fresh build and already reads the label file as text. Both extend to the new key families:
every action input, operation input and entity property must have a label entry, and a label
entry with no corresponding catalog member is a failure. This is the check that catches a
migration renaming a column and silently orphaning its label.

### B. `availableVariables` — the one new shared export

```ts
// packages/workflows/src/definition/variables.ts
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

It reuses the ancestor walk and context construction currently private to `validate.ts`
(`createContext`, `ancestorsOf`) — those move into this module and `validate.ts` imports them,
so there is exactly one definition of "what is upstream of this node" and the picker cannot
offer something the validator would reject as `REF_NOT_UPSTREAM`.

`guaranteed` is computed as graph dominance: a node is guaranteed when every path from the
trigger to the target passes through it. It is advisory — the validator does not read it —
and the picker uses it to mark a variable "may be empty on this path".

Drilling into properties is `walkPath` (`definition/catalog.ts:64`), which already exists and
already returns `undefined` for a path that does not resolve. The picker bounds the walk at
**two entity hops**: `record` → `record.supplierId` → `record.supplierId.name` and stop. The
cap is a picker rule only; the stored `path` array is unchanged and the runtime already
resolves arbitrary depth.

Two pseudo-variables the picker offers that are not upstream nodes:

- **The current item**, offered only inside a node that loops — a filter node's clauses and a
  batch-mode action's inputs. Stored as `{kind: "item", path}`, which the validator already
  rejects outside a loop (`ITEM_OUTSIDE_LOOP`).
- **Now** and **the workflow's owner**, per the PRD's "a few values are always available".
  These resolve at run time and need no upstream node.

### C. Where configuration lives — a panel beside the canvas

**This reverses a phase-7 decision.** That spec recorded "There is no right-hand inspector — a
node's fields live on the node". Building the forms is what makes the reasoning visible: a
condition node with three paths of three clauses is roughly 400px of controls that must sit
inside a card the customer is zooming and panning, with every combobox portalled out of a
transformed container to avoid clipping. Every mature builder surveyed — Zapier, n8n, Make,
Salesforce Flow, Power Automate — puts configuration in a panel or a modal, and none puts it
on the node.

Layout follows `apps/erp/app/components/DocumentTemplateEditor/index.tsx:98-140` exactly:
a `ResizablePanelGroup` with `autoSaveId`, the existing `NodePalette` rail, the canvas, and a
new right panel wrapped in `ScrollArea`. The panel reads `selectedNodeId` from the store that
already tracks it (`ui/Builder/store.ts:148`) and shows an empty state when nothing is
selected. It is hidden entirely when `isReadOnly` (a live version).

The phase-7 key handler already guards this: `WorkflowBuilder.tsx:24-79` captures
`onKeyDownCapture` and skips events targeting inputs and portalled overlays, so Delete inside
a text field no longer deletes the node.

**The node card keeps a plain-English summary.** `NODE_KIND_META.summary` already exists as a
hook (`nodes/meta.ts:26`) and currently returns counts like `2 paths`. It is rewritten per kind
to produce a sentence — "When a purchase order's total changes", "If total is over 10,000",
"Notify the buyer's manager" — so a workflow is readable without opening anything. This is the
single reason to keep a canvas at all.

**Per-kind rendering without breaking the module rule.** `apps/erp/app/modules/workflows/AGENTS.md`
says "Never add a per-kind component or a second per-kind lookup." The forms genuinely differ
per kind, so the rule is honoured in shape rather than abandoned: one exhaustive
`Record<WorkflowNodeType, ComponentType<NodeFormProps>>` living beside the existing `nodeTypes`
record, so a missing kind is a `TS2741` compile error — the same guarantee, and the same idiom
`.ai/lessons.md` recommends over N switches. AGENTS.md is updated to say so in the same PR.

### D. Two field archetypes, and nothing else

Every configurable value is one of exactly two widgets. There is no expression mode, no
fixed/expression toggle, and no third state.

**D1 — Value field (the default).** The field holds *either* a literal *or* a single variable
reference, never both. In literal state it renders the control for its type (below). In
variable state it renders a full-width chip reading `Node name › property path › type`, with an
`×` that clears back to literal. Clicking the chip reopens the picker positioned at that
variable, because re-pointing a reference is something customers do constantly.

Control by `ValueType`, in literal state:

| Type | Control | Notes |
|---|---|---|
| `string` | `Input`, or `Select` when `choices` is present | choices come from A2 |
| `number` | `Number` | |
| `boolean` | `Boolean` switch | |
| `date` | `DatePicker` | |
| `entity(<name>)` | the record picker for that type (E) | |
| `list<T>` | no literal state — variable only | a customer cannot type a list |
| `null` | not offered as a literal | |

**D2 — Template field (opt-in, prose only).** Used by exactly three inputs today:
`notify.subject`, `notify.message` and `webhook.body`. Text and variable chips interleave.
Stored as `{kind: "template", parts}`, which `runtime/template.ts` already renders — only the
editor is missing.

Built on `@carbon/tiptap`, whose `createMentionExtension` factory
(`packages/tiptap/src/extensions/mention.tsx:147`) already exists and has no callers. Chips are
atomic nodes, so backspace removes a whole variable in one keystroke. Hand-rolling this over
`contenteditable` is the documented trap — the research file collects the TinyMCE, Mozilla,
Froala and Lexical bug threads for it.

A field is a template field when the catalog says so. `CatalogInput` gains
`template?: boolean`, set on those three inputs in the hand-written catalog. Everything else is
a value field. This is Make's `mappable: false` precedent inverted: the schema decides the
widget, not the customer.

### E. Record pickers — reuse Carbon's own

An `entity(<name>)` value in literal state renders the domain selector the rest of the ERP
already uses, through one hand-written map:

```ts
// apps/erp/app/modules/workflows/ui/Builder/fields/recordPickers.ts
const RECORD_PICKERS: Partial<Record<string, ComponentType<RecordPickerProps>>> = {
  customer: Customer, supplier: Supplier, item: Item, user: Employee,
  location: Location, group: /* role picker */, /* … */
};
```

Those selectors come from `~/components/Form` (`apps/erp/app/components/Form/index.ts`), are
already company-scoped, already cached, and already look like the rest of Carbon. A record
type with no selector falls back to a plain search box; the map is `Partial` on purpose so a
new registry entity degrades rather than crashes.

The builder runs as the person editing it, who is also the workflow's owner, so what the
selectors show is already what the owner may see — which is the PRD's "the builder can't be
used to discover data" without extra work.

**The Notify `about` special case.** `notify` stores its subject record as two loose strings,
`aboutId` and `aboutType`, because the value model has no "any record" type
(`catalog/actions.ts:110`). Rendered literally that is two text boxes over a database id. The
form instead shows one *about* field — pick a record type, then pick or wire the record — and
writes both inputs behind it. This is the only hand-written deviation from catalog-driven
rendering in the whole phase, and it is commented as such at the call site so it does not read
as a pattern to copy.

### F. Prevention, not live validation

Whole-workflow checking stays at Publish, exactly as today. Nothing re-runs `validateDefinition`
on keystrokes and `WorkflowIssue` gains no severity field. Safety comes from the pickers
refusing to offer the wrong thing:

1. **Operators are keyed off the left operand's type** —
   `operatorsForType(type)` (`definition/types.ts:75`) is the single source, shared with the
   runtime. The operator control is disabled until a left operand is chosen, and changing the
   left operand patches the operator down to a legal one and clears the value. That
   self-healing behaviour is copied from `storage-rules/ui/ConditionRow.tsx:127-131`.
2. **The variable picker soft-filters by the target type.** Compatible variables are listed
   normally; incompatible ones stay visible but disabled, each with a one-line reason — "this
   is a list of jobs; this field takes one job". Hiding them outright is what produces the
   "where did my option go" complaint that dominates Power Automate's picker feedback, and the
   greyed row doubles as how batch mode is discovered.
3. **Entity comparisons require matching record types.** A job cannot be compared to a purchase
   order; `typesEqual` already says so and the picker enforces it up front.
4. **The action and operation lists rank rather than filter.** An action whose required record
   type is not available upstream sorts below the rest and carries the same one-line reason.
   Filtering "what a purchase order can become" is the thing n8n's own source carries a TODO
   admitting it got wrong; filtering "what accepts a purchase order" is safe, and that is what
   the field-level pickers do.
5. **No coercion, anywhere.** No convert-if-needed toggle. n8n ships one and its users still
   hit the type errors it was meant to fix.

Publish still runs the full validator, and this phase makes its output land better:
`WorkflowIssue.field` is already a dotted path (`issues.ts:32`) that nothing resolves. The panel
now resolves it to a control and marks that control, and the existing `IssuesPanel` entry
scrolls the panel to it.

### G. Batch mode, handles, names and deletion

**Batch mode is offered, never applied.** Wiring a `list<T>` into an input that takes a single
`T` puts an inline message on the field — "'Open POs' is a list of jobs; this field takes one
job" — with a button that turns batch mode on. The toggle also lives plainly on the action
node's form. It never switches itself: Power Automate's silent auto-loop is the single
most-complained-about behaviour in that product, and the complaint is precisely that it is
silent and hard to undo, not that it is wrong.

The validator's existing rule is unchanged — exactly one input may resolve to a list in batch
mode — and the form surfaces it as a reason on the other list-typed fields once one is chosen.

**Success and failure handles.** Both are already drawn for action and lookup nodes
(`definition/nodes.ts:346`, `:467`). What is new is a warning on the node card when a fallible
node's `failure` handle has no outgoing edge — "nothing happens if this fails". No surveyed
product does this, and it costs one edge lookup. It is a card affordance, not a
`WorkflowIssue`, so it cannot block Publish.

**Node names.** `nodeBase` in `definition/schema.ts` gains `title: z.string().optional()`,
alongside `id` and `position`. Optional, so every stored definition still parses and
`CURRENT_DEFINITION_FORMAT_VERSION` stays **2** — no migration, no normaliser change. The panel
shows an editable name seeded from the derived summary; the variable picker groups by it. A
workflow with three lookups is otherwise a picker reading "Find / Find / Find".

**Deleting a referenced node.** Deleting a node that later nodes read from asks first — "3
later steps use this step" — and on confirm deletes it and marks the affected fields broken so
they are findable. Nothing is silently rewritten and the customer is never trapped by a refusal.
Publish already catches the dangling reference as `UNKNOWN_VARIABLE`; this makes it visible
immediately.

### The six forms

Each is rendered from catalog data. None hard-codes an entry.

| Kind | Form | Handles |
|---|---|---|
| **Trigger** | Event multi-select over `WORKFLOW_EVENTS` grouped by record type and by "business moments", each labelled from `WORKFLOW_LABELS`; the origin filter as three choices (people / workflows / both); a schedule editor (frequency, time, weekdays or day-of-month including "last", time zone defaulting to the browser's) shown only when the trigger is scheduled. Events and schedule are mutually exclusive — the validator already says so. Multi-event triggers show which outputs survive the intersection (`nodes.ts:234`), because that is otherwise invisible. | one |
| **Condition** | Ordered paths: one `if`, any number of `else if`, one `else`. Each path is a combinator (`and`/`or`) plus a flat clause list; each clause is left value field / operator / right value field, laid out on the `storage-rules` three-column grid. Paths reorder and delete; the `else` is fixed last. | one per path |
| **Entity** | Operation picked from `WORKFLOW_OPERATION_CATALOG`, grouped by record type; then one value field per declared input, labelled from A1. The output type is shown so the customer knows what they are getting. | one |
| **Lookup** | Record type from the registry; returns one or a list; match rows of column / operator / value, columns labelled from A1 and typed from the property map, values restricted by `getEnum` where applicable. | success, failure |
| **Filter** | Source list picked from the variable picker, restricted to `list<T>` variables; then clauses over the current item, with the item pseudo-variable offered as the left operand. | one |
| **Action** | Action from `WORKFLOW_ACTION_CATALOG`, ranked as in F4; then one field per input from the catalog, required ones first, with `requireOneOf` groups rendered as a single either/or block (Notify's person-or-role) rather than two independently-optional fields. Batch toggle. | success, failure |

## Data Model Changes

**None.** No migration, no new table, no new column. The one stored-shape change is
`title?: string` on the node base inside the existing `nodes` JSONB column, which is optional
and therefore backward-compatible; `CURRENT_DEFINITION_FORMAT_VERSION` stays 2.

## API / Service Changes

**No new routes and no change to the save path.** The panel edits the same zustand store the
canvas edits, and `ui/Builder/Autosave.tsx` posts the whole definition to the existing
`$id.save.tsx` on its existing 1s debounce. Phase 7 built this seam deliberately.

Shared package (`packages/workflows`):

- `definition/variables.ts` — new; exports `availableVariables` and `AvailableVariable`.
  `createContext` / `ancestorsOf` move here from `validate.ts`.
- `definition/catalog.ts` — `CatalogInput` gains `choices?: string[]` and `template?: boolean`;
  `WorkflowCatalog` gains `getEnum`; `createFixtureCatalog` implements it.
- `definition/schema.ts` — `title` on the node base.
- `definition/validate.ts` — one added check: a literal bound to a field with `choices` must be
  one of them.
- `catalog/build.ts` — emits the new label families and the enum data.
- `catalog/*.generated.ts` — regenerated, committed.
- `scripts/check-workflow-catalog.ts` — covers the new label families.

ERP (`apps/erp/app/modules/workflows/ui/Builder/`): a new `panel/` directory holding the panel
shell, the six forms and the shared field controls; `fields/` for the value field, template
field, variable picker and record-picker map; `nodes/meta.ts` gains real summaries.

## UI Changes

- `WorkflowBuilder.tsx` becomes a three-panel `ResizablePanelGroup` (palette rail, canvas,
  config panel).
- Node cards render a plain-English summary in place of `Not configured yet`, and show a
  warning when a fallible node has no failure path.
- New: configuration panel, six node forms, value field, template field, variable picker,
  record pickers, clause row, schedule editor.

## Acceptance Criteria

- [ ] Selecting a node opens its form in the right panel; deselecting shows an empty state; the
      panel does not render on a live (read-only) version.
- [ ] A trigger node can be set to "A purchase order's status changes" with origin "people
      only", and the canvas card reads "When a purchase order's status changes".
- [ ] A scheduled trigger can be set to "the last day of the month at 09:00, Asia/Kolkata", and
      the form refuses to also carry event ids.
- [ ] In a condition clause, choosing `record.orderTotal` (a number) offers exactly
      `=, ≠, >, ≥, <, ≤` and no `contains`; switching the left operand to `record.status` (a
      string) replaces the operator with a legal one and clears the value.
- [ ] The PRD's crossing case is buildable end to end: a condition with two clauses,
      `record.orderTotal > 10000` AND `before.orderTotal <= 10000`, publishes cleanly.
- [ ] The variable picker groups by producing node, shows each variable's type, drills two
      entity hops and no further, and marks a variable on a condition branch "may be empty on
      this path".
- [ ] Wiring a `list<job>` into an action input that takes one `job` shows a reason and a
      button; pressing it turns on batch mode and the field becomes valid. Nothing enables
      batch mode on its own.
- [ ] A `<entity>.update` action on a job offers `priority` as a dropdown of the database's
      allowed values, not a text box, and a value outside that list cannot be chosen.
- [ ] An `assignee` input renders Carbon's employee picker, and the chosen person is stored as
      an entity literal.
- [ ] A Notify action shows one "about" field, one either/or person-or-role block, and a
      message body where a variable inserts as a chip that backspace deletes whole.
- [ ] Renaming a lookup node to "Open POs for this supplier" changes its group heading in every
      downstream variable picker.
- [ ] Deleting a node two later nodes read from warns with the count, and on confirm the two
      affected fields are marked broken.
- [ ] Publishing an incomplete workflow lists the issues as it does today, and clicking one
      opens the owning node's panel scrolled to the offending control.
- [ ] `pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog` passes, and the
      check fails when a label entry is removed for a column that still exists.
- [ ] `pnpm exec turbo run typecheck --filter=erp`, `--filter=@carbon/workflows`,
      `pnpm exec biome check` on the touched paths, and the `packages/workflows` vitest suite
      all pass.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| ~600 new translatable strings churn every `.po` file across 13 locales | Medium | Run `lingui:extract` then `lingui:clean` (which strips origin refs); the `/translate` skill fills the other 12 locales. Reviewed as a generated diff, like the catalog itself |
| `apps/erp` targets ES2019 and compiles package source; new shared code can break the app typecheck while the package's own passes | High | Recorded lesson. Run `--filter=erp` after every `packages/workflows` change, not just the package's own typecheck |
| New type surface tips `apps/erp` into TS2589 in unrelated files | Medium | Recorded lesson. Prefer flat selects, verify with direct `tsgo` rather than a cached turbo run |
| Reversing phase 7's "no inspector" decision leaves two specs disagreeing | Medium | Update the phase-7 spec and the module AGENTS.md in the same PR; `keep-sources-in-sync.md` requires it |
| A TipTap chip editor is the fiddliest single item here | Medium | The mention factory already exists and is unused; chips are atomic nodes so the `contenteditable` deletion traps do not apply. Scoped to three inputs |
| Deriving ~500 property labels mechanically produces some awkward English | Low | The registry's hand-written label wins wherever it exists, and adding one is a one-line registry edit that the generator picks up |
| The panel and the canvas competing for keyboard events | Low | Phase 7 already ships the capture-phase guard for inputs and portalled overlays |

## Open Questions

> Resolved with the user on 2026-07-31, before this spec was written. Audit trail.

- [x] Where should a node's configuration fields live? — **Answer:** a resizable right-hand
      panel, the `DocumentTemplateEditor` idiom. Explicitly reverses phase 7's "fields live on
      the node"; a condition node's controls do not fit on a card inside a zooming canvas, and
      no surveyed product does it that way.
- [x] How should inputs and properties be labelled, given the catalog has none? — **Answer:**
      extend the generator so every label is a committed, translatable descriptor.
- [x] How far should the property-label work go, given ~500 uncurated columns? — **Answer:**
      generate for all of them; hand-written where the registry has one, derived from the
      column name at build time otherwise. Accepts a ~600-string translation diff in exchange
      for a picker that never shows a raw column name and is fully translatable.
- [x] Should v1 support text mixing prose and variables? — **Answer:** yes, chip-based, on
      `@carbon/tiptap`. The stored shape and the runtime renderer already exist; only the
      editor was missing, and a notification that cannot name its record is not much of a
      notification.
- [x] What should a picker do with entries that do not fit what is wired in? — **Answer:** show
      them, disabled, each with a one-line reason. Hard-filtering makes a missing option
      unexplainable, and the greyed row is how batch mode gets discovered.
- [x] How does a customer pick a specific record as a value? — **Answer:** reuse Carbon's
      existing domain selectors through one map, with a generic search fallback for record
      types that have none.
- [x] Can customers name their nodes? — **Answer:** yes — auto-named from configuration,
      editable. Otherwise the variable picker reads "Find / Find / Find". Costs one optional
      `title` on the node base, no format bump.
- [x] Should the whole workflow be re-checked while drawing? — **Answer:** no. Checking stays
      at Publish; safety comes from prevention at the picker. `WorkflowIssue` gains no severity
      and `issues.ts` is untouched.
- [x] Did that mean no type-awareness at all, or prevention at the point of choosing? —
      **Answer:** prevention at the picker — type-appropriate operators only, incompatible
      variables greyed with a reason, no list into a single-record field without batch mode.
      The phase brief's requirement, with no shared-package change.
- [x] What happens when a list is wired into a single-record field? — **Answer:** offer batch
      mode in one click; never apply it automatically. Silent auto-loop is Power Automate's
      most-complained-about behaviour.
- [x] Which upstream variables does the picker show? — **Answer:** all of them, with those on a
      branch that need not have run marked "may be empty on this path". Matches what the
      validator permits, so the two cannot disagree.
- [x] How deep may a dot-walk go? — **Answer:** two entity hops. Covers every example in the
      requirements, bounds the reads one value can cost, and is explainable in a sentence.
- [x] What happens when a customer deletes a node others reference? — **Answer:** warn with the
      count, then delete and mark the affected fields broken. Never silently rewrite, never
      trap the customer behind a refusal.
- [x] One spec or two? — **Answer:** one. The picker, the type rules and the forms are the same
      machinery seen from three angles; splitting them means building half a picker twice. The
      plan stages the groundwork so it lands verifiable before the forms.
- [x] What does the node card show now that fields live in a panel? — **Answer:** a
      plain-English summary sentence per kind. A canvas nobody can read at a glance is not
      worth having.
- [x] What should the Notify action's `about` pair render as? — **Answer:** one combined
      record-type-then-record picker writing both stored fields. The only hand-written
      deviation from catalog-driven rendering, and commented as such.

## Changelog

- 2026-07-31: Created. All 16 open questions resolved with the user before writing; research
  in `.ai/research/2026-07-31-workflows-node-configuration.md`.
