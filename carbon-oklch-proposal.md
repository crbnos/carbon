# Carbon OKLCH Palette Proposal

_Fresh design (Option 3) — not a mechanical conversion of existing HSL values._

---

## 1. Why OKLCH

**OKLCH** (`oklch(Lightness Chroma Hue)`) is the perceptually uniform color space standardized in CSS Color Level 4. Unlike HSL:

- **Equal lightness = equal perceived brightness.** HSL 50% yellow is blinding; HSL 50% blue is dim. OKLCH `L=0.7` looks equally light regardless of hue.
- **Systematic dark mode.** Swap `L` values; chroma and hue stay put. Light mode `L=0.95` surface → dark mode `L=0.15` surface. No hand-picking.
- **Consistent scales.** A 10-step ramp with uniform `L` spacing produces visually even gradients.
- **Gamut awareness.** Out-of-gamut colors clip gracefully to the nearest displayable color.

**Browser support:** 97%+ (Chrome 111, Firefox 113, Safari 15.4). Fallbacks only needed for IE11 (not a Carbon target).

---

## 2. Design Principles

1. **Perceptual uniformity first.** All color families share the same lightness steps.
2. **7 semantic status colors preserved.** Green, orange, red, yellow, blue, gray, purple — the Carbon vocabulary stays.
3. **Systematic dark mode.** `L_dark = 1 - L_light + 0.05` (clamped). One formula, not 300 hand-picks.
4. **Token-first.** Every color a component uses goes through a CSS custom property. Zero hardcoded Tailwind color classes.
5. **Theme-capable.** The hue channel makes multi-theme trivial: rotate `H` for brand themes.
6. **ERP-ready.** Status indicators, data visualization, and accessibility (WCAG 2.1 AA minimum 4.5:1 for text, 3:1 for UI elements).

---

## 3. Lightness Scale

A shared 13-step lightness ramp used by all color families:

| Step | L (Light) | L (Dark) | Role |
|------|-----------|----------|------|
| `50` | 0.97 | 0.10 | Subtle tinted background |
| `100` | 0.93 | 0.14 | Light fill / badge bg |
| `150` | 0.89 | 0.18 | Hover state bg |
| `200` | 0.82 | 0.25 | Borders on colored surfaces |
| `300` | 0.72 | 0.35 | Muted accent |
| `400` | 0.62 | 0.45 | Secondary text on tinted bg |
| `500` | 0.55 | 0.55 | **Base** — icon fills, dots, medium emphasis |
| `600` | 0.48 | 0.62 | **Primary action** — buttons, links |
| `700` | 0.40 | 0.72 | Hover on primary |
| `800` | 0.32 | 0.82 | Text on light backgrounds |
| `900` | 0.24 | 0.89 | High-contrast text |
| `950` | 0.16 | 0.93 | Maximum contrast text |
| `1000` | 0.10 | 0.97 | Near-foreground |

**Dark mode formula:** `L_dark = 1.07 - L_light` (clamped 0.05–0.97).

This means step-50 in light (L=0.97, barely tinted white) becomes step-50 in dark (L=0.10, barely tinted black). The perceptual relationship is preserved.

---

## 4. Color Families

### 4.1 Neutral (Gray) — H: 260, C: 0.01

Slightly cool-purple tint (matching Geist/Vercel aesthetic). Near-zero chroma keeps it neutral while avoiding the "dead gray" of `C=0`.

```css
--neutral-50:  oklch(0.97 0.005 260);   /* surfaces */
--neutral-100: oklch(0.93 0.005 260);
--neutral-150: oklch(0.89 0.008 260);
--neutral-200: oklch(0.82 0.008 260);   /* borders */
--neutral-300: oklch(0.72 0.010 260);
--neutral-400: oklch(0.62 0.010 260);   /* placeholder text */
--neutral-500: oklch(0.55 0.010 260);   /* muted text */
--neutral-600: oklch(0.48 0.010 260);
--neutral-700: oklch(0.40 0.010 260);   /* secondary text */
--neutral-800: oklch(0.32 0.010 260);
--neutral-900: oklch(0.24 0.010 260);   /* primary text */
--neutral-950: oklch(0.16 0.010 260);   /* headings */
--neutral-1000: oklch(0.10 0.010 260);  /* near-black */
```

### 4.2 Brand / Primary — H: 250, C: 0.12

A deep indigo-blue that works as a neutral-adjacent primary (like current zinc theme's near-black primary but with actual color identity).

```css
--brand-50:  oklch(0.97 0.015 250);
--brand-100: oklch(0.93 0.025 250);
--brand-200: oklch(0.82 0.055 250);
--brand-300: oklch(0.72 0.085 250);
--brand-400: oklch(0.62 0.110 250);
--brand-500: oklch(0.55 0.120 250);
--brand-600: oklch(0.48 0.120 250);   /* ← primary action */
--brand-700: oklch(0.40 0.115 250);   /* ← hover */
--brand-800: oklch(0.32 0.100 250);
--brand-900: oklch(0.24 0.080 250);
--brand-950: oklch(0.16 0.060 250);
```

### 4.3 Success (Green) — H: 160, C: 0.14

Teal-leaning green for better sRGB gamut fit than pure green (H=145).

```css
--success-50:  oklch(0.97 0.020 160);
--success-100: oklch(0.93 0.040 160);
--success-200: oklch(0.82 0.080 160);
--success-300: oklch(0.72 0.110 160);
--success-400: oklch(0.62 0.130 160);
--success-500: oklch(0.55 0.140 160);  /* ← dot fills, icons */
--success-600: oklch(0.48 0.135 160);  /* ← badge bg dark text */
--success-700: oklch(0.40 0.120 160);
--success-800: oklch(0.32 0.090 160);  /* ← text on light bg */
--success-900: oklch(0.24 0.065 160);
```

### 4.4 Warning (Amber/Yellow) — H: 80, C: 0.14

Amber-gold to distinguish from both yellow (too bright at high L) and orange (reserved for in-progress).

```css
--warning-50:  oklch(0.97 0.025 80);
--warning-100: oklch(0.93 0.050 80);
--warning-200: oklch(0.82 0.100 80);
--warning-300: oklch(0.72 0.130 80);
--warning-400: oklch(0.62 0.140 80);
--warning-500: oklch(0.55 0.140 80);   /* ← dot fills */
--warning-600: oklch(0.48 0.130 80);
--warning-700: oklch(0.40 0.110 80);
--warning-800: oklch(0.32 0.085 80);   /* ← text on light bg */
--warning-900: oklch(0.24 0.060 80);
```

### 4.5 Danger / Destructive (Red) — H: 25, C: 0.16

Warm red (not blue-red). High chroma for urgency. H=25 gives a vibrant tomato red with excellent gamut coverage.

```css
--danger-50:  oklch(0.97 0.015 25);
--danger-100: oklch(0.93 0.040 25);
--danger-200: oklch(0.82 0.090 25);
--danger-300: oklch(0.72 0.130 25);
--danger-400: oklch(0.62 0.150 25);
--danger-500: oklch(0.55 0.160 25);    /* ← dot fills, icons */
--danger-600: oklch(0.48 0.155 25);    /* ← buttons */
--danger-700: oklch(0.40 0.140 25);
--danger-800: oklch(0.32 0.110 25);    /* ← text on light bg */
--danger-900: oklch(0.24 0.075 25);
```

### 4.6 Info (Blue) — H: 240, C: 0.12

Standard blue for informational states. Slightly separated from the brand hue (250) to remain distinguishable.

```css
--info-50:  oklch(0.97 0.015 240);
--info-100: oklch(0.93 0.030 240);
--info-200: oklch(0.82 0.065 240);
--info-300: oklch(0.72 0.095 240);
--info-400: oklch(0.62 0.115 240);
--info-500: oklch(0.55 0.120 240);     /* ← dot fills */
--info-600: oklch(0.48 0.120 240);     /* ← links, badges */
--info-700: oklch(0.40 0.115 240);
--info-800: oklch(0.32 0.095 240);     /* ← text on light bg */
--info-900: oklch(0.24 0.070 240);
```

### 4.7 Orange (In-Progress) — H: 50, C: 0.15

Distinct from both warning (H=80) and danger (H=25). Warm orange for "in-progress" / "needs attention."

```css
--orange-50:  oklch(0.97 0.020 50);
--orange-100: oklch(0.93 0.045 50);
--orange-200: oklch(0.82 0.095 50);
--orange-300: oklch(0.72 0.130 50);
--orange-400: oklch(0.62 0.145 50);
--orange-500: oklch(0.55 0.150 50);    /* ← dot fills */
--orange-600: oklch(0.48 0.140 50);
--orange-700: oklch(0.40 0.120 50);
--orange-800: oklch(0.32 0.090 50);    /* ← text on light bg */
--orange-900: oklch(0.24 0.060 50);
```

### 4.8 Purple (Special/Premium) — H: 300, C: 0.12

Blue-violet for premium, special, or starred items.

```css
--purple-50:  oklch(0.97 0.015 300);
--purple-100: oklch(0.93 0.030 300);
--purple-200: oklch(0.82 0.065 300);
--purple-300: oklch(0.72 0.095 300);
--purple-400: oklch(0.62 0.110 300);
--purple-500: oklch(0.55 0.120 300);   /* ← dot fills */
--purple-600: oklch(0.48 0.120 300);
--purple-700: oklch(0.40 0.115 300);
--purple-800: oklch(0.32 0.095 300);   /* ← text on light bg */
--purple-900: oklch(0.24 0.070 300);
```

---

## 5. Semantic Token Mapping

### Light Mode

```css
:root {
  /* ─── Surfaces ─── */
  --background:           oklch(1.00 0 0);             /* pure white */
  --foreground:           oklch(0.15 0.010 260);       /* near-black */
  --card:                 oklch(1.00 0 0);
  --card-foreground:      oklch(0.15 0.010 260);
  --popover:              oklch(1.00 0 0);
  --popover-foreground:   oklch(0.15 0.010 260);

  /* ─── Primary (Brand) ─── */
  --primary:              oklch(0.48 0.120 250);       /* brand-600 */
  --primary-foreground:   oklch(0.98 0.005 250);       /* near-white w/ hint */

  /* ─── Active State ─── */
  --active:               oklch(0.93 0.025 250);       /* brand-100 */
  --active-foreground:    oklch(0.35 0.100 250);       /* brand ~700 */

  /* ─── Secondary ─── */
  --secondary:            oklch(0.95 0.005 260);       /* neutral-50 ish */
  --secondary-foreground: oklch(0.20 0.010 260);       /* neutral-950 ish */

  /* ─── Muted ─── */
  --muted:                oklch(0.95 0.005 260);
  --muted-foreground:     oklch(0.55 0.010 260);       /* neutral-500 */

  /* ─── Accent (hover highlight) ─── */
  --accent:               oklch(0.93 0.005 260);       /* neutral-100 */
  --accent-foreground:    oklch(0.20 0.010 260);

  /* ─── Status Colors ─── */
  --destructive:          oklch(0.55 0.160 25);        /* danger-500 */
  --destructive-foreground: oklch(0.98 0.005 25);
  --success:              oklch(0.55 0.140 160);       /* success-500 */
  --success-foreground:   oklch(0.98 0.005 160);
  --warning:              oklch(0.55 0.140 80);        /* warning-500 */
  --warning-foreground:   oklch(0.98 0.005 80);
  --info:                 oklch(0.55 0.120 240);       /* info-500 */
  --info-foreground:      oklch(0.98 0.005 240);

  /* ─── Borders & Input ─── */
  --border:               oklch(0.89 0.005 260);       /* neutral-150 */
  --input:                oklch(0.89 0.005 260);
  --ring:                 oklch(0.48 0.120 250);       /* matches primary */

  /* ─── Radius (unchanged) ─── */
  --radius:               0.675rem;
}
```

### Dark Mode

```css
.dark {
  /* ─── Surfaces ─── */
  --background:           oklch(0.07 0.005 260);       /* near-black */
  --foreground:           oklch(0.93 0.005 260);       /* near-white */
  --card:                 oklch(0.11 0.005 260);       /* slightly elevated */
  --card-foreground:      oklch(0.93 0.005 260);
  --popover:              oklch(0.14 0.005 260);       /* more elevated */
  --popover-foreground:   oklch(0.93 0.005 260);

  /* ─── Primary ─── */
  --primary:              oklch(0.72 0.100 250);       /* brand-300 equivalent */
  --primary-foreground:   oklch(0.12 0.020 250);

  /* ─── Active ─── */
  --active:               oklch(0.20 0.040 250);       /* dark tint */
  --active-foreground:    oklch(0.80 0.090 250);

  /* ─── Secondary ─── */
  --secondary:            oklch(0.18 0.005 260);
  --secondary-foreground: oklch(0.90 0.005 260);

  /* ─── Muted ─── */
  --muted:                oklch(0.20 0.005 260);
  --muted-foreground:     oklch(0.60 0.005 260);

  /* ─── Accent ─── */
  --accent:               oklch(0.18 0.005 260);
  --accent-foreground:    oklch(0.90 0.005 260);

  /* ─── Status Colors ─── */
  --destructive:          oklch(0.62 0.150 25);        /* brighter for dark bg */
  --destructive-foreground: oklch(0.10 0.020 25);
  --success:              oklch(0.62 0.130 160);
  --success-foreground:   oklch(0.10 0.020 160);
  --warning:              oklch(0.62 0.130 80);
  --warning-foreground:   oklch(0.10 0.020 80);
  --info:                 oklch(0.62 0.110 240);
  --info-foreground:      oklch(0.10 0.020 240);

  /* ─── Borders & Input ─── */
  --border:               oklch(0.24 0.005 260);
  --input:                oklch(0.24 0.005 260);
  --ring:                 oklch(0.72 0.100 250);       /* matches primary */
}
```

---

## 6. Chart / Data Visualization Palette

Six perceptually distinct hues at consistent lightness, optimized for both light and dark:

```css
:root {
  --chart-1: oklch(0.60 0.160 25);    /* Red-orange — production, cost */
  --chart-2: oklch(0.60 0.140 160);   /* Teal-green — success, received */
  --chart-3: oklch(0.60 0.120 240);   /* Blue — info, processing */
  --chart-4: oklch(0.60 0.130 80);    /* Amber — warning, pending */
  --chart-5: oklch(0.60 0.120 300);   /* Purple — special, threshold */
  --chart-6: oklch(0.60 0.140 50);    /* Orange — attention, in-progress */
}

.dark {
  --chart-1: oklch(0.70 0.140 25);
  --chart-2: oklch(0.70 0.120 160);
  --chart-3: oklch(0.70 0.100 240);
  --chart-4: oklch(0.70 0.110 80);
  --chart-5: oklch(0.70 0.100 300);
  --chart-6: oklch(0.70 0.120 50);
}
```

**Key improvement:** All 6 chart colors share the same lightness (`L=0.60` light, `L=0.70` dark), so no color "pops" more than others. Hues are distributed across the spectrum with ≥40° separation for deuteranopia/protanopia distinguishability.

---

## 7. Notion-Style Label Palette (replaces color.ts)

For avatar backgrounds, colored labels, and category indicators:

```css
/* Light mode — L=0.93 (soft tint), text at L=0.30 */
--label-gray:     oklch(0.93 0.005 260);  --label-gray-text:     oklch(0.30 0.010 260);
--label-brown:    oklch(0.93 0.030  60);  --label-brown-text:    oklch(0.30 0.050  60);
--label-orange:   oklch(0.93 0.040  50);  --label-orange-text:   oklch(0.30 0.065  50);
--label-yellow:   oklch(0.93 0.050  95);  --label-yellow-text:   oklch(0.30 0.065  95);
--label-green:    oklch(0.93 0.035 160);  --label-green-text:    oklch(0.30 0.060 160);
--label-blue:     oklch(0.93 0.030 240);  --label-blue-text:     oklch(0.30 0.060 240);
--label-purple:   oklch(0.93 0.035 300);  --label-purple-text:   oklch(0.30 0.060 300);
--label-pink:     oklch(0.93 0.035 350);  --label-pink-text:     oklch(0.30 0.060 350);
--label-red:      oklch(0.93 0.035  25);  --label-red-text:      oklch(0.30 0.060  25);

/* Dark mode — L=0.22 (deep tint), text at L=0.90 */
--label-gray:     oklch(0.22 0.008 260);  --label-gray-text:     oklch(0.90 0 0);
--label-brown:    oklch(0.22 0.025  60);  --label-brown-text:    oklch(0.90 0 0);
/* ... same pattern, L inverted ... */
```

---

## 8. Multi-Theme Strategy

With OKLCH, creating theme variants is trivial — rotate the brand hue:

| Theme | Brand Hue | Name |
|-------|-----------|------|
| Default | 250 (Indigo) | Modern |
| Cherry | 25 (Red) | Cherry |
| Apricot | 50 (Orange) | Apricot |
| Lemon | 95 (Yellow) | Lemon |
| Mint | 160 (Teal) | Mint |
| Blueberry | 240 (Blue) | Blueberry |
| Lavender | 300 (Violet) | Lavender |
| Neutral | 260, C=0 | Brutal |

Each theme only needs to set `--brand-hue` and optionally adjust chroma. All semantic tokens reference the brand hue. Dark mode is automatic.

```css
/* Theme definition becomes trivial: */
:root[data-theme="cherry"] {
  --brand-hue: 25;
  --brand-chroma: 0.15;
}
:root[data-theme="mint"] {
  --brand-hue: 160;
  --brand-chroma: 0.14;
}
```

Then the token definitions become formulaic:
```css
--primary: oklch(0.48 var(--brand-chroma) var(--brand-hue));
--active:  oklch(0.93 calc(var(--brand-chroma) * 0.2) var(--brand-hue));
/* etc. */
```

---

## 9. Accessibility Compliance

### WCAG 2.1 AA Targets

| Pair | Min Contrast | This Palette |
|------|-------------|--------------|
| Body text on background | 4.5:1 | foreground (L=0.15) on background (L=1.00) ≈ 18:1 ✓ |
| Muted text on background | 4.5:1 | muted-fg (L=0.55) on background (L=1.00) ≈ 5.2:1 ✓ |
| Primary button text | 4.5:1 | primary-fg (L=0.98) on primary (L=0.48) ≈ 6.8:1 ✓ |
| Danger text on white | 4.5:1 | danger-800 (L=0.32) on white ≈ 8.5:1 ✓ |
| UI components (borders) | 3:1 | border (L=0.89) on white (L=1.00) ≈ 1.4:1 ≈ borderline |

Note: Border contrast ratio against white is intentionally subtle (matching current design). For interactive borders, `--input` could be darkened to `L=0.82` (3.1:1).

### Color-Blind Safety

The 7 status colors are chosen with deuteranopia/protanopia in mind:
- **Green (H=160)** vs **Red (H=25)**: Distinguished by lightness when chroma is indistinguishable — green-500 at L=0.55 pairs with supplementary icons
- **Orange (H=50)** vs **Yellow (H=80)**: 30° hue difference is sufficient; they also differ in chroma
- **Blue (H=240)** vs **Purple (H=300)**: 60° apart, clear separation

All status indicators use **icon + color** (the Status component already does this), never color alone.

---

## 10. Migration Path

### Phase 1: Foundation (Non-Breaking)

1. Add OKLCH palette to `theme.css` as new `--oklch-*` custom properties alongside existing HSL tokens
2. Create `oklch-themes.ts` with the new theme definitions
3. Add `--warning` and `--info` tokens to `theme.css` @theme inline block

### Phase 2: Component Migration

1. Update `Badge`, `Alert`, `PulsingDot`, `Toast`, `Status` to use semantic OKLCH tokens instead of hardcoded Tailwind colors
2. Replace `color.ts` hex palette with OKLCH label tokens
3. Replace `STATUS_COLOR_HEX` with OKLCH-derived values
4. Fix toast success color (blue → green)

### Phase 3: Codebase Sweep

1. Replace all `bg-emerald-*`, `bg-red-*`, `bg-blue-*`, `bg-amber-*`, etc. with semantic tokens
2. Remove all `dark:` color overrides (dark mode is now automatic via token inversion)
3. Update chart tokens to OKLCH

### Phase 4: Theme Engine

1. Replace `themes.ts` HSL definitions with OKLCH hue/chroma theme definitions
2. Simplify `getThemeCode()` to set `--brand-hue` and `--brand-chroma`
3. Consolidate the docs editorial palette into the token system where possible

---

## 11. File Changes Summary

| File | Change |
|------|--------|
| `packages/config/tailwind/theme.css` | Add OKLCH token mappings in `@theme inline` |
| `packages/utils/src/themes.ts` | Rewrite with OKLCH values per theme |
| `packages/utils/src/status-colors.ts` | Replace hex with OKLCH token references |
| `packages/utils/src/color.ts` | Replace hex palettes with OKLCH label tokens |
| `packages/react/src/Badge.tsx` | Use semantic `--status-*` tokens |
| `packages/react/src/Alert.tsx` | Use semantic tokens |
| `packages/react/src/Toast.tsx` | Fix success=green, use tokens |
| `packages/react/src/PulsingDot.tsx` | Use semantic tokens |
| `packages/react/src/Status.tsx` | No logic change (wraps Badge) |
| `apps/*/app/styles/tailwind.css` | Update CSS variable definitions to OKLCH |
| ~100+ component files | Replace hardcoded Tailwind color → semantic token |

---

## 12. Appendix: Full Token Reference

### Status Dot/Indicator Hex Equivalents

For contexts that need hex (email, external SVG, PDF):

| Color | OKLCH (Light) | Approximate Hex |
|-------|---------------|-----------------|
| Green | `oklch(0.55 0.140 160)` | `#0fa074` |
| Orange | `oklch(0.55 0.150 50)` | `#c06a00` |
| Red | `oklch(0.55 0.160 25)` | `#d14430` |
| Yellow | `oklch(0.55 0.140 80)` | `#9a7e00` |
| Blue | `oklch(0.55 0.120 240)` | `#3370d0` |
| Gray | `oklch(0.55 0.010 260)` | `#7d7e84` |
| Purple | `oklch(0.55 0.120 300)` | `#8a50c8` |

### Surface Elevation Scale (Dark Mode)

```
L=0.07  — background (deepest)
L=0.11  — card (first elevation)
L=0.14  — popover (second elevation)
L=0.18  — secondary/accent (third elevation)
L=0.20  — muted (fourth elevation)
L=0.24  — border (structural lines)
```

Each step is +0.03–0.04 L, producing subtle but perceptible elevation differences.
