import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuRotateCw } from "react-icons/lu";
import {
  Box3,
  type Mesh,
  type Object3D,
  PerspectiveCamera,
  Vector3
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { AssemblyViewer } from "./AssemblyViewer";
import { useAssembly } from "./useAssembly";
import { cn } from "./utils";

/** Model measurements in model-space units (CAD tessellations are mm). */
export type ModelMetrics = {
  dimensions: { x: number; y: number; z: number };
  /** Surface area (mm²), or null when skipped on a very large mesh. */
  surfaceArea: number | null;
  /** Enclosed volume (mm³), or null when skipped / mesh isn't closed. */
  volume: number | null;
};

export type ModelCanvasProps = {
  /** URL of a meshopt-compressed GLB (the assembler's optimised / LOD artifact). */
  glbUrl: string | null;
  /** Alternative source: an async factory producing a ready Object3D (the raw
   *  WASM fallback tier). Used when `glbUrl` is null; the factory lives in the
   *  caller's lazy chunk so this component stays lean. Re-created factory =
   *  reload (memoize it). */
  loadObject?: (() => Promise<Object3D>) | null;
  mode?: "dark" | "light";
  /** Orientation cube in the top-right (default true). */
  viewCube?: boolean;
  /** Fit the camera to the model's bounds once it loads (default true). */
  autoFrame?: boolean;
  /** Gate orbit/zoom/pan — false shows the model but passes scroll through. */
  interactive?: boolean;
  /** Bump this to re-frame the camera (the "reset view" action). */
  resetSignal?: number;
  /** Fired once the GLB has loaded and framed — the cross-fade trigger. */
  onLoaded?: () => void;
  /** Fired once with the loaded model's measurements (bbox always; area/volume
   *  when the mesh is small enough to measure client-side). */
  onMetrics?: (metrics: ModelMetrics) => void;
  className?: string;
};

// Above this triangle count, skip the O(n) area/volume sweep — it would jank the
// main thread. Dimensions (bbox) are always cheap. Exact mass properties should
// come from the assembler (OCCT) for big models.
const MAX_MEASURE_TRIS = 1_500_000;

/**
 * Standalone static GLB viewer — the reusable core behind the assembly player.
 * Loads a meshopt GLB (via `useAssembly`), frames it, applies the CAD depth
 * fixes (near/far range + per-material polygon offset), and reports the model's
 * measurements. No steps, motion, or picking — just orbit + view. The
 * interactive tier of the progressive `ModelPreview`; also usable anywhere a
 * single optimised model needs showing.
 */
export function ModelCanvas({
  glbUrl,
  loadObject = null,
  mode = "dark",
  viewCube = true,
  autoFrame = true,
  interactive = true,
  resetSignal = 0,
  onLoaded,
  onMetrics,
  className
}: ModelCanvasProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const assembly = useAssembly(glbUrl, null, reloadKey);
  const raw = useLoadedObject(glbUrl ? null : loadObject, reloadKey);
  const { scene, isLoading, error } = glbUrl ? assembly : raw;

  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;

  useEffect(() => {
    if (!scene) return;
    onLoadedRef.current?.();
    onMetricsRef.current?.(measureModel(scene));
  }, [scene]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <AssemblyViewer
        mode={mode}
        viewCube={viewCube}
        interactive={interactive}
        className="absolute inset-0"
      >
        {scene && (
          <ModelScene
            scene={scene}
            autoFrame={autoFrame}
            resetSignal={resetSignal}
          />
        )}
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="max-w-xs text-sm text-muted-foreground">
            Couldn't load the 3D model.
          </p>
          <button
            type="button"
            onClick={() => setReloadKey((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-md border border-border bg-popover px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-transform hover:bg-accent active:scale-[0.96]"
          >
            <LuRotateCw className="size-3.5" />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/** Drive an async Object3D factory with the same {scene,isLoading,error} shape
 *  `useAssembly` returns, so either source plugs into the same render path. */
function useLoadedObject(
  loadObject: (() => Promise<Object3D>) | null,
  reloadKey: number
): { scene: Object3D | null; isLoading: boolean; error: string | null } {
  const [state, setState] = useState<{
    scene: Object3D | null;
    isLoading: boolean;
    error: string | null;
  }>({ scene: null, isLoading: Boolean(loadObject), error: null });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey re-runs the load on retry without being read inside
  useEffect(() => {
    if (!loadObject) {
      setState({ scene: null, isLoading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ scene: null, isLoading: true, error: null });
    loadObject().then(
      (scene) => {
        if (!cancelled) setState({ scene, isLoading: false, error: null });
      },
      (e: unknown) => {
        if (!cancelled) {
          setState({
            scene: null,
            isLoading: false,
            error: e instanceof Error ? e.message : String(e)
          });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [loadObject, reloadKey]);

  return state;
}

function ModelScene({
  scene,
  autoFrame,
  resetSignal
}: {
  scene: Object3D;
  autoFrame: boolean;
  resetSignal: number;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls
  ) as unknown as OrbitControlsImpl | null;

  // Fit the perspective near/far planes to the model. A static 0.1 → 100000
  // range spends nearly all depth precision right in front of `near`, so
  // coplanar CAD faces z-fight into a moiré at model distance. Sizing the range
  // to the model diagonal keeps them stable.
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

  // Coincident-face z-fighting across the model's scale range is handled by the
  // renderer's logarithmic depth buffer (`logarithmicDepthBuffer` on the Canvas)
  // plus the near/far fit above.

  const frameBox = useCallback(
    (box: Box3) => {
      if (box.isEmpty() || !controls) return;
      const center = box.getCenter(new Vector3());
      const radius = box.getSize(new Vector3()).length() / 2;
      const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
      // Fit the bounding sphere with a small margin. Lower factors zoom in more —
      // the sphere circumscribes the model, so a tight fit still leaves headroom.
      const distance = Math.max(
        (radius / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.1,
        radius * 1.5
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

  // Re-frame on demand (the reset-view action). Skip the initial value so it
  // doesn't double-frame on mount.
  const resetSeenRef = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === resetSeenRef.current) return;
    resetSeenRef.current = resetSignal;
    frameBox(new Box3().setFromObject(scene));
  }, [resetSignal, scene, frameBox]);

  return <primitive object={scene} />;
}

/** Bounding-box dimensions (always) + surface area / volume (small meshes). */
function measureModel(scene: Object3D): ModelMetrics {
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const size = box.getSize(new Vector3());
  const dimensions = { x: size.x, y: size.y, z: size.z };

  let triangles = 0;
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry;
    triangles += geom.index
      ? geom.index.count / 3
      : (geom.attributes.position?.count ?? 0) / 3;
  });
  if (triangles === 0 || triangles > MAX_MEASURE_TRIS) {
    return { dimensions, surfaceArea: null, volume: null };
  }

  let area = 0;
  let volume = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const cross = new Vector3();
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.attributes.position;
    if (!pos) return;
    const idx = mesh.geometry.index;
    const mw = mesh.matrixWorld;
    const tri = (i0: number, i1: number, i2: number) => {
      a.fromBufferAttribute(pos, i0).applyMatrix4(mw);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mw);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mw);
      area += cross.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
      // Signed volume of the tetrahedron (origin, a, b, c); sums to the enclosed
      // volume for a closed mesh regardless of where the origin sits.
      volume += a.dot(ab.copy(b).cross(c)) / 6;
    };
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
    }
  });

  return { dimensions, surfaceArea: area, volume: Math.abs(volume) };
}
