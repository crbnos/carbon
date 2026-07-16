# Carbon Color System Audit

_Audited: 2026-07-01 | Codebase: `crbnos/carbon`_

---

## 1. Architecture Overview

Carbon's color system is a **multi-layered, runtime-selectable theme engine** built on HSL CSS custom properties, Tailwind v4, and a dynamic theme injection mechanism.

### How It Works

```
packages/utils/src/themes.ts          ← 8 named themes (HSL triplets)
  ↓  getThemeCode() / runtime injection
apps/*/app/root.tsx                   ← Document component applies vars to <html style>
  ↓
packages/config/tailwind/theme.css    ← @theme inline maps --color-* → hsl(var(--*))
  ↓
Components use Tailwind utilities      (bg-primary, text-muted-foreground, etc.)
```

**Dark mode mechanism:** The `<html>` element gets a `dark` or `light` class. CSS custom properties in `.dark {}` blocks override the `:root` values. The theme.css uses `@custom-variant dark (&:is(.dark *));` to enable Tailwind's `dark:` prefix to target the class-based toggle (not `prefers-color-scheme`).

**Theme selection:** Stored server-side per company. On page load, the `Document` component reads the selected theme name, looks it up in the `themes` array, and injects the appropriate light or dark CSS variables as inline styles on `<html>`.

---

## 2. Semantic Color Tokens

### Core Token Set (19 tokens, each with light + dark values)

All values are bare HSL triplets (e.g., `220 5.9% 10%`) consumed via `hsl(var(--token))`.

| Token | Role | Notes |
|-------|------|-------|
| `--background` | Page/app background | White (light) → near-black (dark) |
| `--foreground` | Primary text color | Near-black (light) → near-white (dark) |
| `--card` | Card/panel surfaces | Same as background in most themes |
| `--card-foreground` | Text on cards | Same as foreground in most themes |
| `--popover` | Dropdown/popover surfaces | Slightly elevated from background |
| `--popover-foreground` | Text in popovers | Same as foreground |
| `--primary` | Primary action color | Theme-colored (e.g., red for Cherry, blue for Blueberry) |
| `--primary-foreground` | Text on primary | Contrasting with primary |
| `--active` | Selected/active state bg | Tinted variant of primary |
| `--active-foreground` | Text on active state | Contrasting with active |
| `--secondary` | Secondary surfaces | Subtle, low-sat version of theme |
| `--secondary-foreground` | Text on secondary | |
| `--muted` | Muted backgrounds | Grayed-out backgrounds |
| `--muted-foreground` | Muted/secondary text | ~46% lightness (light), ~63% (dark) |
| `--accent` | Hover/focus highlight bg | Often same as muted/secondary |
| `--accent-foreground` | Text on accent | |
| `--destructive` | Destructive/error actions | Red hue in all themes |
| `--destructive-foreground` | Text on destructive | |
| `--success` | Success state | Green hue (`142 70% 45%` universally in light) |
| `--success-foreground` | Text on success | |
| `--border` | Default border color | Low-contrast gray |
| `--input` | Input field borders | Usually same as --border |
| `--ring` | Focus ring color | Theme-dependent |
| `--radius` | Border radius base | `0.5rem` or `0.675rem` |

### Sidebar Tokens (8 tokens)

Separate token set for the sidebar, enabling a darker/different sidebar:

| Token | Purpose |
|-------|---------|
| `--sidebar-background` | Sidebar bg |
| `--sidebar-foreground` | Sidebar text |
| `--sidebar-primary` | Sidebar primary action |
| `--sidebar-primary-foreground` | |
| `--sidebar-accent` | Sidebar hover/active |
| `--sidebar-accent-foreground` | |
| `--sidebar-border` | Sidebar borders |
| `--sidebar-ring` | Sidebar focus ring |

### Chart Tokens (6 tokens, ERP only)

Only defined in the ERP and partially in academy. **Not in the shared themes.ts.**

| Token | Light Value | Dark Value | Purpose |
|-------|-------------|------------|---------|
| `--chart-1` | `12 76% 61%` | `220 70% 50%` | Primary chart color |
| `--chart-2` | `173 58% 39%` | `160 60% 45%` | Secondary chart |
| `--chart-3` | `197 37% 24%` | `30 80% 55%` | Tertiary chart |
| `--chart-4` | `43 74% 66%` | `280 65% 60%` | Quaternary chart |
| `--chart-5` | `27 87% 67%` | `340 75% 55%` | Quinary chart |
| `--chart-6` | `262 83% 58%` | `262 90% 74%` | Safety-stock threshold |

### Shadow Tokens (7 tokens)

Extensive shadow system that changes dramatically between light and dark:
- `--button-shadow`, `--button-base-shadow`, `--button-primary-shadow`, `--button-danger-shadow`
- `--popover-shadow`, `--dropdown-item-shadow`
- `--base-shadow-color`

### Missing Tokens (Gaps)

| Missing | Currently Handled By |
|---------|---------------------|
| `--warning` / `--warning-foreground` | **No token.** One orphaned reference to `text-warning-foreground` in quality module. Amber/yellow Tailwind colors used ad-hoc. |
| `--info` / `--info-foreground` | **No token.** Blue Tailwind colors used ad-hoc. |
| `--brand` | Only defined in the **docs site** (`217 91% 60%`), not in the app themes. |

---

## 3. The 8 Selectable Themes

All 8 themes are defined in `packages/utils/src/themes.ts`:

| Name | Label | Primary (Light) | Primary (Dark) | Character |
|------|-------|-----------------|----------------|-----------|
| `zinc` | Modern | `220 5.9% 10%` (near-black) | `0 0% 100%` (white) | Vercel/Geist-inspired, pure black dark |
| `neutral` | Brutal | `0 0% 9%` (near-black) | `30 24% 94%` (warm off-white) | Warm browns, slightly warm dark |
| `red` | Cherry | `0 72.2% 50.6%` (red) | `0 72.2% 50.6%` (red, same) | Red-accented, same primary both modes |
| `orange` | Apricot | `17 96% 57%` (vibrant orange) | `17 96% 57%` (same) | Orange accent |
| `yellow` | Lemon | `47.9 95.8% 53.1%` (yellow) | `61 100% 53.1%` (electric yellow) | Yellow accent |
| `green` | Mint | `171 62% 41%` (teal-green) | `171 98% 59%` (bright teal) | Teal/mint accent |
| `blue` | Blueberry | `237 57% 30%` (deep indigo) | `216 98% 52%` (bright blue) | Deep blue/indigo |
| `violet` | Lavender | `238 57% 50%` (blue-violet) | `327 70% 40.4%` (magenta!) | Note: dark mode switches hue entirely |

### Theme Patterns

**Neutral themes** (zinc, neutral): Primary is near-black in light mode, near-white in dark mode. The dark mode is achromatic/desaturated.

**Colored themes** (red through violet): Primary carries the brand hue in both modes. Dark mode backgrounds are all warmish very-dark neutrals (`20 14.3% 6.1%` for most).

**Inconsistencies across themes:**
- Zinc dark uses `0 0% 0%` (pure black), while colored themes use `20 14.3% 6.1%` (warm near-black)
- The violet theme switches from indigo to magenta between light and dark — jarring
- Destructive is `0 84.2% 60.2%` in most light themes but `0 72.22% 50.59%` in starter
- Success is universally `142 70% 45%` in light, but varies in dark: `142 70% 45%` (some) vs `152 72% 53%` (zinc dark)
- `--active` / `--active-foreground` values are wildly inconsistent across themes (different formulas)

---

## 4. Hardcoded Colors (Pain Points)

### 4.1 Badge Gray Variant — Raw Hex

```tsx
// Badge.tsx
gray: "bg-[#e3e2e080] text-[#32302c] dark:bg-[#373737] dark:text-white hover:bg-[#e3e2e0] dark:hover:bg-[#5a5a5a]"
```

These match the `color.ts` palette but are hardcoded hex values outside the token system.

### 4.2 Color Utility System (color.ts) — Parallel Palette

`packages/utils/src/color.ts` defines a **completely separate** 10-color palette with hardcoded hex for avatar backgrounds and Notion-style colored labels:

```
gray:     #a6a5a5 / #373737
lightGray: #e3e2e0 / #5a5a5a
brown:    #eee0da / #603b2c
orange:   #fadec9 / #854c1d
yellow:   #f9e4bc / #835e33
green:    #dbeddb / #2b593f
blue:     #d3e5ef / #28456c
purple:   #e8deee / #492f64
pink:     #f5e0e9 / #69314c
red:      #ffe2dd / #6e3630
```

This palette is entirely disconnected from the theme tokens and from the Tailwind color scale.

### 4.3 STATUS_COLOR_HEX — Another Parallel Palette

`status-colors.ts` defines solid hex values for status dot indicators:

```
green:  #10b981  (emerald-500)
orange: #f97316  (orange-500)
red:    #ef4444  (red-500)
yellow: #eab308  (yellow-500)
blue:   #3b82f6  (blue-500)
gray:   #8b8985  (custom warm gray)
purple: #8b5cf6  (violet-500)
```

These are picked to match Tailwind's default scale but are hardcoded hex.

### 4.4 Editor Color Picker — Hardcoded Hex

`ColorSelector.tsx` uses 9 hardcoded hex text colors:
```
Purple: #9333EA, Red: #E00000, Yellow: #EAB308
Blue: #2563EB, Green: #008A00, Orange: #FFA500
Pink: #BA4081, Gray: #A8A29E
```

Plus `var(--novel-*)` highlight colors (from a rich-text editor library).

### 4.5 Toast Colors — Hardcoded Tailwind

```tsx
success: "bg-blue-700 text-white border-blue-700"  // Note: SUCCESS uses blue, not green!
error: "bg-red-600 text-white border-red-600"
```

### 4.6 Acknowledge Banner — Hardcoded Hex

```tsx
"bg-[#212278] dark:bg-[#2f31ae]"  // Deep indigo, no token connection
```

### 4.7 Mesh Gradient Background — Hardcoded Hex Arrays

```tsx
light: ["#bdcdff", "#f7f5ff", "#ffffff", "#e6f3ff"]
dark: ["#0a1a2d", "#000000", "#0D0D0D", "#050505"]
```

### 4.8 Docs Editorial Palette — Extensive Hardcoded System

`docs/app/global.css` defines ~40 editorial-specific color tokens (`--color-ed-*`) as hardcoded hex. This is intentional and light-only, but represents a significant parallel palette.

---

## 5. Tailwind Color Usage Counts

### Semantic Tokens (via CSS custom properties)
- **~3,082 usages** of semantic tokens (bg-primary, text-muted-foreground, bg-card, etc.)

### Direct Tailwind Color Classes (hardcoded, non-tokenized)

| Color Family | Usages | Primary Context |
|-------------|--------|-----------------|
| `emerald-*` | 170 | Success states, completed indicators, onboarding |
| `red-*` | 200 | Error states, destructive actions, decline |
| `gray-*` | 290 | Neutral backgrounds, borders (many in non-app files) |
| `blue-*` | 78 | Info states, links, active items, toast success |
| `yellow-*` | 39 | Pending/warning states, in-progress |
| `amber-*` | 36 | Warning states, caution |
| `orange-*` | 21 | In-progress, attention |
| `indigo-*` | 13 | Occasional accent |
| `teal-*` | 11 | Occasional accent |
| `purple-*` | 9 | Premium/special states |
| `violet-*` | 7 | Badge purple variant |
| `cyan-*` | 6 | Minor accent |
| `zinc-*` | 9 | Minor neutrals |
| `rose-*` | 2 | Minor |
| `pink-*` | 2 | Minor |
| `slate-*` | 3 | Minor |

**Total non-tokenized color usages: ~930+** scattered across the codebase.

---

## 6. Dark Mode Implementation

### Mechanism
1. **Class-based toggle** — `<html class="dark">` or `<html class="light">`
2. **Server-side preference** — Mode stored in cookie, read in `loader()`
3. **Theme CSS** — `@custom-variant dark (&:is(.dark *));` enables Tailwind's `dark:` prefix
4. **No system preference detection** — Mode is explicitly set, not auto-detected from OS

### Pattern
Components use `dark:` Tailwind variants extensively for hardcoded color overrides:

```tsx
// Typical pattern — every hardcoded color needs a dark: pair
"bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400"
```

### Issues
- Every hardcoded Tailwind color requires a **manual `dark:` counterpart**
- No systematic lightness inversion formula — each dark mode color is hand-picked
- The light → dark mapping is inconsistent (emerald-100 → emerald-500/15, but blue-100 → blue-900/50 in some places)
- Chart colors change hue entirely between light and dark (chart-1: coral → blue)

---

## 7. Color-Related Components

| Component | Location | Color System |
|-----------|----------|--------------|
| `Badge` | `packages/react/src/Badge.tsx` | 11 variants: default, secondary, destructive, outline, green, yellow, orange, red, blue, gray, purple — **gray uses hardcoded hex** |
| `Alert` | `packages/react/src/Alert.tsx` | 5 variants: default, success, info, warning, destructive — all use hardcoded Tailwind colors |
| `Status` | `packages/react/src/Status.tsx` | 7 colors: green, orange, red, yellow, blue, gray, purple — wraps Badge |
| `PulsingDot` | `packages/react/src/PulsingDot.tsx` | 8 variants matching Status colors |
| `Toast` | `packages/react/src/Toast.tsx` | success (blue-700!), error (red-600) — **success uses blue, not green** |
| `Progress` | `packages/react/src/Progress.tsx` | Hardcoded emerald-500 |
| `BarProgress` | `packages/react/src/BarProgress.tsx` | Default emerald-500, overridable |
| `ColorSelector` | Editor color picker | 9 hardcoded hex text colors |
| `ThemeForm` | `apps/erp/app/modules/settings/ui/Theme/ThemeForm.tsx` | Theme picker grid |
| `EmailThemeProvider` | `packages/documents/src/email/components/Theme.tsx` | Separate email palette with hex values |
| `Avatar` | `packages/react/src/Avatar.tsx` | Uses `color.ts` palette |
| `ModelViewer` | 3D viewer | RGB dots: green-500, blue-500, red-500 for XYZ axes |

---

## 8. Status Color Mapping (ERP Domain)

The `status-colors.ts` file is the canonical source for 15+ entity status → color mappings:

| Color | Semantic Meaning | Example Statuses |
|-------|-----------------|------------------|
| **green** | Complete, positive, available | Completed, Posted, Active, Paid, Available |
| **orange** | In-progress, needs attention | In Progress, Pending, To Receive, To Ship |
| **red** | Error, cancelled, blocked | Cancelled, Voided, Overdue, Rejected, Closed |
| **yellow** | Waiting, planned, needs review | Planned, Needs Approval, To Review, Pending |
| **blue** | Processing, intermediate | Submitted, In Progress, Confirmed, To Invoice |
| **gray** | Draft, inactive, neutral | Draft, Inactive, Closed (some contexts) |
| **purple** | Special, premium | Master (gauges), special states |

---

## 9. Summary of Pain Points

1. **Three parallel color systems:** Theme tokens (HSL vars), `color.ts` (Notion-style hex), and `STATUS_COLOR_HEX` (status indicator hex) — all disconnected.

2. **~930 hardcoded Tailwind color usages** that don't respect the theme system and each require manual `dark:` overrides.

3. **No `--warning` or `--info` tokens** — amber and blue are used ad-hoc via raw Tailwind classes.

4. **Toast success is blue, not green** — semantic mismatch.

5. **HSL values lack perceptual uniformity** — "50% lightness" in HSL doesn't produce perceptually consistent results across hues. This is the core motivation for OKLCH.

6. **Theme inconsistencies:** Violet dark switches hue entirely; destructive values vary between apps; success values vary between themes.

7. **Dark mode is manual labor** — every `bg-emerald-100` needs a hand-picked `dark:bg-emerald-500/15` counterpart, with no systematic formula.

8. **Chart colors change hue between modes** — making them meaningless as data-identity markers.

9. **Email palette is a separate world** — duplicated hex values with no connection to the theme.

10. **Badge gray variant uses hardcoded hex** while all other variants use Tailwind classes.
