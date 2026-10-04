// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Vec3 } from "@carbon/viewer/types";

/**
 * Where to stand to watch a step.
 *
 * A step may carry a camera the planner baked, and the two kinds are not the
 * same promise:
 *
 * - a **manual pose** (`position`, `target`, `fov`) was chosen by a person and
 *   is applied verbatim;
 * - a **plan hint** (`{ source: "plan", direction }`) is only a view
 *   DIRECTION, picked against the real triangles of everything installed
 *   before it so the part being fitted is not behind something. The viewer
 *   owes the rest — where to look and how far back to stand — and gets both
 *   from the model, so the same hint frames a bicycle and a radial engine.
 *
 * With no camera at all the caller keeps its own framing. Returning null
 * rather than inventing a pose is what lets the operator's orbit survive a
 * step change on an instruction that has no views.
 */

/** How many model radii back the hint stands. Matches the default framing. */
const STANDOFF = 2.4;
/** And how far above, so a part is not seen exactly edge-on. */
const RISE = 0.6;

export type StepView = { position: Vec3; target: Vec3 };

type ManualPose = { position: Vec3; target: Vec3; fov?: number };
type PlanHint = { source: "plan"; direction: Vec3 };

const isManualPose = (value: unknown): value is ManualPose =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as ManualPose).position) &&
  Array.isArray((value as ManualPose).target);

const isPlanHint = (value: unknown): value is PlanHint =>
  typeof value === "object" &&
  value !== null &&
  (value as PlanHint).source === "plan" &&
  Array.isArray((value as PlanHint).direction);

function normalize(v: Vec3): Vec3 | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(length) || length === 0) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * The view for a step, or null to keep the current one.
 *
 * `camera` is `unknown` on the wire — the contract carries the planner's JSON
 * untouched — so the shape is checked here rather than trusted. An
 * unrecognised camera keeps the current view, exactly as an unrecognised
 * motion plays none: a view invented from a shape we did not understand would
 * point the operator somewhere arbitrary.
 */
export function stepView(
  camera: unknown,
  modelCenter: Vec3,
  modelRadius: number
): StepView | null {
  if (isManualPose(camera)) {
    return { position: camera.position, target: camera.target };
  }
  if (!isPlanHint(camera)) return null;

  const direction = normalize(camera.direction);
  if (!direction) return null;

  // `direction` is target→eye, so the camera stands along it from the target.
  const radius = modelRadius > 0 ? modelRadius : 1;
  return {
    target: modelCenter,
    position: [
      modelCenter[0] + direction[0] * radius * STANDOFF,
      modelCenter[1] + direction[1] * radius * STANDOFF + radius * RISE,
      modelCenter[2] + direction[2] * radius * STANDOFF
    ]
  };
}

/** The framing used when a step says nothing: the whole model, slightly above. */
export function defaultView(modelCenter: Vec3, modelRadius: number): StepView {
  const radius = modelRadius > 0 ? modelRadius : 1;
  return {
    target: modelCenter,
    position: [
      modelCenter[0],
      modelCenter[1] + radius * RISE,
      modelCenter[2] + radius * STANDOFF
    ]
  };
}
