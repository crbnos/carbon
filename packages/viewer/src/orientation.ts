// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Matrix4, Quaternion, Vector3 } from "three";
import { IDENTITY_QUAT, toQuat, toQuaternion } from "./quat";
import { stepWorlds } from "./subassembly";
import type { AssemblyStep, Quat, Vec3 } from "./types";
import { isFiniteTuple } from "./validate-motion";

/**
 * Build orientation: how the whole build is turned on a step (flipped to fit
 * parts on its underside, laid on its side). A unit quaternion that turns the
 * model frame into the bench frame; both are Z-up. A step's `orientation`
 * holds from that step on, within its own build — the main build and each
 * sub-assembly keep separate chains, and a sub-assembly starts upright.
 *
 * The player shows it by rolling and orbiting the camera, never by turning the
 * model: motion, the path editor and box select all work in world space.
 */

/** Turns relative to the current view: `flip` is 180°, the others 90°. */
export type BuildTurn =
  | "flip"
  | "tipForward"
  | "tipBack"
  | "spinLeft"
  | "spinRight";

const BENCH_UP = new Vector3(0, 0, 1);

export function isOrientation(value: unknown): value is Quat {
  return (
    isFiniteTuple(value, 4) &&
    Math.abs(Math.hypot(...(value as number[])) - 1) < 1e-3
  );
}

/**
 * Snaps to the nearest of the 24 right-angle orientations, so repeated 90°
 * turns never drift and a turn and its opposite compare equal.
 */
function snapOrientation(q: Quat): Quat {
  const rotation = toQuaternion(q);
  // Snap where the model's X and Y axes point to the nearest bench axes (two
  // different ones), then derive Z — rounding matrix entries one by one can
  // yield something that is not a rotation at all.
  const x = nearestAxis(new Vector3(1, 0, 0).applyQuaternion(rotation));
  const y = nearestAxis(new Vector3(0, 1, 0).applyQuaternion(rotation), x);
  const z = new Vector3().crossVectors(x, y);
  const matrix = new Matrix4().makeBasis(x, y, z);
  return toQuat(new Quaternion().setFromRotationMatrix(matrix));
}

export type OrientationPose = "upright" | "upsideDown" | "onSide";

export function describeOrientation(q: Quat): OrientationPose {
  const top = BENCH_UP.clone().applyQuaternion(toQuaternion(q)).z;
  if (top > 0.5) return "upright";
  if (top < -0.5) return "upsideDown";
  return "onSide";
}

/** The bench's up direction in the model frame — what `camera.up` becomes. */
export function upForOrientation(q: Quat): Vec3 {
  return BENCH_UP.clone()
    .applyQuaternion(toQuaternion(q).invert())
    .toArray() as Vec3;
}

export type ResolvedOrientation = {
  orientation: Quat;
  /** The step that set it; `null` = no step of this build turned it yet. */
  sourceStepId: string | null;
};

/**
 * Each step's orientation, in step order: its own, else the last one set
 * earlier in the same build (see `stepWorlds`), else upright.
 */
export function resolveOrientations(
  steps: Pick<
    AssemblyStep,
    | "id"
    | "componentNodeIds"
    | "parentStepId"
    | "usedInStepId"
    | "isSubAssembly"
    | "orientation"
  >[]
): ResolvedOrientation[] {
  const worlds = stepWorlds(steps);
  const current = new Map<string | null, ResolvedOrientation>();
  return steps.map((step) => {
    const world = worlds.get(step.id) ?? null;
    if (isOrientation(step.orientation)) {
      current.set(world, {
        orientation: step.orientation,
        sourceStepId: step.id
      });
    }
    return (
      current.get(world) ?? {
        orientation: IDENTITY_QUAT,
        sourceStepId: null
      }
    );
  });
}

/**
 * `current` turned as seen from `view` — a bench-frame camera pose, as the
 * player's `captureCameraPose` returns it. Spinning turns the build about the
 * bench's up axis; tipping and flipping roll it about the bench axis that runs
 * most nearly left-right on screen, so a turn is always a clean right angle
 * even from a slanted view.
 */
export function turnOrientation(
  current: Quat,
  turn: BuildTurn,
  view: { position: Vec3; target: Vec3 }
): Quat {
  const orientation = toQuaternion(current);
  // Where the camera stands, flattened onto the bench.
  const toCamera = new Vector3(...view.position)
    .sub(new Vector3(...view.target))
    .setZ(0);
  // Looking straight down there is no "toward the viewer": use the CAD front.
  const facing =
    toCamera.lengthSq() < 1e-12 ? new Vector3(0, -1, 0) : toCamera.normalize();

  const axis =
    turn === "spinLeft" || turn === "spinRight"
      ? BENCH_UP.clone()
      : nearestAxis(new Vector3().crossVectors(BENCH_UP, facing));
  const angle =
    turn === "flip"
      ? Math.PI
      : turn === "spinRight" || turn === "tipForward"
        ? Math.PI / 2
        : -Math.PI / 2;

  const rotation = new Quaternion().setFromAxisAngle(axis, angle);
  return snapOrientation(toQuat(rotation.multiply(orientation).normalize()));
}

/** The bench axis (±X, ±Y, ±Z) closest to `v`, skipping `exclude`'s axis. */
function nearestAxis(v: Vector3, exclude?: Vector3): Vector3 {
  const components = [v.x, v.y, v.z];
  let best = -1;
  for (let i = 0; i < 3; i++) {
    if (exclude && Math.abs(exclude.getComponent(i)) > 0.5) continue;
    if (
      best < 0 ||
      Math.abs(components[i] ?? 0) > Math.abs(components[best] ?? 0)
    ) {
      best = i;
    }
  }
  const axis = new Vector3();
  axis.setComponent(best, Math.sign(components[best] ?? 0) || 1);
  return axis;
}
