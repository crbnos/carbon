import type { LabelLogoBlock } from "@carbon/documents/template";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { useCallback, useRef, useState } from "react";

type Crop = NonNullable<LabelLogoBlock["crop"]>;

const FULL: Crop = { x: 0, y: 0, width: 1, height: 1, aspect: 1 };
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

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
      {open && (
        <CropDialog
          src={src}
          crop={crop}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** The drag-to-crop canvas, in a dialog. Live-updates the crop as you drag. */
function CropDialog({
  src,
  crop,
  onChange,
  onClose
}: {
  src: string;
  crop?: Crop;
  onChange: (crop: Crop | undefined) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const natural = useRef<{ w: number; h: number }>({ w: 1, h: 1 });
  const drag = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    start: Crop;
  } | null>(null);
  const [active, setActive] = useState(false);

  const c = crop ?? FULL;

  const aspectOf = useCallback((width: number, height: number) => {
    const { w, h } = natural.current;
    return (width * w) / (height * h) || 1;
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      const rect = boxRef.current?.getBoundingClientRect();
      if (!d || !rect) return;
      const dx = (e.clientX - d.startX) / rect.width;
      const dy = (e.clientY - d.startY) / rect.height;
      let next: Crop;
      if (d.mode === "move") {
        const x = clamp01(d.start.x + dx);
        const y = clamp01(d.start.y + dy);
        next = {
          ...d.start,
          x: Math.min(x, 1 - d.start.width),
          y: Math.min(y, 1 - d.start.height)
        };
      } else {
        const width = clamp01(d.start.width + dx) || 0.05;
        const height = clamp01(d.start.height + dy) || 0.05;
        const w = Math.max(0.05, Math.min(width, 1 - d.start.x));
        const h = Math.max(0.05, Math.min(height, 1 - d.start.y));
        next = { ...d.start, width: w, height: h, aspect: aspectOf(w, h) };
      }
      onChange(next);
    },
    [aspectOf, onChange]
  );

  const endDrag = useCallback(() => {
    drag.current = null;
    setActive(false);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onPointerMove]);

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
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
    },
    [aspectOf, crop, endDrag, onPointerMove]
  );

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Crop logo</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="mb-3 text-sm text-muted-foreground">
            Drag the box to move it, drag the bottom-right handle to resize.
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
                onPointerDown={startDrag("move")}
                className="absolute cursor-move border-2 border-white"
                style={{
                  left: `${c.x * 100}%`,
                  top: `${c.y * 100}%`,
                  width: `${c.width * 100}%`,
                  height: `${c.height * 100}%`,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)",
                  outline: active ? "1px solid #fff" : undefined
                }}
              >
                <div
                  onPointerDown={startDrag("resize")}
                  className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border-2 border-white bg-foreground"
                />
              </div>
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
