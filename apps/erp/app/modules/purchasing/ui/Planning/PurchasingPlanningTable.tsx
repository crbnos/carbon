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
  Status,
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
  useDisclosure,
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
  LuCirclePlus,
  LuClock,
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
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { getLinkToItemPlanning } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import {
  getPurchaseOrdersFromPlanning,
  getReorderPolicyDescription,
  ItemReorderPolicy,
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { useItems } from "~/stores";
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
    selectedItem,
    setSelectedItem,
    orders,
    setOrders,
    locationId,
    periods,
    selectedSupplier,
    isOpen,
    onClose,
    onSupplierChange,
  }: {
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
  }) => {
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
                  order.status === "Draft" ? 0 : order?.quantityToReceive ?? 0,
                existingStatus: order.status ?? undefined,
                startDate: order.orderDate ?? null,
                dueDate: null,
                quantity: order.quantityToReceive ?? 0,
                periodId: periods[0].id,
                supplierId: order.supplierId ?? undefined,
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
                order.status === "Draft" ? 0 : order?.quantityToReceive ?? 0,
              existingStatus: order.status ?? undefined,
              startDate: order.orderDate ?? null,
              dueDate: dueDate ?? null,
              quantity: order.quantityToReceive ?? 0,
              isASAP: false,
              periodId: period?.id ?? periods[periods.length - 1].id,
              supplierId: order.supplierId ?? undefined,
            };
          });

        if (selectedSupplier) {
          const { data: existingPurchaseOrders } = await carbon
            ?.from("purchaseOrder")
            .select(
              "id, purchaseOrderId, orderDate, status, purchaseOrderDelivery(receiptRequestedDate, receiptPromisedDate)"
            )
            .eq("supplierId", selectedSupplier)
            .in("status", ["Draft", "Planned"]);

          const existingPOs =
            existingPurchaseOrders?.map((order) => {
              const dueDate =
                order?.purchaseOrderDelivery?.receiptPromisedDate ??
                order?.purchaseOrderDelivery?.receiptRequestedDate;
              return {
                id: order.id,
                readableId: order.purchaseOrderId,
                status: order.status,
                dueDate,
              };
            }) ?? [];

          const ordersMappedToExistingPOs = orders.map((order) => {
            const period = periods.find((p) => p.id === order.periodId);

            if (period) {
              const firstPOInPeriod = existingPOs.find((po) => {
                const dueDate = po?.dueDate ? parseDate(po.dueDate) : null;
                return (
                  dueDate !== null &&
                  parseDate(period.startDate) <= dueDate &&
                  parseDate(period.endDate) >= dueDate
                );
              });

              if (firstPOInPeriod) {
                return {
                  ...order,
                  existingId: firstPOInPeriod.id,
                  existingLineId: undefined,
                  existingReadableId: firstPOInPeriod.readableId,
                  existingStatus: firstPOInPeriod.status,
                };
              }
            }

            return order;
          });

          setOrders(
            selectedItem,
            [...ordersMappedToExistingPOs, ...existingOrders].sort((a, b) => {
              return a.dueDate?.localeCompare(b.dueDate ?? "") ?? 0;
            })
          );
        } else {
          setOrders(
            selectedItem,
            [...orders, ...existingOrders].sort((a, b) => {
              return a.dueDate?.localeCompare(b.dueDate ?? "") ?? 0;
            })
          );
        }
      }
    }, [carbon, selectedItem, selectedSupplier, orders, periods, setOrders]);

    useMount(async () => {
      if (selectedItem.id) {
        getExistingOrders();
      }
    });

    useEffect(() => {
      if (selectedItem.id) {
        getExistingOrders();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
          periodId: periods[0].id,
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
              periodId: periods[0].id,
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

    const onOrderUpdate = useCallback(
      (index: number, updates: Partial<PlannedOrder>) => {
        if (selectedItem.id) {
          const newOrders = [...orders];
          newOrders[index] = {
            ...orders[index],
            ...updates,
          };
          setOrders(selectedItem, newOrders);
        }
      },
      [selectedItem, orders, setOrders]
    );

    useEffect(() => {
      if (fetcher.data?.success === false && fetcher?.data?.message) {
        toast.error(fetcher.data.message);
      }

      if (fetcher.data?.success === true) {
        toast.success("Orders submitted");
        setOrders(selectedItem, []);
        onClose();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
                                        supplierId: part.supplierId,
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
                          conversionFactor: 1,
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
                                        suppliers: data as SupplierPart[],
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
                                        supplierId: data[0].supplierId,
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
                            <LuHardHat />
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
                                      quantity: value,
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
                onClick={() => onSubmit(selectedItem.id, orders)}
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

    console.log(suppliersMap);
    const isDisabled =
      !permissions.can("create", "production") ||
      bulkUpdateFetcher.state !== "idle" ||
      mrpFetcher.state !== "idle";

    const [items] = useItems();

    const getOrders = useCallback(() => {
      const initialMap: Record<string, PlannedOrder[]> = {};
      data.forEach((item) => {
        if (item.id) {
          initialMap[item.id] = getPurchaseOrdersFromPlanning(
            item,
            periods,
            items,
            suppliersMap[item.id]
          );
        }
      });
      return initialMap;
    }, [data, periods, suppliersMap, items]);

    const [ordersMap, setOrdersMap] =
      useState<Record<string, PlannedOrder[]>>(getOrders);

    useEffect(() => {
      setOrdersMap(getOrders());
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const onBulkUpdate = useCallback(
      (selectedRows: typeof data, action: "order") => {
        const payload = {
          locationId,
          items: selectedRows
            .filter((row) => row.id)
            .map((row) => {
              const ordersWithPeriods = (ordersMap[row.id!] || []).map(
                (order) => {
                  if (
                    !order.dueDate ||
                    parseDate(order.dueDate) < parseDate(periods[0].startDate)
                  ) {
                    return {
                      ...order,
                      periodId: periods[0].id,
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
                    supplierId: suppliersMap[row.id!],
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
      [bulkUpdateFetcher, locationId, ordersMap, periods, suppliersMap]
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
                value: supplier.id,
              })),
            },
            icon: <LuContainer />,
          },
        },
        {
          accessorKey: "leadTime",
          header: "Lead Time",
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
            icon: <LuClock />,
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
            selectedItem={selectedItem}
            setSelectedItem={setSelectedItem}
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
  return `${path.to.purchasingPlanning}?location=${locationId}`;
}
