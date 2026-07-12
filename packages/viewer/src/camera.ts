import type { AssemblyGraphIndex } from "./graph";
import type { CameraPose, Motion, Vec3 } from "./types";

// Plain-array vector math so this runs server-side (step generation) without
// pulling three.js into the bundle. Mirrors the viewer's live occlusion-aware
// framing (AssemblyPlayer), but baked per step at planning time.

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
];

type Aabb = { min: Vec3; max: Vec3 };

const boxCenter = (box: Aabb): Vec3 => [
  (box.min[0] + box.max[0]) / 2,
  (box.min[1] + box.max[1]) / 2,
  (box.min[2] + box.max[2]) / 2
];

function unionBounds(
  nodeIds: Iterable<string>,
  graphIndex: AssemblyGraphIndex
): Aabb | null {
  let min: Vec3 | null = null;
  let max: Vec3 | null = null;
  for (const nodeId of nodeIds) {
    const node = graphIndex.nodesById.get(nodeId);
    if (!node) continue;
    if (!min || !max) {
      min = [...node.bbox.min];
      max = [...node.bbox.max];
    } else {
      min = [
        Math.min(min[0], node.bbox.min[0]),
        Math.min(min[1], node.bbox.min[1]),
        Math.min(min[2], node.bbox.min[2])
      ];
      max = [
        Math.max(max[0], node.bbox.max[0]),
        Math.max(max[1], node.bbox.max[1]),
        Math.max(max[2], node.bbox.max[2])
      ];
    }
  }
  return min && max ? { min, max } : null;
}

/** Where a component starts relative to its seated pose; null if it doesn't translate. */
function insertionStartOffset(motion: Motion): Vec3 | null {
  switch (motion.type) {
    case "linear":
      return scale(normalize(motion.direction), -motion.distance);
    case "L": {
      let offset: Vec3 = [0, 0, 0];
      for (const segment of motion.segments) {
        offset = add(
          offset,
          scale(normalize(segment.direction), -segment.distance)
        );
      }
      return offset;
    }
    case "helix":
      return scale(
        normalize(motion.axis),
        -(motion.approach + motion.pitch * motion.turns)
      );
    default:
      return null;
  }
}

/** Dominant travel direction of an insertion; null if it doesn't translate. */
function insertionDirection(motion: Motion): Vec3 | null {
  switch (motion.type) {
    case "linear":
      return normalize(motion.direction);
    case "L": {
      let longest: Vec3 | null = null;
      let longestDistance = 0;
      for (const segment of motion.segments) {
        if (Math.abs(segment.distance) > longestDistance) {
          longestDistance = Math.abs(segment.distance);
          longest = segment.direction;
        }
      }
      return longest ? normalize(longest) : null;
    }
    case "helix":
      return normalize(motion.axis);
    default:
      return null;
  }
}

/** Slab test: does the segment origin→end pass through the box? Stops just short
 * of the look-at point so a box AT the target doesn't count as blocking it. */
function segmentIntersectsBox(origin: Vec3, end: Vec3, box: Aabb): boolean {
  // Per-axis slabs, unrolled so tuple access stays literal-indexed.
  const axes: [number, number, number, number][] = [
    [origin[0], end[0], box.min[0], box.max[0]],
    [origin[1], end[1], box.min[1], box.max[1]],
    [origin[2], end[2], box.min[2], box.max[2]]
  ];
  let tMin = 0;
  let tMax = 0.98;
  for (const [o, e, boxMin, boxMax] of axes) {
    const delta = e - o;
    if (Math.abs(delta) < 1e-9) {
      if (o < boxMin || o > boxMax) return false;
      continue;
    }
    let tNear = (boxMin - o) / delta;
    let tFar = (boxMax - o) / delta;
    if (tNear > tFar) [tNear, tFar] = [tFar, tNear];
    tMin = Math.max(tMin, tNear);
    tMax = Math.min(tMax, tFar);
    if (tMin > tMax) return false;
  }
  return true;
}

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

/** The 8 corners of an AABB, optionally translated by `offset`. */
function boxCorners(box: Aabb, offset: Vec3 | null): Vec3[] {
  const corners: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [
      i & 1 ? box.max[0] : box.min[0],
      i & 2 ? box.max[1] : box.min[1],
      i & 4 ? box.max[2] : box.min[2]
    ];
    corners.push(offset ? add(corner, offset) : corner);
  }
  return corners;
}

/**
 * A baked camera pose that frames a step's components on their motion path with
 * an unobstructed sight line, given only the components present when the step
 * plays (`occluderNodeIds` — the already-animated parts). Keeps the standing
 * whole-assembly distance and only rotates the view angle, then pans (and, only
 * if the action can't fit, zooms out) so the part AND its full travel are
 * entirely inside the frustum. Returns null when the geometry is degenerate
 * (no subject bounds / zero-size assembly).
 */
export function computeStepCameraPose(
  graphIndex: AssemblyGraphIndex,
  subjectNodeIds: readonly string[],
  motion: Motion,
  occluderNodeIds: Iterable<string>,
  fov = 45
): CameraPose | null {
  const assembly = graphIndex.graph.root.bbox;
  const assemblyRadius = len(sub(assembly.max, assembly.min)) / 2;
  if (assemblyRadius <= 1e-6) return null;

  const subjectBounds = unionBounds(subjectNodeIds, graphIndex);
  if (!subjectBounds) return null;
  const subjectCenter = boxCenter(subjectBounds);
  const assemblyCenter = boxCenter(assembly);

  // Constant standing distance — never re-zoom per step
  const distance = Math.max(
    (assemblyRadius / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.25,
    assemblyRadius * 2
  );

  // Aim mostly at the whole assembly (context) with a nudge toward the part
  const target = lerp(assemblyCenter, subjectCenter, 0.3);

  // Where the action happens: the seated body (corners, so a mostly-hidden
  // part scores worse than a clear one) plus the full travel — start,
  // midpoint, and seat.
  const startOffset = insertionStartOffset(motion);
  const lookPoints: Vec3[] = [
    subjectCenter,
    ...boxCorners(subjectBounds, null)
  ];
  if (startOffset) {
    lookPoints.push(add(subjectCenter, scale(startOffset, 0.5)));
    lookPoints.push(add(subjectCenter, startOffset));
  }

  const subjectSet = new Set(subjectNodeIds);
  const occluders: Aabb[] = [];
  for (const nodeId of occluderNodeIds) {
    if (subjectSet.has(nodeId)) continue;
    const node = graphIndex.nodesById.get(nodeId);
    if (node) occluders.push(node.bbox);
  }

  const motionDirection = insertionDirection(motion);

  // Candidate directions: two elevation rings around the up axis (models
  // keep CAD coordinates, so up is +Z and "elevated" means above the model)
  const up: Vec3 = [0, 0, 1];
  let basisU = cross(up, [0, 0, 1]);
  if (len(basisU) < 1e-6) basisU = cross(up, [1, 0, 0]);
  basisU = normalize(basisU);
  const basisV = normalize(cross(up, basisU));

  const candidates: Vec3[] = [];
  // Third, steeper ring: in dense machines the only clear sight line to a
  // buried part is often from high above.
  for (const elevation of [0.3, 0.55, 0.8]) {
    const horizontal = Math.sqrt(1 - elevation * elevation);
    for (let i = 0; i < 8; i++) {
      const azimuth = (i / 8) * Math.PI * 2;
      candidates.push(
        normalize(
          add(
            add(
              scale(basisU, Math.cos(azimuth) * horizontal),
              scale(basisV, Math.sin(azimuth) * horizontal)
            ),
            scale(up, elevation)
          )
        )
      );
    }
  }

  let bestDirection = candidates[0] ?? normalize([1, 1, 1]);
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const eye = add(target, scale(candidate, distance));
    let score = 0;
    // How much is in the way of seeing the action?
    for (const point of lookPoints) {
      for (const occluder of occluders) {
        if (segmentIntersectsBox(eye, point, occluder)) score += 1;
      }
    }
    // Prefer travel running across the screen, not into it
    if (motionDirection) {
      score += 4 * Math.max(0, Math.abs(dot(candidate, motionDirection)) - 0.6);
    }
    if (score < bestScore) {
      bestScore = score;
      bestDirection = candidate;
    }
  }

  // Guarantee the action is entirely in frame: pan the target (and only grow
  // the distance when the action genuinely can't fit) so the seated body plus
  // its travel-start copy sit inside the frustum. Aspect is unknown at bake
  // time — 4:3 is conservative for the typical wider viewer canvas.
  let right = normalize(cross(up, bestDirection));
  if (len(right) < 1e-6) right = [1, 0, 0];
  const trueUp = normalize(cross(bestDirection, right));
  const actionPoints = boxCorners(subjectBounds, null);
  if (startOffset) actionPoints.push(...boxCorners(subjectBounds, startOffset));
  const camPoints: Vec3[] = actionPoints.map((point) => {
    const rel = sub(point, target);
    return [dot(rel, right), dot(rel, trueUp), dot(rel, bestDirection)];
  });
  const tanHalfV = Math.tan(((fov / 2) * Math.PI) / 180);
  const fit = fitFraming(
    camPoints,
    tanHalfV * (4 / 3),
    tanHalfV,
    0.85,
    distance
  );
  const framedTarget = add(
    add(target, scale(right, fit.pan[0])),
    scale(trueUp, fit.pan[1])
  );

  return {
    position: add(framedTarget, scale(bestDirection, fit.distance)),
    target: framedTarget,
    fov
  };
}

/**
 * Bakes a camera pose for each step group in sequence order. A step's occluders
 * are exactly the components already animated by the time it plays — parts from
 * earlier groups. Components from LATER groups and components in no group are
 * not on the canvas (never-installed parts render like future ones), so they
 * never push the camera around. Returns one entry per group (null where
 * geometry is degenerate).
 */
export function computeStepCameras(
  groups: readonly { componentNodeIds: string[]; motion: Motion }[],
  graphIndex: AssemblyGraphIndex,
  fov = 45
): (CameraPose | null)[] {
  const groupIndexByNode = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const nodeId of group.componentNodeIds) {
      groupIndexByNode.set(nodeId, index);
    }
  });

  return groups.map((group, index) => {
    const subject = new Set(group.componentNodeIds);
    const occluders: string[] = [];
    for (const leaf of graphIndex.leaves) {
      if (subject.has(leaf.nodeId)) continue;
      const leafGroup = groupIndexByNode.get(leaf.nodeId);
      // Present only if it belongs to an earlier step.
      if (leafGroup !== undefined && leafGroup < index) {
        occluders.push(leaf.nodeId);
      }
    }
    return computeStepCameraPose(
      graphIndex,
      group.componentNodeIds,
      group.motion,
      occluders,
      fov
    );
  });
}
