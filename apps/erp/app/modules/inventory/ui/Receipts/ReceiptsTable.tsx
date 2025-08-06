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
  EmployeeAvatar,
  Hyperlink,
  New,
  SupplierAvatar,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRealtime, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Receipt } from "~/modules/inventory";
import {
  ReceiptStatus,
  receiptSourceDocumentType,
  receiptStatusType,
} from "~/modules/inventory";
import { usePeople, useSuppliers } from "~/stores";
import { path } from "~/utils/path";

type ReceiptsTableProps = {
  data: Receipt[];
  count: number;
};

const ReceiptsTable = memo(({ data, count }: ReceiptsTableProps) => {
  useRealtime("receipt", `id=in.(${data.map((d) => d.id).join(",")})`);

  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const rows = useMemo(() => data, [data]);
  const [people] = usePeople();
  const [suppliers] = useSuppliers();
  const customColumns = useCustomColumns<Receipt>("receipt");

  const columns = useMemo<ColumnDef<Receipt>[]>(() => {
    const result: ColumnDef<(typeof rows)[number]>[] = [
      {
        accessorKey: "receiptId",
        header: "Receipt ID",
        cell: ({ row }) => (
          <Hyperlink to={path.to.receiptDetails(row.original.id!)}>
            {row.original.receiptId}
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
            options: receiptSourceDocumentType.map((type) => ({
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
            case "Purchase Invoice":
              return (
                <Hyperlink
                  to={path.to.purchaseInvoice(row.original.sourceDocumentId!)}
                >
                  {row.original.sourceDocumentReadableId}
                </Hyperlink>
              );
            case "Inbound Transfer":
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
          const status = item.getValue<(typeof receiptStatusType)[number]>();
          return <ReceiptStatus status={status} />;
        },
        meta: {
          filter: {
            type: "static",
            options: receiptStatusType.map((type) => ({
              value: type,
              label: <ReceiptStatus status={type} />,
            })),
          },
          pluralHeader: "Statuses",
          icon: <LuClock />,
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
          icon: <LuUser />,
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
          pluralHeader: "Invoiced Statuses",
          icon: <LuCheck />,
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
  }, [people, suppliers, customColumns]);

  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const deleteReceiptModal = useDisclosure();

  const renderContextMenu = useCallback(
    (row: Receipt) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "inventory")}
            onClick={() => {
              navigate(
                `${path.to.receiptDetails(row.id!)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            {row.postingDate ? "View Receipt" : "Edit Receipt"}
          </MenuItem>
          <MenuItem
            disabled={
              !permissions.can("delete", "inventory") ||
              !!row.postingDate ||
              row.status === "Pending"
            }
            destructive
            onClick={() => {
              setSelectedReceipt(row);
              deleteReceiptModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Receipt
          </MenuItem>
        </>
      );
    },
    [deleteReceiptModal, navigate, params, permissions]
  );

  return (
    <>
      <Table<(typeof data)[number]>
        data={data}
        columns={columns}
        count={count}
        defaultColumnPinning={{
          left: ["receiptId"],
        }}
        defaultColumnVisibility={{
          createdAt: false,
          createdBy: false,
          updatedAt: false,
          updatedBy: false,
        }}
        primaryAction={
          permissions.can("create", "inventory") && (
            <New label="Receipt" to={path.to.newReceipt} />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Receipts"
        table="receipt"
        withSavedView
      />
      {selectedReceipt && selectedReceipt.id && (
        <ConfirmDelete
          action={path.to.deleteReceipt(selectedReceipt.id)}
          isOpen={deleteReceiptModal.isOpen}
          name={selectedReceipt.receiptId!}
          text={`Are you sure you want to delete ${selectedReceipt.receiptId!}? This cannot be undone.`}
          onCancel={() => {
            deleteReceiptModal.onClose();
            setSelectedReceipt(null);
          }}
          onSubmit={() => {
            deleteReceiptModal.onClose();
            setSelectedReceipt(null);
          }}
        />
      )}
    </>
  );
});

ReceiptsTable.displayName = "ReceiptsTable";
export default ReceiptsTable;
