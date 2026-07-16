# OKLCH Color Migration for Tailwind CSS v4

Research summary — July 2026. Written for the Carbon ERP codebase (React + Tailwind).

---

## TL;DR

Tailwind v4 moved its **entire default color palette** from RGB/hex to OKLCH. All 22 color scales (red through stone) are now defined as `oklch(...)` values. If you're on v4, you're already consuming OKLCH whether you know it or not. The question isn't "should we adopt OKLCH" — it's "should we align our *custom* colors with the system Tailwind already uses."

---

## 1. What Exactly Changed in Tailwind v4

### Default palette → OKLCH

Every built-in color in Tailwind v4 is defined in OKLCH. Here's what `theme.css` looks like now:

```css
@theme {
  --color-red-50:  oklch(0.971 0.013 17.38);
  --color-red-100: oklch(0.936 0.032 17.717);
  --color-red-200: oklch(0.885 0.062 18.334);
  --color-red-300: oklch(0.808 0.114 19.571);
  --color-red-400: oklch(0.704 0.191 22.216);
  --color-red-500: oklch(0.637 0.237 25.331);
  /* ... and so on for all 22 color scales × 11 shades */
}
```

In v3, these were hex/RGB values. The v4 release blog calls this a **"Modernized P3 color palette"** — the colors have been refreshed to take advantage of wider gamut displays while maintaining the same general balance.

### Opacity via `color-mix()`

Tailwind v4 uses `color-mix(in oklab, ...)` for opacity modifiers like `bg-blue-500/50`. This is a modern CSS feature — no more separate opacity custom properties.

### CSS-first configuration with `@theme`

Colors (and all design tokens) are now configured in CSS via `@theme`, not in `tailwind.config.js`. Custom colors use the same `--color-*` namespace:

```css
@theme {
  --color-brand-500: oklch(0.65 0.19 250);
  --color-brand-600: oklch(0.55 0.18 250);
}
```

These automatically generate utility classes like `bg-brand-500`, `text-brand-600`, etc.

### What they kept

- All the familiar color *names* (red-50 through red-950, etc.) are unchanged
- The visual appearance is intentionally similar — they tried to keep the "balance between all the colors the same as it was in v3"
- Old hex/RGB values still work if you define custom colors with them

---

## 2. Why OKLCH > HSL (Practical Benefits)

### Perceptual uniformity — the big one

HSL lies to you about lightness. In HSL, `hsl(220 60% 50%)` (blue) and `hsl(110 60% 50%)` (green) both claim 50% lightness, but the green looks **dramatically brighter** to human eyes.

OKLCH fixes this. Same lightness value = same *perceived* brightness:

```css
/* These look equally bright to human eyes */
oklch(0.55 0.15 260)  /* blue */
oklch(0.55 0.15 141)  /* green */

/* In HSL, you'd need totally different L values to match perceived brightness */
hsl(220 60% 42%)  /* blue - had to lower L */
hsl(110 60% 50%)  /* green - L stays at 50% */
```

**Why this matters for Carbon:** When you're building a manufacturing ERP with lots of status colors (success/warning/error/info), dashboard charts, and data tables, having colors that are *perceptually consistent* at the same lightness level means:
- Text on colored backgrounds has predictable contrast
- Color-coded severity levels look equally prominent
- Dark mode inversions don't randomly make some colors pop more than others

### Dark mode consistency

With HSL, creating dark mode variants often requires manual per-color tuning because "lightness 30%" means different things for different hues. With OKLCH, you can systematically invert lightness and get predictable results:

```css
/* Light mode: L=0.95 for backgrounds */
--color-surface: oklch(0.95 0.01 250);

/* Dark mode: just flip lightness */
--color-surface: oklch(0.20 0.01 250);
```

The chroma and hue stay the same, and the lightness axis is truthful.

### Palette generation

OKLCH makes generating harmonious color scales algorithmic rather than artisanal:

```js
// Generate a 10-step palette by varying lightness
const lightness = [0.97, 0.93, 0.88, 0.82, 0.74, 0.64, 0.57, 0.46, 0.39, 0.32, 0.23];

function generatePalette(chroma, hue) {
  return lightness.map(l => `oklch(${l} ${chroma} ${hue})`);
}

// All palettes generated this way will have
// visually consistent brightness steps
generatePalette(0.19, 250);  // blue scale
generatePalette(0.19, 25);   // red scale
```

This is huge for dynamic theming — Evil Martians wrote extensively about using OKLCH + CSS variables to build theme systems where users pick a hue and the entire palette generates consistently.

### P3 wide-gamut colors

OKLCH can specify colors outside the sRGB gamut, which means you can use the more vivid colors that modern displays (most Apple devices, many OLED screens) can show. Browsers gracefully clamp to the nearest displayable color on older monitors.

---

## 3. Migration Strategies

### Strategy A: Do nothing (if you're just using Tailwind defaults)

If Carbon only uses Tailwind's built-in color classes (`bg-blue-500`, `text-gray-700`, etc.), **you're already on OKLCH.** Tailwind v4's upgrade tool handles this automatically. No action needed.

### Strategy B: Convert custom colors incrementally

If you have custom colors defined in HSL or hex (which Carbon likely does for brand colors, status colors, etc.), migrate them over time:

**Step 1: Audit what you have**
```bash
# Find all custom color definitions
rg --no-filename 'hsl\(|#[0-9a-fA-F]{3,8}' src/ --include='*.css' --include='*.ts' --include='*.tsx'
```

**Step 2: Convert with tooling**

Use the converter at [oklch.com](https://oklch.com/) — paste in any color format, get OKLCH back. For bulk conversion, the [culori.js](https://culorijs.org/) library is excellent:

```js
import { oklch, formatCss } from 'culori';

// Convert hex to OKLCH
const result = oklch('#3b82f6');
console.log(formatCss(result));
// → oklch(0.623 0.214 259.815)
```

**Step 3: Replace in `@theme`**
```css
/* Before (v3 style) */
@theme {
  --color-brand-500: #3b82f6;
  --color-brand-600: #2563eb;
}

/* After */
@theme {
  --color-brand-500: oklch(0.623 0.214 259.815);
  --color-brand-600: oklch(0.546 0.245 262.881);
}
```

**Step 4: Verify visually**

The converted values should look identical on sRGB displays. On P3 displays, they may look *slightly* more vivid if the original colors were at the edge of sRGB gamut.

### Strategy C: Redesign the palette (if you want to go further)

If the team wants to take full advantage of OKLCH's properties (better dark mode, algorithmic palette generation, P3 colors), you can redesign the custom palette from scratch using OKLCH principles. Tools:

- **[oklch.com](https://oklch.com/)** — interactive color picker, shows gamut boundaries
- **[Huetone](https://huetone.ardov.me/)** — palette generator built on OKLCH
- **[Atmos](https://atmos.style/)** — design token generator using OKLCH

### What teams have actually done

The most common approach from what's documented:

1. **Run `npx @tailwindcss/upgrade`** — handles the v3→v4 migration automatically
2. **Leave Tailwind's default colors alone** — they're already OKLCH
3. **Convert custom/brand colors one at a time** — as you touch those files
4. **Adopt OKLCH for new colors going forward** — don't add any more hex/HSL

---

## 4. Before/After Examples

### HSL palette vs OKLCH palette

Here's what a blue scale looks like defined both ways:

```css
/* HSL — lightness values are NOT perceptually uniform */
--blue-100: hsl(214, 95%, 93%);  /* L=93% */
--blue-300: hsl(213, 97%, 77%);  /* L=77% */
--blue-500: hsl(217, 91%, 60%);  /* L=60% */
--blue-700: hsl(224, 76%, 48%);  /* L=48% */
--blue-900: hsl(226, 71%, 40%);  /* L=40% */

/* OKLCH — lightness IS perceptually uniform */
--blue-100: oklch(0.932 0.032 255);
--blue-300: oklch(0.809 0.105 251);
--blue-500: oklch(0.623 0.214 260);
--blue-700: oklch(0.488 0.243 264);
--blue-900: oklch(0.379 0.146 266);
```

The HSL version has uneven perceived brightness steps — the jump from 300→500 looks much bigger than 500→700. The OKLCH version has even perceived steps.

### Dynamic theming example

```css
/* With OKLCH, changing hue gives you a different color
   at the SAME perceived brightness and saturation */
:root {
  --accent: oklch(0.65 0.20 250);  /* blue */
}

[data-theme="warm"] {
  --accent: oklch(0.65 0.20 30);   /* red-orange, same brightness! */
}

[data-theme="nature"] {
  --accent: oklch(0.65 0.20 145);  /* green, same brightness! */
}
```

In HSL, swapping hue while keeping S and L constant would give you colors that *look* like they have different brightness.

### CSS relative color syntax (the future)

```css
/* Darken a color by 15% — works predictably in OKLCH */
.button:hover {
  background: oklch(from var(--accent) calc(l - 0.15) c h);
}

/* Get a complementary color */
.complementary {
  color: oklch(from var(--accent) l c calc(h + 180));
}
```

---

## 5. Browser Support (mid-2026)

**OKLCH is fully supported everywhere that matters:**

| Browser | Supported Since | Status |
|---------|----------------|--------|
| Chrome | 111+ (Mar 2023) | ✅ Full support |
| Edge | 111+ (Mar 2023) | ✅ Full support |
| Firefox | 113+ (May 2023) | ✅ Full support |
| Safari | 15.4+ (Mar 2022) | ✅ Full support |
| Safari iOS | 15.4+ | ✅ Full support |
| Samsung Internet | 22+ | ✅ Full support |
| Chrome Android | 111+ | ✅ Full support |

**Not supported:** IE (dead), UC Browser, KaiOS, very old Samsung Internet (<22). These are the same browsers that can't run Tailwind v4 at all (which requires Safari 16.4+, Chrome 111+, Firefox 128+).

**Bottom line:** If your browser can run Tailwind v4, it can handle OKLCH. There's no gap. Tailwind v4 has *harder* browser requirements than OKLCH itself.

---

## 6. Risks and Downsides

### Things that could go wrong

1. **Visual regression during conversion** — Converting hex/HSL to OKLCH should produce identical sRGB colors, but rounding can introduce subtle (1-2 unit) differences. Always verify visually.

2. **Chroma clipping on legacy displays** — If you push colors beyond sRGB gamut (chroma > ~0.18 for most hues), older displays will clamp them. The result is usually fine but can be slightly different from what you designed on a P3 display.

3. **Unfamiliar values for designers** — `oklch(0.65 0.19 250)` is less immediately readable than `#3b82f6` if your designers are used to hex. There's a learning curve, though OKLCH is arguably *more* readable once you internalize the L/C/H model.

4. **Figma gap** — As of mid-2026, Figma still doesn't natively support OKLCH (there's a community plugin, [OKColor](https://www.figma.com/community/plugin/1173638098109123591/okcolor)). This can create friction in the design→dev handoff. Designers specify hex in Figma, developers convert to OKLCH.

5. **Not all L/C/H combos produce displayable colors** — Unlike HSL where every combo "works," OKLCH has regions that fall outside any display gamut. Browsers handle this gracefully (they find the nearest displayable color), but it can surprise you.

### Accessibility considerations

OKLCH is actually **better** for accessibility than HSL:

- Perceptual lightness means WCAG contrast ratios are more predictable
- Two colors at the same OKLCH lightness will have roughly the same contrast against a given background
- This makes building accessible color systems more systematic

The one caveat: WCAG contrast ratios are still calculated in luminance (Y from CIE XYZ), not OKLCH lightness. So you still need to check contrast ratios — OKLCH just makes it much less likely you'll have surprises.

### When you'd need fallbacks

You don't. Not in 2026. Every browser that Tailwind v4 targets already supports OKLCH. If you needed to support IE or pre-2022 Safari for some reason, you shouldn't be on Tailwind v4 at all (the Tailwind docs explicitly say "stick with v3.4" for older browsers).

---

## 7. Technical Debt: What Happens If You Stay on Legacy Color Values

### It works, but...

You **can** keep using hex/HSL values for custom colors in a Tailwind v4 project. They'll render correctly. But you're creating a split personality:

```css
@theme {
  /* Tailwind's defaults: OKLCH */
  /* --color-blue-500: oklch(0.623 0.214 259.815); */

  /* Your custom colors: still hex */
  --color-brand-500: #3b82f6;
  --color-brand-600: #2563eb;
}
```

### Why this becomes debt

1. **Inconsistent opacity behavior** — Tailwind v4 uses `color-mix(in oklab, ...)` for opacity. When you write `bg-brand-500/50`, the browser converts your hex to oklab, applies opacity, then renders. This works but means your intermediate color math happens in a different space than if you'd defined in OKLCH.

2. **Can't use relative color syntax** — The powerful `oklch(from var(--brand) ...)` syntax only works cleanly when the source color is already in OKLCH. If it's hex, the browser has to convert first, and you lose the intuitive L/C/H manipulation.

3. **Palette generation friction** — If you ever want to algorithmically generate variants (lighter, darker, saturated, desaturated), OKLCH makes this trivial. Hex/HSL makes it a manual process or requires JS libraries.

4. **P3 colors off the table** — Hex and HSL are limited to sRGB. If you ever want to use wider gamut colors (relevant for marketing pages, brand expressions), you need OKLCH or similar.

5. **Cognitive overhead** — Half your codebase uses one color format, half uses another. New devs have to understand both. Colors in DevTools show up in different formats depending on where they came from.

### The pragmatic answer

**Convert custom colors to OKLCH when you touch them.** There's no urgency to do a Big Bang migration. The existing hex values render identically. But every time you're editing a color or adding a new one, define it in OKLCH. Over a few sprints, you'll converge naturally.

---

## Recommendations for Carbon

1. **Don't do a standalone color migration project.** Not worth the risk or effort as a separate workstream.

2. **Adopt OKLCH for all *new* color definitions** starting now. When adding colors to `@theme`, use `oklch(...)`.

3. **Convert existing custom colors lazily** — when you're already touching that area of the codebase, convert the relevant colors.

4. **Use [oklch.com](https://oklch.com/) as the team color picker.** Bookmark it. It converts to/from everything and shows gamut boundaries.

5. **For the design system palette, consider a structured OKLCH approach** — define lightness steps once, share chroma/hue per color family. This makes generating new semantic colors (status, categories, chart colors) trivial.

6. **Don't worry about browser support.** If it runs Tailwind v4, it runs OKLCH. Full stop.

---

## References

- [Keith Grant — "It's Time to Learn oklch Color"](https://keithjgrant.com/posts/2023/04/its-time-to-learn-oklch-color/) — great intro, the article that started this conversation
- [Evil Martians — "OKLCH in CSS: why we moved from RGB and HSL"](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl) — deep dive with comparisons
- [Evil Martians — "Better dynamic themes in Tailwind with OKLCH"](https://evilmartians.com/chronicles/better-dynamic-themes-in-tailwind-with-oklch-color-magic) — practical Tailwind + OKLCH integration
- [Tailwind CSS v4 Announcement](https://tailwindcss.com/blog/tailwindcss-v4) — "Modernized P3 color palette" section
- [Tailwind CSS v4 Upgrade Guide](https://tailwindcss.com/docs/upgrade-guide) — migration steps
- [Tailwind CSS Colors Reference](https://tailwindcss.com/docs/colors) — full OKLCH palette values
- [OKLCH Color Picker](https://oklch.com/) — interactive picker with gamut visualization
- [Can I Use: oklch()](https://caniuse.com/mdn-css_types_color_oklch) — browser support table
- [Chrome — High Definition CSS Color Guide](https://developer.chrome.com/docs/css-ui/high-definition-css-color-guide) — comprehensive explainer
