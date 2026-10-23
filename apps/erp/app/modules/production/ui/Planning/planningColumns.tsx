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
  LuFolderKanban,
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
import type { ProductionPlanningItem } from "~/modules/production/types";
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
import type { PurchasingPlanningItem } from "~/modules/purchasing/types";
import {
  COMMON_SEGMENT_OPTION,
  PLANNING_SEGMENT_COLUMN
} from "./planning-action-scope";

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
  timeFence: msg`Planning Horizon`,
  type: msg`Type`,
  segment: msg`Segment`,
  common: msg`Common`
};

const weekLabel = (weekNumber: number) => msg`Week ${weekNumber}`;

type PlanningRow = ProductionPlanningItem | PurchasingPlanningItem;
type Option = { value: string; label: string };
/** A project that nets in its own segment: one with project stock. */
export type PlanningSegmentProject = {
  id: string;
  identifier: string | null;
  name: string;
};

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
  formatQuantity: (quantity: number) => string;
  unitOfMeasures: Option[];
  itemPostingGroups: Option[];
  timeFence: ReturnType<typeof useTimeFenceOverrides>;
  onFenceChange: (itemId: string, date: string | null) => void;
  segmentProjects: PlanningSegmentProject[];
}) {
  const {
    i18n,
    periods,
    locationToday,
    formatQuantity,
    unitOfMeasures,
    itemPostingGroups,
    timeFence,
    onFenceChange,
    segmentProjects
  } = ctx;

  // A row's segment: Common, or the project's identifier and name.
  const segmentProjectById = new Map(segmentProjects.map((p) => [p.id, p]));
  const segmentLabel = (segmentId: string | null | undefined) => {
    if (!segmentId) return i18n._(LABELS.common);
    const project = segmentProjectById.get(segmentId);
    return project
      ? [project.identifier, project.name].filter(Boolean).join(" ")
      : segmentId;
  };

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
      cell: ({ row }) => formatQuantity(row.original.quantityOnHand),
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
      // The order-by date MRP stored on the item's open new-supply actions —
      // the same actions the order drawer lists — so cell, sort and drawer
      // agree.
      accessorKey: "latestOrderDate",
      header: i18n._(LABELS.latestOrderDate),
      cell: ({ row }) => (
        <LatestOrderDateCell
          itemPlanning={row.original}
          todayIso={locationToday}
        />
      ),
      meta: {
        icon: <LuCalendarClock />,
        exportValue: latestOrderDateExportValue
      }
    } as ColumnDef<PlanningRow>,
    timeFence: {
      accessorKey: "timeFenceDate",
      header: i18n._(LABELS.timeFence),
      cell: ({ row }) => (
        // The row toggles its expanded actions on click. React events bubble
        // through the calendar's portal, so every click in the picker would
        // reach the row without this.
        <div onClick={(event) => event.stopPropagation()}>
          <TimeFenceCell
            fenceDate={timeFence.fenceDateFor(row.original)}
            isOverridden={timeFence.isOverridden(row.original)}
            onChange={(date) => onFenceChange(row.original.id, date)}
          />
        </div>
      ),
      meta: {
        icon: <LuCalendarRange />,
        exportValue: (row: PlanningRow) => timeFence.fenceDateFor(row)
      }
    } as ColumnDef<PlanningRow>,
    // The netting segment of the row: Common, or a project with project
    // stock. The filter writes `planningSegment`, which the loader turns into
    // a filter on `planningSegmentId` (Common is the empty id).
    segment: {
      id: PLANNING_SEGMENT_COLUMN,
      header: i18n._(LABELS.segment),
      cell: ({ row }) => {
        const segmentId = row.original.planningSegmentId;
        const project = segmentId ? segmentProjectById.get(segmentId) : null;
        if (!segmentId) {
          return (
            <span className="text-muted-foreground">
              {i18n._(LABELS.common)}
            </span>
          );
        }
        return (
          <HStack spacing={2} className="min-w-0">
            <span className="whitespace-nowrap font-medium">
              {project?.identifier ?? segmentId}
            </span>
            {project?.name && (
              <span className="truncate text-muted-foreground">
                {project.name}
              </span>
            )}
          </HStack>
        );
      },
      meta: {
        icon: <LuFolderKanban />,
        filter: {
          type: "static",
          options: [
            { value: COMMON_SEGMENT_OPTION, label: i18n._(LABELS.common) },
            ...segmentProjects.map((project) => ({
              value: project.id,
              label: segmentLabel(project.id)
            }))
          ]
        },
        exportValue: (row: PlanningRow) => segmentLabel(row.planningSegmentId)
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
