// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Box3, Vector3 } from "three";
import { waypointMatrix } from "./keyframes";
import { toQuaternion } from "./quat";
import type { Motion, Vec3 } from "./types";

// The per-step view DIRECTION is baked by the Rust planner (mesh-precise
// sight lines, plan.json `viewDirection`); this module is the live half of
// that split — choosing a direction when there is no baked one, and fitting
// the frame at the real viewport aspect (AssemblyPlayer's camera effect).
// Pure: no scene, no camera, no React.

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

export type FramingOccluder = { min: Vector3; max: Vector3; weight: number };

export type StepFramingInput = {
  /** Seated bounds of the build the step happens in. */
  buildBox: Box3;
  /** What the step's own insertion moves, seated; empty when nothing. */
  ownBox: Box3;
  motion: Motion;
  /** Carried units flying their own path: seated bounds and path. */
  pathUnits: { box: Box3; motion: Motion }[];
  /** A unit gliding in beside the build, where its glide starts. */
  glideStartBox: Box3 | null;
  /** Visible geometry that can block the view, for the live scoring. */
  occluders: FramingOccluder[];
  /** The bench's up in the model frame. */
  up: Vector3;
  /** Where the camera looks from now (target → eye, unit), in the step's frame. */
  currentDirection: Vector3;
  /**
   * The build is turned: keep `currentDirection`. Re-aiming picks a side by
   * geometry alone, which undoes a spin (a spin is just an orbit) and shows a
   * pose the author never chose.
   */
  turned: boolean;
  /**
   * The planner's view direction. Only used on an upright build: it was picked
   * for the upright model and turns with it.
   */
  planDirection: Vector3 | null;
  /** Vertical field of view, degrees. */
  fov: number;
  aspect: number;
};

/**
 * The camera pose for one step: the whole build in view at a steady standing
 * distance, aimed a little toward the action (the step's own parts, seated and
 * at their start, and each carried unit), from the chosen direction, panned —
 * and only pushed back when it can't fit — so all of the action is in frame.
 * Null when there is nothing to frame.
 */
export function frameStepPose(
  input: StepFramingInput
): { position: Vector3; target: Vector3 } | null {
  const { motion, ownBox } = input;
  const buildBox = input.buildBox.clone();
  if (buildBox.isEmpty()) return null;

  // The action, seated and at its start. Start poses turn about the same
  // seated centers the clip uses.
  const ownCenter = ownBox.isEmpty() ? null : ownBox.getCenter(new Vector3());
  const startOffset = insertionStartOffset(motion);
  const seatedBoxes = [ownBox];
  const startBoxes: (Box3 | null)[] = [
    ownCenter && startPoseBounds(ownBox, motion, ownCenter, startOffset),
    input.glideStartBox
  ];
  for (const unit of input.pathUnits) {
    if (unit.box.isEmpty()) continue;
    seatedBoxes.push(unit.box);
    startBoxes.push(
      startPoseBounds(unit.box, unit.motion, unit.box.getCenter(new Vector3()))
    );
  }
  const seatedAction = new Box3();
  for (const box of seatedBoxes) seatedAction.union(box);
  if (seatedAction.isEmpty()) return null;
  const actionBoxes = [...seatedBoxes, ...startBoxes].filter(
    (box): box is Box3 => box !== null && !box.isEmpty()
  );
  for (const box of actionBoxes) buildBox.union(box);

  const center = buildBox.getCenter(new Vector3());
  const radius = buildBox.getSize(new Vector3()).length() / 2;
  const tanHalfV = Math.tan(((input.fov / 2) * Math.PI) / 180);
  const distance = Math.max((radius / tanHalfV) * 1.25, radius * 2);
  const actionCenter = seatedAction.getCenter(new Vector3());
  // Aim mostly at the build (context) with a nudge toward the action.
  const target = center.clone().lerp(actionCenter, 0.3);

  // Every seated and start box (corners, so a mostly-hidden part scores worse
  // than a clear one) plus the midpoint of the own insertion's travel.
  const actionPoints = actionBoxes.flatMap(boxCorners);
  const lookPoints = [actionCenter, ...actionPoints];
  if (ownCenter && startOffset) {
    lookPoints.push(ownCenter.clone().addScaledVector(startOffset, 0.5));
    lookPoints.push(ownCenter.clone().add(startOffset));
  }
  const direction = chooseDirection(input, target, distance, lookPoints);

  let right = new Vector3().crossVectors(input.up, direction);
  if (right.lengthSq() < 1e-6) right = new Vector3(1, 0, 0);
  right.normalize();
  const trueUp = new Vector3().crossVectors(direction, right).normalize();
  const rel = new Vector3();
  const camPoints: Vec3[] = actionPoints.map((point) => {
    rel.copy(point).sub(target);
    return [rel.dot(right), rel.dot(trueUp), rel.dot(direction)];
  });
  const fit = fitFraming(
    camPoints,
    tanHalfV * input.aspect,
    tanHalfV,
    0.85,
    distance
  );
  const framedTarget = target
    .clone()
    .addScaledVector(right, fit.pan[0])
    .addScaledVector(trueUp, fit.pan[1]);
  return {
    position: framedTarget.clone().addScaledVector(direction, fit.distance),
    target: framedTarget
  };
}

/**
 * A turned build keeps the current direction; an upright one takes the
 * planner's. Otherwise (manual or edited steps, plans without directions)
 * AABB-scored candidates — coarse, since a box can't show a hollow part's open
 * top, which is exactly why generated steps carry a baked direction.
 */
function chooseDirection(
  input: StepFramingInput,
  target: Vector3,
  distance: number,
  lookPoints: Vector3[]
): Vector3 {
  const { currentDirection, planDirection, up } = input;
  const hasCurrent = currentDirection.lengthSq() > 1e-6;
  if (input.turned && hasCurrent) return currentDirection.clone();
  if (!input.turned && planDirection && planDirection.lengthSq() > 1e-6) {
    return planDirection.clone().normalize();
  }

  // Elevation rings around the up axis, plus the current view. The third,
  // steeper ring: in dense machines the only clear sight line to a buried
  // part is often from high above.
  let basisU = new Vector3().crossVectors(up, new Vector3(0, 0, 1));
  if (basisU.lengthSq() < 1e-6) {
    basisU = new Vector3().crossVectors(up, new Vector3(1, 0, 0));
  }
  basisU.normalize();
  const basisV = new Vector3().crossVectors(up, basisU).normalize();
  const candidates: Vector3[] = hasCurrent ? [currentDirection] : [];
  for (const elevation of [0.3, 0.55, 0.8]) {
    const horizontal = Math.sqrt(1 - elevation * elevation);
    for (let i = 0; i < 8; i++) {
      const azimuth = (i / 8) * Math.PI * 2;
      candidates.push(
        new Vector3()
          .addScaledVector(basisU, Math.cos(azimuth) * horizontal)
          .addScaledVector(basisV, Math.sin(azimuth) * horizontal)
          .addScaledVector(up, elevation)
          .normalize()
      );
    }
  }

  // Fewest components in the way of the action, travel across the screen
  // rather than into it, and small turns from the current view.
  const motionDirection = insertionDirection(input.motion);
  let best = candidates[0] ?? new Vector3(1, 1, 1).normalize();
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const eye = target.clone().addScaledVector(candidate, distance);
    let score = 0;
    for (const point of lookPoints) {
      for (const occluder of input.occluders) {
        if (segmentIntersectsBox(eye, point, occluder.min, occluder.max)) {
          score += occluder.weight;
        }
      }
    }
    if (motionDirection) {
      score += 4 * Math.max(0, Math.abs(candidate.dot(motionDirection)) - 0.6);
    }
    score += 1.75 * (1 - candidate.dot(currentDirection));
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best.clone();
}

/**
 * Does the open segment from `origin` to `end` pass through the AABB?
 * Slab clipping; ignores grazing contact right at the endpoint so a box
 * around the look-at point does not count as occluding itself.
 */
function segmentIntersectsBox(
  origin: Vector3,
  end: Vector3,
  min: Vector3,
  max: Vector3
): boolean {
  let tMin = 0;
  let tMax = 0.98; // stop just short of the look-at point
  const axes = ["x", "y", "z"] as const;
  for (const axis of axes) {
    const delta = end[axis] - origin[axis];
    if (Math.abs(delta) < 1e-9) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return false;
      continue;
    }
    let tNear = (min[axis] - origin[axis]) / delta;
    let tFar = (max[axis] - origin[axis]) / delta;
    if (tNear > tFar) [tNear, tFar] = [tFar, tNear];
    tMin = Math.max(tMin, tNear);
    tMax = Math.min(tMax, tFar);
    if (tMin > tMax) return false;
  }
  return true;
}

/**
 * Bounds of a set at the start of its motion: the seated box shifted by the
 * start offset, and for a `waypoints` motion first turned about `pivot` as the
 * first waypoint turns it. Null when the motion has no start offset.
 */
function startPoseBounds(
  seated: Box3,
  motion: Motion,
  pivot: Vector3,
  startOffset = insertionStartOffset(motion)
): Box3 | null {
  if (!startOffset) return null;
  const first = motion.type === "waypoints" ? motion.waypoints[0] : undefined;
  if (!first) return seated.clone().translate(startOffset);
  return seated
    .clone()
    .applyMatrix4(
      waypointMatrix(startOffset, toQuaternion(first.rotation), pivot)
    );
}

function boxCorners(box: Box3): Vector3[] {
  return Array.from(
    { length: 8 },
    (_, i) =>
      new Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z
      )
  );
}

/**
 * Where a component starts relative to its seated pose for the given insertion
 * motion. Null when the motion does not translate the component.
 */
function insertionStartOffset(motion: Motion): Vector3 | null {
  switch (motion.type) {
    case "linear": {
      const direction = new Vector3(...motion.direction).normalize();
      return direction.multiplyScalar(-motion.distance);
    }
    case "L": {
      const offset = new Vector3();
      for (const segment of motion.segments) {
        const direction = new Vector3(...segment.direction).normalize();
        offset.addScaledVector(direction, -segment.distance);
      }
      return offset;
    }
    case "helix": {
      const axis = new Vector3(...motion.axis).normalize();
      const travel = motion.approach + motion.pitch * motion.turns;
      return axis.multiplyScalar(-travel);
    }
    case "waypoints": {
      const first = motion.waypoints[0];
      return first ? new Vector3(...first.offset) : null;
    }
    default:
      return null;
  }
}

/**
 * The dominant travel direction of an insertion motion (used to pick a
 * camera angle where the motion reads laterally). Null for motions that
 * do not translate the component.
 */
function insertionDirection(motion: Motion): Vector3 | null {
  switch (motion.type) {
    case "linear":
      return new Vector3(...motion.direction).normalize();
    case "L": {
      let longest: Vector3 | null = null;
      let longestDistance = 0;
      for (const segment of motion.segments) {
        if (Math.abs(segment.distance) > longestDistance) {
          longestDistance = Math.abs(segment.distance);
          longest = new Vector3(...segment.direction);
        }
      }
      return longest ? longest.normalize() : null;
    }
    case "helix":
      return new Vector3(...motion.axis).normalize();
    case "waypoints": {
      // The longest leg, in travel order (start → seat).
      let longest: Vector3 | null = null;
      for (let i = 1; i < motion.waypoints.length; i++) {
        const from = motion.waypoints[i - 1];
        const to = motion.waypoints[i];
        if (!from || !to) continue;
        const leg = new Vector3(...to.offset).sub(new Vector3(...from.offset));
        if (leg.lengthSq() > (longest?.lengthSq() ?? 1e-12)) longest = leg;
      }
      return longest ? longest.normalize() : null;
    }
    default:
      return null;
  }
}
