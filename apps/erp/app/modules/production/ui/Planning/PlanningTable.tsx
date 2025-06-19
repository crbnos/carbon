import {
  Button,
  Combobox,
  DatePicker,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  PulsingDot,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  VStack,
} from "@carbon/react";
import { getLocalTimeZone, parseDate } from "@internationalized/date";
import { useDateFormatter, useNumberFormatter } from "@react-aria/i18n";
import { useFetcher } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuBox,
  LuCalendar,
  LuChevronDown,
  LuChevronUp,
  LuCircleCheck,
  LuCirclePlay,
  LuPackage,
  LuSquareChartGantt,
} from "react-icons/lu";
import {
  Hyperlink,
  ItemThumbnail,
  MethodItemTypeIcon,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions, useUrlParams } from "~/hooks";
import { itemTypes } from "~/modules/inventory/inventory.models";
import { itemReorderingPolicies } from "~/modules/items/items.models";
import type { Order } from "~/modules/items/ui/Item/ItemReorderPolicy";
import {
  getOrdersFromProductionPlanning,
  getReorderPolicyDescription,
  ItemReorderPolicy,
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { path } from "~/utils/path";
import type { ProductionPlanningItem } from "../../types";

type PlanningTableProps = {
  data: ProductionPlanningItem[];
  count: number;
  locationId: string;
  periods: { id: string; startDate: string; endDate: string }[];
};

const OrderModal = memo(
  ({
    row,
    orders,
    setOrders,
    isOpen,
    onClose,
  }: {
    row: ProductionPlanningItem;
    orders: Order[];
    setOrders: (item: ProductionPlanningItem, orders: Order[]) => void;
    isOpen: boolean;
    onClose: () => void;
  }) => {
    return (
      <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{row.readableIdWithRevision}</ModalTitle>
            <ModalDescription>{row.name}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <TableBase full>
              <Thead>
                <Th className="pl-0">
                  <div className="flex items-center gap-2">
                    <LuPackage />
                    <span>Quantity</span>
                  </div>
                </Th>
                <Th className="pr-0">
                  <div className="justify-end flex items-center gap-2">
                    <LuCalendar />
                    <span>Due Date</span>
                  </div>
                </Th>
              </Thead>
              <Tbody>
                {orders.map((order, index) => (
                  <Tr key={index}>
                    <Td className="pl-0 pr-1">
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
                        <NumberInputGroup className="relative">
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
                    <Td className="text-right pr-0 pl-1">
                      <HStack className="justify-end">
                        <DatePicker
                          value={parseDate(order.dueDate)}
                          onChange={(date) => {
                            if (row.id) {
                              const newOrders = [...orders];
                              newOrders[index] = {
                                ...order,
                                dueDate: date ? date.toString() : order.dueDate,
                              };
                              setOrders(row, newOrders);
                            }
                          }}
                        />
                      </HStack>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </TableBase>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => console.log(row.id, orders)}
            >
              Order
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    );
  }
);

OrderModal.displayName = "OrderModal";

const PlanningTable = memo(
  ({ data, count, locationId, periods }: PlanningTableProps) => {
    const permissions = usePermissions();
    const isDisabled = !permissions.can("create", "production");
    const [params] = useUrlParams();
    const dateFormatter = useDateFormatter({
      month: "short",
      day: "numeric",
    });

    const numberFormatter = useNumberFormatter();
    const locations = useLocations();
    const unitOfMeasures = useUnitOfMeasure();

    const bulkUpdateFetcher = useFetcher<typeof bulkUpdateAction>();

    // Store orders in a map keyed by item id
    const [ordersMap, setOrderssMap] = useState<Record<string, Order[]>>(() => {
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
          setOrderssMap((prev) => ({
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
            <HStack className="py-1">
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
                // @ts-ignore
                type={row.original.type}
              />

              <Hyperlink
                to={`${path.to.productionPlanningItem(
                  row.original.id!
                )}?${params.toString()}`}
              >
                <VStack spacing={0}>
                  {row.original.readableIdWithRevision}
                  <div className="w-full truncate text-muted-foreground text-xs">
                    {row.original.name}
                  </div>
                </VStack>
              </Hyperlink>
              <Enumerable
                value={
                  unitOfMeasures.find(
                    (uom) => uom.value === row.original.unitOfMeasureCode
                  )?.label ?? null
                }
              />
            </HStack>
          ),
          meta: {
            icon: <LuBookMarked />,
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
            const hasOrders = orders.length > 0;
            const orderQuantity = orders.reduce(
              (acc, order) => acc + order.quantity,
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
      params,
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
          <OrderModal
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
