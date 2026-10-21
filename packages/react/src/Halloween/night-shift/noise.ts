// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Smooth value noise for fog, moon craters, ridges and candle flicker.

import { floorOf } from "./random";

function lattice(x: number, y: number, seed: number) {
  let h =
    Math.imul(x, 374761393) +
    Math.imul(y, 668265263) +
    Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1], continuous in x and y. */
export function noise2(x: number, y: number, seed = 0) {
  const x0 = floorOf(x);
  const y0 = floorOf(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = lattice(x0, y0, seed);
  const b = lattice(x0 + 1, y0, seed);
  const c = lattice(x0, y0 + 1, seed);
  const d = lattice(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/** Fractal noise: `octaves` layers of `noise2`, each finer and fainter. */
export function fbm2(x: number, y: number, octaves = 3, seed = 0) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise2(x * frequency, y * frequency, seed + i * 17);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

/** A candle's flicker over time, in [0, 1]; mostly bright, now and then a dip. */
export function flicker(seconds: number, seed = 0) {
  const slow = noise2(seconds * 1.7, 0.5, seed);
  const fast = noise2(seconds * 9.3, 3.5, seed + 5);
  return Math.min(1, 0.55 + 0.35 * slow + 0.2 * fast);
}
