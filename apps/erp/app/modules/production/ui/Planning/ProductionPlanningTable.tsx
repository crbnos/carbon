import { useCarbon } from "@carbon/auth";
import {
  Button,
  Combobox,
  DatePicker,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  HStack,
  IconButton,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  PulsingDot,
  Separator,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  useMount,
  VStack,
} from "@carbon/react";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import { Link, useFetcher } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuBox,
  LuCalendar,
  LuChevronDown,
  LuChevronUp,
  LuCircleCheck,
  LuCirclePlay,
  LuExternalLink,
  LuHardHat,
  LuPackage,
  LuPlus,
  LuSquareChartGantt,
  LuStar,
  LuTrash2,
} from "react-icons/lu";
import { ItemThumbnail, MethodItemTypeIcon, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions } from "~/hooks";
import { itemTypes } from "~/modules/inventory/inventory.models";
import { itemReorderingPolicies } from "~/modules/items/items.models";
import { getLinkToItemPlanning } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import {
  getProductionOrdersFromPlanning,
  getReorderPolicyDescription,
  ItemReorderPolicy,
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { ProductionOrder } from "~/modules/production";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { path } from "~/utils/path";
import type { ProductionPlanningItem } from "../../types";
import { JobStatus } from "../Jobs";

type ProductionPlanningTableProps = {
  data: ProductionPlanningItem[];
  count: number;
  locationId: string;
  periods: { id: string; startDate: string; endDate: string }[];
};

const OrderDrawer = memo(
  ({
    row,
    orders,
    setOrders,
    locationId,
    periods,
    isOpen,
    onClose,
  }: {
    row: ProductionPlanningItem;
    orders: ProductionOrder[];
    setOrders: (
      item: ProductionPlanningItem,
      orders: ProductionOrder[]
    ) => void;
    locationId: string;
    periods: { id: string; startDate: string; endDate: string }[];
    isOpen: boolean;
    onClose: () => void;
  }) => {
    const fetcher = useFetcher<typeof bulkUpdateAction>();
    const { carbon } = useCarbon();

    // Memoize getExistingOrders callback
    const getExistingOrders = useCallback(async () => {
      if (!carbon || !row.id) return;

      const { data: existingOrderData } = await carbon
        ?.from("job")
        .select("*")
        .eq("itemId", row.id)
        .is("salesOrderId", null)
        .is("salesOrderLineId", null)
        .in("status", ["Draft", "Planned"]);

      if (existingOrderData) {
        const existingOrders: ProductionOrder[] = existingOrderData
          .filter(
            (order) =>
              !orders.some((existing) => existing.existingId === order.id)
          )
          .map((order) => {
            // If no due date or due date is before first period, use first period
            if (
              !order.dueDate ||
              parseDate(order.dueDate) < parseDate(periods[0].startDate)
            ) {
              return {
                existingId: order.id,
                existingReadableId: order.jobId,
                existingQuantity: order.status === "Draft" ? 0 : order.quantity,
                existingStatus: order.status,
                startDate: order.startDate ?? null,
                dueDate: order.dueDate ?? null,
                quantity: order.quantity,
                isASAP: order.deadlineType === "ASAP",
                periodId: periods[0].id,
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
              existingId: order.id,
              existingReadableId: order.jobId,
              existingQuantity: order.status === "Draft" ? 0 : order.quantity,
              existingStatus: order.status,
              startDate: order.startDate ?? null,
              dueDate: order.dueDate ?? null,
              quantity: order.quantity,
              isASAP: order.deadlineType === "ASAP",
              periodId: period?.id ?? periods[periods.length - 1].id,
            };
          });

        setOrders(
          row,
          [...orders, ...existingOrders].sort((a, b) => {
            return a.dueDate?.localeCompare(b.dueDate ?? "") ?? 0;
          })
        );
      }
    }, [carbon, orders, row, setOrders, periods]);

    useMount(() => {
      if (row.id) {
        getExistingOrders();
      }
    });

    // Memoize handlers
    const onAddOrder = useCallback(() => {
      if (row.id) {
        const newOrder: ProductionOrder = {
          quantity: row.lotSize ?? row.minimumOrderQuantity ?? 0,
          dueDate: today(getLocalTimeZone())
            .add({ days: row.leadTime ?? 0 })
            .toString(),
          startDate: today(getLocalTimeZone()).toString(),
          isASAP: false,
          periodId: periods[0].id,
        };
        setOrders(row, [...orders, newOrder]);
      }
    }, [row, orders, setOrders, periods]);

    const onRemoveOrder = useCallback(
      (index: number) => {
        if (row.id) {
          const newOrders = orders.filter((_, i) => i !== index);
          setOrders(row, newOrders);
        }
      },
      [row, orders, setOrders]
    );

    const onSubmit = useCallback(
      (id: string, orders: ProductionOrder[]) => {
        const ordersWithPeriods = orders.map((order) => {
          // If no due date or due date is before first period, use first period
          if (
            !order.dueDate ||
            parseDate(order.dueDate) < parseDate(periods[0].startDate)
          ) {
            return {
              ...order,
              periodId: periods[0].id,
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
            periodId: period?.id ?? periods[periods.length - 1].id,
          };
        });

        const payload = {
          locationId,
          items: [
            {
              id: id,
              orders: ordersWithPeriods,
            },
          ],
          action: "order" as const,
        };
        fetcher.submit(payload, {
          method: "post",
          action: path.to.bulkUpdateProductionPlanning,
          encType: "application/json",
        });
      },
      [fetcher, locationId, periods]
    );

    // Memoize order update handler
    const handleOrderUpdate = useCallback(
      (index: number, updates: Partial<ProductionOrder>) => {
        if (row.id) {
          const newOrders = [...orders];
          newOrders[index] = {
            ...orders[index],
            ...updates,
          };
          setOrders(row, newOrders);
        }
      },
      [row, orders, setOrders]
    );

    useEffect(() => {
      if (fetcher.data?.success === false && fetcher?.data?.message) {
        toast.error(fetcher.data.message);
      }

      if (fetcher.data?.success === true) {
        toast.success("Orders submitted");
        setOrders(row, []);
        onClose();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetcher.data?.success]);

    // Memoize drawer content
    const drawerContent = useMemo(
      () => (
        <DrawerContent size="lg">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <span>{row.readableIdWithRevision}</span>
              <Link
                // @ts-ignore
                to={getLinkToItemPlanning(row.type, row.id)}
              >
                <LuExternalLink />
              </Link>
            </DrawerTitle>
            <DrawerDescription>{row.name}</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <div className="flex flex-col gap-4  w-full">
              <VStack spacing={2} className="text-sm border rounded-lg p-4">
                <HStack className="justify-between w-full">
                  <span className="text-muted-foreground">Reorder Policy:</span>
                  <ItemReorderPolicy reorderingPolicy={row.reorderingPolicy} />
                </HStack>
                <Separator />
                {row.reorderingPolicy === "Maximum Quantity" && (
                  <>
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">
                        Reorder Point:
                      </span>
                      <span>{row.reorderPoint}</span>
                    </HStack>
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">
                        Maximum Inventory:
                      </span>
                      <span>{row.maximumInventoryQuantity}</span>
                    </HStack>
                  </>
                )}

                {row.reorderingPolicy === "Demand-Based Reorder" && (
                  <>
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">
                        Accumulation Period:
                      </span>
                      <span>{row.demandAccumulationPeriod} weeks</span>
                    </HStack>
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">
                        Safety Stock:
                      </span>
                      <span>{row.demandAccumulationSafetyStock}</span>
                    </HStack>
                  </>
                )}

                {row.reorderingPolicy === "Fixed Reorder Quantity" && (
                  <>
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">
                        Reorder Point:
                      </span>
                      <span>{row.reorderPoint}</span>
                    </HStack>
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">
                        Reorder Quantity:
                      </span>
                      <span>{row.reorderQuantity}</span>
                    </HStack>
                  </>
                )}
                {(row.lotSize > 0 ||
                  row.minimumOrderQuantity > 0 ||
                  row.maximumOrderQuantity > 0) && <Separator />}
                {row.lotSize > 0 && (
                  <HStack className="justify-between w-full">
                    <span className="text-muted-foreground">Lot Size:</span>
                    <span>{row.lotSize}</span>
                  </HStack>
                )}
                {row.minimumOrderQuantity > 0 && (
                  <HStack className="justify-between w-full">
                    <span className="text-muted-foreground">
                      Minimum Order:
                    </span>
                    <span>{row.minimumOrderQuantity}</span>
                  </HStack>
                )}
                {row.maximumOrderQuantity > 0 && (
                  <HStack className="justify-between w-full">
                    <span className="text-muted-foreground">
                      Maximum Order:
                    </span>
                    <span>{row.maximumOrderQuantity}</span>
                  </HStack>
                )}
              </VStack>

              <TableBase full>
                <Thead>
                  <Th>
                    <div className="flex items-center gap-2">
                      <LuHardHat />
                      <span>Job</span>
                    </div>
                  </Th>
                  <Th>
                    <div className="flex items-center gap-2 text-left">
                      <LuStar />
                      <span>Status</span>
                    </div>
                  </Th>
                  <Th>
                    <div className="flex items-center gap-2 text-right">
                      <LuPackage />
                      <span>Quantity</span>
                    </div>
                  </Th>
                  <Th>
                    <div className="flex items-center gap-2">
                      <LuCalendar />
                      <span>Due Date</span>
                    </div>
                  </Th>
                  <Th className="w-[50px]"></Th>
                </Thead>
                <Tbody>
                  {orders.map((order, index) => (
                    <Tr key={index}>
                      <Td className="group-hover:bg-inherit justify-between">
                        {order.existingReadableId && order.existingId ? (
                          <Link to={path.to.job(order.existingId)}>
                            {order.existingReadableId}
                          </Link>
                        ) : (
                          "New Job"
                        )}
                      </Td>
                      <Td className="flex flex-row items-center gap-1 group-hover:bg-inherit">
                        <JobStatus status={order.existingStatus as "Draft"} />
                      </Td>
                      <Td className="text-right group-hover:bg-inherit">
                        <NumberField
                          value={order.quantity}
                          onBlur={(e) => {
                            const datePickerInput = e.target
                              .closest("tr")
                              ?.querySelector(
                                '[role="textbox"]'
                              ) as HTMLElement;
                            if (datePickerInput) {
                              datePickerInput.focus();
                            }
                          }}
                          onChange={(value) => {
                            if (value) {
                              handleOrderUpdate(index, { quantity: value });
                            }
                          }}
                        >
                          <NumberInputGroup className="relative group-hover:bg-inherit">
                            <NumberInput />
                            <NumberInputStepper>
                              <NumberIncrementStepper>
                                <LuChevronUp size="1em" strokeWidth="3" />
                              </NumberIncrementStepper>
                              <NumberDecrementStepper>
                                <LuChevronDown size="1em" strokeWidth="3" />
                              </NumberDecrementStepper>
                            </NumberInputStepper>
                          </NumberInputGroup>
                        </NumberField>
                      </Td>
                      <Td className="text-right group-hover:bg-inherit">
                        <HStack className="justify-end">
                          <DatePicker
                            value={
                              order.dueDate ? parseDate(order.dueDate) : null
                            }
                            onChange={(date) => {
                              handleOrderUpdate(index, {
                                dueDate: date ? date.toString() : null,
                              });
                            }}
                          />
                        </HStack>
                      </Td>
                      <Td className="group-hover:bg-inherit">
                        <IconButton
                          aria-label="Remove order"
                          variant="ghost"
                          size="sm"
                          isDisabled={!!order.existingId}
                          onClick={() => onRemoveOrder(index)}
                          icon={<LuTrash2 className="text-destructive" />}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </TableBase>

              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-4"
                  leftIcon={<LuPlus />}
                  onClick={onAddOrder}
                >
                  Add Order
                </Button>
              </div>

              <ItemPlanningChart
                compact
                itemId={row.id}
                locationId={locationId}
                safetyStock={row.demandAccumulationSafetyStock}
                plannedOrders={orders}
              />
            </div>
          </DrawerBody>
          <DrawerFooter>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => onSubmit(row.id, orders)}
              isDisabled={fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
            >
              Order
            </Button>
          </DrawerFooter>
        </DrawerContent>
      ),
      [
        row,
        orders,
        locationId,
        fetcher.state,
        onClose,
        onAddOrder,
        onRemoveOrder,
        onSubmit,
        handleOrderUpdate,
      ]
    );

    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
        {drawerContent}
      </Drawer>
    );
  }
);

OrderDrawer.displayName = "OrderDrawer";

const ProductionPlanningTable = memo(
  ({ data, count, locationId, periods }: ProductionPlanningTableProps) => {
    const permissions = usePermissions();

    const dateFormatter = useDateFormatter({
      month: "short",
      day: "numeric",
    });

    const numberFormatter = useNumberFormatter();
    const locations = useLocations();
    const unitOfMeasures = useUnitOfMeasure();

    const mrpFetcher = useFetcher<typeof mrpAction>();
    const bulkUpdateFetcher = useFetcher<typeof bulkUpdateAction>();

    useEffect(() => {
      if (
        bulkUpdateFetcher.data?.success === false &&
        bulkUpdateFetcher?.data?.message
      ) {
        toast.error(bulkUpdateFetcher.data.message);
      }

      if (bulkUpdateFetcher.data?.success === true) {
        toast.success("Orders submitted");
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bulkUpdateFetcher.data?.success]);

    const isDisabled =
      !permissions.can("create", "production") ||
      bulkUpdateFetcher.state !== "idle" ||
      mrpFetcher.state !== "idle";

    const getOrders = useCallback(() => {
      const initialMap: Record<string, ProductionOrder[]> = {};
      data.forEach((item) => {
        if (item.id) {
          initialMap[item.id] = getProductionOrdersFromPlanning(item, periods);
        }
      });
      return initialMap;
    }, [data, periods]);

    // Store orders in a map keyed by item id
    const [ordersMap, setOrdersMap] = useState<
      Record<string, ProductionOrder[]>
    >(() => {
      const initialMap: Record<string, ProductionOrder[]> = {};
      data.forEach((item) => {
        if (item.id) {
          initialMap[item.id] = getProductionOrdersFromPlanning(item, periods);
        }
      });
      return initialMap;
    });

    useEffect(() => {
      setOrdersMap(getOrders());
    }, [getOrders]);

    const onBulkUpdate = useCallback(
      (selectedRows: typeof data, action: "order") => {
        const payload = {
          locationId,
          items: selectedRows
            .filter((row) => row.id)
            .map((row) => {
              const ordersWithPeriods = (ordersMap[row.id!] || []).map(
                (order) => {
                  // If no due date or due date is before first period, use first period
                  if (
                    !order.dueDate ||
                    parseDate(order.dueDate) < parseDate(periods[0].startDate)
                  ) {
                    return {
                      ...order,
                      periodId: periods[0].id,
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
                    periodId: period?.id ?? periods[periods.length - 1].id,
                  };
                }
              );

              return {
                id: row.id,
                orders: ordersWithPeriods,
              };
            }),
          action: action,
        };
        bulkUpdateFetcher.submit(payload, {
          method: "post",
          action: path.to.bulkUpdateProductionPlanning,
          encType: "application/json",
        });
      },
      [bulkUpdateFetcher, locationId, ordersMap, periods]
    );

    const [selectedItem, setSelectedItem] =
      useState<ProductionPlanningItem | null>(null);

    const setOrders = useCallback(
      (item: ProductionPlanningItem, orders: ProductionOrder[]) => {
        if (item.id) {
          setOrdersMap((prev) => ({
            ...prev,
            [item.id!]: orders,
          }));
        }
      },
      []
    );

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
                <div>
                  {isCurrentWeek ? "Present Week" : `Week ${weekNumber}`}
                </div>
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
          };
        }
      );

      return [
        {
          accessorKey: "readableIdWithRevision",
          header: "Part ID",
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
            icon: <LuBookMarked />,
          },
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
        },
        {
          accessorKey: "reorderingPolicy",
          header: "Reorder Policy",
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
                value: policy,
              })),
            },
            icon: <LuCircleCheck />,
          },
        },
        {
          accessorKey: "quantityOnHand",
          header: "On Hand",
          cell: ({ row }) =>
            numberFormatter.format(row.original.quantityOnHand),
          meta: {
            icon: <LuPackage />,
          },
        },
        ...periodColumns,
        {
          accessorKey: "type",
          header: "Type",
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
              options: itemTypes
                .filter((t) => ["Part", "Tool"].includes(t))
                .map((type) => ({
                  label: (
                    <HStack spacing={2}>
                      <MethodItemTypeIcon type={type} />
                      <span>{type}</span>
                    </HStack>
                  ),
                  value: type,
                })),
            },
            icon: <LuBox />,
          },
        },
        {
          id: "Order",
          header: "",
          cell: ({ row }) => {
            const orders = row.original.id
              ? ordersMap[row.original.id] || []
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
                      <span>Order {orderQuantity}</span>
                    </HStack>
                  ) : (
                    "Order"
                  )}
                </Button>
              </div>
            );
          },
        },
      ];
    }, [
      periods,
      dateFormatter,
      numberFormatter,
      unitOfMeasures,
      isDisabled,
      ordersMap,
    ]);

    const renderActions = useCallback(
      (selectedRows: typeof data) => {
        return (
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuLabel>Update</DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem
              onSelect={() => onBulkUpdate(selectedRows, "order")}
              disabled={bulkUpdateFetcher.state !== "idle"}
            >
              <DropdownMenuIcon icon={<LuSquareChartGantt />} />
              Order Parts
            </DropdownMenuItem>
          </DropdownMenuContent>
        );
      },
      [bulkUpdateFetcher.state, onBulkUpdate]
    );

    const defaultColumnVisibility = {
      active: false,
      type: false,
    };

    const defaultColumnPinning = {
      left: ["readableIdWithRevision"],
      right: ["Order"],
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
              <mrpFetcher.Form
                method="post"
                action={path.to.api.mrp(locationId)}
              >
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      type="submit"
                      variant="secondary"
                      rightIcon={<LuCirclePlay />}
                      isDisabled={mrpFetcher.state !== "idle"}
                      isLoading={mrpFetcher.state !== "idle"}
                    >
                      Recalculate
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
          title="Planning"
          table="production-planning"
          withSavedView
          withSelectableRows
        />

        {selectedItem && (
          <OrderDrawer
            locationId={locationId}
            row={selectedItem}
            orders={selectedItem.id ? ordersMap[selectedItem.id] || [] : []}
            setOrders={setOrders}
            periods={periods}
            isOpen={!!selectedItem}
            onClose={() => setSelectedItem(null)}
          />
        )}
      </>
    );
  }
);

ProductionPlanningTable.displayName = "ProductionPlanningTable";

export default ProductionPlanningTable;

function getLocationPath(locationId: string) {
  return `${path.to.productionPlanning}?location=${locationId}`;
}
