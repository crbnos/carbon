import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import type { PointerEvent } from "react";
import { memo, useCallback, useState } from "react";

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

/** A shortfall is red, an exact zero is grey, covered stock is green. */
function weekTone(value: number | undefined) {
  if (value === undefined) return "bg-muted";
  if (value < 0) return "bg-red-500";
  if (value === 0) return "bg-muted-foreground/30";
  return "bg-emerald-500";
}

const BAR_WIDTH = 4;
const BAR_GAP = 1;

/** Grid column width that fits every bar plus the cell padding. */
export function planningWeekStripSize(periodCount: number): number {
  return periodCount * (BAR_WIDTH + BAR_GAP) + 32;
}

type Hovered = { index: number; element: HTMLElement };

/**
 * One bar per planning week, coloured by the projected on-hand for that
 * week. A single tooltip serves the whole strip and follows the hovered bar,
 * so a page of rows costs one tooltip per row rather than one per week.
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

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const bar = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-week-index]"
    );
    if (!bar) return;
    const index = Number(bar.dataset.weekIndex);
    setHovered((current) =>
      current?.index === index ? current : { index, element: bar }
    );
  }, []);

  const period = hovered ? periods[hovered.index] : undefined;
  const value = hovered ? values[hovered.index] : undefined;
  const weekNumber = hovered ? hovered.index + 1 : 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex items-center h-6"
          style={{ gap: BAR_GAP }}
          onPointerMove={onPointerMove}
        >
          {values.map((weekValue, index) => (
            <div
              key={periods[index]?.id ?? index}
              data-week-index={index}
              className={cn(
                "rounded-[1px] transition-[height] duration-100",
                hovered?.index === index ? "h-5" : "h-4",
                weekTone(weekValue)
              )}
              style={{ width: BAR_WIDTH }}
            />
          ))}
        </div>
      </TooltipTrigger>
      {hovered && period && (
        <TooltipContent anchor={hovered.element}>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">
              {weekNumber === 1 ? t`Present Week` : t`Week ${weekNumber}`}
            </span>
            <span className="text-xs text-muted-foreground">
              {dateFormatter.format(
                parseDate(period.startDate).toDate(getLocalTimeZone())
              )}{" "}
              -{" "}
              {dateFormatter.format(
                parseDate(period.endDate).toDate(getLocalTimeZone())
              )}
            </span>
            <span className="tabular-nums">
              {t`Projected`}:{" "}
              {value === undefined ? (
                "-"
              ) : (
                <span
                  className={cn(
                    value < 0 && "text-red-500 font-bold",
                    value > 0 && "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {numberFormatter.format(value)}
                </span>
              )}
            </span>
          </div>
        </TooltipContent>
      )}
    </Tooltip>
  );
});
