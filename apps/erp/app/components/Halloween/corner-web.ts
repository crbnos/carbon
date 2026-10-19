// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { seededRandom } from "./scene";

// The classic cobweb in a corner: spokes fanning out from where the bar's
// top edge meets its side, and rings strung between them, each span sagging
// towards the corner. One outer strand has snapped and hangs loose.
//
// It is a small mass–spring network: every strand is silk that pulls but
// never pushes, spun a little short so the web is taut, and every knot is
// tied loosely to its resting place so the web keeps its shape. A hand
// brushing it sets it swaying.
//
// Coordinates are the bar's own: its top edge is y 0, its left edge x 0, its
// lower border y BAR_HEIGHT.

export const BAR_HEIGHT = 49;

type Point = { x: number; y: number };

const SPOKE_ANGLES = [9, 24, 39, 54, 69, 82].map((d) => (d * Math.PI) / 180);
const RING_RADII = [9, 17, 26, 35];
// The outermost ring has snapped between these two spokes.
const TORN_AFTER_SPOKE = 2;
// How far each ring span sags towards the corner, as a share of its reach.
const SAG = 0.13;
const PRETENSION = 0.97;

const STIFFNESS = 140;
const SHAPE_STIFFNESS = 20;
const DAMPING = 4.8;

const SPOKES = SPOKE_ANGLES.length;
const RINGS = RING_RADII.length;
// Where the spider hides: on the middle spoke, two rings out.
const HIDE_SPOKE = 2;
const HIDE_RING = 1;

export function createCornerWeb(side: "left" | "right", width: number) {
  const rand = seededRandom(side === "left" ? 4242 : 777);
  // Out from the corner: +x along the top edge for the left corner, -x for
  // the right; +y down the side.
  const sx = side === "left" ? 1 : -1;
  const cornerX = side === "left" ? 0 : width;

  const CORNER = 0;
  const topWall = (ring: number) => 1 + ring;
  const sideWall = (ring: number) => 1 + RINGS + ring;
  const knot = (spoke: number, ring: number) =>
    1 + 2 * RINGS + spoke * RINGS + ring;
  const points = 1 + 2 * RINGS + SPOKES * RINGS;

  const restX = new Float32Array(points);
  const restY = new Float32Array(points);
  const fixed = new Uint8Array(points);
  restX[CORNER] = cornerX;
  restY[CORNER] = 0;
  fixed[CORNER] = 1;
  RING_RADII.forEach((r, ring) => {
    restX[topWall(ring)] = cornerX + sx * r;
    restY[topWall(ring)] = 0;
    fixed[topWall(ring)] = 1;
    restX[sideWall(ring)] = cornerX;
    restY[sideWall(ring)] = r;
    fixed[sideWall(ring)] = 1;
  });
  for (let spoke = 0; spoke < SPOKES; spoke++) {
    for (let ring = 0; ring < RINGS; ring++) {
      // Hand-spun: never quite regular.
      const angle = SPOKE_ANGLES[spoke] + (rand() - 0.5) * 0.06;
      const r = RING_RADII[ring] * (1 + (rand() - 0.5) * 0.08);
      restX[knot(spoke, ring)] = cornerX + sx * Math.cos(angle) * r;
      restY[knot(spoke, ring)] = Math.sin(angle) * r;
    }
  }

  const springs: { a: number; b: number; rest: number }[] = [];
  const tie = (a: number, b: number) =>
    springs.push({
      a,
      b,
      rest: Math.hypot(restX[b] - restX[a], restY[b] - restY[a]) * PRETENSION
    });
  const spokeChains = SPOKE_ANGLES.map((_, spoke) => [
    CORNER,
    ...RING_RADII.map((_, ring) => knot(spoke, ring))
  ]);
  for (const chain of spokeChains) {
    for (let j = 0; j < chain.length - 1; j++) tie(chain[j], chain[j + 1]);
  }
  // Each ring runs from the top edge, through every spoke, to the side.
  const ringChains = RING_RADII.map((_, ring) => [
    topWall(ring),
    ...SPOKE_ANGLES.map((_, spoke) => knot(spoke, ring)),
    sideWall(ring)
  ]);
  const isTorn = (ring: number, j: number) =>
    ring === RINGS - 1 && j === TORN_AFTER_SPOKE + 1;
  ringChains.forEach((chain, ring) => {
    for (let j = 0; j < chain.length - 1; j++) {
      if (!isTorn(ring, j)) tie(chain[j], chain[j + 1]);
    }
  });

  const x = Float32Array.from(restX);
  const y = Float32Array.from(restY);
  const vx = new Float32Array(points);
  const vy = new Float32Array(points);
  const fx = new Float32Array(points);
  const fy = new Float32Array(points);
  const ex = new Float32Array(points);
  const ey = new Float32Array(points);
  const hideKnot = knot(HIDE_SPOKE, HIDE_RING);

  function step(dt: number) {
    fx.fill(0);
    fy.fill(0);
    for (const { a, b, rest } of springs) {
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const length = Math.hypot(dx, dy) || 1e-6;
      if (length <= rest) continue;
      const f = (STIFFNESS * (length - rest)) / length;
      fx[a] += f * dx;
      fy[a] += f * dy;
      fx[b] -= f * dx;
      fy[b] -= f * dy;
    }
    for (let i = 0; i < points; i++) {
      if (fixed[i]) continue;
      const ax =
        fx[i] + ex[i] + SHAPE_STIFFNESS * (restX[i] - x[i]) - DAMPING * vx[i];
      const ay =
        fy[i] + ey[i] + SHAPE_STIFFNESS * (restY[i] - y[i]) - DAMPING * vy[i];
      vx[i] += ax * dt;
      vy[i] += ay * dt;
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
    }
    ex.fill(0);
    ey.fill(0);
  }

  return {
    /** Where the spider hides, now. */
    hub: (): Point => ({ x: x[hideKnot], y: y[hideKnot] }),
    /** The spider's weight while it hides there. */
    loadHub(forceX: number, forceY: number) {
      ex[hideKnot] += forceX;
      ey[hideKnot] += forceY;
    },
    step,
    /** Brush the threads near a point, as a passing hand would. */
    brush(px: number, py: number, pvx: number, pvy: number) {
      let touched = false;
      for (let i = 0; i < points; i++) {
        if (fixed[i]) continue;
        const gap = Math.hypot(x[i] - px, y[i] - py);
        if (gap > 12) continue;
        const falloff = 1 - gap / 12;
        vx[i] += pvx * 0.2 * falloff;
        vy[i] += pvy * 0.2 * falloff;
        touched = true;
      }
      return touched;
    },
    /** Every knot flung outwards: the web bursts. */
    burst(random: () => number) {
      for (let i = 0; i < points; i++) {
        if (fixed[i]) continue;
        const dx = x[i] - cornerX;
        const dy = y[i];
        const length = Math.hypot(dx, dy) || 1;
        const kick = 120 + random() * 140;
        vx[i] += (dx / length) * kick + (random() - 0.5) * 80;
        vy[i] += (dy / length) * kick + (random() - 0.5) * 80;
      }
    },
    reset() {
      x.set(restX);
      y.set(restY);
      vx.fill(0);
      vy.fill(0);
    },
    /** The fastest knot's speed squared: how far from still the web is. */
    restlessness() {
      let fastest = 0;
      for (let i = 0; i < points; i++) {
        fastest = Math.max(fastest, vx[i] * vx[i] + vy[i] * vy[i]);
      }
      return fastest;
    },
    /** Every point of the web now, for checking it stays in its corner. */
    knots(): Point[] {
      return Array.from(x, (value, i) => ({ x: value, y: y[i] }));
    },
    /** The threads as SVG path data, from where the knots are now. */
    paths() {
      let spokes = "";
      for (const chain of spokeChains) {
        spokes += `M ${x[chain[0]]} ${y[chain[0]]}`;
        for (let j = 1; j < chain.length; j++) {
          spokes += ` L ${x[chain[j]]} ${y[chain[j]]}`;
        }
        spokes += " ";
      }
      let rings = "";
      ringChains.forEach((chain, ring) => {
        rings += `M ${x[chain[0]]} ${y[chain[0]]}`;
        for (let j = 0; j < chain.length - 1; j++) {
          const a = chain[j];
          const b = chain[j + 1];
          if (isTorn(ring, j)) {
            rings += ` M ${x[b]} ${y[b]}`;
            continue;
          }
          // Each span sags towards the corner: the classic scallop.
          const mx = (x[a] + x[b]) / 2;
          const my = (y[a] + y[b]) / 2;
          const cx = mx + (cornerX - mx) * SAG;
          const cy = my + (0 - my) * SAG;
          rings += ` Q ${cx} ${cy} ${x[b]} ${y[b]}`;
        }
        rings += " ";
      });
      // The snapped strand's two loose ends hang from their knots.
      const left = knot(TORN_AFTER_SPOKE, RINGS - 1);
      const right = knot(TORN_AFTER_SPOKE + 1, RINGS - 1);
      const torn = `M ${x[left]} ${y[left]} q ${-2 * sx} 4 ${1 * sx} 8 M ${x[right]} ${y[right]} q ${2 * sx} 3 ${-0.5 * sx} 6`;
      return { spokes, rings, torn };
    }
  };
}

export type CornerWeb = ReturnType<typeof createCornerWeb>;
