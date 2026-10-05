// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { ColumnDef } from "@tanstack/react-table";
import {
  LuBlocks,
  LuBox,
  LuCalendarClock,
  LuCalendarRange,
  LuChartNoAxesColumn,
  LuCircleCheck,
  LuGroup,
  LuTrendingDown
} from "react-icons/lu";
import { exportOnlyColumn, MethodItemTypeIcon } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { inventoryItemTypes } from "~/modules/inventory/inventory.models";
import { itemReorderingPolicies } from "~/modules/items/items.models";
import {
  getReorderPolicyDescription,
  ItemReorderPolicy
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { ProductionPlanningItem } from "~/modules/production";
import {
  LatestOrderDateCell,
  latestOrderDateExportValue
} from "~/modules/production/ui/Planning/LatestOrderDate";
import {
  FirstNegativeDateCell,
  TimeFenceCell,
  type useTimeFenceOverrides
} from "~/modules/production/ui/Planning/PlanningFence";
import {
  PlanningWeekStrip,
  planningWeekStripSize,
  planningWeekValues
} from "~/modules/production/ui/Planning/PlanningWeekStrip";
import type { PurchasingPlanningItem } from "~/modules/purchasing";

// Labels as descriptors: this factory is not a component, so it cannot use
// `useLingui`'s `t`; the grid's `i18n` renders them.
const LABELS = {
  stockAvailability: msg`Stock Availability`,
  presentWeek: msg`Present Week`,
  unitOfMeasure: msg`Unit of Measure`,
  itemGroup: msg`Item Group`,
  reorderPolicy: msg`Reorder Policy`,
  onHand: msg`On Hand`,
  firstNegativeDate: msg`1st Negative On Hand`,
  latestOrderDate: msg`Latest Order Date`,
  timeFence: msg`Time Fence`,
  type: msg`Type`
};

const weekLabel = (weekNumber: number) => msg`Week ${weekNumber}`;

type PlanningRow = ProductionPlanningItem | PurchasingPlanningItem;
type Option = { value: string; label: string };

/**
 * The columns the production and purchasing planning grids share, built once.
 * Each grid keeps its own order and its own columns (item link, supplier,
 * lead time, quantity to order, the Order button) around these. They were two
 * copies that differed only in the row type.
 *
 * `accessorKey` is typed against the union of the two row types, which the
 * grid's own row type narrows; the cast at the end is that narrowing.
 *
 * Labels come from `LABELS` and render through the grid's `i18n`.
 */
export function planningColumns<T extends PlanningRow>(ctx: {
  i18n: I18n;
  periods: { id: string; startDate: string; endDate: string }[];
  locationToday: string;
  numberFormatter: Intl.NumberFormat;
  unitOfMeasures: Option[];
  itemPostingGroups: Option[];
  timeFence: ReturnType<typeof useTimeFenceOverrides>;
  onFenceChange: (itemId: string, date: string | null) => void;
}) {
  const {
    i18n,
    periods,
    locationToday,
    numberFormatter,
    unitOfMeasures,
    itemPostingGroups,
    timeFence,
    onFenceChange
  } = ctx;

  const columns = {
    // The grid shows every week as one bar in a strip; the CSV keeps a column
    // per week so an export still carries the numbers.
    periods: [
      {
        id: "stockAvailability",
        header: i18n._(LABELS.stockAvailability),
        cell: ({ row }) => (
          <PlanningWeekStrip
            periods={periods}
            values={planningWeekValues(row.original, periods)}
          />
        ),
        size: planningWeekStripSize(periods.length),
        meta: {
          icon: <LuChartNoAxesColumn />
        }
      },
      ...periods.map((_, index) => {
        const weekNumber = index + 1;
        const weekKey = `week${weekNumber}` as keyof PlanningRow;
        return exportOnlyColumn<PlanningRow>({
          id: weekKey,
          header:
            index === 0
              ? i18n._(LABELS.presentWeek)
              : i18n._(weekLabel(weekNumber)),
          value: (row) => {
            const value = row[weekKey] as number | undefined;
            return value === undefined ? null : value;
          }
        });
      })
    ] as ColumnDef<PlanningRow>[],
    unitOfMeasure: {
      accessorKey: "unitOfMeasureCode",
      header: "",
      cell: ({ row }) => (
        <Enumerable
          value={
            unitOfMeasures.find(
              (uom) => uom.value === row.original.unitOfMeasureCode
            )?.label ?? null
          }
        />
      ),
      meta: {
        filterHeader: i18n._(LABELS.unitOfMeasure),
        exportValue: (row: PlanningRow) =>
          unitOfMeasures.find((uom) => uom.value === row.unitOfMeasureCode)
            ?.label ?? null
      }
    } as ColumnDef<PlanningRow>,
    itemGroup: {
      accessorKey: "itemPostingGroupId",
      header: i18n._(LABELS.itemGroup),
      cell: ({ row }) => {
        const label = itemPostingGroups.find(
          (group) => group.value === row.original.itemPostingGroupId
        )?.label;
        return label ? <Badge variant="secondary">{label}</Badge> : null;
      },
      meta: {
        filter: {
          type: "static",
          options: itemPostingGroups.map((group) => ({
            value: group.value,
            label: <Badge variant="secondary">{group.label}</Badge>
          }))
        },
        icon: <LuGroup />,
        exportValue: (row: PlanningRow) =>
          itemPostingGroups.find(
            (group) => group.value === row.itemPostingGroupId
          )?.label ?? null
      }
    } as ColumnDef<PlanningRow>,
    reorderPolicy: {
      accessorKey: "reorderingPolicy",
      header: i18n._(LABELS.reorderPolicy),
      cell: ({ row }) => (
        <HStack>
          <Tooltip>
            <TooltipTrigger>
              <ItemReorderPolicy
                reorderingPolicy={row.original.reorderingPolicy}
              />
            </TooltipTrigger>
            <TooltipContent>
              {getReorderPolicyDescription(row.original)}
            </TooltipContent>
          </Tooltip>
        </HStack>
      ),
      meta: {
        filter: {
          type: "static",
          options: itemReorderingPolicies.map((policy) => ({
            label: <ItemReorderPolicy reorderingPolicy={policy} />,
            value: policy
          }))
        },
        icon: <LuCircleCheck />
      }
    } as ColumnDef<PlanningRow>,
    onHand: {
      accessorKey: "quantityOnHand",
      header: i18n._(LABELS.onHand),
      cell: ({ row }) => numberFormatter.format(row.original.quantityOnHand),
      meta: {
        icon: <LuBlocks />,
        renderTotal: true
      }
    } as ColumnDef<PlanningRow>,
    firstNegativeDate: {
      accessorKey: "firstNegativeDate",
      header: i18n._(LABELS.firstNegativeDate),
      cell: ({ row }) => (
        <FirstNegativeDateCell
          date={row.original.firstNegativeDate}
          todayIso={locationToday}
        />
      ),
      meta: {
        icon: <LuTrendingDown />
      }
    } as ColumnDef<PlanningRow>,
    latestOrderDate: {
      // Sorted by the order-by date MRP stored on the item's open new-supply
      // actions; the cell shows the live sizing the order drawer uses, which
      // matches it as of the last MRP run.
      accessorKey: "latestOrderDate",
      header: i18n._(LABELS.latestOrderDate),
      cell: ({ row }) => (
        <LatestOrderDateCell
          itemPlanning={row.original}
          periods={periods}
          todayIso={locationToday}
        />
      ),
      meta: {
        icon: <LuCalendarClock />,
        exportValue: (row: PlanningRow) =>
          latestOrderDateExportValue(row, periods, locationToday)
      }
    } as ColumnDef<PlanningRow>,
    timeFence: {
      accessorKey: "timeFenceDate",
      header: i18n._(LABELS.timeFence),
      cell: ({ row }) => (
        <TimeFenceCell
          fenceDate={timeFence.fenceDateFor(row.original)}
          isOverridden={timeFence.isOverridden(row.original)}
          onChange={(date) => onFenceChange(row.original.id, date)}
        />
      ),
      meta: {
        icon: <LuCalendarRange />,
        exportValue: (row: PlanningRow) => timeFence.fenceDateFor(row)
      }
    } as ColumnDef<PlanningRow>,
    type: {
      accessorKey: "type",
      header: i18n._(LABELS.type),
      cell: ({ row }) =>
        row.original.type && (
          <HStack>
            <MethodItemTypeIcon type={row.original.type} />
            <span>{row.original.type}</span>
          </HStack>
        ),
      meta: {
        filter: {
          type: "static",
          options: inventoryItemTypes
            .filter((type) => ["Part", "Tool"].includes(type))
            .map((type) => ({
              label: (
                <HStack spacing={2}>
                  <MethodItemTypeIcon type={type} />
                  <span>{type}</span>
                </HStack>
              ),
              value: type
            }))
        },
        icon: <LuBox />
      }
    } as ColumnDef<PlanningRow>
  };

  return columns as unknown as {
    [K in keyof typeof columns]: (typeof columns)[K] extends unknown[]
      ? ColumnDef<T>[]
      : ColumnDef<T>;
  };
}
