// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What every scene of the Night Shift draws with: the grid, the hill's
// layout, the shift's plan, where the story is, and what the person at the
// login form is doing.

import type { Color, Grid } from "./grid";
import type { Layout, Point } from "./layout";
import type { Moment, ShiftPlan } from "./story";

/** A light: tints the glyphs around it and, with `halo`, glows on the canvas. */
export type Light = {
  x: number;
  y: number;
  /** Reach, in rows. */
  radius: number;
  color: Color;
  /** How strongly it tints glyphs, 0 to about 1. */
  power: number;
  /** Opacity of the soft halo painted under the glyphs. */
  halo?: number;
};

/** The login form, as the scene reacts to it. */
export type Watcher = {
  /** The pointer, in cells, while it is over the page. */
  pointer: Point | null;
  /** A field has focus: the cat looks at the form. */
  field: boolean;
  /** A secret field (password, one-time code) has focus: nobody looks. */
  secret: boolean;
  /** The secret is shown in clear: one lantern peeks. */
  peek: boolean;
  /** 1 just after a submit, fading to 0: every lantern flares. */
  flare: number;
  /** 1 just after an error, fading to 0: the lanterns flicker red. */
  alarm: number;
};

export const IDLE_WATCHER: Watcher = {
  pointer: null,
  field: false,
  secret: false,
  peek: false,
  flare: 0,
  alarm: 0
};

export type Scene = {
  grid: Grid;
  layout: Layout;
  plan: ShiftPlan;
  moment: Moment;
  /** Seconds since the story started: drives flicker and drift. */
  seconds: number;
  watcher: Watcher;
  lights: Light[];
};

export function clamp01(value: number) {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** 0 before `from`, 1 after `to`, linear between. */
export function segment(t: number, from: number, to: number) {
  return clamp01((t - from) / (to - from));
}

export function ease(t: number) {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** The nearest whole number, halves away from zero. */
export function nearest(value: number) {
  return value >= 0 ? Math.trunc(value + 0.5) : -Math.trunc(-value + 0.5);
}

/** The fractional part, always in [0, 1). */
export function fraction(value: number) {
  return (
    value -
    Math.trunc(value) +
    (value < 0 && value !== Math.trunc(value) ? 1 : 0)
  );
}

/** A stable pseudo-random number in [0, 1) for an integer. */
export function hash01(n: number) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
