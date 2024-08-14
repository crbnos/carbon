import {
  Checkbox,
  Enumerable,
  HStack,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useFetcher, useFetchers } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import { LuPencil, LuPin, LuTrash } from "react-icons/lu";
import { MdCallReceived } from "react-icons/md";
import {
  EmployeeAvatar,
  Hyperlink,
  New,
  SupplierAvatar,
  Table,
} from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { PurchaseOrder } from "~/modules/purchasing";
import {
  PurchasingStatus,
  purchaseOrderStatusType,
} from "~/modules/purchasing";
import { usePeople, useSuppliers } from "~/stores";
import { favoriteSchema } from "~/types/validators";
import { path } from "~/utils/path";
import { usePurchaseOrder } from "./usePurchaseOrder";

type PurchaseOrdersTableProps = {
  data: PurchaseOrder[];
  count: number;
};

const PurchaseOrdersTable = memo(
  ({ data, count }: PurchaseOrdersTableProps) => {
    const permissions = usePermissions();

    const [selectedPurchaseOrder, setSelectedPurchaseOrder] =
      useState<PurchaseOrder | null>(null);

    const deletePurchaseOrderModal = useDisclosure();

    const [people] = usePeople();
    const [suppliers] = useSuppliers();

    const fetcher = useFetcher<{}>();
    const optimisticFavorite = useOptimisticFavorite();

    const rows = useMemo<PurchaseOrder[]>(
      () =>
        data.map((d) =>
          d.id === optimisticFavorite?.id
            ? {
                ...d,
                favorite: optimisticFavorite?.favorite
                  ? optimisticFavorite.favorite === "favorite"
                  : d.favorite,
              }
            : d
        ),
      [data, optimisticFavorite]
    );

    const { edit, receive } = usePurchaseOrder();

    const customColumns = useCustomColumns<PurchaseOrder>("purchaseOrder");

    const columns = useMemo<ColumnDef<PurchaseOrder>[]>(() => {
      const defaultColumns: ColumnDef<PurchaseOrder>[] = [
        {
          accessorKey: "purchaseOrderId",
          header: "PO Number",
          cell: ({ row }) => (
            <HStack>
              {row.original.favorite ? (
                <fetcher.Form
                  method="post"
                  action={path.to.purchaseOrderFavorite}
                  className="flex items-center"
                >
                  <input type="hidden" name="id" value={row.original.id!} />
                  <input type="hidden" name="favorite" value="unfavorite" />
                  <button type="submit">
                    <LuPin
                      className="text-yellow-400 cursor-pointer h-4 w-4 flex-shrink-0"
                      type="submit"
                    />
                  </button>
                </fetcher.Form>
              ) : (
                <fetcher.Form
                  method="post"
                  action={path.to.purchaseOrderFavorite}
                  className="flex items-center"
                >
                  <input type="hidden" name="id" value={row.original.id!} />
                  <input type="hidden" name="favorite" value="favorite" />
                  <button type="submit">
                    <LuPin
                      className="text-yellow-400 cursor-pointer h-4 w-4 flex-shrink-0"
                      type="submit"
                    />
                  </button>
                </fetcher.Form>
              )}

              <Hyperlink to={path.to.purchaseOrderDetails(row.original.id!)}>
                {row.original.purchaseOrderId}
              </Hyperlink>
            </HStack>
          ),
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
          },
        },
        {
          accessorKey: "supplierReference",
          header: "Supplier Ref.",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "orderDate",
          header: "Order Date",
          cell: (item) => item.getValue(),
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
          },
        },
        {
          accessorKey: "receiptPromisedDate",
          header: "Promised Date",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "shippingMethodName",
          header: "Shipping Method",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "shippingTermName",
          header: "Shipping Term",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
        },
        {
          accessorKey: "paymentTermName",
          header: "Payment Method",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
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
          },
        },
        {
          accessorKey: "createdAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
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
          },
        },
        {
          accessorKey: "updatedAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
        },
      ];

      return [...defaultColumns, ...customColumns];
    }, [suppliers, people, customColumns, fetcher]);

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
              !["To Recieve", "To Receive and Invoice"].includes(
                row.status ?? ""
              ) || !permissions.can("update", "inventory")
            }
            onClick={() => {
              receive(row);
            }}
          >
            <MenuIcon icon={<MdCallReceived />} />
            Receive
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "purchasing")}
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
          data={rows}
          defaultColumnPinning={{
            left: ["purchaseOrderId"],
          }}
          defaultColumnVisibility={{
            receiptPromisedDate: false,
            shippingMethodName: false,
            shippingTermName: false,
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

function useOptimisticFavorite() {
  const fetchers = useFetchers();
  const favoriteFetcher = fetchers.find(
    (f) => f.formAction === path.to.purchaseOrderFavorite
  );

  if (favoriteFetcher && favoriteFetcher.formData) {
    const id = favoriteFetcher.formData.get("id");
    const favorite = favoriteFetcher.formData.get("favorite") ?? "off";
    const submission = favoriteSchema.safeParse({ id, favorite });
    if (submission.success) {
      return submission.data;
    }
  }
}
