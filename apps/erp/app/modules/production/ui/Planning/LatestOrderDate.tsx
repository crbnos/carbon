import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { memo } from "react";
import { getNextPlannedOrder } from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { ProductionPlanningItem } from "~/modules/production";
import type { PurchasingPlanningItem } from "~/modules/purchasing";

type PlanningRow = ProductionPlanningItem | PurchasingPlanningItem;
type PlanningPeriod = { id: string; startDate: string };

/** CSV value for the Latest Order Date column: the ISO date, or blank. */
export function latestOrderDateExportValue(
  row: PlanningRow,
  periods: PlanningPeriod[]
) {
  return getNextPlannedOrder(row, periods)?.startDate ?? null;
}

/**
 * The last day the row's next planned order can be placed and still arrive on
 * time: the date the supply is required less the item's lead time. Red once
 * that day has passed — the order is already late. The tooltip shows the two
 * numbers it was derived from.
 */
export const LatestOrderDateCell = memo(function LatestOrderDateCell({
  itemPlanning,
  periods
}: {
  itemPlanning: PlanningRow;
  periods: PlanningPeriod[];
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const order = getNextPlannedOrder(itemPlanning, periods);
  if (!order) return <span>-</span>;

  const leadTime = itemPlanning.leadTime ?? 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "whitespace-nowrap tabular-nums",
            order.isASAP && "text-red-500 font-bold"
          )}
        >
          {formatDate(order.startDate, undefined, locale)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
          <span className="text-muted-foreground">
            <Trans>Required Date</Trans>
          </span>
          <span className="tabular-nums text-right">
            {formatDate(order.dueDate, undefined, locale)}
          </span>
          <span className="text-muted-foreground">
            <Trans>Lead Time</Trans>
          </span>
          <span className="tabular-nums text-right">{t`${leadTime} days`}</span>
          {order.isASAP && (
            <span className="col-span-2 text-red-500 font-medium">
              <Trans>Past due</Trans>
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
});
