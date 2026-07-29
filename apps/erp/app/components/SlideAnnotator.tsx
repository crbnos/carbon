import {
  Button,
  cn,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import type { SlideAnnotation } from "~/modules/shared";

// Fixed pin palette — a handful of high-contrast colors that read on any photo. Stored as
// hex on the annotation so the MES overlay renders identically without a theme lookup.
const PIN_COLORS = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#22c55e", // green
  "#3b82f6", // blue
  "#a855f7" // violet
] as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Modal image annotator for a step reference slide. Click the image to drop a numbered pin,
 * drag a pin to reposition, edit its label/color, or delete it. Coordinates are stored as
 * fractions (0..1) of the image box so pins survive any rendered size. Save hands the full
 * pin array back to the caller, which persists it via the slide route.
 */
export function SlideAnnotator({
  open,
  imageUrl,
  initial,
  onSave,
  onClose
}: {
  open: boolean;
  imageUrl: string;
  initial: SlideAnnotation[];
  onSave: (annotations: SlideAnnotation[]) => void;
  onClose: () => void;
}) {
  const [pins, setPins] = useState<SlideAnnotation[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // The pin currently being dragged, and a flag that suppresses the click fired right after
  // a drag so releasing a pin over the image doesn't also drop a new pin.
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  // Reseed from the source every time the annotator opens for a slide.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open only
  useEffect(() => {
    if (open) {
      setPins(initial);
      setSelectedId(null);
    }
  }, [open]);

  const selected = pins.find((p) => p.id === selectedId) ?? null;

  const toFraction = (clientX: number, clientY: number) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height)
    };
  };

  const addPin = (e: React.MouseEvent) => {
    // Ignore the click that ends a drag.
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    const point = toFraction(e.clientX, e.clientY);
    if (!point) return;
    const pin: SlideAnnotation = {
      id: nanoid(),
      x: point.x,
      y: point.y,
      color: PIN_COLORS[0]
    };
    setPins((prev) => [...prev, pin]);
    setSelectedId(pin.id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const point = toFraction(e.clientX, e.clientY);
    if (!point) return;
    drag.current.moved = true;
    const id = drag.current.id;
    setPins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, x: point.x, y: point.y } : p))
    );
  };

  const endDrag = () => {
    if (drag.current?.moved) justDragged.current = true;
    drag.current = null;
  };

  const updateSelected = (patch: Partial<SlideAnnotation>) => {
    if (!selected) return;
    setPins((prev) =>
      prev.map((p) => (p.id === selected.id ? { ...p, ...patch } : p))
    );
  };

  const deleteSelected = () => {
    if (!selected) return;
    setPins((prev) => prev.filter((p) => p.id !== selected.id));
    setSelectedId(null);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ModalContent size="xxlarge">
        <ModalHeader>
          <ModalTitle>Annotate image</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="flex flex-1 items-center justify-center">
              <div
                ref={wrapperRef}
                className="relative inline-block cursor-crosshair select-none"
                onClick={addPin}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <img
                  src={imageUrl}
                  alt="Slide"
                  draggable={false}
                  className="block max-h-[65vh] w-auto max-w-full rounded-md"
                />
                {pins.map((pin, index) => (
                  <button
                    key={pin.id}
                    type="button"
                    aria-label={pin.label || `Pin ${index + 1}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      drag.current = { id: pin.id, moved: false };
                      setSelectedId(pin.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-semibold text-white shadow-md",
                      "cursor-grab active:cursor-grabbing",
                      selectedId === pin.id
                        ? "border-white ring-2 ring-white/60"
                        : "border-white/70"
                    )}
                    style={{
                      left: `${pin.x * 100}%`,
                      top: `${pin.y * 100}%`,
                      backgroundColor: pin.color ?? PIN_COLORS[0]
                    }}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex w-full flex-col gap-3 lg:w-64">
              <p className="text-xs text-muted-foreground">
                {pins.length === 0
                  ? "Click the image to add a numbered pin."
                  : `${pins.length} pin${pins.length === 1 ? "" : "s"} · click a pin to edit`}
              </p>

              {selected ? (
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Pin {pins.findIndex((p) => p.id === selected.id) + 1}
                    </span>
                    <IconButton
                      aria-label="Delete pin"
                      icon={<LuTrash2 />}
                      variant="ghost"
                      size="sm"
                      onClick={deleteSelected}
                    />
                  </div>
                  <input
                    type="text"
                    aria-label="Pin label"
                    placeholder="Label (optional)"
                    value={selected.label ?? ""}
                    onChange={(e) => updateSelected({ label: e.target.value })}
                    className="w-full rounded-md border bg-transparent px-2 py-1 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    {PIN_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Color ${color}`}
                        onClick={() => updateSelected({ color })}
                        className={cn(
                          "size-6 rounded-full border-2 transition-transform active:scale-[0.9]",
                          (selected.color ?? PIN_COLORS[0]) === color
                            ? "border-foreground"
                            : "border-transparent"
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(pins)}>Save</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
