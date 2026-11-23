// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getViewportForBounds, type Viewport } from "@xyflow/react";
import {
  BOX_HEADER_HEIGHT,
  BOX_PADDING,
  CARD_GAP,
  CARD_HEIGHT,
  type TreeBox
} from "./tree-layout";

/** The smallest zoom a user can reach by hand. */
export const TREE_MIN_ZOOM = 0.1;
/** The largest zoom a fit may choose: a fit never enlarges past 100 %. */
export const TREE_FIT_MAX_ZOOM = 1;
/** Below this zoom a card cannot be read, so the fit shows the top of the tree instead. */
export const TREE_READABLE_ZOOM = 0.5;
export const TREE_FIT_PADDING = 0.15;
/** The cards of the top box a fallback fit shows. */
const FOCUS_CARDS = 6;

type Rect = { x: number; y: number; width: number; height: number };

function boundsOf(boxes: TreeBox[]): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The viewport that fits the Tree layout in a container of `width` ×
 * `height` pixels. The boxes hold every card and carry their own size, so
 * the fit needs no measured node. If the whole tree only fits below
 * `TREE_READABLE_ZOOM`, it fits the top box and its first cards instead, so
 * the first paint is readable rather than a speck. Returns null while the
 * container has no size or the tree has no box.
 */
export function treeViewport(
  boxes: TreeBox[],
  width: number,
  height: number
): Viewport | null {
  if (width <= 0 || height <= 0 || boxes.length === 0) return null;

  const fit = (rect: Rect) =>
    getViewportForBounds(
      rect,
      width,
      height,
      TREE_MIN_ZOOM,
      TREE_FIT_MAX_ZOOM,
      TREE_FIT_PADDING
    );

  const whole = fit(boundsOf(boxes));
  if (whole.zoom >= TREE_READABLE_ZOOM) return whole;

  const top = boxes[0];
  const focusHeight =
    BOX_HEADER_HEIGHT +
    2 * BOX_PADDING +
    FOCUS_CARDS * CARD_HEIGHT +
    (FOCUS_CARDS - 1) * CARD_GAP;
  return fit({
    x: top.x,
    y: top.y,
    width: top.width,
    height: Math.min(top.height, focusHeight)
  });
}
