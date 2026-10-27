// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The character grid every frame is drawn into before it is painted: one
// glyph, one text colour and an optional cell background per cell. Colours
// are packed 0xRRGGBB numbers in typed arrays, so a cell allocates nothing.

import { floorOf } from "../math";

export type Color = number;

/** No background: the canvas behind the cell shows through. */
export const NO_BG = -1;

/** A sprite cell that hides whatever is behind it without drawing a glyph. */
export const OPAQUE = "$";

function clamp255(value: number) {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return value | 0;
}

export function rgb(r: number, g: number, b: number): Color {
  return (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);
}

export function hex(value: string): Color {
  return Number.parseInt(value.replace("#", ""), 16);
}

export function red(color: Color) {
  return (color >> 16) & 255;
}

export function green(color: Color) {
  return (color >> 8) & 255;
}

export function blue(color: Color) {
  return color & 255;
}

/** `a` at t = 0, `b` at t = 1. */
export function mix(a: Color, b: Color, t: number): Color {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return rgb(
    red(a) + (red(b) - red(a)) * k,
    green(a) + (green(b) - green(a)) * k,
    blue(a) + (blue(b) - blue(a)) * k
  );
}

export function scale(color: Color, k: number): Color {
  return rgb(red(color) * k, green(color) * k, blue(color) * k);
}

export function css(color: Color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/**
 * Words in the user's language (a station name, a ticket's status). The grid
 * draws one character per cell, which a translation cannot keep to: a
 * combining mark, or a CJK glyph twice a cell wide. So a label reserves its
 * cells and the painter draws the whole string over them, cut short to fit.
 */
export type Label = {
  x: number;
  y: number;
  cells: number;
  text: string;
  color: Color;
  align: "left" | "center";
};

// East Asian wide and fullwidth ranges: about two cells each.
const WIDE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

/** Roughly how many cells a string takes in the panel's monospace font. */
export function cellsFor(text: string) {
  let cells = 0;
  for (const char of text) cells += WIDE.test(char) ? 2 : 1;
  return cells;
}

export class Grid {
  readonly cols: number;
  readonly rows: number;
  readonly ch: Uint16Array;
  readonly fg: Uint32Array;
  readonly bg: Int32Array;
  labels: Label[] = [];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.ch = new Uint16Array(cols * rows);
    this.fg = new Uint32Array(cols * rows);
    this.bg = new Int32Array(cols * rows);
    this.clear();
  }

  clear() {
    this.ch.fill(32);
    this.fg.fill(0);
    this.bg.fill(NO_BG);
    this.labels = [];
  }

  /** The cell index under a point, or -1 off the grid. */
  index(x: number, y: number) {
    const c = floorOf(x);
    const r = floorOf(y);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  put(x: number, y: number, char: string, color: Color) {
    const i = this.index(x, y);
    if (i < 0) return;
    this.ch[i] = char.charCodeAt(0);
    this.fg[i] = color;
  }

  /** Clears the glyph so nothing behind shows, optionally filling the cell. */
  blank(x: number, y: number, background: Color = NO_BG) {
    const i = this.index(x, y);
    if (i < 0) return;
    this.ch[i] = 32;
    if (background !== NO_BG) this.bg[i] = background;
  }

  fill(x: number, y: number, background: Color) {
    const i = this.index(x, y);
    if (i < 0) return;
    this.bg[i] = background;
  }

  charAt(x: number, y: number) {
    const i = this.index(x, y);
    return i < 0 ? " " : String.fromCharCode(this.ch[i] ?? 32);
  }

  isBlank(x: number, y: number) {
    const i = this.index(x, y);
    return i < 0 || this.ch[i] === 32;
  }

  /**
   * A label in at most `cells` cells from (x, y), centred on them or from
   * their left. Returns how many cells it took.
   */
  label(
    x: number,
    y: number,
    text: string,
    color: Color,
    maxCells: number,
    align: Label["align"] = "left",
    background: Color = NO_BG
  ) {
    const cells = Math.max(0, Math.min(maxCells, cellsFor(text)));
    if (cells === 0) return 0;
    for (let k = 0; k < cells; k++) this.blank(x + k, y, background);
    this.labels.push({ x, y, cells, text, color, align });
    return cells;
  }

  /** Writes a string left to right; spaces leave what is behind. */
  text(x: number, y: number, value: string, color: Color) {
    for (let k = 0; k < value.length; k++) {
      const char = value[k] ?? " ";
      if (char !== " ") this.put(x + k, y, char, color);
    }
  }

  /**
   * Draws ASCII art with its top-left at (x, y). Spaces are transparent,
   * `$` hides what is behind. `color` may vary per glyph; returning null
   * skips that glyph.
   */
  sprite(
    x: number,
    y: number,
    lines: readonly string[],
    color: Color | ((char: string, col: number, row: number) => Color | null),
    background: Color = NO_BG
  ) {
    for (let row = 0; row < lines.length; row++) {
      const line = lines[row] ?? "";
      for (let col = 0; col < line.length; col++) {
        const char = line[col] ?? " ";
        if (char === " ") continue;
        if (char === OPAQUE) {
          this.blank(x + col, y + row, background);
          continue;
        }
        const tint = typeof color === "number" ? color : color(char, col, row);
        if (tint === null) continue;
        this.put(x + col, y + row, char, tint);
        if (background !== NO_BG) this.fill(x + col, y + row, background);
      }
    }
  }
}

/** Width of the widest line: a sprite's footprint in cells. */
export function spriteWidth(lines: readonly string[]) {
  return lines.reduce((widest, line) => Math.max(widest, line.length), 0);
}
