import { GizmoHelper, GizmoViewcube, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, useEffect, useRef } from "react";
import { Vector3 } from "three";
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
        style={{ position: "absolute", inset: 0 }}
      >
        <ambientLight intensity={isDarkMode ? 0.6 : 0.8} />
        <hemisphereLight
          color={0xffffff}
          groundColor={isDarkMode ? 0x202329 : 0xd4d4d8}
          intensity={0.5}
        />
        <directionalLight position={[1, 1, 1]} intensity={1.6} />
        <directionalLight position={[-1, 0.5, -1]} intensity={0.8} />
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
