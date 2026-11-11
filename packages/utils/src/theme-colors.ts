// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The colors a theme can carry: the frame, the rail, the module
// sidebar and a light page tint. Pure color math; `themes.ts` turns presets and
// `custom:` values into themes. Spec: `.ai/specs/2026-11-03-theme-colors.md`.

export type ThemeColors = {
  /** The frame color ("Background"). Six-digit lowercase hex, no `#`. */
  base: string;
  /** The selected rail item ("Selected items"). Same format. */
  highlight: string;
  /** Blend `base` into `highlight` towards the bottom right. */
  gradient: boolean;
};

export type ThemePreset = {
  name: string;
  label: string;
  colors: ThemeColors;
};

// Names are stored in the `theme` cookie: never rename one.
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    name: "forge",
    label: "Forge",
    colors: { base: "c2410c", highlight: "eab308", gradient: true }
  },
  {
    name: "anodized",
    label: "Anodized",
    colors: { base: "4338ca", highlight: "c026d3", gradient: true }
  },
  {
    name: "patina",
    label: "Patina",
    colors: { base: "0f766e", highlight: "84cc16", gradient: true }
  },
  {
    name: "brass",
    label: "Brass",
    colors: { base: "a16207", highlight: "0891b2", gradient: true }
  },
  {
    name: "oxide",
    label: "Oxide",
    colors: { base: "9f1239", highlight: "7c3aed", gradient: true }
  },
  {
    name: "aurora",
    label: "Aurora",
    colors: { base: "6d28d9", highlight: "10b981", gradient: true }
  },
  {
    name: "tidewater",
    label: "Tidewater",
    colors: { base: "0071a4", highlight: "9bc339", gradient: true }
  },
  {
    name: "graphite",
    label: "Graphite",
    colors: { base: "3f3f46", highlight: "3b82f6", gradient: false }
  },
  {
    name: "plum",
    label: "Plum",
    colors: { base: "6b21a8", highlight: "e879f9", gradient: false }
  },
  {
    name: "ember",
    label: "Ember",
    colors: { base: "c2410c", highlight: "fb923c", gradient: false }
  },
  {
    name: "jade",
    label: "Jade",
    colors: { base: "047857", highlight: "34d399", gradient: false }
  },
  {
    name: "lagoon",
    label: "Lagoon",
    colors: { base: "0e7490", highlight: "22d3ee", gradient: false }
  },
  {
    name: "cobalt",
    label: "Cobalt",
    colors: { base: "1d4ed8", highlight: "60a5fa", gradient: false }
  },
  {
    name: "garnet",
    label: "Garnet",
    colors: { base: "be123c", highlight: "fb7185", gradient: false }
  },
  {
    name: "linen",
    label: "Linen",
    colors: { base: "ece5d8", highlight: "cbb994", gradient: false }
  },
  {
    name: "mist",
    label: "Mist",
    colors: { base: "e1e9f1", highlight: "a9c2dc", gradient: false }
  }
];

const HEX = /^[0-9a-f]{6}$/;
const CUSTOM = /^custom:([0-9a-f]{6}):([0-9a-f]{6}):([gs])$/;

/** `#DC540C`, `dc540c` → `dc540c`; anything else → `null`. */
export function normalizeHex(value: string | null | undefined) {
  const hex = (value ?? "").trim().replace(/^#/, "").toLowerCase();
  return HEX.test(hex) ? hex : null;
}

/**
 * A preset name or an exact `custom:` value, else `null`. The value reaches a
 * `style` attribute, so nothing looser is accepted.
 */
export function parseThemeColors(
  value: string | null | undefined
): ThemeColors | null {
  if (!value) return null;
  const preset = THEME_PRESETS.find((theme) => theme.name === value);
  if (preset) return preset.colors;
  const custom = CUSTOM.exec(value);
  if (!custom) return null;
  return {
    base: custom[1]!,
    highlight: custom[2]!,
    gradient: custom[3] === "g"
  };
}

export function serializeThemeColors({
  base,
  highlight,
  gradient
}: ThemeColors): string {
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

function luminance([r, g, b]: Rgb) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
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

/** Light or dark text, whichever has the higher worst-case contrast. */
function textFor(backgrounds: Rgb[]): Rgb {
  const worst = (text: Rgb) =>
    Math.min(...backgrounds.map((bg) => rgbContrast(text, bg)));
  return worst(LIGHT_TEXT) >= worst(DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

/** Trims float noise for CSS. */
function css(n: number) {
  return Number(n.toPrecision(4)).toString();
}

function rgbCss([r, g, b]: Rgb) {
  return `rgb(${css(r)} ${css(g)} ${css(b)})`;
}

// OKLab (Björn Ottosson): perceptual, so blends stay clean where sRGB goes grey.

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
 * `a` moved `t` of the way towards `b` in OKLCH, the hue taking the shorter
 * way round, so opposite hues pass through vivid colors rather than grey.
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

function triplet(h: number, s: number, l: number) {
  return `${css(h)} ${css(s * 100)}% ${css(l * 100)}%`;
}

/** The `H S% L%` triplet the theme variables hold (`hsl(var(--x))`). */
function hslTriplet(rgb: Rgb) {
  return triplet(...rgbToHsl(rgb));
}

const HOVER_ALPHA = 0.6; // `bg-active/60`
// The rail's selected tile washes the frame with its text color, or shades it
// when the wash would cost the text AA.
const RAIL_TILE_ALPHA = 0.14;
const RAIL_SHADE_ALPHA = 0.22;
const SHADE: Rgb = [0, 0, 0];
const AA = 4.5;
// Unselected rail labels are `text-foreground/70`; the frame must carry them.
const LABEL_ALPHA = 0.7;
// Light sidebar: the selected fill is this much highlight over the panel.
const PANEL_SELECTED = 0.45;
// Dark sidebar, fitted to the reference design: the highlight leans this far towards the
// frame, then deepens until white text reaches this contrast.
const SELECTED_TOWARDS_FRAME = 0.2;
const SELECTED_CONTRAST = 6;

type Mode = "light" | "dark";

export type ThemeStyle = {
  /** `SidebarProvider`'s background. */
  frame: Record<Mode, Record<string, string>>;
  /** The desktop rail: transparent, with the theme variables for its frame. */
  rail: Record<Mode, Record<string, string>>;
  /** The page's tinted variables, set on `<html>` so portals match. */
  content: { light: Record<string, string>; dark: Record<string, string> };
  /** The module sidebar's variables. */
  panel: { light: Record<string, string>; dark: Record<string, string> };
  /** The frame's tone, which picks the rail's logo instead of the mode. */
  tone: "light" | "dark";
};

// [share of the frame's saturation, lightness]: a grey frame stays neutral,
// and lightness stays near the default theme's, so contrast holds.
type Surface = readonly [saturation: number, lightness: number];
type Surfaces = Record<"light" | "dark", Record<string, Surface>>;

// The page: almost neutral.
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

// The module sidebar: clearly tinted.
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

/** A surface's hue, saturation and lightness, tinted by `base`. */
function tinted(base: Rgb, [s, l]: Surface): [number, number, number] {
  const [hue, saturation] = rgbToHsl(base);
  return [hue, s * saturation, l];
}

function tintedVariables(base: Rgb, surfaces: Surfaces) {
  const forMode = (mode: "light" | "dark") =>
    Object.fromEntries(
      Object.entries(surfaces[mode]).map(([name, surface]) => [
        `--${name}`,
        triplet(...tinted(base, surface))
      ])
    );
  return { light: forMode("light"), dark: forMode("dark") };
}

// Fitted to the reference design: dark mode deepens a frame to this lightness, muting it
// along this curve (#921D21 → #631A18, #228B07 → #223F18); light mode keeps
// it at this chroma (#228B07 → #448627). A light frame stays light.
const FRAME_DEPTH = 0.336;
const FRAME_CHROMA_CURVE = 1.7;
const LIGHT_MODE_CHROMA = 0.8;
const LIGHT_FRAME = 0.8;

function isLightFrame(color: Rgb) {
  return lightnessOf(color) >= LIGHT_FRAME;
}

function deepFrame(color: Rgb): Rgb {
  const lightness = lightnessOf(color);
  if (lightness <= FRAME_DEPTH || lightness >= LIGHT_FRAME) return color;
  return reshade(
    color,
    FRAME_DEPTH,
    (FRAME_DEPTH / lightness) ** FRAME_CHROMA_CURVE
  );
}

/** Whether a rail label reads on `color` at AA, in whole bytes as painted. */
function labelReadsOn(text: Rgb, color: Rgb, ratio = AA) {
  const background = hexToRgb(rgbToHex(color));
  const label = hexToRgb(rgbToHex(mix(background, text, LABEL_ALPHA)));
  return rgbContrast(label, background) >= ratio;
}

// A browser blends gradient stops in sRGB, which can dip below both ends.
// The blend is checked a little above AA: a painted pixel rounds differently.
const BLEND_SAMPLES = 16;
const BLEND_AA = AA + 0.05;

/** Whether a label reads on `color` and on the sRGB blend from `from`. */
function labelReadsFrom(text: Rgb, color: Rgb, from: Rgb | undefined) {
  if (!labelReadsOn(text, color)) return false;
  if (!from) return true;
  for (let i = 1; i < BLEND_SAMPLES; i++) {
    if (!labelReadsOn(text, mix(from, color, i / BLEND_SAMPLES), BLEND_AA))
      return false;
  }
  return true;
}

/**
 * `color` moved away from the text until a rail label reads on it (and on its
 * blend from the stop before it, `from`), falling back to black or white when
 * a vivid color runs out of gamut.
 */
function readableUnder(text: Rgb, color: Rgb, from?: Rgb): Rgb {
  const darken = text === LIGHT_TEXT;
  const reads = (stop: Rgb) => labelReadsFrom(text, stop, from);
  let stop = color;
  for (let i = 0; i < CONTRAST_STEPS; i++) {
    if (reads(stop)) return stop;
    stop = reshade(stop, lightnessOf(stop) + (darken ? -1 : 1) * CONTRAST_STEP);
  }
  const away: Rgb = darken ? [0, 0, 0] : [255, 255, 255];
  const start = stop;
  for (let i = 1; i <= CONTRAST_STEPS && !reads(stop); i++) {
    stop = mix(start, away, i / CONTRAST_STEPS);
  }
  return stop;
}

/** White, or dark on a light frame. The frame adapts to the text, not back. */
function frameText(picked: Rgb): Rgb {
  return isLightFrame(picked) ? DARK_TEXT : LIGHT_TEXT;
}

/** The frame color for a mode, moved only as far as its labels need for AA. */
function frameBase(picked: Rgb, mode: Mode, text: Rgb): Rgb {
  if (isLightFrame(picked)) return readableUnder(text, picked);
  if (mode === "dark") return readableUnder(text, deepFrame(picked));
  return readableUnder(
    text,
    reshade(picked, lightnessOf(picked), LIGHT_MODE_CHROMA)
  );
}

// Gradient ends, fitted to the reference design. Dark mode: the highlight's hue, deep and
// muted (#921D21 / #36C5F0 → red, plum, navy). Light mode: near the highlight
// (#228B07 / #9E0B2E → corners #83252C).
const FLOW_END = 0.8;
const FLOW_END_DEPTH = 0.6;
const FLOW_END_CHROMA = 0.35;
const FLOW_MID_CHROMA = 0.6;
const LIGHT_FLOW_END = 0.95;
const LIGHT_FLOW_END_LIGHTNESS = 0.93;
const LIGHT_FLOW_END_CHROMA = 0.74;
const LIGHT_FLOW_MID_CHROMA = 0.45;
const CONTRAST_STEP = 0.015;
const CONTRAST_STEPS = 30;

/** The gradient's midpoint and end around a mode's base, readable at AA. */
function gradientFlow(base: Rgb, highlight: Rgb, text: Rgb, mode: Mode) {
  const deep = mode === "dark" && text === LIGHT_TEXT;
  let end: Rgb;
  let mid: Rgb;
  if (deep) {
    const towards = blend(base, highlight, FLOW_END);
    end = reshade(towards, lightnessOf(base) * FLOW_END_DEPTH, FLOW_END_CHROMA);
    const halfway = blend(base, end, 0.5);
    mid = reshade(halfway, lightnessOf(halfway), FLOW_MID_CHROMA);
  } else {
    const towards = blend(base, highlight, LIGHT_FLOW_END);
    end = reshade(
      towards,
      lightnessOf(highlight) * LIGHT_FLOW_END_LIGHTNESS,
      LIGHT_FLOW_END_CHROMA
    );
    const halfway = blend(base, end, 0.5);
    mid = reshade(
      halfway,
      Math.min(lightnessOf(base), lightnessOf(end)),
      LIGHT_FLOW_MID_CHROMA
    );
  }
  const readableMid = readableUnder(text, mid, base);
  return {
    base,
    mid: readableMid,
    end: readableUnder(text, end, readableMid)
  };
}

/**
 * The base on the top-left to bottom-right diagonal (where
 * `to top right` puts 50%), the end in the other 2 corners.
 */
export function themeBackground(theme: ThemeColors, mode: Mode) {
  const { base, flow } = themeColors(theme, mode);
  if (!flow) return rgbCss(base);
  const { mid, end } = flow;
  return `linear-gradient(to top right, ${rgbCss(end)} 0%, ${rgbCss(mid)} 28%, ${rgbCss(base)} 50%, ${rgbCss(mid)} 72%, ${rgbCss(end)} 100%)`;
}

/** One mode's frame, gradient, text and rail tile. */
function themeColors(theme: ThemeColors, mode: Mode) {
  const picked = hexToRgb(theme.base);
  const text = frameText(picked);
  const base = frameBase(picked, mode, text);
  const highlight = hexToRgb(theme.highlight);
  const flow = theme.gradient
    ? gradientFlow(base, highlight, text, mode)
    : undefined;
  const frameColors = flow ? [base, flow.mid, flow.end] : [base];
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
    flow,
    frameColors,
    text,
    railTile: railShades
      ? `0 0% 0% / ${RAIL_SHADE_ALPHA}`
      : `${hslTriplet(text)} / ${RAIL_TILE_ALPHA}`,
    railTiles: railShades ? shaded : washed,
    activeText: textFor([highlight])
  };
}

/** The sidebar's selected item, readable on its fill and its hover blend. */
function withPanelHighlight(
  tintBase: Rgb,
  highlight: Rgb,
  frame: Rgb
): ThemeStyle["panel"] {
  const panel = tintedVariables(tintBase, PANEL_SURFACES);
  const forMode = (variables: Record<string, string>, dark: boolean) => {
    const surface = hslToRgb(
      ...tinted(tintBase, PANEL_SURFACES[dark ? "dark" : "light"].card!)
    );
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
 * Dark sidebar only (#FF81AA on green → #A52943). A light sidebar
 * keeps the wash: its hover blend carries the same text color.
 */
function selectedOnDark(highlight: Rgb, frame: Rgb): Rgb {
  let color = blend(highlight, frame, SELECTED_TOWARDS_FRAME);
  for (let i = 0; i < CONTRAST_STEPS * 2; i++) {
    if (rgbContrast(LIGHT_TEXT, color) >= SELECTED_CONTRAST) break;
    color = reshade(color, lightnessOf(color) - CONTRAST_STEP);
  }
  return color;
}

/** A gradient theme's sidebar shifts to the end's hue at the bottom. */
function withPanelFlow(
  variables: Record<string, string>,
  flowEnd: Rgb | undefined,
  mode: Mode
): Record<string, string> {
  if (!flowEnd) return variables;
  const end = tintedVariables(deepFrame(flowEnd), PANEL_SURFACES)[mode];
  return {
    ...variables,
    "--card-end": end["--card"]!,
    backgroundImage:
      "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--card)) 30%, hsl(var(--card-end)) 100%)"
  };
}

/** The text and the colors it sits on, as hex. */
export function themeTextColors(theme: ThemeColors, mode: Mode) {
  const { text, activeText, frameColors, railTiles } = themeColors(theme, mode);
  return {
    text: rgbToHex(text),
    activeText: rgbToHex(activeText),
    frame: frameColors.map(rgbToHex),
    railTiles: railTiles.map(rgbToHex)
  };
}

export function themeStyle(theme: ThemeColors): ThemeStyle {
  const light = themeColors(theme, "light");
  const dark = themeColors(theme, "dark");
  // Tints use the deep frame in both modes, so a vivid pick tints no harder.
  const tintBase = dark.base;
  const panel = withPanelHighlight(tintBase, dark.highlight, dark.base);

  return {
    frame: {
      light: { background: themeBackground(theme, "light") },
      dark: { background: themeBackground(theme, "dark") }
    },
    content: tintedVariables(tintBase, PAGE_SURFACES),
    panel: {
      light: withPanelFlow(panel.light, light.flow?.end, "light"),
      dark: withPanelFlow(panel.dark, dark.flow?.end, "dark")
    },
    tone: dark.text === LIGHT_TEXT ? "dark" : "light",
    rail: { light: railVariables(light), dark: railVariables(dark) }
  };
}

// A button's fill must stand out from the page (WCAG 1.4.11, 3:1) and carry
// its label at AA. Both are checked a little above: the fill is stored as an
// HSL triplet and painted in whole bytes, which can round it below.
const BUTTON_CONTRAST = 3;
const PAINT_MARGIN = 0.05;
// Like the color themes, a button takes white text unless its color is too
// light to come near it (yellows, pastels), which keep dark text.
const WHITE_LABEL_FROM = 2.5;

/**
 * The accent of a theme with colors: buttons and focus rings in its highlight,
 * moved only as far as the button's label and the page need. Keyed like
 * `Theme.cssVars`, which it overrides.
 */
export function themeAccent(theme: ThemeColors): Record<Mode, AccentVariables> {
  const highlight = hexToRgb(theme.highlight);
  const picked = hexToRgb(theme.base);
  // The page's tint, as `themeStyle` makes it.
  const tintBase = frameBase(picked, "dark", frameText(picked));
  const label =
    rgbContrast(LIGHT_TEXT, highlight) >= WHITE_LABEL_FROM
      ? LIGHT_TEXT
      : DARK_TEXT;
  const forMode = (mode: Mode): AccentVariables => {
    const surface = (name: string) =>
      hslToRgb(...tinted(tintBase, PAGE_SURFACES[mode][name]!));
    const page = [surface("background"), surface("card")];
    // The fill moves away from whichever fails: the label or the page.
    let fill = highlight;
    for (let i = 0; i < CONTRAST_STEPS * 2; i++) {
      const labelReads = rgbContrast(label, fill) >= AA + PAINT_MARGIN;
      const standsOut = page.every(
        (bg) => rgbContrast(fill, bg) >= BUTTON_CONTRAST + PAINT_MARGIN
      );
      if (labelReads && standsOut) break;
      const darker = labelReads ? mode === "light" : label === LIGHT_TEXT;
      fill = reshade(
        fill,
        lightnessOf(fill) + (darker ? -CONTRAST_STEP : CONTRAST_STEP)
      );
    }
    return {
      primary: hslTriplet(fill),
      "primary-foreground": hslTriplet(label),
      ring: hslTriplet(fill)
    };
  };
  return { light: forMode("light"), dark: forMode("dark") };
}

type AccentVariables = Record<
  "primary" | "primary-foreground" | "ring",
  string
>;

/** The rail's variables over one mode's frame. */
function railVariables({
  base,
  text,
  railTile
}: ReturnType<typeof themeColors>): Record<string, string> {
  const toward = (t: number) => hslTriplet(mix(base, text, t));
  return {
    background: "transparent",
    // Unclassed text inherits <body>'s already-resolved `--foreground`.
    color: "hsl(var(--foreground))",
    "--background": hslTriplet(base),
    "--foreground": hslTriplet(text),
    // Group titles and trailing icons: the label's opacity, so they read at AA.
    "--muted-foreground": `${hslTriplet(text)} / ${LABEL_ALPHA}`,
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
  };
}

/** A picker swatch's CSS `background`: the frame as this mode paints it. */
export function themeSwatch(theme: ThemeColors, mode: Mode) {
  const { base, flow } = themeColors(theme, mode);
  const b = rgbCss(base);
  if (!flow) return b;
  return `linear-gradient(to top right, ${rgbCss(flow.end)} 8%, ${b} 50%, ${rgbCss(flow.end)} 92%)`;
}

function hashHex(rgb: Rgb) {
  return `#${rgbToHex(rgb)}`;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/** The onboarding backdrop's 4 mesh stops per mode. */
export function themeMesh({ base, highlight }: ThemeColors) {
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

/** Dark or white text, as hex, for an `"H S% L%"` color. */
export function textColorOn(hsl: string) {
  const [h = 0, s = 0, l = 0] = hsl
    .split(" ")
    .map((part) => Number.parseFloat(part));
  return rgbToHex(textFor([hslToRgb(h, s / 100, l / 100)]));
}

/** The `H S% L%` triplet of a hex color. */
export function hexTriplet(hex: string) {
  return hslTriplet(hexToRgb(hex));
}

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

/** A channel as a hex byte. */
function toByte(channel: number) {
  return Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, "0");
}

function rgbToHex([r, g, b]: Rgb) {
  return `${toByte(r)}${toByte(g)}${toByte(b)}`;
}

/** A random dark frame and a brighter highlight of a nearby hue. */
export function randomThemeColors(
  gradient: boolean,
  random: () => number = Math.random
): ThemeColors {
  const hue = random() * 360;
  const highlightHue = (hue + 15 + random() * 30) % 360;
  return {
    base: rgbToHex(hslToRgb(hue, 0.5 + random() * 0.2, 0.14 + random() * 0.06)),
    highlight: rgbToHex(hslToRgb(highlightHue, 0.6 + random() * 0.2, 0.5)),
    gradient
  };
}
