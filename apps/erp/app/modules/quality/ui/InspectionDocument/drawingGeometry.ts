// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Hit tests and resize arithmetic for the plan editor's drawing overlay. Every
// rectangle is in percent of the page on screen.

import { round } from "@carbon/utils";
import type { DragKind, PctRect, SelectorResizeHandle } from "./editorModel";

export const SELECTOR_RESIZE_HANDLE_PX = 10;
export const SELECTOR_MIN_SIZE_PX = 12;
export const ANNOTATION_RESIZE_HANDLE_PX = 10;
export const ANNOTATION_MIN_SIZE_PX = 12;

export type HoverCursor =
  | ""
  | "pointer"
  | "ew-resize"
  | "ns-resize"
  | "nwse-resize"
  | "nesw-resize";

type PagedRect = PctRect & { pageNumber: number };

export function toPercent(px: number, total: number) {
  return (px / total) * 100;
}

export function cursorForSelectorResizeHandle(
  handle: SelectorResizeHandle
): "ew-resize" | "ns-resize" | "nwse-resize" | "nesw-resize" | "pointer" {
  switch (handle) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    default:
      return "pointer";
  }
}

/**
 * Konva 9 does not apply the `cursor` prop to the DOM; Transformer only sets
 * `stage.content.style.cursor` manually. Use these helpers for hover/drag cursors.
 */
export function konvaContentFromStageRef(stageRef: {
  current: unknown;
}): HTMLElement | null {
  const st = stageRef.current as { content?: HTMLElement } | null | undefined;
  return st?.content ?? null;
}

export function rectContains(r: PctRect, x: number, y: number) {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

/** The last (top-most) rect on the page under the point that `accept` takes. */
export function topmostAt<T extends PagedRect>(
  rects: T[],
  pageNumber: number,
  x: number,
  y: number,
  accept: (rect: T) => boolean = () => true
): T | null {
  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const rect = rects[i];
    if (rect.pageNumber !== pageNumber) continue;
    if (rectContains(rect, x, y) && accept(rect)) return rect;
  }
  return null;
}

/**
 * The resize handle of the top-most rect on the page under the point: a
 * corner first, then an edge. `handlePx` is the grab distance on screen.
 */
export function resizeHandleAt<T extends PagedRect & { id: string }>(
  rects: T[],
  pageNumber: number,
  x: number,
  y: number,
  handlePx: number,
  stage: { width: number; height: number }
): { id: string; handle: SelectorResizeHandle } | null {
  const hPad = Math.max(0.5, (handlePx / Math.max(1, stage.width)) * 100);
  const vPad = Math.max(0.5, (handlePx / Math.max(1, stage.height)) * 100);

  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const s = rects[i];
    if (s.pageNumber !== pageNumber) continue;

    const left = s.x;
    const right = s.x + s.width;
    const top = s.y;
    const bottom = s.y + s.height;

    const nearLeft = Math.abs(x - left) <= hPad;
    const nearRight = Math.abs(x - right) <= hPad;
    const nearTop = Math.abs(y - top) <= vPad;
    const nearBottom = Math.abs(y - bottom) <= vPad;

    const withinXBand = x >= left - hPad && x <= right + hPad;
    const withinYBand = y >= top - vPad && y <= bottom + vPad;
    if (!withinXBand || !withinYBand) continue;

    if (nearTop && nearLeft) return { id: s.id, handle: "nw" };
    if (nearTop && nearRight) return { id: s.id, handle: "ne" };
    if (nearBottom && nearLeft) return { id: s.id, handle: "sw" };
    if (nearBottom && nearRight) return { id: s.id, handle: "se" };
    if (nearTop) return { id: s.id, handle: "n" };
    if (nearBottom) return { id: s.id, handle: "s" };
    if (nearLeft) return { id: s.id, handle: "w" };
    if (nearRight) return { id: s.id, handle: "e" };
  }

  return null;
}

/**
 * `start` dragged by its `handle` through (deltaX, deltaY), kept on the page
 * and no smaller than `minSizePx` on screen.
 */
export function resizeRectByHandle(
  start: PctRect,
  handle: SelectorResizeHandle,
  deltaX: number,
  deltaY: number,
  minSizePx: number,
  stage: { width: number; height: number }
): PctRect {
  const minWidthPct = Math.max(
    0.5,
    (minSizePx / Math.max(1, stage.width)) * 100
  );
  const minHeightPct = Math.max(
    0.5,
    (minSizePx / Math.max(1, stage.height)) * 100
  );
  let nextX = start.x;
  let nextY = start.y;
  let nextW = start.width;
  let nextH = start.height;

  if (handle.includes("e")) {
    nextW = Math.max(
      minWidthPct,
      Math.min(100 - start.x, start.width + deltaX)
    );
  }
  if (handle.includes("s")) {
    nextH = Math.max(
      minHeightPct,
      Math.min(100 - start.y, start.height + deltaY)
    );
  }
  if (handle.includes("w")) {
    const limitedX = Math.max(
      0,
      Math.min(start.x + start.width - minWidthPct, start.x + deltaX)
    );
    nextX = limitedX;
    nextW = start.width - (limitedX - start.x);
  }
  if (handle.includes("n")) {
    const limitedY = Math.max(
      0,
      Math.min(start.y + start.height - minHeightPct, start.y + deltaY)
    );
    nextY = limitedY;
    nextH = start.height - (limitedY - start.y);
  }

  return {
    x: Math.max(0, Math.min(100 - nextW, nextX)),
    y: Math.max(0, Math.min(100 - nextH, nextY)),
    width: nextW,
    height: nextH
  };
}

/** The cursor while a tool is armed or a drag is under way. */
export function dragCursor(
  dragKind: DragKind,
  annotationResizeHandle: SelectorResizeHandle | null,
  anchorResizeHandle: SelectorResizeHandle | null
): string {
  if (dragKind === "balloonMove") return "grabbing";
  if (dragKind === "annotationResize" && annotationResizeHandle) {
    return cursorForSelectorResizeHandle(annotationResizeHandle);
  }
  if (dragKind === "anchorResize" && anchorResizeHandle) {
    return cursorForSelectorResizeHandle(anchorResizeHandle);
  }
  return "";
}

/**
 * The zoom that fits a dragged zoom box (`box`, in percent of the overlay)
 * to the scroll container, between 50% and 300%, and the box's centre at
 * that zoom (pixels). Null when the box is under 8px on screen.
 */
export function zoomBoxFit(
  box: PctRect,
  overlayRect: { width: number; height: number },
  container: { clientWidth: number; clientHeight: number },
  zoomScale: number,
  overlayHeight: number
): { zoom: number; centerX: number; centerY: number } | null {
  const boxWidthPx = (box.width / 100) * overlayRect.width;
  const boxHeightPx = (box.height / 100) * overlayRect.height;
  if (boxWidthPx < 8 || boxHeightPx < 8) return null;
  const fitX = container.clientWidth / boxWidthPx;
  const fitY = container.clientHeight / boxHeightPx;
  const zoom = Math.max(
    0.5,
    Math.min(3, round(zoomScale * Math.min(fitX, fitY), 2))
  );
  const zoomRatio = zoom / zoomScale;
  const centerXPx = ((box.x + box.width / 2) / 100) * overlayRect.width;
  const centerYPx = ((box.y + box.height / 2) / 100) * overlayHeight;
  return {
    zoom,
    centerX: centerXPx * zoomRatio,
    centerY: centerYPx * zoomRatio
  };
}
