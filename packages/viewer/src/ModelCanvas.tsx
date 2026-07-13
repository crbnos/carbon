import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import {
  Box3,
  type Material,
  type Mesh,
  type Object3D,
  PerspectiveCamera,
  Vector3
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { AssemblyViewer } from "./AssemblyViewer";
import { useAssembly } from "./useAssembly";
import { cn } from "./utils";

export type ModelCanvasProps = {
  /** URL of a meshopt-compressed GLB (the assembler's optimised / LOD artifact). */
  glbUrl: string | null;
  mode?: "dark" | "light";
  /** Orientation cube in the top-right (default true). */
  viewCube?: boolean;
  /** Fit the camera to the model's bounds once it loads (default true). */
  autoFrame?: boolean;
  /** Fired once the GLB has loaded and framed — the cross-fade trigger. */
  onLoaded?: () => void;
  className?: string;
};

/**
 * Standalone static GLB viewer — the reusable core behind the assembly player.
 * Loads a meshopt GLB (via `useAssembly`), frames it, and applies the CAD depth
 * fixes (near/far range + per-material polygon offset). No steps, motion, or
 * picking — just orbit + view. The interactive tier of the progressive
 * `ModelPreview`; also usable anywhere a single optimised model needs showing.
 */
export function ModelCanvas({
  glbUrl,
  mode = "dark",
  viewCube = true,
  autoFrame = true,
  onLoaded,
  className
}: ModelCanvasProps) {
  const { scene, isLoading, error } = useAssembly(glbUrl, null);

  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  useEffect(() => {
    if (scene) onLoadedRef.current?.();
  }, [scene]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <AssemblyViewer
        mode={mode}
        viewCube={viewCube}
        className="absolute inset-0"
      >
        {scene && <ModelScene scene={scene} autoFrame={autoFrame} />}
      </AssemblyViewer>
      {isLoading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg
            className="h-6 w-6 animate-spin text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            aria-label="Loading model"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <p className="text-sm text-destructive">{error.message}</p>
        </div>
      )}
    </div>
  );
}

function ModelScene({
  scene,
  autoFrame
}: {
  scene: Object3D;
  autoFrame: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls
  ) as unknown as OrbitControlsImpl | null;

  // Fit the perspective near/far planes to the model. A static 0.1 → 100000
  // range spends nearly all depth precision right in front of `near`, so
  // coplanar CAD faces z-fight into a moiré at model distance. Sizing the range
  // to the model diagonal keeps them stable (mirrors AssemblyPlayer).
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const box = new Box3().setFromObject(scene);
    if (box.isEmpty()) return;
    const diag = box.getSize(new Vector3()).length();
    if (!(diag > 0)) return;
    camera.near = Math.max(diag / 500, 0.01);
    camera.far = diag * 20;
    camera.updateProjectionMatrix();
  }, [camera, scene]);

  // Break coincident-face z-fighting: a multi-body STEP splits each solid into
  // its own mesh; a part seated flush on another shares its exact plane, so the
  // GPU can't pick a depth winner and the face tears. Give each distinct
  // material a unique polygon offset so one always wins at a coincidence.
  useEffect(() => {
    const tagged = new Set<Material>();
    let offset = -1;
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (!material || tagged.has(material)) continue;
        tagged.add(material);
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = offset;
        offset -= 1;
      }
    });
  }, [scene]);

  const frameBox = useCallback(
    (box: Box3) => {
      if (box.isEmpty() || !controls) return;
      const center = box.getCenter(new Vector3());
      const radius = box.getSize(new Vector3()).length() / 2;
      const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
      const distance = Math.max(
        (radius / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.4,
        radius * 2
      );
      const direction = camera.position
        .clone()
        .sub(controls.target)
        .normalize();
      // Front-top-right isometric (models are Z-up, -Y front).
      if (direction.lengthSq() === 0) direction.set(1, -1, 1).normalize();
      camera.position.copy(center).addScaledVector(direction, distance);
      controls.target.copy(center);
      controls.update();
    },
    [camera, controls]
  );

  // Frame once per loaded scene.
  const framedRef = useRef<Object3D | null>(null);
  useEffect(() => {
    if (!autoFrame || !controls || framedRef.current === scene) return;
    framedRef.current = scene;
    frameBox(new Box3().setFromObject(scene));
  }, [scene, controls, autoFrame, frameBox]);

  return <primitive object={scene} />;
}
