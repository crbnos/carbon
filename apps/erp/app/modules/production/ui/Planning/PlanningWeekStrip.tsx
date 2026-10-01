// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import type { PointerEvent } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { planningWeekGeometry } from "./planning-week-geometry";

export type PlanningPeriod = { id: string; startDate: string; endDate: string };

/**
 * The projected on-hand a planning row carries per week, in period order.
 * `week1` is the present week; a missing key means MRP wrote no projection.
 */
export function planningWeekValues(
  row: Record<string, unknown>,
  periods: PlanningPeriod[]
): (number | undefined)[] {
  return periods.map((_, index) => {
    const value = row[`week${index + 1}`];
    return typeof value === "number" ? value : undefined;
  });
}

const BAR_WIDTH = 4;
const BAR_GAP = 1;

/** Grid column width that fits every bar plus the cell padding. */
export function planningWeekStripSize(periodCount: number): number {
  return periodCount * (BAR_WIDTH + BAR_GAP) + 32;
}

type Hovered = { index: number; element: HTMLElement };

/**
 * The projected on-hand for every planning week as a small column chart on a
 * zero line: stock above it in a neutral tone, a shortfall hanging below it in
 * red. The same reading as the item planning chart (red below zero), sized for
 * a grid cell — where the row runs out and how deep it goes is visible without
 * opening anything. Red is the only hue, so it stays rare: a healthy row is
 * quiet, and sign is carried by direction as well as colour.
 *
 * A single tooltip serves the whole strip and follows the hovered week, so a
 * page of rows costs one tooltip per row rather than one per week.
 */
export const PlanningWeekStrip = memo(function PlanningWeekStrip({
  periods,
  values
}: {
  periods: PlanningPeriod[];
  values: (number | undefined)[];
}) {
  const { t } = useLingui();
  const dateFormatter = useDateFormatter({ month: "short", day: "numeric" });
  const numberFormatter = useNumberFormatter();
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const { zero, heights } = useMemo(
    () => planningWeekGeometry(values),
    [values]
  );

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const week = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-week-index]"
    );
    if (!week) return;
    const index = Number(week.dataset.weekIndex);
    setHovered((current) =>
      current?.index === index ? current : { index, element: week }
    );
  }, []);

  // Without this the last week touched stayed highlighted after the pointer
  // left the strip — the highlight is hover state and has to end with the hover.
  const onPointerLeave = useCallback(() => setHovered(null), []);

  const period = hovered ? periods[hovered.index] : undefined;
  const value = hovered ? values[hovered.index] : undefined;
  const weekNumber = hovered ? hovered.index + 1 : 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="img"
          aria-label={t`Projected stock by week`}
          className="relative flex h-6"
          style={{ gap: BAR_GAP }}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        >
          {/* the zero line */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 h-px -translate-y-1/2 bg-border"
            style={{ top: `${zero}%` }}
          />
          {values.map((weekValue, index) => {
            const isShort = weekValue !== undefined && weekValue < 0;
            const hasBar = weekValue !== undefined && weekValue !== 0;
            return (
              // The week's hit area is the full height of the strip, so a
              // short bar is as easy to hover as a tall one.
              <div
                key={periods[index]?.id ?? index}
                data-week-index={index}
                className="relative h-full shrink-0"
                style={{ width: BAR_WIDTH }}
              >
                {hasBar ? (
                  <div
                    className={cn(
                      "absolute inset-x-0 min-h-[2px] rounded-[1px]",
                      isShort ? "bg-red-500" : "bg-muted-foreground/50"
                    )}
                    style={
                      isShort
                        ? { top: `${zero}%`, height: `${heights[index]}%` }
                        : {
                            bottom: `${100 - zero}%`,
                            height: `${heights[index]}%`
                          }
                    }
                  />
                ) : (
                  // exactly zero: a tick on the line; no projection: nothing
                  weekValue === 0 && (
                    <div
                      className="absolute inset-x-0 h-[2px] -translate-y-1/2 rounded-[1px] bg-muted-foreground/50"
                      style={{ top: `${zero}%` }}
                    />
                  )
                )}
                {/* The hovered week, marked over the whole column — the same
                    cue as the planning chart's cursor band. It sits ON TOP of
                    the bar: behind it, a full-height bar hid it completely. */}
                {hovered?.index === index && (
                  <div
                    aria-hidden
                    className="absolute inset-0 rounded-[1px] bg-foreground/20"
                  />
                )}
              </div>
            );
          })}
        </div>
      </TooltipTrigger>
      {hovered && period && (
        <TooltipContent anchor={hovered.element}>
          <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
            <span className="col-span-2 font-medium">
              {weekNumber === 1 ? t`Present Week` : t`Week ${weekNumber}`}
            </span>
            <span className="col-span-2 text-xs text-muted-foreground">
              {dateFormatter.formatRange(
                parseDate(period.startDate).toDate(getLocalTimeZone()),
                parseDate(period.endDate).toDate(getLocalTimeZone())
              )}
            </span>
            <span className="text-muted-foreground">{t`Projected`}</span>
            <span
              className={cn(
                "text-right tabular-nums",
                value !== undefined && value < 0 && "font-medium text-red-500"
              )}
            >
              {value === undefined ? "-" : numberFormatter.format(value)}
            </span>
          </div>
        </TooltipContent>
      )}
    </Tooltip>
  );
});
