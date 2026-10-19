// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Geometry for the Halloween scene. Everything is generated from fixed seeds,
// so the scene is identical on every open. The scene's coordinates are a
// 1600 × 900 viewBox; the ground line sits around y 700–760.

/** mulberry32: a small seeded PRNG returning [0, 1). */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Star = {
  id: string;
  x: number;
  y: number;
  r: number;
  opacity: number;
  twinkle: number;
  delay: number;
};

export const STARS: Star[] = (() => {
  const rand = seededRandom(1031);
  return Array.from({ length: 110 }, (_, i) => ({
    id: `star-${i}`,
    x: rand() * 1600,
    y: rand() * rand() * 560,
    r: 0.5 + rand() * rand() * 1.6,
    opacity: 0.35 + rand() * 0.6,
    twinkle: 2 + rand() * 4,
    delay: rand() * 4
  }));
})();

/**
 * A cloud: a row of puffs, tallest in the middle, over a shallow sag. Each
 * puff is more than a half circle, so neighbours overlap like real billows.
 */
function cloudPath(width: number, height: number, seed: number) {
  const rand = seededRandom(seed);
  const puffs = 6;
  const step = width / puffs;
  let d = "M 0 0";
  for (let i = 0; i < puffs; i++) {
    const swell = 0.56 + 0.3 * Math.sin((Math.PI * (i + 0.5)) / puffs);
    const r = step * swell * (0.9 + rand() * 0.25);
    d += ` A ${r} ${r} 0 1 1 ${(i + 1) * step} 0`;
  }
  return `${d} Q ${width * 0.5} ${height} 0 0 Z`;
}

export const CLOUDS = [
  {
    id: "cloud-far-left",
    x: 40,
    y: 120,
    d: cloudPath(340, 22, 7),
    opacity: 0.4,
    drift: 70
  },
  {
    id: "cloud-far-mid",
    x: 560,
    y: 66,
    d: cloudPath(260, 18, 19),
    opacity: 0.32,
    drift: 85
  },
  {
    id: "cloud-moon",
    x: 1150,
    y: 322,
    d: cloudPath(300, 20, 41),
    opacity: 0.85,
    drift: 55
  }
];

/**
 * A gnarled dead tree, grown recursively. Branches of one depth share a
 * width, so each depth is drawn as a single stroked path.
 */
export const TREE = (() => {
  const rand = seededRandom(666);
  const baseX = 1432;
  const baseY = 790;
  const byDepth: string[] = [];
  const widths: number[] = [];
  let fork = { x: baseX, y: baseY };

  function grow(
    x: number,
    y: number,
    angle: number,
    length: number,
    width: number,
    level: number
  ) {
    const x2 = x + Math.cos(angle) * length;
    const y2 = y + Math.sin(angle) * length;
    // Bend each limb off its straight line, so no branch is a ruler stroke.
    const bend = (rand() - 0.5) * length * 0.42;
    const cx = (x + x2) / 2 - Math.sin(angle) * bend;
    const cy = (y + y2) / 2 + Math.cos(angle) * bend;
    byDepth[level] =
      `${byDepth[level] ?? ""} M ${x} ${y} Q ${cx} ${cy} ${x2} ${y2}`;
    widths[level] = width;
    if (level === 0) fork = { x: x2, y: y2 };
    if (level === 6) return;

    const children = level < 2 ? 2 : rand() < 0.3 ? 3 : 2;
    for (let i = 0; i < children; i++) {
      const spread = 0.42 + rand() * 0.38;
      const offset = (i - (children - 1) / 2) * spread * 1.3;
      // Gravity: limbs droop as they thin out.
      const droop = level > 2 ? 0.08 * level : 0;
      grow(
        x2,
        y2,
        angle + offset + (rand() - 0.5) * 0.35 + droop * Math.sign(offset),
        length * (0.66 + rand() * 0.14),
        width * 0.62,
        level + 1
      );
    }
  }

  grow(baseX, baseY, -Math.PI / 2 - 0.06, 165, 30, 0);

  return {
    branches: byDepth.map((d, level) => ({
      id: `tree-${level}`,
      d,
      width: widths[level]
    })),
    roots: `M ${baseX - 46} ${baseY + 6} C ${baseX - 26} ${baseY - 4}, ${baseX - 18} ${baseY - 22}, ${baseX - 14} ${baseY - 60} L ${baseX + 12} ${baseY - 60} C ${baseX + 16} ${baseY - 20}, ${baseX + 30} ${baseY - 2}, ${baseX + 54} ${baseY + 8} Z`,
    fork
  };
})();

/** A run of iron fence posts with spear tips, a few bent or missing. */
export const FENCE = (() => {
  const rand = seededRandom(13);
  const startX = 520;
  const count = 30;
  const gap = 16;
  const baseY = 712;
  const missing = new Set([9, 10, 21]);
  const posts = [];
  for (let i = 0; i < count; i++) {
    if (missing.has(i)) continue;
    const x = startX + i * gap;
    const tilt = i === 17 ? -14 : i === 4 ? 8 : (rand() - 0.5) * 3;
    posts.push({ id: `post-${i}`, x, tilt });
  }
  return {
    baseY,
    posts,
    rails: `M ${startX - 4} ${baseY - 40} L ${startX + 8.5 * gap} ${baseY - 41} M ${startX + 11 * gap} ${baseY - 39} L ${startX + (count - 1) * gap + 4} ${baseY - 40} M ${startX - 4} ${baseY - 14} L ${startX + (count - 1) * gap + 4} ${baseY - 13}`
  };
})();

export type GravestoneShape = "round" | "cross" | "arch";

export const GRAVESTONES: {
  id: string;
  x: number;
  y: number;
  scale: number;
  tilt: number;
  shape: GravestoneShape;
}[] = [
  { id: "stone-1", x: 640, y: 786, scale: 1, tilt: -6, shape: "round" },
  { id: "stone-2", x: 758, y: 792, scale: 0.78, tilt: 5, shape: "cross" },
  { id: "stone-3", x: 892, y: 782, scale: 1.12, tilt: -2, shape: "arch" },
  { id: "stone-4", x: 1052, y: 790, scale: 0.8, tilt: 9, shape: "round" }
];

/** Spiky grass tufts along the foreground, as one path. */
export const GRASS = (() => {
  const rand = seededRandom(404);
  let d = "";
  for (let x = 0; x < 1600; x += 9 + rand() * 14) {
    const base = 772 + Math.sin(x / 140) * 10;
    const height = 6 + rand() * 16;
    const lean = (rand() - 0.5) * 8;
    d += ` M ${x} ${base + 4} L ${x + 2 + lean} ${base - height} L ${x + 5} ${base + 4} Z`;
  }
  return d;
})();

export type BatFlight = {
  id: string;
  x: number[];
  y: number[];
  scale: number[];
  rotate: number[];
  duration: number;
  delay: number;
  flap: number;
};

// The tower top, where the colony bursts out.
const TOWER = { x: 437, y: 330 };

export const BATS: BatFlight[] = [
  // Far bats crossing the moon.
  {
    id: "bat-moon-1",
    x: [1040, 1230, 1420, 1760],
    y: [262, 200, 226, 160],
    scale: [0.22, 0.24, 0.25, 0.28],
    rotate: [0, -6, 4, -4],
    duration: 6.5,
    delay: 0.9,
    flap: 0.2
  },
  {
    id: "bat-moon-2",
    x: [1760, 1500, 1300, 980],
    y: [130, 180, 160, 206],
    scale: [0.2, 0.2, 0.18, 0.17],
    rotate: [0, 6, -4, 4],
    duration: 7,
    delay: 2.8,
    flap: 0.18
  },
  // The colony bursting out of the tower, flying at the viewer.
  {
    id: "bat-tower-1",
    x: [TOWER.x, 330, 170, -180],
    y: [TOWER.y, 240, 170, 60],
    scale: [0.08, 0.34, 0.7, 1.25],
    rotate: [0, -12, -6, -18],
    duration: 3.4,
    delay: 0.8,
    flap: 0.17
  },
  {
    id: "bat-tower-2",
    x: [TOWER.x, 620, 1050, 1780],
    y: [TOWER.y, 268, 236, 120],
    scale: [0.08, 0.3, 0.62, 1.15],
    rotate: [0, 10, 4, 12],
    duration: 4.2,
    delay: 1.2,
    flap: 0.2
  },
  {
    id: "bat-tower-3",
    x: [TOWER.x, 500, 620, 880],
    y: [TOWER.y, 210, 80, -200],
    scale: [0.08, 0.28, 0.6, 1.3],
    rotate: [0, 8, 14, 20],
    duration: 3.6,
    delay: 1.6,
    flap: 0.19
  },
  {
    id: "bat-tower-4",
    x: [TOWER.x, 300, 120, -200],
    y: [TOWER.y, 340, 400, 470],
    scale: [0.08, 0.32, 0.72, 1.4],
    rotate: [0, -8, -14, -10],
    duration: 3.9,
    delay: 2.2,
    flap: 0.16
  },
  {
    id: "bat-tower-5",
    x: [TOWER.x, 700, 1150, 1800],
    y: [TOWER.y, 380, 470, 560],
    scale: [0.08, 0.4, 0.95, 1.9],
    rotate: [0, 6, 10, 8],
    duration: 4.4,
    delay: 2.9,
    flap: 0.22
  },
  {
    id: "bat-tower-6",
    x: [TOWER.x, 420, 360, 220],
    y: [TOWER.y, 200, 40, -220],
    scale: [0.08, 0.3, 0.66, 1.2],
    rotate: [0, -4, -10, -16],
    duration: 3.5,
    delay: 3.6,
    flap: 0.18
  },
  {
    id: "bat-tower-7",
    x: [TOWER.x, 760, 1300, 1760],
    y: [TOWER.y, 300, 330, 300],
    scale: [0.08, 0.26, 0.5, 0.9],
    rotate: [0, 4, -4, 6],
    duration: 4.8,
    delay: 4.3,
    flap: 0.21
  }
];
