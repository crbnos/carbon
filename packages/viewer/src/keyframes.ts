// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Matrix4, Quaternion, Vector3 } from "three";
import { toQuaternion, toVector3 } from "./quat";
import { motionDuration, waypointLegTravel } from "./timing";
import type { Motion, Quat, Vec3 } from "./types";

/**
 * Pure keyframe construction for step motions. No WebGL — everything here is
 * unit-testable in node.
 *
 * Motion JSON describes the INSERTION of a component: keyframes start at the
 * displaced (pre-insertion) pose and end at the component's final (seated) pose.
 * All poses produced by `motionToKeyframes` are world-space; `buildStepClip`
 * converts them into each node's parent-local space for animation.
 */

/** A world-space pose: position + quaternion ([x, y, z, w]) */
export type Pose = {
  position: Vec3;
  quaternion: Quat;
};

export type MotionKeyframes = {
  /** Seconds, monotonically non-decreasing, starting at 0 */
  times: number[];
  /** Flat [x, y, z] per keyframe, world space */
  positions: number[];
  /** Flat [x, y, z, w] per keyframe, world space */
  quaternions: number[];
};

export type MotionKeyframeOptions = {
  /** Total animation duration in seconds. Defaults to `motionDuration(motion)`. */
  duration?: number;
  /** Helix sampling density (quaternion slerp needs <180° between samples). */
  samplesPerTurn?: number;
  /**
   * Seated center of the whole moving set (one part, a rigid group, or a
   * sub-assembly). A `waypoints` motion turns the set about it. Defaults to the
   * part's own seated position.
   */
  pivot?: Vec3;
};

const DEFAULT_SAMPLES_PER_TURN = 4;
/** A turning waypoint leg gets one keyframe per this much rotation (15°). */
const WAYPOINT_TURN_STEP = Math.PI / 12;
/** Sub-samples per motion when re-timing a straight path through ease-in-out. */
export const EASE_SAMPLES = 20;

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * A `waypoints` pose as a world transform of the seated set: turn about the
 * pivot (the set's seated center), then shift by `offset`.
 */
export function waypointMatrix(
  offset: Vector3,
  rotation: Quaternion,
  pivot: Vector3,
  target: Matrix4 = new Matrix4()
): Matrix4 {
  const translation = pivot
    .clone()
    .applyQuaternion(rotation)
    .negate()
    .add(pivot)
    .add(offset);
  return target.makeRotationFromQuaternion(rotation).setPosition(translation);
}

function easeInOutCubicInverse(y: number): number {
  return y < 0.5 ? Math.cbrt(y / 4) : 1 - Math.cbrt(2 * (1 - y)) / 2;
}

/**
 * Re-times a piecewise-linear keyframe path through an ease-in-out velocity
 * profile. The geometric path, both endpoints and the total duration are kept;
 * only WHEN the part is at each point changes.
 *
 * Every input keyframe stays a keyframe (at its eased time), besides
 * `EASE_SAMPLES` evenly spaced ones for the velocity profile. Uniform samples
 * alone skip keyframes where the ease runs fast, and the track then cuts
 * straight across a turning waypoint leg's arc.
 */
export function resampleEased(kf: MotionKeyframes): MotionKeyframes {
  const n = kf.times.length;
  const total = kf.times[n - 1] ?? 0;
  if (n < 2 || total <= 0) return kf;

  const fractions = new Set<number>();
  for (let j = 0; j <= EASE_SAMPLES; j++) fractions.add(j / EASE_SAMPLES);
  for (const time of kf.times) {
    fractions.add(
      easeInOutCubicInverse(Math.min(Math.max(time / total, 0), 1))
    );
  }
  const sorted = [...fractions].sort((a, b) => a - b);
  const samples = sorted.filter(
    (u, index) => index === 0 || u - (sorted[index - 1] ?? 0) > 1e-9
  );

  const times: number[] = [];
  const positions: number[] = [];
  const quaternions: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const qa = new Quaternion();
  const qb = new Quaternion();

  let i = 0;
  for (const u of samples) {
    const s = easeInOutCubic(u) * total; // eased sample point along the path
    while (i < n - 1 && (kf.times[i + 1] ?? total) < s) i++;
    const t0 = kf.times[i] ?? 0;
    const t1 = kf.times[i + 1] ?? total;
    const span = t1 - t0;
    const f = span > 1e-9 ? Math.min(Math.max((s - t0) / span, 0), 1) : 0;
    a.fromArray(kf.positions, i * 3);
    b.fromArray(kf.positions, (i + 1) * 3);
    a.lerp(b, f);
    qa.fromArray(kf.quaternions, i * 4);
    qb.fromArray(kf.quaternions, (i + 1) * 4);
    qa.slerp(qb, f);
    times.push(u * total);
    positions.push(a.x, a.y, a.z);
    quaternions.push(qa.x, qa.y, qa.z, qa.w);
  }
  return { times, positions, quaternions };
}

/**
 * Builds world-space insertion keyframes for a component whose final (seated)
 * world pose is `basePose`. The last keyframe always equals `basePose`.
 * Returns `null` for `none` motions.
 */
export function motionToKeyframes(
  motion: Motion,
  basePose: Pose,
  options: MotionKeyframeOptions = {}
): MotionKeyframes | null {
  const duration = options.duration ?? motionDuration(motion);
  const finalPosition = toVector3(basePose.position);
  const finalQuaternion = toQuaternion(basePose.quaternion);

  switch (motion.type) {
    case "none":
      return null;

    case "linear": {
      const direction = toVector3(motion.direction).normalize();
      const start = finalPosition
        .clone()
        .addScaledVector(direction, -motion.distance);
      return fromPoses(
        [0, duration],
        [
          { position: start, quaternion: finalQuaternion },
          { position: finalPosition, quaternion: finalQuaternion }
        ]
      );
    }

    case "L": {
      // Walk backwards from the final pose through the segments (insertion
      // order means the last segment ends at the final pose).
      const positions: Vector3[] = [finalPosition.clone()];
      for (let i = motion.segments.length - 1; i >= 0; i--) {
        const segment = motion.segments[i];
        const previous = positions[0];
        if (!segment || !previous) continue;
        const direction = toVector3(segment.direction).normalize();
        positions.unshift(
          previous.clone().addScaledVector(direction, -segment.distance)
        );
      }
      const distances = motion.segments.map((s) => Math.abs(s.distance));
      const total = distances.reduce((sum, d) => sum + d, 0);
      const times: number[] = [0];
      let elapsed = 0;
      for (const distance of distances) {
        elapsed += total > 0 ? (distance / total) * duration : 0;
        times.push(elapsed);
      }
      if (total === 0) times[times.length - 1] = duration;
      return fromPoses(
        times,
        positions.map((position) => ({
          position,
          quaternion: finalQuaternion
        }))
      );
    }

    case "helix": {
      const axis = toVector3(motion.axis).normalize();
      const origin = toVector3(motion.origin);
      const samplesPerTurn = options.samplesPerTurn ?? DEFAULT_SAMPLES_PER_TURN;
      const totalAngle = Math.PI * 2 * motion.turns;
      const threadAdvance = motion.pitch * motion.turns;
      const threadSamples = Math.max(
        1,
        Math.ceil(motion.turns * samplesPerTurn)
      );

      // Pose at the given remaining (un-inserted) thread fraction. r = 1 is
      // the start of threading, r = 0 is seated. The screw transform rotates
      // the final pose backwards about `axis` through `origin` and retracts
      // it along the axis.
      const threadPoseAt = (
        r: number
      ): { position: Vector3; quaternion: Quaternion } => {
        const unscrew = new Quaternion().setFromAxisAngle(
          axis,
          -totalAngle * r
        );
        const position = finalPosition
          .clone()
          .sub(origin)
          .applyQuaternion(unscrew)
          .add(origin)
          .addScaledVector(axis, -threadAdvance * r);
        const quaternion = unscrew.clone().multiply(finalQuaternion);
        return { position, quaternion };
      };

      const approachWeight = Math.abs(motion.approach);
      const threadWeight =
        Math.abs(threadAdvance) > 0
          ? Math.abs(threadAdvance)
          : motion.turns > 0
            ? 1
            : 0;
      const totalWeight = approachWeight + threadWeight;
      const approachTime =
        totalWeight > 0 ? (approachWeight / totalWeight) * duration : 0;

      const times: number[] = [];
      const poses: { position: Vector3; quaternion: Quaternion }[] = [];

      const threadStart = threadPoseAt(1);
      if (motion.approach !== 0) {
        times.push(0);
        poses.push({
          position: threadStart.position
            .clone()
            .addScaledVector(axis, -motion.approach),
          quaternion: threadStart.quaternion
        });
      }
      times.push(approachTime);
      poses.push(threadStart);
      for (let i = 1; i <= threadSamples; i++) {
        const progress = i / threadSamples;
        times.push(approachTime + (duration - approachTime) * progress);
        poses.push(threadPoseAt(1 - progress));
      }
      return fromPoses(times, poses);
    }

    case "path": {
      const keyframes = motion.keyframes;
      const first = keyframes[0];
      const last = keyframes[keyframes.length - 1];
      if (keyframes.length < 2 || !first || !last) {
        throw new Error("path motion requires at least 2 keyframes");
      }
      for (let i = 1; i < keyframes.length; i++) {
        const current = keyframes[i];
        const previous = keyframes[i - 1];
        if (!current || !previous) continue;
        if (current.t <= previous.t) {
          throw new Error(
            "path motion keyframe times must be strictly increasing"
          );
        }
      }
      if (first.t !== 0 || last.t !== 1) {
        throw new Error("path motion keyframes must span t = 0 to t = 1");
      }
      const epsilon = 1e-3;
      if (
        toVector3(last.position).distanceTo(finalPosition) > epsilon ||
        Math.abs(toQuaternion(last.quaternion).dot(finalQuaternion)) <
          1 - epsilon
      ) {
        throw new Error(
          "path motion's last keyframe must equal the component's final pose"
        );
      }
      return fromPoses(
        keyframes.map((keyframe) => keyframe.t * duration),
        keyframes.map((keyframe) => ({
          position: toVector3(keyframe.position),
          quaternion: toQuaternion(keyframe.quaternion)
        }))
      );
    }

    case "waypoints": {
      const waypoints = motion.waypoints;
      const first = waypoints[0];
      if (waypoints.length < 2 || !first) {
        throw new Error("waypoints motion requires at least 2 waypoints");
      }
      const pivot = options.pivot ? toVector3(options.pivot) : finalPosition;
      const matrix = new Matrix4();
      const poseAt = (rotation: Quaternion, offset: Vector3) => ({
        position: finalPosition
          .clone()
          .applyMatrix4(waypointMatrix(offset, rotation, pivot, matrix)),
        quaternion: rotation.clone().multiply(finalQuaternion)
      });
      const legs = waypoints
        .slice(1)
        .map((waypoint, index) =>
          waypointLegTravel(waypoints[index] ?? waypoint, waypoint)
        );
      const total = legs.reduce((sum, leg) => sum + leg, 0);

      const times: number[] = [0];
      const poses = [
        poseAt(toQuaternion(first.rotation), toVector3(first.offset))
      ];
      let elapsed = 0;
      // Keyframe tracks move position in a straight line, so a turning leg is
      // sampled: between samples a part far from the pivot would cut across
      // the arc instead of swinging round it with the rest of the set.
      for (let leg = 0; leg < legs.length; leg++) {
        const from = waypoints[leg];
        const to = waypoints[leg + 1];
        if (!from || !to) continue;
        const fromRotation = toQuaternion(from.rotation);
        const toRotation = toQuaternion(to.rotation);
        const fromOffset = toVector3(from.offset);
        const toOffset = toVector3(to.offset);
        const legSeconds =
          total > 0
            ? ((legs[leg] ?? 0) / total) * duration
            : duration / legs.length;
        const samples = Math.max(
          1,
          Math.ceil(fromRotation.angleTo(toRotation) / WAYPOINT_TURN_STEP)
        );
        for (let i = 1; i <= samples; i++) {
          const f = i / samples;
          times.push(elapsed + legSeconds * f);
          poses.push(
            poseAt(
              fromRotation.clone().slerp(toRotation, f),
              fromOffset.clone().lerp(toOffset, f)
            )
          );
        }
        elapsed += legSeconds;
      }
      // The last waypoint is the seat: land on it exactly.
      times[times.length - 1] = duration;
      poses[poses.length - 1] = {
        position: finalPosition,
        quaternion: finalQuaternion
      };
      return fromPoses(times, poses);
    }
  }
}

function fromPoses(
  times: number[],
  poses: { position: Vector3; quaternion: Quaternion }[]
): MotionKeyframes {
  const positions: number[] = [];
  const quaternions: number[] = [];
  for (const pose of poses) {
    positions.push(pose.position.x, pose.position.y, pose.position.z);
    quaternions.push(
      pose.quaternion.x,
      pose.quaternion.y,
      pose.quaternion.z,
      pose.quaternion.w
    );
  }
  return { times, positions, quaternions };
}
