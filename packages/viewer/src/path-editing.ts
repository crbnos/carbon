// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Vector3 } from "three";
import { motionToKeyframes } from "./keyframes";
import {
  IDENTITY_QUAT,
  sameOrientation,
  toQuat,
  toQuaternion,
  toVector3
} from "./quat";
import type { Motion, Quat, Vec3 } from "./types";

/** Coincident-waypoint threshold (mm). */
const WAYPOINT_EPSILON = 1e-3;
/** Travel of the straight default path drawn for a `none` motion. */
export const DEFAULT_WAYPOINT_DISTANCE = 50;

/**
 * World-space waypoints describing a step's insertion travel, for the visual
 * path editor. The LAST waypoint is the seated reference position; earlier
 * waypoints are where the component(s) travel FROM. Relative motions
 * (linear/L/helix) are anchored to `seatedPosition`; a `path` motion's absolute
 * keyframe positions are used directly. `none` — or any motion that can't be
 * sampled — yields a straight default offset so there is always a path to drag.
 *
 * For a multi-component (rigid group) step, pass the centroid of the components' seated
 * positions: the shared relative motion renders as one path anchored there.
 */
export function motionToWaypoints(
  motion: Motion,
  seatedPosition: Vec3,
  options: { defaultDistance?: number } = {}
): Vec3[] {
  if (motion.type !== "none") {
    try {
      const keyframes = motionToKeyframes(motion, {
        position: seatedPosition,
        quaternion: IDENTITY_QUAT
      });
      if (keyframes) {
        const points = dedupePositions(keyframes.positions);
        if (points.length >= 2) return points;
      }
    } catch {
      // Unsamplable (e.g. an absolute path whose seated pose differs) — fall
      // through to the default straight offset below.
    }
  }
  const distance =
    options.defaultDistance && options.defaultDistance > 0
      ? options.defaultDistance
      : DEFAULT_WAYPOINT_DISTANCE;
  const start = toVector3(seatedPosition).add(new Vector3(0, distance, 0));
  return [start.toArray() as Vec3, seatedPosition];
}

/**
 * Converts dragged world-space waypoints back into a RELATIVE motion — 2
 * waypoints → `linear`, 3+ → `L` (multi-segment). Relative (not absolute
 * `path`) so it applies to every component in a rigid-group step. Pure translation:
 * components keep their seated orientation. The last waypoint is forced to the
 * seated position; zero-length segments are dropped; degenerate input collapses
 * to `none`. Directions/distances match `motionToKeyframes`' reconstruction, so
 * `motionToWaypoints` → `waypointsToMotion` round-trips exactly for linear/L.
 */
export function waypointsToMotion(
  waypoints: Vec3[],
  seatedPosition: Vec3
): Motion {
  const points = waypoints.map(toVector3);
  if (points.length > 0) points[points.length - 1] = toVector3(seatedPosition);

  const segments: { direction: Vec3; distance: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) continue;
    const delta = to.clone().sub(from);
    const distance = delta.length();
    if (distance < WAYPOINT_EPSILON) continue;
    segments.push({
      direction: delta.divideScalar(distance).toArray() as Vec3,
      distance
    });
  }

  const first = segments[0];
  if (!first) return { type: "none" };
  if (segments.length === 1) {
    return {
      type: "linear",
      direction: first.direction,
      distance: first.distance
    };
  }
  return { type: "L", segments };
}

/**
 * One editable waypoint: where the moving set's seated center travels through
 * (world space) and how it is turned there, relative to its seated pose.
 */
export type EditorWaypoint = { position: Vec3; rotation: Quat };

export function motionToEditorWaypoints(
  motion: Motion,
  seatedPosition: Vec3,
  options: { defaultDistance?: number } = {}
): EditorWaypoint[] {
  if (motion.type === "waypoints" && motion.waypoints.length >= 2) {
    const seated = toVector3(seatedPosition);
    return motion.waypoints.map((waypoint) => ({
      position: seated
        .clone()
        .add(toVector3(waypoint.offset))
        .toArray() as Vec3,
      rotation: waypoint.rotation
    }));
  }
  return motionToWaypoints(motion, seatedPosition, options).map((position) => ({
    position,
    rotation: IDENTITY_QUAT
  }));
}

/**
 * With no turned waypoint this is `waypointsToMotion`'s `linear` / `L` / `none`;
 * any turn makes it a relative `waypoints` motion. The last waypoint is forced
 * to the seat, unturned.
 */
export function editorWaypointsToMotion(
  waypoints: EditorWaypoint[],
  seatedPosition: Vec3
): Motion {
  const rotated = waypoints
    .slice(0, -1)
    .some((waypoint) => !sameOrientation(waypoint.rotation, IDENTITY_QUAT));
  if (!rotated) {
    return waypointsToMotion(
      waypoints.map((waypoint) => waypoint.position),
      seatedPosition
    );
  }
  const seated = toVector3(seatedPosition);
  return {
    type: "waypoints",
    waypoints: waypoints.map((waypoint, index) =>
      index === waypoints.length - 1
        ? { offset: [0, 0, 0], rotation: IDENTITY_QUAT }
        : {
            offset: toVector3(waypoint.position).sub(seated).toArray() as Vec3,
            rotation: toQuat(toQuaternion(waypoint.rotation))
          }
    )
  };
}

/** Flat [x,y,z,…] → Vec3[], dropping consecutive coincident points. */
function dedupePositions(flat: number[]): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const point: Vec3 = [flat[i] ?? 0, flat[i + 1] ?? 0, flat[i + 2] ?? 0];
    const previous = points[points.length - 1];
    if (
      previous &&
      Math.hypot(
        point[0] - previous[0],
        point[1] - previous[1],
        point[2] - previous[2]
      ) < WAYPOINT_EPSILON
    ) {
      continue;
    }
    points.push(point);
  }
  return points;
}
