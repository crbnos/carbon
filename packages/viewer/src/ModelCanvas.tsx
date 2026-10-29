// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useThree } from "@react-three/fiber";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { PmiLayer } from "./PmiLayer";
import {
  type PmiBounds,
  type PmiDisplayUnit,
  type PmiDocument,
  pmiItemBounds,
  pmiViewBounds,
  visibleItemIds
} from "./pmi";
import { useAssembly } from "./useAssembly";
import { cn } from "./utils";

/** From the model towards the camera, in the model's axes (Z up). */
export type ViewDirection = [number, number, number];

/** Model measurements in model-space units (CAD tessellations are mm). */
export type ModelMetrics = {
  dimensions: { x: number; y: number; z: number };
  /** Surface area (mm²), or null when skipped on a very large mesh. */
  surfaceArea: number | null;
  /** Enclosed volume (mm³), or null when skipped / mesh isn't closed. */
  volume: number | null;
};

/**
 * Turn the camera to a PMI item (face its annotation plane and fit it) or a
 * saved view (its direction and up, fitting its items). A new `seq` repeats
 * the request.
 */
export type PmiFocusRequest =
  | { kind: "item"; id: string; seq: number }
  | { kind: "view"; id: string; seq: number };

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
  /** Filled with a function that reads where the camera stands right now, as a
   *  direction from the model towards it. `null` until a model is on screen. */
  viewDirectionRef?: MutableRefObject<(() => ViewDirection) | null>;
  /** Fired once the GLB has loaded and framed — the cross-fade trigger. */
  onLoaded?: () => void;
  /** Fired once with the loaded model's measurements (bbox always; area/volume
   *  when the mesh is small enough to measure client-side). */
  onMetrics?: (metrics: ModelMetrics) => void;
  /** The model's PMI (`pmi.json`), drawn over the model when `pmiVisible`. */
  pmi?: PmiDocument | null;
  /** The PMI items to draw (default: all). */
  pmiVisibleIds?: Set<string>;
  /** The PMI item drawn blue and on top. */
  pmiSelectedId?: string | null;
  /** Show the PMI layer (default true). */
  pmiVisible?: boolean;
  /** Display unit of the PMI text labels (default mm). */
  pmiUnit?: PmiDisplayUnit;
  /** Fired when a PMI text label is clicked. */
  onPmiSelect?: (id: string) => void;
  /** Turn the camera to a PMI item or saved view (see `PmiFocusRequest`). */
  focusRequest?: PmiFocusRequest | null;
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
  viewDirectionRef,
  onLoaded,
  onMetrics,
  pmi = null,
  pmiVisibleIds,
  pmiSelectedId = null,
  pmiVisible = true,
  pmiUnit = "mm",
  onPmiSelect,
  focusRequest = null,
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
            viewDirectionRef={viewDirectionRef}
            pmi={pmi}
            pmiVisibleIds={pmiVisibleIds}
            pmiSelectedId={pmiSelectedId}
            pmiVisible={pmiVisible}
            pmiUnit={pmiUnit}
            onPmiSelect={onPmiSelect}
            focusRequest={focusRequest}
            mode={mode}
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

/** Models are Z-up; a saved PMI view may set another up, which reset undoes. */
const MODEL_UP = new Vector3(0, 0, 1);

/** A focused PMI item's box is grown to at least this share of the model's
 *  diagonal, so a tiny datum does not put the camera inside the near plane. */
const MIN_FOCUS_FRACTION = 0.15;

/** How much wider than its bounding sphere a focused PMI item is framed. */
const PMI_FOCUS_MARGIN = 1.6;

const toBox3 = (bounds: PmiBounds) =>
  new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max));

function ModelScene({
  scene,
  autoFrame,
  resetSignal,
  viewDirectionRef,
  pmi,
  pmiVisibleIds,
  pmiSelectedId,
  pmiVisible,
  pmiUnit,
  onPmiSelect,
  focusRequest,
  mode
}: {
  scene: Object3D;
  autoFrame: boolean;
  resetSignal: number;
  viewDirectionRef?: MutableRefObject<(() => ViewDirection) | null>;
  pmi: PmiDocument | null;
  pmiVisibleIds?: Set<string>;
  pmiSelectedId: string | null;
  pmiVisible: boolean;
  pmiUnit: PmiDisplayUnit;
  onPmiSelect?: (id: string) => void;
  focusRequest: PmiFocusRequest | null;
  mode: "dark" | "light";
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

  // `direction` (from the target towards the camera), `up` and `margin` are
  // for the PMI focus; without them the camera keeps where it looks from.
  const frameBox = useCallback(
    (
      box: Box3,
      aim?: { direction?: Vector3; up?: Vector3; margin?: number }
    ) => {
      if (box.isEmpty() || !controls) return;
      const center = box.getCenter(new Vector3());
      const radius = box.getSize(new Vector3()).length() / 2;
      const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
      // Fit the bounding sphere with a small margin. Lower factors zoom in more —
      // the sphere circumscribes the model, so a tight fit still leaves headroom.
      const distance = Math.max(
        (radius / Math.tan(((fov / 2) * Math.PI) / 180)) * (aim?.margin ?? 1.1),
        radius * 1.5
      );
      const direction =
        aim?.direction?.clone().normalize() ??
        camera.position.clone().sub(controls.target).normalize();
      // Front-top-right isometric (models are Z-up, -Y front).
      if (direction.lengthSq() === 0) direction.set(1, -1, 1).normalize();
      if (aim?.up) camera.up.copy(aim.up).normalize();
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
    // A saved PMI view may have turned the camera's up; reset stands it
    // upright again (a no-op otherwise).
    if (!camera.up.equals(MODEL_UP)) camera.up.copy(MODEL_UP);
    frameBox(new Box3().setFromObject(scene));
  }, [resetSignal, scene, frameBox, camera]);

  // Turn to a PMI item or saved view, once per request.
  const focusSeenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest || !pmi || !controls) return;
    if (focusRequest.seq === focusSeenRef.current) return;
    focusSeenRef.current = focusRequest.seq;
    const modelBox = new Box3().setFromObject(scene);

    if (focusRequest.kind === "view") {
      const view = pmi.views.find((v) => v.id === focusRequest.id);
      if (!view) return;
      const bounds = pmiViewBounds(pmi, view.id);
      frameBox(bounds ? toBox3(bounds) : modelBox, {
        // The view looks from the camera towards the model; the camera sits
        // on the other side.
        direction: new Vector3(...view.direction).negate(),
        up: new Vector3(...view.up)
      });
      return;
    }

    const item = pmi.items.find((i) => i.id === focusRequest.id);
    if (!item) return;
    const bounds = pmiItemBounds(pmi, item, true);
    if (!bounds) return;
    const box = toBox3(bounds);
    const minSize =
      modelBox.getSize(new Vector3()).length() * MIN_FOCUS_FRACTION;
    const size = box.getSize(new Vector3()).length();
    if (size < minSize) box.expandByScalar((minSize - size) / 2);

    let direction: Vector3 | undefined;
    let up = MODEL_UP;
    if (item.plane) {
      const normal = new Vector3(...item.plane.normal);
      if (normal.lengthSq() > 0) {
        // Face the plane from whichever side the camera is on now.
        const current = camera.position.clone().sub(controls.target);
        direction = normal.dot(current) < 0 ? normal.clone().negate() : normal;
        // Stand the annotation upright: the plane's own Y axis (normal × X)
        // is up, so its text reads left to right. Z-up would leave a plane
        // lying flat (normal ±Z) at whatever turn the camera happens to take.
        const planeUp = new Vector3()
          .crossVectors(
            new Vector3(...item.plane.normal),
            new Vector3(...item.plane.xDirection)
          )
          .normalize();
        if (planeUp.lengthSq() > 0) up = planeUp;
      }
    }
    // Wider than a model fit: the referenced faces sit at the box's edge.
    frameBox(box, { direction, up, margin: PMI_FOCUS_MARGIN });
  }, [focusRequest, pmi, controls, scene, camera, frameBox]);

  const allPmiIds = useMemo(
    () => (pmi ? visibleItemIds(pmi, null) : new Set<string>()),
    [pmi]
  );

  useEffect(() => {
    if (!viewDirectionRef || !controls) return;
    viewDirectionRef.current = () => {
      const direction = camera.position
        .clone()
        .sub(controls.target)
        .normalize();
      return [direction.x, direction.y, direction.z];
    };
    return () => {
      viewDirectionRef.current = null;
    };
  }, [viewDirectionRef, camera, controls]);

  return (
    <>
      <primitive object={scene} />
      {pmi && pmiVisible && (
        <PmiLayer
          doc={pmi}
          visibleIds={pmiVisibleIds ?? allPmiIds}
          selectedId={pmiSelectedId}
          mode={mode}
          unit={pmiUnit}
          onSelect={onPmiSelect}
        />
      )}
    </>
  );
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
