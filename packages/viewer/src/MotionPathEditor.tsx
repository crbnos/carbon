// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Line, TransformControls } from "@react-three/drei";
import { type ThreeEvent, useThree } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  type Group,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  type Object3D,
  Plane,
  Quaternion,
  Vector3
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { editorWaypointsToMotion, motionToEditorWaypoints } from "./motion";
import type { Motion, Quat, Vec3 } from "./types";

/** Rotation rings snap to this step, so 90° and 180° turns are easy to hit. */
const ROTATION_SNAP = Math.PI / 12;

type Waypoint = { position: Vector3; rotation: Quaternion };

/**
 * In-scene editor for an insertion motion — a step's own, or the path of a
 * sub-assembly the step carries in — rendered as a red path with
 * drag-and-drop waypoints. Grab a sphere and drag it (it moves in the plane
 * facing the camera); the LAST waypoint is the seated (final) pose and is
 * locked. Double-click the path to insert a waypoint; select one and press
 * Delete to remove it.
 *
 * A see-through copy of the moving parts shows the selected waypoint's pose.
 * With the Rotate tool, the selected waypoint gets rotation rings (snapping to
 * 15°) and the spheres stop dragging: the rings' free-rotation grip covers the
 * sphere, so allowing both made one drag move and spin the part at once.
 *
 * Edits serialize back to a RELATIVE motion via `editorWaypointsToMotion` —
 * `linear`/`L` while nothing is turned, `waypoints` once something is — so
 * they apply to every component of a rigid group or sub-assembly.
 *
 * Lives outside the AnimationMixer clip lifecycle: while editing, the player
 * skips building the step clip so components stay seated and the handles are not
 * fought by playback.
 */
export function MotionPathEditor({
  motion,
  seatedPosition,
  scale,
  ghostNodes,
  tool,
  onMotionChange
}: {
  motion: Motion;
  /** Center of the moving parts' seated world bounds (path anchor and pivot). */
  seatedPosition: Vec3;
  /** Assembly diagonal (world units) — sizes the waypoint handles. */
  scale: number;
  /** The parts the path moves, seated — drawn see-through at a waypoint's pose. */
  ghostNodes: Object3D[];
  /** Move: drag waypoints. Rotate: turn the selected waypoint with rings. */
  tool: "move" | "rotate";
  onMotionChange: (motion: Motion) => void;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls
  ) as unknown as OrbitControlsImpl | null;

  const [points, setPoints] = useState<Waypoint[]>(() =>
    motionToEditorWaypoints(motion, seatedPosition, {
      defaultDistance: scale > 0 ? scale * 0.25 : undefined
    }).map((waypoint) => ({
      position: new Vector3(...waypoint.position),
      rotation: new Quaternion(...waypoint.rotation)
    }))
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
    (pts: Waypoint[]) =>
      onMotionChange(
        editorWaypointsToMotion(
          pts.map((point) => ({
            position: point.position.toArray() as Vec3,
            rotation: point.rotation.toArray() as Quat
          })),
          seatedPosition
        )
      ),
    [onMotionChange, seatedPosition]
  );

  const onPointerDown = useCallback(
    (index: number, event: ThreeEvent<PointerEvent>) => {
      if (index === lastIndex) return; // seated pose is locked
      event.stopPropagation();
      setSelected(index);
      if (tool === "rotate") return; // rotating: a click only selects
      (event.target as Element).setPointerCapture?.(event.pointerId);
      const anchor = pointsRef.current[index]?.position;
      if (!anchor) return;
      // Slide in the plane facing the camera, through the grabbed waypoint.
      const normal = camera.getWorldDirection(new Vector3());
      dragRef.current = {
        index,
        plane: new Plane().setFromNormalAndCoplanarPoint(normal, anchor.clone())
      };
      if (controls) controls.enabled = false;
    },
    [camera, controls, lastIndex, tool]
  );

  const onPointerMove = useCallback((event: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.stopPropagation();
    const hit = new Vector3();
    if (!event.ray.intersectPlane(drag.plane, hit)) return;
    setPoints((previous) => {
      const next = previous.map((point, index) =>
        index === drag.index ? { ...point, position: hit.clone() } : point
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
        const distance = distanceToSegment(point, from.position, to.position);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSegment = i;
        }
      }
      const insertIndex = bestSegment + 1;
      // A new waypoint starts turned like the one the segment leaves from.
      const rotation =
        current[bestSegment]?.rotation.clone() ?? new Quaternion();
      const next = [...current];
      next.splice(insertIndex, 0, { position: point, rotation });
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

  // Rotation rings act on a handle sitting at the selected waypoint; turning
  // the handle turns that waypoint.
  const [ringHandle, setRingHandle] = useState<Group | null>(null);
  // With the Rotate tool the rings sit on the selected waypoint, else the start.
  const ringIndex =
    tool !== "rotate" || lastIndex < 1
      ? null
      : selected !== null && selected !== lastIndex
        ? selected
        : 0;
  const ringWaypoint = ringIndex !== null ? points[ringIndex] : undefined;
  useEffect(() => {
    if (!ringHandle || !ringWaypoint) return;
    ringHandle.position.copy(ringWaypoint.position);
    ringHandle.quaternion.copy(ringWaypoint.rotation);
    ringHandle.updateMatrixWorld();
  }, [ringHandle, ringWaypoint]);

  const onRotate = useCallback(() => {
    if (!ringHandle || ringIndex === null) return;
    const rotation = ringHandle.quaternion.clone();
    setPoints((previous) => {
      const next = previous.map((point, index) =>
        index === ringIndex ? { ...point, rotation } : point
      );
      pointsRef.current = next;
      return next;
    });
  }, [ringHandle, ringIndex]);

  const linePoints = useMemo(
    () => points.map((point) => point.position.toArray() as Vec3),
    [points]
  );

  // The see-through copy shows the selected waypoint, else the start.
  const ghostWaypoint =
    (selected !== null && selected !== lastIndex
      ? points[selected]
      : undefined) ?? points[0];
  const showGhost = Boolean(ghostWaypoint) && points.length > 1;

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
            position={point.position}
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
      {showGhost && ghostWaypoint && (
        <MotionGhost
          nodes={ghostNodes}
          pivot={seatedPosition}
          position={ghostWaypoint.position}
          rotation={ghostWaypoint.rotation}
        />
      )}
      <group ref={setRingHandle} />
      {ringHandle && ringWaypoint && (
        <TransformControls
          object={ringHandle}
          mode="rotate"
          space="world"
          rotationSnap={ROTATION_SNAP}
          size={1}
          onObjectChange={onRotate}
          onMouseUp={() => commit(pointsRef.current)}
        />
      )}
    </group>
  );
}

/**
 * The moving parts drawn see-through at one waypoint's pose: turned about the
 * seated center (`pivot`), then moved so that center sits on the waypoint.
 * Copies share the scene's geometry and never take part in picking.
 */
function MotionGhost({
  nodes,
  pivot,
  position,
  rotation
}: {
  nodes: Object3D[];
  pivot: Vec3;
  position: Vector3;
  rotation: Quaternion;
}) {
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: "#f59e0b",
        transparent: true,
        opacity: 0.25,
        depthWrite: false
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  const copies = useMemo(
    () =>
      nodes.map((node) => {
        node.updateWorldMatrix(true, false);
        const copy = node.clone(true);
        copy.matrixAutoUpdate = false;
        copy.matrix.copy(node.matrixWorld);
        copy.matrixWorldNeedsUpdate = true;
        copy.traverse((object) => {
          object.raycast = skipRaycast;
          if ((object as Mesh).isMesh) (object as Mesh).material = material;
        });
        return copy;
      }),
    [nodes, material]
  );

  const groupRef = useRef<Group>(null);
  // Before paint: the copies sit at the seated pose until this matrix lands.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const [x, y, z] = pivot;
    group.matrix
      .makeTranslation(position.x, position.y, position.z)
      .multiply(new Matrix4().makeRotationFromQuaternion(rotation))
      .multiply(new Matrix4().makeTranslation(-x, -y, -z));
    group.matrixWorldNeedsUpdate = true;
  }, [pivot, position, rotation]);

  return (
    <group ref={groupRef} matrixAutoUpdate={false} renderOrder={9}>
      {copies.map((copy) => (
        <primitive key={copy.uuid} object={copy} />
      ))}
    </group>
  );
}

/** A ghost copy is never hit: clicks reach the real parts and the handles. */
function skipRaycast() {
  return;
}

/** Shortest distance from a point to the segment [a, b]. */
function distanceToSegment(point: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  const lengthSq = ab.lengthSq();
  if (lengthSq === 0) return point.distanceTo(a);
  const t = Math.max(0, Math.min(1, point.clone().sub(a).dot(ab) / lengthSq));
  return point.distanceTo(a.clone().addScaledVector(ab, t));
}
