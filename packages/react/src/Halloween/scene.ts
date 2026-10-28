// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Geometry for the Halloween scene. Everything is generated from fixed seeds,
// so the scene is identical on every open. The scene's coordinates are a
// 1600 × 900 viewBox; the ground line sits around y 700–760.

import { seeded } from "./math";

export type Star = {
  id: string;
  x: number;
  y: number;
  r: number;
  opacity: number;
  twinkle: number;
  delay: number;
};

// Most stars are faint pinpricks; a cubed random keeps the big ones rare.
export const STARS: Star[] = (() => {
  const rand = seeded(1031);
  return Array.from({ length: 120 }, (_, i) => {
    const size = rand();
    return {
      id: `star-${i}`,
      x: rand() * 1760 - 80,
      y: rand() * rand() * 600,
      r: 0.45 + size * size * size * 1.9,
      opacity: 0.3 + rand() * 0.65,
      twinkle: 2 + rand() * 4,
      delay: rand() * 4
    };
  });
})();

/** The few bright stars that carry a four-point glint. */
export const BRIGHT_STARS = [
  { id: "bright-1", x: 92, y: 236, size: 1, twinkle: 3.4 },
  { id: "bright-2", x: 566, y: 44, size: 0.8, twinkle: 4.1 },
  { id: "bright-3", x: 1046, y: 72, size: 1.15, twinkle: 2.9 },
  { id: "bright-4", x: 1568, y: 72, size: 0.85, twinkle: 3.7 },
  { id: "bright-5", x: 1110, y: 344, size: 0.7, twinkle: 4.6 },
  { id: "bright-6", x: 650, y: 392, size: 0.75, twinkle: 3.1 },
  { id: "bright-7", x: 26, y: 70, size: 0.9, twinkle: 5 }
];

/**
 * The faint band of the galaxy: dust-sized stars scattered either side of a
 * line from the top left down towards the moon, as one path of tiny circles.
 */
export const STAR_DUST = (() => {
  const rand = seeded(2203);
  let d = "";
  for (let i = 0; i < 220; i++) {
    const t = rand();
    // Summing randoms piles the dust up along the middle of the band.
    const across = (rand() + rand() + rand() - 1.5) * 64;
    const x = -60 + t * 1720 + across * 0.32;
    const y = 30 + t * 330 + across;
    const r = 0.3 + rand() * 0.55;
    d += ` M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  }
  return d;
})();

/**
 * The opening lightning: a jagged main channel from above the screen down
 * behind the hills, with forks that peter out. Each step wanders sideways a
 * little and leans back towards the line, the way a real channel does.
 */
export const LIGHTNING = (() => {
  const rand = seeded(1310);
  function channel(
    x: number,
    y: number,
    toX: number,
    toY: number,
    steps: number,
    jitter: number
  ) {
    let d = `M ${x} ${y}`;
    const points: { x: number; y: number }[] = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const lineX = x + (toX - x) * t;
      const lineY = y + (toY - y) * t;
      const px = i === steps ? toX : lineX + (rand() - 0.5) * jitter;
      const py = i === steps ? toY : lineY + (rand() - 0.5) * jitter * 0.4;
      d += ` L ${px} ${py}`;
      points.push({ x: px, y: py });
    }
    return { d, points };
  }
  const main = channel(806, -30, 712, 616, 34, 34);
  const forkAt = (i: number) => main.points[i] ?? { x: 760, y: 300 };
  const a = forkAt(9);
  const b = forkAt(17);
  const c = forkAt(24);
  const forks = [
    channel(a.x, a.y, a.x - 120, a.y + 150, 9, 22),
    channel(b.x, b.y, b.x + 110, b.y + 120, 8, 20),
    channel(c.x, c.y, c.x - 70, c.y + 70, 5, 14)
  ];
  return { main: main.d, forks: forks.map((fork) => fork.d).join(" ") };
})();

/** Shooting stars: where each starts, the way it heads, when it streaks. */
export const SHOOTING_STARS = [
  { id: "meteor-1", x: 980, y: 30, angle: 160, length: 120, begin: 2.1 },
  { id: "meteor-2", x: 1560, y: 360, angle: 168, length: 90, begin: 5.2 },
  { id: "meteor-3", x: 260, y: 30, angle: 150, length: 100, begin: 7.6 }
];

/**
 * A cloud: a row of puffs, tallest in the middle, over a shallow sag. Each
 * puff is more than a half circle, so neighbours overlap like real billows.
 */
function cloudPath(width: number, height: number, seed: number) {
  const rand = seeded(seed);
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

/** `lit`: how much moonlight catches the cloud's upper edge, 0 to 1. */
export const CLOUDS = [
  {
    id: "cloud-far-left",
    x: 30,
    y: 116,
    d: cloudPath(360, 24, 7),
    opacity: 0.5,
    lit: 0.25,
    drift: 40
  },
  {
    id: "cloud-far-mid",
    x: 560,
    y: 62,
    d: cloudPath(260, 18, 19),
    opacity: 0.4,
    lit: 0.3,
    drift: 48
  },
  {
    id: "cloud-high-right",
    x: 1460,
    y: 70,
    d: cloudPath(220, 16, 23),
    opacity: 0.45,
    lit: 0.55,
    drift: 44
  },
  {
    id: "cloud-moon",
    x: 1150,
    y: 322,
    d: cloudPath(300, 20, 41),
    // Solid, being in front of the moon: any see-through let its rim show.
    opacity: 1,
    lit: 1,
    drift: 34
  }
];

/**
 * A gnarled dead tree, grown recursively. Branches of one depth share a
 * width, so each depth is drawn as a single stroked path.
 */
export const TREE = (() => {
  const rand = seeded(666);
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
    // A long low limb reaching left, with a lantern hung near its end.
    // Filled rather than stroked, so it tapers from the trunk to its tip.
    limb: "M 1444 704 Q 1382 656 1300 658 Q 1290 662 1298 666 Q 1374 672 1440 730 Z",
    twigs:
      "M 1332 662 Q 1314 648 1306 630 M 1374 674 Q 1362 690 1356 708 M 1300 660 Q 1286 654 1276 644",
    hook: { x: 1321, y: 667 },
    roots: `M ${baseX - 46} ${baseY + 6} C ${baseX - 26} ${baseY - 4}, ${baseX - 18} ${baseY - 22}, ${baseX - 14} ${baseY - 60} L ${baseX + 12} ${baseY - 60} C ${baseX + 16} ${baseY - 20}, ${baseX + 30} ${baseY - 2}, ${baseX + 54} ${baseY + 8} Z`,
    fork
  };
})();

/**
 * A run of iron fence posts with spear tips, a few bent or missing, broken by
 * the graveyard gate between two stone pillars.
 */
export const FENCE = (() => {
  const rand = seeded(13);
  const startX = 520;
  const count = 30;
  const gap = 16;
  const baseY = 712;
  const gate = { left: startX + 8 * gap, right: startX + 12 * gap };
  const missing = new Set([8, 9, 10, 11, 12, 21]);
  const posts = [];
  for (let i = 0; i < count; i++) {
    if (missing.has(i)) continue;
    const x = startX + i * gap;
    const tilt = i === 17 ? -14 : i === 4 ? 8 : (rand() - 0.5) * 3;
    posts.push({ id: `post-${i}`, x, tilt });
  }
  const end = startX + (count - 1) * gap + 4;
  return {
    baseY,
    posts,
    gate,
    rails: `M ${startX - 4} ${baseY - 40} L ${gate.left} ${baseY - 41} M ${gate.right} ${baseY - 39} L ${startX + 20.5 * gap} ${baseY - 40} M ${startX + 21.5 * gap} ${baseY - 41} L ${end} ${baseY - 40} M ${startX - 4} ${baseY - 14} L ${gate.left} ${baseY - 13} M ${gate.right} ${baseY - 14} L ${end} ${baseY - 13}`
  };
})();

export type GravestoneShape =
  | "round"
  | "cross"
  | "arch"
  | "slab"
  | "obelisk"
  | "celtic";

export type Gravestone = {
  id: string;
  x: number;
  y: number;
  scale: number;
  tilt: number;
  shape: GravestoneShape;
  /** Further back: smaller and paler in the fog. */
  far?: boolean;
};

// Back row first, so the front row overlaps it. The ghost rises from stone-4.
export const GRAVESTONES: Gravestone[] = [
  {
    id: "stone-back-1",
    x: 742,
    y: 748,
    scale: 0.5,
    tilt: 4,
    shape: "slab",
    far: true
  },
  {
    id: "stone-back-2",
    x: 968,
    y: 746,
    scale: 0.52,
    tilt: -6,
    shape: "obelisk",
    far: true
  },
  {
    id: "stone-back-3",
    x: 1186,
    y: 752,
    scale: 0.46,
    tilt: 3,
    shape: "round",
    far: true
  },
  {
    id: "stone-back-4",
    x: 836,
    y: 750,
    scale: 0.42,
    tilt: -9,
    shape: "cross",
    far: true
  },
  { id: "stone-5", x: 430, y: 800, scale: 0.86, tilt: 7, shape: "celtic" },
  { id: "stone-1", x: 640, y: 786, scale: 1, tilt: -6, shape: "round" },
  { id: "stone-2", x: 758, y: 792, scale: 0.78, tilt: 5, shape: "cross" },
  { id: "stone-3", x: 892, y: 782, scale: 1.12, tilt: -2, shape: "arch" },
  { id: "stone-4", x: 1052, y: 790, scale: 0.8, tilt: 9, shape: "round" },
  { id: "stone-6", x: 1322, y: 800, scale: 0.84, tilt: -11, shape: "slab" },
  { id: "stone-7", x: 74, y: 812, scale: 1.05, tilt: 4, shape: "obelisk" }
];

/**
 * Clumps of curved grass blades as one path. Each blade is a thin sliver
 * between two quadratics, so it tapers to a point and bends with its lean.
 */
function bladesPath({
  seed,
  from,
  to,
  every,
  base,
  height,
  perClump
}: {
  seed: number;
  from: number;
  to: number;
  every: [number, number];
  base: (x: number) => number;
  height: [number, number];
  perClump: number;
}) {
  const rand = seeded(seed);
  let d = "";
  for (let x = from; x < to; x += every[0] + rand() * (every[1] - every[0])) {
    const ground = base(x);
    const blades = 2 + rand() * perClump;
    for (let b = 0; b < blades; b++) {
      const foot = x + (rand() - 0.5) * 10;
      const tall = height[0] + rand() * (height[1] - height[0]);
      const lean = (rand() - 0.5) * tall * 0.9;
      const width = 1.2 + tall * 0.035;
      const tipX = foot + lean;
      const tipY = ground - tall;
      d += ` M ${foot - width} ${ground + 4} Q ${foot + lean * 0.2 - width * 0.4} ${ground - tall * 0.55} ${tipX} ${tipY} Q ${foot + lean * 0.25 + width * 0.6} ${ground - tall * 0.5} ${foot + width} ${ground + 4} Z`;
    }
  }
  return d;
}

/** Grass along the front of the graveyard. */
export const GRASS = bladesPath({
  seed: 404,
  from: -80,
  to: 1680,
  every: [12, 30],
  base: (x) => 772 + Math.sin(x / 140) * 10,
  height: [6, 24],
  perClump: 3
});

/** Grass further back, along the fence line. */
export const FAR_GRASS = bladesPath({
  seed: 405,
  from: -80,
  to: 1680,
  every: [18, 42],
  base: (x) => 712 + Math.sin(x / 190) * 6,
  height: [4, 11],
  perClump: 1.5
});

/** Tall weeds framing the bottom corners, nearest the viewer. */
export const WEEDS = `${bladesPath({
  seed: 77,
  from: -80,
  to: 210,
  every: [8, 18],
  base: (x) => 906 - Math.max(0, 140 - x) * 0.04,
  height: [30, 120],
  perClump: 3
})} ${bladesPath({
  seed: 78,
  from: 1440,
  to: 1690,
  every: [8, 18],
  base: () => 906,
  height: [26, 104],
  perClump: 3
})}`;

/** The far ridge as a sampled line, with a row of cypresses along its top. */
export const FAR_RIDGE = (() => {
  const ridge = (x: number) =>
    604 + Math.sin(x / 170) * 14 + Math.sin(x / 53 + 1) * 5;
  let line = `M -80 ${ridge(-80)}`;
  for (let x = -70; x <= 1680; x += 10) line += ` L ${x} ${ridge(x)}`;
  const d = `${line} L 1680 900 L -80 900 Z`;

  const rand = seeded(91);
  let trees = "";
  for (const x of [618, 640, 652, 846, 862, 1000, 1018, 1196, 1210]) {
    const tall = 14 + rand() * 16;
    const half = tall * 0.17;
    const foot = ridge(x) + 3;
    trees += ` M ${x - half} ${foot} Q ${x - half} ${foot - tall * 0.6} ${x} ${foot - tall} Q ${x + half} ${foot - tall * 0.6} ${x + half} ${foot} Z`;
  }
  return { line, d, trees };
})();

export type Drifter = {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  dur: number;
  blink: number;
  begin: number;
  r: number;
};

/** Fireflies over the graveyard, each wandering its own small loop. */
export const FIREFLIES: Drifter[] = (() => {
  const rand = seeded(3110);
  return Array.from({ length: 18 }, (_, i) => ({
    id: `firefly-${i}`,
    x: 260 + rand() * 1300,
    y: 630 + rand() * 210,
    dx: (rand() - 0.5) * 50,
    dy: (rand() - 0.5) * 36,
    dur: 5 + rand() * 5,
    blink: 1.6 + rand() * 2.6,
    begin: rand() * 3,
    r: 1.3 + rand() * 1.2
  }));
})();

/** Will-o'-the-wisps: three cold lights drifting low over the graves. */
export const WISPS: Drifter[] = [
  {
    id: "wisp-1",
    x: 708,
    y: 694,
    dx: 46,
    dy: -14,
    dur: 9,
    blink: 3.8,
    begin: 0,
    r: 5
  },
  {
    id: "wisp-2",
    x: 990,
    y: 722,
    dx: -40,
    dy: -18,
    dur: 11,
    blink: 4.6,
    begin: 1.4,
    r: 4
  },
  {
    id: "wisp-3",
    x: 1268,
    y: 700,
    dx: 30,
    dy: 12,
    dur: 8,
    blink: 3.2,
    begin: 0.7,
    r: 3.6
  }
];

export type FogPuff = {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};

/** One bank of ground fog: a row of soft overlapping puffs. */
function fogBank(seed: number, y: number, rx: number, ry: number): FogPuff[] {
  const rand = seeded(seed);
  const puffs: FogPuff[] = [];
  for (let x = -260; x < 1900; x += rx * (0.7 + rand() * 0.5)) {
    puffs.push({
      id: `fog-${seed}-${puffs.length}`,
      cx: x,
      cy: y + (rand() - 0.5) * ry * 0.8,
      rx: rx * (0.8 + rand() * 0.5),
      ry: ry * (0.7 + rand() * 0.6)
    });
  }
  return puffs;
}

export const FOG = {
  far: fogBank(51, 708, 260, 34),
  mid: fogBank(52, 786, 240, 30),
  near: fogBank(53, 880, 330, 48)
};

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
