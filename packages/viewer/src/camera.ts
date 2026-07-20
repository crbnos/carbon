import type { Vec3 } from "./types";

// Plain-array math so this stays importable server-side without pulling
// three.js into the bundle. The per-step view DIRECTION is baked by the Rust
// planner (mesh-precise sight lines, plan.json `viewDirection`); this module
// is the live half of that split — fitting the frame at the real viewport
// aspect once a direction is chosen (AssemblyPlayer's camera effect).

export type FramingFit = {
  /** Target shift along the camera's [right, up] axes (world units) */
  pan: [number, number];
  /** Eye distance from the (shifted) target */
  distance: number;
};

/**
 * Minimal view-plane pan — and, only when the action genuinely can't fit,
 * a grown eye distance — that puts every point inside the camera frustum
 * with `margin` of the half-frustum usable (0.85 leaves a 15% border).
 *
 * Points are in CAMERA coordinates relative to the target: [right, up, view]
 * where `view` points from the target toward the eye. A point at [x, y, v]
 * sits at eye depth (distance − v) and is horizontally contained iff
 * |x − panX| ≤ margin · tanHalfH · (distance − v); the pan interval is the
 * intersection of those constraints, per axis, and the smallest |pan| inside
 * it wins. Distance never shrinks below `standingDistance` — the per-step
 * zoom stays steady.
 */
export function fitFraming(
  points: readonly Vec3[],
  tanHalfH: number,
  tanHalfV: number,
  margin: number,
  standingDistance: number
): FramingFit {
  if (points.length === 0) return { pan: [0, 0], distance: standingDistance };
  const maxDistance = standingDistance * 4;
  // Smallest shift inside [lo, hi]; interval midpoint when it's empty
  const pick = (lo: number, hi: number): number =>
    lo <= hi ? Math.min(Math.max(0, lo), hi) : (lo + hi) / 2;
  let distance = standingDistance;
  for (;;) {
    let loX = Number.NEGATIVE_INFINITY;
    let hiX = Number.POSITIVE_INFINITY;
    let loY = Number.NEGATIVE_INFINITY;
    let hiY = Number.POSITIVE_INFINITY;
    let allInFront = true;
    for (const [x, y, v] of points) {
      const depth = distance - v;
      if (depth <= 1e-6) {
        allInFront = false;
        break;
      }
      const hx = margin * tanHalfH * depth;
      const hy = margin * tanHalfV * depth;
      loX = Math.max(loX, x - hx);
      hiX = Math.min(hiX, x + hx);
      loY = Math.max(loY, y - hy);
      hiY = Math.min(hiY, y + hy);
    }
    if (allInFront && loX <= hiX && loY <= hiY) {
      return { pan: [pick(loX, hiX), pick(loY, hiY)], distance };
    }
    if (distance >= maxDistance) {
      // Give up growing: best-effort pan (midpoints of the empty intervals)
      return allInFront
        ? { pan: [pick(loX, hiX), pick(loY, hiY)], distance }
        : { pan: [0, 0], distance };
    }
    distance = Math.min(distance * 1.2, maxDistance);
  }
}
