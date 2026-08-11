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
import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
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
  LuCircleCheck,
  LuCirclePlay,
  LuSquareChartGantt
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import {
  exportOnlyColumn,
  ItemThumbnail,
  MethodItemTypeIcon,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions } from "~/hooks";
import { inventoryItemTypes } from "~/modules/inventory/inventory.models";
import { itemReorderingPolicies } from "~/modules/items/items.models";
import {
  clearOrdersCache,
  getProductionOrdersFromPlanning,
  getReorderPolicyDescription,
  ItemReorderPolicy
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { ProductionOrder } from "~/modules/production";
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
};

const ProductionPlanningTable = ({
  data,
  count,
  locationId,
  periods
}: ProductionPlanningTableProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();

  const dateFormatter = useDateFormatter({
    month: "short",
    day: "numeric"
  });

  const numberFormatter = useNumberFormatter();
  const locations = useLocations();
  const unitOfMeasures = useUnitOfMeasure();

  const mrpFetcher = useFetcher<typeof mrpAction>();
  const bulkUpdateFetcher = useFetcher<typeof bulkUpdateAction>();

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
            // auto-computed orders only for items never opened in the drawer
            const sourceOrders =
              row.id! in ordersMap
                ? ordersMap[row.id!]!
                : (ordersByItemId.get(row.id!) ?? []);
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

    [bulkUpdateFetcher, locationId, ordersMap, ordersByItemId]
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
    const periodColumns: ColumnDef<ProductionPlanningItem>[] = periods.map(
      (period, index) => {
        const isCurrentWeek = index === 0;
        const weekNumber = index + 1;
        const weekKey = `week${weekNumber}` as keyof ProductionPlanningItem;
        const startDate = parseDate(period.startDate).toDate(
          getLocalTimeZone()
        );
        const endDate = parseDate(period.endDate).toDate(getLocalTimeZone());

        return {
          accessorKey: weekKey,
          header: () => (
            <VStack spacing={0}>
              <div>{isCurrentWeek ? "Present Week" : `Week ${weekNumber}`}</div>
              <div className="text-xs text-muted-foreground">
                {dateFormatter.format(startDate)} -{" "}
                {dateFormatter.format(endDate)}
              </div>
            </VStack>
          ),
          cell: ({ row }) => {
            const value = row.getValue<number>(weekKey);
            if (value === undefined) return "-";
            return (
              <span
                className={value < 0 ? "text-red-500 font-bold" : undefined}
              >
                {numberFormatter.format(value)}
              </span>
            );
          },
          meta: {
            filterHeader: isCurrentWeek
              ? t`Present Week`
              : t`Week ${weekNumber}`,
            exportValue: (row: ProductionPlanningItem) => {
              const value = row[weekKey] as number | undefined;
              return value === undefined ? null : value;
            }
          }
        };
      }
    );

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
    dateFormatter,
    numberFormatter,
    unitOfMeasures,
    isDisabled
    // Note: ordersMap is intentionally not in deps to avoid column regeneration
    // getOrdersForItem inside the cell will access the latest ordersMap via closure
  ]);

  const renderActions = useCallback(
    (selectedRows: typeof data) => {
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
        </DropdownMenuContent>
      );
    },
    [bulkUpdateFetcher.state, onBulkUpdate]
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
        title={t`Planning`}
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
              ? ordersMap[selectedItem.id] ||
                getProductionOrdersFromPlanning(selectedItem, periods)
              : []
          }
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
