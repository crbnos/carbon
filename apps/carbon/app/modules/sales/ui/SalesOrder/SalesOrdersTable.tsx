import {
  Checkbox,
  HStack,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useFetcher, useFetchers, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCreditCard,
  LuPencil,
  LuPin,
  LuQrCode,
  LuStar,
  LuTrash,
  LuTruck,
  LuUser,
  LuUserSquare,
} from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  New,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { SalesOrder } from "~/modules/sales";
import { SalesStatus, salesOrderStatusType } from "~/modules/sales";
import { useCustomers, usePeople } from "~/stores";
import { favoriteSchema } from "~/types/validators";
import { path } from "~/utils/path";

type SalesOrdersTableProps = {
  data: SalesOrder[];
  count: number;
};

const SalesOrdersTable = memo(({ data, count }: SalesOrdersTableProps) => {
  const permissions = usePermissions();

  const [selectedSalesOrder, setSelectedSalesOrder] =
    useState<SalesOrder | null>(null);

  const deleteSalesOrderModal = useDisclosure();

  const [people] = usePeople();
  const [customers] = useCustomers();

  const fetcher = useFetcher<{}>();
  const optimisticFavorite = useOptimisticFavorite();

  const rows = useMemo<SalesOrder[]>(
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

  const { edit } = useSalesOrder();

  const customColumns = useCustomColumns<SalesOrder>("salesOrder");

  const columns = useMemo<ColumnDef<SalesOrder>[]>(() => {
    const defaultColumns: ColumnDef<SalesOrder>[] = [
      {
        accessorKey: "salesOrderId",
        header: "Sales Order Number",
        cell: ({ row }) => (
          <HStack>
            {row.original.favorite ? (
              <fetcher.Form
                method="post"
                action={path.to.salesOrderFavorite}
                className="flex items-center"
              >
                <input type="hidden" name="id" value={row.original.id!} />
                <input type="hidden" name="favorite" value="unfavorite" />
                <button type="submit">
                  <LuPin
                    className="cursor-pointer w-4 h-4 outline-foreground fill-foreground flex-shrink-0"
                    type="submit"
                  />
                </button>
              </fetcher.Form>
            ) : (
              <fetcher.Form
                method="post"
                action={path.to.salesOrderFavorite}
                className="flex items-center"
              >
                <input type="hidden" name="id" value={row.original.id!} />
                <input type="hidden" name="favorite" value="favorite" />
                <button type="submit">
                  <LuPin
                    className="cursor-pointer w-4 h-4 text-muted-foreground flex-shrink-0"
                    type="submit"
                  />
                </button>
              </fetcher.Form>
            )}

            <ItemThumbnail
              size="sm"
              thumbnailPath={row.original.thumbnailPath}
              // @ts-ignore
              type={row.original.itemType}
            />
            <Hyperlink to={path.to.salesOrderDetails(row.original.id!)}>
              {row.original.salesOrderId}
            </Hyperlink>
          </HStack>
        ),
        meta: {
          icon: <LuBookMarked />,
        },
      },
      {
        id: "customerId",
        header: "Customer",
        cell: ({ row }) => {
          return <CustomerAvatar customerId={row.original.customerId} />;
        },
        meta: {
          filter: {
            type: "static",
            options: customers?.map((customer) => ({
              value: customer.id,
              label: customer.name,
            })),
          },
          icon: <LuUserSquare />,
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: (item) => {
          const status = item.getValue<(typeof salesOrderStatusType)[number]>();
          return <SalesStatus status={status} />;
        },
        meta: {
          filter: {
            type: "static",
            options: salesOrderStatusType.map((status) => ({
              value: status,
              label: <SalesStatus status={status} />,
            })),
          },
          pluralHeader: "Statuses",
          icon: <LuStar />,
        },
      },
      {
        accessorKey: "customerReference",
        header: "Customer Ref.",
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
        accessorKey: "receiptPromisedDate",
        header: "Promised Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
      {
        accessorKey: "shippingMethodName",
        header: "Shipping Method",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuTruck />,
        },
      },
      // {
      //   accessorKey: "shippingTermName",
      //   header: "Shipping Term",
      //   cell: (item) => <Enumerable value={item.getValue<string>()} />,
      // },
      {
        accessorKey: "paymentTermName",
        header: "Payment Method",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
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
  }, [customers, people, customColumns, fetcher]);

  const renderContextMenu = useMemo(() => {
    // eslint-disable-next-line react/display-name
    return (row: SalesOrder) => (
      <>
        <MenuItem
          disabled={!permissions.can("view", "sales")}
          onClick={() => edit(row)}
        >
          <MenuIcon icon={<LuPencil />} />
          Edit
        </MenuItem>

        {/*<MenuItem
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
          </MenuItem>*/}
        <MenuItem
          disabled={!permissions.can("delete", "sales")}
          onClick={() => {
            setSelectedSalesOrder(row);
            deleteSalesOrderModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          Delete
        </MenuItem>
      </>
    );
  }, [deleteSalesOrderModal, edit, permissions /*receive*/]);

  return (
    <>
      <Table<SalesOrder>
        count={count}
        columns={columns}
        data={rows}
        defaultColumnPinning={{
          left: ["salesOrderId"],
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
          permissions.can("create", "sales") && (
            <New label="Sales Order" to={path.to.newSalesOrder} />
          )
        }
        renderContextMenu={renderContextMenu}
      />

      {selectedSalesOrder && selectedSalesOrder.id && (
        <ConfirmDelete
          action={path.to.deleteSalesOrder(selectedSalesOrder.id)}
          isOpen={deleteSalesOrderModal.isOpen}
          name={selectedSalesOrder.salesOrderId!}
          text={`Are you sure you want to delete ${selectedSalesOrder.salesOrderId!}? This cannot be undone.`}
          onCancel={() => {
            deleteSalesOrderModal.onClose();
            setSelectedSalesOrder(null);
          }}
          onSubmit={() => {
            deleteSalesOrderModal.onClose();
            setSelectedSalesOrder(null);
          }}
        />
      )}
    </>
  );
});
SalesOrdersTable.displayName = "SalesOrdersTable";

export default SalesOrdersTable;

function useOptimisticFavorite() {
  const fetchers = useFetchers();
  const favoriteFetcher = fetchers.find(
    (f) => f.formAction === path.to.salesOrderFavorite
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

export const useSalesOrder = () => {
  const navigate = useNavigate();

  const edit = useCallback(
    (salesOrder: SalesOrder) => navigate(path.to.salesOrder(salesOrder.id!)),
    [navigate]
  );

  /*const invoice = useCallback(
    (salesOrder: SalesOrder) =>
      navigate(
        `${path.to.newPurchaseInvoice}?sourceDocument=Purchase Order&sourceDocumentId=${purchaseOrder.id}`
      ),
    [navigate]
  );

  const receive = useCallback(
    (salesOrder: SalesOrder) =>
      navigate(
        `${path.to.newReceipt}?sourceDocument=Purchase Order&sourceDocumentId=${salesOrder.id}`
      ),
    [navigate]
  );*/

  return {
    edit,
    //invoice,
    //receive,
  };
};
