# Component catalog (real, current)

The MDX vocabulary, per surface. These are the components that **actually ship** in `docs` — read the
live source if anything here looks off (`components/editorial/mdx.tsx`, `components/editorial/reference-components.tsx`,
`components/mdx.tsx`, `components/editorial/illustrations.tsx`). The Guide and Reference surfaces have
**different** component sets and even a **different `Callout` API** — don't mix them.

> Legacy note: the old version of this file listed `ReadingProgress`, `ChapterNav`, `ScrollReveal`,
> `FeatureCallout`, `Checklist`, `Frame`, `TypeTable`, `Eyebrow`. **None of those are used by the shipped
> docs.** Ignore them; use what's below.

---

## Guide surface — `content/guides/*.mdx`

Registered in `components/editorial/mdx.tsx` (markdown elements get warm-paper prose styling; these four
carry the structured pieces). **No code fences in guides.**

### `<Figure>`
SVG diagram from the illustration registry.
```mdx
<Figure illustration="flow-overview" caption="The path one order travels through Carbon." />
```
- `illustration: IllustrationKey` (**required, must be a real key**), `caption?: string`.
- Valid keys (`components/editorial/illustrations.tsx`): `flow-overview`, `order-split`, `bom-tree`,
  `demand-forecast`, `planning-engine`, `shopfloor-loop`, `eight-d`, `traceability-graph`, `method-types`,
  `kit-vs-subassembly`, `reorder-policy`, `outside-processing`, `mes-station`, `issue-workflow`,
  `schedule-board`, `get-method`, `conversion-factor`.
- A non-existent key renders **nothing, silently**. If no key fits your topic, use `<Screenshot>` instead —
  do not invent keys, and don't author a new SVG unless asked (they're hand-built components).

### `<Screenshot>`
Placeholder frame for a real Carbon screen — no image asset required.
```mdx
<Screenshot label="Sales order dashboard" caption="The 90-unit robot order, with its three-week schedule." ratio="wide" />
```
- `label: string` (required), `caption?: string`, `ratio?: "wide" | "tall" | "square"` (default `wide` = 16/9).
- The default *visual* in new content — chapters lean on `<Screenshot>` + `<Callout>`, with `<Figure>` only
  where a registry key genuinely fits. But place each one where a real screen earns it, not as filler.
- **A `<Screenshot>` is a standing slot for a *real* Carbon capture — treat it as one.** Use it where the
  reader genuinely needs to see the actual UI (a dashboard, a specific form/field, a status badge, a board,
  where-to-click). If the prose already carries the point, skip it.
- **Label the real screen, grounded.** `label`/`caption` must name an actual, current Carbon screen + state —
  verify it exists in the app, like any other claim. "Job operations tab — outside operation flagged for a
  PO" beats "a screenshot of operations". A precise label lets a real capture drop straight in and keeps the
  docs honest to the live UI.
- Prefer a real-screen `<Screenshot>` over a conceptual `<Figure>` when the point is *what Carbon actually
  looks like / where to click*; use `<Figure>` only when the point is a concept or relationship.

### `<Callout>` (Guide API — tone + badge)
The workhorse. Carry the **Carbon-specific truth a generic description gets wrong**.
```mdx
<Callout tone="amber" badge="POSTING ≠ CREATING" title="Posting moves inventory and the order — and stops there.">
A posted shipment decrements stock and advances the order; it does **not** create the invoice. Fulfillment
and billing are deliberately separate steps.
</Callout>
```
- `tone: "neutral" | "blue" | "green" | "amber"`, `badge: string` (short, SCREAMING-CASE), `title: string`,
  `children`.
- Tone usage: **blue** = explanatory "why" / context; **green** = good-to-know / outcome; **amber** =
  caution / contrast / gotcha; **neutral** = definitional.
- Body is wrapped in a `<div>` (not `<p>`) — fine to use **one** paragraph of children. Title is a *claim*,
  body is the *why*.

### `<Divider />`
Hairline rule. Used once near the end of a chapter, before the wrap-up sentence.

### `<Term>`
Inline glossary term — dotted blue underline; click/tap opens a popover with a one-line definition and an
optional "Learn more" link. The non-link affordance for jargon: links navigate (solid, blue text), terms
define (dotted underline, ink text).
```mdx
Set the method type to <Term>purchase to order</Term> when the material is bought, not built.
You <Term id="pull-from-inventory">pull it from stock</Term> when the parent is built.
```
- `id?: string` (explicit glossary slug), `children` (display text — slugified to the entry key when `id` is omitted).
- Definitions live in `docs/lib/glossary.ts` (`slug → { term, definition, href? }`). Add the entry there
  first, grounded in source. Omit `href` → definition-only popover; the "Learn more" link auto-hides when it
  would point at the current page. Unknown slug → renders plain text (fails safe).
- **Same component on the Reference surface.** First occurrence per page only — see SKILL.md "Interlinking &
  the glossary".

**Rail:** every `##` heading becomes a sidebar entry. Structure a chapter as 3–5 `##` sections + a short
intro; `###` is for sub-structure (not in the rail).

---

## Reference surface — `content/docs/**/*.mdx`

Registered via `components/mdx.tsx` + `components/editorial/reference-components.tsx`.

### `<Callout>` (Reference API — type, NOT tone+badge)
```mdx
<Callout type="note">**Replenishment system** is the high-level strategy; **default method type** is the line-level default it allows.</Callout>
```
- `type: "info" | "note" | "warn" | "warning" | "error" | "success" | "tip"`, `title?`, `children`.
- type → badge/tone: `info`/`note` → NOTE / blue; `warn`/`warning`/`error` → HEADS UP / amber;
  `success`/`tip` → GOOD TO KNOW / green.
- **Different from the Guide `Callout`** — here you pass `type`, not `tone`+`badge`.

### `<Cards>` / `<Card>`
Link-card grid — overview fan-out and cross-surface navigation.
```mdx
<Cards>
  <Card title="Methods & sourcing" href="/docs/reference/methods">How an item's BOM and routing are defined.</Card>
  <Card title="Inside the build" href="/guides/build">The same ideas in the story of a robot build.</Card>
</Cards>
```
- `Card`: `title?`, `href?`, `icon?`, `children`. `Cards` wraps them in a 2-col grid.

### `<EnvVars>` / `<EnvVar>`
Field / parameter / option rows (hairline-divided).
```mdx
<EnvVars>
  <EnvVar name="CARBON_API_KEY" type="string" required={true}>The PostgREST API key for the instance.</EnvVar>
  <EnvVar name="exchangeRate" type="number" default="1">FX rate stamped on the line at creation.</EnvVar>
</EnvVars>
```
- `EnvVar`: `name: string`, `type?`, `default?`, `required?: boolean`, `children` (description).

### Standard
- `<Steps>/<Step>`, `<Tabs>/<Tab>` (fumadocs-ui) for sub-procedures and alternative paths.
- **Markdown tables** for field references (`| Field | Type | Description |`).
- **Code fences** render in the dark API-playground panel (`MdxCodeBlock`). Reference pages *may* use fences
  — but mind the shiki theme gotcha (SKILL.md).

### `<Term>`
Inline glossary term (dotted underline → definition popover) — **the same component as the Guide**; see the
Guide-surface entry above for the API. Use it on Reference prose too: gloss the first occurrence of a term a
reader hits cold, especially where the page names a concept it doesn't stop to define.

---

## Both surfaces — `<AgentContext>` (agent-only, invisible to readers)

Wrap content that should reach the **in-app agent** but never the human docs site.

```mdx
<AgentContext>
Licensing tiers are enforced in `packages/ee`, gated by the `company.plan` column;
the paywall check lives in `requireLicense()`.
</AgentContext>
```

- **Renders nothing** on the published page, and a `remark` plugin (`source.config.ts`)
  strips it from the MDX AST before `remark-structure` runs — so it's also **excluded
  from site search**. Readers never see it.
- `scripts/generate-agent-kb.ts` **unwraps** it into the agent KB
  (`apps/erp/app/modules/agent/kb/<slug>.md`) — the in-app agent *does* read it.
- Use it for extra code/behavior detail that helps the agent answer accurately but
  would clutter or over-disclose to a human reader (internal table names, service
  functions, edge cases). Author normal markdown inside. Works on Guide and Reference.
- Regenerate the KB after editing (`pnpm run generate:agent-kb`) — same commit-time
  rule as any `docs/content` change (see `.claude/rules/agent-knowledge-base.md`).

---

## Choosing a component

| You want to… | Guide | Reference |
|---|---|---|
| Show a real Carbon screen | `<Screenshot>` | `<Screenshot>` works, but Reference usually uses tables/cards |
| Show a conceptual diagram | `<Figure>` (real key only) | — |
| Flag a must-not-miss truth / gotcha | `<Callout tone badge title>` | `<Callout type>` |
| Fan out to related pages | inline links | `<Cards>` |
| Gloss a jargon term inline | `<Term>` | `<Term>` |
| Document fields/params | (prose) | markdown table or `<EnvVars>` |
| A short ordered procedure | (narrate it) | `<Steps>` |
| Alternative paths | — | `<Tabs>` |

Coherence beats variety: a Guide chapter is mostly prose + 2–4 callouts + a few screenshots/figures; a
Reference page is mostly tables/cards + a couple of `type` callouts. Don't stack Guide and Reference
components on one page.
