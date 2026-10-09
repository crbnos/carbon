paths:
  - "docs/content/changelog/**"
  - "docs/components/changelog-*.tsx"
  - "docs/lib/changelog*.ts*"
  - "docs/app/changelog/**"

# Authoring a changelog entry

One MDX file per dated entry in `docs/content/changelog/`, named
`YYYY-MM-DD-slug.mdx`. Carbon has no versions, so `date` is the ordering key and
the filename's date must match the frontmatter's.

The entry is read in **four** places, which is what constrains the format:

| Surface | Shows | Built by |
|---|---|---|
| `/changelog` feed | hero `image` + `title` + `description` + first 3 tags | `changelog-feed.tsx` |
| `/changelog/<slug>` | the full body | `[slug]/page.tsx` |
| `/changelog/rss.xml` | `description` **and** the full body as HTML | `rss.xml/route.ts` |
| ERP "What's new" panel | `title` + `description` | `getChangelogPanelEntry` |

So `description` is not a summary you can skip — it is the whole feed row, the
newsletter blurb and the in-app toast.

## Frontmatter

```yaml
---
title: "Returns, operation batching, and the Carbon API"
description: "Customer RMAs and supplier returns, job operations that run as one batch, and the Carbon API over plain HTTP."
date: "2026-09-18"
tags: ["sales", "purchasing", "production"]
---
```

- **`title`** — names the things that shipped, not a slogan.
- **`description`** — **15–20 words, one or two clauses.** It is the entire feed
  row; a 40-word run-on is a wall there. Use `Plus …` to gather the tail
  (`"Draft an engineering change … Plus inventory valuation and assembly instructions."`).
- **`tags`** — most important first; the feed shows only the first three.
- **`image`** — optional hero, a path under `docs/public/changelog/`. Rendered above the
  title on both the feed row and the entry page, and it carries a shared
  `view-transition-name` so the card morphs between them.

## Thumbnails

**Hand-built in VectorCraft, one per entry, every one different.** A hero is one
**subject drawn from what that entry changed**, made of frosted glass and light,
floating over a soft grainy gradient on black. The shared look (canvas, glass recipe,
type, grain) keeps the feed reading as one set; the subject and the gradient change
every time, so no two entries look alike.

**How a hero is built.** Each hero is one composed SVG. A small Python generator writes
it: the background and everything drawn behind the glass (washes, ribbons, arcs,
glows) is **rendered as a raster in numpy** at 2400 × 1350, using exact gaussian blurs,
screen and normal compositing, and dithering. A second, pre-blurred copy of that raster
is clipped to each glass shape. The glass tints, borders, chips and labels stay vector
on top, and the grain is an overlay image. VectorCraft only opens and exports it
(`vectorcraft-cli convert hero.svg out.png --scale 2`), with no VectorCraft blur
anywhere (see the pitfalls below for why). The generator lives outside the repo.

Geist must be installed for VectorCraft to see it: convert
`node_modules/.pnpm/non.geist@*/…/fonts/{sans,mono}/static/*.woff2` to TTF (fontTools +
brotli) into `~/Library/Fonts`, then run `text.rescanFonts`.

`docs/scripts/generate-changelog-thumbnail.mjs` is superseded. It still rewrites
`<slug>.svg` for every entry when run, but never touches an `image:` that is already
set, so a hand-built `.jpg` survives a rerun. Do not use it for new entries.

### The subject — one per entry, from the change itself

Read the entry and the code it describes, then pick the single object that *is* the
change. Never default to a table. Examples:

| Entry | Subject |
|---|---|
| MRP planning actions | the planning-actions worklist as a glass table (action types and icons from `PlanningActionLines.tsx`) |
| A faster Carbon | one big number: "686" in frosted-glass Geist Light, "→ a few" beside it, a one-line caption and two small stat pills (9 → 1, 427 KB → 1.2 KB). A waterfall chart was tried first and rejected — it needs chart literacy to read |
| Outbound scheduling | shipping routes over a horizon: glowing arcs from one plant to destinations on a globe, each landing under a glass chip with city, ship-via and day (one late date in red), and an "Outbound · Next 7 days" pill |

Rules for the subject:
- **Grounded.** Labels, statuses, icons and numbers come from the entry or the shipped
  code (`OutboundTable.tsx` columns, `PlanningActionLines.tsx` types, the entry's own
  figures). Never invent a feature fact; where there is no number, show no number.
- **Synthetic data.** Invented part, PO, job numbers and cities; "Jane Doe" for a
  person. Never real tenant or customer data, never a third party's logo. Check that a
  weekday matches its date.
- **Few words.** A caption or a few short labels, readable at feed size — never a page.
- **One idea, readable in a second.** One subject, generous negative space. If it
  needs explaining (a developer chart, an unlabelled axis), it is the wrong subject —
  prefer the outcome itself: a number, an object, a place.
- **The gradient is optional.** A frosted, textured treatment with a soft haze or no
  colour at all is fine when it serves the subject better.

### Shared look — the same on every hero

- **Canvas:** 1200 × 675 artboard on `#000000` (keep a black base rect under
  everything, separate from the gradient group, so moving the gradient never exposes
  the artboard). Export at 2× (2400 × 1350) as **JPEG quality 86** to
  `docs/public/changelog/<slug>.jpg` (0.3–0.7 MB) and set
  `image: "/changelog/<slug>.jpg"`. Not PNG (the grain makes it 3–4 MB), not SVG.
  Keep the generator and its layer PNGs out of git.
- **Everything merges — no hard edges.** The subject must sit *in* the light, not on
  top of it:
  - the gradient passes behind the subject, so the glass picks up its colour;
  - every glass shape gets a soft glow of the palette colour beneath it (the shape
    filled, gaussian σ ≈ 7 pt, screen, 30–45 %);
  - lines and dots glow (a wide blurred copy under a thin bright core);
  - borders are faint gradient highlights, never solid outlines;
  - secondary or "before" elements fade out through an opacity mask, never stop.
- **Glass recipe**, for any shape (a card, pills, chips, a panel), back to front:
  1. the background raster (gradient + anything drawn behind the glass, such as
     arcs) blurred with a gaussian σ ≈ 11 pt, clipped to the glass shape — all glass
     shapes of one depth can share one compound clipping path;
  2. a tint: the same shape filled with a near-black **of the palette's hue** — navy
     `#040A2E` (blues), plum `#120A24` (violets), `#03140F` (greens), `#140806`
     (warm), Carbon card `#0B0909` (neutral) — at 50–64 % opacity, so the glass stays
     coloured, not grey;
  3. a 1 px border, white gradient ~40 % → ~15 % corner to corner (lower for receding
     glass).
- **Type is Geist**, Carbon's UI font (Geist Mono for codes and step labels). Primary
  text `#EDEDED`–`#F4F4F5` Medium; secondary `#A1A1A1` (muted-foreground); a late or
  failing value in red `#FF5C5C`–`#FF6B6B`.
- **Badges and icons:** Lucide icons at 12–15 px, 1.3–1.4 stroke; badges 18–24 px
  tall, radius 5–6, white 7 % fill + white 11–22 % stroke.
- **Grain:** a 2400 × 1350 noise image
  (`ffmpeg -f lavfi -i color=c=0x808080:s=2400x1350 -vf "noise=alls=70:allf=u,format=gray" -frames:v 1 grain.png`)
  placed full-frame on top of everything, blend **overlay**, opacity 14 %.
- **Checks:** at 2× zoom the text is crisp through the grain and nothing is
  misaligned; at feed scale (672 px wide) the subject still reads.
- **Alignment is computed, not eyeballed.** Position text from Geist's metrics
  (cap height 0.71 em; advance widths and side bearings from the TTFs with
  fontTools), so every rule below holds to under 1 px:
  - an icon's centre sits on its text's cap-centre (`baseline − 0.355 × size`), and
    a header's icon, title and button share one centre line;
  - a two-line block (title + subtitle) is centred on its icon tile, and the tile on
    its card; a small inline icon beside a two-line item aligns to the first line;
  - text in a pill, chip or button is centred vertically, with equal left and right
    padding: size the shape to its content, or, when glass behind fixes the width,
    centre the content in it;
  - a nested pill is concentric with its container (equal top and side padding);
  - stacked texts and icons in one column share an ink edge, not an `x` (large
    light type has visible side bearings), and a caption aligns to the edge of the
    element it labels.

Rendering pitfalls (each one shipped as a visible defect before it was understood):
- **VectorCraft renders a Gaussian blur above a radius of about 40–50 at reduced
  resolution and scales it back up unsmoothed**, so a big soft wash turns into a staircase of square
  tiles, seen as "sharp edges" in dark blues. Never build washes from big blurs: use a
  radial gradient that fades to 0 with a gaussian-shaped stop curve, or the raster
  renderer.
- **SVG `feGaussianBlur` filters import unreliably**: in some layer stacks the blurred
  element is shifted, clipped to its own bounding box, or dropped entirely. Never put a
  blur filter in the SVG; render blurred layers as rasters.
- A blur is rasterised only ~1.5 × its radius past the shape, so a large blur on a bright
  background ends in a straight edge. The raster renderer has no such limit.
- The SVG importer measures `text-anchor="end"` text as if it started at `x`, which
  widens the art bounds and makes `file.place` with `rect` shrink the layer. Check
  `file.place.info`; when the width exceeds 1200, place with `at: [width / 2, 337.5]`
  instead. (Opening a composed SVG directly is unaffected.)
- Rotate a glass shape by rotating only its clipping path, tint and labels, never the
  blurred background copy inside the clip.
- Check every hero with its shadows lifted (gamma ≈ 0.4) before shipping: tiles, cut-offs
  and banding that hide at normal exposure jump out, and so do they on some screens.

### Variation — every hero must differ

1. Each entry takes a **subject of its own** and a **style + palette pair** no earlier entry used. Never repeat a pair.
2. Consecutive entries never share a style or a dominant hue.
3. **Rotating, flipping or mirroring an earlier gradient is not a new style** — the
   flow shape itself must change.
4. Alternate coverage: full-frame gradients and partial ones (gradient on part of the
   frame, black elsewhere).
5. Brand cyan `#00B0FF` leads the palette at most every third entry; otherwise it is an
   accent or absent.
6. Add the entry to the log below in the same change, so rules 1–5 can be checked.

**Styles** (add new ones freely; each is a recipe, not a template):

| Style | Shape | Coverage |
|---|---|---|
| Silk ribbons | 3–4 tapered ribbons, a dark fold, thin edge highlights | full |
| Wave bundle | 5–7 thin parallel ribbons riding one S-wave across the frame, over a halo of stacked wide bands | full |
| Fold | one wide sheet of light folding across the frame: an upper and a lower sheet with a dark crease between | full |
| Horizon | soft atmosphere above a planet arc, the rim lit in stacked glow layers | full |
| Liquid | a warm or cool light field with soft dark pools (radial washes, never blurred blobs) and a lit wave along one edge | full |
| Diagonal stream | one ribbon from a corner to an edge, halo + core | partial |
| Arc sweep | one stream arcing in from an edge, over the top, and down behind the subject | partial |
| Corner bloom | radial fill from a corner with a lit wave crest | partial |
| S-wave band | a horizontal S band; top and bottom stay black | partial |
| Spill | a liquid spill from a corner with a dark tongue | partial |
| Plume | a vertical rising plume that tapers | partial |
| Light trails | 6–8 long-exposure streaks in one curved bundle, each fading in from its tail; a wide blurred glow underneath | partial |

Retired, do not reintroduce: **Aurora**, **Mesh**, **Orb**, **Twin ribbons**, **Crossing sweeps** and **Photo**
(stock photography). Liquid stays, but only as on Ramp: dark pools in a light field, not voids with halos. They read as dated, blobby or busy next to the ribbon
styles, and the gradient-and-glass look is the house style.

Ribbons are tapered by generating them from a centre Bézier with a width profile
(`w0 + (w1 − w0)·t + wmid·sin(πt)`). Gaussian σ in points: a halo 12–18 (built from
4–6 stacked widening bands), a ribbon 8–12, a bright core or crest 2–5, an edge
highlight about 1, in screen blend. Washes are radial gradients, never blurred shapes.

**Palettes** (stops, dark → light):

| Palette | Stops |
|---|---|
| Blue–lilac | `#0B1E5B #1F4FD8 #00B0FF #8C7CF0 #D9D2FF` |
| Sky liquid | `#02021A #2F45F5 #3E5CFF #6FBFF8 #7ACBFA` |
| Brand cyan | `#0B3A66 #1E84B0 #00B0FF #C8F2FF` |
| Violet–peach | `#2A1060 #7B3FE4 #F35FAA #FFD9BC` |
| Emerald | `#033D3A #0E9F8A #10B981 #D9FBE8` |
| Amber–rose | `#5A1030 #F0446A #FFA24A #FFE9B8` |
| Cyan + violet | `#6D4CFF #00B0FF #D2F5FF #E4DBFF` |
| Silver | `#334155 #94A3B8 #CBD5E1 #FFFFFF` |
| Champagne gold | `#0E0803 #5E3E14 #9A5B12 #C79E55 #F6E2B0` |
| Sunrise orange | `#0A0402 #C2410C #F26B1D #FFB36B #FFE7C7` |
| Teal–lime | `#02201C #0F766E #2DD4BF #84CC16 #D9F99D` |

**Reference recipe — silk ribbons, blue–lilac** (the MRP hero's gradient), back to front in one group:

| Layer | Shape | Paint | Blur | Blend |
|---|---|---|---|---|
| Ambient washes | two radial gaussian washes, lower left and upper right | `#1A2A8C`, `#6D5BD0` | — | normal 70 %, 45 % |
| Wide sweep | tapered ribbon over a stacked halo, bottom-left → top-right | `#0B1E5B → #1F4FD8 → #00B0FF → #8C7CF0 → #1A1440` | σ 12 | normal |
| Dark fold | narrow ribbon between the sweeps | `#000000` | σ 8 | normal 75 % |
| Lilac ribbon | ribbon, lower right | `#231E66 → #7E6BE6 → #D9D2FF → #8F86C9` | σ 11 | screen 75 % |
| Bright fold | narrow ribbon crossing the card | `#0A3D8F → #3FC6FF → #F0F8FF → #7C9BFF` | σ 5 | screen 85 % |
| Fold edges | three curves, 2.2 px strokes | white, `#BFE9FF`, `#EDE7FF` | σ 1 | screen 40–70 % |
| Vignette | full-frame rect | radial black 0 → 10 % (mid) → 85 % (edge) | — | normal |

**Log** — one row per entry:

| Entry | Subject | Style | Palette | Coverage |
|---|---|---|---|---|
| 2026-03-31 Time clock, Quality dashboard | The MES My Hours card: Clock In / Clock Out / Duration rows, one Active, a total and a Clock Out button | Diagonal stream | Champagne gold | partial |
| 2026-04-14 MCP server, passkeys, Console mode | A frosted fingerprint disc above a Sign in with Passkey button | Wave bundle | Violet–peach | full |
| 2026-04-28 Inbound inspections, pricing rules, storage units | The Storage Units tree: warehouse → rack → shelf → bins, with storage-type chips | Spill | Emerald | partial |
| 2026-05-12 Multi-entity, storage rules, shelf life | The Rule Violation modal: one error, one warning, Confirm disabled | Silk ribbons | Brand cyan | full |
| 2026-05-26 Fixed assets, redesigned PDFs, sidebar | A frosted purchase order page (Purchase Order: PO…) fading off the bottom | Arc sweep | Sunrise orange | partial |
| 2026-06-09 Rework, purchasing planning, ballooning | A serial part's path: Inspection Fail → Rework (job operation) → Inspection Pass, the arc red to amber to green | Silk ribbons | Teal–lime | full |
| 2026-06-23 Picking lists, labels, supersession | A frosted picking list: storage-unit chips, picked / short lines, In Progress | Corner bloom | Amber–rose | partial |
| 2026-07-07 Period closing, payments, backups | A row of frosted month tiles: Closed, Locked, Open | Fold | Sky liquid | full |
| 2026-07-21 Change notices | A frosted change-notice diff on the Bill of Materials tab: one line removed, one added, one quantity changed | Plume | Silver | partial |
| 2026-08-04 Carbon agent | The agent acting on the app: a chat with a reply, action chips and an Open J-000412 link, joined by light to the paused job card and a "Jane Doe was notified" toast | Silk ribbons | Violet–peach | full |
| 2026-08-18 Automation workflows | The builder canvas: trigger → condition → two actions on a dot grid, Published | None (dot grid on black) | — | none |
| 2026-09-04 Finite-capacity scheduling | A frosted Gantt with a Waited slot and the Work Center Reservation popover | Fold | Sunrise orange | full |
| 2026-09-18 Returns, batching, Carbon API | A detailed frosted parcel (tape, shipping label with barcode and RMA number, this-side-up arrows) with a cyan stream (customer RMA) in and a violet one (supplier return) out | Diagonal stream | Cyan + violet | partial |
| 2026-09-28 Ramp, batch materials, community edition | A frosted card whose charges flow into a Charges ledger | Liquid | Champagne gold | full |
| 2026-09-30 Inspection gauges | The frosted gauge picker (Caliper - Outside; one out of calibration) and a "measured with" chip | Arc sweep | Silver | partial |
| 2026-09-30 Outbound scheduling | Shipping routes over a globe | Horizon | Emerald | full |
| 2026-10-05 A faster Carbon | One big number (686 → a few) in frosted glass | Light trails | Amber–rose | partial |
| 2026-10-07 MRP planning actions | Planning-actions glass table | Silk ribbons | Blue–lilac | full |

## Body — concise, useful, linked

Modelled on Linear's and Commit's changelogs. The failure mode to avoid is what
these entries used to be: 100-word unbroken paragraphs, no links, no idea where
in the product the thing lives.

1. **Lead with why, then what** — one or two sentences before the first `##`.
   Name the problem, then the thing that solves it.
2. **One `##` per feature, 1–3 sentences.** Keep a paragraph under ~60 words. If
   it needs more, it wants a bullet list.
3. **Link the feature to its reference page on first mention.** There are ~94
   pages under `docs/content/docs/reference/` — check for one before writing a
   bare noun. `find docs/content/docs -name '*.mdx'` is the index.
4. **Say where it is** when the entry knows: `Automate → Workflows`,
   `Account → Notifications`. Do not invent a path you have not verified.
5. **State plan gating inline** — "available on the Business plan".
6. **`<Accordion title="Improvements">` / `"Fixes"` last**, one line per bullet.
   On the entry page these render expanded (`ChangelogSection`), not collapsed.

**Never invent a product fact to fill the shape.** An entry describes what
merged; if you cannot verify a detail, leave it out.

## Components available

An entry is ordinary MDX with the full editorial vocabulary — `Callout`,
`Screenshot`, `Steps`/`Step`, `Cards`/`Card`, `PlanBadge`, `Term`, `Figure`,
`Accordion`, code fences, tables.

**Every component an entry uses needs a plain-HTML stand-in in
`docs/lib/changelog-feed-components.tsx`.** Feed readers and mail clients run no
components. A component missing from that map renders `undefined` and **fails the
build** — deliberately, because a newsletter that silently drops a section is
worse than a red build. Adding a component to the vocabulary means adding its
degrade there in the same change.

Note `Callout` here is the Reference one — `{ type, title, children }` — not the
Guides variant with `tone`/`badge`.

## Checks before committing

```bash
pnpm --filter docs typecheck
curl -s localhost:3002/changelog/rss.xml | grep -c '<item>'   # every entry still renders
```

Every internal link must resolve — a `/docs/...` path with no matching file 404s
silently in the feed and the newsletter:

```bash
cd docs && for l in $(grep -oh "](/docs/[^)]*)" content/changelog/*.mdx \
  | sed 's|](/docs/||;s|)||' | sort -u); do
  [ -f "content/docs/$l.mdx" ] || [ -f "content/docs/$l/index.mdx" ] \
    || echo "MISSING $l"; done
```
