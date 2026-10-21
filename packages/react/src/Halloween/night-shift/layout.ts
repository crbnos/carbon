// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Where everything stands on the hill, in cells, for a grid of a given size.
// Recomputed only when the panel resizes. The upper left stays clear for the
// Carbon logo and the lower band is fog, behind the panel's headline.

import { fbm2, noise2 } from "./noise";
import { floorOf, hashSeed, seeded } from "./random";

export type Point = { x: number; y: number };

export type StoneKind = "rip" | "small" | "cross" | "round";

export type Layout = {
  cols: number;
  rows: number;
  /** Cell height over cell width: how many columns make one row of distance. */
  aspect: number;
  /** Top row of the far hills, per column. */
  ridge: Float32Array;
  /** Top row of the near ground, per column. */
  ground: Float32Array;
  horizon: number;
  moon: { x: number; y: number; r: number };
  factory: {
    left: number;
    right: number;
    roof: number;
    base: number;
    tower: number;
    towerTop: number;
    chimney: number;
    chimneyTop: number;
    door: number;
    mast: number;
    jib: number;
  };
  /** The lantern path, from the factory door into the fog. */
  path: Point[];
  stones: { x: number; base: number; kind: StoneKind }[];
  fence: { left: number; right: number; top: number };
  cat: Point;
  crow: Point;
  patch: { left: number; right: number; y: number };
  hero: Point;
  stars: { x: number; y: number; seed: number }[];
};

export function makeLayout(cols: number, rows: number, aspect: number): Layout {
  const horizon = floorOf(rows * 0.585);
  const factoryLeft = Math.max(2, floorOf(cols * 0.05));
  const factoryRight = factoryLeft + Math.max(24, floorOf(cols * 0.25));
  const roof = horizon - Math.max(7, floorOf(rows * 0.1));

  const ridge = new Float32Array(cols);
  const ground = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    ridge[c] = rows * 0.505 + rows * 0.13 * (fbm2(c * 0.03, 2.3, 4, 7) - 0.5);
    const flat = c >= factoryLeft - 2 && c <= factoryRight + 2;
    ground[c] = flat
      ? horizon
      : horizon +
        1.6 * (noise2(c * 0.06, 0.7, 11) - 0.5) +
        (c > cols * 0.6 ? 1 : 0);
  }

  const moonR = Math.max(4.5, rows * 0.095);
  const moon = {
    x: cols * 0.7,
    y: Math.max(moonR + 3, rows * 0.24),
    r: moonR
  };

  const door = factoryLeft + floorOf((factoryRight - factoryLeft) * 0.55);
  const path: Point[] = [
    { x: door + 1, y: horizon + 0.5 },
    { x: cols * 0.34, y: rows * 0.628 },
    { x: cols * 0.46, y: rows * 0.668 },
    { x: cols * 0.58, y: rows * 0.652 },
    { x: cols * 0.7, y: rows * 0.684 },
    { x: cols * 0.83, y: rows * 0.668 },
    { x: cols * 0.99, y: rows * 0.694 }
  ];

  const kinds: StoneKind[] = ["rip", "cross", "small", "round", "rip"];
  const stones = kinds.map((kind, i) => ({
    kind,
    x: floorOf(cols * (0.355 + i * 0.05)),
    base: floorOf(rows * 0.622 + (i % 2) * 1.2)
  }));

  const fence = {
    left: floorOf(cols * 0.62),
    right: floorOf(cols * 0.88),
    top: floorOf(rows * 0.6)
  };

  const random = seeded(hashSeed(cols, rows));
  const stars: Layout["stars"] = [];
  const count = floorOf(cols * rows * 0.014);
  for (let i = 0; i < count * 3 && stars.length < count; i++) {
    const x = random() * cols;
    const y = random() * rows * 0.5;
    const dx = (x - moon.x) / aspect;
    const dy = y - moon.y;
    const inMoon = Math.hypot(dx, dy) < moon.r + 2;
    const column = ridge[floorOf(x)] ?? rows;
    if (inMoon || y > column - 2) continue;
    stars.push({ x, y, seed: floorOf(random() * 1e6) });
  }

  return {
    cols,
    rows,
    aspect,
    ridge,
    ground,
    horizon,
    moon,
    factory: {
      left: factoryLeft,
      right: factoryRight,
      roof,
      base: horizon,
      tower: factoryLeft + 6,
      towerTop: roof - 11,
      chimney: factoryRight - 5,
      chimneyTop: roof - 8,
      door,
      mast: factoryRight - 1,
      jib: roof - 6
    },
    path,
    stones,
    fence,
    cat: { x: floorOf(cols * 0.7), y: fence.top - 4 },
    crow: { x: fence.right - 4, y: fence.top - 3 },
    patch: {
      left: floorOf(cols * 0.56),
      right: floorOf(cols * 0.96),
      y: floorOf(rows * 0.745)
    },
    hero: { x: cols * 0.77, y: rows * 0.745 },
    stars
  };
}

function segmentLengths(path: Point[], aspect: number) {
  const lengths: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    lengths.push(Math.hypot((b.x - a.x) / aspect, b.y - a.y));
  }
  return lengths;
}

/** The point a fraction `s` (0 to 1) of the way along a path. */
export function pointAlong(path: Point[], s: number, aspect: number): Point {
  const lengths = segmentLengths(path, aspect);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let rest = Math.max(0, Math.min(1, s)) * total;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i] ?? 0;
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) break;
    if (rest <= length || i === lengths.length - 1) {
      const k = length === 0 ? 0 : Math.min(1, rest / length);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    rest -= length;
  }
  return path[0] ?? { x: 0, y: 0 };
}

/**
 * Where lantern `index` of `count` stands: the oldest furthest along the
 * path, into the fog; the newest nearest the factory door.
 */
export function lanternSlot(index: number, capacity: number) {
  const spacing = 0.86 / capacity;
  return 0.97 - index * spacing;
}
