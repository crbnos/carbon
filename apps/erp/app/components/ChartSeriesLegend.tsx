// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import { useState } from "react";

export function useHiddenSeries<K extends string>() {
  const [hiddenSeries, setHiddenSeries] = useState<Set<K>>(() => new Set());
  const isShown = (key: K) => !hiddenSeries.has(key);
  const toggleSeries = (key: K) =>
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { hiddenSeries, isShown, toggleSeries };
}

/**
 * A chart legend whose entries are buttons that hide and show their series.
 * Line series get a line glyph and bar series a square, so "the line" maps to
 * something. The caller leaves a hidden series out of its axis range, so the
 * axis rescales to what is shown. Give the `ChartContainer` `role="group"`:
 * under the default `role="img"` these buttons are presentational to
 * assistive tech.
 */
export function ChartSeriesLegend<K extends string>({
  payload,
  config,
  hiddenSeries,
  onToggle,
  disabledSeries = []
}: {
  payload?: Array<{ dataKey: K; type?: string; color?: string }>;
  config: ChartConfig;
  hiddenSeries: Set<K>;
  onToggle: (key: K) => void;
  disabledSeries?: K[];
}) {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 pt-3 text-xs text-muted-foreground">
      {payload.map((item) => {
        const shown = !hiddenSeries.has(item.dataKey);
        return (
          <button
            key={item.dataKey}
            type="button"
            aria-pressed={shown}
            disabled={disabledSeries.includes(item.dataKey)}
            onClick={() => onToggle(item.dataKey)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors",
              "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
              !shown && "text-muted-foreground/60 line-through"
            )}
          >
            {item.type === "line" ? (
              <span
                className="h-[3px] w-3.5 shrink-0 rounded-full border"
                style={{
                  borderColor: item.color,
                  backgroundColor: shown ? item.color : "transparent"
                }}
              />
            ) : (
              <span
                className="size-2.5 shrink-0 rounded-[2px] border"
                style={{
                  borderColor: item.color,
                  backgroundColor: shown ? item.color : "transparent"
                }}
              />
            )}
            <span>{config[item.dataKey]?.label}</span>
          </button>
        );
      })}
    </div>
  );
}
