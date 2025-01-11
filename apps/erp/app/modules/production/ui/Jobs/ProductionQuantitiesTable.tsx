import { Badge, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useNavigate, useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { ProductionQuantity, ScrapReason } from "../../types";

type ProductionQuantitiesTableProps = {
  data: ProductionQuantity[];
  count: number;
  operations: { id: string; description: string | null }[];
  scrapReasons: ScrapReason[];
};

const ProductionQuantitiesTable = memo(
  ({
    data,
    count,
    operations,
    scrapReasons,
  }: ProductionQuantitiesTableProps) => {
    const { jobId } = useParams();
    if (!jobId) throw new Error("Job ID is required");
    const [people] = usePeople();

    const columns = useMemo<ColumnDef<ProductionQuantity>[]>(() => {
      return [
        {
          accessorKey: "jobOperationId",
          header: "Operation",
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              {row.original.jobOperation?.description ?? null}
            </Hyperlink>
          ),
          meta: {
            filter: {
              type: "static",
              options: operations.map((operation) => ({
                value: operation.id,
                label: <Enumerable value={operation.description} />,
              })),
            },
          },
        },
        {
          id: "item",
          header: "Item",
          cell: ({ row }) => {
            return row.original.jobOperation?.jobMakeMethod?.item?.readableId;
          },
        },
        {
          accessorKey: "createdBy",
          header: "Employee",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: <Enumerable value={employee.name} />,
              })),
            },
          },
        },
        {
          accessorKey: "type",
          header: "Type",
          cell: ({ row }) => (
            <Badge
              variant={
                row.original.type === "Production"
                  ? "green"
                  : row.original.type === "Rework"
                  ? "orange"
                  : "red"
              }
            >
              {row.original.type}
            </Badge>
          ),
          meta: {
            filter: {
              type: "static",
              options: ["Production", "Rework", "Scrap"].map((type) => ({
                value: type,
                label: (
                  <Badge
                    variant={
                      type === "Production"
                        ? "green"
                        : type === "Rework"
                        ? "orange"
                        : "red"
                    }
                  >
                    {type}
                  </Badge>
                ),
              })),
            },
          },
        },
        {
          accessorKey: "quantity",
          header: "Quantity",
          cell: ({ row }) => row.original.quantity,
        },
        {
          accessorKey: "scrapReasonId",
          header: "Scrap Reason",
          cell: ({ row }) => {
            const scrapReason = scrapReasons.find(
              (reason) => reason.id === row.original.scrapReasonId
            );
            return <Enumerable value={scrapReason?.name ?? ""} />;
          },
          meta: {
            filter: {
              type: "static",
              options: scrapReasons?.map((reason) => ({
                value: reason.id,
                label: <Enumerable value={reason.name ?? ""} />,
              })),
            },
          },
        },
        {
          accessorKey: "notes",
          header: "Notes",
          cell: ({ row }) => (
            <span className="max-w-[200px] truncate block">
              {row.original.notes}
            </span>
          ),
        },
      ];
    }, [operations, people, scrapReasons]);

    const permissions = usePermissions();

    const deleteModal = useDisclosure();
    const [selectedEvent, setSelectedEvent] =
      useState<ProductionQuantity | null>(null);

    const onDelete = (data: ProductionQuantity) => {
      setSelectedEvent(data);
      deleteModal.onOpen();
    };

    const onDeleteCancel = () => {
      setSelectedEvent(null);
      deleteModal.onClose();
    };

    const navigate = useNavigate();

    const renderContextMenu = useCallback<
      (row: ProductionQuantity) => JSX.Element
    >(
      (row) => (
        <>
          <MenuItem
            disabled={!permissions.can("update", "production")}
            onClick={() => navigate(row.id)}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Quantity
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "production")}
            onClick={() => onDelete(row)}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Quantity
          </MenuItem>
        </>
      ),

      // eslint-disable-next-line react-hooks/exhaustive-deps
      [permissions]
    );

    return (
      <>
        <Table<ProductionQuantity>
          compact
          count={count}
          columns={columns}
          data={data}
          renderContextMenu={renderContextMenu}
          title="Production Quantities"
        />
        {deleteModal.isOpen && selectedEvent && (
          <ConfirmDelete
            action={path.to.deleteProductionQuantity(selectedEvent.id)}
            isOpen
            name={`${
              selectedEvent.jobOperation?.description ?? "Operation"
            } by ${
              people.find((p) => p.id === selectedEvent.createdBy)?.name ??
              "Unknown Employee"
            }`}
            text="Are you sure you want to delete this production quantity? This action cannot be undone."
            onCancel={onDeleteCancel}
            onSubmit={onDeleteCancel}
          />
        )}
      </>
    );
  }
);

ProductionQuantitiesTable.displayName = "ProductionQuantitiesTable";

export default ProductionQuantitiesTable;
