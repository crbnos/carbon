import { useEffect, useMemo, useRef, useState } from "react";
import type { LineageEdge, LineagePayload } from "../utils";
import type { LayoutDirection, LayoutResult } from "./core";
import { TracingGraphManager } from "./TracingGraphManager";

export function useTracingGraphManager(): TracingGraphManager {
  const ref = useRef<TracingGraphManager | null>(null);
  if (!ref.current) ref.current = new TracingGraphManager();

  useEffect(() => {
    const mgr = ref.current;
    mgr?.init();
    return () => mgr?.dispose();
  }, []);

  return ref.current;
}

export function useAsyncLayout(
  manager: TracingGraphManager,
  payload: LineagePayload,
  direction: LayoutDirection,
  spacing: number,
  rejectIds: Set<string>,
  layoutVersion: number
): LayoutResult | null {
  const [result, setResult] = useState<LayoutResult | null>(null);
  const rejectIdsArray = useMemo(() => Array.from(rejectIds), [rejectIds]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutVersion is a manual relayout trigger
  useEffect(() => {
    let cancelled = false;
    manager
      .layout({ payload, direction, spacing, rejectIds: rejectIdsArray })
      .then((r) => {
        if (cancelled || r === null) return;
        setResult(r);
      });
    return () => {
      cancelled = true;
    };
  }, [manager, payload, direction, spacing, rejectIdsArray, layoutVersion]);

  return result;
}

export type SelectionPath = {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
};

export function useAsyncSelectionPath(
  manager: TracingGraphManager,
  edges: LineageEdge[],
  selectedIds: string[]
): SelectionPath | null {
  const [path, setPath] = useState<SelectionPath | null>(null);

  useEffect(() => {
    if (selectedIds.length === 0) {
      setPath(null);
      return;
    }
    let cancelled = false;
    manager.selection(edges, selectedIds).then((r) => {
      if (cancelled || r === null) return;
      setPath({
        nodeIds: new Set(r.pathNodeIds),
        edgeIds: new Set(r.pathEdgeIds)
      });
    });
    return () => {
      cancelled = true;
    };
  }, [manager, edges, selectedIds]);

  return path;
}
