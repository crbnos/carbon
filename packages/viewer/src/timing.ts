// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toQuaternion, toVector3 } from "./quat";
import type { AssemblyStep, Motion, WaypointsMotion } from "./types";

export const CARRY_IN_GLIDE_SECONDS = 1.2;
export const DEFAULT_HOLD_SECONDS = 0.6;

const INSERTION_SPEED_MM_PER_S = 60;
const MIN_DURATION_S = 1;
const MAX_DURATION_S = 4;
/** Timeline length of a process-only (none-motion) step without an explicit duration */
const NONE_STEP_SECONDS = 2;
/** Turning counts as travel so a flip in place still takes readable time. */
const TURN_MM_PER_RADIAN = 30;

export type StepClipTiming = {
  total: number;
  /** Each unit's own path, in play order. */
  units: number[];
  unitsTotal: number;
  glide: number;
  motion: number;
  hold: number;
};

/**
 * How a step spends its slot on the continuous timeline (`total`): the
 * sub-assemblies that join on their own path (`units`, one after another), a
 * carried-in sub-assembly's glide, the insertion, then the seated hold. The
 * slot is the explicit `durationSeconds` when set, otherwise the natural length
 * (a fixed slot for process-only steps). An authored duration shorter than the
 * animation speeds everything up to fit, so the step never ends mid-travel and
 * snaps its parts to their seat.
 *
 * `ownParts: false` — the step's own insertion moves nothing (an unused header
 * whose unit joins on its own path, or a step that only brings a unit in): its
 * motion is ignored, and with units its slot is just the units and the hold.
 */
export function stepClipTiming(
  step: Pick<AssemblyStep, "motion" | "durationSeconds">,
  {
    glideSeconds = 0,
    units = [],
    ownParts = true
  }: { glideSeconds?: number; units?: Motion[]; ownParts?: boolean } = {}
): StepClipTiming {
  const unitSeconds = units.map(motionDuration);
  const naturalUnits = unitSeconds.reduce((sum, seconds) => sum + seconds, 0);
  const moves = ownParts && step.motion.type !== "none";
  const motion = moves ? motionDuration(step.motion) : 0;
  const natural = naturalUnits + glideSeconds + motion + DEFAULT_HOLD_SECONDS;
  const total =
    step.durationSeconds && step.durationSeconds > 0
      ? step.durationSeconds
      : moves || (!ownParts && units.length > 0)
        ? natural
        : naturalUnits + glideSeconds + NONE_STEP_SECONDS;
  const fit = Math.min(1, total / natural);
  return {
    total,
    units: unitSeconds.map((seconds) => seconds * fit),
    unitsTotal: naturalUnits * fit,
    glide: glideSeconds * fit,
    motion: motion * fit,
    hold: DEFAULT_HOLD_SECONDS * fit
  };
}

/**
 * Opacity of a seated fade-in at `elapsed` seconds into the step: 0 until
 * `delay` (the step's units on their own path are still arriving), then up to
 * 1 over `seconds`. A finished step — including one shown statically, at its
 * end — is fully in.
 */
export function fadeProgress(
  elapsed: number,
  delay: number,
  seconds: number,
  finished: boolean
): number {
  if (finished) return 1;
  return Math.min(Math.max((elapsed - delay) / seconds, 0), 1);
}

/** Total travel distance (mm) implied by a motion. */
export function motionTravelDistance(motion: Motion): number {
  switch (motion.type) {
    case "linear":
      return Math.abs(motion.distance);
    case "L":
      return motion.segments.reduce(
        (sum, segment) => sum + Math.abs(segment.distance),
        0
      );
    case "helix":
      return Math.abs(motion.approach) + Math.abs(motion.pitch * motion.turns);
    case "path": {
      let total = 0;
      for (let i = 1; i < motion.keyframes.length; i++) {
        const current = motion.keyframes[i];
        const previous = motion.keyframes[i - 1];
        if (!current || !previous) continue;
        total += toVector3(current.position).distanceTo(
          toVector3(previous.position)
        );
      }
      return total;
    }
    case "waypoints": {
      let total = 0;
      for (let i = 1; i < motion.waypoints.length; i++) {
        const current = motion.waypoints[i];
        const previous = motion.waypoints[i - 1];
        if (!current || !previous) continue;
        total += waypointLegTravel(previous, current);
      }
      return total;
    }
    case "none":
      return 0;
  }
}

export function waypointLegTravel(
  from: WaypointsMotion["waypoints"][number],
  to: WaypointsMotion["waypoints"][number]
): number {
  const distance = toVector3(from.offset).distanceTo(toVector3(to.offset));
  const angle = toQuaternion(from.rotation).angleTo(toQuaternion(to.rotation));
  return distance + angle * TURN_MM_PER_RADIAN;
}

/** Animation duration (s) scaled to travel distance, clamped to 1–4 s. */
export function motionDuration(motion: Motion): number {
  if (motion.type === "none") return 0;
  const travel = motionTravelDistance(motion);
  return Math.min(
    MAX_DURATION_S,
    Math.max(MIN_DURATION_S, travel / INSERTION_SPEED_MM_PER_S)
  );
}
