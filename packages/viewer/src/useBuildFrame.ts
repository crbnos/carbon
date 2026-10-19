// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { type Camera, Quaternion, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { easeInOutCubic } from "./keyframes";
import { upForOrientation } from "./orientation";
import { sameOrientation, toQuat, toQuaternion } from "./quat";
import type { Quat } from "./types";

const TURN_MS = 900;

const IDENTITY = new Quaternion();
// Reused every frame so the turn allocates nothing.
const SCRATCH_DELTA = new Quaternion();
const SCRATCH_STEP = new Quaternion();
const SCRATCH_INVERSE = new Quaternion();

export type BuildFrame = {
  /** A turn to a new orientation is playing: playback and framing wait for it. */
  isTurning: () => boolean;
  /**
   * A model-frame point as seen on the bench (where the viewer stands), in
   * place. `orientation` defaults to the one on screen now.
   */
  toBench: (point: Vector3, orientation?: Quat) => Vector3;
  /** The inverse of `toBench`, in place. */
  fromBench: (point: Vector3, orientation?: Quat) => Vector3;
  /**
   * The camera's current bench direction (target → eye, unit), in the model
   * frame of `orientation`: where it looks from once a turn to it lands.
   * Null before the controls exist.
   */
  keptDirection: (orientation: Quat) => Vector3 | null;
};

/**
 * The build's orientation as a CAMERA FRAME, never a turned model (motion, the
 * path editor and box select all work in world space). A new orientation turns
 * the camera, its target and up about the build's center by `next⁻¹ · applied`
 * — the center, not the camera target, so an off-center build turns in place
 * instead of swinging round in an arc.
 *
 * Call it before any other `useFrame` that moves the camera: the turn step must
 * run first, and the others check `isTurning()`.
 */
export function useBuildFrame({
  camera,
  controls,
  orientation,
  center
}: {
  camera: Camera;
  controls: OrbitControlsImpl | null;
  orientation: Quat;
  /** The center of the bounds the build is framed on — what it turns about. */
  center: Vector3;
}): BuildFrame {
  const frameRef = useRef<{
    applied: Quaternion;
    from: Quaternion;
    to: Quaternion;
    start: number;
  } | null>(null);
  const pivotRef = useRef(new Vector3());
  // The up `applied` implies, recomputed only when `applied` changes.
  const upRef = useRef({ applied: new Quaternion(), up: new Vector3(0, 0, 1) });

  // Moves the frame from `applied` to `next`, keeping the camera fixed in the
  // bench frame.
  const applyFrame = useCallback(
    (next: Quaternion) => {
      const frame = frameRef.current;
      if (!frame || !controls) return;
      const delta = SCRATCH_DELTA.copy(next).invert().multiply(frame.applied);
      turnAbout(camera.position, delta, pivotRef.current);
      turnAbout(controls.target, delta, pivotRef.current);
      camera.up.applyQuaternion(delta).normalize();
      frame.applied.copy(next);
      controls.update();
    },
    [camera, controls]
  );

  useEffect(() => {
    if (!controls) return;
    const next = toQuaternion(orientation);
    const frame = frameRef.current;
    if (!frame) {
      // First frame: start already turned, no animation.
      camera.up.set(0, 0, 1);
      pivotRef.current.copy(center);
      frameRef.current = {
        applied: new Quaternion(),
        from: next.clone(),
        to: next.clone(),
        start: 0
      };
      applyFrame(next);
      return;
    }
    if (!center.equals(pivotRef.current)) {
      // Entering or leaving a sub-assembly moves the center: a turn would
      // swing about the other build's center, so the new frame lands at once.
      pivotRef.current.copy(center);
      applyFrame(next);
      frame.from.copy(next);
      frame.to.copy(next);
      return;
    }
    if (sameOrientation(toQuat(frame.to), orientation)) return;
    frame.from.copy(frame.applied);
    frame.to.copy(next);
    frame.start = performance.now();
  }, [orientation, center, controls, camera, applyFrame]);

  // The camera outlives a remounted scene (`key={scene.uuid}`): hand it back
  // upright, so the next mount starts from the model frame.
  useEffect(
    () => () => {
      if (!frameRef.current) return;
      applyFrame(IDENTITY);
      frameRef.current = null;
    },
    [applyFrame]
  );

  // Grabbing the view mid-turn finishes the turn at once.
  useEffect(() => {
    if (!controls) return;
    const finishTurn = () => {
      const frame = frameRef.current;
      if (frame && !frame.applied.equals(frame.to)) applyFrame(frame.to);
    };
    controls.addEventListener("start", finishTurn);
    return () => controls.removeEventListener("start", finishTurn);
  }, [controls, applyFrame]);

  useFrame(() => {
    const frame = frameRef.current;
    if (!frame || !controls) return;
    if (!frame.applied.equals(frame.to)) {
      const t = Math.min((performance.now() - frame.start) / TURN_MS, 1);
      applyFrame(
        t < 1
          ? SCRATCH_STEP.slerpQuaternions(
              frame.from,
              frame.to,
              easeInOutCubic(t)
            )
          : frame.to
      );
      return;
    }
    // drei's GizmoHelper writes `camera.up` on every frame of a viewcube
    // tween and resets it when the tween ends: keep the build turned.
    const cached = upRef.current;
    if (!cached.applied.equals(frame.applied)) {
      cached.up.fromArray(upForOrientation(toQuat(frame.applied)));
      cached.applied.copy(frame.applied);
    }
    if (camera.up.distanceToSquared(cached.up) > 1e-6) {
      camera.up.copy(cached.up);
      controls.update();
    }
  });

  const isTurning = useCallback(() => {
    const frame = frameRef.current;
    return frame !== null && !frame.applied.equals(frame.to);
  }, []);
  const toBench = useCallback(
    (point: Vector3, orientation?: Quat) =>
      turnAbout(
        point,
        orientation
          ? toQuaternion(orientation)
          : (frameRef.current?.applied ?? IDENTITY),
        pivotRef.current
      ),
    []
  );
  const fromBench = useCallback(
    (point: Vector3, orientation?: Quat) =>
      turnAbout(
        point,
        SCRATCH_INVERSE.copy(
          orientation
            ? toQuaternion(orientation)
            : (frameRef.current?.applied ?? IDENTITY)
        ).invert(),
        pivotRef.current
      ),
    []
  );
  const keptDirection = useCallback(
    (target: Quat) => {
      if (!controls) return null;
      return camera.position
        .clone()
        .sub(controls.target)
        .applyQuaternion(
          toQuaternion(target)
            .invert()
            .multiply(frameRef.current?.applied ?? IDENTITY)
        )
        .normalize();
    },
    [camera, controls]
  );

  return useMemo(
    () => ({ isTurning, toBench, fromBench, keptDirection }),
    [isTurning, toBench, fromBench, keptDirection]
  );
}

/** Mutates `point`. */
function turnAbout(
  point: Vector3,
  rotation: Quaternion,
  pivot: Vector3
): Vector3 {
  return point.sub(pivot).applyQuaternion(rotation).add(pivot);
}
