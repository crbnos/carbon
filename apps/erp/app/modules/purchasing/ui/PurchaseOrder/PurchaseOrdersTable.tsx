import {
  Checkbox,
  HStack,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuContainer,
  LuCreditCard,
  LuDollarSign,
  LuHandCoins,
  LuPencil,
  LuQrCode,
  LuStar,
  LuTrash,
  LuTruck,
  LuUser,
} from "react-icons/lu";
import {
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  New,
  SupplierAvatar,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePaymentTerm } from "~/components/Form/PaymentTerm";
import { useShippingMethod } from "~/components/Form/ShippingMethod";
import { ConfirmDelete } from "~/components/Modals";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { PurchaseOrder } from "~/modules/purchasing";
import { purchaseOrderStatusType } from "~/modules/purchasing";
import { usePeople, useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import PurchasingStatus from "./PurchasingStatus";
import { usePurchaseOrder } from "./usePurchaseOrder";

type PurchaseOrdersTableProps = {
  data: PurchaseOrder[];
  count: number;
};

const PurchaseOrdersTable = memo(
  ({ data, count }: PurchaseOrdersTableProps) => {
    const permissions = usePermissions();
    const currencyFormatter = useCurrencyFormatter();

    const [selectedPurchaseOrder, setSelectedPurchaseOrder] =
      useState<PurchaseOrder | null>(null);

    const deletePurchaseOrderModal = useDisclosure();

    const [people] = usePeople();
    const [suppliers] = useSuppliers();
    const shippingMethods = useShippingMethod();
    const paymentTerms = usePaymentTerm();

    // const optimisticFavorite = useOptimisticFavorite();

    const { edit, receive } = usePurchaseOrder();

    const customColumns = useCustomColumns<PurchaseOrder>("purchaseOrder");

    const columns = useMemo<ColumnDef<PurchaseOrder>[]>(() => {
      const defaultColumns: ColumnDef<PurchaseOrder>[] = [
        {
          accessorKey: "purchaseOrderId",
          header: "PO Number",
          cell: ({ row }) => (
            <HStack>
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
                // @ts-ignore
                type={row.original.itemType}
              />
              <Hyperlink to={path.to.purchaseOrderDetails(row.original.id!)}>
                {row.original.purchaseOrderId}
              </Hyperlink>
            </HStack>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        {
          id: "supplierId",
          header: "Supplier",
          cell: ({ row }) => {
            return <SupplierAvatar supplierId={row.original.supplierId} />;
          },
          meta: {
            filter: {
              type: "static",
              options: suppliers?.map((supplier) => ({
                value: supplier.id,
                label: supplier.name,
              })),
            },
            icon: <LuContainer />,
          },
        },
        {
          accessorKey: "supplierReference",
          header: "Supplier Ref.",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuQrCode />,
          },
        },
        {
          accessorKey: "orderDate",
          header: "Order Date",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />,
          },
        },
        {
          accessorKey: "receiptPromisedDate",
          header: "Promised Date",
          cell: ({ row }) => {
            const isReceivedOnTime =
              row.original.deliveryDate &&
              row.original.receiptPromisedDate &&
              row.original.deliveryDate <= row.original.receiptPromisedDate;

            const isOverdue =
              ["To Receive", "To Receive and Invoice", "Draft"].includes(
                row.original.status ?? ""
              ) &&
              row.original.receiptPromisedDate &&
              row.original.receiptPromisedDate <
                today(getLocalTimeZone()).toString();

            return (
              <span
                className={
                  isReceivedOnTime
                    ? "text-emerald-500"
                    : isOverdue
                    ? "text-red-500"
                    : ""
                }
              >
                {formatDate(row.original.receiptPromisedDate)}
              </span>
            );
          },
          meta: {
            icon: <LuCalendar />,
          },
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: (item) => {
            const status =
              item.getValue<(typeof purchaseOrderStatusType)[number]>();
            return <PurchasingStatus status={status} />;
          },
          meta: {
            filter: {
              type: "static",
              options: purchaseOrderStatusType.map((status) => ({
                value: status,
                label: <PurchasingStatus status={status} />,
              })),
            },
            pluralHeader: "Statuses",
            icon: <LuStar />,
          },
        },
        {
          accessorKey: "orderTotal",
          header: "Order Total",
          cell: (item) => currencyFormatter.format(item.getValue<number>()),
          meta: {
            icon: <LuDollarSign />,
          },
        },
        {
          id: "assignee",
          header: "Assignee",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.assignee} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
            icon: <LuUser />,
          },
        },

        {
          accessorKey: "shippingMethodId",
          header: "Shipping Method",
          cell: (item) => (
            <Enumerable
              value={
                shippingMethods.find(
                  (sm) => sm.value === item.getValue<string>()
                )?.label ?? null
              }
            />
          ),
          meta: {
            icon: <LuTruck />,
          },
        },
        {
          accessorKey: "paymentTermId",
          header: "Payment Method",
          cell: (item) => (
            <Enumerable
              value={
                paymentTerms.find((pt) => pt.value === item.getValue<string>())
                  ?.label ?? null
              }
            />
          ),
          meta: {
            icon: <LuCreditCard />,
          },
        },
        {
          accessorKey: "dropShipment",
          header: "Drop Shipment",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ],
            },
            pluralHeader: "Drop Shipment Statuses",
            icon: <LuTruck />,
          },
        },
        {
          id: "createdBy",
          header: "Created By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
            icon: <LuUser />,
          },
        },
        {
          accessorKey: "createdAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />,
          },
        },
        {
          id: "updatedBy",
          header: "Updated By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
            icon: <LuUser />,
          },
        },
        {
          accessorKey: "updatedAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />,
          },
        },
      ];

      return [...defaultColumns, ...customColumns];
    }, [
      suppliers,
      people,
      customColumns,
      currencyFormatter,
      shippingMethods,
      paymentTerms,
    ]);

    const renderContextMenu = useMemo(() => {
      // eslint-disable-next-line react/display-name
      return (row: PurchaseOrder) => (
        <>
          <MenuItem
            disabled={!permissions.can("view", "purchasing")}
            onClick={() => edit(row)}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit
          </MenuItem>

          <MenuItem
            disabled={
              !["To Receive", "To Receive and Invoice"].includes(
                row.status ?? ""
              ) || !permissions.can("update", "inventory")
            }
            onClick={() => {
              receive(row);
            }}
          >
            <MenuIcon icon={<LuHandCoins />} />
            Receive
          </MenuItem>
          <MenuItem
            disabled={
              !permissions.can("delete", "purchasing") ||
              !["Draft"].includes(row.status ?? "")
            }
            destructive
            onClick={() => {
              setSelectedPurchaseOrder(row);
              deletePurchaseOrderModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete
          </MenuItem>
        </>
      );
    }, [deletePurchaseOrderModal, edit, permissions, receive]);

    return (
      <>
        <Table<PurchaseOrder>
          count={count}
          columns={columns}
          data={data}
          defaultColumnPinning={{
            left: ["purchaseOrderId"],
          }}
          defaultColumnVisibility={{
            shippingMethodName: false,
            // shippingTermName: false,
            paymentTermName: false,
            dropShipment: false,
            createdBy: false,
            createdAt: false,
            updatedBy: false,
            updatedAt: false,
          }}
          primaryAction={
            permissions.can("create", "purchasing") && (
              <New label="Purchase Order" to={path.to.newPurchaseOrder} />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Purchase Orders"
        />

        {selectedPurchaseOrder && selectedPurchaseOrder.id && (
          <ConfirmDelete
            action={path.to.deletePurchaseOrder(selectedPurchaseOrder.id)}
            isOpen={deletePurchaseOrderModal.isOpen}
            name={selectedPurchaseOrder.purchaseOrderId!}
            text={`Are you sure you want to delete ${selectedPurchaseOrder.purchaseOrderId!}? This cannot be undone.`}
            onCancel={() => {
              deletePurchaseOrderModal.onClose();
              setSelectedPurchaseOrder(null);
            }}
            onSubmit={() => {
              deletePurchaseOrderModal.onClose();
              setSelectedPurchaseOrder(null);
            }}
          />
        )}
      </>
    );
  }
);
PurchaseOrdersTable.displayName = "PurchaseOrdersTable";

export default PurchaseOrdersTable;
