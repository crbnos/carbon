import { Line } from "@react-three/drei";
import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plane, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { motionToWaypoints, waypointsToMotion } from "./motion";
import type { Motion, Vec3 } from "./types";

/**
 * In-scene editor for a step's insertion motion, rendered as a red path with
 * drag-and-drop waypoints. Grab a sphere and drag it (it moves in the plane
 * facing the camera); the LAST waypoint is the seated (final) pose and is
 * locked. Double-click the path to insert a waypoint; select one and press
 * Delete to remove it.
 *
 * Edits serialize back to a RELATIVE motion (`linear`/`L`) via
 * `waypointsToMotion`, so they apply to every component of a rigid-group step. Pure
 * translation — components keep their seated orientation (see the plan / decision #2).
 *
 * Lives outside the AnimationMixer clip lifecycle: while editing, the player
 * skips building the step clip so components stay seated and the handles are not
 * fought by playback.
 */
export function MotionPathEditor({
  motion,
  seatedPosition,
  scale,
  onMotionChange
}: {
  motion: Motion;
  /** Centroid of the step's components' seated world positions (path anchor). */
  seatedPosition: Vec3;
  /** Assembly diagonal (world units) — sizes the waypoint handles. */
  scale: number;
  onMotionChange: (motion: Motion) => void;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls
  ) as unknown as OrbitControlsImpl | null;

  const [points, setPoints] = useState<Vector3[]>(() =>
    motionToWaypoints(motion, seatedPosition, {
      defaultDistance: scale > 0 ? scale * 0.25 : undefined
    }).map((point) => new Vector3(...point))
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  // Mirror of `points` for the drag-end commit (state is async).
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);
  // Active drag: which waypoint, and the camera-facing plane it slides in.
  const dragRef = useRef<{ index: number; plane: Plane } | null>(null);

  const lastIndex = points.length - 1;
  const handleRadius = Math.max(scale * 0.014, 0.5);

  const commit = useCallback(
    (pts: Vector3[]) =>
      onMotionChange(
        waypointsToMotion(
          pts.map((point) => point.toArray() as Vec3),
          seatedPosition
        )
      ),
    [onMotionChange, seatedPosition]
  );

  const onPointerDown = useCallback(
    (index: number, event: ThreeEvent<PointerEvent>) => {
      if (index === lastIndex) return; // seated pose is locked
      event.stopPropagation();
      (event.target as Element).setPointerCapture?.(event.pointerId);
      setSelected(index);
      const anchor = pointsRef.current[index];
      if (!anchor) return;
      // Slide in the plane facing the camera, through the grabbed waypoint.
      const normal = camera.getWorldDirection(new Vector3());
      dragRef.current = {
        index,
        plane: new Plane().setFromNormalAndCoplanarPoint(normal, anchor.clone())
      };
      if (controls) controls.enabled = false;
    },
    [camera, controls, lastIndex]
  );

  const onPointerMove = useCallback((event: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.stopPropagation();
    const hit = new Vector3();
    if (!event.ray.intersectPlane(drag.plane, hit)) return;
    setPoints((previous) => {
      const next = previous.map((point, index) =>
        index === drag.index ? hit.clone() : point
      );
      pointsRef.current = next;
      return next;
    });
  }, []);

  const endDrag = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.stopPropagation();
      (event.target as Element).releasePointerCapture?.(event.pointerId);
      dragRef.current = null;
      if (controls) controls.enabled = true;
      commit(pointsRef.current);
    },
    [commit, controls]
  );

  const insertWaypoint = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      const point = event.point.clone();
      let bestSegment = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      const current = pointsRef.current;
      for (let i = 0; i < current.length - 1; i++) {
        const from = current[i];
        const to = current[i + 1];
        if (!from || !to) continue;
        const distance = distanceToSegment(point, from, to);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSegment = i;
        }
      }
      const insertIndex = bestSegment + 1;
      const next = [...current];
      next.splice(insertIndex, 0, point);
      pointsRef.current = next;
      setPoints(next);
      setSelected(insertIndex);
      commit(next);
    },
    [commit]
  );

  // Delete the selected (non-seated) waypoint, keeping at least a start + seated.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selected == null || selected === lastIndex) return;
      if (pointsRef.current.length <= 2) return;
      const next = pointsRef.current.filter((_, index) => index !== selected);
      pointsRef.current = next;
      setPoints(next);
      setSelected(null);
      commit(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, lastIndex, commit]);

  // Restore orbit controls if we unmount mid-drag.
  useEffect(() => {
    return () => {
      if (dragRef.current && controls) controls.enabled = true;
    };
  }, [controls]);

  const linePoints = useMemo(
    () => points.map((point) => point.toArray() as Vec3),
    [points]
  );

  return (
    <group renderOrder={10}>
      <Line
        points={linePoints}
        color="#ef4444"
        lineWidth={3}
        depthTest={false}
        transparent
        onDoubleClick={insertWaypoint}
      />
      {points.map((point, index) => {
        const isSeated = index === lastIndex;
        const isActive = index === selected || index === hovered;
        return (
          <mesh
            key={index}
            position={point}
            renderOrder={11}
            onPointerDown={(event) => onPointerDown(index, event)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerOver={(event) => {
              if (isSeated) return;
              event.stopPropagation();
              setHovered(index);
            }}
            onPointerOut={() => setHovered((h) => (h === index ? null : h))}
          >
            <sphereGeometry
              args={[
                isActive && !isSeated ? handleRadius * 1.3 : handleRadius,
                20,
                20
              ]}
            />
            <meshBasicMaterial
              color={isSeated ? "#9ca3af" : isActive ? "#f59e0b" : "#ef4444"}
              depthTest={false}
              transparent
            />
          </mesh>
        );
      })}
    </group>
  );
}

/** Shortest distance from a point to the segment [a, b]. */
function distanceToSegment(point: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  const lengthSq = ab.lengthSq();
  if (lengthSq === 0) return point.distanceTo(a);
  const t = Math.max(0, Math.min(1, point.clone().sub(a).dot(ab) / lengthSq));
  return point.distanceTo(a.clone().addScaledVector(ab, t));
}
