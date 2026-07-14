import { useEffect, useMemo, useState } from "react";
import type { Group, Object3D } from "three";
import { GLTFLoader, MeshoptDecoder } from "three-stdlib";
import type { AssemblyGraph } from "./types";

export type UseAssemblyResult = {
  /** Root group of the loaded GLB, or null while loading */
  scene: Group | null;
  /** Stable nodeId (glTF extras.nodeId) → Object3D */
  nodesById: Map<string, Object3D>;
  /** Parsed graph.json, or null while loading / when no graphUrl given */
  graph: AssemblyGraph | null;
  isLoading: boolean;
  error: Error | null;
};

/**
 * Loads a meshopt-compressed GLB (EXT_meshopt_compression) plus its
 * graph.json and indexes scene nodes by their stable nodeId (written into
 * glTF node extras by the geometry service, surfaced as `userData.nodeId`).
 *
 * Plain three.js — no react-three-fiber dependency — so it can also back
 * non-R3F consumers.
 */
export function useAssembly(
  glbUrl: string | null,
  graphUrl: string | null
): UseAssemblyResult {
  const [scene, setScene] = useState<Group | null>(null);
  const [graph, setGraph] = useState<AssemblyGraph | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(glbUrl));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!glbUrl) {
      setScene(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setScene(null);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(
      // three-stdlib exports MeshoptDecoder as a factory in some versions
      typeof MeshoptDecoder === "function" ? MeshoptDecoder() : MeshoptDecoder
    );

    let loadedScene: Group | null = null;
    loader.load(
      glbUrl,
      (gltf) => {
        if (cancelled) {
          disposeObject(gltf.scene);
          return;
        }
        loadedScene = gltf.scene;
        setScene(gltf.scene);
        setIsLoading(false);
      },
      undefined,
      (event) => {
        if (cancelled) return;
        setError(
          event instanceof Error
            ? event
            : new Error(`Failed to load model: ${glbUrl}`)
        );
        setIsLoading(false);
      }
    );

    return () => {
      cancelled = true;
      if (loadedScene) disposeObject(loadedScene);
    };
  }, [glbUrl]);

  useEffect(() => {
    if (!graphUrl) {
      setGraph(null);
      return;
    }

    let cancelled = false;
    fetch(graphUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load assembly graph (${response.status})`);
        }
        return response.json() as Promise<AssemblyGraph>;
      })
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch((fetchError: Error) => {
        if (!cancelled) setError(fetchError);
      });

    return () => {
      cancelled = true;
    };
  }, [graphUrl]);

  const nodesById = useMemo(() => {
    const map = new Map<string, Object3D>();
    if (scene) {
      scene.traverse((object) => {
        const nodeId = object.userData?.nodeId;
        if (typeof nodeId === "string" && nodeId.length > 0) {
          map.set(nodeId, object);
        }
      });
    }
    return map;
  }, [scene]);

  return { scene, nodesById, graph, isLoading, error };
}

function disposeObject(root: Object3D) {
  root.traverse((object) => {
    const mesh = object as {
      geometry?: { dispose: () => void };
      material?: { dispose: () => void } | { dispose: () => void }[];
    };
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material.dispose();
    } else {
      mesh.material?.dispose();
    }
  });
}
