// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PointerEvent } from "react";
import { useRef, useState } from "react";

/**
 * Sets a pane's height from a drag on a splitter, by mouse, pen or finger.
 * Spread `handleProps` on the handle (which needs `touch-none`) and put
 * `paneRef` on the pane. A move writes the height straight to the pane, so it
 * never re-renders the page; `onCommit` gets the final height.
 */
export function usePaneResize<T extends HTMLElement = HTMLDivElement>({
  height,
  clamp,
  enabled = true,
  onStart,
  onCommit
}: {
  height: number;
  clamp: (height: number) => number;
  enabled?: boolean;
  onStart?: () => void;
  onCommit: (height: number) => void;
}) {
  const paneRef = useRef<T>(null);
  const drag = useRef<{
    startY: number;
    startHeight: number;
    height: number;
  } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const end = () => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    setIsResizing(false);
    onCommit(state.height);
  };

  const handleProps = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { startY: event.clientY, startHeight: height, height };
      setIsResizing(true);
      onStart?.();
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const state = drag.current;
      const pane = paneRef.current;
      if (!state || !pane) return;
      state.height = clamp(state.startHeight + event.clientY - state.startY);
      pane.style.height = `${state.height}px`;
    },
    onPointerUp: end,
    onPointerCancel: end
  };

  return { paneRef, isResizing, handleProps };
}
