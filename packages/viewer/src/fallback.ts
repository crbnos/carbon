import type { AssemblyGraphIndex } from "./graph";
import type { Motion, Vec3 } from "./types";

/**
 * AABB-based fallback motion synthesis for steps the geometry planner left
 * with motion "none" (old plan.json files, manually authored steps). Pure —
 * no WebGL, unit-testable in node, same conventions as the Python planner:
 * distances in mm, stored motion is the INSERTION (removal reversed).
 *
 * This is display guidance, not physics: obstacles are leaf bounding boxes.
 * The obstacle world is the caller-provided PRESENT set — the components
 * already installed by earlier steps. Components of later steps and components
 * no step installs are not on the canvas, so they neither block nor redirect a
 * fallback path.
 *
 * MATED components get no fallback at all: when a present component's box
 * interpenetrates the seated box, the part engages geometry an AABB cannot
 * reason about (a slider wrapping its rail, a screw in its bore). The one
 * obstacle that matters would have to be ignored to synthesize anything, and
 * whatever direction survives cuts straight through the mate on screen — a
 * slider "inserted" sideways through its rail. Those steps return null and
 * fade in at the seated pose until the planner or the author supplies a real
 * motion.
 */

type Box = { min: Vec3; max: Vec3 };

const EXIT_MARGIN_MM = 5;
const HOP_MARGIN_MM = 2;
/** Surface contact between neighbors is not an obstruction */
const CONTACT_EPSILON_MM = 0.01;

type AxisDirection = { dir: Vec3; axis: 0 | 1 | 2; sign: 1 | -1 };

/** Same preference order as the Python planner's world axes: up first. */
const DIRECTIONS: AxisDirection[] = [
  { dir: [0, 0, 1], axis: 2, sign: 1 },
  { dir: [0, 0, -1], axis: 2, sign: -1 },
  { dir: [1, 0, 0], axis: 0, sign: 1 },
  { dir: [-1, 0, 0], axis: 0, sign: -1 },
  { dir: [0, 1, 0], axis: 1, sign: 1 },
  { dir: [0, -1, 0], axis: 1, sign: -1 }
];

function unionBox(boxes: Box[]): Box | null {
  const first = boxes[0];
  if (!first) return null;
  const min: Vec3 = [...first.min];
  const max: Vec3 = [...first.max];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis] ?? 0, box.min[axis] ?? 0);
      max[axis] = Math.max(max[axis] ?? 0, box.max[axis] ?? 0);
    }
  }
  return { min, max };
}

function boxesOverlap(a: Box, b: Box, epsilon: number): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if ((a.max[axis] ?? 0) - epsilon <= (b.min[axis] ?? 0)) return false;
    if ((b.max[axis] ?? 0) - epsilon <= (a.min[axis] ?? 0)) return false;
  }
  return true;
}

function translateBox(
  box: Box,
  direction: AxisDirection,
  distance: number
): Box {
  const min: Vec3 = [...box.min];
  const max: Vec3 = [...box.max];
  min[direction.axis] = (min[direction.axis] ?? 0) + direction.sign * distance;
  max[direction.axis] = (max[direction.axis] ?? 0) + direction.sign * distance;
  return { min, max };
}

/** The box swept by translating `box` along `direction` for `distance`. */
function sweptBox(box: Box, direction: AxisDirection, distance: number): Box {
  const min: Vec3 = [...box.min];
  const max: Vec3 = [...box.max];
  if (direction.sign > 0) {
    max[direction.axis] = (max[direction.axis] ?? 0) + distance;
  } else {
    min[direction.axis] = (min[direction.axis] ?? 0) - distance;
  }
  return { min, max };
}

/** Distance until `component` separates from `assembly` along `direction`. */
function exitTravel(
  component: Box,
  assembly: Box,
  direction: AxisDirection
): number {
  const { axis, sign } = direction;
  const needed =
    sign > 0
      ? (assembly.max[axis] ?? 0) - (component.min[axis] ?? 0)
      : (component.max[axis] ?? 0) - (assembly.min[axis] ?? 0);
  const extent = (component.max[axis] ?? 0) - (component.min[axis] ?? 0);
  return Math.max(needed, extent, 0) + EXIT_MARGIN_MM;
}

/** Distance until `component` clears `obstacle` along `direction`. */
function clearTravel(
  component: Box,
  obstacle: Box,
  direction: AxisDirection
): number {
  const { axis, sign } = direction;
  const needed =
    sign > 0
      ? (obstacle.max[axis] ?? 0) - (component.min[axis] ?? 0)
      : (component.max[axis] ?? 0) - (obstacle.min[axis] ?? 0);
  return Math.max(needed, 0) + HOP_MARGIN_MM;
}

function negate(direction: AxisDirection): Vec3 {
  return direction.dir.map((c) => -c) as Vec3;
}

/**
 * Synthesizes an insertion motion for a step's components from graph bounding
 * boxes: a straight exit along the least-obstructed axis when one exists,
 * else a two-segment escape (hop past the blockers, then exit). Obstacles are
 * ONLY the leaves in `presentNodeIds` — the components already installed by
 * earlier steps. Returns null when the components resolve to no leaf geometry,
 * when a present component interpenetrates the seated box (a mating
 * engagement the AABB sweep cannot respect — see module doc), or when every
 * candidate path collides with a present component: a fabricated path that
 * animates through geometry is worse than fading in at the seated pose, so
 * the caller keeps motion "none" in those cases.
 */
export function synthesizeFallbackMotion(
  index: AssemblyGraphIndex,
  componentNodeIds: string[],
  presentNodeIds: ReadonlySet<string>
): Motion | null {
  const componentSet = new Set(componentNodeIds);
  const componentBoxes: Box[] = [];
  const otherBoxes: Box[] = [];
  for (const node of index.leaves) {
    if (!node.bbox) continue;
    if (componentSet.has(node.nodeId)) {
      componentBoxes.push(node.bbox);
    } else if (presentNodeIds.has(node.nodeId)) {
      otherBoxes.push(node.bbox);
    }
  }

  const component = unionBox(componentBoxes);
  if (!component) return null;
  const assembly = unionBox([component, ...otherBoxes]);
  if (!assembly) return null;

  // A present component interpenetrating the seated box (beyond surface
  // contact) is a mate — refuse to fabricate a path through it. Face-on-face
  // stacking stays within CONTACT_EPSILON_MM and still synthesizes.
  if (
    otherBoxes.some((box) => boxesOverlap(component, box, CONTACT_EPSILON_MM))
  ) {
    return null;
  }
  const obstacles = otherBoxes;

  const candidates = DIRECTIONS.map((direction) => {
    const travel = exitTravel(component, assembly, direction);
    const swept = sweptBox(component, direction, travel);
    const blockers = obstacles.filter((box) =>
      boxesOverlap(swept, box, CONTACT_EPSILON_MM)
    );
    return { direction, travel, blockers };
  }).sort(
    (a, b) => a.blockers.length - b.blockers.length || a.travel - b.travel
  );

  const best = candidates[0];
  if (!best) return null;

  if (best.blockers.length === 0) {
    // Straight removal along `direction` -> insertion approaches from there
    return {
      type: "linear",
      direction: negate(best.direction),
      distance: round(best.travel)
    };
  }

  // Two-segment escape: hop perpendicular until clear of the exit blockers,
  // then exit. Both legs must be unobstructed.
  for (const exit of candidates) {
    if (exit.blockers.length === 0) continue;
    for (const hopDirection of DIRECTIONS) {
      if (hopDirection.axis === exit.direction.axis) continue;

      const hop = Math.max(
        ...exit.blockers.map((box) => clearTravel(component, box, hopDirection))
      );
      const hopSwept = sweptBox(component, hopDirection, hop);
      if (
        obstacles.some((box) => boxesOverlap(hopSwept, box, CONTACT_EPSILON_MM))
      ) {
        continue;
      }

      const hopped = translateBox(component, hopDirection, hop);
      const travel = exitTravel(hopped, assembly, exit.direction);
      const exitSwept = sweptBox(hopped, exit.direction, travel);
      if (
        obstacles.some((box) =>
          boxesOverlap(exitSwept, box, CONTACT_EPSILON_MM)
        )
      ) {
        continue;
      }

      // Removal: hop then exit. Insertion reverses: enter, then settle.
      return {
        type: "L",
        segments: [
          { direction: negate(exit.direction), distance: round(travel) },
          { direction: negate(hopDirection), distance: round(hop) }
        ]
      };
    }
  }

  // Every candidate path collides with a present component — fade in at the
  // seated pose instead of fabricating a fly-through
  return null;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
