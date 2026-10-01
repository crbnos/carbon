// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  Combobox,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  HStack,
  Loading,
  PulsingDot,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition
} from "react";
import {
  LuBlocks,
  LuBookMarked,
  LuBox,
  LuCalendarClock,
  LuCalendarRange,
  LuChartNoAxesColumn,
  LuCircleCheck,
  LuCirclePlay,
  LuGroup,
  LuListTodo,
  LuSquareChartGantt,
  LuTrendingDown
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import {
  exportOnlyColumn,
  ItemThumbnail,
  MethodItemTypeIcon,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions, useUrlParams, useUser } from "~/hooks";
import { inventoryItemTypes } from "~/modules/inventory/inventory.models";
import { itemReorderingPolicies } from "~/modules/items/items.models";
import {
  clearOrdersCache,
  getProductionOrdersFromPlanning,
  getReorderPolicyDescription,
  ItemReorderPolicy
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { PlanningAction, ProductionOrder } from "~/modules/production";
import {
  PLANNING_ACTIONS_COLUMN,
  PLANNING_ACTIONS_SCOPE_MINE,
  PLANNING_ACTIONS_SCOPE_PARAM
} from "~/modules/production";
import {
  LatestOrderDateCell,
  latestOrderDateExportValue
} from "~/modules/production/ui/Planning/LatestOrderDate";
import {
  isApplyablePlanningAction,
  isNewSupplyAction,
  PlanningActionLines,
  PlanningActionsCell,
  planningActionsExportValue,
  usePlanningActionTypeOptions
} from "~/modules/production/ui/Planning/PlanningActionLines";
import {
  FirstNegativeDateCell,
  TimeFenceCell,
  useTimeFenceOverrides
} from "~/modules/production/ui/Planning/PlanningFence";
import {
  PlanningWeekStrip,
  planningWeekStripSize,
  planningWeekValues
} from "~/modules/production/ui/Planning/PlanningWeekStrip";
import {
  actionsInsideFence,
  splitOrdersByFence
} from "~/modules/production/ui/Planning/planning-fence";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { path } from "~/utils/path";
import type { ProductionPlanningItem } from "../../types";
import { ProductionPlanningOrderDrawer } from "./ProductionPlanningOrderDrawer";

type ProductionPlanningTableProps = {
  data: ProductionPlanningItem[];
  count: number;
  locationId: string;
  periods: { id: string; startDate: string; endDate: string }[];
  /** The persisted MRP worklist for the rows on this page (spec §P1.7),
   *  rendered as the Actions column + each item's expanded row. Every action
   *  is here whatever its date; the row's time fence decides what shows. */
  planningActions: PlanningAction[];
  /** Today on the location's calendar (ISO date). */
  locationToday: string;
};

const ProductionPlanningTable = ({
  data,
  count,
  locationId,
  periods,
  planningActions,
  locationToday
}: ProductionPlanningTableProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();

  const numberFormatter = useNumberFormatter();
  const locations = useLocations();
  const unitOfMeasures = useUnitOfMeasure();
  const itemPostingGroups = useItemPostingGroups();

  const mrpFetcher = useFetcher<typeof mrpAction>();
  const bulkUpdateFetcher = useFetcher<typeof bulkUpdateAction>();

  // ── Planning actions (the MRP worklist) ──────────────────────────────────
  const user = useUser();
  const [params, setParams] = useUrlParams();
  const canUpdateActions = permissions.can("update", "production");
  const actionTypeOptions = usePlanningActionTypeOptions("Make");
  const actionsFetcher = useFetcher<{ success?: boolean; message?: string }>();
  const isActionsBusy = actionsFetcher.state !== "idle";

  useEffect(() => {
    if (actionsFetcher.state !== "idle" || !actionsFetcher.data?.message)
      return;
    if (actionsFetcher.data.success) {
      toast.success(actionsFetcher.data.message);
    } else {
      toast.error(actionsFetcher.data.message);
    }
  }, [actionsFetcher.state, actionsFetcher.data]);

  const actionsByItemId = useMemo(() => {
    const map = new Map<string, PlanningAction[]>();
    for (const action of planningActions) {
      const list = map.get(action.itemId);
      if (list) list.push(action);
      else map.set(action.itemId, [action]);
    }
    return map;
  }, [planningActions]);

  // ── Time fence ─────────────────────────────────────────────────────────────
  // A row surfaces only what falls on or before its fence date (today + the
  // item's planning horizon). Moving a row's fence here is page state: it
  // re-filters what is already loaded and never touches the item.
  const timeFence = useTimeFenceOverrides();

  const visibleActionsByItemId = useMemo(() => {
    const map = new Map<string, PlanningAction[]>();
    for (const row of data) {
      const actions = actionsByItemId.get(row.id);
      if (!actions) continue;
      const visible = actionsInsideFence(actions, timeFence.fenceDateFor(row));
      if (visible.length > 0) map.set(row.id, visible);
    }
    return map;
  }, [data, actionsByItemId, timeFence]);

  // ONE batched request per click: the route derives each row's behaviour
  // from its persisted type, and a fetcher holds a single in-flight submission.
  const submitActions = useCallback(
    (payload: Record<string, unknown>) => {
      actionsFetcher.submit(JSON.stringify({ locationId, ...payload }), {
        method: "post",
        action: path.to.bulkUpdateProductionPlanning,
        encType: "application/json"
      });
    },
    [actionsFetcher, locationId]
  );

  const isAssignedToMe =
    params.get(PLANNING_ACTIONS_SCOPE_PARAM) === PLANNING_ACTIONS_SCOPE_MINE;

  // Clear cache when MRP completes
  useEffect(() => {
    if (mrpFetcher.state === "idle" && mrpFetcher.data) {
      clearOrdersCache();
      setOrdersMap({}); // Reset local state to force recalculation
    }
  }, [mrpFetcher.state, mrpFetcher.data]);

  // Clear local state when data changes (e.g., filters, search)
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    setOrdersMap({});
  }, [data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (
      bulkUpdateFetcher.data?.success === false &&
      bulkUpdateFetcher?.data?.message
    ) {
      toast.error(bulkUpdateFetcher.data.message);
      return;
    }

    if (bulkUpdateFetcher.data?.success === true) {
      const {
        jobs = [],
        updatedJobCount = 0,
        alreadyPlannedItemCount = 0,
        noDemandItemCount = 0
      } = bulkUpdateFetcher.data as {
        jobs?: { id: string; readableId: string }[];
        updatedJobCount?: number;
        alreadyPlannedItemCount?: number;
        noDemandItemCount?: number;
      };

      const skipped: string[] = [];
      if (alreadyPlannedItemCount > 0) {
        skipped.push(
          alreadyPlannedItemCount === 1
            ? t`1 part skipped — it already has an open job`
            : t`${alreadyPlannedItemCount} parts skipped — they already have open jobs`
        );
      }
      if (noDemandItemCount > 0) {
        skipped.push(
          noDemandItemCount === 1
            ? t`1 part skipped — nothing to make`
            : t`${noDemandItemCount} parts skipped — nothing to make`
        );
      }

      if (jobs.length === 0 && updatedJobCount === 0) {
        toast.info(
          skipped.length > 0 ? skipped.join(" · ") : t`No jobs were created`
        );
        return;
      }

      const created =
        jobs.length === 1 ? t`1 job created` : t`${jobs.length} jobs created`;
      const updated =
        updatedJobCount > 0
          ? updatedJobCount === 1
            ? t`1 job updated`
            : t`${updatedJobCount} jobs updated`
          : null;

      toast.success(
        <VStack spacing={1}>
          <span>{[created, updated].filter(Boolean).join(" · ")}</span>
          {jobs.length > 0 && (
            <span className="flex flex-wrap gap-2 text-xs">
              {jobs.slice(0, 2).map((job) => (
                <Link
                  key={job.id}
                  to={path.to.job(job.id)}
                  className="underline underline-offset-2 hover:opacity-80"
                >
                  {job.readableId}
                </Link>
              ))}
              {jobs.length > 2 && (
                <Link
                  to={path.to.jobs}
                  className="underline underline-offset-2 hover:opacity-80"
                >
                  {t`View all`}
                </Link>
              )}
            </span>
          )}
          {skipped.length > 0 && (
            <span className="text-xs opacity-80">{skipped.join(" · ")}</span>
          )}
        </VStack>,
        { duration: 8000 }
      );
    }
  }, [bulkUpdateFetcher.data?.success]);

  const isDisabled =
    !permissions.can("create", "production") ||
    bulkUpdateFetcher.state !== "idle" ||
    mrpFetcher.state !== "idle";

  // Store orders in a map keyed by item id - calculate on-demand instead of eagerly
  const [ordersMap, setOrdersMap] = useState<Record<string, ProductionOrder[]>>(
    {}
  );

  const [ordersByItemId, setOrdersByItemId] = useState<
    Map<string, ProductionOrder[]>
  >(new Map());

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onBulkUpdate = useCallback(
    (selectedRows: typeof data, action: "order") => {
      const payload = {
        locationId,
        items: selectedRows
          .filter((row) => row.id)
          .map((row) => {
            // Drawer edits win (even an emptied list); fall back to
            // auto-computed orders only for items never opened in the drawer.
            // The fallback stops at the row's time fence: a bulk order raises
            // what is due inside the planning horizon, not the whole window.
            const sourceOrders =
              row.id! in ordersMap
                ? ordersMap[row.id!]!
                : splitOrdersByFence(
                    ordersByItemId.get(row.id!) ?? [],
                    timeFence.fenceDateFor(row)
                  ).inside;
            const ordersWithPeriods = sourceOrders.map((order) => {
              // If no due date or due date is before first period, use first period
              if (
                !order.dueDate ||
                parseDate(order.dueDate) < parseDate(periods[0].startDate)
              ) {
                return {
                  ...order,
                  periodId: periods[0].id
                };
              }

              // Find matching period based on due date
              const period = periods.find((p) => {
                const dueDate = parseDate(order.dueDate!);
                const startDate = parseDate(p.startDate);
                const endDate = parseDate(p.endDate);
                return dueDate >= startDate && dueDate <= endDate;
              });

              // If no matching period found (date is after last period), use last period
              return {
                ...order,
                periodId: period?.id ?? periods[periods.length - 1].id
              };
            });

            return {
              id: row.id,
              orders: ordersWithPeriods
            };
          }),
        action: action
      };
      bulkUpdateFetcher.submit(payload, {
        method: "post",
        action: path.to.bulkUpdateProductionPlanning,
        encType: "application/json"
      });
    },

    [bulkUpdateFetcher, locationId, ordersMap, ordersByItemId, timeFence]
  );

  // Moving a row's fence changes which suggested orders its drawer opens on.
  // The drawer's list is kept per item once opened (planner edits win), so a
  // stale list would neither show the newly included orders nor offer them —
  // drop it and let the drawer re-seed from the new split.
  const setFenceDate = timeFence.setFenceDate;
  const onFenceChange = useCallback(
    (itemId: string, date: string | null) => {
      setFenceDate(itemId, date);
      setOrdersMap((prev) => {
        if (!(itemId in prev)) return prev;
        const { [itemId]: _dropped, ...rest } = prev;
        return rest;
      });
    },
    [setFenceDate]
  );

  const [selectedItem, setSelectedItem] =
    useState<ProductionPlanningItem | null>(null);

  const setOrders = useCallback(
    (item: ProductionPlanningItem, orders: ProductionOrder[]) => {
      if (item.id) {
        setOrdersMap((prev) => ({
          ...prev,
          [item.id!]: orders
        }));
      }
    },
    []
  );

  // The drawer's own Time Fence control: the same on-screen override as the
  // grid cell, for the row the drawer is open on.
  const selectedItemId = selectedItem?.id;
  const onSelectedFenceChange = useCallback(
    (date: string | null) => {
      if (selectedItemId) onFenceChange(selectedItemId, date);
    },
    [selectedItemId, onFenceChange]
  );

  // The drawer's suggested orders, split at the selected row's time fence: it
  // opens on what is due inside the fence and can pull the rest in.
  const selectedOrders = useMemo(() => {
    if (!selectedItem?.id) return { inside: [], beyond: [] };
    return splitOrdersByFence(
      getProductionOrdersFromPlanning(selectedItem, periods),
      timeFence.fenceDateFor(selectedItem)
    );
  }, [selectedItem, periods, timeFence]);

  // The drawer's Open Orders table shows the selected row's change actions on existing
  // jobs (Expedite, Defer, …). Order / Make actions are left out — each one
  // is already a "New" row in the drawer's order list, right above the table.
  const selectedActions = useMemo(
    () =>
      selectedItem?.id
        ? (visibleActionsByItemId.get(selectedItem.id) ?? []).filter(
            (action) => !isNewSupplyAction(action)
          )
        : [],
    [selectedItem, visibleActionsByItemId]
  );

  // The drawer's Open Orders rows carry the same Apply / Dismiss / Reopen /
  // Assign controls as the expanded row, through the same single fetcher.
  const userId = user.id;
  const actionHandlers = useMemo(
    () => ({
      currentUserId: userId,
      canUpdate: canUpdateActions,
      isBusy: isActionsBusy,
      onApply: (ids: string[]) =>
        submitActions({ action: "apply", planningActionIds: ids }),
      onDismiss: (ids: string[]) =>
        submitActions({ action: "dismiss", planningActionIds: ids }),
      onReopen: (ids: string[]) =>
        submitActions({ action: "reopen", planningActionIds: ids }),
      onAssignToMe: (ids: string[]) =>
        submitActions({
          action: "assign",
          planningActionIds: ids,
          assignee: userId
        })
    }),
    [userId, canUpdateActions, isActionsBusy, submitActions]
  );

  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    startTransition(() => {
      const ordersByItemId = new Map<string, ProductionOrder[]>();
      data.forEach((item) => {
        ordersByItemId.set(
          item.id,
          getProductionOrdersFromPlanning(item, periods)
        );
      });
      setOrdersByItemId(ordersByItemId);
    });
  }, [data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const columns = useMemo<ColumnDef<ProductionPlanningItem>[]>(() => {
    // The grid shows every week as one bar in a strip; the CSV keeps a
    // column per week so an export still carries the numbers.
    const periodColumns: ColumnDef<ProductionPlanningItem>[] = [
      {
        id: "stockAvailability",
        header: t`Stock Availability`,
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
        const weekKey = `week${weekNumber}` as keyof ProductionPlanningItem;
        return exportOnlyColumn<ProductionPlanningItem>({
          id: weekKey,
          header: index === 0 ? t`Present Week` : t`Week ${weekNumber}`,
          value: (row) => {
            const value = row[weekKey] as number | undefined;
            return value === undefined ? null : value;
          }
        });
      })
    ];

    return [
      {
        accessorKey: "readableIdWithRevision",
        header: t`Part ID`,
        cell: ({ row }) => (
          <HStack
            className="py-1 cursor-pointer"
            onClick={() => {
              setSelectedItem(row.original);
            }}
          >
            <ItemThumbnail
              size="sm"
              thumbnailPath={row.original.thumbnailPath}
              // @ts-ignore
              type={row.original.type}
            />

            <VStack spacing={0} className="font-medium">
              {row.original.readableIdWithRevision}
              <div className="w-full truncate text-muted-foreground text-xs">
                {row.original.name}
              </div>
            </VStack>
          </HStack>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      exportOnlyColumn<ProductionPlanningItem>({
        id: "itemName",
        header: t`Item Name`,
        value: (row) => row.name ?? null
      }),
      {
        id: PLANNING_ACTIONS_COLUMN,
        header: t`Actions`,
        cell: ({ row }) => (
          <PlanningActionsCell
            actions={visibleActionsByItemId.get(row.original.id) ?? []}
          />
        ),
        meta: {
          icon: <LuListTodo />,
          pluralHeader: t`Actions`,
          filter: {
            type: "static",
            options: actionTypeOptions
          },
          exportValue: (row: ProductionPlanningItem) =>
            planningActionsExportValue(visibleActionsByItemId.get(row.id) ?? [])
        }
      },
      {
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
          filterHeader: t`Unit of Measure`,
          exportValue: (row: ProductionPlanningItem) =>
            unitOfMeasures.find((uom) => uom.value === row.unitOfMeasureCode)
              ?.label ?? null
        }
      },
      {
        accessorKey: "itemPostingGroupId",
        header: t`Item Group`,
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
          exportValue: (row: ProductionPlanningItem) =>
            itemPostingGroups.find(
              (group) => group.value === row.itemPostingGroupId
            )?.label ?? null
        }
      },
      {
        accessorKey: "reorderingPolicy",
        header: t`Reorder Policy`,
        cell: ({ row }) => {
          return (
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
          );
        },
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
      },
      {
        accessorKey: "quantityOnHand",
        header: t`On Hand`,
        cell: ({ row }) => numberFormatter.format(row.original.quantityOnHand),
        meta: {
          icon: <LuBlocks />,
          renderTotal: true
        }
      },
      ...periodColumns,
      {
        accessorKey: "firstNegativeDate",
        header: t`1st Negative On Hand`,
        cell: ({ row }) => (
          <FirstNegativeDateCell
            date={row.original.firstNegativeDate}
            todayIso={locationToday}
          />
        ),
        meta: {
          icon: <LuTrendingDown />
        }
      },
      {
        accessorKey: "quantityToOrder",
        header: t`Qty to Order`,
        cell: ({ row }) => {
          const value = row.original.quantityToOrder;
          if (value === undefined || value === 0) return "-";
          return (
            <span className="font-medium">{numberFormatter.format(value)}</span>
          );
        },
        meta: {
          icon: <LuCirclePlay />
        }
      },
      {
        // Sorted by the order-by date MRP stored on the item's open new-supply
        // actions; the cell shows the live sizing the order drawer uses, which
        // matches it as of the last MRP run.
        accessorKey: "latestOrderDate",
        header: t`Latest Order Date`,
        cell: ({ row }) => (
          <LatestOrderDateCell itemPlanning={row.original} periods={periods} />
        ),
        meta: {
          icon: <LuCalendarClock />,
          exportValue: (row: ProductionPlanningItem) =>
            latestOrderDateExportValue(row, periods)
        }
      },
      {
        accessorKey: "timeFenceDate",
        header: t`Time Fence`,
        cell: ({ row }) => (
          <TimeFenceCell
            fenceDate={timeFence.fenceDateFor(row.original)}
            isOverridden={timeFence.isOverridden(row.original)}
            onChange={(date) => onFenceChange(row.original.id, date)}
          />
        ),
        meta: {
          icon: <LuCalendarRange />,
          exportValue: (row: ProductionPlanningItem) =>
            timeFence.fenceDateFor(row)
        }
      },
      {
        accessorKey: "type",
        header: t`Type`,
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
              .filter((t) => ["Part", "Tool"].includes(t))
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
      },
      {
        id: "Order",
        header: "",
        cell: ({ row }) => {
          // only what is due inside the row's time fence
          const orders = row.original.id
            ? splitOrdersByFence(
                ordersByItemId.get(row.original.id) ?? [],
                timeFence.fenceDateFor(row.original)
              ).inside
            : [];
          const orderQuantity = orders.reduce(
            (acc, order) =>
              acc + (order.quantity - (order.existingQuantity ?? 0)),
            0
          );
          const isBlocked = row.original.manufacturingBlocked;
          const hasOrders = orders.length > 0 && orderQuantity > 0;
          return (
            <div className="flex justify-end">
              <Button
                variant="secondary"
                leftIcon={hasOrders ? undefined : <LuCircleCheck />}
                isDisabled={isDisabled || isBlocked}
                onClick={() => {
                  setSelectedItem(row.original);
                }}
              >
                {isBlocked ? (
                  "Blocked"
                ) : hasOrders ? (
                  <HStack>
                    <PulsingDot />
                    <span>Make {orderQuantity}</span>
                  </HStack>
                ) : (
                  "Make"
                )}
              </Button>
            </div>
          );
        }
      }
    ];
  }, [
    numberFormatter,
    unitOfMeasures,
    isDisabled,
    visibleActionsByItemId,
    actionTypeOptions,
    itemPostingGroups,
    ordersByItemId,
    timeFence,
    locationToday
    // Note: ordersMap is intentionally not in deps to avoid column regeneration
    // getOrdersForItem inside the cell will access the latest ordersMap via closure
  ]);

  const renderActions = useCallback(
    (selectedRows: typeof data) => {
      // inside each row's time fence only — what the row is showing
      const applyableIds = selectedRows.flatMap((row) =>
        (visibleActionsByItemId.get(row.id) ?? [])
          .filter(isApplyablePlanningAction)
          .map((action) => action.id)
      );
      return (
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuLabel>
            <Trans>Update</Trans>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => onBulkUpdate(selectedRows, "order")}
            disabled={bulkUpdateFetcher.state !== "idle"}
          >
            <DropdownMenuIcon icon={<LuSquareChartGantt />} />
            <Trans>Create Jobs</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={
              !canUpdateActions || applyableIds.length === 0 || isActionsBusy
            }
            onSelect={() =>
              submitActions({
                action: "apply",
                planningActionIds: applyableIds
              })
            }
          >
            <DropdownMenuIcon icon={<LuListTodo />} />
            <Trans>Apply Suggested Changes</Trans>
            {applyableIds.length > 0 && (
              <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                {applyableIds.length}
              </span>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      );
    },
    [
      bulkUpdateFetcher.state,
      onBulkUpdate,
      visibleActionsByItemId,
      canUpdateActions,
      isActionsBusy,
      submitActions
    ]
  );

  const canExpandRow = useCallback(
    (row: ProductionPlanningItem) =>
      (visibleActionsByItemId.get(row.id)?.length ?? 0) > 0,
    [visibleActionsByItemId]
  );

  const renderExpandedRow = useCallback(
    (row: ProductionPlanningItem) => (
      <PlanningActionLines
        actions={visibleActionsByItemId.get(row.id) ?? []}
        currentUserId={user.id}
        canUpdate={canUpdateActions}
        isBusy={isActionsBusy}
        onApply={(ids) =>
          submitActions({ action: "apply", planningActionIds: ids })
        }
        onDismiss={(ids) =>
          submitActions({ action: "dismiss", planningActionIds: ids })
        }
        onReopen={(ids) =>
          submitActions({ action: "reopen", planningActionIds: ids })
        }
        onAssignToMe={(ids) =>
          submitActions({
            action: "assign",
            planningActionIds: ids,
            assignee: user.id
          })
        }
        onOrder={() => setSelectedItem(row)}
      />
    ),
    [
      visibleActionsByItemId,
      user.id,
      canUpdateActions,
      isActionsBusy,
      submitActions
    ]
  );

  const headerActions = (
    <Switch
      variant="small"
      label={t`Assigned to me`}
      checked={isAssignedToMe}
      onCheckedChange={(checked) =>
        setParams({
          [PLANNING_ACTIONS_SCOPE_PARAM]: checked
            ? PLANNING_ACTIONS_SCOPE_MINE
            : null,
          // the result set changes — reset paging like SearchFilter does
          offset: null
        })
      }
    />
  );

  const defaultColumnVisibility = {
    type: false
  };

  const defaultColumnPinning = {
    left: ["readableIdWithRevision"],
    right: ["Order"]
  };

  return (
    <Loading isLoading={isPending}>
      <Table<ProductionPlanningItem>
        count={count}
        columns={columns}
        data={data}
        defaultColumnVisibility={defaultColumnVisibility}
        defaultColumnPinning={defaultColumnPinning}
        primaryAction={
          <div className="flex items-center gap-2">
            <Combobox
              asButton
              size="sm"
              value={locationId}
              options={locations}
              onChange={(selected) => {
                // hard refresh because initialValues update has no effect otherwise
                window.location.href = getLocationPath(selected);
              }}
            />
            <mrpFetcher.Form method="post" action={path.to.api.mrp(locationId)}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="submit"
                    variant="secondary"
                    rightIcon={<LuCirclePlay />}
                    isDisabled={mrpFetcher.state !== "idle"}
                    isLoading={mrpFetcher.state !== "idle"}
                  >
                    <Trans>Recalculate</Trans>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <Trans>
                    MRP runs automatically every 3 hours, but you can run it
                    manually here.
                  </Trans>
                </TooltipContent>
              </Tooltip>
            </mrpFetcher.Form>
          </div>
        }
        renderActions={renderActions}
        renderExpandedRow={renderExpandedRow}
        canExpandRow={canExpandRow}
        headerActions={headerActions}
        title={t`Material Planning`}
        table="production-planning"
        withSavedView
        withSelectableRows
      />

      {selectedItem && (
        <ProductionPlanningOrderDrawer
          locationId={locationId}
          row={selectedItem}
          orders={
            selectedItem.id
              ? ordersMap[selectedItem.id] || selectedOrders.inside
              : []
          }
          beyondFenceOrders={selectedOrders.beyond}
          timeFenceDate={timeFence.fenceDateFor(selectedItem)}
          isTimeFenceOverridden={timeFence.isOverridden(selectedItem)}
          onTimeFenceChange={onSelectedFenceChange}
          actions={selectedActions}
          actionHandlers={actionHandlers}
          setOrders={setOrders}
          periods={periods}
          isOpen={!!selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </Loading>
  );
};

export default ProductionPlanningTable;

function getLocationPath(locationId: string) {
  return `${path.to.productionPlanning}?location=${locationId}`;
}
