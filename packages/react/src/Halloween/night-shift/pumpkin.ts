// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pumpkins, shaded as solids: each cell inside the outline gets a surface
// normal, the moon lights it from the upper right, and the ribs darken it in
// grooves that turn as the pumpkin turns. Carved cells show the candle
// inside, flickering.

import type { Face } from "./faces";
import { cellKey, miniFace } from "./faces";
import type { Color, Grid } from "./grid";
import { hex, mix, scale } from "./grid";
import { noise2 } from "./noise";

const RIND_RAMP = ".:-=+*#%@";
const GLOW_RAMP = "+*%#@";

const RIND_DARK = hex("#2a0e04");
const RIND_LIT = hex("#ff8c22");
const RIM = hex("#9b8cd0");
const GLOW_DIM = hex("#c2410c");
const GLOW_HOT = hex("#fff4cc");
const HOLE = hex("#0b0405");
const STEM = hex("#6b7a2e");

// The moon, up and to the right, a little towards the viewer.
const LIGHT = { x: 0.55, y: -0.55, z: 0.63 };

export type PumpkinLook = {
  x: number;
  y: number;
  /** Half the height in rows; the width follows from the cell aspect. */
  radius: number;
  aspect: number;
  /** Turns the ribs, in radians. */
  spin?: number;
  /** Carved cells, keyed with `cellKey`, relative to the centre. */
  carved?: ReadonlySet<number>;
  /** How brightly the candle inside burns, 0 to 1. */
  glow?: number;
  seconds: number;
  /** Overall light, so a pumpkin in deep fog or shadow can sit back. */
  ambient?: number;
  /** Light that reaches the side away from the moon, 0 to 1. */
  fill?: number;
};

/** Draws a pumpkin and returns the cells its carved face covers. */
export function drawPumpkin(grid: Grid, look: PumpkinLook) {
  const { x, y, radius, aspect, seconds } = look;
  const rx = radius * aspect * 1.18;
  const ry = radius;
  const spin = look.spin ?? 0;
  const glow = look.glow ?? 0;
  const ambient = look.ambient ?? 1;
  const fill = look.fill ?? 0.12;
  const top = Math.trunc(y - ry) - 1;
  const bottom = Math.trunc(y + ry) + 1;
  const left = Math.trunc(x - rx) - 1;
  const right = Math.trunc(x + rx) + 1;
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const nx = (col + 0.5 - x) / rx;
      const ny = (row + 0.5 - y) / ry;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const dx = col - Math.trunc(x);
      const dy = row - Math.trunc(y);
      if (look.carved?.has(cellKey(dx, dy))) {
        if (glow > 0) {
          const heat =
            glow * (0.72 + 0.28 * noise2(seconds * 8 + dx * 0.4, dy * 0.6, 3));
          const char =
            GLOW_RAMP[
              Math.min(
                GLOW_RAMP.length - 1,
                Math.trunc(heat * GLOW_RAMP.length)
              )
            ] ?? "@";
          grid.put(col, row, char, mix(GLOW_DIM, GLOW_HOT, heat));
          grid.fill(col, row, mix(HOLE, hex("#5a1a00"), heat));
        } else {
          grid.blank(col, row, HOLE);
        }
        continue;
      }
      const lambert = Math.max(0, nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z);
      const longitude = Math.atan2(nx, nz);
      const rib = 0.5 + 0.5 * Math.cos((longitude + spin) * 6);
      const groove = 0.62 + 0.38 * Math.sqrt(rib);
      // A lit lantern's rind sits back so its carved face reads.
      const brightness = Math.min(
        1,
        (fill + (1 - fill) * lambert) * groove * ambient * (1 - 0.45 * glow)
      );
      const char =
        RIND_RAMP[
          Math.min(
            RIND_RAMP.length - 1,
            Math.trunc(brightness * RIND_RAMP.length)
          )
        ] ?? ".";
      let color = mix(RIND_DARK, RIND_LIT, brightness);
      if (d2 > 0.7 && nx > 0.15 && ny < 0.1) color = mix(color, RIM, 0.35);
      grid.put(col, row, char, color);
      grid.fill(col, row, scale(RIND_DARK, 0.6));
    }
  }
  grid.put(x, y - ry - 0.6, ")", STEM);
  grid.put(x + 1, y - ry - 0.6, "~", scale(STEM, 0.8));
}

const LANTERN_RIND = hex("#b4500f");
const LANTERN_FACE = hex("#ffd36a");

/** A lantern in the procession: `(^w^)`, or its back while it looks away. */
export function drawLantern(
  grid: Grid,
  x: number,
  y: number,
  face: Face,
  options: { lit: number; away?: boolean; tint?: Color }
) {
  const text = options.away ? "(:|:)" : miniFace(face);
  const left = x - 2;
  const lit = options.lit;
  const faceColor = options.tint ?? mix(GLOW_DIM, LANTERN_FACE, lit);
  for (let k = 0; k < text.length; k++) {
    const char = text[k] ?? " ";
    const isShell = k === 0 || k === text.length - 1 || options.away;
    grid.put(
      left + k,
      y,
      char,
      isShell ? mix(scale(LANTERN_RIND, 0.6), LANTERN_RIND, lit) : faceColor
    );
  }
  grid.put(x, y - 1, "'", STEM);
}
