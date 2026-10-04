// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { synthesizeFallbackMotion } from "@carbon/viewer/fallback";
import type { AssemblyGraphIndex } from "@carbon/viewer/graph";
import type { Motion, Vec3 } from "@carbon/viewer/types";

/** What `synthesizeFallbackMotion` needs; named so the import stays type-only. */
type GraphIndexLike = AssemblyGraphIndex;

/**
 * Where a step's components sit, relative to their seated pose, part-way
 * through the insertion.
 *
 * Web builds a three.js `AnimationClip` for this (`@carbon/viewer/motion.ts`);
 * that module imports three, so it cannot come over. What CAN come over — and
 * does, through the Metro alias — is the geometry that decides what the motion
 * IS: `@carbon/viewer/fallback` and `/graph` are pure, so the native app
 * synthesizes the same fallback for a `none` step that web does, from the same
 * code. Only this last step, turning a motion into an offset per frame, is
 * written here.
 *
 * **The offset is backwards in time.** `t = 1` is seated, so the offset is
 * zero; `t = 0` is the start of the approach, the full travel away. That makes
 * the seated pose the model's own transform and the animation a departure from
 * it, so a part can never drift: the last frame writes exactly what was read.
 */

const ZERO: Vec3 = [0, 0, 0];

const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  // A zero direction is a motion that goes nowhere; treating it as zero is
  // what keeps a malformed plan from producing NaN transforms.
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : ZERO;
}

/**
 * Smooth in and out. A linear insertion reads mechanical in a way a real hand
 * never is, and the eye reads the ease as "placed" rather than "teleported".
 */
export function easeInOut(t: number) {
  const clamped = Math.min(Math.max(t, 0), 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - (-2 * clamped + 2) ** 3 / 2;
}

/**
 * The total distance a motion travels, in the model's own units. Used to pick
 * a duration, so a bolt and a crankcase do not take the same time.
 */
export function motionTravel(motion: Motion | null | undefined): number {
  if (!motion) return 0;
  switch (motion.type) {
    case "linear":
      return Math.abs(motion.distance);
    case "L":
      return motion.segments.reduce((sum, s) => sum + Math.abs(s.distance), 0);
    case "helix":
      return Math.abs(motion.approach) + Math.abs(motion.pitch * motion.turns);
    default:
      return 0;
  }
}

/** Travel per second, in model units — tuned on the R-5's 464-unit radius. */
const SPEED = 220;
const MIN_MS = 350;
const MAX_MS = 2000;

/** How long a step's insertion should play. */
export function motionDurationMs(motion: Motion | null | undefined) {
  const travel = motionTravel(motion);
  if (travel === 0) return 0;
  return Math.min(MAX_MS, Math.max(MIN_MS, (travel / SPEED) * 1000));
}

/**
 * The offset from the seated pose at normalized time `t`.
 *
 * `path` and the rotation of `helix` are deliberately not applied. A `path`
 * motion's keyframes are ABSOLUTE world poses, so they cannot be expressed as
 * an offset without the component's seated pose, and a helix's turns need a
 * rotation about a moving origin — both need the matrix work that lives in
 * web's three.js clip builder. Neither is produced by the planner's fallback
 * (it emits `linear` or `L` only), so the common case is covered and the rest
 * seats without animating rather than animating wrongly.
 */
export function motionOffsetAt(
  motion: Motion | null | undefined,
  t: number
): Vec3 {
  if (!motion) return ZERO;
  const remaining = 1 - Math.min(Math.max(t, 0), 1);
  if (remaining === 0) return ZERO;

  switch (motion.type) {
    case "linear":
      // NEGATIVE: `direction` is the way the part travels to SEAT, so it
      // starts that far back along it. Web does the same
      // (`addScaledVector(direction, -distance)` in its clip builder); the
      // sign is the whole difference between a part arriving and a part
      // leaving.
      return scale(normalize(motion.direction), -motion.distance * remaining);

    case "L": {
      // The segments are in INSERTION order, so backing the part out walks
      // them in reverse: the last segment is undone first.
      const total = motionTravel(motion);
      if (total === 0) return ZERO;
      let toUndo = total * remaining;
      let offset = ZERO;
      for (let i = motion.segments.length - 1; i >= 0 && toUndo > 0; i--) {
        const segment = motion.segments[i];
        if (!segment) continue;
        const length = Math.abs(segment.distance);
        const part = Math.min(length, toUndo);
        offset = add(offset, scale(normalize(segment.direction), -part));
        toUndo -= part;
      }
      return offset;
    }

    case "helix":
      // The approach only; see the note above.
      return scale(
        normalize(motion.axis),
        -(motion.approach + motion.pitch * motion.turns) * remaining
      );

    default:
      return ZERO;
  }
}

/**
 * The motion a step should actually play, which is not always the motion it
 * was stored with.
 *
 * This mirrors `displayMotionForStep` in `@carbon/viewer/motion.ts`, which
 * cannot be imported because that module pulls in three. The DECISION is
 * copied; the geometry it depends on is not — `synthesizeFallbackMotion`
 * comes from `@carbon/viewer/fallback`, so the fallback the native app plays
 * is computed by the same code as web's.
 *
 * Why a fallback exists at all: most authored steps carry `none`. Every step
 * of both instructions in the demo data does. Playing nothing for those would
 * mean parts popping into place, so web synthesizes an approach from the
 * bounding boxes, avoiding the parts already installed. Three cases keep
 * `none` and simply appear:
 *
 * - the FIRST step — it is the base being placed, not inserted
 * - a FLAGGED step — the planner proved no collision-free path exists, and a
 *   fabricated fly-through would be a lie about how the part goes in
 * - a step with no components, or a model with no usable graph
 */
export function displayMotionFor({
  motion,
  componentNodeIds,
  flagged,
  index,
  graphIndex,
  presentNodeIds
}: {
  motion: Motion | null | undefined;
  componentNodeIds: string[];
  flagged: boolean;
  index: number;
  graphIndex: GraphIndexLike | null;
  presentNodeIds: ReadonlySet<string>;
}): Motion {
  const stored: Motion = motion ?? { type: "none" };
  if (
    index === 0 ||
    flagged ||
    stored.type !== "none" ||
    componentNodeIds.length === 0 ||
    !graphIndex
  ) {
    return stored;
  }
  const fallback = synthesizeFallbackMotion(
    graphIndex,
    componentNodeIds,
    presentNodeIds
  );
  return fallback && fallback.type !== "none" ? fallback : stored;
}

/** The components every step before `index` has already installed. */
export function presentNodeIdsBefore(
  steps: { componentNodeIds: string[] }[],
  index: number
) {
  const present = new Set<string>();
  for (let i = 0; i < Math.min(index, steps.length); i++) {
    for (const id of steps[i]?.componentNodeIds ?? []) present.add(id);
  }
  return present;
}

/**
 * A step's component ids expanded to the LEAF nodes beneath them.
 *
 * `synthesizeFallbackMotion` reasons about bounding boxes and only walks the
 * graph's leaves, but a step names assembly nodes — "52-Piston Assembly" has
 * 66 children. Handed those ids it finds no component to move and returns
 * null, which is why an unexpanded call silently produces no animation.
 *
 * Note this is a deliberate difference from web, which passes the step's ids
 * straight through: for an instruction whose steps name assemblies, web
 * therefore synthesizes nothing and the parts appear rather than travel. The
 * expansion is what makes the fallback do on a tablet what it was written to
 * do, and it changes only which boxes the synthesis sees, not the synthesis.
 */
export function expandToLeaves(
  nodeIds: Iterable<string>,
  subtrees: Map<string, string[]>,
  leafIds: ReadonlySet<string>
) {
  const out = new Set<string>();
  for (const id of nodeIds) {
    if (leafIds.has(id)) {
      out.add(id);
      continue;
    }
    for (const descendant of subtrees.get(id) ?? []) {
      if (leafIds.has(descendant)) out.add(descendant);
    }
  }
  return out;
}
