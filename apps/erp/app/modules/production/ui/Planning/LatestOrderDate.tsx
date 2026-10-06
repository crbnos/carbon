// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Plural, Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { memo } from "react";
import type { ProductionPlanningItem } from "~/modules/production";
import type { PurchasingPlanningItem } from "~/modules/purchasing";

type PlanningRow = ProductionPlanningItem | PurchasingPlanningItem;

/** CSV value for the Latest Order Date column: the ISO date, or blank. */
export function latestOrderDateExportValue(row: PlanningRow) {
  return row.latestOrderDate ?? null;
}

/**
 * The last day the row's next suggested order can be placed and still arrive
 * on time: the earliest order-by date among the item's open new-supply
 * actions, which the grid RPC returns as `latestOrderDate` and sorts by. Red
 * once that day has passed — the order is already late. The tooltip shows the
 * date the supply is required (the order-by date plus the lead time MRP took
 * off it) and the lead time.
 */
export const LatestOrderDateCell = memo(function LatestOrderDateCell({
  itemPlanning,
  todayIso
}: {
  itemPlanning: PlanningRow;
  /** Today on the location's calendar — what "past due" is measured from. */
  todayIso: string;
}) {
  const { locale } = useLocale();
  const latestOrderDate = itemPlanning.latestOrderDate;
  if (!latestOrderDate) return <span>-</span>;

  const leadTime = itemPlanning.leadTime ?? 0;
  const requiredDate = parseDate(latestOrderDate)
    .add({ days: leadTime })
    .toString();
  // ISO dates: string order is chronological
  const isPastDue = latestOrderDate < todayIso;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "whitespace-nowrap tabular-nums",
            isPastDue && "text-red-500 font-bold"
          )}
        >
          {formatDate(latestOrderDate, undefined, locale)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
          <span className="text-muted-foreground">
            <Trans>Required Date</Trans>
          </span>
          <span className="tabular-nums text-right">
            {formatDate(requiredDate, undefined, locale)}
          </span>
          <span className="text-muted-foreground">
            <Trans>Lead Time</Trans>
          </span>
          <span className="tabular-nums text-right">
            <Plural value={leadTime} one="# day" other="# days" />
          </span>
          {isPastDue && (
            <span className="col-span-2 text-red-500 font-medium">
              <Trans>Past due</Trans>
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
});
