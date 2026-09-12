import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuContainer,
  LuCreditCard,
  LuPencil,
  LuQrCode,
  LuStar,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  EmployeeAvatar,
  Hyperlink,
  New,
  SupplierAvatar,
  Table
} from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { usePeople, useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { purchaseReturnOrderStatusType } from "../../purchasing.models";
import PurchaseReturnOrderStatus from "./PurchaseReturnOrderStatus";
import type { PurchaseReturnOrderListItem } from "./types";

type PurchaseReturnOrdersTableProps = {
  data: PurchaseReturnOrderListItem[];
  count: number;
};

const PurchaseReturnOrdersTable = memo(
  ({ data, count }: PurchaseReturnOrdersTableProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const navigate = useNavigate();
    const { formatDate } = useDateFormatter();

    const [selectedPurchaseReturnOrder, setSelectedPurchaseReturnOrder] =
      useState<PurchaseReturnOrderListItem | null>(null);

    const deletePurchaseReturnOrderModal = useDisclosure();

    const [people] = usePeople();
    const [suppliers] = useSuppliers();

    const customColumns = useCustomColumns<PurchaseReturnOrderListItem>(
      "purchaseReturnOrder"
    );

    const columns = useMemo<ColumnDef<PurchaseReturnOrderListItem>[]>(() => {
      const defaultColumns: ColumnDef<PurchaseReturnOrderListItem>[] = [
        {
          accessorKey: "purchaseReturnOrderId",
          header: t`Return Number`,
          cell: ({ row }) => (
            <Hyperlink
              to={path.to.purchaseReturnOrderDetails(row.original.id!)}
            >
              {row.original.purchaseReturnOrderId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "supplierId",
          header: t`Supplier`,
          cell: ({ row }) => (
            <SupplierAvatar supplierId={row.original.supplierId} />
          ),
          meta: {
            filter: {
              type: "static",
              options: suppliers?.map((supplier) => ({
                value: supplier.id,
                label: supplier.name
              }))
            },
            icon: <LuContainer />,
            exportValue: (row: PurchaseReturnOrderListItem) =>
              suppliers?.find((supplier) => supplier.id === row.supplierId)
                ?.name ?? row.supplierId
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <PurchaseReturnOrderStatus status={row.original.status} />
          ),
          meta: {
            filter: {
              type: "static",
              options: purchaseReturnOrderStatusType.map((status) => ({
                value: status,
                label: <PurchaseReturnOrderStatus status={status} />
              }))
            },
            pluralHeader: t`Statuses`,
            icon: <LuStar />
          }
        },
        {
          accessorKey: "supplierReference",
          header: t`Supplier RMA #`,
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
          accessorKey: "quantityShipped",
          header: t`Shipped`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {row.original.quantityShipped ?? 0} /{" "}
              {row.original.quantityAuthorized ?? 0}
            </span>
          ),
          meta: {
            icon: <LuContainer />,
            exportValue: (row: PurchaseReturnOrderListItem) =>
              `${row.quantityShipped ?? 0} / ${row.quantityAuthorized ?? 0}`
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
            exportValue: (row: PurchaseReturnOrderListItem) =>
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
    }, [suppliers, people, customColumns, formatDate, t]);

    const renderContextMenu = useMemo(() => {
      return (row: PurchaseReturnOrderListItem) => (
        <>
          <MenuItem
            disabled={!permissions.can("view", "purchasing")}
            onClick={() => {
              navigate(path.to.purchaseReturnOrderDetails(row.id!));
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit</Trans>
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "purchasing")}
            destructive
            onClick={() => {
              setSelectedPurchaseReturnOrder(row);
              deletePurchaseReturnOrderModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete</Trans>
          </MenuItem>
        </>
      );
    }, [deletePurchaseReturnOrderModal, navigate, permissions]);

    return (
      <>
        <Table<PurchaseReturnOrderListItem>
          count={count}
          columns={columns}
          data={data}
          defaultColumnPinning={{
            left: ["purchaseReturnOrderId"]
          }}
          primaryAction={
            permissions.can("create", "purchasing") && (
              <New
                label={t`Supplier Return`}
                to={path.to.newPurchaseReturnOrder}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Supplier Returns`}
          table="purchaseReturnOrder"
          withSavedView
        />

        {selectedPurchaseReturnOrder && selectedPurchaseReturnOrder.id && (
          <ConfirmDelete
            action={path.to.deletePurchaseReturnOrder(
              selectedPurchaseReturnOrder.id
            )}
            isOpen={deletePurchaseReturnOrderModal.isOpen}
            name={selectedPurchaseReturnOrder.purchaseReturnOrderId!}
            text={t`Are you sure you want to delete ${selectedPurchaseReturnOrder.purchaseReturnOrderId!}? This cannot be undone.`}
            onCancel={() => {
              deletePurchaseReturnOrderModal.onClose();
              setSelectedPurchaseReturnOrder(null);
            }}
            onSubmit={() => {
              deletePurchaseReturnOrderModal.onClose();
              setSelectedPurchaseReturnOrder(null);
            }}
          />
        )}
      </>
    );
  }
);
PurchaseReturnOrdersTable.displayName = "PurchaseReturnOrdersTable";

export default PurchaseReturnOrdersTable;
