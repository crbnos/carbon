import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCreditCard,
  LuPackageCheck,
  LuPencil,
  LuQrCode,
  LuSquareUser,
  LuStar,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  New,
  Table
} from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useCustomers, usePeople } from "~/stores";
import { path } from "~/utils/path";
import { salesReturnOrderStatusType } from "../../sales.models";
import SalesReturnOrderStatus from "./SalesReturnOrderStatus";
import type { SalesReturnOrderListItem } from "./types";

type SalesReturnOrdersTableProps = {
  data: SalesReturnOrderListItem[];
  count: number;
};

const SalesReturnOrdersTable = memo(
  ({ data, count }: SalesReturnOrdersTableProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const navigate = useNavigate();
    const { formatDate } = useDateFormatter();

    const [selectedSalesReturnOrder, setSelectedSalesReturnOrder] =
      useState<SalesReturnOrderListItem | null>(null);

    const deleteSalesReturnOrderModal = useDisclosure();

    const [people] = usePeople();
    const [customers] = useCustomers();

    const customColumns =
      useCustomColumns<SalesReturnOrderListItem>("salesReturnOrder");

    const columns = useMemo<ColumnDef<SalesReturnOrderListItem>[]>(() => {
      const defaultColumns: ColumnDef<SalesReturnOrderListItem>[] = [
        {
          accessorKey: "salesReturnOrderId",
          header: t`RMA Number`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.salesReturnOrderDetails(row.original.id!)}>
              {row.original.salesReturnOrderId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "customerId",
          header: t`Customer`,
          cell: ({ row }) => (
            <CustomerAvatar customerId={row.original.customerId} />
          ),
          meta: {
            filter: {
              type: "static",
              options: customers?.map((customer) => ({
                value: customer.id,
                label: customer.name
              }))
            },
            icon: <LuSquareUser />,
            exportValue: (row: SalesReturnOrderListItem) =>
              customers?.find((customer) => customer.id === row.customerId)
                ?.name ?? row.customerId
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <SalesReturnOrderStatus status={row.original.status} />
          ),
          meta: {
            filter: {
              type: "static",
              options: salesReturnOrderStatusType.map((status) => ({
                value: status,
                label: <SalesReturnOrderStatus status={status} />
              }))
            },
            pluralHeader: t`Statuses`,
            icon: <LuStar />
          }
        },
        {
          accessorKey: "customerReference",
          header: t`Customer Reference`,
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
          accessorKey: "quantityReceived",
          header: t`Received`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {row.original.quantityReceived ?? 0} /{" "}
              {row.original.quantityAuthorized ?? 0}
            </span>
          ),
          meta: {
            icon: <LuPackageCheck />,
            exportValue: (row: SalesReturnOrderListItem) =>
              `${row.quantityReceived ?? 0} / ${row.quantityAuthorized ?? 0}`
          }
        },
        {
          accessorKey: "quantityCredited",
          header: t`Credited`,
          cell: (item) => (
            <span className="tabular-nums">{item.getValue<number>() ?? 0}</span>
          ),
          meta: {
            icon: <LuCreditCard />
          }
        },
        {
          accessorKey: "assignee",
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
            icon: <LuUser />,
            exportValue: (row: SalesReturnOrderListItem) =>
              people.find((employee) => employee.id === row.assignee)?.name ??
              row.assignee
          }
        },
        {
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];

      return [...defaultColumns, ...customColumns];
    }, [customers, people, customColumns, formatDate, t]);

    const renderContextMenu = useMemo(() => {
      return (row: SalesReturnOrderListItem) => (
        <>
          <MenuItem
            disabled={!permissions.can("view", "sales")}
            onClick={() => {
              navigate(path.to.salesReturnOrderDetails(row.id!));
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit</Trans>
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "sales")}
            destructive
            onClick={() => {
              setSelectedSalesReturnOrder(row);
              deleteSalesReturnOrderModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete</Trans>
          </MenuItem>
        </>
      );
    }, [deleteSalesReturnOrderModal, navigate, permissions]);

    return (
      <>
        <Table<SalesReturnOrderListItem>
          count={count}
          columns={columns}
          data={data}
          defaultColumnPinning={{
            left: ["salesReturnOrderId"]
          }}
          primaryAction={
            permissions.can("create", "sales") && (
              <New label={t`RMA`} to={path.to.newSalesReturnOrder} />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`RMAs`}
          table="salesReturnOrder"
          withSavedView
        />

        {selectedSalesReturnOrder && selectedSalesReturnOrder.id && (
          <ConfirmDelete
            action={path.to.deleteSalesReturnOrder(selectedSalesReturnOrder.id)}
            isOpen={deleteSalesReturnOrderModal.isOpen}
            name={selectedSalesReturnOrder.salesReturnOrderId!}
            text={t`Are you sure you want to delete ${selectedSalesReturnOrder.salesReturnOrderId!}? This cannot be undone.`}
            onCancel={() => {
              deleteSalesReturnOrderModal.onClose();
              setSelectedSalesReturnOrder(null);
            }}
            onSubmit={() => {
              deleteSalesReturnOrderModal.onClose();
              setSelectedSalesReturnOrder(null);
            }}
          />
        )}
      </>
    );
  }
);
SalesReturnOrdersTable.displayName = "SalesReturnOrdersTable";

export default SalesReturnOrdersTable;
