// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  AnimationClip,
  Matrix4,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack
} from "three";
import {
  EASE_SAMPLES,
  easeInOutCubic,
  type MotionKeyframeOptions,
  type MotionKeyframes,
  motionToKeyframes,
  type Pose,
  resampleEased
} from "./keyframes";
import { toQuat, toVector3 } from "./quat";
import { DEFAULT_HOLD_SECONDS, motionDuration } from "./timing";
import type { AssemblyStep, Motion, Vec3 } from "./types";

export type StepClipOptions = Omit<MotionKeyframeOptions, "pivot"> & {
  /**
   * Seated center of what the step's own insertion moves — a `waypoints`
   * motion turns the set about it. Null when none of its parts resolve.
   */
  pivot: Vec3 | null;
  /** Seconds to hold the seated pose at the end of each loop. */
  holdSeconds?: number;
  /**
   * A step that carries a finished sub-assembly in: prepend a straight glide
   * from seat + `offset` (beside the build) to where the insertion starts.
   * Never clamped like the insertion travel is — it starts far by design.
   * With `nodeIds`, only those nodes glide; the step's other parts wait at
   * their insertion start until the glide ends.
   */
  glide?: { offset: Vec3; seconds: number; nodeIds?: string[] };
  /**
   * Finished sub-assemblies that join on their own path. They play one after
   * another before the step's own parts move (and before any `glide`); each
   * travels as one rigid unit, turning about its own seated center.
   */
  units?: StepClipUnit[];
};

export type StepClipUnit = {
  nodeIds: string[];
  motion: Motion;
  seconds: number;
  /** The unit's seated center, which a `waypoints` motion turns about. */
  pivot: Vec3 | null;
};

type ClipSegment = StepClipUnit & { glide?: StepClipOptions["glide"] };

/**
 * Tracks are bound by node uuid so duplicate node names cannot collide, and
 * keyframes are converted into each node's parent-local space. Nodes must
 * currently sit at their seated pose.
 *
 * `step.componentNodeIds` are the parts the step's own insertion moves — the
 * units' parts belong in `units`. Each unit first travels its own path, one
 * after another, while the step's own parts wait at their start. With
 * `glide`, the own parts then glide from seat + offset to their insertion
 * start (a `none` motion glides straight to the seat).
 *
 * A node listed in more than one segment moves with the first one only: two
 * tracks on one node would fight over it.
 *
 * Returns `null` when nothing moves: a `none` motion without a glide or units,
 * or no component that resolves to a node.
 */
export function buildStepClip(
  step: AssemblyStep,
  nodesById: Map<string, Object3D>,
  options: StepClipOptions
): AnimationClip | null {
  const { glide } = options;
  const segments: ClipSegment[] = (options.units ?? []).filter(
    (unit) => unit.nodeIds.length > 0 && unit.motion.type !== "none"
  );
  if (
    step.componentNodeIds.length > 0 &&
    (step.motion.type !== "none" || glide)
  ) {
    segments.push({
      nodeIds: step.componentNodeIds,
      motion: step.motion,
      seconds:
        step.motion.type === "none"
          ? 0
          : (options.duration ?? motionDuration(step.motion)),
      pivot: options.pivot,
      glide
    });
  }
  if (segments.length === 0) return null;

  const clipLength =
    segments.reduce(
      (sum, segment) => sum + segment.seconds + (segment.glide?.seconds ?? 0),
      0
    ) + (options.holdSeconds ?? DEFAULT_HOLD_SECONDS);
  const tracks: (VectorKeyframeTrack | QuaternionKeyframeTrack)[] = [];

  const claimed = new Set<string>();
  let start = 0;
  for (const segment of segments) {
    const { motion, glide: segmentGlide } = segment;
    const pivot = segment.pivot ?? undefined;
    for (const nodeId of segment.nodeIds) {
      if (claimed.has(nodeId)) continue;
      claimed.add(nodeId);
      const node = nodesById.get(nodeId);
      if (!node) continue;
      const { seatedPose, worldScale } = worldPoseOf(node);
      // A `none` motion only plays with a glide: the insertion is the seat itself.
      const raw =
        motion.type === "none"
          ? {
              times: [0],
              positions: [...seatedPose.position],
              quaternions: [...seatedPose.quaternion]
            }
          : motionToKeyframes(motion, seatedPose, {
              samplesPerTurn: options.samplesPerTurn,
              duration: segment.seconds,
              pivot
            });
      if (!raw) continue;
      const insertion = isEasedMotion(motion) ? resampleEased(raw) : raw;
      const keyframes = segmentGlide
        ? prependGlide(
            insertion,
            !segmentGlide.nodeIds || segmentGlide.nodeIds.includes(nodeId)
              ? segmentGlide.offset
              : null,
            seatedPose,
            segmentGlide.seconds
          )
        : insertion;
      tracks.push(
        ...nodeTracks(
          node,
          delayKeyframes(keyframes, start),
          worldScale,
          clipLength
        )
      );
    }
    start += segment.seconds + (segmentGlide?.seconds ?? 0);
  }

  if (tracks.length === 0) return null;
  return new AnimationClip(`step:${step.id}`, clipLength, tracks);
}

/**
 * Ease the straight and editor-drawn approaches (accelerate off the start,
 * settle into the seat). Helix threads at a constant rate (mechanically
 * correct) and planner paths carry their own timing.
 */
function isEasedMotion(motion: Motion): boolean {
  return (
    motion.type === "linear" ||
    motion.type === "L" ||
    motion.type === "waypoints"
  );
}

function worldPoseOf(node: Object3D): {
  seatedPose: Pose;
  worldScale: Vector3;
} {
  node.updateWorldMatrix(true, false);
  const worldPosition = new Vector3();
  const worldQuaternion = new Quaternion();
  const worldScale = new Vector3();
  node.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
  return {
    seatedPose: {
      position: worldPosition.toArray() as Vec3,
      quaternion: toQuat(worldQuaternion)
    },
    worldScale
  };
}

function delayKeyframes(
  keyframes: MotionKeyframes,
  seconds: number
): MotionKeyframes {
  if (seconds <= 0 || keyframes.times.length === 0) return keyframes;
  return {
    times: [0, ...keyframes.times.map((time) => time + seconds)],
    positions: [...keyframes.positions.slice(0, 3), ...keyframes.positions],
    quaternions: [
      ...keyframes.quaternions.slice(0, 4),
      ...keyframes.quaternions
    ]
  };
}

/**
 * World-space keyframes → uuid-bound tracks in the node's parent-local space,
 * holding the last (seated) pose until `clipLength` so the loop pauses there.
 */
function nodeTracks(
  node: Object3D,
  keyframes: MotionKeyframes,
  worldScale: Vector3,
  clipLength: number
): (VectorKeyframeTrack | QuaternionKeyframeTrack)[] {
  const parentWorldInverse = node.parent
    ? node.parent.matrixWorld.clone().invert()
    : new Matrix4();

  const times: number[] = [];
  const positions: number[] = [];
  const quaternions: number[] = [];
  const worldMatrix = new Matrix4();
  const localMatrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const localPosition = new Vector3();
  const localQuaternion = new Quaternion();
  const localScale = new Vector3();

  const frameCount = keyframes.times.length;
  for (let i = 0; i < frameCount; i++) {
    const time = keyframes.times[i];
    if (time === undefined) continue;
    position.fromArray(keyframes.positions, i * 3);
    quaternion.fromArray(keyframes.quaternions, i * 4);
    worldMatrix.compose(position, quaternion, worldScale);
    localMatrix.multiplyMatrices(parentWorldInverse, worldMatrix);
    localMatrix.decompose(localPosition, localQuaternion, localScale);
    times.push(time);
    positions.push(localPosition.x, localPosition.y, localPosition.z);
    quaternions.push(
      localQuaternion.x,
      localQuaternion.y,
      localQuaternion.z,
      localQuaternion.w
    );
  }

  const lastTime = times[times.length - 1];
  if (lastTime !== undefined && lastTime < clipLength - 1e-9) {
    times.push(clipLength);
    positions.push(...positions.slice(-3));
    quaternions.push(...quaternions.slice(-4));
  }

  return [
    new VectorKeyframeTrack(`${node.uuid}.position`, times, positions),
    new QuaternionKeyframeTrack(`${node.uuid}.quaternion`, times, quaternions)
  ];
}

/**
 * Prepends an eased straight glide from seat + `offset` to the insertion's
 * first pose, and shifts the insertion to start when the glide ends. The part
 * holds the insertion's starting orientation while it glides (the carry is a
 * pure translation), so a helix that starts unscrewed doesn't snap. A `null`
 * offset holds the part at its insertion start for the glide's duration.
 */
function prependGlide(
  insertion: MotionKeyframes,
  offset: Vec3 | null,
  seatedPose: Pose,
  seconds: number
): MotionKeyframes {
  const end = new Vector3().fromArray(insertion.positions, 0);
  const start = offset
    ? toVector3(seatedPose.position).add(toVector3(offset))
    : end.clone();
  const quaternion = new Quaternion().fromArray(insertion.quaternions, 0);

  const times: number[] = [];
  const positions: number[] = [];
  const quaternions: number[] = [];
  const point = new Vector3();
  for (let j = 0; j <= EASE_SAMPLES; j++) {
    const u = j / EASE_SAMPLES;
    point.copy(start).lerp(end, easeInOutCubic(u));
    times.push(u * seconds);
    positions.push(point.x, point.y, point.z);
    quaternions.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }
  // The insertion's first frame is where the glide ended — skip the duplicate.
  for (let i = 1; i < insertion.times.length; i++) {
    times.push(seconds + (insertion.times[i] ?? 0));
    positions.push(...insertion.positions.slice(i * 3, i * 3 + 3));
    quaternions.push(...insertion.quaternions.slice(i * 4, i * 4 + 4));
  }
  return { times, positions, quaternions };
}
