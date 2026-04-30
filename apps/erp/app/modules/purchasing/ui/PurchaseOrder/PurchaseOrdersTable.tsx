import {
  Checkbox,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  HStack,
  MenuIcon,
  MenuItem,
  toast,
  useDisclosure
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
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
  LuUser
} from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  New,
  SupplierAvatar,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePaymentTerm } from "~/components/Form/PaymentTerm";
import { useShippingMethod } from "~/components/Form/ShippingMethod";
import { ConfirmDelete } from "~/components/Modals";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useRealtime
} from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { PurchaseOrder } from "~/modules/purchasing";
import { purchaseOrderStatusType } from "~/modules/purchasing";
import type { action } from "~/routes/x+/purchase-order+/update";
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
    useRealtime("purchaseOrder");

    const { t } = useLingui();
    const permissions = usePermissions();
    const currencyFormatter = useCurrencyFormatter();
    const { formatDate } = useDateFormatter();

    const [selectedPurchaseOrder, setSelectedPurchaseOrder] =
      useState<PurchaseOrder | null>(null);

    const deletePurchaseOrderModal = useDisclosure();

    const [people] = usePeople();
    const [suppliers] = useSuppliers();
    const shippingMethods = useShippingMethod();
    const paymentTerms = usePaymentTerm();

    const { edit, receive } = usePurchaseOrder();

    const customColumns = useCustomColumns<PurchaseOrder>("purchaseOrder");

    const columns = useMemo<ColumnDef<PurchaseOrder>[]>(() => {
      const defaultColumns: ColumnDef<PurchaseOrder>[] = [
        {
          accessorKey: "purchaseOrderId",
          header: t`PO Number`,
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
            icon: <LuBookMarked />
          }
        },
        {
          id: "supplierId",
          header: t`Supplier`,
          cell: ({ row }) => {
            return <SupplierAvatar supplierId={row.original.supplierId} />;
          },
          meta: {
            filter: {
              type: "static",
              options: suppliers?.map((supplier) => ({
                value: supplier.id,
                label: supplier.name
              }))
            },
            icon: <LuContainer />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
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
                label: <PurchasingStatus status={status} />
              }))
            },
            pluralHeader: t`Statuses`,
            icon: <LuStar />
          }
        },
        {
          accessorKey: "supplierReference",
          header: t`Supplier Ref.`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuQrCode />
          }
        },
        {
          accessorKey: "orderDate",
          header: t`Order Date`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "receiptRequestedDate",
          header: t`Requested Date`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "receiptPromisedDate",
          header: t`Promised Date`,
          cell: ({ row }) => {
            const isReceivedOnTime =
              row.original.deliveryDate &&
              row.original.receiptPromisedDate &&
              row.original.deliveryDate <= row.original.receiptPromisedDate;

            const isOverdue =
              ["Cancelled", "Draft"].includes(row.original.status ?? "") &&
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
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "orderTotal",
          header: t`Order Total`,
          cell: (item) => currencyFormatter.format(item.getValue<number>()),
          meta: {
            icon: <LuDollarSign />,
            formatter: currencyFormatter.format,
            renderTotal: true
          }
        },
        {
          id: "assignee",
          header: t`Assignee`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.assignee} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name
              }))
            },
            icon: <LuUser />
          }
        },

        {
          accessorKey: "shippingMethodId",
          header: t`Shipping Method`,
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
            icon: <LuTruck />
          }
        },
        {
          accessorKey: "paymentTermId",
          header: t`Payment Method`,
          cell: (item) => (
            <Enumerable
              value={
                paymentTerms.find((pt) => pt.value === item.getValue<string>())
                  ?.label ?? null
              }
            />
          ),
          meta: {
            icon: <LuCreditCard />
          }
        },
        {
          accessorKey: "dropShipment",
          header: t`Drop Shipment`,
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: t`Yes` },
                { value: "false", label: t`No` }
              ]
            },
            pluralHeader: t`Drop Shipment Statuses`,
            icon: <LuTruck />
          }
        },
        {
          id: "createdBy",
          header: t`Created By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name
              }))
            },
            icon: <LuUser />
          }
        },
        {
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          id: "updatedBy",
          header: t`Updated By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name
              }))
            },
            icon: <LuUser />
          }
        },
        {
          accessorKey: "updatedAt",
          header: t`Updated At`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];

      return [...defaultColumns, ...customColumns];
    }, [
      suppliers,
      people,
      customColumns,
      currencyFormatter,
      shippingMethods,
      paymentTerms,
      t
    ]);

    const fetcher = useFetcher<typeof action>();
    useEffect(() => {
      if (fetcher.data?.error) {
        toast.error(fetcher.data.error.message);
      }
    }, [fetcher.data]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    const onBulkUpdate = useCallback(
      (selectedRows: typeof data, field: "delete", value?: string) => {
        const formData = new FormData();
        selectedRows.forEach((row) => {
          if (row.id) formData.append("ids", row.id);
        });
        formData.append("field", field);
        if (value) formData.append("value", value);
        fetcher.submit(formData, {
          method: "post",
          action: path.to.bulkUpdatePurchaseOrder
        });
      },

      []
    );

    const renderActions = useCallback(
      (selectedRows: typeof data) => {
        return (
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuLabel>Update</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={
                  !permissions.can("delete", "purchasing") ||
                  selectedRows.some(
                    (row) => !["Draft", "Planned"].includes(row.status ?? "")
                  )
                }
                destructive
                onClick={() => onBulkUpdate(selectedRows, "delete")}
              >
                <MenuIcon icon={<LuTrash />} />
                <Trans>Delete Purchase Orders</Trans>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        );
      },
      [onBulkUpdate, permissions]
    );

    const renderContextMenu = useCallback(
      (row: PurchaseOrder) => (
        <>
          <MenuItem
            disabled={!permissions.can("view", "purchasing")}
            onClick={() => edit(row)}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit</Trans>
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
            <Trans>Receive</Trans>
          </MenuItem>
          <MenuItem
            disabled={
              !permissions.can("delete", "purchasing") ||
              !["Draft", "Planned"].includes(row.status ?? "")
            }
            destructive
            onClick={() => {
              setSelectedPurchaseOrder(row);
              deletePurchaseOrderModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete</Trans>
          </MenuItem>
        </>
      ),
      [deletePurchaseOrderModal, edit, permissions, receive]
    );

    return (
      <>
        <Table<PurchaseOrder>
          count={count}
          columns={columns}
          data={data}
          defaultColumnPinning={{
            left: ["purchaseOrderId"]
          }}
          defaultColumnVisibility={{
            shippingMethodName: false,
            paymentTermName: false,
            dropShipment: false,
            createdBy: false,
            createdAt: false,
            updatedBy: false,
            updatedAt: false
          }}
          primaryAction={
            permissions.can("create", "purchasing") && (
              <New label={t`Purchase Order`} to={path.to.newPurchaseOrder} />
            )
          }
          renderContextMenu={renderContextMenu}
          renderActions={renderActions}
          title={t`Purchase Orders`}
          table="purchaseOrder"
          withSavedView
          withSelectableRows
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
