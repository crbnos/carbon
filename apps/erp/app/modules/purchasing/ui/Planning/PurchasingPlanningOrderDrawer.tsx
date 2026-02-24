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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  useDisclosure,
  useMount,
  VStack
} from "@carbon/react";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { memo, useCallback, useEffect, useState } from "react";
import {
  LuCalendar,
  LuChevronDown,
  LuChevronUp,
  LuCircleCheck,
  LuCirclePlay,
  LuCirclePlus,
  LuExternalLink,
  LuPackage,
  LuPlus,
  LuStar,
  LuTrash2
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { SupplierAvatar } from "~/components";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { useCurrencyFormatter } from "~/hooks";
import type { SupplierPart } from "~/modules/items/types";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { getLinkToItemPlanning } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import { ItemReorderPolicy } from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { path } from "~/utils/path";
import type { PlannedOrder } from "../../purchasing.models";
import type { PurchasingPlanningItem } from "../../types";
import { PurchasingStatus } from "../PurchaseOrder";

type PurchasingPlanningOrderDrawerProps = {
  isOpen: boolean;
  locationId: string;
  orders: PlannedOrder[];
  periods: { id: string; startDate: string; endDate: string }[];
  selectedItem: PurchasingPlanningItem;
  selectedSupplier: string;
  onClose: () => void;
  onSupplierChange: (itemId: string, supplierId: string) => void;
  setOrders: (item: PurchasingPlanningItem, orders: PlannedOrder[]) => void;
  setSelectedItem: (item: PurchasingPlanningItem) => void;
};

export const PurchasingPlanningOrderDrawer = memo(
  ({
    selectedItem,
    setSelectedItem,
    orders,
    setOrders,
    locationId,
    periods,
    selectedSupplier,
    isOpen,
    onClose,
    onSupplierChange
  }: PurchasingPlanningOrderDrawerProps) => {
    const fetcher = useFetcher<typeof bulkUpdateAction>();
    const { carbon } = useCarbon();

    const formatter = useCurrencyFormatter();
    const unitOfMeasureOptions = useUnitOfMeasure();

    const [activeTab, setActiveTab] = useState("ordering");

    const getExistingOrders = useCallback(async () => {
      if (!carbon || !selectedItem.id) return;

      const { data: existingOrderData } = await carbon
        ?.from("openPurchaseOrderLines")
        .select("*")
        .eq("itemId", selectedItem.id)
        .in("status", ["Draft", "Planned"]);

      if (existingOrderData) {
        const existingOrders: PlannedOrder[] = existingOrderData
          .filter(
            (order) =>
              !orders.some((existing) => existing.existingId === order.id)
          )
          .map((order) => {
            const dueDate = order.dueDate;

            if (
              !dueDate ||
              parseDate(dueDate) < parseDate(periods[0].startDate)
            ) {
              return {
                existingId: order.purchaseOrderId ?? undefined,
                existingLineId: order.id ?? undefined,
                existingReadableId: order.purchaseOrderReadableId ?? undefined,
                existingQuantity:
                  order.status === "Draft"
                    ? 0
                    : (order?.quantityToReceive ?? 0),
                existingStatus: order.status ?? undefined,
                startDate: order.orderDate ?? null,
                dueDate: null,
                quantity: order.quantityToReceive ?? 0,
                periodId: periods[0].id,
                supplierId: order.supplierId ?? undefined
              };
            }

            const period = periods.find((p) => {
              const d = parseDate(dueDate!);
              const startDate = parseDate(p.startDate);
              const endDate = parseDate(p.endDate);
              return d >= startDate && d <= endDate;
            });

            return {
              existingId: order.purchaseOrderId ?? undefined,
              existingLineId: order.id ?? undefined,
              existingReadableId: order.purchaseOrderReadableId ?? undefined,
              existingQuantity:
                order.status === "Draft" ? 0 : (order?.quantityToReceive ?? 0),
              existingStatus: order.status ?? undefined,
              startDate: order.orderDate ?? null,
              dueDate: dueDate ?? null,
              quantity: order.quantityToReceive ?? 0,
              isASAP: false,
              periodId: period?.id ?? periods[periods.length - 1].id,
              supplierId: order.supplierId ?? undefined
            };
          });

        // Backend now handles grouping items by supplier into single POs
        // So we just need to merge the existing orders with current orders
        setOrders(
          selectedItem,
          [...orders, ...existingOrders].sort((a, b) => {
            return a.dueDate?.localeCompare(b.dueDate ?? "") ?? 0;
          })
        );
      }
    }, [carbon, selectedItem, orders, periods, setOrders]);

    useMount(async () => {
      if (selectedItem.id) {
        getExistingOrders();
      }
    });

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    useEffect(() => {
      if (selectedItem.id) {
        getExistingOrders();
      }
    }, [selectedSupplier]);

    const onAddOrder = useCallback(() => {
      if (selectedItem.id) {
        // Get the conversion factor from the selected supplier
        const supplier = (selectedItem.suppliers as SupplierPart[])?.find(
          (s) => s.supplierId === selectedSupplier
        );
        const conversionFactor = supplier?.conversionFactor ?? 1;

        // Convert inventory quantity to purchase quantity
        const inventoryQuantity =
          selectedItem.lotSize ?? selectedItem.minimumOrderQuantity ?? 0;
        const purchaseQuantity =
          conversionFactor > 0
            ? Math.ceil(inventoryQuantity / conversionFactor)
            : inventoryQuantity;

        const newOrder: PlannedOrder = {
          quantity: purchaseQuantity,
          dueDate: today(getLocalTimeZone())
            .add({ days: selectedItem.leadTime ?? 0 })
            .toString(),
          startDate: today(getLocalTimeZone()).toString(),
          supplierId: selectedItem.preferredSupplierId,
          itemReadableId: selectedItem.readableIdWithRevision,
          description: selectedItem.name,
          periodId: periods[0].id
        };
        setOrders(selectedItem, [...orders, newOrder]);
      }
    }, [selectedItem, orders, setOrders, periods, selectedSupplier]);

    const onRemoveOrder = useCallback(
      (index: number) => {
        if (selectedItem.id) {
          const newOrders = orders.filter((_, i) => i !== index);
          setOrders(selectedItem, newOrders);
        }
      },
      [selectedItem, orders, setOrders]
    );

    const onSubmit = useCallback(
      (id: string, orders: PlannedOrder[]) => {
        const ordersWithPeriods = orders.map((order) => {
          if (
            !order.dueDate ||
            parseDate(order.dueDate) < parseDate(periods[0].startDate)
          ) {
            return {
              ...order,
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
          action: path.to.bulkUpdatePurchasingPlanning,
          encType: "application/json"
        });
      },
      [fetcher, locationId, periods]
    );

    const onOrderUpdate = useCallback(
      (index: number, updates: Partial<PlannedOrder>) => {
        if (selectedItem.id) {
          const newOrders = [...orders];
          newOrders[index] = {
            ...orders[index],
            ...updates
          };
          setOrders(selectedItem, newOrders);
        }
      },
      [selectedItem, orders, setOrders]
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    useEffect(() => {
      if (fetcher.data?.success === false && fetcher?.data?.message) {
        toast.error(fetcher.data.message);
      }

      if (fetcher.data?.success === true) {
        toast.success("Orders submitted");
        setOrders(selectedItem, []);
        onClose();
      }
    }, [fetcher.data?.success]);

    const supplierDisclosure = useDisclosure();

    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <DrawerContent size="lg">
            <DrawerHeader className="relative">
              <DrawerTitle className="flex items-center gap-2">
                <span>{selectedItem.readableIdWithRevision}</span>
                <Link
                  to={getLinkToItemPlanning(
                    selectedItem.type as "Part",
                    selectedItem.id
                  )}
                >
                  <LuExternalLink />
                </Link>
              </DrawerTitle>
              <DrawerDescription>{selectedItem.name}</DrawerDescription>
              <div className="absolute top-8 right-16">
                <TabsList>
                  <TabsTrigger value="ordering">Ordering</TabsTrigger>
                  <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
                </TabsList>
              </div>
            </DrawerHeader>
            <DrawerBody>
              <div className="flex flex-col gap-4  w-full">
                <TabsContent value="suppliers" className="flex flex-col gap-4">
                  <TableBase>
                    <Thead>
                      <Tr>
                        <Th>Supplier</Th>
                        <Th>Unit</Th>
                        <Th>Conversion</Th>
                        <Th>Unit Price</Th>
                        <Th />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {(selectedItem.suppliers as SupplierPart[])?.map(
                        (part) => (
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
                                isDisabled={
                                  selectedSupplier === part.supplierId
                                }
                                leftIcon={<LuCircleCheck />}
                                onClick={() => {
                                  if (selectedItem.id) {
                                    onSupplierChange(
                                      selectedItem.id,
                                      part.supplierId
                                    );

                                    const updatedOrders = orders.map(
                                      (order) => ({
                                        ...order,
                                        supplierId: part.supplierId
                                      })
                                    );
                                    setOrders(selectedItem, updatedOrders);

                                    toast.success("Supplier updated");
                                    setActiveTab("ordering");
                                  }
                                }}
                              >
                                Select
                              </Button>
                            </Td>
                          </Tr>
                        )
                      )}
                    </Tbody>
                  </TableBase>
                  <div>
                    <Button
                      variant="secondary"
                      leftIcon={<LuCirclePlus />}
                      onClick={supplierDisclosure.onOpen}
                    >
                      Add Supplier
                    </Button>
                    {supplierDisclosure.isOpen && (
                      <SupplierPartForm
                        type="Part"
                        initialValues={{
                          itemId: selectedItem.id,
                          supplierId: "",
                          supplierPartId: "",
                          unitPrice: 0,
                          supplierUnitOfMeasureCode: "EA",
                          minimumOrderQuantity: 1,
                          conversionFactor: 1
                        }}
                        unitOfMeasureCode={selectedItem.unitOfMeasureCode ?? ""}
                        onClose={() => {
                          if (carbon && selectedItem.id) {
                            carbon
                              ?.from("supplierPart")
                              .select("*")
                              .eq("itemId", selectedItem.id)
                              .then(({ data }) => {
                                if (data) {
                                  setSelectedItem(
                                    // @ts-expect-error
                                    (prev: PurchasingPlanningItem) => {
                                      return {
                                        ...prev,
                                        suppliers: data as SupplierPart[]
                                      };
                                    }
                                  );

                                  // Auto-select the newly added supplier if it's the only one
                                  if (data.length === 1 && selectedItem.id) {
                                    onSupplierChange(
                                      selectedItem.id,
                                      data[0].supplierId
                                    );

                                    const updatedOrders = orders.map(
                                      (order) => ({
                                        ...order,
                                        supplierId: data[0].supplierId
                                      })
                                    );
                                    setOrders(selectedItem, updatedOrders);

                                    toast.success(
                                      "Supplier added and selected"
                                    );
                                    setActiveTab("ordering");
                                  }
                                }
                              });
                          }
                          supplierDisclosure.onClose();
                        }}
                      />
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="ordering" className="flex flex-col gap-4">
                  <VStack spacing={2} className="text-sm border rounded-lg p-4">
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">
                        Reorder Policy:
                      </span>
                      <ItemReorderPolicy
                        reorderingPolicy={selectedItem.reorderingPolicy}
                      />
                    </HStack>
                    <Separator />
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">Supplier:</span>
                      <SupplierAvatar supplierId={selectedSupplier} />
                    </HStack>
                    <Separator />
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">
                        Purchase Unit:
                      </span>
                      <span>
                        {unitOfMeasureOptions.find(
                          (uom) =>
                            uom.value ===
                            (selectedItem.suppliers as SupplierPart[])?.find(
                              (s) => s.supplierId === selectedSupplier
                            )?.supplierUnitOfMeasureCode
                        )?.label ??
                          selectedItem.unitOfMeasureCode ??
                          "EA"}
                      </span>
                    </HStack>
                    {(() => {
                      const supplier = (
                        selectedItem.suppliers as SupplierPart[]
                      )?.find((s) => s.supplierId === selectedSupplier);
                      const conversionFactor = supplier?.conversionFactor ?? 1;
                      return conversionFactor !== 1 ? (
                        <HStack className="justify-between w-full">
                          <span className="text-muted-foreground">
                            Conversion:
                          </span>
                          <span>1 Purchase = {conversionFactor} Inventory</span>
                        </HStack>
                      ) : null;
                    })()}
                    <Separator />
                    {selectedItem.reorderingPolicy === "Maximum Quantity" && (
                      <>
                        <HStack className="justify-between w-full">
                          <span className="text-muted-foreground">
                            Reorder Point:
                          </span>
                          <span>{selectedItem.reorderPoint}</span>
                        </HStack>
                        <HStack className="justify-between w-full">
                          <span className="text-muted-foreground">
                            Maximum Inventory:
                          </span>
                          <span>{selectedItem.maximumInventoryQuantity}</span>
                        </HStack>
                      </>
                    )}

                    {selectedItem.reorderingPolicy ===
                      "Demand-Based Reorder" && (
                      <>
                        <HStack className="justify-between w-full">
                          <span className="text-muted-foreground">
                            Accumulation Period:
                          </span>
                          <span>
                            {selectedItem.demandAccumulationPeriod} weeks
                          </span>
                        </HStack>
                        <HStack className="justify-between w-full">
                          <span className="text-muted-foreground">
                            Safety Stock:
                          </span>
                          <span>
                            {selectedItem.demandAccumulationSafetyStock}
                          </span>
                        </HStack>
                      </>
                    )}

                    {selectedItem.reorderingPolicy ===
                      "Fixed Reorder Quantity" && (
                      <>
                        <HStack className="justify-between w-full">
                          <span className="text-muted-foreground">
                            Reorder Point:
                          </span>
                          <span>{selectedItem.reorderPoint}</span>
                        </HStack>
                        <HStack className="justify-between w-full">
                          <span className="text-muted-foreground">
                            Reorder Quantity:
                          </span>
                          <span>{selectedItem.reorderQuantity}</span>
                        </HStack>
                      </>
                    )}
                    {(selectedItem.lotSize > 0 ||
                      selectedItem.minimumOrderQuantity > 0 ||
                      selectedItem.maximumOrderQuantity > 0) && <Separator />}
                    {selectedItem.lotSize > 0 && (
                      <HStack className="justify-between w-full">
                        <span className="text-muted-foreground">Lot Size:</span>
                        <span>{selectedItem.lotSize}</span>
                      </HStack>
                    )}
                    {selectedItem.minimumOrderQuantity > 0 && (
                      <HStack className="justify-between w-full">
                        <span className="text-muted-foreground">
                          Minimum Order:
                        </span>
                        <span>{selectedItem.minimumOrderQuantity}</span>
                      </HStack>
                    )}
                    {selectedItem.maximumOrderQuantity > 0 && (
                      <HStack className="justify-between w-full">
                        <span className="text-muted-foreground">
                          Maximum Order:
                        </span>
                        <span>{selectedItem.maximumOrderQuantity}</span>
                      </HStack>
                    )}
                  </VStack>

                  <TableBase full>
                    <Thead>
                      <Tr>
                        <Th>
                          <div className="flex items-center gap-2">
                            <LuCirclePlay />
                            <span>PO</span>
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
                            <span>Purchase Qty</span>
                          </div>
                        </Th>
                        <Th>
                          <div className="flex items-center gap-2">
                            <LuCalendar />
                            <span>Due Date</span>
                          </div>
                        </Th>
                        <Th className="w-[50px]"></Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {orders.map((order, index) => {
                        const isDisabled =
                          selectedSupplier !== order.supplierId &&
                          !!order.existingId;

                        return (
                          <Tr key={index}>
                            <Td className="group-hover:bg-inherit justify-between">
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
                            <Td className="flex flex-row items-center gap-1 group-hover:bg-inherit">
                              {/* @ts-expect-error - status is a string because we have a general type for purchase orders and purchaseOrderLines */}
                              <PurchasingStatus status={order.existingStatus} />
                            </Td>
                            <Td className="text-right group-hover:bg-inherit">
                              <NumberField
                                value={
                                  isDisabled
                                    ? order.existingQuantity
                                    : order.quantity
                                }
                                isDisabled={isDisabled}
                                onChange={(value) => {
                                  if (value) {
                                    onOrderUpdate(index, {
                                      quantity: value
                                    });
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
                                      <LuChevronDown
                                        size="1em"
                                        strokeWidth="3"
                                      />
                                    </NumberDecrementStepper>
                                  </NumberInputStepper>
                                </NumberInputGroup>
                              </NumberField>
                            </Td>
                            <Td className="text-right group-hover:bg-inherit">
                              <HStack className="justify-end">
                                <DatePicker
                                  value={
                                    order.dueDate
                                      ? parseDate(order.dueDate)
                                      : null
                                  }
                                  onChange={(date) => {
                                    onOrderUpdate(index, {
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
                        );
                      })}
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
                    itemId={selectedItem.id}
                    locationId={locationId}
                    safetyStock={selectedItem.demandAccumulationSafetyStock}
                    plannedOrders={orders}
                    conversionFactor={
                      (selectedItem.suppliers as SupplierPart[])?.find(
                        (s) => s.supplierId === selectedSupplier
                      )?.conversionFactor ?? 1
                    }
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
                onClick={() => {
                  if (!selectedSupplier) {
                    toast.error(
                      "Cannot place order - no supplier associated with this item"
                    );
                    return;
                  }
                  onSubmit(selectedItem.id, orders);
                }}
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

PurchasingPlanningOrderDrawer.displayName = "PurchasingPlanningOrderDrawer";
