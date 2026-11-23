// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Motion } from "./types";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isFiniteTuple = (value: unknown, length: number): boolean =>
  Array.isArray(value) &&
  value.length === length &&
  value.every(isFiniteNumber);

const isVec3 = (value: unknown) => isFiniteTuple(value, 3);
const isQuat = (value: unknown) => isFiniteTuple(value, 4);

/**
 * A stored motion the player can animate without throwing or producing NaN.
 * It cannot check that a `path` motion's last keyframe equals the part's seated
 * pose, which only the scene knows.
 */
export function isPlayableMotion(value: unknown): value is Motion {
  if (!value || typeof value !== "object") return false;
  const motion = value as Record<string, unknown>;
  switch (motion.type) {
    case "none":
      return true;
    case "linear":
      return isVec3(motion.direction) && isFiniteNumber(motion.distance);
    case "L":
      return (
        Array.isArray(motion.segments) &&
        motion.segments.every(
          (segment: { direction?: unknown; distance?: unknown } | null) =>
            !!segment &&
            isVec3(segment.direction) &&
            isFiniteNumber(segment.distance)
        )
      );
    case "helix":
      return (
        isVec3(motion.axis) &&
        isVec3(motion.origin) &&
        isFiniteNumber(motion.pitch) &&
        isFiniteNumber(motion.turns) &&
        isFiniteNumber(motion.approach)
      );
    case "path": {
      const keyframes = motion.keyframes;
      if (!Array.isArray(keyframes) || keyframes.length < 2) return false;
      const valid = keyframes.every(
        (
          keyframe: { t?: unknown; position?: unknown; quaternion?: unknown },
          index
        ) =>
          !!keyframe &&
          isFiniteNumber(keyframe.t) &&
          isVec3(keyframe.position) &&
          isQuat(keyframe.quaternion) &&
          (index === 0 || keyframe.t > keyframes[index - 1].t)
      );
      return (
        valid && keyframes[0].t === 0 && keyframes[keyframes.length - 1].t === 1
      );
    }
    case "waypoints":
      return (
        Array.isArray(motion.waypoints) &&
        motion.waypoints.length >= 2 &&
        motion.waypoints.every(
          (waypoint: { offset?: unknown; rotation?: unknown } | null) =>
            !!waypoint && isVec3(waypoint.offset) && isQuat(waypoint.rotation)
        )
      );
    default:
      return false;
  }
}
