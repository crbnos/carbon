"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "./utils/cn";

const BAR_WIDTH = 2;
const BAR_HEIGHT = 14;
const BAR_GAP = 3;

/**
 * Interpolates between two [r,g,b] colors at a given ratio (0-1).
 */
function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

type GradientStop = { pos: number; color: [number, number, number] };

// red -> yellow -> green
const GRADIENT_STOPS: GradientStop[] = [
  { pos: 0, color: [239, 68, 68] }, // red-500
  { pos: 0.5, color: [234, 179, 8] }, // yellow-500
  { pos: 0.8, color: [34, 197, 94] }, // green-500
  { pos: 1, color: [34, 197, 94] } // green-500
];

// green -> yellow -> red (inverted)
const GRADIENT_STOPS_INVERTED: GradientStop[] = [
  { pos: 0, color: [34, 197, 94] }, // green-500
  { pos: 0.2, color: [34, 197, 94] }, // green-500
  { pos: 0.5, color: [234, 179, 8] }, // yellow-500
  { pos: 0.8, color: [239, 68, 68] }, // red-500
  { pos: 1, color: [239, 68, 68] } // red-500
];

function getGradientColor(ratio: number, stops: GradientStop[]): string {
  const clamped = Math.min(Math.max(ratio, 0), 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const curr = stops[i];
    const next = stops[i + 1];
    if (clamped >= curr.pos && clamped <= next.pos) {
      const t = (clamped - curr.pos) / (next.pos - curr.pos);
      return lerpColor(curr.color, next.color, t);
    }
  }
  return lerpColor(stops[0].color, stops[0].color, 0);
}

interface BarProgressProps {
  /** Numeric progress value */
  progress: number;
  /** Maximum progress value (default: 100) */
  max?: number;
  /** Label displayed above-left of the bar */
  label?: string;
  /** Value string displayed above-right of the bar */
  value?: string;
  /** Enable a red-yellow-green gradient across active bars */
  gradient?: boolean;
  /** Invert the gradient to green-yellow-red */
  invertGradient?: boolean;
  /** Additional class names for the outer wrapper */
  className?: string;
  /** Class name for the active (filled) bars (ignored when gradient is true) */
  activeClassName?: string;
  /** Class name for the inactive (unfilled) bars */
  inactiveClassName?: string;
}

export function BarProgress({
  progress,
  max = 100,
  label,
  value,
  gradient = false,
  invertGradient = false,
  className,
  activeClassName = "bg-emerald-500",
  inactiveClassName = "bg-muted"
}: BarProgressProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [barCount, setBarCount] = useState(0);

  const calculateBars = useCallback(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    // Total width per bar = BAR_WIDTH + BAR_GAP, minus one trailing gap
    // width = bars * BAR_WIDTH + (bars - 1) * BAR_GAP
    // width = bars * (BAR_WIDTH + BAR_GAP) - BAR_GAP
    // bars = floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP))
    const count = Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP));
    setBarCount(Math.max(count, 1));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    calculateBars();

    const observer = new ResizeObserver(calculateBars);
    observer.observe(el);
    return () => observer.disconnect();
  }, [calculateBars]);

  const clampedProgress = Math.min(Math.max(progress, 0), max);
  const percentage = (clampedProgress / max) * 100;
  const activeBars = Math.round((clampedProgress / max) * barCount);

  const hasHeader = label || value;

  return (
    <div className={cn("w-full", className)}>
      {hasHeader && (
        <div className="mb-0.5 flex items-baseline justify-between">
          {label ? (
            <span className="text-sm font-medium text-foreground">{label}</span>
          ) : (
            <div />
          )}
          {value && (
            <span className="text-xs font-mono text-muted-foreground">
              {value}
            </span>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        role="progressbar"
        aria-valuenow={clampedProgress}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? "Progress"}
        className="flex w-full items-center gap-[3px]"
      >
        {barCount > 0 &&
          Array.from({ length: barCount }, (_, i) => {
            const isActive = i < activeBars;
            const gradientStyle =
              isActive && gradient && barCount > 0
                ? {
                    backgroundColor: getGradientColor(
                      i / (barCount - 1 || 1),
                      invertGradient ? GRADIENT_STOPS_INVERTED : GRADIENT_STOPS
                    )
                  }
                : undefined;

            return (
              <span
                key={i}
                aria-hidden="true"
                className={cn(
                  "shrink-0 rounded-[2px] transition-colors duration-200",
                  !gradient && isActive && activeClassName,
                  !isActive && inactiveClassName
                )}
                style={{
                  width: BAR_WIDTH,
                  height: BAR_HEIGHT,
                  ...gradientStyle
                }}
              />
            );
          })}
        <span className="sr-only">{Math.round(percentage)}%</span>
      </div>
    </div>
  );
}
