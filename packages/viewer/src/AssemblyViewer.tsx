import { GizmoHelper, GizmoViewcube, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { type DirectionalLight, Object3D, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { cn } from "./utils";

export type AssemblyViewerProps = {
  children?: ReactNode;
  mode?: "dark" | "light";
  /** Orientation cube in the top-right with click-to-snap views */
  viewCube?: boolean;
  /** When false, orbit/zoom/pan are disabled so page scroll passes through. */
  interactive?: boolean;
  className?: string;
};

/**
 * Canvas wrapper for assembly playback: neutral studio lighting, orbit
 * controls, and a transparent, resize-safe canvas. Colors follow the same
 * dark/light convention as ModelViewer in @carbon/react.
 */
export function AssemblyViewer({
  children,
  mode = "dark",
  viewCube = true,
  interactive = true,
  className
}: AssemblyViewerProps) {
  const isDarkMode = mode === "dark";

  return (
    <div
      className={cn(
        "relative h-full w-full",
        isDarkMode ? "bg-[#141619]" : "bg-white",
        className
      )}
    >
      <Canvas
        // Logarithmic depth buffer: distributes depth precision across a huge
        // CAD scale range (metre-scale body, mm-scale parts) so coplanar faces
        // don't z-fight into shimmering seams.
        gl={{ antialias: true, alpha: true, logarithmicDepthBuffer: true }}
        // Cap the render resolution: a 3x-retina panel otherwise renders ~9x the
        // pixels, which is the main fill-rate cost when orbiting a dense model.
        // 2x keeps edges crisp without paying for the top DPR tier.
        dpr={[1, 2]}
        // CAD-style home view: models are Z-up with -Y as front, so +Z is
        // screen-up (bottom faces down) and the (+X, -Y, +Z) octant shows the
        // front, right, and top faces
        camera={{
          position: [100, -100, 100],
          up: [0, 0, 1],
          fov: 45,
          near: 0.1,
          far: 100000
        }}
        resize={{ debounce: 0 }}
        // Explicit CSS background on the canvas element: with alpha:true the
        // canvas layer is otherwise transparent, and Chrome's recomposite
        // during page unload/reload flashes such layers white in dark mode.
        style={{
          position: "absolute",
          inset: 0,
          background: isDarkMode ? "#141619" : "#ffffff"
        }}
      >
        <ambientLight intensity={isDarkMode ? 0.6 : 0.8} />
        <hemisphereLight
          color={0xffffff}
          groundColor={isDarkMode ? 0x202329 : 0xd4d4d8}
          intensity={0.5}
        />
        {/* CAD-style headlamp: the key light follows the camera so the facing
            side is always lit (static world-space lights leave the model's far
            side dark once you orbit around). See HeadLight below. */}
        <HeadLight intensity={1.6} />
        {/* Weak static back fill so silhouettes keep a rim of depth. */}
        <directionalLight position={[-1, 0.5, -1]} intensity={0.4} />
        <OrbitControls
          makeDefault
          enabled={interactive}
          enableDamping
          dampingFactor={0.1}
          // OrbitControls' own dolly snaps (it resets `scale` every frame), so we
          // drive the zoom ourselves for glide — see ZoomInertia below.
          enableZoom={false}
        />
        <ZoomInertia enabled={interactive} />
        {viewCube && (
          // GizmoHelper animates the default OrbitControls on face clicks
          <GizmoHelper alignment="top-right" margin={[56, 56]}>
            <GizmoViewcube
              // Converted models keep raw CAD coordinates (Z-up, like
              // Onshape/STEP), so label the axes with CAD semantics instead of
              // drei's Y-up default. Order is [+X, -X, +Y, -Y, +Z, -Z].
              faces={["Right", "Left", "Back", "Front", "Top", "Bottom"]}
              color={isDarkMode ? "#2a2d33" : "#e4e4e7"}
              hoverColor={isDarkMode ? "#3f4450" : "#cbd5e1"}
              textColor={isDarkMode ? "#e4e4e7" : "#27272a"}
              strokeColor={isDarkMode ? "#71757d" : "#71717a"}
              opacity={1}
            />
          </GizmoHelper>
        )}
        {children}
      </Canvas>
    </div>
  );
}

/**
 * Camera-following key light (CAD headlamp). Repositioned every frame at the
 * camera, offset toward the camera's up+right so the lighting keeps some
 * directionality (a light exactly on the view axis flattens all shading), and
 * aimed at the orbit target so the lit side is always the one facing the user.
 */
function HeadLight({ intensity }: { intensity: number }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls
  ) as unknown as OrbitControlsImpl | null;
  const light = useRef<DirectionalLight>(null);
  // The directional light aims at a target object, which must live in the
  // scene graph for its matrix to update — see the <primitive> below.
  const target = useMemo(() => new Object3D(), []);
  const up = useRef(new Vector3());
  const right = useRef(new Vector3());

  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const anchor = controls?.target ?? target.position;
    const dist = Math.max(camera.position.distanceTo(anchor), 1);
    up.current.set(0, 1, 0).applyQuaternion(camera.quaternion);
    right.current.set(1, 0, 0).applyQuaternion(camera.quaternion);
    l.position
      .copy(camera.position)
      .addScaledVector(up.current, dist * 0.35)
      .addScaledVector(right.current, dist * 0.35);
    if (controls) target.position.copy(controls.target);
    target.updateMatrixWorld();
  });

  return (
    <>
      <directionalLight ref={light} target={target} intensity={intensity} />
      <primitive object={target} />
    </>
  );
}

// Wheel → zoom impulse (accumulated into velocity). Larger = zoom reaches further
// per notch.
const ZOOM_SENSITIVITY = 0.00016;
// Per-frame velocity decay. Higher = longer glide / more inertia (0.9 ≈ ~0.4s,
// 0.92 ≈ ~0.6s of coast).
const ZOOM_FRICTION = 0.92;
const ZOOM_EPSILON = 1e-4;

/**
 * Inertial dolly. `OrbitControls` applies its wheel zoom instantly (it zeroes the
 * dolly `scale` every `update()`), so with its own zoom disabled we accumulate a
 * velocity from the wheel and ease the camera in/out over subsequent frames — the
 * zoom coasts to a stop instead of stepping. Zooms toward the orbit target,
 * clamped to the controls' min/max distance.
 */
function ZoomInertia({ enabled }: { enabled: boolean }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls
  ) as unknown as OrbitControlsImpl | null;
  const gl = useThree((state) => state.gl);
  const velocity = useRef(0);

  useEffect(() => {
    if (!enabled) {
      velocity.current = 0;
      return;
    }
    const el = gl.domElement;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      velocity.current += event.deltaY * ZOOM_SENSITIVITY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [enabled, gl]);

  const offset = useRef(new Vector3());
  useFrame(() => {
    if (!controls || Math.abs(velocity.current) < ZOOM_EPSILON) return;
    const dist = offset.current
      .subVectors(camera.position, controls.target)
      .length();
    if (dist === 0) {
      velocity.current = 0;
      return;
    }
    const min = controls.minDistance || 0.001;
    const max = controls.maxDistance || Number.POSITIVE_INFINITY;
    const next = Math.min(
      Math.max(dist * Math.exp(velocity.current), min),
      max
    );
    camera.position
      .copy(controls.target)
      .addScaledVector(offset.current.divideScalar(dist), next);
    controls.update();
    velocity.current *= ZOOM_FRICTION;
  });

  return null;
}
