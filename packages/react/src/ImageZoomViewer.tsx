// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuX } from "react-icons/lu";
import { IconButton } from "./IconButton";
import { cn } from "./utils/cn";

const MIN_SCALE = 1;
const MAX_SCALE = 6;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * Fullscreen reference-image viewer, used by the MES and the ERP step slides. Pointer-events
 * based so the same code handles a mouse (wheel to zoom, drag to pan) and an iPad (two-finger
 * pinch to zoom, one-finger drag to pan). Double-tap toggles between fit and a 2.5× zoom.
 * Escape, the close button, or tapping the backdrop while at fit-scale dismisses it. It is a
 * portaled Radix dialog: it covers the viewport even under a transformed ancestor (a phone
 * bottom sheet, a sortable row), stacks above other dialogs (z-[80], over BottomSheet's
 * z-[70]), and an open sheet treats taps on it as inside, not as a dismiss.
 */
type Annotation = {
  id: string;
  x: number;
  y: number;
  label?: string | null;
  color?: string | null;
  toolId?: string | null;
};

export function ImageZoomViewer({
  open,
  src,
  caption,
  annotations = [],
  toolNameById,
  alt,
  onClose
}: {
  open: boolean;
  src: string | null;
  caption?: string | null;
  annotations?: Annotation[];
  toolNameById?: Map<string, string>;
  alt?: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  // Active pointers (id → screen position) + last pinch distance/midpoint for gesture math.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastDist = useRef<number | null>(null);
  const lastMid = useRef<{ x: number; y: number } | null>(null);
  const lastTapAt = useRef(0);

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
    pointers.current.clear();
    lastDist.current = null;
    lastMid.current = null;
  }, []);

  // Reset transform every time the viewer opens or the image changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open/src only
  useEffect(() => {
    if (open) reset();
  }, [open, src, reset]);

  if (!open || !src) return null;

  // Focal point in container-center coordinates (origin at the container's center, matching
  // the image's transform-origin), so zooming keeps the point under the cursor/fingers fixed.
  const toFocal = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clientX - (rect.left + rect.width / 2),
      y: clientY - (rect.top + rect.height / 2)
    };
  };

  // Zoom toward a focal point, anchoring it so it doesn't drift under the gesture. Each
  // setter is called once (no nested setState) so StrictMode's double-invoke is harmless.
  const zoomTo = (nextScaleRaw: number, focal: { x: number; y: number }) => {
    const next = clampScale(nextScaleRaw);
    if (next === 1) {
      setScale(1);
      setTx(0);
      setTy(0);
      return;
    }
    const ratio = next / scale;
    setScale(next);
    setTx((px) => focal.x - (focal.x - px) * ratio);
    setTy((py) => focal.y - (focal.y - py) * ratio);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomTo(
      scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15),
      toFocal(e.clientX, e.clientY)
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Double-tap / double-click to toggle zoom.
    const now = Date.now();
    if (pointers.current.size === 1) {
      if (now - lastTapAt.current < 300) {
        if (scale > 1) reset();
        else zoomTo(2.5, toFocal(e.clientX, e.clientY));
      }
      lastTapAt.current = now;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pts = [...pointers.current.values()];

    const [a, b] = pts;
    if (a && b) {
      // Pinch: scale by the change in finger distance, pan by the midpoint shift.
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midClient = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const mid = toFocal(midClient.x, midClient.y);
      if (lastDist.current != null && lastMid.current) {
        zoomTo((scale * dist) / lastDist.current, mid);
        setTx((px) => px + (mid.x - lastMid.current!.x));
        setTy((py) => py + (mid.y - lastMid.current!.y));
      }
      lastDist.current = dist;
      lastMid.current = mid;
      return;
    }

    // Single pointer: pan only when zoomed in.
    if (scale > 1) {
      setTx((px) => px + (e.clientX - prev.x));
      setTy((py) => py + (e.clientY - prev.y));
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    // Dropping below two pointers ends the active pinch — clear its anchors so the next
    // single-finger move doesn't jump.
    if (pointers.current.size < 2) {
      lastDist.current = null;
      lastMid.current = null;
    }
  };

  const altText = alt ?? t`Reference image`;

  return (
    <DialogPrimitive.Root
      open
      // Escape closes through here.
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[80] flex flex-col bg-black/90 backdrop-blur-sm outline-none"
          // Tapping the backdrop at fit-scale closes; while zoomed it's reserved for panning.
          onClick={(e) => {
            if (e.target === e.currentTarget && scale === 1) onClose();
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {caption || altText}
          </DialogPrimitive.Title>
          <div className="flex shrink-0 items-center justify-end p-3">
            <IconButton
              aria-label={t`Close`}
              variant="ghost"
              size="lg"
              className="text-white hover:bg-white/10 hover:text-white"
              icon={<LuX className="size-6" />}
              onClick={onClose}
            />
          </div>

          <div
            ref={containerRef}
            className="relative flex min-h-0 flex-1 select-none items-center justify-center overflow-hidden"
            style={{ touchAction: "none" }}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            {/* Image + pins share one transformed wrapper so annotations pan/zoom with the art. */}
            <div
              className={cn(
                "relative inline-flex max-h-full max-w-full will-change-transform",
                scale > 1 ? "cursor-grab" : "cursor-zoom-in"
              )}
              style={{
                transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                transformOrigin: "center center"
              }}
            >
              <img
                src={src}
                alt={altText}
                draggable={false}
                className="max-h-full max-w-full object-contain"
              />
              {annotations.map((pin, i) => {
                const toolName = pin.toolId
                  ? toolNameById?.get(pin.toolId)
                  : undefined;
                const title =
                  [`#${i + 1}`, toolName, pin.label]
                    .filter(Boolean)
                    .join(" · ") || undefined;
                return (
                  <span
                    key={pin.id}
                    className="pointer-events-none absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow-md"
                    style={{
                      left: `${pin.x * 100}%`,
                      top: `${pin.y * 100}%`,
                      backgroundColor: pin.color ?? "#ef4444"
                    }}
                    title={title}
                  >
                    {i + 1}
                  </span>
                );
              })}
            </div>
          </div>

          {caption ? (
            <p className="shrink-0 px-4 pb-4 pt-2 text-center text-sm text-white/80">
              {caption}
            </p>
          ) : (
            <p className="shrink-0 px-4 pb-4 pt-2 text-center text-xs text-white/40">
              {t`Pinch or scroll to zoom · drag to pan · double-tap to reset`}
            </p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
