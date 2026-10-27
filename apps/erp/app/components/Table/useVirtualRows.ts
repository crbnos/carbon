// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Range, VirtualItem } from "@tanstack/react-virtual";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { Key, ReactNode } from "react";
import { useCallback } from "react";

/** The rendered indexes plus `keep` when it is outside them, in order. */
export function withKeptIndex(
  indexes: number[],
  keep: number | undefined,
  count: number
): number[] {
  if (keep === undefined || keep < 0 || keep >= count) return indexes;
  if (indexes.includes(keep)) return indexes;
  return [...indexes, keep].sort((a, b) => a - b);
}

export type VirtualSlot =
  | { kind: "item"; index: number }
  | { kind: "spacer"; key: string; height: number };

/**
 * The items in view, with a spacer standing in for each run of items that is
 * not rendered, so the scroll height and every item's position stay true.
 * `margin` is where the first item starts in the scroll element (the
 * virtualizer's `scrollMargin`).
 */
export function getVirtualSlots(
  items: Pick<VirtualItem, "index" | "start" | "end">[],
  totalSize: number,
  margin: number
): VirtualSlot[] {
  const slots: VirtualSlot[] = [];
  let offset = 0;
  for (const item of items) {
    const start = item.start - margin;
    if (start > offset) {
      slots.push({
        kind: "spacer",
        key: `before-${item.index}`,
        height: start - offset
      });
    }
    slots.push({ kind: "item", index: item.index });
    offset = item.end - margin;
  }
  if (totalSize > offset) {
    slots.push({ kind: "spacer", key: "after", height: totalSize - offset });
  }
  return slots;
}

/**
 * Row virtualization for the Table, the phone list and the Grid: only the
 * rows in view (plus `overscan`) are in the DOM.
 *
 * `keepIndex` names one more index to keep rendered out of view (the row that
 * holds the keyboard focus, or the sticky group header above the view). Pass
 * a memoized function: a new one recomputes the range.
 */
export function useVirtualRows({
  count,
  getScrollElement,
  getItemKey,
  estimateSize,
  overscan,
  scrollMargin = 0,
  scrollPaddingStart,
  keepIndex,
  initialHeight,
  enabled = true
}: {
  count: number;
  getScrollElement: () => HTMLElement | null;
  getItemKey: (index: number) => Key;
  estimateSize: (index: number) => number;
  overscan: number;
  scrollMargin?: number;
  scrollPaddingStart?: number;
  keepIndex?: (range: Range) => number | undefined;
  /** The view height the server and the first render assume, before the
   *  scroll element is measured. Without it those renders draw no rows. */
  initialHeight: number;
  enabled?: boolean;
}) {
  const rangeExtractor = useCallback(
    (range: Range) =>
      withKeptIndex(
        defaultRangeExtractor(range),
        keepIndex?.(range),
        range.count
      ),
    [keepIndex]
  );

  const virtualizer = useVirtualizer({
    enabled,
    count,
    getScrollElement,
    getItemKey,
    estimateSize,
    overscan,
    scrollMargin,
    scrollPaddingStart,
    rangeExtractor,
    initialRect: { width: 0, height: initialHeight }
  });

  const renderRows = (
    renderItem: (index: number) => ReactNode,
    renderSpacer: (key: string, height: number) => ReactNode
  ): ReactNode[] =>
    getVirtualSlots(
      virtualizer.getVirtualItems(),
      virtualizer.getTotalSize(),
      scrollMargin
    ).map((slot) =>
      slot.kind === "item"
        ? renderItem(slot.index)
        : renderSpacer(slot.key, slot.height)
    );

  return { virtualizer, renderRows };
}
