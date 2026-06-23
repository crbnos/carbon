# Design language (real, current)

The shipped docs are **light-only**, warm-paper, calm and editorial. The governing principle: *restraint* —
lots of whitespace, few type sizes, one accent used for meaning, motion that paces rather than performs.
Match the existing components; don't introduce a new palette or font.

> Legacy note: the old version of this file described Geist fonts, a dark mode, a "Vercel-black" base, and
> signature-touch components (reading-progress ruler, scroll-reveal, chapter rail, interactive checklist,
> framed media). **None of that shipped.** The real system is below.

## Palette — warm paper (light only)

| Role | Hex |
|---|---|
| Page background | `#FBFBF9` |
| Paper / header / nav surface | `#F5F5F2` |
| Ink (body) | `#262323` (+ `rgba(38,35,35,0.7)` / `0.55` / `0.42` for fainter) |
| Accent — links | `#1E84B0` |
| Accent — focus / brand highlight | `#00B0FF` |
| Hairline border (primary) | `#E7E7E3` |
| Hairline border (subtle / inputs) | `#E3E3DF` |

Callout tone fills/borders (Guide `Callout`): neutral `#EFEFEB`/`#DADAD5`, blue `#DFF5FF`/`#A9DAF3`,
green `#E4F8DA`/`#A8DB91`, amber `#FFF2D8`/`#E6CFA3` (text `#3583A8`/`#4F9140`/`#9C7136`).

There is **no dark mode**. `source.config.ts` even maps both shiki "light" and "dark" to
`github-dark-default` because the site is light-only (and a real `github-light` would break the build).

## Fonts

- **Body:** DM Sans. **Mono:** Fira Code (`--font-mono`). (Not Geist.)
- Inline code: Fira Code, quiet bg `rgba(38,35,35,0.055)` + 1px border.
- Code blocks: dark panel (`github-dark-default`) — used on Reference/API surfaces, not in Guides.

## Styling convention — inline Tailwind arbitrary values

This app is **standalone** — it does **not** import `@carbon/react`, the ERP theme, or shared tokens. Styling
is **inline Tailwind arbitrary values**: `text-[15px]`, `bg-[#FBFBF9]`, `border-[#E7E7E3]`,
`text-[rgba(38,35,35,0.7)]`, `rounded-[12px]`, `font-[530]`. When you add or edit a component, **match the
surrounding component's exact values** (sizes, weights, colors, radii) — copy from a sibling rather than
inventing. New `bg-*`/`text-*` palettes are how the warm-paper coherence breaks.

## Layout anatomy

**Shared header** (`components/main-header.tsx`, fixed, `#F5F5F2`, bottom hairline): Carbon wordmark left
(the `carbon-word-light.svg` lockup — mark + "carbon"), primary nav (Guides · Reference · API · MCP),
⌘K search, one dark "Open Carbon" CTA right.

**Guide page** (`how-to-layout.tsx`):
- *Flow subnav* (top, under header) — the flow switcher.
- *Left sidebar* (desktop ≥1000px) — the **active flow's** chapters, each with its `##` section dots
  (`sidebar-nav.tsx`). Active section tracked by scrollspy.
- *Center column* — `max-w-[620px]` reading measure; a small `label — SLUG` eyebrow pill above the body; the
  chapter MDX; a "read next (within flow)" link.
- Chapter/flow switches animate via the **View Transitions API** (reduced-motion → instant). This crossfade
  is the one real "signature" motion — there is no progress ruler or scroll-reveal.

**Reference page** (`app/docs/layout.tsx`): left `DocsNav` sidebar (280px) · center prose · right
"On this page" TOC (232px, ≥xl). Active nav link: `bg-[rgba(0,176,255,0.10)]` + `text-[#1E84B0]` + `font-[530]`.

**API reference** (`app/api-reference/layout.tsx`): left config + nav · center 3-col endpoint docs · right TOC.

## Visual rhythm

- One idea per screen in Guides; whitespace separates thoughts. Generous heading spacing (`pt-[44px]`+).
- Guide `##` headings are large editorial titles (`text-[32px]`/`md:text-[40px]`); body `text-[15px]`,
  leading ~1.6.
- `<Figure>` (registry SVGs) and `<Screenshot>` (placeholder frames) sit in rounded, hairline-bordered cards
  with a centered caption — the "framed media" treatment, built into the components.
- Tabular numerals where figures align (quantities, costs).

## Motion

- View Transitions crossfade on chapter/flow switch (the reader). Reduced-motion → instant swap.
- Hover: quick (~150–200ms) color/translate nudges on links/cards (e.g. arrow `group-hover:translate-x-[2px]`,
  chevron `group-data-[state=open]:rotate-180`).
- Nothing loops or animates on a timer.

## Do / don't

**Do:** match the surrounding component's exact arbitrary values; keep the warm-paper palette; lead Guide
chapters with a strong opinionated paragraph; one accent (`#1E84B0`) for interactive/active states.

**Don't:** import `@carbon/react` or ERP theme tokens here; add a dark mode or a second accent/font; invent
`bg-*`/`text-*` colors; add code fences to Guide chapters; reach for the legacy template components — the live
components in `docs/components/{editorial,api}/` are the source of truth.
