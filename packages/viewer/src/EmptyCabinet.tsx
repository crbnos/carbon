// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useRef, useState } from "react";
import { cn } from "./utils";

type EmptyCabinetProps = {
  className?: string;
  width?: number;
  height?: number;
};

/**
 * A rendered filing cabinet whose bottom drawer slides open, empty — the
 * illustration on empty states. three.js is imported on mount, so a page that
 * shows one ships none of it in its own bundle; until it arrives (or when
 * WebGL is unavailable) the canvas simply stays transparent. Dragging turns
 * the cabinet; on touch only a sideways drag does, so a vertical swipe still
 * scrolls the page.
 */
export function EmptyCabinet({
  className,
  width = 152,
  height = 170
}: EmptyCabinetProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // At least 2× so the downsample antialiases the outlines on 1× screens.
    const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    let cancelled = false;
    let dispose: (() => void) | null = null;
    import("./empty-cabinet/scene")
      .then(({ playCabinet }) => {
        if (cancelled) return;
        dispose = playCabinet(canvas, {
          animate: !window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
        });
        if (dispose) setReady(true);
      })
      .catch(() => {
        // Decoration only: a failed chunk load leaves the canvas empty.
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [width, height]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ width, height }}
      className={cn(
        "transition-opacity duration-300 touch-pan-y",
        ready ? "opacity-100 cursor-grab active:cursor-grabbing" : "opacity-0",
        className
      )}
    />
  );
}
