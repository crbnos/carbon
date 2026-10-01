// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  memo,
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
  LuChartNoAxesColumn,
  LuCircleCheck,
  LuCirclePlay,
  LuClock,
  LuContainer,
  LuListTodo,
  LuSquareChartGantt
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import {
  exportOnlyColumn,
  ItemThumbnail,
  MethodItemTypeIcon,
  SupplierAvatar,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions, useUrlParams, useUser } from "~/hooks";
import { inventoryItemTypes } from "~/modules/inventory/inventory.models";
import { itemReorderingPolicies } from "~/modules/items/items.models";
import type { SupplierPart } from "~/modules/items/types";
import {
  clearOrdersCache,
  getPurchaseOrdersFromPlanning,
  getReorderPolicyDescription,
  ItemReorderPolicy
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { PlanningAction } from "~/modules/production";
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
  PlanningActionLines,
  PlanningActionsCell,
  planningActionsExportValue,
  usePlanningActionTypeOptions
} from "~/modules/production/ui/Planning/PlanningActionLines";
import {
  PlanningWeekStrip,
  planningWeekStripSize,
  planningWeekValues
} from "~/modules/production/ui/Planning/PlanningWeekStrip";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { action as bulkUpdateAction } from "~/routes/x+/purchasing+/planning.update";
import { useItems } from "~/stores";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";
import type { PlannedOrder } from "../../purchasing.models";
import type { PurchasingPlanningItem } from "../../types";
import { PurchasingPlanningOrderDrawer } from "./PurchasingPlanningOrderDrawer";

type PlanningTableProps = {
  data: PurchasingPlanningItem[];
  count: number;
  locationId: string;
  periods: { id: string; startDate: string; endDate: string }[];
  /** The persisted MRP worklist for this location and kind (spec §P1.7),
   *  rendered as the Actions column + each item's expanded row. */
  planningActions: PlanningAction[];
};

const PlanningTable = memo(
  ({
    data,
    count,
    locationId,
    periods,
    planningActions
  }: PlanningTableProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();

    const numberFormatter = useNumberFormatter();
    const locations = useLocations();
    const unitOfMeasures = useUnitOfMeasure();
    const [suppliers] = useSuppliers();

    const mrpFetcher = useFetcher<typeof mrpAction>();
    const bulkUpdateFetcher = useFetcher<typeof bulkUpdateAction>();

    // ── Planning actions (the MRP worklist) ──────────────────────────────────
    const user = useUser();
    const [params, setParams] = useUrlParams();
    const canUpdateActions = permissions.can("update", "purchasing");
    const actionTypeOptions = usePlanningActionTypeOptions("Buy");
    const actionsFetcher = useFetcher<{
      success?: boolean;
      message?: string;
    }>();
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

    // ONE batched request per click: the route derives each row's behaviour
    // from its persisted type, and a fetcher holds a single in-flight submission.
    const submitActions = useCallback(
      (payload: Record<string, unknown>) => {
        actionsFetcher.submit(JSON.stringify({ locationId, ...payload }), {
          method: "post",
          action: path.to.bulkUpdatePurchasingPlanning,
          encType: "application/json"
        });
      },
      [actionsFetcher, locationId]
    );

    const isAssignedToMe =
      params.get(PLANNING_ACTIONS_SCOPE_PARAM) === PLANNING_ACTIONS_SCOPE_MINE;

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

    // Re-seed default suppliers whenever the planning rows change. The useState
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
        for (const item of data) {
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
    }, [data]);

    const isDisabled =
      !permissions.can("create", "production") ||
      bulkUpdateFetcher.state !== "idle" ||
      mrpFetcher.state !== "idle";

    const [items] = useItems();

    // Store orders in a map keyed by item id - calculate on-demand instead of eagerly
    const [ordersMap, setOrdersMap] = useState<Record<string, PlannedOrder[]>>(
      {}
    );

    // Auto-computed planned orders for every row, used as the fallback when
    // bulk-submitting items the user never opened in the drawer.
    const [ordersByItemId, setOrdersByItemId] = useState<
      Map<string, PlannedOrder[]>
    >(new Map());

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
              const sourceOrders =
                ordersMap[row.id!] && ordersMap[row.id!]!.length > 0
                  ? ordersMap[row.id!]!
                  : (ordersByItemId.get(row.id!) ?? []);
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

      [bulkUpdateFetcher, locationId, ordersMap, ordersByItemId, suppliersMap]
    );

    const [selectedItem, setSelectedItem] =
      useState<PurchasingPlanningItem | null>(null);

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

    const [isPending, startTransition] = useTransition();

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    useEffect(() => {
      startTransition(() => {
        const ordersByItemId = new Map<string, PlannedOrder[]>();
        data.forEach((item) => {
          ordersByItemId.set(
            item.id,
            getPurchaseOrdersFromPlanning(
              item,
              periods,
              items,
              suppliersMap[item.id]
            )
          );
        });
        setOrdersByItemId(ordersByItemId);
      });
    }, [data]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    const columns = useMemo<ColumnDef<PurchasingPlanningItem>[]>(() => {
      // The grid shows every week as one bar in a strip; the CSV keeps a
      // column per week so an export still carries the numbers.
      const periodColumns: ColumnDef<PurchasingPlanningItem>[] = [
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
          const weekKey = `week${weekNumber}` as keyof PurchasingPlanningItem;
          return exportOnlyColumn<PurchasingPlanningItem>({
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
          header: t`Item ID`,
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
              actions={actionsByItemId.get(row.original.id) ?? []}
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
              planningActionsExportValue(actionsByItemId.get(row.id) ?? [])
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
            exportValue: (row: PurchasingPlanningItem) =>
              unitOfMeasures.find((uom) => uom.value === row.unitOfMeasureCode)
                ?.label ?? null
          }
        },
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
          cell: ({ row }) =>
            numberFormatter.format(row.original.quantityOnHand),
          meta: {
            icon: <LuBlocks />,
            renderTotal: true
          }
        },
        ...periodColumns,
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
        {
          id: "latestOrderDate",
          header: t`Latest Order Date`,
          cell: ({ row }) => (
            <LatestOrderDateCell
              itemPlanning={row.original}
              periods={periods}
            />
          ),
          meta: {
            icon: <LuCalendarClock />,
            exportValue: (row: PurchasingPlanningItem) =>
              latestOrderDateExportValue(row, periods)
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
            const orders = row.original.id
              ? (ordersByItemId.get(row.original.id) ?? [])
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
                  onClick={() => {
                    setSelectedItem(row.original);
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
      suppliers,
      numberFormatter,
      unitOfMeasures,
      suppliersMap,
      isDisabled,
      actionsByItemId,
      actionTypeOptions
      // Note: ordersMap is intentionally not in deps to avoid column regeneration
      // getOrdersForItem inside the cell will access the latest ordersMap via closure
    ]);

    const renderActions = useCallback(
      (selectedRows: typeof data) => {
        const applyableIds = selectedRows.flatMap((row) =>
          (actionsByItemId.get(row.id) ?? [])
            .filter(isApplyablePlanningAction)
            .map((action) => action.id)
        );
        return (
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuLabel>Update</DropdownMenuLabel>
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
        actionsByItemId,
        canUpdateActions,
        isActionsBusy,
        submitActions
      ]
    );

    const canExpandRow = useCallback(
      (row: PurchasingPlanningItem) =>
        (actionsByItemId.get(row.id)?.length ?? 0) > 0,
      [actionsByItemId]
    );

    const renderExpandedRow = useCallback(
      (row: PurchasingPlanningItem) => (
        <PlanningActionLines
          actions={actionsByItemId.get(row.id) ?? []}
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
      [actionsByItemId, user.id, canUpdateActions, isActionsBusy, submitActions]
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
                  <TooltipContent>
                    MRP runs automatically every 3 hours, but you can run it
                    manually here.
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
          table="planning"
          withSavedView
          withSelectableRows
        />

        {selectedItem && (
          <PurchasingPlanningOrderDrawer
            locationId={locationId}
            selectedItem={selectedItem}
            setSelectedItem={setSelectedItem}
            selectedSupplier={suppliersMap[selectedItem.id]}
            orders={
              selectedItem.id
                ? ordersMap[selectedItem.id] ||
                  getPurchaseOrdersFromPlanning(
                    selectedItem,
                    periods,
                    items,
                    suppliersMap[selectedItem.id]
                  )
                : []
            }
            setOrders={setOrders}
            periods={periods}
            isOpen={!!selectedItem}
            onClose={() => setSelectedItem(null)}
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
