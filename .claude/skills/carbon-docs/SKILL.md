---
name: carbon-docs
description: >-
  Author, edit, or extend the Carbon documentation site at `docs` (a built Fumadocs + Next.js
  app). Use whenever creating or changing reader-facing docs for Carbon: editorial Guide chapters,
  Reference/entity pages, the docs IA, or "document this feature" requests — anything destined for
  the docs site. Covers the grounded-in-source authoring workflow, the flow-based Guide architecture,
  the real MDX components for each surface, the warm-paper house style, and the build verification
  loop. Trigger even if the user doesn't say "docs" but clearly wants explanatory, reader-facing
  written material about how Carbon works.
---

# Carbon Docs

`docs` is a **built, opinionated** documentation site — Fumadocs + Next.js (React 19), **light-only**,
warm-paper aesthetic. It is no longer scaffolded; it exists and ships content. This skill is how to add
or change docs **in that system, in its house style, grounded in real Carbon code.**

> The single biggest mistake is writing plausible ERP-generic prose. Carbon's behavior is specific and
> often counterintuitive (WIP is a GL balance not a table; payment is a field not an entity; overhead is
> not absorbed; fixed-asset disposal is scrapping-only). **Every claim is grounded in source.** See the
> prime directive below — it overrides everything.

> **What Carbon is:** a manufacturing system — **ERP** (the office) + **MES** (the floor), one platform over
> one data model. **Academy is *not* a third product pillar**: it just hosts training **video lessons**, not a
> SaaS app a customer buys. Never frame Carbon as "ERP, MES, and training/Academy"; site, meta, and landing
> copy stay **ERP + MES**. (The `academy` app can appear in an architecture/monorepo listing — fine; describe
> it as video-lesson hosting, not a pillar.)

## The prime directive — ground everything in source

The **holy source of truth is the actual source code + the LATEST database migrations**
(`packages/database/supabase/migrations/`, newest by timestamp) — NOT ERP/CMMS general knowledge, NOT
`.claude/rules/` alone (it is often stale).

- **Verify before you write.** Every entity, status enum *value*, and transition named in docs must exist
  in real code. Confirm exact strings (`"To Ship and Invoice"`, `"Fully Depreciated"`), the actions that
  drive them (service fns, routes, edge functions in `packages/database/supabase/functions/`), and what
  posts/gates (e.g. `companySettings.accountingEnabled`).
- **Read the newest migration, not the first.** Timestamps order them; a 2026 refactor may have rebuilt a
  subsystem the cache still describes the old way.
- **Document only real, ACTIVE features.** Omit placeholders / inactive / not-yet-shipped things (e.g.
  integration registry entries with `active: false` like QuickBooks/Sage/Zapier). Don't surface them.
- **When code and cache disagree, code wins** — and note the drift.
- **Method:** dispatch a research subagent per feature → return verified facts with `file:line` refs →
  then write. This is how every flow in the Guide was built. Don't skip it for anything non-trivial.

## Three surfaces (know which you're touching)

| Surface | Path / route | What it is | Authored? |
|---|---|---|---|
| **Guides** | `content/guides/*.mdx` → `/guides` | Editorial narrative *tours*, grouped into **flows**. Second-person, opinionated, illustrated. The journey + the "why". | Hand-written MDX |
| **Reference** | `content/docs/**/*.mdx` → `/docs` | One page per entity/concept. Scannable: tables, cards, field rows. The "what". | Hand-written MDX |
| **API reference** | `app/api-reference/[module]/[resource]` | PostgREST endpoint docs, **generated at build** from the swagger. | **Generated — do NOT hand-edit.** Edit `scripts/generate-api-docs.mjs` or the swagger schema. |

Interlink across surfaces and flows: a Guide links into Reference for detail; Reference links back to the
Guide for the story. (Guide chapters were given 12 cross-flow links — interlinking is expected, not optional.)

## Authoring workflow (every change)

1. **Research (grounded).** Subagent verifies the feature vs source + newest migrations. Get exact
   table/column/enum/transition names + `file:line`. Flag what a generic description would get wrong.
2. **Pick the surface + placement.** Guide flow + frontmatter, or Reference folder + `meta.json` order.
3. **Write in the house voice** with the surface's real components (below). Lead with a concrete example.
4. **Verify — against the user's running dev server, read-only.** They usually have `pnpm --filter docs dev`
   up. **Never** `pkill`/restart it, run `next build`, or `rm .next` under it — verify by fetching pages:
   ```bash
   cd docs
   pnpm exec fumadocs-mdx                 # regen .source if a content/frontmatter change didn't HMR
   curl -sS -X GET http://localhost:3002/docs/<slug> | grep -o "your new heading"   # confirm it rendered
   ```
   A green `pnpm --filter docs build` (`✓ Generating static pages N/N`) is the gold standard — but only in a
   clean checkout / when no dev server is running. `tsc` is noisy (a React 18/19 `@types` skew that
   `next.config` ignores) — grep your own files out of the errors rather than expecting zero.

## Guides — the flow architecture

Frontmatter (`source.config.ts` schema):

```yaml
---
title: From quote to order
description: An RFQ becomes a quote; an accepted quote becomes a sales order.
label: "(I)"          # display marker, roman numeral, per-flow
index: 0              # order WITHIN the flow (0,1,2…)
flow: quote-to-cash   # flow id (omit → defaults to "make-to-order")
flowName: Quote to cash   # flow tab label
flowIndex: 1          # order of the flow in the subnav (0 = first)
---
```

- Chapters sort by `(flowIndex, index)`. The **subnav is a flow switcher**; the **sidebar + mobile selector
  + "read next" are scoped to the active flow**. The original 5 chapters (order/build/plan/floor/ship) carry
  no flow fields and fold into `make-to-order` (flowIndex 0) via defaults.
- **Add a chapter to a flow:** same `flow`/`flowName`/`flowIndex`, next `index` + `label`.
- **Add a flow:** new `flowIndex` + `flowName`; its chapters start at `index: 0`, `label: "(I)"`.
- All chapter bodies render server-side on every page (the reader cross-fades, no route nav), so links to
  `/guides/<slug>` resolve. **No code fences in guides** (prose + components only).

**Components** (`components/editorial/mdx.tsx`):

- `<Figure illustration="flow-overview" caption="…" />` — SVG from the registry. **`illustration` MUST be a
  real key** from `components/editorial/illustrations.tsx` (else it silently renders nothing). Valid keys:
  `flow-overview, order-split, bom-tree, demand-forecast, planning-engine, shopfloor-loop, eight-d,
  traceability-graph, method-types, kit-vs-subassembly, reorder-policy, outside-processing, mes-station,
  issue-workflow, schedule-board, get-method, conversion-factor, opportunity-thread, cash-cycle,
  rfq-fanout, receive-bill-axes, wip-inflow, wip-to-cogs, depreciation-curve, asset-exit`. For anything
  without a fitting key, use `<Screenshot>` instead — don't invent keys.
- `<Screenshot label="Sales order dashboard" caption="…" ratio="wide|tall|square" />` — a standing **slot for
  a real Carbon capture**. Use it where the reader needs to see the actual UI (dashboard, a specific
  form/field, status, board, where-to-click) — not as decoration. Label the **real, current** screen + state
  precisely (verify it exists) so a real screenshot can drop straight in and the docs stay synced to the live
  Carbon UI. Default `ratio="wide"`.
- `<Callout tone="neutral|blue|green|amber" badge="WHY BATCH" title="…">body</Callout>` — the workhorse.
  Use it to carry the **Carbon-specific truth a generic description gets wrong**. Tones: blue = explanatory
  "why", green = good-to-know/outcome, amber = caution/contrast, neutral = definitional.
- `<Divider />` — closes a chapter before its wrap-up line.
- `<Term>make to order</Term>` — inline glossary term: dotted-underline; click/tap opens a popover with a
  grounded one-line definition + an optional "Learn more" link. Same component on both surfaces; definitions
  live in `docs/lib/glossary.ts`. See "Interlinking & the glossary" below.

Each `##` heading becomes a sidebar rail entry — so structure chapters as 3–5 `##` sections.

## Reference — entity pages

- Frontmatter: `title` + `description` only.
- **Nav = `meta.json` `pages` arrays** (ordered). Folders: `content/docs/{reference,platform,integrate}/`.
  Root order in `content/docs/meta.json`; a folder's order + sidebar title in its own `meta.json`
  (`{ "title": "Product reference", "defaultOpen": true, "pages": [...] }`). Add a page → add its slug to
  the folder's `pages`. **Don't list `index` in `pages`** — fumadocs treats `index.mdx` as the folder index
  and the nav renders it as **"Overview"**; listing it duplicates the title as a sibling. Integrations are
  their own top-level section (`content/docs/integrations/`) grouped by category — document only `active`
  integrations (omit `active: false` placeholders + commented-out ones).
- **Components** (`components/editorial/reference-components.tsx` + `components/mdx.tsx`):
  - `<Callout type="info|note|warn|warning|error|success|tip" title?>…</Callout>` — type → badge+tone
    (`info/note`→NOTE/blue, `warn/warning/error`→HEADS UP/amber, `success/tip`→GOOD TO KNOW/green). Note this
    is a **different Callout API** than the Guides one (type vs tone+badge).
  - `<Cards><Card title href icon?>…</Card></Cards>` — link-card grid (cross-surface navigation).
  - `<EnvVars><EnvVar name type? default? required?>…</EnvVar></EnvVars>` — field/parameter rows. The env-var
    page uses these; for an entity's **field reference** prefer `<FieldTable>` (below).
  - `<FieldTable><Field name type? required?>desc</Field></FieldTable>`
    (`components/editorial/field-table.tsx`) — the accordion field/parameter reference, the warm-paper take on
    Fumadocs' TypeTable. Use it for a `| Field | Type | Description |`-shaped table (item/job/line fields,
    routing, work-center, reorder/shelf-life policy fields, integration settings). `type` = the type token
    (omit when the table has no type column); `required` only when the source marks it so; the child is the
    description as **MDX** (so inline `` `code` ``, *italics*, `<Term>` render — that's why it's children, not a
    `type={{}}` prop). Registered in **both** `mdx.tsx` and `editorial/mdx.tsx`.
  - `<StatusFlow><Status name accent? branch? terminal?>meaning</Status></StatusFlow>`
    (`components/editorial/status-flow.tsx`) — an **interactive** lifecycle widget (selectable pills → a detail
    `Callout` showing the meaning) that replaces a linear `| Status | Meaning |` table. Children in source
    (lifecycle) order; meanings are MDX. Flags: `accent` = the single pivotal milestone (≤1, optional);
    `branch` = a temporary returnable hold (Paused, On Hold, Needs Approval); `terminal` = an off-path exit
    (Cancelled, Voided, Lost, Expired). Use it ONLY for a **linear** lifecycle — a 2-axis comparison matrix
    (e.g. invoices sales-vs-purchase) or a small enum list stays a markdown table.
  - `<PlanBadge plan="Business" />` — flags a paid feature. Whole-page gate → set `plan: Business` in
    frontmatter; renders a small **"Paid"** pill inline with the page title (label is fixed to "Paid"; the
    `plan` value only feeds the hover tooltip + the banner copy). Section gate → drop `<PlanBadge>` in-body.
    Gated features = `packages/ee/src/plan.ts`. **Don't** badge free ones (email, exchange-rates).
  - **Plan-gated pages also get a full-width announcement bar** (`components/plan-banner-bar.tsx`,
    `PlanBannerBar`) rendered by the docs **layout** (`app/docs/[[...slug]]/layout` builds a url→plan map from
    `plan` frontmatter and passes it in) — sticky under the header, spanning the content area. Adding
    `plan: Business` frontmatter is all it takes; the badge and the bar both light up. Don't hand-place a
    banner in MDX.
  - **Licensing model — get this right, it's been wrong before.** See `docs/content/docs/platform/licensing.mdx`
    (the canonical page). Editions (`packages/utils/src/types.ts` `enum Edition`): **Community** (self-host,
    AGPLv3 open core), **Enterprise** (self-host + commercial license), **Cloud** (managed). EE features =
    code under `packages/ee` or any `.ee` file → require a commercial license per the repo `LICENSE`.
    - **Carbon Cloud = the hosted SaaS at https://app.carbon.ms** — NOT the `/docs/platform/...` deployment
      docs. Self-hosting recipes (Docker with Caddy, AWS with SST) live under
      `docs/content/docs/platform/self-hosting/`.
    - **Cloud plans = Starter and Business only.** `Plan` enum also has `Partner`, but Partner is
      **internal-only — never mention it in reader-facing docs.** Don't write "Business and Partner plans".
    - **Never write "self-hosted isn't plan-gated."** The *runtime* gate is Cloud-only
      (`packages/ee/src/plan.server.ts` returns early when `CarbonEdition !== Edition.Cloud`), but the
      *license* still governs: self-hosting runs in **community mode**; Enterprise/EE features need a
      commercial license. Frame it as a license boundary, not a technical lockout — features aren't
      "disabled" in Community.
  - `<Steps>/<Step>`, `<Tabs>/<Tab>` (fumadocs-ui), markdown tables, and code fences (dark panel).
  - `<Term id?>…</Term>` — inline glossary term (dotted underline → definition popover). The same component
    as the Guide; see "Interlinking & the glossary" below.
- Voice is more technical/scannable than the Guides — fields, constraints, tables — but still names the
  gotcha and links back to the Guide for the narrative.

## House voice

- **Second person, concrete, narrative.** Anchor in the running example (the 90-unit humanoid-robot order).
  "Open the sales order dashboard." / "You don't build 90 robots as one monolithic job."
- **Quote real status names exactly**, in quotes: `**"To Ship and Invoice"**`, `**"Posted"**`, `**"Open"**`.
  Status strings live on a specific entity — confirm whether a value belongs to the *header* or the *line*
  (e.g. `"To Ship and Invoice"`/`"To Invoice"` are `salesOrderStatus`, NOT the `salesOrderLineStatus` enum
  `Ordered/In Progress/Completed`) before you attribute it, and state the transition fully (an order at
  `"To Ship and Invoice"` flips to `"To Invoice"` once everything has shipped but isn't billed — don't imply
  it sits at one value until fully closed).
- **Go easy on em-dashes.** Stacked, they read as a tic — at most one per paragraph, and never a dash-pair
  parenthetical in an opening sentence. Default to a period or comma; reach for the dash only when it truly
  beats both. ("Too many em-dashes" is the single most common copy note from review.) Applies to `caption=`
  and `title=` strings too, not just body prose.
- **Keep the running example's nouns and numbers exact.** It's the *sales order* (don't drift to a bare
  "order" when instructing the reader) and it's *90 units* (not "a robot"). Once you name the entity and the
  quantity, stay consistent every time — drift is what makes a tour feel sloppy.
- **Ground every "where to click."** When you tell the reader to act in the UI, copy the real button / modal /
  field labels from the JSX (in quotes) and confirm the capability exists *on that exact path*. A feature
  that lives elsewhere is not the same as one on the screen you're describing — "Carbon splits the order into
  three jobs" was wrong: the sales-order line's **"Make to Order"** → **"Convert Line to Job"** dialog makes
  **one** job per click (the N-jobs-of-M split is a separate bulk-jobs flow). Verify the action, not just the
  concept.
- **Callouts carry the counterintuitive truth** — the thing people get wrong. Title is a claim, body is the
  why. ("Quotes are optional — the opportunity is the thread.")
- **Explain the why, name the mistake, point to the next step.** If a paragraph does none of those, cut it.
- **Interlink** at natural seams (`[make-to-order tour](/guides/order)`).
- **Lead, don't label.** Don't open a page with a generic, repeated heading — no `## Introduction` on guide
  chapters (the chapter title is rendered for you) and no `## Why it matters` on reference pages. Open with
  1–2 substantive lead sentences, then go straight to the real sections. A heading that's identical on every
  page is filler. Landing/index pages are **"Overview"**, never "Introduction".
- **Name things as they are now.** Use a feature's current name; never narrate rename/removal history
  ("formerly item rules", "storage units used to…"). When an old name and the code disagree, the code wins.

## Interlinking & the glossary

Two linking mechanisms — use **both**, deliberately, every time you touch a page. Internal linking compounds:
a page that links out *and* glosses its jargon is worth more than the same prose in isolation.

- **Markdown links carry navigation.** Link the *noun*, inline, at natural seams; never "click here". A Guide
  links into Reference for fields; Reference links back to the Guide for the story
  (`[make-to-order tour](/guides/order)`). Cross-surface and cross-flow links are expected, not optional.
  **But link only when the destination's title echoes your anchor text.** A hard jump whose landing page has
  a different H1 disorients the reader — linking the phrase "quote to cash" to a chapter titled *From quote
  to order* got flagged as confusing. When the anchor is a *concept* (a flow name, a category) rather than a
  page literally called that, gloss it as a `<Term>` (definition popover + optional "Learn more" via `href`)
  instead of a bare link — the reader gets the meaning in place and can still navigate if they choose.
- **`<Term>` carries definitions.** Wrap a manufacturing/Carbon term a reader can hit cold (method type,
  replenishment system, WIP, outside operation, kit/subassembly…) so a click gives the gloss without leaving
  the page.
  - `<Term>make to order</Term>` slugifies the text to find the entry; `<Term id="make-to-order">made</Term>`
    when the display text differs from the slug.
  - **First occurrence per page only** — not every instance. Underlining every "order" is noise.
  - Definitions are a single source of truth: `docs/lib/glossary.ts` (`slug → { term, definition, href? }`).
    Add the entry there *before* you use a new term, and **ground the definition in source** (the prime
    directive applies — exact enum values, real behavior). Omit `href` when there's no dedicated page yet (the
    popover still shows the definition); the "Learn more" link auto-hides when it would point at the page
    you're already on.
  - Unknown slug → renders as plain text (never breaks prose) — a typo fails safe, not loud.

**Enrichment pass.** Whenever you create or edit a page, finish with a linking pass: wrap first-occurrence
jargon in `<Term>`, add markdown cross-links at the seams, and add any missing glossary entries. Cheapest way
to raise the whole site's connectivity.

## Design / styling

- **Light-only.** Warm-paper palette: page bg `#FBFBF9` / `#F5F5F2`; ink `#262323` (+ `rgba(38,35,35,0.x)`
  for faint); accent `#1E84B0` (links) / `#00B0FF` (focus/brand); hairlines `#E7E7E3` / `#E3E3DF`.
- **Inline Tailwind arbitrary values** (`text-[15px]`, `bg-[#FBFBF9]`, `border-[#E7E7E3]`) — this app is
  standalone (NOT `@carbon/react`, NOT the ERP theme). Match the surrounding component's density and colors;
  don't introduce a new palette.
- Fonts: DM Sans (body), Fira Code (mono). Callout tone fills/borders: neutral `#EFEFEB/#DADAD5`,
  blue `#DFF5FF/#A9DAF3`, green `#E4F8DA/#A8DB91`, amber `#FFF2D8/#E6CFA3`.

## Gotchas (hard-won)

- **Frontmatter is YAML — never leave an unquoted colon in a value.** A `title:`/`description:` value
  containing `: ` (colon-space) is parsed as a nested mapping and throws
  `YAMLException: bad indentation of a mapping entry`. Either quote the whole value
  (`description: "How it works: the short version."`) or reword to drop the colon (a comma/period is usually
  the better fix). **One bad frontmatter 500s the *entire* site, not just that page** — fumadocs loads the
  whole source collection at module load, so the symptom is every page (guides included) returning 500 with
  the offending `.mdx` path in the stack. This bites hardest during an em-dash sweep: replacing a
  `description:` em-dash with a colon silently breaks YAML. **`pnpm exec fumadocs-mdx` regen does NOT catch
  it** (it passes) — the only reliable check is fetching a page (any page) and seeing 200 vs 500. When you
  delegate prose edits to subagents, tell them explicitly: in frontmatter, never introduce an unquoted colon.
- **Shiki theme** (`source.config.ts` → `rehypeCodeOptions.themes`): set **both** `light` and `dark` to the
  same `"github-dark-default"`. A single `theme` (or a missing `github-light`) breaks the build for any
  `content/docs` file with a code fence (`ShikiError: Theme github-light not found`). Guides have no fences,
  so they're immune — handy for isolating a red build to the Reference side.
- **Regen `.source` before typecheck** after any frontmatter/schema change (the schema is baked into
  `.source/` at generate time).
- **Figure keys must exist** — see the list above; a typo renders nothing, silently.
- **Bare `{…}` in MDX is a JS expression.** A token in prose like `{item.id}` (e.g. inside an example rule
  message) fails the build with `item is not defined`. Wrap any literal braces/tokens in backticks: `` `{item.id}` ``.
- **`Write` blocks on existing files** — natural collision protection when a parallel session co-writes the
  docs. Just write the next uncovered gap; don't pause to coordinate unless asked.
- **`curl` GET can 405 in this sandbox** (a method-less request reads as POST) — use the WebFetch tool for
  external pages; the pnpm registry works fine.
- **Don't hand-edit the API reference** (generated) — change the generator/schema and rebuild.

## Deep-dive references (read when you reach the relevant phase)

- `references/components.md` — full component APIs for both surfaces + the illustration registry.
- `references/writing-guide.md` — the voice, the grounding rule, worked examples.
- `references/information-architecture.md` — the flow IA and the Reference `meta.json` nav.
- `references/design-language.md` — palette, fonts, the inline-Tailwind convention.

> Note: `references/scaffold.md`, `references/brand-integration.md`, and `assets/templates/*` are
> **scaffolding-era** (how the app was first stood up, with Geist/`@carbon/react`/signature-touch templates).
> The app diverged from them. **The live components in `docs/components/{editorial,api}/` are the source
> of truth** — read those, not the templates, when in doubt.

## Verification bar

Never declare docs done without: the new content rendering (in the user's running dev server, or a clean
`pnpm --filter docs build`), every internal link resolving, any new `<Term>` glossary entries grounded in
source + their popovers rendering, names matching real code, **no generic repeated
headings**, and a re-read that confirms each page says what matters / names the mistake / points onward. Then
record progress (`.claude/scratch/tasks/` + memory). **Don't kill or rebuild under the user's running dev server.**
