# Carbon look — tokens, typography, palette

Matching the product's own chrome is what makes slides read as Carbon rather
than as generic motion graphics. Do not eyeball colours — read them from source.

## Read the tokens at build time (they drift)

Carbon's themes live in `packages/utils/src/themes.ts` — 8 themes, each with a
light and dark block of HSL values. They change; a hardcoded hex goes stale (the
`background` token already drifted once between builds). At the START of a build,
read the theme the user wants and convert its HSL to hex:

```bash
# list the themes and their labels
grep -nE 'name: "|label: "' packages/utils/src/themes.ts
# then read the block for the chosen theme, e.g. Blueberry (name "blue"):
sed -n '/name: "blue"/,/^  },/p' packages/utils/src/themes.ts
```

Convert each `H S% L%` to hex (HSL→RGB). The tokens you need for a video:

| Token | Role in the video |
|-------|-------------------|
| `background` | slide canvas + `background_color` on every clip |
| `card` | ledger/data card fills, caption pill fill (it is DARKER than the canvas by design) |
| `border` | hairlines on cards, dividers, pills |
| `foreground` | primary text |
| `muted-foreground` | secondary text, captions, sub-labels |
| `primary` | the single accent — loader rings, one highlight. Use sparingly |
| `ring` | a calmer accent alternative to `primary` when `primary` reads too hot |

Blueberry dark, at time of writing (VERIFY against source — do not trust these
blind): background ≈ `#0D0F12`, card ≈ `#090A0B`, border ≈ `#24272D`,
foreground ≈ `#F2F2F2`, muted-foreground ≈ `#A1A4AA`, primary ≈ `#0D6DFD`,
ring ≈ `#154080`.

The default `zinc`/"Modern" theme is deliberately achromatic (near-black, no
hue) — good when the user wants restraint. Blueberry adds a blue accent. Match
whichever theme the user will record the APP in; the slides and the app chrome
must be the same palette or the cut looks broken at every boundary.

## Typography

- **Geist** (headings/body) and **Geist Mono** (numbers, ledger rows, ids) — from
  the `non.geist` / `non.geist/mono` imports in `apps/erp/app/styles/tailwind.css`.
- In Clueso text: `font_setting: {font: "Geist", weight: "600"}` for headings,
  `"500"` for body/captions, `{font: "Geist Mono", weight: "500"}` for any row of
  figures. Monospace + fixed-width padding makes debit/credit columns align
  without per-element positioning.
- Headings ~88px with tight tracking (`letterSpacing` ~ -1.76); captions ~42px;
  ledger rows ~34px; sub-labels ~22px in `muted-foreground`.

## Backgrounds

Near-black with dim accent light, NOT a saturated field. Three motifs to vary
across a video so it isn't one loop reused:

- **aurora** — a few large heavily-blurred accent blobs drifting on curved paths
- **drift** — sparse parallax dots rising + soft diagonal glow bands
- **bokeh** — out-of-focus accent circles breathing, one slow light sweep

Keep every blob DIM (10–20% opacity) so the frame still reads near-black. And
forbid grain explicitly (see `clueso-mcp.md`).

## Recording the app to match

Tell the user to set the app to the SAME theme + mode (dark) before recording.
A light app dropped between dark slides is the most common "looks broken" note.
The reference marketing videos (Linear, OpenAI, Claude) are single-palette end to
end — that consistency is most of the polish.
