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

/**
 * The words the scene shows, in the user's language: the factory's four
 * stations, the job on the line's ticket, its status and the QC stamp.
 */
export type Labels = {
  stations: readonly [string, string, string, string];
  item: string;
  inProgress: string;
  complete: string;
  scrapped: string;
  passed: string;
  rejected: string;
};

export type Scene = {
  grid: Grid;
  labels: Labels;
  layout: Layout;
  plan: ShiftPlan;
  moment: Moment;
  /** Seconds since the story started: drives flicker and drift. */
  seconds: number;
  watcher: Watcher;
  lights: Light[];
};
