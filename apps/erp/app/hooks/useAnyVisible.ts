// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type RefObject, useEffect, useState } from "react";

type UseAnyVisibleOptions = {
  /** Container whose descendants are queried. */
  containerRef: RefObject<HTMLElement | null>;
  /** CSS selector for elements to observe. */
  selector: string;
  /** Skip observing entirely. Hook returns `false`. */
  enabled?: boolean;
  /** IntersectionObserver threshold. */
  threshold?: number | number[];
  /** Re-query the DOM when these change (e.g. list contents). */
  deps?: ReadonlyArray<unknown>;
};

/**
 * Returns `true` when at least one element matching `selector` inside
 * `containerRef` is intersecting the viewport.
 *
 * Returns `false` when disabled, when the container is missing, or when no
 * matched elements exist.
 */
export function useAnyVisible({
  containerRef,
  selector,
  enabled = true,
  threshold = 0.1,
  deps = []
}: UseAnyVisibleOptions): boolean {
  const [anyVisible, setAnyVisible] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setAnyVisible(false);
      return;
    }
    const root = containerRef.current;
    if (!root) return;

    const targets = root.querySelectorAll<HTMLElement>(selector);
    if (targets.length === 0) {
      setAnyVisible(false);
      return;
    }

    const visible = new Set<Element>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        setAnyVisible(visible.size > 0);
      },
      { threshold }
    );
    targets.forEach((t) => {
      obs.observe(t);
    });
    return () => obs.disconnect();
  }, [enabled, selector, threshold, containerRef, ...deps]);

  return anyVisible;
}
