// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Seeded randomness for the Night Shift. Every shift is drawn from its own
// seed, so a shift looks the same however often it is rendered, and the
// story can be replayed (and tested) from the seed alone.

import type { Random } from "../math";

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
