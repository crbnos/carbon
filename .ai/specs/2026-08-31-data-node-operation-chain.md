# Data node operation chain

**Status:** Approved (pending user sign-off)
**Date:** 2026-08-31
**Research:** N/A — internal composition of an existing node. External precedent
(Zapier's Formatter chains, n8n's item pipelines) confirms the pattern of piping
one transform into the next inside a single step, but settles no decision the
codebase does not already settle.

## Problem

The data node (`type: "filter"`) performs exactly ONE operation on its source
list — filter, count, first, last, pluck, or join. Real flows need several in
sequence: "keep the matching events, take each one's organizer, count them"
today requires three chained data nodes on the canvas, each re-picking the
previous node's output as its source. That is three cards of canvas noise for
one logical transformation, and the wiring is the author's job instead of the
node's.

## Goal

One data node holds an ordered **chain of operation cards**. Data flows top to
bottom: the node's source feeds card 1, card N's result feeds card N+1, and the
LAST card's result is the node's single output. Everything happens inside the
node — no new canvas nodes, edges, or handles.

## Non-goals

- Reordering cards (delete-only management; re-adding is the reorder).
- Branching or parallel pipelines inside the node — the chain is strictly linear.
- Exposing intermediate card results as referenceable node outputs. Only the
  final result is an output; intermediates appear only in run history.
- Any change to the other node kinds or to the canvas graph model.

## Design

### 1. Schema — `operations` array, no format bump

`filterNode.data` gains an optional `operations` array. Following the node's own
precedent ("no format bump, no migration" — the stored `type` literal stayed
`"filter"` when the node widened), the existing flat fields remain in the schema
with their zod defaults, and a saved single-operation node parses unchanged.

```ts
const operationCardSchema = z.object({
  /** Stable identity for React keys, issue field paths, and detail rows. */
  id: z.string(),
  operation: dataOperationSchema.default("filter"),
  combinator: combinatorSchema.default("and"),
  clauses: z.array(clauseSchema).default([]),
  field: z.string().optional(),
  flatten: z.boolean().default(false)
});

// on filterNode.data, beside the existing flat fields:
operations: z.array(operationCardSchema).optional()
```

- `source` stays **node-level** (`node.data.source`), not card-level: only the
  first card consumes it, and deleting the first card must not lose it.
- **Normalizer** `cardsOf(node): OperationCard[]` in `data-node.ts` is the one
  read path: `operations` when present and non-empty, else one card synthesized
  from the flat fields (id `"card-0"`). Every definition, runtime, and UI
  consumer goes through it; nothing else reads `node.data.operation` /
  `clauses` / `field` / `flatten` directly.
- The builder writes `operations` on any edit. The flat fields are left as
  parsed (zod defaults) and ignored once `operations` exists.
- Card ids are generated client-side (existing id helper the builder uses for
  clauses/paths); uniqueness is per node.
- A generous cap (`.max(20)`) guards against a runaway array; the UI never
  reaches it in practice.

### 2. Type walk — `chainTypes`

New exported helper in `data-node.ts`:

```ts
/** inputs[i] = the type flowing INTO card i; inputs[cards.length] = the node's
 * output type. undefined = unconfigured/unsupported at that point, which
 * suppresses downstream errors exactly as resultType does today. */
function chainTypes(node: FilterNode, ctx: NodeContext): (ValueType | undefined)[]
```

It folds the existing per-operation typing (today's `resultType`, refactored to
`cardResultType(card, input, catalog)`) over the chain, starting from the source
type. `dataOutputs` returns the final element; the form, the operation gating,
and `checkTypes` all read the same array so they can never disagree.

### 3. Operation gating — `operationsFor`

```ts
/** Which operations can consume this type. Every operation needs a list;
 * pluck additionally needs record/entity items. undefined input = all
 * operations (unconfigured source — the author is still choosing). */
function operationsFor(input: ValueType | undefined): DataOperation[]
```

- Card N's operation dropdown offers `operationsFor(inputs[N])`, plus the card's
  currently stored operation if it is no longer in that list (so a stored-but-
  invalid choice still renders; validation marks it red rather than the Select
  silently blanking).
- **"Add operation" is disabled** when `operationsFor(finalOutput)` is empty
  (after count/join/first/last — nothing consumes a bare number, string, or
  single item) or when the final output is `undefined` (chain not yet
  configured). An unknown output must never read as "anything goes".
- **Switching a card to a terminal operation truncates the tail**
  (`truncateStarvedCards`): the cards below would receive a bare value no
  operation could ever consume, so they are dropped rather than left as
  unfixable red. Only a card whose input is DEFINED and not a list is starved —
  an unknown input keeps its tail (delete-ripple rule unchanged for deletions
  and field edits).
- `join` stays offerable on any list whose items render as text, exactly per
  `rendersAsText` today.

### 4. Validation — per-card, card-scoped item typing

`checkTypes` walks the cards with `chainTypes` and validates each card against
its own input, reusing today's per-operation checks. Issue field paths become
`operations.{id}.{field}` (e.g. `operations.card-2.clauses.0`), the same scoped
convention condition paths already use (`paths.{id}.clauses.0`), so the form
attaches each issue to the right card.

**Item refs:** Runtime needs no change — only one card executes at a time, so
`ctx.item` is always the right item. Design-time, the plan-phase check
confirmed `validate.ts`'s layer 5 DOES type ItemRefs through the node-level
loop list, so a wrapped context inside `checkTypes` would not have been enough.
The mechanism is instead:

- `itemRefSchema` gains `card: z.string().optional()` — the id of the card the
  ref lives in. An old ref without one resolves against the FIRST card, which
  for every pre-chain node is the only card: exact back-compat by default.
- `NodeContext.loopListOf` and the `NodeKind.loopList` hook take an optional
  `card` id; only the data node reads it (`dataLoopList` returns the input of
  that card when its operation loops). `resolveItem` passes `ref.card`
  through, which makes `checkClauses` AND layer 5 card-correct with no
  special-cased context.
- The builder stamps `card` onto every ItemRef it creates inside a card
  (variable menu + token id round-trip), keyed by `FieldContext.itemCard`.

`values()` returns every card's clauses (with `operations.{id}.clauses` field
paths) plus the node source, so reference validation still sees every ref.

Delete ripple (user decision): deleting a card re-runs live validation; later
cards keep their config and any type mismatch shows as the ordinary red issue.
Nothing is auto-cleared.

### 5. Runtime — sequential fold in `filter.ts`

`filterExecutor` loops the cards, feeding each card's result to the next. Each
card runs today's per-operation logic (extracted to run one card against one
input value) and yields a one-line summary — the same wording each operation
produces today ("Kept 3 of 10.", "Took 4 values.").

- A card that **skips** (the draft-only runtime guards: plain-value pluck,
  unflattened list field, non-text join, non-list input) skips the whole node;
  the reason names the card position ("Step 2 (Take one field): …").
- The node's `summary` is the LAST card's summary; per-card summaries go into
  `detail`.
- `NodeDetail` gains a second variant:

```ts
| {
    kind: "data";
    cards: Array<{
      id: string;
      operation: DataOperation;
      summary: string;
      status: "Succeeded" | "Skipped";
    }>;
  }
```

Written on Succeeded and Skipped (cards up to and including the skipping one),
never on Failed — per the existing `detail` contract. `compactForLog` already
truncates strings structurally; no retention change needed.

### 6. Builder UI — cards in `FilterForm`

- Each card renders as a rounded bordered box: operation Select (gated per §3),
  then that operation's fields exactly as today (clauses + combinator for
  filter; field picker + flatten for pluck; nothing for count/first/last/join).
- The **first card** additionally carries the node's source picker, above its
  operation.
- Between consecutive cards, a small downward arrow (chevron/arrow glyph in a
  centered column) shows the flow. Below the last card, the **"Add operation"**
  button (disabled per §3, with a tooltip saying why). Adding appends a card
  defaulted to the first operation `operationsFor` offers.
- Each card has a **remove** button (trash icon, top-right), hidden when only
  one card remains — the chain never goes empty.
- Per-card field choices and the "current item" entry in the variable picker
  derive from `inputs[N]` (via `chainTypes` re-exported through
  `@carbon/workflows`). `FieldContext` gains an optional `itemType` override
  that `ClauseRow`'s value resolution consults before falling back to the
  node-level loop list — the form sets it per card.
- Changing a card's operation clears only that card's now-meaningless fields
  (clauses / field / flatten), exactly as `handleOperationChange` does today.
  Changing the node source still clears card 1's dependent state; later cards
  follow the delete-ripple rule (keep + validate red).
- All new copy (Add operation, remove tooltip, disabled-reason tooltip) is
  Lingui-translatable from day one.

### 7. Canvas card summary (`meta.ts`)

Arrow-joined operation labels: `"Keep matching items → Take one field from
every item → Count items"`, ellipsis-truncated by the existing card summary
styles. Single-card nodes keep today's behavior (clause count for filter, the
op label otherwise). Uses `DATA_OPERATIONS[op].label` like the rest of
`meta.ts` (that file's strings are uniformly untranslated today — pre-existing
debt, not widened by adding labels already in the table).

### 8. Run history — `DataDetail`

A sibling of `ConditionDetail` in `ui/Runs/`: renders the per-card breakdown as
a numbered list — operation label, summary, and a subtle Skipped marker.
Surfaced everywhere `detail` already renders (run drawer + test-run panel).

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Storage shape | Optional `operations` array beside the flat fields; `cardsOf` normalizer | Node's own no-migration precedent; length-1 chains parse from old data unchanged |
| Source ownership | Node-level, consumed by card 1 | Deleting card 1 must not lose the source; only one source exists |
| Op gating on add | Dropdown offers only `operationsFor(input)`; Add disabled when nothing consumes the output | User decision; keeps invalid chains unbuildable rather than merely flagged |
| Stored-invalid op | Still listed in its card's Select, flagged red | A Select that blanks a stored value silently destroys state |
| Card management | Add + delete only, min 1 card, cap 20 | User decision (no reorder); a chain never goes empty |
| Delete ripple | Keep later cards, validate red | User decision; never destroys work, matches existing validation UX |
| Item typing | Runtime untouched; `ItemRef.card` (optional) + card-aware `loopListOf` | Layer 5 types ItemRefs too, so scoping must live on the ref; absent `card` = first card = exact back-compat |
| Run detail | New `NodeDetail` kind `"data"` with per-card rows | User decision; mirrors the condition detail contract exactly |
| Node output | Last card's result only, under `DEFAULT_OUTPUT` | User requirement; intermediates are diagnostics, not data |
| Canvas summary | Arrow-joined labels | User decision |
| Format version | Unchanged (4) | zod defaults + optional array make old definitions parse as length-1 chains |

## Acceptance criteria

1. A saved pre-chain data node (flat fields, no `operations`) loads, validates,
   runs, and displays exactly as before — as a chain of one card.
2. In the builder: source list of calendar events → card 1 `filter` (keep
   status = confirmed) → Add operation → card 2 `pluck` (organizer.email,
   offered because items are records) → Add operation → card 3 `count`. After
   card 3, "Add operation" is disabled with a reason tooltip.
3. Card 2's operation dropdown offers no `pluck` when card 1's output is
   `list<string>`; card 2's clause picker's "current item" is typed by card 1's
   output element, not the node source's.
4. Running the node from criterion 2 over 10 events (3 confirmed) outputs the
   number 3; the run drawer's step shows three rows: "Kept 3 of 10." →
   "Took 3 values." → the count summary; the node's own summary is the last
   card's.
5. Deleting card 2 leaves card 3 in place with a red TYPE_MISMATCH on the right
   card (count over `list<record>` is fine, so use a chain where the ripple
   genuinely breaks — e.g. delete a pluck feeding a join that needed text
   items); nothing is auto-cleared.
6. A mid-chain skip (unvalidated draft: pluck with no field) skips the node
   with a reason naming the card position; detail shows cards up to the skip.
7. The canvas card reads "Keep matching items → Take one field from every item
   → Count items" for the criterion-2 node.
8. `pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/jobs`
   and both packages' vitest suites pass; ERP typechecks; new behavior is
   covered by tests at the schema, type-walk, validation, and runtime layers.

## Open questions (resolved)

- [x] What happens after an operation whose output is not a list? —
  **Answer:** only type-compatible operations are offered; "Add operation" is
  disabled when nothing can consume the output.
- [x] Card management beyond adding? — **Answer:** delete only, no reorder.
- [x] Run history: per-card or final-only? — **Answer:** per-card breakdown in
  the step detail.
- [x] Collapsed canvas card summary for a chain? — **Answer:** arrow-joined
  operation labels.
- [x] Deleting a mid-chain card that invalidates later cards? — **Answer:**
  keep the later cards; live validation flags them red; nothing auto-cleared.

## Changelog

- 2026-08-31 — Spec written after resolving all five open questions with the
  user.
- 2026-08-31 — Item-typing mechanism amended during planning: `validate.ts`
  layer 5 resolves ItemRefs through the node loop list, so the wrapped-context
  idea was insufficient; replaced with an optional `card` field on `ItemRef`
  plus a card-aware `loopListOf`. No user-facing change.
- 2026-08-31 — Post-build user feedback: switching a middle card to a terminal
  operation now DROPS the starved tail (`truncateStarvedCards`) instead of
  leaving it red; "Add operation" also disables on an unknown output (an
  implementation gap — the spec already required it).
- 2026-08-31 — Second round: the terminal fact moved into the operation table
  (`keepsList`) so truncation and validation are STRUCTURAL — they hold while
  the source or a pluck field is still unconfigured, where type-based checks
  saw only "unknown" and did nothing. Every `operations` write in the form
  truncates, and `checkTypes` flags any card following a terminal one.
