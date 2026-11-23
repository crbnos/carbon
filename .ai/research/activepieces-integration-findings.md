# Activepieces: returned data + UI control

Two problems on the integration node:
1. A piece's output is `{ result: t.string }` — a JSON blob. `walkPath` only descends into
   `entity` types, so there is no way to reach `items[0].summary`. The data is unusable, and
   silently so: the author sees a `result` variable and only finds out at run time.
2. We emit every vendor prop (`buildPieceActionDeclarations` loops `action.props`), so the
   form shows API trivia nobody wants.

The hard part of (1) is **discovery, not representation**: the author must write a path at
build time against data that only exists at run time. So the first question is how everyone
else solves that.

---

# Part 1 — How the other platforms do it

## Zapier

**The declaration.** A static `sample` JSON blob plus an `outputFields` array, committed in
the integration definition. Live capture exists only as a bootstrap button:

> "Either click the **Use Response from Test Data** button to import the fields your app sent
> to Zapier in the previous test, or add your own JSON-formatted fields."
> — docs.zapier.com/platform/build/sample-data

Nothing re-captures it at run time. The field mapper is populated **from the sample**, not
from live data.

**Testing mutates, and they say so plainly.**

> "When you test an action step, Zapier will perform the action on your behalf." /
> "Testing is live and may result in changes made in your app."
> — help.zapier.com/.../18811411817741

There is a **Skip tests** button for actions; triggers, Filters and Paths *must* be tested
before publishing.

**Their answer to the sample-vs-live gap is a lint rule.** Because mapping comes from the
sample: *"If that mapped field is then not available when a user's Zap runs, the action field
will be empty, causing errors."* Mitigations: a discipline rule on the developer — **"Only
include fields that are present every time a Zap runs"** — plus automated checks that sample
and live data match. That is the whole solution. **This is exactly the "my dev account had no
`queries` field" problem, and the market leader has no better answer.**

**Dynamic fields** (`z.request` + `altersDynamicFields` + a **Refresh Fields** button) handle
per-account custom fields — but **actions only, not triggers**.

**Arrays are second-class.** "Line items" are the only array primitive, shown in a separate
indented section; both trigger and action must support them, and not all action fields
accept them. Escape hatch: Formatter → **Line-item to Text**, flattening to a delimited
string. Arrays-in-arrays effectively unsupported.

## Make.com

**Architecturally identical to Zapier**: the Interface block is static JSON, with a generator
as convenience. The documented workflow is copy-paste: run module → Download output bundles →
Generator → paste JSON → replace Interface.

**And Make explicitly distrusts the generated result:** **"The generated code still needs to
be reviewed!"** — dates get mistyped, labels need capitalization, pagination fields must be
stripped from Search modules. *A machine-derived shape is a draft, not an answer.*

**Make has the one real escape hatch found anywhere: RPC dynamic interfaces.** "You can use
RPC to generate the interface dynamically" — computed per account at design time, mixable
with static params. This is the only mechanism in the whole survey that **solves** per-account
divergence instead of policing it. It costs a design-time call per account.

**Arrays are first-class**: **Iterator** ("converts an array into a series of bundles — each
array item will output as a separate bundle") and **Array Aggregator** (the inverse).
Decompose → process per item → reassemble.

**Honest gaps:** Make never states in first-party wording that "Run this module only" mutates
real data — only that it "consumes one credit." And arrays-in-arrays have no first-party docs;
chained Iterators appear only in community threads.

## n8n

**No output schema at all in the node type.** `INodeTypeDescription.outputs` describes
*connection topology only* — how many branches, of what type. There is no field anywhere
describing the JSON a node emits. The entire runtime contract is
`Array<{ json: {...}, binary?: {...} }>`.

**Discovery is execution.** Run the node, read the INPUT/OUTPUT panels, drag a field into a
parameter to generate `{{ $json.fruit }}`. Autocomplete is resolution-based, not type-based.
Worth stealing as a warning: **Schema view is built from the first item only**, so a field
missing from item 1 is invisible even when item 2 has it.

**Real API calls at build time, with no guard whatsoever.** Grepping the node type for
`readOnly|idempoten|destructive|mutating|sideEffect` finds nothing relevant — n8n has no basis
on which to warn, and doesn't. Its own framing of the risk is resource limits, not mutations:
pinning *"protect[s] live systems from repeated test calls."*

**Pin data is a genuine firewall — but only from the 2nd call on.** The engine short-circuits
before `execute()`:

```ts
if (pinData && !executionNode.disabled && pinData[executionNode.name] !== undefined) {
  nodeSuccessData = [nodePinData];   // node never runs, no API call
} else { /* actually run the node */ }
```

But the documented way to pin is *"1. Run the node to load data. 2. Select Pin data."*
**Pinning presupposes discovery; it doesn't provide it.**

**The one genuinely new idea: committed schema files.** n8n's **Schema Preview** — *"view a
node's expected output — no execution, no credentials needed"* — is not inferred from TS
types or cached runs. It is hand-written draft-7 **JSON Schema checked into the repo** at
`nodes/<Node>/__schema__/v<version>/<resource>/<operation>.json`, fetched by path.
*Caveat:* coverage is partial and hand-curated — Slack, Notion, Asana, Stripe present;
**Google Calendar, Airtable, HubSpot absent (404)**. A moderator confirms there is no way to
generate one *"without executing the node or using pinned data."*

**Arrays are the model, not a feature.** n8n's data is an array of items and **nodes
automatically run once per item**: *"n8n handles this repetitive processing automatically...
Nodes usually run once for each item."* Fan-out is a property of the data, not control flow —
which is why **Split Out** (1 item holding an N-array → N items) is the idiomatic loop, and
**Aggregate** is the inverse (with a `Merge Lists` option for list-of-lists). Escapes:
**Execute Once**, the Code node's run-once-for-all mode, and a hand-maintained list of
non-iterating nodes.

## Activepieces itself (upstream, HEAD `0ff753b`)

**`outputSchema` exists but is explicitly presentational:**

> "…a friendly, labelled presentation … **without changing the expression paths used in
> automations.**"

`ActionRunner` returns `Promise<unknown | void>`. Grepping server/core/web/engine finds
**zero runtime validation** — `piece-executor.ts` calls `setOutput(output)` directly. A schema
claiming `invoice_id` when `run()` returns `invoiceId` produces no error anywhere. It shipped
**August 2026**, one month ago.

**Their picker is driven by executed sample data, not by the schema.** `utils-schema.ts` walks
`outputSchema` *against real sample data*, expanding `listItems` per actual array element.
**With no sample data there is nothing to expand** — the schema only paints labels on a tree
that sample data built. And **actions have no `sampleData` field at all** (triggers require
one), so for an action the only shape source is execution.

**Sample data is stored per-step, per-flow-version**, as a JSON file blob (DB or S3), and
**never expires**.

**Testing a mutating action really mutates.** `/test-step` enqueues a real engine run;
`RunEnvironment.TESTING` is just a label. The framework *does* have a `test()` override that
test-mode prefers over `run()` — and across all 728 pieces there are **48 `test:` definitions,
0 of them on actions** (all triggers). Upstream gates data access behind "test the step
first," which for a create/delete action means really creating/deleting.

**Neither marker helps.** `aiMetadata.idempotent` is an LLM hint — docs: *"it does not by
itself prevent or trigger retries"*; its only readers are MCP surfaces.
`ActionClassification` (READ/SEARCH/WRITE/DESTRUCTIVE) has `isReadOnlyClassification()` but
**no runtime consumer** found in server, engine or web.

**Arrays:** a `LOOP_ON_ITEMS` step type that validates its input is an array and **nests**.
Reshaping is the Code step or a spreadsheet-style formula library (`pluck`, `filter_list`,
`count`, `first_item`…). No data-mapper node.

## The one conclusion all four share

| | declared schema | how authors really discover | test mutates? | arrays |
|---|---|---|---|---|
| Zapier | static `sample`, hand-written | sample data | **yes**, documented | line items (weak) |
| Make | static Interface JSON | generator + mandatory review | implied (costs a credit) | Iterator / Aggregator |
| n8n | none in node type; separate committed JSON files, partial | execute → panels → drag-drop | **yes**, no marker at all | Split Out / Aggregate |
| Activepieces | `outputSchema`, ~8% of pieces, presentational | executed sample data per step | **yes**; `test()` hook exists, 0 actions use it | Loop on Items |

**Four independent teams, one answer: the authoritative shape comes from an executed
response, and every one gates authoring behind running the step for real.** Nobody solved
discovery without execution. Every declared schema above is hand-curated, partially adopted,
and **validated by no one at run time**. Nested arrays: everyone stops at one level.

---

# Part 2 — What the pieces actually ship (measured, not read)

Loaded the packages and inspected them.

**Correction:** I earlier said `outputSchema` was missing on our two allowlisted actions.
Wrong — I'd read a minified bundle. It is on all 25 Google Calendar actions.

Then I over-sold it. Across 12 pieces / 496 actions, coverage is **binary per piece**:

| ~full coverage | zero coverage |
|---|---|
| google-calendar 100%, google-sheets 98%, airtable 97%, notion 92%, github 84%, slack 81% | hubspot, salesforce, jira-cloud, shopify, excel-365, xero — all **0%** |

Upstream-wide: **57 of 728 pieces (7.8%)**. My first sample was biased toward the ones that
have it. `classification` is **81%**, not the 100% I claimed — zero on Salesforce/Shopify/Xero.
Being binary per piece is the useful part: it is knowable with one check at allowlist time.

**Where present it is rich** — human labels, dotted `value` paths, `listItems` for array
element shapes, `children` for nesting, `format` hints (datetime/url/email/number). Across
3,987 field descriptors: `key`/`label` on all, `format` 1728, `children` 339, `listItems` 175.
I verified the paths describe `run()`'s **real** return envelope (`status` unmapped at the
top, everything else under `body.*`).

`dynamicKey: true` (Google Sheets `find_rows`) is the vendor pre-declaring "keys here vary per
account" — the `queries` problem, declared instead of silently missed.

---

# Part 3 — Our own constraints (read from our code)

- `ValueType` = primitive | entity | list-of-scalar. **No object type**, `list<list<T>>`
  unrepresentable, `walkPath` descends only through `entity`. "Just add a nested type" is a
  core-model change touching schema, validator, operators, templates and the picker.
- **But `entity` is only a name + property map** — nothing requires a DB table. A synthetic
  `googleCalendarEvent` entity is representable *today*, and `list<entity>` plus the existing
  `batchPlan` gives per-item looping **for free**. Carbon already has n8n's model: batching is
  derived from a list wired into a single-value slot.
- `compare` allows only `contains` on lists and `eq`/`neq` on entities → "did anything come
  back?" is not expressible without an explicit `count` output.

**The calendar dropdown bug — traced, not guessed.** Auth shape is **fine**: I invoked the
real options function, it reached Google and returned a genuine 401 on a fake token. Two other
defects:
1. The piece's `options()` **throws** on any non-2xx; the route flattens that to
   `{options: []}`; the field then renders an empty dropdown reading as "this account has no
   calendars" rather than "the call failed" (and `issue ?? error` lets a field issue mask it).
2. `useWorkflowOptions` only fetches when `fetcher.data === undefined`, so it fires **once** —
   a failed first load leaves it **permanently stuck empty** until a page reload. Almost
   certainly the regression.

---

# Part 4 — Where this leaves the design

Ranked by what the evidence supports:

- **Hand-writing shapes per action** — rebuilding the integration by hand; the objection that
  killed this was correct.
- **`outputSchema` as a typed contract** — dead. Unvalidated, 8%-adopted, one month old,
  presentational by upstream's own docs. **Survives as a path/label suggester** in the picker,
  which is exactly how upstream uses it, and costs one generic mapper.
- **Sampling on the customer's account** — this is Zapier's model, side effects and all, and
  Zapier's own docs warn about it. Rejecting it was right; the incumbent version isn't better.
- **Capturing the shape once on OUR dev account at packaging time** — strongest option. It is
  Make's generator workflow *including* its review step, minus the customer side effects. Its
  con (dev account lacks a field the customer has) is **universal and unsolved by the
  leaders** — Zapier's entire answer is a lint rule — and `dynamicKey` plus a raw-JSON escape
  hatch puts us slightly ahead.
- **Runtime stays tolerant**: resolve a path, yield null if absent (n8n's `Reflect.get`
  behaviour). Never enforce a declared shape at run time — nobody does.
- **Arrays**: `list<entity>` + existing batching covers one level. A Split-Out-style node is
  the shape to copy for explicit control. Nested arrays — fair to stop where all four stopped.

**Open calls**
- Is authoring-time-only typing acceptable, when "publish catches broken wiring" is Carbon's
  selling point? Product call, not technical.
- Fallback for a 0%-coverage piece (HubSpot et al.) — capture-only, or refuse to allowlist?
- Does run history render a `list<entity>` output usefully today? Unchecked.
