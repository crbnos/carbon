import { useCarbon } from "@carbon/auth";
import {
  Button,
  DatePicker,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  IconButton,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Separator,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  useMount,
  VStack
} from "@carbon/react";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { memo, useCallback, useEffect, useMemo } from "react";
import {
  LuCalendar,
  LuChevronDown,
  LuChevronUp,
  LuCirclePlay,
  LuExternalLink,
  LuPackage,
  LuPlus,
  LuStar,
  LuTrash2
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { getLinkToItemPlanning } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import { ItemReorderPolicy } from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { ProductionOrder } from "~/modules/production";
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { path } from "~/utils/path";
import type { ProductionPlanningItem } from "../../types";
import { JobStatus } from "../Jobs";

type ProductionPlanningOrderDrawerProps = {
  row: ProductionPlanningItem;
  orders: ProductionOrder[];
  setOrders: (item: ProductionPlanningItem, orders: ProductionOrder[]) => void;
  locationId: string;
  periods: { id: string; startDate: string; endDate: string }[];
  isOpen: boolean;
  onClose: () => void;
};

export const ProductionPlanningOrderDrawer = memo(
  ({
    row,
    orders,
    setOrders,
    locationId,
    periods,
    isOpen,
    onClose
  }: ProductionPlanningOrderDrawerProps) => {
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
              existingId: order.id,
              existingReadableId: order.jobId,
              existingQuantity: order.status === "Draft" ? 0 : order.quantity,
              existingStatus: order.status,
              startDate: order.startDate ?? null,
              dueDate: order.dueDate ?? null,
              quantity: order.quantity,
              isASAP: order.deadlineType === "ASAP",
              periodId: period?.id ?? periods[periods.length - 1].id
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
          periodId: periods[0].id
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

        const payload = {
          locationId,
          items: [
            {
              id: id,
              orders: ordersWithPeriods
            }
          ],
          action: "order" as const
        };
        fetcher.submit(payload, {
          method: "post",
          action: path.to.bulkUpdateProductionPlanning,
          encType: "application/json"
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
            ...updates
          };
          setOrders(row, newOrders);
        }
      },
      [row, orders, setOrders]
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    useEffect(() => {
      if (fetcher.data?.success === false && fetcher?.data?.message) {
        toast.error(fetcher.data.message);
      }

      if (fetcher.data?.success === true) {
        toast.success("Orders submitted");
        setOrders(row, []);
        onClose();
      }
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
                      <LuCirclePlay />
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
                                dueDate: date ? date.toString() : null
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
        handleOrderUpdate
      ]
    );

    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
        {drawerContent}
      </Drawer>
    );
  }
);

ProductionPlanningOrderDrawer.displayName = "ProductionPlanningOrderDrawer";
