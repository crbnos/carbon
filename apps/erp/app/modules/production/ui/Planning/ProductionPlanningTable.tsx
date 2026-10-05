// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
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
  LuBookMarked,
  LuCircleCheck,
  LuCirclePlay,
  LuListTodo,
  LuSquareChartGantt,
  LuUserCheck
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import {
  EmployeeAvatarGroup,
  exportOnlyColumn,
  ItemThumbnail,
  Table
} from "~/components";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import {
  useDrawerItem,
  useMrpScheduleDescription,
  usePermissions,
  useUser
} from "~/hooks";
import {
  clearOrdersCache,
  getProductionOrdersFromPlanning
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { PlanningAction, ProductionOrder } from "~/modules/production";
import {
  PLANNING_ACTIONS_COLUMN,
  PLANNING_ASSIGNEE_COLUMN
} from "~/modules/production";
import {
  isApplyablePlanningAction,
  isNewSupplyAction,
  PlanningActionLines,
  PlanningActionsCell,
  planningActionsExportValue,
  usePlanningActionTypeOptions
} from "~/modules/production/ui/Planning/PlanningActionLines";
import { splitOrdersByFence } from "~/modules/production/ui/Planning/planning-fence";
import { planningColumns } from "~/modules/production/ui/Planning/planningColumns";
import { usePlanningActions } from "~/modules/production/ui/Planning/usePlanningActions";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { usePeople } from "~/stores";
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
  /** The Actions-column filter in effect; null when the grid is not filtered
   *  by action type. */
  actionTypes: string[] | null;
  /** Today on the location's calendar (ISO date). */
  locationToday: string;
};

// `useNumberFormatter()` with no argument builds a new formatter on EVERY render:
// react-aria memoizes on the options object, and a default `{}` is a new object
// each time. The formatter is a dependency of `columns`, so every render of this
// table rebuilt the columns, which remounts every cell — opening the order
// drawer did it six times over. One shared options object keeps it stable.
const NUMBER_FORMAT_OPTIONS: Intl.NumberFormatOptions = {};

const ProductionPlanningTable = ({
  data,
  count,
  locationId,
  periods,
  planningActions,
  actionTypes,
  locationToday
}: ProductionPlanningTableProps) => {
  const permissions = usePermissions();
  const { t, i18n } = useLingui();

  const numberFormatter = useNumberFormatter(NUMBER_FORMAT_OPTIONS);
  const locations = useLocations();
  const unitOfMeasures = useUnitOfMeasure();
  const itemPostingGroups = useItemPostingGroups();

  const mrpFetcher = useAction<typeof mrpAction>({
    onSettled: (data) => {
      if (data) {
        clearOrdersCache();
        setOrdersMap({}); // Reset local state to force recalculation
      }
    }
  });
  const mrpScheduleDescription = useMrpScheduleDescription();

  // ── Planning actions (the MRP worklist) ──────────────────────────────────
  const user = useUser();
  const canUpdateActions = permissions.can("update", "production");
  const actionTypeOptions = usePlanningActionTypeOptions("Make");
  const [people] = usePeople();
  const {
    actionHandlers,
    isActionsBusy,
    timeFence,
    fencedActionsByItemId,
    visibleActionsByItemId,
    submitActions
  } = usePlanningActions({
    data,
    planningActions,
    actionTypes,
    locationId,
    updatePath: path.to.bulkUpdateProductionPlanning,
    currentUserId: user.id,
    canUpdate: canUpdateActions
  });
  const bulkUpdateFetcher = useFetcher<typeof bulkUpdateAction>();

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

  // The drawer stays mounted, on the last selected part, while it slides out.
  const {
    item: selectedItem,
    isOpen: isDrawerOpen,
    key: drawerKey,
    open: openDrawer,
    close: closeDrawer
  } = useDrawerItem<ProductionPlanningItem>();

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

  // The drawer's own Planning Horizon control: the same on-screen override as
  // the grid cell, for the row the drawer is open on.
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
      getProductionOrdersFromPlanning(selectedItem, periods, locationToday),
      timeFence.fenceDateFor(selectedItem)
    );
  }, [selectedItem, periods, timeFence, locationToday]);

  // The drawer's Open Orders table shows the selected row's change actions on existing
  // jobs (Expedite, Defer, …). Order / Make actions are left out — each one
  // is already a "New" row in the drawer's order list, right above the table.
  const selectedActions = useMemo(
    () =>
      selectedItem?.id
        ? (fencedActionsByItemId.get(selectedItem.id) ?? []).filter(
            (action) => !isNewSupplyAction(action)
          )
        : [],
    [selectedItem, fencedActionsByItemId]
  );

  // The drawer's Open Orders rows carry the same Apply / Dismiss / Reopen /
  // Assign controls as the expanded row, through the same single fetcher.

  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    startTransition(() => {
      const ordersByItemId = new Map<string, ProductionOrder[]>();
      data.forEach((item) => {
        ordersByItemId.set(
          item.id,
          getProductionOrdersFromPlanning(item, periods, locationToday)
        );
      });
      setOrdersByItemId(ordersByItemId);
    });
  }, [data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const columns = useMemo<ColumnDef<ProductionPlanningItem>[]>(() => {
    const shared = planningColumns<ProductionPlanningItem>({
      i18n,
      periods,
      locationToday,
      numberFormatter,
      unitOfMeasures,
      itemPostingGroups,
      timeFence,
      onFenceChange
    });

    return [
      {
        accessorKey: "readableIdWithRevision",
        header: t`Part ID`,
        cell: ({ row }) => (
          <HStack
            className="py-1 cursor-pointer"
            onClick={(event) => {
              // The row itself toggles its expanded actions on click; this
              // opens the drawer instead, so the click must not reach it.
              event.stopPropagation();
              openDrawer(row.original);
            }}
          >
            <ItemThumbnail
              size="sm"
              thumbnailPath={row.original.thumbnailPath}
              // @ts-expect-error
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
        id: PLANNING_ASSIGNEE_COLUMN,
        header: t`Assignee`,
        cell: ({ row }) => (
          <EmployeeAvatarGroup
            employeeIds={[
              ...new Set(
                (visibleActionsByItemId.get(row.original.id) ?? []).flatMap(
                  (action) => (action.assignee ? [action.assignee] : [])
                )
              )
            ]}
          />
        ),
        meta: {
          icon: <LuUserCheck />,
          pluralHeader: t`Assignees`,
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          exportValue: (row: ProductionPlanningItem) =>
            [
              ...new Set(
                (visibleActionsByItemId.get(row.id) ?? []).flatMap((action) =>
                  action.assignee ? [action.assignee] : []
                )
              )
            ]
              .map(
                (id) => people.find((person) => person.id === id)?.name ?? id
              )
              .join(", ")
        }
      },
      shared.unitOfMeasure,
      shared.itemGroup,
      shared.reorderPolicy,
      shared.onHand,
      ...shared.periods,
      shared.firstNegativeDate,
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
      shared.latestOrderDate,
      shared.timeFence,
      shared.type,
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
                onClick={(event) => {
                  event.stopPropagation();
                  openDrawer(row.original);
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
    people,
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
        todayIso={locationToday}
        {...actionHandlers}
        onOrder={() => openDrawer(row)}
      />
    ),
    [visibleActionsByItemId, locationToday, actionHandlers, openDrawer]
  );

  const defaultColumnVisibility = {
    // carries the Assignee filter; the avatars are opt-in
    [PLANNING_ASSIGNEE_COLUMN]: false,
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
                <TooltipContent>{mrpScheduleDescription}</TooltipContent>
              </Tooltip>
            </mrpFetcher.Form>
          </div>
        }
        renderActions={renderActions}
        renderExpandedRow={renderExpandedRow}
        pinExpandedRows
        canExpandRow={canExpandRow}
        title={t`Material Planning`}
        table="production-planning"
        withSavedView
        withSelectableRows
      />

      {selectedItem && (
        <ProductionPlanningOrderDrawer
          key={drawerKey}
          locationToday={locationToday}
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
          isOpen={isDrawerOpen}
          onClose={closeDrawer}
        />
      )}
    </Loading>
  );
};

export default ProductionPlanningTable;

function getLocationPath(locationId: string) {
  return `${path.to.productionPlanning}?location=${locationId}`;
}
