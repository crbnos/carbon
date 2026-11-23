// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "./utils/cn";

const BAR_WIDTH = 2;
const BAR_HEIGHT = 14;
const BAR_GAP = 3;

type Segment = {
  value: number;
  className: string;
};

interface BarProgressProps {
  /** Numeric progress value */
  progress: number;
  /** Maximum progress value (default: 100) */
  max?: number;
  /** Label displayed above-left of the bar */
  label?: string;
  /** Value string displayed above-right of the bar */
  value?: string;
  /** Multi-segment progress (renders segments in order, ignores progress/activeClassName) */
  segments?: Segment[];
  /** Additional class names for the outer wrapper */
  className?: string;
  /** Class name for the active (filled) bars */
  activeClassName?: string;
  /** Class name for the inactive (unfilled) bars */
  inactiveClassName?: string;
  /** Phones: label above the bar, value under it, value not truncated. */
  stackOnPhone?: boolean;
}

export function BarProgress({
  progress,
  max = 100,
  label,
  value,
  segments,
  className,
  activeClassName = "bg-emerald-500",
  inactiveClassName = "bg-muted",
  stackOnPhone = false
}: BarProgressProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [barCount, setBarCount] = useState(0);

  const calculateBars = useCallback(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
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

  const getBarClassName = (i: number): string => {
    if (segments && barCount > 0) {
      let cumulative = 0;
      for (const seg of segments) {
        const segBars = Math.round((seg.value / max) * barCount);
        cumulative += segBars;
        if (i < cumulative) return seg.className;
      }
      return inactiveClassName;
    }

    return i < activeBars ? activeClassName : inactiveClassName;
  };

  return (
    <div className={cn("w-full", className)}>
      {hasHeader && (
        <div className="mb-0.5 flex items-baseline justify-between gap-2">
          {label ? (
            <span
              className={cn(
                "shrink-0 text-sm font-medium text-foreground",
                stackOnPhone && "max-md:min-w-0 max-md:truncate max-md:text-xs"
              )}
            >
              {label}
            </span>
          ) : (
            <div />
          )}
          {value && (
            <span
              title={value}
              className={cn(
                "min-w-0 truncate text-xs font-mono tabular-nums text-muted-foreground",
                stackOnPhone && "max-md:hidden"
              )}
            >
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
        // The shown text ("2h / 8h", "3 / 4"), not a bare percentage.
        aria-valuetext={value || undefined}
        className="flex w-full items-center gap-[3px]"
      >
        {barCount > 0 &&
          Array.from({ length: barCount }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={cn(
                "shrink-0 rounded-[2px] transition-colors duration-200",
                getBarClassName(i)
              )}
              style={{ width: BAR_WIDTH, height: BAR_HEIGHT }}
            />
          ))}
        <span className="sr-only">{Math.round(percentage)}%</span>
      </div>
      {stackOnPhone && value ? (
        <span className="mt-1 hidden break-words text-xs font-mono tabular-nums text-muted-foreground max-md:block">
          {value}
        </span>
      ) : null}
    </div>
  );
}
