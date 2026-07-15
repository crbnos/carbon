import {
  AnimationClip,
  Matrix4,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack
} from "three";
import { synthesizeFallbackMotion } from "./fallback";
import type { AssemblyGraphIndex } from "./graph";
import type { AssemblyStep, Motion, Quat, Vec3 } from "./types";

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
};

export type StepClipOptions = MotionKeyframeOptions & {
  /** Seconds to hold the seated pose at the end of each loop. */
  holdSeconds?: number;
};

const INSERTION_SPEED_MM_PER_S = 60;
const MIN_DURATION_S = 1;
const MAX_DURATION_S = 4;
const DEFAULT_SAMPLES_PER_TURN = 4;
export const DEFAULT_HOLD_SECONDS = 0.6;
/** Coincident-waypoint threshold (mm) and the fallback travel for `none`. */
const WAYPOINT_EPSILON = 1e-3;
export const DEFAULT_WAYPOINT_DISTANCE = 50;
/** Timeline length of a process-only (none-motion) step without an explicit duration */
const NONE_STEP_SECONDS = 2;

/**
 * Seconds a step occupies on the continuous timeline: the explicit
 * `durationSeconds` override when set, otherwise the natural animation
 * length (motion duration + seated hold), or a fixed slot for process-only
 * steps.
 */
export function stepTimelineSeconds(
  step: Pick<AssemblyStep, "motion" | "durationSeconds">
): number {
  if (step.durationSeconds && step.durationSeconds > 0) {
    return step.durationSeconds;
  }
  if (step.motion.type === "none") return NONE_STEP_SECONDS;
  return motionDuration(step.motion) + DEFAULT_HOLD_SECONDS;
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
    case "none":
      return 0;
  }
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

/**
 * The motion a step should display. Flagged steps (the planner proved no
 * collision-free path exists) keep motion "none" — the player fades their
 * components in at the seated pose rather than animating a fabricated
 * fly-through. Other non-first steps stored with "none" (legacy plans,
 * manually authored steps) get the AABB fallback so components never pop into
 * place; the fallback's obstacle world is `presentNodeIds`, the components
 * already installed by EARLIER steps — later-step and never-installed
 * components are not on the canvas. When no collision-free fallback exists the
 * step keeps "none" and fades in. The first step is the base: placed, not
 * inserted.
 */
export function displayMotionForStep(
  step: Pick<AssemblyStep, "motion" | "componentNodeIds" | "flagged">,
  index: number,
  graphIndex: AssemblyGraphIndex | null,
  presentNodeIds: ReadonlySet<string>
): Motion {
  if (
    index === 0 ||
    step.flagged ||
    step.motion.type !== "none" ||
    step.componentNodeIds.length === 0 ||
    !graphIndex
  ) {
    return step.motion;
  }
  const fallback = synthesizeFallbackMotion(
    graphIndex,
    step.componentNodeIds,
    presentNodeIds
  );
  return fallback && fallback.type !== "none" ? fallback : step.motion;
}

/** Components smaller than this fraction of the assembly count as "small". */
const SMALL_COMPONENT_FRACTION = 0.15;
/** Small components travel at least this many times their own size. */
const SMALL_COMPONENT_TRAVEL_FACTOR = 2.5;
/** No component travels more than this many times its own size, +margin. */
const NATURAL_TRAVEL_FACTOR = 3;
/** Additive slack (mm) on the travel ceiling so a seat still fully clears. */
const NATURAL_TRAVEL_MARGIN_MM = 5;
/**
 * Hard ceiling as a fraction of the whole assembly: nothing animates in from
 * further than this, however large the part. A big FLAT part (a gasket, a lid)
 * has a huge diagonal but should still just drop a short way onto its seat —
 * the per-part `NATURAL_TRAVEL_FACTOR × diagonal` ceiling is meaningless for it
 * (3× a 166 mm seal = 500 mm), so its planner collision path (an L-shaped
 * detour around the box, ~1.5× the assembly) reads as flying in from off-screen.
 */
const ASSEMBLY_TRAVEL_FRACTION = 0.35;

/**
 * Shapes a component's insertion travel into a natural band for playback so it
 * neither pops (too short) nor flies in from across the assembly (too long).
 *
 * Display-only: the stored plan keeps the geometric (collision-minimum) travel;
 * this only shortens/lengthens where the part *starts* its animated approach.
 * Safe because playback hides future-step parts and a part seats against the
 * already-placed parts below/beside it, not along its short approach.
 *
 * - Ceiling (all parts): `d · NATURAL_TRAVEL_FACTOR + margin` — a long
 *   collision path (slider, deep mate, a graze past a distant neighbor) is
 *   trimmed to a few of the part's own body-lengths.
 * - Floor (small parts only, < SMALL_COMPONENT_FRACTION of the assembly): keeps
 *   bolts/washers/pins traveling `d · SMALL_COMPONENT_TRAVEL_FACTOR` so they
 *   still read at assembly scale.
 *
 * Returns the motion unchanged when it's non-translating or already in band.
 */
export function naturalizeMotion(
  motion: Motion,
  componentDiagonal: number,
  assemblyDiagonal: number
): Motion {
  if (componentDiagonal <= 0 || assemblyDiagonal <= 0) return motion;

  const isSmall =
    componentDiagonal < assemblyDiagonal * SMALL_COMPONENT_FRACTION;
  const floor = isSmall ? componentDiagonal * SMALL_COMPONENT_TRAVEL_FACTOR : 0;
  // Per-part ceiling, then the assembly-wide cap; never below the floor so a
  // borderline-small part keeps its readable minimum travel.
  const ceiling = Math.max(
    floor,
    Math.min(
      componentDiagonal * NATURAL_TRAVEL_FACTOR + NATURAL_TRAVEL_MARGIN_MM,
      assemblyDiagonal * ASSEMBLY_TRAVEL_FRACTION
    )
  );
  const clamp = (t: number) => Math.min(Math.max(t, floor), ceiling);

  switch (motion.type) {
    case "linear": {
      const distance = clamp(motion.distance);
      return distance === motion.distance ? motion : { ...motion, distance };
    }
    case "L": {
      const total = motion.segments.reduce(
        (sum, segment) => sum + Math.abs(segment.distance),
        0
      );
      if (total <= 0) return motion;
      const target = clamp(total);
      if (target === total) return motion;
      const scale = target / total;
      return {
        ...motion,
        segments: motion.segments.map((segment) => ({
          ...segment,
          distance: segment.distance * scale
        }))
      };
    }
    default:
      return motion;
  }
}

/**
 * Builds world-space insertion keyframes for a component whose final (seated)
 * world pose is `basePose`. The last keyframe always equals `basePose`.
 * Returns `null` for `none` motions.
 */
/** Sub-samples per motion when re-timing a straight path through ease-in-out. */
const EASE_SAMPLES = 20;

/** Ease-in-out cubic: slow start, quick middle, gentle settle. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Re-times a piecewise-linear keyframe path through an ease-in-out velocity
 * profile so an insertion accelerates off the start and decelerates into its
 * seat instead of moving at constant speed. Preserves the geometric path and
 * both endpoints exactly (only WHEN the part is at each point changes); total
 * duration is unchanged. Playback-only — the stored motion and the editable
 * waypoints keep the raw path.
 */
export function resampleEased(kf: MotionKeyframes): MotionKeyframes {
  const n = kf.times.length;
  const total = kf.times[n - 1] ?? 0;
  if (n < 2 || total <= 0) return kf;

  const times: number[] = [];
  const positions: number[] = [];
  const quaternions: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const qa = new Quaternion();
  const qb = new Quaternion();

  for (let j = 0; j <= EASE_SAMPLES; j++) {
    const u = j / EASE_SAMPLES;
    const s = easeInOutCubic(u) * total; // eased sample point along the path
    let i = 0;
    while (i < n - 1 && (kf.times[i + 1] ?? total) < s) i++;
    const t0 = kf.times[i] ?? 0;
    const t1 = kf.times[i + 1] ?? total;
    const span = t1 - t0;
    const f = span > 1e-9 ? (s - t0) / span : 0;
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
  }
}

/**
 * Builds a looping insertion AnimationClip for one step, with position and
 * quaternion tracks for each of the step's components. Tracks are bound by node
 * uuid so duplicate node names cannot collide. World-space keyframes are
 * converted into each node's parent-local space, so nested assembly
 * transforms are respected. Nodes are assumed to currently sit at their
 * final (seated) pose.
 *
 * Returns `null` for `none` motions or when no component resolves to a node.
 */
export function buildStepClip(
  step: AssemblyStep,
  nodesById: Map<string, Object3D>,
  options: StepClipOptions = {}
): AnimationClip | null {
  if (step.motion.type === "none" || step.componentNodeIds.length === 0) {
    return null;
  }

  const duration = options.duration ?? motionDuration(step.motion);
  const holdSeconds = options.holdSeconds ?? DEFAULT_HOLD_SECONDS;
  const tracks: (VectorKeyframeTrack | QuaternionKeyframeTrack)[] = [];

  for (const nodeId of step.componentNodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) continue;

    node.updateWorldMatrix(true, false);
    const worldPosition = new Vector3();
    const worldQuaternion = new Quaternion();
    const worldScale = new Vector3();
    node.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);

    const rawKeyframes = motionToKeyframes(
      step.motion,
      {
        position: worldPosition.toArray() as Vec3,
        quaternion: toQuat(worldQuaternion)
      },
      { ...options, duration }
    );
    if (!rawKeyframes) continue;
    // Ease the straight insertion approaches (accelerate off the start, settle
    // into the seat). Helix threads at a constant rate (mechanically correct)
    // and paths carry their own timing, so leave those raw.
    const keyframes =
      step.motion.type === "linear" || step.motion.type === "L"
        ? resampleEased(rawKeyframes)
        : rawKeyframes;

    const parentWorldInverse = node.parent
      ? node.parent.matrixWorld.clone().invert()
      : new Matrix4();

    const times: number[] = [];
    const positions: number[] = [];
    const quaternions: number[] = [];
    const worldMatrix = new Matrix4();
    const localMatrix = new Matrix4();
    const localPosition = new Vector3();
    const localQuaternion = new Quaternion();
    const localScale = new Vector3();

    const frameCount = keyframes.times.length;
    for (let i = 0; i < frameCount; i++) {
      const time = keyframes.times[i];
      if (time === undefined) continue;
      const position = new Vector3().fromArray(keyframes.positions, i * 3);
      const quaternion = new Quaternion().fromArray(
        keyframes.quaternions,
        i * 4
      );
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

    // Hold the seated pose so LoopRepeat pauses before restarting.
    const lastTime = times[times.length - 1];
    if (holdSeconds > 0 && lastTime !== undefined) {
      times.push(lastTime + holdSeconds);
      positions.push(...positions.slice(-3));
      quaternions.push(...quaternions.slice(-4));
    }

    tracks.push(
      new VectorKeyframeTrack(`${node.uuid}.position`, times, positions),
      new QuaternionKeyframeTrack(`${node.uuid}.quaternion`, times, quaternions)
    );
  }

  if (tracks.length === 0) return null;
  return new AnimationClip(`step:${step.id}`, duration + holdSeconds, tracks);
}

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
        quaternion: [0, 0, 0, 1]
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

function toVector3(value: Vec3): Vector3 {
  return new Vector3(value[0], value[1], value[2]);
}

function toQuaternion(value: Quat): Quaternion {
  return new Quaternion(value[0], value[1], value[2], value[3]).normalize();
}

function toQuat(quaternion: Quaternion): Quat {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
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
