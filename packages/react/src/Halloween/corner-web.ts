// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

import { at, seeded } from "./math";

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
  const rand = seeded(side === "left" ? 4242 : 777);
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
      const angle = at(SPOKE_ANGLES, spoke) + (rand() - 0.5) * 0.06;
      const r = at(RING_RADII, ring) * (1 + (rand() - 0.5) * 0.08);
      restX[knot(spoke, ring)] = cornerX + sx * Math.cos(angle) * r;
      restY[knot(spoke, ring)] = Math.sin(angle) * r;
    }
  }

  const springs: { a: number; b: number; rest: number }[] = [];
  const tie = (a: number, b: number) =>
    springs.push({
      a,
      b,
      rest:
        Math.hypot(at(restX, b) - at(restX, a), at(restY, b) - at(restY, a)) *
        PRETENSION
    });
  const spokeChains = SPOKE_ANGLES.map((_, spoke) => [
    CORNER,
    ...RING_RADII.map((_, ring) => knot(spoke, ring))
  ]);
  for (const chain of spokeChains) {
    for (let j = 0; j < chain.length - 1; j++) {
      tie(at(chain, j), at(chain, j + 1));
    }
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
      if (!isTorn(ring, j)) tie(at(chain, j), at(chain, j + 1));
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
      const dx = at(x, b) - at(x, a);
      const dy = at(y, b) - at(y, a);
      const length = Math.hypot(dx, dy) || 1e-6;
      if (length <= rest) continue;
      const f = (STIFFNESS * (length - rest)) / length;
      fx[a] = at(fx, a) + f * dx;
      fy[a] = at(fy, a) + f * dy;
      fx[b] = at(fx, b) - f * dx;
      fy[b] = at(fy, b) - f * dy;
    }
    for (let i = 0; i < points; i++) {
      if (fixed[i]) continue;
      const ax =
        at(fx, i) +
        at(ex, i) +
        SHAPE_STIFFNESS * (at(restX, i) - at(x, i)) -
        DAMPING * at(vx, i);
      const ay =
        at(fy, i) +
        at(ey, i) +
        SHAPE_STIFFNESS * (at(restY, i) - at(y, i)) -
        DAMPING * at(vy, i);
      vx[i] = at(vx, i) + ax * dt;
      vy[i] = at(vy, i) + ay * dt;
      x[i] = at(x, i) + at(vx, i) * dt;
      y[i] = at(y, i) + at(vy, i) * dt;
    }
    ex.fill(0);
    ey.fill(0);
  }

  return {
    /** Where the spider hides, now. */
    hub: (): Point => ({ x: at(x, hideKnot), y: at(y, hideKnot) }),
    /** The spider's weight while it hides there. */
    loadHub(forceX: number, forceY: number) {
      ex[hideKnot] = at(ex, hideKnot) + forceX;
      ey[hideKnot] = at(ey, hideKnot) + forceY;
    },
    step,
    /** Brush the threads near a point, as a passing hand would. */
    brush(px: number, py: number, pvx: number, pvy: number) {
      let touched = false;
      for (let i = 0; i < points; i++) {
        if (fixed[i]) continue;
        const gap = Math.hypot(at(x, i) - px, at(y, i) - py);
        if (gap > 12) continue;
        const falloff = 1 - gap / 12;
        vx[i] = at(vx, i) + pvx * 0.2 * falloff;
        vy[i] = at(vy, i) + pvy * 0.2 * falloff;
        touched = true;
      }
      return touched;
    },
    /** Every knot flung outwards: the web bursts. */
    burst(random: () => number) {
      for (let i = 0; i < points; i++) {
        if (fixed[i]) continue;
        const dx = at(x, i) - cornerX;
        const dy = at(y, i);
        const length = Math.hypot(dx, dy) || 1;
        const kick = 120 + random() * 140;
        vx[i] = at(vx, i) + ((dx / length) * kick + (random() - 0.5) * 80);
        vy[i] = at(vy, i) + ((dy / length) * kick + (random() - 0.5) * 80);
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
        const speedX = at(vx, i);
        const speedY = at(vy, i);
        fastest = Math.max(fastest, speedX * speedX + speedY * speedY);
      }
      return fastest;
    },
    /** Every point of the web now, for checking it stays in its corner. */
    knots(): Point[] {
      return Array.from(x, (value, i) => ({ x: value, y: at(y, i) }));
    },
    /** The threads as SVG path data, from where the knots are now. */
    paths() {
      let spokes = "";
      for (const chain of spokeChains) {
        const start = at(chain, 0);
        spokes += `M ${at(x, start)} ${at(y, start)}`;
        for (let j = 1; j < chain.length; j++) {
          const k = at(chain, j);
          spokes += ` L ${at(x, k)} ${at(y, k)}`;
        }
        spokes += " ";
      }
      let rings = "";
      ringChains.forEach((chain, ring) => {
        const start = at(chain, 0);
        rings += `M ${at(x, start)} ${at(y, start)}`;
        for (let j = 0; j < chain.length - 1; j++) {
          const a = at(chain, j);
          const b = at(chain, j + 1);
          if (isTorn(ring, j)) {
            rings += ` M ${at(x, b)} ${at(y, b)}`;
            continue;
          }
          // Each span sags towards the corner: the classic scallop.
          const mx = (at(x, a) + at(x, b)) / 2;
          const my = (at(y, a) + at(y, b)) / 2;
          const cx = mx + (cornerX - mx) * SAG;
          const cy = my + (0 - my) * SAG;
          rings += ` Q ${cx} ${cy} ${at(x, b)} ${at(y, b)}`;
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
