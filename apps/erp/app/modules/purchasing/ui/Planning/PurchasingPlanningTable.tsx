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
  Status,
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
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  LuBookMarked,
  LuCircleCheck,
  LuCirclePlay,
  LuClock,
  LuContainer,
  LuListTodo,
  LuSquareChartGantt,
  LuUserCheck
} from "react-icons/lu";
import { Link, useFetcher, useSearchParams } from "react-router";
import {
  EmployeeAvatarGroup,
  exportOnlyColumn,
  ItemThumbnail,
  SupplierAvatar,
  Table
} from "~/components";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import {
  useLinkedDrawerItem,
  useMrpScheduleDescription,
  usePermissions,
  useUser
} from "~/hooks";
import type { SupplierPart } from "~/modules/items/types";
import {
  clearOrdersCache,
  getPurchaseOrdersFromPlanning
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { PlanningAction } from "~/modules/production";
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
  planningActionsExportValue,
  usePlanningActionTypeOptions
} from "~/modules/production/ui/Planning/PlanningActionLines";
import { splitOrdersByFence } from "~/modules/production/ui/Planning/planning-fence";
import { planningColumns } from "~/modules/production/ui/Planning/planningColumns";
import { usePlanningActions } from "~/modules/production/ui/Planning/usePlanningActions";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { action as bulkUpdateAction } from "~/routes/x+/purchasing+/planning.update";
import { useItems, usePeople } from "~/stores";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";
import type { PlannedOrder } from "../../purchasing.models";
import type { PurchasingPlanningItem } from "../../types";
import { PurchasingPlanningOrderDrawer } from "./PurchasingPlanningOrderDrawer";

type PlanningTableProps = {
  data: PurchasingPlanningItem[];
  /** The row a `?item=` link opens the drawer on when it is not in `data`. */
  drawerItem: PurchasingPlanningItem | null;
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

const PlanningTable = memo(
  ({
    data,
    drawerItem,
    count,
    locationId,
    periods,
    planningActions,
    actionTypes,
    locationToday
  }: PlanningTableProps) => {
    const { t, i18n } = useLingui();
    const permissions = usePermissions();

    const numberFormatter = useNumberFormatter(NUMBER_FORMAT_OPTIONS);
    const locations = useLocations();
    const unitOfMeasures = useUnitOfMeasure();
    const [suppliers] = useSuppliers();
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
    const bulkUpdateFetcher = useFetcher<typeof bulkUpdateAction>();

    // What the order drawer can open on: the page's rows, plus the row a link
    // names when it is not on this page.
    const drawerRows = useMemo(
      () => (drawerItem ? [...data, drawerItem] : data),
      [data, drawerItem]
    );

    // ── Planning actions (the MRP worklist) ──────────────────────────────────
    const user = useUser();
    const canUpdateActions = permissions.can("update", "purchasing");
    const actionTypeOptions = usePlanningActionTypeOptions("Buy");
    const [people] = usePeople();
    const {
      actionHandlers,
      isActionsBusy,
      timeFence,
      fencedActionsByItemId,
      visibleActionsByItemId,
      submitActions
    } = usePlanningActions({
      data: drawerRows,
      planningActions,
      actionTypes,
      locationId,
      updatePath: path.to.bulkUpdatePurchasingPlanning,
      currentUserId: user.id,
      canUpdate: canUpdateActions
    });

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    useEffect(() => {
      if (bulkUpdateFetcher.state !== "idle" || !bulkUpdateFetcher.data) {
        return;
      }

      if (
        bulkUpdateFetcher.data?.success === false &&
        bulkUpdateFetcher.data?.message
      ) {
        toast.error(bulkUpdateFetcher.data.message);
      }

      if (bulkUpdateFetcher.data?.success === true) {
        // The drafts became PO lines; the next open re-seeds from the new split.
        setOrdersMap({});
        const purchaseOrders =
          (
            bulkUpdateFetcher.data as {
              purchaseOrders?: { id: string; readableId: string }[];
            }
          )?.purchaseOrders ?? [];

        if (purchaseOrders.length === 0) {
          toast.success(t`Orders submitted`);
        } else {
          toast.success(
            <div className="flex gap-1">
              <span>{t`Orders submitted`}</span>
              <span className="flex flex-wrap gap-2 text-xs">
                {purchaseOrders.map((po) => (
                  <Link
                    key={po.id}
                    to={path.to.purchaseOrder(po.id)}
                    className="underline underline-offset-2 hover:opacity-80"
                  >
                    {po.readableId}
                  </Link>
                ))}
              </span>
            </div>,
            { duration: 8000 }
          );
        }
      }
    }, [bulkUpdateFetcher.state, bulkUpdateFetcher.data]);

    const [suppliersMap, setSuppliersMap] = useState<Record<string, string>>(
      () => {
        const initial: Record<string, string> = {};
        data.forEach((item) => {
          // If there's a preferred supplier, use it
          if (item.preferredSupplierId) {
            initial[item.id] = item.preferredSupplierId;
          }
          // If there's only one supplier, auto-select it regardless of preference
          else if ((item.suppliers as SupplierPart[])?.length === 1) {
            initial[item.id] = (item.suppliers as SupplierPart[])[0].supplierId;
          }
          // Otherwise, use the first available supplier if any
          else if ((item.suppliers as SupplierPart[])?.length > 0) {
            initial[item.id] = (item.suppliers as SupplierPart[])[0].supplierId;
          }
        });

        return initial;
      }
    );

    // Re-seed default suppliers whenever the planning rows (or a linked
    // drawer row) change. The useState
    // initializer above only runs once at mount, so an item that gained a
    // supplier after the page loaded — data revalidated after adding a supplier
    // part, running MRP, filtering, or an initially-empty list — would never get
    // its default picked up, and the order drawer would reject it as having "no
    // supplier". Merge only: an item the user explicitly chose a supplier for is
    // left untouched.
    useEffect(() => {
      setSuppliersMap((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const item of drawerRows) {
          if (next[item.id]) continue;
          const seed =
            item.preferredSupplierId ??
            (item.suppliers as SupplierPart[] | null)?.[0]?.supplierId;
          if (seed) {
            next[item.id] = seed;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, [drawerRows]);

    const isDisabled =
      !permissions.can("create", "purchasing") ||
      bulkUpdateFetcher.state !== "idle" ||
      mrpFetcher.state !== "idle";

    const [items] = useItems();

    // Store orders in a map keyed by item id - calculate on-demand instead of eagerly
    const [ordersMap, setOrdersMap] = useState<Record<string, PlannedOrder[]>>(
      {}
    );

    // Auto-computed planned orders for every row, used as the fallback when
    // bulk-submitting items the user never opened in the drawer.
    // Computed from the rows and the supplier chosen for each, a render
    // behind them so a large plan does not block typing; `isPending` covers
    // the gap.
    const deferredData = useDeferredValue(data);
    const isPending = deferredData !== data;
    const ordersByItemId = useMemo(() => {
      const orders = new Map<string, PlannedOrder[]>();
      for (const item of deferredData) {
        orders.set(
          item.id,
          getPurchaseOrdersFromPlanning(
            item,
            periods,
            locationToday,
            items,
            suppliersMap[item.id]
          )
        );
      }
      return orders;
    }, [deferredData, periods, locationToday, items, suppliersMap]);

    // The drawer's draft orders are page state keyed by item. They are
    // dropped when the page's scope changes (location, filters, search, sort,
    // page) and when MRP recalculates (mrpFetcher above) or an order is placed
    // (below) — NOT on every reload of the loader: Apply, Dismiss and Assign
    // inside the drawer revalidate it, and that used to wipe the planner's
    // edits in the suggested-orders table above them.
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
    const onBulkUpdate = useCallback(
      (selectedRows: typeof data, action: "order") => {
        // Filter out rows without suppliers and track them for error reporting
        const rowsWithoutSuppliers = selectedRows.filter(
          (row) => row.id && !suppliersMap[row.id]
        );
        const rowsWithSuppliers = selectedRows.filter(
          (row) => row.id && suppliersMap[row.id]
        );

        if (rowsWithoutSuppliers.length > 0) {
          toast.error(
            `Cannot place order - ${rowsWithoutSuppliers.length} item(s) have no supplier associated`
          );
        }

        if (rowsWithSuppliers.length === 0) {
          return;
        }

        const payload = {
          locationId,
          items: rowsWithSuppliers
            .filter((row) => row.id)
            .map((row) => {
              // Prefer user-edited orders (from the drawer) when present,
              // otherwise fall back to the auto-computed planned orders so
              // bulk submit works for items the user never opened.
              // The fallback stops at the row's time fence: a bulk order
              // raises what is due inside the planning horizon, not the whole
              // planning window.
              const sourceOrders =
                ordersMap[row.id!] && ordersMap[row.id!]!.length > 0
                  ? ordersMap[row.id!]!
                  : splitOrdersByFence(
                      ordersByItemId.get(row.id!) ?? [],
                      timeFence.fenceDateFor(row)
                    ).inside;
              const ordersWithPeriods = sourceOrders.map((order) => {
                const supplierId = suppliersMap[row.id!] ?? order.supplierId;
                if (
                  !order.dueDate ||
                  parseDate(order.dueDate) < parseDate(periods[0].startDate)
                ) {
                  return {
                    ...order,
                    supplierId,
                    periodId: periods[0].id
                  };
                }

                const period = periods.find((p) => {
                  const dueDate = parseDate(order.dueDate!);
                  const startDate = parseDate(p.startDate);
                  const endDate = parseDate(p.endDate);
                  return dueDate >= startDate && dueDate <= endDate;
                });

                return {
                  ...order,
                  supplierId,
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
          action: path.to.bulkUpdatePurchasingPlanning,
          encType: "application/json"
        });
      },

      [
        bulkUpdateFetcher,
        locationId,
        ordersMap,
        ordersByItemId,
        suppliersMap,
        timeFence
      ]
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
      setItem: setSelectedItem,
      isOpen: isDrawerOpen,
      key: drawerKey,
      open: openDrawer,
      close: closeDrawer
    } = useLinkedDrawerItem({
      param: PLANNING_DRAWER_PARAM,
      rows: drawerRows
    });

    const setOrders = useCallback(
      (item: PurchasingPlanningItem, orders: PlannedOrder[]) => {
        if (item.id) {
          setOrdersMap((prev) => ({
            ...prev,
            [item.id!]: orders
          }));
        }
      },
      []
    );

    // The drawer's own Planning Horizon control: the same on-screen override
    // as the grid cell, for the row the drawer is open on.
    const selectedItemId = selectedItem?.id;
    const onSelectedFenceChange = useCallback(
      (date: string | null) => {
        if (selectedItemId) onFenceChange(selectedItemId, date);
      },
      [selectedItemId, onFenceChange]
    );

    // The drawer's suggested orders, split at the selected row's time fence:
    // it opens on what is due inside the fence and can pull the rest in.
    const selectedOrders = useMemo(() => {
      if (!selectedItem?.id) return { inside: [], beyond: [] };
      return splitOrdersByFence(
        getPurchaseOrdersFromPlanning(
          selectedItem,
          periods,
          locationToday,
          items,
          suppliersMap[selectedItem.id]
        ),
        timeFence.fenceDateFor(selectedItem)
      );
    }, [selectedItem, periods, items, suppliersMap, timeFence, locationToday]);

    // The drawer's Open Orders table shows the selected row's change actions on existing
    // orders (Expedite, Defer, …). Order / Make actions are left out — each one
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

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    const columns = useMemo<ColumnDef<PurchasingPlanningItem>[]>(() => {
      const shared = planningColumns<PurchasingPlanningItem>({
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
          header: t`Item ID`,
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
                type={row.original.type as "Part"}
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
        exportOnlyColumn<PurchasingPlanningItem>({
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
            exportValue: (row: PurchasingPlanningItem) =>
              planningActionsExportValue(
                visibleActionsByItemId.get(row.id) ?? []
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
            exportValue: (row: PurchasingPlanningItem) =>
              [
                ...new Set(
                  (visibleActionsByItemId.get(row.id) ?? []).flatMap(
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
        shared.unitOfMeasure,
        {
          accessorKey: "preferredSupplierId",
          header: t`Supplier`,
          cell: ({ row }) => {
            const supplierId = suppliersMap[row.original.id];
            if (!supplierId) return <Status color="red">No Supplier</Status>;

            return <SupplierAvatar supplierId={supplierId} />;
          },
          meta: {
            filter: {
              type: "static",
              options: suppliers.map((supplier) => ({
                label: supplier.name,
                value: supplier.id
              }))
            },
            icon: <LuContainer />
          }
        },
        shared.itemGroup,
        {
          accessorKey: "leadTime",
          header: t`Lead Time`,
          cell: ({ row }) => {
            const leadTime = row.original.leadTime;
            const weeks = Math.ceil(leadTime / 7);
            return (
              <span>
                {weeks} week{weeks > 1 ? "s" : ""}
              </span>
            );
          },
          meta: {
            icon: <LuClock />
          }
        },
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
              <span className="font-medium">
                {numberFormatter.format(value)}
              </span>
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
            const isBlocked = row.original.purchasingBlocked;
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
                      <span>Order {orderQuantity}</span>
                    </HStack>
                  ) : (
                    "Order"
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
      suppliers,
      numberFormatter,
      unitOfMeasures,
      suppliersMap,
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
              <Trans>Order Parts</Trans>
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
      (row: PurchasingPlanningItem) =>
        (visibleActionsByItemId.get(row.id)?.length ?? 0) > 0,
      [visibleActionsByItemId]
    );

    const renderExpandedRow = useCallback(
      (row: PurchasingPlanningItem) => (
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
      active: false,
      type: false
    };

    const defaultColumnPinning = {
      left: ["readableIdWithRevision"],
      right: ["Order"]
    };

    return (
      <Loading isLoading={isPending}>
        <Table<PurchasingPlanningItem>
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
                  window.location.href = getLocationPath(selected);
                }}
              />
              <mrpFetcher.Form
                method="post"
                action={path.to.api.mrp(locationId)}
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
            </div>
          }
          renderActions={renderActions}
          renderExpandedRow={renderExpandedRow}
          pinExpandedRows
          canExpandRow={canExpandRow}
          title={t`Material Planning`}
          table="planning"
          withSavedView
          withSelectableRows
        />

        {selectedItem && (
          <PurchasingPlanningOrderDrawer
            key={drawerKey}
            locationToday={locationToday}
            locationId={locationId}
            selectedItem={selectedItem}
            setSelectedItem={setSelectedItem}
            selectedSupplier={suppliersMap[selectedItem.id]}
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
            onSupplierChange={(itemId, supplierId) => {
              setSuppliersMap((prev) => ({
                ...prev,
                [itemId]: supplierId
              }));
            }}
          />
        )}
      </Loading>
    );
  }
);

PlanningTable.displayName = "PlanningTable";

export default PlanningTable;

function getLocationPath(locationId: string) {
  return `${path.to.purchasingPlanning}?location=${locationId}`;
}
