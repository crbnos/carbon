import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuClock,
  LuHash,
  LuMapPin,
  LuPencil,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRealtime, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import { warehouseTransferStatusType } from "../../inventory.models";
import type { WarehouseTransfer } from "../../types";
import WarehouseTransferStatus from "./WarehouseTransferStatus";

type WarehouseTransfersTableProps = {
  data: WarehouseTransfer[];
  count: number;
};

const WarehouseTransfersTable = memo(
  ({ data, count }: WarehouseTransfersTableProps) => {
    useRealtime(
      "warehouseTransfer",
      `id=in.(${data.map((d) => d.id).join(",")})`
    );

    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const rows = useMemo(() => data, [data]);
    const [people] = usePeople();
    const customColumns =
      useCustomColumns<WarehouseTransfer>("warehouseTransfer");

    const columns = useMemo<ColumnDef<WarehouseTransfer>[]>(() => {
      const result: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "transferId",
          header: "Transfer ID",
          cell: ({ row }) => (
            <Hyperlink to={path.to.warehouseTransferDetails(row.original.id!)}>
              {row.original.transferId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: (item) => {
            const status =
              item.getValue<(typeof warehouseTransferStatusType)[number]>();
            return <WarehouseTransferStatus status={status} />;
          },
          meta: {
            filter: {
              type: "static",
              options: warehouseTransferStatusType.map((type) => ({
                value: type,
                label: <WarehouseTransferStatus status={type} />,
              })),
            },
            pluralHeader: "Statuses",
            icon: <LuClock />,
          },
        },
        {
          id: "fromLocation",
          header: "From Location",
          cell: ({ row }) => row.original.fromLocation?.name || "N/A",
          meta: {
            icon: <LuMapPin />,
          },
        },
        {
          id: "toLocation",
          header: "To Location",
          cell: ({ row }) => row.original.toLocation?.name || "N/A",
          meta: {
            icon: <LuMapPin />,
          },
        },
        {
          accessorKey: "reference",
          header: "Reference",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuHash />,
          },
        },
        {
          accessorKey: "transferDate",
          header: "Transfer Date",
          cell: (item) => {
            const date = item.getValue<string>();
            return date ? formatDate(date) : "N/A";
          },
          meta: {
            icon: <LuCalendar />,
          },
        },
        {
          accessorKey: "expectedReceiptDate",
          header: "Expected Receipt",
          cell: (item) => {
            const date = item.getValue<string>();
            return date ? formatDate(date) : "N/A";
          },
          meta: {
            icon: <LuCalendar />,
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
          header: "Updated At",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />,
          },
        },
      ];

      return [...result, ...customColumns];
    }, [people, customColumns]);

    const [selectedTransfer, setSelectedTransfer] =
      useState<WarehouseTransfer | null>(null);
    const deleteTransferModal = useDisclosure();

    const renderContextMenu = useCallback(
      (row: WarehouseTransfer) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "inventory")}
              onClick={() => {
                navigate(
                  `${path.to.warehouseTransferDetails(
                    row.id!
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {row.status === "Received" ? "View Transfer" : "Edit Transfer"}
            </MenuItem>
            <MenuItem
              disabled={
                !permissions.can("delete", "inventory") ||
                row.status === "In Transit" ||
                row.status === "Received"
              }
              destructive
              onClick={() => {
                setSelectedTransfer(row);
                deleteTransferModal.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Transfer
            </MenuItem>
          </>
        );
      },
      [deleteTransferModal, navigate, params, permissions]
    );

    return (
      <>
        <Table<(typeof data)[number]>
          data={data}
          columns={columns}
          count={count}
          defaultColumnPinning={{
            left: ["transferId"],
          }}
          defaultColumnVisibility={{
            createdAt: false,
            createdBy: false,
            updatedAt: false,
            updatedBy: false,
          }}
          primaryAction={
            permissions.can("create", "inventory") && (
              <New
                label="Warehouse Transfer"
                to={path.to.newWarehouseTransfer}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Warehouse Transfers"
          table="warehouseTransfer"
          withSavedView
        />
        {selectedTransfer && selectedTransfer.id && (
          <ConfirmDelete
            action={path.to.deleteWarehouseTransfer(selectedTransfer.id)}
            isOpen={deleteTransferModal.isOpen}
            name={selectedTransfer.transferId!}
            text={`Are you sure you want to delete ${selectedTransfer.transferId!}? This cannot be undone.`}
            onCancel={() => {
              deleteTransferModal.onClose();
              setSelectedTransfer(null);
            }}
            onSubmit={() => {
              deleteTransferModal.onClose();
              setSelectedTransfer(null);
            }}
          />
        )}
      </>
    );
  }
);

WarehouseTransfersTable.displayName = "WarehouseTransfersTable";
export default WarehouseTransfersTable;
