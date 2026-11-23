# Activepieces integration — goals and decisions

All three problems are closed on design. This doc states **what we are trying to achieve**,
then the decision behind each. Evidence lives in `activepieces-integration-findings.md`.

## Why this is bigger than originally planned

v1 shipped integrations as a node kind with `outputs: { result: t.string }` — the JSON the
piece returned, as one string. That was a deliberate, documented non-goal
(`.claude/rules/workflow-integrations.md`: *"mapping a piece's output schema"*), and it was
the right call to ship on.

The consequence is that **a workflow can call a vendor but cannot use the answer.** "Get all
Events" hands the author one opaque string: no property access, no counting, no looping, no
branching on what came back. Every use case past fire-and-forget is blocked, and blocked
*silently* — the author sees a `result` variable and only discovers at run time that it is a
blob.

Closing that is not a patch to the integration node. It touches the catalog generator (emit
real output types), the type system's entity registry (synthetic entities), a node kind (the
filter node becomes a JSON/data node), and the builder form (which inputs a person sees). That
is the scope increase, and it is deliberate — the alternative is an integration feature whose
output nobody can consume.

## Goals

1. **An author can see, at build time, what an integration step returns** — real named
   properties in the variable picker, not a JSON string. Without running the step, without
   touching the customer's account, and without us hand-writing a shape per action.
2. **An author can operate on returned data** — count it, filter it, take the first, project a
   field across a list, loop over it — using one node rather than a new one per operation.
3. **An author sees a form worth filling in** — vendor API trivia hidden by default, business
   decisions surfaced, and nothing permanently out of reach.
4. **No per-action maintenance burden on us.** Adding a piece stays "a few lines and a package"
   — that was the whole reason to build on Activepieces, and no decision here may erode it.
5. **Nothing already saved breaks.** Every change is additive; `result: t.string` stays.

## Non-goals (this round)

- Genuinely nested (2D+) array structure kept grouped — needs `list<list<T>>`, a core-model
  change. Flatten covers the real cases.
- Publish-time guarantee that a vendor's response matches its declared schema. Nobody in the
  market does this; run-time resolution stays tolerant.
- Pieces with no `outputSchema` (HubSpot, Salesforce, Shopify, …). Deferred, not designed
  away — see P1.
- Triggers, non-OAuth2 auth. Unchanged from v1's non-goals.

# Problem 1 — Build-time knowledge of what a step outputs  ✅ CLOSED

**Today:** every integration step declares `outputs: { result: t.string }` holding
`JSON.stringify(...)`. `walkPath` descends only into `entity` types, so there is no way to
reach `items[0].summary`. The author sees one `result` variable and discovers at run time
that it is a blob. Unusable, and silently so.

## Decision — allowlist only actions that ship an `outputSchema`

The schema is the source of build-time paths and labels. An action without one is not
exposed. Enforced in the generator, like the existing `UnmappablePropertyError`: a piece
action that fails the rule fails the build rather than reaching a customer's canvas.

**Why this works.** Coverage is **binary per piece**, not a per-action lottery — Google
Calendar 25/25, Sheets 60/61, Airtable 33/34, versus HubSpot 0/45, Salesforce 0/27. So the
rule is knowable with one check when a piece is allowlisted, which is already a deliberate,
human-gated step. And it is genuinely free: no per-action authoring, no capture pipeline, no
calls against a customer's account.

**What it rules out**, and why that is right:
- *Hand-writing shapes per action* — rebuilding the integration by hand. This was the
  objection that killed the original proposal, and it stands.
- *Sampling on the customer's account* — Zapier's model, real side effects; their own docs
  warn about it. `/test-step` upstream is a real run; `RunEnvironment.TESTING` is only a label.
- *Packaging-time capture on our own dev account* — still the best fallback if we ever need
  a piece without schemas, but it is a pipeline to build and maintain. Not needed if we can
  simply decline such actions.

## What this does NOT solve — and the design must absorb it

`outputSchema` is **unvalidated metadata**, not a contract:
- upstream docs scope it to presentation, *"without changing the expression paths used in
  automations"*;
- `ActionRunner` returns `Promise<unknown | void>`; there is zero validation in
  server/core/web/engine;
- it shipped August 2026 — one month old;
- upstream's own picker expands arrays from **executed sample data**, using the schema only
  for labels.

Therefore:
- **Authoring-time only.** Schema-derived types populate the variable picker and generate
  paths. They are not a publish-time guarantee.
- **Tolerant at run time.** Resolve a declared path against the real response; missing or
  mistyped → `null`, never a crash and never a lie. Same posture as `toPropsValue` omitting
  an absent optional input, and the same behaviour as n8n's `Reflect.get`.
- **Keep `result: t.string`** alongside, holding the raw JSON. It is the escape hatch when a
  schema misses a field, keeps "pass the blob to a webhook" working, and makes the whole
  change purely additive to saved workflows.

## Representation

`ValueType` has no object type and `list<list<T>>` is unrepresentable, so we do **not** add a
kind. Instead the generator emits a **synthetic entity** per schema container — an entity is
only a name plus a property map, and nothing requires it to be a database table.

- `listItems` → `list<entity>`; `children` → a nested `entity`; `format` → a `ValueType`
  guess (`datetime`→date, `number`→number, `boolean`→boolean, else string).
- Namespaced ids (e.g. `integration.google-calendar.event`) so they can never collide with a
  real Carbon entity. No `permission` — it is not Carbon data.
- `list<entity>` plus the **existing** `batchPlan` gives per-item looping for free: Carbon
  already derives "this step repeats" from a list wired into a single-value slot, which is
  n8n's implicit-per-item model.
- Add a `count` output. `compare` allows only `contains` on lists, so "did anything come
  back?" is otherwise inexpressible.

**Open:** does run history render a `list<entity>` output usefully today? Unchecked.
**Open:** `dynamicKey: true` marks per-account-varying keys (Sheets `find_rows`). Render
those as free-text path entry rather than a picker — needs a UI decision.

---

# Problem 2 — Operating on the returned data  ✅ CLOSED

**Today:** nothing. Even with Problem 1 solved, an author holding
`list<googleCalendarEvent>` can loop over it via batching, but cannot count it, filter it,
take the first one, or reach into a nested array.

**Hypothesis on the table:** a JSON-operations node that accepts JSON, performs an operation,
and returns either a primitive or another JSON value.

## What the prior art says

Every platform concluded arrays need a **first-class primitive**, not expression syntax:

| platform | mechanism |
|---|---|
| n8n | **Split Out** (1 item holding an N-array → N items) + **Aggregate** (inverse, with `Merge Lists` for list-of-lists) |
| Make | **Iterator** ("converts an array into a series of bundles") + **Array Aggregator** |
| Activepieces | `LOOP_ON_ITEMS` step type, validates input is an array, **nests** |
| Zapier | line items only; escape hatch is Formatter → Line-item-to-Text (flatten to string). Weakest of the four. |

And **nobody solves nested arrays** past one level: chain Split Outs, chain Iterators, or drop
to a Code node. Fair for us to stop there too.

## Decision — widen the existing filter node into a JSON/data node

Do **not** add a second node. The filter node already owns `loopList` and `ItemRef` ("the
item a looping node is currently on"), so a separate extract node would need its own parallel
item concept and we would have two loop primitives that must be kept agreeing. Widen the one
that exists: from *list in → filtered list out* to *value in → operation → value out*, where
filtering becomes one operation among several.

Operation set (Activepieces' own formula library is the shopping list — `pluck`,
`filter_list`, `count`, `first_item`, `join_list`):
`filter` · `count` · `first` / `last` · `pluck` (project one field across a list, with an
optional **flatten** flag) · `join`.

**This is fully typed, because P1 gives it typed input.** Once an integration step emits
`list<googleCalendarEvent>` instead of `t.string`, the node reads the upstream step's catalog
entry and knows exactly what it is operating on. Every operation's output type is then
derivable and checkable at publish, like the rest of Carbon:

| operation | output type |
|---|---|
| `count` | `number` |
| `first` / `last` | the element entity |
| `filter` | same `list<entity>` |
| `pluck("title")` | `list<string>` — looked up on the entity |
| `pluck("attendees")` + flatten | `list<attendee>` — see nested arrays below |
| `join` | `string` |

**Correction to an earlier claim in this doc's history:** `list<entity>` does **not** get
looping "for free" from existing batching. `engine/execute.ts:261` is
`if (node.type !== "action") return undefined` — the engine batches **action nodes only**, and
`catalog.ts` hard-codes `batchable: false` for integration steps. Batching also means "this
step repeats over a list fed *into* it", not "this step emits a list others iterate." That is
exactly why iteration has to live in this node.

### Nested objects and nested arrays

**Nested objects chain naturally.** `children` become nested entities and `walkPath` already
descends through entities, so `first → organizer → email` composes across two nodes with
nothing new.

**Nested arrays need one addition.** A 2D array cannot chain the same way, because
`valueTypeSchema`'s `list` accepts only a scalar (primitive or entity), never another list —
`list<list<T>>` is unrepresentable, so a node has no type in which to return one, and nothing
upstream could hand one to the next node.

So flatten is **not** a standalone operation taking a 2D array (such an input cannot exist).
It is an **optional flag on the operation that would otherwise produce one**:
`pluck("attendees")` over `list<event>` logically yields `list<list<attendee>>`; with flatten
it returns `list<attendee>` directly. The 2D value is never materialised — it is collapsed at
the moment it is created. Default it on: the flat result is nearly always what is wanted
("every attendee across every event"). This is Make's `Merge Lists` on Array Aggregator.

What this deliberately does not give: genuinely ragged multi-level structure — keeping events
*grouped* with their attendees. That needs real `list<list<T>>`, i.e. the core-model change
(schema, validator, operators, templates, picker, and `rendersAsText` which assumes an entity
part is never a list). Grouping is rarely the ask; flattening is. Not v1.

Worth noting nobody else represents nested arrays either: n8n chains Split Outs and Make
chains Iterators precisely because their data is untyped — they never need a *name* for the
intermediate value. Zapier flattens to text. Our flatten flag reaches the same place while
staying typed.

**Deliberately NOT in v1: a raw `path` operation into the `result` blob.** It is the only
operation whose output type is not derivable, because it would reach into things the synthetic
entity does not model — a sub-array (`list<list<T>>` is unrepresentable) or a field the schema
omitted. Leaving it out keeps P2 fully typed end to end with no publish-time hole, and stops
exactly where n8n, Make and Zapier stop. Additive later as an explicit escape hatch with
tolerant resolution if a real need appears.

**Open (implementation, not design):** replacing the shipped `filter` node type has a
migration cost on already-saved workflows — check what is published before committing to a
rename versus adding a mode.

# Problem 3 — UI presentation and control  ✅ CLOSED

**Today:** `buildPieceActionDeclarations` loops `Object.entries(action.props)` and emits every
prop. Whatever the vendor wrote, the author sees.

Measured on `google_calendar_get_events` (piece 0.10.3):

| prop | type | verdict |
|---|---|---|
| `calendar_id` | DROPDOWN, required | **keep** — a real business choice |
| `event_types` | STATIC_MULTI_SELECT, required, default `["default","focusTime","outOfOffice"]` | hide, use default |
| `search` | SHORT_TEXT | keep |
| `start_date` / `end_date` | DATE_TIME | keep |
| `singleEvents` | CHECKBOX, required, default `false` | **hide and pin to `true`** |

`singleEvents` ("Expand Recurring Event?") is worse than clutter — defaulting to `false`
means "events tomorrow" silently misses every recurring meeting, because unexpanded
recurring events carry the *series* start date. The vendor default is wrong for our use case.

**The rule:** hide fields that encode vendor API trivia; keep fields that encode a business
decision. `singleEvents` is trivia. `calendar_id` is a decision.

## Decision — three tiers: generic rules, a reviewed hide list, and Advanced properties

Not a per-action override table (that carries the same maintenance smell as hand-writing
schemas). Three layers, cheapest first:

**1. Generic rules, auto-applied, no per-action data.**
- **required + has a `defaultValue`** → hide, send the default. Covers `event_types`.
- **exactly one possible value** → hide.
- **connection input with exactly one connection** → auto-select and hide. Must still *store*
  the `connectionId` (a second connection added later must not silently repoint existing
  workflows) and stay a required input the validator checks — hiding is never removing. Zero
  connections already renders "Connect …"; two or more shows the field.

**2. A reviewed hide list per integration.** Written once when we allowlist a piece — which is
already a deliberate, human-gated step — for fields the rules cannot catch because the
vendor's default is *wrong for us* rather than merely boring. `singleEvents` is the case:
required, defaulted to `false`, and that default silently drops every recurring meeting. Pin
such values **at run time**, not stored on the node, so changing our mind fixes every existing
workflow instead of leaving stale literals behind. A hidden required prop with no pinned value
must **fail the generator**.

**3. An "Advanced properties" section on the node**, collapsed by default, showing everything —
including fields hidden by tiers 1 and 2. This is what makes the whole approach safe: a hidden
field is **demoted, never lost**. A normal user sees the simplified form; a power user opens
Advanced and gets full control without needing a code change from us. It also means being
wrong about a hide decision costs a click, not a release.

**Advanced shows pinned values as editable.** More honest than read-only, and the stale-literal
risk is acceptable because overriding is an explicit, deliberate action — the run-time pin
still governs every node that has not opted out.

**On `calendar_id`:** do not "select all calendars" — `get_events` hits
`/calendars/{id}/events` for exactly one id, so "all" means N fanned-out calls plus every
subscribed holiday calendar. Default to the **primary** calendar and keep the field visible:
which calendar is a genuine business choice on a shared workshop account.

## Two real bugs, traced (fix regardless of the above)

Auth shape is **fine** — I invoked the real options function; it reached Google and returned a
genuine 401 on a fake token.

1. **A vendor error becomes "no options."** The piece's `options()` throws on any non-2xx;
   `workflows.options.ts` flattens that to `{options: [], error}`; `OptionsField` then renders
   an empty `Combobox` (the `emptyHref` branch does not apply to the property provider), so it
   reads as "this account has no calendars" rather than "the call failed." `issue ?? error`
   also lets a field issue mask the error entirely.
2. **The fetch never retries.** `useWorkflowOptions` loads only when
   `fetcher.state === "idle" && fetcher.data === undefined`, so it fires **once**. A failed
   first load leaves `fetcher.data` set, so the field is **permanently stuck empty** for the
   rest of the editing session. Almost certainly the reported regression.

**Open:** how much of the piece's own `description` text to surface as field help.

---

# Cross-cutting note — what remains unguaranteed

With the raw-`path` operation left out of v1, there is **no publish-time hole of our own
making**: paths come from the schema, and every JSON-node operation's output type is derived
and checked like any other Carbon wiring.

What stays unguaranteed is narrower, and is not something any platform solves: whether the
**vendor's actual response matches the schema it declared**. `outputSchema` is unvalidated
upstream (`run()` returns `Promise<unknown | void>`; zero validation in server/core/web/engine).
So run-time resolution stays tolerant — a declared path that is absent or mistyped yields
`null`, never a crash and never a lie — and `result: t.string` remains alongside as the raw
escape hatch. Zapier, Make, n8n and Activepieces all accept exactly this.

# Suggested order

1. **Options bugs** (P3) — smallest, and the calendar dropdown is broken right now.
2. **Generic hide rules + auto-hide single connection + Advanced section** (P3).
3. **Schema-gated allowlist + synthetic entities + `count` output** (P1).
4. **Widen the filter node into the JSON/data node** (P2) — needs 3 to be useful.

Steps 1–2 are days. Step 3 is the one to design carefully. Step 4 carries a migration
question (rename the shipped `filter` node type versus add a mode) — check what is already
published first.

## Still open (implementation detail only, no design blockers)

- Rename/migration cost of replacing the shipped `filter` node type.
- One node with an operation dropdown versus a mode — affects validation shape.
- Does run history render a `list<entity>` output usefully today? Unchecked.
- `dynamicKey: true` fields (per-account-varying keys) — render as free-text path entry
  rather than a picker.
- How much of a piece's own `description` text to surface as field help.
