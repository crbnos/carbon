// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The small maths every Halloween decoration shares: seeded randomness,
// clamping and easing, and whole-number helpers for the pixel and character
// grids. `floorOf`, `nearest` and `fraction` are built on `Math.trunc`
// because the `no-raw-rounding` check (@carbon/checks) refuses
// `Math.floor`/`Math.round` in this package: that rule is for prices and
// quantities, and these are only screen positions.

export type Random = () => number;

/** Mulberry32: a small, fast seeded generator returning [0, 1). */
export function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable pseudo-random number in [0, 1) for an integer. */
export function hash01(n: number) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

export function clamp01(value: number) {
  return clamp(value, 0, 1);
}

/** 0 before `from`, 1 after `to`, linear between. */
export function segment(t: number, from: number, to: number) {
  return clamp01((t - from) / (to - from));
}

/** Smoothstep: eases in and out over [0, 1]. */
export function ease(t: number) {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** The whole-number part, rounded towards minus infinity. */
export function floorOf(value: number): number {
  const whole = Math.trunc(value);
  return value < whole ? whole - 1 : whole;
}

/** The nearest whole number, halves away from zero. */
export function nearest(value: number) {
  return value >= 0 ? Math.trunc(value + 0.5) : -Math.trunc(-value + 0.5);
}

/** The fractional part, always in [0, 1). */
export function fraction(value: number) {
  return value - floorOf(value);
}

/**
 * The entry at an index the caller's own layout guarantees (a track point, a
 * leg, a web ring), so a missing one is a bug, not a state to carry on with.
 */
export function at<T>(list: ArrayLike<T>, i: number): T {
  const value = list[i];
  if (value === undefined) throw new Error(`Halloween: no entry at ${i}`);
  return value;
}
