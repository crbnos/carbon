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
  PulsingDot,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { distinctItemText } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCircleCheck,
  LuCirclePlay,
  LuListTodo,
  LuSquareChartGantt,
  LuUserCheck
} from "react-icons/lu";
import { Link, useFetcher, useSearchParams } from "react-router";
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
  useLinkedDrawerItem,
  useMrpScheduleDescription,
  usePermissions,
  useQuantityFormatter,
  useUser
} from "~/hooks";
import type { PlanningAction, ProductionOrder } from "~/modules/production";
import {
  PLANNING_ACTIONS_COLUMN,
  PLANNING_ASSIGNEE_COLUMN,
  PLANNING_DRAWER_PARAM
} from "~/modules/production";
import {
  isApplyablePlanningAction,
  isNewSupplyAction,
  PlanningActionLines,
  PlanningActionsCell,
  planningActionDot,
  planningActionsExportValue,
  usePlanningActionTypeOptions
} from "~/modules/production/ui/Planning/PlanningActionLines";
import {
  openNewSupplyActions,
  productionOrdersFromActions
} from "~/modules/production/ui/Planning/planned-orders-from-actions";
import { splitOrdersByFence } from "~/modules/production/ui/Planning/planning-fence";
import { planningColumns } from "~/modules/production/ui/Planning/planningColumns";
import { useJobPlanningRelease } from "~/modules/production/ui/Planning/useJobPlanningRelease";
import { usePlanningActions } from "~/modules/production/ui/Planning/usePlanningActions";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { ProductionPlanningItem } from "../../types";
import { ProductionPlanningOrderDrawer } from "./ProductionPlanningOrderDrawer";

type ProductionPlanningTableProps = {
  data: ProductionPlanningItem[];
  /** The row a `?item=` link opens the drawer on when it is not in `data`. */
  drawerItem: ProductionPlanningItem | null;
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

const ProductionPlanningTable = ({
  data,
  drawerItem,
  count,
  locationId,
  periods,
  planningActions,
  actionTypes,
  locationToday
}: ProductionPlanningTableProps) => {
  const permissions = usePermissions();
  const { t, i18n } = useLingui();

  // Memoized on the locale, so it never rebuilds `columns` on its own.
  const formatQuantity = useQuantityFormatter();
  const locations = useLocations();
  const unitOfMeasures = useUnitOfMeasure();
  const itemPostingGroups = useItemPostingGroups();

  const mrpFetcher = useAction<typeof mrpAction>({
    onSettled: (data) => {
      // the drawer re-seeds from the new run's actions
      if (data) setOrdersMap({});
    }
  });
  const mrpScheduleDescription = useMrpScheduleDescription();

  // What the order drawer can open on: the page's rows, plus the row a link
  // names when it is not on this page.
  const drawerRows = useMemo(
    () => (drawerItem ? [...data, drawerItem] : data),
    [data, drawerItem]
  );

  // ── Planning actions (the MRP worklist) ──────────────────────────────────
  const user = useUser();
  const canUpdateActions = permissions.can("update", "production");
  const actionTypeOptions = usePlanningActionTypeOptions("Make");
  const [people] = usePeople();
  const {
    actionHandlers: changeActionHandlers,
    isActionsBusy,
    timeFence,
    actionsByItemId,
    fencedActionsByItemId,
    visibleActionsByItemId,
    submitActions
  } = usePlanningActions({
    data: drawerRows,
    planningActions,
    actionTypes,
    locationId,
    updatePath: path.to.bulkUpdateProductionPlanning,
    currentUserId: user.id,
    canUpdate: canUpdateActions
  });

  // A job's Release button releases it from here (the jobs table's release
  // route), rather than opening the job.
  const { onRelease, isReleasing } = useJobPlanningRelease();
  const actionHandlers = useMemo(
    () => ({
      ...changeActionHandlers,
      isBusy: changeActionHandlers.isBusy || isReleasing,
      onRelease
    }),
    [changeActionHandlers, isReleasing, onRelease]
  );
  const bulkUpdateFetcher = useFetcher<typeof bulkUpdateAction>();

  // The drawer's draft orders are page state keyed by item. They are dropped
  // when the page's scope changes (location, filters, search, sort, page) and
  // when MRP recalculates (mrpFetcher above) or an order is placed (below) —
  // NOT on every reload of the loader: Apply, Dismiss and Assign inside the
  // drawer revalidate it, and that used to wipe the planner's edits in the
  // suggested-orders table above them.
  const [searchParams] = useSearchParams();
  // The open drawer is in the address too, and is not a change of scope.
  const pageScope = useMemo(() => {
    const scope = new URLSearchParams(searchParams);
    scope.delete(PLANNING_DRAWER_PARAM);
    return scope.toString();
  }, [searchParams]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scope string is the dependency
  useEffect(() => {
    setOrdersMap({});
  }, [pageScope]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    // Once per completed submission: the fetcher settles to idle with that
    // submission's data. Keyed on `data.success` alone, a second Create Jobs in
    // the same session (success again) never re-ran this — no toast, and the
    // spent drafts stayed in `ordersMap`.
    if (bulkUpdateFetcher.state !== "idle" || !bulkUpdateFetcher.data) {
      return;
    }

    if (
      bulkUpdateFetcher.data?.success === false &&
      bulkUpdateFetcher?.data?.message
    ) {
      toast.error(bulkUpdateFetcher.data.message);
      return;
    }

    if (bulkUpdateFetcher.data?.success === true) {
      // The drafts became jobs; the next open re-seeds from the new split.
      setOrdersMap({});
      const {
        jobs = [],
        alreadyPlannedItemCount = 0,
        noDemandItemCount = 0
      } = bulkUpdateFetcher.data as {
        jobs?: { id: string; readableId: string }[];
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

      if (jobs.length === 0) {
        toast.info(
          skipped.length > 0 ? skipped.join(" · ") : t`No jobs were created`
        );
        return;
      }

      const created =
        jobs.length === 1 ? t`1 job created` : t`${jobs.length} jobs created`;

      toast.success(
        <VStack spacing={1}>
          <span>{created}</span>
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
  }, [bulkUpdateFetcher.state, bulkUpdateFetcher.data]);

  const isDisabled =
    !permissions.can("create", "production") ||
    bulkUpdateFetcher.state !== "idle" ||
    mrpFetcher.state !== "idle";

  // Store orders in a map keyed by item id - calculate on-demand instead of eagerly
  const [ordersMap, setOrdersMap] = useState<Record<string, ProductionOrder[]>>(
    {}
  );

  // A row's suggested jobs are its open Make actions: what MRP wrote after it
  // moved expedited supply, folded a shortfall into an open job as an
  // Increase, and summed each week. They seed the drawer, size the Make
  // button, and are what a bulk Create Jobs submits for rows never opened.
  const ordersByItemId = useMemo(
    () =>
      new Map(
        data.map((row) => [
          row.id,
          productionOrdersFromActions(
            openNewSupplyActions(actionsByItemId.get(row.id), "Make"),
            { item: row, todayDate: locationToday }
          )
        ])
      ),
    [data, actionsByItemId, locationToday]
  );

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
  } = useLinkedDrawerItem({
    param: PLANNING_DRAWER_PARAM,
    rows: drawerRows
  });

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

  // Planning a Draft job re-runs MRP: the item's draft list is stale, so the
  // drawer re-seeds from the new suggestions.
  const dropOrders = useCallback((item: ProductionPlanningItem) => {
    if (!item.id) return;
    setOrdersMap((prev) => {
      if (!(item.id! in prev)) return prev;
      const { [item.id!]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);

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
  // opens on what is due inside the fence and can pull the rest in. A
  // shortfall MRP folded into an Increase on an existing job has no Make
  // action, so it is offered there, in Open Orders, and not here.
  const selectedOrders = useMemo(() => {
    if (!selectedItem?.id) return { inside: [], beyond: [] };
    return splitOrdersByFence(
      ordersByItemId.get(selectedItem.id) ?? [],
      timeFence.fenceDateFor(selectedItem)
    );
  }, [selectedItem, ordersByItemId, timeFence]);

  // The drawer's Open Orders table shows the selected row's change actions on existing
  // jobs (Expedite, Defer, Increase, …). Order / Make actions are left out —
  // each one is already a "New" row in the drawer's order list, right above
  // the table.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const columns = useMemo<ColumnDef<ProductionPlanningItem>[]>(() => {
    const shared = planningColumns<ProductionPlanningItem>({
      i18n,
      periods,
      locationToday,
      formatQuantity,
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
              {distinctItemText(
                row.original.readableIdWithRevision,
                row.original.name
              ) && (
                <div className="w-full truncate text-muted-foreground text-xs">
                  {row.original.name}
                </div>
              )}
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
      ...shared.periods,
      shared.reorderPolicy,
      shared.unitOfMeasure,
      shared.onHand,
      shared.firstNegativeDate,
      shared.latestOrderDate,
      shared.timeFence,
      shared.type,
      shared.itemGroup,
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
          const quantity = formatQuantity(orderQuantity);
          // An open action that adds or advances supply needs doing even with
          // nothing new to order (an Increase on an existing order), so it lights
          // the dot too; a Decrease, Defer or Cancel does not.
          const dot =
            planningActionDot(
              visibleActionsByItemId.get(row.original.id) ?? []
            ) ?? (hasOrders ? "green" : null);
          return (
            <div className="flex justify-end">
              <Button
                variant="secondary"
                leftIcon={dot ? undefined : <LuCircleCheck />}
                isDisabled={isDisabled || isBlocked}
                onClick={(event) => {
                  event.stopPropagation();
                  openDrawer(row.original);
                }}
              >
                {isBlocked ? (
                  t`Blocked`
                ) : dot ? (
                  <HStack>
                    <PulsingDot variant={dot} />
                    <span>{hasOrders ? t`Make ${quantity}` : t`Make`}</span>
                  </HStack>
                ) : (
                  t`Make`
                )}
              </Button>
            </div>
          );
        }
      }
    ];
  }, [
    t,
    i18n,
    formatQuantity,
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
    <>
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
          onSuggestionsStale={dropOrders}
          periods={periods}
          isOpen={isDrawerOpen}
          onClose={closeDrawer}
        />
      )}
    </>
  );
};

export default ProductionPlanningTable;

function getLocationPath(locationId: string) {
  return `${path.to.productionPlanning}?location=${locationId}`;
}
