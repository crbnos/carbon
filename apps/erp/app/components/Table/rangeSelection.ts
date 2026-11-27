// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback, useRef } from "react";

/**
 * The ids from the anchor to the clicked id, inclusive, in `ids` order.
 * Null when there is no anchor or either id is not in `ids` (not visible).
 */
export function rangeBetween(
  ids: readonly string[],
  anchorId: string | null,
  clickedId: string
): string[] | null {
  if (anchorId == null) return null;
  const anchorIndex = ids.indexOf(anchorId);
  const clickedIndex = ids.indexOf(clickedId);
  if (anchorIndex === -1 || clickedIndex === -1) return null;
  return ids.slice(
    Math.min(anchorIndex, clickedIndex),
    Math.max(anchorIndex, clickedIndex) + 1
  );
}

/**
 * Shift-click range selection for a checkbox list that keeps its own
 * selection state. One hook per selection area, so each has its own anchor.
 */
export function useRangeAnchor() {
  const anchorRef = useRef<string | null>(null);

  // A shift-click returns the range and keeps the anchor; any other click returns null and moves the anchor here.
  const rangeTo = useCallback(
    (ids: readonly string[], clickedId: string, shiftKey: boolean) => {
      const range = shiftKey
        ? rangeBetween(ids, anchorRef.current, clickedId)
        : null;
      if (!range) anchorRef.current = clickedId;
      return range;
    },
    []
  );

  const clearAnchor = useCallback(() => {
    anchorRef.current = null;
  }, []);

  return { rangeTo, clearAnchor };
}
