// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { newBalloonId, newFeatureId } from "./autosave";
import {
  ANNOTATION_MIN_SIZE_PX,
  ANNOTATION_RESIZE_HANDLE_PX,
  cursorForSelectorResizeHandle,
  dragCursor,
  type HoverCursor,
  konvaContentFromStageRef,
  resizeHandleAt,
  resizeRectByHandle,
  SELECTOR_MIN_SIZE_PX,
  SELECTOR_RESIZE_HANDLE_PX,
  toPercent,
  topmostAt,
  zoomBoxFit
} from "./drawingGeometry";
import {
  type AnnotationRecord,
  balloonBesideSelector,
  type DragKind,
  type DragState,
  type FeatureRow,
  placeBalloonOnRows,
  type SelectorRect,
  type SelectorResizeHandle
} from "./editorModel";
import { useDrawingAnnotations } from "./useDrawingAnnotations";
import { useRegionSuggestion } from "./useRegionSuggestion";

type UseDrawingInteractionsArgs = {
  diagramId: string;
  /** False on a locked version or without update permission: a click still
   * selects, but no drag or resize starts. */
  canUpdate: boolean;
  pdfViewPage: number;
  pdfFile: File | null;
  pdfUrl: string;
  featureRows: FeatureRow[];
  setFeatureRows: Dispatch<SetStateAction<FeatureRow[]>>;
  anchorRects: SelectorRect[];
  setSelectorRects: Dispatch<SetStateAction<SelectorRect[]>>;
  zoomScale: number;
  setZoomScale: Dispatch<SetStateAction<number>>;
  containerWidth: number;
  overlayHeight: number;
  containerRef: RefObject<HTMLDivElement>;
  overlayRef: RefObject<HTMLDivElement>;
  /** The autosave's set of ids minted here and not saved yet. */
  unsavedIdsRef: MutableRefObject<Set<string>>;
};

type KonvaMouseEvent = {
  evt?: MouseEvent;
  target?: unknown;
  cancelBubble?: boolean;
  getTarget?: () => unknown;
};

/**
 * The drawing overlay's pointer handling: what a press selects, which drag
 * it starts (a new selector, a zoom box, a balloon move, a selector or
 * annotation resize), and what the release does with it.
 */
export function useDrawingInteractions({
  diagramId,
  canUpdate,
  pdfViewPage,
  pdfFile,
  pdfUrl,
  featureRows,
  setFeatureRows,
  anchorRects,
  setSelectorRects,
  zoomScale,
  setZoomScale,
  containerWidth,
  overlayHeight,
  containerRef,
  overlayRef,
  unsavedIdsRef
}: UseDrawingInteractionsArgs) {
  const [placing, setPlacing] = useState(false);
  const [placingAnnotation, setPlacingAnnotation] = useState(false);
  const [zoomBoxMode, setZoomBoxMode] = useState(false);
  const [placingFeatureId, setPlacingFeatureId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [dragKind, setDragKind] = useState<DragKind>(null);
  const stageRef = useRef<unknown>(null);
  const balloonDragRef = useRef<{
    balloonId: string;
    startX: number;
    startY: number;
  } | null>(null);
  const anchorResizeRef = useRef<{
    balloonAnchorId: string;
    handle: SelectorResizeHandle;
    startRect: Pick<SelectorRect, "x" | "y" | "width" | "height">;
  } | null>(null);
  const annotationResizeRef = useRef<{
    annotationId: string;
    handle: SelectorResizeHandle;
    startRect: Pick<
      AnnotationRecord,
      "x" | "y" | "width" | "height" | "pageNumber"
    >;
  } | null>(null);

  const [selectedAnnotationId, setSelectedAnnotationId] = useState<
    string | null
  >(null);
  const [selectedBalloonId, setSelectedBalloonId] = useState<string | null>(
    null
  );
  const [selectedSelectorId, setSelectedSelectorId] = useState<string | null>(
    null
  );
  const annotationsApi = useDrawingAnnotations({
    selectedAnnotationId,
    setSelectedAnnotationId
  });
  const {
    annotations,
    setAnnotations,
    setAnnotationDraft,
    setAnnotationFontSizeInput,
    setAnnotationEditDraft
  } = annotationsApi;
  const suggestFromRegion = useRegionSuggestion({
    diagramId,
    pdfFile,
    pdfUrl,
    renderedPageWidthPx: Math.max(1, containerWidth * zoomScale),
    setFeatureRows
  });

  useEffect(() => {
    setSelectedSelectorId((id) => {
      if (!id) return null;
      const sel = anchorRects.find((s) => s.id === id);
      if (!sel || sel.pageNumber !== pdfViewPage) return null;
      return id;
    });
    setSelectedBalloonId((bid) => {
      if (!bid) return null;
      const row = featureRows.find((r) => r.balloonId === bid);
      if (!row || row.pageNumber !== pdfViewPage) return null;
      return bid;
    });
    setSelectedAnnotationId((aid) => {
      if (!aid) return null;
      const ann = annotations.find((a) => a.id === aid);
      if (!ann || ann.pageNumber !== pdfViewPage) return null;
      return aid;
    });
  }, [pdfViewPage, anchorRects, featureRows, annotations]);

  const getRelativePosFromStage = useCallback(() => {
    const stage = stageRef.current as {
      getPointerPosition: () => { x: number; y: number } | null;
      width: () => number;
      height: () => number;
    } | null;
    const pos = stage?.getPointerPosition?.() ?? null;
    if (!pos || !stage) return { x: 0, y: 0 };
    const w = stage.width();
    const h = stage.height();
    return { x: toPercent(pos.x, w), y: toPercent(pos.y, h) };
  }, []);

  const persistAnnotationResize = useCallback(
    async (_annotation: AnnotationRecord) => {
      return;
    },
    []
  );

  const endDrag = useCallback(() => {
    setDragKind(null);
    setDrag(null);
  }, []);

  const finalizeDragAt = useCallback(
    (x: number, y: number) => {
      if (!drag || !dragKind) return;

      const rx = Math.min(drag.startX, x);
      const ry = Math.min(drag.startY, y);
      const rw = Math.abs(x - drag.startX);
      const rh = Math.abs(y - drag.startY);

      if (rw < 0.5 || rh < 0.5) {
        if (dragKind === "balloonMove") {
          balloonDragRef.current = null;
        }
        if (dragKind === "annotationResize") {
          annotationResizeRef.current = null;
        }
        if (dragKind === "anchorResize") {
          anchorResizeRef.current = null;
        }
        endDrag();
        return;
      }

      if (dragKind === "zoom") {
        const container = containerRef.current;
        const fit =
          container && overlayRef.current
            ? zoomBoxFit(
                { x: rx, y: ry, width: rw, height: rh },
                overlayRef.current.getBoundingClientRect(),
                container,
                zoomScale,
                overlayHeight
              )
            : null;
        if (fit) {
          setZoomScale(fit.zoom);
          requestAnimationFrame(() => {
            if (!containerRef.current) return;
            containerRef.current.scrollLeft =
              fit.centerX - containerRef.current.clientWidth / 2;
            containerRef.current.scrollTop =
              fit.centerY - containerRef.current.clientHeight / 2;
          });
        }
        endDrag();
        return;
      }

      if (dragKind === "annotation") {
        const clippedLocalHeight = Math.min(rh, 100 - ry);

        if (clippedLocalHeight < 0.5) {
          endDrag();
          return;
        }

        setAnnotationDraft({
          pageNumber: pdfViewPage,
          x: rx,
          y: ry,
          width: rw,
          height: clippedLocalHeight,
          text: "",
          fontSize: 12
        });
        setAnnotationFontSizeInput("12");
        endDrag();
        setPlacingAnnotation(false);
        return;
      }

      if (dragKind === "annotationResize" && annotationResizeRef.current) {
        const activeResize = annotationResizeRef.current;
        const resized = resizeRectByHandle(
          activeResize.startRect,
          activeResize.handle,
          x - drag.startX,
          y - drag.startY,
          ANNOTATION_MIN_SIZE_PX,
          { width: containerWidth * zoomScale, height: overlayHeight }
        );
        const resizedAnnotation = annotations.find(
          (item) => item.id === activeResize.annotationId
        );
        const finalAnnotation: AnnotationRecord = {
          id: activeResize.annotationId,
          pageNumber: activeResize.startRect.pageNumber,
          ...resized,
          text: resizedAnnotation?.text ?? "",
          fontSize: resizedAnnotation?.fontSize ?? 12
        };

        setAnnotations((prev) =>
          prev.map((a) =>
            a.id === activeResize.annotationId ? { ...a, ...resized } : a
          )
        );
        setAnnotationEditDraft((prev) =>
          prev && prev.id === activeResize.annotationId
            ? { ...prev, ...resized }
            : prev
        );
        annotationResizeRef.current = null;
        endDrag();
        void persistAnnotationResize(finalAnnotation);
        return;
      }

      if (dragKind === "anchor") {
        const pageNumber = pdfViewPage;
        const clippedLocalHeight = Math.min(rh, 100 - ry);

        if (clippedLocalHeight < 0.5) {
          endDrag();
          return;
        }

        const placingExistingFeatureId = placingFeatureId;
        const balloonId = newBalloonId();
        const featureId = newFeatureId();
        unsavedIdsRef.current.add(balloonId);
        if (!placingExistingFeatureId) unsavedIdsRef.current.add(featureId);
        const balloon = balloonBesideSelector(rx, ry, rw);

        setSelectorRects((prev) => [
          ...prev,
          {
            id: balloonId,
            pageNumber,
            x: rx,
            y: ry,
            width: rw,
            height: clippedLocalHeight,
            isNew: true,
            isDirty: false
          }
        ]);

        setFeatureRows((prev) => {
          const placed = placeBalloonOnRows(prev, {
            placingFeatureId: placingExistingFeatureId,
            featureId,
            balloonId,
            pageNumber,
            ...balloon
          });
          // The feature being placed was deleted meanwhile: a new one it is.
          if (placed.createdFeature) unsavedIdsRef.current.add(featureId);
          return placed.rows;
        });
        setPlacingFeatureId(null);

        // New selector rows only — skip AI when placing geometry on an existing table feature.
        if (!placingExistingFeatureId) {
          void suggestFromRegion(balloonId, {
            pageNumber,
            x: rx,
            y: ry,
            width: rw,
            height: clippedLocalHeight
          });
        }

        endDrag();
        setPlacing(false);
        return;
      }

      if (dragKind === "balloonMove") {
        balloonDragRef.current = null;
        endDrag();
        return;
      }

      if (dragKind === "anchorResize") {
        anchorResizeRef.current = null;
        endDrag();
        return;
      }

      endDrag();
    },
    [
      drag,
      pdfViewPage,
      dragKind,
      zoomScale,
      setZoomScale,
      overlayHeight,
      containerWidth,
      containerRef,
      overlayRef,
      annotations,
      persistAnnotationResize,
      placingFeatureId,
      unsavedIdsRef,
      setSelectorRects,
      setFeatureRows,
      suggestFromRegion,
      endDrag,
      setAnnotations,
      setAnnotationDraft,
      setAnnotationFontSizeInput,
      setAnnotationEditDraft
    ]
  );

  const getAnnotationResizeHandleAt = useCallback(
    (x: number, y: number) =>
      resizeHandleAt(
        annotations,
        pdfViewPage,
        x,
        y,
        ANNOTATION_RESIZE_HANDLE_PX,
        { width: containerWidth * zoomScale, height: overlayHeight }
      ),
    [annotations, pdfViewPage, overlayHeight, containerWidth, zoomScale]
  );

  const getSelectorResizeHandleAt = useCallback(
    (x: number, y: number) =>
      resizeHandleAt(
        anchorRects,
        pdfViewPage,
        x,
        y,
        SELECTOR_RESIZE_HANDLE_PX,
        { width: containerWidth * zoomScale, height: overlayHeight }
      ),
    [anchorRects, pdfViewPage, overlayHeight, containerWidth, zoomScale]
  );

  const startDrag = useCallback((kind: DragKind, x: number, y: number) => {
    setDragKind(kind);
    setDrag({ startX: x, startY: y, currentX: x, currentY: y });
  }, []);

  const handleStageMouseDown = useCallback(
    (e: unknown) => {
      const evt = (e as KonvaMouseEvent).evt;
      if (!evt) return;

      if (placing && canUpdate) {
        evt.preventDefault();
        const { x, y } = getRelativePosFromStage();
        startDrag("anchor", x, y);
        return;
      }

      if (placingAnnotation && canUpdate) {
        evt.preventDefault();
        const { x, y } = getRelativePosFromStage();
        startDrag("annotation", x, y);
        return;
      }

      if (zoomBoxMode) {
        evt.preventDefault();
        const { x, y } = getRelativePosFromStage();
        startDrag("zoom", x, y);
        return;
      }

      const { x, y } = getRelativePosFromStage();
      const annotationId =
        topmostAt(annotations, pdfViewPage, x, y)?.id ?? null;
      // A locked or view-only plan selects on a click but never drags.
      const annotationResize = canUpdate
        ? getAnnotationResizeHandleAt(x, y)
        : null;
      if (annotationResize) {
        const annotation = annotations.find(
          (a) => a.id === annotationResize.id
        );
        if (annotation) {
          setSelectedAnnotationId(annotation.id);
          setSelectedBalloonId(null);
          setSelectedSelectorId(null);
          annotationResizeRef.current = {
            annotationId: annotation.id,
            handle: annotationResize.handle,
            startRect: {
              x: annotation.x,
              y: annotation.y,
              width: annotation.width,
              height: annotation.height,
              pageNumber: annotation.pageNumber
            }
          };
          evt.preventDefault();
          startDrag("annotationResize", x, y);
          return;
        }
      }

      if (annotationId) {
        setSelectedAnnotationId(annotationId);
        setSelectedBalloonId(null);
        setSelectedSelectorId(null);
        return;
      }

      const anchorResize = canUpdate ? getSelectorResizeHandleAt(x, y) : null;
      if (anchorResize) {
        const anchor = anchorRects.find((s) => s.id === anchorResize.id);
        if (anchor) {
          const linkedBalloonId =
            featureRows.find((row) => row.balloonAnchorId === anchor.id)
              ?.balloonId ?? null;
          setSelectedSelectorId(anchor.id);
          setSelectedBalloonId(linkedBalloonId);
          setSelectedAnnotationId(null);
          anchorResizeRef.current = {
            balloonAnchorId: anchor.id,
            handle: anchorResize.handle,
            startRect: {
              x: anchor.x,
              y: anchor.y,
              width: anchor.width,
              height: anchor.height
            }
          };
          evt.preventDefault();
          startDrag("anchorResize", x, y);
          return;
        }
      }

      const balloonId =
        topmostAt(featureRows, pdfViewPage, x, y, (r) => !!r.balloonId)
          ?.balloonId ?? null;
      if (balloonId) {
        const linkedSelectorId =
          featureRows.find((row) => row.balloonId === balloonId)
            ?.balloonAnchorId ?? null;
        setSelectedBalloonId(balloonId);
        setSelectedAnnotationId(null);
        setSelectedSelectorId(linkedSelectorId);
        const dragged = featureRows.find((row) => row.balloonId === balloonId);
        if (dragged && canUpdate) {
          evt.preventDefault();
          balloonDragRef.current = {
            balloonId,
            startX: dragged.x,
            startY: dragged.y
          };
          startDrag("balloonMove", x, y);
        }
        return;
      }

      const balloonAnchorId =
        topmostAt(anchorRects, pdfViewPage, x, y)?.id ?? null;
      if (balloonAnchorId) {
        const linkedBalloonId =
          featureRows.find((row) => row.balloonAnchorId === balloonAnchorId)
            ?.balloonId ?? null;
        setSelectedSelectorId(balloonAnchorId);
        setSelectedAnnotationId(null);
        setSelectedBalloonId(linkedBalloonId);
        return;
      }

      setSelectedAnnotationId(null);
      setSelectedBalloonId(null);
      setSelectedSelectorId(null);
    },
    [
      placingAnnotation,
      placing,
      getRelativePosFromStage,
      zoomBoxMode,
      getAnnotationResizeHandleAt,
      getSelectorResizeHandleAt,
      startDrag,
      annotations,
      featureRows,
      anchorRects,
      pdfViewPage,
      canUpdate
    ]
  );

  const getHoverCursorAt = useCallback(
    (x: number, y: number): HoverCursor => {
      // Top-most visual priority: annotation -> balloon -> anchor.
      const annotationResize = canUpdate
        ? getAnnotationResizeHandleAt(x, y)
        : null;
      if (annotationResize) {
        return cursorForSelectorResizeHandle(annotationResize.handle);
      }

      if (topmostAt(annotations, pdfViewPage, x, y)) return "pointer";

      if (topmostAt(featureRows, pdfViewPage, x, y, (r) => !!r.balloonId)) {
        return "pointer";
      }

      const anchorResize = canUpdate ? getSelectorResizeHandleAt(x, y) : null;
      if (anchorResize) {
        return cursorForSelectorResizeHandle(anchorResize.handle);
      }

      if (topmostAt(anchorRects, pdfViewPage, x, y)) return "pointer";

      return "";
    },
    [
      annotations,
      featureRows,
      anchorRects,
      pdfViewPage,
      getAnnotationResizeHandleAt,
      getSelectorResizeHandleAt,
      canUpdate
    ]
  );

  const handleStageMouseMove = useCallback(
    (e: unknown) => {
      const evt = (e as KonvaMouseEvent).evt;
      if (!evt) return;

      const { x, y } = getRelativePosFromStage();

      const stageContent = konvaContentFromStageRef(stageRef);
      if (placing || placingAnnotation || zoomBoxMode || drag) {
        if (stageContent) {
          stageContent.style.cursor = dragCursor(
            dragKind,
            annotationResizeRef.current?.handle ?? null,
            anchorResizeRef.current?.handle ?? null
          );
        }
      } else if (stageContent) {
        stageContent.style.cursor = getHoverCursorAt(x, y);
      }

      if (dragKind === "balloonMove" && drag && balloonDragRef.current) {
        const activeDrag = balloonDragRef.current;
        const deltaX = x - drag.startX;
        const deltaY = y - drag.startY;
        setFeatureRows((prev) =>
          prev.map((row) => {
            if (row.balloonId !== activeDrag.balloonId) return row;
            const nextX = Math.max(
              0,
              Math.min(100 - row.width, activeDrag.startX + deltaX)
            );
            const nextY = Math.max(
              0,
              Math.min(100 - row.height, activeDrag.startY + deltaY)
            );
            return {
              ...row,
              x: nextX,
              y: nextY,
              geometryDirty: true
            };
          })
        );
      }

      if (
        dragKind === "annotationResize" &&
        drag &&
        annotationResizeRef.current
      ) {
        const activeResize = annotationResizeRef.current;
        const resized = resizeRectByHandle(
          activeResize.startRect,
          activeResize.handle,
          x - drag.startX,
          y - drag.startY,
          ANNOTATION_MIN_SIZE_PX,
          { width: containerWidth * zoomScale, height: overlayHeight }
        );

        setAnnotations((prev) =>
          prev.map((a) =>
            a.id === activeResize.annotationId ? { ...a, ...resized } : a
          )
        );
        setAnnotationEditDraft((prev) =>
          prev && prev.id === activeResize.annotationId
            ? { ...prev, ...resized }
            : prev
        );
      }

      if (dragKind === "anchorResize" && drag && anchorResizeRef.current) {
        const activeResize = anchorResizeRef.current;
        const resizedRect = resizeRectByHandle(
          activeResize.startRect,
          activeResize.handle,
          x - drag.startX,
          y - drag.startY,
          SELECTOR_MIN_SIZE_PX,
          { width: containerWidth * zoomScale, height: overlayHeight }
        );

        setSelectorRects((prev) =>
          prev.map((anchor) =>
            anchor.id !== activeResize.balloonAnchorId
              ? anchor
              : { ...anchor, ...resizedRect, isDirty: true }
          )
        );

        setFeatureRows((prev) =>
          prev.map((row) =>
            row.balloonAnchorId !== activeResize.balloonAnchorId
              ? row
              : {
                  ...row,
                  geometryDirty: true
                }
          )
        );
      }

      if (!drag) return;
      setDrag((d) => (d ? { ...d, currentX: x, currentY: y } : null));
    },
    [
      drag,
      dragKind,
      getRelativePosFromStage,
      getHoverCursorAt,
      placing,
      placingAnnotation,
      zoomBoxMode,
      overlayHeight,
      containerWidth,
      zoomScale,
      setFeatureRows,
      setSelectorRects,
      setAnnotations,
      setAnnotationEditDraft
    ]
  );

  const handleStageMouseUp = useCallback(
    (e: unknown) => {
      const evt = (e as { evt?: MouseEvent }).evt;
      if (!evt) return;

      if (!drag || !dragKind) return;

      const { x, y } = getRelativePosFromStage();
      finalizeDragAt(x, y);
    },
    [drag, dragKind, getRelativePosFromStage, finalizeDragAt]
  );

  /** The pointer left the drawing: drop any drag in progress. */
  const handleOverlayMouseLeave = useCallback(() => {
    if (drag) setDrag(null);
    if (dragKind) setDragKind(null);
    balloonDragRef.current = null;
    annotationResizeRef.current = null;
    anchorResizeRef.current = null;
    const el = konvaContentFromStageRef(stageRef);
    if (el) el.style.cursor = "";
  }, [drag, dragKind]);

  const togglePlacing = useCallback(() => {
    setPlacing((v) => {
      const next = !v;
      if (next) {
        setPlacingAnnotation(false);
        setZoomBoxMode(false);
        setPlacingFeatureId(null);
      }
      return next;
    });
  }, []);

  const toggleZoomBox = useCallback(() => {
    setZoomBoxMode((v) => {
      const next = !v;
      if (next) {
        setPlacing(false);
        setPlacingAnnotation(false);
      }
      return next;
    });
  }, []);

  /** Draw a selector for a characteristic the grid already has. */
  const startPlacingFeature = useCallback((featureId: string) => {
    setPlacingFeatureId(featureId);
    setPlacing(true);
    setPlacingAnnotation(false);
    setZoomBoxMode(false);
  }, []);

  const previewRect =
    drag &&
    dragKind !== "balloonMove" &&
    dragKind !== "anchorResize" &&
    dragKind !== "annotationResize"
      ? {
          x: Math.min(drag.startX, drag.currentX),
          y: Math.min(drag.startY, drag.currentY),
          width: Math.abs(drag.currentX - drag.startX),
          height: Math.abs(drag.currentY - drag.startY)
        }
      : null;

  return {
    stageRef,
    dragKind,
    previewRect,
    placing,
    placingAnnotation,
    zoomBoxMode,
    togglePlacing,
    toggleZoomBox,
    startPlacingFeature,
    ...annotationsApi,
    selectedAnnotationId,
    selectedBalloonId,
    selectedSelectorId,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    handleOverlayMouseLeave
  };
}
