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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
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
  LuContainer,
  LuExternalLink,
  LuHardHat,
  LuPackage,
  LuPlus,
  LuSquareChartGantt,
  LuStar,
  LuTrash2,
} from "react-icons/lu";
import {
  ItemThumbnail,
  MethodItemTypeIcon,
  SupplierAvatar,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import { itemTypes } from "~/modules/inventory/inventory.models";
import { itemReorderingPolicies } from "~/modules/items/items.models";
import type { SupplierPart } from "~/modules/items/types";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import {
  getPurchaseOrdersFromPlanning,
  getReorderPolicyDescription,
  ItemReorderPolicy,
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";
import type { PlannedOrder } from "../../purchasing.models";
import type { PurchasingPlanningItem } from "../../types";
import { PurchasingStatus } from "../PurchaseOrder";

type PlanningTableProps = {
  data: PurchasingPlanningItem[];
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
    selectedSupplier,
    isOpen,
    onClose,
    onSupplierChange,
  }: {
    row: PurchasingPlanningItem;
    orders: PlannedOrder[];
    setOrders: (item: PurchasingPlanningItem, orders: PlannedOrder[]) => void;
    locationId: string;
    selectedSupplier: string;
    periods: { id: string; startDate: string; endDate: string }[];
    isOpen: boolean;
    onClose: () => void;
    onSupplierChange: (itemId: string, supplierId: string) => void;
  }) => {
    const fetcher = useFetcher<typeof bulkUpdateAction>();
    const { carbon } = useCarbon();

    const formatter = useCurrencyFormatter();
    const unitOfMeasureOptions = useUnitOfMeasure();

    // Add state for active tab
    const [activeTab, setActiveTab] = useState("ordering");

    // Memoize getExistingOrders callback
    const getExistingOrders = useCallback(async () => {
      if (!carbon || !row.id) return;

      const { data: existingOrderData } = await carbon
        ?.from("openPurchaseOrderLines")
        .select("*")
        .eq("itemId", row.id)
        .in("status", ["Draft", "Planned"]);

      if (existingOrderData) {
        console.log({ existingOrderData, orders });
        const existingOrders: PlannedOrder[] = existingOrderData
          .filter(
            (order) =>
              !orders.some((existing) => existing.existingId === order.id)
          )
          .map((order) => {
            const dueDate = order.dueDate;
            // If no due date or due date is before first period, use first period
            if (
              !dueDate ||
              parseDate(dueDate) < parseDate(periods[0].startDate)
            ) {
              return {
                existingId: order.purchaseOrderId ?? undefined,
                existingLineId: order.id ?? undefined,
                existingReadableId: order.purchaseOrderReadableId ?? undefined,
                existingQuantity:
                  order.status === "Draft" ? 0 : order?.quantityToReceive ?? 0,
                existingStatus: order.status ?? undefined,
                startDate: order.orderDate ?? null,
                dueDate: null,
                quantity: order.quantityToReceive ?? 0,
                isASAP: false,
                periodId: periods[0].id,
              };
            }

            // Find matching period based on due date
            const period = periods.find((p) => {
              const d = parseDate(dueDate!);
              const startDate = parseDate(p.startDate);
              const endDate = parseDate(p.endDate);
              return d >= startDate && d <= endDate;
            });

            // If no matching period found (date is after last period), use last period
            return {
              existingId: order.purchaseOrderId ?? undefined,
              existingLineId: order.id ?? undefined,
              existingReadableId: order.purchaseOrderReadableId ?? undefined,
              existingQuantity:
                order.status === "Draft" ? 0 : order?.quantityToReceive ?? 0,
              existingStatus: order.status ?? undefined,
              startDate: order.orderDate ?? null,
              dueDate: dueDate ?? null,
              quantity: order.quantityToReceive ?? 0,
              isASAP: false,
              periodId: period?.id ?? periods[periods.length - 1].id,
            };
          });

        console.log({ existingOrders });

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
        const newOrder: PlannedOrder = {
          quantity: row.lotSize ?? row.minimumOrderQuantity ?? 0,
          dueDate: today(getLocalTimeZone())
            .add({ days: row.leadTime ?? 0 })
            .toString(),
          startDate: today(getLocalTimeZone()).toString(),
          supplierId: row.preferredSupplierId,
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
      (id: string, orders: PlannedOrder[]) => {
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
          action: path.to.bulkUpdatePurchasingPlanning,
          encType: "application/json",
        });
      },
      [fetcher, locationId, periods]
    );

    // Memoize order update handler
    const handleOrderUpdate = useCallback(
      (index: number, updates: Partial<PlannedOrder>) => {
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
    }, [fetcher.data, onClose, row, setOrders]);

    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <DrawerContent size="lg">
            <DrawerHeader className="relative">
              <DrawerTitle className="flex items-center gap-2">
                <span>{row.readableIdWithRevision}</span>
                <Link
                  // @ts-ignore
                  to={getLinkToItemDetails(row.type, row.id)}
                >
                  <LuExternalLink />
                </Link>
              </DrawerTitle>
              <DrawerDescription>{row.name}</DrawerDescription>
              <div className="absolute top-8 right-16">
                <TabsList>
                  <TabsTrigger value="ordering">Ordering</TabsTrigger>
                  <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
                </TabsList>
              </div>
            </DrawerHeader>
            <DrawerBody>
              <div className="flex flex-col gap-4  w-full">
                <TabsContent value="suppliers">
                  <TableBase>
                    <Thead>
                      <Tr>
                        <Th>Supplier</Th>
                        <Th>UoM</Th>
                        <Th>Conversion</Th>
                        <Th>Unit Price</Th>
                        <Th />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {(row.suppliers as SupplierPart[])?.map((part) => (
                        <Tr key={part.id}>
                          <Td>
                            <SupplierAvatar supplierId={part.supplierId} />
                          </Td>
                          <Td>
                            {
                              unitOfMeasureOptions.find(
                                (uom) =>
                                  uom.value === part.supplierUnitOfMeasureCode
                              )?.label
                            }
                          </Td>
                          <Td>{part.conversionFactor}</Td>
                          <Td>{formatter.format(part.unitPrice ?? 0)}</Td>
                          <Td className="text-end">
                            <Button
                              variant="secondary"
                              size="sm"
                              isDisabled={selectedSupplier === part.supplierId}
                              onClick={() => {
                                if (row.id) {
                                  onSupplierChange(row.id, part.supplierId);

                                  // Update all orders with new supplier
                                  const updatedOrders = orders.map((order) => ({
                                    ...order,
                                    supplierId: part.supplierId,
                                  }));
                                  setOrders(row, updatedOrders);

                                  // Show toast and switch tab
                                  toast.success("Supplier updated");
                                  setActiveTab("ordering");
                                }
                              }}
                            >
                              Select
                            </Button>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </TableBase>
                </TabsContent>
                <TabsContent value="ordering" className="flex flex-col gap-4">
                  <VStack spacing={2} className="text-sm border rounded-lg p-4">
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">
                        Reorder Policy:
                      </span>
                      <ItemReorderPolicy
                        reorderingPolicy={row.reorderingPolicy}
                      />
                    </HStack>
                    <Separator />
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">Supplier:</span>
                      <SupplierAvatar supplierId={selectedSupplier} />
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
                      <Th className="pl-0 pr-1">
                        <div className="flex items-center gap-2">
                          <LuHardHat />
                          <span>PO</span>
                        </div>
                      </Th>
                      <Th className="px-1">
                        <div className="flex items-center gap-2 text-left">
                          <LuStar />
                          <span>Status</span>
                        </div>
                      </Th>
                      <Th className="px-1">
                        <div className="flex items-center gap-2 text-right">
                          <LuPackage />
                          <span>Quantity</span>
                        </div>
                      </Th>
                      <Th className="pr-1">
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
                          <Td className="pl-0 pr-1 group-hover:bg-inherit justify-between">
                            {order.existingReadableId && order.existingId ? (
                              <Link
                                to={path.to.purchaseOrder(order.existingId)}
                              >
                                {order.existingReadableId}
                              </Link>
                            ) : (
                              "New PO"
                            )}
                          </Td>
                          <Td className="flex flex-row items-center gap-1 px-1 group-hover:bg-inherit">
                            {/* @ts-expect-error - status is a string because we have a general type for purchase orders and purchaseOrderLines */}
                            <PurchasingStatus status={order.existingStatus} />
                          </Td>
                          <Td className="text-right px-1 group-hover:bg-inherit">
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
                          <Td className="text-right px-1 group-hover:bg-inherit">
                            <HStack className="justify-end">
                              <DatePicker
                                value={
                                  order.dueDate
                                    ? parseDate(order.dueDate)
                                    : null
                                }
                                onChange={(date) => {
                                  handleOrderUpdate(index, {
                                    dueDate: date ? date.toString() : null,
                                  });
                                }}
                              />
                            </HStack>
                          </Td>
                          <Td className="pl-1 pr-0 group-hover:bg-inherit">
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
                </TabsContent>
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
        </Tabs>
      </Drawer>
    );
  }
);

OrderDrawer.displayName = "OrderDrawer";

const PlanningTable = memo(
  ({ data, count, locationId, periods }: PlanningTableProps) => {
    const permissions = usePermissions();

    const dateFormatter = useDateFormatter({
      month: "short",
      day: "numeric",
    });

    const numberFormatter = useNumberFormatter();
    const locations = useLocations();
    const unitOfMeasures = useUnitOfMeasure();
    const [suppliers] = useSuppliers();

    const mrpFetcher = useFetcher<typeof mrpAction>();
    const bulkUpdateFetcher = useFetcher<typeof bulkUpdateAction>();

    const [suppliersMap, setSuppliersMap] = useState<Record<string, string>>(
      () => {
        const initial: Record<string, string> = {};
        data.forEach((item) => {
          initial[item.id] = item.preferredSupplierId;
        });
        return initial;
      }
    );

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
    }, [bulkUpdateFetcher.data]);

    const isDisabled =
      !permissions.can("create", "production") ||
      bulkUpdateFetcher.state !== "idle" ||
      mrpFetcher.state !== "idle";

    const getOrders = useCallback(() => {
      const initialMap: Record<string, PlannedOrder[]> = {};
      data.forEach((item) => {
        if (item.id) {
          // TODO: pass supplier override
          initialMap[item.id] = getPurchaseOrdersFromPlanning(
            item,
            periods,
            suppliersMap[item.id]
          );
        }
      });
      return initialMap;
    }, [data, periods, suppliersMap]);

    // Store orders in a map keyed by item id
    const [ordersMap, setOrdersMap] =
      useState<Record<string, PlannedOrder[]>>(getOrders);

    useEffect(() => {
      setOrdersMap(getOrders());
    }, [data, periods, getOrders]);

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
          action: path.to.bulkUpdatePurchasingPlanning,
          encType: "application/json",
        });
      },
      [bulkUpdateFetcher, locationId, ordersMap, periods]
    );

    const [selectedItem, setSelectedItem] =
      useState<PurchasingPlanningItem | null>(null);

    const setOrders = useCallback(
      (item: PurchasingPlanningItem, orders: PlannedOrder[]) => {
        if (item.id) {
          setOrdersMap((prev) => ({
            ...prev,
            [item.id!]: orders,
          }));
        }
      },
      []
    );

    const columns = useMemo<ColumnDef<PurchasingPlanningItem>[]>(() => {
      const periodColumns: ColumnDef<PurchasingPlanningItem>[] = periods.map(
        (period, index) => {
          const isCurrentWeek = index === 0;
          const weekNumber = index + 1;
          const weekKey = `week${weekNumber}` as keyof PurchasingPlanningItem;
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
          accessorKey: "preferredSupplierId",
          header: "Supplier",
          cell: (item) => {
            return (
              <SupplierAvatar supplierId={suppliersMap[item.row.original.id]} />
            );
          },
          meta: {
            filter: {
              type: "static",
              options: suppliers.map((supplier) => ({
                label: supplier.name,
                value: supplier.id,
              })),
            },
            icon: <LuContainer />,
          },
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
          },
        },
      ];
    }, [
      periods,
      suppliers,
      dateFormatter,
      numberFormatter,
      unitOfMeasures,
      suppliersMap,
      ordersMap,
      isDisabled,
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
          table="planning"
          withSavedView
          withSelectableRows
        />

        {selectedItem && (
          <OrderDrawer
            locationId={locationId}
            row={selectedItem}
            selectedSupplier={suppliersMap[selectedItem.id]}
            orders={selectedItem.id ? ordersMap[selectedItem.id] || [] : []}
            setOrders={setOrders}
            periods={periods}
            isOpen={!!selectedItem}
            onClose={() => setSelectedItem(null)}
            onSupplierChange={(itemId, supplierId) => {
              setSuppliersMap((prev) => ({
                ...prev,
                [itemId]: supplierId,
              }));
            }}
          />
        )}
      </>
    );
  }
);

PlanningTable.displayName = "PlanningTable";

export default PlanningTable;

function getLocationPath(locationId: string) {
  return `${path.to.productionPlanning}?location=${locationId}`;
}
