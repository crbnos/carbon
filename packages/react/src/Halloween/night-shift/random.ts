// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Seeded randomness for the Night Shift. Every shift is drawn from its own
// seed, so a shift looks the same however often it is rendered, and the
// story can be replayed (and tested) from the seed alone.

export type Random = () => number;

/** Mulberry32: small, fast and good enough for picking pumpkin faces. */
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

/** Folds numbers into one 32-bit seed (FNV-1a over their bits). */
export function hashSeed(...parts: number[]): number {
  let hash = 2166136261;
  for (const part of parts) {
    hash ^= part >>> 0;
    hash = Math.imul(hash, 16777619);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

/** The whole-number part, rounded towards minus infinity. */
export function floorOf(value: number): number {
  const whole = Math.trunc(value);
  return value < whole ? whole - 1 : whole;
}

/** Picks by weight: `[["a", 3], ["b", 1]]` gives "a" three times in four. */
export function pickWeighted<T>(
  random: Random,
  weighted: readonly (readonly [T, number])[]
): T {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [item, weight] of weighted) {
    roll -= weight;
    if (roll < 0) return item;
  }
  const last = weighted.at(-1);
  if (!last) throw new Error("pickWeighted: empty list");
  return last[0];
}
