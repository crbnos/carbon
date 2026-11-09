// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

/** Resizes a pane from a splitter. The handle needs `touch-none`. */
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
    pointerId: number;
    startY: number;
    startHeight: number;
    height: number;
    moved: boolean;
  } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const end = (save: boolean) => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    setIsResizing(false);
    if (!state.moved) return;
    const final = save ? clamp(state.height) : state.startHeight;
    if (paneRef.current) paneRef.current.style.height = `${final}px`;
    if (save) onCommit(final);
  };
  const endRef = useRef(end);
  endRef.current = end;

  useEffect(() => {
    if (!enabled) endRef.current(true);
  }, [enabled]);

  const handleProps = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: height,
        height,
        moved: false
      };
      setIsResizing(true);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const state = drag.current;
      const pane = paneRef.current;
      if (!state || !pane || event.pointerId !== state.pointerId) return;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        end(true);
        return;
      }
      if (!state.moved) {
        state.moved = true;
        onStart?.();
      }
      state.height = clamp(state.startHeight + event.clientY - state.startY);
      pane.style.height = `${state.height}px`;
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerId === drag.current?.pointerId) end(true);
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerId === drag.current?.pointerId) end(false);
    }
  };

  return { paneRef, isResizing, handleProps };
}
