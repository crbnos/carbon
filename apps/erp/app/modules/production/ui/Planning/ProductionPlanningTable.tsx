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
import { useCallback, useMemo, useRef } from "react";
import {
  LuBookMarked,
  LuCircleCheck,
  LuCirclePlay,
  LuListTodo,
  LuSquareChartGantt,
  LuUserCheck
} from "react-icons/lu";
import { Link } from "react-router";
import {
  EmployeeAvatarGroup,
  exportOnlyColumn,
  ItemThumbnail,
  Table
} from "~/components";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { useInfiniteRows } from "~/components/Table/useInfiniteRows";
import {
  useLinkedDrawerItem,
  useMrpScheduleDescription,
  usePermissions,
  useQuantityFormatter,
  useUser
} from "~/hooks";
import type { ProductionOrder } from "~/modules/production/production.models";
import {
  PLANNING_ACTIONS_COLUMN,
  PLANNING_ASSIGNEE_COLUMN,
  PLANNING_DRAWER_PARAM
} from "~/modules/production/production.models";
import {
  applyPlanningActionsPermission,
  type DrawerPlannedOrder
} from "~/modules/production/production.utils";
import type { PlanningAction } from "~/modules/production/types";
import {
  draftsOfRefusedOrders,
  openNewSupplyActions,
  productionOrdersFromActions
} from "~/modules/production/ui/Planning/planned-orders-from-actions";
import {
  PLANNING_SEGMENT_COLUMN,
  planningRowKey
} from "~/modules/production/ui/Planning/planning-action-scope";
import { splitOrdersByFence } from "~/modules/production/ui/Planning/planning-fence";
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
  type PlanningSegmentProject,
  planningColumns
} from "~/modules/production/ui/Planning/planningColumns";
import { useJobPlanningRelease } from "~/modules/production/ui/Planning/useJobPlanningRelease";
import { usePastStartToast } from "~/modules/production/ui/Planning/usePastStartToast";
import { usePlanningActions } from "~/modules/production/ui/Planning/usePlanningActions";
import { usePlanningRowDrafts } from "~/modules/production/ui/Planning/usePlanningRowDrafts";
import { usePlanningWeekLabel } from "~/modules/production/ui/Planning/usePlanningWeekLabel";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { ProductionPlanningItem } from "../../types";
import { ProductionPlanningOrderDrawer } from "./ProductionPlanningOrderDrawer";

/** A grid row with its persisted MRP worklist (spec §P1.7), rendered as the
 *  Actions column + the item's expanded row. Every action is here whatever
 *  its date; the row's time fence decides what shows. */
type PlanningRow = ProductionPlanningItem & {
  planningActions: PlanningAction[];
};

type ProductionPlanningTableProps = {
  data: PlanningRow[];
  /** The row a `?item=` link opens the drawer on when it is not in `data`. */
  drawerItem: PlanningRow | null;
  count: number;
  // The loader's cursor for the next page (infinite scroll).
  nextCursor: string | null;
  locationId: string;
  periods: { id: string; startDate: string; endDate: string }[];
  /** The Actions-column filter in effect; null when the grid is not filtered
   *  by action type. */
  actionTypes: string[] | null;
  /** The projects that net in their own segment, for the Segment column. */
  segmentProjects: PlanningSegmentProject[];
  /** Today on the location's calendar (ISO date). */
  locationToday: string;
};

const ProductionPlanningTable = ({
  data,
  drawerItem,
  count,
  nextCursor,
  locationId,
  periods,
  actionTypes,
  segmentProjects,
  locationToday
}: ProductionPlanningTableProps) => {
  const permissions = usePermissions();
  const { t, i18n } = useLingui();
  const weekLabel = usePlanningWeekLabel();

  // Memoized on the locale, so it never rebuilds `columns` on its own.
  const formatQuantity = useQuantityFormatter();
  const locations = useLocations();
  const unitOfMeasures = useUnitOfMeasure();
  const itemPostingGroups = useItemPostingGroups();

  const user = useUser();
  // The drawer's draft orders and the planned orders they stand for, by row.
  const drafts = usePlanningRowDrafts<ProductionOrder>({
    orderType: "Make",
    locationId,
    companyId: user.company.id,
    // a Make planned order explodes to its components, so an Apply that
    // re-planned may have moved any row's suggestions
    replanDrops: "everyRow"
  });
  const {
    ordersMap,
    setOrders,
    plannedOrdersByRowKey,
    onPlannedOrdersLoaded,
    draftVersion,
    dropOrders,
    dropAllDrafts,
    clearDrafts,
    replaceDrafts,
    dropItemDrafts,
    readPlannedOrders
  } = drafts;

  const mrpFetcher = useAction<typeof mrpAction>({
    onSettled: (data) => {
      // the drawer re-seeds from the new run's actions and planned orders
      if (data) clearDrafts();
    }
  });
  const mrpScheduleDescription = useMrpScheduleDescription();

  // Every loaded row, each with its own actions. The grid is location-scoped:
  // no list registry entry, so no `listKey`. The open drawer's param does not
  // change the list.
  const infiniteRows = useInfiniteRows({
    initialRows: data,
    infinite: {
      dataKey: "items",
      nextCursor,
      ignoreParams: [PLANNING_DRAWER_PARAM]
    }
  });
  const loadedRows = infiniteRows.rows;

  // What the order drawer can open on: the loaded rows, plus the row a link
  // names when it is not loaded. A loaded row is never counted twice.
  const drawerRows = useMemo(
    () =>
      drawerItem && !loadedRows.some((row) => row.id === drawerItem.id)
        ? [...loadedRows, drawerItem]
        : loadedRows,
    [loadedRows, drawerItem]
  );
  const loadedPlanningActions = useMemo(
    () => drawerRows.flatMap((row) => row.planningActions),
    [drawerRows]
  );

  // ── Planning actions (the MRP worklist) ──────────────────────────────────
  const canUpdateActions = permissions.has({
    "production.materialPlanning": "Edit"
  });
  const canApplyActions = permissions.has(applyPlanningActionsPermission);
  const actionTypeOptions = usePlanningActionTypeOptions("Make");
  const [people] = usePeople();
  const {
    actionHandlers: changeActionHandlers,
    isActionsBusy,
    horizon,
    actionsByRowKey,
    fencedActionsByRowKey,
    visibleActionsByRowKey,
    submitActions
  } = usePlanningActions({
    data: drawerRows,
    planningActions: loadedPlanningActions,
    actionTypes,
    locationId,
    updatePath: path.to.bulkUpdateProductionPlanning,
    currentUserId: user.id,
    canUpdate: canUpdateActions,
    // an Apply on a planned order re-plans: the drafts are stale
    onRowsReplanned: drafts.onRowsReplanned
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
  // Create Jobs: the order's created jobs, and the parts it skipped. A refusal
  // is toasted by useAction.
  const pastStartToast = usePastStartToast();
  const submittedRows = useRef<
    { id: string; planningSegmentId: string; orders: ProductionOrder[] }[]
  >([]);
  const bulkUpdateFetcher = useAction<typeof bulkUpdateAction>({
    onSuccess: (result) => {
      const data = "data" in result ? result.data : null;
      if (!data || !("jobs" in data)) return;
      // A refused late order stays a draft as it was sent; every other row
      // re-seeds from the suggestions, which keep what was not ordered.
      // the jobs converted planned orders: they are read again
      replaceDrafts(
        draftsOfRefusedOrders(submittedRows.current, data.refusedOrders)
      );
      const refusedCount = data.refusedOrders.length;
      if (refusedCount > 0) {
        toast.error(pastStartToast(data.jobs.length, refusedCount));
      }
      const problems = [...data.warnings, ...data.errors];
      if (problems.length > 0) toast.error(problems.join(" · "));
      const { jobs, alreadyPlannedItemCount, noDemandItemCount } = data;

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
  });

  const isDisabled =
    !permissions.has({ "production.materialPlanning": "Create" }) ||
    bulkUpdateFetcher.state !== "idle" ||
    mrpFetcher.state !== "idle" ||
    drafts.isReadingPlannedOrders;

  // A row's suggested jobs are its open Make actions: what MRP wrote after it
  // moved expedited supply, folded a shortfall into an open job as an
  // Increase, and summed each week — one job per planned order of the
  // action's week when it has any. They seed the drawer, size the Make
  // button, and are what a bulk Create Jobs submits for rows never opened.
  const ordersForRow = useCallback(
    (row: ProductionPlanningItem, plannedOrders?: DrawerPlannedOrder[]) => {
      const rowActions = actionsByRowKey.get(planningRowKey(row));
      return productionOrdersFromActions(
        openNewSupplyActions(rowActions, "Make"),
        {
          item: row,
          todayDate: locationToday,
          plannedOrders,
          rowActions,
          weeks: periods
        }
      );
    },
    [actionsByRowKey, locationToday, periods]
  );
  const ordersByRowKey = useMemo(
    () =>
      new Map(
        loadedRows.map((row) => [
          planningRowKey(row),
          ordersForRow(row, plannedOrdersByRowKey[planningRowKey(row)])
        ])
      ),
    [loadedRows, ordersForRow, plannedOrdersByRowKey]
  );

  const onBulkUpdate = useCallback(
    async (selectedRows: ProductionPlanningItem[], action: "order") => {
      if (drafts.isReading()) return;
      // A bulk Create Jobs reads the planned orders of the rows it sizes
      // itself, so a bulk job converts by id as the drawer's does.
      const plannedOrdersByItem = await readPlannedOrders(selectedRows);
      const suggestedOrders = (row: ProductionPlanningItem) =>
        plannedOrdersByItem && !row.planningSegmentId
          ? ordersForRow(row, plannedOrdersByItem.get(row.id!) ?? [])
          : (ordersByRowKey.get(planningRowKey(row)) ?? []);

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
              planningRowKey(row) in ordersMap
                ? ordersMap[planningRowKey(row)]!
                : splitOrdersByFence(
                    suggestedOrders(row),
                    horizon.horizonDateFor(row)
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
              planningSegmentId: row.planningSegmentId ?? "",
              orders: ordersWithPeriods
            };
          }),
        action: action
      };
      submittedRows.current = payload.items;
      bulkUpdateFetcher.submit(payload, {
        method: "post",
        action: path.to.bulkUpdateProductionPlanning,
        encType: "application/json"
      });
    },

    // oxlint-disable-next-line react/exhaustive-deps -- suppressed due to migration
    [
      bulkUpdateFetcher,
      drafts.isReading,
      readPlannedOrders,
      locationId,
      ordersMap,
      ordersByRowKey,
      ordersForRow,
      horizon
    ]
  );

  // Moving a row's horizon changes which suggested orders its drawer opens
  // on. The drawer's list is kept per item once opened (planner edits win),
  // so a stale list would neither show the newly included orders nor offer
  // them — drop it and let the drawer re-seed from the new split.
  const setHorizonDate = horizon.setHorizonDate;
  const onHorizonChange = useCallback(
    (itemId: string, date: string | null) => {
      setHorizonDate(itemId, date);
      dropItemDrafts(itemId);
    },
    [setHorizonDate, dropItemDrafts]
  );

  // The drawer stays mounted, on the last selected part, while it slides out.
  const {
    item: selectedItem,
    isOpen: isDrawerOpen,
    key: drawerKey,
    open: openDrawer,
    close: closeDrawer
  } = useLinkedDrawerItem<ProductionPlanningItem>({
    param: PLANNING_DRAWER_PARAM,
    rows: drawerRows
  });

  // The drawer's own Planning Horizon control: the same on-screen override as
  // the grid cell, for the row the drawer is open on.
  const selectedItemId = selectedItem?.id;
  const onSelectedHorizonChange = useCallback(
    (date: string | null) => {
      if (selectedItemId) onHorizonChange(selectedItemId, date);
    },
    [selectedItemId, onHorizonChange]
  );

  // The drawer's suggested orders, split at the selected row's time fence: it
  // opens on what is due inside the fence and can pull the rest in. A
  // shortfall MRP folded into an Increase on an existing job has no Make
  // action, so it is offered there, in Open Orders, and not here.
  const selectedOrders = useMemo(() => {
    if (!selectedItem?.id) return { inside: [], beyond: [] };
    return splitOrdersByFence(
      ordersByRowKey.get(planningRowKey(selectedItem)) ?? [],
      horizon.horizonDateFor(selectedItem)
    );
  }, [selectedItem, ordersByRowKey, horizon]);

  // The drawer's Open Orders table shows the selected row's change actions on existing
  // jobs (Expedite, Defer, Increase, …). Order / Make actions are left out —
  // each one is already a "New" row in the drawer's order list, right above
  // the table.
  const selectedActions = useMemo(
    () =>
      selectedItem?.id
        ? (
            fencedActionsByRowKey.get(planningRowKey(selectedItem)) ?? []
          ).filter((action) => !isNewSupplyAction(action))
        : [],
    [selectedItem, fencedActionsByRowKey]
  );

  // The drawer's Open Orders rows carry the same Apply / Dismiss / Reopen /
  // Assign controls as the expanded row, through the same single fetcher.

  const columns = useMemo<ColumnDef<ProductionPlanningItem>[]>(() => {
    const shared = planningColumns<ProductionPlanningItem>({
      i18n,
      periods,
      weekLabel,
      locationToday,
      formatQuantity,
      unitOfMeasures,
      itemPostingGroups,
      horizon,
      onHorizonChange,
      segmentProjects
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
          mobile: "P1",
          icon: <LuBookMarked />
        }
      },
      exportOnlyColumn<ProductionPlanningItem>({
        id: "itemName",
        header: t`Item Name`,
        value: (row) => row.name ?? null
      }),
      shared.segment,
      {
        id: PLANNING_ACTIONS_COLUMN,
        header: t`Actions`,
        cell: ({ row }) => (
          <PlanningActionsCell
            actions={
              visibleActionsByRowKey.get(planningRowKey(row.original)) ?? []
            }
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
            planningActionsExportValue(
              visibleActionsByRowKey.get(planningRowKey(row)) ?? []
            )
        }
      },
      {
        id: PLANNING_ASSIGNEE_COLUMN,
        header: t`Assignee`,
        cell: ({ row }) => (
          <EmployeeAvatarGroup
            employeeIds={[
              ...new Set(
                (
                  visibleActionsByRowKey.get(planningRowKey(row.original)) ?? []
                ).flatMap((action) =>
                  action.assignee ? [action.assignee] : []
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
                (visibleActionsByRowKey.get(planningRowKey(row)) ?? []).flatMap(
                  (action) => (action.assignee ? [action.assignee] : [])
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
      {
        ...shared.reorderPolicy,
        meta: { ...shared.reorderPolicy.meta, mobile: "P2" }
      },
      shared.unitOfMeasure,
      {
        ...shared.onHand,
        meta: { ...shared.onHand.meta, mobile: "P3", mobileLabel: true }
      },
      shared.firstNegativeDate,
      shared.latestOrderDate,
      shared.planningHorizon,
      shared.type,
      shared.itemGroup,
      {
        id: "Order",
        header: "",
        cell: ({ row }) => {
          // only what is due inside the row's time fence
          const orders = row.original.id
            ? splitOrdersByFence(
                ordersByRowKey.get(planningRowKey(row.original)) ?? [],
                horizon.horizonDateFor(row.original)
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
              visibleActionsByRowKey.get(planningRowKey(row.original)) ?? []
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
                    <PulsingDot
                      variant={dot}
                      label={dot === "red" ? t`Urgent` : t`Action needed`}
                    />
                    <span>{hasOrders ? t`Make ${quantity}` : t`Make`}</span>
                  </HStack>
                ) : (
                  t`Make`
                )}
              </Button>
            </div>
          );
        },
        meta: {
          mobile: "action"
        }
      }
    ];
    // oxlint-disable-next-line react/exhaustive-deps -- suppressed due to migration
  }, [
    t,
    i18n,
    formatQuantity,
    unitOfMeasures,
    isDisabled,
    visibleActionsByRowKey,
    actionTypeOptions,
    people,
    itemPostingGroups,
    ordersByRowKey,
    horizon,
    segmentProjects,
    locationToday,
    weekLabel
    // Note: ordersMap is intentionally not in deps to avoid column regeneration
    // getOrdersForItem inside the cell will access the latest ordersMap via closure
  ]);

  const renderActions = useCallback(
    (selectedRows: ProductionPlanningItem[]) => {
      // inside each row's time fence only — what the row is showing
      const applyableIds = selectedRows.flatMap((row) =>
        (visibleActionsByRowKey.get(planningRowKey(row)) ?? [])
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
            disabled={
              bulkUpdateFetcher.state !== "idle" ||
              drafts.isReadingPlannedOrders
            }
          >
            <DropdownMenuIcon icon={<LuSquareChartGantt />} />
            <Trans>Create Jobs</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={
              !canApplyActions || applyableIds.length === 0 || isActionsBusy
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
      drafts.isReadingPlannedOrders,
      onBulkUpdate,
      visibleActionsByRowKey,
      canApplyActions,
      isActionsBusy,
      submitActions
    ]
  );

  const canExpandRow = useCallback(
    (row: ProductionPlanningItem) =>
      (visibleActionsByRowKey.get(planningRowKey(row))?.length ?? 0) > 0,
    [visibleActionsByRowKey]
  );

  const renderExpandedRow = useCallback(
    (row: ProductionPlanningItem) => (
      <PlanningActionLines
        actions={visibleActionsByRowKey.get(planningRowKey(row)) ?? []}
        todayIso={locationToday}
        {...actionHandlers}
        onOrder={() => openDrawer(row)}
      />
    ),
    [visibleActionsByRowKey, locationToday, actionHandlers, openDrawer]
  );

  const defaultColumnVisibility = {
    // carries the Assignee filter; the avatars are opt-in
    [PLANNING_ASSIGNEE_COLUMN]: false,
    // only a company with project stock has more than one segment
    [PLANNING_SEGMENT_COLUMN]: segmentProjects.length > 0,
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
        infiniteRows={infiniteRows}
        defaultColumnVisibility={defaultColumnVisibility}
        defaultColumnPinning={defaultColumnPinning}
        primaryAction={
          <div className="flex items-center gap-2">
            <Combobox
              aria-label={t`Location`}
              asButton
              size="sm"
              value={locationId}
              options={locations}
              onChange={(selected) => {
                // hard refresh because initialValues update has no effect otherwise
                window.location.href = getLocationPath(selected);
              }}
            />
            <mrpFetcher.Form
              method="post"
              action={path.to.api.mrp(locationId)}
              className="max-md:hidden"
            >
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
            <p className="basis-full text-xs text-muted-foreground md:hidden">
              {mrpScheduleDescription}
            </p>
          </div>
        }
        mobileMenuItems={
          <DropdownMenuItem
            disabled={mrpFetcher.state !== "idle"}
            onSelect={() =>
              mrpFetcher.submit(
                {},
                { method: "post", action: path.to.api.mrp(locationId) }
              )
            }
          >
            <DropdownMenuIcon icon={<LuCirclePlay />} />
            <Trans>Recalculate</Trans>
          </DropdownMenuItem>
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
              ? ordersMap[planningRowKey(selectedItem)] || selectedOrders.inside
              : []
          }
          beyondFenceOrders={selectedOrders.beyond}
          horizonDate={horizon.horizonDateFor(selectedItem)}
          isHorizonOverridden={horizon.isOverridden(selectedItem)}
          onHorizonChange={onSelectedHorizonChange}
          actions={selectedActions}
          actionHandlers={actionHandlers}
          setOrders={setOrders}
          onSuggestionsStale={dropOrders}
          onPlanReran={dropAllDrafts}
          draftVersion={draftVersion}
          onPlannedOrdersLoaded={onPlannedOrdersLoaded}
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
