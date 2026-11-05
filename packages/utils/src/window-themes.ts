// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The window colors of a theme: a theme that carries them (a preset here, or
 * a `custom:` value) colors the app's frame, the navigation rail, the module
 * sidebar and, lightly, the page, as Slack does. `themes.ts` turns each one
 * into a theme, so it is stored like any theme, in the `theme` cookie. This
 * file is the color math; it knows nothing of cookies.
 * Spec: `.ai/specs/2026-11-03-window-themes.md`.
 */

export type WindowTheme = {
  /** The frame color ("Window background"). Six-digit lowercase hex, no `#`. */
  base: string;
  /** The selected rail item ("Selected items"). Same format. */
  highlight: string;
  /** Blend `base` into `highlight` towards the bottom right. */
  gradient: boolean;
};

export type WindowThemePreset = WindowTheme & {
  name: string;
  label: string;
};

/**
 * The presets. Their names are theme names, stored in the `theme` cookie, so
 * never rename one; a removed name reads as the default theme.
 */
export const WINDOW_THEMES = [
  // Gradient
  {
    name: "forge",
    label: "Forge",
    base: "6b2410",
    highlight: "ea7a3a",
    gradient: true
  },
  {
    name: "anodized",
    label: "Anodized",
    base: "24245c",
    highlight: "5b4bd6",
    gradient: true
  },
  {
    name: "patina",
    label: "Patina",
    base: "0d3f3a",
    highlight: "3fae98",
    gradient: true
  },
  {
    name: "brass",
    label: "Brass",
    base: "4a3a12",
    highlight: "b38b2e",
    gradient: true
  },
  {
    name: "oxide",
    label: "Oxide",
    base: "4a1424",
    highlight: "b4492b",
    gradient: true
  },
  {
    name: "aurora",
    label: "Aurora",
    base: "10264a",
    highlight: "3fb68b",
    gradient: true
  },
  {
    name: "tidewater",
    label: "Tidewater",
    base: "1a5470",
    highlight: "2f7d55",
    gradient: true
  },
  // Solid
  {
    name: "graphite",
    label: "Graphite",
    base: "1c1d21",
    highlight: "3d63dd",
    gradient: false
  },
  {
    name: "plum",
    label: "Plum",
    base: "3f0e40",
    highlight: "1264a3",
    gradient: false
  },
  {
    name: "ember",
    label: "Ember",
    base: "6c2510",
    highlight: "bf4f1c",
    gradient: false
  },
  {
    name: "jade",
    label: "Jade",
    base: "0e3a2c",
    highlight: "0f7a52",
    gradient: false
  },
  {
    name: "lagoon",
    label: "Lagoon",
    base: "0b3352",
    highlight: "1270ad",
    gradient: false
  },
  {
    name: "cobalt",
    label: "Cobalt",
    base: "141f4f",
    highlight: "3462d8",
    gradient: false
  },
  {
    name: "garnet",
    label: "Garnet",
    base: "4f0f1c",
    highlight: "c8284c",
    gradient: false
  },
  {
    name: "linen",
    label: "Linen",
    base: "ece5d8",
    highlight: "cbb994",
    gradient: false
  },
  {
    name: "mist",
    label: "Mist",
    base: "e1e9f1",
    highlight: "a9c2dc",
    gradient: false
  }
] as const satisfies readonly WindowThemePreset[];

export type WindowThemeName = (typeof WINDOW_THEMES)[number]["name"];

const HEX = /^[0-9a-f]{6}$/;
const CUSTOM = /^custom:([0-9a-f]{6}):([0-9a-f]{6}):([gs])$/;

/** `#DC540C`, `dc540c` → `dc540c`; anything else → `null`. */
export function normalizeHex(value: string | null | undefined) {
  const hex = (value ?? "").trim().replace(/^#/, "").toLowerCase();
  return HEX.test(hex) ? hex : null;
}

/**
 * The window theme a stored value names: a preset, a `custom:` value, or
 * `null` (the default). The value reaches a `style` attribute, so only these
 * exact shapes are accepted; anything else is the default.
 */
export function parseWindowTheme(
  value: string | null | undefined
): WindowTheme | null {
  if (!value) return null;
  const preset = WINDOW_THEMES.find((theme) => theme.name === value);
  if (preset) {
    return {
      base: preset.base,
      highlight: preset.highlight,
      gradient: preset.gradient
    };
  }
  const custom = CUSTOM.exec(value);
  if (!custom) return null;
  return {
    base: custom[1]!,
    highlight: custom[2]!,
    gradient: custom[3] === "g"
  };
}

/** The cookie value of a custom theme. */
export function serializeWindowTheme({
  base,
  highlight,
  gradient
}: WindowTheme): string {
  return `custom:${base}:${highlight}:${gradient ? "g" : "s"}`;
}

// --- Color math -----------------------------------------------------------

type Rgb = readonly [number, number, number];

const LIGHT_TEXT: Rgb = [255, 255, 255];
const DARK_TEXT: Rgb = [24, 24, 27];

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` moved `t` of the way towards `b`, in sRGB. */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

function channelLuminance(channel: number) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb) {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function rgbContrast(a: Rgb, b: Rgb) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The WCAG contrast ratio of two hex colors, 1 to 21. */
export function contrastRatio(a: string, b: string) {
  return rgbContrast(hexToRgb(a), hexToRgb(b));
}

/**
 * Light or dark text, whichever reads better on every background given: the
 * one whose lowest contrast is highest. A gradient passes both ends.
 */
function textFor(backgrounds: Rgb[]): Rgb {
  const worst = (text: Rgb) =>
    Math.min(...backgrounds.map((bg) => rgbContrast(text, bg)));
  return worst(LIGHT_TEXT) >= worst(DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

/** Trims float noise for CSS; not value-bearing. */
function css(n: number) {
  return Number(n.toPrecision(4)).toString();
}

function rgbCss([r, g, b]: Rgb) {
  return `rgb(${css(r)} ${css(g)} ${css(b)})`;
}

// --- OKLab: blends that stay clean -----------------------------------------
// A blend in sRGB passes through grey between distant hues (blue to lime goes
// muddy olive). OKLab (Björn Ottosson, 2020) is perceptual: the midpoint of
// blue and lime is a clean teal, and lightness is what the eye sees.

type Lab = readonly [l: number, a: number, b: number];

function toLinear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number) {
  const v = Math.min(1, Math.max(0, value));
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
}

function rgbToOklab([r, g, b]: Rgb): Lab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
  );
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

function oklabToRgb([L, A, B]: Lab): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ];
}

/**
 * `a` moved `t` of the way towards `b`, in OKLCH: lightness and chroma
 * straight, the hue the shorter way round the wheel. A straight line through
 * OKLab still crosses grey between opposite hues (red to cyan); round the
 * wheel, red goes through magenta and violet to blue, as Slack's bloom does.
 * A near-grey color has no hue worth keeping, so it takes the other's.
 */
function blend(a: Rgb, b: Rgb, t: number): Rgb {
  const [la, aa, ba] = rgbToOklab(a);
  const [lb, ab, bb] = rgbToOklab(b);
  const ca = Math.hypot(aa, ba);
  const cb = Math.hypot(ab, bb);
  const ha = Math.atan2(ba, aa);
  const hb = Math.atan2(bb, ab);
  const GREY = 0.02;
  const from = ca < GREY ? hb : ha;
  const to = cb < GREY ? ha : hb;
  // The shorter way round: the difference folded into (-π, π].
  const turn = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const hue = from + turn * t;
  const chroma = ca + (cb - ca) * t;
  return oklabToRgb([
    la + (lb - la) * t,
    chroma * Math.cos(hue),
    chroma * Math.sin(hue)
  ]);
}

/** A color with its OKLab lightness set and its chroma scaled. */
function reshade(color: Rgb, lightness: number, chroma = 1): Rgb {
  const [, a, b] = rgbToOklab(color);
  return oklabToRgb([lightness, a * chroma, b * chroma]);
}

function lightnessOf(color: Rgb) {
  return rgbToOklab(color)[0];
}

/** The `H S% L%` triplet the theme variables hold (`hsl(var(--x))`). */
/** Hue in degrees, saturation and lightness in 0 to 1. */
function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

/** An `H S% L%` triplet from hue (degrees), saturation and lightness (0 to 1). */
function triplet(h: number, s: number, l: number) {
  return `${css(h)} ${css(s * 100)}% ${css(l * 100)}%`;
}

/** The `H S% L%` triplet the theme variables hold (`hsl(var(--x))`). */
function hslTriplet(rgb: Rgb) {
  return triplet(...rgbToHsl(rgb));
}

// How strong a hover (`bg-active/60`) is, and how strong the rail's selected
// tile is: a translucent wash of the rail's own text color, as Slack's rail
// does, so it sits on any frame and any gradient.
const HOVER_ALPHA = 0.6;
const RAIL_TILE_ALPHA = 0.14;
// When a wash of the text color would cost the text its contrast (a light
// text on a mid-tone gradient end), the tile shades the frame instead.
const RAIL_SHADE_ALPHA = 0.22;
const SHADE: Rgb = [0, 0, 0];
// WCAG AA for normal text.
const AA = 4.5;
// How far the light sidebar's selected fill moves from the panel towards the
// highlight: a clear wash of the highlight that text reads on, and that the
// 60% hover keeps subtle. A dark sidebar takes the deepened highlight.
const PANEL_SELECTED = 0.45;
// A dark sidebar's selected item, fitted to Slack's samples: the highlight
// moved this far towards the frame (in OKLCH), then deepened until white text
// reads at this contrast.
const SELECTED_TOWARDS_FRAME = 0.2;
const SELECTED_CONTRAST = 6;

export type WindowThemeStyle = {
  /** The shell's frame: `SidebarProvider` in the ERP and MES. */
  frame: Record<string, string>;
  /** The desktop rail `<nav>`: transparent, with the theme variables set. */
  rail: Record<string, string>;
  /**
   * The surface and text variables of the page, per mode: the content card,
   * popovers, dialogs and tables take a light tint of the frame's hue, so the
   * page matches the frame and stays calm, like Slack's message pane. Set on `<html>` inside the app, so
   * portals get it too. Status colors and the theme color stay as they are.
   */
  content: { light: Record<string, string>; dark: Record<string, string> };
  /**
   * The module sidebar's variables, per mode: a tinted panel between the
   * frame and the page, like Slack's channel list. Set on the panel only.
   */
  panel: { light: Record<string, string>; dark: Record<string, string> };
  /**
   * Whether the frame reads as dark or light, from the text chosen for it. The
   * rail picks its mode-specific art (the company logo) by this, not the mode.
   */
  tone: "light" | "dark";
};

// How strongly a surface takes the frame's hue: a fraction of the frame's own
// saturation, so a grey frame (Graphite) leaves everything almost neutral.
// Lightness stays close to the default theme, so contrast does not change.
type Surface = readonly [saturation: number, lightness: number];
type Surfaces = Record<"light" | "dark", Record<string, Surface>>;

// The page, like Slack's message pane: almost neutral, a whisper of the hue.
const PAGE_SURFACES: Surfaces = {
  light: {
    background: [0.28, 0.955],
    card: [0.12, 0.995],
    popover: [0.12, 0.995],
    secondary: [0.2, 0.95],
    muted: [0.22, 0.93],
    accent: [0.22, 0.945],
    active: [0.32, 0.88],
    border: [0.2, 0.89],
    input: [0.2, 0.89],
    foreground: [0.25, 0.09],
    "card-foreground": [0.25, 0.09],
    "popover-foreground": [0.25, 0.09],
    "secondary-foreground": [0.25, 0.1],
    "accent-foreground": [0.25, 0.1],
    "active-foreground": [0.25, 0.1],
    "muted-foreground": [0.12, 0.38]
  },
  dark: {
    background: [0.3, 0.1],
    card: [0.24, 0.085],
    popover: [0.24, 0.1],
    secondary: [0.24, 0.1],
    muted: [0.22, 0.13],
    accent: [0.22, 0.14],
    active: [0.28, 0.19],
    border: [0.18, 0.19],
    input: [0.18, 0.19],
    foreground: [0.12, 0.93],
    "card-foreground": [0.12, 0.93],
    "popover-foreground": [0.12, 0.93],
    "secondary-foreground": [0.12, 0.93],
    "accent-foreground": [0.12, 0.93],
    "active-foreground": [0.1, 0.98],
    "muted-foreground": [0.08, 0.66]
  }
};

// The module sidebar, like Slack's channel list: a clearly tinted panel
// between the frame and the page. Pale in light mode, deep in dark mode.
const PANEL_SURFACES: Surfaces = {
  light: {
    background: [0.5, 0.93],
    card: [0.5, 0.93],
    accent: [0.5, 0.89],
    active: [0.6, 0.84],
    border: [0.4, 0.86],
    input: [0.4, 0.86],
    foreground: [0.45, 0.11],
    "card-foreground": [0.45, 0.11],
    "accent-foreground": [0.45, 0.11],
    "active-foreground": [0.5, 0.09],
    "muted-foreground": [0.3, 0.33]
  },
  dark: {
    background: [0.5, 0.075],
    card: [0.5, 0.075],
    accent: [0.42, 0.13],
    active: [0.48, 0.18],
    border: [0.36, 0.16],
    input: [0.36, 0.16],
    foreground: [0.22, 0.92],
    "card-foreground": [0.22, 0.92],
    "accent-foreground": [0.22, 0.92],
    "active-foreground": [0.15, 0.98],
    "muted-foreground": [0.15, 0.66]
  }
};

function tintedVariables(base: Rgb, surfaces: Surfaces) {
  const [hue, saturation] = rgbToHsl(base);
  const forMode = (mode: "light" | "dark") =>
    Object.fromEntries(
      Object.entries(surfaces[mode]).map(([name, [s, l]]) => [
        `--${name}`,
        triplet(hue, s * saturation, l)
      ])
    );
  return { light: forMode("light"), dark: forMode("dark") };
}

// Slack never paints a picked frame color as it is: it deepens it to one
// depth. Measured from its screenshots (2026-11-05): #921D21 shows as
// #631A18 and #228B07 as #223F18, both at OKLab lightness 0.336, the more
// muted the further they move. A color already that deep stays as it is, and
// a light frame (Linen, Mist; Slack has none) keeps its own lightness.
const FRAME_DEPTH = 0.336;
const LIGHT_FRAME = 0.8;
const FRAME_CHROMA_CURVE = 1.7;

/** The frame color Slack would paint for a picked color. */
function deepFrame(color: Rgb): Rgb {
  const lightness = lightnessOf(color);
  if (lightness <= FRAME_DEPTH || lightness >= LIGHT_FRAME) return color;
  return reshade(
    color,
    FRAME_DEPTH,
    (FRAME_DEPTH / lightness) ** FRAME_CHROMA_CURVE
  );
}

// Slack's gradient, measured from its screenshots (2026-11-05): the base on
// the top-left to bottom-right diagonal, the highlight's hue, deep and
// muted, in the other 2 corners. With #921D21 / #36C5F0 the rail runs red
// #4E181B, plum #261722, navy #121828, and the right edge navy to red.
// So the end takes the highlight's hue (this far from the base, in OKLCH), at
// this share of the base's lightness and of the highlight's chroma, and the
// midpoint is as calm.
const FLOW_END = 0.8;
const FLOW_END_DEPTH = 0.6;
const FLOW_END_CHROMA = 0.35;
const FLOW_MID_CHROMA = 0.6;
// How far a stop may move per step, and how many steps, to give the text AA.
const CONTRAST_STEP = 0.015;
const CONTRAST_STEPS = 30;

/**
 * The colors of a gradient frame: the base (on the diagonal), the OKLCH
 * midpoint, and the deep, muted end in the highlight's hue (the corners). Every stop but the base
 * (the user's own color) moves away from the text color, a step at a time,
 * until the text reads on it at AA.
 */
function gradientFlow(base: Rgb, highlight: Rgb) {
  const towards = blend(base, highlight, FLOW_END);
  const end = reshade(
    towards,
    lightnessOf(base) * FLOW_END_DEPTH,
    FLOW_END_CHROMA
  );
  const halfway = blend(base, end, 0.5);
  const mid = reshade(halfway, lightnessOf(halfway), FLOW_MID_CHROMA);
  const text = textFor([base, mid, end]);
  // Light text needs a darker stop; dark text a lighter one.
  const direction = text === LIGHT_TEXT ? -1 : 1;
  const readable = (stop: Rgb) => {
    let color = stop;
    for (let i = 0; i < CONTRAST_STEPS; i++) {
      if (rgbContrast(text, color) >= AA) break;
      color = reshade(color, lightnessOf(color) + direction * CONTRAST_STEP);
    }
    return color;
  };
  return { base, mid: readable(mid), end: readable(end) };
}

/**
 * The frame's CSS `background`, as Slack's is: the base runs along the
 * diagonal from the top-left to the bottom-right corner, and the end color
 * fills the other 2 corners, top right and bottom left. `to top right` puts
 * 50% exactly on that diagonal, so the stops mirror round it. On the frame:
 * the rail runs base to end from top to bottom, the top edge base to end from
 * left to right, the right edge end to base from top to bottom, and the
 * bottom edge end to base from left to right. The OKLCH midpoint is a stop on
 * each side, so the flow never passes through grey.
 */
export function windowThemeBackground({
  base,
  highlight,
  gradient
}: WindowTheme) {
  const b = deepFrame(hexToRgb(base));
  if (!gradient) return rgbCss(b);
  const { mid, end } = gradientFlow(b, hexToRgb(highlight));
  return `linear-gradient(to top right, ${rgbCss(end)} 0%, ${rgbCss(mid)} 28%, ${rgbCss(b)} 50%, ${rgbCss(mid)} 72%, ${rgbCss(end)} 100%)`;
}

/**
 * The 2 style objects a window theme renders. Pure, so the server and the
 * browser paint the same thing. The rail re-sets the theme variables its
 * classes already read, so the rail's markup does not change.
 */
function themeColors(theme: WindowTheme) {
  const base = deepFrame(hexToRgb(theme.base));
  const highlight = hexToRgb(theme.highlight);
  const flow = theme.gradient ? gradientFlow(base, highlight) : undefined;
  // Every color the rail's text can sit on.
  const frameColors = flow ? [base, flow.mid, flow.end] : [base];
  const text = textFor(frameColors);
  const worst = (tiles: Rgb[]) =>
    Math.min(...tiles.map((tile) => rgbContrast(text, tile)));
  const washed = frameColors.map((color) => mix(color, text, RAIL_TILE_ALPHA));
  const shaded = frameColors.map((color) =>
    mix(color, SHADE, RAIL_SHADE_ALPHA)
  );
  const railShades = worst(washed) < AA && worst(shaded) > worst(washed);
  return {
    base,
    highlight,
    flowEnd: flow?.end,
    frameColors,
    text,
    // The rail's selected tile, and its color over each end of the frame.
    railTile: railShades
      ? `0 0% 0% / ${RAIL_SHADE_ALPHA}`
      : `${hslTriplet(text)} / ${RAIL_TILE_ALPHA}`,
    railTiles: railShades ? shaded : washed,
    // Text on the highlight: the module sidebar's selected item.
    activeText: textFor([highlight])
  };
}

/**
 * The module sidebar's selected item takes the highlight's hue, as Slack's
 * channel list does: a wash of the highlight over the panel. Its text reads on
 * the fill and on the hover blend (`bg-active/60` over the panel).
 */
function withPanelHighlight(
  panel: WindowThemeStyle["panel"],
  highlight: Rgb,
  frame: Rgb
): WindowThemeStyle["panel"] {
  const forMode = (variables: Record<string, string>, dark: boolean) => {
    const [h, s, l] = variables["--card"]!.split(" ").map((part) =>
      Number.parseFloat(part)
    ) as [number, number, number];
    const surface = hslToRgb(h, s / 100, l / 100);
    const selected = dark
      ? selectedOnDark(highlight, frame)
      : mix(surface, highlight, PANEL_SELECTED);
    return {
      ...variables,
      "--active": hslTriplet(selected),
      "--active-foreground": hslTriplet(
        textFor([selected, mix(surface, selected, HOVER_ALPHA)])
      )
    };
  };
  return {
    light: forMode(panel.light, false),
    dark: forMode(panel.dark, true)
  };
}

/**
 * The selected item in a dark sidebar, as Slack paints it: the highlight,
 * leaning a fifth of the way towards the frame's hue, deepened until white
 * text reads on it at 6:1. Measured on a green frame #FF81AA shows as #A52943
 * (redder), and on a red frame #36C5F0 as #2F6EA8 (bluer); this gives #A83F35
 * and #2C62A8. A light sidebar
 * keeps the wash (`PANEL_SELECTED`): its hover (`bg-active/60` over a pale
 * panel) must carry the same text, and a deep fill would leave it mid-tone.
 */
function selectedOnDark(highlight: Rgb, frame: Rgb): Rgb {
  let color = blend(highlight, frame, SELECTED_TOWARDS_FRAME);
  for (let i = 0; i < CONTRAST_STEPS * 2; i++) {
    if (rgbContrast(LIGHT_TEXT, color) >= SELECTED_CONTRAST) break;
    color = reshade(color, lightnessOf(color) - CONTRAST_STEP);
  }
  return color;
}

/**
 * On a gradient theme the module sidebar flows too, as Slack's channel list
 * does over its window gradient: its tint moves from the base's hue at the
 * top to the gradient end's hue at the bottom, at the same lightness, so the
 * text reads the same all the way down. `--card-end` holds the bottom color.
 */
function withPanelFlow(
  panel: WindowThemeStyle["panel"],
  flowEnd: Rgb | undefined
): WindowThemeStyle["panel"] {
  if (!flowEnd) return panel;
  const ends = tintedVariables(flowEnd, PANEL_SURFACES);
  const forMode = (
    variables: Record<string, string>,
    end: Record<string, string>
  ) => ({
    ...variables,
    "--card-end": end["--card"]!,
    backgroundImage:
      "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--card)) 30%, hsl(var(--card-end)) 100%)"
  });
  return {
    light: forMode(panel.light, ends.light),
    dark: forMode(panel.dark, ends.dark)
  };
}

/**
 * The text colors a theme renders, as hex: on the frame (both ends of a
 * gradient), on the highlight, and the rail's selected tile on each end.
 */
export function windowThemeTextColors(theme: WindowTheme) {
  const { text, activeText, frameColors, railTiles } = themeColors(theme);
  return {
    text: rgbToHex(text),
    activeText: rgbToHex(activeText),
    frame: frameColors.map(rgbToHex),
    railTiles: railTiles.map(rgbToHex)
  };
}

export function windowThemeStyle(theme: WindowTheme): WindowThemeStyle {
  const { base, highlight, text, railTile, flowEnd } = themeColors(theme);
  const toward = (t: number) => hslTriplet(mix(base, text, t));

  return {
    frame: { background: windowThemeBackground(theme) },
    content: tintedVariables(base, PAGE_SURFACES),
    panel: withPanelFlow(
      withPanelHighlight(
        tintedVariables(base, PANEL_SURFACES),
        highlight,
        base
      ),
      flowEnd
    ),
    tone: text === LIGHT_TEXT ? "dark" : "light",
    rail: {
      background: "transparent",
      // Text with no color class inherits from <body>, which resolved
      // `--foreground` before the rail re-set it.
      color: "hsl(var(--foreground))",
      "--background": hslTriplet(base),
      "--foreground": hslTriplet(text),
      "--muted-foreground": hslTriplet(mix(text, base, 0.35)),
      // A translucent tile: `bg-active` and `bg-active/60` both read it.
      "--active": railTile,
      "--active-foreground": hslTriplet(text),
      "--accent": toward(0.12),
      "--accent-foreground": hslTriplet(text),
      "--secondary": toward(0.12),
      "--secondary-foreground": hslTriplet(text),
      "--muted": toward(0.1),
      "--card": toward(0.08),
      "--card-foreground": hslTriplet(text),
      "--border": toward(0.18),
      "--input": toward(0.18),
      "--ring": hslTriplet(text)
    }
  };
}

/**
 * The round swatch a picker shows for a theme, as a CSS `background`: what
 * its frame is. A gradient theme shows its gradient; a solid theme one flat
 * color (a split circle read as a two-tone frame).
 */
export function windowThemeSwatch({ base, highlight, gradient }: WindowTheme) {
  const frame = deepFrame(hexToRgb(base));
  const b = rgbCss(frame);
  if (!gradient) return b;
  const flow = gradientFlow(frame, hexToRgb(highlight));
  // The frame's pattern: the base on the diagonal, the end in the 2 corners.
  return `linear-gradient(to top right, ${rgbCss(flow.end)} 8%, ${b} 50%, ${rgbCss(flow.end)} 92%)`;
}

/** `#rrggbb`, for the mesh backdrop. */
function hashHex(rgb: Rgb) {
  return `#${rgbToHex(rgb)}`;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/**
 * The 4 mesh-gradient stops per mode a theme carries (the onboarding
 * backdrop, the Implementation Hub): the frame's colors, deep in dark mode and
 * a pale wash in light mode.
 */
export function windowThemeMesh({ base, highlight }: WindowTheme) {
  const b = hexToRgb(base);
  const h = hexToRgb(highlight);
  return {
    light: [
      hashHex(mix(WHITE, b, 0.14)),
      hashHex(mix(WHITE, h, 0.08)),
      hashHex(mix(WHITE, b, 0.03)),
      hashHex(mix(WHITE, h, 0.12))
    ],
    dark: [
      hashHex(b),
      hashHex(mix(b, BLACK, 0.7)),
      hashHex(mix(b, h, 0.3)),
      hashHex(mix(b, BLACK, 0.85))
    ]
  } as const;
}

/** The `H S% L%` triplet of a hex color: a theme's picker swatch. */
export function hexTriplet(hex: string) {
  return hslTriplet(hexToRgb(hex));
}

// --- Surprise me ------------------------------------------------------------

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** A color channel as a hex byte. Genuinely integer: 0 to 255. */
function toByte(channel: number) {
  return Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, "0");
}

function rgbToHex([r, g, b]: Rgb) {
  return `${toByte(r)}${toByte(g)}${toByte(b)}`;
}

/**
 * A random dark frame and a brighter highlight of a nearby hue. `random`
 * returns a number in [0, 1), as `Math.random` does.
 */
export function randomWindowTheme(
  gradient: boolean,
  random: () => number = Math.random
): WindowTheme {
  const hue = random() * 360;
  const highlightHue = (hue + 15 + random() * 30) % 360;
  return {
    base: rgbToHex(hslToRgb(hue, 0.5 + random() * 0.2, 0.14 + random() * 0.06)),
    highlight: rgbToHex(hslToRgb(highlightHue, 0.6 + random() * 0.2, 0.5)),
    gradient
  };
}
