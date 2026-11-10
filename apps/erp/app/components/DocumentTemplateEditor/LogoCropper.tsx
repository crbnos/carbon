// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LabelLogoBlock } from "@carbon/documents/template";
import {
  Button,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { round } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";

type Crop = NonNullable<LabelLogoBlock["crop"]>;

const FULL: Crop = { x: 0, y: 0, width: 1, height: 1, aspect: 1 };
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const areaPosition = (c: Crop) => ({
  left: `${c.x * 100}%`,
  top: `${c.y * 100}%`,
  width: `${c.width * 100}%`,
  height: `${c.height * 100}%`
});

const handlePosition = (c: Crop) => ({
  left: `calc(${(c.x + c.width) * 100}% - 0.375rem)`,
  top: `calc(${(c.y + c.height) * 100}% - 0.375rem)`
});

/**
 * Logo crop field: a compact preview + buttons. The actual drag-to-crop canvas
 * lives in a dialog (kept out of the cramped config panels) so the source logo
 * never blows the surrounding form open. Emits a crop rectangle normalized to
 * the source image (0..1) plus the cropped region's pixel aspect ratio, so the
 * PDF/ZPL renderers can size a clip box without loading the image.
 */
export function LogoCropper({
  src,
  crop,
  onChange
}: {
  src: string;
  crop?: Crop;
  onChange: (crop: Crop | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Crop</span>
        <div className="flex items-center gap-1">
          {crop && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => onChange(undefined)}
            >
              Reset
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setOpen(true)}
          >
            {crop ? "Edit crop" : "Crop"}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-16 items-center justify-center overflow-hidden rounded-md border bg-white p-1"
      >
        <img src={src} alt="" className="max-h-full w-auto" />
      </button>
      <CropDialog
        open={open}
        src={src}
        crop={crop}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

/** The drag-to-crop canvas, in a dialog. Saves the crop when a drag ends. */
function CropDialog({
  open,
  src,
  crop,
  onChange,
  onClose
}: {
  open: boolean;
  src: string;
  crop?: Crop;
  onChange: (crop: Crop | undefined) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const natural = useRef<{ w: number; h: number }>({ w: 1, h: 1 });
  const drag = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    start: Crop;
    current?: Crop;
  } | null>(null);
  const [active, setActive] = useState(false);

  const c = crop ?? FULL;

  const aspectOf = useCallback((width: number, height: number) => {
    const { w, h } = natural.current;
    return (width * w) / (height * h) || 1;
  }, []);

  const { t } = useLingui();

  /** Shift `start` by a normalized delta — shared by pointer drag and arrow keys. */
  const shift = useCallback(
    (start: Crop, mode: "move" | "resize", dx: number, dy: number): Crop => {
      if (mode === "move") {
        const x = clamp01(start.x + dx);
        const y = clamp01(start.y + dy);
        return {
          ...start,
          x: Math.min(x, 1 - start.width),
          y: Math.min(y, 1 - start.height)
        };
      }
      const width = clamp01(start.width + dx) || 0.05;
      const height = clamp01(start.height + dy) || 0.05;
      const w = Math.max(0.05, Math.min(width, 1 - start.x));
      const h = Math.max(0.05, Math.min(height, 1 - start.y));
      return { ...start, width: w, height: h, aspect: aspectOf(w, h) };
    },
    [aspectOf]
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      const rect = boxRef.current?.getBoundingClientRect();
      if (!d || !rect) return;
      const dx = (e.clientX - d.startX) / rect.width;
      const dy = (e.clientY - d.startY) / rect.height;
      d.current = shift(d.start, d.mode, dx, dy);
      if (areaRef.current) {
        Object.assign(areaRef.current.style, areaPosition(d.current));
      }
      if (handleRef.current) {
        Object.assign(handleRef.current.style, handlePosition(d.current));
      }
    },
    [shift]
  );

  // Keyboard path: arrow keys nudge 1% (Shift: 10%).
  const onNudge =
    (mode: "move" | "resize") => (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      const delta = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      }[e.key];
      if (!delta) return;
      e.preventDefault();
      e.stopPropagation();
      onChange(
        shift(
          crop ?? { ...FULL, aspect: aspectOf(1, 1) },
          mode,
          delta[0],
          delta[1]
        )
      );
    };

  const detach = useRef<(() => void) | null>(null);
  const finishDrag = (save: boolean) => {
    const d = drag.current;
    drag.current = null;
    setActive(false);
    detach.current?.();
    detach.current = null;
    if (!d?.current) return;
    if (save) {
      onChange(d.current);
      return;
    }
    if (areaRef.current) {
      Object.assign(areaRef.current.style, areaPosition(d.start));
    }
    if (handleRef.current) {
      Object.assign(handleRef.current.style, handlePosition(d.start));
    }
  };
  const finishDragRef = useRef(finishDrag);
  finishDragRef.current = finishDrag;
  useEffect(() => () => finishDragRef.current(true), []);

  const startDrag = useCallback(
    (mode: "move" | "resize") => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      drag.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        start: crop ?? { ...FULL, aspect: aspectOf(1, 1) }
      };
      setActive(true);
      const end = () => finishDragRef.current(true);
      const cancel = () => finishDragRef.current(false);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", cancel);
      detach.current = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", cancel);
      };
    },
    [aspectOf, crop, onPointerMove]
  );

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Crop logo</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="mb-3 text-sm text-muted-foreground">
            Drag the box to move it, drag the bottom-right handle to resize.
            {` ${t`Or focus the box or the handle and use the arrow keys (Shift for bigger steps).`}`}
          </p>
          <div className="flex justify-center">
            <div
              ref={boxRef}
              className="relative inline-block max-h-[55vh] select-none overflow-hidden rounded-md border bg-white"
              style={{ touchAction: "none" }}
            >
              <img
                src={src}
                alt=""
                draggable={false}
                className="pointer-events-none block max-h-[55vh] w-auto"
                onLoad={(e) => {
                  natural.current = {
                    w: e.currentTarget.naturalWidth || 1,
                    h: e.currentTarget.naturalHeight || 1
                  };
                }}
              />
              <div
                ref={areaRef}
                role="button"
                tabIndex={0}
                aria-label={t`Crop area: ${round(c.x * 100, 0)}% from left, ${round(c.y * 100, 0)}% from top. Arrow keys move it.`}
                onPointerDown={startDrag("move")}
                onKeyDown={onNudge("move")}
                className="absolute cursor-move border-2 border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                style={{
                  ...areaPosition(c),
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)",
                  outline: active ? "1px solid #fff" : undefined
                }}
              />
              {/* A sibling of the crop area, not a child, so neither control nests inside the other. */}
              <div
                ref={handleRef}
                role="button"
                tabIndex={0}
                aria-label={t`Crop size: ${round(c.width * 100, 0)}% wide, ${round(c.height * 100, 0)}% tall. Arrow keys resize it.`}
                onPointerDown={startDrag("resize")}
                onKeyDown={onNudge("resize")}
                className={cn(
                  "absolute h-3 w-3 cursor-se-resize rounded-sm border-2 border-white bg-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  c.width >= 0.25 &&
                    c.height >= 0.25 &&
                    "pointer-coarse:after:absolute pointer-coarse:after:-inset-4"
                )}
                style={handlePosition(c)}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onChange(undefined);
            }}
          >
            Reset
          </Button>
          <Button onClick={onClose}>Done</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
