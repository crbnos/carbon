// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { Plural, Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuCalendarRange } from "react-icons/lu";
import { useQuantityFormatter } from "~/hooks";
import { ItemReorderPolicy } from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { ProductionPlanningItem } from "~/modules/production";
import { TimeFenceCell } from "~/modules/production/ui/Planning/PlanningFence";

// What the production and purchasing order drawers share. They used to keep
// a copy each, and the copies had already drifted (one drawer's labels were
// translated, the other's were not).

type Period = { id: string; startDate: string; endDate: string };

/** The planning period a date falls in: the first for a missing or past date,
 *  the last for one beyond the planning window. ISO dates compare as text. */
export function periodIdFor(
  periods: Period[],
  date: string | null | undefined
) {
  if (!date || date < periods[0].startDate) return periods[0].id;
  return (
    periods.find((p) => date >= p.startDate && date <= p.endDate)?.id ??
    periods[periods.length - 1].id
  );
}

type PolicyFields = Pick<
  ProductionPlanningItem,
  | "reorderingPolicy"
  | "reorderPoint"
  | "reorderQuantity"
  | "maximumInventoryQuantity"
  | "demandAccumulationPeriod"
  | "demandAccumulationSafetyStock"
  | "lotSize"
  | "orderMultiple"
  | "minimumOrderQuantity"
  | "maximumOrderQuantity"
>;

export function PlanningSummaryRow({
  label,
  children
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <HStack className="justify-between w-full">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </HStack>
  );
}

/**
 * The drawer's policy card: the reorder policy, the row's time fence, then
 * `children` (the purchasing drawer's supplier and unit rows), then the
 * parameters of the policy in force.
 */
export function PlanningPolicySummary({
  item,
  fenceDate,
  isFenceOverridden,
  onFenceChange,
  children
}: {
  item: PolicyFields;
  fenceDate: string | null;
  isFenceOverridden: boolean;
  onFenceChange: (date: string | null) => void;
  children?: ReactNode;
}) {
  const formatQuantity = useQuantityFormatter();
  return (
    // A line between every row, whichever rows the policy shows.
    <VStack
      spacing={0}
      className="text-sm border rounded-lg px-4 py-2 divide-y divide-border [&>*]:py-2"
    >
      <PlanningSummaryRow label={<Trans>Reorder Policy:</Trans>}>
        <ItemReorderPolicy reorderingPolicy={item.reorderingPolicy} />
      </PlanningSummaryRow>
      <PlanningSummaryRow label={<Trans>Planning Horizon:</Trans>}>
        <div className="flex-none">
          <TimeFenceCell
            fenceDate={fenceDate}
            isOverridden={isFenceOverridden}
            onChange={onFenceChange}
          />
        </div>
      </PlanningSummaryRow>
      {children}
      {item.reorderingPolicy === "Maximum Quantity" && (
        <>
          <PlanningSummaryRow label={<Trans>Reorder Point:</Trans>}>
            <span>{formatQuantity(item.reorderPoint)}</span>
          </PlanningSummaryRow>
          <PlanningSummaryRow label={<Trans>Maximum Inventory:</Trans>}>
            <span>{formatQuantity(item.maximumInventoryQuantity)}</span>
          </PlanningSummaryRow>
        </>
      )}
      {item.reorderingPolicy === "Demand-Based Reorder" && (
        <>
          <PlanningSummaryRow label={<Trans>Accumulation Period:</Trans>}>
            <span>
              <Plural
                value={item.demandAccumulationPeriod}
                one="# week"
                other="# weeks"
              />
            </span>
          </PlanningSummaryRow>
          <PlanningSummaryRow label={<Trans>Safety Stock:</Trans>}>
            <span>{formatQuantity(item.demandAccumulationSafetyStock)}</span>
          </PlanningSummaryRow>
        </>
      )}
      {item.reorderingPolicy === "Fixed Reorder Quantity" && (
        <>
          <PlanningSummaryRow label={<Trans>Reorder Point:</Trans>}>
            <span>{formatQuantity(item.reorderPoint)}</span>
          </PlanningSummaryRow>
          <PlanningSummaryRow label={<Trans>Reorder Quantity:</Trans>}>
            <span>{formatQuantity(item.reorderQuantity)}</span>
          </PlanningSummaryRow>
        </>
      )}
      {item.lotSize > 0 && (
        <PlanningSummaryRow label={<Trans>Lot Size:</Trans>}>
          <span>{formatQuantity(item.lotSize)}</span>
        </PlanningSummaryRow>
      )}
      {item.orderMultiple > 1 && (
        <PlanningSummaryRow label={<Trans>Order Multiple:</Trans>}>
          <span>{formatQuantity(item.orderMultiple)}</span>
        </PlanningSummaryRow>
      )}
      {item.minimumOrderQuantity > 0 && (
        <PlanningSummaryRow label={<Trans>Minimum Order:</Trans>}>
          <span>{formatQuantity(item.minimumOrderQuantity)}</span>
        </PlanningSummaryRow>
      )}
      {item.maximumOrderQuantity > 0 && (
        <PlanningSummaryRow label={<Trans>Maximum Order:</Trans>}>
          <span>{formatQuantity(item.maximumOrderQuantity)}</span>
        </PlanningSummaryRow>
      )}
    </VStack>
  );
}

/** "3 More After Oct 12": takes in the suggested orders beyond the fence. */
export function BeyondFenceButton({
  count,
  fenceLabel,
  onClick
}: {
  count: number;
  fenceLabel: string | null;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<LuCalendarRange />}
          onClick={onClick}
        >
          <Plural
            value={count}
            one={`# More After ${fenceLabel}`}
            other={`# More After ${fenceLabel}`}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <Trans>
          Suggested orders required after this item's planning horizon. Extend
          the horizon to include them.
        </Trans>
      </TooltipContent>
    </Tooltip>
  );
}
