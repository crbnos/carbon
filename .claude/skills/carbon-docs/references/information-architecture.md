# Information architecture (real, current)

How the shipped docs are organized. The governing rule still holds:

> **Organize around what the reader is trying to do, not how the product is built.**

But the *mechanism* is specific to this app — read it from the live files, not generic Fumadocs lore.
The Guide and Reference use **different nav systems**.

## Guide — flow-based, frontmatter-driven (NO meta.json)

The Guide is a set of **flows**. A flow is a self-contained narrative tour (a reader goal): *make-to-order*,
*quote-to-cash*, *rfq-to-bill*, *manufacturing-accounting*. Each flow is an ordered set of chapters.

Navigation is driven **entirely by frontmatter** (`source.config.ts` schema) — there is no `meta.json` for
guides:

```yaml
label: "(II)"            # roman-numeral marker, per flow
index: 1                 # order within the flow
flow: quote-to-cash      # flow id (omit → defaults to make-to-order)
flowName: Quote to cash  # subnav tab label
flowIndex: 1             # flow order in the subnav (0 first)
```

How it renders (`app/guides/[chapter]/page.tsx` + `components/editorial/*`):
- Chapters sort by `(flowIndex, index)` → each flow is contiguous.
- **Subnav = a flow switcher** ("How to · Make to order · Quote to cash · …"), built by `flowsOf()`.
- **Sidebar + mobile selector + "read next" are scoped to the active flow** via `chaptersInFlow()`. The
  sidebar lists that flow's chapters and each chapter's `##` sections.
- All bodies render server-side; switching flows/chapters cross-fades (View Transitions), no route nav.

**To add a chapter:** new `.mdx` in `content/guides/`, same `flow`/`flowName`/`flowIndex`, next `index`+`label`.
**To add a flow:** pick the next `flowIndex` + a `flowName`; its chapters start `index: 0`, `label: "(I)"`.
The original 5 chapters carry no flow fields and fall into `make-to-order` (flowIndex 0) by default.

Keep a flow to ~2–5 chapters; a chapter to 3–5 `##` sections. If a chapter sprawls, split it.

## Reference — meta.json membership + `REFERENCE_GROUPS` placement

`content/docs/**` → `/docs`, rendered through a **custom `DocsNav`** (`components/api/docs-nav.tsx`), not
the stock Fumadocs sidebar.

Folders today: `reference/` (the entity pages — "Product reference"), `platform/` (architecture/deployment/
env/licensing), `building/` (API keys, webhooks, local development), `integrations/` (by category).

The nav is built by `app/docs/layout.tsx`, and it is TWO layers:

1. **Membership** — a folder's `meta.json` `pages` array says what's in the folder. But `toNav()` sorts
   every folder's children **alphabetically**, so meta.json order does NOT control display order.
2. **Grouping** — the flat Product-reference list is nested into sidebar groups ("Items & methods",
   "Production", "Sales", …) by the hardcoded `REFERENCE_GROUPS` slug map in the same `layout.tsx`.
   Group order and within-group order follow that map. A reference slug missing from the map is
   appended **ungrouped after all the groups** — visible, but dangling at the bottom of the rail.

**To add a Reference page:** create `content/docs/<folder>/<slug>.mdx` (frontmatter = `title` +
`description`, + `plan` if paid-gated), add `<slug>` to the folder's `meta.json` `pages`, **and** — for
`reference/` — add it to the right `REFERENCE_GROUPS` group in `app/docs/layout.tsx`. No fitting group
means proposing one, not skipping the step.

One page **per entity/concept** (one-noun-per-page). Slugs: short, kebab-case, stable (URLs are a contract).

## API reference — generated, not authored

`/api-reference` is built from the PostgREST swagger by `scripts/generate-api-docs.mjs` (runs on
`predev`/`prebuild`). One page per table, grouped by module. **Don't hand-author** — change the generator or
the swagger schema.

## Page taxonomy

Decide a page's type up front; mixing them is what makes docs confusing.

The four types (and their ask-the-user-first rule) live in SKILL.md — this is the same taxonomy:

| Type | Surface | Answers | Shape | Budget |
|---|---|---|---|---|
| Flow / tour | Guide | "walk me through ___" | narrated, sequenced, illustrated, opinionated | length serves the story |
| System / entity | Reference | "how does ___ work — fields, statuses, rules?" | lead → `<StatusFlow entity=…>` → Callouts → `<FieldTable>` → `<Cards>` | ~800–1,500 words |
| Settings / how-to | Reference | "how do I turn ___ on / use it?" | lead → `<Steps>` → one gotcha Callout → where-it-lives | ~300–600 words |
| Concept / overview | either | "what is this area?" | short intro + `<Cards>` | ~150–300 words |

Don't put exhaustive field tables in a narrative chapter — link out to the Reference page. Don't put
motivational narration in a field table — link back to the Guide.

## Cross-linking IS the architecture

The two surfaces only work stitched together — and the Guide flows must interlink with each other:
- Guide → Reference for the fields; Reference → Guide for the story (`<Cards>` / inline links).
- Guide flow → Guide flow at natural seams (`[make-to-order tour](/guides/order)`,
  `[quote-to-cash](/guides/order-to-cash)`). The shipped Guide has ~12 cross-flow links.
- No dead ends — every page offers an obvious next move (the reader auto-gets "read next" within a flow).
