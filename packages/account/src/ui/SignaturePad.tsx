// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, IconButton, SHORTCUTS } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PointerEvent } from "react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import { LuEraser, LuUndo2, LuX } from "react-icons/lu";

type Point = { x: number; y: number; width: number };
type Stroke = Point[];

export type SignaturePadHandle = {
  /** The ink, cropped to its bounds, as a PNG. Null when the pad is empty. */
  toPng: () => Promise<Blob | null>;
};

const INK = "#111827";
// Stroke width in CSS pixels: fast strokes thin out, slow ones thicken, the
// way a pen's line does. A stylus uses its pressure instead.
const MIN_WIDTH = 1.2;
const MAX_WIDTH = 3.4;
const SPEED_FOR_MIN = 2.5; // px per ms
const SMOOTHING = 0.35;

type Sample = {
  clientX: number;
  clientY: number;
  pressure: number;
  pointerType: string;
  timeStamp: number;
};

/**
 * A signing surface: paper-white in both modes (it becomes a PNG printed on
 * white), a hint that fades on the first stroke, a baseline to sign on, and
 * undo and clear in the corner.
 */
const SignaturePad = forwardRef<
  SignaturePadHandle,
  {
    /** Called with whether the pad has ink, after every stroke, undo and clear. */
    onChange?: (hasInk: boolean) => void;
  }
>(function SignaturePad({ onChange }, ref) {
  const { t } = useLingui();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<Stroke[]>([]);
  const last = useRef<{ time: number; width: number } | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);

  const commit = (count: number) => {
    setStrokeCount(count);
    onChange?.(count > 0);
  };

  // Size the backing store to the element at the screen's density, and
  // redraw whatever is there (a resize clears a canvas).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
      redraw(canvas, strokes.current);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    toPng: () => {
      const canvas = canvasRef.current;
      if (!canvas || strokes.current.length === 0) return Promise.resolve(null);
      return new Promise((resolve) =>
        trimmed(canvas).toBlob((blob) => resolve(blob), "image/png")
      );
    }
  }));

  const pointAt = (canvas: HTMLCanvasElement, sample: Sample): Point => {
    const rect = canvas.getBoundingClientRect();
    const x = sample.clientX - rect.left;
    const y = sample.clientY - rect.top;
    const previous = last.current;
    const before = strokes.current.at(-1)?.at(-1);
    let target = MAX_WIDTH;
    if (sample.pointerType === "pen" && sample.pressure > 0) {
      target = MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * sample.pressure;
    } else if (previous && before) {
      const elapsed = Math.max(sample.timeStamp - previous.time, 1);
      const speed = Math.hypot(x - before.x, y - before.y) / elapsed;
      target =
        MAX_WIDTH -
        (MAX_WIDTH - MIN_WIDTH) * Math.min(speed / SPEED_FOR_MIN, 1);
    }
    const width = previous
      ? previous.width + (target - previous.width) * SMOOTHING
      : target;
    last.current = { time: sample.timeStamp, width };
    return { x, y, width };
  };

  const start = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    last.current = null;
    const stroke = [pointAt(canvas, e)];
    strokes.current.push(stroke);
    const ctx = context(canvas);
    if (ctx) drawStroke(ctx, stroke);
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const stroke = strokes.current.at(-1);
    if (!stroke || !canvas.hasPointerCapture(e.pointerId)) return;
    const ctx = context(canvas);
    // A fast pointer reports several positions per frame; draw them all.
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const sample of samples.length > 0 ? samples : [e.nativeEvent]) {
      stroke.push(pointAt(canvas, sample));
      if (ctx) drawSegment(ctx, stroke, stroke.length - 1);
    }
  };

  const end = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    if (!canvas.hasPointerCapture(e.pointerId)) return;
    canvas.releasePointerCapture(e.pointerId);
    commit(strokes.current.length);
  };

  const undo = () => {
    strokes.current.pop();
    if (canvasRef.current) redraw(canvasRef.current, strokes.current);
    commit(strokes.current.length);
  };

  const clear = () => {
    strokes.current = [];
    if (canvasRef.current) redraw(canvasRef.current, []);
    commit(0);
  };

  const isEmpty = strokeCount === 0;

  return (
    <div className="relative h-48 w-full overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-[38%] select-none text-center text-sm text-neutral-400 transition-opacity duration-150 ease-out",
          !isEmpty && "opacity-0"
        )}
      >
        <Trans>Sign here</Trans>
      </span>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-6 bottom-9 flex items-end gap-2"
      >
        <LuX className="size-3.5 shrink-0 text-neutral-400" />
        <span className="flex-1 border-b border-dashed border-neutral-300" />
      </div>
      <canvas
        ref={canvasRef}
        aria-label={t`Signature pad. Draw your signature with a mouse, trackpad, stylus or finger.`}
        className="absolute inset-0 size-full cursor-crosshair touch-none"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="absolute top-2 right-2 flex gap-1">
        <IconButton
          aria-label={t`Undo`}
          icon={<LuUndo2 />}
          variant="ghost"
          size="sm"
          isDisabled={isEmpty}
          onClick={undo}
          shortcut={SHORTCUTS.undo}
          hideShortcutKey
          className="text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
        />
        <IconButton
          aria-label={t`Clear`}
          icon={<LuEraser />}
          variant="ghost"
          size="sm"
          isDisabled={isEmpty}
          onClick={clear}
          className="text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
        />
      </div>
    </div>
  );
});

export default SignaturePad;

function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const ratio = window.devicePixelRatio || 1;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  return ctx;
}

/** Segment `i` of a stroke, curved through the midpoints of its neighbours. */
function drawSegment(ctx: CanvasRenderingContext2D, stroke: Stroke, i: number) {
  const current = stroke[i];
  const previous = stroke[i - 1];
  if (!current || !previous) return;
  const before = stroke[i - 2] ?? previous;
  ctx.beginPath();
  ctx.lineWidth = (previous.width + current.width) / 2;
  ctx.moveTo((before.x + previous.x) / 2, (before.y + previous.y) / 2);
  ctx.quadraticCurveTo(
    previous.x,
    previous.y,
    (previous.x + current.x) / 2,
    (previous.y + current.y) / 2
  );
  ctx.stroke();
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const first = stroke[0];
  if (!first) return;
  // A tap leaves a dot.
  ctx.beginPath();
  ctx.arc(first.x, first.y, first.width / 2, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 1; i < stroke.length; i++) drawSegment(ctx, stroke, i);
}

function redraw(canvas: HTMLCanvasElement, strokes: Stroke[]) {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  const ctx = context(canvas);
  if (!ctx) return;
  for (const stroke of strokes) drawStroke(ctx, stroke);
}

/** The drawing cropped to its ink plus a small margin, so it prints full size. */
function trimmed(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return canvas;
  const margin = 8;
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(width - 1, right + margin);
  bottom = Math.min(height - 1, bottom + margin);
  const out = document.createElement("canvas");
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext("2d")?.drawImage(canvas, -left, -top);
  return out;
}
