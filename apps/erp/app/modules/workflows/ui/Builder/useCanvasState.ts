import type { Viewport } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import type { WorkflowCanvasState } from "../../workflows.models";

const DEBOUNCE_MS = 800;

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/** Fitting a two-node workflow would otherwise blow the cards up to 200%. Centre it,
 * but never zoom past life size. */
export const FIT_VIEW_OPTIONS = { maxZoom: DEFAULT_VIEWPORT.zoom };

/** Remembers where the canvas was left — viewport and pan/select mode — on the
 * workflow row. Writes are debounced; a wheel-zoom fires `onMoveEnd` per tick. */
export function useCanvasState({
  workflowId,
  initial,
  canPersist
}: {
  workflowId: string;
  initial: WorkflowCanvasState | null;
  canPersist: boolean;
}) {
  const { submit } = useFetcher<{ ok?: boolean }>();
  const [panOnScroll, setPanOnScroll] = useState(initial?.panOnScroll ?? true);

  // Refs, not state: a viewport change must not re-render the canvas, and the
  // debounced write reads both values long after the event that scheduled it.
  const viewport = useRef<Viewport>(
    initial
      ? { x: initial.x, y: initial.y, zoom: initial.zoom }
      : DEFAULT_VIEWPORT
  );
  const panOnScrollRef = useRef(panOnScroll);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(() => {
    if (!canPersist) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const formData = new FormData();
      formData.append("x", String(viewport.current.x));
      formData.append("y", String(viewport.current.y));
      formData.append("zoom", String(viewport.current.zoom));
      if (panOnScrollRef.current) formData.append("panOnScroll", "on");

      submit(formData, {
        method: "post",
        action: path.to.workflowCanvas(workflowId)
      });
    }, DEBOUNCE_MS);
  }, [canPersist, submit, workflowId]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const onMoveEnd = useCallback(
    (_event: unknown, next: Viewport) => {
      viewport.current = next;
      save();
    },
    [save]
  );

  const togglePanOnScroll = useCallback(() => {
    const next = !panOnScrollRef.current;
    panOnScrollRef.current = next;
    setPanOnScroll(next);
    save();
  }, [save]);

  return {
    panOnScroll,
    togglePanOnScroll,
    onMoveEnd,
    /** Null when nothing was stored, so the canvas falls back to fit-view. */
    initialViewport: initial
      ? { x: initial.x, y: initial.y, zoom: initial.zoom }
      : null
  };
}
