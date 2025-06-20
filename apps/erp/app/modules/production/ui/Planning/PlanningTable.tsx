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
import type { FetcherWithComponents } from "@remix-run/react";
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
  LuTrash2,
} from "react-icons/lu";
import { ItemThumbnail, MethodItemTypeIcon, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions } from "~/hooks";
import { itemTypes } from "~/modules/inventory/inventory.models";
import type { Order } from "~/modules/items/items.models";
import { itemReorderingPolicies } from "~/modules/items/items.models";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import {
  getOrdersFromProductionPlanning,
  getReorderPolicyDescription,
  ItemReorderPolicy,
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { path } from "~/utils/path";
import type { ProductionPlanningItem } from "../../types";
import { getDeadlineIcon, JobStatus } from "../Jobs";

type PlanningTableProps = {
  data: ProductionPlanningItem[];
  count: number;
  locationId: string;
  periods: { id: string; startDate: string; endDate: string }[];
};

const OrderDrawer = memo(
  ({
    fetcher,
    row,
    orders,
    setOrders,
    locationId,
    isOpen,
    onClose,
  }: {
    fetcher: FetcherWithComponents<typeof bulkUpdateAction>;
    row: ProductionPlanningItem;
    orders: Order[];
    setOrders: (item: ProductionPlanningItem, orders: Order[]) => void;
    locationId: string;
    isOpen: boolean;
    onClose: () => void;
  }) => {
    const { carbon } = useCarbon();
    const getExistingOrders = useCallback(async () => {
      if (!carbon || !row.id) return;

      const { data: existingOrderData } = await carbon
        ?.from("job")
        .select("*")
        .eq("itemId", row.id)
        .in("status", ["Draft", "Planned"]);

      if (existingOrderData) {
        const existingOrders: Order[] = existingOrderData
          .filter(
            (order) =>
              !orders.some((existing) => existing.existingId === order.id)
          )
          .map((order) => ({
            existingId: order.id,
            existingReadableId: order.jobId,
            existingQuantity: order.quantity,
            existingStatus: order.status,
            startDate: order.startDate ?? null,
            dueDate: order.dueDate ?? null,
            quantity: order.quantity,
            isASAP: order.deadlineType === "ASAP",
          }));

        setOrders(
          row,
          [...orders, ...existingOrders].sort((a, b) => {
            return a.dueDate?.localeCompare(b.dueDate ?? "") ?? 0;
          })
        );
      }
    }, [carbon, orders, row, setOrders]);

    useMount(() => {
      if (row.id) {
        getExistingOrders();
      }
    });
    console.log({ orders });

    const onAddOrder = () => {
      if (row.id) {
        const newOrder: Order = {
          quantity: row.lotSize ?? row.minimumOrderQuantity ?? 0,
          dueDate: today(getLocalTimeZone())
            .add({ days: row.leadTime ?? 0 })
            .toString(),
          startDate: today(getLocalTimeZone()).toString(),
          isASAP: false,
        };
        setOrders(row, [...orders, newOrder]);
      }
    };

    const onRemoveOrder = (index: number) => {
      if (row.id) {
        const newOrders = orders.filter((_, i) => i !== index);
        setOrders(row, newOrders);
      }
    };

    const onSubmit = useCallback(
      (id: string, orders: Order[]) => {
        const payload = {
          locationId,
          items: [
            {
              id: id,
              orders: orders,
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
      [fetcher, locationId]
    );

    useEffect(() => {
      if (fetcher.data?.success === false && fetcher?.data?.message) {
        toast.error(fetcher.data.message);
      }

      if (fetcher.data?.success === true) {
        toast.success("Orders submitted");
        onClose();
      }
    }, [fetcher.data, fetcher.state]);

    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DrawerContent size="lg">
          <DrawerHeader>
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
          </DrawerHeader>
          <DrawerBody>
            <div className="flex flex-col gap-4  w-full">
              {(row.lotSize ||
                row.minimumOrderQuantity ||
                row.maximumOrderQuantity) && (
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
              )}

              <TableBase full>
                <Thead>
                  <Th className="pl-0">
                    <div className="flex items-center gap-2">
                      <LuHardHat />
                      <span>Job</span>
                    </div>
                  </Th>
                  <Th>
                    <div className="px-1 flex items-center gap-2 text-right">
                      <LuPackage />
                      <span>Quantity</span>
                    </div>
                  </Th>
                  <Th>
                    <div className="justify-end flex items-center gap-2">
                      <LuCalendar />
                      <span>Due Date</span>
                    </div>
                  </Th>
                  <Th className="w-[50px]"></Th>
                </Thead>
                <Tbody>
                  {orders.map((order, index) => (
                    <Tr key={index}>
                      <Td className="flex flex-row items-center gap-1 pl-0 pr-1 group-hover:bg-inherit justify-between">
                        {order.existingReadableId && order.existingId ? (
                          <VStack spacing={0}>
                            <Link to={path.to.job(order.existingId)}>
                              {order.existingReadableId}
                            </Link>
                            {/* @ts-expect-error - status is a string because we have a general type for purchase orders and jobs */}
                            <JobStatus status={order.existingStatus} />
                          </VStack>
                        ) : (
                          "New Job"
                        )}
                        {order.isASAP && getDeadlineIcon("ASAP")}
                      </Td>
                      <Td className="text-right px-1 group-hover:bg-inherit">
                        <NumberField
                          value={order.quantity}
                          onChange={(value) => {
                            if (row.id && value) {
                              const newOrders = [...orders];
                              newOrders[index] = {
                                ...order,
                                quantity: value,
                              };
                              setOrders(row, newOrders);
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
                              order.dueDate ? parseDate(order.dueDate) : null
                            }
                            onChange={(date) => {
                              if (row.id) {
                                const newOrders = [...orders];
                                newOrders[index] = {
                                  ...order,
                                  dueDate: date ? date.toString() : null,
                                };
                                setOrders(row, newOrders);
                              }
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
      </Drawer>
    );
  }
);

OrderDrawer.displayName = "OrderDrawer";

const PlanningTable = memo(
  ({ data, count, locationId, periods }: PlanningTableProps) => {
    const permissions = usePermissions();
    const isDisabled = !permissions.can("create", "production");

    const dateFormatter = useDateFormatter({
      month: "short",
      day: "numeric",
    });

    const numberFormatter = useNumberFormatter();
    const locations = useLocations();
    const unitOfMeasures = useUnitOfMeasure();

    const bulkUpdateFetcher = useFetcher<typeof bulkUpdateAction>();

    // Store orders in a map keyed by item id
    const [ordersMap, setOrdersMap] = useState<Record<string, Order[]>>(() => {
      const initialMap: Record<string, Order[]> = {};
      data.forEach((item) => {
        if (item.id) {
          initialMap[item.id] = getOrdersFromProductionPlanning(item, periods);
        }
      });
      return initialMap;
    });

    const onBulkUpdate = useCallback(
      (selectedRows: typeof data, action: "order") => {
        const payload = {
          locationId,
          items: selectedRows
            .filter((row) => row.id)
            .map((row) => {
              return {
                id: row.id,
                orders: ordersMap[row.id!] || [],
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
      [bulkUpdateFetcher, locationId, ordersMap]
    );

    const [selectedItem, setSelectedItem] =
      useState<ProductionPlanningItem | null>(null);

    const setOrders = useCallback(
      (item: ProductionPlanningItem, orders: Order[]) => {
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
            const hasOrders = orders.length > 0;
            const orderQuantity = orders.reduce(
              (acc, order) =>
                acc + (order.quantity - (order.existingQuantity ?? 0)),
              0
            );
            return (
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  leftIcon={hasOrders ? undefined : <LuCircleCheck />}
                  isDisabled={isDisabled}
                  onClick={() => {
                    setSelectedItem(row.original);
                  }}
                >
                  {hasOrders ? (
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
            <DropdownMenuLabel>Bulk Update</DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem
              onSelect={() => onBulkUpdate(data, "order")}
              disabled={bulkUpdateFetcher.state !== "idle"}
            >
              <DropdownMenuIcon icon={<LuSquareChartGantt />} />
              Order Parts
            </DropdownMenuItem>
          </DropdownMenuContent>
        );
      },
      [bulkUpdateFetcher.state, onBulkUpdate, data]
    );

    const defaultColumnVisibility = {
      active: false,
      type: false,
    };

    const defaultColumnPinning = {
      left: ["readableIdWithRevision"],
      right: ["Order"],
    };

    const mrpFetcher = useFetcher<typeof mrpAction>();

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
          table="planning"
          withSavedView
          withSelectableRows
        />

        {selectedItem && (
          <OrderDrawer
            // @ts-ignore
            fetcher={bulkUpdateFetcher}
            locationId={locationId}
            row={selectedItem}
            orders={selectedItem.id ? ordersMap[selectedItem.id] || [] : []}
            setOrders={setOrders}
            isOpen={!!selectedItem}
            onClose={() => setSelectedItem(null)}
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
