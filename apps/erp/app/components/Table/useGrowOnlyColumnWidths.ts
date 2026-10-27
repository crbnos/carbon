// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RefObject } from "react";
import { useEffect, useState } from "react";

type Widths = { key: string; widths: Map<string, number> };

const NONE = new Map<string, number>();

/** `widths` raised to every larger measured width, or null when none grew. */
export function growWidths(
  widths: ReadonlyMap<string, number>,
  measured: Iterable<readonly [string, number]>
): Map<string, number> | null {
  let next: Map<string, number> | null = null;
  for (const [id, width] of measured) {
    const current = (next ?? widths).get(id);
    if (current === undefined || width > current) {
      next ??= new Map(widths);
      next.set(id, width);
    }
  }
  return next;
}

/**
 * The widest each header cell (`th[data-column-id]`) has been, for its
 * `min-width`. Only the rows in view are rendered, so table layout would
 * narrow a column again each time its widest cell scrolls out. Holding the
 * widest width stops that; a column still widens once when a wider cell first
 * shows. The table keeps its normal layout, so a column always fits its
 * content. The widths start over on a new `resetKey` (the list, the column
 * set) and when the scroll container changes width.
 */
export function useGrowOnlyColumnWidths({
  tableRef,
  containerRef,
  resetKey,
  enabled
}: {
  tableRef: RefObject<HTMLTableElement | null>;
  containerRef: RefObject<HTMLElement | null>;
  resetKey: string;
  enabled: boolean;
}): ReadonlyMap<string, number> {
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() =>
      setContainerWidth(container.clientWidth)
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [enabled, containerRef]);

  const key = `${resetKey}|${containerWidth}`;
  const [state, setState] = useState<Widths>({ key, widths: NONE });

  useEffect(() => {
    const table = tableRef.current;
    if (!enabled || !table || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries.map((entry) => {
        const cell = entry.target as HTMLElement;
        return [
          cell.dataset.columnId!,
          Math.ceil(cell.getBoundingClientRect().width)
        ] as const;
      });
      setState((previous) => {
        const widths = previous.key === key ? previous.widths : NONE;
        const grown = growWidths(widths, measured);
        if (grown) return { key, widths: grown };
        return previous.key === key ? previous : { key, widths };
      });
    });
    for (const cell of table.querySelectorAll<HTMLElement>(
      "thead th[data-column-id]"
    )) {
      observer.observe(cell);
    }
    return () => observer.disconnect();
  }, [enabled, tableRef, key]);

  return enabled && state.key === key ? state.widths : NONE;
}
