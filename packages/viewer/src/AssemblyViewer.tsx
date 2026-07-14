import { GizmoHelper, GizmoViewcube, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type { ReactNode } from "react";
import { cn } from "./utils";

export type AssemblyViewerProps = {
  children?: ReactNode;
  mode?: "dark" | "light";
  /** Orientation cube in the top-right with click-to-snap views */
  viewCube?: boolean;
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
        gl={{ antialias: true, alpha: true }}
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
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
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
