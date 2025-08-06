import { Checkbox, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCheck,
  LuClock,
  LuFileText,
  LuHash,
  LuPencil,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  New,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRealtime, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useCustomers, usePeople } from "~/stores";
import { path } from "~/utils/path";
import {
  shipmentSourceDocumentType,
  shipmentStatusType,
} from "../../inventory.models";
import type { Shipment } from "../../types";
import ShipmentStatus from "./ShipmentStatus";

type ShipmentsTableProps = {
  data: Shipment[];
  count: number;
};

const ShipmentsTable = memo(({ data, count }: ShipmentsTableProps) => {
  useRealtime("shipment", `id=in.(${data.map((d) => d.id).join(",")})`);

  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const rows = useMemo(() => data, [data]);
  const [people] = usePeople();
  const [customers] = useCustomers();
  const customColumns = useCustomColumns<Shipment>("shipment");

  const columns = useMemo<ColumnDef<Shipment>[]>(() => {
    const result: ColumnDef<(typeof rows)[number]>[] = [
      {
        accessorKey: "shipmentId",
        header: "Shipment ID",
        cell: ({ row }) => (
          <Hyperlink to={path.to.shipmentDetails(row.original.id!)}>
            {row.original.shipmentId}
          </Hyperlink>
        ),
        meta: {
          icon: <LuBookMarked />,
        },
      },
      {
        accessorKey: "sourceDocument",
        header: "Source Document",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "static",
            options: shipmentSourceDocumentType.map((type) => ({
              value: type,
              label: <Enumerable value={type} />,
            })),
          },
          icon: <LuFileText />,
        },
      },
      {
        accessorKey: "sourceDocumentReadableId",
        header: "Source Document ID",
        cell: ({ row }) => {
          if (!row.original.sourceDocumentId) return null;
          switch (row.original.sourceDocument) {
            case "Sales Invoice":
              return (
                <Hyperlink
                  to={path.to.salesInvoiceDetails(
                    row.original.sourceDocumentId!
                  )}
                >
                  {row.original.sourceDocumentReadableId}
                </Hyperlink>
              );
            case "Sales Order":
              return (
                <Hyperlink
                  to={path.to.salesOrderDetails(row.original.sourceDocumentId!)}
                >
                  {row.original.sourceDocumentReadableId}
                </Hyperlink>
              );
            case "Purchase Order":
              return (
                <Hyperlink
                  to={path.to.purchaseOrderDetails(
                    row.original.sourceDocumentId!
                  )}
                >
                  {row.original.sourceDocumentReadableId}
                </Hyperlink>
              );
            case "Outbound Transfer":
              return (
                <Hyperlink
                  to={path.to.warehouseTransferDetails(
                    row.original.sourceDocumentId!
                  )}
                >
                  {row.original.sourceDocumentReadableId}
                </Hyperlink>
              );
            default:
              return null;
          }
        },
        meta: {
          icon: <LuHash />,
        },
      },

      {
        accessorKey: "status",
        header: "Status",
        cell: (item) => {
          const status = item.getValue<(typeof shipmentStatusType)[number]>();
          return <ShipmentStatus status={status} />;
        },
        meta: {
          filter: {
            type: "static",
            options: shipmentStatusType.map((type) => ({
              value: type,
              label: <ShipmentStatus status={type} />,
            })),
          },
          pluralHeader: "Statuses",
          icon: <LuClock />,
        },
      },
      {
        accessorKey: "invoiced",
        header: "Invoiced",
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          filter: {
            type: "static",
            options: [
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ],
          },
          icon: <LuCheck />,
        },
      },
      {
        id: "postedBy",
        header: "Posted By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.postedBy} />
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
        accessorKey: "postingDate",
        header: "Posting Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
      {
        accessorKey: "assignee",
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
          icon: <LuUser />,
        },
      },
      {
        accessorKey: "externalDocumentId",
        header: "External Ref.",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuHash />,
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
  }, [people, customers, customColumns]);

  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(
    null
  );
  const deleteShipmentModal = useDisclosure();

  const renderContextMenu = useCallback(
    (row: Shipment) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "inventory")}
            onClick={() => {
              navigate(
                `${path.to.shipmentDetails(row.id!)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            {row.postingDate ? "View Shipment" : "Edit Shipment"}
          </MenuItem>
          <MenuItem
            disabled={
              !permissions.can("delete", "inventory") ||
              !!row.postingDate ||
              row.status === "Pending"
            }
            destructive
            onClick={() => {
              setSelectedShipment(row);
              deleteShipmentModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Shipment
          </MenuItem>
        </>
      );
    },
    [deleteShipmentModal, navigate, params, permissions]
  );

  return (
    <>
      <Table<(typeof data)[number]>
        data={data}
        columns={columns}
        count={count}
        defaultColumnPinning={{
          left: ["shipmentId"],
        }}
        defaultColumnVisibility={{
          createdAt: false,
          createdBy: false,
          updatedAt: false,
          updatedBy: false,
        }}
        primaryAction={
          permissions.can("create", "inventory") && (
            <New label="Shipment" to={path.to.newShipment} />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Shipments"
        table="shipment"
        withSavedView
      />
      {selectedShipment && selectedShipment.id && (
        <ConfirmDelete
          action={path.to.deleteShipment(selectedShipment.id)}
          isOpen={deleteShipmentModal.isOpen}
          name={selectedShipment.shipmentId!}
          text={`Are you sure you want to delete ${selectedShipment.shipmentId!}? This cannot be undone.`}
          onCancel={() => {
            deleteShipmentModal.onClose();
            setSelectedShipment(null);
          }}
          onSubmit={() => {
            deleteShipmentModal.onClose();
            setSelectedShipment(null);
          }}
        />
      )}
    </>
  );
});

ShipmentsTable.displayName = "ShipmentsTable";
export default ShipmentsTable;
