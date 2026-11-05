// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef
} from "react";
import { LuEraser } from "react-icons/lu";
import { Button } from "./Button";
import { cn } from "./utils/cn";

type Point = { x: number; y: number };

/** The canvas calls a drawing needs: a `CanvasRenderingContext2D` or a fake. */
export type SignatureContext = Pick<
  CanvasRenderingContext2D,
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "quadraticCurveTo"
  | "stroke"
  | "clearRect"
  | "save"
  | "restore"
  | "setTransform"
> & {
  strokeStyle: CanvasRenderingContext2D["strokeStyle"];
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
};

/** The pen width in CSS pixels. */
const LINE_WIDTH = 2;

const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2
});

/**
 * The strokes of a signature and how they are drawn, apart from the DOM so
 * it can be tested. Points are CSS pixels. Each move draws a quadratic curve
 * from the midpoint of the last two points, through the last point, to the
 * midpoint of the last point and the new one, so a stroke is smooth. A tap
 * draws a dot. `onChange` reports whether the pad is empty, once per change
 * of that answer and on every clear.
 */
export function createSignatureDrawing(options: {
  getContext: () => SignatureContext | null;
  getSize: () => { width: number; height: number };
  getColor: () => string;
  onChange?: (isEmpty: boolean) => void;
}) {
  const strokes: Point[][] = [];
  let current: Point[] | null = null;

  const begin = (context: SignatureContext) => {
    context.strokeStyle = options.getColor();
    context.lineWidth = LINE_WIDTH;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
  };

  const drawStroke = (context: SignatureContext, points: Point[]) => {
    if (points.length === 0) return;
    begin(context);
    const [first] = points;
    context.moveTo(first!.x, first!.y);
    if (points.length === 1) {
      context.lineTo(first!.x + 0.01, first!.y + 0.01);
    } else {
      for (let i = 1; i < points.length; i++) {
        const control = points[i - 1]!;
        const end = midpoint(control, points[i]!);
        context.quadraticCurveTo(control.x, control.y, end.x, end.y);
      }
      const last = points[points.length - 1]!;
      context.lineTo(last.x, last.y);
    }
    context.stroke();
  };

  return {
    /** Starts a stroke at a point. */
    start(point: Point) {
      const wasEmpty = strokes.length === 0;
      current = [point];
      strokes.push(current);
      const context = options.getContext();
      if (context) drawStroke(context, current);
      if (wasEmpty) options.onChange?.(false);
    },
    /** Extends the stroke in progress to a point. */
    move(point: Point) {
      if (!current) return;
      const previous = current[current.length - 1]!;
      const beforePrevious = current[current.length - 2] ?? previous;
      current.push(point);
      const context = options.getContext();
      if (!context) return;
      begin(context);
      const from = midpoint(beforePrevious, previous);
      const to = midpoint(previous, point);
      context.moveTo(from.x, from.y);
      context.quadraticCurveTo(previous.x, previous.y, to.x, to.y);
      context.stroke();
    },
    /** Ends the stroke in progress. */
    end() {
      current = null;
    },
    /** Removes every stroke and blanks the canvas. */
    clear() {
      strokes.length = 0;
      current = null;
      const context = options.getContext();
      if (context) {
        const { width, height } = options.getSize();
        context.clearRect(0, 0, width, height);
      }
      options.onChange?.(true);
    },
    /** Draws every stroke again, after the canvas was resized. */
    redraw() {
      const context = options.getContext();
      if (!context) return;
      const { width, height } = options.getSize();
      context.clearRect(0, 0, width, height);
      for (const stroke of strokes) drawStroke(context, stroke);
    },
    isEmpty() {
      return strokes.length === 0;
    }
  };
}

export type SignaturePadHandle = {
  /** The signature as a PNG. */
  toBlob: () => Promise<Blob>;
  clear: () => void;
  isEmpty: () => boolean;
};

export type SignaturePadProps = {
  className?: string;
  /** The pen color; the theme's foreground by default. */
  strokeColor?: string;
  /** Called with `true` when the pad is cleared, `false` once it has ink. */
  onChange?: (isEmpty: boolean) => void;
  disabled?: boolean;
};

/**
 * A pad to sign on with a finger, a pen or a mouse. The canvas fills its
 * container and is scaled by the device pixel ratio, so strokes stay sharp.
 * Pointer events with pointer capture keep a stroke going when the finger
 * leaves the pad; `touch-action: none` stops the page from scrolling under
 * it. `toBlob` on the ref gives the signature as a PNG.
 */
const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  ({ className, strokeColor, onChange, disabled = false }, ref) => {
    const { t } = useLingui();
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sizeRef = useRef({ width: 0, height: 0 });
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const colorRef = useRef(strokeColor);
    colorRef.current = strokeColor;

    const drawing = useMemo(
      () =>
        createSignatureDrawing({
          getContext: () => canvasRef.current?.getContext("2d") ?? null,
          getSize: () => sizeRef.current,
          // The canvas carries `text-foreground`, so its computed color is
          // the theme's foreground in light and dark.
          getColor: () =>
            colorRef.current ??
            (canvasRef.current
              ? getComputedStyle(canvasRef.current).color
              : "#000"),
          onChange: (isEmpty) => onChangeRef.current?.(isEmpty)
        }),
      []
    );

    // Size the canvas to its container, in device pixels.
    useEffect(() => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      const resize = () => {
        const { width, height } = container.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        sizeRef.current = { width, height };
        // A canvas truncates a fractional size to whole device pixels.
        canvas.width = Math.max(1, width * ratio);
        canvas.height = Math.max(1, height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawing.redraw();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      return () => observer.disconnect();
    }, [drawing]);

    useImperativeHandle(
      ref,
      () => ({
        toBlob: () =>
          new Promise<Blob>((resolve, reject) => {
            const canvas = canvasRef.current;
            if (!canvas) {
              reject(new Error("The signature pad is not mounted"));
              return;
            }
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error("The signature could not be read"));
            }, "image/png");
          }),
        clear: () => drawing.clear(),
        isEmpty: () => drawing.isEmpty()
      }),
      [drawing]
    );

    const pointOf = useCallback(
      (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
      },
      []
    );

    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <div
          ref={containerRef}
          className={cn(
            "relative h-40 w-full overflow-hidden rounded-lg border border-border bg-card",
            disabled && "opacity-50"
          )}
        >
          <canvas
            ref={canvasRef}
            aria-label={t`Signature pad`}
            role="img"
            className="absolute inset-0 text-foreground"
            style={{ touchAction: "none" }}
            onPointerDown={(event) => {
              if (
                disabled ||
                (event.button !== 0 && event.pointerType === "mouse")
              )
                return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              drawing.start(pointOf(event));
            }}
            onPointerMove={(event) => {
              if (disabled) return;
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                return;
              }
              drawing.move(pointOf(event));
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              drawing.end();
            }}
            onPointerCancel={() => drawing.end()}
          />
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            leftIcon={<LuEraser />}
            isDisabled={disabled}
            onClick={() => drawing.clear()}
          >
            {t`Clear`}
          </Button>
        </div>
      </div>
    );
  }
);
SignaturePad.displayName = "SignaturePad";

export { SignaturePad };
